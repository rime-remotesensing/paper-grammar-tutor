import { OllamaProvider } from '../src/llm/providers/ollama/OllamaProvider.ts'
import { analyzeSentence } from '../src/features/grammar/domain/GrammarAnalyzer.ts'
import {
  findVocabularyForTreeNode,
  groundVocabularyForDisplay,
} from '../src/features/grammar/domain/vocabularyPresentation.ts'

const sentence = 'This regression line can be rotated to the horizontal to normalize the data using the equation [EQUATION_6] where Ln is the normalized radiance, a and b are the y-intercept and slope of the regression line, respectively, and Lavg is the average of the measured radiance data.'
const provider = new OllamaProvider('http://localhost:11434')
const result = await analyzeSentence({
  provider,
  model: 'qwen2.5:7b-instruct',
  sentence,
  temperature: 0.1,
})
const grounded = groundVocabularyForDisplay(
  result.analysis.vocabulary,
  result.analysis.normalizedText,
)
const lavgStart = result.analysis.normalizedText.indexOf('Lavg')
const contextual = findVocabularyForTreeNode(
  { start: lavgStart, end: result.analysis.normalizedText.length },
  grounded,
)

console.log(JSON.stringify({
  schemaValid: result.meta.schemaValid,
  regenerated: result.meta.regenerated,
  llmCalls: result.meta.regenerated ? 2 : 1,
  raw: result.analysis.vocabulary,
  grounded,
  lavgSpan: { start: lavgStart, end: result.analysis.normalizedText.length },
  contextual,
}, null, 2))
