import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/features/grammar/domain/stanzaSyntaxClient.ts', async () => {
  const actual = await vi.importActual<typeof import('../../src/features/grammar/domain/stanzaSyntaxClient.ts')>(
    '../../src/features/grammar/domain/stanzaSyntaxClient.ts',
  )
  return { ...actual, fetchStanzaAnalysis: vi.fn() }
})

import { fetchStanzaAnalysis } from '../../src/features/grammar/domain/stanzaSyntaxClient.ts'
import { resetSyntaxAuthorityCache } from '../../src/features/grammar/domain/analyzeSyntaxAuthority.ts'
import {
  analyzeSentenceWithSyntaxAuthority,
  resetSentenceAnalysisCache,
} from '../../src/features/grammar/domain/analyzeSentenceWithSyntaxAuthority.ts'
import { GRAMMAR_ANALYSIS_PROMPT_VERSION } from '../../src/llm/prompts/grammarAnalysisPrompt.ts'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types.ts'

const mockedFetch = vi.mocked(fetchStanzaAnalysis)

const STANZA_TOKENS = [
  { id: 1, text: 'It', lemma: 'it', upos: 'PRON', head: 2, deprel: 'nsubj', start: 0, end: 2 },
  { id: 2, text: 'works', lemma: 'work', upos: 'VERB', head: 0, deprel: 'root', start: 3, end: 8 },
  { id: 3, text: '.', lemma: '.', upos: 'PUNCT', head: 2, deprel: 'punct', start: 8, end: 9 },
]

function grammarAnalysisJson() {
  return JSON.stringify({
    sentenceCoreSet: {
      subject: { text: 'It', start: 0, end: 2 },
      subjectHead: { text: 'It', start: 0, end: 2 },
      predicateCores: [{ connector: null, verb: { text: 'works', start: 3, end: 8 }, indirectObject: null, object: null, complement: null }],
    },
    modifiers: [], clauses: [], phrases: [], vocabulary: [],
    confidence: 0.9, uncertainties: [], needsMoreContext: false, referenceTranslation: null,
  })
}

/** Counts how many times the (uncached) grammar-analysis LLM call actually fires, so the
 * top-level cache's whole point -- skipping the expensive Qwen chain on a repeat selection
 * of the same sentence -- is directly observable. */
class CountingProvider implements LLMProvider {
  calls = 0

  async listModels(): Promise<ModelInfo[]> {
    return []
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, message: 'ok' }
  }

  async generateStructured(_request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    this.calls++
    return { rawText: grammarAnalysisJson(), elapsedMs: 1 }
  }
}

describe('analyzeSentenceWithSyntaxAuthority caching', () => {
  beforeEach(() => {
    resetSentenceAnalysisCache()
    resetSyntaxAuthorityCache()
    mockedFetch.mockClear()
    mockedFetch.mockResolvedValue({ tokens: STANZA_TOKENS })
  })

  it('reuses the cached result for an identical (sentence, model, temperature) request instead of re-running the Qwen chain', async () => {
    const provider = new CountingProvider()
    const options = { provider, model: 'test-model', sentence: 'It works.', temperature: 0.1 }

    const first = await analyzeSentenceWithSyntaxAuthority(options)
    const second = await analyzeSentenceWithSyntaxAuthority(options)
    const third = await analyzeSentenceWithSyntaxAuthority(options)

    expect(first.success).toBe(true)
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(provider.calls).toBe(1)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('runs a fresh analysis for a different sentence', async () => {
    const provider = new CountingProvider()
    await analyzeSentenceWithSyntaxAuthority({ provider, model: 'test-model', sentence: 'It works.', temperature: 0.1 })
    await analyzeSentenceWithSyntaxAuthority({ provider, model: 'test-model', sentence: 'It runs.', temperature: 0.1 })

    expect(provider.calls).toBe(2)
  })

  it('runs a fresh analysis for the same sentence under a different model', async () => {
    const provider = new CountingProvider()
    await analyzeSentenceWithSyntaxAuthority({ provider, model: 'model-a', sentence: 'It works.', temperature: 0.1 })
    await analyzeSentenceWithSyntaxAuthority({ provider, model: 'model-b', sentence: 'It works.', temperature: 0.1 })

    expect(provider.calls).toBe(2)
  })

  it('bumps GRAMMAR_ANALYSIS_PROMPT_VERSION past its pre-chunks/readingHint-removal value', () => {
    // The cache key (analyzeSentenceWithSyntaxAuthority.ts's cacheKey()) embeds this version
    // string precisely so a schema/prompt contract change like removing chunks/readingHint
    // can never have a stale, differently-shaped cached result served under a colliding key.
    // Version 1 was the contract that still required chunks/readingHint; this must be >1 now.
    expect(GRAMMAR_ANALYSIS_PROMPT_VERSION).toBeGreaterThan(1)
  })
})
