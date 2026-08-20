/**
 * Prototype 2.6G2.8M2 — client-side TypeScript twin of
 * `services/pymupdf_layout/main.py`'s `_detect_math_runs`/`_classify_math_token` (see that
 * module's own doc comment for the full architecture rationale). Deliberately reimplements
 * the SAME evidence-based, STRONG-evidence-only, no-phrase-dictionary algorithm rather than
 * depending on the server's own per-selection `Fragment.mathRuns` (which is computed against
 * server-side fragment-local text that has not yet passed through the client's own nuisance-
 * line filtering/whitespace normalization — reusing those offsets directly would risk silent
 * drift). Running the identical algorithm against the FINAL `sourceText` the user actually
 * submits for analysis avoids that drift entirely, at the cost of keeping two
 * implementations in sync — the same trade-off this project already accepts for the
 * Projection string/Projection-based twins elsewhere in this directory.
 *
 * Any behavioral change to the Python detector must be mirrored here (and vice versa) — see
 * tests/grammar/mathRunDetection.test.ts, which exercises the identical case matrix as
 * services/pymupdf_layout/tests/test_math_run_detection.py.
 */

export interface MathRun {
  start: number
  end: number
  text: string
}

const MATH_EVIDENCE_UNICODE_CHARS = new Set(
  Array.from('<>=≤≥≠≈±×·°_' + '¹²³⁰⁴⁵⁶⁷⁸⁹' + 'αβγδεζηθικλμνξοπρστυφχψω' + 'ΓΔΘΛΞΠΣΦΨΩ' + '∑∫√∞'),
)

/** Item 9's own default policy split: an expression carrying one of these characters is
 * "RELATIONAL/ASSIGNMENT" (Stanza-unreliable, per M1.1's live-traced "t = 0.5" fabricated-
 * clause finding) rather than "SIMPLE/STABLE". */
export const RELATIONAL_OPERATOR_CHARS = new Set(Array.from('=<>≤≥≠≈'))

const NUMERIC_TOKEN_PATTERN = /^[\d.,%]+$/
const SYMBOL_TOKEN_PATTERN = /^[^\w\s]+$/u
const ALLCAPS_IDENTIFIER_PATTERN = /^[A-Z]{2,}$/

type TokenKind = 'EVIDENCE' | 'NUMERIC' | 'SYMBOL' | 'SINGLE_LETTER' | 'ALLCAPS_IDENTIFIER' | 'PROSE'

const BRIDGEABLE_TOKEN_KINDS: ReadonlySet<TokenKind> = new Set(['EVIDENCE', 'NUMERIC', 'SYMBOL', 'SINGLE_LETTER', 'ALLCAPS_IDENTIFIER'])

function isTextMathEvidenceChar(c: string): boolean {
  return MATH_EVIDENCE_UNICODE_CHARS.has(c)
}

/** Purely structural classification (never a word/phrase dictionary) — mirrors
 * `_classify_math_token` exactly; see that function's own doc comment for the full
 * per-category rationale. */
export function classifyMathToken(token: string): TokenKind {
  if (Array.from(token).some((c) => isTextMathEvidenceChar(c))) return 'EVIDENCE'
  const stem = token.endsWith('.') && token.length > 1 ? token.slice(0, -1) : token
  if (NUMERIC_TOKEN_PATTERN.test(stem)) return 'NUMERIC'
  if (SYMBOL_TOKEN_PATTERN.test(token)) return 'SYMBOL'
  if (token.length === 1 && /^[A-Za-z]$/.test(token)) return 'SINGLE_LETTER'
  if (ALLCAPS_IDENTIFIER_PATTERN.test(token)) return 'ALLCAPS_IDENTIFIER'
  return 'PROSE'
}

/** Mirrors `_detect_math_runs` exactly — see that function's own doc comment. */
export function detectMathRuns(text: string): MathRun[] {
  const tokens: { start: number; end: number; kind: TokenKind }[] = []
  const tokenPattern = /\S+/g
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(text)) !== null) {
    tokens.push({ start: match.index, end: match.index + match[0].length, kind: classifyMathToken(match[0]) })
  }

  const evidenceIndices = tokens.reduce<number[]>((acc, t, i) => {
    if (t.kind === 'EVIDENCE') acc.push(i)
    return acc
  }, [])
  if (evidenceIndices.length === 0) return []

  const included = new Array(tokens.length).fill(false)
  for (const idx of evidenceIndices) {
    included[idx] = true
    let i = idx - 1
    while (i >= 0 && BRIDGEABLE_TOKEN_KINDS.has(tokens[i].kind)) {
      included[i] = true
      i--
    }
    i = idx + 1
    while (i < tokens.length && BRIDGEABLE_TOKEN_KINDS.has(tokens[i].kind)) {
      included[i] = true
      i++
    }
  }

  const runs: { start: number; end: number }[] = []
  let runStart: number | null = null
  let prevEnd: number | null = null
  for (let i = 0; i < tokens.length; i++) {
    if (included[i]) {
      if (runStart === null) runStart = tokens[i].start
      prevEnd = tokens[i].end
    } else if (runStart !== null) {
      runs.push({ start: runStart, end: prevEnd as number })
      runStart = null
    }
  }
  if (runStart !== null) runs.push({ start: runStart, end: prevEnd as number })

  const trimmed: MathRun[] = []
  for (const { start, end: rawEnd } of runs) {
    let end = rawEnd
    if (end > start && text[end - 1] === '.') {
      const rest = text.slice(end).replace(/^\s+/, '')
      if (rest === '' || /[A-Z]/.test(rest[0]) || !/[A-Za-z0-9]/.test(rest[0])) {
        end -= 1
      }
    }
    if (end > start) trimmed.push({ start, end, text: text.slice(start, end) })
  }
  return trimmed
}

/** Item 9's default policy: an expression carrying a relational/assignment operator
 * character is Stanza-unreliable evidence (see M1.1's live-traced "t = 0.5" fabricated
 * clause) and defaults to MATH_EXPR shielding; everything else stays literal. */
export function containsRelationalOperator(text: string): boolean {
  return Array.from(text).some((c) => RELATIONAL_OPERATOR_CHARS.has(c))
}
