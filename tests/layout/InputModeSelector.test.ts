import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_INPUT_MODE, InputModeSelector, type InputMode } from '../../src/features/layout/components/InputModeSelector'

function render(mode: InputMode) {
  return renderToStaticMarkup(createElement(InputModeSelector, { mode, onChange: vi.fn() }))
}

describe('InputModeSelector', () => {
  it('text mode item 1: App.tsx starts every fresh load on PDF mode (never persisted)', () => {
    expect(DEFAULT_INPUT_MODE).toBe('pdf')
  })

  it('defaults to marking PDF mode selected when mode="pdf"', () => {
    const markup = render('pdf')
    expect(markup).toContain('PDFを読む')
    expect(markup).toContain('テキストを解析')
    // Both options render as buttons; only "PDFを読む" carries aria-pressed="true"/is-selected.
    const pdfButtonMatch = markup.match(/<button[^>]*>PDFを読む<\/button>/)
    const textButtonMatch = markup.match(/<button[^>]*>テキストを解析<\/button>/)
    expect(pdfButtonMatch?.[0]).toContain('aria-pressed="true"')
    expect(pdfButtonMatch?.[0]).toContain('is-selected')
    expect(textButtonMatch?.[0]).toContain('aria-pressed="false"')
    expect(textButtonMatch?.[0]).not.toContain('is-selected')
  })

  it('marks Text mode selected when mode="text"', () => {
    const markup = render('text')
    const pdfButtonMatch = markup.match(/<button[^>]*>PDFを読む<\/button>/)
    const textButtonMatch = markup.match(/<button[^>]*>テキストを解析<\/button>/)
    expect(pdfButtonMatch?.[0]).toContain('aria-pressed="false"')
    expect(textButtonMatch?.[0]).toContain('aria-pressed="true"')
    expect(textButtonMatch?.[0]).toContain('is-selected')
  })
})
