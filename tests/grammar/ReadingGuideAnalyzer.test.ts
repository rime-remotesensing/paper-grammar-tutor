import { describe, expect, it } from 'vitest'
import { analyzeReadingGuide } from '../../src/features/grammar/domain/ReadingGuideAnalyzer'
import type { TreeReadingTarget } from '../../src/features/grammar/domain/treeReadingTargets'
import type { GenerateStructuredRequest, GenerateStructuredResult, HealthStatus, LLMProvider, ModelInfo } from '../../src/llm/types'

const SENTENCE = 'The method is based on observations.'
const TARGETS: TreeReadingTarget[] = [{
  targetId: 'tree-0', nodeKey: '0:10:subject', authoritativeStart: 0, authoritativeEnd: 10,
  interactionStart: 0, interactionEnd: 10, displayText: 'The method', authorityText: 'The method',
  interactionText: 'The method', role: 'subject', parentTargetId: null, parentDisplayText: null,
}]
const VALID = JSON.stringify({
  readingSteps: [{ targetId: 'tree-0', guidance: 'まず主語をひとまとまりで受け取る。' }],
  expressions: [{ text: 'is based on', pattern: 'be based on ~', meaning: '〜に基づく', function: 'on以下を根拠として結ぶ。' }],
})

class StubProvider implements LLMProvider {
  callCount = 0
  requests: GenerateStructuredRequest[] = []
  private readonly responses: string[]
  constructor(responses: string[]) { this.responses = responses }
  async listModels(): Promise<ModelInfo[]> { return [] }
  async healthCheck(): Promise<HealthStatus> { return { ok: true, message: 'ok' } }
  async generateStructured(request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    this.requests.push(request)
    const rawText = this.responses[Math.min(this.callCount, this.responses.length - 1)]
    this.callCount += 1
    return { rawText, elapsedMs: 1 }
  }
}

const analyze = (provider: StubProvider) => analyzeReadingGuide({
  provider, model: 'test-model', sentence: SENTENCE, targets: TARGETS, temperature: 0.1,
})

describe('analyzeReadingGuide — Tree-authoritative contract', () => {
  it('supplies target context and returns exact-ID notes plus grounded Expressions', async () => {
    const provider = new StubProvider([VALID])
    const result = await analyze(provider)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.readingGuide.readingSteps).toEqual([{ targetId: 'tree-0', guidance: 'まず主語をひとまとまりで受け取る。' }])
    expect(result.readingGuide.expressions.map(({ pattern }) => pattern)).toEqual(['be based on ~'])
    expect(provider.requests[0]?.userPrompt).toContain('"targetId": "tree-0"')
    expect(provider.requests[0]?.userPrompt).toContain('"displayText": "The method"')
  })

  it('drops and reports unknown returned IDs without failing valid output', async () => {
    const provider = new StubProvider([JSON.stringify({ readingSteps: [
      { targetId: 'invented', guidance: '表示しない。' },
      { targetId: 'tree-0', guidance: 'ひとまとまりで読む。' },
    ], expressions: [] })])
    const result = await analyze(provider)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.invalidTargetIds).toEqual(['invented'])
    expect(result.readingGuide.readingSteps.map(({ targetId }) => targetId)).toEqual(['tree-0'])
  })

  it('repairs invalid JSON once and then succeeds', async () => {
    const provider = new StubProvider(['bad', VALID])
    expect((await analyze(provider)).success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('fails safely after one unsuccessful repair', async () => {
    const provider = new StubProvider(['bad', 'still bad', VALID])
    expect((await analyze(provider)).success).toBe(false)
    expect(provider.callCount).toBe(2)
  })

  it('repairs a schema-invalid response once and then succeeds', async () => {
    const provider = new StubProvider([
      JSON.stringify({ readingSteps: [{ targetId: 'tree-0' }], expressions: [] }),
      VALID,
    ])
    expect((await analyze(provider)).success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('accepts reordered and subset target IDs without a repair call', async () => {
    const provider = new StubProvider([JSON.stringify({
      readingSteps: [{ targetId: 'tree-0', guidance: '主語を先に読む。' }],
      expressions: [],
    })])
    const result = await analyze(provider)
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(1)
  })

  it('reports duplicate returned IDs and exposes no arbitrarily chosen note', async () => {
    const provider = new StubProvider([JSON.stringify({ readingSteps: [
      { targetId: 'tree-0', guidance: '説明A。' },
      { targetId: 'tree-0', guidance: '説明B。' },
    ], expressions: [] })])
    const result = await analyze(provider)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.duplicateTargetIds).toEqual(['tree-0'])
    expect(result.readingGuide.readingSteps).toEqual([])
  })
})
