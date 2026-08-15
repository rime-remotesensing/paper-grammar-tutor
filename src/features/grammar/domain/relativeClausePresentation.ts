/**
 * Prototype 2.3M — CONSERVATIVE, presentation-only relative-clause detection. Never adds a
 * new LLM call, never changes GrammarAnalysis/PredicateStructure/Hybrid merger semantics —
 * item 17 of the 2.3M order. Two complementary, deliberately narrow mechanisms, both
 * requiring "structural relationship + grounded source span" (item 19), never a bare
 * string match on "that" alone (item 15's explicit warning: content-clause "that" —
 * "The study showed THAT temperature increased." — must never be mislabeled a relative
 * pronoun):
 *
 * 1. startsWithRelativePronoun() — for a node that is ALREADY a separate, independently
 *    grounded child in the structure (e.g. a subjectModifier or a dependent's own child),
 *    checks whether its own text begins with a relative pronoun. This is the safest case:
 *    the structural nesting already exists in the grounded data (Prototype 2.3M item
 *    16 diagnosis: the "who discovered the compound" subjectModifier case, and ~75% of
 *    sampled runs for the target's "those aspects" -> "that have changed..." child).
 *
 * 2. parseRelativeClauseSuffix() — for a SINGLE flat grounded span that was not split into
 *    a separate child at all (Prototype 2.3M item 16 diagnosis found this for
 *    subject-attached relative clauses specifically, e.g. effectiveCore.subject =
 *    "The aspects that have changed" — PredicateStructure never breaks this out, but the
 *    always-reliable effectiveCore.subject text still carries it intact), conservatively
 *    looks for a relative-pronoun word appearing strictly AFTER at least one real content
 *    word (never as the very first word — that would risk matching a demonstrative "that"
 *    at the start of a fragment) and splits the text there for display only. Verified safe
 *    against the content-that negative control (its grounded object span, "temperature
 *    increased", contains no relative-pronoun word at all — nothing to split).
 *
 * Known residual limitation (documented, not solved this round): a flat span like "the
 * chamber that day" (a demonstrative "that", not a relative pronoun) would still trip
 * parseRelativeClauseSuffix() if it ever appeared as a subject/object span — this is a
 * position heuristic, not full syntactic parsing. Scoped narrowly (only applied to
 * subject/antecedent-like text, never to arbitrary sentence fragments) to keep this risk
 * low; not eliminated. Precision is prioritized over recall throughout, matching
 * coordinationListParser.ts's (Prototype 2.3D) established conservatism.
 */

const RELATIVE_PRONOUNS = new Set(['that', 'which', 'who', 'whom', 'whose'])

function bareWord(word: string): string {
  return word.replace(/[.,;:]+$/, '').toLowerCase()
}

/** True when `text` begins with a relative pronoun as its very first word — the safe,
 * purely-structural case (item 16's "who discovered..." subjectModifier). */
export function startsWithRelativePronoun(text: string): boolean {
  const [firstWord] = text.trim().split(/\s+/)
  return firstWord !== undefined && RELATIVE_PRONOUNS.has(bareWord(firstWord))
}

export interface RelativeClauseSplit {
  antecedentText: string
  relativeClauseText: string
  relativePronoun: string
}

/**
 * Conservative suffix split for a flat span that mixes an antecedent noun phrase with its
 * own relative clause (item 19/32). Returns null (no split) when:
 * - no relative-pronoun word appears at all (content-that's ungrounded object, e.g.
 *   "temperature increased", safely never matches — item 30's negative control), or
 * - the relative-pronoun word IS the first word (that would be a content-clause /
 *   demonstrative-fragment shape, not "NP + relative clause"), or
 * - more than one relative-pronoun-like word appears (ambiguous — item 15: don't guess), or
 * - nothing follows the pronoun (a bare trailing pronoun cannot be a complete relative
 *   clause — it needs its own verb).
 */
export function parseRelativeClauseSuffix(text: string): RelativeClauseSplit | null {
  const words = text.trim().split(/\s+/)
  const matchIndices: number[] = []
  for (let i = 1; i < words.length - 1; i++) {
    if (RELATIVE_PRONOUNS.has(bareWord(words[i]))) matchIndices.push(i)
  }
  if (matchIndices.length !== 1) return null

  const [index] = matchIndices
  const antecedentText = words.slice(0, index).join(' ')
  const relativeClauseText = words.slice(index).join(' ')
  if (!antecedentText || !relativeClauseText) return null

  return { antecedentText, relativeClauseText, relativePronoun: bareWord(words[index]) }
}
