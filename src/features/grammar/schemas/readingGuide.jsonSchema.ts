// Hand-written JSON Schema mirroring llmReadingGuideSchema in readingGuide.schema.ts.
// Passed to Ollama's `format` field for the "英語の語順で読む" second call. If you change
// one of these two files, change the other too (same convention as
// grammarAnalysis.jsonSchema.ts / forcedCore.jsonSchema.ts). readingSteps carry no
// start/end here — the app derives those itself (see readingGuideGrounding.ts) rather
// than trusting the model's own offsets.
//
// Prototype 2.3C: structureBranches (Prototype 2.2B/2.2C's fixed-depth attachment tree)
// is removed — structure is now a separate, dedicated LLM call
// (predicateStructure.jsonSchema.ts) combined with a deterministic hybrid merger. See
// readingGuide.schema.ts for why.

export const READING_GUIDE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    readingSteps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          cue: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['text', 'cue', 'explanation'],
        additionalProperties: false,
      },
    },
    connections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['text', 'explanation'],
        additionalProperties: false,
      },
    },
    expressions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          pattern: { type: 'string' },
          meaning: { type: 'string' },
          function: { type: 'string' },
        },
        required: ['text', 'pattern', 'meaning', 'function'],
        additionalProperties: false,
      },
    },
    readingAdvice: { type: 'array', items: { type: 'string' } },
  },
  required: ['readingSteps', 'connections', 'expressions', 'readingAdvice'],
  additionalProperties: false,
} as const
