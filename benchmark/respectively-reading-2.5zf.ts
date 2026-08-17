import { OllamaProvider } from '../src/llm/providers/ollama/OllamaProvider.ts'
import { analyzeReadingGuide } from '../src/features/grammar/domain/ReadingGuideAnalyzer.ts'
import { prepareExpressionsForDisplay } from '../src/features/grammar/domain/expressionPresentation.ts'
import type { TreeReadingTarget } from '../src/features/grammar/domain/treeReadingTargets.ts'

function wholeSentenceTarget(sentence: string): TreeReadingTarget[] {
  return [{
    targetId: 'tree-0', nodeKey: `0:${sentence.length}:clause`, authoritativeStart: 0, authoritativeEnd: sentence.length,
    interactionStart: 0, interactionEnd: sentence.length, displayText: sentence, authorityText: sentence,
    interactionText: sentence, role: 'clause', parentTargetId: null, parentDisplayText: null,
  }]
}

const provider = new OllamaProvider('http://localhost:11434')
const model = 'qwen2.5:7b-instruct'
const controls = [
  'The values of a and b are 10 and 20, respectively.',
  'Temperature and pressure increased by 2 K and 5 Pa, respectively.',
]
let concretePairingPasses = 0
let functionalPairingPasses = 0
let failures = 0
let displayedExpressionCount = 0
const runs: unknown[] = []

for (let round = 1; round <= 2; round++) {
  for (const sentence of controls) {
    const result = await analyzeReadingGuide({ provider, model, sentence, targets: wholeSentenceTarget(sentence), temperature: 0.1 })
    if (!result.success) {
      failures++
      runs.push({ round, sentence, error: result.error })
      continue
    }
    const respectivelyStep = result.readingGuide.readingSteps[0]
    const stepTeaching = respectivelyStep
      ? respectivelyStep.guidance
      : ''
    const expected = sentence.startsWith('The values')
      ? [['a'], ['b'], ['10'], ['20']]
      : [['Temperature', '温度'], ['pressure', '圧力'], ['2 K'], ['5 Pa']]
    const functional = /それぞれ|同じ順|順番|対応/.test(stepTeaching)
    const concrete = functional && expected.every(
      (alternatives) => alternatives.some((token) => stepTeaching.includes(token)),
    )
    if (functional) functionalPairingPasses++
    if (concrete) concretePairingPasses++
    const displayedExpressions = prepareExpressionsForDisplay(result.readingGuide.expressions)
    displayedExpressionCount += displayedExpressions.filter(({ pattern }) => (
      /respectively/i.test(pattern)
    )).length
    runs.push({
      round,
      sentence,
      functional,
      concrete,
      respectivelyStep,
      displayedExpressions,
    })
  }
}

console.log(JSON.stringify({
  model,
  runCount: controls.length * 2,
  functionalPairing: `${functionalPairingPasses}/4`,
  concretePairing: `${concretePairingPasses}/4`,
  failures,
  displayedExpressionCount,
  runs,
}, null, 2))
