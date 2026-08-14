import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestLineRecognition } from '../../src/features/ocr/domain/paddleLineRecognitionClient'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('requestLineRecognition', () => {
  it('returns the parsed JSON body on success', async () => {
    const body = { lines: [{ text: 'hello', confidence: 0.9 }] }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)))
    const result = await requestLineRecognition('http://127.0.0.1:8008', [new Blob(['x'])], 10_000)
    expect(result).toEqual(body)
  })

  it('sends every crop under the same "files" field name, in order, as multipart/form-data', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ lines: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const cropA = new Blob(['a'])
    const cropB = new Blob(['b'])
    await requestLineRecognition('http://127.0.0.1:8008', [cropA, cropB], 10_000)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8008/ocr/lines')
    expect(init?.body).toBeInstanceOf(FormData)
    const form = init?.body as FormData
    const files = form.getAll('files')
    expect(files).toHaveLength(2)
  })

  it('throws on a non-2xx HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)))
    await expect(requestLineRecognition('http://127.0.0.1:8008', [new Blob(['x'])], 10_000)).rejects.toThrow()
  })

  it('throws when the request times out', async () => {
    vi.useFakeTimers()
    const fetchThatRespectsAbort = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchThatRespectsAbort)
    const promise = requestLineRecognition('http://127.0.0.1:8008', [new Blob(['x'])], 10_000)
    const expectation = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation
  })
})
