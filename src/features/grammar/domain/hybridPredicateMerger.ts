import type { SentenceCore, Span } from '../schemas/grammarAnalysis.schema.ts'
import type { PredicateRelation, PredicateStructure, ResolvedDependent, ResolvedLeaf, StructureRole } from '../schemas/predicateStructure.schema.ts'

/**
 * Prototype 2.3C — production port of the Prototype 2.3B feasibility spike's deterministic
 * hybrid predicate merger, UNSIMPLIFIED (item 10 of the 2.3C order: "今回spikeで確定した
 * ロジックを不用意に簡略化しないこと"). PURE function, no LLM calls: combines the
 * already-confirmed sentenceCore (from analyzeSentenceWithAutoRecovery) with a raw
 * (already grounded) PredicateStructure result (PredicateStructureAnalyzer.ts) into a
 * final predicate tree, using only original-source-text-grounded spans.
 *
 * See docs/design-notes.md (Prototype 2.3B) for the acceptance numbers this exact
 * algorithm was validated against: Primary Reno/Green leaves/Active coordination/Triple
 * predicate all 20/20 with BAD=0, Gerund/Preposed/That-clause/Relative/Simple SVO
 * negative controls all clean, MERGER_REGRESSION=0 across 140 spike runs.
 */

/** Dependent/leaf role space: the 7 roles the structure analyzer itself can emit
 * (StructureRole) plus "indirectObject", which only ever comes from a core-slot injection
 * (step 5 below) — the structure analyzer's own schema has no such role. */
export type HybridDependentRole = StructureRole | 'indirectObject'

export interface HybridLeaf {
  text: string
  start: number
  end: number
  role: HybridDependentRole
}

export interface HybridDependent {
  text: string
  start: number
  end: number
  role: HybridDependentRole
  children: HybridLeaf[]
}

export interface HybridPredicate {
  text: string
  start: number
  end: number
  relation: PredicateRelation
  dependents: HybridDependent[]
  isCoreAnchor: boolean
}

export interface DroppedCandidate {
  text: string
  reason: string
}

export interface SuppressedCoreDependent {
  slot: 'indirectObject' | 'object' | 'complement'
  text: string
  reason: string
}

export interface HybridMergedStructure {
  subject: Span | null
  subjectModifiers: ResolvedLeaf[]
  predicates: HybridPredicate[]
  sentenceModifiers: ResolvedLeaf[]
  /** Structure-analyzer predicate candidates that did NOT make it into the final tree,
   * with why — for debugging/reporting (Prototype 2.3B item 26/Q), never shown to the user. */
  dropped: DroppedCandidate[]
  /** Core O/IO/C slots hidden from the tree because they overlap/contain an accepted
   * coordinated predicate span (item 14) — GrammarAnalysis's own result is unchanged. */
  suppressedCoreDependents: SuppressedCoreDependent[]
  /** True when no structure-analyzer candidate was compatible with sentenceCore.verb at
   * all, so a synthetic anchor node had to be injected from sentenceCore alone. */
  anchorInjected: boolean
}

const COORDINATION_MARKER = /\b(and|or|but|nor|yet)\b/i

function hasCoordinationEvidence(gapText: string): boolean {
  return COORDINATION_MARKER.test(gapText) || gapText.includes(',')
}

interface AnySpan {
  start: number
  end: number
}

function fullyContains(outer: AnySpan, inner: AnySpan): boolean {
  return outer.start <= inner.start && inner.end <= outer.end
}

/** True if the spans overlap at all, OR one fully contains the other (item 14's
 * "overlap or contain" contamination trigger). */
function overlapsOrContains(a: AnySpan, b: AnySpan): boolean {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end) || fullyContains(a, b) || fullyContains(b, a)
}

function sameSpan(a: AnySpan, b: AnySpan): boolean {
  return a.start === b.start && a.end === b.end
}

function isGrounded(span: Span | null | undefined): span is Span {
  return !!span && span.start >= 0 && span.end >= 0
}

/** Fallback for when core.verb fails to ground (start/end = -1) because the LLM's claimed
 * verb text (e.g. "were stored") is a paraphrase that never appears as one contiguous span
 * in the source (elided shared auxiliary across a coordinated verb chain: "were dried,
 * weighed, and stored" -- only "were dried" and "stored" are literal substrings). Compare
 * the last content word only: robust to aux-verb differences, still conservative. */
function lastWordMatches(coreVerbText: string, candidateText: string): boolean {
  const lastWord = (s: string) => s.trim().split(/\s+/).pop()?.toLowerCase()
  return lastWord(coreVerbText) === lastWord(candidateText)
}

interface WorkingPredicate {
  text: string
  start: number
  end: number
  relation: PredicateRelation
  dependents: ResolvedDependent[]
}

/**
 * @param sentence - normalizedText (same coordinate space as sentenceCore spans and as
 *   what was passed to PredicateStructureAnalyzer).
 * @param sentenceCore - the already-confirmed, already-grounded SentenceCore
 *   (analyzeSentenceWithAutoRecovery's result — post forced-core recovery if that ran).
 * @param structure - the already-grounded PredicateStructure (PredicateStructureAnalyzer's
 *   result).
 */
export function mergeHybridPredicateStructure(
  sentence: string,
  sentenceCore: SentenceCore,
  structure: PredicateStructure,
): HybridMergedStructure {
  const dropped: DroppedCandidate[] = []
  const subject = isGrounded(sentenceCore.subject) ? sentenceCore.subject : null
  const coreVerb = sentenceCore.verb

  // --- Step 1: subject-containment filter (item 12) + pre-subject filter (item 13) ---
  let candidates: WorkingPredicate[] = structure.predicates.filter((p) => {
    if (subject && fullyContains(subject, p)) {
      dropped.push({ text: p.text, reason: 'subject-contained (e.g. gerund head)' })
      return false
    }
    if (subject && p.end <= subject.start) {
      dropped.push({ text: p.text, reason: 'pre-subject (preposed clause/phrase)' })
      return false
    }
    return true
  })

  // --- Step 2: exact-span duplicate collapse (item 14), dependents merged ---
  const bySpan = new Map<string, WorkingPredicate>()
  for (const p of candidates) {
    const key = `${p.start}:${p.end}`
    const existing = bySpan.get(key)
    if (!existing) {
      bySpan.set(key, { ...p, dependents: [...p.dependents] })
      continue
    }
    const seenDepSpans = new Set(existing.dependents.map((d) => `${d.start}:${d.end}`))
    for (const d of p.dependents) {
      const dKey = `${d.start}:${d.end}`
      if (!seenDepSpans.has(dKey)) {
        existing.dependents.push(d)
        seenDepSpans.add(dKey)
      }
    }
  }
  candidates = [...bySpan.values()]

  // --- Step 3: core verb anchor (item 15/16) ---
  // "exact/compatible span" resolved as a 4-stage fallback (Prototype 2.3B item 15):
  // exact grounded span -> overlap/containment -> last-lexical-word text compatibility ->
  // the structure analyzer's own relation="main" designation. Synthetic injection from
  // sentenceCore alone is the LAST resort, and only when core.verb is itself grounded
  // (item 16 — an ungrounded (-1,-1) span must never become a tree node).
  let anchor: WorkingPredicate | undefined
  if (coreVerb) {
    if (isGrounded(coreVerb)) {
      anchor = candidates.find((p) => sameSpan(p, coreVerb)) ?? candidates.find((p) => overlapsOrContains(p, coreVerb))
    }
    if (!anchor) {
      anchor = candidates.find((p) => lastWordMatches(coreVerb.text, p.text))
    }
  }
  if (!anchor) {
    anchor = candidates.find((p) => p.relation === 'main')
  }
  let anchorInjected = false
  if (!anchor && coreVerb && isGrounded(coreVerb)) {
    anchor = { text: coreVerb.text, start: coreVerb.start, end: coreVerb.end, relation: 'main', dependents: [] }
    candidates.push(anchor)
    anchorInjected = true
  }

  // --- Step 4: coordination-evidence chain around the anchor (item 17) ---
  const sorted = [...candidates].sort((a, b) => a.start - b.start)
  const anchorIdx = anchor ? sorted.findIndex((p) => sameSpan(p, anchor!)) : -1
  const accepted = new Array<boolean>(sorted.length).fill(false)
  if (anchorIdx >= 0) accepted[anchorIdx] = true
  for (let i = anchorIdx + 1; i < sorted.length; i++) {
    const gap = sentence.slice(sorted[i - 1].end, sorted[i].start)
    accepted[i] = hasCoordinationEvidence(gap)
    if (!accepted[i]) dropped.push({ text: sorted[i].text, reason: `no coordination evidence after "${sorted[i - 1].text}"` })
  }
  for (let i = anchorIdx - 1; i >= 0; i--) {
    const gap = sentence.slice(sorted[i].end, sorted[i + 1].start)
    accepted[i] = hasCoordinationEvidence(gap)
    if (!accepted[i]) dropped.push({ text: sorted[i].text, reason: `no coordination evidence before "${sorted[i + 1].text}"` })
  }

  const finalPredicates: HybridPredicate[] = sorted
    .filter((_, i) => accepted[i])
    .map((p) => ({
      text: p.text,
      start: p.start,
      end: p.end,
      relation: anchor && sameSpan(p, anchor) ? 'main' : 'coordinated',
      dependents: p.dependents.map(toHybridDependent),
      isCoreAnchor: anchor ? sameSpan(p, anchor) : false,
    }))

  // --- Step 5: core O/IO/C contamination check + attachment (item 18/19) ---
  const suppressed: SuppressedCoreDependent[] = []
  const anchorNode = finalPredicates.find((p) => p.isCoreAnchor)
  if (anchorNode) {
    const coreSlots: ReadonlyArray<[SuppressedCoreDependent['slot'], Span | null]> = [
      ['indirectObject', sentenceCore.indirectObject],
      ['object', sentenceCore.object],
      ['complement', sentenceCore.complement],
    ]
    for (const [slotName, slotSpan] of coreSlots) {
      if (!slotSpan || !isGrounded(slotSpan)) continue
      const contaminated = finalPredicates.some((p) => !p.isCoreAnchor && overlapsOrContains(slotSpan, p))
      if (contaminated) {
        suppressed.push({ slot: slotName, text: slotSpan.text, reason: 'overlaps/contains an accepted coordinated predicate' })
        continue
      }
      const alreadyPresent = anchorNode.dependents.some((d) => sameSpan(d, slotSpan))
      if (!alreadyPresent) {
        anchorNode.dependents.push({ text: slotSpan.text, start: slotSpan.start, end: slotSpan.end, role: slotName, children: [] })
      }
    }
    anchorNode.dependents.sort((a, b) => a.start - b.start)
  }

  finalPredicates.sort((a, b) => a.start - b.start)

  return {
    subject,
    subjectModifiers: structure.subjectModifiers,
    predicates: finalPredicates,
    sentenceModifiers: structure.sentenceModifiers,
    dropped,
    suppressedCoreDependents: suppressed,
    anchorInjected,
  }
}

function toHybridDependent(dep: ResolvedDependent): HybridDependent {
  return {
    text: dep.text,
    start: dep.start,
    end: dep.end,
    role: dep.role,
    children: dep.children.map(toHybridLeaf),
  }
}

function toHybridLeaf(leaf: ResolvedLeaf): HybridLeaf {
  return { text: leaf.text, start: leaf.start, end: leaf.end, role: leaf.role }
}
