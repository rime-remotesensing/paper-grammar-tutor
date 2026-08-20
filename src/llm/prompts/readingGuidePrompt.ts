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
  order -- do not stop after the first one found.
- Prioritize academically reusable multiword units: verb/adjective/participle + preposition
  (e.g. be based on ~, be associated with ~, result from ~, lead to ~, depend on ~), fixed
  prepositional academic phrases (e.g. in terms of ~, with respect to ~, in contrast to ~),
  and common academic passive/use constructions (e.g. be widely used in ~, be commonly applied
  to ~). text must be an exact sentence substring.
- Normalize pattern to its base learning form regardless of the sentence's actual inflection
  (tense/number/voice): "is/are/was/were associated with" -> pattern "be associated with ~";
  "results from"/"resulted from" -> pattern "result from ~". text stays the literal inflected
  substring actually in the sentence; only pattern is normalized to the reusable base form.
- An ordinary compositional verb + preposition combination with no fixed/reusable academic
  value is not an expression (e.g. a bare intransitive verb + directional adverb like "flows
  downhill" is plain description, not an expression). Do not output elementary
  subject/predicate labels, articles, conjunctions, generic passive voice with no fixed
  collocation, generic "can be + past participle", or "where X is Y" as Expressions.
- When pattern ends in a trailing preposition (e.g. "~ in ~", "~ from ~", "~ on ~"), text must
  be the single contiguous span that includes that same preposition -- never split one fixed
  phrase into a bare-verb entry plus a separate preposition-phrase entry.
- Return [] when there is no useful expression; never invent one.

Example expressions output for "The estimates are based on ground-truth measurements and are
evaluated in terms of root-mean-square error, which stems from instrument noise.":
[{"text":"are based on","pattern":"be based on ~","meaning":"〜に基づいている","function":"on 以下を根拠として結びつける。"},
{"text":"in terms of","pattern":"in terms of ~","meaning":"〜の観点で","function":"評価や比較の基準となる観点を示す。"},
{"text":"stems from","pattern":"stem from ~","meaning":"〜に由来する","function":"from 以下を発生源として結びつける。"}]

Every guidance/meaning/function field must be natural Japanese, never Chinese. pattern is a
compact reusable English form such as "be based on ~".
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
