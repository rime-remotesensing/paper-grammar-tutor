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
    predicateCores: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          connector: { ...NULLABLE_SPAN_SCHEMA, description: 'Exact linking word before this predicate, or null for the first/comma-only core.' },
          verb: { ...SPAN_SCHEMA, description: 'Exact finite/content verb words only; include auxiliaries, exclude adjectives, objects, adverbs, and prepositions.' },
          indirectObject: { ...NULLABLE_SPAN_SCHEMA, description: 'Only the recipient in a true double-object construction; otherwise null.' },
          object: { ...NULLABLE_SPAN_SCHEMA, description: 'Required exact direct object for a transitive predicate; never put the only object in indirectObject.' },
          complement: { ...NULLABLE_SPAN_SCHEMA, description: 'Only an SVC/SVOC predicate noun/adjective; never an adverb or ordinary PP.' },
        },
        required: ['connector', 'verb', 'indirectObject', 'object', 'complement'],
        additionalProperties: false,
      },
    },
  },
  required: ['subject', 'subjectHead', 'predicateCores'],
  additionalProperties: false,
} as const
