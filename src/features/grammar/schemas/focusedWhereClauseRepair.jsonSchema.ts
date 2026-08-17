// Hand-written JSON Schema mirroring llmFocusedWhereClauseRepairSchema, 1:1. Passed to
// Ollama's `format` field for the Focused Where-Clause Repair call (Prototype 2.5W).

export const FOCUSED_WHERE_CLAUSE_REPAIR_JSON_SCHEMA = {
  type: 'object',
  properties: {
    owner: { type: ['string', 'null'] },
    children: { type: 'array', items: { type: 'string' } },
  },
  required: ['owner', 'children'],
  additionalProperties: false,
} as const
