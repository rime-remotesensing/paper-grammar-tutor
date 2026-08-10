import { describe, expect, it } from 'vitest'
import { PDF_WASM_URL } from '../../src/config/settings'

describe('PDF_WASM_URL', () => {
  it('ends with a trailing slash, matching pdf.js\'s `${wasmUrl}${filename}` concatenation', () => {
    // pdf.js builds resource URLs by directly concatenating this prefix with filenames
    // like "jbig2.wasm" — a missing trailing slash silently breaks JBIG2/JPX decoding
    // (pages render blank) without throwing, which is exactly the bug this fixes.
    expect(PDF_WASM_URL.endsWith('/')).toBe(true)
  })

  it('is a root-relative path servable by Vite\'s public dir, not a bare filename', () => {
    expect(PDF_WASM_URL.startsWith('/')).toBe(true)
  })
})
