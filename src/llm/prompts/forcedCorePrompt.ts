// Recovery-only prompt for the user-triggered "骨格だけ再解析" second call. Deliberately
// separate from grammarAnalysisPrompt.ts's SYSTEM_PROMPT (which stays untouched) — this
// prompt asserts a precondition (the input is a confirmed complete sentence) that only
// holds when the user has explicitly triggered recovery, never for the primary request.

const FORCED_CORE_SYSTEM_PROMPT = `The input is a complete English declarative sentence that a
human reader has already confirmed is a full sentence, not a fragment.

Extract the matrix (main) clause's shared subject, subjectHead, and one or more predicateCores
as spans (exact substrings of the sentence; start/end are best-effort, the app corrects them).
Every predicate core's verb MUST be present. Use one core for each coordinated main predicate
that shares the subject, in source order. Never combine multiple verbs into one verb string.
Do not include a subordinate-clause predicate or a later clause with its own explicit subject.

verb is that core's finite verb, including any auxiliary (e.g. "was recorded"), but no
following adjective, object, adverb, or preposition. connector is null for the first core and
the exact linking word for a later core, or null for comma-only coordination.
subjectHead is the bare head noun of subject.

indirectObject, object, complement are spans when the predicate has them, or null when it
does not. Never force a modifier or prepositional/adverbial phrase into object or complement
just to fill the field — leave it null instead. complement is only an SVC/SVOC predicate noun
or adjective. A passive by/for/to/in/from/with PP is not O or C.
Do not omit an ordinary direct object: "filters noise" has object="noise" and "reported
gains" has object="gains". indirectObject is used only with an object in a true double-object
form: "gives users feedback" has indirectObject="users", object="feedback". A predicative
adjective is C: "remained significant" has complement="significant" and "was considered
unsafe" has complement="unsafe". An adverb is not C: "performed well" has no O/C.

Main-clause controls:
- "When ice melts, river levels rise." -> subject="river levels", one verb="rise".
- "Whereas one measure declined, the second measure increased." -> subject=
  "the second measure", one verb="increased".
- "The device detects smoke, estimates density, and reports the result." -> one shared
  subject and three separate predicate cores.

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
