// Hand-written JSON Schema mirroring llmFocusedSubjectVerbRepairSchema, 1:1. Passed to
// Ollama's `format` field for the Focused Subject-Verb Repair call (Prototype 2.3L, ported
// unchanged from the Prototype 2.3J spike).

export const FOCUSED_SUBJECT_VERB_REPAIR_JSON_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    subjectHead: { type: 'string' },
    verb: { type: 'string' },
  },
  required: ['subject', 'subjectHead', 'verb'],
  additionalProperties: false,
} as const
