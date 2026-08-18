import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { buildCoreOnlyTree, type StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'
import type { SentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema.ts'
import { DEVELOPMENT_CASES, type GeneralizationCase, type GoldSpan } from './dataset.ts'
import { evaluateTree, rate, type TreeMetrics } from './metrics.ts'
import type { BaselineResult } from './run.ts'

interface Region { kind: 'opening' | 'main' | 'enumeration' | 'citation' | 'semicolonMember'; start: number; end: number; text: string }

function region(text: string, kind: Region['kind'], start: number, end: number): Region {
  return { kind, start, end, text: text.slice(start, end).trim() }
}

/** Non-production Stage-0 spike: punctuation-bounded regions only, with no five-pattern role assignment. */
export function identifyStructuralRegions(text: string): Region[] {
  const regions: Region[] = []
  let mainStart = 0
  let mainEnd = text.length
  const citation = text.match(/\s+\([^)]*(?:et\s+al\.|(?:19|20)\d{2})[^)]*\)\.?$/i)
  if (citation?.index !== undefined) {
    regions.push(region(text, 'citation', citation.index, text.length))
    mainEnd = citation.index
  }
  const opening = text.slice(0, mainEnd).match(/^(?:Although|Whereas|Because|When|If|After)\b[^,]*,/i)
  if (opening) {
    regions.push(region(text, 'opening', 0, opening[0].length - 1))
    mainStart = opening[0].length
  }
  const colon = text.indexOf(':', mainStart)
  if (colon >= 0 && colon < mainEnd) {
    regions.push(region(text, 'enumeration', colon + 1, mainEnd))
    mainEnd = colon
  }
  const semicolonSource = text.slice(mainStart, mainEnd)
  if (semicolonSource.includes(';')) {
    let offset = mainStart
    for (const member of semicolonSource.split(';')) {
      const start = text.indexOf(member, offset)
      regions.push(region(text, 'semicolonMember', start, start + member.length))
      offset = start + member.length + 1
    }
  }
  regions.push(region(text, 'main', mainStart, mainEnd))
  return regions.sort((a, b) => a.start - b.start)
}

function contains(regionValue: Region, span: GoldSpan): boolean {
  return regionValue.start <= span.start && span.end <= regionValue.end
}

function flatten(nodes: readonly StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end)
}

function allGoldPredicatesCovered(item: GeneralizationCase, candidates: ReadonlyArray<{ start: number; end: number }>): boolean {
  return item.gold.predicateCores.every(({ verb }) => candidates.some((candidate) => overlaps(candidate, verb)))
}

function hasAnyTreeDefect(metrics: TreeMetrics): boolean {
  return Object.values(metrics).some(Boolean)
}

async function main(): Promise<void> {
  const input = JSON.parse(await readFile('benchmark/results/generalization/development.json', 'utf8')) as { results: BaselineResult[] }
  const baseline = input.results.filter((result) => result.split === 'development')
  const byId = new Map(baseline.map((result) => [result.id, result]))
  const items = DEVELOPMENT_CASES.map((item) => ({ item, result: byId.get(item.id)! }))

  const regionRows = items.map(({ item }) => {
    const regions = identifyStructuralRegions(item.text)
    const main = regions.find(({ kind }) => kind === 'main')!
    const needsSeparation = item.tags.some((tag) => ['subordinate-clause', 'enumeration', 'citation'].includes(tag))
    const separationKinds = new Set(regions.map(({ kind }) => kind))
    const expectedSeparated = [
      item.tags.includes('subordinate-clause') ? separationKinds.has('opening') : true,
      item.tags.includes('enumeration') ? separationKinds.has('enumeration') || separationKinds.has('semicolonMember') : true,
      item.tags.includes('citation') ? separationKinds.has('citation') : true,
    ].every(Boolean)
    return {
      id: item.id,
      regions,
      mainAuthorityRetained: contains(main, item.gold.subject) && contains(main, item.gold.primaryCore.verb),
      structuralPayloadSeparated: !needsSeparation || expectedSeparated,
    }
  })

  const predicateRows = items.map(({ item, result }) => {
    const structure = result.rawPredicateStructure as { predicates?: Array<{ start: number; end: number }> }
    const accepted = result.acceptedPredicates as { accepted?: Array<{ start: number; end: number }> } | null
    const hybrid = result.hybridMerger as { predicates?: Array<{ start: number; end: number }> } | null
    const finalPredicates = flatten(result.finalTree).filter(({ role }) => role === 'predicate' || role === 'coordinatedPredicate')
    return {
      id: item.id,
      multiPredicate: item.gold.predicateCores.length > 1,
      rawStructureCoversAll: allGoldPredicatesCovered(item, structure.predicates ?? []),
      acceptedCoversAll: allGoldPredicatesCovered(item, accepted?.accepted ?? []),
      hybridCoversAll: allGoldPredicatesCovered(item, hybrid?.predicates ?? []),
      finalTreeCoversAll: allGoldPredicatesCovered(item, finalPredicates),
    }
  })

  const defective = items.filter(({ result }) => result.treeMetrics && hasAnyTreeDefect(result.treeMetrics))
  const coarseRows = defective.map(({ item, result }) => {
    const coarse = buildCoreOnlyTree(result.effectiveCore as SentenceCore)
    const metrics = evaluateTree(item, coarse)
    const coarsePresentationSafe = !metrics.duplicateVisibleConstituent && !metrics.parentChildVisibleOverlap &&
      !metrics.lexicalLoss && !metrics.bogusPredicate && !metrics.citationAsGrammarNode && !metrics.equationPlaceholderCorruption
    const core = result.coreMetrics!
    const coreAuthorityCorrect = core.subjectExact && core.verbExact && core.objectExact && core.complementExact && core.patternExact
    return { id: item.id, coarsePresentationSafe, coreAuthorityCorrect, eligibleSafeFallback: coarsePresentationSafe && coreAuthorityCorrect }
  })

  const multi = predicateRows.filter(({ multiPredicate }) => multiPredicate)
  const output = {
    candidateA_currentFullPipeline: {
      developmentCases: items.length,
      allPredicateCoresVisibleRate: rate(predicateRows, ({ finalTreeCoversAll }) => finalTreeCoversAll),
      multiPredicateCoresVisibleRate: rate(multi, ({ finalTreeCoversAll }) => finalTreeCoversAll),
    },
    candidateB_mainClauseCoreFirst: {
      kind: 'non-production deterministic region-isolation feasibility spike',
      mainSubjectAndVerbRetentionRate: rate(regionRows, ({ mainAuthorityRetained }) => mainAuthorityRetained),
      requiredPayloadSeparationRate: rate(regionRows, ({ structuralPayloadSeparated }) => structuralPayloadSeparated),
      rows: regionRows,
    },
    candidateC_hierarchicalRegionsAndSharedSubjectPredicateCores: {
      kind: 'non-production representation spike using existing grounded Stage-2 candidates',
      multiPredicateCases: multi.length,
      rawStructureCoverage: rate(multi, ({ rawStructureCoversAll }) => rawStructureCoversAll),
      predicateAcceptanceCoverage: rate(multi, ({ acceptedCoversAll }) => acceptedCoversAll),
      hybridCoverage: rate(multi, ({ hybridCoversAll }) => hybridCoversAll),
      finalTreeCoverage: rate(multi, ({ finalTreeCoversAll }) => finalTreeCoversAll),
      rows: predicateRows,
    },
    candidateD_coarseFallback: {
      defectiveDetailedTrees: defective.length,
      coarsePresentationSafeRate: rate(coarseRows, ({ coarsePresentationSafe }) => coarsePresentationSafe),
      eligibleSafeFallbackRate: rate(coarseRows, ({ eligibleSafeFallback }) => eligibleSafeFallback),
      rows: coarseRows,
    },
  }
  await mkdir('benchmark/results/generalization', { recursive: true })
  await writeFile('benchmark/results/generalization/spikes.json', JSON.stringify(output, null, 2), 'utf8')
  console.log(JSON.stringify({
    A: output.candidateA_currentFullPipeline,
    B: { ...output.candidateB_mainClauseCoreFirst, rows: undefined },
    C: { ...output.candidateC_hierarchicalRegionsAndSharedSubjectPredicateCores, rows: undefined },
    D: { ...output.candidateD_coarseFallback, rows: undefined },
  }, null, 2))
}

await main()
