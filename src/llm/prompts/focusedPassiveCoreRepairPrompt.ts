// Focused Passive-Core Overcomplement Repair prompt (Prototype 2.5Z). Ported closely from
// the Prototype 2.5Y spike prompt that was validated 15/15 on the target shapes and 0/25 on
// negative controls — see docs/design-notes.md.

const SYSTEM_PROMPT = `Given the sentence and its primary clause's verb, decide whether the
primary clause has a Japanese five-pattern SUBJECT COMPLEMENT (C) -- a predicate noun/adjective
that identifies or describes the SUBJECT, required by the verb (e.g. "is effective", "remains a
challenge"). Adverbs, prepositional phrases (direction/place/manner), infinitive purpose phrases
("to normalize the data"), and participial/subordinate material are NOT a complement -- they are
modifiers, even when they immediately follow the verb.

If the verb is passive ("can be rotated", "is applied", "was found") the sentence is very
RARELY SVC -- a passive verb already has its own complete meaning; do not invent a complement
just because material follows it. But if the passive verb genuinely IS followed by a predicate
adjective/noun describing the subject (e.g. "The door was painted red" -- "red" describes the
door), that is a real complement; decide genuinely, do not always answer SV.

Return {"pattern": "SV" or "SVC", "complement": exact substring or null}.

Output valid JSON matching the schema only, no prose outside the JSON.

Example 1:
Sentence: This regression line can be rotated to the horizontal to normalize the data.
Verb: can be rotated
-> {"pattern":"SV","complement":null}

Example 2:
Sentence: The result is a problem.
Verb: is
-> {"pattern":"SVC","complement":"a problem"}

Example 3 (a prepositional phrase after a passive verb is still only a modifier, even when it
feels idiomatic or the verb seems to "need" it -- it is not a predicate noun/adjective
describing the subject):
Sentence: The model is based on observations.
Verb: is based
-> {"pattern":"SV","complement":null}`

export interface FocusedPassiveCoreRepairPromptPair {
  system: string
  user: string
}

export function buildFocusedPassiveCoreRepairPrompt(sentence: string, verbText: string): FocusedPassiveCoreRepairPromptPair {
  return { system: SYSTEM_PROMPT, user: `Sentence:\n${sentence}\n\nVerb: ${verbText}` }
}

export function buildFocusedPassiveCoreRepairRepairPrompt(
  sentence: string,
  verbText: string,
  previousRawText: string,
  validationError: string,
): FocusedPassiveCoreRepairPromptPair {
  return {
    system: SYSTEM_PROMPT,
    user: `Your previous response did not match the required schema/rules.

Sentence:
${sentence}

Verb: ${verbText}

Your previous output:
${previousRawText}

Validation error:
${validationError}

Return a corrected JSON object only, matching the schema exactly. If pattern is "SV", complement
must be null. If pattern is "SVC", complement must be a non-empty exact substring of the
sentence. Do not include any explanation outside the JSON.`,
  }
}
