import type { LlmGrammarAnalysis, LlmSentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema'

export const SAMPLE_SENTENCE =
  'The results obtained in the previous experiment indicate that the proposed method is effective.'

export const validAnalysisFixture: LlmGrammarAnalysis & { sentenceCore: LlmSentenceCore } = {
  sentenceCoreSet: {
    subject: { text: 'The results obtained in the previous experiment', start: 0, end: 49 },
    subjectHead: { text: 'The results', start: 0, end: 11 },
    predicateCores: [{
      connector: null,
      verb: { text: 'indicate', start: 50, end: 58 },
      indirectObject: null,
      object: { text: 'that the proposed method is effective', start: 59, end: 97 },
      complement: null,
    }],
  },
  /** Legacy fixture convenience for pre-E1 unit tests that override one core field. */
  sentenceCore: {
    subject: { text: 'The results obtained in the previous experiment', start: 0, end: 49 },
    subjectHead: { text: 'The results', start: 0, end: 11 },
    verb: { text: 'indicate', start: 50, end: 58 },
    indirectObject: null,
    object: { text: 'that the proposed method is effective', start: 59, end: 97 },
    complement: null,
  },
  modifiers: [
    {
      phrase: { text: 'obtained in the previous experiment', start: 12, end: 48 },
      kind: 'participlePhrase',
      target: { text: 'The results', start: 0, end: 11 },
      explanation: '「前回の実験で得られた」という意味でThe resultsを説明している。',
    },
  ],
  clauses: [
    {
      span: { text: 'that the proposed method is effective', start: 59, end: 97 },
      kind: 'nounClause',
      grammaticalRole: 'object',
      roleExplanation: '主動詞indicateの目的語となる名詞節。',
    },
  ],
  phrases: [],
  vocabulary: [{ word: 'indicate', contextualMeaning: '（データなどが）〜を示す', partOfSpeech: 'verb' }],
  confidence: 0.9,
  uncertainties: [],
  needsMoreContext: false,
  referenceTranslation: '前回の実験で得られた結果は、提案手法が有効であることを示している。',
}

/** Test-only migration helper: constructs canonical LLM authority from a legacy one-core
 * fixture while retaining sentenceCore as a convenient unknown field for older assertions. */
export function withSingleCoreFixture(
  base: LlmGrammarAnalysis,
  sentenceCore: LlmSentenceCore,
): LlmGrammarAnalysis & { sentenceCore: LlmSentenceCore } {
  return {
    ...base,
    sentenceCore,
    sentenceCoreSet: {
      subject: sentenceCore.subject,
      subjectHead: sentenceCore.subjectHead,
      predicateCores: [{
        connector: null,
        verb: sentenceCore.verb,
        indirectObject: sentenceCore.indirectObject,
        object: sentenceCore.object,
        complement: sentenceCore.complement,
      }],
    },
  }
}
