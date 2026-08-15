import type { SentenceCore, Span } from '../schemas/grammarAnalysis.schema.ts'
import type { ComplementVerification } from './analyzeSentenceWithComplementVerification.ts'
import type { HybridMergedStructure, HybridPredicate } from './hybridPredicateMerger.ts'

/**
 * Prototype 2.3O items 30-34: 2.3N's re-diagnosis of 2.3M's live "not_applicable 2/8"
 * finding (item A of the 2.3N report) confirmed those runs are raw GrammarAnalysis
 * genuinely returning SVO/C=null from the start — commaIngComplementGate.ts's gate never
 * even fires, because it only ever looks at `core.complement`, which is already null. In
 * that shape the Focused Complement Verifier is correctly never called (there is no SVOC
 * candidate to verify), but Prototype 2.3M's `verifiedSupplementSpan` was ONLY ever set from
 * `verification.status === 'confirmed_supplementary_ing'` — so this raw-SVO shape silently
 * fell back to the pre-2.3I/2.3M rendering (the "emphasizing" predicate left in the subject's
 * main predicate list, displayed as a coordinated predicate) even though the source text
 * still visibly has the same ", emphasizing ..." shape.
 *
 * This function extends supplement-span authority to that raw-SVO case WITHOUT a new LLM
 * call (item 32 explicitly forbids adding one this round) and without weakening the
 * existing OBJECT_COMPLEMENT vs SUPPLEMENTARY_ING distinction the Focused Complement
 * Verifier already owns: `core.complement !== null` is used as the guard, and it is
 * sufficient on its own to isolate exactly the intended case --
 * - `confirmed_object_complement` / `uncertain` leave `core.complement` non-null (only
 *   SUPPLEMENTARY_ING nulls it), so this function's second branch never fires for them;
 * - `not_applicable` while the gate's own SVOC-shape precondition held (a real SVOC
 *   candidate that just didn't match the comma+ing surface pattern) also leaves
 *   `core.complement` non-null;
 * - only `not_applicable` with `core.complement === null` (raw GrammarAnalysis never
 *   produced an SVOC candidate at all) reaches the fallback below.
 *
 * The fallback itself reuses the EXACT same conservative surface signal
 * commaIngComplementGate.ts already established and validated (comma immediately before,
 * candidate's own first token ends in "ing") — just applied to a HybridPredicate's own
 * grounded span instead of `core.complement`, since in this shape there is no complement
 * span to check in the first place. This is safe specifically because there is no
 * OBJECT_COMPLEMENT-vs-SUPPLEMENTARY_ING ambiguity left to resolve here: GrammarAnalysis's
 * own SVO judgment already means "this is not part of the core S/V/O/C pattern" -- the only
 * remaining question is a presentation one ("should this predicate be pulled out of the
 * subject's main predicate list for display"), which the surface signal alone safely answers.
 */
export function isSuspiciousCommaIngPredicate(originalText: string, core: SentenceCore, predicate: HybridPredicate): boolean {
  if (core.complement !== null) return false
  if (!core.object) return false
  if (predicate.start < core.object.end) return false
  const gap = originalText.slice(core.object.end, predicate.start)
  if (!gap.includes(',')) return false
  return /^[a-zA-Z]+ing\b/.test(predicate.text.trim())
}

/**
 * Resolves the single span buildHybridStructureTree should treat as a verified supplement,
 * per the authority precedence in the doc comment above:
 * 1. Prototype 2.3I/2.3M's existing authority (`confirmed_supplementary_ing`) — unchanged.
 * 2. Prototype 2.3O's raw-SVO fallback — only reached when `core.complement === null` and
 *    the gate never had a real SVOC candidate to evaluate in the first place.
 */
export function resolveSupplementSpan(
  originalText: string,
  core: SentenceCore,
  rawCore: SentenceCore,
  verification: ComplementVerification,
  hybrid: HybridMergedStructure,
): Span | null {
  if (verification.status === 'confirmed_supplementary_ing') return rawCore.complement
  const candidate = hybrid.predicates.find((p) => isSuspiciousCommaIngPredicate(originalText, core, p))
  return candidate ? { text: candidate.text, start: candidate.start, end: candidate.end } : null
}
