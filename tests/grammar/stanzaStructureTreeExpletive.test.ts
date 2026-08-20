import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.5B2 item 1 -- existential/expletive "there" presentation. Controls A-D:
 * (A) existential "there" (expl), (B) genuine locative "there" (advmod, a totally different
 * dependency role that must be completely unaffected), (C) existential "there" nested inside
 * a subordinate clause, (D) existential "there" in the main clause. Distinguished purely by
 * Stanza's own dependency role, never by matching the word "there" itself.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

describe('Prototype 2.6G2.5B2 item 1 -- expletive vs. locative "there" controls (A-D)', () => {
  it('(A)/(C) existential "there" (expl) inside a subordinate clause renders as role "expletive", exactly once, never openingModifier/subject/O-C', () => {
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
    expect(flat.filter((n) => n.role === 'expletive')).toHaveLength(1)
    expect(flat.filter((n) => n.text === 'there')).toHaveLength(1)
    expect(flat.some((n) => n.role === 'openingModifier')).toBe(false)
    expect(flat.some((n) => (n.role === 'subject' || n.role === 'object' || n.role === 'complement') && n.text === 'there')).toBe(false)
    // Remains inside its own subordinate clause -- never a top-level sibling.
    expect(tree.some((n) => n.role === 'expletive')).toBe(false)
  })

  it('(B) a genuine locative "there" (advmod) is completely unaffected -- an ordinary modifier, never "expletive"', () => {
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
    const thereNode = flat.find((n) => n.text === 'there')!
    expect(thereNode).toBeDefined()
    expect(thereNode.role).toBe('modifier')
  })

  it('(D) existential "there" (expl) directly in the main clause renders identically to the subordinate case', () => {
    const text = 'There is a problem.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'There', upos: 'PRON', head: 2, deprel: 'expl', start: 0, end: 5 }),
      tok({ id: 2, text: 'is', upos: 'VERB', head: 0, deprel: 'root', start: 6, end: 8 }),
      tok({ id: 3, text: 'a', upos: 'DET', head: 4, deprel: 'det', start: 9, end: 10 }),
      tok({ id: 4, text: 'problem', upos: 'NOUN', head: 2, deprel: 'nsubj', start: 11, end: 18 }),
      tok({ id: 5, text: '.', upos: 'PUNCT', head: 2, deprel: 'punct', start: 18, end: 19 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    const expletives = flat.filter((n) => n.role === 'expletive')
    expect(expletives).toHaveLength(1)
    expect(expletives[0]!.text).toBe('There')
    expect(flat.some((n) => n.role === 'openingModifier')).toBe(false)
    // Prototype 2.6G2.6B item 8/9/10: existential surface-reading order -- the top-level
    // node is now the expletive itself (marker-less here, since the main clause has no
    // marker), wrapping predicate -> subject, not the grammatically-encoded
    // subject -> predicate -> expletive nesting.
    const expletive = tree.find((n) => n.role === 'expletive')!
    expect(expletive).toBeDefined()
    expect(expletive.text).toBe('There')
    const predicate = expletive.children.find((c) => c.role === 'predicate')!
    expect(predicate).toBeDefined()
    const subject = predicate.children.find((c) => c.role === 'subject')!
    expect(subject).toBeDefined()
    expect(subject.text).toBe('a problem')
  })
})
