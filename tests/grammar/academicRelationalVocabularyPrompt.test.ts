import { describe, expect, it } from 'vitest'
import { buildGrammarAnalysisPrompt } from '../../src/llm/prompts/grammarAnalysisPrompt'
import { buildReadingGuidePrompt } from '../../src/llm/prompts/readingGuidePrompt'

const targets = [{
  targetId: 'tree-0', nodeKey: '0:43:clause', authoritativeStart: 0, authoritativeEnd: 43,
  interactionStart: 0, interactionEnd: 43, displayText: 'The values are 10 and 20, respectively',
  authorityText: 'The values are 10 and 20, respectively', interactionText: 'The values are 10 and 20, respectively',
  role: 'clause' as const, parentTargetId: null, parentDisplayText: null,
}]

describe('academic relational vocabulary prompts', () => {
  it('asks GrammarAnalysis for interpretation-changing relational words as lexical items', () => {
    const prompt = buildGrammarAnalysisPrompt('The values are 10 and 20, respectively.')

    expect(prompt.system).toContain('academically important adverbs or relational words')
    expect(prompt.system).toContain('as their own lexical item')
    expect(prompt.user).toContain('always')
    expect(prompt.user).toContain('respectively/adverb')
  })

  it('keeps POS teaching separate from the ReadingGuide pairwise explanation', () => {
    const prompt = buildReadingGuidePrompt('The values are 10 and 20, respectively.', targets)

    expect(prompt.system).toContain('same-order pairs')
    expect(prompt.system).toContain('source items')
    expect(prompt.user).toContain('respectively')
    expect(prompt.user).not.toContain('respectively/adverb')
  })

  it('allows the respectively construction to become a reusable expression', () => {
    const prompt = buildReadingGuidePrompt('The values are 10 and 20, respectively.', targets)

    expect(prompt.system).toContain('sentence-wide and independent from Tree targets')
  })

  it('states the general technical-compound interpretation principle without hardcoding any single word', () => {
    const prompt = buildGrammarAnalysisPrompt('The values are 10 and 20, respectively.')

    expect(prompt.system).toContain('technical/scientific compound')
    expect(prompt.system).toContain('ONE whole noun phrase first')
  })

  it('injects a background technical-term hint for a sentence containing a glossary phrase', () => {
    const sentence = 'VIIRS is a whiskbroom scanning radiometer with a swath width of 3060 km.'
    const prompt = buildGrammarAnalysisPrompt(sentence)

    expect(prompt.user).toContain('whiskbroom scanning radiometer')
    expect(prompt.user).toContain('ウィスクブルーム走査式放射計')
    expect(prompt.user).toContain('background knowledge only')
  })

  it('omits the technical-term hint block for a sentence with no glossary match', () => {
    const prompt = buildGrammarAnalysisPrompt('The results indicate a strong correlation between variables.')

    expect(prompt.user).not.toContain('background knowledge only')
  })
})
