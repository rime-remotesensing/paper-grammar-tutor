import { describe, expect, it } from 'vitest'
import { analyzeReadingGuide } from '../../src/features/grammar/domain/ReadingGuideAnalyzer'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

const SENTENCE = 'Data was recorded every 1 nm in the 0.4 to 0.8 μm region.'

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

const VALID_RESPONSE = JSON.stringify({
  readingSteps: [
    { text: 'Data', cue: '何について？', explanation: '主語。' },
    { text: 'was recorded', cue: 'どうなった？', explanation: '受動態。' },
    { text: 'every 1 nm', cue: 'どの間隔で？', explanation: '間隔の情報。' },
    { text: 'in the 0.4 to 0.8 μm region', cue: 'どの範囲で？', explanation: '範囲の情報。' },
  ],
  connections: [{ text: 'every 1 nm と in the 0.4 to 0.8 μm region', explanation: '間隔とその範囲の関係。' }],
  expressions: [
    { text: 'was recorded', pattern: 'be + past participle', meaning: '〜される', function: '受動態。' },
    { text: 'every 1 nm', pattern: 'every + number + unit', meaning: '〜ごとに', function: '間隔を示す。' },
  ],
  readingAdvice: ['まずDataとwas recordedで文の核を確定する。'],
})

describe('analyzeReadingGuide — Prototype 2.3C (no sentenceCore dependency)', () => {
  it('succeeds on the first valid, well-grounded response', async () => {
    const provider = new StubProvider([VALID_RESPONSE])
    const result = await analyzeReadingGuide({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(provider.callCount).toBe(1)
    expect(result.readingGuide.readingSteps.map((s) => s.text)).toEqual([
      'Data',
      'was recorded',
      'every 1 nm',
      'in the 0.4 to 0.8 μm region',
    ])
    expect(result.readingGuide.expressions.map(({ text }) => text)).toEqual(['every 1 nm'])
    expect(result.readingGuide.connections).toHaveLength(1)
  })

  it('repairs once when the first response is invalid JSON, then succeeds', async () => {
    const provider = new StubProvider(['not valid json', VALID_RESPONSE])
    const result = await analyzeReadingGuide({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
    })

    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('repairs once when the first response has an out-of-order readingStep, then succeeds', async () => {
    const outOfOrderResponse = JSON.stringify({
      readingSteps: [
        { text: 'was recorded', cue: 'どうなった？', explanation: '受動態。' },
        { text: 'Data', cue: '何について？', explanation: '主語。' },
      ],
      connections: [],
      expressions: [],
      readingAdvice: [],
    })
    const provider = new StubProvider([outOfOrderResponse, VALID_RESPONSE])
    const result = await analyzeReadingGuide({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
    })

    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('fails safely (without throwing) when the repair attempt also fails', async () => {
    const provider = new StubProvider(['not valid json', 'still not valid json'])
    const result = await analyzeReadingGuide({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
    })

    expect(result.success).toBe(false)
    expect(provider.callCount).toBe(2)
    if (result.success) return
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('fails safely when readingSteps text is never groundable, even after one repair', async () => {
    const ungroundedResponse = JSON.stringify({
      readingSteps: [{ text: 'this text is not in the sentence at all', cue: 'x', explanation: 'x' }],
      connections: [],
      expressions: [],
      readingAdvice: [],
    })
    const provider = new StubProvider([ungroundedResponse, ungroundedResponse])
    const result = await analyzeReadingGuide({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
    })

    expect(result.success).toBe(false)
    expect(provider.callCount).toBe(2)
  })

  it('never issues more than one repair call (no repair loops)', async () => {
    const provider = new StubProvider(['bad', 'bad', 'bad', VALID_RESPONSE])
    await analyzeReadingGuide({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(provider.callCount).toBe(2)
  })
})
