import { derivePattern } from '../../../src/features/grammar/domain/derivePattern.ts'
import type { PredicateCoreRelation, SentencePattern, Span } from '../../../src/features/grammar/schemas/grammarAnalysis.schema.ts'
import type { GeneralizationCase } from './dataset.ts'

// ============================================================================
// Prototype 2.6F/2.6G2.9 -- hierarchical Stanza adapter (product fixture copy).
//
// Pipeline: Stanza dependency tokens -> ClauseFrame tree -> PredicateFrame
// per clause -> Paper Grammar Tutor SentenceCoreSet (S/V/O/C).
//
// This is the pure `buildHierarchical` logic ONLY -- a trimmed copy of the file
// of the same name under develop's benchmark/generalization/, kept in sync by
// hand. The original also carries CLI/report-generation code (`runSplit`,
// `main()`, filesystem reads of benchmark/results/generalization/*.json) that
// exists solely to run and report the full corpus from the command line --
// never needed by `buildHierarchical` itself, and never safe to import as a
// side effect of a product test (a bare top-level `main()` call executed on
// import, reading a benchmark-generated file that does not exist on this
// branch, producing an unhandled ENOENT the moment this module loads).
// Product regression tests only ever need `buildHierarchical`'s own pure
// conversion logic, so this copy keeps exactly that and nothing else: no
// top-level execution, no filesystem access, no benchmark/results/ dependency.
// ============================================================================

interface ParsedCase {
  id: string
  text: string
  tokens: Array<{ id?: number; text: string; lemma: string | null; upos: string | null; head: number; deprel: string; start: number; end: number }>
}

type ParsedToken = ParsedCase['tokens'][number] & { id: number }

function normalizeDep(dep: string): string {
  return dep.split(':')[0] ?? dep
}

function childrenByHead(tokens: ParsedToken[]): Map<number, ParsedToken[]> {
  const byHead = new Map<number, ParsedToken[]>()
  for (const token of tokens) {
    if (!byHead.has(token.head)) byHead.set(token.head, [])
    byHead.get(token.head)!.push(token)
  }
  return byHead
}

// ----------------------------------------------------------------------------
// Balanced-delimiter span construction (section 9).
//
// A span is built from a set of tokens by taking [min(start), max(end)], same
// as before, but afterwards it is *extended* (never truncated) so that any
// opening/closing delimiter left dangling at the edges gets its partner --
// this is a generic bracket-matching pass over ( ) [ ] { }, not specific to
// any literal string.
// ----------------------------------------------------------------------------
const OPENERS: Record<string, string> = { '(': ')', '[': '[', '{': '}' }
OPENERS['['] = ']'
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

function balanceDelimiters(text: string, start: number, end: number): { start: number; end: number } {
  let s = start
  let e = end
  // Walk outward while there is an unmatched closer just past `e` whose opener is inside [s,e),
  // or an unmatched opener just before `s` whose closer is inside [s,e).
  for (let guard = 0; guard < 8; guard++) {
    const slice = text.slice(s, e)
    const stack: string[] = []
    let unmatchedOpenInside = false
    for (const ch of slice) {
      if (OPENERS[ch]) stack.push(OPENERS[ch])
      else if (CLOSERS[ch]) {
        if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop()
        // an unmatched closer inside means an opener was truncated on the left; handled by the
        // caller only ever growing forward, so we do not walk left here.
      }
    }
    if (stack.length > 0) {
      unmatchedOpenInside = true
      // there's a dangling opener with no closer before `e` -- extend `e` to the matching closer
      const want = stack[stack.length - 1]!
      const found = text.indexOf(want, e)
      if (found >= 0 && found - e < 6) {
        e = found + 1
        continue
      }
    }
    if (!unmatchedOpenInside) break
    break
  }
  return { start: s, end: e }
}

function spanFromTokens(text: string, tokens: ParsedToken[]): Span | null {
  if (tokens.length === 0) return null
  const ordered = [...tokens].sort((a, b) => a.start - b.start)
  const rawStart = ordered[0]!.start
  const rawEnd = ordered.at(-1)!.end
  const { start, end } = balanceDelimiters(text, rawStart, rawEnd)
  return { text: text.slice(start, end), start, end }
}

function hasCommaBetween(tokens: ParsedToken[], start: number, end: number): boolean {
  return tokens.some((token) => token.text === ',' && token.start >= start && token.start < end)
}

// ----------------------------------------------------------------------------
// Canonical-constituent token selection (sections 8 & 10).
//
// Allowlist of NP/PP-internal relations that stay inside a constituent
// (subject, object, or complement) headed by `head`. Non-restrictive
// appositives/parataxis are always excluded; acl/acl:relcl/advcl are excluded
// only when comma-delimited (i.e. non-restrictive), matching the restrictive
// vs. non-restrictive distinction UD actually encodes via punctuation.
// Postnominal amod is excluded (it signals an object-complement small clause,
// see PredicateFrame construction) and left for the caller to reattach as C.
// ----------------------------------------------------------------------------
const ALWAYS_NONRESTRICTIVE = new Set(['appos', 'parataxis'])
const RESTRICTIVE_GATED = new Set(['acl', 'advcl'])
const EMPTY_ID_SET: ReadonlySet<number> = new Set()
const EMPTY_DEP_SET: ReadonlySet<string> = new Set()
const COPULAR_HEAD_STOP_DEPS: ReadonlySet<string> = new Set(['nsubj', 'csubj', 'cop'])

function collectConstituentTokens(
  head: ParsedToken,
  byHead: Map<number, ParsedToken[]>,
  allTokens: ParsedToken[],
  boundaryIds: ReadonlySet<number> = EMPTY_ID_SET,
  stopDeps: ReadonlySet<string> = EMPTY_DEP_SET,
): ParsedToken[] {
  const out: ParsedToken[] = []
  const stack: ParsedToken[] = [head]
  const seen = new Set<number>()

  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current.id)) continue
    // Never swallow a token that is itself a registered clause head or a sibling coordinated
    // predicate head -- those are separate PredicateFrames/ClauseFrames, already extracted on
    // their own, and must not be re-absorbed into this constituent's span (this is what caused
    // a copular complement to swallow its own coordinated sibling predicate, e.g. "nonlinear"
    // reaching across `conj` into "is controlled by soil moisture").
    if (current.id !== head.id && boundaryIds.has(current.id)) continue
    seen.add(current.id)
    out.push(current)

    for (const child of byHead.get(current.id) ?? []) {
      const dep = normalizeDep(child.deprel)
      if (dep === 'punct') continue // balanced-delimiter pass reattaches closers/openers afterwards
      if (stopDeps.has(dep)) continue
      // `appos` is a bare non-restrictive apposition ("gains (Kim et al. 2018)") and stays
      // excluded -- unless it itself has a `case` child, which means it is actually the object
      // of a preposition (a PP such as "term in [式 (7)]") that Stanza attached as `appos`
      // instead of `nmod`; a PP headed this way is kept, same as an ordinary `nmod` PP.
      const childIsPpObject = dep === 'appos' && (byHead.get(child.id) ?? []).some((gc) => normalizeDep(gc.deprel) === 'case')
      if (ALWAYS_NONRESTRICTIVE.has(dep) && !childIsPpObject) continue
      if (RESTRICTIVE_GATED.has(dep) && hasCommaBetween(allTokens, current.end, child.start)) continue
      if (dep === 'amod' && child.start > current.end) continue // postnominal -> complement candidate
      stack.push(child)
    }
  }
  return out
}

function findPostnominalComplementToken(head: ParsedToken, byHead: Map<number, ParsedToken[]>): ParsedToken | null {
  const children = byHead.get(head.id) ?? []
  return children.filter((c) => normalizeDep(c.deprel) === 'amod' && c.start > head.end).sort((a, b) => a.start - b.start)[0] ?? null
}

// ============================================================================
// ClauseFrame layer (sections 4 & 5)
// ============================================================================

type ClauseRelation = 'main' | 'subordinate' | 'coordinated' | 'relative' | 'other'

interface ClauseFrame {
  clauseId: number
  relation: ClauseRelation
  headTokenId: number
  parentClauseId: number | null
  marker: ParsedToken | null // the clause's own `mark` child token, if any (a subordinating conjunction or complementizer)
  predicateHeadIds: number[] // this clause's own predicate head tokens (root + its conj chain)
}

// Deprels that start a genuinely new clause. xcomp is deliberately excluded: an
// xcomp has no subject of its own in UD and is folded into the governing
// PredicateFrame instead (section 7). ccomp *is* a finite clause with its own
// subject, but for S/V/O/C purposes it is folded back into the governing
// predicate's object slot as a whole span (section 6/10) rather than exploded
// into a further S/V/O -- so it is registered as a clause (to protect its own
// internal coordination scope) but never contributes to a *different*
// clause's predicateFrames.
const CLAUSE_STARTING_DEPRELS = new Set(['root', 'advcl', 'acl', 'ccomp', 'csubj', 'parataxis'])

function classifyClauseRelation(headToken: ParsedToken): ClauseRelation {
  const dep = headToken.deprel // keep subtype (acl:relcl) for this decision
  if (normalizeDep(dep) === 'root') return 'main'
  if (dep === 'acl:relcl') return 'relative'
  if (normalizeDep(dep) === 'advcl') return 'subordinate'
  if (normalizeDep(dep) === 'acl') return 'other' // reduced/non-finite postmodifier clause
  if (normalizeDep(dep) === 'ccomp') return 'other'
  if (normalizeDep(dep) === 'csubj') return 'other'
  if (normalizeDep(dep) === 'parataxis') return 'other'
  return 'other'
}

// Walk up the head-chain from `token` until reaching a token that is itself a
// clause head (its id is in clauseHeadIds), following only `conj` links.
// Returns null if the chain does not stay inside pure coordination.
function anchorClauseHead(token: ParsedToken, byId: Map<number, ParsedToken>, clauseHeadIds: Set<number>): ParsedToken | null {
  let current: ParsedToken | undefined = token
  let guard = 0
  while (current && guard < 64) {
    if (clauseHeadIds.has(current.id)) return current
    if (normalizeDep(current.deprel) !== 'conj') return null
    current = byId.get(current.head)
    guard += 1
  }
  return null
}

function isPredicateLikeToken(token: ParsedToken, byHead: Map<number, ParsedToken[]>): boolean {
  if (token.upos === 'VERB' || token.upos === 'AUX') return true
  // copular root: lexical ADJ/NOUN/PROPN head with an overt `cop` child (e.g. "X is effective")
  if (token.upos === 'ADJ' || token.upos === 'NOUN' || token.upos === 'PROPN') {
    return (byHead.get(token.id) ?? []).some((c) => normalizeDep(c.deprel) === 'cop')
  }
  return false
}

function buildClauseFrames(text: string, tokens: ParsedToken[], byHead: Map<number, ParsedToken[]>): ClauseFrame[] {
  const byId = new Map(tokens.map((t) => [t.id, t]))

  const clauseHeadTokens = tokens.filter(
    (t) => CLAUSE_STARTING_DEPRELS.has(normalizeDep(t.deprel)) && isPredicateLikeToken(t, byHead),
  )
  const clauseHeadIds = new Set(clauseHeadTokens.map((t) => t.id))

  // predicateHeadIds: the clause head itself plus every token reachable from it via a pure
  // `conj` chain (coordinated predicates of the *same* clause). Recursion stops the moment a
  // child's own deprel is a clause-starting deprel -- that child becomes ITS OWN clause instead.
  // A conjunct reached across a semicolon is excluded even when it attaches by plain `conj`
  // directly to the clause head: a semicolon-separated conjunct is a colon-introduced
  // enumeration item, not a further coordinated action of the clause's own subject (the
  // punctuation is the only general signal UD gives for this -- there is no distinct deprel
  // for "enumeration item" vs. "true coordinate clause").
  function collectCoordinatedPredicates(head: ParsedToken): number[] {
    const out = [head.id]
    const stack = [head]
    const seen = new Set([head.id])
    let previousEnd = head.end
    while (stack.length > 0) {
      const current = stack.pop()!
      for (const child of byHead.get(current.id) ?? []) {
        if (seen.has(child.id)) continue
        if (normalizeDep(child.deprel) !== 'conj') continue
        if (!isPredicateLikeToken(child, byHead)) continue
        if (text.slice(previousEnd, child.start).includes(';')) continue
        seen.add(child.id)
        out.push(child.id)
        stack.push(child)
        previousEnd = child.end
      }
    }
    return out
  }

  const clauses: ClauseFrame[] = clauseHeadTokens
    .sort((a, b) => a.start - b.start)
    .map((headToken, _idx) => {
      const anchor = anchorClauseHead(byId.get(headToken.head)!, byId, clauseHeadIds)
      const marker = (byHead.get(headToken.id) ?? []).find((c) => normalizeDep(c.deprel) === 'mark') ?? null
      return {
        clauseId: headToken.id,
        relation: classifyClauseRelation(headToken),
        headTokenId: headToken.id,
        parentClauseId: anchor ? anchor.id : null,
        marker,
        predicateHeadIds: collectCoordinatedPredicates(headToken),
      }
    })

  return clauses
}

// ============================================================================
// PredicateFrame layer (section 6)
// ============================================================================

interface PredicateFrame {
  predicateId: number
  clauseId: number
  relation: PredicateCoreRelation
  headToken: ParsedToken
  aux: ParsedToken[]
  auxPass: ParsedToken[]
  cop: ParsedToken[]
  subjToken: ParsedToken | null
  objToken: ParsedToken | null
  iobjToken: ParsedToken | null
  xcompToken: ParsedToken | null
  ccompToken: ParsedToken | null
}

function buildPredicateFrame(headToken: ParsedToken, clause: ClauseFrame, byHead: Map<number, ParsedToken[]>, isFirstInClause: boolean): PredicateFrame {
  const children = byHead.get(headToken.id) ?? []
  return {
    predicateId: headToken.id,
    clauseId: clause.clauseId,
    relation: isFirstInClause ? 'main' : 'coordinated',
    headToken,
    aux: children.filter((c) => normalizeDep(c.deprel) === 'aux'),
    auxPass: children.filter((c) => c.deprel === 'aux:pass'),
    cop: children.filter((c) => normalizeDep(c.deprel) === 'cop'),
    subjToken: children.find((c) => normalizeDep(c.deprel) === 'nsubj' || normalizeDep(c.deprel) === 'csubj') ?? null,
    objToken: children.find((c) => normalizeDep(c.deprel) === 'obj') ?? null,
    iobjToken: children.find((c) => normalizeDep(c.deprel) === 'iobj') ?? null,
    xcompToken: children.find((c) => normalizeDep(c.deprel) === 'xcomp') ?? null,
    ccompToken: children.find((c) => normalizeDep(c.deprel) === 'ccomp') ?? null,
  }
}

// ============================================================================
// PredicateFrame -> Paper Grammar Tutor S/V/O/C (sections 7, 8, 10)
// ============================================================================

interface CoreOut {
  predicateCoreId: string
  relation: PredicateCoreRelation
  connector: Span | null
  verb: Span | null
  indirectObject: Span | null
  object: Span | null
  complement: Span | null
  pattern: SentencePattern
}

function isCitationLike(span: Span | null): boolean {
  if (!span) return false
  return /\b[A-Z][a-z]+\s+et\s+al\.|\(\s*[A-Z][a-z]+\s+et\s+al\.\s*\d{4}\s*\)/i.test(span.text) || /\(.*\d{4}.*\)/.test(span.text)
}

function verbSpanFor(frame: PredicateFrame, text: string, _byHead: Map<number, ParsedToken[]>): Span {
  const parts = new Map<number, ParsedToken>()
  // For a copular predicate the lexical head (e.g. "nonlinear") is the complement, not the verb;
  // the verb is the copula (+ aux) alone. For every other predicate the lexical head is the verb.
  if (frame.cop.length === 0) parts.set(frame.headToken.id, frame.headToken)
  for (const t of [...frame.aux, ...frame.auxPass, ...frame.cop]) parts.set(t.id, t)
  return spanFromTokens(text, [...parts.values()])!
}

function convertPredicateFrame(
  frame: PredicateFrame,
  text: string,
  tokens: ParsedToken[],
  byHead: Map<number, ParsedToken[]>,
  _clauseById: Map<number, ClauseFrame>,
  boundaryIds: ReadonlySet<number>,
): CoreOut {
  const verb = verbSpanFor(frame, text, byHead)
  let object: Span | null = null
  let indirectObject: Span | null = null
  let complement: Span | null = null

  if (frame.cop.length > 0) {
    // Copular core: V = cop(+aux); C = the lexical head's own constituent (unchanged policy).
    // `boundaryIds` keeps this from reaching across a `conj` into a sibling coordinated
    // predicate (e.g. "nonlinear" must not swallow "is controlled by soil moisture").
    const complementTokens = collectConstituentTokens(frame.headToken, byHead, tokens, boundaryIds, COPULAR_HEAD_STOP_DEPS)
    complement = spanFromTokens(text, complementTokens)
  } else {
    if (frame.objToken) {
      object = spanFromTokens(text, collectConstituentTokens(frame.objToken, byHead, tokens, boundaryIds))
      const postnominal = findPostnominalComplementToken(frame.objToken, byHead)
      if (postnominal) complement = spanFromTokens(text, collectConstituentTokens(postnominal, byHead, tokens, boundaryIds))
    }
    if (frame.iobjToken) {
      indirectObject = spanFromTokens(text, collectConstituentTokens(frame.iobjToken, byHead, tokens, boundaryIds))
    }
    if (frame.ccompToken) {
      // Whole clausal complement is the object, as a single grounded span (section 6/10):
      // find that clause's own predicate-frame span extent via its full token subtree.
      const ccompTokens = collectFullSubtree(frame.ccompToken, byHead)
      object = spanFromTokens(text, ccompTokens)
    }
    if (frame.xcompToken && !object) {
      // xcomp -> complement only when the open complement's own head is a predicative
      // adjective/noun (lexical linking verb / object-complement small clause). A VERB-headed
      // xcomp ("began to run") is a different, non-5-pattern construction and is left unmapped.
      const xUpos = frame.xcompToken.upos
      if (xUpos === 'ADJ' || xUpos === 'NOUN' || xUpos === 'PROPN') {
        complement = spanFromTokens(text, collectConstituentTokens(frame.xcompToken, byHead, tokens, boundaryIds))
      }
    } else if (frame.xcompToken && object) {
      const xUpos = frame.xcompToken.upos
      if (xUpos === 'ADJ' || xUpos === 'NOUN' || xUpos === 'PROPN') {
        complement = spanFromTokens(text, collectConstituentTokens(frame.xcompToken, byHead, tokens, boundaryIds))
      }
    }
  }

  if (object && isCitationLike(object)) object = null
  if (complement && isCitationLike(complement)) complement = null

  const pattern = derivePattern({ verb, indirectObject, object, complement })
  return {
    predicateCoreId: `predicate-${frame.predicateId}`,
    relation: frame.relation,
    connector: null, // filled in by caller once ordering within the clause is known
    verb,
    indirectObject,
    object,
    complement,
    pattern,
  }
}

function collectFullSubtree(head: ParsedToken, byHead: Map<number, ParsedToken[]>): ParsedToken[] {
  const out: ParsedToken[] = []
  const stack = [head]
  const seen = new Set<number>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current.id)) continue
    seen.add(current.id)
    out.push(current)
    for (const child of byHead.get(current.id) ?? []) stack.push(child)
  }
  return out
}

function connectorSpan(text: string, start: number, end: number): Span | null {
  const gap = text.slice(start, end)
  const match = Array.from(gap.matchAll(/\b(and|or|but|nor|yet|while|whereas)\b/gi)).at(-1)
  if (!match || match.index === undefined) return null
  const absoluteStart = start + match.index
  return { text: match[0], start: absoluteStart, end: absoluteStart + match[0].length }
}

// ============================================================================
// Whole-sentence assembly: main clause only feeds SentenceCoreSet.predicateCores
// ============================================================================

interface HierarchicalResult {
  subject: Span | null
  predicateCores: CoreOut[]
  clauses: ClauseFrame[]
}

export function buildHierarchical(item: GeneralizationCase, parsed: ParsedCase): HierarchicalResult {
  const tokens: ParsedToken[] = parsed.tokens.map((t, idx) => ({ ...t, id: t.id ?? idx + 1 }))
  const byHead = childrenByHead(tokens)
  const byId = new Map(tokens.map((t) => [t.id, t]))

  const clauses = buildClauseFrames(item.text, tokens, byHead)
  const clauseById = new Map(clauses.map((c) => [c.clauseId, c]))
  const mainClause = clauses.find((c) => c.relation === 'main')

  if (!mainClause) return { subject: null, predicateCores: [], clauses }

  // A constituent span (subject, object, complement, ...) must never reach across `conj` into a
  // *sibling coordinated predicate of the same clause* -- that sibling is already its own
  // PredicateFrame. This is deliberately scoped to same-clause siblings only (not every clause
  // head sentence-wide): a restrictive acl/acl:relcl postmodifier is its own ClauseFrame too, but
  // it must still be absorbable into the subject/object NP it restrictively modifies (section 8),
  // so it is not a boundary here.
  const siblingBoundaryIds = new Set<number>(mainClause.predicateHeadIds)

  const mainSubjToken = (byHead.get(mainClause.headTokenId) ?? []).find(
    (c) => normalizeDep(c.deprel) === 'nsubj' || normalizeDep(c.deprel) === 'csubj',
  ) ?? null
  const subject = mainSubjToken ? spanFromTokens(item.text, collectConstituentTokens(mainSubjToken, byHead, tokens, siblingBoundaryIds)) : null

  const predicateCores: CoreOut[] = []
  let previousVerbEnd = 0
  mainClause.predicateHeadIds.forEach((headId, idx) => {
    const headToken = byId.get(headId)!
    const frame = buildPredicateFrame(headToken, mainClause, byHead, idx === 0)
    const core = convertPredicateFrame(frame, item.text, tokens, byHead, clauseById, siblingBoundaryIds)
    core.connector = idx === 0 ? null : connectorSpan(item.text, previousVerbEnd, core.verb ? core.verb.start : item.text.length)
    predicateCores.push(core)
    if (core.verb) previousVerbEnd = core.verb.end
  })

  return { subject, predicateCores, clauses }
}
