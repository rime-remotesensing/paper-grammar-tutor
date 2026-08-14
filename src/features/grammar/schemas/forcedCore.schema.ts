import { z } from 'zod'
import { spanSchema } from './grammarAnalysis.schema.ts'

/**
 * Recovery-only schema for the user-triggered "骨格だけ再解析" second call. Unlike
 * llmSentenceCoreSchema (used by the primary GrammarAnalysis request), subject/
 * subjectHead/verb are NOT nullable here — Phase E of the sentenceCore-empty
 * investigation (see docs/design-notes.md) found that making them non-null in the
 * schema itself, together with a prompt that guarantees the input is a complete
 * sentence, reliably recovers cases where the primary request left sentenceCore
 * empty. This schema is intentionally never used for the primary request, because
 * forcing non-null broadly would make the model fabricate a subject/verb for genuine
 * sentence fragments (e.g. a PDF selection that isn't a full sentence).
 */
export const forcedCoreSchema = z.object({
  subject: spanSchema,
  subjectHead: spanSchema,
  verb: spanSchema,
  indirectObject: spanSchema.nullable(),
  object: spanSchema.nullable(),
  complement: spanSchema.nullable(),
})
export type ForcedCore = z.infer<typeof forcedCoreSchema>
