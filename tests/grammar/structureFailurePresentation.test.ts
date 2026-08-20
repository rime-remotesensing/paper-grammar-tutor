import { describe, expect, it } from 'vitest'
import {
  isStructureTreeSuppliedByStanza,
  shouldShowPredicateStructureFailureWarning,
} from '../../src/features/grammar/domain/structureFailurePresentation.ts'

/**
 * Prototype 2.6G2-D2 -- Scope PredicateStructure Failure UI Correctly on the Stanza Authority
 * Path. Domain-level tests for the two pure decisions extracted from AnalysisResultPanel.tsx
 * (this codebase has no React-Testing-Library/jsdom setup, so component behavior is verified
 * via its extracted pure presentation logic, matching basicSkeletonPresentation.test.ts's own
 * convention).
 */
describe('Prototype 2.6G2-D2 -- PredicateStructure failure UI scoping', () => {
  describe('isStructureTreeSuppliedByStanza', () => {
    it('true when syntax authority is stanza AND stanzaTokens are present', () => {
      expect(isStructureTreeSuppliedByStanza('stanza', true)).toBe(true)
    })

    it('false when syntax authority is stanza but stanzaTokens are missing', () => {
      expect(isStructureTreeSuppliedByStanza('stanza', false)).toBe(false)
    })

    it('false on the legacy-qwen-fallback path regardless of stanzaTokens', () => {
      expect(isStructureTreeSuppliedByStanza('legacy-qwen-fallback', true)).toBe(false)
      expect(isStructureTreeSuppliedByStanza('legacy-qwen-fallback', false)).toBe(false)
    })
  })

  describe('shouldShowPredicateStructureFailureWarning', () => {
    it('(1) Stanza Tree success + PredicateStructure success -> no error', () => {
      expect(shouldShowPredicateStructureFailureWarning('success', true)).toBe(false)
    })

    it('(2)+(3) Stanza Tree success + PredicateStructure error -> no Tree-level warning/retry', () => {
      expect(shouldShowPredicateStructureFailureWarning('error', true)).toBe(false)
    })

    it('(4) legacy/non-Stanza structure path + PredicateStructure error -> error remains visible', () => {
      expect(shouldShowPredicateStructureFailureWarning('error', false)).toBe(true)
    })

    it('(6) PredicateStructure error state is not silently converted to success -- loading/idle never show the warning either', () => {
      expect(shouldShowPredicateStructureFailureWarning('idle', false)).toBe(false)
      expect(shouldShowPredicateStructureFailureWarning('loading', false)).toBe(false)
      expect(shouldShowPredicateStructureFailureWarning('idle', true)).toBe(false)
      expect(shouldShowPredicateStructureFailureWarning('loading', true)).toBe(false)
    })

    it('legacy path success never shows the warning', () => {
      expect(shouldShowPredicateStructureFailureWarning('success', false)).toBe(false)
    })
  })

  describe('regression -- the exact live scenarios from the D1 diagnosis', () => {
    it('(5) Stanza Tree success stays independent of PredicateStructure status: warning tracks structureTreeSuppliedByStanza, not the Tree itself', () => {
      const suppliedByStanza = isStructureTreeSuppliedByStanza('stanza', true)
      // The Relevant-data sentence: Stanza Tree renders successfully; PredicateStructure
      // deterministically fails grounding ("were converted" not found in source, per D1).
      expect(shouldShowPredicateStructureFailureWarning('error', suppliedByStanza)).toBe(false)
      // The Tree itself is built independently of this decision -- this module makes no claim
      // about `tree`, only about whether the legacy warning should render alongside it.
    })

    it('(7) existing retry behavior remains valid where PredicateStructure still owns the visible structure (legacy/non-Stanza path)', () => {
      const suppliedByStanza = isStructureTreeSuppliedByStanza('legacy-qwen-fallback', false)
      expect(shouldShowPredicateStructureFailureWarning('error', suppliedByStanza)).toBe(true)
    })
  })
})
