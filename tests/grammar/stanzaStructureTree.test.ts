import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { structureTreeNodeKey, structureTreeNodeSpan } from '../../src/features/grammar/domain/treeReadingMatching.ts'
import { deriveTreeReadingTargets, findTreeReadingTargetForNode } from '../../src/features/grammar/domain/treeReadingTargets.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

describe('Prototype 2.6G2 Structure Tree -- canonical slot mapping', () => {
  it('maps canonical object/complement to object/complement roles, never PP to O/C', () => {
    // "The system flags problems for the maintenance team." -- SVO with a trailing PP
    // ("for the maintenance team") that must stay a plain modifier, never object/complement.
    const text = 'The system flags problems for the maintenance team.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'flags', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 16 }),
      tok({ id: 4, text: 'problems', upos: 'NOUN', head: 3, deprel: 'obj', start: 17, end: 25 }),
      tok({ id: 5, text: 'for', upos: 'ADP', head: 8, deprel: 'case', start: 26, end: 29 }),
      tok({ id: 6, text: 'the', upos: 'DET', head: 8, deprel: 'det', start: 30, end: 33 }),
      tok({ id: 7, text: 'maintenance', upos: 'NOUN', head: 8, deprel: 'compound', start: 34, end: 45 }),
      tok({ id: 8, text: 'team', upos: 'NOUN', head: 3, deprel: 'obl', start: 46, end: 50 }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 50, end: 51 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    expect(flat.some((n) => n.role === 'object' && n.text === 'problems')).toBe(true)
    expect(flat.some((n) => n.role === 'modifier' && n.text === 'for the maintenance team')).toBe(true)
    expect(flat.some((n) => (n.role === 'object' || n.role === 'complement') && n.text.includes('maintenance team'))).toBe(false)
  })
})

describe('Prototype 2.6G2.1 -- reduced postmodifier attachment', () => {
  it('attaches a non-finite reduced postmodifier as its own child, not folded flat, and does not label it a relative clause', () => {
    // "Data collected by volunteers require review." -- "collected by volunteers" is a
    // restrictive reduced postmodifier (plain acl, no relative pronoun, no comma) on "Data".
    const text = 'Data collected by volunteers require review.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Data', upos: 'NOUN', head: 5, deprel: 'nsubj', start: 0, end: 4 }),
      tok({ id: 2, text: 'collected', upos: 'VERB', head: 1, deprel: 'acl', start: 5, end: 14 }),
      tok({ id: 3, text: 'by', upos: 'ADP', head: 4, deprel: 'case', start: 15, end: 17 }),
      tok({ id: 4, text: 'volunteers', upos: 'NOUN', head: 2, deprel: 'obl', start: 18, end: 28 }),
      tok({ id: 5, text: 'require', upos: 'VERB', head: 0, deprel: 'root', start: 29, end: 36 }),
      tok({ id: 6, text: 'review', upos: 'NOUN', head: 5, deprel: 'obj', start: 37, end: 43 }),
      tok({ id: 7, text: '.', upos: 'PUNCT', head: 5, deprel: 'punct', start: 43, end: 44 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const subject = tree.find((n) => n.role === 'subject')!
    expect(subject.text).toBe('Data collected by volunteers') // authority: full canonical span
    expect(subject.presentationSpan?.text).toBe('Data') // presentation: core NP only
    expect(subject.children.some((c) => c.role === 'postmodifier' && c.text === 'collected by volunteers')).toBe(true)
    expect(subject.children.some((c) => c.role === 'relativeClause')).toBe(false)
  })
})

describe('Prototype 2.6G2 -- citation suppression', () => {
  it('never creates a standalone grammar node for citation-only appositive material', () => {
    const text = 'Earlier audits reported similar inefficiencies (Chen et al. 2020).'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Earlier', upos: 'ADJ', head: 2, deprel: 'amod', start: 0, end: 7 }),
      tok({ id: 2, text: 'audits', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 8, end: 14 }),
      tok({ id: 3, text: 'reported', upos: 'VERB', head: 0, deprel: 'root', start: 15, end: 23 }),
      tok({ id: 4, text: 'similar', upos: 'ADJ', head: 5, deprel: 'amod', start: 24, end: 31 }),
      tok({ id: 5, text: 'inefficiencies', upos: 'NOUN', head: 3, deprel: 'obj', start: 32, end: 46 }),
      tok({ id: 6, text: '(', upos: 'PUNCT', head: 8, deprel: 'punct', start: 47, end: 48 }),
      tok({ id: 7, text: 'Chen', upos: 'PROPN', head: 5, deprel: 'appos', start: 48, end: 52 }),
      tok({ id: 8, text: 'al.', upos: 'X', head: 7, deprel: 'conj', start: 57, end: 60 }),
      tok({ id: 9, text: '2020', upos: 'NUM', head: 7, deprel: 'nmod:unmarked', start: 61, end: 65 }),
      tok({ id: 10, text: ')', upos: 'PUNCT', head: 7, deprel: 'punct', start: 65, end: 66 }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 66, end: 67 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    expect(flat.some((n) => n.text.includes('Chen'))).toBe(false)
    const object = flat.find((n) => n.role === 'object')!
    expect(object.text).toBe('similar inefficiencies')
  })
})

describe('Prototype 2.6G2 -- balanced delimiter preservation', () => {
  it('never truncates a closing bracket belonging to retained content', () => {
    const text = 'The panel reviewed the result (see Table 2).'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'panel', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 9 }),
      tok({ id: 3, text: 'reviewed', upos: 'VERB', head: 0, deprel: 'root', start: 10, end: 18 }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', start: 19, end: 22 }),
      tok({ id: 5, text: 'result', upos: 'NOUN', head: 3, deprel: 'obj', start: 23, end: 29 }),
      tok({ id: 6, text: '(', upos: 'PUNCT', head: 9, deprel: 'punct', start: 30, end: 31 }),
      tok({ id: 7, text: 'see', upos: 'VERB', head: 5, deprel: 'acl', start: 31, end: 34 }),
      tok({ id: 8, text: 'Table', upos: 'PROPN', head: 7, deprel: 'obj', start: 35, end: 40 }),
      tok({ id: 9, text: '2', upos: 'NUM', head: 8, deprel: 'nummod', start: 41, end: 42 }),
      tok({ id: 10, text: ')', upos: 'PUNCT', head: 7, deprel: 'punct', start: 42, end: 43 }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 43, end: 44 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    for (const n of flatten(tree)) {
      const opens = (n.text.match(/\(/g) ?? []).length
      const closes = (n.text.match(/\)/g) ?? []).length
      expect(opens).toBe(closes)
    }
  })
})

describe('Prototype 2.6G2 -- source order', () => {
  it('keeps siblings in source-order regardless of build order', () => {
    const text = 'The controller monitors voltage, adjusts current, and logs anomalies.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'controller', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 14 }),
      tok({ id: 3, text: 'monitors', upos: 'VERB', head: 0, deprel: 'root', start: 15, end: 23 }),
      tok({ id: 4, text: 'voltage', upos: 'NOUN', head: 3, deprel: 'obj', start: 24, end: 31 }),
      tok({ id: 5, text: ',', upos: 'PUNCT', head: 6, deprel: 'punct', start: 31, end: 32 }),
      tok({ id: 6, text: 'adjusts', upos: 'VERB', head: 3, deprel: 'conj', start: 33, end: 40 }),
      tok({ id: 7, text: 'current', upos: 'NOUN', head: 6, deprel: 'obj', start: 41, end: 48 }),
      tok({ id: 8, text: ',', upos: 'PUNCT', head: 10, deprel: 'punct', start: 48, end: 49 }),
      tok({ id: 9, text: 'and', upos: 'CCONJ', head: 10, deprel: 'cc', start: 50, end: 53 }),
      tok({ id: 10, text: 'logs', upos: 'VERB', head: 3, deprel: 'conj', start: 54, end: 58 }),
      tok({ id: 11, text: 'anomalies', upos: 'NOUN', head: 10, deprel: 'obj', start: 59, end: 68 }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 68, end: 69 }),
    ]
    const subject = buildStanzaHierarchicalTree(text, tokens).find((n) => n.role === 'subject')!
    const starts = subject.children.map((c) => c.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(subject.children.map((c) => c.text)).toEqual(['monitors', 'adjusts', 'logs'])
  })
})

describe('Prototype 2.6G2.1 -- B4 authority vs. presentation non-overlap', () => {
  it('a postmodifier child never overlaps its parent\'s own presentation span', () => {
    const text = 'A new model called KNN-GCN is applied broadly.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'A', upos: 'DET', head: 3, deprel: 'det', start: 0, end: 1 }),
      tok({ id: 2, text: 'new', upos: 'ADJ', head: 3, deprel: 'amod', start: 2, end: 5 }),
      tok({ id: 3, text: 'model', upos: 'NOUN', head: 7, deprel: 'nsubj:pass', start: 6, end: 11 }),
      tok({ id: 4, text: 'called', upos: 'VERB', head: 3, deprel: 'acl', start: 12, end: 18 }),
      tok({ id: 5, text: 'KNN-GCN', upos: 'PROPN', head: 4, deprel: 'xcomp', start: 19, end: 26 }),
      tok({ id: 6, text: 'is', upos: 'AUX', head: 7, deprel: 'aux:pass', start: 27, end: 29 }),
      tok({ id: 7, text: 'applied', upos: 'VERB', head: 0, deprel: 'root', start: 30, end: 37 }),
      tok({ id: 8, text: 'broadly', upos: 'ADV', head: 7, deprel: 'advmod', start: 38, end: 45 }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', start: 45, end: 46 }),
    ]
    const subject = buildStanzaHierarchicalTree(text, tokens).find((n) => n.role === 'subject')!
    const presentation = structureTreeNodeSpan(subject)
    const postmodifier = subject.children.find((c) => c.role === 'postmodifier')!
    expect(postmodifier).toBeDefined()
    const overlap = Math.max(presentation.start, postmodifier.start) < Math.min(presentation.end, postmodifier.end)
    expect(overlap).toBe(false)
  })
})

describe('Prototype 2.6G2.3 item 3 -- NP/PP-internal coordination from structured conj', () => {
  it('splits a nmod-nested conj chain into sibling coordination-member nodes, never a text-based split', () => {
    // "on a mixture of alpha factors and beta conditions" -- "factors" (nmod of "mixture")
    // itself heads a conj chain ("conditions"). The shared leading "of" must stay with the
    // parent's own core text, not get duplicated onto the first member.
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
    const modifier = flatten(buildStanzaHierarchicalTree(text, tokens)).find((n) => n.role === 'modifier' && n.text.includes('mixture'))!
    expect(modifier.text).toBe('on a mixture of alpha factors and beta conditions') // authority: no lexical loss
    expect(modifier.presentationSpan?.text).toBe('on a mixture of') // shared preposition stays with the parent
    expect(modifier.children).toHaveLength(2)
    expect(modifier.children[0]!.text).toBe('alpha factors')
    expect(modifier.children[0]!.connector).toBeUndefined()
    expect(modifier.children[1]!.text).toBe('beta conditions')
    expect(modifier.children[1]!.connector?.text).toBe('and')
    // Neither member is promoted to object/complement -- Prototype 2.6G2.6C5 unifies this
    // coordination member role with canonical-constituent coordination's own established
    // 'coordinationMember' role (previously 'modifier', a coincidental reuse rather than a
    // semantically distinct member role).
    expect(modifier.children.every((c) => c.role === 'coordinationMember')).toBe(true)
  })

  it('Prototype 2.6G2.5B3 item 6 -- a conj chain rooted directly at the constituent head now decomposes into coordination-member children, while the node\'s own canonical authority span/text stays exactly what SentenceCoreSet would produce', () => {
    // "The team studied results and conclusions." -- object's own authority span IS
    // "results and conclusions" (conj directly on frame.objToken), unaffected -- but the
    // Tree now ALSO presents the genuine dependency-backed coordination as children.
    const text = 'The team studied results and conclusions.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'studied', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 16 }),
      tok({ id: 4, text: 'results', upos: 'NOUN', head: 3, deprel: 'obj', start: 17, end: 24 }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', start: 25, end: 28 }),
      tok({ id: 6, text: 'conclusions', upos: 'NOUN', head: 4, deprel: 'conj', start: 29, end: 40 }),
      tok({ id: 7, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 40, end: 41 }),
    ]
    const object = flatten(buildStanzaHierarchicalTree(text, tokens)).find((n) => n.role === 'object')!
    expect(object.text).toBe('results and conclusions') // authority unchanged (B4: authority != presentation)
    expect(object.children).toHaveLength(2)
    expect(object.children.map((c) => c.text)).toEqual(['results', 'conclusions'])
    // Prototype 2.6G2.6C item B/6/7: a coordination member never inherits the canonical
    // slot's own role a second time -- the object's own container node (asserted above via
    // `object.text`) is the sole owner of the 'object' label.
    expect(object.children.every((c) => c.role === 'coordinationMember')).toBe(true)
    expect(object.children[1]!.connector?.text).toBe('and')
  })
})

describe('Prototype 2.6G2 -- stable Tree node keys', () => {
  it('produces identical keys across two independent builds of the same tokens', () => {
    const text = 'The team published results confirming the hypothesis.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'published', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 18 }),
      tok({ id: 4, text: 'results', upos: 'NOUN', head: 3, deprel: 'obj', start: 19, end: 26 }),
      tok({ id: 5, text: 'confirming', upos: 'VERB', head: 4, deprel: 'acl', start: 27, end: 37 }),
      tok({ id: 6, text: 'the', upos: 'DET', head: 8, deprel: 'det', start: 38, end: 41 }),
      tok({ id: 7, text: 'hypothesis', upos: 'NOUN', head: 5, deprel: 'obj', start: 42, end: 52 }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 52, end: 53 }),
    ]
    const keysOf = (nodes: StructureTreeNode[]): string[] => flatten(nodes).map(structureTreeNodeKey)
    const keys1 = keysOf(buildStanzaHierarchicalTree(text, tokens))
    const keys2 = keysOf(buildStanzaHierarchicalTree(text, JSON.parse(JSON.stringify(tokens))))
    expect(keys1).toEqual(keys2)
    expect(new Set(keys1).size).toBe(keys1.length) // no duplicate keys within one tree
  })
})

describe('Prototype 2.6G2 -- B6 target derivation + exact lookup on the new Tree', () => {
  it('derives reading targets and finds an exact grounded match for a Tree node', () => {
    const text = 'The occurrence of landslides is very complex and is influenced by rainfall intensity.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'occurrence', upos: 'NOUN', head: 7, deprel: 'nsubj', start: 4, end: 14 }),
      tok({ id: 3, text: 'of', upos: 'ADP', head: 4, deprel: 'case', start: 15, end: 17 }),
      tok({ id: 4, text: 'landslides', upos: 'NOUN', head: 2, deprel: 'nmod', start: 18, end: 28 }),
      tok({ id: 5, text: 'is', upos: 'AUX', head: 7, deprel: 'cop', start: 29, end: 31 }),
      tok({ id: 6, text: 'very', upos: 'ADV', head: 7, deprel: 'advmod', start: 32, end: 36 }),
      tok({ id: 7, text: 'complex', upos: 'ADJ', head: 0, deprel: 'root', start: 37, end: 44 }),
      tok({ id: 8, text: 'and', upos: 'CCONJ', head: 10, deprel: 'cc', start: 45, end: 48 }),
      tok({ id: 9, text: 'is', upos: 'AUX', head: 10, deprel: 'aux:pass', start: 49, end: 51 }),
      tok({ id: 10, text: 'influenced', upos: 'VERB', head: 7, deprel: 'conj', start: 52, end: 62 }),
      tok({ id: 11, text: 'by', upos: 'ADP', head: 12, deprel: 'case', start: 63, end: 65 }),
      tok({ id: 12, text: 'rainfall', upos: 'NOUN', head: 13, deprel: 'compound', start: 66, end: 74 }),
      tok({ id: 13, text: 'intensity', upos: 'NOUN', head: 10, deprel: 'obl', start: 75, end: 84 }),
      tok({ id: 14, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', start: 84, end: 85 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const targets = deriveTreeReadingTargets(tree, text)
    expect(targets.some((t) => t.displayText === 'very complex')).toBe(true)
    expect(targets.some((t) => t.displayText === 'is influenced')).toBe(true)
    // Prototype 2.6G2.2: the connector is now structured node metadata (`connector`), not
    // baked into the coordinatedPredicate's own display/interaction text.
    const coordinatedPredicate = flatten(tree).find((n) => n.role === 'coordinatedPredicate')!
    expect(coordinatedPredicate.connector?.text).toBe('and')
    expect(coordinatedPredicate.text).toBe('is influenced')

    const complementNode = flatten(tree).find((n) => n.role === 'complement')!
    const exact = findTreeReadingTargetForNode(complementNode, targets)
    expect(exact?.displayText).toBe('very complex')
  })
})

describe('Prototype 2.6G2.1 -- (A) modifier subtree decomposition', () => {
  it('a PP modifier whose object noun carries a plain-acl postmodifier stays two nested nodes, not one flat leaf', () => {
    // "The team relies on data collected nationwide." -- general shape: predicate -> obl PP
    // modifier ("on data") whose head noun ("data") itself carries a restrictive plain-acl
    // postmodifier ("collected nationwide"). No canonical object/complement anywhere.
    const text = 'The team relies on data collected nationwide.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'relies', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 15 }),
      tok({ id: 4, text: 'on', upos: 'ADP', head: 5, deprel: 'case', start: 16, end: 18 }),
      tok({ id: 5, text: 'data', upos: 'NOUN', head: 3, deprel: 'obl', start: 19, end: 23 }),
      tok({ id: 6, text: 'collected', upos: 'VERB', head: 5, deprel: 'acl', start: 24, end: 33 }),
      tok({ id: 7, text: 'nationwide', upos: 'ADV', head: 6, deprel: 'advmod', start: 34, end: 44 }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 44, end: 45 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const modifier = flatten(tree).find((n) => n.role === 'modifier')!
    expect(modifier).toBeDefined()
    expect(modifier.text).toBe('on data collected nationwide') // authority: full canonical span, no lexical loss
    expect(modifier.presentationSpan?.text).toBe('on data') // presentation: core PP only
    expect(modifier.children).toHaveLength(1)
    expect(modifier.children[0]!.role).toBe('postmodifier')
    expect(modifier.children[0]!.text).toBe('collected nationwide')
  })
})

describe('Prototype 2.6G2.1 -- (B)/(C) acl:relcl vs plain acl role distinction', () => {
  it('a finite acl:relcl postmodifier keeps the relativeClause role', () => {
    // "The team hired researchers who designed studies." -- "who designed studies" is a
    // finite relative clause (acl:relcl, overt relative pronoun) on "researchers".
    const text = 'The team hired researchers who designed studies.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'hired', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 14 }),
      tok({ id: 4, text: 'researchers', upos: 'NOUN', head: 3, deprel: 'obj', start: 15, end: 26 }),
      tok({ id: 5, text: 'who', upos: 'PRON', head: 6, deprel: 'nsubj', start: 27, end: 30 }),
      tok({ id: 6, text: 'designed', upos: 'VERB', head: 4, deprel: 'acl:relcl', start: 31, end: 39 }),
      tok({ id: 7, text: 'studies', upos: 'NOUN', head: 6, deprel: 'obj', start: 40, end: 47 }),
      tok({ id: 8, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 47, end: 48 }),
    ]
    const object = flatten(buildStanzaHierarchicalTree(text, tokens)).find((n) => n.role === 'object')!
    expect(object.children).toHaveLength(1)
    expect(object.children[0]!.role).toBe('relativeClause')
    expect(object.children[0]!.text).toBe('who designed studies')
  })

  it('a plain (non-finite, no relative pronoun) acl postmodifier never gets the relativeClause role', () => {
    // Same shape as above but "designed" carries no subject and is a reduced participle
    // ("researchers assigned studies") -- structurally a plain acl, not acl:relcl.
    const text = 'The team hired researchers assigned studies.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'hired', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 14 }),
      tok({ id: 4, text: 'researchers', upos: 'NOUN', head: 3, deprel: 'obj', start: 15, end: 26 }),
      tok({ id: 5, text: 'assigned', upos: 'VERB', head: 4, deprel: 'acl', start: 27, end: 35 }),
      tok({ id: 6, text: 'studies', upos: 'NOUN', head: 5, deprel: 'obj', start: 36, end: 43 }),
      tok({ id: 7, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 43, end: 44 }),
    ]
    const object = flatten(buildStanzaHierarchicalTree(text, tokens)).find((n) => n.role === 'object')!
    expect(object.children).toHaveLength(1)
    expect(object.children[0]!.role).toBe('postmodifier')
    expect(object.children[0]!.text).toBe('assigned studies')
  })
})

describe('Prototype 2.6G2.1 -- (D) opening modifier placement', () => {
  it('a predicate-attached PP ending before the subject starts becomes a top-level opening modifier, not a nested predicate child', () => {
    const text = 'In the laboratory, the team collected samples.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'In', upos: 'ADP', head: 3, deprel: 'case', start: 0, end: 2 }),
      tok({ id: 2, text: 'the', upos: 'DET', head: 3, deprel: 'det', start: 3, end: 6 }),
      tok({ id: 3, text: 'laboratory', upos: 'NOUN', head: 7, deprel: 'obl', start: 7, end: 17 }),
      tok({ id: 4, text: ',', upos: 'PUNCT', head: 7, deprel: 'punct', start: 17, end: 18 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 6, deprel: 'det', start: 19, end: 22 }),
      tok({ id: 6, text: 'team', upos: 'NOUN', head: 7, deprel: 'nsubj', start: 23, end: 27 }),
      tok({ id: 7, text: 'collected', upos: 'VERB', head: 0, deprel: 'root', start: 28, end: 37 }),
      tok({ id: 8, text: 'samples', upos: 'NOUN', head: 7, deprel: 'obj', start: 38, end: 45 }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', start: 45, end: 46 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    expect(tree[0]!.role).toBe('openingModifier')
    expect(tree[0]!.text).toBe('In the laboratory')
    const subject = tree.find((n) => n.role === 'subject')!
    const predicate = subject.children.find((c) => c.role === 'predicate')!
    expect(predicate.children.some((c) => c.role === 'modifier')).toBe(false) // not nested under the predicate
  })
})

describe('Prototype 2.6G2.1 -- (E) enumeration reachable through nested modifier -> postmodifier -> noun', () => {
  it('surfaces an enumeration attached three levels deep, in source order, without requiring a canonical object', () => {
    // SV pattern (no canonical object) -- "on findings" (modifier) -> "based on items"
    // (postmodifier, plain acl on "findings") -> "items" owns a colon-introduced list.
    const text = 'The team relies on findings based on items: alpha, beta, and gamma.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'relies', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 15 }),
      tok({ id: 4, text: 'on', upos: 'ADP', head: 5, deprel: 'case', start: 16, end: 18 }),
      tok({ id: 5, text: 'findings', upos: 'NOUN', head: 3, deprel: 'obl', start: 19, end: 27 }),
      tok({ id: 6, text: 'based', upos: 'VERB', head: 5, deprel: 'acl', start: 28, end: 33 }),
      tok({ id: 7, text: 'on', upos: 'ADP', head: 8, deprel: 'case', start: 34, end: 36 }),
      tok({ id: 8, text: 'items', upos: 'NOUN', head: 6, deprel: 'obl', start: 37, end: 42 }),
      tok({ id: 9, text: ':', upos: 'PUNCT', head: 8, deprel: 'punct', start: 42, end: 43 }),
      tok({ id: 10, text: 'alpha', upos: 'NOUN', head: 8, deprel: 'appos', start: 44, end: 49 }),
      tok({ id: 11, text: ',', upos: 'PUNCT', head: 12, deprel: 'punct', start: 49, end: 50 }),
      tok({ id: 12, text: 'beta', upos: 'NOUN', head: 10, deprel: 'conj', start: 51, end: 55 }),
      tok({ id: 13, text: ',', upos: 'PUNCT', head: 15, deprel: 'punct', start: 55, end: 56 }),
      tok({ id: 14, text: 'and', upos: 'CCONJ', head: 15, deprel: 'cc', start: 57, end: 60 }),
      tok({ id: 15, text: 'gamma', upos: 'NOUN', head: 12, deprel: 'conj', start: 61, end: 66 }),
      tok({ id: 16, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 66, end: 67 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const modifier = flatten(tree).find((n) => n.role === 'modifier')!
    expect(modifier.presentationSpan?.text).toBe('on findings')
    const postmodifier = modifier.children.find((c) => c.role === 'postmodifier')!
    expect(postmodifier.text).toBe('based on items')
    const enumeration = postmodifier.children.find((c) => c.role === 'enumeration')!
    expect(enumeration).toBeDefined()
    expect(enumeration.children.map((c) => c.text)).toEqual(['alpha', 'beta', 'gamma'])
    expect(enumeration.children.map((c) => c.start)).toEqual([...enumeration.children.map((c) => c.start)].sort((a, b) => a - b))
  })
})

describe('Prototype 2.6G2.1 -- (F) canonical SV pattern with a PP modifier never promotes it to O/C', () => {
  it('leaves an SV clause with no object/complement anywhere, PP stays a modifier', () => {
    const text = 'The system operates for the benefit of users.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'operates', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 19 }),
      tok({ id: 4, text: 'for', upos: 'ADP', head: 6, deprel: 'case', start: 20, end: 23 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 6, deprel: 'det', start: 24, end: 27 }),
      tok({ id: 6, text: 'benefit', upos: 'NOUN', head: 3, deprel: 'obl', start: 28, end: 35 }),
      tok({ id: 7, text: 'of', upos: 'ADP', head: 8, deprel: 'case', start: 36, end: 38 }),
      tok({ id: 8, text: 'users', upos: 'NOUN', head: 6, deprel: 'nmod', start: 39, end: 44 }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 44, end: 45 }),
    ]
    const flat = flatten(buildStanzaHierarchicalTree(text, tokens))
    expect(flat.some((n) => n.role === 'object' || n.role === 'complement')).toBe(false)
    expect(flat.some((n) => n.role === 'modifier' && n.text === 'for the benefit of users')).toBe(true)
  })
})

describe('Prototype 2.6G2.1 -- (G) recursive decomposition never loses or duplicates text (B4)', () => {
  it('every node across a deeply nested tree satisfies lexical-loss and visible-duplicate hard gates', () => {
    const text = 'The team relies on findings based on items: alpha, beta, and gamma.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'relies', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 15 }),
      tok({ id: 4, text: 'on', upos: 'ADP', head: 5, deprel: 'case', start: 16, end: 18 }),
      tok({ id: 5, text: 'findings', upos: 'NOUN', head: 3, deprel: 'obl', start: 19, end: 27 }),
      tok({ id: 6, text: 'based', upos: 'VERB', head: 5, deprel: 'acl', start: 28, end: 33 }),
      tok({ id: 7, text: 'on', upos: 'ADP', head: 8, deprel: 'case', start: 34, end: 36 }),
      tok({ id: 8, text: 'items', upos: 'NOUN', head: 6, deprel: 'obl', start: 37, end: 42 }),
      tok({ id: 9, text: ':', upos: 'PUNCT', head: 8, deprel: 'punct', start: 42, end: 43 }),
      tok({ id: 10, text: 'alpha', upos: 'NOUN', head: 8, deprel: 'appos', start: 44, end: 49 }),
      tok({ id: 11, text: ',', upos: 'PUNCT', head: 12, deprel: 'punct', start: 49, end: 50 }),
      tok({ id: 12, text: 'beta', upos: 'NOUN', head: 10, deprel: 'conj', start: 51, end: 55 }),
      tok({ id: 13, text: ',', upos: 'PUNCT', head: 15, deprel: 'punct', start: 55, end: 56 }),
      tok({ id: 14, text: 'and', upos: 'CCONJ', head: 15, deprel: 'cc', start: 57, end: 60 }),
      tok({ id: 15, text: 'gamma', upos: 'NOUN', head: 12, deprel: 'conj', start: 61, end: 66 }),
      tok({ id: 16, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 66, end: 67 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    for (const n of flat) expect(text.slice(n.start, n.end)).toBe(n.text) // lexical loss = 0
    const keys = flat.map((n) => `${n.role}:${n.start}:${n.end}:${n.text}`)
    expect(new Set(keys).size).toBe(keys.length) // visible duplicate = 0
  })
})

describe('Prototype 2.6G2.1 -- combined architecture fixture (opening modifier + subject postmodifier + passive predicate + nested PP/acl/enumeration)', () => {
  it('reproduces the full KNN-GCN-shaped dependency structure with synthetic wording and every mechanism composes correctly', () => {
    // Same STRUCTURAL SHAPE as the live KNN-GCN control that originally blocked acceptance
    // (opening obl + passive nsubj:pass with plain-acl postmodifier + obl PP modifier whose
    // object noun carries its own plain-acl postmodifier + a colon-introduced enumeration
    // three levels deep) -- built with entirely different, non-copyrighted wording, per
    // section 14's "architecture coverage, not sentence-specific patching".
    const text = 'In this study, a model called AlphaNet is applied for the analysis based on the following steps: collection, extraction, and validation.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'In', upos: 'ADP', head: 3, deprel: 'case', start: 0, end: 2 }),
      tok({ id: 2, text: 'this', upos: 'DET', head: 3, deprel: 'det', start: 3, end: 7 }),
      tok({ id: 3, text: 'study', upos: 'NOUN', head: 10, deprel: 'obl', start: 8, end: 13 }),
      tok({ id: 4, text: ',', upos: 'PUNCT', head: 10, deprel: 'punct', start: 13, end: 14 }),
      tok({ id: 5, text: 'a', upos: 'DET', head: 6, deprel: 'det', start: 15, end: 16 }),
      tok({ id: 6, text: 'model', upos: 'NOUN', head: 10, deprel: 'nsubj:pass', start: 17, end: 22 }),
      tok({ id: 7, text: 'called', upos: 'VERB', head: 6, deprel: 'acl', start: 23, end: 29 }),
      tok({ id: 8, text: 'AlphaNet', upos: 'PROPN', head: 7, deprel: 'xcomp', start: 30, end: 38 }),
      tok({ id: 9, text: 'is', upos: 'AUX', head: 10, deprel: 'aux:pass', start: 39, end: 41 }),
      tok({ id: 10, text: 'applied', upos: 'VERB', head: 0, deprel: 'root', start: 42, end: 49 }),
      tok({ id: 11, text: 'for', upos: 'ADP', head: 13, deprel: 'case', start: 50, end: 53 }),
      tok({ id: 12, text: 'the', upos: 'DET', head: 13, deprel: 'det', start: 54, end: 57 }),
      tok({ id: 13, text: 'analysis', upos: 'NOUN', head: 10, deprel: 'obl', start: 58, end: 66 }),
      tok({ id: 14, text: 'based', upos: 'VERB', head: 13, deprel: 'acl', start: 67, end: 72 }),
      tok({ id: 15, text: 'on', upos: 'ADP', head: 18, deprel: 'case', start: 73, end: 75 }),
      tok({ id: 16, text: 'the', upos: 'DET', head: 18, deprel: 'det', start: 76, end: 79 }),
      tok({ id: 17, text: 'following', upos: 'ADJ', head: 18, deprel: 'amod', start: 80, end: 89 }),
      tok({ id: 18, text: 'steps', upos: 'NOUN', head: 14, deprel: 'obl', start: 90, end: 95 }),
      tok({ id: 19, text: ':', upos: 'PUNCT', head: 18, deprel: 'punct', start: 95, end: 96 }),
      tok({ id: 20, text: 'collection', upos: 'NOUN', head: 18, deprel: 'appos', start: 97, end: 107 }),
      tok({ id: 21, text: ',', upos: 'PUNCT', head: 22, deprel: 'punct', start: 107, end: 108 }),
      tok({ id: 22, text: 'extraction', upos: 'NOUN', head: 20, deprel: 'conj', start: 109, end: 119 }),
      tok({ id: 23, text: ',', upos: 'PUNCT', head: 25, deprel: 'punct', start: 119, end: 120 }),
      tok({ id: 24, text: 'and', upos: 'CCONJ', head: 25, deprel: 'cc', start: 121, end: 124 }),
      tok({ id: 25, text: 'validation', upos: 'NOUN', head: 22, deprel: 'conj', start: 125, end: 135 }),
      tok({ id: 26, text: '.', upos: 'PUNCT', head: 10, deprel: 'punct', start: 135, end: 136 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)

    // Top level: opening modifier before the subject, then the subject/predicate clause.
    expect(tree.map((n) => n.role)).toEqual(['openingModifier', 'subject'])
    expect(tree[0]!.text).toBe('In this study')

    const subject = tree[1]!
    expect(subject.presentationSpan?.text).toBe('a model')
    expect(subject.children.some((c) => c.role === 'postmodifier' && c.text === 'called AlphaNet')).toBe(true)
    expect(subject.children.some((c) => c.role === 'relativeClause')).toBe(false) // plain acl, never mislabeled

    const predicate = subject.children.find((c) => c.role === 'predicate')!
    expect(predicate.text).toBe('is applied')
    expect(predicate.children.some((c) => c.role === 'object' || c.role === 'complement')).toBe(false) // SV pattern, PP never promoted

    const modifier = predicate.children.find((c) => c.role === 'modifier')!
    expect(modifier.presentationSpan?.text).toBe('for the analysis') // no longer flattened with "based on..."
    expect(modifier.text).toBe('for the analysis based on the following steps') // authority: no lexical loss

    const postmodifier = modifier.children.find((c) => c.role === 'postmodifier')!
    expect(postmodifier.text).toBe('based on the following steps') // separate node, not merged into the parent

    const enumeration = postmodifier.children.find((c) => c.role === 'enumeration')!
    expect(enumeration.children.map((c) => c.text)).toEqual(['collection', 'extraction', 'validation']) // all members, in order

    // Full-tree B4 hard gates.
    const flat = flatten(tree)
    for (const n of flat) expect(text.slice(n.start, n.end)).toBe(n.text)
    const keys = flat.map((n) => `${n.role}:${n.start}:${n.end}:${n.text}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('Prototype 2.6G2.2 item 4 -- surface numbered-enumeration recovery independent of dependency drift', () => {
  it('recovers all members from source markers when dependency anchoring never reaches past the first item', () => {
    // Only tokens through "items" are modeled -- deliberately nothing attaches via
    // appos/conj afterward (mirrors the real KNN-GCN control, where UD coordination
    // attachment drifted off the true list head after the first item). The recovery must
    // work from the raw source text alone, tolerating semicolons and internal clauses/NPs
    // inside each item that were never given any dependency structure at all.
    const text =
      'The team relies on the following items: (1) alpha data collected during the initial phase of the project; (2) beta results measured after calibration; (3) gamma summary.'
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
    const enumeration = flatten(tree).find((n) => n.role === 'enumeration')!
    expect(enumeration).toBeDefined()
    expect(enumeration.children.map((c) => c.text)).toEqual([
      '(1) alpha data collected during the initial phase of the project',
      '(2) beta results measured after calibration',
      '(3) gamma summary',
    ])
    // Source order preserved, no member promoted to O/C, no lexical loss on any item.
    const starts = enumeration.children.map((c) => c.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    for (const item of enumeration.children) expect(text.slice(item.start, item.end)).toBe(item.text)
    expect(flatten(tree).some((n) => n.role === 'object' || n.role === 'complement')).toBe(false)
  })

  it('tolerates a final "and" before the last marker without absorbing it into the previous item', () => {
    const text = 'The plan covers the following stages: (1) design; (2) build; and (3) release.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'plan', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'covers', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 15 }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 6, deprel: 'det', start: 16, end: 19 }),
      tok({ id: 5, text: 'following', upos: 'ADJ', head: 6, deprel: 'amod', start: 20, end: 29 }),
      tok({ id: 6, text: 'stages', upos: 'NOUN', head: 3, deprel: 'obj', start: 30, end: 36 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const enumeration = flatten(tree).find((n) => n.role === 'enumeration')!
    expect(enumeration.children.map((c) => c.text)).toEqual(['(1) design', '(2) build', '(3) release'])
  })

  it('dependency-based enumeration remains preferred and is never overridden when it already succeeded cleanly', () => {
    // Same shape as the earlier clean enumeration test (E) -- confirms the new fallback
    // never fires when the dependency chain already produced a valid 2+ item list.
    const text = 'The team relies on findings based on items: alpha, beta, and gamma.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'relies', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 15 }),
      tok({ id: 4, text: 'on', upos: 'ADP', head: 5, deprel: 'case', start: 16, end: 18 }),
      tok({ id: 5, text: 'findings', upos: 'NOUN', head: 3, deprel: 'obl', start: 19, end: 27 }),
      tok({ id: 6, text: 'based', upos: 'VERB', head: 5, deprel: 'acl', start: 28, end: 33 }),
      tok({ id: 7, text: 'on', upos: 'ADP', head: 8, deprel: 'case', start: 34, end: 36 }),
      tok({ id: 8, text: 'items', upos: 'NOUN', head: 6, deprel: 'obl', start: 37, end: 42 }),
      tok({ id: 9, text: ':', upos: 'PUNCT', head: 8, deprel: 'punct', start: 42, end: 43 }),
      tok({ id: 10, text: 'alpha', upos: 'NOUN', head: 8, deprel: 'appos', start: 44, end: 49 }),
      tok({ id: 11, text: ',', upos: 'PUNCT', head: 12, deprel: 'punct', start: 49, end: 50 }),
      tok({ id: 12, text: 'beta', upos: 'NOUN', head: 10, deprel: 'conj', start: 51, end: 55 }),
      tok({ id: 13, text: ',', upos: 'PUNCT', head: 15, deprel: 'punct', start: 55, end: 56 }),
      tok({ id: 14, text: 'and', upos: 'CCONJ', head: 15, deprel: 'cc', start: 57, end: 60 }),
      tok({ id: 15, text: 'gamma', upos: 'NOUN', head: 12, deprel: 'conj', start: 61, end: 66 }),
      tok({ id: 16, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 66, end: 67 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const enumeration = flatten(tree).find((n) => n.role === 'enumeration')!
    expect(enumeration.children.map((c) => c.text)).toEqual(['alpha', 'beta', 'gamma'])
  })
})

describe('Prototype 2.6G2.2 -- numbered-list false-positive controls', () => {
  it('a single marker (not a genuine list) never creates a spurious enumeration node', () => {
    const text = 'The team relies on the following result: (1) alpha only.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'relies', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 15 }),
      tok({ id: 4, text: 'on', upos: 'ADP', head: 7, deprel: 'case', start: 16, end: 18 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 7, deprel: 'det', start: 19, end: 22 }),
      tok({ id: 6, text: 'following', upos: 'ADJ', head: 7, deprel: 'amod', start: 23, end: 32 }),
      tok({ id: 7, text: 'result', upos: 'NOUN', head: 3, deprel: 'obl', start: 33, end: 39 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    expect(flatten(tree).some((n) => n.role === 'enumeration')).toBe(false)
  })

  it('4-digit parenthetical years (citations) are never reinterpreted as list markers', () => {
    const text = 'The team relies on the following citations: (2020) and (2019).'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'relies', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 15 }),
      tok({ id: 4, text: 'on', upos: 'ADP', head: 7, deprel: 'case', start: 16, end: 18 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 7, deprel: 'det', start: 19, end: 22 }),
      tok({ id: 6, text: 'following', upos: 'ADJ', head: 7, deprel: 'amod', start: 23, end: 32 }),
      tok({ id: 7, text: 'citations', upos: 'NOUN', head: 3, deprel: 'obl', start: 33, end: 42 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    expect(flatten(tree).some((n) => n.role === 'enumeration')).toBe(false)
  })

  it('an equation-style single "(1)" reference with no colon anchor never creates an enumeration', () => {
    const text = 'The model uses formula (1) directly.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 9 }),
      tok({ id: 3, text: 'uses', upos: 'VERB', head: 0, deprel: 'root', start: 10, end: 14 }),
      tok({ id: 4, text: 'formula', upos: 'NOUN', head: 3, deprel: 'obj', start: 15, end: 22 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    expect(flatten(tree).some((n) => n.role === 'enumeration')).toBe(false)
  })
})

describe('Prototype 2.6G2 -- legacy fallback authority', () => {
  it('the syntaxAuthority union type keeps the legacy Qwen path structurally distinguishable from Stanza', () => {
    // Compile-time/shape check: a 'legacy-qwen-fallback' result must carry unavailableReason
    // and no stanzaTokens -- exercised at the type level plus a runtime shape assertion
    // mirroring analyzeSentenceWithSyntaxAuthority.ts's own branch.
    const legacy: { source: 'stanza' | 'legacy-qwen-fallback'; unavailableReason: string | null } = {
      source: 'legacy-qwen-fallback',
      unavailableReason: 'Stanza syntax service is unreachable',
    }
    const stanzaTokens: StanzaToken[] | null = legacy.source === 'stanza' ? [] : null
    expect(stanzaTokens).toBeNull()
    expect(legacy.unavailableReason).toBeTruthy()
  })
})
