import { beforeEach, describe, expect, it } from 'vitest'
import { getReadingGuide, resetReadingGuideCache } from '../../src/features/grammar/domain/readingGuideService'
import type { TreeReadingTarget } from '../../src/features/grammar/domain/treeReadingTargets'
import type { SentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type { GenerateStructuredRequest, GenerateStructuredResult, HealthStatus, LLMProvider, ModelInfo } from '../../src/llm/types'

const SENTENCE = 'Data was recorded.'
const RESPONSE = JSON.stringify({ readingSteps: [{ targetId: 'tree-0', guidance: 'Dataを先に受け取る。' }], expressions: [] })
const TARGET: TreeReadingTarget = {
  targetId: 'tree-0', nodeKey: '0:4:subject', authoritativeStart: 0, authoritativeEnd: 4,
  interactionStart: 0, interactionEnd: 4, displayText: 'Data', authorityText: 'Data', interactionText: 'Data',
  role: 'subject', parentTargetId: null, parentDisplayText: null,
}
const CORE: SentenceCore = {
  subject: { text: 'Data', start: 0, end: 4 }, subjectHead: { text: 'Data', start: 0, end: 4 },
  verb: { text: 'was recorded', start: 5, end: 17 }, indirectObject: null, object: null, complement: null, pattern: 'SV',
}

class Provider implements LLMProvider {
  callCount = 0
  private readonly response: string
  constructor(response = RESPONSE) { this.response = response }
  async listModels(): Promise<ModelInfo[]> { return [] }
  async healthCheck(): Promise<HealthStatus> { return { ok: true, message: 'ok' } }
  async generateStructured(_request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    this.callCount += 1
    return { rawText: this.response, elapsedMs: 1 }
  }
}

beforeEach(resetReadingGuideCache)

function params(provider: Provider, targets: TreeReadingTarget[] = [TARGET]) {
  return { provider, model: 'test-model', originalText: SENTENCE, sentenceCore: CORE, targets, temperature: 0.1 }
}

describe('getReadingGuide — target-signature cache', () => {
  it('reuses one generation for the same sentence/model/core/targets', async () => {
    const provider = new Provider()
    await getReadingGuide(params(provider))
    await getReadingGuide(params(provider))
    expect(provider.callCount).toBe(1)
  })

  it('invalidates when final Tree target interaction materially changes', async () => {
    const provider = new Provider()
    await getReadingGuide(params(provider))
    await getReadingGuide(params(provider, [{ ...TARGET, interactionEnd: 17, interactionText: 'Data was recorded' }]))
    expect(provider.callCount).toBe(2)
  })

  it('invalidates when stable target IDs or display presentation change', async () => {
    const provider = new Provider()
    await getReadingGuide(params(provider))
    await getReadingGuide(params(provider, [{ ...TARGET, targetId: 'tree-1', displayText: 'Data item' }]))
    expect(provider.callCount).toBe(2)
  })

  it('still invalidates on model and effective core changes', async () => {
    const provider = new Provider()
    const base = params(provider)
    await getReadingGuide(base)
    await getReadingGuide({ ...base, model: 'other-model' })
    await getReadingGuide({ ...base, sentenceCore: { ...CORE, pattern: 'other' } })
    expect(provider.callCount).toBe(3)
  })

  it('evicts failed generations so retry calls the model again', async () => {
    const provider = new Provider('bad')
    expect((await getReadingGuide(params(provider))).success).toBe(false)
    const afterFirst = provider.callCount
    expect((await getReadingGuide(params(provider))).success).toBe(false)
    expect(provider.callCount).toBeGreaterThan(afterFirst)
  })

  it('invalidates for a differently repaired final Tree even when IDs and spans stay stable', async () => {
    const provider = new Provider()
    await getReadingGuide(params(provider))
    await getReadingGuide(params(provider, [{
      ...TARGET,
      nodeKey: '0:4:repaired-subject',
      authorityText: 'Repaired Data',
      interactionText: 'Repaired Data',
      parentDisplayText: 'repaired parent',
    }]))
    expect(provider.callCount).toBe(2)
  })

  it('does not reuse a target-identical cache entry across different sentence text', async () => {
    const provider = new Provider()
    const base = params(provider)
    await getReadingGuide(base)
    await getReadingGuide({ ...base, originalText: 'Data was recorded twice.' })
    expect(provider.callCount).toBe(2)
  })
})
