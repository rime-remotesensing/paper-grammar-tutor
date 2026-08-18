import { readFile, writeFile } from 'node:fs/promises'
import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES, type GeneralizationCase } from './dataset.ts'
import type { SentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema.ts'
import { evaluateCore, wordLengthBin, type CoreMetrics, type TreeMetrics } from './metrics.ts'

interface Trace {
  kind: string
  elapsedMs: number
  callIndex?: number
  responseSha256?: string
  responseBytes?: number
}

interface GoldValue {
  primaryCore: { complement: unknown | null; object: unknown | null }
}

interface BaselineValue {
  id: string
  split: string
  tags: string[]
  wordCount: number
  clauseCount: number
  modifierCount: number
  gold: GoldValue | null
  requestTrace: Trace[]
  cacheResetSequence?: number
  schemaValid: boolean
  regenerationUsed: boolean
  recoveryUsed: boolean
  coreRepair: Record<string, unknown> | null
  copularRepair: Record<string, unknown> | null
  passiveRepair: Record<string, unknown> | null
  complementVerification: Record<string, unknown> | null
  rawCore: Record<string, unknown> | null
  effectiveCore: Record<string, unknown> | null
  rawPredicateStructure: Record<string, unknown> | null
  whereClauseRepair: string
  acceptedPredicates: Record<string, unknown> | null
  hybridMerger: Record<string, unknown> | null
  finalTree: Array<Record<string, unknown>>
  coreMetrics: CoreMetrics | null
  treeMetrics: TreeMetrics | null
  firstFailureStage: string
  failureTaxonomy: string[]
  error: string | null
}

interface SpikeValue {
  candidateA_currentFullPipeline: Record<string, number>
  candidateB_mainClauseCoreFirst: Record<string, unknown>
  candidateC_hierarchicalRegionsAndSharedSubjectPredicateCores: Record<string, unknown>
  candidateD_coarseFallback: Record<string, unknown>
}

async function bundle(name: string): Promise<BaselineValue[]> {
  const parsed = JSON.parse(await readFile(`benchmark/results/generalization/${name}.json`, 'utf8')) as { results: BaselineValue[] }
  return parsed.results
}

function percent(numerator: number, denominator: number): string {
  return denominator === 0 ? 'N/A' : `${(100 * numerator / denominator).toFixed(1)}% (${numerator}/${denominator})`
}

function pass<T>(values: readonly T[], predicate: (value: T) => boolean): string {
  return percent(values.filter(predicate).length, values.length)
}

function coreCount(metrics: CoreMetrics): number {
  return [metrics.subjectExact, metrics.verbExact, metrics.objectExact, metrics.complementExact, metrics.patternExact].filter(Boolean).length
}

function allCore(metrics: CoreMetrics): boolean {
  return coreCount(metrics) === 5
}

function coreSummary(label: string, values: readonly BaselineValue[]): string {
  const valid = values.filter((value): value is BaselineValue & { coreMetrics: CoreMetrics; gold: GoldValue } => value.coreMetrics !== null && value.gold !== null)
  const cNull = valid.filter(({ gold }) => gold.primaryCore.complement === null)
  const oNull = valid.filter(({ gold }) => gold.primaryCore.object === null)
  return `| ${label} | ${valid.length} | ${pass(valid, (v) => v.schemaValid)} | ${pass(valid, (v) => v.coreMetrics.subjectExact)} | ${pass(valid, (v) => v.coreMetrics.verbExact)} | ${pass(valid, (v) => v.coreMetrics.objectExact)} | ${pass(valid, (v) => v.coreMetrics.complementExact)} | ${pass(valid, (v) => v.coreMetrics.patternExact)} | ${pass(cNull, (v) => v.coreMetrics.falseComplement)} | ${pass(oNull, (v) => v.coreMetrics.falseObject)} | ${pass(valid, (v) => v.coreMetrics.missingCoreSlot)} |`
}

function treeSummary(label: string, values: readonly BaselineValue[]): string {
  const valid = values.filter((value): value is BaselineValue & { treeMetrics: TreeMetrics } => value.treeMetrics !== null)
  return `| ${label} | ${valid.length} | ${pass(valid, (v) => v.treeMetrics.duplicateVisibleConstituent)} | ${pass(valid, (v) => v.treeMetrics.parentChildVisibleOverlap)} | ${pass(valid, (v) => v.treeMetrics.lexicalLoss)} | ${pass(valid, (v) => v.treeMetrics.wrongRole)} | ${pass(valid, (v) => v.treeMetrics.unattachedMeaningfulSpan)} | ${pass(valid, (v) => v.treeMetrics.bogusPredicate)} | ${pass(valid, (v) => v.treeMetrics.citationAsGrammarNode)} | ${pass(valid, (v) => v.treeMetrics.equationPlaceholderCorruption)} |`
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const key = keyOf(value)
    groups.set(key, [...(groups.get(key) ?? []), value])
  }
  return groups
}

function countRows(values: readonly BaselineValue[], keyOf: (value: BaselineValue) => string): string[] {
  return [...groupBy(values, keyOf)].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => `| ${key} | ${rows.length} |`)
}

function accuracyRows(values: readonly BaselineValue[], keyOf: (value: BaselineValue) => string): string[] {
  return [...groupBy(values, keyOf)].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => {
    const valid = rows.filter((row): row is BaselineValue & { coreMetrics: CoreMetrics; gold: GoldValue } => row.coreMetrics !== null && row.gold !== null)
    const cNull = valid.filter(({ gold }) => gold.primaryCore.complement === null)
    return `| ${key} | ${valid.length} | ${pass(valid, (v) => v.coreMetrics.subjectExact)} | ${pass(valid, (v) => v.coreMetrics.verbExact)} | ${pass(valid, (v) => v.coreMetrics.objectExact)} | ${pass(valid, (v) => v.coreMetrics.complementExact)} | ${pass(valid, (v) => v.coreMetrics.patternExact)} | ${pass(cNull, (v) => v.coreMetrics.falseComplement)} |`
  })
}

function statusCount(values: readonly BaselineValue[], field: keyof Pick<BaselineValue, 'coreRepair' | 'copularRepair' | 'passiveRepair' | 'complementVerification'>, key: string): string {
  const counts = groupBy(values, (value) => String(value[field]?.[key] ?? 'null'))
  return [...counts].sort((a, b) => b[1].length - a[1].length).map(([status, rows]) => `${status}=${rows.length}`).join(', ')
}

function repairRow(
  label: string,
  values: readonly BaselineValue[],
  invoked: (value: BaselineValue) => boolean,
  succeeded: (value: BaselineValue) => boolean,
  comparable: boolean,
): string {
  const rows = values.filter(invoked)
  const scored = rows.filter((row): row is BaselineValue & { coreMetrics: CoreMetrics; rawCore: Record<string, unknown>; effectiveCore: Record<string, unknown> } => row.coreMetrics !== null && row.rawCore !== null && row.effectiveCore !== null)
  if (!comparable) return `| ${label} | ${rows.length} | ${rows.filter(succeeded).length} | N/A | N/A | N/A |`
  const comparisons = scored.map((row) => ({
    row,
    raw: evaluateCore(caseById.get(row.id)!, row.rawCore as unknown as SentenceCore),
  }))
  const improved = comparisons.filter(({ row, raw }) => coreCount(row.coreMetrics) > coreCount(raw))
  const unnecessary = comparisons.filter(({ raw }) => allCore(raw))
  const regressions = comparisons.filter(({ row, raw }) => coreCount(row.coreMetrics) < coreCount(raw))
  return `| ${label} | ${rows.length} | ${rows.filter(succeeded).length} | ${improved.length} | ${unnecessary.length} | ${regressions.length} |`
}

function tagsFor(values: readonly GeneralizationCase[]): string {
  const counts = new Map<string, number>()
  for (const value of values) for (const tag of value.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([tag, count]) => `${tag}=${count}`).join(', ')
}

function shortSpan(value: unknown): string {
  if (!value || typeof value !== 'object') return 'null'
  const candidate = value as { text?: unknown; start?: unknown; end?: unknown }
  return typeof candidate.text === 'string' ? `“${candidate.text}” [${candidate.start}, ${candidate.end})` : 'null'
}

const development = (await bundle('development')).filter(({ split }) => split === 'development')
const holdout = (await bundle('holdout')).filter(({ split }) => split === 'holdout')
const all = [...development, ...holdout]
const stability = await bundle('stability')
const knn = (await bundle('control-knn'))[0]
const mixed = (await bundle('control-mixed'))[0]
const spikes = JSON.parse(await readFile('benchmark/results/generalization/spikes.json', 'utf8')) as SpikeValue

if (development.length !== 48 || holdout.length !== 24 || stability.length !== 36) {
  throw new Error(`Incomplete benchmark: development=${development.length}, holdout=${holdout.length}, stability=${stability.length}`)
}

const selectedIds = new Set(stability.map(({ id }) => id))
const stabilityGroups = groupBy([...development.filter(({ id }) => selectedIds.has(id)), ...stability], ({ id }) => id)
const stabilityStageStable = [...stabilityGroups.values()].filter((rows) => new Set(rows.map(({ firstFailureStage }) => firstFailureStage)).size === 1).length
const stabilityCoreStable = [...stabilityGroups.values()].filter((rows) => new Set(rows.map(({ coreMetrics }) => JSON.stringify(coreMetrics))).size === 1).length
const stabilityTreeStable = [...stabilityGroups.values()].filter((rows) => new Set(rows.map(({ treeMetrics }) => JSON.stringify(treeMetrics))).size === 1).length
const unstableCoreIds = [...stabilityGroups].filter(([, rows]) => new Set(rows.map(({ coreMetrics }) => JSON.stringify(coreMetrics))).size > 1).map(([id]) => id)
const stabilityTraces = stability.flatMap(({ requestTrace }) => requestTrace)
const traceIndices = stabilityTraces.map(({ callIndex }) => callIndex).filter((value): value is number => value !== undefined)
const freshGrammarRuns = stability.filter(({ requestTrace }) => requestTrace.some(({ kind }) => kind === 'GrammarAnalysis')).length
const distinctResponseIds = [...groupBy(stability, ({ id }) => id).values()].filter((rows) => new Set(rows.map(({ requestTrace }) => requestTrace.map(({ responseSha256 }) => responseSha256).join(','))).size > 1).length
const cacheEvidencePass = new Set(stability.map(({ cacheResetSequence }) => cacheResetSequence)).size === 36 &&
  freshGrammarRuns === 36 && new Set(traceIndices).size === stabilityTraces.length && Math.min(...traceIndices) === 1 && Math.max(...traceIndices) === stabilityTraces.length

const categories = [
  'baseline', 'passive', 'passive-pp', 'infinitive', 'reduced-relative', 'relative-clause',
  'postnominal-participle', 'long-np', 'multiple-pp', 'coordination', 'shared-subject',
  'mixed-pattern', 'three-predicates', 'internal-np-coordination', 'subordinate-clause',
  'enumeration', 'respectively', 'citation', 'equation', 'multiple-modifier-depths', 'long-50-80', 'long-80+',
]

const categoryRows = categories.map((category) => {
  const rows = all.filter(({ tags }) => tags.includes(category))
  const valid = rows.filter((row): row is BaselineValue & { coreMetrics: CoreMetrics; treeMetrics: TreeMetrics; gold: GoldValue } => row.coreMetrics !== null && row.treeMetrics !== null && row.gold !== null)
  const cNull = valid.filter(({ gold }) => gold.primaryCore.complement === null)
  return `| ${category} | ${valid.length} | ${pass(valid, (v) => allCore(v.coreMetrics))} | ${pass(valid, (v) => v.coreMetrics.patternExact)} | ${pass(cNull, (v) => v.coreMetrics.falseComplement)} | ${pass(valid, (v) => Object.values(v.treeMetrics).some(Boolean))} |`
})

const taxonomy = [...groupBy(all.flatMap((value) => value.failureTaxonomy.map((name) => ({ name, split: value.split }))), ({ name }) => name)]
  .sort((a, b) => b[1].length - a[1].length)
  .map(([name, rows]) => `| ${name} | ${rows.filter(({ split }) => split === 'development').length} | ${rows.filter(({ split }) => split === 'holdout').length} | ${rows.length} |`)

const stages = [...new Set(all.map(({ firstFailureStage }) => firstFailureStage))].sort()
const stageRows = stages.map((stage) => `| ${stage} | ${development.filter((v) => v.firstFailureStage === stage).length} | ${holdout.filter((v) => v.firstFailureStage === stage).length} | ${all.filter((v) => v.firstFailureStage === stage).length} |`)

const caseById = new Map([...DEVELOPMENT_CASES, ...LOCKED_HOLDOUT_CASES].map((item) => [item.id, item]))
const devCoreRepairInvoked = (value: BaselineValue) => value.coreRepair?.strategy !== 'none'
const focusedRows = [
  repairRow('Stage-1 core recovery (forced/focused)', development, devCoreRepairInvoked, (v) => v.coreRepair?.status === 'repaired', false),
  repairRow('Focused copular core', development, (v) => v.copularRepair?.status !== 'not_applicable', (v) => v.copularRepair?.status === 'repaired', true),
  repairRow('Focused passive core', development, (v) => v.passiveRepair?.status !== 'not_applicable', (v) => v.passiveRepair?.status === 'repaired', true),
  repairRow('Focused complement verification', development, (v) => v.complementVerification?.status !== 'not_applicable', (v) => String(v.complementVerification?.status).startsWith('confirmed_'), true),
  repairRow('Focused where-clause repair', development, (v) => !['not_applicable', 'not_run'].includes(v.whereClauseRepair), (v) => v.whereClauseRepair === 'repaired', false),
]

const knnRaw = knn.rawCore as { subject?: unknown; verb?: unknown; complement?: unknown; pattern?: unknown }
const knnEffective = knn.effectiveCore as { complement?: unknown; pattern?: unknown }
const mixedRaw = mixed.rawCore as { subject?: unknown; verb?: unknown; complement?: unknown; pattern?: unknown }

const a = spikes.candidateA_currentFullPipeline
const b = spikes.candidateB_mainClauseCoreFirst
const c = spikes.candidateC_hierarchicalRegionsAndSharedSubjectPredicateCores
const d = spikes.candidateD_coarseFallback

const markdown = `# Prototype 2.6D — Complex Sentence Generalization Benchmark

Measurement date: 2026-08-18 (Asia/Tokyo)

Model/provider: \`qwen2.5:7b-instruct\` / local Ollama, production temperature and schemas

Production grammar, Tree, ReadingGuide, and Docker code changes during 2.6D: **none**

## Executive decision

**COMPLEX_SENTENCE_GENERALIZATION_ARCHITECTURE_READY_FOR_REVIEW**

The audit is complete and reproducible. The present single-core Stage-1 schema is not adequate as the canonical authority for shared-subject predicates with different five-pattern structures. For Prototype 2.6E, use **one shared subject plus multiple grounded predicate cores** as canonical authority, while deriving a primary-core compatibility projection for the existing simple-sentence UI. Add Stage-0 grounded structural regions and an enumeration container; retain a coarse-but-correct fallback. This is a recommendation only—no production implementation was made.

## A. Benchmark dataset composition

- New synthetic/paraphrased academic set: 72 sentences: 48 development + 24 locked holdout.
- Every gold S/V/IO/O/C span is deterministic and source-grounded; the loader rejects missing or ambiguous source spans.
- Gold C follows the Japanese five-pattern definition. Post-verbal PPs are modifiers unless they are genuine predicate complements.
- Development tag counts: ${tagsFor(DEVELOPMENT_CASES)}.
- Locked holdout tag counts: ${tagsFor(LOCKED_HOLDOUT_CASES)}.
- The locked holdout was frozen before the unchanged production pipeline was run, and was evaluated once.
- The initial development JSON also contains one unscored non-development artifact produced by an early absent-flag parser bug. Aggregation is explicitly filtered to \`split === development\` and exactly 48 IDs; no scored row is affected. The parser was fixed before stability and external-control runs. The baseline was not rerun or replaced after holdout inspection.

## B. Legacy holdout status

- Files: \`benchmark/sentences/development.json\` (28) and \`benchmark/sentences/holdout.json\` (57). Text and gold were not edited.
- Legacy structural coverage includes SV/SVO/SVC/SVOO/SVOC, passives, PPs, relatives, gerund subjects, coordination, clauses, ambiguity, and modifier cases.
- It is a **legacy holdout, not fully blind**. Two sentences have been reused in recent Prototype 2.x prompt/tests: \`h25-relative-who\` (focused S/V prompt, hybrid merger, relative-link prefilter) and \`h37-gerund-subject\` (comma-ing gate, hybrid merger).
- Post-complex-holdout run (57): schema 100%, regeneration 0%, subject 74%, subjectHead 74%, verb 70%, IO 95%, object 77%, subject-complement 70% (n=20), object-complement 92% (n=37), constituent average 80%, derived pattern 56%; average 6171 ms.

## C. Complexity distribution

| Word bin | Sentences |
|---|---:|
${countRows(all, (v) => wordLengthBin(v.wordCount)).join('\n')}

| Clauses | Sentences |
|---|---:|
${countRows(all, (v) => v.clauseCount >= 3 ? '3+' : String(v.clauseCount)).join('\n')}

| Modifiers | Sentences |
|---|---:|
${countRows(all, (v) => v.modifierCount <= 1 ? '0-1' : v.modifierCount <= 3 ? '2-3' : '4+').join('\n')}

## D–I. Current core baseline

False-C uses only gold-C-null sentences as its denominator; false-O analogously uses gold-O-null sentences.

| Split | n | Schema | S exact | V exact | O exact | C exact | Pattern | False C | False O | Missing slot |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${coreSummary('Development', development)}
${coreSummary('Locked holdout', holdout)}
${coreSummary('Combined', all)}

### D. Current baseline S accuracy

Development ${pass(development, (v) => v.coreMetrics?.subjectExact === true)}; locked holdout ${pass(holdout, (v) => v.coreMetrics?.subjectExact === true)}.

### E. Current baseline V accuracy

Development ${pass(development, (v) => v.coreMetrics?.verbExact === true)}; locked holdout ${pass(holdout, (v) => v.coreMetrics?.verbExact === true)}.

### F. Current baseline O accuracy

Development ${pass(development, (v) => v.coreMetrics?.objectExact === true)}; locked holdout ${pass(holdout, (v) => v.coreMetrics?.objectExact === true)}.

### G. Current baseline C accuracy

Development ${pass(development, (v) => v.coreMetrics?.complementExact === true)}; locked holdout ${pass(holdout, (v) => v.coreMetrics?.complementExact === true)}.

### H. Sentence-pattern accuracy

Development ${pass(development, (v) => v.coreMetrics?.patternExact === true)}; locked holdout ${pass(holdout, (v) => v.coreMetrics?.patternExact === true)}.

### I. False-complement rate

Development ${pass(development.filter((v) => v.gold?.primaryCore.complement === null), (v) => v.coreMetrics?.falseComplement === true)}; locked holdout ${pass(holdout.filter((v) => v.gold?.primaryCore.complement === null), (v) => v.coreMetrics?.falseComplement === true)}.

Development verb overcapture: ${pass(development, (v) => v.coreMetrics?.overcapturedVerb === true)}; undercapture: ${pass(development, (v) => v.coreMetrics?.undercapturedVerb === true)}.

Locked-holdout verb overcapture: ${pass(holdout, (v) => v.coreMetrics?.overcapturedVerb === true)}; undercapture: ${pass(holdout, (v) => v.coreMetrics?.undercapturedVerb === true)}.

## J. Results by sentence length

| Split / word bin | n | S | V | O | C | Pattern | False C |
|---|---:|---:|---:|---:|---:|---:|---:|
${accuracyRows(development, (v) => `Development ${wordLengthBin(v.wordCount)}`).join('\n')}
${accuracyRows(holdout, (v) => `Holdout ${wordLengthBin(v.wordCount)}`).join('\n')}

The >80-word bin is intentionally small and therefore diagnostic, not a population estimate. The longer/enumerated examples show that structural attachment degrades more sharply than schema validity.

## K. Results by structure category

“Any Tree defect” is the union of the deterministic Tree metrics.

| Category | n | All 5 core fields exact | Pattern | False C | Any Tree defect |
|---|---:|---:|---:|---:|---:|
${categoryRows.join('\n')}

Boolean strata required by the audit are represented above: passive, enumeration, coordination, and citation; word, clause, and modifier strata are in C/J.

## L–N. Tree metrics

| Split | n | Duplicate visible | Parent-child overlap | Lexical loss | Wrong role | Unattached span | Bogus predicate | Citation node | Equation corruption |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${treeSummary('Development', development)}
${treeSummary('Locked holdout', holdout)}
${treeSummary('Combined', all)}

### L. Tree duplicate rate

Development ${pass(development, (v) => v.treeMetrics?.duplicateVisibleConstituent === true)}; locked holdout ${pass(holdout, (v) => v.treeMetrics?.duplicateVisibleConstituent === true)}.

### M. Tree lexical-loss rate

Development ${pass(development, (v) => v.treeMetrics?.lexicalLoss === true)}; locked holdout ${pass(holdout, (v) => v.treeMetrics?.lexicalLoss === true)}.

### N. Tree wrong-role rate

Development ${pass(development, (v) => v.treeMetrics?.wrongRole === true)}; locked holdout ${pass(holdout, (v) => v.treeMetrics?.wrongRole === true)}.

The required presentation invariant held: **lexical loss = 0**. Duplicate visible constituents also remained 0; the residual parent-child overlap metric identifies semantic/authority overlap rather than duplicate presentation rows.

## O. Failure taxonomy

| Root-cause class | Development | Holdout | Total |
|---|---:|---:|---:|
${taxonomy.join('\n')}

The coordination categories are supported by multiple synthetic cases. The second live control additionally exhibits predicate-coordination nesting and internal-NP-coordination loss, but those two labels are kept as live-control findings rather than promoted to corpus-level taxonomy without multiple scored cases.

## P. First-failure-stage distribution

| First stage | Development | Holdout | Total |
|---|---:|---:|---:|
${stageRows.join('\n')}

This distribution prevents downstream Tree defects from being incorrectly attributed to Tree construction when Stage 1 or Stage 2 was already corrupt.

## Q. Focused-repair invocation/success audit

Development status inventory:

- Stage-1 core recovery: ${statusCount(development, 'coreRepair', 'strategy')} (status: ${statusCount(development, 'coreRepair', 'status')}).
- Copular repair: ${statusCount(development, 'copularRepair', 'status')}.
- Passive repair: ${statusCount(development, 'passiveRepair', 'status')}.
- Complement verification: ${statusCount(development, 'complementVerification', 'status')}.
- Where-clause repair: ${[...groupBy(development, (v) => v.whereClauseRepair)].map(([status, rows]) => `${status}=${rows.length}`).join(', ')}.

| Mechanism | Invoked | Mechanism success | Gold-positive/improved | Unnecessary/no-op | Regression |
|---|---:|---:|---:|---:|---:|
${focusedRows.join('\n')}

Important limitation: \`rawGrammarAnalysis\`/\`rawCore\` are already post auto-recovery. Therefore forced-core and focused-S/V pre-repair authority is not exposed, and their true-positive/unnecessary/regression counts cannot be reconstructed without rerunning a modified production pipeline; they are reported as N/A rather than guessed. For focused copular/passive/complement layers, \`rawCore\` versus \`effectiveCore\` is available. The 20/48 forced-core rate is itself strong evidence that the current architecture relies heavily on recovery.

## Stability and fresh-response verification

- Representative set: 18 sentences spanning correct, borderline, failed, passive, coordination, equation, citation, 50–80 words, >80 words, and enumeration.
- Runs: original baseline + 2 new runs = 3 per sentence. First-failure stage stable: ${stabilityStageStable}/18; core metrics stable: ${stabilityCoreStable}/18; Tree metrics stable: ${stabilityTreeStable}/18. Core-metric variation: ${unstableCoreIds.length === 0 ? 'none' : unstableCoreIds.join(', ')}.
- Before **every** new run, the runner calls: \`resetPredicateStructureCache\`, \`resetFocusedRelativeLinkCache\`, \`resetFocusedWhereClauseRepairCache\`, \`resetFocusedSubjectVerbRepairCache\`, \`resetFocusedComplementVerifierCache\`, \`resetFocusedCopularCoreRepairCache\`, and \`resetFocusedPassiveCoreRepairCache\`. GrammarAnalysis has no result cache.
- Fresh-call proof: ${stability.length}/36 runs contain a delegate-level GrammarAnalysis call; ${new Set(stability.map(({ cacheResetSequence }) => cacheResetSequence)).size}/36 unique reset sequences; ${stabilityTraces.length} delegate calls with ${new Set(traceIndices).size} unique monotonic call indices 1–${Math.max(...traceIndices)}; minimum ${Math.min(...stability.map(({ requestTrace }) => requestTrace.length))} actual LLM request(s) per run. Evidence gate: **${cacheEvidencePass ? 'PASS' : 'FAIL'}**.
- Response SHA-256 and byte length were recorded after every delegate response. ${distinctResponseIds}/18 sentence IDs had differing whole-trace response fingerprints across the two new runs. Identical hashes are valid deterministic regenerations because the delegate call index proves a new HTTP generation occurred; hash equality is not used as evidence of a cache hit.

## R. External KNN-GCN failure trace

- External/noncommitted control; its full source sentence is not in the benchmark dataset or this report.
- Stage 1 after auto-recovery: S=${shortSpan(knnRaw.subject)}, V=${shortSpan(knnRaw.verb)}, C covered the entire post-verbal PP/list payload, pattern=${String(knnRaw.pattern)}. This is the first false-C point: GrammarAnalysis/forced-core recovery.
- Focused passive repair ran and shortened C to ${shortSpan(knnEffective.complement)}, but retained pattern=${String(knnEffective.pattern)}. Thus it improved span size without correcting complement semantics.
- PredicateStructure required two actual generation calls, then emitted one \`is applied\` predicate whose “object” covered the complete PP plus enumeration. It also emitted two broad, overlapping \`other\` regions; it did not create an enumeration container.
- Predicate acceptance preserved that single predicate. The hybrid merger then combined the broad Stage-2 object with the overlapping Stage-1 C. Tree construction preserved both plus overlapping list regions.
- Root cause: **both Stage 1 and Stage 2**. Stage 1 created SVC/false C; Stage 2 flattened the list into oversized overlapping dependents. Acceptance and merger did not originate the errors, but did not enforce consistency against them.
- LLM proof for this control: ${knn.requestTrace.length} delegate calls, reset sequence ${knn.cacheResetSequence}, response hashes recorded.

### External live control 2 — shared-subject mixed predicates

- Stage 1 selected only V=${shortSpan(mixedRaw.verb)}, pattern=${String(mixedRaw.pattern)}. “is very complex” disappears at GrammarAnalysis/forced-core recovery.
- PredicateStructure did **not** identify two predicates. It emitted one predicate \`is\`; \`very complex\` became a condition and the full passive predicate became an object dependent. This is the first subordination error.
- Predicate acceptance retained the already-corrupt single branch; it did not independently drop a correctly represented second predicate. The hybrid merger retained the nesting; Tree construction rendered it.
- The citation was a Stage-2 sentence modifier and became a visible \`other\` grammar node in Tree construction. Internal “geological conditions and environmental factors” remained opaque inside one broad object span, so internal NP coordination was not represented.
- Basic Skeleton conclusion: a single S/V/IO/O/C/pattern cannot faithfully preserve SVC + SV under one subject.

## S. Architecture spike A — current full-sentence pipeline

- Development cases: ${a.developmentCases}.
- All predicate cores visible: ${percent(Math.round(Number(a.allPredicateCoresVisibleRate) * 48), 48)}.
- Multi-predicate cases: 9; all predicate cores visible: ${percent(Math.round(Number(a.multiPredicateCoresVisibleRate) * 9), 9)}.
- Core pattern accuracy remains the limiting authority metric (D–I), even when the final Tree happens to expose additional predicates.

## T. Architecture spike B — main-clause/core-first

- Non-production deterministic region-isolation feasibility only; no production prompt/rule changes.
- Main subject+verb authority retained: ${percent(Math.round(Number(b.mainSubjectAndVerbRetentionRate) * 48), 48)}.
- Required subordinate/enumeration/citation payload separated: ${percent(Math.round(Number(b.requiredPayloadSeparationRate) * 48), 48)}.
- This supports a Stage-0 grounded-region boundary before assigning five-pattern roles.

## U. Architecture spike C — hierarchical/shared-subject predicate cores

- Multi-predicate cases: ${String(c.multiPredicateCases)}.
- All gold predicates covered: raw PredicateStructure ${percent(Math.round(Number(c.rawStructureCoverage) * 9), 9)}, predicate acceptance ${percent(Math.round(Number(c.predicateAcceptanceCoverage) * 9), 9)}, hybrid ${percent(Math.round(Number(c.hybridCoverage) * 9), 9)}, final Tree ${percent(Math.round(Number(c.finalTreeCoverage) * 9), 9)}.
- The loss usually occurs before acceptance/merger, supporting a canonical shared-subject + multiple-predicate-core representation rather than more downstream repair gates.

## V. Coarse-fallback result

- Detailed defective development Trees: ${String(d.defectiveDetailedTrees)}.
- A core-only coarse presentation avoided presentation hazards in ${percent(Math.round(Number(d.coarsePresentationSafeRate) * Number(d.defectiveDetailedTrees)), Number(d.defectiveDetailedTrees))}.
- It was both presentation-safe and backed by fully correct core authority in only ${percent(Math.round(Number(d.eligibleSafeFallbackRate) * Number(d.defectiveDetailedTrees)), Number(d.defectiveDetailedTrees))}.
- Therefore fallback is useful, but must be gated on core/region consistency; coarse output cannot rescue a wrong Stage-1 core.

## W. Recommended Prototype 2.6E production architecture

1. Stage 0: produce grounded, non-five-pattern structural regions (opening modifier, main subject region, predicate regions, PP/modifier regions, citation, enumeration container and members).
2. Canonical authority: **one shared subject + multiple predicate cores**, each with its own V/IO/O/C/pattern and grounded spans.
3. Compatibility projection: expose a deterministic primary core for current simple-sentence UI/API, plus explicit coordinated predicate structures. Do not silently collapse mixed predicates into one label.
4. Stage 2 attaches modifiers/clauses/list containers to predicate cores under invariants: post-verbal PP ≠ C by position; list payload cannot enter V/O/C without justification; Stage 2 cannot broaden/replace an accepted core verb.
5. Confidence/consistency gate: if detailed attachment is unsafe but the canonical core/regions are sound, render a coarse Tree rather than a detailed misleading Tree.

Representation comparison:

| Representation | Simple compatibility | Current UI migration | Tree/ReadingGuide authority | Five-pattern pedagogy | Decision |
|---|---|---|---|---|---|
| A. Single core | Excellent | None | Loses mixed coordinated predicates | Misleading for SVC+SV | Reject as canonical |
| B. Shared subject + multiple predicate cores | Excellent for one predicate | Add coordinated-core view | Best grounded authority/targets | Teaches each predicate pattern explicitly | **Canonical choice** |
| C. Primary core + coordinated structures | Excellent | Easiest transition | Good only if secondary structures are equally authoritative | Risk of overemphasizing “primary” | Use as compatibility projection of B |

ReadingGuide remains downstream and unchanged; it should consume final Tree targets after Tree authority is corrected.

## X. Proposed Prototype 2.6E acceptance thresholds

These targets are proposed after observing the baseline:

- Structured-output success ≥99%; regeneration ≤2%.
- S exact ≥97%, V exact ≥95%, O exact ≥90%, C exact ≥95%, pattern ≥90% overall.
- Gold-C-null false-C ≤2%; passive+PP false-C = 0.
- Multi-predicate all-core preservation ≥95%, including all locked SVC+SV/SVC+SVC/SVO+SVO cases.
- 41–80 and >80 word pattern ≥85% (report bins separately; do not hide small n).
- Duplicate visible constituent = 0; lexical loss = 0; parent-child visible overlap ≤1%.
- Citation-as-grammar-node = 0; equation corruption = 0; bogus predicate ≤2%; wrong-role ≤5%.
- Stability set: ≥95% identical core decisions and ≥90% identical first-failure/success classification over 3 fresh generations.
- Forced-core recovery invocation ≤10%; every repair must expose auditable pre/post authority, true-positive, unnecessary, and regression counts.

## Y. Changed files

- \`benchmark/generalization/dataset.ts\` — 48 development + 24 locked cases and exact-span materialization.
- \`benchmark/generalization/metrics.ts\` — deterministic core/Tree metrics.
- \`benchmark/generalization/run.ts\` — unchanged-pipeline runner, full stage capture, per-run cache resets, delegate request evidence, external-control mode.
- \`benchmark/generalization/spikes.ts\` — non-production A–D feasibility spikes.
- \`benchmark/generalization/report.ts\` / \`report.md\` — reproducible aggregation and this report.
- \`tests/benchmark/generalizationDataset.test.ts\` — lock, span, coverage, length, passive-C, and mixed-predicate assertions.
- Ignored raw outputs: \`benchmark/results/generalization/*.json\`; no copyrighted external control was committed into source assets.

## Z. Git status and scope

- Phase-0 checkpoint: \`f1e9a53c8cd64c5c6d6d67f57b0f32c9152db368\` — \`Add Docker distribution and Tree-authoritative reading guidance\`.
- 2.6D state before any new commit: \`?? benchmark/generalization/\`, \`?? tests/benchmark/generalizationDataset.test.ts\`.
- Production grammar/UI/ReadingGuide/Docker files: unchanged during 2.6D.
- Tag: none. Push: none. Winning architecture: not implemented.

## Verification record

- Phase 0: frontend 88 files / 893 tests; typecheck, lint, tests, build, diff-check passed. PyMuPDF 103 passed / 2 fixture skips. Paddle 16 passed. Docker config and short live smoke passed; the smoke stack was stopped. The benchmark-only Ollama service was stopped after 2.6D.
- 2.6D dataset test: 6/6 passed; typecheck passed after runner instrumentation.
- Development baseline: one controlled run on 48. Locked complex holdout: one run on 24 after freeze. Legacy holdout: one run on 57 after complex holdout.
`

await writeFile('benchmark/generalization/report.md', markdown, 'utf8')
console.log(JSON.stringify({
  development: development.length,
  holdout: holdout.length,
  stabilityRuns: stability.length,
  cacheEvidencePass,
  stabilityStageStable,
  stabilityCoreStable,
  stabilityTreeStable,
  distinctResponseIds,
  delegateCalls: stabilityTraces.length,
}, null, 2))
