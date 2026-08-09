import { describe, expect, it } from 'vitest'
import { normalizePdfSelectionText } from '../../src/features/pdf/utils/pdfTextNormalize'

describe('normalizePdfSelectionText', () => {
  it('turns an ordinary line wrap into a space', () => {
    expect(normalizePdfSelectionText('The proposed\nmethod')).toBe('The proposed method')
  })

  it('joins a wrap-hyphenated word split across a line break', () => {
    expect(normalizePdfSelectionText('This result is signifi-\ncant for the field.')).toBe(
      'This result is significant for the field.',
    )
  })

  it('does not touch a legitimate hyphenated compound that is not at a line break', () => {
    expect(normalizePdfSelectionText('This is a state-of-the-art method.')).toBe(
      'This is a state-of-the-art method.',
    )
  })

  it('collapses runs of spaces and tabs', () => {
    expect(normalizePdfSelectionText('The   results\t\tare clear.')).toBe('The results are clear.')
  })

  it('normalizes CRLF and CR line endings before processing', () => {
    expect(normalizePdfSelectionText('The proposed\r\nmethod')).toBe('The proposed method')
    expect(normalizePdfSelectionText('The proposed\rmethod')).toBe('The proposed method')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizePdfSelectionText('  \n The method works. \n ')).toBe('The method works.')
  })

  it('handles multiple wrapped lines in one selection', () => {
    expect(
      normalizePdfSelectionText('The results obtained in the previous\nexperiment indi-\ncate that the method works.'),
    ).toBe('The results obtained in the previous experiment indicate that the method works.')
  })
})
