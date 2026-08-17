// Hand-written JSON Schema mirroring llmReadingGuideSchema. Tree target IDs are supplied
// by the application in the prompt and validated after generation; the model never returns
// offsets or source-label authority.
export const READING_GUIDE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    readingSteps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          targetId: { type: 'string' },
          guidance: { type: 'string' },
        },
        required: ['targetId', 'guidance'],
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
  },
  required: ['readingSteps', 'expressions'],
  additionalProperties: false,
} as const
