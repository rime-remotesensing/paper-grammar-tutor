import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_TEMPERATURE } from '../../src/config/settings.ts'
import { OllamaProvider } from '../../src/llm/providers/ollama/OllamaProvider.ts'
import type { GenerateStructuredRequest, GenerateStructuredResult, HealthStatus, LLMProvider, ModelInfo } from '../../src/llm/types.ts'
import { analyzeSentenceWithComplementVerification } from '../../src/features/grammar/domain/analyzeSentenceWithComplementVerification.ts'
import { startReadingSupport } from '../../src/features/grammar/domain/readingSupportOrchestrator.ts'
import { applyFocusedWhereClauseRepair } from '../../src/features/grammar/domain/whereClauseRelocation.ts'
import { classifyAcceptedPredicates, mergeHybridPredicateStructure } from '../../src/features/grammar/domain/hybridPredicateMerger.ts'
import { resolveSupplementSpan } from '../../src/features/grammar/domain/supplementSpanResolution.ts'
import { buildCoreOnlyTree, buildHybridStructureTree, type StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'
import { deriveStructureNodePresentation } from '../../src/features/grammar/domain/structureNodePresentation.ts'
import { resetFocusedComplementVerifierCache } from '../../src/features/grammar/domain/focusedComplementVerifierService.ts'
import { resetFocusedCopularCoreRepairCache } from '../../src/features/grammar/domain/focusedCopularCoreRepairService.ts'
import { resetFocusedPassiveCoreRepairCache } from '../../src/features/grammar/domain/focusedPassiveCoreRepairService.ts'
import { resetFocusedRelativeLinkCache } from '../../src/features/grammar/domain/focusedRelativeLinkService.ts'
import { resetFocusedSubjectVerbRepairCache } from '../../src/features/grammar/domain/focusedSubjectVerbRepairService.ts'
import { resetFocusedWhereClauseRepairCache } from '../../src/features/grammar/domain/focusedWhereClauseRepairService.ts'
import { resetPredicateStructureCache } from '../../src/features/grammar/domain/predicateStructureService.ts'
import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES, type GeneralizationCase, type GeneralizationSplit } from './dataset.ts'
import { evaluateCore, evaluateTree, type CoreMetrics, type TreeMetrics } from './metrics.ts'

interface Args {
  split: GeneralizationSplit
  model: string
  baseUrl: string
  controlId: string | null
  controlText: string | null
  ids: string[]
  repetitions: number
  outputName: string
  controlOnly: boolean
}

function parseArgs(argv: string[]): Args {
  const valueAfter = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const split = (valueAfter('--split') ?? 'development') as GeneralizationSplit
  if (split !== 'development' && split !== 'holdout') throw new Error('--split must be development or holdout')
  return {
    split,
    model: valueAfter('--model') ?? 'qwen2.5:7b-instruct',
    baseUrl: valueAfter('--base-url') ?? DEFAULT_OLLAMA_BASE_URL,
    controlId: valueAfter('--control-id') ?? null,
    controlText: valueAfter('--control-text') ?? null,
    ids: (valueAfter('--ids') ?? '').split(',').filter(Boolean),
    repetitions: Number(valueAfter('--repetitions') ?? '1'),
    outputName: valueAfter('--output') ?? split,
    controlOnly: argv.includes('--control-only'),
  }
}

interface RequestTrace {
  kind: string
  elapsedMs: number
  callIndex: number
  responseSha256: string
  responseBytes: number
}

function requestKind(request: GenerateStructuredRequest): string {
  const properties = Object.keys((request.jsonSchema.properties ?? {}) as Record<string, unknown>)
  if (properties.includes('sentenceCore')) return 'GrammarAnalysis'
  if (properties.includes('subjectModifiers') && properties.includes('predicates')) return 'PredicateStructure'
  if (properties.includes('relations')) return 'FocusedRelativeLink'
  if (properties.includes('classification')) return 'FocusedComplementVerification'
  if (properties.includes('owner')) return 'FocusedWhereClauseRepair'
  if (properties.includes('pattern') && properties.includes('complement') && properties.length <= 3) return 'FocusedPassiveCoreRepair'
  if (properties.includes('subject') && properties.includes('verb') && properties.includes('complement')) return 'FocusedCopularCoreRepair'
  if (properties.includes('subject') && properties.includes('subjectHead') && properties.includes('verb')) return 'CoreRepair'
  return `Structured:${properties.join(',')}`
}

class TracingProvider implements LLMProvider {
  readonly calls: RequestTrace[] = []
  private readonly delegate: LLMProvider
  constructor(delegate: LLMProvider) { this.delegate = delegate }
  listModels(): Promise<ModelInfo[]> { return this.delegate.listModels() }
  healthCheck(): Promise<HealthStatus> { return this.delegate.healthCheck() }
  async generateStructured(request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    const result = await this.delegate.generateStructured(request)
    this.calls.push({
      kind: requestKind(request),
      elapsedMs: result.elapsedMs,
      callIndex: this.calls.length + 1,
      responseSha256: createHash('sha256').update(result.rawText).digest('hex'),
      responseBytes: Buffer.byteLength(result.rawText, 'utf8'),
    })
    return result
  }
}

let cacheResetSequence = 0

function resetPipelineCaches(): number {
  resetFocusedComplementVerifierCache()
  resetFocusedCopularCoreRepairCache()
  resetFocusedPassiveCoreRepairCache()
  resetFocusedRelativeLinkCache()
  resetFocusedSubjectVerbRepairCache()
  resetFocusedWhereClauseRepairCache()
  resetPredicateStructureCache()
  cacheResetSequence += 1
  return cacheResetSequence
}

interface VisibleTreeNode {
  authorityText: string
  authorityStart: number
  authorityEnd: number
  displayText: string
  displayStart: number
  displayEnd: number
  role: StructureTreeNode['role']
  children: VisibleTreeNode[]
}

function visibleTree(nodes: readonly StructureTreeNode[]): VisibleTreeNode[] {
  return nodes.map((node) => {
    const display = deriveStructureNodePresentation(node)
    return {
      authorityText: node.text,
      authorityStart: node.start,
      authorityEnd: node.end,
      displayText: display.text,
      displayStart: display.start,
      displayEnd: display.end,
      role: node.role,
      children: visibleTree(node.children),
    }
  })
}

type FailureStage = 'none' | 'GrammarAnalysis' | 'focused repair' | 'PredicateStructure' | 'predicate acceptance' | 'hybrid merger' | 'Tree construction' | 'presentation'

function allCoreExact(metrics: CoreMetrics): boolean {
  return metrics.subjectExact && metrics.verbExact && metrics.objectExact && metrics.complementExact && metrics.patternExact
}

function predicateCovered(start: number, end: number, candidates: ReadonlyArray<{ start: number; end: number }>): boolean {
  return candidates.some((candidate) => Math.max(start, candidate.start) < Math.min(end, candidate.end))
}

function firstFailureStage(
  item: GeneralizationCase,
  rawMetrics: CoreMetrics,
  effectiveMetrics: CoreMetrics,
  repairRan: boolean,
  structurePredicates: ReadonlyArray<{ start: number; end: number }>,
  acceptedPredicates: ReadonlyArray<{ start: number; end: number }>,
  hybridPredicates: ReadonlyArray<{ start: number; end: number }>,
  treeMetrics: TreeMetrics,
): FailureStage {
  if (!allCoreExact(effectiveMetrics)) return repairRan && !allCoreExact(rawMetrics) ? 'focused repair' : 'GrammarAnalysis'
  const goldPredicates = item.gold.predicateCores.map(({ verb }) => verb)
  if (goldPredicates.some((verb) => !predicateCovered(verb.start, verb.end, structurePredicates))) return 'PredicateStructure'
  if (goldPredicates.some((verb) => !predicateCovered(verb.start, verb.end, acceptedPredicates))) return 'predicate acceptance'
  if (goldPredicates.some((verb) => !predicateCovered(verb.start, verb.end, hybridPredicates))) return 'hybrid merger'
  if (treeMetrics.wrongRole || treeMetrics.unattachedMeaningfulSpan || treeMetrics.bogusPredicate || treeMetrics.citationAsGrammarNode || treeMetrics.equationPlaceholderCorruption) return 'Tree construction'
  if (treeMetrics.duplicateVisibleConstituent || treeMetrics.parentChildVisibleOverlap || treeMetrics.lexicalLoss) return 'presentation'
  return 'none'
}

function taxonomy(item: GeneralizationCase, core: CoreMetrics, tree: TreeMetrics): string[] {
  const failures = new Set<string>()
  if (core.falseComplement) failures.add(item.tags.includes('passive') ? 'CORE_PASSIVE_PP_AS_COMPLEMENT' : 'CORE_FALSE_COMPLEMENT')
  if (core.overcapturedVerb) failures.add('CORE_VERB_OVERCAPTURE')
  if (core.undercapturedVerb) failures.add('CORE_VERB_UNDERCAPTURE')
  if (core.missingCoreSlot) failures.add('CORE_MISSING_SLOT')
  if (item.gold.predicateCores.length > 1 && (!core.verbExact || !core.patternExact)) failures.add('CORE_COORDINATED_PREDICATE_LOSS')
  if (item.tags.includes('mixed-pattern') && (!core.verbExact || !core.patternExact)) failures.add('CORE_MIXED_PATTERN_COORDINATION_FAILURE')
  if (item.tags.includes('enumeration') && tree.unattachedMeaningfulSpan) failures.add('ENUMERATION_ATTACHMENT_FAILURE')
  if (item.tags.some((tag) => tag.includes('postmodifier')) && tree.unattachedMeaningfulSpan) failures.add('POSTMODIFIER_ATTACHMENT_FAILURE')
  if (item.tags.includes('coordination') && tree.wrongRole) failures.add('COORDINATION_FAILURE')
  if (tree.duplicateVisibleConstituent) failures.add('HYBRID_DUPLICATION')
  if (tree.lexicalLoss) failures.add('TREE_LEXICAL_LOSS')
  if (tree.wrongRole) failures.add('TREE_WRONG_ROLE')
  if (tree.citationAsGrammarNode) failures.add('CITATION_AS_TREE_NODE')
  if (tree.bogusPredicate) failures.add('PREDICATE_STAGE2_PSEUDO_PREDICATE')
  return [...failures]
}

export interface BaselineResult {
  id: string
  split: GeneralizationSplit | 'external-control'
  text: string
  tags: string[]
  wordCount: number
  clauseCount: number
  modifierCount: number
  gold: GeneralizationCase['gold'] | null
  requestTrace: RequestTrace[]
  cacheResetSequence: number
  schemaValid: boolean
  regenerationUsed: boolean
  recoveryUsed: boolean
  coreRepair: unknown
  copularRepair: unknown
  passiveRepair: unknown
  complementVerification: unknown
  rawGrammarAnalysis: unknown
  rawCore: unknown
  effectiveCore: unknown
  rawPredicateStructure: unknown
  whereClauseRepair: string
  acceptedPredicates: unknown
  hybridMerger: unknown
  finalTree: StructureTreeNode[]
  visibleTree: VisibleTreeNode[]
  coreMetrics: CoreMetrics | null
  treeMetrics: TreeMetrics | null
  firstFailureStage: FailureStage | 'unscored-control'
  failureTaxonomy: string[]
  error: string | null
}

async function runCase(provider: TracingProvider, model: string, item: GeneralizationCase): Promise<BaselineResult> {
  const resetSequence = resetPipelineCaches()
  const startCall = provider.calls.length
  const outcome = await analyzeSentenceWithComplementVerification({
    provider, model, sentence: item.text, temperature: DEFAULT_TEMPERATURE,
  })
  if (!outcome.success) {
    return {
      id: item.id, split: item.split, text: item.text, tags: item.tags, wordCount: item.wordCount,
      clauseCount: item.clauseCount, modifierCount: item.modifierCount, gold: item.gold,
      requestTrace: provider.calls.slice(startCall), cacheResetSequence: resetSequence,
      schemaValid: false, regenerationUsed: false, recoveryUsed: false,
      coreRepair: null, copularRepair: null, passiveRepair: null, complementVerification: null,
      rawGrammarAnalysis: null, rawCore: null, effectiveCore: null, rawPredicateStructure: null,
      whereClauseRepair: 'not_run', acceptedPredicates: null, hybridMerger: null, finalTree: [], visibleTree: [],
      coreMetrics: null, treeMetrics: null, firstFailureStage: 'GrammarAnalysis', failureTaxonomy: ['CORE_MISSING_SLOT'], error: outcome.error,
    }
  }

  const verified = outcome.result
  const support = startReadingSupport({
    provider, model, originalText: verified.analysis.normalizedText,
    sentenceCore: verified.effectiveCore, temperature: DEFAULT_TEMPERATURE,
  })
  const structureOutcome = await support.structure
  const relativeOutcome = support.relativeLink ? await support.relativeLink : null
  let whereClauseRepair = 'not_run'
  let structure = structureOutcome.success ? structureOutcome.structure : null
  if (structure) {
    const repaired = await applyFocusedWhereClauseRepair({
      provider, model, temperature: DEFAULT_TEMPERATURE, sentence: verified.analysis.normalizedText,
      sentenceCore: verified.effectiveCore, structure,
    })
    structure = repaired.structure
    whereClauseRepair = repaired.status
  }
  const relations = relativeOutcome?.success ? relativeOutcome.relations : []
  const classification = structure
    ? classifyAcceptedPredicates(verified.analysis.normalizedText, verified.effectiveCore, structure.predicates)
    : null
  const hybrid = structure
    ? mergeHybridPredicateStructure(verified.analysis.normalizedText, verified.effectiveCore, structure)
    : null
  const supplement = hybrid
    ? resolveSupplementSpan(verified.analysis.normalizedText, verified.effectiveCore, verified.rawCore, verified.verification, hybrid)
    : null
  const tree = hybrid
    ? buildHybridStructureTree(verified.effectiveCore, hybrid, supplement, relations)
    : buildCoreOnlyTree(verified.effectiveCore)
  const rawMetrics = evaluateCore(item, verified.rawCore)
  const coreMetrics = evaluateCore(item, verified.effectiveCore)
  const treeMetrics = evaluateTree(item, tree)
  const repairRan = verified.coreRepair.strategy !== 'none' || verified.copularRepair.status !== 'not_applicable' ||
    verified.passiveRepair.status !== 'not_applicable' || verified.verification.status !== 'not_applicable'
  const stage = firstFailureStage(
    item, rawMetrics, coreMetrics, repairRan,
    structure?.predicates ?? [], classification?.accepted ?? [], hybrid?.predicates ?? [], treeMetrics,
  )
  return {
    id: item.id, split: item.split, text: item.text, tags: item.tags, wordCount: item.wordCount,
    clauseCount: item.clauseCount, modifierCount: item.modifierCount, gold: item.gold,
    requestTrace: provider.calls.slice(startCall), cacheResetSequence: resetSequence,
    schemaValid: verified.meta.schemaValid,
    regenerationUsed: verified.meta.regenerated, recoveryUsed: outcome.recoveryUsed,
    coreRepair: verified.coreRepair, copularRepair: verified.copularRepair, passiveRepair: verified.passiveRepair,
    complementVerification: verified.verification, rawGrammarAnalysis: verified.analysis,
    rawCore: verified.rawCore, effectiveCore: verified.effectiveCore,
    rawPredicateStructure: structureOutcome.success ? structureOutcome.structure : structureOutcome,
    whereClauseRepair, acceptedPredicates: classification, hybridMerger: hybrid,
    finalTree: tree, visibleTree: visibleTree(tree), coreMetrics, treeMetrics,
    firstFailureStage: stage, failureTaxonomy: taxonomy(item, coreMetrics, treeMetrics), error: null,
  }
}

async function runExternalControl(provider: TracingProvider, model: string, id: string, text: string): Promise<BaselineResult> {
  const synthetic: GeneralizationCase = {
    id, split: 'development', locked: false, text, tags: ['external-live-control'],
    wordCount: text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0,
    clauseCount: 0, modifierCount: 0,
    gold: {
      subject: { text: text, start: 0, end: text.length },
      primaryCore: { verb: { text, start: 0, end: text.length }, indirectObject: null, object: null, complement: null, pattern: 'other' },
      predicateCores: [], attachments: [],
    },
  }
  const result = await runCase(provider, model, synthetic)
  return { ...result, split: 'external-control', gold: null, coreMetrics: null, treeMetrics: null, firstFailureStage: 'unscored-control', failureTaxonomy: [] }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const provider = new TracingProvider(new OllamaProvider(args.baseUrl))
  const health = await provider.healthCheck()
  if (!health.ok) throw new Error(`Ollama unavailable: ${health.message}`)
  const allCases = args.split === 'development' ? DEVELOPMENT_CASES : LOCKED_HOLDOUT_CASES
  const cases = args.controlOnly ? [] : args.ids.length === 0 ? allCases : allCases.filter(({ id }) => args.ids.includes(id))
  if (cases.length === 0 && !args.controlOnly) throw new Error('No benchmark cases selected')
  if (args.controlOnly && (!args.controlId || !args.controlText)) throw new Error('--control-only requires --control-id and --control-text')
  const results: BaselineResult[] = []
  for (let repetition = 0; repetition < args.repetitions; repetition++) {
    for (const [index, item] of cases.entries()) {
      process.stdout.write(`[${repetition + 1}/${args.repetitions}][${index + 1}/${cases.length}] ${item.id} ... `)
      const result = await runCase(provider, args.model, item)
      results.push(result)
      console.log(result.error ? `ERROR ${result.error}` : result.firstFailureStage)
    }
  }
  if (args.controlId && args.controlText) {
    console.log(`external control ${args.controlId} ...`)
    results.push(await runExternalControl(provider, args.model, args.controlId, args.controlText))
  }
  const outputDir = path.join('benchmark', 'results', 'generalization')
  await mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `${args.outputName}.json`)
  await writeFile(outputPath, JSON.stringify({ model: args.model, split: args.split, results }, null, 2), 'utf8')
  console.log(`Wrote ${outputPath}`)
}

await main()
