import type { Span } from '../schemas/grammarAnalysis.schema.ts'

export type SentenceCoreFailureReason =
  | 'NONE'
  | 'NULL_SUBJECT'
  | 'NULL_VERB'
  | 'UNGROUNDED_SUBJECT'
  | 'UNGROUNDED_VERB'
  | 'SUBJECT_VERB_OVERLAP'
  | 'SUBJECT_HEAD_OUTSIDE'
  | 'OTHER'

/**
 * True when both spans have resolved (non-negative) offsets and their ranges intersect,
 * treating start/end as a half-open [start, end) interval — ported unchanged from the
 * original isSentenceCoreFailure() logic (see below).
 */
function spansOverlap(a: Span, b: Span): boolean {
  if (a.start < 0 || a.end < 0 || b.start < 0 || b.end < 0) return false
  return Math.max(a.start, b.start) < Math.min(a.end, b.end)
}

/** True when `inner` falls fully within `outer`'s [start, end] bounds (inclusive). */
function isContainedWithin(outer: Span, inner: Span): boolean {
  if (outer.start < 0 || inner.start < 0) return true
  return outer.start <= inner.start && inner.end <= outer.end
}

/**
 * Prototype 2.3L — production port of the Prototype 2.3K feasibility spike's failure-reason
 * classifier. Distinguishes WHY a core is unusable so the caller can route to the repair
 * strategy validated for that specific shape (analyzeSentenceWithAutoRecovery.ts):
 * SUBJECT_VERB_OVERLAP -> FocusedSubjectVerbRepairer.ts (2.3K: 61/61 correct on actual
 * routed cases), everything else -> the existing forced-core recovery (2.3G/H/J/K found
 * forced-core structurally unsuited to SUBJECT_VERB_OVERLAP specifically — 0/30 correct on
 * the primary target — but it remains the validated path for NULL_SUBJECT/NULL_VERB/
 * SUBJECT_HEAD_OUTSIDE, unchanged since Prototype 2.2).
 *
 * IMPORTANT (item 6 of the 2.3L order): this function's NONE/non-NONE partition is kept
 * EXACTLY behaviorally equivalent to the original isSentenceCoreFailure() boolean —
 * UNGROUNDED_SUBJECT/UNGROUNDED_VERB are declared in the enum (the 2.3K spike's superset
 * diagnostic surface) but are deliberately NEVER returned by this production version: the
 * original boolean's own overlap/containment checks both treat an ungrounded span as "not
 * a problem" (see spansOverlap/isContainedWithin above, ported unchanged, which return
 * false/true respectively whenever a span has start<0) and existing tests/production
 * behavior depend on that. Detecting ungrounded spans as a genuine failure trigger would
 * WIDEN which cores get routed for repair at all — a real behavior change the 2.3K spike
 * never validated end-to-end. That widening is deliberately deferred; the two ungrounded
 * variants stay in the type for future use once validated, not promoted silently now.
 */
export function classifySentenceCoreFailure(core: {
  subject: Span | null
  subjectHead: Span | null
  verb: Span | null
}): SentenceCoreFailureReason {
  if (core.subject === null) return 'NULL_SUBJECT'
  if (core.verb === null) return 'NULL_VERB'
  if (spansOverlap(core.subject, core.verb)) return 'SUBJECT_VERB_OVERLAP'
  if (core.subjectHead !== null && !isContainedWithin(core.subject, core.subjectHead)) return 'SUBJECT_HEAD_OUTSIDE'
  return 'NONE'
}
