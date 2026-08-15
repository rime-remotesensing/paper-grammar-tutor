import type { LLMProvider } from '../../../llm/types.ts'
import type { SentenceCore } from '../schemas/grammarAnalysis.schema.ts'
import { getReadingGuide, type ReadingGuideOutcome } from './readingGuideService.ts'
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
  readingGuide: Promise<ReadingGuideOutcome>
  structure: Promise<PredicateStructureOutcome>
  /** Prototype 2.3O item 16/46: null when the cheap word-boundary prefilter
   * (relativeLinkPrefilter.ts) finds no that/which/who token at all -- the analyzer is
   * simply never called for that sentence, not called-and-discarded. Never awaited before
   * readingGuide/structure start (item 46: all three fire together). */
  relativeLink: Promise<FocusedRelativeLinkOutcome> | null
}

/**
 * Prototype 2.3C item 24 / 2.3O item 46: a single "英語の語順で読む" click starts THREE
 * independent services (ReadingGuide, PredicateStructureAnalyzer, and — since Prototype
 * 2.3O, only when the prefilter finds a candidate token — Focused Relative-Link) at once.
 * Each underlying getX() call already fires its LLM request(s) synchronously up to its
 * first `await`, so calling them back-to-back here — never awaiting one before starting the
 * next — is sufficient to run them in parallel; no Promise.all/allSettled ceremony is
 * needed since the caller handles each outcome via fully independent chains (failure
 * independence, item 23/48: each failing/succeeding on its own never affects the others'
 * displayed state, and none of them delay "基本の骨格", item 47, since this function is
 * only ever invoked from the separate "英語の語順で読む" click handler).
 */
export function startReadingSupport(params: StartReadingSupportParams): ReadingSupportPromises {
  const readingGuide = getReadingGuide({
    provider: params.provider,
    model: params.model,
    originalText: params.originalText,
    sentenceCore: params.sentenceCore,
    temperature: params.temperature,
  })
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
  return { readingGuide, structure, relativeLink }
}
