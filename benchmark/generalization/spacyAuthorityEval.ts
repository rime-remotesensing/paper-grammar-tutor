import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { derivePattern } from '../../src/features/grammar/domain/derivePattern.ts'
import type { SentencePattern, Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema.ts'
import {
  DEVELOPMENT_CASES,
  LOCKED_HOLDOUT_CASES,
  type GeneralizationCase,
  type GeneralizationSplit,
  type GoldSpan,
} from './dataset.ts'

type Split = GeneralizationSplit

interface Token {
  i: number
  text: string
  lemma: string
  pos: string
  tag: string
  dep: string
  head: number
  start: number
  end: number
}

interface SpacyDoc {
  tokens: Token[]
}

interface PredicateRaw {
  verb: Span | null
  object: Span | null
  complementCandidate: Span | null
  ppModifiers: Span[]
  subjectForPredicate: Span | null
}

interface ParserExtraction {
  mainSubject: Span | null
  predicates: PredicateRaw[]
}

interface ConvertedCore {
  verb: Span | null
  object: Span | null
  complement: Span | null
  pattern: SentencePattern
}

interface PerSentenceResult {
  id: string
  split: Split
  text: string
  parser: {
    mainSubject: Span | null
    predicateCount: number
    predicates: Array<{
      verb: Span | null
      object: Span | null
      complementCandidate: Span | null
      ppModifiers: Span[]
    }>
    metrics: {
      sharedMainSubjectExact: boolean
      predicateCountExact: boolean
      coordinatedPredicatesExact: boolean
      predicateVerbExact: boolean[]
      objectRelationExact: boolean[]
      complementCandidateExact: boolean[]
      ppModifierRelationExact: boolean[]
    }
  }
  conversion: {
    cores: ConvertedCore[]
    metrics: {
      verbExact: boolean[]
      objectExact: boolean[]
      complementExact: boolean[]
      patternExact: boolean[]
      falseC: boolean[]
    }
    attribution: {
      verb: { parser: number; conversion: number }
      object: { parser: number; conversion: number }
      complement: { parser: number; conversion: number }
      pattern: { parser: number; conversion: number }
      falseC: { parser: number; conversion: number }
    }
  }
}

interface Aggregate {
  split: Split
  n: number
  parserMetrics: {
    sharedMainSubjectExact: string
    predicateCountExact: string
    predicateVerbExact: string
    coordinatedPredicatesExact: string
    objectRelationExact: string
    complementCandidateExact: string
    ppModifierRelationExact: string
  }
  conversionMetrics: {
    perCoreV: string
    perCoreO: string
    perCoreC: string
    pattern: string
    falseC: string
  }
  attribution: {
    verb: { parser: number; conversion: number }
    object: { parser: number; conversion: number }
    complement: { parser: number; conversion: number }
    pattern: { parser: number; conversion: number }
    falseC: { parser: number; conversion: number }
  }
}

interface Args {
  split: Split
  pythonExe: string
  spacyModel: string
  outName: string
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PREP_WORDS = new Set([
  'in', 'on', 'at', 'by', 'with', 'from', 'to', 'for', 'of', 'under', 'over', 'across', 'after', 'before', 'between', 'among', 'through', 'during', 'within', 'without', 'into', 'onto',
])
const COPULAR_LEMMAS = new Set(['be', 'seem', 'become', 'remain', 'appear', 'feel', 'look', 'sound', 'stay'])

function parseArgs(argv: string[]): Args {
  const valueAfter = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const split = (valueAfter('--split') ?? 'development') as Split
  if (split !== 'development' && split !== 'holdout') {
    throw new Error('--split must be development or holdout')
  }
  return {
    split,
    pythonExe: valueAfter('--python') ?? 'C:/anaconda3/python.exe',
    spacyModel: valueAfter('--spacy-model') ?? 'en_core_web_sm',
    outName: valueAfter('--out') ?? `spacy-${split}`,
  }
}

function exact(gold: GoldSpan | null, got: Span | null): boolean {
  if (gold === null) return got === null
  return got !== null && gold.start === got.start && gold.end === got.end && gold.text === got.text
}

function trimSpanEdges(tokens: Token[], startIndex: number, endIndex: number): { start: number; end: number } {
  let s = startIndex
  let e = endIndex
  while (s <= e && (tokens[s]?.pos === 'PUNCT' || tokens[s]?.dep === 'punct')) s++
  while (e >= s && (tokens[e]?.pos === 'PUNCT' || tokens[e]?.dep === 'punct')) e--
  if (s > e) return { start: startIndex, end: endIndex }
  return { start: s, end: e }
}

function spanFromTokenRange(text: string, tokens: Token[], startIndex: number, endIndex: number): Span | null {
  if (startIndex < 0 || endIndex < 0 || startIndex >= tokens.length || endIndex >= tokens.length) return null
  const trimmed = trimSpanEdges(tokens, startIndex, endIndex)
  const start = tokens[trimmed.start]!.start
  const end = tokens[trimmed.end]!.end
  return { text: text.slice(start, end), start, end }
}

function subtreeSpan(text: string, tokens: Token[], headIndex: number): Span | null {
  const indices = tokens.filter((t) => t.i === headIndex || t.head === headIndex || isDescendant(tokens, t.i, headIndex)).map((t) => t.i)
  if (indices.length === 0) return null
  const min = Math.min(...indices)
  const max = Math.max(...indices)
  return spanFromTokenRange(text, tokens, min, max)
}

function isDescendant(tokens: Token[], nodeIndex: number, ancestorIndex: number): boolean {
  let current = nodeIndex
  const seen = new Set<number>()
  while (!seen.has(current)) {
    seen.add(current)
    const token = tokens[current]
    if (!token) return false
    if (token.head === ancestorIndex) return true
    if (token.head === current) return false
    current = token.head
  }
  return false
}

function childIndices(tokens: Token[], head: number, deps?: Set<string>): number[] {
  return tokens
    .filter((t) => t.head === head && (!deps || deps.has(t.dep)))
    .map((t) => t.i)
    .sort((a, b) => a - b)
}

function pickSubjectForPredicate(text: string, tokens: Token[], predicateToken: number): Span | null {
  const subjDeps = new Set(['nsubj', 'nsubjpass', 'csubj', 'csubjpass'])
  const ownSubject = childIndices(tokens, predicateToken, subjDeps)[0]
  if (ownSubject !== undefined) return subtreeSpan(text, tokens, ownSubject)

  let cursor = tokens[predicateToken]
  const seen = new Set<number>()
  while (cursor && !seen.has(cursor.i)) {
    seen.add(cursor.i)
    if (cursor.dep !== 'conj') break
    const parent = tokens[cursor.head]
    if (!parent) break
    const parentSubject = childIndices(tokens, parent.i, subjDeps)[0]
    if (parentSubject !== undefined) return subtreeSpan(text, tokens, parentSubject)
    cursor = parent
  }
  return null
}

function pickVerbSpan(text: string, tokens: Token[], predicateToken: number): Span | null {
  const depSet = new Set(['aux', 'auxpass', 'neg', 'prt'])
  const indices = [predicateToken, ...childIndices(tokens, predicateToken, depSet)]
  const min = Math.min(...indices)
  const max = Math.max(...indices)
  return spanFromTokenRange(text, tokens, min, max)
}

function pickObjectSpan(text: string, tokens: Token[], predicateToken: number): Span | null {
  const objIdx = childIndices(tokens, predicateToken, new Set(['obj', 'dobj']))[0]
  if (objIdx === undefined) return null
  return subtreeSpan(text, tokens, objIdx)
}

function pickComplementCandidate(text: string, tokens: Token[], predicateToken: number): Span | null {
  const compDeps = ['attr', 'acomp', 'oprd', 'xcomp', 'ccomp']
  const idx = childIndices(tokens, predicateToken).find((i) => compDeps.includes(tokens[i]!.dep))
  if (idx !== undefined) return subtreeSpan(text, tokens, idx)

  const predicate = tokens[predicateToken]
  if (!predicate) return null
  if (predicate.dep === 'cop') {
    return subtreeSpan(text, tokens, predicate.head)
  }
  return null
}

function pickPPModifiers(text: string, tokens: Token[], predicateToken: number): Span[] {
  const ppDeps = new Set(['prep', 'agent', 'obl'])
  return childIndices(tokens, predicateToken, ppDeps)
    .map((idx) => subtreeSpan(text, tokens, idx))
    .filter((v): v is Span => v !== null)
}

function collectPredicates(text: string, tokens: Token[]): ParserExtraction {
  const roots = tokens.filter((t) => t.dep === 'ROOT')
  const root = roots[0]
  if (!root) {
    return { mainSubject: null, predicates: [] }
  }

  const predicateTokenIndices: number[] = []

  const rootCop = childIndices(tokens, root.i, new Set(['cop'])).find((i) => {
    const child = tokens[i]
    return child?.pos === 'AUX' || child?.pos === 'VERB'
  })

  if (root.pos === 'VERB' || root.pos === 'AUX') {
    predicateTokenIndices.push(root.i)
  } else if (rootCop !== undefined) {
    predicateTokenIndices.push(rootCop)
  }

  for (const token of tokens) {
    if (token.dep !== 'conj') continue
    const hasCop = childIndices(tokens, token.i, new Set(['cop'])).length > 0
    if (token.pos === 'VERB' || token.pos === 'AUX' || hasCop) {
      predicateTokenIndices.push(hasCop && !(token.pos === 'VERB' || token.pos === 'AUX')
        ? childIndices(tokens, token.i, new Set(['cop']))[0]!
        : token.i)
    }
  }

  const unique = [...new Set(predicateTokenIndices)].sort((a, b) => a - b)
  const predicates = unique.map((tokenIndex) => ({
    verb: pickVerbSpan(text, tokens, tokenIndex),
    object: pickObjectSpan(text, tokens, tokenIndex),
    complementCandidate: pickComplementCandidate(text, tokens, tokenIndex),
    ppModifiers: pickPPModifiers(text, tokens, tokenIndex),
    subjectForPredicate: pickSubjectForPredicate(text, tokens, tokenIndex),
  }))

  const mainSubject = predicates[0]?.subjectForPredicate ?? null
  return { mainSubject, predicates }
}

function toConvertedCore(raw: PredicateRaw): ConvertedCore {
  const lemma = raw.verb?.text.toLowerCase() ?? ''
  const copular = [...COPULAR_LEMMAS].some((l) => lemma.startsWith(l + ' ') || lemma === l)

  let complement: Span | null = null
  if (copular && raw.object === null) {
    complement = raw.complementCandidate
  } else if (raw.object !== null && raw.complementCandidate !== null) {
    complement = raw.complementCandidate
  }

  return {
    verb: raw.verb,
    object: raw.object,
    complement,
    pattern: derivePattern({ verb: raw.verb, indirectObject: null, object: raw.object, complement }),
  }
}

function isPPLike(text: string): boolean {
  const first = text.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return PREP_WORDS.has(first)
}

function compareSentence(item: GeneralizationCase, extraction: ParserExtraction): PerSentenceResult {
  const goldCores = item.gold.predicateCores
  const parserPredicates = extraction.predicates
  const converted = parserPredicates.map(toConvertedCore)

  const predicateVerbExact = goldCores.map((g, i) => exact(g.verb, parserPredicates[i]?.verb ?? null))
  const objectRelationExact = goldCores.map((g, i) => exact(g.object, parserPredicates[i]?.object ?? null))
  const complementCandidateExact = goldCores.map((g, i) => exact(g.complement, parserPredicates[i]?.complementCandidate ?? null))

  const goldPPs = item.gold.attachments.filter((a) => a.role === 'predicateModifier' && isPPLike(a.span.text))
  const gotPPs = parserPredicates.flatMap((p) => p.ppModifiers)
  const ppModifierRelationExact = goldPPs.map((g) => gotPPs.some((p) => exact(g.span, p)))

  const coordinatedPredicatesExact =
    goldCores.length <= 1
      ? parserPredicates.length <= 1
      : goldCores.slice(1).every((g, i) => exact(g.verb, parserPredicates[i + 1]?.verb ?? null)) && parserPredicates.length === goldCores.length

  const conversionVerbExact = goldCores.map((g, i) => exact(g.verb, converted[i]?.verb ?? null))
  const conversionObjectExact = goldCores.map((g, i) => exact(g.object, converted[i]?.object ?? null))
  const conversionComplementExact = goldCores.map((g, i) => exact(g.complement, converted[i]?.complement ?? null))
  const conversionPatternExact = goldCores.map((g, i) => g.pattern === (converted[i]?.pattern ?? 'other'))
  const conversionFalseC = goldCores.map((g, i) => g.complement === null && converted[i]?.complement !== null)

  const attribution = {
    verb: { parser: 0, conversion: 0 },
    object: { parser: 0, conversion: 0 },
    complement: { parser: 0, conversion: 0 },
    pattern: { parser: 0, conversion: 0 },
    falseC: { parser: 0, conversion: 0 },
  }

  for (let i = 0; i < goldCores.length; i++) {
    if (!conversionVerbExact[i]) {
      if (!predicateVerbExact[i]) attribution.verb.parser++
      else attribution.verb.conversion++
    }
    if (!conversionObjectExact[i]) {
      if (!objectRelationExact[i]) attribution.object.parser++
      else attribution.object.conversion++
    }
    if (!conversionComplementExact[i]) {
      if (!complementCandidateExact[i]) attribution.complement.parser++
      else attribution.complement.conversion++
    }
    if (!conversionPatternExact[i]) {
      if (!predicateVerbExact[i] || !objectRelationExact[i] || !complementCandidateExact[i]) attribution.pattern.parser++
      else attribution.pattern.conversion++
    }
    if (conversionFalseC[i]) {
      if ((parserPredicates[i]?.complementCandidate ?? null) !== null) attribution.falseC.parser++
      else attribution.falseC.conversion++
    }
  }

  return {
    id: item.id,
    split: item.split,
    text: item.text,
    parser: {
      mainSubject: extraction.mainSubject,
      predicateCount: parserPredicates.length,
      predicates: parserPredicates.map((p) => ({
        verb: p.verb,
        object: p.object,
        complementCandidate: p.complementCandidate,
        ppModifiers: p.ppModifiers,
      })),
      metrics: {
        sharedMainSubjectExact: exact(item.gold.subject, extraction.mainSubject),
        predicateCountExact: item.gold.predicateCores.length === parserPredicates.length,
        coordinatedPredicatesExact,
        predicateVerbExact,
        objectRelationExact,
        complementCandidateExact,
        ppModifierRelationExact,
      },
    },
    conversion: {
      cores: converted,
      metrics: {
        verbExact: conversionVerbExact,
        objectExact: conversionObjectExact,
        complementExact: conversionComplementExact,
        patternExact: conversionPatternExact,
        falseC: conversionFalseC,
      },
      attribution,
    },
  }
}

function fmtRate(hit: number, total: number): string {
  const pct = total === 0 ? 0 : (100 * hit) / total
  return `${pct.toFixed(1)}% (${hit}/${total})`
}

function sumBool(list: boolean[]): number {
  return list.filter(Boolean).length
}

function buildAggregate(split: Split, rows: PerSentenceResult[]): Aggregate {
  const n = rows.length

  const parserSubjectHit = rows.filter((r) => r.parser.metrics.sharedMainSubjectExact).length
  const parserCountHit = rows.filter((r) => r.parser.metrics.predicateCountExact).length
  const coordHit = rows.filter((r) => r.parser.metrics.coordinatedPredicatesExact).length

  const parserVerbAll = rows.flatMap((r) => r.parser.metrics.predicateVerbExact)
  const parserObjectAll = rows.flatMap((r) => r.parser.metrics.objectRelationExact)
  const parserCompAll = rows.flatMap((r) => r.parser.metrics.complementCandidateExact)
  const parserPPAll = rows.flatMap((r) => r.parser.metrics.ppModifierRelationExact)

  const convV = rows.flatMap((r) => r.conversion.metrics.verbExact)
  const convO = rows.flatMap((r) => r.conversion.metrics.objectExact)
  const convC = rows.flatMap((r) => r.conversion.metrics.complementExact)
  const convP = rows.flatMap((r) => r.conversion.metrics.patternExact)
  const convFalseC = rows.flatMap((r) => r.conversion.metrics.falseC)
  const falseCTotal = rows.flatMap((r, rowIndex) =>
    r.conversion.metrics.falseC.map((_, i) => ({ rowIndex, i }))).filter(({ rowIndex, i }) => {
      const gold = (split === 'development' ? DEVELOPMENT_CASES : LOCKED_HOLDOUT_CASES)
        .find((v) => v.id === rows[rowIndex]!.id)!.gold.predicateCores[i]!
      return gold.complement === null
    }).length

  const attribution = rows.reduce(
    (acc, row) => {
      acc.verb.parser += row.conversion.attribution.verb.parser
      acc.verb.conversion += row.conversion.attribution.verb.conversion
      acc.object.parser += row.conversion.attribution.object.parser
      acc.object.conversion += row.conversion.attribution.object.conversion
      acc.complement.parser += row.conversion.attribution.complement.parser
      acc.complement.conversion += row.conversion.attribution.complement.conversion
      acc.pattern.parser += row.conversion.attribution.pattern.parser
      acc.pattern.conversion += row.conversion.attribution.pattern.conversion
      acc.falseC.parser += row.conversion.attribution.falseC.parser
      acc.falseC.conversion += row.conversion.attribution.falseC.conversion
      return acc
    },
    {
      verb: { parser: 0, conversion: 0 },
      object: { parser: 0, conversion: 0 },
      complement: { parser: 0, conversion: 0 },
      pattern: { parser: 0, conversion: 0 },
      falseC: { parser: 0, conversion: 0 },
    },
  )

  return {
    split,
    n,
    parserMetrics: {
      sharedMainSubjectExact: fmtRate(parserSubjectHit, n),
      predicateCountExact: fmtRate(parserCountHit, n),
      predicateVerbExact: fmtRate(sumBool(parserVerbAll), parserVerbAll.length),
      coordinatedPredicatesExact: fmtRate(coordHit, n),
      objectRelationExact: fmtRate(sumBool(parserObjectAll), parserObjectAll.length),
      complementCandidateExact: fmtRate(sumBool(parserCompAll), parserCompAll.length),
      ppModifierRelationExact: fmtRate(sumBool(parserPPAll), parserPPAll.length),
    },
    conversionMetrics: {
      perCoreV: fmtRate(sumBool(convV), convV.length),
      perCoreO: fmtRate(sumBool(convO), convO.length),
      perCoreC: fmtRate(sumBool(convC), convC.length),
      pattern: fmtRate(sumBool(convP), convP.length),
      falseC: fmtRate(sumBool(convFalseC), falseCTotal),
    },
    attribution,
  }
}

function buildMarkdownReport(args: Args, agg: Aggregate): string {
  const subjectPct = Number(agg.parserMetrics.sharedMainSubjectExact.split('%')[0])
  const countPct = Number(agg.parserMetrics.predicateCountExact.split('%')[0])
  const verbPct = Number(agg.parserMetrics.predicateVerbExact.split('%')[0])
  const authorityReady = subjectPct >= 95 && countPct >= 95 && verbPct >= 95

  return [
    `# spaCy authority evaluation (${args.split})`,
    '',
    `- split: ${args.split}`,
    `- model: ${args.spacyModel}`,
    `- n: ${agg.n}`,
    `- authority readiness gate (subject/count/verb >= 95%): ${authorityReady ? 'PASS' : 'FAIL'}`,
    '',
    '## spaCy parser-only metrics',
    '',
    '| metric | result |',
    '|---|---|',
    `| shared/main subject | ${agg.parserMetrics.sharedMainSubjectExact} |`,
    `| predicate count | ${agg.parserMetrics.predicateCountExact} |`,
    `| predicate verb | ${agg.parserMetrics.predicateVerbExact} |`,
    `| coordinated predicates | ${agg.parserMetrics.coordinatedPredicatesExact} |`,
    `| direct/object relation | ${agg.parserMetrics.objectRelationExact} |`,
    `| copular complement candidate | ${agg.parserMetrics.complementCandidateExact} |`,
    `| PP/modifier relation | ${agg.parserMetrics.ppModifierRelationExact} |`,
    '',
    '## Deterministic conversion metrics (SentenceCoreSet-like)',
    '',
    '| metric | result |',
    '|---|---|',
    `| per-core V | ${agg.conversionMetrics.perCoreV} |`,
    `| per-core O | ${agg.conversionMetrics.perCoreO} |`,
    `| per-core C | ${agg.conversionMetrics.perCoreC} |`,
    `| pattern | ${agg.conversionMetrics.pattern} |`,
    `| false-C (gold C is null) | ${agg.conversionMetrics.falseC} |`,
    '',
    '## Error attribution (parser vs conversion rule)',
    '',
    '| target | parser error | conversion rule error |',
    '|---|---:|---:|',
    `| V | ${agg.attribution.verb.parser} | ${agg.attribution.verb.conversion} |`,
    `| O | ${agg.attribution.object.parser} | ${agg.attribution.object.conversion} |`,
    `| C | ${agg.attribution.complement.parser} | ${agg.attribution.complement.conversion} |`,
    `| pattern | ${agg.attribution.pattern.parser} | ${agg.attribution.pattern.conversion} |`,
    `| false-C | ${agg.attribution.falseC.parser} | ${agg.attribution.falseC.conversion} |`,
    '',
    'Notes: parser error means spaCy candidate itself mismatched gold; conversion rule error means parser candidate matched but deterministic mapping diverged.',
  ].join('\n')
}

function runSpacy(pythonExe: string, spacyModel: string, sentences: string[]): SpacyDoc[] {
  const scriptPath = path.join(__dirname, 'spacy_dump.py')
  const payload = JSON.stringify({ model: spacyModel, sentences })
  const proc = spawnSync(pythonExe, [scriptPath], {
    input: payload,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  if (proc.status !== 0) {
    throw new Error(`spaCy dump failed: ${proc.stderr || proc.stdout}`)
  }
  const parsed = JSON.parse(proc.stdout) as { docs: SpacyDoc[] }
  return parsed.docs
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cases = args.split === 'development' ? DEVELOPMENT_CASES : LOCKED_HOLDOUT_CASES
  const docs = runSpacy(args.pythonExe, args.spacyModel, cases.map((c) => c.text))

  if (docs.length !== cases.length) {
    throw new Error(`spaCy returned ${docs.length} docs for ${cases.length} sentences`)
  }

  const rows = cases.map((item, i) => {
    const extraction = collectPredicates(item.text, docs[i]!.tokens)
    return compareSentence(item, extraction)
  })

  const aggregate = buildAggregate(args.split, rows)

  const outDir = path.join(__dirname, '..', 'results', 'generalization')
  await mkdir(outDir, { recursive: true })
  const jsonPath = path.join(outDir, `${args.outName}.json`)
  const mdPath = path.join(outDir, `${args.outName}.md`)

  await writeFile(jsonPath, JSON.stringify({ args, aggregate, results: rows }, null, 2))
  await writeFile(mdPath, buildMarkdownReport(args, aggregate))

  console.log(`wrote ${jsonPath}`)
  console.log(`wrote ${mdPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
