import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchStanzaAnalysis, fetchStanzaHealth, StanzaSyntaxUnavailableError } from '../../src/features/grammar/domain/stanzaSyntaxClient.ts'

describe('stanzaSyntaxClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns parsed tokens on a successful response', async () => {
    const tokens = [{ id: 1, text: 'Hi', lemma: 'hi', upos: 'INTJ', head: 0, deprel: 'root', start: 0, end: 2 }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ tokens }), { status: 200 })))
    const result = await fetchStanzaAnalysis('Hi.', 'http://127.0.0.1:8010')
    expect(result.tokens).toEqual(tokens)
  })

  it('throws StanzaSyntaxUnavailableError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    await expect(fetchStanzaAnalysis('Hi.', 'http://127.0.0.1:8010')).rejects.toBeInstanceOf(StanzaSyntaxUnavailableError)
  })

  it('throws StanzaSyntaxUnavailableError on a malformed response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ notTokens: [] }), { status: 200 })))
    await expect(fetchStanzaAnalysis('Hi.', 'http://127.0.0.1:8010')).rejects.toBeInstanceOf(StanzaSyntaxUnavailableError)
  })

  it('throws StanzaSyntaxUnavailableError when the network call itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(fetchStanzaAnalysis('Hi.', 'http://127.0.0.1:8010')).rejects.toBeInstanceOf(StanzaSyntaxUnavailableError)
  })

  it('fetchStanzaHealth returns null (never throws) when the service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const health = await fetchStanzaHealth('http://127.0.0.1:8010')
    expect(health).toBeNull()
  })

  it('fetchStanzaHealth returns the parsed body when healthy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok', modelReady: true }), { status: 200 })),
    )
    const health = await fetchStanzaHealth('http://127.0.0.1:8010')
    expect(health).toEqual({ status: 'ok', modelReady: true })
  })
})
