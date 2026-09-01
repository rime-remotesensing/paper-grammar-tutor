import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SentenceInputPanel } from '../../src/features/grammar/components/SentenceInputPanel'

function render(overrides: Partial<Parameters<typeof SentenceInputPanel>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(SentenceInputPanel, {
      sentence: '',
      onChange: vi.fn(),
      onAnalyze: vi.fn(),
      onClear: vi.fn(),
      phase: 'idle',
      canAnalyze: false,
      ...overrides,
    }),
  )
}

describe('SentenceInputPanel — shared between PDF and Text mode', () => {
  it('uses the PDF-mode default placeholder and idle label when no override is given', () => {
    const markup = render()
    expect(markup).toContain('The results obtained in the previous experiment')
    expect(markup).toContain('骨格を見る')
  })

  it('uses Text mode\'s placeholder/label when overridden, without any other markup change', () => {
    const markup = render({
      placeholder: '解析したい英語の1文を入力または貼り付けてください',
      idleLabel: '解析する',
    })
    expect(markup).toContain('解析したい英語の1文を入力または貼り付けてください')
    expect(markup).toContain('解析する')
    expect(markup).not.toContain('骨格を見る')
  })

  it('keeps the non-idle phase labels identical regardless of idleLabel override (same pipeline, same status text)', () => {
    const withOverride = render({ idleLabel: '解析する', phase: 'analyzing', canAnalyze: true })
    const withoutOverride = render({ phase: 'analyzing', canAnalyze: true })
    expect(withOverride).toContain('解析中…')
    expect(withoutOverride).toContain('解析中…')
  })

  it('preserves whatever sentence text is passed in, unmodified, regardless of mode', () => {
    const typed = 'VIIRS is a whiskbroom scanning radiometer.'
    const markup = render({ sentence: typed })
    expect(markup).toContain(typed)
  })
})
