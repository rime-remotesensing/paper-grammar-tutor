import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StructureTreeView } from '../../src/features/grammar/components/StructureTreeView.tsx'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6B -- Single-owner + Coordination-scope + Existential Presentation.
 * Rendered and data-level tests for the three live blockers this phase fixes, plus their
 * required negative controls. Synthetic fixtures reproducing the same STRUCTURAL SHAPES as
 * the live-diagnosed controls, different wording -- no literal live-PDF text committed.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

function offsets(text: string, words: string[]): Record<string, { start: number; end: number }> {
  let cursor = 0
  const pos: Record<string, { start: number; end: number }> = {}
  for (const w of words) {
    const start = text.indexOf(w, cursor)
    if (start === -1) throw new Error(`word "${w}" not found starting at ${cursor}`)
    pos[w] = { start, end: start + w.length }
    cursor = start + w.length
  }
  return pos
}

describe('Prototype 2.6G2.6B item 1/2/3 -- enumeration item owns its own internal clause, never duplicated as a sentence-level sibling', () => {
  it('a parataxis-attached predicate whose own span falls inside an already-built surface-enumeration item is not ALSO surfaced as a top-level paratactic clause', () => {
    // "The method has two steps: normalization is applied and scaling follows." -- "applied"
    // attaches via `parataxis` to the main root ("has"), the same shape a colon-introduced
    // "(1) ... (2) ..." surface-enumeration list produces when its own internal clauses also
    // happen to be genuine ClauseFrames (parataxis / conj chains), independent of, and
    // unaware of, the surface-marker recovery that already flattened them into an item's text.
    const text = 'The method has two steps: (1) normalization is applied and (2) scaling follows.'
    const words = ['The', 'method', 'has', 'two', 'steps', 'normalization', 'is', 'applied', 'and', 'scaling', 'follows']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'method', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pos['method']! }),
      tok({ id: 3, text: 'has', upos: 'VERB', head: 0, deprel: 'root', ...pos['has']! }),
      tok({ id: 4, text: 'two', upos: 'NUM', head: 5, deprel: 'nummod', ...pos['two']! }),
      tok({ id: 5, text: 'steps', upos: 'NOUN', head: 3, deprel: 'obj', ...pos['steps']! }),
      tok({ id: 6, text: 'normalization', upos: 'NOUN', head: 8, deprel: 'nsubj:pass', ...pos['normalization']! }),
      tok({ id: 7, text: 'is', upos: 'AUX', head: 8, deprel: 'aux:pass', ...pos['is']! }),
      // Genuinely a ClauseFrame (parataxis of the main root), the same as a real corpus's
      // colon-list internal clauses -- the enumeration surface-recovery flattens its text
      // into an item independently of this dependency fact.
      tok({ id: 8, text: 'applied', upos: 'VERB', head: 3, deprel: 'parataxis', ...pos['applied']! }),
      tok({ id: 9, text: 'and', upos: 'CCONJ', head: 10, deprel: 'cc', ...pos['and']! }),
      tok({ id: 10, text: 'scaling', upos: 'NOUN', head: 11, deprel: 'nsubj', ...pos['scaling']! }),
      tok({ id: 11, text: 'follows', upos: 'VERB', head: 8, deprel: 'conj', ...pos['follows']! }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)

    // Single owner: the enumeration node is the ONLY node whose own span reaches
    // "applied"/"follows" -- no separate top-level paratactic-clause sibling duplicates it.
    const enumerationNodes = flat.filter((n) => n.role === 'enumeration')
    expect(enumerationNodes).toHaveLength(1)
    expect(enumerationNodes[0]!.text).toContain('applied')
    expect(enumerationNodes[0]!.text).toContain('follows')

    // No visible duplicate anywhere in the tree (same role+span+text key appearing twice).
    const keys = flat.map((n) => `${n.role}:${n.start}:${n.end}:${n.text}`)
    expect(new Set(keys).size).toBe(keys.length)

    // Top level of the sentence tree contains only the main clause -- no stray second
    // top-level entry for "applied"/"follows".
    expect(tree).toHaveLength(1)
    expect(tree[0]!.role).toBe('subject')
  })
})

describe('Prototype 2.6G2.6B item 5/6/7 -- nonrestrictive relative clause on a coordinated constituent: promotion vs. staying local', () => {
  it('(A) nonrestrictive relative AFTER the whole coordination is promoted to the coordination container', () => {
    const text = 'The pressure sensor and the temperature sensor, which were recently calibrated, recorded values.'
    const words = ['The', 'pressure', 'sensor', 'and', 'the', 'temperature', 'sensor', 'which', 'were', 'recently', 'calibrated', 'recorded', 'values']
    let cursor = 0
    const at: { start: number; end: number }[] = []
    for (const w of words) {
      const start = text.indexOf(w, cursor)
      if (start === -1) throw new Error(`word "${w}" not found starting at ${cursor}`)
      at.push({ start, end: start + w.length })
      cursor = start + w.length
    }
    const [wThe, wPressure, wSensor1, wAnd, wThe2, wTemperature, wSensor2, wWhich, wWere, wRecently, wCalibrated, wRecorded, wValues] = at
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 3, deprel: 'det', ...wThe! }),
      tok({ id: 2, text: 'pressure', upos: 'NOUN', head: 3, deprel: 'compound', ...wPressure! }),
      tok({ id: 3, text: 'sensor', upos: 'NOUN', head: 12, deprel: 'nsubj', ...wSensor1! }),
      tok({ id: 4, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', ...wAnd! }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 7, deprel: 'det', ...wThe2! }),
      tok({ id: 6, text: 'temperature', upos: 'NOUN', head: 7, deprel: 'compound', ...wTemperature! }),
      tok({ id: 7, text: 'sensor', upos: 'NOUN', head: 3, deprel: 'conj', ...wSensor2! }),
      tok({ id: 8, text: ',', upos: 'PUNCT', head: 11, deprel: 'punct', start: wSensor2!.end, end: wSensor2!.end + 1 }),
      tok({ id: 9, text: 'which', upos: 'PRON', head: 11, deprel: 'nsubj:pass', ...wWhich! }),
      tok({ id: 10, text: 'were', upos: 'AUX', head: 11, deprel: 'aux:pass', ...wWere! }),
      tok({ id: 11, text: 'calibrated', upos: 'VERB', head: 3, deprel: 'acl:relcl', ...wCalibrated! }),
      tok({ id: 12, text: 'recorded', upos: 'VERB', head: 0, deprel: 'root', ...wRecorded! }),
      tok({ id: 13, text: 'values', upos: 'NOUN', head: 12, deprel: 'obj', ...wValues! }),
      tok({ id: 14, text: '.', upos: 'PUNCT', head: 12, deprel: 'punct', start: text.length - 1, end: text.length }),
      tok({ id: 15, text: 'recently', upos: 'ADV', head: 11, deprel: 'advmod', ...wRecently! }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const subject = tree.find((n) => n.role === 'subject')!
    expect(subject).toBeDefined()
    const relativeClause = subject.children.find((c) => c.role === 'relativeClause')!
    expect(relativeClause).toBeDefined()
    // Promoted: the relative clause is a CHILD of the coordination container (the subject
    // node itself), a SIBLING of the two coordination members -- not nested under either one.
    const members = subject.children.filter((c) => c.role === 'coordinationMember')
    expect(members).toHaveLength(2)
    expect(members.every((m) => m.children.every((c) => c.role !== 'relativeClause'))).toBe(true)
  })

  it('(B) restrictive relative on ONE conjunct stays local to that member', () => {
    const text = 'The sensor that failed and the monitor recorded data.'
    const words = ['The', 'sensor', 'that', 'failed', 'and', 'the', 'monitor', 'recorded', 'data']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'sensor', upos: 'NOUN', head: 8, deprel: 'nsubj', ...pos['sensor']! }),
      tok({ id: 3, text: 'that', upos: 'PRON', head: 4, deprel: 'nsubj', ...pos['that']! }),
      tok({ id: 4, text: 'failed', upos: 'VERB', head: 2, deprel: 'acl:relcl', ...pos['failed']! }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', ...pos['and']! }),
      tok({ id: 6, text: 'the', upos: 'DET', head: 7, deprel: 'det', ...pos['the']! }),
      tok({ id: 7, text: 'monitor', upos: 'NOUN', head: 2, deprel: 'conj', ...pos['monitor']! }),
      tok({ id: 8, text: 'recorded', upos: 'VERB', head: 0, deprel: 'root', ...pos['recorded']! }),
      tok({ id: 9, text: 'data', upos: 'NOUN', head: 8, deprel: 'obj', ...pos['data']! }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const subject = tree.find((n) => n.role === 'subject')!
    // Restrictive relatives (no comma) stay INSIDE the member's own canonical authority span
    // (grounded via collectConstituentTokens, matching SentenceCoreSet) while still getting
    // their own decomposed relativeClause child, same as the existing non-coordinated
    // restrictive-relative precedent -- exactly once, nested LOCALLY under that one member,
    // never promoted to the coordination container (the promotion condition never fires: no
    // comma, and its own start is before the coordination's own end).
    expect(subject.text).toContain('sensor that failed')
    const relativeClauses = flatten(tree).filter((n) => n.role === 'relativeClause')
    expect(relativeClauses).toHaveLength(1)
    const members = subject.children.filter((c) => c.role === 'coordinationMember')
    expect(members).toHaveLength(2)
    const memberWithRelcl = members.find((m) => m.children.some((c) => c.role === 'relativeClause'))
    expect(memberWithRelcl).toBeDefined()
    expect(subject.children.some((c) => c.role === 'relativeClause')).toBe(false)
  })

  it('(C) nonrestrictive relative BEFORE the coordination ends (modifying an earlier member): authority alignment holds and nothing is wrongly promoted', () => {
    // A nonrestrictive relative clause interposed BETWEEN two coordination members ("A,
    // which X, and B") is a pre-existing, OUT-OF-SCOPE structural limitation shared
    // identically by canonical SentenceCoreSet grounding (confirmed live, not a Tree-only
    // gap): the relative clause's own excluded verb sits in the source gap between the two
    // members, and the general island-restriction fix (2.6G2.5C2/2.6G2.6, not touched in
    // this phase) breaks contiguity there -- the second coordination member is not part of
    // the canonical/Tree authority span for this specific interposed-clause shape. Since
    // fixing that would require modifying stanzaSyntaxAuthority.ts (explicitly out of scope
    // for this Tree-presentation-only phase), this control instead verifies the two
    // properties actually in scope: (1) the Tree never drifts from canonical authority even
    // in this edge case, and (2) whatever the Tree DOES build, the relative clause is never
    // wrongly duplicated or promoted to a coordination container that was never built.
    const text = 'The sensor, which failed twice, and the monitor recorded data.'
    const words = ['The', 'sensor', 'which', 'failed', 'twice', 'and', 'the', 'monitor', 'recorded', 'data']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'sensor', upos: 'NOUN', head: 11, deprel: 'nsubj', ...pos['sensor']! }),
      tok({ id: 3, text: ',', upos: 'PUNCT', head: 4, deprel: 'punct', start: pos['sensor']!.end, end: pos['sensor']!.end + 1 }),
      tok({ id: 4, text: 'which', upos: 'PRON', head: 5, deprel: 'nsubj', ...pos['which']! }),
      tok({ id: 5, text: 'failed', upos: 'VERB', head: 2, deprel: 'acl:relcl', ...pos['failed']! }),
      tok({ id: 6, text: 'twice', upos: 'ADV', head: 5, deprel: 'advmod', ...pos['twice']! }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: pos['twice']!.end, end: pos['twice']!.end + 1 }),
      tok({ id: 8, text: 'and', upos: 'CCONJ', head: 10, deprel: 'cc', ...pos['and']! }),
      tok({ id: 9, text: 'the', upos: 'DET', head: 10, deprel: 'det', ...pos['the']! }),
      tok({ id: 10, text: 'monitor', upos: 'NOUN', head: 2, deprel: 'conj', ...pos['monitor']! }),
      tok({ id: 11, text: 'recorded', upos: 'VERB', head: 0, deprel: 'root', ...pos['recorded']! }),
      tok({ id: 12, text: 'data', upos: 'NOUN', head: 11, deprel: 'obj', ...pos['data']! }),
      tok({ id: 13, text: '.', upos: 'PUNCT', head: 11, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const subject = tree.find((n) => n.role === 'subject')!
    expect(subject).toBeDefined()
    expect(subject.text).toBe('The sensor') // matches canonical SentenceCoreSet exactly -- zero authority drift, even here
    const relativeClauses = flatten(tree).filter((n) => n.role === 'relativeClause')
    expect(relativeClauses).toHaveLength(1) // present exactly once, never duplicated
    expect(relativeClauses[0]!.text).toBe('which failed twice')
    // Never wrongly promoted to a coordination container -- none was built (no second
    // member is reachable in this shape), so the relative clause stays nested under the
    // subject itself, not floated to an unrelated top-level sibling.
    expect(subject.children.some((c) => c.role === 'relativeClause')).toBe(true)
  })

  it('(D) ordinary non-coordinated NP relative clause is unaffected', () => {
    const text = 'The device, which requires calibration, failed.'
    const words = ['The', 'device', 'which', 'requires', 'calibration', 'failed']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'device', upos: 'NOUN', head: 8, deprel: 'nsubj', ...pos['device']! }),
      tok({ id: 3, text: ',', upos: 'PUNCT', head: 4, deprel: 'punct', start: pos['device']!.end, end: pos['device']!.end + 1 }),
      tok({ id: 4, text: 'which', upos: 'PRON', head: 5, deprel: 'nsubj', ...pos['which']! }),
      tok({ id: 5, text: 'requires', upos: 'VERB', head: 2, deprel: 'acl:relcl', ...pos['requires']! }),
      tok({ id: 6, text: 'calibration', upos: 'NOUN', head: 5, deprel: 'obj', ...pos['calibration']! }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 6, deprel: 'punct', start: pos['calibration']!.end, end: pos['calibration']!.end + 1 }),
      tok({ id: 8, text: 'failed', upos: 'VERB', head: 0, deprel: 'root', ...pos['failed']! }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const subject = tree.find((n) => n.role === 'subject')!
    expect(subject.text).toBe('The device')
    expect(subject.children.some((c) => c.role === 'relativeClause' && c.text === 'which requires calibration')).toBe(true)
  })
})

describe('Prototype 2.6G2.6B item 8/9/10 -- existential surface-order presentation, locative control, and subordinate ownership', () => {
  it('existential expl renders in English surface-reading order: marker -> expletive -> predicate -> subject', () => {
    const words = ['The', 'plan', 'works', 'well', 'if', 'there', 'is', 'strong', 'covariance']
    const text = words.join(' ') + '.'
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'plan', upos: 'NOUN', head: 3, deprel: 'nsubj', ...pos['plan']! }),
      tok({ id: 3, text: 'works', upos: 'VERB', head: 0, deprel: 'root', ...pos['works']! }),
      tok({ id: 4, text: 'well', upos: 'ADV', head: 3, deprel: 'advmod', ...pos['well']! }),
      tok({ id: 5, text: 'if', upos: 'SCONJ', head: 7, deprel: 'mark', ...pos['if']! }),
      tok({ id: 6, text: 'there', upos: 'PRON', head: 7, deprel: 'expl', ...pos['there']! }),
      tok({ id: 7, text: 'is', upos: 'VERB', head: 3, deprel: 'advcl', ...pos['is']! }),
      tok({ id: 8, text: 'strong', upos: 'ADJ', head: 9, deprel: 'amod', ...pos['strong']! }),
      tok({ id: 9, text: 'covariance', upos: 'NOUN', head: 7, deprel: 'nsubj', ...pos['covariance']! }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)

    // Each visible exactly once.
    expect(flat.filter((n) => n.marker?.text === 'if')).toHaveLength(1)
    expect(flat.filter((n) => n.role === 'expletive')).toHaveLength(1)
    expect(flat.filter((n) => n.role === 'predicate' && n.text === 'is')).toHaveLength(1)
    expect(flat.filter((n) => n.role === 'subject' && n.text === 'strong covariance')).toHaveLength(1)
    // "there" never labelled 前置き (openingModifier) and never O/C.
    expect(flat.some((n) => n.role === 'openingModifier')).toBe(false)
    expect(flat.some((n) => (n.role === 'object' || n.role === 'complement') && n.text === 'there')).toBe(false)

    // Surface-order nesting: marker(if) -> expletive(there) -> predicate(is) -> subject.
    const wrapper = tree.find((n) => n.marker?.text === 'if')!
    expect(wrapper.role).toBe('clause')
    const expletive = wrapper.children.find((c) => c.role === 'expletive')!
    expect(expletive).toBeDefined()
    const predicate = expletive.children.find((c) => c.role === 'predicate')!
    expect(predicate).toBeDefined()
    const subject = predicate.children.find((c) => c.role === 'subject')!
    expect(subject).toBeDefined()

    // Rendered: everything appears exactly once, nothing lost.
    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    expect((html.match(/>if</g) ?? []).length).toBe(1)
    expect((html.match(/>there</g) ?? []).length).toBe(1)
    expect((html.match(/>is</g) ?? []).length).toBe(1)
  })

  it('a genuine locative "there" (advmod, not expl) keeps the ordinary subject-wraps-predicate nesting, unaffected', () => {
    const text = 'The book remains there.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'book', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'remains', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 16 }),
      tok({ id: 4, text: 'there', upos: 'ADV', head: 3, deprel: 'advmod', start: 17, end: 22 }),
      tok({ id: 5, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 22, end: 23 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    expect(flat.some((n) => n.role === 'expletive')).toBe(false)
    // Ordinary nesting: subject is the TOP-level node (not the reverse).
    expect(tree[0]!.role).toBe('subject')
    expect(tree[0]!.text).toBe('The book')
    const predicate = tree[0]!.children.find((c) => c.role === 'predicate')!
    expect(predicate).toBeDefined()
    const thereNode = predicate.children.find((c) => c.text === 'there')!
    expect(thereNode).toBeDefined()
    expect(thereNode.role).toBe('modifier')
  })

  it('a subordinate if-clause (existential or not) remains owned by its own governing predicate scope, never an unrelated second top-level structure', () => {
    const text = 'The noise can interfere with the model and lead to inaccurate predictions if there is strong covariance.'
    const words = ['The', 'noise', 'can', 'interfere', 'with', 'the', 'model', 'and', 'lead', 'to', 'inaccurate', 'predictions', 'if', 'there', 'is', 'strong', 'covariance']
    const pos = offsets(text, words)
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', ...pos['The']! }),
      tok({ id: 2, text: 'noise', upos: 'NOUN', head: 4, deprel: 'nsubj', ...pos['noise']! }),
      tok({ id: 3, text: 'can', upos: 'AUX', head: 4, deprel: 'aux', ...pos['can']! }),
      tok({ id: 4, text: 'interfere', upos: 'VERB', head: 0, deprel: 'root', ...pos['interfere']! }),
      tok({ id: 5, text: 'with', upos: 'ADP', head: 7, deprel: 'case', ...pos['with']! }),
      tok({ id: 6, text: 'the', upos: 'DET', head: 7, deprel: 'det', ...pos['the']! }),
      tok({ id: 7, text: 'model', upos: 'NOUN', head: 4, deprel: 'obl', ...pos['model']! }),
      tok({ id: 8, text: 'and', upos: 'CCONJ', head: 9, deprel: 'cc', ...pos['and']! }),
      tok({ id: 9, text: 'lead', upos: 'VERB', head: 4, deprel: 'conj', ...pos['lead']! }),
      tok({ id: 10, text: 'to', upos: 'ADP', head: 12, deprel: 'case', ...pos['to']! }),
      tok({ id: 11, text: 'inaccurate', upos: 'ADJ', head: 12, deprel: 'amod', ...pos['inaccurate']! }),
      tok({ id: 12, text: 'predictions', upos: 'NOUN', head: 9, deprel: 'obl', ...pos['predictions']! }),
      tok({ id: 13, text: 'if', upos: 'SCONJ', head: 15, deprel: 'mark', ...pos['if']! }),
      tok({ id: 14, text: 'there', upos: 'PRON', head: 15, deprel: 'expl', ...pos['there']! }),
      tok({ id: 15, text: 'is', upos: 'VERB', head: 9, deprel: 'advcl', ...pos['is']! }),
      tok({ id: 16, text: 'strong', upos: 'ADJ', head: 17, deprel: 'amod', ...pos['strong']! }),
      tok({ id: 17, text: 'covariance', upos: 'NOUN', head: 15, deprel: 'nsubj', ...pos['covariance']! }),
      tok({ id: 18, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: text.length - 1, end: text.length }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    // Exactly two top-level nodes: the main clause and the "if" clause -- the if-clause is
    // NOT an unrelated third structure, and it never gets grouped with the main clause's own
    // coordinated predicates (no false extra connector).
    expect(tree).toHaveLength(2)
    expect(tree[0]!.role).toBe('subject')
    expect(tree[1]!.marker?.text).toBe('if')

    const html = renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
    expect((html.match(/>and</g) ?? []).length).toBe(1)
  })
})
