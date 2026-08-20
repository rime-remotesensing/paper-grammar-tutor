/**
 * Prototype 2.6G2.8E — explicit source↔analysis character mapping.
 *
 * Root cause of the live mapping bug: `buildSourceHighlightSegmentsFromSourceText`
 * (2.6G2.8B) located a Tree span's text in `sourceText` via `resolveSpan`, i.e. best-effort
 * SUBSTRING SEARCH. For a one-character scientific variable ("b"), that search can — and did,
 * live — match inside a completely unrelated word ("be rotated") long before the real
 * occurrence, with no way to tell the two apart from the text alone. Substring search can
 * never be a source-of-truth mapping; it is deleted as a mapping authority in this phase
 * (kept, if at all, only as an explicitly-labeled diagnostic, never wired to the visible
 * highlight).
 *
 * A `Projection` instead carries the mapping FORWARD, character by character, through every
 * pre-Stanza transformation (citation removal, equation-placeholder normalization, display-
 * equation shielding) as each one runs — never reconstructed afterward by matching text. Each
 * character of `text` (the analysis-facing string) is tagged with the exact source-text index
 * it came from, or `null` if it has no literal source origin (synthetic — e.g. the internal
 * "the formula" surrogate, or a period scientificTextShielding.ts appends to close a
 * truncated sentence). Projecting an analysis-side span back to `sourceText` is then exact
 * index lookup, never search — see `projectAnalysisSpanToSourceSegments` in
 * sourceSentenceHighlight.ts.
 */

/** Prototype 2.6G2.8M2 — records that the synthetic analysis-text range
 * [analysisStart, analysisEnd) (e.g. an internal "MATH_EXPR" token) stands in for the
 * COMPLETE, CONTIGUOUS source range [sourceStart, sourceEnd) it replaced — unlike an
 * ordinary synthetic character (whose `sourceIndexOf` entry is simply `null`, with no
 * recoverable source origin at all, e.g. the "the formula" equation surrogate), a math-run
 * placeholder's whole original source text is still known and highlightable. Consulted by
 * `projectAnalysisSpanToSourceHighlight` (sourceSentenceHighlight.ts) before falling back to
 * per-character `sourceIndexOf` lookup, so clicking a Tree node for the placeholder
 * highlights the ENTIRE original math run in the source, not nothing. */
export interface SyntheticRunSourceRange {
  analysisStart: number
  analysisEnd: number
  sourceStart: number
  sourceEnd: number
}

export interface Projection {
  /** The analysis-facing text (what Stanza/the grammar pipeline actually parses). */
  text: string
  /** sourceIndexOf[i] is the index into the ORIGINAL sourceText that text[i] was copied
   * from, or null when text[i] has no literal source character (synthetic). Always the same
   * length as `text`. */
  sourceIndexOf: ReadonlyArray<number | null>
  /** Optional (absent for every projection step that predates Prototype 2.6G2.8M2) —
   * see `SyntheticRunSourceRange`'s own doc comment. */
  syntheticRunSourceRanges?: ReadonlyArray<SyntheticRunSourceRange>
}

/** The starting point of every projection pipeline: every character is copied verbatim from
 * itself, i.e. the identity mapping. */
export function projectionFromSource(sourceText: string): Projection {
  return { text: sourceText, sourceIndexOf: Array.from(sourceText, (_c, i) => i) }
}

/**
 * Removes every match of `pattern` (which MUST have the global flag) from the projection.
 * The removed characters' source positions become source-only from this point forward —
 * never resurrected by later steps. Mirrors `String.replace(pattern, '')` exactly, but keeps
 * `sourceIndexOf` in lockstep with the surviving characters.
 */
export function removeMatches(input: Projection, pattern: RegExp): Projection {
  if (!pattern.global) throw new Error('removeMatches requires a global regex')
  let text = ''
  const sourceIndexOf: (number | null)[] = []
  let cursor = 0
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input.text)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex++
      continue
    }
    text += input.text.slice(cursor, match.index)
    for (let i = cursor; i < match.index; i++) sourceIndexOf.push(input.sourceIndexOf[i])
    cursor = match.index + match[0].length
  }
  text += input.text.slice(cursor)
  for (let i = cursor; i < input.text.length; i++) sourceIndexOf.push(input.sourceIndexOf[i])
  return { text, sourceIndexOf }
}

/**
 * Replaces every match of `pattern` (global) with a literal `replacement` string. The
 * replacement's own characters are synthetic (no source origin) regardless of what they
 * happen to spell.
 */
export function replaceMatchesWithSynthetic(input: Projection, pattern: RegExp, replacement: string): Projection {
  if (!pattern.global) throw new Error('replaceMatchesWithSynthetic requires a global regex')
  let text = ''
  const sourceIndexOf: (number | null)[] = []
  let cursor = 0
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input.text)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex++
      continue
    }
    text += input.text.slice(cursor, match.index)
    for (let i = cursor; i < match.index; i++) sourceIndexOf.push(input.sourceIndexOf[i])
    text += replacement
    for (let _i = 0; _i < replacement.length; _i++) sourceIndexOf.push(null)
    cursor = match.index + match[0].length
  }
  text += input.text.slice(cursor)
  for (let i = cursor; i < input.text.length; i++) sourceIndexOf.push(input.sourceIndexOf[i])
  return { text, sourceIndexOf }
}

/**
 * Like `replaceMatchesWithSynthetic`, but the replacement text is computed per-match (e.g.
 * "[式 (5)]" -> "[EQUATION_5]", where the digits carry through) rather than a single fixed
 * string. The computed replacement's characters are still always synthetic (no source
 * origin) -- even when a computed replacement happens to reuse digits that also appear in
 * the source, they are a NEW literal token, not a copy of that specific source occurrence.
 */
export function replaceMatchesWithComputed(input: Projection, pattern: RegExp, computeReplacement: (match: RegExpExecArray) => string): Projection {
  if (!pattern.global) throw new Error('replaceMatchesWithComputed requires a global regex')
  let text = ''
  const sourceIndexOf: (number | null)[] = []
  let cursor = 0
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input.text)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex++
      continue
    }
    text += input.text.slice(cursor, match.index)
    for (let i = cursor; i < match.index; i++) sourceIndexOf.push(input.sourceIndexOf[i])
    const replacement = computeReplacement(match)
    text += replacement
    for (let _i = 0; _i < replacement.length; _i++) sourceIndexOf.push(null)
    cursor = match.index + match[0].length
  }
  text += input.text.slice(cursor)
  for (let i = cursor; i < input.text.length; i++) sourceIndexOf.push(input.sourceIndexOf[i])
  return { text, sourceIndexOf }
}

/** Truncates the projection to its first `end` characters (used when a downstream policy
 * decides the analysis text ends before the source text does — e.g. a display-equation
 * sentence boundary). */
export function truncateProjection(input: Projection, end: number): Projection {
  const bounded = Math.max(0, Math.min(end, input.text.length))
  return { text: input.text.slice(0, bounded), sourceIndexOf: input.sourceIndexOf.slice(0, bounded) }
}

/** Appends synthetic (source-less) text to the end of the projection -- e.g. a closing
 * period scientificTextShielding.ts adds to a truncated sentence. */
export function appendSynthetic(input: Projection, text: string): Projection {
  return { text: input.text + text, sourceIndexOf: [...input.sourceIndexOf, ...Array.from(text, () => null)] }
}

/** Removes leading/trailing whitespace, keeping `sourceIndexOf` aligned -- the projection
 * equivalent of `String.prototype.trim()`. */
export function trimProjection(input: Projection): Projection {
  const start = input.text.search(/\S/)
  if (start === -1) return { text: '', sourceIndexOf: [] }
  let end = input.text.length
  while (end > start && /\s/.test(input.text[end - 1])) end--
  return { text: input.text.slice(start, end), sourceIndexOf: input.sourceIndexOf.slice(start, end) }
}

/** Collapses every run of `[ \t]{2,}` to a single space, keeping `sourceIndexOf` aligned
 * (the surviving space keeps the FIRST character's own source index in the collapsed run,
 * matching how a human would expect "the nearest source position" to resolve). */
export function collapseInternalSpaces(input: Projection): Projection {
  let text = ''
  const sourceIndexOf: (number | null)[] = []
  let i = 0
  while (i < input.text.length) {
    const c = input.text[i]
    if (c === ' ' || c === '\t') {
      let j = i
      while (j < input.text.length && (input.text[j] === ' ' || input.text[j] === '\t')) j++
      text += ' '
      sourceIndexOf.push(input.sourceIndexOf[i])
      i = j
      continue
    }
    text += c
    sourceIndexOf.push(input.sourceIndexOf[i])
    i++
  }
  return { text, sourceIndexOf }
}

/**
 * Prototype 2.6G2.8M2 — replaces the analysis-text range that currently maps back to source
 * range [sourceStart, sourceEnd) with a synthetic `replacement` string, and records a
 * `SyntheticRunSourceRange` so the WHOLE original range stays highlightable (see that type's
 * own doc comment). `sourceStart`/`sourceEnd` are source-text indices (not positions in
 * `input.text`) — the matching analysis-text span is located by scanning `sourceIndexOf` for
 * it, so this primitive works correctly regardless of what earlier steps already ran
 * (never assumes `input` is still the identity projection). Abstains (returns `input`
 * unchanged) if the source range can no longer be found intact in `input.sourceIndexOf` —
 * e.g. an earlier step already removed part of it — rather than guessing.
 */
export function replaceRangeWithSynthetic(input: Projection, sourceStart: number, sourceEnd: number, replacement: string): Projection {
  const analysisStart = input.sourceIndexOf.findIndex((idx) => idx === sourceStart)
  if (analysisStart === -1) return input
  let analysisEnd = analysisStart
  let expected = sourceStart
  while (analysisEnd < input.sourceIndexOf.length && input.sourceIndexOf[analysisEnd] === expected && expected < sourceEnd) {
    analysisEnd++
    expected++
  }
  if (expected !== sourceEnd) return input // the source range isn't intact/contiguous here -- abstain

  const text = input.text.slice(0, analysisStart) + replacement + input.text.slice(analysisEnd)
  const sourceIndexOf: (number | null)[] = [
    ...input.sourceIndexOf.slice(0, analysisStart),
    ...Array.from(replacement, () => null),
    ...input.sourceIndexOf.slice(analysisEnd),
  ]
  const newRange: SyntheticRunSourceRange = { analysisStart, analysisEnd: analysisStart + replacement.length, sourceStart, sourceEnd }
  const syntheticRunSourceRanges = [...(input.syntheticRunSourceRanges ?? []), newRange]
  return { text, sourceIndexOf, syntheticRunSourceRanges }
}
