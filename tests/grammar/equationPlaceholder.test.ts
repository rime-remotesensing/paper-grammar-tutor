import { describe, expect, it } from 'vitest'
import { normalizeEquationPlaceholdersForAnalysis, restoreEquationPlaceholdersForDisplay } from '../../src/features/grammar/domain/equationPlaceholder.ts'

describe('normalizeEquationPlaceholdersForAnalysis', () => {
  it('converts "[式 (5)]" to "[EQUATION_5]"', () => {
    expect(normalizeEquationPlaceholdersForAnalysis('...for the cosine equation, as [式 (5)].')).toBe('...for the cosine equation, as [EQUATION_5].')
  })

  it('converts "[式 (10)]" to "[EQUATION_10]" (multi-digit number)', () => {
    expect(normalizeEquationPlaceholdersForAnalysis('as [式 (10)]')).toBe('as [EQUATION_10]')
  })

  it('converts bare "[式]" (no number) to "[EQUATION]"', () => {
    expect(normalizeEquationPlaceholdersForAnalysis('as [式]')).toBe('as [EQUATION]')
  })

  it('converts multiple placeholders in one sentence independently', () => {
    expect(normalizeEquationPlaceholdersForAnalysis('see [式 (1)] and [式 (2)]')).toBe('see [EQUATION_1] and [EQUATION_2]')
  })

  it('does not touch ordinary Japanese text containing "式"', () => {
    const text = 'これは公式や数式を含む普通の文です。'
    expect(normalizeEquationPlaceholdersForAnalysis(text)).toBe(text)
  })

  it('leaves a malformed lookalike "[式 abc]" untouched (item 45 -- exact syntax only)', () => {
    const text = 'as [式 abc]'
    expect(normalizeEquationPlaceholdersForAnalysis(text)).toBe(text)
  })

  it('leaves text with no placeholder at all unchanged', () => {
    const text = 'The value of k can then be used as a moderator for the cosine equation.'
    expect(normalizeEquationPlaceholdersForAnalysis(text)).toBe(text)
  })

  it('is a no-op on text that already uses the analysis form', () => {
    const text = 'as [EQUATION_5]'
    expect(normalizeEquationPlaceholdersForAnalysis(text)).toBe(text)
  })
})

describe('restoreEquationPlaceholdersForDisplay', () => {
  it('converts "[EQUATION_5]" back to "[式 (5)]"', () => {
    expect(restoreEquationPlaceholdersForDisplay('as [EQUATION_5]')).toBe('as [式 (5)]')
  })

  it('converts bare "[EQUATION]" back to "[式]"', () => {
    expect(restoreEquationPlaceholdersForDisplay('as [EQUATION]')).toBe('as [式]')
  })

  it('round-trips through normalize then restore unchanged', () => {
    const original = 'The value of k can then be used as a moderator [9] for the cosine equation, as [式 (5)].'
    expect(restoreEquationPlaceholdersForDisplay(normalizeEquationPlaceholdersForAnalysis(original))).toBe(original)
  })

  it('does not touch a plain "[EQUATION_5]"-lookalike inside unrelated text without the exact token shape', () => {
    const text = 'EQUATION_5 written without brackets is untouched'
    expect(restoreEquationPlaceholdersForDisplay(text)).toBe(text)
  })
})
