// Short, rule-focused prompt for the "英語の語順で読む" second call. Prototype 2.3C: back to
// Prototype 2.1's original scope — pure left-to-right reading support, with no structural
// attachment tree responsibility at all (that moved to predicateStructurePrompt.ts +
// hybridPredicateMerger.ts in Prototype 2.3C; see readingGuide.schema.ts). Deliberately its
// own short prompt, separate from grammarAnalysisPrompt.ts (which stays untouched) — a
// previous experiment found lengthening the primary GrammarAnalysis prompt degraded
// qwen2.5:7b-instruct's accuracy on that call, so this stays short with at most one worked
// example rather than growing into a second long prompt.

const READING_GUIDE_SYSTEM_PROMPT = `Help a Japanese-speaking reader read an English sentence
left-to-right, in the order English actually presents it. This is NOT translation — never
produce a full Japanese translation of the sentence as your output.

readingSteps: split the sentence into consecutive chunks in the EXACT left-to-right order they
appear (do not reorder to Japanese word order). Each step's "text" must be an EXACT substring
copied verbatim from the sentence — never paraphrase, translate, or invent text not in the
sentence. "cue" is a short Japanese question the reader should ask at this point. "explanation"
is 1-2 short Japanese sentences on what this chunk adds to the reading so far — never a
full-sentence translation of the chunk. A subordinate clause with its own finite verb (e.g. a
"that"/relative/adverbial clause) should stay as its own step(s), not be merged into the step
that introduces it.

expressions: list reusable, non-obvious academic usage actually present in the sentence,
in source order. Prioritize verb/adjective/participle + preposition, collocations, and academic
phrases (e.g. "is based on", pattern "be based on ~"). "text" must be the exact English
substring. Explain the combined meaning and, briefly, the preposition's contribution when
useful. Do NOT teach elementary labels such as subject/predicate, be verb, article, conjunction,
or generic passive voice. Return [] when there is no useful expression; never invent one.
Treat generic "can be + past participle" and "where X is Y" as structure, not expressions.
Typical high-value patterns include "result in ~" and "be analogous to ~".

connections: plain-Japanese explanation of how parts relate (coordination, what a preposed
phrase modifies, etc.) — not just a grammar-term label by itself.

readingAdvice: 2-3 short Japanese tips on HOW to read this kind of sentence — never vocabulary
definitions.

Every cue/explanation/meaning/function/pattern/advice field must be natural Japanese only.
Never answer any of these fields in Chinese.

Output valid JSON matching the schema only, no prose outside the JSON.

Example (sentence: "The method is based on observations and accounts for spatial variability."):
{"readingSteps":[
{"text":"The method is based","cue":"どんな根拠？","explanation":"まず「その方法は基づいている」と受け取る。"},
{"text":"on observations","cue":"何に基づく？","explanation":"根拠となる対象を後ろから足す。"},
{"text":"and accounts for spatial variability","cue":"さらに何をする？","explanation":"空間的な変動も考慮する、と並列に読み足す。"}],
"connections":[{"text":"is based ... and accounts ...","explanation":"同じ方法について二つの性質を並列に述べる。"}],
"expressions":[
{"text":"is based on","pattern":"be based on ~","meaning":"〜に基づいている","function":"on 以下を根拠として結びつける。"},
{"text":"accounts for","pattern":"account for ~","meaning":"〜を考慮する","function":"for 以下を考慮の対象として示す。"}],
"readingAdvice":["述べられる性質を一つずつ受け取り、前置詞の後ろで対象を補う。"]}`

const RESPECTIVELY_READING_RULE = `When two ordered lists are linked by "respectively", the
readingStep containing it must explain the same-order correspondence and name the concrete pairs.
Copy each paired item name from the English source verbatim; never translate or substitute it.
In the explanation, use the sentence's actual items and values; never output placeholder letters
such as A/B/X/Y in place of them.
For example, "values of a and b are 10 and 20, respectively" should say
"a → 10、b → 20 と同じ順で対応させる。" in the respectively step.
Treat the full "A and B ... X and Y, respectively" construction as a reusable expression when useful.`

export interface ReadingGuidePromptPair {
  system: string
  user: string
}

export function buildReadingGuidePrompt(sentence: string): ReadingGuidePromptPair {
  return {
    system: READING_GUIDE_SYSTEM_PROMPT,
    user: `Sentence:\n${sentence}\n\n${RESPECTIVELY_READING_RULE}`,
  }
}

export function buildReadingGuideRepairPrompt(
  sentence: string,
  previousRawText: string,
  validationError: string,
): ReadingGuidePromptPair {
  return {
    system: READING_GUIDE_SYSTEM_PROMPT,
    user: `Your previous response for the sentence below did not match the required schema/rules.

Sentence:
${sentence}

Your previous output:
${previousRawText}

Validation error:
${validationError}

${RESPECTIVELY_READING_RULE}

Return a corrected JSON object only, matching the schema exactly. Remember: readingSteps.text
must be an exact substring of the sentence, and readingSteps must stay in left-to-right order.
Do not include any explanation outside the JSON.`,
  }
}
