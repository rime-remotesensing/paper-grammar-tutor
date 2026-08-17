import { describe, expect, it } from 'vitest'
import { classifyAcceptedPredicates, mergeHybridPredicateStructure } from '../../src/features/grammar/domain/hybridPredicateMerger'
import type { SentenceCore, Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type { PredicateStructure, ResolvedPredicate } from '../../src/features/grammar/schemas/predicateStructure.schema'

// Prototype 2.3C item 37 — hybrid merger tests, production port of the Prototype 2.3B
// spike's validated algorithm (unsimplified — item 10). Each describe block below maps to
// one line item from the 2.3C order (item 37's checklist), using fixtures built directly
// from the concrete sentences the spike measured acceptance against.

function span(text: string, start: number): Span {
  return { text, start, end: start + text.length }
}

function ungroundedSpan(text: string): Span {
  return { text, start: -1, end: -1 }
}

function coreOf(overrides: Partial<SentenceCore>): SentenceCore {
  return {
    subject: null,
    subjectHead: null,
    verb: null,
    indirectObject: null,
    object: null,
    complement: null,
    pattern: 'other',
    ...overrides,
  }
}

function predicate(text: string, start: number, relation: 'main' | 'coordinated' = 'main', dependents: ResolvedPredicate['dependents'] = []): ResolvedPredicate {
  return { text, start, end: start + text.length, relation, dependents }
}

function dependent(text: string, start: number, role: ResolvedPredicate['dependents'][number]['role'] = 'other') {
  return { text, start, end: start + text.length, role, children: [] }
}

function structureOf(predicates: ResolvedPredicate[], overrides: Partial<PredicateStructure> = {}): PredicateStructure {
  return { subjectModifiers: [], predicates, sentenceModifiers: [], ...overrides }
}

describe('mergeHybridPredicateStructure — subject-containment filter', () => {
  const SENTENCE = 'Collecting reliable field data takes considerable time.'
  it('drops a predicate candidate that lies fully inside sentenceCore.subject (gerund head)', () => {
    const core = coreOf({ subject: span('Collecting reliable field data', 0), verb: span('takes', 32), pattern: 'SVO' })
    const structure = structureOf([
      predicate('Collecting', 0, 'main'),
      predicate('takes', 32, 'main', [dependent('considerable time', 38, 'complement')]),
    ])
    const result = mergeHybridPredicateStructure(SENTENCE, core, structure)
    expect(result.predicates.map((p) => p.text)).toEqual(['takes'])
    expect(result.dropped).toContainEqual({ text: 'Collecting', reason: 'subject-contained (e.g. gerund head)' })
  })

  it('drops a predicate fully inside a long relative-clause subject', () => {
    const sentence = 'The scientist who discovered the compound won an award.'
    const core = coreOf({ subject: span('The scientist who discovered the compound', 0), verb: span('won', 43), pattern: 'SVO' })
    const structure = structureOf([
      predicate('discovered', 17, 'main'),
      predicate('won', 43, 'main', [dependent('an award', 47, 'object')]),
    ])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.predicates.map((p) => p.text)).toEqual(['won'])
    expect(result.dropped.some((d) => d.text === 'discovered')).toBe(true)
  })
})

describe('mergeHybridPredicateStructure — pre-subject filter', () => {
  const SENTENCE = 'Although temperatures increased, the sensor remained stable.'
  it('drops a predicate candidate that lies fully BEFORE sentenceCore.subject (preposed clause)', () => {
    const core = coreOf({ subject: span('the sensor', 34), verb: span('remained', 45), pattern: 'SVC' })
    // The structure analyzer (wrongly) proposed "increased" as its own top-level predicate
    // candidate — it must be excluded since it lies entirely before the confirmed subject.
    const withFalsePredicate = structureOf(
      [predicate('increased', 20, 'coordinated'), predicate('remained', 45, 'main', [dependent('stable', 54, 'complement')])],
      { sentenceModifiers: [{ text: 'Although temperatures increased', start: 0, end: 32, role: 'clause' }] },
    )
    const result = mergeHybridPredicateStructure(SENTENCE, core, withFalsePredicate)
    expect(result.predicates.map((p) => p.text)).toEqual(['remained'])
    expect(result.dropped).toContainEqual({ text: 'increased', reason: 'pre-subject (preposed clause/phrase)' })
  })
})

describe('mergeHybridPredicateStructure — exact duplicate predicate collapse + dependent merge', () => {
  const SENTENCE = 'Data was recorded every 1 nm in the 0.4 to 0.8 μm region and every 4 nm from 0.8 to 2.5 μm.'
  it('collapses two identical-span predicate candidates into one, merging their dependents (Primary Reno)', () => {
    const core = coreOf({ subject: span('Data', 0), verb: span('was recorded', 5), pattern: 'SV' })
    const structure = structureOf([
      predicate('was recorded', 5, 'main', [dependent('every 1 nm', 18, 'condition')]),
      // A second candidate with the SAME exact span as above, but a different dependent —
      // this is the exact duplicate-predicate shape the 2.3A raw analyzer produced.
      predicate('was recorded', 5, 'main', [dependent('every 4 nm', 65, 'condition')]),
    ])
    const result = mergeHybridPredicateStructure(SENTENCE, core, structure)
    expect(result.predicates).toHaveLength(1)
    expect(result.predicates[0].dependents.map((d) => d.text)).toEqual(['every 1 nm', 'every 4 nm'])
  })

  it('dedupes an exact-duplicate dependent span within the collapsed predicate rather than keeping both copies', () => {
    const core = coreOf({ subject: span('Data', 0), verb: span('was recorded', 5), pattern: 'SV' })
    const structure = structureOf([
      predicate('was recorded', 5, 'main', [dependent('every 1 nm', 18, 'condition')]),
      predicate('was recorded', 5, 'main', [dependent('every 1 nm', 18, 'condition')]),
    ])
    const result = mergeHybridPredicateStructure(SENTENCE, core, structure)
    expect(result.predicates[0].dependents).toHaveLength(1)
  })
})

describe('mergeHybridPredicateStructure — core verb anchor: exact span match', () => {
  it('unifies the anchor when core.verb has the exact same grounded span as a structure candidate', () => {
    const sentence = 'The sensor collected data and analyzed the results.'
    const core = coreOf({ subject: span('The sensor', 0), verb: span('collected', 11), pattern: 'SVO' })
    const structure = structureOf([
      predicate('collected', 11, 'main', [dependent('data', 21, 'object')]),
      predicate('analyzed', 30, 'coordinated', [dependent('the results', 39, 'object')]),
    ])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    const anchor = result.predicates.find((p) => p.isCoreAnchor)
    expect(anchor?.text).toBe('collected')
    expect(result.anchorInjected).toBe(false)
  })
})

describe('mergeHybridPredicateStructure — core verb anchor: overlap/containment match', () => {
  it('unifies the anchor when core.verb overlaps (but is not identical to) a structure candidate span', () => {
    const sentence = 'The sensor collected data and analyzed the results.'
    const core = coreOf({ subject: span('The sensor', 0), verb: span('collected data', 11), pattern: 'SVO' }) // overlaps "collected"
    const structure = structureOf([
      predicate('collected', 11, 'main', [dependent('data', 21, 'object')]),
      predicate('analyzed', 30, 'coordinated', [dependent('the results', 39, 'object')]),
    ])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    const anchor = result.predicates.find((p) => p.isCoreAnchor)
    expect(anchor?.text).toBe('collected')
    expect(result.anchorInjected).toBe(false)
  })
})

describe('mergeHybridPredicateStructure — core verb anchor: last-word text compatibility fallback', () => {
  const SENTENCE = 'The samples were dried, weighed, and stored at room temperature.'
  it('anchors on "stored" when core.verb="were stored" fails to ground as a contiguous span (Triple predicate, Prototype 2.3B finding)', () => {
    const core = coreOf({ subject: span('The samples', 0), verb: ungroundedSpan('were stored'), pattern: 'other' })
    const structure = structureOf([
      predicate('were dried', 12, 'coordinated'),
      predicate('weighed', 24, 'coordinated'),
      predicate('stored', 37, 'coordinated', [dependent('at room temperature', 44, 'condition')]),
    ])
    const result = mergeHybridPredicateStructure(SENTENCE, core, structure)
    const anchor = result.predicates.find((p) => p.isCoreAnchor)
    expect(anchor?.text).toBe('stored')
    expect(result.anchorInjected).toBe(false)
    // and the coordination-evidence chain, walking LEFTWARD from the last-positioned
    // anchor, recovers BOTH earlier coordinated predicates.
    expect(result.predicates.map((p) => p.text)).toEqual(['were dried', 'weighed', 'stored'])
  })
})

describe('mergeHybridPredicateStructure — relation="main" fallback (no core.verb at all)', () => {
  it('falls back to the structure analyzer\'s own relation="main" designation when core.verb is null', () => {
    const sentence = 'The sensor collected data and analyzed the results.'
    const core = coreOf({ subject: span('The sensor', 0), verb: null, pattern: 'other' })
    const structure = structureOf([
      predicate('collected', 11, 'main', [dependent('data', 21, 'object')]),
      predicate('analyzed', 30, 'coordinated', [dependent('the results', 39, 'object')]),
    ])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    const anchor = result.predicates.find((p) => p.isCoreAnchor)
    expect(anchor?.text).toBe('collected')
  })
})

describe('mergeHybridPredicateStructure — ungrounded core verb never becomes a synthetic node', () => {
  it('does not inject a synthetic anchor with (-1,-1) offsets when core.verb is ungrounded and no candidate is compatible', () => {
    const sentence = 'The sensor collected data.'
    const core = coreOf({ subject: span('The sensor', 0), verb: ungroundedSpan('totally fabricated verb'), pattern: 'other' })
    const structure = structureOf([predicate('collected', 11, 'main', [dependent('data', 21, 'object')])])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.anchorInjected).toBe(false)
    expect(result.predicates.every((p) => p.start >= 0 && p.end >= 0)).toBe(true)
    // Falls through to the structure analyzer's own relation="main" designation.
    expect(result.predicates.find((p) => p.isCoreAnchor)?.text).toBe('collected')
  })

  it('DOES inject a synthetic anchor from sentenceCore when core.verb IS grounded but no candidate is compatible at all', () => {
    const sentence = 'Data increased.'
    const core = coreOf({ subject: span('Data', 0), verb: span('increased', 5), pattern: 'SV' })
    const structure = structureOf([]) // structure analyzer found nothing at all (defensive — schema requires >=1 in practice)
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.anchorInjected).toBe(true)
    expect(result.predicates).toHaveLength(1)
    expect(result.predicates[0]).toMatchObject({ text: 'increased', isCoreAnchor: true, relation: 'main' })
  })
})

describe('mergeHybridPredicateStructure — coordination evidence', () => {
  it('accepts a coordinated predicate when "and" appears in the gap between it and the anchor', () => {
    const sentence = 'The sensor collected data and analyzed the results.'
    const core = coreOf({ subject: span('The sensor', 0), verb: span('collected', 11), pattern: 'SVO' })
    const structure = structureOf([
      predicate('collected', 11, 'main', [dependent('data', 21, 'object')]),
      predicate('analyzed', 30, 'coordinated', [dependent('the results', 39, 'object')]),
    ])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.predicates.map((p) => p.text)).toEqual(['collected', 'analyzed'])
  })

  it('rejects a coordinated candidate when the gap has NO coordination marker (that-clause negative control)', () => {
    const sentence = 'The study showed that temperature increased.'
    const core = coreOf({ subject: span('The study', 0), verb: span('showed', 10), pattern: 'other' })
    const structure = structureOf([
      predicate('showed', 10, 'main', [dependent('that temperature increased', 17, 'clause')]),
      // A structure-analyzer mistake: treating the subordinate clause's own verb as a
      // second top-level predicate, with NO "and"/"or"/"but"/comma between it and "showed".
      predicate('increased', 33, 'coordinated'),
    ])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.predicates.map((p) => p.text)).toEqual(['showed'])
    expect(result.dropped.some((d) => d.text === 'increased')).toBe(true)
  })

  it('accepts a comma-separated coordination chain (triple predicate, no explicit "and" before the middle item)', () => {
    const sentence = 'The samples were dried, weighed, and stored at room temperature.'
    const core = coreOf({ subject: span('The samples', 0), verb: span('were dried', 12), pattern: 'other' })
    const structure = structureOf([
      predicate('were dried', 12, 'main'),
      predicate('weighed', 24, 'coordinated'),
      predicate('stored', 37, 'coordinated', [dependent('at room temperature', 44, 'condition')]),
    ])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.predicates.map((p) => p.text)).toEqual(['were dried', 'weighed', 'stored'])
  })
})

describe('mergeHybridPredicateStructure — contaminated core object suppression', () => {
  it('suppresses core.object from the tree when it overlaps/contains an accepted coordinated predicate span (Green leaves)', () => {
    const sentence = 'California buckwheat leaves were available locally and were measured within 1 hour of collection.'
    const core = coreOf({
      subject: span('California buckwheat leaves', 0),
      verb: span('were available', 29),
      object: span('locally and were measured within 1 hour of collection', 44), // broken/corrupted GrammarAnalysis object
      pattern: 'SVO',
    })
    const structure = structureOf([
      predicate('were available', 29, 'main', [dependent('locally', 44, 'modifier')]),
      predicate('were measured', 56, 'coordinated', [dependent('within 1 hour of collection', 70, 'condition')]),
    ])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.suppressedCoreDependents).toContainEqual({
      slot: 'object',
      text: 'locally and were measured within 1 hour of collection',
      reason: 'overlaps/contains an accepted coordinated predicate',
    })
    // The broken core.object never leaks into the anchor's own dependents as a literal node.
    const anchor = result.predicates.find((p) => p.isCoreAnchor)
    expect(anchor?.dependents.some((d) => d.text === 'locally and were measured within 1 hour of collection')).toBe(false)
  })
})

describe('mergeHybridPredicateStructure — true object preservation', () => {
  it('keeps core.object as a dependent of the anchor when it does NOT overlap any coordinated predicate (active coordination)', () => {
    const sentence = 'The sensor collected data and analyzed the results.'
    const core = coreOf({ subject: span('The sensor', 0), verb: span('collected', 11), object: span('data', 21), pattern: 'SVO' })
    const structure = structureOf([
      predicate('collected', 11, 'main', [dependent('data', 21, 'object')]),
      predicate('analyzed', 30, 'coordinated', [dependent('the results', 39, 'object')]),
    ])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.suppressedCoreDependents).toEqual([])
    const anchor = result.predicates.find((p) => p.isCoreAnchor)
    expect(anchor?.dependents.filter((d) => d.text === 'data')).toHaveLength(1) // deduped against structure's own "data" dependent
  })
})

describe('mergeHybridPredicateStructure — Prototype 2.5U redundancy condition (item 14/18: core slot overlaps anchor text AND contains an existing dependent)', () => {
  const SENTENCE = 'The parameter C is a function of the regression slope (b) and intercept (a).'

  it('[18A] suppresses a core.object that overlaps the anchor predicate text AND fully contains an existing dependent (exact CASE A shape)', () => {
    // Stage 1 folded "a function" (part of the predicate itself) into its object span;
    // Stage 2 correctly scoped its own dependent to just "of the regression slope (b) and
    // intercept (a)" starting further right. The core slot span (19-75) overlaps the anchor
    // predicate "is a function" (16-29) and fully contains the Stage-2 dependent (30-75).
    const core = coreOf({
      subject: span('The parameter C', 0),
      verb: span('is', 16),
      object: span('a function of the regression slope (b) and intercept (a)', 19),
      pattern: 'SVO',
    })
    const structure = structureOf([predicate('is a function', 16, 'main', [dependent('of the regression slope (b) and intercept (a)', 30, 'object')])])
    const result = mergeHybridPredicateStructure(SENTENCE, core, structure)
    expect(result.suppressedCoreDependents).toContainEqual({
      slot: 'object',
      text: 'a function of the regression slope (b) and intercept (a)',
      reason: 'redundant with an existing dependent of the anchor predicate',
    })
    const anchor = result.predicates.find((p) => p.isCoreAnchor)
    expect(anchor?.dependents).toHaveLength(1)
    expect(anchor?.dependents[0].text).toBe('of the regression slope (b) and intercept (a)')
  })

  it('[18B] exact same-span core slot is deduped exactly as before (sameSpan short-circuit, unaffected by the new condition)', () => {
    const sentence = 'The sensor collected data.'
    const core = coreOf({ subject: span('The sensor', 0), verb: span('collected', 11), object: span('data', 21), pattern: 'SVO' })
    const structure = structureOf([predicate('collected', 11, 'main', [dependent('data', 21, 'object')])])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.suppressedCoreDependents).toEqual([])
    const anchor = result.predicates.find((p) => p.isCoreAnchor)
    expect(anchor?.dependents.filter((d) => d.text === 'data')).toHaveLength(1)
  })

  it('[18C] a legitimate non-overlapping core slot still attaches normally', () => {
    const sentence = 'The sensor collected data reliably.'
    const core = coreOf({ subject: span('The sensor', 0), verb: span('collected', 11), object: span('data', 21), pattern: 'SVO' })
    const structure = structureOf([predicate('collected', 11, 'main', [dependent('reliably', 26, 'modifier')])])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.suppressedCoreDependents).toEqual([])
    const anchor = result.predicates.find((p) => p.isCoreAnchor)
    expect(anchor?.dependents.some((d) => d.text === 'data')).toBe(true)
  })

  it('[18D] partial overlap without containment does NOT suppress (core slot overlaps a dependent but does not fully contain it)', () => {
    // core.complement spans only "a function of the regression" (ends mid-dependent) —
    // overlaps the anchor predicate AND overlaps the Stage-2 dependent, but does not fully
    // CONTAIN it (the dependent extends past the core slot's own end). Must still attach.
    const core = coreOf({
      subject: span('The parameter C', 0),
      verb: span('is', 16),
      complement: span('a function of the regression', 19),
      pattern: 'SVC',
    })
    const structure = structureOf([predicate('is a function', 16, 'main', [dependent('of the regression slope (b) and intercept (a)', 30, 'object')])])
    const result = mergeHybridPredicateStructure(SENTENCE, core, structure)
    expect(result.suppressedCoreDependents).toEqual([])
    const anchor = result.predicates.find((p) => p.isCoreAnchor)
    expect(anchor?.dependents.some((d) => d.text === 'a function of the regression')).toBe(true)
  })

  it('[18E] containment without anchor-predicate contamination does NOT suppress (core slot contains a dependent but never touches the anchor\'s own text)', () => {
    // core.object fully contains the Stage-2 dependent's span, but starts well AFTER the
    // anchor predicate's own text ends — no overlap with "is a function" itself — so the
    // redundancy condition's first half (A) is false and injection must proceed normally.
    const core = coreOf({
      subject: span('The parameter C', 0),
      verb: span('is', 16),
      object: span('of the regression slope (b) and intercept (a) extra', 30),
      pattern: 'SVO',
    })
    const structure = structureOf([predicate('is a function', 16, 'main', [dependent('of the regression slope (b) and intercept (a)', 30, 'object')])])
    const result = mergeHybridPredicateStructure(SENTENCE, core, structure)
    expect(result.suppressedCoreDependents).toEqual([])
    const anchor = result.predicates.find((p) => p.isCoreAnchor)
    expect(anchor?.dependents.some((d) => d.text === 'of the regression slope (b) and intercept (a) extra')).toBe(true)
  })
})

describe('mergeHybridPredicateStructure — that-clause negative control (no false main coordination)', () => {
  it('never creates a top-level coordinated predicate for a that-clause\'s own subordinate verb', () => {
    const sentence = 'The study showed that temperature increased.'
    const core = coreOf({ subject: span('The study', 0), verb: span('showed', 10), pattern: 'other' })
    const structure = structureOf([predicate('showed', 10, 'main', [dependent('that temperature increased', 17, 'clause')])])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.predicates.map((p) => p.text)).toEqual(['showed'])
  })
})

describe('mergeHybridPredicateStructure — relative-clause negative control (no false main coordination)', () => {
  it('never creates a top-level coordinated predicate for a relative clause\'s own verb (subject-contained)', () => {
    const sentence = 'The scientist who discovered the compound won an award.'
    const core = coreOf({ subject: span('The scientist who discovered the compound', 0), verb: span('won', 43), pattern: 'SVO' })
    const structure = structureOf([
      predicate('discovered', 17, 'coordinated'),
      predicate('won', 43, 'main', [dependent('an award', 47, 'object')]),
    ])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.predicates.map((p) => p.text)).toEqual(['won'])
  })
})

describe('mergeHybridPredicateStructure — ungrounded sentenceCore.subject does not crash geometry checks', () => {
  it('treats an ungrounded subject as absent rather than passing (-1,-1) into containment/pre-subject checks', () => {
    const sentence = 'The sensor collected data.'
    const core = coreOf({ subject: ungroundedSpan('a paraphrase never in the source'), verb: span('collected', 11), pattern: 'SVO' })
    const structure = structureOf([predicate('collected', 11, 'main', [dependent('data', 21, 'object')])])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.subject).toBeNull()
    expect(result.predicates.map((p) => p.text)).toEqual(['collected'])
  })
})

describe('mergeHybridPredicateStructure — ungrounded core O/IO/C never enters contamination checks', () => {
  it('skips an ungrounded complement slot without crashing or suppressing anything', () => {
    const sentence = 'The sensor collected data.'
    const core = coreOf({
      subject: span('The sensor', 0),
      verb: span('collected', 11),
      complement: ungroundedSpan('fabricated complement'),
      pattern: 'SVC',
    })
    const structure = structureOf([predicate('collected', 11, 'main', [dependent('data', 21, 'object')])])
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.suppressedCoreDependents).toEqual([])
  })
})

describe('mergeHybridPredicateStructure — Prototype 2.5S salvage fix: rejected coordination candidates keep their content', () => {
  it('demotes a rejected candidate\'s dependents to sentenceModifiers instead of discarding them (CASE B "using" regression)', () => {
    // Live shape: the raw model sometimes mistakes a participial phrase ("using the
    // equation [EQUATION_6]") for a second coordinated predicate. The coordination-evidence
    // chain is right to reject "using" (no and/or/comma before it) — but its equation
    // dependent is real, grounded content that must survive as a sentence-level modifier
    // rather than vanish along with the rejected candidate.
    const sentence =
      'This regression line can be rotated to the horizontal to normalize the data using the equation [EQUATION_6] where Ln is the normalized radiance.'
    const core = coreOf({ subject: span('This regression line', 0), verb: span('can be rotated', 21), pattern: 'SVC' })
    const structure = structureOf(
      [
        predicate('can be rotated', 21, 'main', [dependent('to the horizontal', 36, 'condition'), dependent('to normalize the data', 54, 'object')]),
        predicate('using', 76, 'coordinated', [dependent('the equation [EQUATION_6]', 82, 'object')]),
      ],
      { sentenceModifiers: [{ text: 'where Ln is the normalized radiance', start: 108, end: 143, role: 'clause' }] },
    )
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    expect(result.predicates.map((p) => p.text)).toEqual(['can be rotated'])
    expect(result.dropped).toContainEqual({ text: 'using', reason: 'no coordination evidence after "can be rotated"' })
    const modifierTexts = result.sentenceModifiers.map((m) => m.text)
    expect(modifierTexts).toContain('the equation [EQUATION_6]')
    expect(modifierTexts).toContain('where Ln is the normalized radiance')
  })

  it('salvaged sentenceModifiers stay ordered by source position alongside pre-existing ones', () => {
    const sentence = 'The model runs [EQUATION_1] and uses it where x is the input.'
    const core = coreOf({ subject: span('The model', 0), verb: span('runs', 10), pattern: 'SVO' })
    const structure = structureOf(
      [
        predicate('runs', 10, 'main', [dependent('[EQUATION_1]', 15, 'object')]),
        predicate('uses', 32, 'coordinated', [dependent('it', 37, 'object')]),
      ],
      { sentenceModifiers: [{ text: 'where x is the input', start: 40, end: 60, role: 'clause' }] },
    )
    const result = mergeHybridPredicateStructure(sentence, core, structure)
    // "uses" IS accepted here (genuine "and" before it) — nothing should be salvaged/dropped.
    expect(result.dropped).toEqual([])
    expect(result.predicates.map((p) => p.text)).toEqual(['runs', 'uses'])
    expect(result.sentenceModifiers.map((m) => m.text)).toEqual(['where x is the input'])
  })
})

describe('classifyAcceptedPredicates — Prototype 2.5W item 30: Steps 1–4 extraction regression suite', () => {
  it('returns the same accepted set (by text) that mergeHybridPredicateStructure derives internally for a coordinated sentence', () => {
    const sentence = 'The sensor collected data and analyzed the results.'
    const core = coreOf({ subject: span('The sensor', 0), verb: span('collected', 11), pattern: 'other' })
    const predicates = [
      predicate('collected', 11, 'main', [dependent('data', 21, 'object')]),
      predicate('analyzed', 30, 'coordinated', [dependent('the results', 39, 'object')]),
    ]
    const classification = classifyAcceptedPredicates(sentence, core, predicates)
    expect(classification.accepted.map((p) => p.text)).toEqual(['collected', 'analyzed'])
    expect(classification.rejected).toEqual([])
    expect(classification.anchor?.text).toBe('collected')
    expect(classification.dropped).toEqual([])
    expect(classification.anchorInjected).toBe(false)

    const merged = mergeHybridPredicateStructure(sentence, core, structureOf(predicates))
    expect(merged.predicates.map((p) => p.text)).toEqual(classification.accepted.map((p) => p.text))
  })

  it('rejects an unsupported coordination candidate (no evidence), matching mergeHybridPredicateStructure\'s own dropped list', () => {
    const sentence =
      'This regression line can be rotated to the horizontal to normalize the data using the equation [EQUATION_6] where Ln is the normalized radiance.'
    const core = coreOf({ subject: span('This regression line', 0), verb: span('can be rotated', 21), pattern: 'SVC' })
    const predicates = [
      predicate('can be rotated', 21, 'main', [dependent('to the horizontal', 36, 'condition'), dependent('to normalize the data', 54, 'object')]),
      predicate('using', 76, 'coordinated', [dependent('the equation [EQUATION_6]', 82, 'object')]),
    ]
    const classification = classifyAcceptedPredicates(sentence, core, predicates)
    expect(classification.accepted.map((p) => p.text)).toEqual(['can be rotated'])
    expect(classification.rejected.map((p) => p.text)).toEqual(['using'])
    expect(classification.dropped).toContainEqual({ text: 'using', reason: 'no coordination evidence after "can be rotated"' })

    const merged = mergeHybridPredicateStructure(sentence, core, structureOf(predicates))
    expect(merged.predicates.map((p) => p.text)).toEqual(classification.accepted.map((p) => p.text))
    expect(merged.dropped).toEqual(classification.dropped)
  })

  it('reflects subject-containment filtering in `dropped` (item 12/13\'s Step 1, which runs before the accepted/rejected split)', () => {
    const sentence = 'Collecting reliable field data takes considerable time.'
    const core = coreOf({ subject: span('Collecting reliable field data', 0), verb: span('takes', 31), pattern: 'SVO' })
    const predicates = [predicate('Collecting', 0, 'main'), predicate('takes', 31, 'main', [dependent('considerable time', 37, 'complement')])]
    const classification = classifyAcceptedPredicates(sentence, core, predicates)
    expect(classification.accepted.map((p) => p.text)).toEqual(['takes'])
    // Step-1-filtered candidates never enter the accepted/rejected split at all -- only
    // `dropped` records them (matching the merger's own equivalent behavior).
    expect(classification.rejected).toEqual([])
    expect(classification.dropped).toContainEqual({ text: 'Collecting', reason: 'subject-contained (e.g. gerund head)' })
  })

  it('injects a synthetic anchor from a grounded core.verb when no candidate is compatible, matching the merger\'s anchorInjected flag', () => {
    const sentence = 'The sensor operated normally.'
    const core = coreOf({ subject: span('The sensor', 0), verb: span('operated', 11), pattern: 'other' })
    const classification = classifyAcceptedPredicates(sentence, core, [])
    expect(classification.anchorInjected).toBe(true)
    expect(classification.accepted.map((p) => p.text)).toEqual(['operated'])

    const merged = mergeHybridPredicateStructure(sentence, core, structureOf([]))
    expect(merged.anchorInjected).toBe(true)
  })
})
