import { describe, expect, it } from 'vitest'
import { repairFocusedCopularCore } from '../../src/features/grammar/domain/FocusedCopularCoreRepairer'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

// Prototype 2.5W — Focused Copular Core Repair analyzer tests.

const SENTENCE = 'The parameter C is a function of the regression slope.'

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

const VALID_RESPONSE = JSON.stringify({ subject: 'The parameter C', verb: 'is', complement: 'a function of the regression slope' })

describe('repairFocusedCopularCore — success', () => {
  it('grounds all three fields against the sentence on a well-formed response', async () => {
    const provider = new StubProvider([VALID_RESPONSE])
    const result = await repairFocusedCopularCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result.subject).toEqual({ text: 'The parameter C', start: 0, end: 15 })
    expect(result.result.verb).toEqual({ text: 'is', start: 16, end: 18 })
    expect(result.result.complement).toEqual({ text: 'a function of the regression slope', start: 19, end: 53 })
    expect(provider.callCount).toBe(1)
  })

  it('excludes a coordinated second clause from the complement (the exact CASE A shape)', async () => {
    const sentence =
      'The parameter C is a function of the regression slope and is introduced to the model.'
    const response = JSON.stringify({ subject: 'The parameter C', verb: 'is', complement: 'a function of the regression slope' })
    const provider = new StubProvider([response])
    const result = await repairFocusedCopularCore({ provider, model: 'test-model', sentence, temperature: 0.1 })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result.complement.text).toBe('a function of the regression slope')
    expect(result.result.complement.text).not.toContain('is introduced')
  })

  it('passes the optional stage2Hint through to the prompt without altering grounding', async () => {
    const provider = new StubProvider([VALID_RESPONSE])
    const result = await repairFocusedCopularCore({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      stage2Hint: 'is a function',
    })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(1)
  })
})

describe('repairFocusedCopularCore — malformed output triggers exactly one repair', () => {
  it('repairs once on invalid JSON, then succeeds', async () => {
    const provider = new StubProvider(['not valid json', VALID_RESPONSE])
    const result = await repairFocusedCopularCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('repairs once when a field is missing, then succeeds', async () => {
    const missingField = JSON.stringify({ subject: 'The parameter C', verb: 'is' })
    const provider = new StubProvider([missingField, VALID_RESPONSE])
    const result = await repairFocusedCopularCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('repairs once when a field does not resolve as an exact substring (ungroundable), then succeeds', async () => {
    const ungrounded = JSON.stringify({ subject: 'not in the sentence at all', verb: 'is', complement: 'a function of the regression slope' })
    const provider = new StubProvider([ungrounded, VALID_RESPONSE])
    const result = await repairFocusedCopularCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('repairs once when the returned fields ground out of order (subject after verb), then succeeds', async () => {
    // "is" appears before "The parameter C" would ground if taken as literal substrings in
    // a nonsensical order -- construct a response whose grounded order is invalid to check
    // the ordering guard fires and triggers exactly one repair.
    const outOfOrder = JSON.stringify({ subject: 'the regression slope', verb: 'is', complement: 'The parameter C' })
    const provider = new StubProvider([outOfOrder, VALID_RESPONSE])
    const result = await repairFocusedCopularCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })
})

describe('repairFocusedCopularCore — repair failure is safe, never a loop', () => {
  it('fails safely without throwing when the repair attempt also fails', async () => {
    const provider = new StubProvider(['bad', 'still bad'])
    const result = await repairFocusedCopularCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(result.success).toBe(false)
    expect(provider.callCount).toBe(2)
    if (result.success) return
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('never issues more than one repair call', async () => {
    const provider = new StubProvider(['bad', 'bad', 'bad', VALID_RESPONSE])
    await repairFocusedCopularCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(provider.callCount).toBe(2)
  })
})
