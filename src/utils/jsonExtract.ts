/**
 * Some models wrap JSON output in markdown code fences or add stray prose
 * even when instructed not to. This strips fences and takes the outermost
 * {...} block before handing the text to JSON.parse.
 */
export function extractJsonText(raw: string): string {
  const withoutFences = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  const firstBrace = withoutFences.indexOf('{')
  const lastBrace = withoutFences.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return withoutFences
  }
  return withoutFences.slice(firstBrace, lastBrace + 1)
}

export function tryParseJson(raw: string): { value: unknown } | { error: string } {
  const text = extractJsonText(raw)
  try {
    return { value: JSON.parse(text) as unknown }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
