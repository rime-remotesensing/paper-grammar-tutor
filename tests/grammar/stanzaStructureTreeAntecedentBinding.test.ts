import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StructureTreeView } from '../../src/features/grammar/components/StructureTreeView.tsx'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G2.6C (Generalized Tree Presentation Completion) Problem D / sections 13-18 --
 * relative-pronoun <-> antecedent visual binding. Controls A-F. Renders the REAL,
 * unmodified StructureTreeView component (react-dom/server) and inspects the
 * `relative-antecedent` CSS class -- never mocking rendering logic.
 */

function tok(partial: Partial<StanzaToken> & { id: number; text: string; head: number; deprel: string; start: number; end: number }): StanzaToken {
  return { lemma: null, upos: null, ...partial }
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function render(text: string, tokens: StanzaToken[]): string {
  const tree = buildStanzaHierarchicalTree(text, tokens)
  return renderToStaticMarkup(React.createElement(StructureTreeView, { nodes: tree, sentence: text, structuredSyntax: true }))
}

describe('Prototype 2.6G2.6C Problem D -- relative-pronoun/antecedent visual binding (controls A-F)', () => {
  it('(A) ordinary relative clause on a single NP -- antecedent underline applies to that one NP, not fabricated elsewhere', () => {
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
    const html = render(text, tokens)
    expect(countOccurrences(html, 'relative-antecedent')).toBe(1)
    expect(html).toContain('<span class="structure-tree-text relative-antecedent">The samples</span>')
  })

  it('(B) CLASS A -- coordination-wide nonrestrictive relative raw-attached to the coordination\'s OWN head (member 0): antecedent underline applies to BOTH coordination members, not merely the pronoun', () => {
    const text = 'The datasets and models, which were validated externally, achieved strong results.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'datasets', upos: 'NOUN', head: 11, deprel: 'nsubj', start: 4, end: 12 }),
      tok({ id: 3, text: 'and', upos: 'CCONJ', head: 4, deprel: 'cc', start: 13, end: 16 }),
      tok({ id: 4, text: 'models', upos: 'NOUN', head: 2, deprel: 'conj', start: 17, end: 23 }),
      tok({ id: 5, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: 23, end: 24 }),
      tok({ id: 6, text: 'which', upos: 'PRON', head: 8, deprel: 'nsubj:pass', start: 25, end: 30 }),
      tok({ id: 7, text: 'were', upos: 'AUX', head: 8, deprel: 'aux:pass', start: 31, end: 35 }),
      tok({ id: 8, text: 'validated', upos: 'VERB', head: 2, deprel: 'acl:relcl', start: 36, end: 45 }),
      tok({ id: 9, text: 'externally', upos: 'ADV', head: 8, deprel: 'advmod', start: 46, end: 56 }),
      tok({ id: 10, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: 56, end: 57 }),
      tok({ id: 11, text: 'achieved', upos: 'VERB', head: 0, deprel: 'root', start: 58, end: 66 }),
      tok({ id: 12, text: 'strong', upos: 'ADJ', head: 13, deprel: 'amod', start: 67, end: 73 }),
      tok({ id: 13, text: 'results', upos: 'NOUN', head: 11, deprel: 'obj', start: 74, end: 81 }),
      tok({ id: 14, text: '.', upos: 'PUNCT', head: 11, deprel: 'punct', start: 81, end: 82 }),
    ]
    const html = render(text, tokens)
    // Both coordination members ("The datasets" and "models") are marked as the antecedent --
    // the whole coordinated constituent, not just one member and not just the pronoun.
    expect(countOccurrences(html, 'relative-antecedent')).toBe(2)
    expect(html).toContain('<span class="structure-tree-text relative-antecedent">The datasets</span>')
    expect(html).toContain('<span class="structure-tree-text relative-antecedent">models</span>')
  })

  it('(C)/(D) restrictive relative on ONE coordination member -- antecedent underline stays local to that member, never leaks to its sibling', () => {
    const text = 'The sensor that failed and the monitor recorded data.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'sensor', upos: 'NOUN', head: 8, deprel: 'nsubj', start: 4, end: 10 }),
      tok({ id: 3, text: 'that', upos: 'PRON', head: 4, deprel: 'nsubj', start: 11, end: 15 }),
      tok({ id: 4, text: 'failed', upos: 'VERB', head: 2, deprel: 'acl:relcl', start: 16, end: 22 }),
      tok({ id: 5, text: 'and', upos: 'CCONJ', head: 7, deprel: 'cc', start: 23, end: 26 }),
      tok({ id: 6, text: 'the', upos: 'DET', head: 7, deprel: 'det', start: 27, end: 30 }),
      tok({ id: 7, text: 'monitor', upos: 'NOUN', head: 2, deprel: 'conj', start: 31, end: 38 }),
      tok({ id: 8, text: 'recorded', upos: 'VERB', head: 0, deprel: 'root', start: 39, end: 47 }),
      tok({ id: 9, text: 'data', upos: 'NOUN', head: 8, deprel: 'obj', start: 48, end: 52 }),
      tok({ id: 10, text: '.', upos: 'PUNCT', head: 8, deprel: 'punct', start: 52, end: 53 }),
    ]
    const html = render(text, tokens)
    // Exactly one antecedent underline (the "sensor that failed" member) -- the sibling
    // "the monitor" member never inherits it merely by being a coordination sibling, since
    // the relative clause here is LOCAL (nested one level inside "sensor"'s own children),
    // never promoted to a sibling of both members.
    expect(countOccurrences(html, 'relative-antecedent')).toBe(1)
    expect(html).toContain('<span class="structure-tree-text relative-antecedent">The sensor</span>')
    expect(html).not.toContain('<span class="structure-tree-text relative-antecedent">the monitor')
  })

  it('(E) reduced relative / plain acl ("called KNN-GCN") never receives antecedent-underline styling -- it is not even a relativeClause node', () => {
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
    const html = render(text, tokens)
    expect(countOccurrences(html, 'relative-antecedent')).toBe(0)
    expect(countOccurrences(html, 'relative-marker')).toBe(0)
  })

  it('(F) unresolved/no-relative-clause sentence -- no antecedent binding is ever fabricated', () => {
    const text = 'The model achieved strong results.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'model', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 9 }),
      tok({ id: 3, text: 'achieved', upos: 'VERB', head: 0, deprel: 'root', start: 10, end: 18 }),
      tok({ id: 4, text: 'strong', upos: 'ADJ', head: 5, deprel: 'amod', start: 19, end: 25 }),
      tok({ id: 5, text: 'results', upos: 'NOUN', head: 3, deprel: 'obj', start: 26, end: 33 }),
      tok({ id: 6, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 33, end: 34 }),
    ]
    const html = render(text, tokens)
    expect(countOccurrences(html, 'relative-antecedent')).toBe(0)
  })
})

/**
 * Prototype 2.6G2.6C2 (Structural Relative Antecedent Resolution) -- live-review fix. The
 * "coordination-wide" promotion above was proven too broad by a real "not only A but also B,
 * which ..." live control: Stanza attaches the relative clause to B's OWN token (the LAST
 * conjunct), not to the coordination's own syntactic head, yet the old rule promoted it to
 * "the whole coordination" purely from position + comma, producing a false antecedent
 * (both A and B underlined) when only B is the true antecedent -- confirmed live to also
 * apply to the VIF/PCC control itself (its own raw "which" attaches to the LAST conjunct,
 * "methods", not to the coordination's head "factor"), so VIF/PCC's own antecedent is
 * corrected here from "the whole coordination" to "methods" alone, matching the general rule
 * rather than special-casing that one sentence.
 */
describe('Prototype 2.6G2.6C2 -- structural relative-antecedent scope resolution (CLASS A vs CLASS B)', () => {
  it('CLASS B (last-member antecedent, "not only A but also B, which ..." shape): only the raw-attached member gets antecedent styling, never the whole coordination', () => {
    // Hand-transcribed from a real Stanza parse of "The evaluation considers not only the
    // hyperparameter combinations but also the model selection, which is a highly complex
    // process that is executed internally and automatically." (see phase diagnostic).
    const text =
      'The evaluation considers not only the hyperparameter combinations but also the model selection, which is a highly complex process that is executed internally and automatically.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'evaluation', upos: 'NOUN', head: 3, deprel: 'nsubj', start: 4, end: 14 }),
      tok({ id: 3, text: 'considers', upos: 'VERB', head: 0, deprel: 'root', start: 15, end: 24 }),
      tok({ id: 4, text: 'not', upos: 'PART', head: 8, deprel: 'advmod', start: 25, end: 28 }),
      tok({ id: 5, text: 'only', upos: 'ADV', head: 8, deprel: 'advmod', start: 29, end: 33 }),
      tok({ id: 6, text: 'the', upos: 'DET', head: 8, deprel: 'det', start: 34, end: 37 }),
      tok({ id: 7, text: 'hyperparameter', upos: 'NOUN', head: 8, deprel: 'compound', start: 38, end: 52 }),
      tok({ id: 8, text: 'combinations', upos: 'NOUN', head: 3, deprel: 'obj', start: 53, end: 65 }),
      tok({ id: 9, text: 'but', upos: 'CCONJ', head: 13, deprel: 'cc', start: 66, end: 69 }),
      tok({ id: 10, text: 'also', upos: 'ADV', head: 13, deprel: 'advmod', start: 70, end: 74 }),
      tok({ id: 11, text: 'the', upos: 'DET', head: 13, deprel: 'det', start: 75, end: 78 }),
      tok({ id: 12, text: 'model', upos: 'NOUN', head: 13, deprel: 'compound', start: 79, end: 84 }),
      tok({ id: 13, text: 'selection', upos: 'NOUN', head: 8, deprel: 'conj', start: 85, end: 94 }),
      tok({ id: 14, text: ',', upos: 'PUNCT', head: 20, deprel: 'punct', start: 94, end: 95 }),
      tok({ id: 15, text: 'which', upos: 'PRON', head: 20, deprel: 'nsubj', start: 96, end: 101 }),
      tok({ id: 16, text: 'is', upos: 'AUX', head: 20, deprel: 'cop', start: 102, end: 104 }),
      tok({ id: 17, text: 'a', upos: 'DET', head: 20, deprel: 'det', start: 105, end: 106 }),
      tok({ id: 18, text: 'highly', upos: 'ADV', head: 19, deprel: 'advmod', start: 107, end: 113 }),
      tok({ id: 19, text: 'complex', upos: 'ADJ', head: 20, deprel: 'amod', start: 114, end: 121 }),
      tok({ id: 20, text: 'process', upos: 'NOUN', head: 13, deprel: 'acl:relcl', start: 122, end: 129 }),
      tok({ id: 21, text: 'that', upos: 'PRON', head: 23, deprel: 'nsubj:pass', start: 130, end: 134 }),
      tok({ id: 22, text: 'is', upos: 'AUX', head: 23, deprel: 'aux:pass', start: 135, end: 137 }),
      tok({ id: 23, text: 'executed', upos: 'VERB', head: 20, deprel: 'acl:relcl', start: 138, end: 146 }),
      tok({ id: 24, text: 'internally', upos: 'ADV', head: 23, deprel: 'advmod', start: 147, end: 157 }),
      tok({ id: 25, text: 'and', upos: 'CCONJ', head: 26, deprel: 'cc', start: 158, end: 161 }),
      tok({ id: 26, text: 'automatically', upos: 'ADV', head: 24, deprel: 'conj', start: 162, end: 175 }),
      tok({ id: 27, text: '.', upos: 'PUNCT', head: 3, deprel: 'punct', start: 175, end: 176 }),
    ]
    const html = render(text, tokens)
    // Whole-node antecedent: exactly ONE ("also the model selection"), never the first
    // conjunct ("not only the hyperparameter combinations").
    expect(html).toContain('relative-antecedent">also the model selection</span>')
    expect(html).not.toContain('relative-antecedent">not only the hyperparameter combinations</span>')
    // Nested sub-span antecedent: the OUTER relative clause's own row underlines just "a
    // highly complex process" (the inner "that"'s grounded antecedent NP), inline within its
    // own displayed text, without duplicating the inner clause's own text a second time.
    expect(html).toContain('<span class="relative-marker">which</span> is <span class="relative-antecedent">a highly complex process</span>')
    expect(countOccurrences(html, '<span class="structure-tree-text"><span class="relative-marker">that</span> is executed internally and automatically</span>')).toBe(1)
    // Exactly 2 antecedent-styled regions total: "also the model selection" (whole node) and
    // "a highly complex process" (inline sub-span) -- never 3+, never leaking onto the first
    // conjunct or duplicating.
    expect(countOccurrences(html, 'relative-antecedent')).toBe(2)
  })

  it('CLASS B applies to VIF/PCC too, once its OWN raw attachment (to "methods", the last conjunct) is honored: only "methods" gets antecedent styling', () => {
    // Hand-transcribed from a real Stanza parse of "The variance inflation factor (VIF) and
    // Pearson's correlation coefficient (PCC) methods, which are commonly used in the field,
    // were applied to reduce multicollinearity." -- "used" (acl:relcl) attaches to "methods"
    // (id 16, the LAST conjunct), never to "factor" (id 4, the coordination's own head).
    const text =
      "The variance inflation factor (VIF) and Pearson's correlation coefficient (PCC) methods, which are commonly used in the field, were applied to reduce multicollinearity."
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 4, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'variance', upos: 'NOUN', head: 4, deprel: 'compound', start: 4, end: 12 }),
      tok({ id: 3, text: 'inflation', upos: 'NOUN', head: 4, deprel: 'compound', start: 13, end: 22 }),
      tok({ id: 4, text: 'factor', upos: 'NOUN', head: 27, deprel: 'nsubj:pass', start: 23, end: 29 }),
      tok({ id: 5, text: '(', upos: 'PUNCT', head: 6, deprel: 'punct', start: 30, end: 31 }),
      tok({ id: 6, text: 'VIF', upos: 'PROPN', head: 4, deprel: 'appos', start: 31, end: 34 }),
      tok({ id: 7, text: ')', upos: 'PUNCT', head: 6, deprel: 'punct', start: 34, end: 35 }),
      tok({ id: 8, text: 'and', upos: 'CCONJ', head: 16, deprel: 'cc', start: 36, end: 39 }),
      tok({ id: 9, text: 'Pearson', upos: 'PROPN', head: 16, deprel: 'nmod:poss', start: 40, end: 47 }),
      tok({ id: 10, text: "'s", upos: 'PART', head: 9, deprel: 'case', start: 47, end: 49 }),
      tok({ id: 11, text: 'correlation', upos: 'NOUN', head: 12, deprel: 'compound', start: 50, end: 61 }),
      tok({ id: 12, text: 'coefficient', upos: 'NOUN', head: 16, deprel: 'compound', start: 62, end: 73 }),
      tok({ id: 13, text: '(', upos: 'PUNCT', head: 14, deprel: 'punct', start: 74, end: 75 }),
      tok({ id: 14, text: 'PCC', upos: 'PROPN', head: 12, deprel: 'appos', start: 75, end: 78 }),
      tok({ id: 15, text: ')', upos: 'PUNCT', head: 14, deprel: 'punct', start: 78, end: 79 }),
      tok({ id: 16, text: 'methods', upos: 'NOUN', head: 4, deprel: 'conj', start: 80, end: 87 }),
      tok({ id: 17, text: ',', upos: 'PUNCT', head: 21, deprel: 'punct', start: 87, end: 88 }),
      tok({ id: 18, text: 'which', upos: 'PRON', head: 21, deprel: 'nsubj:pass', start: 89, end: 94 }),
      tok({ id: 19, text: 'are', upos: 'AUX', head: 21, deprel: 'aux:pass', start: 95, end: 98 }),
      tok({ id: 20, text: 'commonly', upos: 'ADV', head: 21, deprel: 'advmod', start: 99, end: 107 }),
      tok({ id: 21, text: 'used', upos: 'VERB', head: 16, deprel: 'acl:relcl', start: 108, end: 112 }),
      tok({ id: 22, text: 'in', upos: 'ADP', head: 24, deprel: 'case', start: 113, end: 115 }),
      tok({ id: 23, text: 'the', upos: 'DET', head: 24, deprel: 'det', start: 116, end: 119 }),
      tok({ id: 24, text: 'field', upos: 'NOUN', head: 21, deprel: 'obl', start: 120, end: 125 }),
      tok({ id: 25, text: ',', upos: 'PUNCT', head: 4, deprel: 'punct', start: 125, end: 126 }),
      tok({ id: 26, text: 'were', upos: 'AUX', head: 27, deprel: 'aux:pass', start: 127, end: 131 }),
      tok({ id: 27, text: 'applied', upos: 'VERB', head: 0, deprel: 'root', start: 132, end: 139 }),
      tok({ id: 28, text: 'to', upos: 'PART', head: 29, deprel: 'mark', start: 140, end: 142 }),
      tok({ id: 29, text: 'reduce', upos: 'VERB', head: 27, deprel: 'advcl', start: 143, end: 149 }),
      tok({ id: 30, text: 'multicollinearity', upos: 'NOUN', head: 29, deprel: 'obj', start: 150, end: 167 }),
      tok({ id: 31, text: '.', upos: 'PUNCT', head: 27, deprel: 'punct', start: 167, end: 168 }),
    ]
    const html = render(text, tokens)
    expect(countOccurrences(html, 'relative-antecedent')).toBe(1)
    expect(html).toContain('relative-antecedent">Pearson&#x27;s correlation coefficient (PCC) methods</span>')
    expect(html).not.toContain('relative-antecedent">The variance inflation factor')
  })
})

/**
 * Prototype 2.6G2.6C3 (Conservative Relative Scope) Part A -- two EXTERNAL diagnostic
 * controls, deliberately chosen because VIF/PCC's own semantic scope is genuinely ambiguous
 * and therefore unsuitable as a gold control for whole-coordination vs member-scoped
 * behavior. Hand-transcribed from real Stanza parses (see phase diagnostic).
 */
describe('Prototype 2.6G2.6C3 Part A -- conservative whole-coordination promotion (external controls A/B)', () => {
  it('(A) clearly coordination-wide: "The temperature and humidity, which are measured every hour, are stored in the database." -- whole-coordination binding is acceptable', () => {
    const text = 'The temperature and humidity, which are measured every hour, are stored in the database.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'temperature', upos: 'NOUN', head: 13, deprel: 'nsubj:pass', start: 4, end: 15 }),
      tok({ id: 3, text: 'and', upos: 'CCONJ', head: 4, deprel: 'cc', start: 16, end: 19 }),
      tok({ id: 4, text: 'humidity', upos: 'NOUN', head: 2, deprel: 'conj', start: 20, end: 28 }),
      tok({ id: 5, text: ',', upos: 'PUNCT', head: 8, deprel: 'punct', start: 28, end: 29 }),
      tok({ id: 6, text: 'which', upos: 'PRON', head: 8, deprel: 'nsubj:pass', start: 30, end: 35 }),
      tok({ id: 7, text: 'are', upos: 'AUX', head: 8, deprel: 'aux:pass', start: 36, end: 39 }),
      tok({ id: 8, text: 'measured', upos: 'VERB', head: 2, deprel: 'acl:relcl', start: 40, end: 48 }),
      tok({ id: 9, text: 'every', upos: 'DET', head: 10, deprel: 'det', start: 49, end: 54 }),
      tok({ id: 10, text: 'hour', upos: 'NOUN', head: 8, deprel: 'obl:unmarked', start: 55, end: 59 }),
      tok({ id: 11, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: 59, end: 60 }),
      tok({ id: 12, text: 'are', upos: 'AUX', head: 13, deprel: 'aux:pass', start: 61, end: 64 }),
      tok({ id: 13, text: 'stored', upos: 'VERB', head: 0, deprel: 'root', start: 65, end: 71 }),
      tok({ id: 14, text: 'in', upos: 'ADP', head: 16, deprel: 'case', start: 72, end: 74 }),
      tok({ id: 15, text: 'the', upos: 'DET', head: 16, deprel: 'det', start: 75, end: 78 }),
      tok({ id: 16, text: 'database', upos: 'NOUN', head: 13, deprel: 'obl', start: 79, end: 87 }),
      tok({ id: 17, text: '.', upos: 'PUNCT', head: 13, deprel: 'punct', start: 87, end: 88 }),
    ]
    const html = render(text, tokens)
    expect(countOccurrences(html, 'relative-antecedent')).toBe(2)
    expect(html).toContain('<span class="structure-tree-text relative-antecedent">The temperature</span>')
    expect(html).toContain('<span class="structure-tree-text relative-antecedent">humidity</span>')
  })

  it('(B) ambiguous/member-looking: "The temperature and the humidity sensor, which is installed outdoors, are monitored continuously." -- whole-coordination underline MUST NOT appear; abstain rather than guess the true member', () => {
    // Raw UD attaches "installed" (acl:relcl) to "temperature" (member 0, the SAME
    // structural position as control A's genuinely coordination-wide "measured") -- yet the
    // relative clause's own singular copula "is" is incompatible with a collective (plural)
    // reading of the 2-member coordination, which is negative evidence against promoting to
    // the whole coordination. Since raw attachment still only points at "temperature" (not
    // reliably at "the humidity sensor", the semantically correct antecedent), no member can
    // be structurally identified with confidence either -- the correct behavior is total
    // abstention, not a confidently wrong underline on "temperature" alone.
    const text = 'The temperature and the humidity sensor, which is installed outdoors, are monitored continuously.'
    const tokens: StanzaToken[] = [
      tok({ id: 1, text: 'The', upos: 'DET', head: 2, deprel: 'det', start: 0, end: 3 }),
      tok({ id: 2, text: 'temperature', upos: 'NOUN', head: 14, deprel: 'nsubj:pass', start: 4, end: 15 }),
      tok({ id: 3, text: 'and', upos: 'CCONJ', head: 6, deprel: 'cc', start: 16, end: 19 }),
      tok({ id: 4, text: 'the', upos: 'DET', head: 6, deprel: 'det', start: 20, end: 23 }),
      tok({ id: 5, text: 'humidity', upos: 'NOUN', head: 6, deprel: 'compound', start: 24, end: 32 }),
      tok({ id: 6, text: 'sensor', upos: 'NOUN', head: 2, deprel: 'conj', start: 33, end: 39 }),
      tok({ id: 7, text: ',', upos: 'PUNCT', head: 10, deprel: 'punct', start: 39, end: 40 }),
      tok({ id: 8, text: 'which', upos: 'PRON', head: 10, deprel: 'nsubj:pass', start: 41, end: 46 }),
      tok({ id: 9, text: 'is', upos: 'AUX', head: 10, deprel: 'aux:pass', start: 47, end: 49 }),
      tok({ id: 10, text: 'installed', upos: 'VERB', head: 2, deprel: 'acl:relcl', start: 50, end: 59 }),
      tok({ id: 11, text: 'outdoors', upos: 'ADV', head: 10, deprel: 'advmod', start: 60, end: 68 }),
      tok({ id: 12, text: ',', upos: 'PUNCT', head: 2, deprel: 'punct', start: 68, end: 69 }),
      tok({ id: 13, text: 'are', upos: 'AUX', head: 14, deprel: 'aux:pass', start: 70, end: 73 }),
      tok({ id: 14, text: 'monitored', upos: 'VERB', head: 0, deprel: 'root', start: 74, end: 83 }),
      tok({ id: 15, text: 'continuously', upos: 'ADV', head: 14, deprel: 'advmod', start: 84, end: 96 }),
      tok({ id: 16, text: '.', upos: 'PUNCT', head: 14, deprel: 'punct', start: 96, end: 97 }),
    ]
    const html = render(text, tokens)
    expect(countOccurrences(html, 'relative-antecedent')).toBe(0)
    expect(html).not.toContain('relative-antecedent">The temperature</span>')
    expect(html).not.toContain('relative-antecedent">the humidity sensor</span>')
    // Interaction (hover/click/pin) span is unaffected by the antecedent abstention -- the
    // relative clause still renders exactly once, fully intact, just without a false binding.
    expect(countOccurrences(html, 'which is installed outdoors')).toBe(1)
  })
})
