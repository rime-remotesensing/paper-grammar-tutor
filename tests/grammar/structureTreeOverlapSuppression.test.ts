import { describe, expect, it } from 'vitest'
import { mergeHybridPredicateStructure } from '../../src/features/grammar/domain/hybridPredicateMerger'
import { buildHybridStructureTree, type StructureTreeNode } from '../../src/features/grammar/domain/structureTree'
import { structureTreeNodeSpan } from '../../src/features/grammar/domain/treeReadingMatching'
import type { SentenceCore, Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type { PredicateStructure, ResolvedDependent } from '../../src/features/grammar/schemas/predicateStructure.schema'

function span(sentence: string, text: string, from = 0): Span {
  const start = sentence.indexOf(text, from)
  if (start < 0) throw new Error(`Fixture text not found: ${text}`)
  return { text, start, end: start + text.length }
}

function core(sentence: string, pattern: SentenceCore['pattern'], subject: string, verb: string, slots: Partial<SentenceCore> = {}): SentenceCore {
  return {
    subject: span(sentence, subject),
    subjectHead: span(sentence, subject),
    verb: span(sentence, verb, subject.length),
    indirectObject: null,
    object: null,
    complement: null,
    pattern,
    ...slots,
  }
}

function dependent(sentence: string, text: string, role: ResolvedDependent['role'], from = 0, children: ResolvedDependent['children'] = []): ResolvedDependent {
  return { ...span(sentence, text, from), role, children }
}

function structure(sentence: string, verb: string, dependents: ResolvedDependent[], sentenceModifiers: PredicateStructure['sentenceModifiers'] = []): PredicateStructure {
  return {
    subjectModifiers: [],
    predicates: [{ ...span(sentence, verb), relation: 'main', dependents }],
    sentenceModifiers,
  }
}

function predicateNode(sentence: string, sentenceCore: SentenceCore, raw: PredicateStructure): StructureTreeNode {
  const merged = mergeHybridPredicateStructure(sentence, sentenceCore, raw)
  return buildHybridStructureTree(sentenceCore, merged)[0].children.find((node) => node.role === 'predicate')!
}

describe('Prototype 2.6B — authoritative SVC complement ownership by grounded span', () => {
  const springer = 'Grid units and slope units are the two types of evaluation units most commonly used in LSM (Lima et al. 2022).'
  const springerComplement = 'the two types of evaluation units most commonly used in LSM'

  it('removes the live Springer sibling duplicate by nesting Stage-2 details under the one Stage-1 complement', () => {
    const c = core(springer, 'SVC', 'Grid units and slope units', 'are', { complement: span(springer, springerComplement) })
    const raw = structure(
      springer,
      'are',
      [
        dependent(springer, 'the two types of evaluation units', 'object'),
        dependent(springer, 'most commonly used', 'condition'),
      ],
      [{ ...span(springer, 'in LSM (Lima et al. 2022)'), role: 'clause' }],
    )

    const predicate = predicateNode(springer, c, raw)
    const topComplements = predicate.children.filter((node) => node.role === 'complement')
    expect(topComplements.map((node) => node.text)).toEqual([springerComplement])
    expect(predicate.children.some((node) => node.text === 'the two types of evaluation units')).toBe(false)
    expect(topComplements[0].children.map((node) => [node.text, node.role])).toEqual([
      ['most commonly used', 'condition'],
    ])
    expect(predicate.children.some((node) => node.text === 'in LSM (Lima et al. 2022)')).toBe(false)
  })

  it('keeps the retained complement and its nested detail grounded for Tree interaction', () => {
    const c = core(springer, 'SVC', 'Grid units and slope units', 'are', { complement: span(springer, springerComplement) })
    const predicate = predicateNode(springer, c, structure(springer, 'are', [
      dependent(springer, 'the two types of evaluation units', 'object'),
      dependent(springer, 'most commonly used', 'condition'),
    ], [{ ...span(springer, 'in LSM (Lima et al. 2022)'), role: 'clause' }]))
    const complement = predicate.children.find((node) => node.role === 'complement')!
    expect(structureTreeNodeSpan(complement)).toEqual({ start: 31, end: 90 })
    expect(complement.children[0]).toMatchObject({ text: 'most commonly used', start: 65, end: 83 })
    expect(structureTreeNodeSpan(complement.children[0])).toEqual({ start: 65, end: 90 })
  })

  it('handles a copular function complement without a competing shorter object sibling', () => {
    const sentence = 'The method is a function of temperature.'
    const full = 'a function of temperature'
    const c = core(sentence, 'SVC', 'The method', 'is', { complement: span(sentence, full) })
    const predicate = predicateNode(sentence, c, structure(sentence, 'is', [dependent(sentence, 'a function', 'object')]))
    expect(predicate.children.map((node) => node.text)).toEqual([full])
    expect(predicate.children[0].children).toEqual([])
  })

  it('handles a modified-noun SVC complement without a competing head-NP sibling', () => {
    const sentence = 'The output is the average value measured over the study area.'
    const full = 'the average value measured over the study area'
    const c = core(sentence, 'SVC', 'The output', 'is', { complement: span(sentence, full) })
    const predicate = predicateNode(sentence, c, structure(sentence, 'is', [
      dependent(sentence, 'the average value', 'object'),
      dependent(sentence, 'measured over the study area', 'modifier'),
    ]))
    expect(predicate.children.map((node) => node.text)).toEqual([full])
    expect(predicate.children[0].children.map((node) => node.text)).toEqual(['measured over the study area'])
  })

  it('leaves a simple SVC unchanged apart from enforcing the authoritative complement role', () => {
    const sentence = 'The value is constant.'
    const c = core(sentence, 'SVC', 'The value', 'is', { complement: span(sentence, 'constant') })
    const predicate = predicateNode(sentence, c, structure(sentence, 'is', [dependent(sentence, 'constant', 'object')]))
    expect(predicate.children).toMatchObject([{ text: 'constant', role: 'complement', children: [] }])
  })

  it('does not weaken true SVO object handling', () => {
    const sentence = 'The model estimates the average value.'
    const object = span(sentence, 'the average value')
    const c = core(sentence, 'SVO', 'The model', 'estimates', { object })
    const predicate = predicateNode(sentence, c, structure(sentence, 'estimates', [dependent(sentence, object.text, 'object')]))
    expect(predicate.children).toMatchObject([{ text: object.text, role: 'object' }])
  })

  it('preserves true SVOC object/complement distinction', () => {
    const sentence = 'The correction makes the estimate more accurate.'
    const c = core(sentence, 'SVOC', 'The correction', 'makes', {
      object: span(sentence, 'the estimate'),
      complement: span(sentence, 'more accurate'),
    })
    const predicate = predicateNode(sentence, c, structure(sentence, 'makes', [dependent(sentence, 'the estimate', 'object')]))
    expect(predicate.children.map((node) => [node.text, node.role])).toEqual([
      ['the estimate', 'object'],
      ['more accurate', 'complement'],
    ])
  })

  it('uses offsets rather than text equality when the same text occurs at different spans', () => {
    const sentence = 'value outside; The label is value inside.'
    const insideStart = sentence.lastIndexOf('value')
    const complement = { text: 'value inside', start: insideStart, end: insideStart + 'value inside'.length }
    const c = core(sentence, 'SVC', 'The label', 'is', { complement })
    const raw = structure(sentence, 'is', [
      dependent(sentence, 'value', 'modifier'),
      dependent(sentence, 'value', 'object', insideStart),
    ])
    const predicate = predicateNode(sentence, c, raw)
    expect(predicate.children.map((node) => [node.text, node.start])).toEqual([
      ['value', 0],
      ['value inside', insideStart],
    ])
    expect(predicate.children[1].children).toEqual([])
  })

  it('does not re-parent a merely partial overlap', () => {
    const sentence = 'The value is stable under load.'
    const complement = span(sentence, 'stable under')
    const partial = dependent(sentence, 'under load', 'condition')
    const c = core(sentence, 'SVC', 'The value', 'is', { complement })
    const predicate = predicateNode(sentence, c, structure(sentence, 'is', [partial]))
    expect(predicate.children.map((node) => [node.text, node.role])).toEqual([
      ['stable under', 'complement'],
      ['under load', 'condition'],
    ])
  })

  it('suppresses a citation-bearing sentenceModifier that starts inside authoritative SVC C and crosses its right boundary', () => {
    const c = core(springer, 'SVC', 'Grid units and slope units', 'are', { complement: span(springer, springerComplement) })
    const citationBearing = { ...span(springer, 'in LSM (Lima et al. 2022)'), role: 'clause' as const }
    const raw = structure(springer, 'are', [], [citationBearing])
    const merged = mergeHybridPredicateStructure(springer, c, raw)
    expect(raw.sentenceModifiers).toEqual([citationBearing])
    expect(merged.sentenceModifiers).toEqual([])
    expect(predicateNode(springer, c, raw).children.map((node) => node.text)).toEqual([springerComplement])
  })

  it('retains partial overlap outside sole-predicate SVC complement authority', () => {
    const sentence = 'The model estimates the value under load.'
    const object = span(sentence, 'the value under')
    const modifier = { ...span(sentence, 'under load'), role: 'condition' as const }
    const c = core(sentence, 'SVO', 'The model', 'estimates', { object })
    const merged = mergeHybridPredicateStructure(sentence, c, structure(sentence, 'estimates', [], [modifier]))
    expect(merged.sentenceModifiers).toEqual([modifier])
  })

  it('preserves an already-nested Stage-2 subtree when adopting it under the complement', () => {
    const sentence = 'The output is the value measured in situ.'
    const full = 'the value measured in situ'
    const measured = dependent(sentence, 'measured in situ', 'modifier', 0, [{ ...span(sentence, 'in situ'), role: 'condition' }])
    const c = core(sentence, 'SVC', 'The output', 'is', { complement: span(sentence, full) })
    const predicate = predicateNode(sentence, c, structure(sentence, 'is', [measured]))
    const adopted = predicate.children[0].children[0]
    expect(adopted.text).toBe('measured in situ')
    expect(adopted.children.map((node) => node.text)).toEqual(['in situ'])
  })

  it('uses exact Stage-1 V for an SVC anchor even when Stage 2 over-captures complement-prefix words', () => {
    const c = core(springer, 'SVC', 'Grid units and slope units', 'are', { complement: span(springer, springerComplement) })
    const raw = structure(springer, 'are the two types', [
      dependent(springer, 'of evaluation units', 'object'),
      dependent(springer, 'most commonly used', 'condition'),
    ], [{ ...span(springer, 'in LSM (Lima et al. 2022)'), role: 'clause' }])
    const merged = mergeHybridPredicateStructure(springer, c, raw)
    expect(merged.predicates[0]).toMatchObject({ text: 'are', start: 27, end: 30, isCoreAnchor: true })
    const predicate = buildHybridStructureTree(c, merged)[0].children[0]
    expect(predicate).toMatchObject({ text: 'are', start: 27, end: 30, role: 'predicate' })
    expect(predicate.children[0].children.map((node) => node.text)).toEqual(['most commonly used'])
  })
})
