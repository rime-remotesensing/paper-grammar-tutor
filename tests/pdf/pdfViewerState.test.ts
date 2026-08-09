import { describe, expect, it } from 'vitest'
import { buildSelectionResult, resetForNewDocument } from '../../src/features/pdf/domain/pdfViewerState'
import { PDF_DEFAULT_SCALE } from '../../src/config/settings'

describe('resetForNewDocument', () => {
  it('always returns page 1 at the default scale', () => {
    expect(resetForNewDocument()).toEqual({ pageNumber: 1, scale: PDF_DEFAULT_SCALE })
  })
})

describe('buildSelectionResult', () => {
  it('normalizes the raw selection and keeps the page number', () => {
    expect(buildSelectionResult('The proposed\nmethod', 3)).toEqual({
      rawText: 'The proposed\nmethod',
      normalizedText: 'The proposed method',
      pageNumber: 3,
    })
  })

  it('returns null for a whitespace-only selection', () => {
    expect(buildSelectionResult('   \n  ', 1)).toBeNull()
  })

  it('returns null for an empty selection', () => {
    expect(buildSelectionResult('', 1)).toBeNull()
  })
})
