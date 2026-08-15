import { describe, expect, it } from 'vitest'
import { verifyFocusedComplement } from '../../src/features/grammar/domain/FocusedComplementVerifier'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

// Prototype 2.3I item 37 — verifier analyzer tests.

class StubProvider implements LLMProvider {
  callCount = 0
  private readonly responses: string[]

  constructor(responses: string[]) {
    this.responses = responses
  }

  async listModels(): Promise<ModelInfo[]> {
    return []
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, message: 'ok' }
  }

  async generateStructured(_request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    const rawText = this.responses[Math.min(this.callCount, this.responses.length - 1)]
    this.callCount += 1
    return { rawText, elapsedMs: 1 }
  }
}

const VALID_SUPPLEMENTARY = JSON.stringify({ classification: 'SUPPLEMENTARY_ING', reasonCode: 'COMMA_SUPPLEMENT' })
const VALID_OBJECT_COMPLEMENT = JSON.stringify({ classification: 'OBJECT_COMPLEMENT', reasonCode: 'OBJECT_PREDICATION' })

const BASE_OPTIONS = {
  sentence: 'We describe the method, emphasizing its advantages.',
  subject: 'We',
  verb: 'describe',
  object: 'the method',
  complement: 'emphasizing its advantages',
  temperature: 0.1,
}

describe('verifyFocusedComplement — successful classification', () => {
  it('returns SUPPLEMENTARY_ING on a well-formed response', async () => {
    const provider = new StubProvider([VALID_SUPPLEMENTARY])
    const result = await verifyFocusedComplement({ provider, model: 'test-model', ...BASE_OPTIONS })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.classification).toBe('SUPPLEMENTARY_ING')
    expect(result.reasonCode).toBe('COMMA_SUPPLEMENT')
    expect(provider.callCount).toBe(1)
  })

  it('returns OBJECT_COMPLEMENT on a well-formed response', async () => {
    const provider = new StubProvider([VALID_OBJECT_COMPLEMENT])
    const result = await verifyFocusedComplement({ provider, model: 'test-model', ...BASE_OPTIONS })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.classification).toBe('OBJECT_COMPLEMENT')
  })
})

describe('verifyFocusedComplement — malformed output triggers exactly one repair', () => {
  it('repairs once when the first response is invalid JSON, then succeeds', async () => {
    const provider = new StubProvider(['not valid json', VALID_SUPPLEMENTARY])
    const result = await verifyFocusedComplement({ provider, model: 'test-model', ...BASE_OPTIONS })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('repairs once when the classification enum value is invalid, then succeeds', async () => {
    const invalid = JSON.stringify({ classification: 'MAYBE', reasonCode: 'OBJECT_PREDICATION' })
    const provider = new StubProvider([invalid, VALID_OBJECT_COMPLEMENT])
    const result = await verifyFocusedComplement({ provider, model: 'test-model', ...BASE_OPTIONS })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })
})

describe('verifyFocusedComplement — repair failure is a safe failure, never a loop', () => {
  it('fails safely (without throwing) when the repair attempt also fails', async () => {
    const provider = new StubProvider(['bad', 'still bad'])
    const result = await verifyFocusedComplement({ provider, model: 'test-model', ...BASE_OPTIONS })
    expect(result.success).toBe(false)
    expect(provider.callCount).toBe(2)
    if (result.success) return
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('never issues more than one repair call (no repair loops)', async () => {
    const provider = new StubProvider(['bad', 'bad', 'bad', VALID_SUPPLEMENTARY])
    await verifyFocusedComplement({ provider, model: 'test-model', ...BASE_OPTIONS })
    expect(provider.callCount).toBe(2)
  })
})
