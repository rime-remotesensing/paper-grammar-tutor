import { describe, expect, it } from 'vitest'
import { applyRuleA, applyRuleB, isNumericQuantityToken } from '../../src/features/ocr/domain/scientificNormalization'
import type { EmbeddedScientificToken, OcrWord } from '../../src/features/ocr/domain/ocrTypes'
import { findDigitMiddotMatches } from '../../src/features/pdf/domain/pdfViewerState'

const CANVAS_W = 1000
const CANVAS_H = 1000
const TOLERANCE = 3

function token(text: string, x0: number, y0: number, x1: number, y1: number): EmbeddedScientificToken {
  return { text, rects: [{ x0, y0, x1, y1 }] }
}

function word(text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90): OcrWord {
  return { text, confidence, bbox: { x0, y0, x1, y1 } }
}

describe('findDigitMiddotMatches', () => {
  it('finds a single digit·digit token', () => {
    expect(findDigitMiddotMatches('region 0·8 end')).toEqual([{ text: '0·8', start: 7, end: 10 }])
  })

  it('finds a multi-digit-after-dot token like 0·05', () => {
    expect(findDigitMiddotMatches('sampled every 0·05')).toEqual([{ text: '0·05', start: 14, end: 18 }])
  })

  it('finds multiple tokens in the same text', () => {
    expect(findDigitMiddotMatches('from 0·8 to 2·5 μm')).toEqual([
      { text: '0·8', start: 5, end: 8 },
      { text: '2·5', start: 12, end: 15 },
    ])
  })

  it('does not match a real hyphen range', () => {
    expect(findDigitMiddotMatches('2-5')).toEqual([])
    expect(findDigitMiddotMatches('1775-1795')).toEqual([])
    expect(findDigitMiddotMatches('2001-2004')).toEqual([])
  })

  it('returns an empty array for text with no middot at all', () => {
    expect(findDigitMiddotMatches('The signal is recorded on 1 nm centres')).toEqual([])
  })
})

describe('Rule A: applyRuleA', () => {
  it('1. embedded 0·8 + OCR 0-8 (digits match) -> 0.8', () => {
    const t = token('0·8', 0.1, 0.1, 0.14, 0.13)
    const w = word('0-8', 100, 105, 135, 125)
    const result = applyRuleA('region 0·8 end', [t], [w], TOLERANCE, CANVAS_W, CANVAS_H)
    expect(result).toEqual({ text: 'region 0.8 end', changed: true })
  })

  it('2. embedded 2·5 + OCR 2-5 -> 2.5', () => {
    const t = token('2·5', 0.1, 0.1, 0.14, 0.13)
    const w = word('2-5', 100, 105, 135, 125)
    const result = applyRuleA('from 2·5 onward', [t], [w], TOLERANCE, CANVAS_W, CANVAS_H)
    expect(result).toEqual({ text: 'from 2.5 onward', changed: true })
  })

  it('3. embedded 0·05 + OCR 0-05 -> 0.05', () => {
    const t = token('0·05', 0.1, 0.1, 0.16, 0.13)
    const w = word('0-05', 100, 105, 155, 125)
    const result = applyRuleA('sampled every 0·05.', [t], [w], TOLERANCE, CANVAS_W, CANVAS_H)
    expect(result).toEqual({ text: 'sampled every 0.05.', changed: true })
  })

  it('4. embedded 0·8 + OCR 0-9 (digits mismatch) -> no change', () => {
    const t = token('0·8', 0.1, 0.1, 0.14, 0.13)
    const w = word('0-9', 100, 105, 135, 125)
    const result = applyRuleA('region 0·8 end', [t], [w], TOLERANCE, CANVAS_W, CANVAS_H)
    expect(result).toEqual({ text: null, changed: false })
  })

  it('5. embedded 0·8 + no matching OCR word -> no change', () => {
    const t = token('0·8', 0.1, 0.1, 0.14, 0.13)
    const w = word('elsewhere', 800, 800, 850, 820) // far away, won't match the rect
    const result = applyRuleA('region 0·8 end', [t], [w], TOLERANCE, CANVAS_W, CANVAS_H)
    expect(result).toEqual({ text: null, changed: false })
  })

  it('6. embedded text "2-5" (no token found upstream) -> no change', () => {
    const result = applyRuleA('range 2-5 end', [], [], TOLERANCE, CANVAS_W, CANVAS_H)
    expect(result).toEqual({ text: null, changed: false })
  })

  it('7. embedded text "1775-1795" (no token found upstream) -> no change', () => {
    const result = applyRuleA('pp. 1775-1795', [], [], TOLERANCE, CANVAS_W, CANVAS_H)
    expect(result).toEqual({ text: null, changed: false })
  })

  it('8. embedded text "2001-2004" (no token found upstream) -> no change', () => {
    const result = applyRuleA('in 2001-2004', [], [], TOLERANCE, CANVAS_W, CANVAS_H)
    expect(result).toEqual({ text: null, changed: false })
  })

  it('9. multiple middle-dots: only the cross-validated one changes', () => {
    const validToken = token('0·8', 0.1, 0.1, 0.14, 0.13)
    const invalidToken = token('2·5', 0.3, 0.1, 0.34, 0.13)
    const validWord = word('0-8', 100, 105, 135, 125)
    const wrongWord = word('2-9', 300, 105, 335, 125) // digits mismatch for the second token
    const result = applyRuleA('from 0·8 to 2·5 region', [validToken, invalidToken], [validWord, wrongWord], TOLERANCE, CANVAS_W, CANVAS_H)
    expect(result).toEqual({ text: 'from 0.8 to 2·5 region', changed: true })
  })

  it('10. no token qualifies -> candidate is null, not an unchanged string', () => {
    const t = token('0·8', 0.1, 0.1, 0.14, 0.13)
    const result = applyRuleA('region 0·8 end', [t], [], TOLERANCE, CANVAS_W, CANVAS_H)
    expect(result.text).toBeNull()
    expect(result.changed).toBe(false)
  })
})

describe('Rule B: applyRuleB', () => {
  it('1. ["2-5", "um"] -> ["2-5", "μm"]', () => {
    const words = [word('2-5', 0, 0, 10, 10), word('um', 12, 0, 20, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(true)
    expect(result.words.map((w) => w.text)).toEqual(['2-5', 'μm'])
  })

  it('2. ["0.8", "um"] -> μm', () => {
    const words = [word('0.8', 0, 0, 10, 10), word('um', 12, 0, 20, 10)]
    const result = applyRuleB(words)
    expect(result.words.map((w) => w.text)).toEqual(['0.8', 'μm'])
  })

  it('3. ["1", "um"] -> μm', () => {
    const words = [word('1', 0, 0, 10, 10), word('um', 12, 0, 20, 10)]
    const result = applyRuleB(words)
    expect(result.words.map((w) => w.text)).toEqual(['1', 'μm'])
  })

  it('4. non-numeric preceding word + "um" -> no change', () => {
    const words = [word('region', 0, 0, 10, 10), word('um', 12, 0, 20, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
    expect(result.words.map((w) => w.text)).toEqual(['region', 'um'])
  })

  it('5. "ym" is never touched', () => {
    const words = [word('0.8', 0, 0, 10, 10), word('ym', 12, 0, 20, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
    expect(result.words.map((w) => w.text)).toEqual(['0.8', 'ym'])
  })

  it('6. "jum" is never touched', () => {
    const words = [word('0.68', 0, 0, 10, 10), word('jum', 12, 0, 20, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })

  it('7. "pm" is never touched', () => {
    const words = [word('0.9', 0, 0, 10, 10), word('pm', 12, 0, 20, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })

  it('8. "nm" is never touched', () => {
    const words = [word('4', 0, 0, 10, 10), word('nm', 12, 0, 20, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })

  it('9. actual Elsevier positive fixture: ["had","a","4-","um","potential-fire"] -> "4-" "μm" only', () => {
    const words = ['had', 'a', '4-', 'um', 'potential-fire'].map((t, i) => word(t, i * 20, 0, i * 20 + 15, 10))
    const result = applyRuleB(words)
    expect(result.changed).toBe(true)
    expect(result.words.map((w) => w.text)).toEqual(['had', 'a', '4-', 'μm', 'potential-fire'])
  })

  it('9b. actual Elsevier fixture where "0.86-um" is ONE merged token -> 0.86-μm (same-word case)', () => {
    const words = ['the', 'mean', '0.86-um', 'reflectance'].map((t, i) => word(t, i * 20, 0, i * 20 + 15, 10))
    const result = applyRuleB(words)
    expect(result.changed).toBe(true)
    expect(result.words.map((w) => w.text)).toEqual(['the', 'mean', '0.86-μm', 'reflectance'])
  })

  it('10. multiple units in sequence: only the exact "um" token changes', () => {
    const words = [
      word('4', 0, 0, 8, 10),
      word('nm', 10, 0, 20, 10),
      word('and', 22, 0, 35, 10),
      word('2.5', 37, 0, 48, 10),
      word('um', 50, 0, 58, 10),
    ]
    const result = applyRuleB(words)
    expect(result.words.map((w) => w.text)).toEqual(['4', 'nm', 'and', '2.5', 'μm'])
  })

  // --- trailing punctuation on an exact "um" token (Case A) ---

  it('11. ["2-5", "um."] -> "2-5 μm."', () => {
    const words = [word('2-5', 0, 0, 10, 10), word('um.', 12, 0, 22, 10)]
    const result = applyRuleB(words)
    expect(result.words.map((w) => w.text)).toEqual(['2-5', 'μm.'])
  })

  it('12. ["1", "um,"] -> "1 μm,"', () => {
    const words = [word('1', 0, 0, 10, 10), word('um,', 12, 0, 22, 10)]
    const result = applyRuleB(words)
    expect(result.words.map((w) => w.text)).toEqual(['1', 'μm,'])
  })

  it('13. ["0.8", "um)"] -> "0.8 μm)"', () => {
    const words = [word('0.8', 0, 0, 10, 10), word('um)', 12, 0, 22, 10)]
    const result = applyRuleB(words)
    expect(result.words.map((w) => w.text)).toEqual(['0.8', 'μm)'])
  })

  // --- numeric prefix fused into the same word as "-um" (Case B) ---

  it('14. single token "0.86-um" -> "0.86-μm"', () => {
    const words = [word('the', 0, 0, 8, 10), word('mean', 10, 0, 25, 10), word('0.86-um', 27, 0, 50, 10)]
    const result = applyRuleB(words)
    expect(result.words.map((w) => w.text)).toEqual(['the', 'mean', '0.86-μm'])
  })

  it('15. "4-um" -> "4-μm"', () => {
    const words = [word('had', 0, 0, 8, 10), word('a', 10, 0, 15, 10), word('4-um', 17, 0, 30, 10)]
    const result = applyRuleB(words)
    expect(result.words.map((w) => w.text)).toEqual(['had', 'a', '4-μm'])
  })

  it('16. "0.86-um." (same-word plus trailing punctuation) -> "0.86-μm."', () => {
    const words = [word('0.86-um.', 0, 0, 20, 10)]
    const result = applyRuleB(words)
    expect(result.words.map((w) => w.text)).toEqual(['0.86-μm.'])
  })

  it('17. "foo-um" (non-numeric prefix) -> no change', () => {
    const words = [word('foo-um', 0, 0, 15, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
    expect(result.words.map((w) => w.text)).toEqual(['foo-um'])
  })

  it('17b. "test-um" (non-numeric prefix) -> no change', () => {
    const words = [word('test-um', 0, 0, 15, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })

  it('18. "spectrum" (incidental "um" inside an ordinary word) -> no change', () => {
    const words = [word('the', 0, 0, 8, 10), word('spectrum', 10, 0, 30, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })

  it('19. "maximum" (incidental "um" inside an ordinary word) -> no change', () => {
    const words = [word('1', 0, 0, 5, 10), word('maximum', 7, 0, 27, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })

  it('19b. "datum" -> no change', () => {
    const words = [word('2', 0, 0, 5, 10), word('datum', 7, 0, 20, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })

  it('20. "ym." (trailing punctuation on a non-"um" misreading) -> no change', () => {
    const words = [word('0.8', 0, 0, 10, 10), word('ym.', 12, 0, 22, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })

  it('21. "jum." -> no change', () => {
    const words = [word('0.68', 0, 0, 10, 10), word('jum.', 12, 0, 24, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })

  it('22. "pm." -> no change', () => {
    const words = [word('0.9', 0, 0, 10, 10), word('pm.', 12, 0, 22, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })

  it('23. numeric + "Jim" -> no change', () => {
    const words = [word('0.05', 0, 0, 10, 10), word('Jim', 12, 0, 24, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })

  it('24. numeric + "umx" (not a recognized trailing-punctuation form) -> no change', () => {
    const words = [word('2.5', 0, 0, 10, 10), word('umx', 12, 0, 24, 10)]
    const result = applyRuleB(words)
    expect(result.changed).toBe(false)
  })
})

describe('isNumericQuantityToken', () => {
  it('accepts plain integers, decimals, hyphen-decimals, middot-decimals, and trailing-hyphen forms', () => {
    for (const t of ['1', '2.5', '0.8', '0-8', '2-5', '0·8', '4-', '0.86-']) {
      expect(isNumericQuantityToken(t)).toBe(true)
    }
  })

  it('rejects non-numeric words', () => {
    for (const t of ['region', 'the', 'um', '-', 'nm']) {
      expect(isNumericQuantityToken(t)).toBe(false)
    }
  })
})
