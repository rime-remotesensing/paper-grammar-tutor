import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEVELOPMENT_CASES, type GeneralizationCase, type GoldSpan } from './dataset.ts'

interface StanzaToken {
  text: string
  lemma: string | null
  upos: string | null
  head: number
  deprel: string
  id: number
  start: number
  end: number
}

interface StanzaSentence {
  tokens: StanzaToken[]
}

interface StanzaDoc {
  sentences: StanzaSentence[]
}

interface Predicate {
  head: StanzaToken
  headIndex: number
  deprel: string
  aux: StanzaToken[]
  cop: StanzaToken[]
  subject: Span | null
  object: Span | null
  verbSpan: Span | null
}

interface Span {
  text: string
  start: number
  end: number
}

interface Args {
  pythonExe: string
  out: string
}

interface RowResult {
  id: string
  text: string
  tags: string[]
  tokens: Array<Pick<StanzaToken, 'id' | 'text' | 'lemma' | 'upos' | 'head' | 'deprel' | 'start' | 'end'>>
  raw: {
    subject: Span | null
    predicateCount: number
    predicates: Array<{
      head: Pick<StanzaToken, 'text' | 'lemma' | 'upos' | 'head' | 'deprel'>
      deprel: string
      verbSpan: Span | null
      subject: Span | null
      object: Span | null
      hasCop: boolean
      hasAux: boolean
    }>
  }
  metrics: {
    subjectExact: boolean
    predicateCountExact: boolean
    predicateVerbExact: boolean[]
    predicateCoordinationExact: boolean
    objectRelationExact: boolean[]
    copularStructureExact: boolean[]
  }
}

function parseArgs(argv: string[]): Args {
  const valueAfter = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    pythonExe: valueAfter('--python') ?? 'C:/anaconda3/python.exe',
    out: valueAfter('--out') ?? 'stanza-development',
  }
}

function exact(gold: GoldSpan | null, got: Span | null): boolean {
  if (gold === null) return got === null
  return got !== null && gold.start === got.start && gold.end === got.end && gold.text === got.text
}

function normalizeDep(dep: string): string {
  const pos = dep.indexOf(':')
  return pos >= 0 ? dep.slice(0, pos) : dep
}

function buildChildren(tokens: StanzaToken[]): Map<number, number[]> {
  const m = new Map<number, number[]>()
  for (let i = 0; i < tokens.length; i++) {
    const headId = tokens[i]!.head
    if (!m.has(headId)) m.set(headId, [])
    m.get(headId)!.push(i)
  }
  return m
}

function collectSubtree(indicesByHead: Map<number, number[]>, tokens: StanzaToken[], headTokenId: number): number[] {
  const out: number[] = []
  const stack = [headTokenId]
  const seen = new Set<number>()
  while (stack.length > 0) {
    const tokenId = stack.pop()!
    if (seen.has(tokenId)) continue
    seen.add(tokenId)
    const idx = tokens.findIndex((t) => t.id === tokenId)
    if (idx >= 0) out.push(idx)
    for (const childIdx of indicesByHead.get(tokenId) ?? []) {
      stack.push(tokens[childIdx]!.id)
    }
  }
  return out.sort((a, b) => a - b)
}

function spanFromIndices(text: string, tokens: StanzaToken[], indices: number[]): Span | null {
  if (indices.length === 0) return null
  const start = Math.min(...indices.map((i) => tokens[i]!.start))
  const end = Math.max(...indices.map((i) => tokens[i]!.end))
  return { text: text.slice(start, end), start, end }
}

function alignTokensToSource(text: string, tokens: StanzaToken[]): StanzaToken[] {
  let cursor = 0
  const aligned: StanzaToken[] = []

  for (const token of tokens) {
    while (cursor < text.length && /\s/.test(text[cursor]!)) cursor += 1

    let start = text.indexOf(token.text, cursor)
    if (start < 0) {
      start = text.indexOf(token.text)
    }

    if (start < 0) {
      const fallbackStart = Number.isFinite(token.start) ? token.start : cursor
      const fallbackEnd = Number.isFinite(token.end) ? token.end : fallbackStart + token.text.length
      aligned.push({ ...token, start: fallbackStart, end: fallbackEnd })
      cursor = fallbackEnd
      continue
    }

    const end = start + token.text.length
    aligned.push({ ...token, start, end })
    cursor = end
  }

  return aligned
}

function findSubjectSpan(text: string, tokens: StanzaToken[], children: Map<number, number[]>, predicate: StanzaToken): Span | null {
  const subj = (children.get(predicate.id) ?? [])
    .map((i) => tokens[i]!)
    .find((t) => {
      const dep = normalizeDep(t.deprel)
      return dep === 'nsubj' || dep === 'csubj'
    })
  if (subj) {
    return spanFromIndices(text, tokens, collectSubtree(children, tokens, subj.id))
  }

  let cursor = predicate
  const visited = new Set<number>()
  while (normalizeDep(cursor.deprel) === 'conj' && !visited.has(cursor.id)) {
    visited.add(cursor.id)
    const parent = tokens.find((t) => t.id === cursor.head)
    if (!parent) break
    const parentSubj = (children.get(parent.id) ?? [])
      .map((i) => tokens[i]!)
      .find((t) => {
        const dep = normalizeDep(t.deprel)
        return dep === 'nsubj' || dep === 'csubj'
      })
    if (parentSubj) {
      return spanFromIndices(text, tokens, collectSubtree(children, tokens, parentSubj.id))
    }
    cursor = parent
  }
  return null
}

function findObjectSpan(text: string, tokens: StanzaToken[], children: Map<number, number[]>, predicate: StanzaToken): Span | null {
  const obj = (children.get(predicate.id) ?? [])
    .map((i) => tokens[i]!)
    .find((t) => normalizeDep(t.deprel) === 'obj')
  if (!obj) return null
  return spanFromIndices(text, tokens, collectSubtree(children, tokens, obj.id))
}

function buildVerbSpan(text: string, tokens: StanzaToken[], children: Map<number, number[]>, predicate: StanzaToken): Span | null {
  const parts = [predicate]
  for (const childIdx of children.get(predicate.id) ?? []) {
    const c = tokens[childIdx]!
    const dep = normalizeDep(c.deprel)
    if (dep === 'aux' || dep === 'cop' || dep === 'compound' || dep === 'prt' || dep === 'mark') {
      parts.push(c)
    }
  }
  const indices = parts.map((p) => tokens.findIndex((t) => t.id === p.id)).filter((i) => i >= 0)
  return spanFromIndices(text, tokens, indices)
}

function collectPredicates(text: string, tokens: StanzaToken[]): { predicates: Predicate[]; mainSubject: Span | null } {
  const children = buildChildren(tokens)
  const isPredicateHead = (t: StanzaToken): boolean => {
    const dep = normalizeDep(t.deprel)
    if (dep !== 'root' && dep !== 'conj') return false
    if (t.upos === 'VERB' || t.upos === 'AUX') return true
    if (dep === 'root') {
      const hasCop = (children.get(t.id) ?? []).some((i) => normalizeDep(tokens[i]!.deprel) === 'cop')
      if (hasCop && (t.upos === 'ADJ' || t.upos === 'NOUN' || t.upos === 'PROPN')) return true
    }
    return false
  }

  const heads = tokens.filter(isPredicateHead).sort((a, b) => a.start - b.start)
  const predicates = heads.map((h) => {
    const childTokens = (children.get(h.id) ?? []).map((i) => tokens[i]!)
    const aux = childTokens.filter((t) => normalizeDep(t.deprel) === 'aux')
    const cop = childTokens.filter((t) => normalizeDep(t.deprel) === 'cop')
    return {
      head: h,
      headIndex: tokens.findIndex((t) => t.id === h.id),
      deprel: normalizeDep(h.deprel),
      aux,
      cop,
      subject: findSubjectSpan(text, tokens, children, h),
      object: findObjectSpan(text, tokens, children, h),
      verbSpan: buildVerbSpan(text, tokens, children, h),
    }
  })

  const mainSubject = predicates[0]?.subject ?? null
  return { predicates, mainSubject }
}

function verbMatch(gold: GoldSpan, pred: Predicate | undefined): boolean {
  if (!pred) return false
  if (exact(gold, pred.verbSpan)) return true
  const head = pred.head.text.toLowerCase()
  const goldText = gold.text.toLowerCase()
  if (!goldText.includes(head)) return false
  const helpers = [...pred.aux, ...pred.cop].map((t) => t.text.toLowerCase())
  return helpers.every((h) => goldText.includes(h))
}

function copularStructureMatch(item: GeneralizationCase, pred: Predicate | undefined, coreIndex: number): boolean {
  if (!pred) return false
  const core = item.gold.predicateCores[coreIndex]
  if (!core) return false
  const isCopularTarget = core.pattern === 'SVC' || core.pattern === 'SVOC'
  if (!isCopularTarget) return true

  const hasCop = pred.cop.length > 0
  const headIsLexical = pred.head.upos === 'ADJ' || pred.head.upos === 'NOUN' || pred.head.upos === 'PROPN'
  const hasLinkingStyle = hasCop && headIsLexical
  const hasVerbPlusComp = (pred.head.upos === 'VERB' || pred.head.upos === 'AUX')

  return hasLinkingStyle || hasVerbPlusComp
}

function coordinationMatch(item: GeneralizationCase, predicates: Predicate[]): boolean {
  const goldCount = item.gold.predicateCores.length
  if (goldCount <= 1) {
    return predicates.length <= 1
  }
  if (predicates.length !== goldCount) return false
  for (let i = 1; i < predicates.length; i++) {
    if (predicates[i]!.deprel !== 'conj') return false
  }
  return true
}

function runStanza(pythonExe: string, sentences: string[]): StanzaDoc[] {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const scriptPath = path.join(__dirname, 'stanza_dump.py')
  const input = JSON.stringify({ lang: 'en', sentences })
  const proc = spawnSync(pythonExe, [scriptPath], {
    input,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  })
  if (proc.status !== 0) {
    throw new Error(`stanza dump failed: ${proc.stderr || proc.stdout}`)
  }
  return (JSON.parse(proc.stdout) as { docs: StanzaDoc[] }).docs
}

function pct(hit: number, total: number): string {
  return `${((hit / Math.max(total, 1)) * 100).toFixed(1)}% (${hit}/${total})`
}

function summarize(rows: RowResult[]) {
  const subjectHit = rows.filter((r) => r.metrics.subjectExact).length
  const countHit = rows.filter((r) => r.metrics.predicateCountExact).length
  const coordHit = rows.filter((r) => r.metrics.predicateCoordinationExact).length

  const verbFlags = rows.flatMap((r) => r.metrics.predicateVerbExact)
  const objFlags = rows.flatMap((r) => r.metrics.objectRelationExact)
  const copFlags = rows.flatMap((r) => r.metrics.copularStructureExact)

  return {
    sentenceCount: rows.length,
    subject: pct(subjectHit, rows.length),
    predicateCount: pct(countHit, rows.length),
    predicateVerb: pct(verbFlags.filter(Boolean).length, verbFlags.length),
    predicateCoordination: pct(coordHit, rows.length),
    objectRelation: pct(objFlags.filter(Boolean).length, objFlags.length),
    copularStructure: pct(copFlags.filter(Boolean).length, copFlags.length),
  }
}

function toMarkdown(summary: ReturnType<typeof summarize>): string {
  return [
    '# Stanza raw dependency evaluation (development)',
    '',
    '| metric | result |',
    '|---|---|',
    `| subject | ${summary.subject} |`,
    `| predicate count | ${summary.predicateCount} |`,
    `| predicate verb | ${summary.predicateVerb} |`,
    `| predicate coordination | ${summary.predicateCoordination} |`,
    `| object relation | ${summary.objectRelation} |`,
    `| copular structure | ${summary.copularStructure} |`,
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const docs = runStanza(args.pythonExe, DEVELOPMENT_CASES.map((c) => c.text))
  if (docs.length !== DEVELOPMENT_CASES.length) {
    throw new Error(`expected ${DEVELOPMENT_CASES.length} docs, got ${docs.length}`)
  }

  const rows: RowResult[] = DEVELOPMENT_CASES.map((item, idx) => {
    const sentence = docs[idx]!.sentences[0]
    const tokens = alignTokensToSource(item.text, sentence?.tokens ?? [])
    const { predicates, mainSubject } = collectPredicates(item.text, tokens)

    const predicateVerbExact = item.gold.predicateCores.map((core, i) => verbMatch(core.verb, predicates[i]))
    const objectRelationExact = item.gold.predicateCores.map((core, i) => exact(core.object, predicates[i]?.object ?? null))
    const copularStructureExact = item.gold.predicateCores.map((_, i) => copularStructureMatch(item, predicates[i], i))

    return {
      id: item.id,
      text: item.text,
      tags: item.tags,
      tokens: tokens.map((t) => ({
        id: t.id,
        text: t.text,
        lemma: t.lemma,
        upos: t.upos,
        head: t.head,
        deprel: t.deprel,
        start: t.start,
        end: t.end,
      })),
      raw: {
        subject: mainSubject,
        predicateCount: predicates.length,
        predicates: predicates.map((p) => ({
          head: {
            text: p.head.text,
            lemma: p.head.lemma,
            upos: p.head.upos,
            head: p.head.head,
            deprel: p.head.deprel,
          },
          deprel: p.deprel,
          verbSpan: p.verbSpan,
          subject: p.subject,
          object: p.object,
          hasCop: p.cop.length > 0,
          hasAux: p.aux.length > 0,
        })),
      },
      metrics: {
        subjectExact: exact(item.gold.subject, mainSubject),
        predicateCountExact: item.gold.predicateCores.length === predicates.length,
        predicateVerbExact,
        predicateCoordinationExact: coordinationMatch(item, predicates),
        objectRelationExact,
        copularStructureExact,
      },
    }
  })

  const summary = summarize(rows)
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const outDir = path.join(__dirname, '..', 'results', 'generalization')
  await mkdir(outDir, { recursive: true })

  const jsonPath = path.join(outDir, `${args.out}.json`)
  const mdPath = path.join(outDir, `${args.out}.md`)

  await writeFile(jsonPath, JSON.stringify({ summary, results: rows }, null, 2))
  await writeFile(mdPath, toMarkdown(summary))

  console.log(`wrote ${jsonPath}`)
  console.log(`wrote ${mdPath}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
