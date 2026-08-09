import { z } from 'zod'

export const spanSchema = z.object({
  text: z.string(),
  start: z.number().int(),
  end: z.number().int(),
})
export type Span = z.infer<typeof spanSchema>

export const sentencePatternSchema = z.enum(['SV', 'SVC', 'SVO', 'SVOO', 'SVOC', 'other'])
export type SentencePattern = z.infer<typeof sentencePatternSchema>

/**
 * The LLM is not asked for `pattern` here. Pattern (SV/SVC/SVO/SVOO/SVOC) is derived by
 * the app from which of subject/verb/indirectObject/object/complement are present
 * (see domain/derivePattern.ts) — the LLM previously produced S/V/O/C and a `pattern`
 * label that sometimes contradicted each other (e.g. object+complement filled in but
 * pattern said SVOO). Deriving it mechanically removes that class of error entirely.
 */
export const llmSentenceCoreSchema = z.object({
  subject: spanSchema.nullable(),
  subjectHead: spanSchema.nullable(),
  verb: spanSchema.nullable(),
  /** Indirect object, only meaningful together with `object` (the direct object) in SVOO. */
  indirectObject: spanSchema.nullable(),
  object: spanSchema.nullable(),
  complement: spanSchema.nullable(),
})
export type LlmSentenceCore = z.infer<typeof llmSentenceCoreSchema>

export const sentenceCoreSchema = llmSentenceCoreSchema.extend({
  pattern: sentencePatternSchema,
})
export type SentenceCore = z.infer<typeof sentenceCoreSchema>

export const chunkSchema = z.object({
  span: spanSchema,
  order: z.number().int().nonnegative(),
})
export type Chunk = z.infer<typeof chunkSchema>

export const modifierKindSchema = z.enum([
  'prepositionalPhrase',
  'participlePhrase',
  'infinitivePhrase',
  'relativeClause',
  'adverbialPhrase',
  'appositive',
  'other',
])
export type ModifierKind = z.infer<typeof modifierKindSchema>

export const modifierSchema = z.object({
  phrase: spanSchema,
  kind: modifierKindSchema,
  target: spanSchema.nullable(),
  explanation: z.string(),
})
export type Modifier = z.infer<typeof modifierSchema>

export const clauseKindSchema = z.enum(['nounClause', 'adjectiveClause', 'adverbClause', 'other'])
export type ClauseKind = z.infer<typeof clauseKindSchema>

/**
 * Machine-readable grammatical function of a clause within the sentence. Kept as an
 * enum (not free text) so the UI can render a fixed Japanese label instead of
 * whatever raw English/Japanese term the model happens to produce (Prototype 0 saw
 * `role: "indirectObject"` leak through as literal English). Free-form elaboration
 * belongs in `roleExplanation`, not here.
 */
export const grammaticalRoleSchema = z.enum([
  'subject',
  'object',
  'complement',
  'modifier',
  'adverbial',
  'apposition',
  'other',
])
export type GrammaticalRole = z.infer<typeof grammaticalRoleSchema>

export const clauseSchema = z.object({
  span: spanSchema,
  kind: clauseKindSchema,
  grammaticalRole: grammaticalRoleSchema,
  /** Free-text Japanese elaboration, e.g. "主動詞indicateの目的語". */
  roleExplanation: z.string(),
})
export type Clause = z.infer<typeof clauseSchema>

export const phraseSchema = z.object({
  span: spanSchema,
  meaning: z.string(),
})
export type Phrase = z.infer<typeof phraseSchema>

export const vocabularyItemSchema = z.object({
  word: z.string(),
  contextualMeaning: z.string(),
})
export type VocabularyItem = z.infer<typeof vocabularyItemSchema>

const sharedAnalysisFieldsSchema = z.object({
  chunks: z.array(chunkSchema),
  modifiers: z.array(modifierSchema),
  clauses: z.array(clauseSchema),
  phrases: z.array(phraseSchema),
  vocabulary: z.array(vocabularyItemSchema),
  readingHint: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  uncertainties: z.array(z.string()),
  needsMoreContext: z.boolean(),
  referenceTranslation: z.string().nullable(),
})

/** What the LLM is asked to produce. `pattern` is absent; the app derives it after the fact. */
export const llmGrammarAnalysisSchema = sharedAnalysisFieldsSchema.extend({
  sentenceCore: llmSentenceCoreSchema,
})
export type LlmGrammarAnalysis = z.infer<typeof llmGrammarAnalysisSchema>

/** Full result shown in the UI: LLM output plus app-filled originalText/normalizedText/pattern. */
export const grammarAnalysisSchema = sharedAnalysisFieldsSchema.extend({
  originalText: z.string(),
  normalizedText: z.string(),
  sentenceCore: sentenceCoreSchema,
})
export type GrammarAnalysis = z.infer<typeof grammarAnalysisSchema>
