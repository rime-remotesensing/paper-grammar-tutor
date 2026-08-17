import { OllamaProvider } from '../src/llm/providers/ollama/OllamaProvider.ts'
import { buildReadingGuidePrompt } from '../src/llm/prompts/readingGuidePrompt.ts'
import { READING_GUIDE_JSON_SCHEMA } from '../src/features/grammar/schemas/readingGuide.jsonSchema.ts'
import { llmReadingGuideSchema } from '../src/features/grammar/schemas/readingGuide.schema.ts'
import { groundReadingGuide } from '../src/features/grammar/domain/readingGuideGrounding.ts'
import { analyzeSentence } from '../src/features/grammar/domain/GrammarAnalyzer.ts'
import { tryParseJson } from '../src/utils/jsonExtract.ts'
import { prepareVocabularyForDisplay } from '../src/features/grammar/domain/vocabularyPresentation.ts'
import type { TreeReadingTarget } from '../src/features/grammar/domain/treeReadingTargets.ts'

function wholeSentenceTarget(sentence: string): TreeReadingTarget[] {
  return [{
    targetId: 'tree-0', nodeKey: `0:${sentence.length}:clause`, authoritativeStart: 0, authoritativeEnd: sentence.length,
    interactionStart: 0, interactionEnd: sentence.length, displayText: sentence, authorityText: sentence,
    interactionText: sentence, role: 'clause', parentTargetId: null, parentDisplayText: null,
  }]
}

const model = 'qwen2.5:7b-instruct'
const provider = new OllamaProvider('http://localhost:11434')
const sentences = [
  'The parameter C is a function of the regression slope (b) and intercept (a) [EQUATION_8] and is introduced to the cosine correction model as an additive term [EQUATION_9]',
  'This regression line can be rotated to the horizontal to normalize the data using the equation [EQUATION_6] where Ln is the normalized radiance, a and b are the y-intercept and slope of the regression line, respectively, and Lavg is the average of the measured radiance data.',
  'The method is based on observations and accounts for spatial variability.',
  'The parameter is analogous to the measured response.',
  'These differences result in a substantial reduction in accuracy.',
]

const basicGrammar = /\b(subject|predicate|be verb|article|conjunction|passive voice|past participle|can be ~|where ~ is ~)\b|主語|述語|be動詞|冠詞|接続詞|受動態/i
const usefulUsage = /\b(on|for|to|in|of|with|as|from|into|account|result|based|analogous)\b/i
const functionWords = new Set(['the', 'a', 'an', 'is', 'are', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'as'])

const guideRuns: unknown[] = []
let schemaFailures = 0
let groundingFailures = 0
let rawInventedExpressions = 0
let groundedExactSourceItems = 0
let usefulExpressionCount = 0
let basicGrammarNoteCount = 0

for (let round = 1; round <= 2; round++) {
  for (const sentence of sentences) {
    const targets = wholeSentenceTarget(sentence)
    const prompt = buildReadingGuidePrompt(sentence, targets)
    const response = await provider.generateStructured({
      model,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      jsonSchema: READING_GUIDE_JSON_SCHEMA,
      temperature: 0.1,
    })
    const parsed = tryParseJson(response.rawText)
    if ('error' in parsed) {
      schemaFailures++
      guideRuns.push({ round, sentence, success: false, error: parsed.error })
      continue
    }
    const checked = llmReadingGuideSchema.safeParse(parsed.value)
    if (!checked.success) {
      schemaFailures++
      guideRuns.push({ round, sentence, success: false, error: checked.error.issues })
      continue
    }

    rawInventedExpressions += checked.data.expressions.filter(({ text }) => !sentence.includes(text)).length
    const grounded = groundReadingGuide(checked.data, sentence, targets)

    const { readingSteps, expressions } = grounded.readingGuide
    groundedExactSourceItems += readingSteps.length + expressions.length
    usefulExpressionCount += expressions.filter((item) => usefulUsage.test(`${item.text} ${item.pattern}`)).length
    basicGrammarNoteCount += expressions.filter((item) => basicGrammar.test(`${item.pattern} ${item.meaning} ${item.function}`)).length
    guideRuns.push({
      round,
      sentence,
      success: true,
      expressions: expressions.map(({ text, pattern }) => ({ text, pattern })),
    })
  }
}

const vocabularyRuns: unknown[] = []
let vocabularyItems = 0
let rawVocabularyItems = 0
let basicVocabularyItems = 0
for (const sentence of sentences) {
  const result = await analyzeSentence({ provider, model, sentence, temperature: 0.1 })
  rawVocabularyItems += result.analysis.vocabulary.length
  const words = prepareVocabularyForDisplay(result.analysis.vocabulary).map(({ word }) => word)
  vocabularyItems += words.length
  basicVocabularyItems += words.filter((word) => functionWords.has(word.trim().toLowerCase())).length
  vocabularyRuns.push({ sentence, schemaValid: result.meta.schemaValid, words })
}

console.log(JSON.stringify({
  model,
  readingGuideRuns: guideRuns.length,
  schemaFailures,
  groundingFailures,
  rawInventedExpressions,
  groundedExactSourceItems,
  usefulExpressionCount,
  basicGrammarNoteCount,
  vocabularyRunCount: vocabularyRuns.length,
  rawVocabularyItems,
  vocabularyItems,
  basicVocabularyItems,
  guideRuns,
  vocabularyRuns,
}, null, 2))
