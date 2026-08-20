/**
 * Prototype 2.6G2.8A/8B — display-equation shielding for the Stanza-facing analysis text.
 *
 * Audit finding (2.8A): a display-equation placeholder ("[EQUATION_5]", produced only from a
 * genuinely block-level display equation -- see equationPlaceholder.ts /
 * services/pymupdf_layout/main.py's `_equation_display_token`, never inferred from ambiguous
 * inline text) survived, UNCHANGED, all the way into the raw string handed to the local
 * Stanza service. Live-verified against the running Stanza service: "[EQUATION_5]" tokenizes
 * as an ordinary PROPN and attaches as a normal `dep` child of the sentence's root verb -- an
 * ordinary grammatical constituent, exactly the corrupted Tree the user reported.
 *
 * 2.8B correction: 2.8A's first fix treated EVERY display equation as an automatic sentence
 * boundary (drop everything after the first one). A second live case proved this wrong -- a
 * display equation frequently sits INSIDE one continuing sentence ("...intercept (a) [式 (8)]
 * and is introduced ... as an additive term [式 (9)]"), and dropping "and is introduced..."
 * lost real, intended content. A display equation is non-voting (it never becomes a normal
 * grammatical constituent) but is NOT inherently a sentence terminator.
 *
 * This module now handles EVERY equation placeholder occurrence, in order, and for each one
 * independently decides:
 *
 *  1. Whether the clause immediately preceding it needs a grammatical placeholder at all.
 *     Most of the time it does not -- the display equation is dropped entirely and the
 *     surrounding prose is joined directly ("...intercept (a) and is introduced...", never
 *     "...intercept (a) the formula and is introduced..."). The one exception (item 12/16):
 *     the equation is the object of a closed-class preposition with nothing else to govern
 *     ("...as [EQUATION_5]" with nothing else in the clause) -- there, and ONLY there, a
 *     neutral surrogate ("the formula", live-verified against Stanza to parse as a plain,
 *     inert oblique NP) replaces it so the clause stays grammatical. This surrogate is
 *     INTERNAL to the analysis text only -- App.tsx never shows it in the user-facing "英文"
 *     panel (see sourceSentenceHighlight.ts's source-text-based highlighting), satisfying
 *     item 16's "must remain INTERNAL" requirement.
 *  2. Whether the sentence continues past this equation, or the equation is this sentence's
 *     own true end. Per item 14/15, provenance is preferred but the current PDF-selection API
 *     does not yet expose the layout service's own internal PROSE/DISPLAY_EQUATION/PROSE
 *     segment boundaries (audited in 2.8A -- the segments exist server-side but are flattened
 *     before the response leaves the service; extending that API is a larger, separately
 *     justified change, not made here to avoid destabilizing the already-extensively-tuned
 *     reconstruction service without live testing against a real fixture). Absent that
 *     provenance, this module uses one minimal, GENERAL (never a literal-phrase/keyword)
 *     linguistic signal: capitalization of the first letter immediately following the
 *     equation. A lowercase start (an ordinary running clause -- "and is introduced...")
 *     continues the sentence; an uppercase start (a fresh sentence-initial capital -- "In the
 *     case of...") or no following text at all is treated, conservatively, as this sentence's
 *     own end (item 15: abstain toward separation rather than risk fabricating one giant
 *     merged sentence). This single rule, driven purely by the general grammatical fact that
 *     English sentences begin with a capital letter, correctly discriminates both live cases
 *     without matching any specific word or sentence.
 */

import { appendSynthetic, collapseInternalSpaces, trimProjection, type Projection } from './textProjection.ts'

const DISPLAY_EQUATION_PATTERN = /\[EQUATION(?:_\d{1,3})?\]/g

/** Live-verified (2.8A audit) against the actual Stanza service: parses as a plain two-token
 * NP (DET + NOUN), attaching as an ordinary oblique/object argument with no spurious clause
 * structure. Used ONLY when the immediately preceding word is a closed-class preposition with
 * nothing else in the clause to govern -- never shown in the user-facing source display. */
const EQUATION_SURROGATE = 'the formula'

/** A closed, general grammatical class (not tied to any specific sentence/example) -- when a
 * display equation is the only thing following one of these, removing it entirely would leave
 * a dangling preposition with no object at all. */
const DANGLING_PREPOSITIONS = new Set(['as', 'of', 'in', 'by', 'with', 'from', 'to', 'on', 'at', 'for'])

function endsWithDanglingPreposition(before: string): boolean {
  const match = /([A-Za-z]+)\s*$/.exec(before)
  if (!match) return false
  return DANGLING_PREPOSITIONS.has(match[1].toLowerCase())
}

/** General capitalization signal (item 14/15): never inspects specific words. Abstains
 * (returns false -- treat as a boundary) whenever nothing follows, or the first character
 * isn't a letter at all (a digit, symbol, or quote -- never guess past those). */
function looksLikeSentenceContinuation(after: string): boolean {
  const trimmed = after.trimStart()
  if (trimmed.length === 0) return false
  const first = trimmed[0]
  if (!/[A-Za-z]/.test(first)) return false
  return first === first.toLowerCase() && first !== first.toUpperCase()
}

function finalizeShieldedText(text: string): string {
  const collapsed = text.replace(/[ \t]{2,}/g, ' ').trim()
  if (collapsed.length === 0) return collapsed
  return /[.!?]$/.test(collapsed) ? collapsed : `${collapsed}.`
}

/**
 * Processes every display-equation placeholder in `text` in order (see module doc comment).
 * A no-op when no placeholder is present.
 */
export function shieldDisplayEquationsForAnalysis(text: string): string {
  DISPLAY_EQUATION_PATTERN.lastIndex = 0
  let result = ''
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = DISPLAY_EQUATION_PATTERN.exec(text)) !== null) {
    const before = text.slice(cursor, match.index)
    const after = text.slice(match.index + match[0].length)
    result += before
    if (endsWithDanglingPreposition(before)) {
      result += result.endsWith(' ') || before.length === 0 ? EQUATION_SURROGATE : ` ${EQUATION_SURROGATE}`
    }
    cursor = match.index + match[0].length

    if (!looksLikeSentenceContinuation(after)) {
      return finalizeShieldedText(result)
    }
  }

  result += text.slice(cursor)
  return finalizeShieldedText(result)
}

/** Projection equivalent of `finalizeShieldedText`: collapses runs of spaces/tabs, trims, and
 * ensures a terminal sentence-ending punctuation mark -- the appended "." (when needed) is
 * synthetic, since it never appears at that position in the source. */
function finalizeShieldedProjection(input: Projection): Projection {
  const collapsed = trimProjection(collapseInternalSpaces(input))
  if (collapsed.text.length === 0) return collapsed
  return /[.!?]$/.test(collapsed.text) ? collapsed : appendSynthetic(collapsed, '.')
}

/**
 * Prototype 2.6G2.8E — `Projection`-carrying twin of `shieldDisplayEquationsForAnalysis`,
 * mirroring its exact same per-occurrence loop (dangling-preposition surrogate insertion,
 * capitalization-based continuation/boundary decision, finalization) so the two can never
 * drift apart. The surrogate text ("the formula") and any appended closing period are always
 * synthetic (no literal source origin) -- neither may ever be highlighted as source text.
 */
export function shieldDisplayEquationsInProjection(input: Projection): Projection {
  DISPLAY_EQUATION_PATTERN.lastIndex = 0
  let resultText = ''
  const resultSourceIndexOf: (number | null)[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  const appendCopied = (start: number, end: number) => {
    resultText += input.text.slice(start, end)
    for (let i = start; i < end; i++) resultSourceIndexOf.push(input.sourceIndexOf[i])
  }
  const appendSyntheticText = (value: string) => {
    resultText += value
    for (let i = 0; i < value.length; i++) resultSourceIndexOf.push(null)
  }

  while ((match = DISPLAY_EQUATION_PATTERN.exec(input.text)) !== null) {
    const before = input.text.slice(cursor, match.index)
    const after = input.text.slice(match.index + match[0].length)
    appendCopied(cursor, match.index)
    if (endsWithDanglingPreposition(before)) {
      appendSyntheticText(resultText.endsWith(' ') || before.length === 0 ? EQUATION_SURROGATE : ` ${EQUATION_SURROGATE}`)
    }
    cursor = match.index + match[0].length

    if (!looksLikeSentenceContinuation(after)) {
      return finalizeShieldedProjection({ text: resultText, sourceIndexOf: resultSourceIndexOf })
    }
  }

  appendCopied(cursor, input.text.length)
  return finalizeShieldedProjection({ text: resultText, sourceIndexOf: resultSourceIndexOf })
}
