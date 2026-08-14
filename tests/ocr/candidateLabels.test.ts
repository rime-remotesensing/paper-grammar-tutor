import { describe, expect, it } from 'vitest'
import { getCandidateLabels } from '../../src/features/ocr/domain/candidateLabels'

describe('getCandidateLabels', () => {
  it('uses a single unnumbered "OCR候補" label when only one candidate is shown (baseline == high-res)', () => {
    const { primary } = getCandidateLabels(false)
    expect(primary).toEqual({ label: 'OCR候補', buttonText: 'この候補を使う' })
  })

  it('numbers both candidates neutrally when both are shown (baseline != high-res)', () => {
    const { primary, secondary } = getCandidateLabels(true)
    expect(primary).toEqual({ label: '候補1（通常OCR）', buttonText: '候補1を使う' })
    expect(secondary).toEqual({ label: '候補2（高解像度OCR）', buttonText: '候補2を使う' })
  })

  it('never implies either candidate is "correct" or "recommended" in either state', () => {
    const banned = ['修正版', '正しい候補', '推奨候補', '正解']
    for (const bothShown of [false, true]) {
      const { primary, secondary } = getCandidateLabels(bothShown)
      for (const text of [primary.label, primary.buttonText, secondary.label, secondary.buttonText]) {
        for (const word of banned) {
          expect(text).not.toContain(word)
        }
      }
    }
  })
})
