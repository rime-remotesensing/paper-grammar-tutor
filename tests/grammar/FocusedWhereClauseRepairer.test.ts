import { describe, expect, it } from 'vitest'
import { repairFocusedWhereClause } from '../../src/features/grammar/domain/FocusedWhereClauseRepairer'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

// Prototype 2.5W — Focused Where-Clause Repair analyzer tests.

const SENTENCE = 'We use a model where x is the input and y is the output.'
const CLAUSE_SPAN = { text: 'where x is the input and y is the output', start: 15, end: 55 }
const CANDIDATES = ['use']

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

const VALID_RESPONSE = JSON.stringify({ owner: 'use', children: ['x is the input', 'y is the output'] })

describe('repairFocusedWhereClause — success', () => {
  it('grounds owner and children against the sentence on a well-formed response', async () => {
    const provider = new StubProvider([VALID_RESPONSE])
    const result = await repairFocusedWhereClause({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      clauseSpan: CLAUSE_SPAN,
      acceptedPredicateCandidates: CANDIDATES,
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result.owner?.text).toBe('use')
    expect(result.result.children.map((c) => c.text)).toEqual(['x is the input', 'y is the output'])
    expect(provider.callCount).toBe(1)
  })
})

describe('repairFocusedWhereClause — owner null (abstain)', () => {
  it('accepts an explicit JSON null owner as a valid abstain result', async () => {
    const response = JSON.stringify({ owner: null, children: ['x is the input and y is the output'] })
    const provider = new StubProvider([response])
    const result = await repairFocusedWhereClause({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      clauseSpan: CLAUSE_SPAN,
      acceptedPredicateCandidates: CANDIDATES,
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result.owner).toBeNull()
  })

  it('normalizes the model\'s string "null" quirk (Prototype 2.5V finding) to a real abstain, not a validation error', async () => {
    const response = JSON.stringify({ owner: 'null', children: ['x is the input and y is the output'] })
    const provider = new StubProvider([response])
    const result = await repairFocusedWhereClause({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      clauseSpan: CLAUSE_SPAN,
      acceptedPredicateCandidates: CANDIDATES,
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result.owner).toBeNull()
    expect(provider.callCount).toBe(1)
  })
})

describe('repairFocusedWhereClause — invalid owner (item 36: no fuzzy invented owner)', () => {
  it('treats an owner not in the candidate list as a graceful abstain, not a hard failure', async () => {
    const response = JSON.stringify({ owner: 'invented predicate text', children: ['x is the input and y is the output'] })
    const provider = new StubProvider([response])
    const result = await repairFocusedWhereClause({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      clauseSpan: CLAUSE_SPAN,
      acceptedPredicateCandidates: CANDIDATES,
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result.owner).toBeNull()
    expect(provider.callCount).toBe(1)
  })
})

describe('repairFocusedWhereClause — invalid child span (item 37/38)', () => {
  it('fails validation when a child does not ground as an exact substring, then repairs once', async () => {
    const invalidChild = JSON.stringify({ owner: 'use', children: ['not a real substring at all'] })
    const provider = new StubProvider([invalidChild, VALID_RESPONSE])
    const result = await repairFocusedWhereClause({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      clauseSpan: CLAUSE_SPAN,
      acceptedPredicateCandidates: CANDIDATES,
    })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('fails validation when a child grounds OUTSIDE the where-clause span, then repairs once', async () => {
    // "We use a model" is a real substring of the sentence, but lies entirely before the
    // clause span -- must be rejected even though it grounds successfully.
    const outsideClause = JSON.stringify({ owner: 'use', children: ['We use a model'] })
    const provider = new StubProvider([outsideClause, VALID_RESPONSE])
    const result = await repairFocusedWhereClause({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      clauseSpan: CLAUSE_SPAN,
      acceptedPredicateCandidates: CANDIDATES,
    })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })
})

describe('repairFocusedWhereClause — child order failure (item 37: source order required)', () => {
  it('fails validation when children are returned out of source order, then repairs once', async () => {
    const outOfOrder = JSON.stringify({ owner: 'use', children: ['y is the output', 'x is the input'] })
    const provider = new StubProvider([outOfOrder, VALID_RESPONSE])
    const result = await repairFocusedWhereClause({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      clauseSpan: CLAUSE_SPAN,
      acceptedPredicateCandidates: CANDIDATES,
    })
    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })
})

describe('repairFocusedWhereClause — repair failure is safe, never a loop', () => {
  it('fails safely without throwing when the repair attempt also fails', async () => {
    const provider = new StubProvider(['bad', 'still bad'])
    const result = await repairFocusedWhereClause({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      clauseSpan: CLAUSE_SPAN,
      acceptedPredicateCandidates: CANDIDATES,
    })
    expect(result.success).toBe(false)
    expect(provider.callCount).toBe(2)
  })

  it('never issues more than one repair call', async () => {
    const provider = new StubProvider(['bad', 'bad', 'bad', VALID_RESPONSE])
    await repairFocusedWhereClause({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      clauseSpan: CLAUSE_SPAN,
      acceptedPredicateCandidates: CANDIDATES,
    })
    expect(provider.callCount).toBe(2)
  })
})
