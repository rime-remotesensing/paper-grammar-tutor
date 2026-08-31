import { MAX_REPAIR_ATTEMPTS } from '../../../config/settings.ts'
import { FOCUSED_COMPLEMENT_VERIFICATION_JSON_SCHEMA } from '../schemas/focusedComplementVerification.jsonSchema.ts'
import {
  llmFocusedComplementVerificationSchema,
  type FocusedClassification,
  type FocusedReasonCode,
} from '../schemas/focusedComplementVerification.schema.ts'
import type { LLMProvider } from '../../../llm/types.ts'
import {
  buildFocusedComplementVerifierPrompt,
  buildFocusedComplementVerifierRepairPrompt,
} from '../../../llm/prompts/focusedComplementVerifierPrompt.ts'
import { tryParseJson } from '../../../utils/jsonExtract.ts'

export interface VerifyFocusedComplementOptions {
  provider: LLMProvider
  model: string
  sentence: string
  subject: string
  verb: string
  object: string
  complement: string
  temperature: number
}

export type VerifyFocusedComplementResult =
  | { success: true; classification: FocusedClassification; reasonCode: FocusedReasonCode }
  | { success: false; error: string }

/**
 * Orchestrates the focused complement verifier call (Prototype 2.3I, production port of
 * the Prototype 2.3H spike's `runFocusedVerifier`): prompt -> LLM -> JSON parse -> Zod ->
 * (one repair attempt) -> result. Fully independent of GrammarAnalyzer, ReadingGuideAnalyzer,
 * and PredicateStructureAnalyzer — its own prompt, its own schema, never shares a call with
 * any of them, and is only ever invoked when commaIngComplementGate.ts's
 * isSuspiciousCommaIngComplement() returns true (the gate never rewrites a core itself —
 * only this verifier's classification is the authority for that, see
 * analyzeSentenceWithComplementVerification.ts).
 *
 * Never throws for LLM-quality problems; always resolves to a Result so a verification
 * failure can fall back to a safe "uncertain" presentation state without ever silently
 * asserting a possibly-wrong core.
 */
export async function verifyFocusedComplement(
  options: VerifyFocusedComplementOptions,
): Promise<VerifyFocusedComplementResult> {
  const { provider, model, sentence, subject, verb, object, complement, temperature } = options

  const prompt = buildFocusedComplementVerifierPrompt(sentence, subject, verb, object, complement)
  let generation = await provider.generateStructured({
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonSchema: FOCUSED_COMPLEMENT_VERIFICATION_JSON_SCHEMA,
    temperature,
    callLabel: 'focused-complement-verifier.initial',
  })

  let attempt = validate(generation.rawText)

  for (let repairCount = 0; repairCount < MAX_REPAIR_ATTEMPTS && !attempt.success; repairCount++) {
    const repairPrompt = buildFocusedComplementVerifierRepairPrompt(
      sentence,
      subject,
      verb,
      object,
      complement,
      generation.rawText,
      attempt.error,
    )
    generation = await provider.generateStructured({
      model,
      systemPrompt: repairPrompt.system,
      userPrompt: repairPrompt.user,
      jsonSchema: FOCUSED_COMPLEMENT_VERIFICATION_JSON_SCHEMA,
      temperature,
      callLabel: `focused-complement-verifier.repair.${repairCount + 1}`,
    })
    attempt = validate(generation.rawText)
  }

  if (!attempt.success) {
    return { success: false, error: attempt.error }
  }

  return { success: true, classification: attempt.classification, reasonCode: attempt.reasonCode }
}

type ValidationOutcome =
  | { success: true; classification: FocusedClassification; reasonCode: FocusedReasonCode }
  | { success: false; error: string }

function validate(rawText: string): ValidationOutcome {
  const parsed = tryParseJson(rawText)
  if ('error' in parsed) {
    return { success: false, error: `JSONとして解析できませんでした: ${parsed.error}` }
  }
  const result = llmFocusedComplementVerificationSchema.safeParse(parsed.value)
  if (!result.success) {
    return { success: false, error: result.error.issues.map((issue) => issue.message).join('; ') }
  }
  return { success: true, classification: result.data.classification, reasonCode: result.data.reasonCode }
}
