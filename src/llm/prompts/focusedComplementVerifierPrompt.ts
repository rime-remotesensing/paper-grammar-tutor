// Focused complement verifier prompt (Prototype 2.3I). Ported UNCHANGED from the Prototype
// 2.3H spike's final prompt.mjs — item 5 of the 2.3I order explicitly forbids prompt
// tuning this round; this exact 27-line text is the authority the 2.3H acceptance numbers
// (30/30 target, 80/80 true object-complement controls, 160/160 supplementary-ing
// controls, 0/315 malformed) were measured against. Deliberately tiny input (plain text
// subject/verb/object/candidate complement, no offsets, no full GrammarAnalysis JSON, no
// PredicateStructure result) and tiny output (one classification + one reason code) — no
// translation, no reading guide, no relative-clause work.

const SYSTEM_PROMPT = `Decide ONE thing: does "Candidate complement" describe the OBJECT itself
(a true SVOC objective complement), or is it EXTRA information added to the WHOLE main clause
after a comma (a supplementary -ing addition)?

Key test: does "Object + Candidate complement" form a true statement on its own, describing a
state/action of the object (object predication)? If yes: OBJECT_COMPLEMENT. If instead the
candidate complement describes what the SUBJECT is additionally doing, or adds new information
to the whole clause, not specifically predicating the object: SUPPLEMENTARY_ING. If genuinely
unclear either way: UNCERTAIN.

classification: OBJECT_COMPLEMENT | SUPPLEMENTARY_ING | UNCERTAIN
reasonCode: OBJECT_PREDICATION | COMMA_SUPPLEMENT | INSUFFICIENT_EVIDENCE

Output valid JSON matching the schema only, no prose outside the JSON.

Example 1:
Sentence: We found the sensor operating normally.
Subject: We / Verb: found / Object: the sensor / Candidate complement: operating normally
-> {"classification":"OBJECT_COMPLEMENT","reasonCode":"OBJECT_PREDICATION"}
("the sensor operating normally" is true on its own: object predication.)

Example 2:
Sentence: We describe the method, emphasizing its main advantages.
Subject: We / Verb: describe / Object: the method / Candidate complement: emphasizing its main advantages
-> {"classification":"SUPPLEMENTARY_ING","reasonCode":"COMMA_SUPPLEMENT"}
("the method emphasizing its main advantages" is not object predication; "emphasizing" describes
what the subject additionally does, added after a comma.)`

export interface FocusedComplementVerifierPromptPair {
  system: string
  user: string
}

export function buildFocusedComplementVerifierPrompt(
  sentence: string,
  subject: string,
  verb: string,
  object: string,
  complement: string,
): FocusedComplementVerifierPromptPair {
  return {
    system: SYSTEM_PROMPT,
    user: `Sentence: ${sentence}\nSubject: ${subject}\nVerb: ${verb}\nObject: ${object}\nCandidate complement: ${complement}`,
  }
}

export function buildFocusedComplementVerifierRepairPrompt(
  sentence: string,
  subject: string,
  verb: string,
  object: string,
  complement: string,
  previousRawText: string,
  validationError: string,
): FocusedComplementVerifierPromptPair {
  return {
    system: SYSTEM_PROMPT,
    user: `Your previous response did not match the required schema.

Sentence: ${sentence}
Subject: ${subject}
Verb: ${verb}
Object: ${object}
Candidate complement: ${complement}

Your previous output:
${previousRawText}

Validation error:
${validationError}

Return a corrected JSON object only, matching the schema exactly.`,
  }
}
