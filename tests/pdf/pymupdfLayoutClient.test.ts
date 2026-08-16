import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkPymupdfHealth,
  closeDocument,
  registerDocument,
  requestSelectionResolution,
} from '../../src/features/pdf/domain/pymupdfLayoutClient'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function fetchThatRespectsAbort() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      })
    })
  })
}

const endpoint = { pageNumber: 1, xNorm: 0.1, yNorm: 0.2, boundaryText: 'x', direction: 'forward' as const }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('checkPymupdfHealth', () => {
  it('returns the parsed JSON body on success', async () => {
    const body = { status: 'ok', engine: 'pymupdf', serviceVersion: 'prototype-2.4b-r8' }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)))
    const result = await checkPymupdfHealth('http://127.0.0.1:8009', 3000)
    expect(result).toEqual(body)
  })

  it('throws on a non-2xx HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)))
    await expect(checkPymupdfHealth('http://127.0.0.1:8009', 3000)).rejects.toThrow()
  })

  it('throws when the health check times out', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchThatRespectsAbort())
    const promise = checkPymupdfHealth('http://127.0.0.1:8009', 3000)
    const expectation = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(3000)
    await expectation
  })
})

describe('registerDocument', () => {
  it('sends the PDF bytes as multipart/form-data, not a raw filesystem path', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ documentId: 'doc-1', numPages: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    await registerDocument('http://127.0.0.1:8009', new ArrayBuffer(4), 10_000)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8009/document/register')
    expect(init?.body).toBeInstanceOf(FormData)
  })

  it('throws on a non-2xx HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 400)))
    await expect(registerDocument('http://127.0.0.1:8009', new ArrayBuffer(0), 10_000)).rejects.toThrow()
  })
})

describe('closeDocument', () => {
  it('never throws even when the request fails (best-effort cleanup)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await expect(closeDocument('http://127.0.0.1:8009', 'doc-1', 10_000)).resolves.toBeUndefined()
  })
})

describe('requestSelectionResolution', () => {
  it('posts documentId/start/end as JSON and returns the parsed body', async () => {
    const body = { startBlockId: '1:0', endBlockId: '1:1', sameBlock: false, reconstructedText: 'a\nb', fragments: [] }
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(body))
    vi.stubGlobal('fetch', fetchMock)
    const result = await requestSelectionResolution('http://127.0.0.1:8009', 'doc-1', endpoint, endpoint, 5000)
    expect(result).toEqual(body)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8009/layout/selection')
    const sentBody = JSON.parse(init?.body as string)
    expect(sentBody).toEqual({ documentId: 'doc-1', start: endpoint, end: endpoint })
  })

  it('throws on a non-2xx HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 404)))
    await expect(requestSelectionResolution('http://127.0.0.1:8009', 'doc-1', endpoint, endpoint, 5000)).rejects.toThrow()
  })

  it('throws when the request times out', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchThatRespectsAbort())
    const promise = requestSelectionResolution('http://127.0.0.1:8009', 'doc-1', endpoint, endpoint, 5000)
    const expectation = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(5000)
    await expectation
  })

  it('aborts when an external AbortSignal fires (stale-request cancellation)', async () => {
    vi.stubGlobal('fetch', fetchThatRespectsAbort())
    const controller = new AbortController()
    const promise = requestSelectionResolution('http://127.0.0.1:8009', 'doc-1', endpoint, endpoint, 5000, controller.signal)
    const expectation = expect(promise).rejects.toThrow()
    controller.abort()
    await expectation
  })
})
