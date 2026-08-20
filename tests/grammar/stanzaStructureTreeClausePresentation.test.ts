import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StructureTreeView } from '../../src/features/grammar/components/StructureTreeView.tsx'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.5B3 -- Clause Marker / Wrapper / Canonical Coordination Presentation.
 * Rendered-component tests (via react-dom/server's renderToStaticMarkup against the real,
 * unmodified StructureTreeView) plus tree-shape tests for the three general presentation
 * problems the 2.6G2.5B2 live review found: (1) a false extra "and" between the main
 * clause and an unrelated marked subordinate clause, (2) a clause marker fused into the
 * subject's own displayed row, (3) a subjectless clause wrapper duplicating its own single
 * predicate child's text. Also covers item 6's canonical-slot-internal coordination
 * presentation (A-F). Synthetic fixtures, different wording from the real live controls,
 * same dependency shapes.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/** Builds a synthetic token list from a word list, computing exact character offsets via
 * sequential indexOf search -- avoids hand-computed offset arithmetic errors (a repeated
 * source of test bugs in earlier phases of this prototype). */
function wordsToOffsets(text: string, words: string[]): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = []
  let cursor = 0
  for (const word of words) {
    const start = text.indexOf(word, cursor)
    if (start === -1) throw new Error(`word "${word}" not found in text starting at ${cursor}`)
    const end = start + word.length
    out.push({ text: word, start, end })
    cursor = end
  }
  return out
}

describe('Prototype 2.6G2.5B3 item 1 -- no extra connector between the main clause and an unrelated marked subordinate clause', () => {
  it('predicate1 + predicate2 (coordinated) + a subordinate if-clause anchored via the conj chain renders exactly one visible "and"', () => {
    const words = ['The', 'noise', 'interferes', 'with', 'the', 'model', 'and', 'leads', 'failures', 'if', 'there', 'is', 'strong', 'covariance']
    const text = words.join(' ') + '.'
    const o = wordsToOffsets(text, words)
    const at = (w: string) => o.find((x) => x.text === w)!
    const tokens: StanzaToken[] = [
      tok({ id: 1, upos: 'DET', head: 2, deprel: 'det', ...at('The') }),
      tok({ id: 2, upos: 'NOUN', head: 3, deprel: 'nsubj', ...at('noise') }),
      tok({ id: 3, upos: 'VERB', head: 0, deprel: 'root', ...at('interferes') }),
      tok({ id: 4, upos: 'ADP', head: 6, deprel: 'case', ...at('with') }),
      tok({ id: 5, upos: 'DET', head: 6, deprel: 'det', ...at('the') }),
      tok({ id: 6, upos: 'NOUN', head: 3, deprel: 'obl', ...at('model') }),
      tok({ id: 7, upos: 'CCONJ', head: 8, deprel: 'cc', ...at('and') }),
      tok({ id: 8, upos: 'VERB', head: 3, deprel: 'conj', ...at('leads') }),
      tok({ id: 9, upos: 'NOUN', head: 8, deprel: 'obj', ...at('failures') }),
      tok({ id: 10, upos: 'SCONJ', head: 12, deprel: 'mark', ...at('if') }),
      tok({ id: 11, upos: 'PRON', head: 12, deprel: 'expl', ...at('there') }),
      tok({ id: 12, upos: 'VERB', head: 8, deprel: 'advcl', ...at('is') }),
      tok({ id: 13, upos: 'ADJ', head: 14, deprel: 'amod', ...at('strong') }),
      tok({ id: 14, upos: 'NOUN', head: 12, deprel: 'nsubj', ...at('covariance') }),
      tok({ id: 15, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)

    // Tree-shape check: the "if" clause is a top-level sibling with role 'clause' (marker
    // wrapper), never 'subject' -- so it can never be mistaken by the sibling-level
    // coordination grouper for a further coordinated member of the main clause.
    const subordinate = tree.find((n) => n.marker?.text === 'if')!
    expect(subordinate).toBeDefined()
    expect(subordinate.role).toBe('clause')
    const mainNode = tree.find((n) => n.role === 'subject')!
    expect(mainNode).toBeDefined()

    // Rendered check: exactly one visible "and" (the genuine predicate coordination),
    // never a second one before the "if" clause.
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    expect(countOccurrences(html, '>and<')).toBe(1)
  })
})

describe('Prototype 2.6G2.5B3 item 2/5 -- clause marker is structurally and visually separate from the subject it introduces', () => {
  it('a marked subordinate clause never labels the marker as the subject, and the subject\'s own text excludes the marker', () => {
    const words = ['The', 'plan', 'works', 'well', 'if', 'there', 'is', 'strong', 'covariance']
    const text = words.join(' ') + '.'
    const o = wordsToOffsets(text, words)
    const at = (w: string) => o.find((x) => x.text === w)!
    const tokens: StanzaToken[] = [
      tok({ id: 1, upos: 'DET', head: 2, deprel: 'det', ...at('The') }),
      tok({ id: 2, upos: 'NOUN', head: 3, deprel: 'nsubj', ...at('plan') }),
      tok({ id: 3, upos: 'VERB', head: 0, deprel: 'root', ...at('works') }),
      tok({ id: 4, upos: 'ADV', head: 3, deprel: 'advmod', ...at('well') }),
      tok({ id: 5, upos: 'SCONJ', head: 7, deprel: 'mark', ...at('if') }),
      tok({ id: 6, upos: 'PRON', head: 7, deprel: 'expl', ...at('there') }),
      tok({ id: 7, upos: 'VERB', head: 3, deprel: 'advcl', ...at('is') }),
      tok({ id: 8, upos: 'ADJ', head: 9, deprel: 'amod', ...at('strong') }),
      tok({ id: 9, upos: 'NOUN', head: 7, deprel: 'nsubj', ...at('covariance') }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)

    // Prototype 2.6G2.6B item 8/9/10: this fixture is existential (`expl` "there"), so the
    // wrapper's child is now the expletive node (marker -> expletive -> predicate ->
    // subject, English surface-reading order) rather than the subject directly -- the
    // subject is still reachable, still excludes the marker, just nested one level deeper.
    const wrapper = tree.find((n) => n.marker?.text === 'if')!
    expect(wrapper).toBeDefined()
    expect(wrapper.role).toBe('clause')
    const expletive = wrapper.children.find((c) => c.role === 'expletive')!
    expect(expletive).toBeDefined()
    const predicate = expletive.children.find((c) => c.role === 'predicate')!
    expect(predicate).toBeDefined()
    const subject = predicate.children.find((c) => c.role === 'subject')!
    expect(subject).toBeDefined()
    expect(subject.marker).toBeUndefined()
    expect(subject.text).toBe('strong covariance') // never "if strong covariance"

    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    // The marker renders exactly once, and never as part of a 主語-labelled row's own text.
    expect(countOccurrences(html, '>if<')).toBe(1)
    expect(html).not.toContain('if strong covariance')
    expect(html).toContain('<span class="structure-tree-text">strong covariance</span>')
  })
})

describe('Prototype 2.6G2.5B3 item 3 -- existential presentation stays understandable, never implying an ordinary complement reading', () => {
  it('"there" (expl) renders as its own 形式要素-labelled element, distinct from the subject it never equals', () => {
    const words = ['The', 'plan', 'works', 'well', 'if', 'there', 'is', 'strong', 'covariance']
    const text = words.join(' ') + '.'
    const o = wordsToOffsets(text, words)
    const at = (w: string) => o.find((x) => x.text === w)!
    const tokens: StanzaToken[] = [
      tok({ id: 1, upos: 'DET', head: 2, deprel: 'det', ...at('The') }),
      tok({ id: 2, upos: 'NOUN', head: 3, deprel: 'nsubj', ...at('plan') }),
      tok({ id: 3, upos: 'VERB', head: 0, deprel: 'root', ...at('works') }),
      tok({ id: 4, upos: 'ADV', head: 3, deprel: 'advmod', ...at('well') }),
      tok({ id: 5, upos: 'SCONJ', head: 7, deprel: 'mark', ...at('if') }),
      tok({ id: 6, upos: 'PRON', head: 7, deprel: 'expl', ...at('there') }),
      tok({ id: 7, upos: 'VERB', head: 3, deprel: 'advcl', ...at('is') }),
      tok({ id: 8, upos: 'ADJ', head: 9, deprel: 'amod', ...at('strong') }),
      tok({ id: 9, upos: 'NOUN', head: 7, deprel: 'nsubj', ...at('covariance') }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    // Once as the visible role-label span; the aria-label on the same button also mentions
    // it for accessibility, which is a second (non-visible-duplicate) occurrence of the
    // substring -- the actual visible-row check is the role-label span itself.
    expect(countOccurrences(html, '<span class="structure-tree-role">形式要素</span>')).toBe(1)
    expect(countOccurrences(html, '>there<')).toBe(1)
    // "there" is never shown as (part of) the 主語-labelled subject's own text.
    expect(html).not.toContain('<span class="structure-tree-text">there</span>主語')
    const subject = flatten(tree).find((n) => n.role === 'subject' && n.text === 'strong covariance')!
    expect(subject).toBeDefined()
    expect(subject.text).not.toContain('there')
  })
})

describe('Prototype 2.6G2.5B3 item 4 -- subjectless clause wrapper never duplicates its own predicate\'s lexical content', () => {
  it('an infinitival advcl ("to detect...") renders "to" once, its predicate once, and its object once -- no wrapper-level text duplication', () => {
    const words = ['The', 'team', 'built', 'the', 'tool', 'to', 'test', 'the', 'new', 'method']
    const text = words.join(' ') + '.'
    const o = wordsToOffsets(text, words)
    const at = (w: string) => o.find((x) => x.text === w)!
    const tokens: StanzaToken[] = [
      tok({ id: 1, upos: 'DET', head: 2, deprel: 'det', ...at('The') }),
      tok({ id: 2, upos: 'NOUN', head: 3, deprel: 'nsubj', ...at('team') }),
      tok({ id: 3, upos: 'VERB', head: 0, deprel: 'root', ...at('built') }),
      tok({ id: 4, upos: 'DET', head: 5, deprel: 'det', ...at('the') }),
      tok({ id: 5, upos: 'NOUN', head: 3, deprel: 'obj', ...at('tool') }),
      tok({ id: 6, upos: 'PART', head: 7, deprel: 'mark', ...at('to') }),
      tok({ id: 7, upos: 'VERB', head: 3, deprel: 'advcl', ...at('test') }),
      tok({ id: 8, upos: 'DET', head: 10, deprel: 'det', ...o.filter((x) => x.text === 'the')[1]! }),
      tok({ id: 9, upos: 'ADJ', head: 10, deprel: 'amod', ...at('new') }),
      tok({ id: 10, upos: 'NOUN', head: 7, deprel: 'obj', ...at('method') }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)

    const wrapper = tree.find((n) => n.marker?.text === 'to')!
    expect(wrapper).toBeDefined()
    expect(wrapper.role).toBe('clause')
    // Flattened, not double-nested: the wrapper's single child IS the predicate node.
    expect(wrapper.children).toHaveLength(1)
    expect(wrapper.children[0]!.role).toBe('predicate')
    expect(wrapper.children[0]!.text).toBe('test')

    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    expect(countOccurrences(html, '>to<')).toBe(1)
    expect(countOccurrences(html, '>test<')).toBe(1)
    // Visible text row appears exactly once (the aria-label on the same button also mentions
    // it for accessibility -- not a second visible row, so checked via the text span only).
    expect(countOccurrences(html, '<span class="structure-tree-text">the new method</span>')).toBe(1)
  })
})

describe('Prototype 2.6G2.5B3 item 6/8 -- canonical-slot-internal coordination presentation (controls A-F)', () => {
  it('(A) coordinated subject: the canonical authority span stays flat, while presentation decomposes it into 2 connected members', () => {
    const words = ['The', 'variance', 'factor', 'and', 'the', 'correlation', 'method', 'caused', 'problems']
    const text = words.join(' ') + '.'
    const o = wordsToOffsets(text, words)
    const at = (w: string) => o.find((x) => x.text === w)!
    const tokens: StanzaToken[] = [
      tok({ id: 1, upos: 'DET', head: 3, deprel: 'det', ...at('The') }),
      tok({ id: 2, upos: 'NOUN', head: 3, deprel: 'compound', ...at('variance') }),
      tok({ id: 3, upos: 'NOUN', head: 8, deprel: 'nsubj', ...at('factor') }),
      tok({ id: 4, upos: 'CCONJ', head: 7, deprel: 'cc', ...at('and') }),
      tok({ id: 5, upos: 'DET', head: 7, deprel: 'det', ...at('the') }),
      tok({ id: 6, upos: 'NOUN', head: 7, deprel: 'compound', ...at('correlation') }),
      tok({ id: 7, upos: 'NOUN', head: 3, deprel: 'conj', ...at('method') }),
      tok({ id: 8, upos: 'VERB', head: 0, deprel: 'root', ...at('caused') }),
      tok({ id: 9, upos: 'NOUN', head: 8, deprel: 'obj', ...at('problems') }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const subject = tree.find((n) => n.role === 'subject')!
    expect(subject.text).toBe('The variance factor and the correlation method') // authority unchanged
    // Prototype 2.6G2.6C item B/6/7: a coordination member never inherits the canonical
    // 'subject' role a second time -- the container node above already carries it once.
    const members = subject.children.filter((c) => c.role === 'coordinationMember')
    expect(members).toHaveLength(2)
    expect(members[0]!.text).toBe('The variance factor')
    expect(members[1]!.text).toBe('the correlation method')
    expect(members[1]!.connector?.text).toBe('and')
    expect(subject.children.some((c) => c.role === 'predicate' && c.text === 'caused')).toBe(true)
  })

  it('(B) coordinated object decomposes the same way', () => {
    const words = ['The', 'team', 'analyzed', 'the', 'pressure', 'sensor', 'and', 'the', 'temperature', 'sensor']
    const text = words.join(' ') + '.'
    let cursor = 0
    const positions: { text: string; start: number; end: number }[] = []
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      positions.push({ text: w, start, end: start + w.length })
      cursor = start + w.length
    }
    const at = (i: number) => positions[i]!
    const tokens: StanzaToken[] = [
      tok({ id: 1, upos: 'DET', head: 2, deprel: 'det', ...at(0) }),
      tok({ id: 2, upos: 'NOUN', head: 3, deprel: 'nsubj', ...at(1) }),
      tok({ id: 3, upos: 'VERB', head: 0, deprel: 'root', ...at(2) }),
      tok({ id: 4, upos: 'DET', head: 6, deprel: 'det', ...at(3) }),
      tok({ id: 5, upos: 'NOUN', head: 6, deprel: 'compound', ...at(4) }),
      tok({ id: 6, upos: 'NOUN', head: 3, deprel: 'obj', ...at(5) }),
      tok({ id: 7, upos: 'CCONJ', head: 10, deprel: 'cc', ...at(6) }),
      tok({ id: 8, upos: 'DET', head: 10, deprel: 'det', ...at(7) }),
      tok({ id: 9, upos: 'NOUN', head: 10, deprel: 'compound', ...at(8) }),
      tok({ id: 10, upos: 'NOUN', head: 6, deprel: 'conj', ...at(9) }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const object = flatten(tree).find((n) => n.role === 'object')!
    expect(object.text).toBe('the pressure sensor and the temperature sensor')
    const members = object.children.filter((c) => c.role === 'coordinationMember')
    expect(members).toHaveLength(2)
    expect(members[1]!.connector?.text).toBe('and')
  })

  it('(C) coordinated complement (non-copular, postnominal) decomposes when grammatically valid', () => {
    const words = ['The', 'team', 'considers', 'the', 'design', 'elegant', 'and', 'efficient']
    const text = words.join(' ') + '.'
    let cursor = 0
    const positions: { text: string; start: number; end: number }[] = []
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      positions.push({ text: w, start, end: start + w.length })
      cursor = start + w.length
    }
    const at = (i: number) => positions[i]!
    const tokens: StanzaToken[] = [
      tok({ id: 1, upos: 'DET', head: 2, deprel: 'det', ...at(0) }),
      tok({ id: 2, upos: 'NOUN', head: 3, deprel: 'nsubj', ...at(1) }),
      tok({ id: 3, upos: 'VERB', head: 0, deprel: 'root', ...at(2) }),
      tok({ id: 4, upos: 'DET', head: 5, deprel: 'det', ...at(3) }),
      tok({ id: 5, upos: 'NOUN', head: 3, deprel: 'obj', ...at(4) }),
      tok({ id: 6, upos: 'ADJ', head: 5, deprel: 'amod', ...at(5) }),
      tok({ id: 7, upos: 'CCONJ', head: 8, deprel: 'cc', ...at(6) }),
      tok({ id: 8, upos: 'ADJ', head: 6, deprel: 'conj', ...at(7) }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const complement = flatten(tree).find((n) => n.role === 'complement')!
    expect(complement).toBeDefined()
    expect(complement.text).toBe('elegant and efficient')
    const members = complement.children.filter((c) => c.role === 'coordinationMember')
    expect(members).toHaveLength(2)
    expect(members[1]!.connector?.text).toBe('and')
  })

  it('(D) a canonical slot with an incidental "and" but no dependency-level coordination stays a single flat node', () => {
    // "and" appears in the source text but is NOT a `cc` linking a `conj` sibling of the
    // object's own head -- it belongs to an unrelated adjacent modifier, so no decomposition
    // should ever be triggered by text alone.
    const words = ['The', 'team', 'analyzed', 'the', 'results', 'and', 'reported', 'them']
    const text = words.join(' ') + '.'
    let cursor = 0
    const positions: { text: string; start: number; end: number }[] = []
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      positions.push({ text: w, start, end: start + w.length })
      cursor = start + w.length
    }
    const at = (i: number) => positions[i]!
    const tokens: StanzaToken[] = [
      tok({ id: 1, upos: 'DET', head: 2, deprel: 'det', ...at(0) }),
      tok({ id: 2, upos: 'NOUN', head: 3, deprel: 'nsubj', ...at(1) }),
      tok({ id: 3, upos: 'VERB', head: 0, deprel: 'root', ...at(2) }),
      tok({ id: 4, upos: 'DET', head: 5, deprel: 'det', ...at(3) }),
      tok({ id: 5, upos: 'NOUN', head: 3, deprel: 'obj', ...at(4) }),
      tok({ id: 6, upos: 'CCONJ', head: 7, deprel: 'cc', ...at(5) }),
      tok({ id: 7, upos: 'VERB', head: 3, deprel: 'conj', ...at(6) }),
      tok({ id: 8, upos: 'PRON', head: 7, deprel: 'obj', ...at(7) }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const results = flatten(tree).find((n) => n.role === 'object' && n.text === 'the results')!
    expect(results).toBeDefined()
    expect(results.children).toHaveLength(0) // no coordination inside the object itself
  })

  it('(E) nested NP coordination (below the constituent head, not rooted at it) is unaffected -- still decomposes exactly as before', () => {
    const words = ['on', 'a', 'mixture', 'of', 'geological', 'conditions', 'and', 'environmental', 'factors']
    const text = words.join(' ')
    let cursor = 0
    const positions: { text: string; start: number; end: number }[] = []
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      positions.push({ text: w, start, end: start + w.length })
      cursor = start + w.length
    }
    const at = (i: number) => positions[i]!
    const full = 'The model was trained ' + text + '.'
    const offset = full.indexOf(text)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', start: 4, end: 9 }),
      tok({ id: 3, text: 'was', upos: 'AUX', head: 4, deprel: 'aux:pass', start: 10, end: 13 }),
      tok({ id: 4, text: 'trained', upos: 'VERB', head: 0, deprel: 'root', start: 14, end: 21 }),
      tok({ id: 5, text: 'on', upos: 'ADP', head: 7, deprel: 'case', start: offset + at(0).start, end: offset + at(0).end }),
      tok({ id: 6, text: 'a', upos: 'DET', head: 7, deprel: 'det', start: offset + at(1).start, end: offset + at(1).end }),
      tok({ id: 7, text: 'mixture', upos: 'NOUN', head: 4, deprel: 'obl', start: offset + at(2).start, end: offset + at(2).end }),
      tok({ id: 8, text: 'of', upos: 'ADP', head: 10, deprel: 'case', start: offset + at(3).start, end: offset + at(3).end }),
      tok({ id: 9, text: 'geological', upos: 'ADJ', head: 10, deprel: 'amod', start: offset + at(4).start, end: offset + at(4).end }),
      tok({ id: 10, text: 'conditions', upos: 'NOUN', head: 7, deprel: 'nmod', start: offset + at(5).start, end: offset + at(5).end }),
      tok({ id: 11, text: 'and', upos: 'CCONJ', head: 13, deprel: 'cc', start: offset + at(6).start, end: offset + at(6).end }),
      tok({ id: 12, text: 'environmental', upos: 'ADJ', head: 13, deprel: 'amod', start: offset + at(7).start, end: offset + at(7).end }),
      tok({ id: 13, text: 'factors', upos: 'NOUN', head: 10, deprel: 'conj', start: offset + at(8).start, end: offset + at(8).end }),
      tok({ id: 14, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: full.length - 1, end: full.length }),
    ]
    const tree = buildStanzaHierarchicalTree(full, tokens)
    const modifier = flatten(tree).find((n) => n.role === 'modifier' && n.text.includes('mixture'))!
    expect(modifier).toBeDefined()
    expect(modifier.presentationSpan?.text).toBe('on a mixture of')
    expect(modifier.children).toHaveLength(2)
    // Prototype 2.6G2.6C5: unified with canonical-constituent coordination's own established
    // 'coordinationMember' role (previously 'modifier').
    expect(modifier.children.every((c) => c.role === 'coordinationMember')).toBe(true)
  })

  it('(F) main predicate coordination + a coordinated subject simultaneously: both decompositions coexist without cross-contamination', () => {
    const words = ['The', 'sensor', 'and', 'the', 'monitor', 'recorded', 'data', 'and', 'reported', 'results']
    const text = words.join(' ') + '.'
    let cursor = 0
    const positions: { text: string; start: number; end: number }[] = []
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      positions.push({ text: w, start, end: start + w.length })
      cursor = start + w.length
    }
    const at = (i: number) => positions[i]!
    const tokens: StanzaToken[] = [
      tok({ id: 1, upos: 'DET', head: 2, deprel: 'det', ...at(0) }),
      tok({ id: 2, upos: 'NOUN', head: 6, deprel: 'nsubj', ...at(1) }),
      tok({ id: 3, upos: 'CCONJ', head: 5, deprel: 'cc', ...at(2) }),
      tok({ id: 4, upos: 'DET', head: 5, deprel: 'det', ...at(3) }),
      tok({ id: 5, upos: 'NOUN', head: 2, deprel: 'conj', ...at(4) }),
      tok({ id: 6, upos: 'VERB', head: 0, deprel: 'root', ...at(5) }),
      tok({ id: 7, upos: 'NOUN', head: 6, deprel: 'obj', ...at(6) }),
      tok({ id: 8, upos: 'CCONJ', head: 9, deprel: 'cc', ...at(7) }),
      tok({ id: 9, upos: 'VERB', head: 6, deprel: 'conj', ...at(8) }),
      tok({ id: 10, upos: 'NOUN', head: 9, deprel: 'obj', ...at(9) }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const subject = tree.find((n) => n.role === 'subject')!
    expect(subject.text).toBe('The sensor and the monitor')
    const subjectMembers = subject.children.filter((c) => c.role === 'coordinationMember')
    expect(subjectMembers).toHaveLength(2)
    expect(subjectMembers[1]!.connector?.text).toBe('and')
    expect(subject.children.some((c) => c.role === 'predicate' && c.text === 'recorded')).toBe(true)
    const coordinatedPredicate = subject.children.find((c) => c.role === 'coordinatedPredicate')!
    expect(coordinatedPredicate).toBeDefined()
    expect(coordinatedPredicate.text).toBe('reported')
    expect(coordinatedPredicate.connector?.text).toBe('and')

    // Rendered: exactly two "and" occurrences (subject-coordination + predicate-coordination),
    // never a third from cross-contamination between the two independent coordination sites.
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    expect(countOccurrences(html, '>and<')).toBe(2)
  })
})

describe('Prototype 2.6G2.5B3 item 9 -- rendered lexical-duplication gate for structural clause containers', () => {
  it('across a set of marked/subjectless/multi-predicate clause containers, no clause-role node ever repeats its own child\'s full text', () => {
    // Reuses the item-4 infinitival fixture -- the wrapper's own text is the marker only,
    // never a restatement of the predicate's text.
    const words = ['The', 'team', 'built', 'the', 'tool', 'to', 'test', 'the', 'method']
    const text = words.join(' ') + '.'
    let cursor = 0
    const positions: { text: string; start: number; end: number }[] = []
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      positions.push({ text: w, start, end: start + w.length })
      cursor = start + w.length
    }
    const at = (i: number) => positions[i]!
    const tokens: StanzaToken[] = [
      tok({ id: 1, upos: 'DET', head: 2, deprel: 'det', ...at(0) }),
      tok({ id: 2, upos: 'NOUN', head: 3, deprel: 'nsubj', ...at(1) }),
      tok({ id: 3, upos: 'VERB', head: 0, deprel: 'root', ...at(2) }),
      tok({ id: 4, upos: 'DET', head: 5, deprel: 'det', ...at(3) }),
      tok({ id: 5, upos: 'NOUN', head: 3, deprel: 'obj', ...at(4) }),
      tok({ id: 6, upos: 'PART', head: 7, deprel: 'mark', ...at(5) }),
      tok({ id: 7, upos: 'VERB', head: 3, deprel: 'advcl', ...at(6) }),
      tok({ id: 8, upos: 'DET', head: 9, deprel: 'det', ...at(7) }),
      tok({ id: 9, upos: 'NOUN', head: 7, deprel: 'obj', ...at(8) }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    for (const clauseNode of flatten(tree).filter((n) => n.role === 'clause')) {
      for (const child of clauseNode.children) {
        if (clauseNode.text.trim().length === 0) continue // structural-only container, nothing to compare
        expect(clauseNode.text).not.toBe(child.text)
      }
    }
  })
})
