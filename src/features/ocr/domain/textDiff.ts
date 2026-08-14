/**
 * Pure character-level text diff for showing a user where two OCR candidates differ
 * (Prototype 1.5I). Display-only — never rewrites either candidate's text, never
 * normalizes/corrects anything (µ and μ are different characters here, exactly as in the
 * raw OCR output). Standard LCS-based diff; no semantic/dictionary/unit-aware logic.
 */

interface DiffOp {
  type: 'equal' | 'delete' | 'insert'
  text: string
}

function computeOps(a: string, b: string): DiffOp[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'delete', text: a[i] })
      i++
    } else {
      ops.push({ type: 'insert', text: b[j] })
      j++
    }
  }
  while (i < n) {
    ops.push({ type: 'delete', text: a[i] })
    i++
  }
  while (j < m) {
    ops.push({ type: 'insert', text: b[j] })
    j++
  }

  const merged: DiffOp[] = []
  for (const op of ops) {
    const last = merged[merged.length - 1]
    if (last && last.type === op.type) last.text += op.text
    else merged.push({ ...op })
  }
  return merged
}

export interface DiffSegment {
  text: string
  changed: boolean
}

export interface TextDiffResult {
  /** `a`, split into same/changed segments — 'changed' segments are the characters of
   * `a` that are absent from `b` (a "delete" from `a`'s point of view). */
  aSegments: DiffSegment[]
  /** `b`, split into same/changed segments — 'changed' segments are the characters of
   * `b` that are absent from `a` (an "insert" from `a`'s point of view). */
  bSegments: DiffSegment[]
}

/** Diffs `a` against `b` at the character level, returning display segments for both
 * sides. Equal runs are shared verbatim; a substitution (e.g. "m" -> "µm") shows up as a
 * 'changed' segment in `aSegments` and a different 'changed' segment in `bSegments` at
 * the corresponding position — never merged into one "replacement" unit, since this is a
 * display aid, not an edit script to apply. */
export function diffForDisplay(a: string, b: string): TextDiffResult {
  const ops = computeOps(a, b)
  const aSegments: DiffSegment[] = []
  const bSegments: DiffSegment[] = []
  for (const op of ops) {
    if (op.type === 'equal') {
      aSegments.push({ text: op.text, changed: false })
      bSegments.push({ text: op.text, changed: false })
    } else if (op.type === 'delete') {
      aSegments.push({ text: op.text, changed: true })
    } else {
      bSegments.push({ text: op.text, changed: true })
    }
  }
  return { aSegments, bSegments }
}
