/**
 * Label/button text for the Paddle OCR candidate block(s) (Prototype 1.5J). Pure
 * presentation logic only — never implies one candidate is "correct"/"recommended",
 * since baseline is sometimes right when high-res is wrong and vice versa (see
 * docs/design-notes.md, Prototype 1.5H/1.5I). Kept as a small pure function so the
 * label choice is unit-testable without a DOM/component-rendering environment.
 */
export interface CandidateLabelSet {
  label: string
  buttonText: string
}

export interface CandidateLabels {
  primary: CandidateLabelSet
  /** Only relevant when both candidates are shown (baseline !== high-res). */
  secondary: CandidateLabelSet
}

export function getCandidateLabels(bothShown: boolean): CandidateLabels {
  if (!bothShown) {
    return {
      primary: { label: 'OCR候補', buttonText: 'この候補を使う' },
      secondary: { label: '候補2（高解像度OCR）', buttonText: '候補2を使う' },
    }
  }
  return {
    primary: { label: '候補1（通常OCR）', buttonText: '候補1を使う' },
    secondary: { label: '候補2（高解像度OCR）', buttonText: '候補2を使う' },
  }
}
