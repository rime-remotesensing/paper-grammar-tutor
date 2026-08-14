import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkPaddleHealth, requestPaddleOcr } from '../../src/features/ocr/domain/paddleOcrClient'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function validHealthBody(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    model: 'PP-OCRv6_medium',
    device: 'gpu',
    gpuAvailable: true,
    modelLoaded: true,
    error: null,
    ...overrides,
  }
}

function fakeCanvas(blob: Blob | null = new Blob(['x'])): HTMLCanvasElement {
  return {
    toBlob: (callback: BlobCallback) => callback(blob),
  } as unknown as HTMLCanvasElement
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('checkPaddleHealth', () => {
  it('reports available when status/gpuAvailable/modelLoaded/device all pass', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(validHealthBody())))
    const result = await checkPaddleHealth('http://127.0.0.1:8008', 3000)
    expect(result).toEqual({ available: true, reason: null })
  })

  it('reports unavailable on connection refused (fetch throws)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const result = await checkPaddleHealth('http://127.0.0.1:8008', 3000)
    expect(result.available).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('reports unavailable on a non-2xx HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)))
    const result = await checkPaddleHealth('http://127.0.0.1:8008', 3000)
    expect(result.available).toBe(false)
  })

  it('reports unavailable when gpuAvailable is false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(validHealthBody({ gpuAvailable: false }))))
    const result = await checkPaddleHealth('http://127.0.0.1:8008', 3000)
    expect(result.available).toBe(false)
    expect(result.reason).toContain('GPU')
  })

  it('reports unavailable when modelLoaded is false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(validHealthBody({ modelLoaded: false }))))
    const result = await checkPaddleHealth('http://127.0.0.1:8008', 3000)
    expect(result.available).toBe(false)
  })

  it('reports unavailable when device is not "gpu"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(validHealthBody({ device: 'cpu' }))))
    const result = await checkPaddleHealth('http://127.0.0.1:8008', 3000)
    expect(result.available).toBe(false)
  })

  it('reports unavailable when status is not "ok"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(validHealthBody({ status: 'degraded' }))))
    const result = await checkPaddleHealth('http://127.0.0.1:8008', 3000)
    expect(result.available).toBe(false)
  })

  it('reports unavailable on a malformed response body (fails schema validation)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ unexpected: true })))
    const result = await checkPaddleHealth('http://127.0.0.1:8008', 3000)
    expect(result.available).toBe(false)
  })

  it('reports unavailable when the health check times out', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchThatRespectsAbort())
    const promise = checkPaddleHealth('http://127.0.0.1:8008', 3000)
    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise
    expect(result.available).toBe(false)
  })
})

describe('requestPaddleOcr', () => {
  it('returns the parsed JSON body on success', async () => {
    const body = { imageWidth: 100, imageHeight: 200, lines: [] }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)))
    const result = await requestPaddleOcr('http://127.0.0.1:8008', fakeCanvas(), 10_000)
    expect(result).toEqual(body)
  })

  it('sends the page image as multipart/form-data, not base64', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ imageWidth: 1, imageHeight: 1, lines: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await requestPaddleOcr('http://127.0.0.1:8008', fakeCanvas(), 10_000)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8008/ocr/page')
    expect(init?.body).toBeInstanceOf(FormData)
  })

  it('throws on a non-2xx HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)))
    await expect(requestPaddleOcr('http://127.0.0.1:8008', fakeCanvas(), 10_000)).rejects.toThrow()
  })

  it('throws when the request times out', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchThatRespectsAbort())
    const promise = requestPaddleOcr('http://127.0.0.1:8008', fakeCanvas(), 10_000)
    const expectation = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation
  })

  it('throws when canvas.toBlob yields no blob', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(requestPaddleOcr('http://127.0.0.1:8008', fakeCanvas(null), 10_000)).rejects.toThrow()
  })
})
