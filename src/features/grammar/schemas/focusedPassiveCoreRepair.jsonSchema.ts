// Hand-written JSON Schema mirroring llmFocusedPassiveCoreRepairSchema, 1:1. Passed to
// Ollama's `format` field for the Focused Passive-Core Overcomplement Repair call
// (Prototype 2.5Z).

export const FOCUSED_PASSIVE_CORE_REPAIR_JSON_SCHEMA = {
  type: 'object',
  properties: {
    pattern: { type: 'string', enum: ['SV', 'SVC'] },
    complement: { type: ['string', 'null'] },
  },
  required: ['pattern', 'complement'],
  additionalProperties: false,
} as const
