// Hand-written JSON Schema mirroring llmFocusedCopularCoreRepairSchema, 1:1. Passed to
// Ollama's `format` field for the Focused Copular Core Repair call (Prototype 2.5W).

export const FOCUSED_COPULAR_CORE_REPAIR_JSON_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    verb: { type: 'string' },
    complement: { type: 'string' },
  },
  required: ['subject', 'verb', 'complement'],
  additionalProperties: false,
} as const
