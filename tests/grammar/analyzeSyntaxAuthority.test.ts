import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/features/grammar/domain/stanzaSyntaxClient.ts', async () => {
  const actual = await vi.importActual<typeof import('../../src/features/grammar/domain/stanzaSyntaxClient.ts')>(
    '../../src/features/grammar/domain/stanzaSyntaxClient.ts',
  )
  return { ...actual, fetchStanzaAnalysis: vi.fn() }
})

import { fetchStanzaAnalysis, StanzaSyntaxUnavailableError } from '../../src/features/grammar/domain/stanzaSyntaxClient.ts'
import { analyzeSyntaxAuthority, resetSyntaxAuthorityCache } from '../../src/features/grammar/domain/analyzeSyntaxAuthority.ts'

const mockedFetch = vi.mocked(fetchStanzaAnalysis)

describe('analyzeSyntaxAuthority failure policy', () => {
  beforeEach(() => {
    resetSyntaxAuthorityCache()
    mockedFetch.mockClear()
  })

  it('returns status "ok" with a canonical core set on a valid Stanza parse', async () => {
    mockedFetch.mockResolvedValue({
      tokens: [
        { id: 1, text: 'It', lemma: 'it', upos: 'PRON', head: 2, deprel: 'nsubj', start: 0, end: 2 },
        { id: 2, text: 'works', lemma: 'work', upos: 'VERB', head: 0, deprel: 'root', start: 3, end: 8 },
        { id: 3, text: '.', lemma: '.', upos: 'PUNCT', head: 2, deprel: 'punct', start: 8, end: 9 },
      ],
    })
    const result = await analyzeSyntaxAuthority('It works.')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.coreSet.predicateCores).toHaveLength(1)
      expect(result.coreSet.predicateCores[0]!.verb?.text).toBe('works')
    }
  })

  it('never fabricates a plausible result when the service is unreachable', async () => {
    mockedFetch.mockRejectedValue(new StanzaSyntaxUnavailableError('Stanza syntax service is unreachable'))
    const result = await analyzeSyntaxAuthority('It works.')
    expect(result.status).toBe('unavailable')
  })

  it('reports unavailable when Stanza returns no tokens', async () => {
    mockedFetch.mockResolvedValue({ tokens: [] })
    const result = await analyzeSyntaxAuthority('...')
    expect(result.status).toBe('unavailable')
  })

  it('reports unavailable when no main-clause predicate is found', async () => {
    // A subject-only fragment with no root verb at all -- nothing for a clause to anchor on.
    mockedFetch.mockResolvedValue({
      tokens: [{ id: 1, text: 'Nothing', lemma: 'nothing', upos: 'PRON', head: 0, deprel: 'dep', start: 0, end: 7 }],
    })
    const result = await analyzeSyntaxAuthority('Nothing')
    expect(result.status).toBe('unavailable')
  })

  it('caches a successful result: repeat calls for the same text make exactly one HTTP call', async () => {
    mockedFetch.mockResolvedValue({
      tokens: [
        { id: 1, text: 'It', lemma: 'it', upos: 'PRON', head: 2, deprel: 'nsubj', start: 0, end: 2 },
        { id: 2, text: 'works', lemma: 'work', upos: 'VERB', head: 0, deprel: 'root', start: 3, end: 8 },
      ],
    })
    await analyzeSyntaxAuthority('It works.')
    await analyzeSyntaxAuthority('It works.')
    await analyzeSyntaxAuthority('It works.')
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('never caches a failed lookup: a later call retries the service', async () => {
    mockedFetch.mockRejectedValueOnce(new StanzaSyntaxUnavailableError('temporarily down'))
    const first = await analyzeSyntaxAuthority('It works.')
    expect(first.status).toBe('unavailable')

    mockedFetch.mockResolvedValueOnce({
      tokens: [
        { id: 1, text: 'It', lemma: 'it', upos: 'PRON', head: 2, deprel: 'nsubj', start: 0, end: 2 },
        { id: 2, text: 'works', lemma: 'work', upos: 'VERB', head: 0, deprel: 'root', start: 3, end: 8 },
      ],
    })
    const second = await analyzeSyntaxAuthority('It works.')
    expect(second.status).toBe('ok')
    expect(mockedFetch).toHaveBeenCalledTimes(2)
  })
})
