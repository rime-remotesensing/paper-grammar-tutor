import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.8 -- Three-Way Coordinated Passive Clause Tree.
 *
 * Real live-traced defect: a sentence with THREE coordinated finite passive clauses joined by
 * commas plus one final "and" is not attached uniformly by Stanza's own UD parse -- the first
 * becomes `root`; a peer joined via a bare `conj` shares the root's own ClauseFrame (already
 * correctly split into its own subject/predicate branch by the existing "Class B explicit-
 * subject clause coordination" logic); but a peer joined via `parataxis` instead receives its
 * own entirely separate ClauseFrame and was previously rendered as a disconnected top-level
 * sibling, landing outside the visual coordination group even though it is structurally the
 * same kind of peer. Fixed by UNWRAPPING the Class-B branches back into flat top-level array
 * entries whenever a qualifying parataxis peer (own explicit subject, anchored directly to the
 * main clause) exists, so every peer -- conj- or parataxis-attached alike -- ends up as an
 * ordinary flat sibling; the existing, unmodified `layoutSiblingsWithCoordinationGroups`
 * render-time mechanism then brackets them together using its own connector/gap evidence.
 *
 * A second, independent defect fixed alongside it: `buildClauseSubtree`'s own subordinate-
 * clause attachment previously appended ANY subjectless subordinate clause as a bare SIBLING
 * of its host's predicate node, promoting a genuine dependent modifier (e.g. "using X") to
 * apparent peer status. Generalized via `attachSubjectlessSubordinateModifiers`, gated on (a)
 * no explicit subject of its own, (b) attaches directly to one of the host clause's own
 * predicate heads, (c) no infinitival ('to', upos PART) marker of its own -- an infinitival
 * purpose clause ("to test the new method") keeps its existing, correct independent
 * presentation, distinguishing it from a bare gerund/participial modifier.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

describe('Prototype 2.6G2.8 -- three-way coordinated passive clause tree', () => {
  it('TEST A: real three-way passive coordination -- "Slope values were varied between 0° and 46° at 2° intervals, aspect was varied over the full 360° range, using a 20° increment, and crown closure was varied between 10% and 90% CC at 10% increments."', () => {
    const text =
      'Slope values were varied between 0° and 46° at 2° intervals, aspect was varied over the full 360° range, using a 20° increment, and crown closure was varied between 10% and 90% CC at 10% increments.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'Slope', upos: 'NOUN', head: 2, deprel: 'compound', start: 0, end: 5 }),
      tok({ id: 2, text: 'values', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', start: 6, end: 12 }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 4, deprel: 'aux:pass', start: 13, end: 17 }),
      tok({ id: 4, text: 'varied', upos: 'VERB', head: 0, deprel: 'root', start: 18, end: 24 }),
      tok({ id: 5, text: 'between', upos: 'ADP', head: 7, deprel: 'case', start: 25, end: 32 }),
      tok({ id: 6, text: '0', upos: 'NUM', head: 7, deprel: 'nummod', start: 33, end: 34 }),
      tok({ id: 7, text: '°', upos: 'NOUN', head: 4, deprel: 'obl', start: 34, end: 35 }),
      tok({ id: 8, text: 'and', upos: 'CCONJ', head: 10, deprel: 'cc', start: 36, end: 39 }),
      tok({ id: 9, text: '46', upos: 'NUM', head: 10, deprel: 'nummod', start: 40, end: 42 }),
      tok({ id: 10, text: '°', upos: 'NOUN', head: 7, deprel: 'conj', start: 42, end: 43 }),
      tok({ id: 11, text: 'at', upos: 'ADP', head: 14, deprel: 'case', start: 44, end: 46 }),
      tok({ id: 12, text: '2', upos: 'NUM', head: 13, deprel: 'nummod', start: 47, end: 48 }),
      tok({ id: 13, text: '°', upos: 'NOUN', head: 14, deprel: 'compound', start: 48, end: 49 }),
      tok({ id: 14, text: 'intervals', upos: 'NOUN', head: 7, deprel: 'nmod', start: 50, end: 59 }),
      tok({ id: 15, text: ',', upos: 'PUNCT', head: 18, deprel: 'punct', start: 59, end: 60 }),
      tok({ id: 16, text: 'aspect', upos: 'NOUN', head: 18, deprel: 'nsubj:pass', start: 61, end: 67 }),
      tok({ id: 17, text: 'was', upos: 'AUX', head: 18, deprel: 'aux:pass', start: 68, end: 71 }),
      tok({ id: 18, text: 'varied', upos: 'VERB', head: 4, deprel: 'parataxis', start: 72, end: 78 }),
      tok({ id: 19, text: 'over', upos: 'ADP', head: 24, deprel: 'case', start: 79, end: 83 }),
      tok({ id: 20, text: 'the', upos: 'DET', head: 24, deprel: 'det', start: 84, end: 87 }),
      tok({ id: 21, text: 'full', upos: 'ADJ', head: 24, deprel: 'amod', start: 88, end: 92 }),
      tok({ id: 22, text: '360', upos: 'NUM', head: 23, deprel: 'nummod', start: 93, end: 96 }),
      tok({ id: 23, text: '°', upos: 'NOUN', head: 24, deprel: 'compound', start: 96, end: 97 }),
      tok({ id: 24, text: 'range', upos: 'NOUN', head: 18, deprel: 'obl', start: 98, end: 103 }),
      tok({ id: 25, text: ',', upos: 'PUNCT', head: 26, deprel: 'punct', start: 103, end: 104 }),
      tok({ id: 26, text: 'using', upos: 'VERB', head: 18, deprel: 'advcl', start: 105, end: 110 }),
      tok({ id: 27, text: 'a', upos: 'DET', head: 30, deprel: 'det', start: 111, end: 112 }),
      tok({ id: 28, text: '20', upos: 'NUM', head: 29, deprel: 'nummod', start: 113, end: 115 }),
      tok({ id: 29, text: '°', upos: 'NOUN', head: 30, deprel: 'compound', start: 115, end: 116 }),
      tok({ id: 30, text: 'increment', upos: 'NOUN', head: 26, deprel: 'obj', start: 117, end: 126 }),
      tok({ id: 31, text: ',', upos: 'PUNCT', head: 36, deprel: 'punct', start: 126, end: 127 }),
      tok({ id: 32, text: 'and', upos: 'CCONJ', head: 36, deprel: 'cc', start: 128, end: 131 }),
      tok({ id: 33, text: 'crown', upos: 'NOUN', head: 34, deprel: 'compound', start: 132, end: 137 }),
      tok({ id: 34, text: 'closure', upos: 'NOUN', head: 36, deprel: 'nsubj:pass', start: 138, end: 145 }),
      tok({ id: 35, text: 'was', upos: 'AUX', head: 36, deprel: 'aux:pass', start: 146, end: 149 }),
      tok({ id: 36, text: 'varied', upos: 'VERB', head: 4, deprel: 'conj', start: 150, end: 156 }),
      tok({ id: 37, text: 'between', upos: 'ADP', head: 39, deprel: 'case', start: 157, end: 164 }),
      tok({ id: 38, text: '10', upos: 'NUM', head: 39, deprel: 'nummod', start: 165, end: 167 }),
      tok({ id: 39, text: '%', upos: 'SYM', head: 36, deprel: 'obl', start: 167, end: 168 }),
      tok({ id: 40, text: 'and', upos: 'CCONJ', head: 43, deprel: 'cc', start: 169, end: 172 }),
      tok({ id: 41, text: '90', upos: 'NUM', head: 42, deprel: 'nummod', start: 173, end: 175 }),
      tok({ id: 42, text: '%', upos: 'SYM', head: 39, deprel: 'conj', start: 175, end: 176 }),
      tok({ id: 43, text: 'CC', upos: 'PROPN', head: 39, deprel: 'conj', start: 177, end: 179 }),
      tok({ id: 44, text: 'at', upos: 'ADP', head: 47, deprel: 'case', start: 180, end: 182 }),
      tok({ id: 45, text: '10', upos: 'NUM', head: 46, deprel: 'nummod', start: 183, end: 185 }),
      tok({ id: 46, text: '%', upos: 'SYM', head: 47, deprel: 'compound', start: 185, end: 186 }),
      tok({ id: 47, text: 'increments', upos: 'NOUN', head: 36, deprel: 'obl', start: 187, end: 197 }),
      tok({ id: 48, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 197, end: 198 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)

    // Exactly three clause-level peers, flat at the top level.
    expect(tree).toHaveLength(3)
    expect(tree.every((n) => n.role === 'subject')).toBe(true)

    // Peer source order: Slope values -> aspect -> crown closure.
    const starts = tree.map((n) => n.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(tree[0]!.text).toBe('Slope values')
    expect(tree[1]!.text).toBe('aspect')
    expect(tree[2]!.text).toBe('crown closure')

    // All three finite passive predicates retained.
    const predicate1 = tree[0]!.children.find((c) => c.role === 'predicate')!
    const predicate2 = tree[1]!.children.find((c) => c.role === 'predicate')!
    const predicate3 = tree[2]!.children.find((c) => c.role === 'predicate' || c.role === 'coordinatedPredicate')!
    expect(predicate1?.text).toBe('were varied')
    expect(predicate2?.text).toBe('was varied')
    expect(predicate3?.text).toBe('was varied')

    // Final coordinator belongs to the THIRD peer only -- never the first or second.
    expect(tree[0]!.connector).toBeUndefined()
    expect(tree[1]!.connector).toBeUndefined()
    expect(tree[2]!.connector?.text).toBe('and')

    // "using a 20° increment" belongs under the SECOND clause's own predicate, as a modifier
    // -- never promoted to independent/peer status.
    const usingModifier = predicate2.children.find((c) => c.role === 'modifier' && c.text.startsWith('using'))
    expect(usingModifier).toBeDefined()
    expect(usingModifier!.text).toBe('using a 20° increment')
    expect(tree.some((n) => n.text === 'using')).toBe(false)

    // No duplicate spans, no missing spans.
    const flat = flatten(tree)
    expect(flat.filter((n) => n.text === 'Slope values')).toHaveLength(1)
    expect(flat.filter((n) => n.text === 'aspect')).toHaveLength(1)
    expect(flat.filter((n) => n.text === 'crown closure')).toHaveLength(1)
    expect(flat.filter((n) => n.text === 'using a 20° increment')).toHaveLength(1)
    expect(flat.filter((n) => n.text === 'over the full 360° range')).toHaveLength(1)
    expect(flat.filter((n) => n.text === 'between 10% and 90% CC')).toHaveLength(1)
  })

  it('TEST B: non-finite method modifier -- "The samples were analyzed at room temperature, using a calibrated sensor." keeps "using" as a modifier, never a peer clause', () => {
    const text = 'The samples were analyzed at room temperature, using a calibrated sensor.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'samples', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', start: 4, end: 11 }),
      tok({ id: 3, text: 'were', upos: 'AUX', head: 4, deprel: 'aux:pass', start: 12, end: 16 }),
      tok({ id: 4, text: 'analyzed', upos: 'VERB', head: 0, deprel: 'root', start: 17, end: 25 }),
      tok({ id: 5, text: 'at', upos: 'ADP', head: 7, deprel: 'case', start: 26, end: 28 }),
      tok({ id: 6, text: 'room', upos: 'NOUN', head: 7, deprel: 'compound', start: 29, end: 33 }),
      tok({ id: 7, text: 'temperature', upos: 'NOUN', head: 4, deprel: 'obl', start: 34, end: 45 }),
      tok({ id: 8, text: ',', upos: 'PUNCT', head: 9, deprel: 'punct', start: 45, end: 46 }),
      tok({ id: 9, text: 'using', upos: 'VERB', head: 4, deprel: 'advcl', start: 47, end: 52 }),
      tok({ id: 10, text: 'a', upos: 'DET', head: 12, deprel: 'det', start: 53, end: 54 }),
      tok({ id: 11, text: 'calibrated', upos: 'VERB', head: 12, deprel: 'amod', start: 55, end: 65 }),
      tok({ id: 12, text: 'sensor', upos: 'NOUN', head: 9, deprel: 'obj', start: 66, end: 72 }),
      tok({ id: 13, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 72, end: 73 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    // Single top-level structure -- the finite predicate remains primary, never orphaned.
    expect(tree).toHaveLength(1)
    expect(tree[0]!.role).toBe('subject')
    const predicate = tree[0]!.children.find((c) => c.role === 'predicate')!
    expect(predicate).toBeDefined()
    const usingModifier = predicate.children.find((c) => c.role === 'modifier' && c.text.startsWith('using'))
    expect(usingModifier).toBeDefined()
    expect(usingModifier!.text).toBe('using a calibrated sensor')
    // "using" is never promoted to a peer finite clause / independent top-level node.
    expect(tree.some((n) => n.text.startsWith('using'))).toBe(false)
  })

  it('TEST C: legitimate three-clause finite coordination -- "The soil was sampled at each site, the pH was measured in the laboratory, and the results were recorded in a database." preserves source order', () => {
    const text = 'The soil was sampled at each site, the pH was measured in the laboratory, and the results were recorded in a database.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'soil', upos: 'NOUN', head: 4, deprel: 'nsubj:pass', start: 4, end: 8 }),
      tok({ id: 3, text: 'was', upos: 'AUX', head: 4, deprel: 'aux:pass', start: 9, end: 12 }),
      tok({ id: 4, text: 'sampled', upos: 'VERB', head: 0, deprel: 'root', start: 13, end: 20 }),
      tok({ id: 5, text: 'at', upos: 'ADP', head: 7, deprel: 'case', start: 21, end: 23 }),
      tok({ id: 6, text: 'each', upos: 'DET', head: 7, deprel: 'det', start: 24, end: 28 }),
      tok({ id: 7, text: 'site', upos: 'NOUN', head: 4, deprel: 'obl', start: 29, end: 33 }),
      tok({ id: 8, text: ',', upos: 'PUNCT', head: 12, deprel: 'punct', start: 33, end: 34 }),
      tok({ id: 9, text: 'the', upos: 'DET', head: 10, deprel: 'det', start: 35, end: 38 }),
      tok({ id: 10, text: 'pH', upos: 'NOUN', head: 12, deprel: 'nsubj:pass', start: 39, end: 41 }),
      tok({ id: 11, text: 'was', upos: 'AUX', head: 12, deprel: 'aux:pass', start: 42, end: 45 }),
      tok({ id: 12, text: 'measured', upos: 'VERB', head: 4, deprel: 'parataxis', start: 46, end: 54 }),
      tok({ id: 13, text: 'in', upos: 'ADP', head: 15, deprel: 'case', start: 55, end: 57 }),
      tok({ id: 14, text: 'the', upos: 'DET', head: 15, deprel: 'det', start: 58, end: 61 }),
      tok({ id: 15, text: 'laboratory', upos: 'NOUN', head: 12, deprel: 'obl', start: 62, end: 72 }),
      tok({ id: 16, text: ',', upos: 'PUNCT', head: 21, deprel: 'punct', start: 72, end: 73 }),
      tok({ id: 17, text: 'and', upos: 'CCONJ', head: 21, deprel: 'cc', start: 74, end: 77 }),
      tok({ id: 18, text: 'the', upos: 'DET', head: 19, deprel: 'det', start: 78, end: 81 }),
      tok({ id: 19, text: 'results', upos: 'NOUN', head: 21, deprel: 'nsubj:pass', start: 82, end: 89 }),
      tok({ id: 20, text: 'were', upos: 'AUX', head: 21, deprel: 'aux:pass', start: 90, end: 94 }),
      tok({ id: 21, text: 'recorded', upos: 'VERB', head: 4, deprel: 'conj', start: 95, end: 103 }),
      tok({ id: 22, text: 'in', upos: 'ADP', head: 24, deprel: 'case', start: 104, end: 106 }),
      tok({ id: 23, text: 'a', upos: 'DET', head: 24, deprel: 'det', start: 107, end: 108 }),
      tok({ id: 24, text: 'database', upos: 'NOUN', head: 21, deprel: 'obl', start: 109, end: 117 }),
      tok({ id: 25, text: '.', upos: 'PUNCT', head: 4, deprel: 'punct', start: 117, end: 118 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    expect(tree).toHaveLength(3)
    const starts = tree.map((n) => n.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(tree[0]!.text).toBe('The soil')
    expect(tree[1]!.text).toBe('the pH')
    expect(tree[2]!.text).toBe('the results')
    expect(tree[0]!.connector).toBeUndefined()
    expect(tree[1]!.connector).toBeUndefined()
    expect(tree[2]!.connector?.text).toBe('and')
  })

  it('TEST D: legitimate infinitival purpose clause negative -- "The team built the tool to test the new method." keeps "to test the new method" as its own independent clause, never collapsed into a modifier', () => {
    const text = 'The team built the tool to test the new method.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'built', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 14 }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', start: 15, end: 18 }),
      tok({ id: 5, text: 'tool', upos: 'NOUN', head: 3, deprel: 'obj', start: 19, end: 23 }),
      tok({ id: 6, text: 'to', upos: 'PART', head: 7, deprel: 'mark', start: 24, end: 26 }),
      tok({ id: 7, text: 'test', upos: 'VERB', head: 3, deprel: 'advcl', start: 27, end: 31 }),
      tok({ id: 8, text: 'the', upos: 'DET', head: 10, deprel: 'det', start: 32, end: 35 }),
      tok({ id: 9, text: 'new', upos: 'ADJ', head: 10, deprel: 'amod', start: 36, end: 39 }),
      tok({ id: 10, text: 'method', upos: 'NOUN', head: 7, deprel: 'obj', start: 40, end: 46 }),
      tok({ id: 11, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 46, end: 47 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    // The infinitival purpose clause is NOT swallowed as a bare modifier of "built" -- it
    // remains its own independent, marked top-level clause (never promoted to peer-COORDINATE
    // status either, just retained as the architecture already correctly does).
    const clauseNode = tree.find((n) => n.role === 'clause')
    expect(clauseNode).toBeDefined()
    expect(clauseNode!.marker).toEqual({ text: 'to', start: 24, end: 26 })
    const predicate = clauseNode!.children.find((c) => c.role === 'predicate')!
    expect(predicate.text).toBe('test')
    // Never nested as a bare 'modifier' leaf under "built"'s own predicate node.
    const mainSubject = tree.find((n) => n.role === 'subject' && n.text === 'The team')!
    const builtPredicate = mainSubject.children.find((c) => c.role === 'predicate')!
    expect(builtPredicate.children.some((c) => c.role === 'modifier' && c.text.includes('test'))).toBe(false)
  })
})
