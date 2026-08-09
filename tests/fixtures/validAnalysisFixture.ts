import type { LlmGrammarAnalysis } from '../../src/features/grammar/schemas/grammarAnalysis.schema'

export const SAMPLE_SENTENCE =
  'The results obtained in the previous experiment indicate that the proposed method is effective.'

export const validAnalysisFixture: LlmGrammarAnalysis = {
  sentenceCore: {
    subject: { text: 'The results obtained in the previous experiment', start: 0, end: 49 },
    subjectHead: { text: 'The results', start: 0, end: 11 },
    verb: { text: 'indicate', start: 50, end: 58 },
    indirectObject: null,
    object: { text: 'that the proposed method is effective', start: 59, end: 97 },
    complement: null,
  },
  chunks: [
    { span: { text: 'The results', start: 0, end: 11 }, order: 0 },
    { span: { text: 'obtained in the previous experiment', start: 12, end: 48 }, order: 1 },
    { span: { text: 'indicate', start: 50, end: 58 }, order: 2 },
    { span: { text: 'that the proposed method is effective', start: 59, end: 97 }, order: 3 },
  ],
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
  vocabulary: [{ word: 'indicate', contextualMeaning: '（データなどが）〜を示す' }],
  readingHint: ['まず主語のかたまりを読み、その後 indicate という動詞を見つけましょう。'],
  confidence: 0.9,
  uncertainties: [],
  needsMoreContext: false,
  referenceTranslation: '前回の実験で得られた結果は、提案手法が有効であることを示している。',
}
