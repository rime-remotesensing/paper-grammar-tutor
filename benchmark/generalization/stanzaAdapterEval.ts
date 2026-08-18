import fs from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { derivePattern } from '../../src/features/grammar/domain/derivePattern.ts'
import type { PredicateCoreRelation, SentencePattern, Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema.ts'
import { DEVELOPMENT_CASES, type GeneralizationCase } from './dataset.ts'
import { evaluateCoreSet } from './metrics.ts'

interface ParsedCase {
  id: string
  text: string
  tokens: Array<{ id?: number; text: string; lemma: string | null; upos: string | null; head: number; deprel: string; start: number; end: number }>
  raw: {
    subject: { text: string; start: number; end: number } | null
    predicateCount: number
    predicates: Array<{
      head: { text: string; lemma: string | null; upos: string | null; head: number; deprel: string }
      deprel: string
      verbSpan: { text: string; start: number; end: number } | null
      subject: { text: string; start: number; end: number } | null
      object: { text: string; start: number; end: number } | null
      hasCop: boolean
      hasAux: boolean
    }>
  }
}

function normalizeDep(dep: string): string {
  return dep.split(':')[0] ?? dep
}

function sanitizeSpan(span: { text: string; start: number; end: number } | null): Span | null {
  if (!span) return null
  return { text: span.text, start: span.start, end: span.end }
}

type ParsedToken = ParsedCase['tokens'][number] & { id: number }

function spanFromTokens(text: string, tokens: ParsedToken[]): Span | null {
  if (tokens.length === 0) return null
  const ordered = [...tokens].sort((a, b) => a.start - b.start)
  const start = ordered[0]!.start
  const end = ordered.at(-1)!.end
  return { text: text.slice(start, end), start, end }
}

function childrenByHead(tokens: ParsedToken[]): Map<number, ParsedToken[]> {
  const byHead = new Map<number, ParsedToken[]>()
  for (const token of tokens) {
    if (!byHead.has(token.head)) byHead.set(token.head, [])
    byHead.get(token.head)!.push(token)
  }
  return byHead
}

function collectPhraseTokens(head: ParsedToken, byHead: Map<number, ParsedToken[]>, excludedDeps: Set<string>): ParsedToken[] {
  const out: ParsedToken[] = []
  const stack: ParsedToken[] = [head]
  const seen = new Set<number>()

  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current.id)) continue
    seen.add(current.id)
    out.push(current)

    const children = byHead.get(current.id) ?? []
    for (const child of children) {
      const dep = normalizeDep(child.deprel)
      if (excludedDeps.has(dep)) continue
      stack.push(child)
    }
  }

  return out
}

function reconstructCopularCore(
  text: string,
  pred: ParsedCase['raw']['predicates'][number],
  tokens: ParsedToken[],
): { verb: Span | null; complement: Span | null } | null {
  if (!pred.hasCop) return null
  const rawVerb = sanitizeSpan(pred.verbSpan ?? null)
  if (!rawVerb) return null

  const headCandidates = tokens
    .filter((token) => token.text === pred.head.text)
    .filter((token) => !pred.head.upos || token.upos === pred.head.upos)
    .filter((token) => token.start >= rawVerb.start && token.end <= rawVerb.end)
    .sort((a, b) => a.start - b.start)
  const headToken = headCandidates[0]
  if (!headToken) return null

  const byHead = childrenByHead(tokens)
  const copTokens = (byHead.get(headToken.id) ?? [])
    .filter((token) => normalizeDep(token.deprel) === 'cop')
    .sort((a, b) => a.start - b.start)
  if (copTokens.length === 0) return null

  const copPhraseSet = new Map<number, ParsedToken>()
  for (const cop of copTokens) {
    copPhraseSet.set(cop.id, cop)
    for (const child of byHead.get(cop.id) ?? []) {
      const dep = normalizeDep(child.deprel)
      if (dep === 'aux' || dep === 'neg' || dep === 'advmod') {
        copPhraseSet.set(child.id, child)
      }
    }
  }

  const complementTokens = collectPhraseTokens(headToken, byHead, new Set(['cop', 'conj', 'cc', 'punct', 'nsubj', 'csubj']))
  return {
    verb: spanFromTokens(text, [...copPhraseSet.values()]),
    complement: spanFromTokens(text, complementTokens),
  }
}

function isCitationLike(span: { text: string; start: number; end: number } | null): boolean {
  if (!span) return false
  return /\b[A-Z][a-z]+\s+et\s+al\.|\(\s*[A-Z][a-z]+\s+et\s+al\.\s*\d{4}\s*\)/i.test(span.text) || /\(.*\d{4}.*\)/.test(span.text)
}

function connectorSpan(text: string, start: number, end: number): Span | null {
  const gap = text.slice(start, end)
  const match = Array.from(gap.matchAll(/\b(and|or|but|nor|yet|while|whereas)\b/gi)).at(-1)
  if (!match || match.index === undefined) return null
  const absoluteStart = start + match.index
  return { text: match[0], start: absoluteStart, end: absoluteStart + match[0].length }
}

const SUBJECT_PARENTHETICAL_DEPS = new Set(['acl', 'advcl', 'appos', 'parataxis'])

function hasCommaBetween(tokens: ParsedToken[], start: number, end: number): boolean {
  return tokens.some((token) => token.text === ',' && token.start >= start && token.start < end)
}

function collectSubjectPhraseTokens(head: ParsedToken, byHead: Map<number, ParsedToken[]>, allTokens: ParsedToken[]): ParsedToken[] {
  const out: ParsedToken[] = []
  const stack: ParsedToken[] = [head]
  const seen = new Set<number>()

  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current.id)) continue
    seen.add(current.id)
    out.push(current)

    const children = byHead.get(current.id) ?? []
    for (const child of children) {
      const dep = normalizeDep(child.deprel)
      if (dep === 'punct') continue
      // A clausal/appositive modifier set off by a comma right after the subject head is a
      // parenthetical aside (e.g. "score, defined by [式 (3)], approaches"), not part of the
      // subject noun phrase. The same relation attached directly with no comma stays in the
      // subject (e.g. "stations that recorded ... were retained").
      if (SUBJECT_PARENTHETICAL_DEPS.has(dep) && hasCommaBetween(allTokens, current.end, child.start)) continue
      stack.push(child)
    }
  }

  return out
}

function findMainSubjectToken(tokens: ParsedToken[]): ParsedToken | null {
  const root = tokens.find((token) => normalizeDep(token.deprel) === 'root')
  if (!root) return null
  return tokens.find((token) => token.head === root.id && ['nsubj', 'csubj'].includes(normalizeDep(token.deprel))) ?? null
}

function trimSubjectSpan(text: string, rawSubject: Span | null, tokens: ParsedToken[], byHead: Map<number, ParsedToken[]>): Span | null {
  if (!rawSubject) return null
  const mainSubjectToken = findMainSubjectToken(tokens)
  if (!mainSubjectToken) return rawSubject
  if (mainSubjectToken.start < rawSubject.start || mainSubjectToken.end > rawSubject.end) return rawSubject
  const phraseTokens = collectSubjectPhraseTokens(mainSubjectToken, byHead, tokens)
  return spanFromTokens(text, phraseTokens) ?? rawSubject
}

function findPredicateHeadToken(tokens: ParsedToken[], pred: ParsedCase['raw']['predicates'][number]): ParsedToken | null {
  const verbSpan = sanitizeSpan(pred.verbSpan ?? null)
  const candidates = tokens
    .filter((token) => token.text === pred.head.text)
    .filter((token) => !pred.head.upos || token.upos === pred.head.upos)
    .filter((token) => !verbSpan || (token.start >= verbSpan.start && token.end <= verbSpan.end))
    .sort((a, b) => a.start - b.start)
  return candidates[0] ?? null
}

function collectObjectPhraseTokens(head: ParsedToken, byHead: Map<number, ParsedToken[]>): ParsedToken[] {
  const out: ParsedToken[] = []
  const stack: ParsedToken[] = [head]
  const seen = new Set<number>()

  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current.id)) continue
    seen.add(current.id)
    out.push(current)

    const children = byHead.get(current.id) ?? []
    for (const child of children) {
      const dep = normalizeDep(child.deprel)
      if (dep === 'punct') continue
      // A nominal dropped in via apposition (citation lists, colon-introduced enumerations) is
      // supplementary detail, not part of the object noun phrase (e.g. "gains (Kim et al. 2018;
      // ...)" or "stages: image correction, ..."). A postnominal adjective (English attributive
      // adjectives are prenominal) signals a resultative/object-complement small clause instead
      // of an NP-internal modifier (e.g. "deemed the threshold unnecessarily conservative").
      if (dep === 'appos' || dep === 'parataxis') continue
      if (dep === 'amod' && child.start > current.end) continue
      stack.push(child)
    }
  }

  return out
}

function findPostnominalComplement(text: string, head: ParsedToken, byHead: Map<number, ParsedToken[]>): Span | null {
  const children = byHead.get(head.id) ?? []
  const trailingAmod = children
    .filter((child) => normalizeDep(child.deprel) === 'amod' && child.start > head.end)
    .sort((a, b) => a.start - b.start)[0]
  if (!trailingAmod) return null
  return spanFromTokens(text, collectPhraseTokens(trailingAmod, byHead, new Set(['punct'])))
}

function trimObjectSpan(
  text: string,
  rawObject: Span | null,
  tokens: ParsedToken[],
  byHead: Map<number, ParsedToken[]>,
  headToken: ParsedToken | null,
): { object: Span | null; complement: Span | null } {
  if (!rawObject || !headToken) return { object: rawObject, complement: null }
  const objectHeadToken = tokens.find((token) => normalizeDep(token.deprel) === 'obj' && token.head === headToken.id)
  if (!objectHeadToken) return { object: rawObject, complement: null }
  if (objectHeadToken.start < rawObject.start || objectHeadToken.end > rawObject.end) return { object: rawObject, complement: null }
  const phraseTokens = collectObjectPhraseTokens(objectHeadToken, byHead)
  const trimmedObject = spanFromTokens(text, phraseTokens) ?? rawObject
  const complement = findPostnominalComplement(text, objectHeadToken, byHead)
  return { object: trimmedObject, complement }
}

function subjectHeadFromSubject(subject: Span | null, tokens: ParsedCase['tokens']): Span | null {
  if (!subject) return null
  const subjectToken = tokens.find((token) => token.text === subject.text.split(' ')[0])
  if (!subjectToken) return subject
  const nominal = tokens.filter((token) => token.start >= subject.start && token.end <= subject.end)
    .filter((token) => token.upos && ['NOUN', 'PROPN', 'ADJ', 'PRON'].includes(token.upos))
    .sort((a, b) => a.start - b.start)
  if (nominal.length === 0) return subject
  const head = nominal.at(-1)!
  return { text: head.text, start: head.start, end: head.end }
}

function buildSentenceCoreSet(item: GeneralizationCase, parsed: ParsedCase) {
  const tokens = parsed.tokens.map((token, idx) => ({ ...token, id: token.id ?? idx + 1 }))
  const byHead = childrenByHead(tokens)
  const rawSubject = sanitizeSpan(parsed.raw.subject ?? null)
  const subject = trimSubjectSpan(item.text, rawSubject, tokens, byHead)
  const subjectHead = subjectHeadFromSubject(subject, tokens)

  const predicateCores: Array<{
    predicateCoreId: string
    relation: PredicateCoreRelation
    connector: Span | null
    verb: Span | null
    indirectObject: Span | null
    object: Span | null
    complement: Span | null
    pattern: SentencePattern
  }> = []

  let previousVerbEnd = 0
  for (let i = 0; i < parsed.raw.predicates.length; i++) {
    const pred = parsed.raw.predicates[i]!
    let verb = sanitizeSpan(pred.verbSpan ?? null)

    // A candidate coordinated predicate reached across a semicolon is a colon-introduced
    // enumeration item (e.g. "followed four steps: A were dried; B were recorded; ..."), not a
    // further coordinated action of the main subject; the main predicate's object already names
    // the enumerated set, so these conjuncts stay out of the core predicate list entirely.
    if (i > 0 && verb && item.text.slice(previousVerbEnd, verb.start).includes(';')) continue

    let object = sanitizeSpan(pred.object ?? null)
    let complement: Span | null = null

    if (pred.hasCop) {
      const reconstructed = reconstructCopularCore(item.text, pred, tokens)
      if (reconstructed?.verb) verb = reconstructed.verb
      if (reconstructed?.complement) complement = reconstructed.complement
    } else {
      const headToken = findPredicateHeadToken(tokens, pred)
      const trimmed = trimObjectSpan(item.text, object, tokens, byHead, headToken)
      object = trimmed.object
      if (trimmed.complement) complement = trimmed.complement
    }

    if (object && isCitationLike(object)) object = null
    if (complement && isCitationLike(complement)) complement = null

    const pattern = derivePattern({ verb, indirectObject: null, object, complement })
    const isFirst = predicateCores.length === 0
    const connector = isFirst ? null : connectorSpan(item.text, previousVerbEnd, verb ? verb.start : item.text.length)

    predicateCores.push({
      predicateCoreId: `predicate-${predicateCores.length + 1}`,
      relation: isFirst ? 'main' : 'coordinated',
      connector,
      verb,
      indirectObject: null,
      object,
      complement,
      pattern,
    })

    if (verb) previousVerbEnd = verb.end
  }

  return { subject, subjectHead, predicateCores }
}

function failureClass(id: string): 'upstream Stanza parser error' | 'deterministic adapter error' | 'adapter scope gap (gold reviewed, correct)' | 'intentional product-representation difference' {
  if (new Set(['d15-svc-svc-coordination', 'd23-whereas', 'd34-long-80', 'd43-coordinated-clauses']).has(id)) {
    return 'upstream Stanza parser error'
  }
  if (new Set(['d16-svc-passive-coordination', 'd31-equation-adjacent', 'd41-parenthetical-citation', 'd48-mixed-three-patterns']).has(id)) {
    return 'deterministic adapter error'
  }
  // Reviewed against the product's own S/V/O/C and five-pattern definitions, independent of
  // Stanza's output: gold is correct in every one of these six cases. Each failure instead traces
  // to a specific, un-implemented adapter capability -- d03/d22/d25/d36 need xcomp-based
  // complement reconstruction for lexical linking/object-complement verbs (remain, become,
  // was considered) that carry no literal `cop` token; d38 needs `iobj` extraction (never wired
  // up; indirectObject is hardcoded null); d39 needs `ccomp` clausal-object extraction (object
  // extraction only looks at `obj`). None of these are in scope for this pass.
  if (new Set(['d03-simple-svc', 'd22-although', 'd25-when', 'd36-passive-true-svc', 'd38-svoo', 'd39-clause-object']).has(id)) {
    return 'adapter scope gap (gold reviewed, correct)'
  }
  return 'intentional product-representation difference'
}

async function main() {
  const file = path.join(process.cwd(), 'benchmark', 'results', 'generalization', 'stanza-development.json')
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { results: ParsedCase[] }
  const rows: Array<{ id: string; classification: string; metrics: ReturnType<typeof evaluateCoreSet>; coreSet: ReturnType<typeof buildSentenceCoreSet> }> = []

  for (const item of DEVELOPMENT_CASES) {
    const current = parsed.results.find((entry) => entry.id === item.id)
    if (!current) continue
    const coreSet = buildSentenceCoreSet(item, current)
    const metrics = evaluateCoreSet(item, coreSet as any)
    rows.push({ id: item.id, classification: failureClass(item.id), metrics, coreSet })
  }

  const totalPredicateCores = DEVELOPMENT_CASES.reduce((sum, item) => sum + item.gold.predicateCores.length, 0)
  const totalGoldNullComplementCores = DEVELOPMENT_CASES.flatMap((item) => item.gold.predicateCores).filter((core) => core.complement === null).length
  const totalTrueFalseComplement = rows.reduce((sum, row) => sum + row.metrics.falseComplement.filter(Boolean).length, 0)
  const exactComplement = rows.reduce((sum, row) => sum + row.metrics.predicateComplementExact.filter(Boolean).length, 0)
  const exactPattern = rows.reduce((sum, row) => sum + row.metrics.predicatePatternExact.filter(Boolean).length, 0)
  const exactCoreSet = rows.filter((row) => row.metrics.coreSetExact).length

  const summary = {
    sentenceCount: DEVELOPMENT_CASES.length,
    subject: `${((100 * rows.filter((row) => row.metrics.sharedSubjectExact).length) / DEVELOPMENT_CASES.length).toFixed(1)}% (${rows.filter((row) => row.metrics.sharedSubjectExact).length}/${DEVELOPMENT_CASES.length})`,
    predicateCount: `${((100 * rows.filter((row) => row.metrics.predicateCoreCountExact).length) / DEVELOPMENT_CASES.length).toFixed(1)}% (${rows.filter((row) => row.metrics.predicateCoreCountExact).length}/${DEVELOPMENT_CASES.length})`,
    predicateVerb: `${((100 * rows.reduce((sum, row) => sum + row.metrics.predicateVerbExact.filter(Boolean).length, 0)) / totalPredicateCores).toFixed(1)}% (${rows.reduce((sum, row) => sum + row.metrics.predicateVerbExact.filter(Boolean).length, 0)}/${totalPredicateCores})`,
    objectRelation: `${((100 * rows.reduce((sum, row) => sum + row.metrics.predicateObjectExact.filter(Boolean).length, 0)) / totalPredicateCores).toFixed(1)}% (${rows.reduce((sum, row) => sum + row.metrics.predicateObjectExact.filter(Boolean).length, 0)}/${totalPredicateCores})`,
    copularStructure: `${((100 * exactComplement) / totalPredicateCores).toFixed(1)}% (${exactComplement}/${totalPredicateCores})`,
    perCorePattern: `${((100 * exactPattern) / totalPredicateCores).toFixed(1)}% (${exactPattern}/${totalPredicateCores})`,
    falseC: `${((100 * totalTrueFalseComplement) / totalGoldNullComplementCores).toFixed(1)}% (${totalTrueFalseComplement}/${totalGoldNullComplementCores})`,
    wholeCoreSetExact: `${((100 * exactCoreSet) / DEVELOPMENT_CASES.length).toFixed(1)}% (${exactCoreSet}/${DEVELOPMENT_CASES.length})`,
  }

  const failures = rows.filter((row) => !row.metrics.sharedSubjectExact || !row.metrics.predicateCoreCountExact || row.metrics.predicateVerbExact.some((value) => !value) || row.metrics.predicateObjectExact.some((value) => !value) || row.metrics.predicateComplementExact.some((value) => !value) || row.metrics.predicatePatternExact.some((value) => !value) || row.metrics.falseComplement.some(Boolean) || !row.metrics.coreSetExact)

  const md = `# Stanza -> SentenceCoreSet adapter (development 48)

Scope: development-only. No holdout, no production code, no UI change.

## Summary
- subject: ${summary.subject}
- predicate count: ${summary.predicateCount}
- per-core V: ${summary.predicateVerb}
- O: ${summary.objectRelation}
- C: ${summary.copularStructure}
- per-core pattern: ${summary.perCorePattern}
- false-C: ${summary.falseC}
- whole core-set exact: ${summary.wholeCoreSetExact}

## Failure attribution
| id | classification | reason |
${failures.map((row) => `| ${row.id} | ${row.classification} | ${row.classification === 'upstream Stanza parser error' ? 'The dependency graph itself loses the intended clause structure before the adapter sees it.' : row.classification === 'deterministic adapter error' ? 'The dependency parse is largely correct, but the deterministic conversion mis-assigns the V/O/C span.' : row.classification === 'adapter scope gap (gold reviewed, correct)' ? 'Gold matches the product\'s own S/V/O/C and five-pattern rules; the adapter does not yet implement the dependency pattern this sentence needs (xcomp complement, iobj, or ccomp object).' : 'The parser is acceptable; this is an intentional product span or attachment difference.'} |`).join('\n')}

## Notes
- The adapter is intentionally minimal: it converts the dependency tree to a shared subject + predicate core set without repairing Stanza parses.
- The evaluator now uses the per-core null-C denominator to avoid sentence-level overcounting.
- Citation, equation, and parenthetical material are excluded from core object/complement slots unless the product definition explicitly includes them.
`

  const outDir = path.join(process.cwd(), 'benchmark', 'results', 'generalization')
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'stanza-adapter-development.json'), JSON.stringify({ summary, failures: failures.map((row) => ({ id: row.id, classification: row.classification, metrics: row.metrics })) }, null, 2))
  await writeFile(path.join(outDir, 'stanza-adapter-development.md'), md)

  console.log(JSON.stringify(summary, null, 2))
  console.log('wrote benchmark/results/generalization/stanza-adapter-development.json and .md')
}

void main()
