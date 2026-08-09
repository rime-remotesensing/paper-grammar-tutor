// Model-comparison benchmark runner (Prototype 0.2).
// Usage: node benchmark/run.ts <model1>[,<model2>,...] [--dataset development|holdout] [--base-url http://localhost:11434]
// --dataset defaults to "development" if omitted.
//
// Runs the same GrammarAnalyzer used by the app against every sentence in the chosen
// dataset (benchmark/sentences/development.json or holdout.json), for each requested
// model, and writes per-model raw results plus a human-readable summary table.
//
// Two datasets, two purposes:
// - development.json: the 28 sentences used to drive prompt/schema decisions in
//   Prototype 0 and 0.1. NOT a held-out test — treat its numbers as "does the model
//   still do what we tuned it to do", not "does this generalize".
// - holdout.json: sentences never used in any prompt/schema decision. Its gold was
//   fixed before any model was run against it and must not be edited based on model
//   output (see holdout.json's own "description" field).
//
// Scoring is deliberately conservative: constituent fields (subject/verb/object/
// indirectObject/complement) get a lenient string-containment match, since that's a
// reasonably safe automatic check. Clause detection, clause grammaticalRole, and
// modifier/attachment detection are NOT auto-scored here — matching a set of spans
// against gold spans without producing false confidence is a harder problem than this
// script attempts, so those are left for human review using the full per-sentence JSON
// this script writes out (which includes both the model's analysis and the sentence's
// gold side by side).

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeSentence } from '../src/features/grammar/domain/GrammarAnalyzer.ts'
import { OllamaProvider } from '../src/llm/providers/ollama/OllamaProvider.ts'
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_TEMPERATURE } from '../src/config/settings.ts'
import type { GrammarAnalysis } from '../src/features/grammar/schemas/grammarAnalysis.schema.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type DatasetName = 'development' | 'holdout'

// --- Raw file shapes (each dataset file uses its own field names; see loadDataset) ---

interface DevelopmentGoldRaw {
  subject: string | null
  verb: string | null
  indirectObject?: string | null
  object: string | null
  complement: string | null
  pattern: string
  notes: string
}

interface HoldoutGoldRaw {
  subject: string | null
  subjectHead: string | null
  mainVerb: string | null
  indirectObject: string | null
  object: string | null
  complement: string | null
  expectedPattern: string
  clauses?: Array<{ span: string; kind: string; grammaticalRole: string }>
  modifiers?: Array<{ phrase: string; kind: string; target: string | null }>
  ambiguous?: boolean
  alternativeAcceptableAnswers?: Record<string, string[]>
  notes?: string
}

interface RawSentence<TGold> {
  id: string
  text: string
  tags: string[]
  gold: TGold
}

// --- Normalized shape used for scoring, regardless of which file it came from ---

interface NormalizedGold {
  subject: string | null
  /** undefined = this dataset doesn't annotate subjectHead (development.json); skip the metric, don't score it as "expected null". */
  subjectHead: string | null | undefined
  verb: string | null
  indirectObject: string | null
  object: string | null
  complement: string | null
  pattern: string
  clauses?: Array<{ span: string; kind: string; grammaticalRole: string }>
  modifiers?: Array<{ phrase: string; kind: string; target: string | null }>
  ambiguous: boolean
  alternativeAcceptableAnswers: Record<string, string[]>
  notes: string
}

interface NormalizedSentence {
  id: string
  text: string
  tags: string[]
  gold: NormalizedGold
}

async function loadDataset(name: DatasetName): Promise<NormalizedSentence[]> {
  const fileName = name === 'development' ? 'development.json' : 'holdout.json'
  const filePath = path.join(__dirname, 'sentences', fileName)
  const raw = JSON.parse(await readFile(filePath, 'utf-8')) as { sentences: unknown[] }

  if (name === 'development') {
    const sentences = raw.sentences as Array<RawSentence<DevelopmentGoldRaw>>
    return sentences.map((s) => ({
      id: s.id,
      text: s.text,
      tags: s.tags,
      gold: {
        subject: s.gold.subject,
        subjectHead: undefined,
        verb: s.gold.verb,
        indirectObject: s.gold.indirectObject ?? null,
        object: s.gold.object,
        complement: s.gold.complement,
        pattern: s.gold.pattern,
        ambiguous: false,
        alternativeAcceptableAnswers: {},
        notes: s.gold.notes,
      },
    }))
  }

  const sentences = raw.sentences as Array<RawSentence<HoldoutGoldRaw>>
  return sentences.map((s) => ({
    id: s.id,
    text: s.text,
    tags: s.tags,
    gold: {
      subject: s.gold.subject,
      subjectHead: s.gold.subjectHead,
      verb: s.gold.mainVerb,
      indirectObject: s.gold.indirectObject,
      object: s.gold.object,
      complement: s.gold.complement,
      pattern: s.gold.expectedPattern,
      clauses: s.gold.clauses,
      modifiers: s.gold.modifiers,
      ambiguous: s.gold.ambiguous ?? false,
      alternativeAcceptableAnswers: s.gold.alternativeAcceptableAnswers ?? {},
      notes: s.gold.notes ?? '',
    },
  }))
}

// Constituent fields scored automatically. `subjectHead` is handled separately since
// not every dataset annotates it (see NormalizedGold.subjectHead).
const CONSTITUENT_FIELDS = ['subject', 'verb', 'indirectObject', 'object', 'complement'] as const
type ConstituentField = (typeof CONSTITUENT_FIELDS)[number]
// Fields that can make derivePattern's output differ from gold if wrong. `subject` is
// intentionally excluded: derivePattern never looks at the subject (see derivePattern.ts).
const PATTERN_RELEVANT_FIELDS = ['verb', 'indirectObject', 'object', 'complement'] as const

interface SentenceRunResult {
  id: string
  text: string
  tags: string[]
  schemaValid: boolean
  regenerated: boolean
  elapsedMs: number
  parseError: string | null
  fieldMatches: Record<ConstituentField, boolean> & { subjectHead: boolean | null; derivedPattern: boolean }
  /** Present only when a pattern mismatch occurred; names the constituent field(s) that differ from gold and therefore explain it. Never includes "subject" (see PATTERN_RELEVANT_FIELDS). */
  patternMismatchCauses: string[] | null
  /** Heuristic-only guess at what kind of phrase a wrongly-produced complement actually is. Not authoritative — for the human-reviewed error taxonomy, not for scoring. */
  complementErrorGuess: string | null
  ambiguous: boolean
  /** For ambiguous sentences only: did the model show any sign of recognizing the ambiguity? Informational, not a pass/fail score. */
  ambiguityAwareness: boolean | null
  gold: NormalizedGold
  analysis: GrammarAnalysis
}

interface ModelSummary {
  model: string
  dataset: DatasetName
  sentenceCount: number
  structuredOutputSuccessRate: number
  regenerationRate: number
  avgElapsedMs: number
  /** Average accuracy across CONSTITUENT_FIELDS only (excludes subjectHead and derivedPattern). */
  constituentExtractionAccuracy: number
  fieldAccuracy: Record<ConstituentField, number> & { derivedPattern: number }
  /** null when the dataset doesn't annotate subjectHead at all (development.json). */
  subjectHeadAccuracy: number | null
  /** complement accuracy split by whether gold expects a subject complement (SVC-shaped, object null) or object complement (SVOC-shaped, object non-null). */
  subjectComplementAccuracy: { accuracy: number; n: number }
  objectComplementAccuracy: { accuracy: number; n: number }
  /** How often each constituent field was implicated in a pattern mismatch, across all mismatches for this model. */
  patternMismatchCauseCounts: Record<(typeof PATTERN_RELEVANT_FIELDS)[number], number>
  ambiguousSentenceCount: number
  ambiguityAwarenessCount: number
}

export function parseArgs(argv: string[]): { models: string[]; baseUrl: string; dataset: DatasetName } {
  let baseUrl = DEFAULT_OLLAMA_BASE_URL
  let dataset: DatasetName = 'development'
  let modelsArg: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--base-url') {
      baseUrl = argv[i + 1] ?? baseUrl
      i++
      continue
    }
    if (arg === '--dataset') {
      const value = argv[i + 1]
      if (value !== 'development' && value !== 'holdout') {
        throw new Error(`--dataset must be "development" or "holdout", got "${String(value)}"`)
      }
      dataset = value
      i++
      continue
    }
    if (!arg.startsWith('--') && modelsArg === undefined) {
      modelsArg = arg
    }
  }

  if (!modelsArg) {
    throw new Error(
      'Usage: node benchmark/run.ts <model1>[,<model2>,...] [--dataset development|holdout] [--base-url http://localhost:11434]',
    )
  }
  return { models: modelsArg.split(',').map((m) => m.trim()).filter(Boolean), baseUrl, dataset }
}

export function normalizeForComparison(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ')
}

export function fieldMatches(goldValue: string | null, actual: string | null): boolean {
  if (goldValue === null) return actual === null
  if (actual === null) return false
  const gold = normalizeForComparison(goldValue)
  const got = normalizeForComparison(actual)
  return gold === got || got.includes(gold) || gold.includes(got)
}

const COMMON_PREPOSITIONS = new Set([
  'in', 'on', 'at', 'by', 'with', 'from', 'to', 'of', 'for', 'over', 'under', 'through',
  'during', 'without', 'within', 'across', 'about', 'against', 'between', 'among',
])

/**
 * Best-effort, heuristic-only guess at what a wrongly-produced complement actually is,
 * used only to populate the human-reviewed error taxonomy (section E of the report),
 * never used as a scoring signal. Deliberately simple: a handful of surface patterns,
 * not a parser.
 */
export function guessComplementErrorKind(wrongText: string): string {
  const trimmed = wrongText.trim()
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() ?? ''
  if (firstWord === 'to' && trimmed.split(/\s+/).length > 1) return 'possibly-infinitive-phrase'
  if (COMMON_PREPOSITIONS.has(firstWord)) return 'possibly-prepositional-phrase'
  if (/^[a-zA-Z]+ly$/.test(trimmed) || /^[a-zA-Z]+ly\s/.test(trimmed)) return 'possibly-adverb'
  return 'other-unclassified'
}

async function runModel(
  provider: OllamaProvider,
  model: string,
  dataset: DatasetName,
  sentences: NormalizedSentence[],
): Promise<{ results: SentenceRunResult[]; summary: ModelSummary }> {
  const results: SentenceRunResult[] = []

  for (const sentence of sentences) {
    process.stdout.write(`  [${model}] ${sentence.id}... `)
    const { analysis, meta } = await analyzeSentence({
      provider,
      model,
      sentence: sentence.text,
      temperature: DEFAULT_TEMPERATURE,
    })
    console.log(meta.schemaValid ? 'ok' : 'INVALID')

    const core = analysis.sentenceCore
    const gold = sentence.gold

    const constituentMatches: Record<ConstituentField, boolean> = {
      subject: fieldMatches(gold.subject, core.subject?.text ?? null),
      verb: fieldMatches(gold.verb, core.verb?.text ?? null),
      indirectObject: fieldMatches(gold.indirectObject, core.indirectObject?.text ?? null),
      object: fieldMatches(gold.object, core.object?.text ?? null),
      complement: fieldMatches(gold.complement, core.complement?.text ?? null),
    }
    const subjectHeadMatch =
      gold.subjectHead === undefined ? null : fieldMatches(gold.subjectHead, core.subjectHead?.text ?? null)
    const derivedPatternMatches = gold.pattern === core.pattern

    const patternMismatchCauses = derivedPatternMatches
      ? null
      : PATTERN_RELEVANT_FIELDS.filter((f) => !constituentMatches[f])

    const complementErrorGuess =
      !constituentMatches.complement && core.complement !== null && gold.complement === null
        ? guessComplementErrorKind(core.complement.text)
        : !constituentMatches.complement && core.complement === null && gold.complement !== null
          ? 'missed-true-complement'
          : null

    const ambiguityAwareness = gold.ambiguous
      ? analysis.needsMoreContext || analysis.confidence < 0.7 || analysis.uncertainties.length > 0
      : null

    results.push({
      id: sentence.id,
      text: sentence.text,
      tags: sentence.tags,
      schemaValid: meta.schemaValid,
      regenerated: meta.regenerated,
      elapsedMs: meta.elapsedMs,
      parseError: meta.parseError,
      fieldMatches: { ...constituentMatches, subjectHead: subjectHeadMatch, derivedPattern: derivedPatternMatches },
      patternMismatchCauses,
      complementErrorGuess,
      ambiguous: gold.ambiguous,
      ambiguityAwareness,
      gold,
      analysis,
    })
  }

  const n = results.length
  const fieldAccuracy = Object.fromEntries(
    [...CONSTITUENT_FIELDS, 'derivedPattern' as const].map((f) => [
      f,
      results.filter((r) => r.fieldMatches[f]).length / n,
    ]),
  ) as ModelSummary['fieldAccuracy']

  const constituentExtractionAccuracy =
    CONSTITUENT_FIELDS.reduce((sum, f) => sum + fieldAccuracy[f], 0) / CONSTITUENT_FIELDS.length

  const subjectHeadResults = results.filter((r) => r.fieldMatches.subjectHead !== null)
  const subjectHeadAccuracy =
    subjectHeadResults.length === 0
      ? null
      : subjectHeadResults.filter((r) => r.fieldMatches.subjectHead === true).length / subjectHeadResults.length

  const subjectComplementResults = results.filter((r) => r.gold.object === null)
  const objectComplementResults = results.filter((r) => r.gold.object !== null)
  const complementBucketAccuracy = (bucket: SentenceRunResult[]) => ({
    n: bucket.length,
    accuracy: bucket.length === 0 ? 0 : bucket.filter((r) => r.fieldMatches.complement).length / bucket.length,
  })

  const patternMismatchCauseCounts = Object.fromEntries(
    PATTERN_RELEVANT_FIELDS.map((f) => [
      f,
      results.filter((r) => r.patternMismatchCauses?.includes(f)).length,
    ]),
  ) as ModelSummary['patternMismatchCauseCounts']

  const ambiguousResults = results.filter((r) => r.ambiguous)

  const summary: ModelSummary = {
    model,
    dataset,
    sentenceCount: n,
    structuredOutputSuccessRate: results.filter((r) => r.schemaValid).length / n,
    regenerationRate: results.filter((r) => r.regenerated).length / n,
    avgElapsedMs: results.reduce((sum, r) => sum + r.elapsedMs, 0) / n,
    constituentExtractionAccuracy,
    fieldAccuracy,
    subjectHeadAccuracy,
    subjectComplementAccuracy: complementBucketAccuracy(subjectComplementResults),
    objectComplementAccuracy: complementBucketAccuracy(objectComplementResults),
    patternMismatchCauseCounts,
    ambiguousSentenceCount: ambiguousResults.length,
    ambiguityAwarenessCount: ambiguousResults.filter((r) => r.ambiguityAwareness).length,
  }

  return { results, summary }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`
}

function renderSummaryMarkdown(summaries: ModelSummary[]): string {
  const header =
    '| model | dataset | n | structured-output success | regeneration rate | avg ms | subject | subjectHead | verb | indirectObject | object | subjectComplement | objectComplement | constituent avg | pattern (derived) |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'
  const rows = summaries.map((s) =>
    [
      s.model,
      s.dataset,
      s.sentenceCount,
      pct(s.structuredOutputSuccessRate),
      pct(s.regenerationRate),
      Math.round(s.avgElapsedMs),
      pct(s.fieldAccuracy.subject),
      s.subjectHeadAccuracy === null ? 'n/a' : pct(s.subjectHeadAccuracy),
      pct(s.fieldAccuracy.verb),
      pct(s.fieldAccuracy.indirectObject),
      pct(s.fieldAccuracy.object),
      `${pct(s.subjectComplementAccuracy.accuracy)} (n=${s.subjectComplementAccuracy.n})`,
      `${pct(s.objectComplementAccuracy.accuracy)} (n=${s.objectComplementAccuracy.n})`,
      pct(s.constituentExtractionAccuracy),
      pct(s.fieldAccuracy.derivedPattern),
    ].join(' | '),
  )

  const causesSection = summaries
    .map((s) => {
      const total = Object.values(s.patternMismatchCauseCounts).reduce((a, b) => a + b, 0)
      const mismatches = s.sentenceCount - s.fieldAccuracy.derivedPattern * s.sentenceCount
      const parts = Object.entries(s.patternMismatchCauseCounts)
        .map(([field, count]) => `${field}=${count}`)
        .join(', ')
      const ambiguity =
        s.ambiguousSentenceCount === 0
          ? ''
          : ` | ambiguity awareness: ${s.ambiguityAwarenessCount}/${s.ambiguousSentenceCount} flagged uncertainty on the ${s.ambiguousSentenceCount} intentionally-ambiguous sentences (informational, not a pass/fail score)`
      return `- ${s.model} (${s.dataset}): ~${Math.round(mismatches)} pattern mismatches; contributing-field tally (a mismatch can have >1 cause): ${parts} [causes counted: ${total}]${ambiguity}`
    })
    .join('\n')

  const note =
    '\n\n_"structured-output success" is JSON-schema validity, not grammar correctness. ' +
    '"pattern (derived)" is computed by the app from verb/indirectObject/object/complement ' +
    '(see derivePattern.ts) — it is deterministic given those fields, so we do not call this ' +
    '"pattern engine accuracy"; a pattern mismatch is a symptom of a constituent-extraction ' +
    'error, not a separate failure mode, and the per-model breakdown below attributes each ' +
    'mismatch to the constituent field(s) that actually differed from gold. Clause detection, ' +
    'clause grammaticalRole, and modifier/attachment accuracy are NOT auto-scored in this table ' +
    '— see the per-sentence JSON files (gold vs analysis) for manual review of those and of the ' +
    'complementErrorGuess/ambiguityAwareness annotations._\n\n' +
    'Pattern-mismatch root cause (which constituent field(s) explain each mismatch):\n' +
    causesSection

  return [header, ...rows.map((r) => `| ${r} |`)].join('\n') + note
}

async function main() {
  const { models, baseUrl, dataset } = parseArgs(process.argv.slice(2))
  const sentences = await loadDataset(dataset)

  const provider = new OllamaProvider(baseUrl)
  const health = await provider.healthCheck()
  if (!health.ok) {
    console.error(`Ollama is not reachable at ${baseUrl}: ${health.message}`)
    process.exitCode = 1
    return
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = path.join(__dirname, 'results', `${runId}-${dataset}`)
  await mkdir(outDir, { recursive: true })

  const summaries: ModelSummary[] = []
  for (const model of models) {
    console.log(`Running ${sentences.length} sentences (${dataset}) against ${model}...`)
    try {
      const { results, summary } = await runModel(provider, model, dataset, sentences)
      summaries.push(summary)
      const safeName = model.replace(/[^a-zA-Z0-9._-]/g, '_')
      await writeFile(path.join(outDir, `${safeName}.json`), JSON.stringify(results, null, 2))
    } catch (err) {
      // A single model erroring out (e.g. an Ollama request timeout) should not lose the
      // per-sentence JSON already written for other models, or skip the summary entirely.
      console.error(`  ${model} failed and was skipped: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const summaryMarkdown = renderSummaryMarkdown(summaries)
  await writeFile(path.join(outDir, 'summary.md'), summaryMarkdown)
  console.log(`\nResults written to ${outDir}\n`)
  console.log(summaryMarkdown)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
