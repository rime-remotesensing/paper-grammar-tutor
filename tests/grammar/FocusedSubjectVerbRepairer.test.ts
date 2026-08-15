import { describe, expect, it } from 'vitest'
import { repairFocusedSubjectVerb } from '../../src/features/grammar/domain/FocusedSubjectVerbRepairer'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

// Prototype 2.3L — Focused Subject-Verb Repair analyzer tests.

const SENTENCE = 'The sensor recorded data.'

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

const VALID_RESPONSE = JSON.stringify({ subject: 'The sensor', subjectHead: 'sensor', verb: 'recorded' })

describe('repairFocusedSubjectVerb — success', () => {
  it('grounds all three fields against the sentence on a well-formed response', async () => {
    const provider = new StubProvider([VALID_RESPONSE])
    const result = await repairFocusedSubjectVerb({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result.subject).toEqual({ text: 'The sensor', start: 0, end: 10 })
    expect(result.result.subjectHead).toEqual({ text: 'sensor', start: 4, end: 10 })
    expect(result.result.verb).toEqual({ text: 'recorded', start: 11, end: 19 })
    expect(provider.callCount).toBe(1)
  })
})

describe('repairFocusedSubjectVerb — malformed output triggers exactly one repair', () => {
  it('repairs once on invalid JSON, then succeeds', async () => {
    const provider = new StubProvider(['not valid json', VALID_RESPONSE])
    const result = await repairFocusedSubjectVerb({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('repairs once when a field is missing, then succeeds', async () => {
    const missingField = JSON.stringify({ subject: 'The sensor', verb: 'recorded' })
    const provider = new StubProvider([missingField, VALID_RESPONSE])
    const result = await repairFocusedSubjectVerb({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('repairs once when a field does not resolve as an exact substring, then succeeds', async () => {
    const ungrounded = JSON.stringify({ subject: 'not in the sentence', subjectHead: 'sensor', verb: 'recorded' })
    const provider = new StubProvider([ungrounded, VALID_RESPONSE])
    const result = await repairFocusedSubjectVerb({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })
})

describe('repairFocusedSubjectVerb — repair failure is safe, never a loop', () => {
  it('fails safely without throwing when the repair attempt also fails', async () => {
    const provider = new StubProvider(['bad', 'still bad'])
    const result = await repairFocusedSubjectVerb({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(result.success).toBe(false)
    expect(provider.callCount).toBe(2)
    if (result.success) return
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('never issues more than one repair call', async () => {
    const provider = new StubProvider(['bad', 'bad', 'bad', VALID_RESPONSE])
    await repairFocusedSubjectVerb({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(provider.callCount).toBe(2)
  })
})
