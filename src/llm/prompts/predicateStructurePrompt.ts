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
— never a bare phrase. When a "clause" dependent itself contains several finite subject-verb
units (e.g. "where A is X, B is Y, and C is Z"), keep the whole clause as the dependent's own
text, but ALSO list each finite unit as its own item in "children" — never leave several finite
units flattened into one opaque string when "children" can hold them separately.

"subjectModifiers": phrases describing the subject noun itself (e.g. "of X, Y and Z"), as
[{"text","role"}]. "sentenceModifiers": other sentence-level phrases not tied to one predicate
(e.g. a preposed clause), as [{"text","role"}].

"[EQUATION]" or "[EQUATION_n]" is one opaque expression, already written into the sentence like
any other word. Treat it as a normal dependent of whichever predicate it belongs to — never put
it in sentenceModifiers just because it looks unusual. Text after it is still part of the
sentence: keep capturing dependents normally instead of stopping at the placeholder — never drop
what follows it.

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
"sentenceModifiers":[]}

Example ("The model uses [EQUATION_1] where x is the input, y is the output, and z is the
error."):
{"subjectModifiers":[],"predicates":[{"text":"uses","relation":"main","dependents":[
{"text":"[EQUATION_1]","role":"object","children":[]},
{"text":"where x is the input, y is the output, and z is the error","role":"clause","children":[
{"text":"x is the input","role":"clause"},
{"text":"y is the output","role":"clause"},
{"text":"z is the error","role":"clause"}]}]}],"sentenceModifiers":[]}

Example ("The gain is calculated from the input signal [EQUATION_2] and is applied to the output
stage [EQUATION_3]."): two genuinely separate finite verbs joined by "and" — each equation stays
with the verb right before it, not sentenceModifiers.
{"subjectModifiers":[],"predicates":[
{"text":"is calculated","relation":"main","dependents":[{"text":"from the input signal","role":"object","children":[]},{"text":"[EQUATION_2]","role":"object","children":[]}]},
{"text":"is applied","relation":"coordinated","dependents":[{"text":"to the output stage","role":"object","children":[]},{"text":"[EQUATION_3]","role":"object","children":[]}]}],
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
