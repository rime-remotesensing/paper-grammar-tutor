// Hand-written JSON Schema mirroring llmFocusedRelativeLinkSchema in
// focusedRelativeLink.schema.ts, 1:1. Passed to Ollama's `format` field. If you change one
// of these two files, change the other too.
//
// relativeWord's enum is restricted to the production scope (that/which/who) at the SCHEMA
// level, not just via a post-hoc mechanical check — item 10's "schema + mechanical
// validationの両方で保証" requirement. This is the fix for the Prototype 2.3N zero-relative
// hallucination (the model returning an ordinary word like "we" as relativeWord): a
// same-shaped hallucination now fails generation-time schema validation before it can even
// reach the mechanical grounding check in relativeLinkGrounding.ts.

export const FOCUSED_RELATIVE_LINK_JSON_SCHEMA = {
  type: 'object',
  properties: {
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          antecedent: { type: 'string' },
          relativeWord: { type: 'string', enum: ['that', 'which', 'who'] },
          relativeClause: { type: 'string' },
        },
        required: ['antecedent', 'relativeWord', 'relativeClause'],
        additionalProperties: false,
      },
    },
  },
  required: ['relations'],
  additionalProperties: false,
} as const
