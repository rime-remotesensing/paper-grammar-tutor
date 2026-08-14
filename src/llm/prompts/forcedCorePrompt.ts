// Recovery-only prompt for the user-triggered "骨格だけ再解析" second call. Deliberately
// separate from grammarAnalysisPrompt.ts's SYSTEM_PROMPT (which stays untouched) — this
// prompt asserts a precondition (the input is a confirmed complete sentence) that only
// holds when the user has explicitly triggered recovery, never for the primary request.

const FORCED_CORE_SYSTEM_PROMPT = `The input is a complete English declarative sentence that a
human reader has already confirmed is a full sentence, not a fragment.

Extract the matrix (main) clause's subject, subjectHead, and verb as spans (exact substrings
of the sentence; start/end are best-effort, the app corrects them). subject, subjectHead, and
verb MUST always be present — a confirmed complete sentence always has a subject and a finite
verb in its matrix clause, so never omit them.

verb is the matrix clause's own finite verb, including any auxiliary (e.g. "was recorded").
subjectHead is the bare head noun of subject.

indirectObject, object, complement are spans when the matrix clause has them, or null when it
does not. Never force a modifier or prepositional/adverbial phrase into object or complement
just to fill the field — leave it null instead.

Output valid JSON matching the schema only, no prose outside the JSON.`

export interface ForcedCorePromptPair {
  system: string
  user: string
}

export function buildForcedCorePrompt(sentence: string): ForcedCorePromptPair {
  return {
    system: FORCED_CORE_SYSTEM_PROMPT,
    user: `Sentence:\n${sentence}`,
  }
}
