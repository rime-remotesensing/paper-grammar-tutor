import { beforeEach, describe, expect, it } from 'vitest'
import { getFocusedWhereClauseRepair, resetFocusedWhereClauseRepairCache } from '../../src/features/grammar/domain/focusedWhereClauseRepairService'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

const SENTENCE = 'We use a model where x is the input and y is the output.'
const CLAUSE_SPAN = { text: 'where x is the input and y is the output', start: 15, end: 55 }
const VALID_RESPONSE = JSON.stringify({ owner: 'use', children: ['x is the input', 'y is the output'] })

class CountingProvider implements LLMProvider {
  callCount = 0
  private readonly response: string

  constructor(response: string) {
    this.response = response
  }

  async listModels(): Promise<ModelInfo[]> {
    return []
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, message: 'ok' }
  }

  async generateStructured(_request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    this.callCount += 1
    return { rawText: this.response, elapsedMs: 1 }
  }
}

class FailingProvider implements LLMProvider {
  callCount = 0

  async listModels(): Promise<ModelInfo[]> {
    return []
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, message: 'ok' }
  }

  async generateStructured(_request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    this.callCount += 1
    return { rawText: 'not valid json', elapsedMs: 1 }
  }
}

beforeEach(() => {
  resetFocusedWhereClauseRepairCache()
})

describe('getFocusedWhereClauseRepair — caching', () => {
  it('calls the LLM only once for repeated requests with the same key', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const params = { provider, model: 'test-model', originalText: SENTENCE, clauseSpan: CLAUSE_SPAN, acceptedPredicateCandidates: ['use'], temperature: 0.1 }
    await getFocusedWhereClauseRepair(params)
    await getFocusedWhereClauseRepair(params)
    expect(provider.callCount).toBe(1)
  })

  it('invalidates the cache when the accepted candidate list differs', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, model: 'test-model', originalText: SENTENCE, clauseSpan: CLAUSE_SPAN, temperature: 0.1 }
    await getFocusedWhereClauseRepair({ ...base, acceptedPredicateCandidates: ['use'] })
    await getFocusedWhereClauseRepair({ ...base, acceptedPredicateCandidates: ['use', 'other'] })
    expect(provider.callCount).toBe(2)
  })

  it('invalidates the cache when the clause span differs', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, model: 'test-model', originalText: SENTENCE, acceptedPredicateCandidates: ['use'], temperature: 0.1 }
    await getFocusedWhereClauseRepair({ ...base, clauseSpan: CLAUSE_SPAN })
    await getFocusedWhereClauseRepair({ ...base, clauseSpan: { ...CLAUSE_SPAN, start: 16 } })
    expect(provider.callCount).toBe(2)
  })

  it('evicts a failed generation from the cache so a retry calls the LLM again', async () => {
    const provider = new FailingProvider()
    const params = { provider, model: 'test-model', originalText: SENTENCE, clauseSpan: CLAUSE_SPAN, acceptedPredicateCandidates: ['use'], temperature: 0.1 }
    const first = await getFocusedWhereClauseRepair(params)
    expect(first.success).toBe(false)
    const callsAfterFirstFailure = provider.callCount

    const second = await getFocusedWhereClauseRepair(params)
    expect(second.success).toBe(false)
    expect(provider.callCount).toBeGreaterThan(callsAfterFirstFailure)
  })
})
