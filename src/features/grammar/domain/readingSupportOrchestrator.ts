import type { LLMProvider } from '../../../llm/types.ts'
import type { SentenceCore } from '../schemas/grammarAnalysis.schema.ts'
import { getPredicateStructure, type PredicateStructureOutcome } from './predicateStructureService.ts'
import { getFocusedRelativeLink, type FocusedRelativeLinkOutcome } from './focusedRelativeLinkService.ts'
import { shouldCallFocusedRelativeLink } from './relativeLinkPrefilter.ts'

export interface StartReadingSupportParams {
  provider: LLMProvider
  model: string
  originalText: string
  sentenceCore: SentenceCore
  temperature: number
}

export interface ReadingSupportPromises {
  structure: Promise<PredicateStructureOutcome>
  /** Prototype 2.3O item 16/46: null when the cheap word-boundary prefilter
   * (relativeLinkPrefilter.ts) finds no that/which/who token at all -- the analyzer is
   * simply never called for that sentence, not called-and-discarded. Never awaited before
   * readingGuide/structure start (item 46: all three fire together). */
  relativeLink: Promise<FocusedRelativeLinkOutcome> | null
}

/**
 * Prototype 2.6B6: starts the Tree-authority calls in parallel. ReadingGuide deliberately
 * starts later, after the caller has applied focused repairs and derived final Tree targets.
 * This changes ordering, not count: the existing ReadingGuide call is deferred rather than
 * duplicated.
 */
export function startReadingSupport(params: StartReadingSupportParams): ReadingSupportPromises {
  const structure = getPredicateStructure({
    provider: params.provider,
    model: params.model,
    originalText: params.originalText,
    sentenceCore: params.sentenceCore,
    temperature: params.temperature,
  })
  const relativeLink = shouldCallFocusedRelativeLink(params.originalText)
    ? getFocusedRelativeLink({
        provider: params.provider,
        model: params.model,
        originalText: params.originalText,
        temperature: params.temperature,
      })
    : null
  return { structure, relativeLink }
}
