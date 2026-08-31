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

export const predicateCoreRelationSchema = z.enum(['main', 'coordinated'])
export type PredicateCoreRelation = z.infer<typeof predicateCoreRelationSchema>

/** Compact canonical predicate authority returned by GrammarAnalysis. Subject is held once
 * at SentenceCoreSet level; pattern and predicateCoreId are derived by the app. Nullable
 * verb is retained only so the established core-recovery path can safely handle a malformed
 * model answer without inventing a second schema. */
export const llmPredicateCoreSchema = z.object({
  connector: spanSchema.nullable(),
  verb: spanSchema.nullable(),
  indirectObject: spanSchema.nullable(),
  object: spanSchema.nullable(),
  complement: spanSchema.nullable(),
})
export type LlmPredicateCore = z.infer<typeof llmPredicateCoreSchema>

/**
 * Prototype 2.6G2.5C4.2 -- additive, canonical-authority-specific presentation metadata.
 * `Span` itself stays a plain contiguous source-grounded interval everywhere, including the
 * LLM/Qwen `llmPredicateCoreSchema` this extends -- these fields exist ONLY on the app-level
 * `PredicateCore`/`SentenceCoreSet` (never on the shared `Span`), are entirely optional, and
 * are set only by the Stanza syntax authority path (`stanzaSyntaxAuthority.ts`'s fine-grained
 * citation pruning). The Qwen/LLM pipeline's own construction of these types simply never
 * sets them, which is valid: `null`/absent means "no citation-free rewrite; render the span's
 * own `.text` as-is". See the 2.6G2.5C4.1 audit for why this is additive metadata rather than
 * a mutation of `Span.text` itself.
 */
export const predicateCoreSchema = llmPredicateCoreSchema.extend({
  predicateCoreId: z.string().min(1),
  relation: predicateCoreRelationSchema,
  pattern: sentencePatternSchema,
  indirectObjectPresentationText: z.string().nullable().optional(),
  objectPresentationText: z.string().nullable().optional(),
  complementPresentationText: z.string().nullable().optional(),
})
export type PredicateCore = z.infer<typeof predicateCoreSchema>

export const llmSentenceCoreSetSchema = z.object({
  subject: spanSchema.nullable(),
  subjectHead: spanSchema.nullable(),
  predicateCores: z.array(llmPredicateCoreSchema).min(1),
})
export type LlmSentenceCoreSet = z.infer<typeof llmSentenceCoreSetSchema>

export const sentenceCoreSetSchema = z.object({
  subject: spanSchema.nullable(),
  subjectHead: spanSchema.nullable(),
  subjectPresentationText: z.string().nullable().optional(),
  predicateCores: z.array(predicateCoreSchema).min(1),
})
export type SentenceCoreSet = z.infer<typeof sentenceCoreSetSchema>

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

export const vocabularyPartOfSpeechSchema = z.enum([
  'noun',
  'verb',
  'adjective',
  'adverb',
  'nounPhrase',
  'verbPhrase',
  'adjectivePhrase',
  'adverbialPhrase',
  'other',
])
export type VocabularyPartOfSpeech = z.infer<typeof vocabularyPartOfSpeechSchema>

export const vocabularyItemSchema = z.object({
  word: z.string(),
  contextualMeaning: z.string(),
  partOfSpeech: vocabularyPartOfSpeechSchema,
})
export type VocabularyItem = z.infer<typeof vocabularyItemSchema>

const sharedAnalysisFieldsSchema = z.object({
  modifiers: z.array(modifierSchema),
  clauses: z.array(clauseSchema),
  phrases: z.array(phraseSchema),
  vocabulary: z.array(vocabularyItemSchema),
  confidence: z.number().min(0).max(1),
  uncertainties: z.array(z.string()),
  needsMoreContext: z.boolean(),
  referenceTranslation: z.string().nullable(),
})

/** What the LLM is asked to produce. `pattern` is absent; the app derives it after the fact. */
export const llmGrammarAnalysisSchema = sharedAnalysisFieldsSchema.extend({
  sentenceCoreSet: llmSentenceCoreSetSchema,
})
export type LlmGrammarAnalysis = z.infer<typeof llmGrammarAnalysisSchema>

/** Full result shown in the UI: LLM output plus app-filled originalText/normalizedText/pattern. */
export const grammarAnalysisSchema = sharedAnalysisFieldsSchema.extend({
  originalText: z.string(),
  normalizedText: z.string(),
  sentenceCoreSet: sentenceCoreSetSchema,
  /** Temporary compatibility projection. Canonical authority is always sentenceCoreSet. */
  sentenceCore: sentenceCoreSchema,
})
export type GrammarAnalysis = z.infer<typeof grammarAnalysisSchema>
