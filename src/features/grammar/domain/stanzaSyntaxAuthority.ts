import type { PredicateCore, PredicateCoreRelation, SentenceCoreSet, SentencePattern, Span } from '../schemas/grammarAnalysis.schema.ts'
import { derivePattern } from './derivePattern.ts'

/**
 * Prototype 2.6G1 -- production hierarchical Stanza syntax authority.
 *
 * Ported from the frozen benchmark hierarchical adapter (Prototype 2.6F,
 * commit da6cb57ec1dc3ccf4de3602f856bc6cdd11600ca,
 * benchmark/generalization/stanzaHierarchicalAdapterEval.ts). Behavioral parity
 * with that frozen module is a hard requirement, verified by
 * tests/grammar/stanzaSyntaxAuthorityParity.test.ts against the 96-sentence
 * frozen regression corpus (development 48 + former holdout 24 +
 * BLIND_HOLDOUT_V2 24). Do not change the conversion logic below without
 * re-running that parity test and understanding exactly what moved.
 *
 * Pipeline: Stanza dependency tokens -> ClauseFrame tree -> PredicateFrame per
 * clause -> SentenceCoreSet (Paper Grammar Tutor S/V/O/C).
 *
 * This module owns NO network/IO -- it is a pure function of
 * (text, StanzaToken[]). The HTTP call to the local Stanza service lives in
 * stanzaSyntaxClient.ts.
 */

export interface StanzaToken {
  id: number
  text: string
  lemma: string | null
  upos: string | null
  head: number
  deprel: string
  start: number
  end: number
}

export function normalizeDep(dep: string): string {
  return dep.split(':')[0] ?? dep
}

export function childrenByHead(tokens: StanzaToken[]): Map<number, StanzaToken[]> {
  const byHead = new Map<number, StanzaToken[]>()
  for (const token of tokens) {
    if (!byHead.has(token.head)) byHead.set(token.head, [])
    byHead.get(token.head)!.push(token)
  }
  return byHead
}

// ----------------------------------------------------------------------------
// Balanced-delimiter span construction. A span is built from [min(start),
// max(end)] over its selected tokens, then *extended* (never truncated) so
// any opening delimiter left dangling at the edge gets its matching closer --
// generic bracket-matching over ( ) [ ] { }, not tied to any literal string
// (e.g. the CJK equation placeholder "[式 (7)]" must keep its closing "]").
// ----------------------------------------------------------------------------
const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

function balanceDelimiters(text: string, start: number, end: number): { start: number; end: number } {
  let e = end
  for (let guard = 0; guard < 8; guard++) {
    const slice = text.slice(start, e)
    const stack: string[] = []
    for (const ch of slice) {
      if (OPENERS[ch]) stack.push(OPENERS[ch])
      else if (CLOSERS[ch] && stack.length > 0 && stack[stack.length - 1] === ch) stack.pop()
    }
    if (stack.length === 0) break
    const want = stack[stack.length - 1]!
    const found = text.indexOf(want, e)
    if (found >= 0 && found - e < 6) {
      e = found + 1
      continue
    }
    break
  }
  return { start, end: e }
}

export function spanFromTokens(text: string, tokens: StanzaToken[]): Span | null {
  if (tokens.length === 0) return null
  const ordered = [...tokens].sort((a, b) => a.start - b.start)
  const rawStart = ordered[0]!.start
  const rawEnd = ordered.at(-1)!.end
  const { start, end } = balanceDelimiters(text, rawStart, rawEnd)
  return { text: text.slice(start, end), start, end }
}

export function hasCommaBetween(tokens: StanzaToken[], start: number, end: number): boolean {
  return tokens.some((token) => token.text === ',' && token.start >= start && token.start < end)
}

// ----------------------------------------------------------------------------
// Canonical-constituent token selection. Allowlist of NP/PP-internal
// relations that stay inside a constituent (subject, object, complement)
// headed by `head`. Non-restrictive appositives/parataxis are always
// excluded; acl/advcl are excluded only when comma-delimited (i.e.
// non-restrictive) -- restrictive postmodifiers stay in the constituent.
// Postnominal amod is excluded (it signals an object-complement small
// clause) and left for the caller to reattach as complement.
// ----------------------------------------------------------------------------
// `appos` is deliberately NOT listed here -- it gets its own three-way comma/PP-aware check
// where it's used (see the dedicated `dep === 'appos'` branch below).
const ALWAYS_NONRESTRICTIVE = new Set(['parataxis'])
const RESTRICTIVE_GATED = new Set(['acl', 'advcl'])
const EMPTY_ID_SET: ReadonlySet<number> = new Set()
const EMPTY_DEP_SET: ReadonlySet<string> = new Set()
const COPULAR_HEAD_STOP_DEPS: ReadonlySet<string> = new Set(['nsubj', 'csubj', 'cop'])

export function collectConstituentTokens(
  head: StanzaToken,
  byHead: Map<number, StanzaToken[]>,
  allTokens: StanzaToken[],
  boundaryIds: ReadonlySet<number> = EMPTY_ID_SET,
  stopDeps: ReadonlySet<string> = EMPTY_DEP_SET,
): StanzaToken[] {
  const out: StanzaToken[] = []
  const stack: StanzaToken[] = [head]
  const seen = new Set<number>()

  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current.id)) continue
    // Never swallow a token that is itself a sibling coordinated predicate head of the same
    // clause -- that sibling is already its own PredicateFrame (e.g. a copular complement must
    // not reach across `conj` into "is controlled by soil moisture").
    if (current.id !== head.id && boundaryIds.has(current.id)) continue
    seen.add(current.id)
    out.push(current)

    for (const child of byHead.get(current.id) ?? []) {
      const dep = normalizeDep(child.deprel)
      if (dep === 'punct') continue // balanced-delimiter pass reattaches closers/openers afterwards
      // Prototype 2.6G2.5C: `stopDeps` (e.g. COPULAR_HEAD_STOP_DEPS excluding the MAIN
      // clause's own nsubj/csubj/cop from a copular complement's grounding) must only apply
      // to `head`'s own DIRECT children -- not to every descendant at any depth. A restrictive
      // relative clause nested inside the constituent (e.g. "an approach that scales well")
      // has its OWN internal `nsubj` ("that", subject of "scales") that has nothing to do
      // with the outer clause boundary stopDeps exists to enforce; stopping it too used to be
      // silently masked by the old contiguous-min/max span (the excluded "that" sat between
      // two otherwise-selected tokens and was reintroduced anyway) -- now that spans are
      // correctly restricted to the selected tokens' own contiguous island, an
      // over-broadly-stopped deep token would wrongly fracture that island. Scoping the stop
      // to direct children only is what `stopDeps` was always semantically meant to express.
      if (current.id === head.id && stopDeps.has(dep)) continue
      // `appos` needs its own three-way check (not a plain ALWAYS_NONRESTRICTIVE/
      // RESTRICTIVE_GATED member), defaulting to EXCLUDED (a bare appositive is a non-
      // restrictive aside by default -- this also covers a colon-introduced enumeration list,
      // which UD sometimes attaches as `appos` too and must stay excluded from canonical O/C,
      // matching the Tree layer's own separate enumeration-recovery mechanism), with two
      // narrow, dependency/punctuation-structural KEEP exceptions: (1) it itself has a `case`
      // child, meaning Stanza attached what is structurally a PP (e.g. "term in [式 (7)]") as
      // `appos` instead of `nmod` -- a PP headed this way is kept, like any `nmod`; (2)
      // Prototype 2.6G2.5C2 -- it is wrapped in its OWN direct balanced-parenthesis punct
      // children (a literal "(" and ")" attached to the appositive token itself, e.g. "factor
      // (VIF)") -- a tightly-bound, DEFINING parenthetical abbreviation, structurally distinct
      // from both a floating comma-set-off aside and a colon-introduced list (neither of which
      // has its own paren-wrapping). Comma presence/absence was tried and rejected as the
      // distinguishing signal: a colon-enumeration appositive also has no comma before it, so
      // a comma-only gate wrongly kept it too (live-audited regression, reverted).
      if (dep === 'appos') {
        const apposChildren = byHead.get(child.id) ?? []
        const isPpObject = apposChildren.some((gc) => normalizeDep(gc.deprel) === 'case')
        const isParenWrappedAbbreviation = apposChildren.some((gc) => gc.text === '(') && apposChildren.some((gc) => gc.text === ')')
        if (!isPpObject && !isParenWrappedAbbreviation) continue
      } else if (ALWAYS_NONRESTRICTIVE.has(dep)) {
        continue
      }
      if (RESTRICTIVE_GATED.has(dep) && hasCommaBetween(allTokens, current.end, child.start)) continue
      if (dep === 'amod' && child.start > current.end) continue // postnominal -> complement candidate
      stack.push(child)
    }
  }
  return out
}

export function findPostnominalComplementToken(head: StanzaToken, byHead: Map<number, StanzaToken[]>): StanzaToken | null {
  const children = byHead.get(head.id) ?? []
  return children.filter((c) => normalizeDep(c.deprel) === 'amod' && c.start > head.end).sort((a, b) => a.start - b.start)[0] ?? null
}

// ============================================================================
// ClauseFrame layer
// ============================================================================

export type ClauseRelation = 'main' | 'subordinate' | 'coordinated' | 'relative' | 'other'

export interface ClauseFrame {
  clauseId: number
  relation: ClauseRelation
  headTokenId: number
  parentClauseId: number | null
  /** This clause's own `mark` child token, if any (subordinating conjunction/complementizer). */
  marker: StanzaToken | null
  /** This clause's own predicate head token id, plus its pure-`conj` coordination chain. */
  predicateHeadIds: number[]
}

// Deprels that start a genuinely new clause. `xcomp` is deliberately excluded: an xcomp has no
// subject of its own in UD and is folded into the governing PredicateFrame instead. `ccomp` is
// a finite clause with its own subject but, for S/V/O/C purposes, is folded back into the
// governing predicate's object slot as one whole span rather than exploded into a further
// S/V/O -- it is still registered as its own clause so its internal coordination stays scoped.
const CLAUSE_STARTING_DEPRELS = new Set(['root', 'advcl', 'acl', 'ccomp', 'csubj', 'parataxis'])

function classifyClauseRelation(headToken: StanzaToken): ClauseRelation {
  const dep = headToken.deprel // keep subtype (acl:relcl) for this decision
  if (normalizeDep(dep) === 'root') return 'main'
  if (dep === 'acl:relcl') return 'relative'
  if (normalizeDep(dep) === 'advcl') return 'subordinate'
  return 'other'
}

/** Walk up the head-chain from `token` until reaching a registered clause head, following only
 * `conj` links. Returns null if the chain leaves pure coordination. */
function anchorClauseHead(token: StanzaToken, byId: Map<number, StanzaToken>, clauseHeadIds: Set<number>): StanzaToken | null {
  let current: StanzaToken | undefined = token
  let guard = 0
  while (current && guard < 64) {
    if (clauseHeadIds.has(current.id)) return current
    if (normalizeDep(current.deprel) !== 'conj') return null
    current = byId.get(current.head)
    guard += 1
  }
  return null
}

export function isPredicateLikeToken(token: StanzaToken, byHead: Map<number, StanzaToken[]>): boolean {
  if (token.upos === 'VERB' || token.upos === 'AUX') return true
  // copular root: lexical ADJ/NOUN/PROPN head with an overt `cop` child (e.g. "X is effective")
  if (token.upos === 'ADJ' || token.upos === 'NOUN' || token.upos === 'PROPN') {
    return (byHead.get(token.id) ?? []).some((c) => normalizeDep(c.deprel) === 'cop')
  }
  return false
}

export function buildClauseFrames(text: string, tokens: StanzaToken[], byHead: Map<number, StanzaToken[]>): ClauseFrame[] {
  const byId = new Map(tokens.map((t) => [t.id, t]))

  const clauseHeadTokens = tokens.filter((t) => CLAUSE_STARTING_DEPRELS.has(normalizeDep(t.deprel)) && isPredicateLikeToken(t, byHead))
  const clauseHeadIds = new Set(clauseHeadTokens.map((t) => t.id))

  // predicateHeadIds: the clause head itself plus every token reachable via a pure `conj` chain
  // (coordinated predicates of the SAME clause). Recursion stops the moment a candidate's own
  // deprel is itself clause-starting -- that candidate becomes its own clause instead. A `conj`
  // reached across a semicolon is excluded even when it attaches directly to the clause head: a
  // semicolon-separated conjunct is a colon-introduced enumeration item, not a further
  // coordinated action of the clause's own subject (punctuation is the only general signal UD
  // gives for this distinction).
  function collectCoordinatedPredicates(head: StanzaToken): number[] {
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

  return clauseHeadTokens
    .sort((a, b) => a.start - b.start)
    .map((headToken) => {
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
}

// ============================================================================
// PredicateFrame layer
// ============================================================================

export interface PredicateFrame {
  predicateId: number
  clauseId: number
  relation: PredicateCoreRelation
  headToken: StanzaToken
  aux: StanzaToken[]
  auxPass: StanzaToken[]
  cop: StanzaToken[]
  subjToken: StanzaToken | null
  objToken: StanzaToken | null
  iobjToken: StanzaToken | null
  xcompToken: StanzaToken | null
  ccompToken: StanzaToken | null
}

export function buildPredicateFrame(headToken: StanzaToken, clause: ClauseFrame, byHead: Map<number, StanzaToken[]>, isFirstInClause: boolean): PredicateFrame {
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
// PredicateFrame -> Paper Grammar Tutor S/V/O/C
// ============================================================================

export function isCitationLike(span: Span | null): boolean {
  if (!span) return false
  return /\b[A-Z][a-z]+\s+et\s+al\.|\(\s*[A-Z][a-z]+\s+et\s+al\.\s*\d{4}\s*\)/i.test(span.text) || /\(.*\d{4}.*\)/.test(span.text)
}

/**
 * Prototype 2.6G2.2 -- citation-safe constituent cleanup. The pre-existing whole-span
 * `isCitationLike` check nulled an entire O/C constituent the moment ANY citation-like text
 * appeared anywhere inside it (e.g. "very complex (Chen et al. 2015)" -> null, losing the
 * genuine complement "very complex" along with the citation). This instead walks the
 * candidate constituent's DIRECT children (within the already-collected token set -- never
 * past the constituent's own boundary) and, for each one, checks whether that child's own
 * reachable subtree forms a citation-like span on its own. A matching subtree is removed in
 * full -- dependency/token-based exclusion, never substring deletion on the rendered text, so
 * a legitimate nested parenthetical that merely happens to contain a 4-digit number elsewhere
 * in the constituent is never touched by this pass. Returns `tokens` unchanged when no child
 * subtree qualifies; a candidate that is ITSELF nothing but a citation (no other child to
 * strip from) is unaffected here and still correctly rejected by the existing whole-span
 * `isCitationLike` check that runs after this, in `convertPredicateFrame`.
 */
export function stripCitationTokens(text: string, head: StanzaToken, tokens: StanzaToken[], byHead: Map<number, StanzaToken[]>): StanzaToken[] {
  const allowedIds = new Set(tokens.map((t) => t.id))
  const removedIds = new Set<number>()
  for (const child of byHead.get(head.id) ?? []) {
    if (!allowedIds.has(child.id) || removedIds.has(child.id)) continue
    const subtree: StanzaToken[] = []
    const stack = [child]
    const seen = new Set<number>()
    while (stack.length > 0) {
      const current = stack.pop()!
      if (seen.has(current.id) || !allowedIds.has(current.id)) continue
      seen.add(current.id)
      subtree.push(current)
      for (const grandchild of byHead.get(current.id) ?? []) stack.push(grandchild)
    }
    const span = spanFromTokens(text, subtree)
    if (span && isCitationLike(span)) {
      for (const t of subtree) removedIds.add(t.id)
    }
  }
  if (removedIds.size === 0) return tokens
  return tokens.filter((t) => !removedIds.has(t.id))
}

/**
 * Prototype 2.6G2.5C -- a selected token set from `collectConstituentTokens` can be textually
 * SPARSE: some tokens strictly between its own min-start and max-end were deliberately
 * excluded (a stopped `nsubj`/`cop`, a sibling coordinated predicate boundary, a non-
 * restrictive relative clause, ...), yet `spanFromTokens` grounds a span via one CONTIGUOUS
 * min-to-max slice of the source text -- so an excluded token sitting textually between two
 * selected tokens is silently reintroduced into the final span merely because it lies inside
 * that broad range, never because it was actually selected. This was the live-diagnosed root
 * cause of a copular complement absorbing a sentence-opening `obl` adjunct ("In this study")
 * attached to the SAME root token that doubles as the complement's own grounding head: the
 * adjunct was correctly excluded from the selected set (nothing in `COPULAR_HEAD_STOP_DEPS`
 * removes it, but it was never the issue -- see below) yet resurfaced anyway once the subject
 * and copula sitting between it and the lexical complement were stopped out, breaking
 * contiguity of the *selected* set while `spanFromTokens` kept slicing across the gap.
 *
 * This finds the maximal run of tokens, in source order, that are either (a) part of the
 * selected set, (b) punctuation, or (c) a non-selected NOMINAL aside (an excluded bare
 * appositive like "(VIF)", a stripped citation, ...), and returns only the run containing
 * `head` -- the run only breaks at a genuine excluded CLAUSE-LEVEL boundary (a stopped
 * copular verb, a comma-gated non-restrictive relative clause's own verb, sibling predicate
 * material, ...), identified via `isPredicateLikeToken` -- dependency-structural, never
 * lexical/positional. Punctuation never forces a split: it is already excluded from every
 * constituent's own token selection by `collectConstituentTokens` itself, yet legitimately
 * sits between two selected tokens all the time (e.g. the hyphens in "graph-based").
 *
 * Prototype 2.6G2.5C2: a bare non-restrictive appositive/citation excluded by
 * `collectConstituentTokens`'s own policy (e.g. "(VIF)" in "the variance inflation factor
 * (VIF) and Pearson's ... methods") must still be silently BRIDGED OVER when it sits between
 * two genuinely selected tokens of the SAME constituent (the coordination's own two members)
 * -- that is the established, accepted product policy (section 8 of the phase spec), not a
 * bug. Only an excluded token that is ITSELF predicate-like (a finite verb/copula, i.e. the
 * signal that a whole separate CLAUSE -- not just a nominal aside -- sits in the gap) breaks
 * the island. This is what distinguishes the desired VIF/PCC bridging from the d34-diagnosed
 * bug (a non-restrictive relative clause's own verb, "integrates", correctly breaks the
 * island; its own excluded appositive/citation content never would have).
 */
function contiguousIslandContaining(head: StanzaToken, allTokens: StanzaToken[], selected: StanzaToken[], byHead: Map<number, StanzaToken[]>): StanzaToken[] {
  const selectedIds = new Set(selected.map((t) => t.id))
  const sorted = [...allTokens].sort((a, b) => a.start - b.start)
  let current: StanzaToken[] = []
  for (const token of sorted) {
    if (selectedIds.has(token.id)) {
      current.push(token)
      continue
    }
    if (normalizeDep(token.deprel) === 'punct') continue // punctuation never breaks an island
    if (isPredicateLikeToken(token, byHead)) {
      if (current.some((t) => t.id === head.id)) return current // head's own island just closed
      current = []
      continue
    }
    // A non-selected, non-punct, non-predicate-like token (a bare excluded appositive,
    // citation subtree, ...) is a nominal aside -- bridged over, never breaks the island.
  }
  return current
}

/** Collects a constituent's tokens, removes an embedded citation subtree (if any), and
 * restricts the result to the contiguous source-text island containing `head` (see
 * `contiguousIslandContaining`) before grounding the span -- the citation-safe, boundary-safe
 * replacement for a bare `spanFromTokens(text, collectConstituentTokens(...))` call wherever
 * an O/C/IO span is finalized. The trailing whole-span `isCitationLike` check in
 * convertPredicateFrame remains as the final safety net for a citation-only candidate
 * (nothing left to strip from). */
function groundConstituentSpan(
  head: StanzaToken,
  byHead: Map<number, StanzaToken[]>,
  allTokens: StanzaToken[],
  boundaryIds: ReadonlySet<number>,
  text: string,
  stopDeps: ReadonlySet<string> = EMPTY_DEP_SET,
): Span | null {
  const rawTokens = collectConstituentTokens(head, byHead, allTokens, boundaryIds, stopDeps)
  const cleanedTokens = stripCitationTokens(text, head, rawTokens, byHead)
  const island = contiguousIslandContaining(head, allTokens, cleanedTokens, byHead)
  return spanFromTokens(text, island.length > 0 ? island : cleanedTokens)
}

function verbSpanFor(frame: PredicateFrame, text: string): Span {
  const parts = new Map<number, StanzaToken>()
  // For a copular predicate the lexical head (e.g. "nonlinear") is the complement, not the
  // verb; the verb is the copula (+ aux) alone. For every other predicate the lexical head is
  // the verb.
  if (frame.cop.length === 0) parts.set(frame.headToken.id, frame.headToken)
  for (const t of [...frame.aux, ...frame.auxPass, ...frame.cop]) parts.set(t.id, t)
  return spanFromTokens(text, [...parts.values()])!
}

export function collectFullSubtree(head: StanzaToken, byHead: Map<number, StanzaToken[]>): StanzaToken[] {
  const out: StanzaToken[] = []
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

export function connectorSpan(text: string, start: number, end: number): Span | null {
  const gap = text.slice(start, end)
  const match = Array.from(gap.matchAll(/\b(and|or|but|nor|yet|while|whereas)\b/gi)).at(-1)
  if (!match || match.index === undefined) return null
  const absoluteStart = start + match.index
  return { text: match[0], start: absoluteStart, end: absoluteStart + match[0].length }
}

interface ConvertedCore {
  relation: PredicateCoreRelation
  connector: Span | null
  verb: Span | null
  indirectObject: Span | null
  object: Span | null
  complement: Span | null
  pattern: SentencePattern
}

export function convertPredicateFrame(
  frame: PredicateFrame,
  text: string,
  tokens: StanzaToken[],
  byHead: Map<number, StanzaToken[]>,
  boundaryIds: ReadonlySet<number>,
): ConvertedCore {
  const verb = verbSpanFor(frame, text)
  let object: Span | null = null
  let indirectObject: Span | null = null
  let complement: Span | null = null

  if (frame.cop.length > 0) {
    // Copular core: V = cop(+aux); C = the lexical head's own constituent. `boundaryIds` keeps
    // this from reaching across `conj` into a sibling coordinated predicate.
    complement = groundConstituentSpan(frame.headToken, byHead, tokens, boundaryIds, text, COPULAR_HEAD_STOP_DEPS)
  } else {
    if (frame.objToken) {
      object = groundConstituentSpan(frame.objToken, byHead, tokens, boundaryIds, text)
      const postnominal = findPostnominalComplementToken(frame.objToken, byHead)
      if (postnominal) complement = groundConstituentSpan(postnominal, byHead, tokens, boundaryIds, text)
    }
    if (frame.iobjToken) {
      indirectObject = groundConstituentSpan(frame.iobjToken, byHead, tokens, boundaryIds, text)
    }
    if (frame.ccompToken) {
      // Whole clausal complement is the object, as a single grounded span (noun-clause object).
      object = spanFromTokens(text, collectFullSubtree(frame.ccompToken, byHead))
    }
    if (frame.xcompToken) {
      // xcomp -> complement only when the open complement's own head is a predicative
      // adjective/noun (lexical linking verb / object-complement small clause). A VERB-headed
      // xcomp ("began to run") is a different, non-5-pattern construction and is left unmapped.
      const xUpos = frame.xcompToken.upos
      if (xUpos === 'ADJ' || xUpos === 'NOUN' || xUpos === 'PROPN') {
        complement = groundConstituentSpan(frame.xcompToken, byHead, tokens, boundaryIds, text)
      }
    }
  }

  if (object && isCitationLike(object)) object = null
  if (complement && isCitationLike(complement)) complement = null

  const pattern = derivePattern({ verb, indirectObject, object, complement })
  return { relation: frame.relation, connector: null, verb, indirectObject, object, complement, pattern }
}

// ============================================================================
// Whole-sentence assembly: only the main clause feeds SentenceCoreSet
// ============================================================================

export interface StanzaSyntaxResult {
  coreSet: SentenceCoreSet
  clauses: ClauseFrame[]
}

/**
 * Pure conversion: Stanza dependency tokens -> Paper Grammar Tutor SentenceCoreSet.
 * Only the main clause's own predicate-head chain (root + its pure-conj coordination)
 * ever contributes predicate cores -- a subordinate/relative/other clause's internal
 * predicates never leak into the canonical core set (subordinate predicate leakage is
 * eliminated by construction, not by post-hoc filtering).
 */
export function buildSentenceCoreSetFromStanzaTokens(text: string, rawTokens: StanzaToken[]): StanzaSyntaxResult {
  const tokens: StanzaToken[] = rawTokens
  const byHead = childrenByHead(tokens)
  const byId = new Map(tokens.map((t) => [t.id, t]))

  const clauses = buildClauseFrames(text, tokens, byHead)
  const mainClause = clauses.find((c) => c.relation === 'main')

  if (!mainClause) {
    return { coreSet: { subject: null, subjectHead: null, predicateCores: [] }, clauses }
  }

  // A constituent span must never reach across `conj` into a sibling coordinated predicate of
  // the SAME clause -- that sibling is already its own PredicateFrame. Deliberately scoped to
  // same-clause siblings only: a restrictive acl/acl:relcl postmodifier is its own ClauseFrame
  // too, but must still be absorbable into the subject/object NP it restrictively modifies.
  const siblingBoundaryIds = new Set<number>(mainClause.predicateHeadIds)

  const mainSubjToken = (byHead.get(mainClause.headTokenId) ?? []).find(
    (c) => normalizeDep(c.deprel) === 'nsubj' || normalizeDep(c.deprel) === 'csubj',
  ) ?? null
  // Prototype 2.6G2.5C2: subject grounding used to be a bare
  // `spanFromTokens(text, collectConstituentTokens(...))` call -- the exact same "sparse
  // selected tokens -> contiguous min/max source slice -> excluded material silently
  // reinserted" class 2.6G2.5C already fixed for O/C/IO grounding, just never routed through
  // the fix. Live-diagnosed on `d34-long-80`: the subject head's own non-restrictive relative
  // clause is correctly excluded by `collectConstituentTokens` (comma-gated acl:relcl), but a
  // downstream enumeration item several tokens INSIDE that excluded relative clause ("...
  // slope-unit morphology...") suffers a genuine Stanza UD coordination-attachment drift and
  // attaches its `conj` chain directly to the SUBJECT head instead of to the relative clause's
  // own object -- a real, correctly-selected (if spuriously attached) token, textually
  // stranded far past the excluded relative clause. `groundConstituentSpan`'s island
  // restriction (see its own doc comment) is exactly the general mechanism this needs: the
  // excluded relative clause tokens sitting between the subject head and the drifted
  // enumeration break the contiguous run, so only the island actually containing the subject
  // head is kept. This also gives subject the SAME citation-safe stripping O/C/IO already
  // have (`stripCitationTokens`) -- previously subject had none at all.
  const subject = mainSubjToken ? groundConstituentSpan(mainSubjToken, byHead, tokens, siblingBoundaryIds, text) : null
  const subjectHead = mainSubjToken ? spanFromTokens(text, [mainSubjToken]) : null

  const predicateCores: PredicateCore[] = []
  let previousVerbEnd = 0
  mainClause.predicateHeadIds.forEach((headId, idx) => {
    const headToken = byId.get(headId)!
    const frame = buildPredicateFrame(headToken, mainClause, byHead, idx === 0)
    const converted = convertPredicateFrame(frame, text, tokens, byHead, siblingBoundaryIds)
    const connector = idx === 0 ? null : connectorSpan(text, previousVerbEnd, converted.verb ? converted.verb.start : text.length)
    predicateCores.push({
      predicateCoreId: `predicate-${idx + 1}`,
      relation: converted.relation,
      connector,
      verb: converted.verb,
      indirectObject: converted.indirectObject,
      object: converted.object,
      complement: converted.complement,
      pattern: converted.pattern,
    })
    if (converted.verb) previousVerbEnd = converted.verb.end
  })

  return { coreSet: { subject, subjectHead, predicateCores }, clauses }
}
