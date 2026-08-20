import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.8E2.1 -- Mixed Enumeration Members + Recursive Member-Local Source Ownership.
 * Every fixture is captured verbatim from a real Stanza parse (never hand-tuned). The two REAL
 * cases (KNN-GCN 6-member mixed nominal/gerund list, and the SUM/SUG two-clause member with the
 * IDW duplicate-ownership bug) are the primary regression targets; the seven synthetic cases
 * (14A-G in the phase spec) generalize the same two structural principles -- explicit numbered
 * markers are the outer authority regardless of Stanza's own preferred attachment point, and a
 * source span already built inside one unit must never be independently rebuilt as a peer.
 */

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

function findEnumeration(nodes: StructureTreeNode[]): StructureTreeNode {
  const enumeration = flatten(nodes).find((n) => n.role === 'enumeration')
  if (!enumeration) throw new Error('no enumeration node found')
  return enumeration
}

function assertNoLeakageOrOverlap(members: StructureTreeNode[]) {
  for (const member of members) {
    for (const descendant of flatten(member.children)) {
      expect(descendant.start).toBeGreaterThanOrEqual(member.start)
      expect(descendant.end).toBeLessThanOrEqual(member.end)
    }
  }
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const overlaps = members[i]!.start < members[j]!.end && members[j]!.start < members[i]!.end
      expect(overlaps).toBe(false)
    }
  }
}

/** No leaf (childless) node's source range may overlap another leaf's -- the general,
 * recursive form of MEMBER_LOCAL_PEER_SOURCE_DUPLICATION = 0 / no duplicate peer ownership. */
function assertNoLeafOverlap(root: StructureTreeNode) {
  const leaves = [root, ...flatten(root.children)].filter((n) => n.children.length === 0)
  const covered = new Set<number>()
  for (const leaf of leaves) {
    for (let p = leaf.start; p < leaf.end; p++) {
      expect(covered.has(p)).toBe(false)
      covered.add(p)
    }
  }
}

const caseAText = "In this study, a new slope-unit-based model called KNN-GCN is applied for the mapping of landslide susceptibility based on the following steps: (1) data collection for landslide causal factors and landslide inventory development, as described in the previous section; (2) slope unit division based on DEM and hydrological data; (3) multicollinearity analysis of the causal factors; (4) dataset construction and splitting; (5) constraining and training the KNN-GCN model; and (6) model evaluation, landslide mapping with the trained KNN-GCN model and model comparison."
const caseATokens: StanzaToken[] = [
    { id: 1, text: "In", lemma: "in", upos: "ADP", head: 3, deprel: "case", start: 0, end: 2 },
    { id: 2, text: "this", lemma: "this", upos: "DET", head: 3, deprel: "det", start: 3, end: 7 },
    { id: 3, text: "study", lemma: "study", upos: "NOUN", head: 18, deprel: "obl", start: 8, end: 13 },
    { id: 4, text: ",", lemma: ",", upos: "PUNCT", head: 3, deprel: "punct", start: 13, end: 14 },
    { id: 5, text: "a", lemma: "a", upos: "DET", head: 12, deprel: "det", start: 15, end: 16 },
    { id: 6, text: "new", lemma: "new", upos: "ADJ", head: 12, deprel: "amod", start: 17, end: 20 },
    { id: 7, text: "slope", lemma: "slope", upos: "NOUN", head: 11, deprel: "obl:unmarked", start: 21, end: 26 },
    { id: 8, text: "-", lemma: "-", upos: "PUNCT", head: 7, deprel: "punct", start: 26, end: 27 },
    { id: 9, text: "unit", lemma: "unit", upos: "NOUN", head: 11, deprel: "obl:unmarked", start: 27, end: 31 },
    { id: 10, text: "-", lemma: "-", upos: "PUNCT", head: 9, deprel: "punct", start: 31, end: 32 },
    { id: 11, text: "based", lemma: "base", upos: "VERB", head: 12, deprel: "amod", start: 32, end: 37 },
    { id: 12, text: "model", lemma: "model", upos: "NOUN", head: 18, deprel: "nsubj:pass", start: 38, end: 43 },
    { id: 13, text: "called", lemma: "call", upos: "VERB", head: 12, deprel: "acl", start: 44, end: 50 },
    { id: 14, text: "KNN", lemma: "KNN", upos: "PROPN", head: 13, deprel: "xcomp", start: 51, end: 54 },
    { id: 15, text: "-", lemma: "-", upos: "PUNCT", head: 16, deprel: "punct", start: 54, end: 55 },
    { id: 16, text: "GCN", lemma: "GCN", upos: "PROPN", head: 14, deprel: "flat", start: 55, end: 58 },
    { id: 17, text: "is", lemma: "be", upos: "AUX", head: 18, deprel: "aux:pass", start: 59, end: 61 },
    { id: 18, text: "applied", lemma: "apply", upos: "VERB", head: 0, deprel: "root", start: 62, end: 69 },
    { id: 19, text: "for", lemma: "for", upos: "ADP", head: 21, deprel: "case", start: 70, end: 73 },
    { id: 20, text: "the", lemma: "the", upos: "DET", head: 21, deprel: "det", start: 74, end: 77 },
    { id: 21, text: "mapping", lemma: "mapping", upos: "NOUN", head: 18, deprel: "obl", start: 78, end: 85 },
    { id: 22, text: "of", lemma: "of", upos: "ADP", head: 24, deprel: "case", start: 86, end: 88 },
    { id: 23, text: "landslide", lemma: "landslide", upos: "NOUN", head: 24, deprel: "compound", start: 89, end: 98 },
    { id: 24, text: "susceptibility", lemma: "susceptibility", upos: "NOUN", head: 21, deprel: "nmod", start: 99, end: 113 },
    { id: 25, text: "based", lemma: "base", upos: "VERB", head: 21, deprel: "acl", start: 114, end: 119 },
    { id: 26, text: "on", lemma: "on", upos: "ADP", head: 29, deprel: "case", start: 120, end: 122 },
    { id: 27, text: "the", lemma: "the", upos: "DET", head: 29, deprel: "det", start: 123, end: 126 },
    { id: 28, text: "following", lemma: "follow", upos: "VERB", head: 29, deprel: "amod", start: 127, end: 136 },
    { id: 29, text: "steps", lemma: "step", upos: "NOUN", head: 25, deprel: "obl", start: 137, end: 142 },
    { id: 30, text: ":", lemma: ":", upos: "PUNCT", head: 35, deprel: "punct", start: 142, end: 143 },
    { id: 31, text: "(", lemma: "(", upos: "PUNCT", head: 32, deprel: "punct", start: 144, end: 145 },
    { id: 32, text: "1", lemma: "1", upos: "NUM", head: 35, deprel: "discourse", start: 145, end: 146 },
    { id: 33, text: ")", lemma: ")", upos: "PUNCT", head: 32, deprel: "punct", start: 146, end: 147 },
    { id: 34, text: "data", lemma: "datum", upos: "NOUN", head: 35, deprel: "compound", start: 148, end: 152 },
    { id: 35, text: "collection", lemma: "collection", upos: "NOUN", head: 29, deprel: "appos", start: 153, end: 163 },
    { id: 36, text: "for", lemma: "for", upos: "ADP", head: 39, deprel: "case", start: 164, end: 167 },
    { id: 37, text: "landslide", lemma: "landslide", upos: "NOUN", head: 39, deprel: "compound", start: 168, end: 177 },
    { id: 38, text: "causal", lemma: "causal", upos: "ADJ", head: 39, deprel: "amod", start: 178, end: 184 },
    { id: 39, text: "factors", lemma: "factor", upos: "NOUN", head: 35, deprel: "nmod", start: 185, end: 192 },
    { id: 40, text: "and", lemma: "and", upos: "CCONJ", head: 43, deprel: "cc", start: 193, end: 196 },
    { id: 41, text: "landslide", lemma: "landslide", upos: "NOUN", head: 43, deprel: "compound", start: 197, end: 206 },
    { id: 42, text: "inventory", lemma: "inventory", upos: "NOUN", head: 43, deprel: "compound", start: 207, end: 216 },
    { id: 43, text: "development", lemma: "development", upos: "NOUN", head: 39, deprel: "conj", start: 217, end: 228 },
    { id: 44, text: ",", lemma: ",", upos: "PUNCT", head: 46, deprel: "punct", start: 228, end: 229 },
    { id: 45, text: "as", lemma: "as", upos: "SCONJ", head: 46, deprel: "mark", start: 230, end: 232 },
    { id: 46, text: "described", lemma: "describe", upos: "VERB", head: 35, deprel: "acl", start: 233, end: 242 },
    { id: 47, text: "in", lemma: "in", upos: "ADP", head: 50, deprel: "case", start: 243, end: 245 },
    { id: 48, text: "the", lemma: "the", upos: "DET", head: 57, deprel: "det", start: 246, end: 249 },
    { id: 49, text: "previous", lemma: "previous", upos: "ADJ", head: 50, deprel: "amod", start: 250, end: 258 },
    { id: 50, text: "section", lemma: "section", upos: "NOUN", head: 46, deprel: "obl", start: 259, end: 266 },
    { id: 51, text: ";", lemma: ";", upos: "PUNCT", head: 50, deprel: "punct", start: 266, end: 267 },
    { id: 52, text: "(", lemma: "(", upos: "PUNCT", head: 53, deprel: "punct", start: 268, end: 269 },
    { id: 53, text: "2", lemma: "2", upos: "NUM", head: 57, deprel: "discourse", start: 269, end: 270 },
    { id: 54, text: ")", lemma: ")", upos: "PUNCT", head: 53, deprel: "punct", start: 270, end: 271 },
    { id: 55, text: "slope", lemma: "slope", upos: "NOUN", head: 56, deprel: "compound", start: 272, end: 277 },
    { id: 56, text: "unit", lemma: "unit", upos: "NOUN", head: 57, deprel: "compound", start: 278, end: 282 },
    { id: 57, text: "division", lemma: "division", upos: "NOUN", head: 50, deprel: "appos", start: 283, end: 291 },
    { id: 58, text: "based", lemma: "base", upos: "VERB", head: 57, deprel: "acl", start: 292, end: 297 },
    { id: 59, text: "on", lemma: "on", upos: "ADP", head: 63, deprel: "case", start: 298, end: 300 },
    { id: 60, text: "DEM", lemma: "dem", upos: "NOUN", head: 63, deprel: "compound", start: 301, end: 304 },
    { id: 61, text: "and", lemma: "and", upos: "CCONJ", head: 62, deprel: "cc", start: 305, end: 308 },
    { id: 62, text: "hydrological", lemma: "hydrological", upos: "ADJ", head: 60, deprel: "conj", start: 309, end: 321 },
    { id: 63, text: "data", lemma: "datum", upos: "NOUN", head: 58, deprel: "obl", start: 322, end: 326 },
    { id: 64, text: ";", lemma: ";", upos: "PUNCT", head: 69, deprel: "punct", start: 326, end: 327 },
    { id: 65, text: "(", lemma: "(", upos: "PUNCT", head: 66, deprel: "punct", start: 328, end: 329 },
    { id: 66, text: "3", lemma: "3", upos: "NUM", head: 69, deprel: "discourse", start: 329, end: 330 },
    { id: 67, text: ")", lemma: ")", upos: "PUNCT", head: 66, deprel: "punct", start: 330, end: 331 },
    { id: 68, text: "multicollinearity", lemma: "multicollinearity", upos: "NOUN", head: 69, deprel: "compound", start: 332, end: 349 },
    { id: 69, text: "analysis", lemma: "analysis", upos: "NOUN", head: 57, deprel: "conj", start: 350, end: 358 },
    { id: 70, text: "of", lemma: "of", upos: "ADP", head: 73, deprel: "case", start: 359, end: 361 },
    { id: 71, text: "the", lemma: "the", upos: "DET", head: 73, deprel: "det", start: 362, end: 365 },
    { id: 72, text: "causal", lemma: "causal", upos: "ADJ", head: 73, deprel: "amod", start: 366, end: 372 },
    { id: 73, text: "factors", lemma: "factor", upos: "NOUN", head: 69, deprel: "nmod", start: 373, end: 380 },
    { id: 74, text: ";", lemma: ";", upos: "PUNCT", head: 79, deprel: "punct", start: 380, end: 381 },
    { id: 75, text: "(", lemma: "(", upos: "PUNCT", head: 76, deprel: "punct", start: 382, end: 383 },
    { id: 76, text: "4", lemma: "4", upos: "NUM", head: 79, deprel: "discourse", start: 383, end: 384 },
    { id: 77, text: ")", lemma: ")", upos: "PUNCT", head: 76, deprel: "punct", start: 384, end: 385 },
    { id: 78, text: "dataset", lemma: "dataset", upos: "NOUN", head: 79, deprel: "compound", start: 386, end: 393 },
    { id: 79, text: "construction", lemma: "construction", upos: "NOUN", head: 73, deprel: "appos", start: 394, end: 406 },
    { id: 80, text: "and", lemma: "and", upos: "CCONJ", head: 81, deprel: "cc", start: 407, end: 410 },
    { id: 81, text: "splitting", lemma: "split", upos: "NOUN", head: 79, deprel: "conj", start: 411, end: 420 },
    { id: 82, text: ";", lemma: ";", upos: "PUNCT", head: 86, deprel: "punct", start: 420, end: 421 },
    { id: 83, text: "(", lemma: "(", upos: "PUNCT", head: 84, deprel: "punct", start: 422, end: 423 },
    { id: 84, text: "5", lemma: "5", upos: "NUM", head: 86, deprel: "discourse", start: 423, end: 424 },
    { id: 85, text: ")", lemma: ")", upos: "PUNCT", head: 84, deprel: "punct", start: 424, end: 425 },
    { id: 86, text: "constraining", lemma: "constrain", upos: "VERB", head: 79, deprel: "conj", start: 426, end: 438 },
    { id: 87, text: "and", lemma: "and", upos: "CCONJ", head: 88, deprel: "cc", start: 439, end: 442 },
    { id: 88, text: "training", lemma: "train", upos: "VERB", head: 86, deprel: "conj", start: 443, end: 451 },
    { id: 89, text: "the", lemma: "the", upos: "DET", head: 93, deprel: "det", start: 452, end: 455 },
    { id: 90, text: "KNN", lemma: "KNN", upos: "PROPN", head: 93, deprel: "compound", start: 456, end: 459 },
    { id: 91, text: "-", lemma: "-", upos: "PUNCT", head: 90, deprel: "punct", start: 459, end: 460 },
    { id: 92, text: "GCN", lemma: "GCN", upos: "PROPN", head: 90, deprel: "flat", start: 460, end: 463 },
    { id: 93, text: "model", lemma: "model", upos: "NOUN", head: 86, deprel: "obj", start: 464, end: 469 },
    { id: 94, text: ";", lemma: ";", upos: "PUNCT", head: 95, deprel: "punct", start: 469, end: 470 },
    { id: 95, text: "and", lemma: "and", upos: "CCONJ", head: 100, deprel: "cc", start: 471, end: 474 },
    { id: 96, text: "(", lemma: "(", upos: "PUNCT", head: 97, deprel: "punct", start: 475, end: 476 },
    { id: 97, text: "6", lemma: "6", upos: "NUM", head: 100, deprel: "discourse", start: 476, end: 477 },
    { id: 98, text: ")", lemma: ")", upos: "PUNCT", head: 97, deprel: "punct", start: 477, end: 478 },
    { id: 99, text: "model", lemma: "model", upos: "NOUN", head: 100, deprel: "compound", start: 479, end: 484 },
    { id: 100, text: "evaluation", lemma: "evaluation", upos: "NOUN", head: 93, deprel: "conj", start: 485, end: 495 },
    { id: 101, text: ",", lemma: ",", upos: "PUNCT", head: 103, deprel: "punct", start: 495, end: 496 },
    { id: 102, text: "landslide", lemma: "landslide", upos: "NOUN", head: 103, deprel: "compound", start: 497, end: 506 },
    { id: 103, text: "mapping", lemma: "mapping", upos: "NOUN", head: 100, deprel: "conj", start: 507, end: 514 },
    { id: 104, text: "with", lemma: "with", upos: "ADP", head: 110, deprel: "case", start: 515, end: 519 },
    { id: 105, text: "the", lemma: "the", upos: "DET", head: 110, deprel: "det", start: 520, end: 523 },
    { id: 106, text: "trained", lemma: "train", upos: "VERB", head: 110, deprel: "amod", start: 524, end: 531 },
    { id: 107, text: "KNN", lemma: "knn", upos: "NOUN", head: 109, deprel: "compound", start: 532, end: 535 },
    { id: 108, text: "-", lemma: "-", upos: "PUNCT", head: 107, deprel: "punct", start: 535, end: 536 },
    { id: 109, text: "GCN", lemma: "GCN", upos: "PROPN", head: 110, deprel: "compound", start: 536, end: 539 },
    { id: 110, text: "model", lemma: "model", upos: "NOUN", head: 103, deprel: "nmod", start: 540, end: 545 },
    { id: 111, text: "and", lemma: "and", upos: "CCONJ", head: 113, deprel: "cc", start: 546, end: 549 },
    { id: 112, text: "model", lemma: "model", upos: "NOUN", head: 113, deprel: "compound", start: 550, end: 555 },
    { id: 113, text: "comparison", lemma: "comparison", upos: "NOUN", head: 110, deprel: "conj", start: 556, end: 566 },
    { id: 114, text: ".", lemma: ".", upos: "PUNCT", head: 18, deprel: "punct", start: 566, end: 567 },
]

describe('Prototype 2.6G2.8E2.1 REAL CASE A -- mixed nominal/gerund/predicate 6-member numbered list (KNN-GCN)', () => {
  it('ENUMERATION_MARKER_COUNT=6, ENUMERATION_MEMBER_COUNT=6, MARKER_MEMBER_BIJECTION=100%, order=100%', () => {
    const tree = buildStanzaHierarchicalTree(caseAText, caseATokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(6)
    for (let i = 1; i < members.length; i++) expect(members[i]!.start).toBeGreaterThan(members[i - 1]!.start)
  })

  it('every member preserves its complete nominal/gerund/predicate identity -- no NOMINAL_MEMBER_ERASURE/GERUND_MEMBER_ERASURE', () => {
    const tree = buildStanzaHierarchicalTree(caseAText, caseATokens)
    const members = findEnumeration(tree).children
    expect(members[0]!.text).toBe('(1) data collection for landslide causal factors and landslide inventory development, as described in the previous section')
    expect(members[1]!.text).toBe('(2) slope unit division based on DEM and hydrological data')
    expect(members[2]!.text).toBe('(3) multicollinearity analysis of the causal factors')
    expect(members[3]!.text).toBe('(4) dataset construction and splitting')
    expect(members[4]!.text).toBe('(5) constraining and training the KNN-GCN model')
    expect(members[5]!.text).toBe('(6) model evaluation, landslide mapping with the trained KNN-GCN model and model comparison')
  })

  it('"described"/"based" never become the apparent member head (adnominal acl stays embedded, never promoted)', () => {
    const tree = buildStanzaHierarchicalTree(caseAText, caseATokens)
    const members = findEnumeration(tree).children
    const member1Predicates = flatten(members[0]!.children).filter((n) => n.role === 'predicate')
    const member2Predicates = flatten(members[1]!.children).filter((n) => n.role === 'predicate')
    expect(member1Predicates.some((n) => n.text === 'described')).toBe(false)
    expect(member2Predicates.some((n) => n.text === 'based')).toBe(false)
  })

  it('ENUMERATION_CROSS_MEMBER_DESCENDANT_LEAKAGE=0, ENUMERATION_MEMBER_SOURCE_OVERLAP=0 (member 5 object never reaches into member 6)', () => {
    const tree = buildStanzaHierarchicalTree(caseAText, caseATokens)
    assertNoLeakageOrOverlap(findEnumeration(tree).children)
  })

  it('member 5 retains "constraining"/"training" as coordinated predicates with a correctly bounded object', () => {
    const tree = buildStanzaHierarchicalTree(caseAText, caseATokens)
    const members = findEnumeration(tree).children
    const flat5 = flatten(members[4]!.children)
    expect(flat5.some((n) => n.role === 'predicate' && n.text === 'constraining')).toBe(true)
    expect(flat5.some((n) => n.role === 'coordinatedPredicate' && n.text === 'training')).toBe(true)
    const object = flat5.find((n) => n.role === 'object')
    expect(object?.text).toBe('the KNN-GCN model')
  })

  it('Prototype 2.6G2.8E2.2 TRACK A -- member 5\'s shared object is a GROUP-SCOPE sibling of both "constraining" and "training", never nested exclusively under one', () => {
    const tree = buildStanzaHierarchicalTree(caseAText, caseATokens)
    const members = findEnumeration(tree).children
    const member5 = members[4]!
    const objectSibling = member5.children.find((n) => n.role === 'object')
    expect(objectSibling?.text).toBe('the KNN-GCN model')
    const predicateNode = member5.children.find((n) => n.role === 'predicate' && n.text === 'constraining')!
    const coordNode = member5.children.find((n) => n.role === 'coordinatedPredicate' && n.text === 'training')!
    expect(predicateNode.children.some((n) => n.role === 'object')).toBe(false)
    expect(coordNode.children.some((n) => n.role === 'object')).toBe(false)
  })
})

const caseBText = "The structure of this model is shown in Fig. 5, and it consists of two parts: (1) the SUM is converted to a SUG using the KNN method, and the weight of each edge is calculated based on the distances between nodes using the inverse distance weighting (IDW) algorithm, and (2) a multilayer GCN model is established for LSM."
const caseBTokens: StanzaToken[] = [
    { id: 1, text: "The", lemma: "the", upos: "DET", head: 2, deprel: "det", start: 0, end: 3 },
    { id: 2, text: "structure", lemma: "structure", upos: "NOUN", head: 7, deprel: "nsubj:pass", start: 4, end: 13 },
    { id: 3, text: "of", lemma: "of", upos: "ADP", head: 5, deprel: "case", start: 14, end: 16 },
    { id: 4, text: "this", lemma: "this", upos: "DET", head: 5, deprel: "det", start: 17, end: 21 },
    { id: 5, text: "model", lemma: "model", upos: "NOUN", head: 2, deprel: "nmod", start: 22, end: 27 },
    { id: 6, text: "is", lemma: "be", upos: "AUX", head: 7, deprel: "aux:pass", start: 28, end: 30 },
    { id: 7, text: "shown", lemma: "show", upos: "VERB", head: 0, deprel: "root", start: 31, end: 36 },
    { id: 8, text: "in", lemma: "in", upos: "ADP", head: 9, deprel: "case", start: 37, end: 39 },
    { id: 9, text: "Fig.", lemma: "Fig.", upos: "PROPN", head: 7, deprel: "obl", start: 40, end: 44 },
    { id: 10, text: "5", lemma: "5", upos: "NUM", head: 9, deprel: "flat", start: 45, end: 46 },
    { id: 11, text: ",", lemma: ",", upos: "PUNCT", head: 14, deprel: "punct", start: 46, end: 47 },
    { id: 12, text: "and", lemma: "and", upos: "CCONJ", head: 14, deprel: "cc", start: 48, end: 51 },
    { id: 13, text: "it", lemma: "it", upos: "PRON", head: 14, deprel: "nsubj", start: 52, end: 54 },
    { id: 14, text: "consists", lemma: "consist", upos: "VERB", head: 7, deprel: "conj", start: 55, end: 63 },
    { id: 15, text: "of", lemma: "of", upos: "ADP", head: 17, deprel: "case", start: 64, end: 66 },
    { id: 16, text: "two", lemma: "two", upos: "NUM", head: 17, deprel: "nummod", start: 67, end: 70 },
    { id: 17, text: "parts", lemma: "part", upos: "NOUN", head: 14, deprel: "obl", start: 71, end: 76 },
    { id: 18, text: ":", lemma: ":", upos: "PUNCT", head: 25, deprel: "punct", start: 76, end: 77 },
    { id: 19, text: "(", lemma: "(", upos: "PUNCT", head: 20, deprel: "punct", start: 78, end: 79 },
    { id: 20, text: "1", lemma: "1", upos: "NUM", head: 25, deprel: "discourse", start: 79, end: 80 },
    { id: 21, text: ")", lemma: ")", upos: "PUNCT", head: 20, deprel: "punct", start: 80, end: 81 },
    { id: 22, text: "the", lemma: "the", upos: "DET", head: 23, deprel: "det", start: 82, end: 85 },
    { id: 23, text: "SUM", lemma: "SUM", upos: "NOUN", head: 25, deprel: "nsubj:pass", start: 86, end: 89 },
    { id: 24, text: "is", lemma: "be", upos: "AUX", head: 25, deprel: "aux:pass", start: 90, end: 92 },
    { id: 25, text: "converted", lemma: "convert", upos: "VERB", head: 7, deprel: "parataxis", start: 93, end: 102 },
    { id: 26, text: "to", lemma: "to", upos: "ADP", head: 28, deprel: "case", start: 103, end: 105 },
    { id: 27, text: "a", lemma: "a", upos: "DET", head: 28, deprel: "det", start: 106, end: 107 },
    { id: 28, text: "SUG", lemma: "sug", upos: "NOUN", head: 25, deprel: "obl", start: 108, end: 111 },
    { id: 29, text: "using", lemma: "use", upos: "VERB", head: 25, deprel: "advcl", start: 112, end: 117 },
    { id: 30, text: "the", lemma: "the", upos: "DET", head: 32, deprel: "det", start: 118, end: 121 },
    { id: 31, text: "KNN", lemma: "knn", upos: "NOUN", head: 32, deprel: "compound", start: 122, end: 125 },
    { id: 32, text: "method", lemma: "method", upos: "NOUN", head: 29, deprel: "obj", start: 126, end: 132 },
    { id: 33, text: ",", lemma: ",", upos: "PUNCT", head: 41, deprel: "punct", start: 132, end: 133 },
    { id: 34, text: "and", lemma: "and", upos: "CCONJ", head: 41, deprel: "cc", start: 134, end: 137 },
    { id: 35, text: "the", lemma: "the", upos: "DET", head: 36, deprel: "det", start: 138, end: 141 },
    { id: 36, text: "weight", lemma: "weight", upos: "NOUN", head: 41, deprel: "nsubj:pass", start: 142, end: 148 },
    { id: 37, text: "of", lemma: "of", upos: "ADP", head: 39, deprel: "case", start: 149, end: 151 },
    { id: 38, text: "each", lemma: "each", upos: "DET", head: 39, deprel: "det", start: 152, end: 156 },
    { id: 39, text: "edge", lemma: "edge", upos: "NOUN", head: 36, deprel: "nmod", start: 157, end: 161 },
    { id: 40, text: "is", lemma: "be", upos: "AUX", head: 41, deprel: "aux:pass", start: 162, end: 164 },
    { id: 41, text: "calculated", lemma: "calculate", upos: "VERB", head: 25, deprel: "conj", start: 165, end: 175 },
    { id: 42, text: "based", lemma: "base", upos: "VERB", head: 41, deprel: "advcl", start: 176, end: 181 },
    { id: 43, text: "on", lemma: "on", upos: "ADP", head: 45, deprel: "case", start: 182, end: 184 },
    { id: 44, text: "the", lemma: "the", upos: "DET", head: 45, deprel: "det", start: 185, end: 188 },
    { id: 45, text: "distances", lemma: "distance", upos: "NOUN", head: 42, deprel: "obl", start: 189, end: 198 },
    { id: 46, text: "between", lemma: "between", upos: "ADP", head: 47, deprel: "case", start: 199, end: 206 },
    { id: 47, text: "nodes", lemma: "node", upos: "NOUN", head: 45, deprel: "nmod", start: 207, end: 212 },
    { id: 48, text: "using", lemma: "use", upos: "VERB", head: 47, deprel: "acl", start: 213, end: 218 },
    { id: 49, text: "the", lemma: "the", upos: "DET", head: 56, deprel: "det", start: 219, end: 222 },
    { id: 50, text: "inverse", lemma: "inverse", upos: "ADJ", head: 51, deprel: "amod", start: 223, end: 230 },
    { id: 51, text: "distance", lemma: "distance", upos: "NOUN", head: 52, deprel: "compound", start: 231, end: 239 },
    { id: 52, text: "weighting", lemma: "weighting", upos: "NOUN", head: 56, deprel: "compound", start: 240, end: 249 },
    { id: 53, text: "(", lemma: "(", upos: "PUNCT", head: 54, deprel: "punct", start: 250, end: 251 },
    { id: 54, text: "IDW", lemma: "IDW", upos: "PROPN", head: 52, deprel: "appos", start: 251, end: 254 },
    { id: 55, text: ")", lemma: ")", upos: "PUNCT", head: 54, deprel: "punct", start: 254, end: 255 },
    { id: 56, text: "algorithm", lemma: "algorithm", upos: "NOUN", head: 48, deprel: "obj", start: 256, end: 265 },
    { id: 57, text: ",", lemma: ",", upos: "PUNCT", head: 58, deprel: "punct", start: 265, end: 266 },
    { id: 58, text: "and", lemma: "and", upos: "CCONJ", head: 67, deprel: "cc", start: 267, end: 270 },
    { id: 59, text: "(", lemma: "(", upos: "PUNCT", head: 60, deprel: "punct", start: 271, end: 272 },
    { id: 60, text: "2", lemma: "2", upos: "NUM", head: 67, deprel: "discourse", start: 272, end: 273 },
    { id: 61, text: ")", lemma: ")", upos: "PUNCT", head: 60, deprel: "punct", start: 273, end: 274 },
    { id: 62, text: "a", lemma: "a", upos: "DET", head: 65, deprel: "det", start: 275, end: 276 },
    { id: 63, text: "multilayer", lemma: "multilayer", upos: "NOUN", head: 65, deprel: "compound", start: 277, end: 287 },
    { id: 64, text: "GCN", lemma: "gcn", upos: "NOUN", head: 65, deprel: "compound", start: 288, end: 291 },
    { id: 65, text: "model", lemma: "model", upos: "NOUN", head: 67, deprel: "nsubj:pass", start: 292, end: 297 },
    { id: 66, text: "is", lemma: "be", upos: "AUX", head: 67, deprel: "aux:pass", start: 298, end: 300 },
    { id: 67, text: "established", lemma: "establish", upos: "VERB", head: 41, deprel: "conj", start: 301, end: 312 },
    { id: 68, text: "for", lemma: "for", upos: "ADP", head: 69, deprel: "case", start: 313, end: 316 },
    { id: 69, text: "LSM", lemma: "LSM", upos: "PROPN", head: 67, deprel: "obl", start: 317, end: 320 },
    { id: 70, text: ".", lemma: ".", upos: "PUNCT", head: 7, deprel: "punct", start: 320, end: 321 },
]

describe('Prototype 2.6G2.8E2.1 REAL CASE B -- internal clause coordination + IDW duplicate-ownership', () => {
  it('OUTER_ENUMERATION_MEMBER_COUNT=2', () => {
    const tree = buildStanzaHierarchicalTree(caseBText, caseBTokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(2)
  })

  it('MEMBER_1_INTERNAL_CLAUSE_COUNT=2 -- "is converted" and "is calculated" both present as their own clauses', () => {
    const tree = buildStanzaHierarchicalTree(caseBText, caseBTokens)
    const members = findEnumeration(tree).children
    const flat1 = flatten(members[0]!.children)
    expect(flat1.some((n) => n.role === 'predicate' && n.text === 'is converted')).toBe(true)
    expect(flat1.some((n) => n.role === 'coordinatedPredicate' && n.text === 'is calculated')).toBe(true)
  })

  it('IDW_USING_PRESENTATION_COUNT=1 -- MEMBER_1_PEER_SOURCE_DUPLICATION=0', () => {
    const tree = buildStanzaHierarchicalTree(caseBText, caseBTokens)
    const idwLeaves = flatten(tree).filter((n) => n.children.length === 0 && n.text.includes('IDW'))
    expect(idwLeaves).toHaveLength(1)
    expect(idwLeaves[0]!.role).not.toBe('predicate')
    expect(idwLeaves[0]!.role).not.toBe('coordinatedPredicate')
  })

  it('member 2 retains "is established" for LSM, untouched', () => {
    const tree = buildStanzaHierarchicalTree(caseBText, caseBTokens)
    const members = findEnumeration(tree).children
    expect(members[1]!.text).toContain('a multilayer GCN model')
    expect(members[1]!.text).toContain('is established')
    expect(members[1]!.text).toContain('for LSM')
  })

  it('no leaf source range in member 1 overlaps another (general recursive ownership check)', () => {
    const tree = buildStanzaHierarchicalTree(caseBText, caseBTokens)
    const members = findEnumeration(tree).children
    assertNoLeafOverlap(members[0]!)
  })
})

const synthAText = "The process consisted of the following steps: (1) data collection; (2) feature extraction; and (3) model evaluation."
const synthATokens: StanzaToken[] = [
    { id: 1, text: "The", lemma: "the", upos: "DET", head: 2, deprel: "det", start: 0, end: 3 },
    { id: 2, text: "process", lemma: "process", upos: "NOUN", head: 3, deprel: "nsubj", start: 4, end: 11 },
    { id: 3, text: "consisted", lemma: "consist", upos: "VERB", head: 0, deprel: "root", start: 12, end: 21 },
    { id: 4, text: "of", lemma: "of", upos: "ADP", head: 7, deprel: "case", start: 22, end: 24 },
    { id: 5, text: "the", lemma: "the", upos: "DET", head: 7, deprel: "det", start: 25, end: 28 },
    { id: 6, text: "following", lemma: "follow", upos: "VERB", head: 7, deprel: "amod", start: 29, end: 38 },
    { id: 7, text: "steps", lemma: "step", upos: "NOUN", head: 3, deprel: "obl", start: 39, end: 44 },
    { id: 8, text: ":", lemma: ":", upos: "PUNCT", head: 13, deprel: "punct", start: 44, end: 45 },
    { id: 9, text: "(", lemma: "(", upos: "PUNCT", head: 10, deprel: "punct", start: 46, end: 47 },
    { id: 10, text: "1", lemma: "1", upos: "NUM", head: 13, deprel: "discourse", start: 47, end: 48 },
    { id: 11, text: ")", lemma: ")", upos: "PUNCT", head: 10, deprel: "punct", start: 48, end: 49 },
    { id: 12, text: "data", lemma: "datum", upos: "NOUN", head: 13, deprel: "compound", start: 50, end: 54 },
    { id: 13, text: "collection", lemma: "collection", upos: "NOUN", head: 7, deprel: "appos", start: 55, end: 65 },
    { id: 14, text: ";", lemma: ";", upos: "PUNCT", head: 19, deprel: "punct", start: 65, end: 66 },
    { id: 15, text: "(", lemma: "(", upos: "PUNCT", head: 16, deprel: "punct", start: 67, end: 68 },
    { id: 16, text: "2", lemma: "2", upos: "NUM", head: 19, deprel: "discourse", start: 68, end: 69 },
    { id: 17, text: ")", lemma: ")", upos: "PUNCT", head: 16, deprel: "punct", start: 69, end: 70 },
    { id: 18, text: "feature", lemma: "feature", upos: "NOUN", head: 19, deprel: "compound", start: 71, end: 78 },
    { id: 19, text: "extraction", lemma: "extraction", upos: "NOUN", head: 13, deprel: "conj", start: 79, end: 89 },
    { id: 20, text: ";", lemma: ";", upos: "PUNCT", head: 26, deprel: "punct", start: 89, end: 90 },
    { id: 21, text: "and", lemma: "and", upos: "CCONJ", head: 26, deprel: "cc", start: 91, end: 94 },
    { id: 22, text: "(", lemma: "(", upos: "PUNCT", head: 23, deprel: "punct", start: 95, end: 96 },
    { id: 23, text: "3", lemma: "3", upos: "NUM", head: 26, deprel: "discourse", start: 96, end: 97 },
    { id: 24, text: ")", lemma: ")", upos: "PUNCT", head: 23, deprel: "punct", start: 97, end: 98 },
    { id: 25, text: "model", lemma: "model", upos: "NOUN", head: 26, deprel: "compound", start: 99, end: 104 },
    { id: 26, text: "evaluation", lemma: "evaluation", upos: "NOUN", head: 13, deprel: "conj", start: 105, end: 115 },
    { id: 27, text: ".", lemma: ".", upos: "PUNCT", head: 3, deprel: "punct", start: 115, end: 116 },
]

describe('Prototype 2.6G2.8E2.1 synthetic 14A -- 3 nominal peers', () => {
  it('produces 3 ordered nominal members, no leakage/overlap', () => {
    const tree = buildStanzaHierarchicalTree(synthAText, synthATokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(3)
    assertNoLeakageOrOverlap(members)
    expect(members[0]!.text).toBe('(1) data collection')
    expect(members[1]!.text).toBe('(2) feature extraction')
    expect(members[2]!.text).toBe('(3) model evaluation')
  })
})

const synthBText = "The procedure included the following steps: (1) data collection as described above; (2) model training based on the selected samples; and (3) evaluation."
const synthBTokens: StanzaToken[] = [
    { id: 1, text: "The", lemma: "the", upos: "DET", head: 2, deprel: "det", start: 0, end: 3 },
    { id: 2, text: "procedure", lemma: "procedure", upos: "NOUN", head: 3, deprel: "nsubj", start: 4, end: 13 },
    { id: 3, text: "included", lemma: "include", upos: "VERB", head: 0, deprel: "root", start: 14, end: 22 },
    { id: 4, text: "the", lemma: "the", upos: "DET", head: 6, deprel: "det", start: 23, end: 26 },
    { id: 5, text: "following", lemma: "follow", upos: "VERB", head: 6, deprel: "amod", start: 27, end: 36 },
    { id: 6, text: "steps", lemma: "step", upos: "NOUN", head: 3, deprel: "obj", start: 37, end: 42 },
    { id: 7, text: ":", lemma: ":", upos: "PUNCT", head: 12, deprel: "punct", start: 42, end: 43 },
    { id: 8, text: "(", lemma: "(", upos: "PUNCT", head: 9, deprel: "punct", start: 44, end: 45 },
    { id: 9, text: "1", lemma: "1", upos: "NUM", head: 12, deprel: "discourse", start: 45, end: 46 },
    { id: 10, text: ")", lemma: ")", upos: "PUNCT", head: 9, deprel: "punct", start: 46, end: 47 },
    { id: 11, text: "data", lemma: "datum", upos: "NOUN", head: 12, deprel: "compound", start: 48, end: 52 },
    { id: 12, text: "collection", lemma: "collection", upos: "NOUN", head: 6, deprel: "appos", start: 53, end: 63 },
    { id: 13, text: "as", lemma: "as", upos: "SCONJ", head: 14, deprel: "mark", start: 64, end: 66 },
    { id: 14, text: "described", lemma: "describe", upos: "VERB", head: 12, deprel: "acl", start: 67, end: 76 },
    { id: 15, text: "above", lemma: "above", upos: "ADV", head: 14, deprel: "advmod", start: 77, end: 82 },
    { id: 16, text: ";", lemma: ";", upos: "PUNCT", head: 21, deprel: "punct", start: 82, end: 83 },
    { id: 17, text: "(", lemma: "(", upos: "PUNCT", head: 18, deprel: "punct", start: 84, end: 85 },
    { id: 18, text: "2", lemma: "2", upos: "NUM", head: 21, deprel: "discourse", start: 85, end: 86 },
    { id: 19, text: ")", lemma: ")", upos: "PUNCT", head: 18, deprel: "punct", start: 86, end: 87 },
    { id: 20, text: "model", lemma: "model", upos: "NOUN", head: 21, deprel: "compound", start: 88, end: 93 },
    { id: 21, text: "training", lemma: "training", upos: "NOUN", head: 14, deprel: "obj", start: 94, end: 102 },
    { id: 22, text: "based", lemma: "base", upos: "VERB", head: 21, deprel: "acl", start: 103, end: 108 },
    { id: 23, text: "on", lemma: "on", upos: "ADP", head: 26, deprel: "case", start: 109, end: 111 },
    { id: 24, text: "the", lemma: "the", upos: "DET", head: 26, deprel: "det", start: 112, end: 115 },
    { id: 25, text: "selected", lemma: "select", upos: "VERB", head: 26, deprel: "amod", start: 116, end: 124 },
    { id: 26, text: "samples", lemma: "sample", upos: "NOUN", head: 22, deprel: "obl", start: 125, end: 132 },
    { id: 27, text: ";", lemma: ";", upos: "PUNCT", head: 28, deprel: "punct", start: 132, end: 133 },
    { id: 28, text: "and", lemma: "and", upos: "CCONJ", head: 32, deprel: "cc", start: 134, end: 137 },
    { id: 29, text: "(", lemma: "(", upos: "PUNCT", head: 30, deprel: "punct", start: 138, end: 139 },
    { id: 30, text: "3", lemma: "3", upos: "NUM", head: 32, deprel: "discourse", start: 139, end: 140 },
    { id: 31, text: ")", lemma: ")", upos: "PUNCT", head: 30, deprel: "punct", start: 140, end: 141 },
    { id: 32, text: "evaluation", lemma: "evaluation", upos: "NOUN", head: 21, deprel: "conj", start: 142, end: 152 },
    { id: 33, text: ".", lemma: ".", upos: "PUNCT", head: 3, deprel: "punct", start: 152, end: 153 },
]

describe('Prototype 2.6G2.8E2.1 synthetic 14B -- nominal identity preserved, described/based stay modifiers', () => {
  it('produces 3 ordered members with full nominal identity retained', () => {
    const tree = buildStanzaHierarchicalTree(synthBText, synthBTokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(3)
    assertNoLeakageOrOverlap(members)
    expect(members[0]!.text).toBe('(1) data collection as described above')
    expect(members[1]!.text).toBe('(2) model training based on the selected samples')
    expect(members[2]!.text).toBe('(3) evaluation')
  })
})

const synthCText = "The procedure consisted of the following steps: (1) collecting data; (2) removing outliers; and (3) training the model."
const synthCTokens: StanzaToken[] = [
    { id: 1, text: "The", lemma: "the", upos: "DET", head: 2, deprel: "det", start: 0, end: 3 },
    { id: 2, text: "procedure", lemma: "procedure", upos: "NOUN", head: 3, deprel: "nsubj", start: 4, end: 13 },
    { id: 3, text: "consisted", lemma: "consist", upos: "VERB", head: 0, deprel: "root", start: 14, end: 23 },
    { id: 4, text: "of", lemma: "of", upos: "ADP", head: 7, deprel: "case", start: 24, end: 26 },
    { id: 5, text: "the", lemma: "the", upos: "DET", head: 7, deprel: "det", start: 27, end: 30 },
    { id: 6, text: "following", lemma: "follow", upos: "VERB", head: 7, deprel: "amod", start: 31, end: 40 },
    { id: 7, text: "steps", lemma: "step", upos: "NOUN", head: 3, deprel: "obl", start: 41, end: 46 },
    { id: 8, text: ":", lemma: ":", upos: "PUNCT", head: 12, deprel: "punct", start: 46, end: 47 },
    { id: 9, text: "(", lemma: "(", upos: "PUNCT", head: 10, deprel: "punct", start: 48, end: 49 },
    { id: 10, text: "1", lemma: "1", upos: "NUM", head: 12, deprel: "discourse", start: 49, end: 50 },
    { id: 11, text: ")", lemma: ")", upos: "PUNCT", head: 10, deprel: "punct", start: 50, end: 51 },
    { id: 12, text: "collecting", lemma: "collect", upos: "VERB", head: 7, deprel: "acl", start: 52, end: 62 },
    { id: 13, text: "data", lemma: "datum", upos: "NOUN", head: 12, deprel: "obj", start: 63, end: 67 },
    { id: 14, text: ";", lemma: ";", upos: "PUNCT", head: 18, deprel: "punct", start: 67, end: 68 },
    { id: 15, text: "(", lemma: "(", upos: "PUNCT", head: 16, deprel: "punct", start: 69, end: 70 },
    { id: 16, text: "2", lemma: "2", upos: "NUM", head: 18, deprel: "discourse", start: 70, end: 71 },
    { id: 17, text: ")", lemma: ")", upos: "PUNCT", head: 16, deprel: "punct", start: 71, end: 72 },
    { id: 18, text: "removing", lemma: "remove", upos: "VERB", head: 12, deprel: "conj", start: 73, end: 81 },
    { id: 19, text: "outliers", lemma: "outlier", upos: "NOUN", head: 18, deprel: "obj", start: 82, end: 90 },
    { id: 20, text: ";", lemma: ";", upos: "PUNCT", head: 21, deprel: "punct", start: 90, end: 91 },
    { id: 21, text: "and", lemma: "and", upos: "CCONJ", head: 25, deprel: "cc", start: 92, end: 95 },
    { id: 22, text: "(", lemma: "(", upos: "PUNCT", head: 23, deprel: "punct", start: 96, end: 97 },
    { id: 23, text: "3", lemma: "3", upos: "NUM", head: 25, deprel: "discourse", start: 97, end: 98 },
    { id: 24, text: ")", lemma: ")", upos: "PUNCT", head: 23, deprel: "punct", start: 98, end: 99 },
    { id: 25, text: "training", lemma: "training", upos: "NOUN", head: 12, deprel: "conj", start: 100, end: 108 },
    { id: 26, text: "the", lemma: "the", upos: "DET", head: 27, deprel: "det", start: 109, end: 112 },
    { id: 27, text: "model", lemma: "model", upos: "NOUN", head: 25, deprel: "obj", start: 113, end: 118 },
    { id: 28, text: ".", lemma: ".", upos: "PUNCT", head: 3, deprel: "punct", start: 118, end: 119 },
]

describe('Prototype 2.6G2.8E2.1 synthetic 14C -- 3 gerund/nonfinite peers', () => {
  it('produces 3 ordered members with visible gerund heads, no duplicate postmodifier', () => {
    const tree = buildStanzaHierarchicalTree(synthCText, synthCTokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(3)
    assertNoLeakageOrOverlap(members)
    const heads = members.map((m) => flatten(m.children).find((n) => n.role === 'predicate')?.text)
    expect(heads[0]).toBe('collecting')
    expect(heads[1]).toBe('removing')
    expect(flatten(tree).filter((n) => n.role === 'postmodifier' && n.text.includes('collecting'))).toHaveLength(0)
  })
})

const synthDText = "The workflow included the following steps: (1) collection and preprocessing; (2) training and testing; and (3) evaluation and comparison."
const synthDTokens: StanzaToken[] = [
    { id: 1, text: "The", lemma: "the", upos: "DET", head: 2, deprel: "det", start: 0, end: 3 },
    { id: 2, text: "workflow", lemma: "workflow", upos: "NOUN", head: 3, deprel: "nsubj", start: 4, end: 12 },
    { id: 3, text: "included", lemma: "include", upos: "VERB", head: 0, deprel: "root", start: 13, end: 21 },
    { id: 4, text: "the", lemma: "the", upos: "DET", head: 6, deprel: "det", start: 22, end: 25 },
    { id: 5, text: "following", lemma: "follow", upos: "VERB", head: 6, deprel: "amod", start: 26, end: 35 },
    { id: 6, text: "steps", lemma: "step", upos: "NOUN", head: 3, deprel: "obj", start: 36, end: 41 },
    { id: 7, text: ":", lemma: ":", upos: "PUNCT", head: 11, deprel: "punct", start: 41, end: 42 },
    { id: 8, text: "(", lemma: "(", upos: "PUNCT", head: 9, deprel: "punct", start: 43, end: 44 },
    { id: 9, text: "1", lemma: "1", upos: "NUM", head: 11, deprel: "discourse", start: 44, end: 45 },
    { id: 10, text: ")", lemma: ")", upos: "PUNCT", head: 9, deprel: "punct", start: 45, end: 46 },
    { id: 11, text: "collection", lemma: "collection", upos: "NOUN", head: 6, deprel: "appos", start: 47, end: 57 },
    { id: 12, text: "and", lemma: "and", upos: "CCONJ", head: 13, deprel: "cc", start: 58, end: 61 },
    { id: 13, text: "preprocessing", lemma: "preprocessing", upos: "NOUN", head: 11, deprel: "conj", start: 62, end: 75 },
    { id: 14, text: ";", lemma: ";", upos: "PUNCT", head: 18, deprel: "punct", start: 75, end: 76 },
    { id: 15, text: "(", lemma: "(", upos: "PUNCT", head: 16, deprel: "punct", start: 77, end: 78 },
    { id: 16, text: "2", lemma: "2", upos: "NUM", head: 18, deprel: "discourse", start: 78, end: 79 },
    { id: 17, text: ")", lemma: ")", upos: "PUNCT", head: 16, deprel: "punct", start: 79, end: 80 },
    { id: 18, text: "training", lemma: "training", upos: "NOUN", head: 11, deprel: "conj", start: 81, end: 89 },
    { id: 19, text: "and", lemma: "and", upos: "CCONJ", head: 20, deprel: "cc", start: 90, end: 93 },
    { id: 20, text: "testing", lemma: "testing", upos: "NOUN", head: 18, deprel: "conj", start: 94, end: 101 },
    { id: 21, text: ";", lemma: ";", upos: "PUNCT", head: 22, deprel: "punct", start: 101, end: 102 },
    { id: 22, text: "and", lemma: "and", upos: "CCONJ", head: 26, deprel: "cc", start: 103, end: 106 },
    { id: 23, text: "(", lemma: "(", upos: "PUNCT", head: 24, deprel: "punct", start: 107, end: 108 },
    { id: 24, text: "3", lemma: "3", upos: "NUM", head: 26, deprel: "discourse", start: 108, end: 109 },
    { id: 25, text: ")", lemma: ")", upos: "PUNCT", head: 24, deprel: "punct", start: 109, end: 110 },
    { id: 26, text: "evaluation", lemma: "evaluation", upos: "NOUN", head: 18, deprel: "conj", start: 111, end: 121 },
    { id: 27, text: "and", lemma: "and", upos: "CCONJ", head: 28, deprel: "cc", start: 122, end: 125 },
    { id: 28, text: "comparison", lemma: "comparison", upos: "NOUN", head: 26, deprel: "conj", start: 126, end: 136 },
    { id: 29, text: ".", lemma: ".", upos: "PUNCT", head: 3, deprel: "punct", start: 136, end: 137 },
]

describe('Prototype 2.6G2.8E2.1 synthetic 14D -- 3 outer peers, internal coordination preserved', () => {
  it('produces 3 members; "collection and preprocessing" etc. stay flat internal coordination, not further split', () => {
    const tree = buildStanzaHierarchicalTree(synthDText, synthDTokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(3)
    assertNoLeakageOrOverlap(members)
    expect(members[0]!.text).toBe('(1) collection and preprocessing')
    expect(members[1]!.text).toBe('(2) training and testing')
    expect(members[2]!.text).toBe('(3) evaluation and comparison')
  })
})

const synthEText = "The procedure included the following steps: (1) collect the samples; (2) data preprocessing; (3) fitting the model; and (4) model evaluation."
const synthETokens: StanzaToken[] = [
    { id: 1, text: "The", lemma: "the", upos: "DET", head: 2, deprel: "det", start: 0, end: 3 },
    { id: 2, text: "procedure", lemma: "procedure", upos: "NOUN", head: 3, deprel: "nsubj", start: 4, end: 13 },
    { id: 3, text: "included", lemma: "include", upos: "VERB", head: 0, deprel: "root", start: 14, end: 22 },
    { id: 4, text: "the", lemma: "the", upos: "DET", head: 6, deprel: "det", start: 23, end: 26 },
    { id: 5, text: "following", lemma: "follow", upos: "VERB", head: 6, deprel: "amod", start: 27, end: 36 },
    { id: 6, text: "steps", lemma: "step", upos: "NOUN", head: 3, deprel: "obj", start: 37, end: 42 },
    { id: 7, text: ":", lemma: ":", upos: "PUNCT", head: 11, deprel: "punct", start: 42, end: 43 },
    { id: 8, text: "(", lemma: "(", upos: "PUNCT", head: 9, deprel: "punct", start: 44, end: 45 },
    { id: 9, text: "1", lemma: "1", upos: "NUM", head: 11, deprel: "discourse", start: 45, end: 46 },
    { id: 10, text: ")", lemma: ")", upos: "PUNCT", head: 9, deprel: "punct", start: 46, end: 47 },
    { id: 11, text: "collect", lemma: "collect", upos: "VERB", head: 6, deprel: "appos", start: 48, end: 55 },
    { id: 12, text: "the", lemma: "the", upos: "DET", head: 13, deprel: "det", start: 56, end: 59 },
    { id: 13, text: "samples", lemma: "sample", upos: "NOUN", head: 11, deprel: "obj", start: 60, end: 67 },
    { id: 14, text: ";", lemma: ";", upos: "PUNCT", head: 19, deprel: "punct", start: 67, end: 68 },
    { id: 15, text: "(", lemma: "(", upos: "PUNCT", head: 16, deprel: "punct", start: 69, end: 70 },
    { id: 16, text: "2", lemma: "2", upos: "NUM", head: 19, deprel: "discourse", start: 70, end: 71 },
    { id: 17, text: ")", lemma: ")", upos: "PUNCT", head: 16, deprel: "punct", start: 71, end: 72 },
    { id: 18, text: "data", lemma: "datum", upos: "NOUN", head: 19, deprel: "compound", start: 73, end: 77 },
    { id: 19, text: "preprocessing", lemma: "preprocessing", upos: "NOUN", head: 13, deprel: "conj", start: 78, end: 91 },
    { id: 20, text: ";", lemma: ";", upos: "PUNCT", head: 24, deprel: "punct", start: 91, end: 92 },
    { id: 21, text: "(", lemma: "(", upos: "PUNCT", head: 22, deprel: "punct", start: 93, end: 94 },
    { id: 22, text: "3", lemma: "3", upos: "NUM", head: 24, deprel: "discourse", start: 94, end: 95 },
    { id: 23, text: ")", lemma: ")", upos: "PUNCT", head: 22, deprel: "punct", start: 95, end: 96 },
    { id: 24, text: "fitting", lemma: "fit", upos: "VERB", head: 19, deprel: "acl", start: 97, end: 104 },
    { id: 25, text: "the", lemma: "the", upos: "DET", head: 26, deprel: "det", start: 105, end: 108 },
    { id: 26, text: "model", lemma: "model", upos: "NOUN", head: 24, deprel: "obj", start: 109, end: 114 },
    { id: 27, text: ";", lemma: ";", upos: "PUNCT", head: 28, deprel: "punct", start: 114, end: 115 },
    { id: 28, text: "and", lemma: "and", upos: "CCONJ", head: 33, deprel: "cc", start: 116, end: 119 },
    { id: 29, text: "(", lemma: "(", upos: "PUNCT", head: 30, deprel: "punct", start: 120, end: 121 },
    { id: 30, text: "4", lemma: "4", upos: "NUM", head: 33, deprel: "discourse", start: 121, end: 122 },
    { id: 31, text: ")", lemma: ")", upos: "PUNCT", head: 30, deprel: "punct", start: 122, end: 123 },
    { id: 32, text: "model", lemma: "model", upos: "NOUN", head: 33, deprel: "compound", start: 124, end: 129 },
    { id: 33, text: "evaluation", lemma: "evaluation", upos: "NOUN", head: 19, deprel: "conj", start: 130, end: 140 },
    { id: 34, text: ".", lemma: ".", upos: "PUNCT", head: 3, deprel: "punct", start: 140, end: 141 },
]

describe('Prototype 2.6G2.8E2.1 synthetic 14E -- mixed predicate/nominal/gerund/nominal peers', () => {
  it('produces 4 members of mixed kind with correct identity each', () => {
    const tree = buildStanzaHierarchicalTree(synthEText, synthETokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(4)
    assertNoLeakageOrOverlap(members)
    expect(members[0]!.text).toBe('(1) collect the samples')
    expect(members[1]!.text).toBe('(2) data preprocessing')
    expect(members[2]!.text).toBe('(3) fitting the model')
    expect(members[3]!.text).toBe('(4) model evaluation')
  })
})

const synthFText = "The procedure consisted of the following steps: (1) the data are filtered using method A, and the results are evaluated using method B; (2) model training."
const synthFTokens: StanzaToken[] = [
    { id: 1, text: "The", lemma: "the", upos: "DET", head: 2, deprel: "det", start: 0, end: 3 },
    { id: 2, text: "procedure", lemma: "procedure", upos: "NOUN", head: 3, deprel: "nsubj", start: 4, end: 13 },
    { id: 3, text: "consisted", lemma: "consist", upos: "VERB", head: 0, deprel: "root", start: 14, end: 23 },
    { id: 4, text: "of", lemma: "of", upos: "ADP", head: 7, deprel: "case", start: 24, end: 26 },
    { id: 5, text: "the", lemma: "the", upos: "DET", head: 7, deprel: "det", start: 27, end: 30 },
    { id: 6, text: "following", lemma: "follow", upos: "VERB", head: 7, deprel: "amod", start: 31, end: 40 },
    { id: 7, text: "steps", lemma: "step", upos: "NOUN", head: 3, deprel: "obl", start: 41, end: 46 },
    { id: 8, text: ":", lemma: ":", upos: "PUNCT", head: 15, deprel: "punct", start: 46, end: 47 },
    { id: 9, text: "(", lemma: "(", upos: "PUNCT", head: 10, deprel: "punct", start: 48, end: 49 },
    { id: 10, text: "1", lemma: "1", upos: "NUM", head: 15, deprel: "discourse", start: 49, end: 50 },
    { id: 11, text: ")", lemma: ")", upos: "PUNCT", head: 10, deprel: "punct", start: 50, end: 51 },
    { id: 12, text: "the", lemma: "the", upos: "DET", head: 13, deprel: "det", start: 52, end: 55 },
    { id: 13, text: "data", lemma: "datum", upos: "NOUN", head: 15, deprel: "nsubj:pass", start: 56, end: 60 },
    { id: 14, text: "are", lemma: "be", upos: "AUX", head: 15, deprel: "aux:pass", start: 61, end: 64 },
    { id: 15, text: "filtered", lemma: "filter", upos: "VERB", head: 3, deprel: "parataxis", start: 65, end: 73 },
    { id: 16, text: "using", lemma: "use", upos: "VERB", head: 15, deprel: "advcl", start: 74, end: 79 },
    { id: 17, text: "method", lemma: "method", upos: "NOUN", head: 16, deprel: "obj", start: 80, end: 86 },
    { id: 18, text: "A", lemma: "A", upos: "NOUN", head: 17, deprel: "flat", start: 87, end: 88 },
    { id: 19, text: ",", lemma: ",", upos: "PUNCT", head: 24, deprel: "punct", start: 88, end: 89 },
    { id: 20, text: "and", lemma: "and", upos: "CCONJ", head: 24, deprel: "cc", start: 90, end: 93 },
    { id: 21, text: "the", lemma: "the", upos: "DET", head: 22, deprel: "det", start: 94, end: 97 },
    { id: 22, text: "results", lemma: "result", upos: "NOUN", head: 24, deprel: "nsubj:pass", start: 98, end: 105 },
    { id: 23, text: "are", lemma: "be", upos: "AUX", head: 24, deprel: "aux:pass", start: 106, end: 109 },
    { id: 24, text: "evaluated", lemma: "evaluate", upos: "VERB", head: 15, deprel: "conj", start: 110, end: 119 },
    { id: 25, text: "using", lemma: "use", upos: "VERB", head: 24, deprel: "advcl", start: 120, end: 125 },
    { id: 26, text: "method", lemma: "method", upos: "NOUN", head: 25, deprel: "obj", start: 126, end: 132 },
    { id: 27, text: "B", lemma: "B", upos: "NOUN", head: 26, deprel: "flat", start: 133, end: 134 },
    { id: 28, text: ";", lemma: ";", upos: "PUNCT", head: 33, deprel: "punct", start: 134, end: 135 },
    { id: 29, text: "(", lemma: "(", upos: "PUNCT", head: 30, deprel: "punct", start: 136, end: 137 },
    { id: 30, text: "2", lemma: "2", upos: "NUM", head: 33, deprel: "discourse", start: 137, end: 138 },
    { id: 31, text: ")", lemma: ")", upos: "PUNCT", head: 30, deprel: "punct", start: 138, end: 139 },
    { id: 32, text: "model", lemma: "model", upos: "NOUN", head: 33, deprel: "compound", start: 140, end: 145 },
    { id: 33, text: "training", lemma: "training", upos: "NOUN", head: 26, deprel: "appos", start: 146, end: 154 },
    { id: 34, text: ".", lemma: ".", upos: "PUNCT", head: 3, deprel: "punct", start: 154, end: 155 },
]

describe('Prototype 2.6G2.8E2.1 synthetic 14F -- two internal clauses, each "using" occurs once', () => {
  it('member 1 has two clauses, each with its own non-duplicated "using" modifier', () => {
    const tree = buildStanzaHierarchicalTree(synthFText, synthFTokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(2)
    const flat1 = flatten(members[0]!.children)
    const usingLeaves = flat1.filter((n) => n.children.length === 0 && n.text.startsWith('using'))
    expect(usingLeaves).toHaveLength(2)
    expect(usingLeaves.map((n) => n.text)).toEqual(['using method A', 'using method B'])
    assertNoLeafOverlap(members[0]!)
  })
})

const synthGText = "The procedure consisted of the following steps: (1) the model is trained by minimizing the loss using Adam, and the output is validated using a held-out test set; (2) evaluation."
const synthGTokens: StanzaToken[] = [
    { id: 1, text: "The", lemma: "the", upos: "DET", head: 2, deprel: "det", start: 0, end: 3 },
    { id: 2, text: "procedure", lemma: "procedure", upos: "NOUN", head: 3, deprel: "nsubj", start: 4, end: 13 },
    { id: 3, text: "consisted", lemma: "consist", upos: "VERB", head: 0, deprel: "root", start: 14, end: 23 },
    { id: 4, text: "of", lemma: "of", upos: "ADP", head: 7, deprel: "case", start: 24, end: 26 },
    { id: 5, text: "the", lemma: "the", upos: "DET", head: 7, deprel: "det", start: 27, end: 30 },
    { id: 6, text: "following", lemma: "follow", upos: "VERB", head: 7, deprel: "amod", start: 31, end: 40 },
    { id: 7, text: "steps", lemma: "step", upos: "NOUN", head: 3, deprel: "obl", start: 41, end: 46 },
    { id: 8, text: ":", lemma: ":", upos: "PUNCT", head: 15, deprel: "punct", start: 46, end: 47 },
    { id: 9, text: "(", lemma: "(", upos: "PUNCT", head: 10, deprel: "punct", start: 48, end: 49 },
    { id: 10, text: "1", lemma: "1", upos: "NUM", head: 15, deprel: "discourse", start: 49, end: 50 },
    { id: 11, text: ")", lemma: ")", upos: "PUNCT", head: 10, deprel: "punct", start: 50, end: 51 },
    { id: 12, text: "the", lemma: "the", upos: "DET", head: 13, deprel: "det", start: 52, end: 55 },
    { id: 13, text: "model", lemma: "model", upos: "NOUN", head: 15, deprel: "nsubj:pass", start: 56, end: 61 },
    { id: 14, text: "is", lemma: "be", upos: "AUX", head: 15, deprel: "aux:pass", start: 62, end: 64 },
    { id: 15, text: "trained", lemma: "train", upos: "VERB", head: 3, deprel: "parataxis", start: 65, end: 72 },
    { id: 16, text: "by", lemma: "by", upos: "SCONJ", head: 17, deprel: "mark", start: 73, end: 75 },
    { id: 17, text: "minimizing", lemma: "minimize", upos: "VERB", head: 15, deprel: "advcl", start: 76, end: 86 },
    { id: 18, text: "the", lemma: "the", upos: "DET", head: 19, deprel: "det", start: 87, end: 90 },
    { id: 19, text: "loss", lemma: "loss", upos: "NOUN", head: 17, deprel: "obj", start: 91, end: 95 },
    { id: 20, text: "using", lemma: "use", upos: "VERB", head: 19, deprel: "acl", start: 96, end: 101 },
    { id: 21, text: "Adam", lemma: "Adam", upos: "PROPN", head: 20, deprel: "obj", start: 102, end: 106 },
    { id: 22, text: ",", lemma: ",", upos: "PUNCT", head: 27, deprel: "punct", start: 106, end: 107 },
    { id: 23, text: "and", lemma: "and", upos: "CCONJ", head: 27, deprel: "cc", start: 108, end: 111 },
    { id: 24, text: "the", lemma: "the", upos: "DET", head: 25, deprel: "det", start: 112, end: 115 },
    { id: 25, text: "output", lemma: "output", upos: "NOUN", head: 27, deprel: "nsubj:pass", start: 116, end: 122 },
    { id: 26, text: "is", lemma: "be", upos: "AUX", head: 27, deprel: "aux:pass", start: 123, end: 125 },
    { id: 27, text: "validated", lemma: "validate", upos: "VERB", head: 15, deprel: "conj", start: 126, end: 135 },
    { id: 28, text: "using", lemma: "use", upos: "VERB", head: 27, deprel: "advcl", start: 136, end: 141 },
    { id: 29, text: "a", lemma: "a", upos: "DET", head: 34, deprel: "det", start: 142, end: 143 },
    { id: 30, text: "held", lemma: "hold", upos: "VERB", head: 32, deprel: "amod", start: 144, end: 148 },
    { id: 31, text: "-", lemma: "-", upos: "PUNCT", head: 30, deprel: "punct", start: 148, end: 149 },
    { id: 32, text: "out", lemma: "out", upos: "NOUN", head: 34, deprel: "compound", start: 149, end: 152 },
    { id: 33, text: "test", lemma: "test", upos: "NOUN", head: 34, deprel: "compound", start: 153, end: 157 },
    { id: 34, text: "set", lemma: "set", upos: "NOUN", head: 28, deprel: "obj", start: 158, end: 161 },
    { id: 35, text: ";", lemma: ";", upos: "PUNCT", head: 39, deprel: "punct", start: 161, end: 162 },
    { id: 36, text: "(", lemma: "(", upos: "PUNCT", head: 37, deprel: "punct", start: 163, end: 164 },
    { id: 37, text: "2", lemma: "2", upos: "NUM", head: 39, deprel: "discourse", start: 164, end: 165 },
    { id: 38, text: ")", lemma: ")", upos: "PUNCT", head: 37, deprel: "punct", start: 165, end: 166 },
    { id: 39, text: "evaluation", lemma: "evaluation", upos: "NOUN", head: 34, deprel: "appos", start: 167, end: 177 },
    { id: 40, text: ".", lemma: ".", upos: "PUNCT", head: 3, deprel: "punct", start: 177, end: 178 },
]

describe('Prototype 2.6G2.8E2.1 synthetic 14G -- no duplicate by/using modifier', () => {
  it('member 1 has two clauses, "by minimizing..." and "using..." each appear exactly once', () => {
    const tree = buildStanzaHierarchicalTree(synthGText, synthGTokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(2)
    const flat1 = flatten(members[0]!.children)
    const byLeaves = flat1.filter((n) => n.children.length === 0 && n.text.includes('minimizing the loss using Adam'))
    const usingLeaves = flat1.filter((n) => n.children.length === 0 && n.text.startsWith('using a held-out test set'))
    expect(byLeaves).toHaveLength(1)
    expect(usingLeaves).toHaveLength(1)
    assertNoLeafOverlap(members[0]!)
  })
})

// Prototype 2.6G2.8E2.1 -- ORIGINAL 14G WORDING, KEPT AS A DIAGNOSTIC (NON-GATING) RECORD.
// The phase spec's own 14G wording ("... using cross-validation; (2) evaluation.") triggers an
// UNRELATED real Stanza parser artifact, not an ownership defect: Stanza tags "cross-validation"
// as a `compound` premodifier of "evaluation" -- member 2's OWN head token, positions 164-174,
// deprel='compound', head=34 (raw-captured below) -- rather than as the object of "using"(28).
// "using"'s own object then resolves (via the SAME raw mis-tag) to "evaluation" itself, a token
// that belongs to a DIFFERENT numbered member entirely. The member-local boundary clip this
// phase adds (`outOfItemIds` in structureEnumerationItem) correctly refuses to let member 1's
// "using" reach across into member 2's own text -- exactly the leakage/duplication invariant
// this phase exists to enforce -- but it cannot invent "cross-validation" as the object of
// "using" when Stanza's own graph never connects the two tokens at all. The 14G test above uses
// reworded fixture text ("using a held-out test set") specifically so the OWNERSHIP gate can be
// asserted independent of this orthogonal, pre-existing parser limitation. This block preserves
// the original wording and its exact observed misparse for future reference -- do NOT read the
// rewording above as evidence this parser artifact was fixed by E2.1; it was not, and was never
// in scope. Kept `.skip`ped (diagnostic only, never gates CI).
describe.skip('Prototype 2.6G2.8E2.1 synthetic 14G -- ORIGINAL WORDING (diagnostic only, not gating)', () => {
  const synthGOriginalText =
    'The procedure consisted of the following steps: (1) the model is trained by minimizing the loss using Adam, and the output is validated using cross-validation; (2) evaluation.'
  const synthGOriginalTokens: StanzaToken[] = [
    { id: 1, text: 'The', lemma: 'the', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 },
    { id: 2, text: 'procedure', lemma: 'procedure', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 13 },
    { id: 3, text: 'consisted', lemma: 'consist', upos: 'VERB', head: 0, deprel: 'root', start: 14, end: 23 },
    { id: 4, text: 'of', lemma: 'of', upos: 'ADP', head: 7, deprel: 'case', start: 24, end: 26 },
    { id: 5, text: 'the', lemma: 'the', upos: 'DET', head: 7, deprel: 'det', start: 27, end: 30 },
    { id: 6, text: 'following', lemma: 'follow', upos: 'VERB', head: 7, deprel: 'amod', start: 31, end: 40 },
    { id: 7, text: 'steps', lemma: 'step', upos: 'NOUN', head: 3, deprel: 'obl', start: 41, end: 46 },
    { id: 8, text: ':', lemma: ':', upos: 'PUNCT', head: 15, deprel: 'punct', start: 46, end: 47 },
    { id: 9, text: '(', lemma: '(', upos: 'PUNCT', head: 10, deprel: 'punct', start: 48, end: 49 },
    { id: 10, text: '1', lemma: '1', upos: 'NUM', head: 15, deprel: 'discourse', start: 49, end: 50 },
    { id: 11, text: ')', lemma: ')', upos: 'PUNCT', head: 10, deprel: 'punct', start: 50, end: 51 },
    { id: 12, text: 'the', lemma: 'the', upos: 'DET', head: 13, deprel: 'det', start: 52, end: 55 },
    { id: 13, text: 'model', lemma: 'model', upos: 'NOUN', head: 15, deprel: 'nsubj:pass', start: 56, end: 61 },
    { id: 14, text: 'is', lemma: 'be', upos: 'AUX', head: 15, deprel: 'aux:pass', start: 62, end: 64 },
    { id: 15, text: 'trained', lemma: 'train', upos: 'VERB', head: 3, deprel: 'parataxis', start: 65, end: 72 },
    { id: 16, text: 'by', lemma: 'by', upos: 'SCONJ', head: 17, deprel: 'mark', start: 73, end: 75 },
    { id: 17, text: 'minimizing', lemma: 'minimize', upos: 'VERB', head: 15, deprel: 'advcl', start: 76, end: 86 },
    { id: 18, text: 'the', lemma: 'the', upos: 'DET', head: 19, deprel: 'det', start: 87, end: 90 },
    { id: 19, text: 'loss', lemma: 'loss', upos: 'NOUN', head: 17, deprel: 'obj', start: 91, end: 95 },
    { id: 20, text: 'using', lemma: 'use', upos: 'VERB', head: 19, deprel: 'acl', start: 96, end: 101 },
    { id: 21, text: 'Adam', lemma: 'Adam', upos: 'PROPN', head: 20, deprel: 'obj', start: 102, end: 106 },
    { id: 22, text: ',', lemma: ',', upos: 'PUNCT', head: 27, deprel: 'punct', start: 106, end: 107 },
    { id: 23, text: 'and', lemma: 'and', upos: 'CCONJ', head: 27, deprel: 'cc', start: 108, end: 111 },
    { id: 24, text: 'the', lemma: 'the', upos: 'DET', head: 25, deprel: 'det', start: 112, end: 115 },
    { id: 25, text: 'output', lemma: 'output', upos: 'NOUN', head: 27, deprel: 'nsubj:pass', start: 116, end: 122 },
    { id: 26, text: 'is', lemma: 'be', upos: 'AUX', head: 27, deprel: 'aux:pass', start: 123, end: 125 },
    { id: 27, text: 'validated', lemma: 'validate', upos: 'VERB', head: 15, deprel: 'conj', start: 126, end: 135 },
    { id: 28, text: 'using', lemma: 'use', upos: 'VERB', head: 27, deprel: 'advcl', start: 136, end: 141 },
    // Live-observed Stanza misparse: "cross-validation" tags as `compound`, head=34
    // ("evaluation" -- member 2's OWN head, a different numbered member) instead of as the
    // object of "using"(28). This is the exact artifact this diagnostic block preserves.
    { id: 29, text: 'cross-validation', lemma: 'cross-validation', upos: 'NOUN', head: 34, deprel: 'compound', start: 142, end: 158 },
    { id: 30, text: ';', lemma: ';', upos: 'PUNCT', head: 34, deprel: 'punct', start: 158, end: 159 },
    { id: 31, text: '(', lemma: '(', upos: 'PUNCT', head: 32, deprel: 'punct', start: 160, end: 161 },
    { id: 32, text: '2', lemma: '2', upos: 'NUM', head: 34, deprel: 'discourse', start: 161, end: 162 },
    { id: 33, text: ')', lemma: ')', upos: 'PUNCT', head: 32, deprel: 'punct', start: 162, end: 163 },
    { id: 34, text: 'evaluation', lemma: 'evaluation', upos: 'NOUN', head: 28, deprel: 'obj', start: 164, end: 174 },
    { id: 35, text: '.', lemma: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 174, end: 175 },
  ]

  it('DOCUMENTS (does not assert-fix) that "cross-validation" is unrecoverable as using\'s object due to the raw misparse above -- ownership/leakage is still correctly enforced', () => {
    const tree = buildStanzaHierarchicalTree(synthGOriginalText, synthGOriginalTokens)
    const members = findEnumeration(tree).children
    expect(members).toHaveLength(2)
    // The leakage/duplication invariant still holds even under this misparse -- "using" never
    // reaches into member 2's own text, it simply cannot recover "cross-validation" as content.
    assertNoLeafOverlap(members[0]!)
    const flat1 = flatten(members[0]!.children)
    expect(flat1.some((n) => n.text.includes('cross-validation'))).toBe(false)
  })
})
