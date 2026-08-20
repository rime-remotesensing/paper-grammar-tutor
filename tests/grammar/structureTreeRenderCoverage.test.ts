import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES } from '../../benchmark/generalization/dataset.ts'
import { BLIND_HOLDOUT_V2 } from '../../benchmark/generalization/blindHoldoutV2.ts'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { buildStanzaHierarchicalTree, recoverSurfaceEnumeration } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import { StructureTreeView } from '../../src/features/grammar/components/StructureTreeView.tsx'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.2 item 5 -- two new "user-visible coverage" gates, complementary to (never
 * replacing) the existing lexical-loss/duplicate hard gates in
 * stanzaStructureTreeRegression.test.ts. Lexical loss only validates nodes that ALREADY
 * exist in the tree; it cannot catch a canonical slot that silently failed to become a node
 * at all (the live "C = very complex -> null" failure) or an enumeration that never made it
 * into the tree (the live KNN-GCN failure). These gates check coverage instead: does every
 * piece of authority content that SHOULD be representable actually end up represented.
 */

interface RawParsedCase {
  id: string
  text: string
  tokens: StanzaToken[]
}

function loadRaw(fileName: string): RawParsedCase[] {
  const filePath = path.join(process.cwd(), 'benchmark', 'results', 'generalization', fileName)
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { results: RawParsedCase[] }
  return parsed.results
}

const SPLITS: Array<{ name: string; cases: readonly { id: string; text: string }[]; rawFile: string }> = [
  { name: 'development', cases: DEVELOPMENT_CASES, rawFile: 'stanza-development.json' },
  { name: 'former holdout', cases: LOCKED_HOLDOUT_CASES, rawFile: 'stanza-holdout.json' },
  { name: 'blind holdout v2', cases: BLIND_HOLDOUT_V2, rawFile: 'stanza-blind-v2.json' },
]

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

describe('Prototype 2.6G2.2 item 5A -- canonical-slot render coverage (96-sentence corpus)', () => {
  let missingArtifact = false
  for (const split of SPLITS) {
    if (!fs.existsSync(path.join(process.cwd(), 'benchmark', 'results', 'generalization', split.rawFile))) missingArtifact = true
  }

  it.skipIf(missingArtifact)('every non-null canonical S/V/IO/O/C span is represented in the rendered Tree with the correct role', () => {
    let total = 0
    let subjectCovered = 0
    let subjectExpected = 0
    let verbCovered = 0
    let verbExpected = 0
    let ioCovered = 0
    let ioExpected = 0
    let objectCovered = 0
    let objectExpected = 0
    let complementCovered = 0
    let complementExpected = 0
    const failures: string[] = []

    for (const split of SPLITS) {
      const raw = loadRaw(split.rawFile)
      for (const item of split.cases) {
        const parsed = raw.find((entry) => entry.id === item.id)
        if (!parsed) continue
        total += 1

        const { coreSet } = buildSentenceCoreSetFromStanzaTokens(item.text, parsed.tokens)
        if (coreSet.predicateCores.length === 0) continue
        const tree = buildStanzaHierarchicalTree(item.text, parsed.tokens)
        const flat = flatten(tree)

        const has = (role: string, span: { start: number; end: number }) => flat.some((n) => n.role === role && n.start === span.start && n.end === span.end)

        if (coreSet.subject) {
          subjectExpected += 1
          if (has('subject', coreSet.subject)) subjectCovered += 1
          else failures.push(`${split.name}/${item.id}: subject "${coreSet.subject.text}" not covered`)
        }
        for (const core of coreSet.predicateCores) {
          if (core.verb) {
            verbExpected += 1
            if (has('predicate', core.verb) || has('coordinatedPredicate', core.verb)) verbCovered += 1
            else failures.push(`${split.name}/${item.id}: verb "${core.verb.text}" not covered`)
          }
          if (core.indirectObject) {
            ioExpected += 1
            if (has('indirectObject', core.indirectObject)) ioCovered += 1
            else failures.push(`${split.name}/${item.id}: indirectObject "${core.indirectObject.text}" not covered`)
          }
          if (core.object) {
            objectExpected += 1
            if (has('object', core.object)) objectCovered += 1
            else failures.push(`${split.name}/${item.id}: object "${core.object.text}" not covered`)
          }
          if (core.complement) {
            // Prototype 2.6G2.6: the Tree layer's own complement decomposition now carries
            // the same island-restriction fix as canonical authority grounding, so the
            // `d15-svc-svc-coordination` exception this gate previously needed (2.6G2.5C/C2
            // fixed canonical grounding but left the Tree's own separate builder untouched, by
            // design) is resolved and removed.
            complementExpected += 1
            if (has('complement', core.complement)) complementCovered += 1
            else failures.push(`${split.name}/${item.id}: complement "${core.complement.text}" not covered`)
          }
        }
      }
    }

    if (failures.length > 0) console.error(`Canonical-slot render coverage failures (${failures.length}):\n${failures.slice(0, 50).join('\n')}`)

    expect(total).toBe(96)
    expect(subjectCovered).toBe(subjectExpected)
    expect(verbCovered).toBe(verbExpected)
    expect(ioCovered).toBe(ioExpected)
    expect(objectCovered).toBe(objectExpected)
    expect(complementCovered).toBe(complementExpected)
  })
})

describe('Prototype 2.6G2.2 item 5B -- explicit enumeration render coverage', () => {
  // Each fixture pairs a full token set (the production path) with the position its
  // constituent's own core ends at, so the SAME text-only surface detector -- run
  // standalone, independent of ClauseFrame/PredicateFrame/the dependency-chain walk -- can
  // be checked against what the production Tree actually rendered.
  const fixtures: { name: string; text: string; coreEnd: number; tokens: StanzaToken[] }[] = [
    {
      name: 'drifted long list (no dependency anchor past the first item)',
      text: 'The team relies on the following items: (1) alpha data collected during the initial phase of the project; (2) beta results measured after calibration; (3) gamma summary.',
      coreEnd: 'The team relies on the following items'.length,
      tokens: [
        { id: 1, text: 'The', lemma: null, upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 },
        { id: 2, text: 'team', lemma: null, upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 },
        { id: 3, text: 'relies', lemma: null, upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 15 },
        { id: 4, text: 'on', lemma: null, upos: 'ADP', head: 7, deprel: 'case', start: 16, end: 18 },
        { id: 5, text: 'the', lemma: null, upos: 'DET', head: 7, deprel: 'det', start: 19, end: 22 },
        { id: 6, text: 'following', lemma: null, upos: 'ADJ', head: 7, deprel: 'amod', start: 23, end: 32 },
        { id: 7, text: 'items', lemma: null, upos: 'NOUN', head: 3, deprel: 'obl', start: 33, end: 38 },
      ],
    },
    {
      name: 'final "and" before the last marker',
      text: 'The plan covers the following stages: (1) design; (2) build; and (3) release.',
      coreEnd: 'The plan covers the following stages'.length,
      tokens: [
        { id: 1, text: 'The', lemma: null, upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 },
        { id: 2, text: 'plan', lemma: null, upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 },
        { id: 3, text: 'covers', lemma: null, upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 15 },
        { id: 4, text: 'the', lemma: null, upos: 'DET', head: 6, deprel: 'det', start: 16, end: 19 },
        { id: 5, text: 'following', lemma: null, upos: 'ADJ', head: 6, deprel: 'amod', start: 20, end: 29 },
        { id: 6, text: 'stages', lemma: null, upos: 'NOUN', head: 3, deprel: 'obj', start: 30, end: 36 },
      ],
    },
  ]

  for (const fixture of fixtures) {
    it(`"${fixture.name}" -- independently-detected surface members match the rendered Tree exactly`, () => {
      const independent = recoverSurfaceEnumeration(fixture.text, fixture.coreEnd)
      expect(independent).not.toBeNull()
      expect(independent!.length).toBeGreaterThanOrEqual(2)

      const tree = buildStanzaHierarchicalTree(fixture.text, fixture.tokens)
      const enumerationNode = flatten(tree).find((n) => n.role === 'enumeration')
      expect(enumerationNode).toBeDefined()
      expect(enumerationNode!.children.map((c) => c.text)).toEqual(independent!.map((m) => m.text))
      expect(enumerationNode!.children.map((c) => c.start)).toEqual(independent!.map((m) => m.start))
      expect(enumerationNode!.children).toHaveLength(independent!.length) // exact member-count coverage
    })
  }
})

describe('Prototype 2.6G2.2 item 5 -- rendered-output connector multiplicity', () => {
  it('a fully built coordinated-predicate Tree renders its connector exactly once end-to-end', () => {
    const sentence = 'The occurrence is complex and is influenced by rainfall.'
    const tokens: StanzaToken[] = [
      { id: 1, text: 'The', lemma: null, upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 },
      { id: 2, text: 'occurrence', lemma: null, upos: 'NOUN', head: 4, deprel: 'nsubj', start: 4, end: 14 },
      { id: 3, text: 'is', lemma: null, upos: 'AUX', head: 4, deprel: 'cop', start: 15, end: 17 },
      { id: 4, text: 'complex', lemma: null, upos: 'ADJ', head: 0, deprel: 'root', start: 18, end: 25 },
      { id: 5, text: 'and', lemma: null, upos: 'CCONJ', head: 7, deprel: 'cc', start: 26, end: 29 },
      { id: 6, text: 'is', lemma: null, upos: 'AUX', head: 7, deprel: 'aux:pass', start: 30, end: 32 },
      { id: 7, text: 'influenced', lemma: null, upos: 'VERB', head: 4, deprel: 'conj', start: 33, end: 43 },
      { id: 8, text: 'by', lemma: null, upos: 'ADP', head: 9, deprel: 'case', start: 44, end: 46 },
      { id: 9, text: 'rainfall', lemma: null, upos: 'NOUN', head: 7, deprel: 'obl', start: 47, end: 55 },
    ]
    const tree = buildStanzaHierarchicalTree(sentence, tokens)
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence, structuredSyntax: true }))
    const andOccurrences = (html.match(/>and</g) ?? []).length
    expect(andOccurrences).toBe(1)
  })
})
