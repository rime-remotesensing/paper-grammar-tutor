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
- List reusable, non-obvious academic usage actually present in the sentence, in source order.
- Prioritize verb/adjective/participle + preposition, collocations, and academic phrases such
  as be based on ~. text must be an exact sentence substring. When "is based on" is present,
  include it with pattern "be based on ~".
- Do not output elementary subject/predicate labels, articles, conjunctions, generic passive
  voice, generic "can be + past participle", or "where X is Y" as Expressions.
- Return [] when there is no useful expression; never invent one.

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
  const basedOn = sentence.match(/\b(?:am|is|are|was|were|be|been|being)\s+based\s+on\b/i)?.[0]
  if (basedOn) {
    requirements.push(`EXPRESSION: include {"text":"${basedOn}","pattern":"be based on ~"} with Japanese meaning/function.`)
  }

  return `Sentence:\n${sentence}\n\nAuthoritative Tree reading targets:\n${JSON.stringify(compactTargets, null, 2)}\n\nMandatory checks for this request:\n${requirements.join('\n') || '- Follow the general rules.'}`
}
