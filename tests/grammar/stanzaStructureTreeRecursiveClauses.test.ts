import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.5B2 items 3/4/5 -- recursive clause ownership traversal, semicolon/
 * parataxis sibling-clause discovery, and the generalized buried-relative-clause scan (the
 * "interaction case"). Synthetic fixtures, different wording from the real corpus cases
 * these generalize, same dependency shapes.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

describe('Prototype 2.6G2.5B2 item 3 -- recursive multi-level clause nesting', () => {
  it('main -> subordinate -> subordinate: a 2-level chain nests at its true depth, never promoted to the sentence top level', () => {
    const text = 'The system works if conditions allow because resources permit.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'works', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 16 }),
      tok({ id: 4, text: 'if', upos: 'SCONJ', head: 6, deprel: 'mark', start: 17, end: 19 }),
      tok({ id: 5, text: 'conditions', upos: 'NOUN', head: 6, deprel: 'nsubj', start: 20, end: 30 }),
      tok({ id: 6, text: 'allow', upos: 'VERB', head: 3, deprel: 'advcl', start: 31, end: 36 }),
      tok({ id: 7, text: 'because', upos: 'SCONJ', head: 9, deprel: 'mark', start: 37, end: 44 }),
      tok({ id: 8, text: 'resources', upos: 'NOUN', head: 9, deprel: 'nsubj', start: 45, end: 54 }),
      tok({ id: 9, text: 'permit', upos: 'VERB', head: 6, deprel: 'advcl', start: 55, end: 61 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 61, end: 62 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    // Exactly 2 top-level nodes: main + the FIRST-level subordinate ("allow"). The
    // second-level subordinate ("permit") must NOT also appear here.
    expect(tree).toHaveLength(2)
    // Prototype 2.6G2.5B3 item 2/5: the marker is now its own dedicated wrapper node (role
    // 'clause', text === the marker word), never fused onto the subject's own text/label.
    const level1 = tree.find((n) => n.marker?.text === 'if')!
    expect(level1).toBeDefined()
    expect(level1.role).toBe('clause')
    expect(level1.text).toBe('if')
    const level1Subject = level1.children.find((c) => c.role === 'subject')!
    expect(level1Subject).toBeDefined()
    expect(level1Subject.text).toBe('conditions')
    const level1Predicate = level1Subject.children.find((c) => c.role === 'predicate' && c.text === 'allow')!
    expect(level1Predicate).toBeDefined()
    // The second-level subordinate nests as a sibling of the "if" clause's own subject,
    // still inside the "if" wrapper -- reachable, never promoted to the sentence top level.
    const level2 = level1.children.find((c) => c.marker?.text === 'because')!
    expect(level2).toBeDefined()
    expect(level2.role).toBe('clause')
    expect(level2.text).toBe('because')
    const level2Subject = level2.children.find((c) => c.role === 'subject')!
    expect(level2Subject).toBeDefined()
    expect(level2Subject.text).toBe('resources')
    expect(level2Subject.children.some((c) => c.role === 'predicate' && c.text === 'permit')).toBe(true)
  })

  it('main coordination -> subordinate: a subordinate clause anchored to a coordinated (non-root) predicate still resolves to the main clause', () => {
    const text = 'The system works and helps if conditions allow.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'works', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 16 }),
      tok({ id: 4, text: 'and', upos: 'CCONJ', head: 5, deprel: 'cc', start: 17, end: 20 }),
      tok({ id: 5, text: 'helps', upos: 'VERB', head: 3, deprel: 'conj', start: 21, end: 26 }),
      tok({ id: 6, text: 'if', upos: 'SCONJ', head: 8, deprel: 'mark', start: 27, end: 29 }),
      tok({ id: 7, text: 'conditions', upos: 'NOUN', head: 8, deprel: 'nsubj', start: 30, end: 40 }),
      tok({ id: 8, text: 'allow', upos: 'VERB', head: 5, deprel: 'advcl', start: 41, end: 46 }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 46, end: 47 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    expect(tree).toHaveLength(2)
    const subordinate = tree.find((n) => n.marker?.text === 'if')!
    expect(subordinate).toBeDefined()
    const subordinateSubject = subordinate.children.find((c) => c.role === 'subject')!
    expect(subordinateSubject.children.some((c) => c.role === 'predicate' && c.text === 'allow')).toBe(true)
    const main = tree.find((n) => n.role === 'subject')!
    expect(main.children.some((c) => c.role === 'coordinatedPredicate' && c.text === 'helps')).toBe(true)
  })

  it('subordinate containing coordination: a subordinate clause with its own two coordinated predicates', () => {
    const text = 'The system pauses if sensors fail and recover.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'pauses', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 17 }),
      tok({ id: 4, text: 'if', upos: 'SCONJ', head: 6, deprel: 'mark', start: 18, end: 20 }),
      tok({ id: 5, text: 'sensors', upos: 'NOUN', head: 6, deprel: 'nsubj', start: 21, end: 28 }),
      tok({ id: 6, text: 'fail', upos: 'VERB', head: 3, deprel: 'advcl', start: 29, end: 33 }),
      tok({ id: 7, text: 'and', upos: 'CCONJ', head: 8, deprel: 'cc', start: 34, end: 37 }),
      tok({ id: 8, text: 'recover', upos: 'VERB', head: 6, deprel: 'conj', start: 38, end: 45 }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 45, end: 46 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const subordinate = tree.find((n) => n.marker?.text === 'if')!
    expect(subordinate).toBeDefined()
    const subordinateSubject = subordinate.children.find((c) => c.role === 'subject')!
    expect(subordinateSubject).toBeDefined()
    expect(subordinateSubject.text).toBe('sensors')
    expect(subordinateSubject.children.some((c) => c.role === 'predicate' && c.text === 'fail')).toBe(true)
    const coordinated = subordinateSubject.children.find((c) => c.role === 'coordinatedPredicate')!
    expect(coordinated).toBeDefined()
    expect(coordinated.text).toBe('recover')
    expect(coordinated.connector?.text).toBe('and')
  })

  it('subordinate -> relative/postmodifier child: a subordinate clause\'s own subject retains its relative clause', () => {
    const text = 'The system pauses if sensors that fail require replacement.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'system', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'pauses', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 17 }),
      tok({ id: 4, text: 'if', upos: 'SCONJ', head: 8, deprel: 'mark', start: 18, end: 20 }),
      tok({ id: 5, text: 'sensors', upos: 'NOUN', head: 8, deprel: 'nsubj', start: 21, end: 28 }),
      tok({ id: 6, text: 'that', upos: 'PRON', head: 7, deprel: 'nsubj', start: 29, end: 33 }),
      tok({ id: 7, text: 'fail', upos: 'VERB', head: 5, deprel: 'acl:relcl', start: 34, end: 38 }),
      tok({ id: 8, text: 'require', upos: 'VERB', head: 3, deprel: 'advcl', start: 39, end: 46 }),
      tok({ id: 9, text: 'replacement', upos: 'NOUN', head: 8, deprel: 'obj', start: 47, end: 58 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 58, end: 59 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const subordinate = tree.find((n) => n.marker?.text === 'if')!
    expect(subordinate).toBeDefined()
    const subordinateSubject = subordinate.children.find((c) => c.role === 'subject')!
    expect(subordinateSubject).toBeDefined()
    expect(subordinateSubject.text).toBe('sensors that fail') // authority: full canonical span (restrictive relative)
    expect(subordinateSubject.presentationSpan?.text).toBe('sensors') // presentation: core NP only
    expect(subordinateSubject.children.some((c) => c.role === 'relativeClause' && c.text === 'that fail')).toBe(true)
    const predicate = subordinateSubject.children.find((c) => c.role === 'predicate')!
    expect(predicate.children.some((c) => c.role === 'object' && c.text === 'replacement')).toBe(true)
  })
})

describe('Prototype 2.6G2.5B2 item 4 -- semicolon/parataxis sibling clauses', () => {
  it('a 3-item semicolon-joined list (parataxis + conj-across-semicolon) renders as flat coordinate top-level siblings', () => {
    const text = 'The team reported results; the committee reviewed findings; and the board approved conclusions.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'reported', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 17 }),
      tok({ id: 4, text: 'results', upos: 'NOUN', head: 3, deprel: 'obj', start: 18, end: 25 }),
      tok({ id: 5, text: ';', upos: 'PUNCT', head: 8, deprel: 'punct', start: 25, end: 26 }),
      tok({ id: 6, text: 'the', upos: 'DET', head: 7, deprel: 'det', start: 27, end: 30 }),
      tok({ id: 7, text: 'committee', upos: 'NOUN', head: 8, deprel: 'nsubj', start: 31, end: 40 }),
      tok({ id: 8, text: 'reviewed', upos: 'VERB', head: 3, deprel: 'parataxis', start: 41, end: 49 }),
      tok({ id: 9, text: 'findings', upos: 'NOUN', head: 8, deprel: 'obj', start: 50, end: 58 }),
      tok({ id: 10, text: ';', upos: 'PUNCT', head: 14, deprel: 'punct', start: 58, end: 59 }),
      tok({ id: 11, text: 'and', upos: 'CCONJ', head: 14, deprel: 'cc', start: 60, end: 63 }),
      tok({ id: 12, text: 'the', upos: 'DET', head: 13, deprel: 'det', start: 64, end: 67 }),
      tok({ id: 13, text: 'board', upos: 'NOUN', head: 14, deprel: 'nsubj', start: 68, end: 73 }),
      tok({ id: 14, text: 'approved', upos: 'VERB', head: 3, deprel: 'conj', start: 74, end: 82 }),
      tok({ id: 15, text: 'conclusions', upos: 'NOUN', head: 14, deprel: 'obj', start: 83, end: 94 }),
      tok({ id: 16, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 94, end: 95 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    // Main clause + 2 paratactic siblings, all flat at the top level -- every one of them
    // has its own overt subject, so all three use role 'subject' (never the subjectless
    // 'clause' wrapper).
    expect(tree).toHaveLength(3)
    const roles = tree.map((n) => n.role)
    expect(roles.filter((r) => r === 'subject')).toHaveLength(3)
    expect(roles.filter((r) => r === 'clause')).toHaveLength(0)

    const flat = flatten(tree)
    expect(flat.some((n) => n.role === 'object' && n.text === 'results')).toBe(true)
    expect(flat.some((n) => n.role === 'object' && n.text === 'findings')).toBe(true)
    expect(flat.some((n) => n.role === 'object' && n.text === 'conclusions')).toBe(true)
    // Source order preserved.
    const starts = tree.map((n) => n.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
})

describe('Prototype 2.6G2.5B2 item 5 -- the "interaction case": a relative clause buried under a non-restrictive appositive nested in an nmod chain', () => {
  it('an acl:relcl attached to a bare appos several hops below the canonical object head is still captured', () => {
    const text = 'The team analyzed the data of the array, sensor readings, which exceed limits.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'team', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 8 }),
      tok({ id: 3, text: 'analyzed', upos: 'VERB', head: 0, deprel: 'root', start: 9, end: 17 }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 5, deprel: 'det', start: 18, end: 21 }),
      tok({ id: 5, text: 'data', upos: 'NOUN', head: 3, deprel: 'obj', start: 22, end: 26 }),
      tok({ id: 6, text: 'of', upos: 'ADP', head: 8, deprel: 'case', start: 27, end: 29 }),
      tok({ id: 7, text: 'the', upos: 'DET', head: 8, deprel: 'det', start: 30, end: 33 }),
      tok({ id: 8, text: 'array', upos: 'NOUN', head: 5, deprel: 'nmod', start: 34, end: 39 }),
      tok({ id: 9, text: ',', upos: 'PUNCT', head: 11, deprel: 'punct', start: 39, end: 40 }),
      tok({ id: 10, text: 'sensor', upos: 'NOUN', head: 11, deprel: 'compound', start: 41, end: 47 }),
      tok({ id: 11, text: 'readings', upos: 'NOUN', head: 8, deprel: 'appos', start: 48, end: 56 }),
      tok({ id: 12, text: ',', upos: 'PUNCT', head: 14, deprel: 'punct', start: 56, end: 57 }),
      tok({ id: 13, text: 'which', upos: 'PRON', head: 14, deprel: 'nsubj', start: 58, end: 63 }),
      tok({ id: 14, text: 'exceed', upos: 'VERB', head: 11, deprel: 'acl:relcl', start: 64, end: 70 }),
      tok({ id: 15, text: 'limits', upos: 'NOUN', head: 14, deprel: 'obj', start: 71, end: 77 }),
      tok({ id: 16, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 77, end: 78 }),
    ]
    const object = flatten(buildStanzaHierarchicalTree(text, tokens)).find((n) => n.role === 'object')!
    expect(object).toBeDefined()
    // Authority (canonical span) is unaffected -- the bare appositive stays excluded, no
    // lexical loss, no change to what SentenceCoreSet/Basic Skeleton would show.
    expect(object.text).toBe('the data of the array')
    const relativeClause = object.children.find((c) => c.role === 'relativeClause')!
    expect(relativeClause).toBeDefined()
    // Relative clauses are grounded as one flat, lexically-complete constituent (matching
    // the existing precedent, e.g. B2's "which are commonly used in the field") -- not
    // decomposed into their own S/V/O roles.
    expect(relativeClause.text).toBe('which exceed limits')
  })
})
