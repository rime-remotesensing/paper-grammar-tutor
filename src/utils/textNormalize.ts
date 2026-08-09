// Unicode space separators (category Zs) plus tab/BOM/zero-width-space,
// written as \u escapes so the source file stays plain ASCII and unambiguous.
const UNICODE_SPACE_CHARS = new RegExp(
  '[\\t\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]',
  'g',
)
const ZERO_WIDTH_CHARS = new RegExp('[\\u200B\\uFEFF]', 'g')

/**
 * Normalizes user-supplied sentence text before it is sent to the LLM.
 * Collapses exotic whitespace to plain spaces so that character offsets
 * returned by the model line up with what the app can index into.
 */
export function normalizeSentence(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(ZERO_WIDTH_CHARS, '')
    .replace(UNICODE_SPACE_CHARS, ' ')
    .trim()
}
