// Hand-written JSON Schema mirroring llmFocusedComplementVerificationSchema in
// focusedComplementVerification.schema.ts, 1:1. Passed to Ollama's `format` field for the
// focused complement verifier call (Prototype 2.3I, ported unchanged from the Prototype
// 2.3H spike). If you change one of these two files, change the other too.

export const FOCUSED_COMPLEMENT_VERIFICATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    classification: { type: 'string', enum: ['OBJECT_COMPLEMENT', 'SUPPLEMENTARY_ING', 'UNCERTAIN'] },
    reasonCode: { type: 'string', enum: ['OBJECT_PREDICATION', 'COMMA_SUPPLEMENT', 'INSUFFICIENT_EVIDENCE'] },
  },
  required: ['classification', 'reasonCode'],
  additionalProperties: false,
} as const
