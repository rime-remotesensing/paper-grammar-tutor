import { describe, expect, it } from 'vitest'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.5B -- recursive meaningful-clause Structure Tree coverage. Synthetic
 * fixtures reproducing the general STRUCTURAL SHAPES diagnosed live (Prototype 2.6G2.4):
 * an existential expletive misclassified as an opening modifier, a clause-introducing
 * marker (if/because/.../infinitival "to") silently discarded, a subjectless subordinate
 * clause dropped outright, a non-restrictive (comma-gated) relative clause invisible to the
 * postmodifier extraction loop, and a subordinate clause's own local opening modifier
 * escaping to the sentence's top level. Different wording from the real live controls, same
 * dependency shapes.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

describe('Prototype 2.6G2.5B2 item 1 -- existential "there" (expl) is visible as an expletive, never an opener/subject/O-C', () => {
  it('an expl-marked "there" renders exactly once as role "expletive", not openingModifier, inside its own subordinate clause', () => {
    const text = 'The plan works well if there is enough time.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'plan', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'works', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 14 }),
      tok({ id: 4, text: 'well', upos: 'ADV', head: 3, deprel: 'advmod', start: 15, end: 19 }),
      tok({ id: 5, text: 'if', upos: 'SCONJ', head: 7, deprel: 'mark', start: 20, end: 22 }),
      tok({ id: 6, text: 'there', upos: 'PRON', head: 7, deprel: 'expl', start: 23, end: 28 }),
      tok({ id: 7, text: 'is', upos: 'VERB', head: 3, deprel: 'advcl', start: 29, end: 31 }),
      tok({ id: 8, text: 'enough', upos: 'ADJ', head: 9, deprel: 'amod', start: 32, end: 38 }),
      tok({ id: 9, text: 'time', upos: 'NOUN', head: 7, deprel: 'nsubj', start: 39, end: 43 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 43, end: 44 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const expletives = flat.filter((n) => n.role === 'expletive')
    expect(expletives).toHaveLength(1)
    expect(expletives[0]!.text).toBe('there')
    expect(flat.some((n) => n.role === 'openingModifier')).toBe(false)
    expect(flat.some((n) => n.role === 'subject' && n.text === 'there')).toBe(false)
    expect(flat.some((n) => (n.role === 'object' || n.role === 'complement') && n.text === 'there')).toBe(false)

    // The subordinate clause itself must still be retained, with its own marker as a
    // dedicated wrapper node (2.6G2.5B3 item 2/5 -- never fused onto the subject's own
    // text/label), and the expletive stays nested inside it -- never hoisted to the
    // sentence top level.
    // Prototype 2.6G2.6B item 8/9/10: an existential clause's own nesting is now
    // marker -> expletive -> predicate -> subject (English surface-reading order), not the
    // grammatically-encoded subject -> predicate -> expletive nesting used elsewhere.
    const subordinate = tree.find((n) => n.marker?.text === 'if')!
    expect(subordinate).toBeDefined()
    expect(subordinate.role).toBe('clause')
    expect(subordinate.text).toBe('if') // the wrapper's own text is the marker itself, never the subject
    const expletive = subordinate.children.find((c) => c.role === 'expletive')!
    expect(expletive).toBeDefined()
    expect(expletive.marker).toBeUndefined() // marker lives on the wrapper, never on the expletive node
    expect(expletive.text).toBe('there')
    const predicate = expletive.children.find((c) => c.role === 'predicate' && c.text === 'is')!
    expect(predicate).toBeDefined()
    const subject = predicate.children.find((c) => c.role === 'subject')!
    expect(subject).toBeDefined()
    expect(subject.text).toBe('enough time')
  })
})

describe('Prototype 2.6G2.5B item B10 -- clause markers survive visibly exactly once', () => {
  it('a subordinate clause with an overt subject carries its own marker as node metadata', () => {
    const text = 'The plan works well if there is enough time.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'plan', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'works', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 14 }),
      tok({ id: 4, text: 'well', upos: 'ADV', head: 3, deprel: 'advmod', start: 15, end: 19 }),
      tok({ id: 5, text: 'if', upos: 'SCONJ', head: 7, deprel: 'mark', start: 20, end: 22 }),
      tok({ id: 6, text: 'there', upos: 'PRON', head: 7, deprel: 'expl', start: 23, end: 28 }),
      tok({ id: 7, text: 'is', upos: 'VERB', head: 3, deprel: 'advcl', start: 29, end: 31 }),
      tok({ id: 8, text: 'enough', upos: 'ADJ', head: 9, deprel: 'amod', start: 32, end: 38 }),
      tok({ id: 9, text: 'time', upos: 'NOUN', head: 7, deprel: 'nsubj', start: 39, end: 43 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 43, end: 44 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const marked = flatten(tree).filter((n) => n.marker !== undefined)
    expect(marked).toHaveLength(1)
    expect(marked[0]!.marker).toEqual({ text: 'if', start: 20, end: 22 })
    // The main clause's own node never carries a spurious marker.
    const mainSubject = tree.find((n) => n.role === 'subject' && n.text === 'The plan')!
    expect(mainSubject.marker).toBeUndefined()
  })
})

describe('Prototype 2.6G2.5B item B12 -- subjectless (infinitival) subordinate clauses are retained, not dropped', () => {
  it('an infinitival advcl with no nsubj/csubj becomes a top-level "clause" node instead of being silently discarded', () => {
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
    const clauseNode = tree.find((n) => n.role === 'clause')
    expect(clauseNode).toBeDefined()
    expect(clauseNode!.marker).toEqual({ text: 'to', start: 24, end: 26 })
    const predicate = clauseNode!.children.find((c) => c.role === 'predicate')!
    expect(predicate.text).toBe('test')
    const object = predicate.children.find((c) => c.role === 'object')!
    expect(object.text).toBe('the new method')

    // Main clause's own canonical object is unaffected -- no O/C contamination from the
    // subjectless clause (item B12: "must not become O/C unless SentenceCoreSet says so").
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.predicateCores[0]?.object?.text).toBe('the tool')
  })
})

describe('Prototype 2.6G2.5B item B11 -- non-restrictive relative clauses are captured, not lost', () => {
  it('a comma-gated (non-restrictive) acl:relcl becomes a relativeClause child, never absorbed or dropped', () => {
    const text = 'The device, which requires calibration, failed yesterday.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'device', upos: 'NOUN', head: 8, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: ',', upos: 'PUNCT', head: 5, deprel: 'punct', start: 10, end: 11 }),
      tok({ id: 4, text: 'which', upos: 'PRON', head: 5, deprel: 'nsubj', start: 12, end: 17 }),
      tok({ id: 5, text: 'requires', upos: 'VERB', head: 2, deprel: 'acl:relcl', start: 18, end: 26 }),
      tok({ id: 6, text: 'calibration', upos: 'NOUN', head: 5, deprel: 'obj', start: 27, end: 38 }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', start: 38, end: 39 }),
      tok({ id: 8, text: 'failed', upos: 'VERB', head: 0, deprel: 'root', start: 40, end: 46 }),
      tok({ id: 9, text: 'yesterday', upos: 'ADV', head: 8, deprel: 'advmod', start: 47, end: 56 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', start: 56, end: 57 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const subject = tree.find((n) => n.role === 'subject')!
    expect(subject.text).toBe('The device') // authority: canonical span unaffected, no lexical loss
    const relativeClause = subject.children.find((c) => c.role === 'relativeClause')!
    expect(relativeClause).toBeDefined()
    expect(relativeClause.text).toBe('which requires calibration')

    // Basic Skeleton (canonical authority) stays exactly as before -- this is presentation
    // coverage, never a change to SentenceCoreSet.
    const { coreSet } = buildSentenceCoreSetFromStanzaTokens(text, tokens)
    expect(coreSet.subject?.text).toBe('The device')
  })

  it('a restrictive (no-comma) acl:relcl still works exactly as before -- no regression', () => {
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
})

describe('Prototype 2.6G2.5B item B8 -- opening modifiers stay scoped to their own clause', () => {
  it('a subordinate clause\'s own local opening modifier nests inside that clause, never hoisted to the sentence top level', () => {
    const text = 'The plan continues if under normal circumstances the system performs well.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'plan', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'continues', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 18 }),
      tok({ id: 4, text: 'if', upos: 'SCONJ', head: 10, deprel: 'mark', start: 19, end: 21 }),
      tok({ id: 5, text: 'under', upos: 'ADP', head: 7, deprel: 'case', start: 22, end: 27 }),
      tok({ id: 6, text: 'normal', upos: 'ADJ', head: 7, deprel: 'amod', start: 28, end: 34 }),
      tok({ id: 7, text: 'circumstances', upos: 'NOUN', head: 10, deprel: 'obl', start: 35, end: 48 }),
      tok({ id: 8, text: 'the', upos: 'DET', head: 9, deprel: 'det', start: 49, end: 52 }),
      tok({ id: 9, text: 'system', upos: 'NOUN', head: 10, deprel: 'nsubj', start: 53, end: 59 }),
      tok({ id: 10, text: 'performs', upos: 'VERB', head: 3, deprel: 'advcl', start: 60, end: 68 }),
      tok({ id: 11, text: 'well', upos: 'ADV', head: 10, deprel: 'advmod', start: 69, end: 73 }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 73, end: 74 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)

    // Exactly two top-level nodes: the main clause and the subordinate clause -- the
    // subordinate clause's own opening modifier must NOT appear as a third, separate
    // top-level sibling (the pre-2.6G2.5B bug).
    expect(tree).toHaveLength(2)

    const subordinate = tree.find((n) => n.marker?.text === 'if')!
    expect(subordinate).toBeDefined()
    const nestedOpening = subordinate.children.find((c) => c.role === 'openingModifier')
    expect(nestedOpening).toBeDefined()
    expect(nestedOpening!.text).toBe('under normal circumstances')
    expect(flatten(tree).filter((n) => n.role === 'openingModifier')).toHaveLength(1) // exactly one, and it's nested
  })
})
