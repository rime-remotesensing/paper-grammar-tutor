import type { SyntaxAuthoritySource } from './analyzeSentenceWithSyntaxAuthority.ts'

/**
 * Prototype 2.6G2-D2 -- Scope PredicateStructure Failure UI Correctly on the Stanza
 * Authority Path.
 *
 * `AnalysisResultPanel.tsx`'s `structureStatus` state tracks the legacy, dedicated
 * PredicateStructure LLM call (predicateStructureService.ts/PredicateStructureAnalyzer.ts) --
 * NOT the visible Structure Tree. On the `syntaxAuthority.source === 'stanza'` path,
 * `buildFinalTree` ignores that call's result entirely (it builds the Tree directly from
 * Stanza's own ClauseFrame/PredicateFrame authority) and every other downstream consumer
 * (ReadingGuide targets, relative-link relations) is likewise derived from the Stanza-built
 * Tree, never from PredicateStructure -- confirmed by the Prototype 2.6G2-D1 consumer audit:
 * PredicateStructure has ZERO visible consumers once Stanza authority already supplied the
 * Tree. A PredicateStructure failure on that path is therefore an internal, historically-
 * accumulated pipeline failure with nothing left depending on it, not a failure of "the
 * detailed sentence structure" the user is actually looking at.
 *
 * This module isolates the two small, pure UI-scoping decisions this phase makes, so they can
 * be unit-tested without mounting `AnalysisResultPanel` (this codebase has no
 * React-Testing-Library/jsdom setup -- component behavior is tested via extracted pure
 * presentation logic, the same convention `basicSkeletonPresentation.ts` already
 * established).
 */

/** True when the visible Structure Tree is already fully supplied by Stanza authority --
 * i.e. the exact condition `AnalysisResultPanel.tsx`'s own `buildFinalTree` uses to decide
 * whether to ignore the legacy PredicateStructure result entirely
 * (`syntaxAuthority.source === 'stanza' && stanzaTokens`). Reproduced here (not imported) --
 * this module deliberately has no dependency on stanzaStructureTree.ts/StructureTreeView.tsx,
 * matching this phase's own scope restriction to UI status semantics only. */
export function isStructureTreeSuppliedByStanza(
  syntaxAuthoritySource: SyntaxAuthoritySource,
  hasStanzaTokens: boolean,
): boolean {
  return syntaxAuthoritySource === 'stanza' && hasStanzaTokens
}

/**
 * Whether the legacy PredicateStructure failure should be surfaced as a Tree-level warning
 * ("詳細な文構造を作成できませんでした") and retry button ("構造を再試行"). False whenever the
 * Structure Tree the user is actually looking at was already supplied by Stanza authority --
 * on that path PredicateStructure's own success or failure has no visible effect (see this
 * module's own doc comment), so surfacing its failure there would blame a currently-correct,
 * fully-rendered Tree for an unrelated, already-inert legacy call. On every other path
 * (`legacy-qwen-fallback`, or Stanza tokens genuinely unavailable) the visible structure
 * genuinely still depends on PredicateStructure -- unchanged, still a real, user-facing
 * failure there. Never suppresses the underlying `structureStatus === 'error'` state itself
 * (still tracked, still loggable, still what a retry would clear) -- only whether the UI shows
 * a warning/retry FOR that state, scoped by whether anything visible actually depends on it. */
export function shouldShowPredicateStructureFailureWarning(
  structureStatus: 'idle' | 'loading' | 'success' | 'error',
  structureTreeSuppliedByStanza: boolean,
): boolean {
  return structureStatus === 'error' && !structureTreeSuppliedByStanza
}
