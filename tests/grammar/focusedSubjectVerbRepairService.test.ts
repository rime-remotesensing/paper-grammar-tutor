import { beforeEach, describe, expect, it } from 'vitest'
import { getFocusedSubjectVerbRepair, resetFocusedSubjectVerbRepairCache } from '../../src/features/grammar/domain/focusedSubjectVerbRepairService'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

const SENTENCE = 'The sensor recorded data.'
const RAW_SUBJECT = { text: 'The sensor recorded data', start: 0, end: 25 }
const RAW_SUBJECT_HEAD = { text: 'sensor', start: 4, end: 10 }
const RAW_VERB = { text: 'recorded', start: 11, end: 19 }

const VALID_RESPONSE = JSON.stringify({ subject: 'The sensor', subjectHead: 'sensor', verb: 'recorded' })

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
  resetFocusedSubjectVerbRepairCache()
})

describe('getFocusedSubjectVerbRepair — caching', () => {
  it('calls the LLM only once for repeated requests with the same key', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const params = {
      provider,
      model: 'test-model',
      originalText: SENTENCE,
      rawSubject: RAW_SUBJECT,
      rawSubjectHead: RAW_SUBJECT_HEAD,
      rawVerb: RAW_VERB,
      temperature: 0.1,
    }
    await getFocusedSubjectVerbRepair(params)
    await getFocusedSubjectVerbRepair(params)
    expect(provider.callCount).toBe(1)
  })

  it('invalidates the cache when the model changes', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, originalText: SENTENCE, rawSubject: RAW_SUBJECT, rawSubjectHead: RAW_SUBJECT_HEAD, rawVerb: RAW_VERB, temperature: 0.1 }
    await getFocusedSubjectVerbRepair({ ...base, model: 'model-a' })
    await getFocusedSubjectVerbRepair({ ...base, model: 'model-b' })
    expect(provider.callCount).toBe(2)
  })

  it('does not reuse the cache across different sentence text', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, model: 'test-model', rawSubject: RAW_SUBJECT, rawSubjectHead: RAW_SUBJECT_HEAD, rawVerb: RAW_VERB, temperature: 0.1 }
    await getFocusedSubjectVerbRepair({ ...base, originalText: SENTENCE })
    await getFocusedSubjectVerbRepair({ ...base, originalText: 'The sensor recorded data twice.' })
    expect(provider.callCount).toBe(2)
  })

  it('evicts a failed generation from the cache so a retry calls the LLM again', async () => {
    const provider = new FailingProvider()
    const params = {
      provider,
      model: 'test-model',
      originalText: SENTENCE,
      rawSubject: RAW_SUBJECT,
      rawSubjectHead: RAW_SUBJECT_HEAD,
      rawVerb: RAW_VERB,
      temperature: 0.1,
    }
    const first = await getFocusedSubjectVerbRepair(params)
    expect(first.success).toBe(false)
    const callsAfterFirstFailure = provider.callCount

    const second = await getFocusedSubjectVerbRepair(params)
    expect(second.success).toBe(false)
    expect(provider.callCount).toBeGreaterThan(callsAfterFirstFailure)
  })
})
