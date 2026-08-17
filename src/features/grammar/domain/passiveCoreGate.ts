import type { Span, SentencePattern } from '../schemas/grammarAnalysis.schema.ts'

/**
 * Prototype 2.5Z — production port of the Prototype 2.5Y spike's passive-core-overcomplement
 * suspicion gate. Two independent broad conditions must BOTH hold (item 8): (A) the verb is
 * passive-shaped (modal + bare "be" + past participle, or bare "be" + past participle) and
 * (B) the current core claims a non-null complement under an SVC/SVOC pattern. Never a final
 * grammatical decision (item 13) — only "suspicious enough to verify"; the actual
 * pattern/complement answer always comes from FocusedPassiveCoreRepairer.
 *
 * Validated in Prototype 2.5Y: 15/15 correct triggers+repairs (10/10 exact CASE B, 5/5
 * simplified "can be rotated to the horizontal"), 0/25 false triggers across 3 genuine
 * copular SVC sentences + 3 already-correct passive sentences.
 *
 * Deliberately duplicates its own small closed participle set rather than importing
 * copularCoreGate.ts's — same precedent as coordinationGroupPresentation.ts's own
 * intentional duplicate of hybridPredicateMerger.ts's COORDINATION_MARKER (that file's own
 * comment: safer than coupling two independent gates that must stay behaviorally distinct
 * even if their vocab happens to overlap today).
 *
 * Mutual exclusion with copularCoreGate (item 7): copularCoreGate's own BARE_COPULA regex
 * never matches a modal-led verb ("can be rotated" does not start with is/are/was/were/
 * been/being/be), and its own multi-word branch explicitly excludes anything that looks
 * passive — so by construction the two gates never both fire for the same verb shape. The
 * one theoretical overlap (a verb like "is introduced", passive-shaped, appearing as
 * copularCoreGate's OWN candidate) is moot in production because copularCoreGate is always
 * checked FIRST and returns early on fire — this gate is only ever reached when copularGate
 * did not fire.
 */

const MODAL = /^(can|could|will|would|may|might|must|shall|should)\s+/i
const BARE_BE = /^(is|are|was|were|been|being|be)\b/i
const COMMON_IRREGULAR_PARTICIPLES = new Set([
  'applied', 'based', 'defined', 'used', 'given', 'shown', 'known', 'found', 'made', 'taken',
  'written', 'done', 'seen', 'measured', 'normalized', 'calculated', 'derived', 'obtained',
  'introduced', 'described', 'observed', 'presented', 'estimated', 'computed', 'determined',
  'rotated',
])

function looksPassive(verbText: string): boolean {
  const stripped = verbText.replace(MODAL, '').trim()
  if (!BARE_BE.test(stripped)) return false
  const words = stripped.split(/\s+/)
  const second = words[1]?.toLowerCase().replace(/[.,;:]$/, '')
  return /ed$/.test(second ?? '') || COMMON_IRREGULAR_PARTICIPLES.has(second ?? '')
}

export interface PassiveCoreGateResult {
  fire: boolean
  reason: string
}

/**
 * @param verb - the core's own verb span (rawCore.verb).
 * @param pattern - the core's own derived pattern (rawCore.pattern).
 * @param complement - the core's own claimed complement span (rawCore.complement), or null.
 */
export function evaluatePassiveCoreGate(verb: Span | null, pattern: SentencePattern, complement: Span | null): PassiveCoreGateResult {
  if (!verb) return { fire: false, reason: 'no verb' }
  if (!looksPassive(verb.text)) return { fire: false, reason: 'verb is not passive-shaped' }
  if (pattern !== 'SVC' && pattern !== 'SVOC') return { fire: false, reason: 'pattern is not SVC/SVOC' }
  if (!complement) return { fire: false, reason: 'no complement claimed' }
  return { fire: true, reason: 'passive-shaped verb with a claimed SVC/SVOC complement' }
}
