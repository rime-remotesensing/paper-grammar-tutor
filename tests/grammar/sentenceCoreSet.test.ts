import { describe, expect, it } from 'vitest'
import { llmSentenceCoreSetSchema, type LlmSentenceCoreSet, type SentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import {
  materializeSentenceCoreSet,
  projectPrimaryCore,
  replacePrimaryCoreFromRepair,
  validateGroundedSentenceCoreSet,
} from '../../src/features/grammar/domain/sentenceCoreSet'

const span = (text: string, start: number) => ({ text, start, end: start + text.length })
const subject = span('The model', 0)

function set(predicateCores: LlmSentenceCoreSet['predicateCores']): LlmSentenceCoreSet {
  return { subject, subjectHead: span('model', 4), predicateCores }
}

const main = (verb: string, start: number, slots: Partial<LlmSentenceCoreSet['predicateCores'][number]> = {}) => ({
  connector: null, verb: span(verb, start), indirectObject: null, object: null, complement: null, ...slots,
})
const coordinated = (verb: string, start: number, connectorStart: number, slots: Partial<LlmSentenceCoreSet['predicateCores'][number]> = {}) => ({
  connector: span('and', connectorStart), verb: span(verb, start), indirectObject: null, object: null, complement: null, ...slots,
})

describe('SentenceCoreSet canonical authority', () => {
  it('accepts one, two, and three predicate cores and rejects an empty set', () => {
    expect(llmSentenceCoreSetSchema.safeParse(set([main('runs', 10)])).success).toBe(true)
    expect(llmSentenceCoreSetSchema.safeParse(set([main('runs', 10), coordinated('stops', 19, 15)])).success).toBe(true)
    expect(llmSentenceCoreSetSchema.safeParse(set([main('runs', 10), coordinated('stops', 19, 15), coordinated('waits', 29, 25)])).success).toBe(true)
    expect(llmSentenceCoreSetSchema.safeParse(set([])).success).toBe(false)
  })

  it('derives stable IDs and one pattern per predicate without asking the model', () => {
    const value = materializeSentenceCoreSet(set([
      main('is', 10, { complement: span('stable', 13) }),
      coordinated('predicts', 28, 24, { object: span('rainfall', 37) }),
    ]))
    expect(value.predicateCores.map(({ predicateCoreId, pattern }) => [predicateCoreId, pattern])).toEqual([
      ['predicate-1', 'SVC'], ['predicate-2', 'SVO'],
    ])
  })

  it('projects the first source-order predicate deterministically', () => {
    const value = materializeSentenceCoreSet(set([
      main('is', 10, { complement: span('stable', 13) }),
      coordinated('predicts', 28, 24, { object: span('rainfall', 37) }),
    ]))
    expect(projectPrimaryCore(value)).toMatchObject({ subject, verb: span('is', 10), complement: span('stable', 13), pattern: 'SVC' })
  })

  it.each([
    ['SV', { verb: span('runs', 10) }],
    ['SVC', { verb: span('is', 10), complement: span('stable', 13) }],
    ['SVO', { verb: span('measures', 10), object: span('rainfall', 19) }],
    ['SVOO', { verb: span('gives', 10), indirectObject: span('users', 16), object: span('feedback', 22) }],
    ['SVOC', { verb: span('found', 10), object: span('it', 16), complement: span('useful', 19) }],
  ] as const)('keeps simple %s projection compatible', (pattern, slots) => {
    const value = materializeSentenceCoreSet(set([main(slots.verb.text, slots.verb.start, slots)]))
    expect(value.predicateCores).toHaveLength(1)
    expect(projectPrimaryCore(value).pattern).toBe(pattern)
  })

  it('keeps coordinated complement inside one core when only one finite predicate exists', () => {
    const value = materializeSentenceCoreSet(set([main('is', 12, { complement: span('smooth and uniform', 15) })]))
    expect(value.predicateCores).toHaveLength(1)
    expect(value.predicateCores[0].complement?.text).toBe('smooth and uniform')
  })

  it('normalizes a passive verb that overcaptures one following PP boundary', () => {
    const value = materializeSentenceCoreSet(set([main('is controlled by', 12, { object: span('soil moisture', 29) })]))
    expect(value.predicateCores[0]).toMatchObject({ verb: span('is controlled', 12), object: null, complement: null, pattern: 'SV' })
  })

  it('moves a passive participle out of a bare-copula complement without retaining its PP as C', () => {
    const value = materializeSentenceCoreSet(set([main('is', 12, {
      complement: span('distributed through an open portal', 15),
    })]))
    expect(value.predicateCores[0]).toMatchObject({
      verb: span('is distributed', 12), complement: null, pattern: 'SV',
    })
  })

  it('rejects duplicate/overlapping verbs, wrong ordering, and misplaced connectors after grounding', () => {
    const duplicate = materializeSentenceCoreSet(set([main('runs', 10), coordinated('runs', 10, 6)]))
    expect(validateGroundedSentenceCoreSet(duplicate).some((issue) => issue.includes('overlaps'))).toBe(true)
    const reversed = materializeSentenceCoreSet(set([main('runs', 20), coordinated('stops', 10, 6)]))
    expect(validateGroundedSentenceCoreSet(reversed).some((issue) => issue.includes('source order'))).toBe(true)
    const misplaced = materializeSentenceCoreSet(set([main('runs', 10), coordinated('stops', 20, 30)]))
    expect(validateGroundedSentenceCoreSet(misplaced).some((issue) => issue.includes('connector'))).toBe(true)
  })

  it('applies primary repair evidence without collapsing secondary cores', () => {
    const canonical = materializeSentenceCoreSet(set([main('is', 10), coordinated('is influenced', 30, 26)]))
    const repaired: SentenceCore = {
      subject, subjectHead: span('model', 4), verb: span('is', 10), indirectObject: null,
      object: null, complement: span('stable', 13), pattern: 'SVC',
    }
    const result = replacePrimaryCoreFromRepair(canonical, repaired)
    expect(result.predicateCores).toHaveLength(2)
    expect(result.predicateCores[0].pattern).toBe('SVC')
    expect(result.predicateCores[1].verb?.text).toBe('is influenced')
  })
})
