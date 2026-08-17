import { describe, expect, it } from 'vitest'
import { repairFocusedPassiveCore } from '../../src/features/grammar/domain/FocusedPassiveCoreRepairer'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

// Prototype 2.5Z — Focused Passive-Core Overcomplement Repair analyzer tests.

const SENTENCE =
  'This regression line can be rotated to the horizontal to normalize the data using the equation [EQUATION_6] where Ln is the normalized radiance.'
const VERB = 'can be rotated'

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

describe('repairFocusedPassiveCore — SV success', () => {
  it('accepts pattern=SV with complement=null', async () => {
    const response = JSON.stringify({ pattern: 'SV', complement: null })
    const provider = new StubProvider([response])
    const result = await repairFocusedPassiveCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1, verbText: VERB })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result).toEqual({ pattern: 'SV', complement: null })
    expect(provider.callCount).toBe(1)
  })
})

describe('repairFocusedPassiveCore — SVC success', () => {
  it('accepts pattern=SVC with a grounded complement', async () => {
    const sentence = 'The door was painted red.'
    const response = JSON.stringify({ pattern: 'SVC', complement: 'red' })
    const provider = new StubProvider([response])
    const result = await repairFocusedPassiveCore({ provider, model: 'test-model', sentence, temperature: 0.1, verbText: 'was painted' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result.pattern).toBe('SVC')
    if (result.result.pattern !== 'SVC') return
    expect(result.result.complement).toEqual({ text: 'red', start: 21, end: 24 })
  })
})

describe('repairFocusedPassiveCore — Prototype 2.5Z1 item 12: PP-vs-true-complement semantic distinction', () => {
  it('ordinary PP dependent after passive verb: accepts a SV/null focused result ("is based on observations", the confirmed 2.5Z1 bug case)', async () => {
    const sentence = 'The model is based on observations.'
    const response = JSON.stringify({ pattern: 'SV', complement: null })
    const provider = new StubProvider([response])
    const result = await repairFocusedPassiveCore({ provider, model: 'test-model', sentence, temperature: 0.1, verbText: 'is based' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result).toEqual({ pattern: 'SV', complement: null })
  })

  it('true complement after passive verb: accepts a SVC/complement focused result ("was painted red")', async () => {
    const sentence = 'The door was painted red.'
    const response = JSON.stringify({ pattern: 'SVC', complement: 'red' })
    const provider = new StubProvider([response])
    const result = await repairFocusedPassiveCore({ provider, model: 'test-model', sentence, temperature: 0.1, verbText: 'was painted' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result.pattern).toBe('SVC')
    if (result.result.pattern !== 'SVC') return
    expect(result.result.complement.text).toBe('red')
  })
})

describe('repairFocusedPassiveCore — invalid JSON triggers exactly one repair', () => {
  it('repairs once on invalid JSON, then succeeds', async () => {
    const valid = JSON.stringify({ pattern: 'SV', complement: null })
    const provider = new StubProvider(['not valid json', valid])
    const result = await repairFocusedPassiveCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1, verbText: VERB })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })
})

describe('repairFocusedPassiveCore — inconsistent SV + complement (item 16)', () => {
  it('rejects pattern=SV with a non-null complement, then repairs once', async () => {
    const inconsistent = JSON.stringify({ pattern: 'SV', complement: 'to the horizontal' })
    const valid = JSON.stringify({ pattern: 'SV', complement: null })
    const provider = new StubProvider([inconsistent, valid])
    const result = await repairFocusedPassiveCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1, verbText: VERB })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })
})

describe('repairFocusedPassiveCore — inconsistent SVC + null (item 16)', () => {
  it('rejects pattern=SVC with a null complement, then repairs once', async () => {
    const inconsistent = JSON.stringify({ pattern: 'SVC', complement: null })
    const valid = JSON.stringify({ pattern: 'SV', complement: null })
    const provider = new StubProvider([inconsistent, valid])
    const result = await repairFocusedPassiveCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1, verbText: VERB })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })
})

describe('repairFocusedPassiveCore — ungroundable complement', () => {
  it('rejects an SVC complement that is not a literal substring, then repairs once', async () => {
    const ungrounded = JSON.stringify({ pattern: 'SVC', complement: 'not in the sentence at all' })
    const valid = JSON.stringify({ pattern: 'SV', complement: null })
    const provider = new StubProvider([ungrounded, valid])
    const result = await repairFocusedPassiveCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1, verbText: VERB })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })
})

describe('repairFocusedPassiveCore — provider failure / repair loop safety', () => {
  it('fails safely without throwing when the repair attempt also fails', async () => {
    const provider = new StubProvider(['bad', 'still bad'])
    const result = await repairFocusedPassiveCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1, verbText: VERB })
    expect(result.success).toBe(false)
    expect(provider.callCount).toBe(2)
    if (result.success) return
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('never issues more than one repair call', async () => {
    const valid = JSON.stringify({ pattern: 'SV', complement: null })
    const provider = new StubProvider(['bad', 'bad', 'bad', valid])
    await repairFocusedPassiveCore({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1, verbText: VERB })
    expect(provider.callCount).toBe(2)
  })
})
