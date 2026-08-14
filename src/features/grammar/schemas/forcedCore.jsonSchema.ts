// Hand-written JSON Schema mirroring forcedCoreSchema in forcedCore.schema.ts. Passed to
// Ollama's `format` field for the recovery-only "骨格だけ再解析" call. If you change one
// of these two files, change the other too (same convention as grammarAnalysis.jsonSchema.ts).

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

export const FORCED_CORE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    subject: SPAN_SCHEMA,
    subjectHead: SPAN_SCHEMA,
    verb: SPAN_SCHEMA,
    indirectObject: NULLABLE_SPAN_SCHEMA,
    object: NULLABLE_SPAN_SCHEMA,
    complement: NULLABLE_SPAN_SCHEMA,
  },
  required: ['subject', 'subjectHead', 'verb', 'indirectObject', 'object', 'complement'],
  additionalProperties: false,
} as const
