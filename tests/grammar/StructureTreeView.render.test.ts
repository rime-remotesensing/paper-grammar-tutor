import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StructureTreeView } from '../../src/features/grammar/components/StructureTreeView.tsx'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

/**
 * Prototype 2.6G2.2 -- deterministic RENDERED-COMPONENT tests (item 2/3), not only
 * Tree-node-shape tests. Uses react-dom/server's `renderToStaticMarkup` against the real,
 * unmodified `StructureTreeView` component -- no mocking of rendering logic.
 */

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('Prototype 2.6G2.3 item 2/4 -- coordination connector rendered as its own row, exactly once', () => {
  it('a grouped coordinatedPredicate with structured `connector` metadata renders "and" as a standalone connector row, and the predicate itself never repeats it', () => {
    const sentence = 'It is ready and is used.'
    const nodes: StructureTreeNode[] = [
      { text: 'is', role: 'predicate', start: 3, end: 5, children: [] },
      { text: 'is used', role: 'coordinatedPredicate', start: 16, end: 23, connector: { text: 'and', start: 12, end: 15 }, children: [] },
    ]
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes, sentence, structuredSyntax: true }))
    expect(countOccurrences(html, '>and<')).toBe(1)
    expect(html).toContain('coordination-group-connector')
    // The predicate's own VISIBLE text (its structure-tree-text span, not the aria-label
    // which may still mention the connector for a11y context) is untouched by the connector
    // (item 2's "is influenced remains the predicate text" requirement).
    expect(html).toContain('<span class="structure-tree-text">is used</span>')
    expect(html).not.toContain('<span class="structure-tree-text">and is used</span>')
  })

  it('a connector on a node with no sibling to pair with is not rendered (never a standalone connector-only target) -- production never produces this shape, since a coordinated member always has a preceding sibling in the same children array', () => {
    const sentence = 'And it works.'
    const nodes: StructureTreeNode[] = [
      { text: 'it works', role: 'coordinatedPredicate', start: 4, end: 12, connector: { text: 'And', start: 0, end: 3 }, children: [] },
    ]
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes, sentence, structuredSyntax: true }))
    expect(countOccurrences(html, '>And<')).toBe(0)
  })

  it('works identically for "but"/"or" connectors, not only "and"', () => {
    for (const word of ['but', 'or']) {
      const sentence = `It is ready ${word} is used.`
      const nodes: StructureTreeNode[] = [
        { text: 'is', role: 'predicate', start: 3, end: 5, children: [] },
        {
          text: 'is used',
          role: 'coordinatedPredicate',
          start: 16 + (word.length - 3),
          end: 23 + (word.length - 3),
          connector: { text: word, start: 12, end: 12 + word.length },
          children: [],
        },
      ]
      const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes, sentence, structuredSyntax: true }))
      expect(countOccurrences(html, `>${word}<`)).toBe(1)
    }
  })

  it('a node with no connector renders no connector row at all', () => {
    const sentence = 'It works.'
    const nodes: StructureTreeNode[] = [{ text: 'works', role: 'predicate', start: 3, end: 8, children: [] }]
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes, sentence, structuredSyntax: true }))
    expect(html).not.toContain('coordination-group-connector')
  })
})

describe('Prototype 2.6G2.2 item 3 -- structured-syntax nodes are never re-parsed by text-only coordination inference', () => {
  const text = 'by a mixture of geological conditions and environmental factors'

  it('a Stanza-authoritative flat modifier renders as one plain node, not a guessed coordination split', () => {
    const nodes: StructureTreeNode[] = [{ text, role: 'modifier', start: 0, end: text.length, children: [] }]
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes, sentence: text, structuredSyntax: true }))
    expect(html).not.toContain('coordination-group')
    expect(html).toContain(text)
  })

  it('the SAME node still gets the legacy text-split when structuredSyntax is left at its default (false)', () => {
    const nodes: StructureTreeNode[] = [{ text, role: 'modifier', start: 0, end: text.length, children: [] }]
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes, sentence: text }))
    expect(html).toContain('coordination-group')
    expect(html).toContain('geological conditions')
    expect(html).toContain('environmental factors')
  })

  it('an ordinary phrase containing "and" but no coordination shape is unaffected either way', () => {
    const plain = 'increases and decreases over time'
    // No comma-separated head -> parseSimpleCoordinationList already returns null on its own
    // (headParts would be a single un-comma'd run, still valid actually) -- use a genuinely
    // non-matching case: two conjunctions, which parseSimpleCoordinationList always rejects.
    const twoConjunctions = 'increases and decreases and then stabilizes'
    for (const structuredSyntax of [true, false]) {
      const nodes: StructureTreeNode[] = [{ text: twoConjunctions, role: 'modifier', start: 0, end: twoConjunctions.length, children: [] }]
      const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes, sentence: twoConjunctions, structuredSyntax }))
      expect(html).not.toContain('coordination-group')
      expect(html).toContain(twoConjunctions)
    }
    void plain
  })

  it('true structured Tree children (real coordination represented as actual nodes) render fully regardless of the flag', () => {
    const sentence = 'steps: alpha and beta'
    const nodes: StructureTreeNode[] = [
      {
        text: 'steps',
        role: 'modifier',
        start: 0,
        end: 5,
        children: [
          {
            text: 'alpha and beta',
            role: 'enumeration',
            start: 7,
            end: 21,
            children: [
              { text: 'alpha', role: 'other', start: 7, end: 12, children: [] },
              { text: 'beta', role: 'other', start: 17, end: 21, children: [] },
            ],
          },
        ],
      },
    ]
    for (const structuredSyntax of [true, false]) {
      const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes, sentence, structuredSyntax }))
      expect(html).toContain('alpha')
      expect(html).toContain('beta')
    }
  })
})

describe('Prototype 2.6G2.3 item 6 -- coordination/enumeration rendered-component regression suite (A-F)', () => {
  it('(A) every enumeration list item is visible exactly once, and the container never renders its own full-list row', () => {
    const text = 'The team relies on the following items: (1) alpha data collected during the initial phase of the project; (2) beta results measured after calibration; (3) gamma summary.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'relies', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 15 }),
      tok({ id: 4, text: 'on', upos: 'ADP', head: 7, deprel: 'case', start: 16, end: 18 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 7, deprel: 'det', start: 19, end: 22 }),
      tok({ id: 6, text: 'following', upos: 'ADJ', head: 7, deprel: 'amod', start: 23, end: 32 }),
      tok({ id: 7, text: 'items', upos: 'NOUN', head: 3, deprel: 'obl', start: 33, end: 38 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    expect(html).not.toContain('列挙') // the structural container itself never renders as its own row
    // Count only the VISIBLE text spans (not aria-label, which legitimately repeats the same
    // text for accessibility) -- each item's own structure-tree-text span must appear once.
    const visibleTexts = [...html.matchAll(/<span class="structure-tree-text">([^<]*)<\/span>/g)].map((m) => m[1])
    expect(visibleTexts.filter((t) => t.startsWith('(1)')).length).toBe(1)
    expect(visibleTexts.filter((t) => t.startsWith('(2)')).length).toBe(1)
    expect(visibleTexts.filter((t) => t.startsWith('(3)')).length).toBe(1)
  })

  it('(B) predicate coordination renders as member / connector / member, with exactly one connector', () => {
    const text = 'The occurrence is complex and is influenced by rainfall.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'occurrence', upos: 'NOUN', head: 4, deprel: 'nsubj', start: 4, end: 14 }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 4, deprel: 'cop', start: 15, end: 17 }),
      tok({ id: 4, text: 'complex', upos: 'ADJ', head: 0, deprel: 'root', start: 18, end: 25 }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', start: 26, end: 29 }),
      tok({ id: 6, text: 'is', upos: 'AUX', head: 7, deprel: 'aux:pass', start: 30, end: 32 }),
      tok({ id: 7, text: 'influenced', upos: 'VERB', head: 4, deprel: 'conj', start: 33, end: 43 }),
      tok({ id: 8, text: 'by', upos: 'ADP', head: 9, deprel: 'case', start: 44, end: 46 }),
      tok({ id: 9, text: 'rainfall', upos: 'NOUN', head: 7, deprel: 'obl', start: 47, end: 55 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    expect((html.match(/>and</g) ?? []).length).toBe(1)
    expect(html).toContain('coordination-group-connector">and<')
    expect(html).toContain('<span class="structure-tree-text">is influenced</span>')
    expect(html).not.toContain('<span class="structure-tree-text">and is influenced</span>')
  })

  it('(C) NP-internal coordination from structured conj renders as its own member/connector/member group, nested under the shared prefix', () => {
    const text = 'The system depends on a mixture of alpha factors and beta conditions.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'depends', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 18 }),
      tok({ id: 4, text: 'on', upos: 'ADP', head: 6, deprel: 'case', start: 19, end: 21 }),
      tok({ id: 5, text: 'a', upos: 'DET', head: 6, deprel: 'det', start: 22, end: 23 }),
      tok({ id: 6, text: 'mixture', upos: 'NOUN', head: 3, deprel: 'obl', start: 24, end: 31 }),
      tok({ id: 7, text: 'of', upos: 'ADP', head: 9, deprel: 'case', start: 32, end: 34 }),
      tok({ id: 8, text: 'alpha', upos: 'ADJ', head: 9, deprel: 'amod', start: 35, end: 40 }),
      tok({ id: 9, text: 'factors', upos: 'NOUN', head: 6, deprel: 'nmod', start: 41, end: 48 }),
      tok({ id: 10, text: 'and', upos: 'CCONJ', head: 12, deprel: 'cc', start: 49, end: 52 }),
      tok({ id: 11, text: 'beta', upos: 'ADJ', head: 12, deprel: 'amod', start: 53, end: 57 }),
      tok({ id: 12, text: 'conditions', upos: 'NOUN', head: 9, deprel: 'conj', start: 58, end: 68 }),
      tok({ id: 13, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 68, end: 69 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    expect((html.match(/>and</g) ?? []).length).toBe(1)
    expect(html).toContain('<span class="structure-tree-text">on a mixture of</span>')
    expect(html).toContain('<span class="structure-tree-text">alpha factors</span>')
    expect(html).toContain('<span class="structure-tree-text">beta conditions</span>')
  })

  it('(D) no regression to the old incorrect text-based split boundary ("a mixture of X" as one side, "and Y" as the other)', () => {
    const text = 'The system depends on a mixture of alpha factors and beta conditions.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'depends', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 18 }),
      tok({ id: 4, text: 'on', upos: 'ADP', head: 6, deprel: 'case', start: 19, end: 21 }),
      tok({ id: 5, text: 'a', upos: 'DET', head: 6, deprel: 'det', start: 22, end: 23 }),
      tok({ id: 6, text: 'mixture', upos: 'NOUN', head: 3, deprel: 'obl', start: 24, end: 31 }),
      tok({ id: 7, text: 'of', upos: 'ADP', head: 9, deprel: 'case', start: 32, end: 34 }),
      tok({ id: 8, text: 'alpha', upos: 'ADJ', head: 9, deprel: 'amod', start: 35, end: 40 }),
      tok({ id: 9, text: 'factors', upos: 'NOUN', head: 6, deprel: 'nmod', start: 41, end: 48 }),
      tok({ id: 10, text: 'and', upos: 'CCONJ', head: 12, deprel: 'cc', start: 49, end: 52 }),
      tok({ id: 11, text: 'beta', upos: 'ADJ', head: 12, deprel: 'amod', start: 53, end: 57 }),
      tok({ id: 12, text: 'conditions', upos: 'NOUN', head: 9, deprel: 'conj', start: 58, end: 68 }),
      tok({ id: 13, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 68, end: 69 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    // The OLD text-heuristic boundary would have shown these two exact strings as the split
    // -- neither must appear as a rendered node's own visible text now.
    expect(html).not.toContain('<span class="structure-tree-text">a mixture of alpha factors</span>')
    expect(html).not.toContain('<span class="structure-tree-text">and beta conditions</span>')
  })

  it('(E) coordination nests correctly at different depths in the same tree (predicate coordination + NP-internal coordination together)', () => {
    const text = 'The occurrence is complex and is influenced by a mixture of alpha factors and beta conditions.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'occurrence', upos: 'NOUN', head: 4, deprel: 'nsubj', start: 4, end: 14 }),
      tok({ id: 3, text: 'is', upos: 'AUX', head: 4, deprel: 'cop', start: 15, end: 17 }),
      tok({ id: 4, text: 'complex', upos: 'ADJ', head: 0, deprel: 'root', start: 18, end: 25 }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', start: 26, end: 29 }),
      tok({ id: 6, text: 'is', upos: 'AUX', head: 7, deprel: 'aux:pass', start: 30, end: 32 }),
      tok({ id: 7, text: 'influenced', upos: 'VERB', head: 4, deprel: 'conj', start: 33, end: 43 }),
      tok({ id: 8, text: 'by', upos: 'ADP', head: 10, deprel: 'case', start: 44, end: 46 }),
      tok({ id: 9, text: 'a', upos: 'DET', head: 10, deprel: 'det', start: 47, end: 48 }),
      tok({ id: 10, text: 'mixture', upos: 'NOUN', head: 7, deprel: 'obl', start: 49, end: 56 }),
      tok({ id: 11, text: 'of', upos: 'ADP', head: 13, deprel: 'case', start: 57, end: 59 }),
      tok({ id: 12, text: 'alpha', upos: 'ADJ', head: 13, deprel: 'amod', start: 60, end: 65 }),
      tok({ id: 13, text: 'factors', upos: 'NOUN', head: 10, deprel: 'nmod', start: 66, end: 73 }),
      tok({ id: 14, text: 'and', upos: 'CCONJ', head: 16, deprel: 'cc', start: 74, end: 77 }),
      tok({ id: 15, text: 'beta', upos: 'ADJ', head: 16, deprel: 'amod', start: 78, end: 82 }),
      tok({ id: 16, text: 'conditions', upos: 'NOUN', head: 13, deprel: 'conj', start: 83, end: 93 }),
      tok({ id: 17, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 93, end: 94 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    // Two independent connector boundaries -- predicate-level "and" and NP-level "and" --
    // each shown exactly once (two total), never merged or duplicated across levels.
    expect((html.match(/>and</g) ?? []).length).toBe(2)
    expect(html).toContain('<span class="structure-tree-text">complex</span>')
    expect(html).toContain('<span class="structure-tree-text">is influenced</span>')
    expect(html).toContain('<span class="structure-tree-text">alpha factors</span>')
    expect(html).toContain('<span class="structure-tree-text">beta conditions</span>')
  })

  it('(F) legacy Tree behavior (Stanza syntax unavailable) is unchanged: structuredSyntax=false still applies the old text-based coordination split', () => {
    const text = 'by a mixture of geological conditions and environmental factors'
    const nodes: StructureTreeNode[] = [{ text, role: 'modifier', start: 0, end: text.length, children: [] }]
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes, sentence: text })) // structuredSyntax defaults to false
    expect(html).toContain('coordination-group')
    expect(html).toContain('geological conditions')
    expect(html).toContain('environmental factors')
  })
})
