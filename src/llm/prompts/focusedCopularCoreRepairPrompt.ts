// Focused Copular Core Repair prompt (Prototype 2.5W). Ported closely from the Prototype
// 2.5V spike prompt that was validated 20/20 on the exact target sentence and 15/15 clean
// on passive negative controls — see docs/design-notes.md.

const SYSTEM_PROMPT = `Identify ONLY the sentence's PRIMARY clause subject, its bare copular
"be" verb, and its subject complement (a noun/adjective phrase that identifies or describes
the subject) -- nothing else.

If the sentence has a SECOND clause coordinated by "and"/"or" sharing the same subject (e.g.
"... is a function of X and is introduced to Y"), IGNORE that second clause entirely -- your
complement must stop before the coordinating "and"/"or" that introduces it.

verb must be the bare copula only ("is"/"are"/"was"/"were"), never swallowing the complement
that follows it.

Every field must be an EXACT substring of the sentence, copied verbatim.

Output valid JSON matching the schema only, no prose outside the JSON.

Example 1 (no coordination):
Sentence: The result is a problem.
-> {"subject":"The result","verb":"is","complement":"a problem"}

Example 2 (coordinated second clause excluded):
Sentence: The parameter C is a function of the regression slope and is introduced to the model.
-> {"subject":"The parameter C","verb":"is","complement":"a function of the regression slope"}`

export interface FocusedCopularCoreRepairPromptPair {
  system: string
  user: string
}

/**
 * `stage2Hint`, when supplied, is a non-authoritative piece of evidence only (Prototype
 * 2.5V item 7 / 2.5W item 6: "no circular authority") — the focused call still has to
 * verify it against the sentence itself; the hint never gets copied into the result
 * directly.
 */
export function buildFocusedCopularCoreRepairPrompt(sentence: string, stage2Hint: string | null = null): FocusedCopularCoreRepairPromptPair {
  const user = stage2Hint
    ? `Sentence:\n${sentence}\n\nHint (from a separate structural pass, evidence only -- verify it yourself): the primary predicate appears to begin with "${stage2Hint}".`
    : `Sentence:\n${sentence}`
  return { system: SYSTEM_PROMPT, user }
}

export function buildFocusedCopularCoreRepairRepairPrompt(
  sentence: string,
  previousRawText: string,
  validationError: string,
): FocusedCopularCoreRepairPromptPair {
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
