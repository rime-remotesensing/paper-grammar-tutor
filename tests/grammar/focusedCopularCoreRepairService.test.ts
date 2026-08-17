import { beforeEach, describe, expect, it } from 'vitest'
import { getFocusedCopularCoreRepair, resetFocusedCopularCoreRepairCache } from '../../src/features/grammar/domain/focusedCopularCoreRepairService'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

const SENTENCE = 'The parameter C is a function of the regression slope.'
const VALID_RESPONSE = JSON.stringify({ subject: 'The parameter C', verb: 'is', complement: 'a function of the regression slope' })

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
  resetFocusedCopularCoreRepairCache()
})

describe('getFocusedCopularCoreRepair — caching', () => {
  it('calls the LLM only once for repeated requests with the same key', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const params = { provider, model: 'test-model', originalText: SENTENCE, stage2Hint: null, temperature: 0.1 }
    await getFocusedCopularCoreRepair(params)
    await getFocusedCopularCoreRepair(params)
    expect(provider.callCount).toBe(1)
  })

  it('invalidates the cache when the model changes', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, originalText: SENTENCE, stage2Hint: null, temperature: 0.1 }
    await getFocusedCopularCoreRepair({ ...base, model: 'model-a' })
    await getFocusedCopularCoreRepair({ ...base, model: 'model-b' })
    expect(provider.callCount).toBe(2)
  })

  it('does not reuse the cache across different sentence text', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, model: 'test-model', stage2Hint: null, temperature: 0.1 }
    await getFocusedCopularCoreRepair({ ...base, originalText: SENTENCE })
    await getFocusedCopularCoreRepair({ ...base, originalText: 'The parameter C is a function of the regression slope, approximately.' })
    expect(provider.callCount).toBe(2)
  })

  it('invalidates the cache when stage2Hint differs (item 14: hint is part of the cache key)', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, model: 'test-model', originalText: SENTENCE, temperature: 0.1 }
    await getFocusedCopularCoreRepair({ ...base, stage2Hint: null })
    await getFocusedCopularCoreRepair({ ...base, stage2Hint: 'is a function' })
    expect(provider.callCount).toBe(2)
  })

  it('evicts a failed generation from the cache so a retry calls the LLM again', async () => {
    const provider = new FailingProvider()
    const params = { provider, model: 'test-model', originalText: SENTENCE, stage2Hint: null, temperature: 0.1 }
    const first = await getFocusedCopularCoreRepair(params)
    expect(first.success).toBe(false)
    const callsAfterFirstFailure = provider.callCount

    const second = await getFocusedCopularCoreRepair(params)
    expect(second.success).toBe(false)
    expect(provider.callCount).toBeGreaterThan(callsAfterFirstFailure)
  })
})
