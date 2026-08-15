// Hand-written JSON Schema mirroring llmPredicateStructureSchema in
// predicateStructure.schema.ts. Passed to Ollama's `format` field for the dedicated
// structure-only call (Prototype 2.3C, ported unchanged from the Prototype 2.3A spike's
// PREDICATE_STRUCTURE_JSON_SCHEMA). Fixed-depth (predicate -> dependent -> leaf, 3
// levels), no $ref/recursion — same convention as grammarAnalysis.jsonSchema.ts.

const STRUCTURE_ROLE_ENUM = ['object', 'complement', 'modifier', 'condition', 'range', 'clause', 'other']
const PREDICATE_RELATION_ENUM = ['main', 'coordinated']

const LEAF_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    role: { type: 'string', enum: STRUCTURE_ROLE_ENUM },
  },
  required: ['text', 'role'],
  additionalProperties: false,
} as const

const DEPENDENT_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    role: { type: 'string', enum: STRUCTURE_ROLE_ENUM },
    children: { type: 'array', items: LEAF_SCHEMA },
  },
  required: ['text', 'role', 'children'],
  additionalProperties: false,
} as const

const PREDICATE_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    relation: { type: 'string', enum: PREDICATE_RELATION_ENUM },
    dependents: { type: 'array', items: DEPENDENT_SCHEMA },
  },
  required: ['text', 'relation', 'dependents'],
  additionalProperties: false,
} as const

export const PREDICATE_STRUCTURE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    subjectModifiers: { type: 'array', items: LEAF_SCHEMA },
    predicates: { type: 'array', items: PREDICATE_SCHEMA },
    sentenceModifiers: { type: 'array', items: LEAF_SCHEMA },
  },
  required: ['subjectModifiers', 'predicates', 'sentenceModifiers'],
  additionalProperties: false,
} as const
