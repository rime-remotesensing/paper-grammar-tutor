import type {
  LlmSentenceCore,
  LlmSentenceCoreSet,
  LlmPredicateCore,
  PredicateCore,
  SentenceCore,
  SentenceCoreSet,
  Span,
} from '../schemas/grammarAnalysis.schema.ts'
import { attachDerivedPattern } from './derivePattern.ts'

function overlaps(a: Span, b: Span): boolean {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end)
}

function coreSlots(core: LlmPredicateCore): LlmSentenceCore {
  return {
    subject: null,
    subjectHead: null,
    verb: core.verb,
    indirectObject: core.indirectObject,
    object: core.object,
    complement: core.complement,
  }
}

const BARE_COPULA = /^(?:is|are|was|were|be|been|being)$/i
const PASSIVE_WITH_TRAILING_WORD = /^((?:(?:can|could|will|would|may|might|must|shall|should)\s+)?(?:is|are|was|were|be|been|being)\s+\S+(?:ed|en))\s+\S+$/i
const PASSIVE_VERB = /^(?:(?:can|could|will|would|may|might|must|shall|should)\s+)?(?:is|are|was|were|be|been|being)\s+\S+(?:ed|en)$/i
const TRAILING_PREPOSITION = /\s+(?:about|across|after|against|along|among|around|at|before|behind|below|beneath|beside|between|beyond|by|during|for|from|in|into|of|on|onto|over|through|to|toward|under|with|within|without)$/i
const LEADING_PREPOSITION = /^(?:about|across|after|against|along|among|around|at|before|behind|below|beneath|beside|between|beyond|by|during|for|from|in|into|of|on|onto|over|through|to|toward|under|with|within|without)\b/i

function isEmptyCore(core: LlmPredicateCore): boolean {
  return !core.connector && !core.verb && !core.indirectObject && !core.object && !core.complement
}

function normalizeVerbBoundary(core: LlmPredicateCore): LlmPredicateCore {
  if (!core.verb) return core
  const text = core.verb.text.trim().replace(TRAILING_PREPOSITION, '')
  if (text === core.verb.text.trim()) return core
  return { ...core, verb: { text, start: core.verb.start, end: core.verb.start + text.length } }
}

function normalizePassiveVerbBoundary(core: LlmPredicateCore): LlmPredicateCore {
  if (!core.verb) return core
  const match = core.verb.text.trim().match(PASSIVE_WITH_TRAILING_WORD)
  if (!match) return core
  const text = match[1]
  return {
    ...core,
    verb: { text, start: core.verb.start, end: core.verb.start + text.length },
    indirectObject: null,
    object: null,
    complement: null,
  }
}

function normalizePassivePrepositionalSlots(core: LlmPredicateCore): LlmPredicateCore {
  if (!core.verb || !PASSIVE_VERB.test(core.verb.text.trim())) return core
  return {
    ...core,
    indirectObject: core.indirectObject && LEADING_PREPOSITION.test(core.indirectObject.text.trim()) ? null : core.indirectObject,
    object: core.object && LEADING_PREPOSITION.test(core.object.text.trim()) ? null : core.object,
    complement: core.complement && LEADING_PREPOSITION.test(core.complement.text.trim()) ? null : core.complement,
  }
}

function normalizeCopularSlots(core: LlmPredicateCore): LlmPredicateCore {
  if (!core.verb || !BARE_COPULA.test(core.verb.text.trim()) || !core.object || core.complement) return core
  return { ...core, object: null, complement: core.object }
}

function normalizePassiveComplementBoundary(core: LlmPredicateCore): LlmPredicateCore {
  if (!core.verb || !BARE_COPULA.test(core.verb.text.trim()) || !core.complement) return core
  const match = core.complement.text.trim().match(/^(\S+(?:ed|en))\s+\S+/i)
  if (!match) return core
  const verbText = `${core.verb.text.trim()} ${match[1]}`
  return {
    ...core,
    verb: { text: verbText, start: core.verb.start, end: core.verb.start + verbText.length },
    complement: null,
  }
}

export function materializeSentenceCoreSet(value: LlmSentenceCoreSet): SentenceCoreSet {
  const nonEmptyCores = value.predicateCores.filter((core) => !isEmptyCore(core))
  const sourceCores = nonEmptyCores.length > 0 ? nonEmptyCores : value.predicateCores.slice(0, 1)
  return {
    subject: value.subject,
    subjectHead: value.subjectHead,
    predicateCores: sourceCores.map((rawCore, index) => {
      const core = normalizeCopularSlots(normalizePassiveComplementBoundary(normalizePassivePrepositionalSlots(
        normalizeVerbBoundary(normalizePassiveVerbBoundary(rawCore)),
      )))
      return {
        ...core,
        predicateCoreId: `predicate-${index + 1}`,
        relation: index === 0 ? 'main' : 'coordinated',
        pattern: attachDerivedPattern(coreSlots(core)).pattern,
      }
    }),
  }
}

/** Deterministic legacy projection: always the first/main predicate in source order. */
export function projectPrimaryCore(coreSet: SentenceCoreSet): SentenceCore {
  const primary = coreSet.predicateCores[0]
  return attachDerivedPattern({
    subject: coreSet.subject,
    subjectHead: coreSet.subjectHead,
    verb: primary?.verb ?? null,
    indirectObject: primary?.indirectObject ?? null,
    object: primary?.object ?? null,
    complement: primary?.complement ?? null,
  })
}

/** Applies established focused/forced repair evidence to the canonical primary core, then
 * regenerates the legacy projection. Secondary predicate cores are never collapsed. */
export function replacePrimaryCoreFromRepair(coreSet: SentenceCoreSet, repaired: SentenceCore): SentenceCoreSet {
  const primary = coreSet.predicateCores[0]
  const replacement: PredicateCore = {
    predicateCoreId: primary?.predicateCoreId ?? 'predicate-1',
    relation: 'main',
    connector: null,
    verb: repaired.verb,
    indirectObject: repaired.indirectObject,
    object: repaired.object,
    complement: repaired.complement,
    pattern: repaired.pattern,
  }
  return {
    subject: repaired.subject,
    subjectHead: repaired.subjectHead,
    predicateCores: [replacement, ...coreSet.predicateCores.slice(1)],
  }
}

/** Post-grounding structural validation. Offsets supplied by the model are deliberately not
 * trusted; this runs only after resolveAnalysisSpans has mapped text to source coordinates. */
export function validateGroundedSentenceCoreSet(coreSet: SentenceCoreSet): string[] {
  const issues: string[] = []
  if (coreSet.predicateCores.length === 0) return ['predicateCores must contain at least one core']
  for (const [index, core] of coreSet.predicateCores.entries()) {
    if (index === 0 && core.relation !== 'main') issues.push('predicateCores.0.relation must be main')
    if (index > 0 && core.relation !== 'coordinated') issues.push(`predicateCores.${index}.relation must be coordinated`)
    if (index === 0 && core.connector !== null) issues.push('predicateCores.0.connector must be null')
    if (!core.verb || core.verb.start < 0) continue // existing recovery owns null/ungrounded S/V
    const previous = coreSet.predicateCores[index - 1]
    if (index > 0 && previous?.verb && previous.verb.start >= core.verb.start) {
      issues.push(`predicateCores.${index}.verb is not in source order`)
    }
    for (const earlier of coreSet.predicateCores.slice(0, index)) {
      if (earlier.verb && overlaps(earlier.verb, core.verb)) {
        issues.push(`predicateCores.${index}.verb overlaps another predicate core`)
        break
      }
    }
    if (core.connector && index > 0 && previous?.verb &&
      !(previous.verb.end <= core.connector.start && core.connector.end <= core.verb.start)) {
      issues.push(`predicateCores.${index}.connector is outside the predicate gap`)
    }
  }
  return issues
}
