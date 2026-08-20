import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import { structureTreeNodeSpan } from '../../src/features/grammar/domain/treeReadingMatching.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C Problem C / hard gate `RELATIVE_INTERACTION_COVERAGE = 100%` --
 * independent structural verification that every rendered `relativeClause` node's own
 * interaction span (what `structureTreeNodeSpan` returns, i.e. what hover/click/pin actually
 * operate on -- see `treeReadingMatching.ts` and `TreeNodeButton` in `StructureTreeView.tsx`,
 * both of which key off `node.start`/`node.end`/`node.presentationSpan` directly, never off
 * only the leading pronoun) covers the WHOLE relative-clause span, never only the relative
 * pronoun/wh-word. This does not reuse the Tree builder's own internal NodeText/marker
 * rendering logic (deliberately, per the phase's "never define a gate with the exact same
 * presentation-builder logic being tested" rule) -- it re-derives the expected full-clause
 * span independently from the raw dependency subtree every `relativeClause` node's own head
 * token roots (every descendant reachable by walking `head` pointers), and compares that
 * against the actually-rendered node's own span.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

/** Independently recomputes the full raw dependency-subtree span rooted at `headId` (every
 * token transitively dominated by it), never touching the Tree builder's own span logic. */
function rawSubtreeSpan(headId: number, tokens: StanzaToken[]): { start: number; end: number } {
  const byId = new Map(tokens.map((t) => [t.id, t]))
  const childrenOf = (id: number) => tokens.filter((t) => t.head === id)
  const collected: StanzaToken[] = []
  const stack = [byId.get(headId)!]
  while (stack.length > 0) {
    const t = stack.pop()!
    collected.push(t)
    for (const c of childrenOf(t.id)) stack.push(c)
  }
  return { start: Math.min(...collected.map((t) => t.start)), end: Math.max(...collected.map((t) => t.end)) }
}

describe('Prototype 2.6G2.6C item 9-12 -- relative-clause whole-clause interaction coverage', () => {
  it('(A) ordinary restrictive relative clause with the pronoun as OBJECT of the relative verb -- interaction span covers the whole clause, not just "that"', () => {
    const text = 'The method that we used achieved high accuracy.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'method', upos: 'NOUN', head: 6, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'that', upos: 'PRON', head: 5, deprel: 'obj', start: 11, end: 15 }),
      tok({ id: 4, text: 'we', upos: 'PRON', head: 5, deprel: 'nsubj', start: 16, end: 18 }),
      tok({ id: 5, text: 'used', upos: 'VERB', head: 2, deprel: 'acl:relcl', start: 19, end: 23 }),
      tok({ id: 6, text: 'achieved', upos: 'VERB', head: 0, deprel: 'root', start: 24, end: 32 }),
      tok({ id: 7, text: 'high', upos: 'ADJ', head: 8, deprel: 'amod', start: 33, end: 37 }),
      tok({ id: 8, text: 'accuracy', upos: 'NOUN', head: 6, deprel: 'obj', start: 38, end: 46 }),
      tok({ id: 9, text: '.', upos: 'PUNCT', head: 6, deprel: 'punct', start: 46, end: 47 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const relatives = flatten(tree).filter((n) => n.role === 'relativeClause')
    expect(relatives).toHaveLength(1)
    const node = relatives[0]!
    const expected = rawSubtreeSpan(5, tokens) // whole "that we used" acl:relcl subtree
    const interactionSpan = structureTreeNodeSpan(node)
    expect(interactionSpan).toEqual(expected)
    expect(text.slice(interactionSpan.start, interactionSpan.end)).toBe('that we used')
    // Not merely the pronoun.
    expect(interactionSpan.end - interactionSpan.start).toBeGreaterThan('that'.length)
  })

  it('(B) coordinated subject + nonrestrictive relative clause (VIF/PCC-style, relcl attached at coordination scope) -- interaction span covers the whole clause', () => {
    const text = 'The datasets and models which were validated externally achieved strong results.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'datasets', upos: 'NOUN', head: 9, deprel: 'nsubj', start: 4, end: 12 }),
      tok({ id: 3, text: 'and', upos: 'CCONJ', head: 4, deprel: 'cc', start: 13, end: 16 }),
      tok({ id: 4, text: 'models', upos: 'NOUN', head: 2, deprel: 'conj', start: 17, end: 23 }),
      tok({ id: 5, text: 'which', upos: 'PRON', head: 7, deprel: 'nsubj:pass', start: 24, end: 29 }),
      tok({ id: 6, text: 'were', upos: 'AUX', head: 7, deprel: 'aux:pass', start: 30, end: 34 }),
      tok({ id: 7, text: 'validated', upos: 'VERB', head: 2, deprel: 'acl:relcl', start: 35, end: 44 }),
      tok({ id: 8, text: 'externally', upos: 'ADV', head: 7, deprel: 'advmod', start: 45, end: 55 }),
      tok({ id: 9, text: 'achieved', upos: 'VERB', head: 0, deprel: 'root', start: 56, end: 64 }),
      tok({ id: 10, text: 'strong', upos: 'ADJ', head: 11, deprel: 'amod', start: 65, end: 71 }),
      tok({ id: 11, text: 'results', upos: 'NOUN', head: 9, deprel: 'obj', start: 72, end: 79 }),
      tok({ id: 12, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: 79, end: 80 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    // Coordinated subject remains decomposed (both members present). Prototype 2.6G2.6C
    // item B/6/7: members carry the neutral 'coordinationMember' role, never a second
    // 'subject' label -- the container above already owns that once.
    expect(flat.some((n) => n.role === 'coordinationMember' && n.presentationSpan?.text === 'The datasets')).toBe(true)
    expect(flat.some((n) => n.role === 'coordinationMember' && n.text === 'models')).toBe(true)
    const relatives = flat.filter((n) => n.role === 'relativeClause')
    expect(relatives).toHaveLength(1)
    const node = relatives[0]!
    const expected = rawSubtreeSpan(7, tokens) // whole "which were validated externally" subtree
    const interactionSpan = structureTreeNodeSpan(node)
    expect(interactionSpan).toEqual(expected)
    expect(text.slice(interactionSpan.start, interactionSpan.end)).toBe('which were validated externally')
  })

  it('(C) restrictive relative clause with the pronoun as SUBJECT of the relative verb -- interaction span covers the whole clause', () => {
    const text = 'The samples that failed the quality check were discarded.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'samples', upos: 'NOUN', head: 9, deprel: 'nsubj:pass', start: 4, end: 11 }),
      tok({ id: 3, text: 'that', upos: 'PRON', head: 4, deprel: 'nsubj', start: 12, end: 16 }),
      tok({ id: 4, text: 'failed', upos: 'VERB', head: 2, deprel: 'acl:relcl', start: 17, end: 23 }),
      tok({ id: 5, text: 'the', upos: 'DET', head: 7, deprel: 'det', start: 24, end: 27 }),
      tok({ id: 6, text: 'quality', upos: 'NOUN', head: 7, deprel: 'compound', start: 28, end: 35 }),
      tok({ id: 7, text: 'check', upos: 'NOUN', head: 4, deprel: 'obj', start: 36, end: 41 }),
      tok({ id: 8, text: 'were', upos: 'AUX', head: 9, deprel: 'aux:pass', start: 42, end: 46 }),
      tok({ id: 9, text: 'discarded', upos: 'VERB', head: 0, deprel: 'root', start: 47, end: 56 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 9, deprel: 'punct', start: 56, end: 57 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const relatives = flatten(tree).filter((n) => n.role === 'relativeClause')
    expect(relatives).toHaveLength(1)
    const node = relatives[0]!
    const expected = rawSubtreeSpan(4, tokens) // whole "that failed the quality check" subtree
    const interactionSpan = structureTreeNodeSpan(node)
    expect(interactionSpan).toEqual(expected)
    expect(text.slice(interactionSpan.start, interactionSpan.end)).toBe('that failed the quality check')
  })

  it('(D) reduced relative / plain acl (no relative pronoun) remains a "postmodifier", never promoted to "relativeClause" -- unaffected by this control', () => {
    const text = 'A classifier optimized with balanced samples achieved higher recall.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'A', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 1 }),
      tok({ id: 2, text: 'classifier', upos: 'NOUN', head: 7, deprel: 'nsubj', start: 2, end: 12 }),
      tok({ id: 3, text: 'optimized', upos: 'VERB', head: 2, deprel: 'acl', start: 13, end: 22 }),
      tok({ id: 4, text: 'with', upos: 'ADP', head: 6, deprel: 'case', start: 23, end: 27 }),
      tok({ id: 5, text: 'balanced', upos: 'ADJ', head: 6, deprel: 'amod', start: 28, end: 36 }),
      tok({ id: 6, text: 'samples', upos: 'NOUN', head: 3, deprel: 'obl', start: 37, end: 44 }),
      tok({ id: 7, text: 'achieved', upos: 'VERB', head: 0, deprel: 'root', start: 45, end: 53 }),
      tok({ id: 8, text: 'higher', upos: 'ADJ', head: 9, deprel: 'amod', start: 54, end: 60 }),
      tok({ id: 9, text: 'recall', upos: 'NOUN', head: 7, deprel: 'obj', start: 61, end: 67 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 7, deprel: 'punct', start: 67, end: 68 }),
    ]
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const flat = flatten(tree)
    expect(flat.some((n) => n.role === 'relativeClause')).toBe(false)
    const postmodifiers = flat.filter((n) => n.role === 'postmodifier')
    expect(postmodifiers).toHaveLength(1)
    expect(postmodifiers[0]!.text).toBe('optimized with balanced samples')
  })

  it('(E) the relative-pronoun/antecedent marker styling stays LOCAL to the pronoun -- NodeText only wraps the first word in "relative-marker", never the whole clause text', async () => {
    // Presentation-layer check (deliberately separate from the interaction-span check above):
    // confirms Problem C's two spans stay independently correct -- the interaction span is the
    // WHOLE clause (verified above), while the antecedent-linkage marker visually anchors only
    // the pronoun itself, matching the phase's explicit "antecedent-link may stay on 'which'"
    // requirement without that visual choice ever narrowing the actual interactive span.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../src/features/grammar/components/StructureTreeView.tsx', import.meta.url), 'utf8'),
    )
    const relativeClauseBranch = source.slice(source.indexOf("if (node.role === 'relativeClause')"), source.indexOf("// Prototype 2.5X item 11/12"))
    expect(relativeClauseBranch).toContain('relative-marker')
    // Only the split-off leading `pronoun` is wrapped in the marker span -- the remainder
    // (`rest`) is emitted as plain trailing text within the same outer span, never re-wrapped.
    expect(relativeClauseBranch).toMatch(/<span className="relative-marker">\s*\{pronoun\}/)
  })
})
