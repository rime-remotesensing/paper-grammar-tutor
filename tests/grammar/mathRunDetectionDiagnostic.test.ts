import { describe, expect, it } from 'vitest'
import { containsRelationalOperator, detectMathRuns } from '../../src/features/grammar/domain/mathRunDetection.ts'

/**
 * Prototype 2.6G2.8M2.2a Track B item 12/11 diagnostic -- verifies the hypothesis that the
 * live "r = 10" (last assignment) staying literal is a DOWNSTREAM CONSEQUENCE of Track A's
 * still-unfixed U+0002-for-"=" bug, not a separate detector/grouping defect. If this proves
 * true, Track A's own fix (once live-confirmed) should make ALL FOUR assignments shield
 * correctly with NO detector changes needed at all.
 */
describe('diagnostic: U+0002-for-"=" interaction with relational-operator detection', () => {
  const brokenSource = 't \x02 200,000 m², a \x02 5,000 m², c \x02 0.3, and r \x02 10.'
  const correctedSource = 't = 200,000 m², a = 5,000 m², c = 0.3, and r = 10.'

  it('with the CURRENT broken source (U+0002 instead of "="), no run is classified relational -- containsRelationalOperator is false for every detected run', () => {
    const runs = detectMathRuns(brokenSource)
    expect(runs.length).toBeGreaterThan(0) // still detected as math (via the m² superscript evidence)
    for (const run of runs) {
      expect(containsRelationalOperator(run.text)).toBe(false)
    }
  })

  it('with the source CORRECTED (real "="), both runs ARE classified relational', () => {
    const runs = detectMathRuns(correctedSource)
    expect(runs.length).toBe(2) // splits at "and", matching the M2 report's own finding
    for (const run of runs) {
      expect(containsRelationalOperator(run.text)).toBe(true)
    }
  })

  it('confirms: fixing Track A (real "=") is sufficient on its own -- no detector/grouping change is needed for "r = 10" to shield correctly', () => {
    const runs = detectMathRuns(correctedSource)
    const lastRun = runs[runs.length - 1]
    expect(lastRun.text).toBe('r = 10')
    expect(containsRelationalOperator(lastRun.text)).toBe(true)
  })
})
