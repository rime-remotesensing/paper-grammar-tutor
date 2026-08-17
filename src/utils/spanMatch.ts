export interface RawSpan {
  text: string
  start: number
  end: number
}

export interface ResolvedSpan extends RawSpan {
  /** False when the app could not locate `text` inside the source sentence at all. */
  resolved: boolean
  /** True when start/end had to be corrected because the model's offsets were wrong. */
  corrected: boolean
}

/**
 * LLMs are unreliable at counting characters, so start/end offsets they report
 * cannot be trusted directly. This re-locates `candidate.text` inside `fullText`
 * and derives verified offsets, falling back to a whitespace-insensitive search
 * before giving up and flagging the span as unresolved.
 */
export function resolveSpan(fullText: string, candidate: RawSpan): ResolvedSpan {
  const text = candidate.text

  if (
    candidate.start >= 0 &&
    candidate.end > candidate.start &&
    candidate.end <= fullText.length &&
    fullText.slice(candidate.start, candidate.end) === text
  ) {
    return { text, start: candidate.start, end: candidate.end, resolved: true, corrected: false }
  }

  const exactIndex = fullText.indexOf(text)
  if (exactIndex !== -1) {
    return {
      text,
      start: exactIndex,
      end: exactIndex + text.length,
      resolved: true,
      corrected: true,
    }
  }

  const fuzzy = findWhitespaceInsensitive(fullText, text)
  if (fuzzy) {
    return { ...fuzzy, resolved: true, corrected: true }
  }

  return { text, start: -1, end: -1, resolved: false, corrected: false }
}

/** Resolves an exact substring at or after a known source position. Ordered LLM lists use
 * this so repeated text binds to successive occurrences, never silently to the first one. */
export function resolveSpanAfter(fullText: string, text: string, minStart: number): ResolvedSpan {
  const boundedStart = Math.max(0, minStart)
  const exactIndex = fullText.indexOf(text, boundedStart)
  if (exactIndex !== -1) {
    return { text, start: exactIndex, end: exactIndex + text.length, resolved: true, corrected: true }
  }

  const fuzzy = findWhitespaceInsensitive(fullText.slice(boundedStart), text)
  if (fuzzy) {
    return {
      text: fuzzy.text,
      start: boundedStart + fuzzy.start,
      end: boundedStart + fuzzy.end,
      resolved: true,
      corrected: true,
    }
  }

  return { text, start: -1, end: -1, resolved: false, corrected: false }
}

function findWhitespaceInsensitive(fullText: string, needle: string): RawSpan | null {
  const normalizedNeedle = needle.trim().replace(/\s+/g, ' ')
  if (normalizedNeedle.length === 0) return null

  const pattern = normalizedNeedle
    .split(' ')
    .map(escapeRegExp)
    .join('\\s+')

  const match = new RegExp(pattern).exec(fullText)
  if (!match) return null

  return { text: match[0], start: match.index, end: match.index + match[0].length }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
