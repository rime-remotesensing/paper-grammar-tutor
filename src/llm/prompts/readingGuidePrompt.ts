import type { TreeReadingTarget } from '../../features/grammar/domain/treeReadingTargets.ts'

const READING_GUIDE_SYSTEM_PROMPT = `Help a Japanese-speaking reader process an English
sentence left-to-right. The application supplies authoritative Structure Tree targets.

readingSteps:
- Return only targetId and a concise Japanese guidance string.
- Use ONLY targetIds in the supplied target list. Never invent an ID, source text, or offset.
- A target may be omitted when it has no useful reading guidance. Do not force a note for a
  trivial copular verb.
- Explain HOW to read: what to take first, what attaches next, what an element modifies, or
  how coordinated items correspond. A short gloss is fine, but never translate the full
  sentence.
- A note that only says "read this", "add this", or states the role is not useful. Name the
  relationship: for "temperature and pressure", say the two items are joined by and and read
  as one group. For a postmodifier, say it adds information from the right to the supplied
  parentDisplayText. For a decomposed parent, say to take displayText first and then attach
  the child information shown by interactionText.
- Do not merely label subject, verb, complement, modifier, or another basic grammar category.
- displayText is the visible label. interactionText and parentDisplayText are context only;
  never claim that context is part of a different target.
- Never treat or discuss a bibliographic citation as a reading target.
- When a target contains respectively, explicitly name both same-order pairs using actual
  source items when the supplied structure supports it (for example: a → y-intercept and
  b → slope). Saying only "respectively shows the relation" is insufficient.

expressions:
- Keep this sentence-wide and independent from Tree targets.
- List EVERY reusable, non-obvious academic usage actually present in the sentence, in source
  order -- do not stop after the first one found. Not limited to idioms: also look for these
  four kinds of reusable unit, since a reader needs these just as much as fixed idioms.
- CRITICAL -- one candidate per entry, never a chained run-on: a real sentence often packs
  several DIFFERENT candidates back to back with nothing but "and"/a comma/plain adjacency
  between them. pattern must always be describable as ONE single template phrase. If
  describing what you are about to output would take more than one such phrase -- for
  instance you find yourself wanting to join two templates with a comma, with "and", or by
  listing them one after another -- that is proof you have merged two separate candidates
  into one entry by mistake. Stop, cut pattern down to only the FIRST template, cut text down
  to match only that first span, and open a brand-new second entry for the remaining
  candidate instead. text may never run past the end of the single span its own pattern
  describes, no matter how naturally the next candidate follows it in the sentence.
  For "...was placed in a low Earth orbit at an altitude of 400 km and with a 90-minute
  period.", the correct output is two separate, single-template entries: one entry with
  text "was placed in a low Earth orbit" and pattern "be placed in + orbit", and a second,
  independent entry with text "at an altitude of 400 km" and pattern "at a(n) altitude of ~".
  "and with a 90-minute period" is ordinary clause content, not itself a fixed template, so
  it is left out of both entries -- never invent a third entry just to cover leftover words.
  This split applies even when every one of those prepositional phrases happens to modify the
  SAME verb: a single verb commonly takes several adverbial PPs in a row (state/location,
  then measurement, then another detail), and each qualifying PP is still counted and
  reported as its OWN separate candidate -- sharing one verb is never a reason to combine
  them into a single multi-part entry.
  1. Verb/adjective/participle + preposition academic collocations (e.g. be based on ~, be
     associated with ~, result from ~, lead to ~, depend on ~). A verb + "on"/"in" + a plain
     calendar date or clock time (e.g. "launched on 28 October 2011") is NOT this category --
     that is ordinary time-adverbial structure, not a reusable collocation; skip it.
  2. Passive verb + preposition constructions common in technical/scientific writing (e.g. be
     widely used in ~, be commonly applied to ~, be equipped with ~, be launched aboard ~) --
     not limited to ones modified by "widely"/"commonly". (Same date/time exclusion as #1.)
  3. A verb/adjective + preposition whose reusable meaning depends on a SPECIFIC recurring
     complement noun or narrow noun class, not just the bare verb+preposition (e.g. "place ~
     in orbit", "put ~ into service", "bring ~ online"). pattern keeps that noun literal
     (e.g. "be placed in + orbit"), never generalized away as "be placed in ~". text is the
     verb phrase through that complement noun's own full noun phrase (e.g. "was placed in a
     sun synchronous orbit") -- stop there; do not continue into the next, independent
     prepositional phrase that may immediately follow.
  4. A prepositional phrase with a specialized, field-specific meaning beyond its plain
     literal reading: (a) a fixed template for a measured quantity, "at a(n) [measurement] of
     [number] [unit]" (number/unit stay "~"-abstracted, unlike case 3's fixed noun), or (b) a
     preposition used in a domain-specific associative/locative sense not obvious from an
     everyday reading (e.g. one meaning "aboard/carried by" a vehicle, pattern "onboard +
     platform"). A plain calendar date or an unremarkable bare "in/at/on + noun" is NOT this
     category -- most prepositional phrases stay unflagged; only a genuine fixed template or
     domain-specific sense qualifies. This template covers exactly one quantity phrase (one
     number plus its one unit) and text stops right there; if the sentence then continues with
     "and (with) ~" into a second, different quantity or detail, that continuation is a wholly
     separate candidate on its own merits (its own new entry if it also qualifies, otherwise
     left out) -- never widen this entry's text/pattern to swallow it.
  Fixed academic phrases (e.g. in terms of ~, with respect to ~) count too, as before.
- text must be an exact sentence substring. Normalize pattern to its base learning form
  regardless of the sentence's actual inflection (tense/number/voice): "is/are/was/were
  associated with" -> pattern "be associated with ~"; "results from"/"resulted from" ->
  pattern "result from ~" (category 3's complement noun is the one exception -- it stays
  literal in pattern, since it is the fixed/reusable part, not a variable slot).
- An ordinary compositional verb + preposition combination with no fixed/reusable value is
  not an expression (e.g. "flows downhill" is plain description). A plain calendar date/time
  (e.g. "launched on 28 October 2011") is likewise not an expression under any category --
  the date itself is never the reusable part, only a genuine fixed collocation/template
  around it (if any) would be. Do not output elementary subject/predicate labels, articles,
  conjunctions, generic passive voice with no fixed collocation, generic "can be + past
  participle", or "where X is Y" as Expressions.
- When pattern ends in a trailing preposition (e.g. "~ in ~", "~ from ~", "~ on ~"), text must
  be the single contiguous span that includes that same preposition -- never split one fixed
  phrase into a bare-verb entry plus a separate preposition-phrase entry.
- Return [] when there is no useful expression; never invent one.

Example expressions output for "The estimates are based on ground-truth measurements and are
evaluated in terms of root-mean-square error, which stems from instrument noise.":
[{"text":"are based on","pattern":"be based on ~","meaning":"〜に基づいている","function":"on 以下を根拠として結びつける。"},
{"text":"in terms of","pattern":"in terms of ~","meaning":"〜の観点で","function":"評価や比較の基準となる観点を示す。"},
{"text":"stems from","pattern":"stem from ~","meaning":"〜に由来する","function":"from 以下を発生源として結びつける。"}]

Example expressions output for "The sensor was placed in a sun-synchronous orbit at an
altitude of 705 km, onboard the Terra satellite." (categories 3 and 4 -- note THREE separate
entries, never merged into one, even though nothing but "at"/a comma separates them):
[{"text":"was placed in a sun-synchronous orbit","pattern":"be placed in + orbit","meaning":"軌道に投入される","function":"衛星などが特定の軌道という状態に置かれることを表す定型表現。"},
{"text":"at an altitude of 705 km","pattern":"at a(n) altitude of ~","meaning":"高度〜で","function":"測定値としての高度を示す定型的な言い方。"},
{"text":"onboard the Terra satellite","pattern":"onboard + platform","meaning":"〜に搭載されて","function":"衛星や機体などのプラットフォームに搭載されていることを示す。"}]

Every guidance/meaning/function field must be natural Japanese, never Chinese. pattern is a
compact reusable English form such as "be based on ~" or "be placed in + orbit".
Output valid JSON matching the schema only, with no prose outside JSON.`

export interface ReadingGuidePromptPair {
  system: string
  user: string
}

export function buildReadingGuidePrompt(
  sentence: string,
  targets: readonly TreeReadingTarget[],
): ReadingGuidePromptPair {
  return {
    system: READING_GUIDE_SYSTEM_PROMPT,
    user: buildUserPrompt(sentence, targets),
  }
}

export function buildReadingGuideRepairPrompt(
  sentence: string,
  targets: readonly TreeReadingTarget[],
  previousRawText: string,
  validationError: string,
): ReadingGuidePromptPair {
  return {
    system: READING_GUIDE_SYSTEM_PROMPT,
    user: `${buildUserPrompt(sentence, targets)}

Your previous output was invalid:
${previousRawText}

Validation error:
${validationError}

Return corrected JSON only. Use only supplied targetId values and never return offsets or
source text in readingSteps.`,
  }
}

function buildUserPrompt(sentence: string, targets: readonly TreeReadingTarget[]): string {
  const compactTargets = targets.map((target) => ({
    targetId: target.targetId,
    displayText: target.displayText,
    authorityText: target.authorityText,
    interactionText: target.interactionText,
    role: target.role,
    parentTargetId: target.parentTargetId,
    parentDisplayText: target.parentDisplayText,
  }))
  const requirements: string[] = []
  for (const target of targets) {
    if (/\b(?:and|or|nor)\b/i.test(target.displayText)) {
      requirements.push(`${target.targetId}: name the coordinated items and explain that the connector makes them one reading unit.`)
    }
    if (target.parentDisplayText && ['modifier', 'condition', 'range', 'clause', 'relativeClause'].includes(target.role)) {
      requirements.push(`${target.targetId}: explain how this information attaches to parent "${target.parentDisplayText}" from the right.`)
    }
    if (target.interactionText !== target.displayText) {
      requirements.push(`${target.targetId}: take displayText first, then explain that later information in interactionText is attached.`)
    }
  }
  if (/\brespectively\b/i.test(sentence)) {
    requirements.push('RESPECTIVELY: explicitly write every concrete first-list → second-list pair; a generic respectively explanation is invalid.')
  }

  return `Sentence:\n${sentence}\n\nAuthoritative Tree reading targets:\n${JSON.stringify(compactTargets, null, 2)}\n\nMandatory checks for this request:\n${requirements.join('\n') || '- Follow the general rules.'}`
}
