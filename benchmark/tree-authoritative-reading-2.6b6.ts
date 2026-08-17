import { OllamaProvider } from '../src/llm/providers/ollama/OllamaProvider.ts'
import { analyzeReadingGuide } from '../src/features/grammar/domain/ReadingGuideAnalyzer.ts'
import type { TreeReadingTarget } from '../src/features/grammar/domain/treeReadingTargets.ts'

const provider = new OllamaProvider('http://localhost:11434')
const model = 'qwen2.5:7b-instruct'

function target(
  targetId: string,
  displayText: string,
  role: TreeReadingTarget['role'],
  options: { authorityText?: string; interactionText?: string; parentTargetId?: string; parentDisplayText?: string } = {},
): TreeReadingTarget {
  const authorityText = options.authorityText ?? displayText
  const interactionText = options.interactionText ?? authorityText
  return {
    targetId,
    nodeKey: `${targetId}:${role}`,
    authoritativeStart: 0,
    authoritativeEnd: authorityText.length,
    interactionStart: 0,
    interactionEnd: interactionText.length,
    displayText,
    authorityText,
    interactionText,
    role,
    parentTargetId: options.parentTargetId ?? null,
    parentDisplayText: options.parentDisplayText ?? null,
  }
}

const cases = [
  {
    name: 'springer',
    sentence: 'Grid units and slope units are the two types of evaluation units most commonly used in LSM (Lima et al. 2022).',
    targets: [
      target('tree-0', 'Grid units and slope units', 'subject'),
      target('tree-0-0-0', 'the two types of evaluation units', 'complement', {
        authorityText: 'the two types of evaluation units most commonly used in LSM',
        interactionText: 'the two types of evaluation units most commonly used in LSM',
      }),
      target('tree-0-0-0-0', 'most commonly used in LSM', 'condition', {
        parentTargetId: 'tree-0-0-0', parentDisplayText: 'the two types of evaluation units',
      }),
    ],
  },
  {
    name: 'respectively',
    sentence: 'The values of a and b are the y-intercept and slope of the regression line, respectively.',
    targets: [
      target('tree-0', 'The values of a and b', 'subject'),
      target('tree-0-0-0', 'the y-intercept and slope of the regression line, respectively', 'complement', {
      }),
    ],
  },
  {
    name: 'based-on',
    sentence: 'The method is based on observations.',
    targets: [
      target('tree-0', 'The method', 'subject'),
      target('tree-0-0', 'is based', 'predicate', { parentTargetId: 'tree-0', parentDisplayText: 'The method' }),
      target('tree-0-0-0', 'on observations', 'condition', { parentTargetId: 'tree-0-0', parentDisplayText: 'is based' }),
    ],
  },
] as const

const usefulReading = /ひとまとまり|一つの読み|並列|後ろ|右側|先に|まず|付け|付く|説明|対応|それぞれ|→/
const basicGrammar = /主語|動詞|述語|補語|修飾語|subject|predicate|verb|complement|modifier/i
const citation = /Lima\s+et\s+al\.|\b2022\b/i

const runs: unknown[] = []
let schemaFailures = 0
let invalidTargetIds = 0
let expectedNotes = 0
let returnedNotes = 0
let usefulJapaneseGuidance = 0
let basicGrammarOnlyNotes = 0
let citationLeakage = 0
let outOfTargetLeakage = 0
let respectivelyPairingPasses = 0
let basedOnExpressionPasses = 0

for (const control of cases) {
  for (let run = 1; run <= 10; run++) {
    expectedNotes += control.targets.length
    const result = await analyzeReadingGuide({
      provider, model, sentence: control.sentence, targets: control.targets, temperature: 0.1,
    })
    if (!result.success) {
      schemaFailures += 1
      runs.push({ control: control.name, run, success: false, error: result.error })
      continue
    }

    invalidTargetIds += result.invalidTargetIds.length
    outOfTargetLeakage += result.invalidTargetIds.length
    const notes = result.readingGuide.readingSteps
    returnedNotes += notes.length
    for (const note of notes) {
      const isJapanese = /[ぁ-んァ-ヶ一-龠]/.test(note.guidance)
      if (isJapanese && usefulReading.test(note.guidance)) usefulJapaneseGuidance += 1
      if (basicGrammar.test(note.guidance) && !usefulReading.test(note.guidance)) basicGrammarOnlyNotes += 1
      if (citation.test(note.guidance)) citationLeakage += 1
    }
    for (const expression of result.readingGuide.expressions) {
      if (citation.test(`${expression.pattern} ${expression.meaning} ${expression.function}`)) citationLeakage += 1
    }

    const teaching = [
      ...notes.map(({ guidance }) => guidance),
      ...result.readingGuide.expressions.flatMap(({ pattern, meaning, function: expressionFunction }) => [pattern, meaning, expressionFunction]),
    ].join('\n')
    const respectivelyPass = control.name === 'respectively'
      && ['a', 'b', 'y-intercept', 'slope'].every((token) => teaching.toLowerCase().includes(token))
      && /それぞれ|対応|→/.test(teaching)
    if (respectivelyPass) respectivelyPairingPasses += 1

    const basedOnPass = control.name === 'based-on' && result.readingGuide.expressions.some(
      ({ text, pattern }) => /is based on/i.test(text) && /be based on/i.test(pattern),
    )
    if (basedOnPass) basedOnExpressionPasses += 1

    runs.push({
      control: control.name,
      run,
      success: true,
      invalidTargetIds: result.invalidTargetIds,
      notes,
      expressions: result.readingGuide.expressions.map(({ text, pattern }) => ({ text, pattern })),
      respectivelyPass,
      basedOnPass,
    })
  }
}

console.log(JSON.stringify({
  model,
  statistics: {
    runs: 30,
    schemaFailures,
    invalidTargetIds,
    meaningfulTargetNoteCoverage: `${returnedNotes}/${expectedNotes}`,
    missingMeaningfulTargetNotes: expectedNotes - returnedNotes,
    usefulJapaneseGuidance,
    basicGrammarOnlyNotes,
    citationLeakage,
    outOfTargetLeakage,
    respectivelyPairingPasses: `${respectivelyPairingPasses}/10`,
    basedOnExpressionPasses: `${basedOnExpressionPasses}/10`,
  },
  runs,
}, null, 2))
