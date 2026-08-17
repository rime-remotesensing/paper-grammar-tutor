import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StructureTreeView } from '../../src/features/grammar/components/StructureTreeView'
import { mergeHybridPredicateStructure } from '../../src/features/grammar/domain/hybridPredicateMerger'
import { buildHybridStructureTree } from '../../src/features/grammar/domain/structureTree'
import {
  deriveStructureNodePresentation,
  hasLosslessPresentationCoverage,
  prepareLosslessComplementPresentation,
} from '../../src/features/grammar/domain/structureNodePresentation'
import { structureTreeNodeSpan } from '../../src/features/grammar/domain/treeReadingMatching'
import type { SentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type { PredicateStructure } from '../../src/features/grammar/schemas/predicateStructure.schema'

describe('StructureTreeView — Prototype 2.6B2 live SVC presentation', () => {
  it('renders exact V/C/modifier once without a redundant or residual object-head node', () => {
    const sentence = 'Grid units and slope units are the two types of evaluation units most commonly used in LSM (Lima et al. 2022).'
    const complementText = 'the two types of evaluation units most commonly used in LSM'
    const core: SentenceCore = {
      subject: { text: 'Grid units and slope units', start: 0, end: 26 },
      subjectHead: { text: 'units', start: 5, end: 10 },
      verb: { text: 'are', start: 27, end: 30 },
      indirectObject: null,
      object: null,
      complement: { text: complementText, start: 31, end: 90 },
      pattern: 'SVC',
    }
    // The live-corruption control: Stage 2 has swallowed "the two types" into its
    // predicate and left the residual "of evaluation units" as a bogus object.
    const structure: PredicateStructure = {
      subjectModifiers: [],
      predicates: [{
        text: 'are the two types',
        start: 27,
        end: 44,
        relation: 'main',
        dependents: [
          { text: 'of evaluation units', start: 45, end: 64, role: 'object', children: [] },
          { text: 'most commonly used', start: 65, end: 83, role: 'condition', children: [] },
        ],
      }],
      sentenceModifiers: [{ text: 'in LSM (Lima et al. 2022)', start: 84, end: 109, role: 'clause' }],
    }

    const tree = buildHybridStructureTree(core, mergeHybridPredicateStructure(sentence, core, structure))
    const predicate = tree[0].children[0]
    expect(predicate).toMatchObject({ text: 'are', start: 27, end: 30, role: 'predicate' })
    expect(predicate.children[0]).toMatchObject({ text: complementText, start: 31, end: 90, role: 'complement' })
    expect(predicate.children[0].children).toMatchObject([{ text: 'most commonly used', start: 65, end: 83 }])
    expect(predicate.children[0].children[0].presentationSpan).toEqual({
      text: 'most commonly used in LSM',
      start: 65,
      end: 90,
    })
    expect(deriveStructureNodePresentation(predicate.children[0])).toEqual({
      text: 'the two types of evaluation units',
      start: 31,
      end: 64,
    })
    expect(structureTreeNodeSpan(predicate.children[0])).toEqual({ start: 31, end: 90 })
    expect(structureTreeNodeSpan(predicate.children[0].children[0])).toEqual({ start: 65, end: 90 })
    expect(hasLosslessPresentationCoverage(
      { text: complementText, start: 31, end: 90 },
      [{ start: 31, end: 64 }, { start: 65, end: 90 }],
    )).toBe(true)

    const markup = renderToStaticMarkup(createElement(StructureTreeView, { nodes: tree, sentence }))
    expect(markup).toContain('aria-label="are')
    expect(markup).not.toContain('aria-label="are the two types')
    expect(markup).toContain('aria-label="the two types of evaluation units（')
    expect(markup).not.toContain(`aria-label="${complementText}`)
    expect(markup).not.toContain(`>${complementText}</span>`)
    expect(markup.match(/>most commonly used in LSM<\/span>/g)).toHaveLength(1)
    expect(markup).not.toContain('(Lima et al. 2022)（')
    expect(markup).not.toContain('aria-label="of evaluation units（')
    expect(markup).not.toContain('>of evaluation units</span>')
  })

  it('keeps full authoritative text when a complement has no visible decomposition child', () => {
    const node = {
      text: 'a function of temperature',
      start: 14,
      end: 39,
      role: 'complement' as const,
      children: [],
    }
    expect(deriveStructureNodePresentation(node)).toEqual({ text: node.text, start: 14, end: 39 })
  })

  it('derives a non-overlapping base for a modified-noun SVC complement', () => {
    const node = {
      text: 'the average value measured over the study area',
      start: 14,
      end: 60,
      role: 'complement' as const,
      children: [{ text: 'measured over the study area', start: 32, end: 60, role: 'modifier' as const, children: [] }],
    }
    expect(deriveStructureNodePresentation(node)).toEqual({ text: 'the average value', start: 14, end: 31 })
    expect(structureTreeNodeSpan(node)).toEqual({ start: 14, end: 60 })
  })

  it('does not shorten a parent with multiple children or a coordination-sensitive non-complement node', () => {
    const complement = {
      text: 'stable under heat and pressure',
      start: 10,
      end: 40,
      role: 'complement' as const,
      children: [
        { text: 'under heat', start: 17, end: 27, role: 'condition' as const, children: [] },
        { text: 'pressure', start: 32, end: 40, role: 'condition' as const, children: [] },
      ],
    }
    const coordinated = { ...complement, role: 'coordinatedPredicate' as const, children: [complement.children[0]] }
    expect(deriveStructureNodePresentation(complement).text).toBe(complement.text)
    expect(deriveStructureNodePresentation(coordinated).text).toBe(coordinated.text)
  })

  it('falls back to the full parent and hides the child when no grounded evidence owns a lexical suffix', () => {
    const node = {
      text: 'the value measured under load',
      start: 10,
      end: 39,
      role: 'complement' as const,
      children: [{ text: 'measured', start: 20, end: 28, role: 'modifier' as const, children: [] }],
    }
    const prepared = prepareLosslessComplementPresentation(node, [])
    expect(prepared.children).toEqual([])
    expect(deriveStructureNodePresentation(prepared)).toEqual({ text: node.text, start: 10, end: 39 })
  })

  it('does not count an uncovered lexical suffix as lossless', () => {
    expect(hasLosslessPresentationCoverage(
      { text: 'base measured in field', start: 0, end: 22 },
      [{ start: 0, end: 4 }, { start: 5, end: 13 }],
    )).toBe(false)
  })
})
