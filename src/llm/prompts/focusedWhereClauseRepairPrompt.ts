// Focused Where-Clause Repair prompt (Prototype 2.5W). Ported closely from the Prototype
// 2.5V spike prompt that was validated 20/20 on the exact target sentence and 5/5 correct
// abstention on a genuine ambiguity control — see docs/design-notes.md.

const SYSTEM_PROMPT = `You are given a sentence, a list of its known predicates
(finite verb phrases), and ONE subordinate clause that was left as a loose sentence-level
modifier. Decide two things:

1. "owner": which predicate (copy its EXACT text from the list) this clause structurally
   belongs to -- normally the predicate whose own material the clause immediately follows or
   depends on. If genuinely no predicate in the list is a safe, unambiguous owner (e.g. the
   clause modifies something else entirely, or multiple predicates are equally plausible),
   return null.
2. "children": if the clause contains MULTIPLE finite subject-verb units (e.g. "where A is X,
   B is Y, and C is Z"), split it into each finite unit as a separate exact substring. If it
   has only ONE finite unit, return a single-item array with the clause's own full text.

Every string must be an EXACT substring of the sentence, copied verbatim -- never invent text.

Output valid JSON matching the schema only, no prose outside the JSON.

Example:
Sentence: We use a model where x is the input and y is the output.
Predicates: ["use"]
Clause: "where x is the input and y is the output"
-> {"owner":"use","children":["x is the input","y is the output"]}`

export interface FocusedWhereClauseRepairPromptPair {
  system: string
  user: string
}

export function buildFocusedWhereClauseRepairPrompt(
  sentence: string,
  predicateCandidates: string[],
  clauseText: string,
): FocusedWhereClauseRepairPromptPair {
  const user = `Sentence:\n${sentence}\n\nPredicates: ${JSON.stringify(predicateCandidates)}\n\nClause: ${JSON.stringify(clauseText)}`
  return { system: SYSTEM_PROMPT, user }
}

export function buildFocusedWhereClauseRepairRepairPrompt(
  sentence: string,
  predicateCandidates: string[],
  clauseText: string,
  previousRawText: string,
  validationError: string,
): FocusedWhereClauseRepairPromptPair {
  return {
    system: SYSTEM_PROMPT,
    user: `Your previous response did not match the required schema/rules.

Sentence:
${sentence}

Predicates: ${JSON.stringify(predicateCandidates)}

Clause: ${JSON.stringify(clauseText)}

Your previous output:
${previousRawText}

Validation error:
${validationError}

Return a corrected JSON object only, matching the schema exactly. "owner" must exactly match
one of the listed predicates or be null. Every child must be an exact substring of the clause.
Do not include any explanation outside the JSON.`,
  }
}
