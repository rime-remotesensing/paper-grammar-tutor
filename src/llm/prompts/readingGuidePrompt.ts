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

expressions: multi-word patterns actually present in the sentence (e.g. "be + past participle",
"every + number + unit", "from A to B") — never a single word, never a pattern that is not
literally in the sentence. "text" must be an exact substring. For a relative clause with an
auxiliary verb (e.g. "that have changed"), name the pattern accurately, e.g. "that + have +
past participle" (present perfect) — never just "past participle" or "present participle" alone.

connections: plain-Japanese explanation of how parts relate (coordination, what a preposed
phrase modifies, etc.) — not just a grammar-term label by itself.

readingAdvice: 2-3 short Japanese tips on HOW to read this kind of sentence — never vocabulary
definitions.

Every cue/explanation/meaning/function/pattern/advice field must be natural Japanese only.
Never answer any of these fields in Chinese.

Output valid JSON matching the schema only, no prose outside the JSON.

Example (sentence: "Data was recorded every 1 nm in the 0.4 to 0.8 μm region and every 4 nm from
0.8 to 2.5 μm."):
{"readingSteps":[
{"text":"Data","cue":"何について？","explanation":"文の主語。"},
{"text":"was recorded","cue":"どうなった？","explanation":"受動態で記録されたことを示す。"},
{"text":"every 1 nm","cue":"どの間隔で？","explanation":"記録の間隔。"},
{"text":"in the 0.4 to 0.8 μm region","cue":"どの範囲で？","explanation":"最初の間隔が適用される波長範囲。"},
{"text":"and every 4 nm","cue":"他には？","explanation":"別の間隔が並列で示される。"},
{"text":"from 0.8 to 2.5 μm","cue":"どの範囲で？","explanation":"2つ目の間隔が適用される波長範囲。"}],
"connections":[{"text":"every 1 nm ... and every 4 nm ...","explanation":"2つの間隔条件が並列に示されている。"}],
"expressions":[
{"text":"was recorded","pattern":"be + past participle","meaning":"〜される","function":"受動態。"},
{"text":"every 1 nm","pattern":"every + number + unit","meaning":"〜ごとに","function":"間隔を示す。"},
{"text":"from 0.8 to 2.5 μm","pattern":"from A to B","meaning":"AからBまで","function":"範囲を示す。"}],
"readingAdvice":["まず主語と動詞を確認してから、条件や範囲の情報を順に読み足していく。"]}`

export interface ReadingGuidePromptPair {
  system: string
  user: string
}

export function buildReadingGuidePrompt(sentence: string): ReadingGuidePromptPair {
  return {
    system: READING_GUIDE_SYSTEM_PROMPT,
    user: `Sentence:\n${sentence}`,
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

Return a corrected JSON object only, matching the schema exactly. Remember: readingSteps.text
must be an exact substring of the sentence, and readingSteps must stay in left-to-right order.
Do not include any explanation outside the JSON.`,
  }
}
