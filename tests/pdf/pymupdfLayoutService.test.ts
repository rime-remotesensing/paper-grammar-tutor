import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/features/pdf/domain/pymupdfLayoutClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/pdf/domain/pymupdfLayoutClient')>()
  return {
    ...actual,
    checkPymupdfHealth: vi.fn(),
    registerDocument: vi.fn(),
    closeDocument: vi.fn(),
    requestSelectionResolution: vi.fn(),
  }
})

import {
  checkPymupdfHealth,
  closeDocument,
  registerDocument,
  requestSelectionResolution,
  SelectionResolutionError,
} from '../../src/features/pdf/domain/pymupdfLayoutClient'
import {
  checkPymupdfAvailability,
  closeLayoutDocument,
  registerDocumentWithLayoutService,
  resolveSelectionWithLayoutService,
} from '../../src/features/pdf/domain/pymupdfLayoutService'

const checkPymupdfHealthMock = vi.mocked(checkPymupdfHealth)
const registerDocumentMock = vi.mocked(registerDocument)
const closeDocumentMock = vi.mocked(closeDocument)
const requestSelectionResolutionMock = vi.mocked(requestSelectionResolution)

const endpoint = { pageNumber: 1, xNorm: 0.1, yNorm: 0.1, boundaryText: 'x', direction: 'forward' as const }

afterEach(() => {
  checkPymupdfHealthMock.mockReset()
  registerDocumentMock.mockReset()
  closeDocumentMock.mockReset()
  requestSelectionResolutionMock.mockReset()
})

describe('checkPymupdfAvailability', () => {
  it('reports available on a valid ok health response', async () => {
    checkPymupdfHealthMock.mockResolvedValue({ status: 'ok', engine: 'pymupdf', serviceVersion: 'prototype-2.4b-r8' })
    const result = await checkPymupdfAvailability()
    expect(result).toEqual({ available: true, reason: null })
  })

  it('reports unavailable when the response fails schema validation', async () => {
    checkPymupdfHealthMock.mockResolvedValue({ status: 'ok' })
    const result = await checkPymupdfAvailability()
    expect(result.available).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('reports unavailable when the client throws (service down/unreachable)', async () => {
    checkPymupdfHealthMock.mockRejectedValue(new Error('connection refused'))
    const result = await checkPymupdfAvailability()
    expect(result.available).toBe(false)
    expect(result.reason).toBe('connection refused')
  })
})

describe('registerDocumentWithLayoutService', () => {
  it('returns the parsed documentId/numPages on success', async () => {
    registerDocumentMock.mockResolvedValue({ documentId: 'doc-1', numPages: 3 })
    const result = await registerDocumentWithLayoutService(new ArrayBuffer(0))
    expect(result).toEqual({ documentId: 'doc-1', numPages: 3 })
  })

  it('returns null (never throws) when the client throws', async () => {
    registerDocumentMock.mockRejectedValue(new Error('network error'))
    const result = await registerDocumentWithLayoutService(new ArrayBuffer(0))
    expect(result).toBeNull()
  })

  it('returns null (never throws) when the response fails schema validation', async () => {
    registerDocumentMock.mockResolvedValue({ documentId: '', numPages: 3 })
    const result = await registerDocumentWithLayoutService(new ArrayBuffer(0))
    expect(result).toBeNull()
  })
})

describe('closeLayoutDocument', () => {
  it('delegates to the client with the same documentId', async () => {
    closeDocumentMock.mockResolvedValue(undefined)
    await closeLayoutDocument('doc-1')
    expect(closeDocumentMock).toHaveBeenCalledWith(expect.any(String), 'doc-1', expect.any(Number))
  })
})

describe('resolveSelectionWithLayoutService', () => {
  it('returns the parsed response on success', async () => {
    requestSelectionResolutionMock.mockResolvedValue({
      startBlockId: '1:0',
      endBlockId: '1:1',
      sameBlock: false,
      reconstructedText: 'a\nb',
      fragments: [{ pageNumber: 1, text: 'a\nb' }],
    })
    const result = await resolveSelectionWithLayoutService('doc-1', endpoint, endpoint)
    expect(result.sameBlock).toBe(false)
    expect(result.fragments).toHaveLength(1)
  })

  it('throws (never returns a best-guess fallback) when the client rejects', async () => {
    requestSelectionResolutionMock.mockRejectedValue(new Error('HTTP 404'))
    await expect(resolveSelectionWithLayoutService('doc-1', endpoint, endpoint)).rejects.toThrow('HTTP 404')
  })

  it('throws when the response fails schema validation, instead of silently coercing it', async () => {
    requestSelectionResolutionMock.mockResolvedValue({ sameBlock: 'not-a-boolean' })
    await expect(resolveSelectionWithLayoutService('doc-1', endpoint, endpoint)).rejects.toThrow()
  })

  it('parses a same-block response WITH recovered fragments (Prototype 2.5E missing-glyph recovery)', async () => {
    requestSelectionResolutionMock.mockResolvedValue({
      startBlockId: '1:0',
      endBlockId: '1:0',
      sameBlock: true,
      reconstructedText: 'of\nk\ncan then be used',
      fragments: [{ pageNumber: 1, text: 'of\nk\ncan then be used' }],
    })
    const result = await resolveSelectionWithLayoutService('doc-1', endpoint, endpoint)
    expect(result.sameBlock).toBe(true)
    expect(result.fragments).toHaveLength(1)
  })

  it('parses the fast same-block-no-recovery response (empty fragments, null reconstructedText)', async () => {
    requestSelectionResolutionMock.mockResolvedValue({
      startBlockId: '1:0',
      endBlockId: '1:0',
      sameBlock: true,
      reconstructedText: null,
      fragments: [],
    })
    const result = await resolveSelectionWithLayoutService('doc-1', endpoint, endpoint)
    expect(result.reconstructedText).toBeNull()
    expect(result.fragments).toEqual([])
  })

  it('propagates a SelectionResolutionError from the client unchanged (never swallowed/wrapped)', async () => {
    requestSelectionResolutionMock.mockRejectedValue(new SelectionResolutionError('equation_endpoint_unresolved', 'no recoverable prose'))
    await expect(resolveSelectionWithLayoutService('doc-1', endpoint, endpoint)).rejects.toMatchObject({ code: 'equation_endpoint_unresolved' })
  })
})
