import { describe, expect, it } from 'vitest'
import { buildGrammarAnalysisPrompt } from '../../src/llm/prompts/grammarAnalysisPrompt'
import { buildReadingGuidePrompt } from '../../src/llm/prompts/readingGuidePrompt'

describe('academic relational vocabulary prompts', () => {
  it('asks GrammarAnalysis for interpretation-changing relational words as lexical items', () => {
    const prompt = buildGrammarAnalysisPrompt('The values are 10 and 20, respectively.')

    expect(prompt.system).toContain('academically important adverbs or relational words')
    expect(prompt.system).toContain('as their own lexical item')
    expect(prompt.user).toContain('always')
    expect(prompt.user).toContain('respectively/adverb')
  })

  it('keeps POS teaching separate from the ReadingGuide pairwise explanation', () => {
    const prompt = buildReadingGuidePrompt('The values are 10 and 20, respectively.')

    expect(prompt.user).toContain('same-order correspondence')
    expect(prompt.user).toContain('never output placeholder letters')
    expect(prompt.user).toContain('a → 10、b → 20')
    expect(prompt.user).toContain('English source verbatim')
    expect(prompt.user).not.toContain('respectively/adverb')
  })

  it('allows the respectively construction to become a reusable expression', () => {
    const prompt = buildReadingGuidePrompt('The values are 10 and 20, respectively.')

    expect(prompt.user).toContain('A and B ... X and Y, respectively')
  })
})
