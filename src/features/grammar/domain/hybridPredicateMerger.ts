import type { SentenceCore, SentenceCoreSet, Span } from '../schemas/grammarAnalysis.schema.ts'
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
  /** Present only when an authoritative Stage-1 SVC complement adopts a Stage-2
   * dependent as decomposition detail. PredicateStructure itself remains fixed-depth;
   * this preserves that dependent's existing leaves while moving the whole subtree. */
  children?: HybridLeaf[]
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
  /** Canonical five-pattern authority. Tree presentation remains legacy-projection based
   * in E1, but Stage 2 may never replace, merge, or discard these predicate cores. */
  canonicalCoreSet?: SentenceCoreSet | null
  subject: Span | null
  subjectModifiers: ResolvedLeaf[]
  predicates: HybridPredicate[]
  sentenceModifiers: ResolvedLeaf[]
  /** Stage-2 sentence modifiers suppressed from visible sibling placement because a sole
   * authoritative SVC complement owns their overlap. Retained as grounded presentation
   * evidence (Prototype 2.6B4), never restored as independent Tree nodes. */
  suppressedOverlappingModifiers?: ResolvedLeaf[]
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

export interface WorkingPredicate {
  text: string
  start: number
  end: number
  relation: PredicateRelation
  dependents: ResolvedDependent[]
}

export interface AcceptedPredicateClassification {
  /** Candidates that survive Steps 1–4, in final sorted (source) order — exactly the set
   * that will become `finalPredicates` in the merged result. */
  accepted: WorkingPredicate[]
  /** Candidates rejected at any of Steps 1–4, in their original relative order. */
  rejected: WorkingPredicate[]
  /** The one candidate anchored to sentenceCore.verb (Step 3), if any. */
  anchor: WorkingPredicate | undefined
  dropped: DroppedCandidate[]
  anchorInjected: boolean
}

/**
 * Prototype 2.5W (item 28/29) — Steps 1–4 of mergeHybridPredicateStructure, extracted
 * verbatim into a standalone pure helper so a second caller (the focused where-clause
 * repair's accepted-predicate candidate list) can share the SAME authority the merger
 * itself uses for which predicate candidates actually survive, rather than duplicating this
 * logic. Byte-for-byte behaviorally identical to the inline version it replaced — see
 * hybridPredicateMerger.test.ts's "Steps 1–4 extraction" regression suite (item 30).
 */
export function classifyAcceptedPredicates(
  sentence: string,
  sentenceCore: SentenceCore,
  predicates: PredicateStructure['predicates'],
): AcceptedPredicateClassification {
  const dropped: DroppedCandidate[] = []
  const subject = isGrounded(sentenceCore.subject) ? sentenceCore.subject : null
  const coreVerb = sentenceCore.verb

  // --- Step 1: subject-containment filter (item 12) + pre-subject filter (item 13) ---
  let candidates: WorkingPredicate[] = predicates.filter((p) => {
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

  return {
    accepted: sorted.filter((_, i) => accepted[i]),
    rejected: sorted.filter((_, i) => !accepted[i]),
    anchor,
    dropped,
    anchorInjected,
  }
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
  canonicalCoreSet: SentenceCoreSet | null = null,
): HybridMergedStructure {
  const subject = isGrounded(sentenceCore.subject) ? sentenceCore.subject : null
  const { accepted, rejected, anchor, dropped, anchorInjected } = classifyAcceptedPredicates(sentence, sentenceCore, structure.predicates)

  // Rejecting a candidate here means we don't trust it as its own predicate (e.g. a
  // participial phrase the model mistook for a coordinated verb) — but its dependents are
  // still real, grounded content (e.g. an equation placeholder) that must not silently
  // vanish. Demote them to sentence-level modifiers instead of discarding them.
  const salvagedModifiers: ResolvedLeaf[] = rejected.flatMap((p) =>
    p.dependents.flatMap((d) => [{ text: d.text, start: d.start, end: d.end, role: d.role }, ...d.children]),
  )

  const finalPredicates: HybridPredicate[] = accepted.map((p) => {
    const isCoreAnchor = anchor ? sameSpan(p, anchor) : false
    // Prototype 2.6B2: Stage 2 sometimes over-captures complement-prefix words into a
    // copular predicate (e.g. "are the two types"). Once Stage 1 has accepted SVC and
    // grounded its verb, that verb is the display/span authority for the anchor. Keep the
    // Stage-2 candidate's dependents, but never let its broader predicate surface corrupt
    // the pedagogical V node.
    const displayedPredicate =
      isCoreAnchor && sentenceCore.pattern === 'SVC' && isGrounded(sentenceCore.verb) ? sentenceCore.verb : p
    return {
      text: displayedPredicate.text,
      start: displayedPredicate.start,
      end: displayedPredicate.end,
      relation: isCoreAnchor ? 'main' : 'coordinated',
      dependents: p.dependents.map(toHybridDependent),
      isCoreAnchor,
    }
  })

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

      // Prototype 2.6B: for an accepted SVC core, Stage 1's grounded complement is the
      // top-level constituent authority. Stage 2 may decompose that complement, but a
      // contained Stage-2 dependent (including a model-invented `object` under a copula)
      // must not compete with the full C as its sibling. Re-parent only by source-span
      // containment and only in the SVC/complement channel; SVO and SVOC ownership is
      // deliberately untouched. Exact-span Stage-2 nodes become the authoritative C
      // itself, preserving their children without nesting a node inside itself.
      if (slotName === 'complement' && sentenceCore.pattern === 'SVC') {
        const owned = anchorNode.dependents.filter((d) => fullyContains(slotSpan, d))
        if (owned.length > 0) {
          const exact = owned.find((d) => sameSpan(d, slotSpan))
          const strictChildren = owned
            .filter((d) => !sameSpan(d, slotSpan))
            .flatMap((d) => {
              // Prototype 2.6B2: SVC has no object slot. A Stage-2 `object` fully owned by
              // authoritative C is only a redundant head/base wrapper, whether it starts
              // with C ("the two types...") or follows words Stage 2 over-captured into
              // the predicate ("of evaluation units"). Do not render that wrapper. Its
              // already-grounded children, if any, still carry independent decomposition
              // information and are therefore lifted rather than discarded.
              if (d.role === 'object') return d.children
              return [dependentToHybridLeaf(d)]
            })
          const exactChildren = exact?.children ?? []
          anchorNode.dependents = anchorNode.dependents.filter((d) => !owned.includes(d))
          anchorNode.dependents.push({
            text: slotSpan.text,
            start: slotSpan.start,
            end: slotSpan.end,
            role: 'complement',
            children: [...exactChildren, ...strictChildren].sort((a, b) => a.start - b.start),
          })
          continue
        }
      }

      if (alreadyPresent) continue

      // Prototype 2.5U redundancy condition (item 14): a core slot whose span both (A)
      // overlaps the anchor predicate's OWN text (e.g. Stage 1 folded the predicate nominal
      // itself into its object/complement span, as with "is a function of X" -> object "a
      // function of X") AND (B) fully contains an already-grounded Stage-2 dependent of that
      // same anchor is redundant with content Stage 2 already represents more precisely —
      // injecting it would only duplicate that dependent under a wider, sloppier span.
      // Deliberately narrower than a bare overlap check (item 13): a slot that merely
      // overlaps the anchor without containing any existing dependent, or that contains a
      // dependent without touching the anchor's own text, still gets attached normally.
      const redundantWithAnchor =
        overlapsOrContains(slotSpan, anchorNode) && anchorNode.dependents.some((d) => fullyContains(slotSpan, d))
      if (redundantWithAnchor) {
        suppressed.push({ slot: slotName, text: slotSpan.text, reason: 'redundant with an existing dependent of the anchor predicate' })
        continue
      }

      anchorNode.dependents.push({ text: slotSpan.text, start: slotSpan.start, end: slotSpan.end, role: slotName, children: [] })
    }
    anchorNode.dependents.sort((a, b) => a.start - b.start)
  }

  finalPredicates.sort((a, b) => a.start - b.start)

  let sentenceModifiers = [...structure.sentenceModifiers, ...salvagedModifiers].sort((a, b) => a.start - b.start)
  const suppressedOverlappingModifiers: ResolvedLeaf[] = []

  // Prototype 2.6B1: a sole accepted SVC predicate gives Stage 1's complement exclusive
  // ownership of source that STARTS inside its grounded span. A Stage-2 sentenceModifier
  // fully inside C can be retained as decomposition detail; one that crosses C's right
  // boundary cannot be represented as its child without lying about containment, so use
  // the requested safe simplified fallback and omit that redundant Tree fragment. This is
  // intentionally directional and narrow: left-crossing/other partial overlaps, multiple
  // predicates, SVO/SVOC, and ordinary predicate dependents are all left untouched.
  if (anchorNode && finalPredicates.length === 1 && sentenceCore.pattern === 'SVC' && isGrounded(sentenceCore.complement)) {
    const complementNode = anchorNode.dependents.find((d) => d.role === 'complement' && sameSpan(d, sentenceCore.complement!))
    if (complementNode) {
      const retained: ResolvedLeaf[] = []
      for (const modifier of sentenceModifiers) {
        const startsInsideComplement =
          sentenceCore.complement.start <= modifier.start && modifier.start < sentenceCore.complement.end
        if (!startsInsideComplement) {
          retained.push(modifier)
          continue
        }
        if (modifier.end <= sentenceCore.complement.end && !sameSpan(modifier, sentenceCore.complement)) {
          complementNode.children.push(toHybridLeaf(modifier))
        } else {
          suppressedOverlappingModifiers.push(modifier)
        }
        // Exact-span and right-crossing fragments are already represented by the
        // authoritative C and intentionally do not become competing Tree nodes.
      }
      complementNode.children.sort((a, b) => a.start - b.start)
      sentenceModifiers = retained
    }
  }

  return {
    canonicalCoreSet,
    subject,
    subjectModifiers: structure.subjectModifiers,
    predicates: finalPredicates,
    sentenceModifiers,
    suppressedOverlappingModifiers,
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

function dependentToHybridLeaf(dependent: HybridDependent): HybridLeaf {
  return {
    text: dependent.text,
    start: dependent.start,
    end: dependent.end,
    role: dependent.role,
    children: dependent.children,
  }
}
