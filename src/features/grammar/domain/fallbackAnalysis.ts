import type { GrammarAnalysis } from '../schemas/grammarAnalysis.schema.ts'

/**
 * A safe, empty result used when the LLM's output could not be parsed or
 * validated even after one repair attempt. Keeps the UI rendering something
 * coherent instead of crashing or showing a raw error.
 */
export function buildFallbackAnalysis(
  originalText: string,
  normalizedText: string,
  reason: string,
): GrammarAnalysis {
  return {
    originalText,
    normalizedText,
    sentenceCoreSet: {
      subject: null,
      subjectHead: null,
      predicateCores: [{
        predicateCoreId: 'predicate-1',
        relation: 'main',
        connector: null,
        verb: null,
        indirectObject: null,
        object: null,
        complement: null,
        pattern: 'other',
      }],
    },
    sentenceCore: {
      subject: null,
      subjectHead: null,
      verb: null,
      indirectObject: null,
      object: null,
      complement: null,
      pattern: 'other',
    },
    modifiers: [],
    clauses: [],
    phrases: [],
    vocabulary: [],
    confidence: 0,
    uncertainties: [reason],
    needsMoreContext: true,
    referenceTranslation: null,
  }
}
