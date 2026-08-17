import { OllamaProvider } from '../src/llm/providers/ollama/OllamaProvider.ts'
import { analyzeSentence } from '../src/features/grammar/domain/GrammarAnalyzer.ts'
import { groundVocabularyForDisplay, prepareVocabularyForDisplay } from '../src/features/grammar/domain/vocabularyPresentation.ts'
import type { VocabularyPartOfSpeech } from '../src/features/grammar/schemas/grammarAnalysis.schema.ts'

const provider = new OllamaProvider('http://localhost:11434')
const model = 'qwen2.5:7b-instruct'
const controls = [
  'This regression line can be rotated to the horizontal to normalize the data.',
  'Ln is the normalized radiance.',
  'a and b are the y-intercept and slope of the regression line, respectively.',
  'The method accounts for spatial variability.',
  'These differences result in a substantial reduction in accuracy.',
]

const functionWords = new Set(['the', 'a', 'an', 'is', 'are', 'and', 'or', 'of', 'to', 'in', 'on', 'for'])
const expressionOnly = new Set(['account for', 'accounts for', 'result in', 'results in'])
const expectedPos = new Map<string, Set<VocabularyPartOfSpeech>>([
  ['regression', new Set(['noun', 'adjective'])],
  ['regression line', new Set(['nounPhrase'])],
  ['horizontal', new Set(['noun', 'adjective'])],
  ['normalize', new Set(['verb'])],
  ['normalized', new Set(['adjective'])],
  ['radiance', new Set(['noun'])],
  ['normalized radiance', new Set(['nounPhrase'])],
  ['y-intercept', new Set(['noun'])],
  ['slope', new Set(['noun'])],
  ['respectively', new Set(['adverb'])],
  ['spatial', new Set(['adjective'])],
  ['variability', new Set(['noun'])],
  ['spatial variability', new Set(['nounPhrase'])],
  ['differences', new Set(['noun'])],
  ['substantial', new Set(['adjective'])],
  ['reduction', new Set(['noun'])],
  ['accuracy', new Set(['noun'])],
])

let schemaFailures = 0
let repairCount = 0
let usefulVocabularyCount = 0
let functionWordLeakage = 0
let invalidPosCount = 0
let obviouslyWrongPosCount = 0
let groundingFailures = 0
let expressionVocabularyDuplicates = 0
const runs: unknown[] = []

for (let round = 1; round <= 2; round++) {
  for (const sentence of controls) {
    const result = await analyzeSentence({ provider, model, sentence, temperature: 0.1 })
    if (!result.meta.schemaValid) schemaFailures++
    if (result.meta.regenerated) repairCount++

    const prepared = prepareVocabularyForDisplay(result.analysis.vocabulary)
    const grounded = groundVocabularyForDisplay(result.analysis.vocabulary, result.analysis.normalizedText)
    groundingFailures += Math.max(0, prepared.length - grounded.length)
    usefulVocabularyCount += grounded.length

    for (const item of grounded) {
      const normalizedWord = item.word.trim().toLowerCase()
      if (functionWords.has(normalizedWord)) functionWordLeakage++
      if (!expectedPos.has(normalizedWord)) continue
      const allowed = expectedPos.get(normalizedWord)!
      if (!allowed.has(item.partOfSpeech)) obviouslyWrongPosCount++
    }
    expressionVocabularyDuplicates += grounded.filter(({ word }) => expressionOnly.has(word.trim().toLowerCase())).length

    // Invalid values cannot survive Zod validation; keep this explicit in the report.
    invalidPosCount += grounded.filter(({ partOfSpeech }) => ![
      'noun', 'verb', 'adjective', 'adverb', 'nounPhrase', 'verbPhrase',
      'adjectivePhrase', 'adverbialPhrase', 'other',
    ].includes(partOfSpeech)).length

    runs.push({
      round,
      sentence,
      schemaValid: result.meta.schemaValid,
      regenerated: result.meta.regenerated,
      vocabulary: grounded.map(({ word, contextualMeaning, partOfSpeech, start, end }) => ({
        word, contextualMeaning, partOfSpeech, start, end,
      })),
    })
  }
}

console.log(JSON.stringify({
  model,
  runCount: runs.length,
  schemaFailures,
  repairCount,
  usefulVocabularyCount,
  functionWordLeakage,
  invalidPosCount,
  obviouslyWrongPosCount,
  groundingFailures,
  expressionVocabularyDuplicates,
  runs,
}, null, 2))
