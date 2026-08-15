/**
 * Prototype 2.3O item 16/17: a cheap, word-boundary-aware surface check used ONLY to decide
 * whether the Focused Relative-Link Analyzer is worth calling at all -- item 29 of Prototype
 * 2.3M established the same principle for a different gate ("thatがsourceにある -> callして
 * よい、というだけ -- thatがrelativeであることをregexだけで確定しない"). This function is
 * NEVER relative-clause authority; it only decides whether to spend an LLM call. Whether a
 * `that` found here is actually a relative pronoun or a content-clause complementizer is
 * entirely the analyzer's (and downstream mechanical grounding's) job.
 *
 * Word-boundary matching (`\b`) avoids triggering on a substring inside an unrelated word
 * (e.g. "somewhat" must not trigger on "what"; not a concern for that/which/who specifically,
 * but the \b discipline is kept for robustness/clarity per item 17).
 */
const RELATIVE_LINK_TRIGGER_PATTERN = /\b(that|which|who)\b/i

export function shouldCallFocusedRelativeLink(originalText: string): boolean {
  return RELATIVE_LINK_TRIGGER_PATTERN.test(originalText)
}
