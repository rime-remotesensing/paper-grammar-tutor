import { describe, expect, it } from 'vitest'
import { padAndClampRect } from '../../src/features/ocr/domain/canvasCrop'
import { PADDLE_HIGH_RES_PADDING_FRAC } from '../../src/config/settings'

describe('padAndClampRect', () => {
  it('expands the rect by paddingPx on every side', () => {
    const result = padAndClampRect({ left: 100, top: 100, right: 200, bottom: 130 }, 10, 1000, 1000)
    expect(result).toEqual({ left: 90, top: 90, right: 210, bottom: 140 })
  })

  it('computes the same padding a real line uses at the production PADDLE_HIGH_RES_PADDING_FRAC', () => {
    // A line bbox with a 20px character height (bottom - top), matching how
    // paddleHighResService.ts derives padPx from the line's own bbox. Derives the
    // expected padPx from the actual constant rather than hardcoding a fraction, so this
    // test doesn't need updating if the accepted production value changes again.
    const bbox = { left: 300, top: 900, right: 970, bottom: 920 }
    const charHeight = bbox.bottom - bbox.top
    const padPx = charHeight * PADDLE_HIGH_RES_PADDING_FRAC
    const result = padAndClampRect(bbox, padPx, 2000, 2000)
    expect(result).toEqual({
      left: bbox.left - padPx,
      top: bbox.top - padPx,
      right: bbox.right + padPx,
      bottom: bbox.bottom + padPx,
    })
  })

  it('clamps the left/top edges at 0 for a line near the page start', () => {
    const result = padAndClampRect({ left: 5, top: 3, right: 100, bottom: 30 }, 10, 1000, 1000)
    expect(result).toEqual({ left: 0, top: 0, right: 110, bottom: 40 })
  })

  it('clamps the right/bottom edges at the canvas dimensions for a line near the page end', () => {
    const result = padAndClampRect({ left: 900, top: 980, right: 995, bottom: 998 }, 10, 1000, 1000)
    expect(result).toEqual({ left: 890, top: 970, right: 1000, bottom: 1000 })
  })

  it('clamps on all sides at once for a tiny canvas smaller than the padded rect', () => {
    const result = padAndClampRect({ left: 2, top: 2, right: 8, bottom: 8 }, 10, 6, 6)
    expect(result).toEqual({ left: 0, top: 0, right: 6, bottom: 6 })
  })
})
