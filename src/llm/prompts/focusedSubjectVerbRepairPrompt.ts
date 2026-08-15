// Focused Subject-Verb Repair prompt (Prototype 2.3L). Ported UNCHANGED from the Prototype
// 2.3J spike's final prompt.mjs — item 11 of the 2.3L order forbids prompt tuning this
// round. Neither the primary target ("We found the sensor operating normally.") nor Green
// leaves is used as a few-shot example.

const SYSTEM_PROMPT = `Identify ONLY the MAIN CLAUSE subject and main verb of this English
sentence — nothing else.

Rules:
- Ignore any preposed introductory phrase or clause (a participial phrase, an adverbial
  clause, a prepositional phrase) that comes before the main clause — the subject/verb must
  come from the MAIN clause, never from that introductory part.
- If the subject is a gerund phrase ("Collecting data takes time"), the whole gerund phrase
  IS the subject — never treat the gerund itself as the main verb.
- If the subject has its own relative clause attached ("The scientist who discovered X won
  an award"), include the WHOLE noun phrase (with its relative clause) as "subject", but
  the main verb is the one AFTER that relative clause, never the relative clause's own verb.
- "subjectHead" is the single head noun of the subject (e.g. "scientist", "team", "data").
- The main verb is the finite verb of the main clause (including auxiliaries, e.g. "was
  recorded", "have changed") — never a verb inside a subordinate/relative clause.

Every field must be an EXACT substring of the sentence, copied verbatim.

Output valid JSON matching the schema only, no prose outside the JSON.

Example 1 (ignore a preposed participial phrase):
Sentence: Using the calibrated sensor, the team measured reflectance.
-> {"subject":"the team","subjectHead":"team","verb":"measured"}

Example 2 (subject carries its own relative clause; verb is the one after it):
Sentence: The scientist who discovered the compound won an award.
-> {"subject":"The scientist who discovered the compound","subjectHead":"scientist","verb":"won"}`

export interface FocusedSubjectVerbRepairPromptPair {
  system: string
  user: string
}

export function buildFocusedSubjectVerbRepairPrompt(sentence: string): FocusedSubjectVerbRepairPromptPair {
  return { system: SYSTEM_PROMPT, user: `Sentence:\n${sentence}` }
}

export function buildFocusedSubjectVerbRepairRepairPrompt(
  sentence: string,
  previousRawText: string,
  validationError: string,
): FocusedSubjectVerbRepairPromptPair {
  return {
    system: SYSTEM_PROMPT,
    user: `Your previous response did not match the required schema/rules.

Sentence:
${sentence}

Your previous output:
${previousRawText}

Validation error:
${validationError}

Return a corrected JSON object only, matching the schema exactly. Every field must be an exact
substring of the sentence. Do not include any explanation outside the JSON.`,
  }
}
