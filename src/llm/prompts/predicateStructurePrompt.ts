// Structure-ONLY prompt for the dedicated PredicateStructureAnalyzer call (Prototype
// 2.3C). Ported UNCHANGED from the Prototype 2.3A/2.3B spike's final `prompt.mjs` — item 8
// of the 2.3C order explicitly forbids prompt tuning this round; this text is the
// authority the 2.3B hybrid-merger acceptance numbers were measured against. Deliberately
// does not ask for readingSteps/expressions/vocabulary/advice/translation at all — that is
// ReadingGuide's job (readingGuidePrompt.ts), fully independent of this call.

const SYSTEM_PROMPT = `Analyze ONLY the grammatical structure of this English sentence. Do not
translate it. Do not produce reading steps, expressions, vocabulary, or advice — structure only.

Find EVERY main-clause predicate (finite verb phrase), including ones joined by "and"/"or" that
share the same subject. Put each in "predicates": {"text": exact substring, "relation": "main"
for the first one or "coordinated" for a later one sharing the subject, "dependents": [...]}.
IMPORTANT: only create a SECOND predicate entry if the sentence has a genuinely SECOND verb. If
there is only ONE verb but it has several parallel details (e.g. two conditions both describing
the same single verb, joined by "and"), that is still ONE predicate entry with MULTIPLE
dependents — never repeat the same verb text as two separate predicate entries.

Each dependent is something attached to that predicate: {"text": exact substring, "role":
object/complement/modifier/condition/range/clause/other, "children": [...]} — children are
nested details inside that dependent (e.g. a range narrowing a condition), at most one more
level, each {"text","role"}. "clause" is ONLY for a subordinate clause with its own finite verb
— never a bare phrase.

"subjectModifiers": phrases describing the subject noun itself (e.g. "of X, Y and Z"), as
[{"text","role"}]. "sentenceModifiers": other sentence-level phrases not tied to one predicate
(e.g. a preposed clause), as [{"text","role"}].

Every "text" must be an EXACT substring of the sentence, copied verbatim — never invent text,
never add a word (like a shared auxiliary) that is not literally written at that position.

Output valid JSON matching the schema only, no prose outside the JSON.

Example ("Data was recorded every 1 nm in the 0.4 to 0.8 μm region."):
{"subjectModifiers":[],"predicates":[{"text":"was recorded","relation":"main","dependents":[
{"text":"every 1 nm","role":"condition","children":[{"text":"in the 0.4 to 0.8 μm region","role":"range"}]}]}],"sentenceModifiers":[]}

Example ("The sensor collected data and analyzed the results."):
{"subjectModifiers":[],"predicates":[
{"text":"collected","relation":"main","dependents":[{"text":"data","role":"object","children":[]}]},
{"text":"analyzed","relation":"coordinated","dependents":[{"text":"the results","role":"object","children":[]}]}],
"sentenceModifiers":[]}`

export interface PredicateStructurePromptPair {
  system: string
  user: string
}

export function buildPredicateStructurePrompt(sentence: string): PredicateStructurePromptPair {
  return { system: SYSTEM_PROMPT, user: `Sentence:\n${sentence}` }
}

export function buildPredicateStructureRepairPrompt(
  sentence: string,
  previousRawText: string,
  validationError: string,
): PredicateStructurePromptPair {
  return {
    system: SYSTEM_PROMPT,
    user: `Your previous response did not match the required schema/rules.

Sentence:
${sentence}

Your previous output:
${previousRawText}

Validation error:
${validationError}

Return a corrected JSON object only, matching the schema exactly. Every "text" must be an exact
substring of the sentence. Do not include any explanation outside the JSON.`,
  }
}
