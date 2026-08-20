import { describe, expect, it } from 'vitest'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import { projectAnalysisSpanToSourceHighlight } from '../../src/features/grammar/domain/sourceSentenceHighlight.ts'
import { projectionFromSource } from '../../src/features/grammar/domain/textProjection.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.8E2.2 TRACK A -- Coordinated Shared Arguments. When two (or more) coordinated
 * predicates of the SAME clause are built inside one enumeration member and Stanza's raw graph
 * attaches a shared object/complement to only ONE conjunct (a well-documented UD coordination-
 * ellipsis pattern -- "constraining and training the KNN-GCN model"), the argument is hoisted
 * out of that one predicate's own children and re-parented as a sibling of the whole coordinated
 * predicate group -- never duplicated, never left implying exclusive single-conjunct ownership.
 * Fixtures captured verbatim from a real Stanza parse.
 */

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

function findEnumeration(nodes: StructureTreeNode[]): StructureTreeNode {
  const enumeration = flatten(nodes).find((n) => n.role === 'enumeration')
  if (!enumeration) throw new Error('no enumeration node found')
  return enumeration
}

const trackAPos1Text = "The procedure consisted of the following steps: (1) filter the samples; (2) collecting and analyzing the data; (3) reporting."
const trackAPos1Tokens: StanzaToken[] = [
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
    { id: 12, text: "filter", lemma: "filter", upos: "VERB", head: 7, deprel: "appos", start: 52, end: 58 },
    { id: 13, text: "the", lemma: "the", upos: "DET", head: 14, deprel: "det", start: 59, end: 62 },
    { id: 14, text: "samples", lemma: "sample", upos: "NOUN", head: 12, deprel: "obj", start: 63, end: 70 },
    { id: 15, text: ";", lemma: ";", upos: "PUNCT", head: 19, deprel: "punct", start: 70, end: 71 },
    { id: 16, text: "(", lemma: "(", upos: "PUNCT", head: 17, deprel: "punct", start: 72, end: 73 },
    { id: 17, text: "2", lemma: "2", upos: "NUM", head: 19, deprel: "discourse", start: 73, end: 74 },
    { id: 18, text: ")", lemma: ")", upos: "PUNCT", head: 17, deprel: "punct", start: 74, end: 75 },
    { id: 19, text: "collecting", lemma: "collect", upos: "VERB", head: 12, deprel: "conj", start: 76, end: 86 },
    { id: 20, text: "and", lemma: "and", upos: "CCONJ", head: 21, deprel: "cc", start: 87, end: 90 },
    { id: 21, text: "analyzing", lemma: "analyze", upos: "VERB", head: 19, deprel: "conj", start: 91, end: 100 },
    { id: 22, text: "the", lemma: "the", upos: "DET", head: 23, deprel: "det", start: 101, end: 104 },
    { id: 23, text: "data", lemma: "datum", upos: "NOUN", head: 19, deprel: "obj", start: 105, end: 109 },
    { id: 24, text: ";", lemma: ";", upos: "PUNCT", head: 28, deprel: "punct", start: 109, end: 110 },
    { id: 25, text: "(", lemma: "(", upos: "PUNCT", head: 26, deprel: "punct", start: 111, end: 112 },
    { id: 26, text: "3", lemma: "3", upos: "NUM", head: 28, deprel: "discourse", start: 112, end: 113 },
    { id: 27, text: ")", lemma: ")", upos: "PUNCT", head: 26, deprel: "punct", start: 113, end: 114 },
    { id: 28, text: "reporting", lemma: "reporting", upos: "NOUN", head: 19, deprel: "conj", start: 115, end: 124 },
    { id: 29, text: ".", lemma: ".", upos: "PUNCT", head: 3, deprel: "punct", start: 124, end: 125 },
]

describe('Prototype 2.6G2.8E2.2 TRACK A positive -- "collecting and analyzing the data"', () => {
  it('hoists the shared object to the coordinated-predicate-group level, not nested under either conjunct', () => {
    const tree = buildStanzaHierarchicalTree(trackAPos1Text, trackAPos1Tokens)
    const members = findEnumeration(tree).children
    const member = members.find((m) => m.text.includes('collecting'))!
    expect(member.children.some((c) => c.role === 'predicate' && c.text === 'collecting')).toBe(true)
    expect(member.children.some((c) => c.role === 'coordinatedPredicate' && c.text === 'analyzing')).toBe(true)
    const objectSibling = member.children.find((c) => c.role === 'object')
    expect(objectSibling?.text).toBe('the data')
    // Never ALSO nested under either predicate -- rendered exactly once.
    const predicateNode = member.children.find((c) => c.role === 'predicate')!
    const coordNode = member.children.find((c) => c.role === 'coordinatedPredicate')!
    expect(predicateNode.children.some((c) => c.role === 'object')).toBe(false)
    expect(coordNode.children.some((c) => c.role === 'object')).toBe(false)
  })
})

const trackAPos3Text = "The procedure consisted of the following steps: (1) filter the samples; (2) detecting and removing outliers; (3) reporting."
const trackAPos3Tokens: StanzaToken[] = [
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
    { id: 12, text: "filter", lemma: "filter", upos: "VERB", head: 7, deprel: "appos", start: 52, end: 58 },
    { id: 13, text: "the", lemma: "the", upos: "DET", head: 14, deprel: "det", start: 59, end: 62 },
    { id: 14, text: "samples", lemma: "sample", upos: "NOUN", head: 12, deprel: "obj", start: 63, end: 70 },
    { id: 15, text: ";", lemma: ";", upos: "PUNCT", head: 19, deprel: "punct", start: 70, end: 71 },
    { id: 16, text: "(", lemma: "(", upos: "PUNCT", head: 17, deprel: "punct", start: 72, end: 73 },
    { id: 17, text: "2", lemma: "2", upos: "NUM", head: 19, deprel: "discourse", start: 73, end: 74 },
    { id: 18, text: ")", lemma: ")", upos: "PUNCT", head: 17, deprel: "punct", start: 74, end: 75 },
    { id: 19, text: "detecting", lemma: "detect", upos: "VERB", head: 12, deprel: "conj", start: 76, end: 85 },
    { id: 20, text: "and", lemma: "and", upos: "CCONJ", head: 21, deprel: "cc", start: 86, end: 89 },
    { id: 21, text: "removing", lemma: "remove", upos: "VERB", head: 19, deprel: "conj", start: 90, end: 98 },
    { id: 22, text: "outliers", lemma: "outlier", upos: "NOUN", head: 19, deprel: "obj", start: 99, end: 107 },
    { id: 23, text: ";", lemma: ";", upos: "PUNCT", head: 27, deprel: "punct", start: 107, end: 108 },
    { id: 24, text: "(", lemma: "(", upos: "PUNCT", head: 25, deprel: "punct", start: 109, end: 110 },
    { id: 25, text: "3", lemma: "3", upos: "NUM", head: 27, deprel: "discourse", start: 110, end: 111 },
    { id: 26, text: ")", lemma: ")", upos: "PUNCT", head: 25, deprel: "punct", start: 111, end: 112 },
    { id: 27, text: "reporting", lemma: "reporting", upos: "NOUN", head: 19, deprel: "conj", start: 113, end: 122 },
    { id: 28, text: ".", lemma: ".", upos: "PUNCT", head: 3, deprel: "punct", start: 122, end: 123 },
]

describe('Prototype 2.6G2.8E2.2 TRACK A positive -- "detecting and removing outliers"', () => {
  it('hoists the shared object to the coordinated-predicate-group level', () => {
    const tree = buildStanzaHierarchicalTree(trackAPos3Text, trackAPos3Tokens)
    const members = findEnumeration(tree).children
    const member = members.find((m) => m.text.includes('detecting'))!
    expect(member.children.some((c) => c.role === 'predicate' && c.text === 'detecting')).toBe(true)
    expect(member.children.some((c) => c.role === 'coordinatedPredicate' && c.text === 'removing')).toBe(true)
    const objectSibling = member.children.find((c) => c.role === 'object')
    expect(objectSibling?.text).toBe('outliers')
  })
})

const trackAPos4Text = "The procedure consisted of the following steps: (1) filter the samples; (2) estimating and validating the parameters; (3) reporting."
const trackAPos4Tokens: StanzaToken[] = [
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
    { id: 12, text: "filter", lemma: "filter", upos: "VERB", head: 7, deprel: "appos", start: 52, end: 58 },
    { id: 13, text: "the", lemma: "the", upos: "DET", head: 14, deprel: "det", start: 59, end: 62 },
    { id: 14, text: "samples", lemma: "sample", upos: "NOUN", head: 12, deprel: "obj", start: 63, end: 70 },
    { id: 15, text: ";", lemma: ";", upos: "PUNCT", head: 19, deprel: "punct", start: 70, end: 71 },
    { id: 16, text: "(", lemma: "(", upos: "PUNCT", head: 17, deprel: "punct", start: 72, end: 73 },
    { id: 17, text: "2", lemma: "2", upos: "NUM", head: 19, deprel: "discourse", start: 73, end: 74 },
    { id: 18, text: ")", lemma: ")", upos: "PUNCT", head: 17, deprel: "punct", start: 74, end: 75 },
    { id: 19, text: "estimating", lemma: "estimate", upos: "VERB", head: 12, deprel: "conj", start: 76, end: 86 },
    { id: 20, text: "and", lemma: "and", upos: "CCONJ", head: 21, deprel: "cc", start: 87, end: 90 },
    { id: 21, text: "validating", lemma: "validate", upos: "VERB", head: 19, deprel: "conj", start: 91, end: 101 },
    { id: 22, text: "the", lemma: "the", upos: "DET", head: 23, deprel: "det", start: 102, end: 105 },
    { id: 23, text: "parameters", lemma: "parameter", upos: "NOUN", head: 19, deprel: "obj", start: 106, end: 116 },
    { id: 24, text: ";", lemma: ";", upos: "PUNCT", head: 28, deprel: "punct", start: 116, end: 117 },
    { id: 25, text: "(", lemma: "(", upos: "PUNCT", head: 26, deprel: "punct", start: 118, end: 119 },
    { id: 26, text: "3", lemma: "3", upos: "NUM", head: 28, deprel: "discourse", start: 119, end: 120 },
    { id: 27, text: ")", lemma: ")", upos: "PUNCT", head: 26, deprel: "punct", start: 120, end: 121 },
    { id: 28, text: "reporting", lemma: "reporting", upos: "NOUN", head: 19, deprel: "conj", start: 122, end: 131 },
    { id: 29, text: ".", lemma: ".", upos: "PUNCT", head: 3, deprel: "punct", start: 131, end: 132 },
]

describe('Prototype 2.6G2.8E2.2 TRACK A positive -- "estimating and validating the parameters"', () => {
  it('hoists the shared object to the coordinated-predicate-group level', () => {
    const tree = buildStanzaHierarchicalTree(trackAPos4Text, trackAPos4Tokens)
    const members = findEnumeration(tree).children
    const member = members.find((m) => m.text.includes('estimating'))!
    expect(member.children.some((c) => c.role === 'predicate' && c.text === 'estimating')).toBe(true)
    expect(member.children.some((c) => c.role === 'coordinatedPredicate' && c.text === 'validating')).toBe(true)
    const objectSibling = member.children.find((c) => c.role === 'object')
    expect(objectSibling?.text).toBe('the parameters')
  })
})

const trackANeg1Text = "The procedure consisted of the following steps: (1) filter the samples; (2) collecting temperature data and analyzing precipitation data; (3) reporting."
const trackANeg1Tokens: StanzaToken[] = [
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
    { id: 12, text: "filter", lemma: "filter", upos: "VERB", head: 7, deprel: "appos", start: 52, end: 58 },
    { id: 13, text: "the", lemma: "the", upos: "DET", head: 14, deprel: "det", start: 59, end: 62 },
    { id: 14, text: "samples", lemma: "sample", upos: "NOUN", head: 12, deprel: "obj", start: 63, end: 70 },
    { id: 15, text: ";", lemma: ";", upos: "PUNCT", head: 19, deprel: "punct", start: 70, end: 71 },
    { id: 16, text: "(", lemma: "(", upos: "PUNCT", head: 17, deprel: "punct", start: 72, end: 73 },
    { id: 17, text: "2", lemma: "2", upos: "NUM", head: 19, deprel: "discourse", start: 73, end: 74 },
    { id: 18, text: ")", lemma: ")", upos: "PUNCT", head: 17, deprel: "punct", start: 74, end: 75 },
    { id: 19, text: "collecting", lemma: "collect", upos: "VERB", head: 14, deprel: "acl", start: 76, end: 86 },
    { id: 20, text: "temperature", lemma: "temperature", upos: "NOUN", head: 21, deprel: "compound", start: 87, end: 98 },
    { id: 21, text: "data", lemma: "datum", upos: "NOUN", head: 19, deprel: "obj", start: 99, end: 103 },
    { id: 22, text: "and", lemma: "and", upos: "CCONJ", head: 23, deprel: "cc", start: 104, end: 107 },
    { id: 23, text: "analyzing", lemma: "analyze", upos: "VERB", head: 19, deprel: "conj", start: 108, end: 117 },
    { id: 24, text: "precipitation", lemma: "precipitation", upos: "NOUN", head: 25, deprel: "compound", start: 118, end: 131 },
    { id: 25, text: "data", lemma: "datum", upos: "NOUN", head: 23, deprel: "obj", start: 132, end: 136 },
    { id: 26, text: ";", lemma: ";", upos: "PUNCT", head: 30, deprel: "punct", start: 136, end: 137 },
    { id: 27, text: "(", lemma: "(", upos: "PUNCT", head: 28, deprel: "punct", start: 138, end: 139 },
    { id: 28, text: "3", lemma: "3", upos: "NUM", head: 30, deprel: "discourse", start: 139, end: 140 },
    { id: 29, text: ")", lemma: ")", upos: "PUNCT", head: 28, deprel: "punct", start: 140, end: 141 },
    { id: 30, text: "reporting", lemma: "reporting", upos: "NOUN", head: 12, deprel: "parataxis", start: 142, end: 151 },
    { id: 31, text: ".", lemma: ".", upos: "PUNCT", head: 3, deprel: "punct", start: 151, end: 152 },
]

describe('Prototype 2.6G2.8E2.2 TRACK A negative -- "collecting temperature data and analyzing precipitation data"', () => {
  it('keeps each conjunct\'s own distinct object -- never falsely shares', () => {
    const tree = buildStanzaHierarchicalTree(trackANeg1Text, trackANeg1Tokens)
    const members = findEnumeration(tree).children
    const member = members.find((m) => m.text.includes('collecting'))!
    // No hoisted object sibling -- each predicate keeps its own.
    expect(member.children.some((c) => c.role === 'object')).toBe(false)
    const predicateNode = member.children.find((c) => c.role === 'predicate' && c.text === 'collecting')!
    const coordNode = member.children.find((c) => c.role === 'coordinatedPredicate' && c.text === 'analyzing')!
    expect(predicateNode.children.find((c) => c.role === 'object')?.text).toBe('temperature data')
    expect(coordNode.children.find((c) => c.role === 'object')?.text).toBe('precipitation data')
  })
})

describe('Prototype 2.6G2.8E2.2 section 11 -- source-highlight mapping for the hoisted shared object', () => {
  it('predicate/coordinatedPredicate/hoisted-object each map to their exact, non-overlapping source range', () => {
    const tree = buildStanzaHierarchicalTree(trackAPos1Text, trackAPos1Tokens)
    const members = findEnumeration(tree).children
    const member = members.find((m) => m.text.includes('collecting'))!
    const predicateNode = member.children.find((c) => c.role === 'predicate')!
    const coordNode = member.children.find((c) => c.role === 'coordinatedPredicate')!
    const objectNode = member.children.find((c) => c.role === 'object')!

    const projection = projectionFromSource(trackAPos1Text)
    const nodes = [predicateNode, coordNode, objectNode]
    const runs = nodes.map((n) => {
      const result = projectAnalysisSpanToSourceHighlight(trackAPos1Text, projection, { start: n.start, end: n.end })
      expect(result.activeRuns).toHaveLength(1)
      return result.activeRuns[0]!
    })
    expect(trackAPos1Text.slice(runs[0]!.start, runs[0]!.end)).toBe('collecting')
    expect(trackAPos1Text.slice(runs[1]!.start, runs[1]!.end)).toBe('analyzing')
    expect(trackAPos1Text.slice(runs[2]!.start, runs[2]!.end)).toBe('the data')
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const overlaps = runs[i]!.start < runs[j]!.end && runs[j]!.start < runs[i]!.end
        expect(overlaps).toBe(false)
      }
    }
  })
})
