// Focused Relative-Link Analyzer prompt (Prototype 2.3O). Ported from the Prototype 2.3N
// spike's prompt (30 lines, 3 few-shot examples, target sentence excluded — 30/30 exact
// match, 0 false relations at that line count), trimmed to the production scope: item 7 of
// the 2.3O order — "that"/"which"/"who" only, the "whose"-specific rule removed since
// "whose" is deferred (2.3N: 0/20 exact, always a safe miss but never accurate enough to
// ship). Deliberately tiny input (plain sentence text, no offsets, no S/V/O/C) and tiny
// output (a list of antecedent/relativeWord/relativeClause triples) — no S/V/O/C parsing,
// no supplement judgment, no translation, no reading guide (item 3).

const SYSTEM_PROMPT = `Find relative clauses in the sentence. A relative clause begins with
that/which/who and modifies the noun phrase (antecedent) immediately before it.

Rules:
- Only report a relation if that/which/who is present and truly starts a clause modifying a
  preceding noun phrase.
- "that" is NOT always a relative pronoun. When "that" introduces a clause reporting or
  complementing a verb (e.g. "showed that X happened", "believe that X"), it is a content
  clause, not a relative clause -- do not report it.
- antecedent, relativeWord, and relativeClause must be exact substrings copied word-for-word
  from the sentence.
- antecedent must be the FULL noun phrase immediately before the relative word, including its
  determiner/quantifier (e.g. "those aspects", not just "aspects").
- relativeClause must start with relativeWord and include the rest of that clause only.
- If no relative clause is present, or you are not confident, return an empty relations array.
  Do not guess. A sentence may have zero, one, or multiple relations.

Output valid JSON matching the schema only, no prose outside the JSON.

Example 1 (relative subject):
Sentence: The device that failed was replaced.
-> {"relations":[{"antecedent":"The device","relativeWord":"that","relativeClause":"that failed"}]}

Example 2 (relative object):
Sentence: The results which we obtained were consistent.
-> {"relations":[{"antecedent":"The results","relativeWord":"which","relativeClause":"which we obtained"}]}

Example 3 (content-that, NOT relative):
Sentence: The report showed that errors decreased.
-> {"relations":[]}`

export interface FocusedRelativeLinkPromptPair {
  system: string
  user: string
}

export function buildFocusedRelativeLinkPrompt(sentence: string): FocusedRelativeLinkPromptPair {
  return { system: SYSTEM_PROMPT, user: `Sentence: ${sentence}` }
}

export function buildFocusedRelativeLinkRepairPrompt(
  sentence: string,
  previousRawText: string,
  validationError: string,
): FocusedRelativeLinkPromptPair {
  return {
    system: SYSTEM_PROMPT,
    user: `Your previous response did not match the required schema.

Sentence: ${sentence}

Your previous output:
${previousRawText}

Validation error:
${validationError}

Return a corrected JSON object only, matching the schema exactly.`,
  }
}
