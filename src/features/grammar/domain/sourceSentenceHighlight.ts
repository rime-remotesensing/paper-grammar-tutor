import type { SourceSpan } from './treeReadingMatching.ts'

export interface SourceHighlightSegments {
  before: string
  active: string | null
  after: string
}

/** Splits the normalized analysis sentence using only the active Tree node's grounded
 * coordinates. No text search is involved, so repeated phrases remain unambiguous. */
export function buildSourceHighlightSegments(
  sentence: string,
  activeSpan: SourceSpan | null,
): SourceHighlightSegments {
  if (
    activeSpan === null ||
    !Number.isInteger(activeSpan.start) ||
    !Number.isInteger(activeSpan.end) ||
    activeSpan.start < 0 ||
    activeSpan.end <= activeSpan.start ||
    activeSpan.end > sentence.length
  ) {
    return { before: sentence, active: null, after: '' }
  }

  return {
    before: sentence.slice(0, activeSpan.start),
    active: sentence.slice(activeSpan.start, activeSpan.end),
    after: sentence.slice(activeSpan.end),
  }
}
