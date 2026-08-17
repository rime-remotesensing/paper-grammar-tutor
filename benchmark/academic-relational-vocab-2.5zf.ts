import { OllamaProvider } from '../src/llm/providers/ollama/OllamaProvider.ts'
import { analyzeSentence } from '../src/features/grammar/domain/GrammarAnalyzer.ts'
import { analyzeReadingGuide } from '../src/features/grammar/domain/ReadingGuideAnalyzer.ts'
import {
  groundVocabularyForDisplay,
  prepareVocabularyForDisplay,
} from '../src/features/grammar/domain/vocabularyPresentation.ts'
import { prepareExpressionsForDisplay } from '../src/features/grammar/domain/expressionPresentation.ts'

const provider = new OllamaProvider('http://localhost:11434')
const model = 'qwen2.5:7b-instruct'
const controls = [
  'The values of a and b are 10 and 20, respectively.',
  'Temperature and pressure increased by 2 K and 5 Pa, respectively.',
  'The value was approximately 10.',
  'The parameter was subsequently estimated from the observations.',
  'The correction reduces the bias, thereby improving accuracy.',
]
const respectivelyControls = new Set(controls.slice(0, 2))
const academicAdverbs = new Set([
  'respectively', 'approximately', 'subsequently', 'thereby',
])
const functionWords = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'and', 'or', 'of', 'to', 'in', 'on', 'for',
  'at', 'by', 'from', 'with',
])
const posExpectation = new Map([
  ['respectively', 'adverb'],
  ['approximately', 'adverb'],
  ['subsequently', 'adverb'],
  ['thereby', 'adverb'],
  ['estimated', 'verb'],
])

let schemaFailures = 0
let repairCount = 0
let groundingFailures = 0
let functionWordLeakage = 0
let usefulAcademicAdverbCount = 0
let wrongPosCount = 0
let respectivelyOpportunities = 0
let respectivelyInclusions = 0
let expressionVocabularyDuplicates = 0
let readingGuideFailures = 0
let respectivelyReadingOpportunities = 0
let respectivelyReadingQualityPasses = 0
let respectivelyExpressionInclusions = 0
const runs: unknown[] = []

for (let round = 1; round <= 2; round++) {
  for (const sentence of controls) {
    const grammar = await analyzeSentence({ provider, model, sentence, temperature: 0.1 })
    if (!grammar.meta.schemaValid) schemaFailures++
    if (grammar.meta.regenerated) repairCount++
    const prepared = prepareVocabularyForDisplay(grammar.analysis.vocabulary)
    const grounded = groundVocabularyForDisplay(
      grammar.analysis.vocabulary,
      grammar.analysis.normalizedText,
    )
    groundingFailures += Math.max(0, prepared.length - grounded.length)

    const vocabularyWords = new Set(grounded.map(({ word }) => word.trim().toLowerCase()))
    if (respectivelyControls.has(sentence)) {
      respectivelyOpportunities++
      if (vocabularyWords.has('respectively')) respectivelyInclusions++
    }
    for (const item of grounded) {
      const word = item.word.trim().toLowerCase()
      if (academicAdverbs.has(word)) usefulAcademicAdverbCount++
      if (functionWords.has(word)) functionWordLeakage++
      const expected = posExpectation.get(word)
      if (expected && item.partOfSpeech !== expected) wrongPosCount++
    }

    let readingGuide: Awaited<ReturnType<typeof analyzeReadingGuide>> | null = null
    let readingQuality = false
    if (respectivelyControls.has(sentence)) {
      respectivelyReadingOpportunities++
      readingGuide = await analyzeReadingGuide({
        provider,
        model,
        sentence: grammar.analysis.normalizedText,
        temperature: 0.1,
      })
      if (!readingGuide.success) {
        readingGuideFailures++
      } else {
        const guide = readingGuide.readingGuide
        const displayedExpressions = prepareExpressionsForDisplay(guide.expressions)
        const readingStepText = guide.readingSteps
          .flatMap(({ cue, explanation }) => [cue, explanation])
          .join('\n')
        const expectedTokens = sentence.startsWith('The values')
          ? [['a'], ['b'], ['10'], ['20']]
          : [['Temperature', '温度'], ['pressure', '圧力'], ['2 K'], ['5 Pa']]
        readingQuality = /それぞれ|同じ順|順番|対応/.test(readingStepText) && expectedTokens.every(
          (alternatives) => alternatives.some((token) => readingStepText.includes(token)),
        )
        if (readingQuality) respectivelyReadingQualityPasses++
        if (displayedExpressions.some(({ pattern }) => /respectively/i.test(pattern))) {
          respectivelyExpressionInclusions++
        }
        expressionVocabularyDuplicates += displayedExpressions.flatMap(({ examples }) => examples)
          .filter((text) => vocabularyWords.has(text.trim().toLowerCase())).length
      }
    }

    runs.push({
      round,
      sentence,
      vocabulary: grounded.map(({ word, contextualMeaning, partOfSpeech }) => ({
        word, contextualMeaning, partOfSpeech,
      })),
      readingQuality,
      readingGuide: readingGuide?.success ? readingGuide.readingGuide : readingGuide,
    })
  }
}

console.log(JSON.stringify({
  model,
  grammarRunCount: runs.length,
  readingGuideRunCount: respectivelyReadingOpportunities,
  respectivelyInclusion: `${respectivelyInclusions}/${respectivelyOpportunities}`,
  usefulAcademicAdverbCount,
  functionWordLeakage,
  wrongPosCount,
  groundingFailures,
  schemaFailures,
  repairCount,
  expressionVocabularyDuplicates,
  respectivelyReadingQuality: `${respectivelyReadingQualityPasses}/${respectivelyReadingOpportunities}`,
  readingGuideFailures,
  respectivelyExpressionInclusions,
  runs,
}, null, 2))
