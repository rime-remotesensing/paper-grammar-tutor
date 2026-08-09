// Hand-written JSON Schema mirroring llmGrammarAnalysisSchema in grammarAnalysis.schema.ts.
// Passed to Ollama's `format` field to constrain decoding. Zod remains the source of truth
// for validation after parsing; if you change one of these two files, change the other too.
// $ref/oneOf are avoided in favor of inlined "anyOf [object, null]" for nullable fields,
// since that shape was verified to work reliably with Ollama's structured-output grammar.

const SPAN_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    start: { type: 'integer' },
    end: { type: 'integer' },
  },
  required: ['text', 'start', 'end'],
  additionalProperties: false,
} as const

const NULLABLE_SPAN_SCHEMA = {
  anyOf: [SPAN_SCHEMA, { type: 'null' }],
} as const

const GRAMMATICAL_ROLE_ENUM = [
  'subject',
  'object',
  'complement',
  'modifier',
  'adverbial',
  'apposition',
  'other',
]

export const GRAMMAR_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    sentenceCore: {
      type: 'object',
      properties: {
        subject: NULLABLE_SPAN_SCHEMA,
        subjectHead: NULLABLE_SPAN_SCHEMA,
        verb: NULLABLE_SPAN_SCHEMA,
        indirectObject: NULLABLE_SPAN_SCHEMA,
        object: NULLABLE_SPAN_SCHEMA,
        complement: NULLABLE_SPAN_SCHEMA,
      },
      required: ['subject', 'subjectHead', 'verb', 'indirectObject', 'object', 'complement'],
      additionalProperties: false,
    },
    chunks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          span: SPAN_SCHEMA,
          order: { type: 'integer' },
        },
        required: ['span', 'order'],
        additionalProperties: false,
      },
    },
    modifiers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          phrase: SPAN_SCHEMA,
          kind: {
            type: 'string',
            enum: [
              'prepositionalPhrase',
              'participlePhrase',
              'infinitivePhrase',
              'relativeClause',
              'adverbialPhrase',
              'appositive',
              'other',
            ],
          },
          target: NULLABLE_SPAN_SCHEMA,
          explanation: { type: 'string' },
        },
        required: ['phrase', 'kind', 'target', 'explanation'],
        additionalProperties: false,
      },
    },
    clauses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          span: SPAN_SCHEMA,
          kind: {
            type: 'string',
            enum: ['nounClause', 'adjectiveClause', 'adverbClause', 'other'],
          },
          grammaticalRole: { type: 'string', enum: GRAMMATICAL_ROLE_ENUM },
          roleExplanation: { type: 'string' },
        },
        required: ['span', 'kind', 'grammaticalRole', 'roleExplanation'],
        additionalProperties: false,
      },
    },
    phrases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          span: SPAN_SCHEMA,
          meaning: { type: 'string' },
        },
        required: ['span', 'meaning'],
        additionalProperties: false,
      },
    },
    vocabulary: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          contextualMeaning: { type: 'string' },
        },
        required: ['word', 'contextualMeaning'],
        additionalProperties: false,
      },
    },
    readingHint: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    uncertainties: { type: 'array', items: { type: 'string' } },
    needsMoreContext: { type: 'boolean' },
    referenceTranslation: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: [
    'sentenceCore',
    'chunks',
    'modifiers',
    'clauses',
    'phrases',
    'vocabulary',
    'readingHint',
    'confidence',
    'uncertainties',
    'needsMoreContext',
    'referenceTranslation',
  ],
  additionalProperties: false,
} as const
