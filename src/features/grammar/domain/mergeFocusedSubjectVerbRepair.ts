import { attachDerivedPattern } from './derivePattern.ts'
import type { LlmSentenceCore, SentenceCore, Span } from '../schemas/grammarAnalysis.schema.ts'
import type { FocusedSubjectVerbRepairResult } from './FocusedSubjectVerbRepairer.ts'

export interface DroppedDependent {
  text: string
  reason: 'ungrounded' | 'overlaps repaired subject' | 'overlaps repaired verb'
}

export interface MergeFocusedSubjectVerbRepairResult {
  core: SentenceCore
  dropped: DroppedDependent[]
}

function overlaps(a: Span, b: Span): boolean {
  if (a.start < 0 || b.start < 0) return false
  return Math.max(a.start, b.start) < Math.min(a.end, b.end)
}

/**
 * Prototype 2.3L — production port of the Prototype 2.3J/2.3K spike's merge simulation,
 * unchanged. Replaces subject/subjectHead/verb with the Focused Subject-Verb Repair's
 * result; NEVER regenerates indirectObject/object/complement itself (item 16 of the 2.3L
 * order) — each is preserved from the raw core only if mechanically safe (grounded, and
 * not overlapping the REPAIRED subject/verb spans), otherwise dropped to null rather than
 * guessed. Pattern is always re-derived via derivePattern.ts, never hand-set.
 */
export function mergeFocusedSubjectVerbRepair(
  rawCore: SentenceCore,
  focused: FocusedSubjectVerbRepairResult,
): MergeFocusedSubjectVerbRepairResult {
  const dropped: DroppedDependent[] = []

  const checkSlot = (slot: Span | null): Span | null => {
    if (!slot) return null
    if (slot.start < 0 || slot.end < 0) {
      dropped.push({ text: slot.text, reason: 'ungrounded' })
      return null
    }
    if (overlaps(slot, focused.subject)) {
      dropped.push({ text: slot.text, reason: 'overlaps repaired subject' })
      return null
    }
    if (overlaps(slot, focused.verb)) {
      dropped.push({ text: slot.text, reason: 'overlaps repaired verb' })
      return null
    }
    return slot
  }

  const mergedRaw: LlmSentenceCore = {
    subject: focused.subject,
    subjectHead: focused.subjectHead,
    verb: focused.verb,
    indirectObject: checkSlot(rawCore.indirectObject),
    object: checkSlot(rawCore.object),
    complement: checkSlot(rawCore.complement),
  }

  return { core: attachDerivedPattern(mergedRaw), dropped }
}
