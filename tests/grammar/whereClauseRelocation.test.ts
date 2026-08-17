import { beforeEach, describe, expect, it } from 'vitest'
import { applyFocusedWhereClauseRepair } from '../../src/features/grammar/domain/whereClauseRelocation'
import { resetFocusedWhereClauseRepairCache } from '../../src/features/grammar/domain/focusedWhereClauseRepairService'
import { mergeHybridPredicateStructure } from '../../src/features/grammar/domain/hybridPredicateMerger'
import type { SentenceCore, Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type { PredicateStructure } from '../../src/features/grammar/schemas/predicateStructure.schema'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

// Prototype 2.5W — Focused Where-Clause Repair orchestration/relocation tests. The most
// important test here (the last one) directly reproduces the exact 2.5V-discovered
// flattening bug scenario end-to-end through the REAL merger, confirming the item 27/28 fix
// (restricting candidates to merger-accepted predicates only) actually prevents it in the
// wired production code — not just in the spike.

function span(text: string, start: number): Span {
  return { text, start, end: start + text.length }
}

function coreOf(overrides: Partial<SentenceCore>): SentenceCore {
  return { subject: null, subjectHead: null, verb: null, indirectObject: null, object: null, complement: null, pattern: 'other', ...overrides }
}

beforeEach(() => {
  resetFocusedWhereClauseRepairCache()
})

class StubProvider implements LLMProvider {
  callCount = 0
  private readonly response: string | null

  constructor(response: string | null) {
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
    if (this.response === null) throw new Error('focused where-clause repair should not have been called')
    return { rawText: this.response, elapsedMs: 1 }
  }
}

describe('applyFocusedWhereClauseRepair — gate not applicable', () => {
  it('returns the structure unchanged and does not call the LLM when there is no candidate clause', async () => {
    const sentence = 'We use a model.'
    const core = coreOf({ subject: span('We', 0), verb: span('use', 3), pattern: 'SVO' })
    const structure: PredicateStructure = {
      subjectModifiers: [],
      predicates: [{ ...span('use', 3), relation: 'main', dependents: [{ ...span('a model', 7), role: 'object', children: [] }] }],
      sentenceModifiers: [],
    }
    const provider = new StubProvider(null)
    const outcome = await applyFocusedWhereClauseRepair({ provider, model: 'test-model', temperature: 0.1, sentence, sentenceCore: core, structure })
    expect(outcome.status).toBe('not_applicable')
    expect(outcome.structure).toBe(structure)
    expect(provider.callCount).toBe(0)
  })
})

describe('applyFocusedWhereClauseRepair — abstain', () => {
  it('leaves the structure unchanged when the focused call returns owner=null', async () => {
    const sentence = 'We use a model where x is the input and y is the output.'
    const core = coreOf({ subject: span('We', 0), verb: span('use', 3), pattern: 'SVO' })
    const structure: PredicateStructure = {
      subjectModifiers: [],
      predicates: [{ ...span('use', 3), relation: 'main', dependents: [{ ...span('a model', 7), role: 'object', children: [] }] }],
      sentenceModifiers: [{ text: 'where x is the input and y is the output', start: 15, end: 55, role: 'clause' }],
    }
    const response = JSON.stringify({ owner: null, children: ['x is the input and y is the output'] })
    const provider = new StubProvider(response)
    const outcome = await applyFocusedWhereClauseRepair({ provider, model: 'test-model', temperature: 0.1, sentence, sentenceCore: core, structure })
    expect(outcome.status).toBe('abstained')
    expect(outcome.structure).toEqual(structure)
    expect(outcome.structure.sentenceModifiers).toHaveLength(1)
  })
})

describe('applyFocusedWhereClauseRepair — failure is safe', () => {
  it('leaves the structure unchanged when the focused call fails technically', async () => {
    const sentence = 'We use a model where x is the input and y is the output.'
    const core = coreOf({ subject: span('We', 0), verb: span('use', 3), pattern: 'SVO' })
    const structure: PredicateStructure = {
      subjectModifiers: [],
      predicates: [{ ...span('use', 3), relation: 'main', dependents: [{ ...span('a model', 7), role: 'object', children: [] }] }],
      sentenceModifiers: [{ text: 'where x is the input and y is the output', start: 15, end: 55, role: 'clause' }],
    }
    const provider = new StubProvider('not valid json') // fails validation on both attempts
    const outcome = await applyFocusedWhereClauseRepair({ provider, model: 'test-model', temperature: 0.1, sentence, sentenceCore: core, structure })
    expect(outcome.status).toBe('failed')
    expect(outcome.structure).toEqual(structure)
  })
})

describe('applyFocusedWhereClauseRepair — successful relocation (item 40/41)', () => {
  it('moves the where-clause into the owner predicate\'s dependents and removes it from sentenceModifiers', async () => {
    const sentence = 'We use a model where x is the input and y is the output.'
    const core = coreOf({ subject: span('We', 0), verb: span('use', 3), pattern: 'SVO' })
    const structure: PredicateStructure = {
      subjectModifiers: [],
      predicates: [{ ...span('use', 3), relation: 'main', dependents: [{ ...span('a model', 7), role: 'object', children: [] }] }],
      sentenceModifiers: [{ text: 'where x is the input and y is the output', start: 15, end: 55, role: 'clause' }],
    }
    const response = JSON.stringify({ owner: 'use', children: ['x is the input', 'y is the output'] })
    const provider = new StubProvider(response)
    const outcome = await applyFocusedWhereClauseRepair({ provider, model: 'test-model', temperature: 0.1, sentence, sentenceCore: core, structure })
    expect(outcome.status).toBe('repaired')
    expect(outcome.structure.sentenceModifiers).toEqual([])
    expect(outcome.structure.predicates[0].dependents).toHaveLength(2)
    const clauseDep = outcome.structure.predicates[0].dependents.find((d) => d.role === 'clause')
    expect(clauseDep?.text).toBe('where x is the input and y is the output')
    expect(clauseDep?.children.map((c) => c.text)).toEqual(['x is the input', 'y is the output'])
  })
})

describe('applyFocusedWhereClauseRepair — end-to-end no-flattening confirmation (Prototype 2.5V critical finding, item 44)', () => {
  it('children survive genuinely NESTED (not flattened into sentenceModifiers) through the real merger, even though the raw structure also contains a doomed pseudo-predicate ("using") that will be rejected', async () => {
    // Exact CASE B shape: raw Stage 2 offers "using" as a second predicate candidate, which
    // classifyAcceptedPredicates will reject (no coordination evidence). The relocation
    // orchestration must offer the focused call ONLY the accepted candidate ("can be
    // rotated"), so the clause attaches somewhere that survives the merger intact.
    const sentence =
      'This regression line can be rotated to the horizontal to normalize the data using the equation [EQUATION_6] where Ln is the normalized radiance.'
    const core = coreOf({ subject: span('This regression line', 0), verb: span('can be rotated', 21), pattern: 'SVC' })
    const structure: PredicateStructure = {
      subjectModifiers: [],
      predicates: [
        {
          ...span('can be rotated', 21),
          relation: 'main',
          dependents: [
            { ...span('to the horizontal', 36), role: 'condition', children: [] },
            { ...span('to normalize the data', 54), role: 'object', children: [] },
          ],
        },
        {
          ...span('using', 76),
          relation: 'coordinated',
          dependents: [{ ...span('the equation [EQUATION_6]', 82), role: 'object', children: [] }],
        },
      ],
      sentenceModifiers: [
        { text: 'where Ln is the normalized radiance', start: 108, end: 143, role: 'clause' },
      ],
    }

    // Sanity: confirm the candidate list the focused call actually receives is restricted to
    // the accepted predicate only.
    let capturedUserPrompt = ''
    class CapturingProvider implements LLMProvider {
      async listModels(): Promise<ModelInfo[]> {
        return []
      }
      async healthCheck(): Promise<HealthStatus> {
        return { ok: true, message: 'ok' }
      }
      async generateStructured(request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
        capturedUserPrompt = request.userPrompt
        return {
          rawText: JSON.stringify({ owner: 'can be rotated', children: ['Ln is the normalized radiance'] }),
          elapsedMs: 1,
        }
      }
    }
    const provider = new CapturingProvider()

    const outcome = await applyFocusedWhereClauseRepair({ provider, model: 'test-model', temperature: 0.1, sentence, sentenceCore: core, structure })
    expect(outcome.status).toBe('repaired')
    expect(capturedUserPrompt).toContain('"can be rotated"')
    expect(capturedUserPrompt).not.toContain('"using"')

    // Now run the REAL merger on the repaired structure — "using" is still present and will
    // still be rejected (no coordination evidence), triggering 2.5S's salvage path for ITS
    // OWN dependent (the equation) -- but the where-clause+children, having been relocated
    // onto the SURVIVING "can be rotated" predicate BEFORE the merge, must remain genuinely
    // nested, never flattened into sentenceModifiers as siblings.
    const hybrid = mergeHybridPredicateStructure(sentence, core, outcome.structure)
    expect(hybrid.dropped).toContainEqual({ text: 'using', reason: 'no coordination evidence after "can be rotated"' })

    const anchor = hybrid.predicates.find((p) => p.isCoreAnchor)
    const clauseDependent = anchor?.dependents.find((d) => d.role === 'clause')
    expect(clauseDependent).toBeDefined()
    expect(clauseDependent?.children.map((c) => c.text)).toEqual(['Ln is the normalized radiance'])

    // The critical negative assertion: the child text must NOT also appear as a flattened
    // top-level sentenceModifier sibling.
    expect(hybrid.sentenceModifiers.some((m) => m.text === 'Ln is the normalized radiance')).toBe(false)
  })
})
