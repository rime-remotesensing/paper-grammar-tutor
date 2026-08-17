import { beforeEach, describe, expect, it } from 'vitest'
import { getFocusedPassiveCoreRepair, resetFocusedPassiveCoreRepairCache } from '../../src/features/grammar/domain/focusedPassiveCoreRepairService'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

const SENTENCE = 'This regression line can be rotated to the horizontal.'
const VERB = { text: 'can be rotated', start: 21, end: 35 }
const COMPLEMENT = { text: 'to the horizontal', start: 36, end: 54 }
const VALID_RESPONSE = JSON.stringify({ pattern: 'SV', complement: null })

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
  resetFocusedPassiveCoreRepairCache()
})

describe('getFocusedPassiveCoreRepair — caching', () => {
  it('calls the LLM only once for repeated requests with the same key', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const params = { provider, model: 'test-model', originalText: SENTENCE, verb: VERB, pattern: 'SVC' as const, object: null, indirectObject: null, complement: COMPLEMENT, temperature: 0.1 }
    await getFocusedPassiveCoreRepair(params)
    await getFocusedPassiveCoreRepair(params)
    expect(provider.callCount).toBe(1)
  })

  it('invalidates the cache when the model changes', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, originalText: SENTENCE, verb: VERB, pattern: 'SVC' as const, object: null, indirectObject: null, complement: COMPLEMENT, temperature: 0.1 }
    await getFocusedPassiveCoreRepair({ ...base, model: 'model-a' })
    await getFocusedPassiveCoreRepair({ ...base, model: 'model-b' })
    expect(provider.callCount).toBe(2)
  })

  it('invalidates the cache when the current complement differs (item 15)', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, model: 'test-model', originalText: SENTENCE, verb: VERB, pattern: 'SVC' as const, object: null, indirectObject: null, temperature: 0.1 }
    await getFocusedPassiveCoreRepair({ ...base, complement: COMPLEMENT })
    await getFocusedPassiveCoreRepair({ ...base, complement: { text: 'a different span', start: 36, end: 53 } })
    expect(provider.callCount).toBe(2)
  })

  it('evicts a failed generation from the cache so a retry calls the LLM again', async () => {
    const provider = new FailingProvider()
    const params = { provider, model: 'test-model', originalText: SENTENCE, verb: VERB, pattern: 'SVC' as const, object: null, indirectObject: null, complement: COMPLEMENT, temperature: 0.1 }
    const first = await getFocusedPassiveCoreRepair(params)
    expect(first.success).toBe(false)
    const callsAfterFirstFailure = provider.callCount

    const second = await getFocusedPassiveCoreRepair(params)
    expect(second.success).toBe(false)
    expect(provider.callCount).toBeGreaterThan(callsAfterFirstFailure)
  })
})
