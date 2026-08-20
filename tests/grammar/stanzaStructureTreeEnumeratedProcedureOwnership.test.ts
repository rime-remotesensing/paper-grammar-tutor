import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.8E2 -- Enumerated Procedure Span Ownership + Parallel Member Structure.
 * Every fixture below is captured verbatim from a real Stanza parse (never hand-tuned) so the
 * genuine UD coordination-attachment/enumeration structure that broke member ownership is
 * exercised exactly as it occurs in production, not an idealized approximation of it.
 */

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

function findEnumeration(nodes: StructureTreeNode[]): StructureTreeNode {
  const enumeration = flatten(nodes).find((n) => n.role === 'enumeration')
  if (!enumeration) throw new Error('no enumeration node found')
  return enumeration
}

/** No descendant of one member may reach into another member's own source span (childSpan ⊆
 * memberSpan for every descendant), and no source position may be covered by two different
 * members' subtrees (independent of member ownership) -- the two invariants section 24's hard
 * gates name ENUMERATION_CROSS_MEMBER_DESCENDANT_LEAKAGE and ENUMERATION_MEMBER_SOURCE_OVERLAP. */
function assertNoLeakageOrOverlap(members: StructureTreeNode[]) {
  for (const member of members) {
    for (const descendant of flatten(member.children)) {
      expect(descendant.start).toBeGreaterThanOrEqual(member.start)
      expect(descendant.end).toBeLessThanOrEqual(member.end)
    }
  }
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const overlaps = members[i].start < members[j].end && members[j].start < members[i].end
      expect(overlaps).toBe(false)
    }
  }
}

/** ENUMERATION_CROSS_MEMBER_SOURCE_DUPLICATION=0 -- no source position may be independently
 * rendered by two different nodes anywhere in the whole member's own subtree. */
function assertNoDuplicateSourceOwnership(member: StructureTreeNode) {
  const nodes = [member, ...flatten(member.children)]
  const covered = new Set<number>()
  for (const node of nodes) {
    // Only leaf-most text matters for duplication -- a container's span naturally overlaps its
    // own children's spans, so only compare nodes that do not themselves contain one another.
    if (node.children.length > 0) continue
    for (let p = node.start; p < node.end; p++) {
      expect(covered.has(p)).toBe(false)
      covered.add(p)
    }
  }
}

describe('Prototype 2.6G2.8E2 -- main live sentence (4 numbered members, relative clause, internal coordination)', () => {
  const text =
    'Based on the filtered landslide causal factors, slope units, and landslide inventory, the training and testing datasets for the LSM model were constructed through the following steps: (1) project the landslide points onto polygonal slope units; (2) randomly select the same number of non-landslide slope units, which must be at least 500 m from the known landslide units and no less than 200 m apart; (3) establish the attribute table of slope units by selecting the landslide causal factors at the centroid of each unit to represent the attributes of the whole unit; and (4) randomly divide the dataset into a training set and a test set at a ratio of 7:3.'
  const tokens: StanzaToken[] = [
    { id: 1, text: 'Based', lemma: 'base', upos: 'VERB', head: 7, deprel: 'case', start: 0, end: 5 },
    { id: 2, text: 'on', lemma: 'on', upos: 'ADP', head: 7, deprel: 'case', start: 6, end: 8 },
    { id: 3, text: 'the', lemma: 'the', upos: 'DET', head: 7, deprel: 'det', start: 9, end: 12 },
    { id: 4, text: 'filtered', lemma: 'filter', upos: 'VERB', head: 7, deprel: 'amod', start: 13, end: 21 },
    { id: 5, text: 'landslide', lemma: 'landslide', upos: 'NOUN', head: 7, deprel: 'compound', start: 22, end: 31 },
    { id: 6, text: 'causal', lemma: 'causal', upos: 'ADJ', head: 7, deprel: 'amod', start: 32, end: 38 },
    { id: 7, text: 'factors', lemma: 'factor', upos: 'NOUN', head: 26, deprel: 'obl', start: 39, end: 46 },
    { id: 8, text: ',', lemma: ',', upos: 'PUNCT', head: 10, deprel: 'punct', start: 46, end: 47 },
    { id: 9, text: 'slope', lemma: 'slope', upos: 'NOUN', head: 10, deprel: 'compound', start: 48, end: 53 },
    { id: 10, text: 'units', lemma: 'unit', upos: 'NOUN', head: 7, deprel: 'conj', start: 54, end: 59 },
    { id: 11, text: ',', lemma: ',', upos: 'PUNCT', head: 14, deprel: 'punct', start: 59, end: 60 },
    { id: 12, text: 'and', lemma: 'and', upos: 'CCONJ', head: 14, deprel: 'cc', start: 61, end: 64 },
    { id: 13, text: 'landslide', lemma: 'landslide', upos: 'NOUN', head: 14, deprel: 'compound', start: 65, end: 74 },
    { id: 14, text: 'inventory', lemma: 'inventory', upos: 'NOUN', head: 7, deprel: 'conj', start: 75, end: 84 },
    { id: 15, text: ',', lemma: ',', upos: 'PUNCT', head: 7, deprel: 'punct', start: 84, end: 85 },
    { id: 16, text: 'the', lemma: 'the', upos: 'DET', head: 20, deprel: 'det', start: 86, end: 89 },
    { id: 17, text: 'training', lemma: 'training', upos: 'NOUN', head: 20, deprel: 'compound', start: 90, end: 98 },
    { id: 18, text: 'and', lemma: 'and', upos: 'CCONJ', head: 19, deprel: 'cc', start: 99, end: 102 },
    { id: 19, text: 'testing', lemma: 'testing', upos: 'NOUN', head: 17, deprel: 'conj', start: 103, end: 110 },
    { id: 20, text: 'datasets', lemma: 'dataset', upos: 'NOUN', head: 26, deprel: 'nsubj:pass', start: 111, end: 119 },
    { id: 21, text: 'for', lemma: 'for', upos: 'ADP', head: 24, deprel: 'case', start: 120, end: 123 },
    { id: 22, text: 'the', lemma: 'the', upos: 'DET', head: 24, deprel: 'det', start: 124, end: 127 },
    { id: 23, text: 'LSM', lemma: 'LSM', upos: 'PROPN', head: 24, deprel: 'compound', start: 128, end: 131 },
    { id: 24, text: 'model', lemma: 'model', upos: 'NOUN', head: 20, deprel: 'nmod', start: 132, end: 137 },
    { id: 25, text: 'were', lemma: 'be', upos: 'AUX', head: 26, deprel: 'aux:pass', start: 138, end: 142 },
    { id: 26, text: 'constructed', lemma: 'construct', upos: 'VERB', head: 0, deprel: 'root', start: 143, end: 154 },
    { id: 27, text: 'through', lemma: 'through', upos: 'ADP', head: 30, deprel: 'case', start: 155, end: 162 },
    { id: 28, text: 'the', lemma: 'the', upos: 'DET', head: 30, deprel: 'det', start: 163, end: 166 },
    { id: 29, text: 'following', lemma: 'follow', upos: 'VERB', head: 30, deprel: 'amod', start: 167, end: 176 },
    { id: 30, text: 'steps', lemma: 'step', upos: 'NOUN', head: 26, deprel: 'obl', start: 177, end: 182 },
    { id: 31, text: ':', lemma: ':', upos: 'PUNCT', head: 35, deprel: 'punct', start: 182, end: 183 },
    { id: 32, text: '(', lemma: '(', upos: 'PUNCT', head: 33, deprel: 'punct', start: 184, end: 185 },
    { id: 33, text: '1', lemma: '1', upos: 'NUM', head: 35, deprel: 'discourse', start: 185, end: 186 },
    { id: 34, text: ')', lemma: ')', upos: 'PUNCT', head: 33, deprel: 'punct', start: 186, end: 187 },
    { id: 35, text: 'project', lemma: 'project', upos: 'NOUN', head: 26, deprel: 'parataxis', start: 188, end: 195 },
    { id: 36, text: 'the', lemma: 'the', upos: 'DET', head: 38, deprel: 'det', start: 196, end: 199 },
    { id: 37, text: 'landslide', lemma: 'landslide', upos: 'NOUN', head: 38, deprel: 'compound', start: 200, end: 209 },
    { id: 38, text: 'points', lemma: 'point', upos: 'NOUN', head: 35, deprel: 'obj', start: 210, end: 216 },
    { id: 39, text: 'onto', lemma: 'onto', upos: 'ADP', head: 42, deprel: 'case', start: 217, end: 221 },
    { id: 40, text: 'polygonal', lemma: 'polygonal', upos: 'ADJ', head: 41, deprel: 'amod', start: 222, end: 231 },
    { id: 41, text: 'slope', lemma: 'slope', upos: 'NOUN', head: 42, deprel: 'compound', start: 232, end: 237 },
    { id: 42, text: 'units', lemma: 'unit', upos: 'NOUN', head: 38, deprel: 'nmod', start: 238, end: 243 },
    { id: 43, text: ';', lemma: ';', upos: 'PUNCT', head: 48, deprel: 'punct', start: 243, end: 244 },
    { id: 44, text: '(', lemma: '(', upos: 'PUNCT', head: 45, deprel: 'punct', start: 245, end: 246 },
    { id: 45, text: '2', lemma: '2', upos: 'NUM', head: 48, deprel: 'discourse', start: 246, end: 247 },
    { id: 46, text: ')', lemma: ')', upos: 'PUNCT', head: 45, deprel: 'punct', start: 247, end: 248 },
    { id: 47, text: 'randomly', lemma: 'randomly', upos: 'ADV', head: 48, deprel: 'advmod', start: 249, end: 257 },
    { id: 48, text: 'select', lemma: 'select', upos: 'VERB', head: 35, deprel: 'parataxis', start: 258, end: 264 },
    { id: 49, text: 'the', lemma: 'the', upos: 'DET', head: 51, deprel: 'det', start: 265, end: 268 },
    { id: 50, text: 'same', lemma: 'same', upos: 'ADJ', head: 51, deprel: 'amod', start: 269, end: 273 },
    { id: 51, text: 'number', lemma: 'number', upos: 'NOUN', head: 48, deprel: 'obj', start: 274, end: 280 },
    { id: 52, text: 'of', lemma: 'of', upos: 'ADP', head: 55, deprel: 'case', start: 281, end: 283 },
    { id: 53, text: 'non-landslide', lemma: 'non-landslide', upos: 'ADJ', head: 55, deprel: 'amod', start: 284, end: 297 },
    { id: 54, text: 'slope', lemma: 'slope', upos: 'NOUN', head: 55, deprel: 'compound', start: 298, end: 303 },
    { id: 55, text: 'units', lemma: 'unit', upos: 'NOUN', head: 51, deprel: 'nmod', start: 304, end: 309 },
    { id: 56, text: ',', lemma: ',', upos: 'PUNCT', head: 63, deprel: 'punct', start: 309, end: 310 },
    { id: 57, text: 'which', lemma: 'which', upos: 'PRON', head: 63, deprel: 'nsubj', start: 311, end: 316 },
    { id: 58, text: 'must', lemma: 'must', upos: 'AUX', head: 63, deprel: 'aux', start: 317, end: 321 },
    { id: 59, text: 'be', lemma: 'be', upos: 'AUX', head: 63, deprel: 'cop', start: 322, end: 324 },
    { id: 60, text: 'at', lemma: 'at', upos: 'ADP', head: 61, deprel: 'case', start: 325, end: 327 },
    { id: 61, text: 'least', lemma: 'least', upos: 'ADJ', head: 62, deprel: 'nmod', start: 328, end: 333 },
    { id: 62, text: '500', lemma: '500', upos: 'NUM', head: 63, deprel: 'nummod', start: 334, end: 337 },
    { id: 63, text: 'm', lemma: 'm', upos: 'NOUN', head: 55, deprel: 'acl:relcl', start: 338, end: 339 },
    { id: 64, text: 'from', lemma: 'from', upos: 'ADP', head: 68, deprel: 'case', start: 340, end: 344 },
    { id: 65, text: 'the', lemma: 'the', upos: 'DET', head: 68, deprel: 'det', start: 345, end: 348 },
    { id: 66, text: 'known', lemma: 'know', upos: 'VERB', head: 68, deprel: 'amod', start: 349, end: 354 },
    { id: 67, text: 'landslide', lemma: 'landslide', upos: 'NOUN', head: 68, deprel: 'compound', start: 355, end: 364 },
    { id: 68, text: 'units', lemma: 'unit', upos: 'NOUN', head: 63, deprel: 'nmod', start: 365, end: 370 },
    { id: 69, text: 'and', lemma: 'and', upos: 'CCONJ', head: 74, deprel: 'cc', start: 371, end: 374 },
    { id: 70, text: 'no', lemma: 'no', upos: 'DET', head: 74, deprel: 'det', start: 375, end: 377 },
    { id: 71, text: 'less', lemma: 'less', upos: 'ADJ', head: 73, deprel: 'advmod', start: 378, end: 382 },
    { id: 72, text: 'than', lemma: 'than', upos: 'ADP', head: 71, deprel: 'fixed', start: 383, end: 387 },
    { id: 73, text: '200', lemma: '200', upos: 'NUM', head: 74, deprel: 'nummod', start: 388, end: 391 },
    { id: 74, text: 'm', lemma: 'm', upos: 'NOUN', head: 63, deprel: 'conj', start: 392, end: 393 },
    { id: 75, text: 'apart', lemma: 'apart', upos: 'ADV', head: 74, deprel: 'advmod', start: 394, end: 399 },
    { id: 76, text: ';', lemma: ';', upos: 'PUNCT', head: 80, deprel: 'punct', start: 399, end: 400 },
    { id: 77, text: '(', lemma: '(', upos: 'PUNCT', head: 78, deprel: 'punct', start: 401, end: 402 },
    { id: 78, text: '3', lemma: '3', upos: 'NUM', head: 80, deprel: 'discourse', start: 402, end: 403 },
    { id: 79, text: ')', lemma: ')', upos: 'PUNCT', head: 78, deprel: 'punct', start: 403, end: 404 },
    { id: 80, text: 'establish', lemma: 'establish', upos: 'VERB', head: 63, deprel: 'conj', start: 405, end: 414 },
    { id: 81, text: 'the', lemma: 'the', upos: 'DET', head: 83, deprel: 'det', start: 415, end: 418 },
    { id: 82, text: 'attribute', lemma: 'attribute', upos: 'NOUN', head: 83, deprel: 'compound', start: 419, end: 428 },
    { id: 83, text: 'table', lemma: 'table', upos: 'NOUN', head: 80, deprel: 'obj', start: 429, end: 434 },
    { id: 84, text: 'of', lemma: 'of', upos: 'ADP', head: 86, deprel: 'case', start: 435, end: 437 },
    { id: 85, text: 'slope', lemma: 'slope', upos: 'NOUN', head: 86, deprel: 'compound', start: 438, end: 443 },
    { id: 86, text: 'units', lemma: 'unit', upos: 'NOUN', head: 83, deprel: 'nmod', start: 444, end: 449 },
    { id: 87, text: 'by', lemma: 'by', upos: 'SCONJ', head: 88, deprel: 'mark', start: 450, end: 452 },
    { id: 88, text: 'selecting', lemma: 'select', upos: 'VERB', head: 80, deprel: 'advcl', start: 453, end: 462 },
    { id: 89, text: 'the', lemma: 'the', upos: 'DET', head: 92, deprel: 'det', start: 463, end: 466 },
    { id: 90, text: 'landslide', lemma: 'landslide', upos: 'NOUN', head: 92, deprel: 'compound', start: 467, end: 476 },
    { id: 91, text: 'causal', lemma: 'causal', upos: 'ADJ', head: 92, deprel: 'amod', start: 477, end: 483 },
    { id: 92, text: 'factors', lemma: 'factor', upos: 'NOUN', head: 88, deprel: 'obj', start: 484, end: 491 },
    { id: 93, text: 'at', lemma: 'at', upos: 'ADP', head: 95, deprel: 'case', start: 492, end: 494 },
    { id: 94, text: 'the', lemma: 'the', upos: 'DET', head: 95, deprel: 'det', start: 495, end: 498 },
    { id: 95, text: 'centroid', lemma: 'centroid', upos: 'NOUN', head: 88, deprel: 'obl', start: 499, end: 507 },
    { id: 96, text: 'of', lemma: 'of', upos: 'ADP', head: 98, deprel: 'case', start: 508, end: 510 },
    { id: 97, text: 'each', lemma: 'each', upos: 'DET', head: 98, deprel: 'det', start: 511, end: 515 },
    { id: 98, text: 'unit', lemma: 'unit', upos: 'NOUN', head: 95, deprel: 'nmod', start: 516, end: 520 },
    { id: 99, text: 'to', lemma: 'to', upos: 'PART', head: 100, deprel: 'mark', start: 521, end: 523 },
    { id: 100, text: 'represent', lemma: 'represent', upos: 'VERB', head: 88, deprel: 'advcl', start: 524, end: 533 },
    { id: 101, text: 'the', lemma: 'the', upos: 'DET', head: 102, deprel: 'det', start: 534, end: 537 },
    { id: 102, text: 'attributes', lemma: 'attribute', upos: 'NOUN', head: 100, deprel: 'obj', start: 538, end: 548 },
    { id: 103, text: 'of', lemma: 'of', upos: 'ADP', head: 106, deprel: 'case', start: 549, end: 551 },
    { id: 104, text: 'the', lemma: 'the', upos: 'DET', head: 106, deprel: 'det', start: 552, end: 555 },
    { id: 105, text: 'whole', lemma: 'whole', upos: 'ADJ', head: 106, deprel: 'amod', start: 556, end: 561 },
    { id: 106, text: 'unit', lemma: 'unit', upos: 'NOUN', head: 102, deprel: 'nmod', start: 562, end: 566 },
    { id: 107, text: ';', lemma: ';', upos: 'PUNCT', head: 108, deprel: 'punct', start: 566, end: 567 },
    { id: 108, text: 'and', lemma: 'and', upos: 'CCONJ', head: 113, deprel: 'cc', start: 568, end: 571 },
    { id: 109, text: '(', lemma: '(', upos: 'PUNCT', head: 110, deprel: 'punct', start: 572, end: 573 },
    { id: 110, text: '4', lemma: '4', upos: 'NUM', head: 113, deprel: 'discourse', start: 573, end: 574 },
    { id: 111, text: ')', lemma: ')', upos: 'PUNCT', head: 110, deprel: 'punct', start: 574, end: 575 },
    { id: 112, text: 'randomly', lemma: 'randomly', upos: 'ADV', head: 113, deprel: 'advmod', start: 576, end: 584 },
    { id: 113, text: 'divide', lemma: 'divide', upos: 'VERB', head: 88, deprel: 'conj', start: 585, end: 591 },
    { id: 114, text: 'the', lemma: 'the', upos: 'DET', head: 115, deprel: 'det', start: 592, end: 595 },
    { id: 115, text: 'dataset', lemma: 'dataset', upos: 'NOUN', head: 113, deprel: 'obj', start: 596, end: 603 },
    { id: 116, text: 'into', lemma: 'into', upos: 'ADP', head: 119, deprel: 'case', start: 604, end: 608 },
    { id: 117, text: 'a', lemma: 'a', upos: 'DET', head: 119, deprel: 'det', start: 609, end: 610 },
    { id: 118, text: 'training', lemma: 'training', upos: 'NOUN', head: 119, deprel: 'compound', start: 611, end: 619 },
    { id: 119, text: 'set', lemma: 'set', upos: 'NOUN', head: 113, deprel: 'obl', start: 620, end: 623 },
    { id: 120, text: 'and', lemma: 'and', upos: 'CCONJ', head: 122, deprel: 'cc', start: 624, end: 627 },
    { id: 121, text: 'a', lemma: 'a', upos: 'DET', head: 122, deprel: 'det', start: 628, end: 629 },
    { id: 122, text: 'test', lemma: 'test', upos: 'NOUN', head: 119, deprel: 'conj', start: 630, end: 634 },
    { id: 123, text: 'set', lemma: 'set', upos: 'VERB', head: 122, deprel: 'acl', start: 635, end: 638 },
    { id: 124, text: 'at', lemma: 'at', upos: 'ADP', head: 126, deprel: 'case', start: 639, end: 641 },
    { id: 125, text: 'a', lemma: 'a', upos: 'DET', head: 126, deprel: 'det', start: 642, end: 643 },
    { id: 126, text: 'ratio', lemma: 'ratio', upos: 'NOUN', head: 123, deprel: 'obl', start: 644, end: 649 },
    { id: 127, text: 'of', lemma: 'of', upos: 'ADP', head: 128, deprel: 'case', start: 650, end: 652 },
    { id: 128, text: '7:3', lemma: '7:3', upos: 'NUM', head: 126, deprel: 'nmod', start: 653, end: 656 },
    { id: 129, text: '.', lemma: '.', upos: 'PUNCT', head: 26, deprel: 'punct', start: 656, end: 657 },
  ]

  it('ENUMERATION_MEMBER_COUNT=4, ENUMERATION_MEMBER_ORDER=100%', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(4)
    for (let i = 1; i < members.length; i++) expect(members[i].start).toBeGreaterThan(members[i - 1].start)
  })

  it('ENUMERATION_CROSS_MEMBER_DESCENDANT_LEAKAGE=0, ENUMERATION_MEMBER_SOURCE_OVERLAP=0', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    assertNoLeakageOrOverlap(findEnumeration(tree).children)
  })

  it('ENUMERATION_CROSS_MEMBER_SOURCE_DUPLICATION=0 -- no member independently duplicates a descendant already owned elsewhere in its own subtree', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    for (const member of findEnumeration(tree).children) assertNoDuplicateSourceOwnership(member)
  })

  it('MEMBER_2_HEAD=select, MEMBER_3_HEAD=establish, MEMBER_4_HEAD=divide are retained as visible predicate nodes', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const members = findEnumeration(tree).children
    const heads = members.map((member) => flatten(member.children).find((n) => n.role === 'predicate')?.text)
    expect(heads[1]).toBe('select')
    expect(heads[2]).toBe('establish')
    expect(heads[3]).toBe('divide')
  })

  it('RELATIVE_CLAUSE_CROSS_MEMBER_LEAKAGE=0 -- "which must be ... apart" stays inside member 2 only', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const members = findEnumeration(tree).children
    const relativeClause = flatten(members[1].children).find((n) => n.role === 'relativeClause')
    expect(relativeClause).toBeDefined()
    expect(relativeClause!.text).toContain('which must be')
    expect(relativeClause!.text).toContain('no less than 200 m apart')
    expect(relativeClause!.start).toBeGreaterThanOrEqual(members[1].start)
    expect(relativeClause!.end).toBeLessThanOrEqual(members[1].end)
  })

  it('member 3\'s "by selecting ... to represent ..." modifier stays inside member 3 only (no leak into member 4)', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const members = findEnumeration(tree).children
    const modifier = flatten(members[2].children).find((n) => n.role === 'modifier' && n.text.startsWith('by selecting'))
    expect(modifier).toBeDefined()
    expect(modifier!.text).toContain('to represent the attributes of the whole unit')
    expect(modifier!.end).toBeLessThanOrEqual(members[2].end)
    expect(flatten(members[3].children).some((n) => n.text.includes('to represent'))).toBe(false)
  })

  it('member 4\'s internal "a training set and a test set" coordination is not split into a spurious extra member', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(4)
    expect(members[3].text).toContain('a training set and a test set at a ratio of 7:3')
  })
})

describe('Prototype 2.6G2.8E2 CASE 1 -- finite-verb 3-member numbered list (collect/filter/analyze)', () => {
  const text = 'The workflow proceeded using the following steps: (1) collect the raw samples; (2) filter the noisy readings; and (3) analyze the cleaned dataset.'
  const tokens: StanzaToken[] = [
    { id: 1, text: 'The', lemma: 'the', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 },
    { id: 2, text: 'workflow', lemma: 'workflow', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 12 },
    { id: 3, text: 'proceeded', lemma: 'proceed', upos: 'VERB', head: 0, deprel: 'root', start: 13, end: 22 },
    { id: 4, text: 'using', lemma: 'use', upos: 'VERB', head: 3, deprel: 'advcl', start: 23, end: 28 },
    { id: 5, text: 'the', lemma: 'the', upos: 'DET', head: 7, deprel: 'det', start: 29, end: 32 },
    { id: 6, text: 'following', lemma: 'follow', upos: 'VERB', head: 7, deprel: 'amod', start: 33, end: 42 },
    { id: 7, text: 'steps', lemma: 'step', upos: 'NOUN', head: 4, deprel: 'obj', start: 43, end: 48 },
    { id: 8, text: ':', lemma: ':', upos: 'PUNCT', head: 12, deprel: 'punct', start: 48, end: 49 },
    { id: 9, text: '(', lemma: '(', upos: 'PUNCT', head: 10, deprel: 'punct', start: 50, end: 51 },
    { id: 10, text: '1', lemma: '1', upos: 'NUM', head: 12, deprel: 'discourse', start: 51, end: 52 },
    { id: 11, text: ')', lemma: ')', upos: 'PUNCT', head: 10, deprel: 'punct', start: 52, end: 53 },
    { id: 12, text: 'collect', lemma: 'collect', upos: 'VERB', head: 7, deprel: 'appos', start: 54, end: 61 },
    { id: 13, text: 'the', lemma: 'the', upos: 'DET', head: 15, deprel: 'det', start: 62, end: 65 },
    { id: 14, text: 'raw', lemma: 'raw', upos: 'ADJ', head: 15, deprel: 'amod', start: 66, end: 69 },
    { id: 15, text: 'samples', lemma: 'sample', upos: 'NOUN', head: 12, deprel: 'obj', start: 70, end: 77 },
    { id: 16, text: ';', lemma: ';', upos: 'PUNCT', head: 20, deprel: 'punct', start: 77, end: 78 },
    { id: 17, text: '(', lemma: '(', upos: 'PUNCT', head: 18, deprel: 'punct', start: 79, end: 80 },
    { id: 18, text: '2', lemma: '2', upos: 'NUM', head: 20, deprel: 'discourse', start: 80, end: 81 },
    { id: 19, text: ')', lemma: ')', upos: 'PUNCT', head: 18, deprel: 'punct', start: 81, end: 82 },
    { id: 20, text: 'filter', lemma: 'filter', upos: 'VERB', head: 12, deprel: 'conj', start: 83, end: 89 },
    { id: 21, text: 'the', lemma: 'the', upos: 'DET', head: 23, deprel: 'det', start: 90, end: 93 },
    { id: 22, text: 'noisy', lemma: 'noisy', upos: 'ADJ', head: 23, deprel: 'amod', start: 94, end: 99 },
    { id: 23, text: 'readings', lemma: 'reading', upos: 'NOUN', head: 20, deprel: 'obj', start: 100, end: 108 },
    { id: 24, text: ';', lemma: ';', upos: 'PUNCT', head: 25, deprel: 'punct', start: 108, end: 109 },
    { id: 25, text: 'and', lemma: 'and', upos: 'CCONJ', head: 29, deprel: 'cc', start: 110, end: 113 },
    { id: 26, text: '(', lemma: '(', upos: 'PUNCT', head: 27, deprel: 'punct', start: 114, end: 115 },
    { id: 27, text: '3', lemma: '3', upos: 'NUM', head: 29, deprel: 'discourse', start: 115, end: 116 },
    { id: 28, text: ')', lemma: ')', upos: 'PUNCT', head: 27, deprel: 'punct', start: 116, end: 117 },
    { id: 29, text: 'analyze', lemma: 'analyze', upos: 'VERB', head: 20, deprel: 'conj', start: 118, end: 125 },
    { id: 30, text: 'the', lemma: 'the', upos: 'DET', head: 32, deprel: 'det', start: 126, end: 129 },
    { id: 31, text: 'cleaned', lemma: 'clean', upos: 'VERB', head: 32, deprel: 'amod', start: 130, end: 137 },
    { id: 32, text: 'dataset', lemma: 'dataset', upos: 'NOUN', head: 29, deprel: 'obj', start: 138, end: 145 },
    { id: 33, text: '.', lemma: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 145, end: 146 },
  ]

  it('produces exactly 3 ordered members with no cross-member leakage, overlap, or duplication', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(3)
    for (let i = 1; i < members.length; i++) expect(members[i].start).toBeGreaterThan(members[i - 1].start)
    assertNoLeakageOrOverlap(members)
    for (const member of members) assertNoDuplicateSourceOwnership(member)
    expect(members[0].text).toContain('collect the raw samples')
    expect(members[1].text).toContain('filter the noisy readings')
    expect(members[2].text).toContain('analyze the cleaned dataset')
  })
})

describe('Prototype 2.6G2.8E2 CASE 2 -- gerund/non-finite-headed 3-member numbered list (sampling/removing/fitting)', () => {
  const text =
    'The pipeline proceeded through the following steps: (1) sampling points across the study area; (2) removing outliers from the raw records; and (3) fitting the regression model.'
  const tokens: StanzaToken[] = [
    { id: 1, text: 'The', lemma: 'the', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 },
    { id: 2, text: 'pipeline', lemma: 'pipeline', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 12 },
    { id: 3, text: 'proceeded', lemma: 'proceed', upos: 'VERB', head: 0, deprel: 'root', start: 13, end: 22 },
    { id: 4, text: 'through', lemma: 'through', upos: 'ADP', head: 7, deprel: 'case', start: 23, end: 30 },
    { id: 5, text: 'the', lemma: 'the', upos: 'DET', head: 7, deprel: 'det', start: 31, end: 34 },
    { id: 6, text: 'following', lemma: 'follow', upos: 'VERB', head: 7, deprel: 'amod', start: 35, end: 44 },
    { id: 7, text: 'steps', lemma: 'step', upos: 'NOUN', head: 3, deprel: 'obl', start: 45, end: 50 },
    { id: 8, text: ':', lemma: ':', upos: 'PUNCT', head: 13, deprel: 'punct', start: 50, end: 51 },
    { id: 9, text: '(', lemma: '(', upos: 'PUNCT', head: 10, deprel: 'punct', start: 52, end: 53 },
    { id: 10, text: '1', lemma: '1', upos: 'NUM', head: 13, deprel: 'discourse', start: 53, end: 54 },
    { id: 11, text: ')', lemma: ')', upos: 'PUNCT', head: 10, deprel: 'punct', start: 54, end: 55 },
    { id: 12, text: 'sampling', lemma: 'sampling', upos: 'NOUN', head: 13, deprel: 'compound', start: 56, end: 64 },
    { id: 13, text: 'points', lemma: 'point', upos: 'NOUN', head: 7, deprel: 'appos', start: 65, end: 71 },
    { id: 14, text: 'across', lemma: 'across', upos: 'ADP', head: 17, deprel: 'case', start: 72, end: 78 },
    { id: 15, text: 'the', lemma: 'the', upos: 'DET', head: 17, deprel: 'det', start: 79, end: 82 },
    { id: 16, text: 'study', lemma: 'study', upos: 'NOUN', head: 17, deprel: 'compound', start: 83, end: 88 },
    { id: 17, text: 'area', lemma: 'area', upos: 'NOUN', head: 13, deprel: 'nmod', start: 89, end: 93 },
    { id: 18, text: ';', lemma: ';', upos: 'PUNCT', head: 22, deprel: 'punct', start: 93, end: 94 },
    { id: 19, text: '(', lemma: '(', upos: 'PUNCT', head: 20, deprel: 'punct', start: 95, end: 96 },
    { id: 20, text: '2', lemma: '2', upos: 'NUM', head: 22, deprel: 'discourse', start: 96, end: 97 },
    { id: 21, text: ')', lemma: ')', upos: 'PUNCT', head: 20, deprel: 'punct', start: 97, end: 98 },
    { id: 22, text: 'removing', lemma: 'remove', upos: 'VERB', head: 13, deprel: 'acl', start: 99, end: 107 },
    { id: 23, text: 'outliers', lemma: 'outlier', upos: 'NOUN', head: 22, deprel: 'obj', start: 108, end: 116 },
    { id: 24, text: 'from', lemma: 'from', upos: 'ADP', head: 27, deprel: 'case', start: 117, end: 121 },
    { id: 25, text: 'the', lemma: 'the', upos: 'DET', head: 27, deprel: 'det', start: 122, end: 125 },
    { id: 26, text: 'raw', lemma: 'raw', upos: 'ADJ', head: 27, deprel: 'amod', start: 126, end: 129 },
    { id: 27, text: 'records', lemma: 'record', upos: 'NOUN', head: 22, deprel: 'obl', start: 130, end: 137 },
    { id: 28, text: ';', lemma: ';', upos: 'PUNCT', head: 29, deprel: 'punct', start: 137, end: 138 },
    { id: 29, text: 'and', lemma: 'and', upos: 'CCONJ', head: 33, deprel: 'cc', start: 139, end: 142 },
    { id: 30, text: '(', lemma: '(', upos: 'PUNCT', head: 31, deprel: 'punct', start: 143, end: 144 },
    { id: 31, text: '3', lemma: '3', upos: 'NUM', head: 33, deprel: 'discourse', start: 144, end: 145 },
    { id: 32, text: ')', lemma: ')', upos: 'PUNCT', head: 31, deprel: 'punct', start: 145, end: 146 },
    { id: 33, text: 'fitting', lemma: 'fit', upos: 'VERB', head: 22, deprel: 'conj', start: 147, end: 154 },
    { id: 34, text: 'the', lemma: 'the', upos: 'DET', head: 36, deprel: 'det', start: 155, end: 158 },
    { id: 35, text: 'regression', lemma: 'regression', upos: 'NOUN', head: 36, deprel: 'compound', start: 159, end: 169 },
    { id: 36, text: 'model', lemma: 'model', upos: 'NOUN', head: 33, deprel: 'obj', start: 170, end: 175 },
    { id: 37, text: '.', lemma: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 175, end: 176 },
  ]

  it('produces exactly 3 ordered members with no cross-member leakage, overlap, or duplication', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(3)
    for (let i = 1; i < members.length; i++) expect(members[i].start).toBeGreaterThan(members[i - 1].start)
    assertNoLeakageOrOverlap(members)
    for (const member of members) assertNoDuplicateSourceOwnership(member)
    expect(members[1].text).toContain('removing outliers from the raw records')
    expect(members[2].text).toContain('fitting the regression model')
  })

  it('members 2/3 retain their own gerund heads as visible predicate nodes', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    const members = findEnumeration(tree).children
    const heads = members.map((member) => flatten(member.children).find((n) => n.role === 'predicate')?.text)
    expect(heads[1]).toBe('removing')
    expect(heads[2]).toBe('fitting')
  })
})

describe('Prototype 2.6G2.8E2 CASE 4 -- internal NP coordination negative (no numbered markers present)', () => {
  const text = 'The sensor recorded the ambient temperature and pressure at each station.'
  const tokens: StanzaToken[] = [
    { id: 1, text: 'The', lemma: 'the', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 },
    { id: 2, text: 'sensor', lemma: 'sensor', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 10 },
    { id: 3, text: 'recorded', lemma: 'record', upos: 'VERB', head: 0, deprel: 'root', start: 11, end: 19 },
    { id: 4, text: 'the', lemma: 'the', upos: 'DET', head: 6, deprel: 'det', start: 20, end: 23 },
    { id: 5, text: 'ambient', lemma: 'ambient', upos: 'ADJ', head: 6, deprel: 'amod', start: 24, end: 31 },
    { id: 6, text: 'temperature', lemma: 'temperature', upos: 'NOUN', head: 3, deprel: 'obj', start: 32, end: 43 },
    { id: 7, text: 'and', lemma: 'and', upos: 'CCONJ', head: 8, deprel: 'cc', start: 44, end: 47 },
    { id: 8, text: 'pressure', lemma: 'pressure', upos: 'NOUN', head: 6, deprel: 'conj', start: 48, end: 56 },
    { id: 9, text: 'at', lemma: 'at', upos: 'ADP', head: 11, deprel: 'case', start: 57, end: 59 },
    { id: 10, text: 'each', lemma: 'each', upos: 'DET', head: 11, deprel: 'det', start: 60, end: 64 },
    { id: 11, text: 'station', lemma: 'station', upos: 'NOUN', head: 3, deprel: 'obl', start: 65, end: 72 },
    { id: 12, text: '.', lemma: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 72, end: 73 },
  ]

  it('never creates an enumeration node -- "temperature and pressure" is ordinary internal coordination', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    expect(flatten(tree).some((n) => n.role === 'enumeration')).toBe(false)
    const object = flatten(tree).find((n) => n.role === 'object')
    expect(object?.text).toBe('the ambient temperature and pressure')
  })
})

describe('Prototype 2.6G2.8E2 CASE 5 -- internal "and" inside a numbered member does not split into an extra member', () => {
  const text = 'The team will randomly divide the dataset into a training set and a test set at a ratio of 7:3.'
  const tokens: StanzaToken[] = [
    { id: 1, text: 'The', lemma: 'the', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 },
    { id: 2, text: 'team', lemma: 'team', upos: 'NOUN', head: 5, deprel: 'nsubj', start: 4, end: 8 },
    { id: 3, text: 'will', lemma: 'will', upos: 'AUX', head: 5, deprel: 'aux', start: 9, end: 13 },
    { id: 4, text: 'randomly', lemma: 'randomly', upos: 'ADV', head: 5, deprel: 'advmod', start: 14, end: 22 },
    { id: 5, text: 'divide', lemma: 'divide', upos: 'VERB', head: 0, deprel: 'root', start: 23, end: 29 },
    { id: 6, text: 'the', lemma: 'the', upos: 'DET', head: 7, deprel: 'det', start: 30, end: 33 },
    { id: 7, text: 'dataset', lemma: 'dataset', upos: 'NOUN', head: 5, deprel: 'obj', start: 34, end: 41 },
    { id: 8, text: 'into', lemma: 'into', upos: 'ADP', head: 11, deprel: 'case', start: 42, end: 46 },
    { id: 9, text: 'a', lemma: 'a', upos: 'DET', head: 11, deprel: 'det', start: 47, end: 48 },
    { id: 10, text: 'training', lemma: 'training', upos: 'NOUN', head: 11, deprel: 'compound', start: 49, end: 57 },
    { id: 11, text: 'set', lemma: 'set', upos: 'NOUN', head: 5, deprel: 'obl', start: 58, end: 61 },
    { id: 12, text: 'and', lemma: 'and', upos: 'CCONJ', head: 14, deprel: 'cc', start: 62, end: 65 },
    { id: 13, text: 'a', lemma: 'a', upos: 'DET', head: 14, deprel: 'det', start: 66, end: 67 },
    { id: 14, text: 'test', lemma: 'test', upos: 'NOUN', head: 11, deprel: 'conj', start: 68, end: 72 },
    { id: 15, text: 'set', lemma: 'set', upos: 'VERB', head: 14, deprel: 'acl', start: 73, end: 76 },
    { id: 16, text: 'at', lemma: 'at', upos: 'ADP', head: 18, deprel: 'case', start: 77, end: 79 },
    { id: 17, text: 'a', lemma: 'a', upos: 'DET', head: 18, deprel: 'det', start: 80, end: 81 },
    { id: 18, text: 'ratio', lemma: 'ratio', upos: 'NOUN', head: 15, deprel: 'obl', start: 82, end: 87 },
    { id: 19, text: 'of', lemma: 'of', upos: 'ADP', head: 20, deprel: 'case', start: 88, end: 90 },
    { id: 20, text: '7:3', lemma: '7:3', upos: 'NUM', head: 18, deprel: 'nmod', start: 91, end: 94 },
    { id: 21, text: '.', lemma: '.', upos: 'PUNCT', head: 5, deprel: 'punct', start: 94, end: 95 },
  ]

  it('never creates an enumeration node -- "a training set and a test set" stays one modifier, not split members', () => {
    const tree = buildStanzaHierarchicalTree(text, tokens)
    expect(flatten(tree).some((n) => n.role === 'enumeration')).toBe(false)
    const modifier = flatten(tree).find((n) => n.role === 'modifier' && n.text.startsWith('into'))
    expect(modifier?.text).toBe('into a training set and a test set at a ratio of 7:3')
  })
})
