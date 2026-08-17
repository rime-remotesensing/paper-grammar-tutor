import { describe, expect, it } from 'vitest'
import { findReadingStepsForTreeNode } from '../../src/features/grammar/domain/treeReadingMatching'
import type { ResolvedReadingStep } from '../../src/features/grammar/schemas/readingGuide.schema'

function step(text: string, start: number, end = start + text.length): ResolvedReadingStep {
  return { text, cue: '', explanation: '', start, end }
}

describe('findReadingStepsForTreeNode', () => {
  it('prefers exact span matches', () => {
    expect(findReadingStepsForTreeNode({ start: 10, end: 20 }, [step('broad', 5, 25), step('exact', 10, 20)]))
      .toEqual([step('exact', 10, 20)])
  })

  it('returns multiple source-ordered steps contained by a broad tree node', () => {
    const items = [step('later', 15, 18), step('earlier', 11, 14)]
    expect(findReadingStepsForTreeNode({ start: 10, end: 20 }, items)).toEqual([items[1], items[0]])
  })

  it('uses a reading step containing a narrow tree node', () => {
    const item = step('containing item', 5, 25)
    expect(findReadingStepsForTreeNode({ start: 10, end: 20 }, [item])).toEqual([item])
  })

  it('falls back to meaningful partial overlap', () => {
    const item = step('partial', 15, 25)
    expect(findReadingStepsForTreeNode({ start: 10, end: 20 }, [item])).toEqual([item])
  })

  it('returns nothing for no overlap', () => {
    expect(findReadingStepsForTreeNode({ start: 10, end: 20 }, [step('away', 30, 34)])).toEqual([])
  })

  it('distinguishes repeated source text by grounded offsets', () => {
    const first = step('is based on', 4, 15)
    const second = step('is based on', 30, 41)
    expect(findReadingStepsForTreeNode({ start: 30, end: 41 }, [first, second])).toEqual([second])
  })

  it('matches an equation placeholder span as opaque source text', () => {
    const equation = step('[EQUATION_6]', 22, 34)
    expect(findReadingStepsForTreeNode({ start: 22, end: 34 }, [equation])).toEqual([equation])
  })

  it('ignores an ungrounded reading step', () => {
    expect(findReadingStepsForTreeNode({ start: 0, end: 4 }, [step('bad', -1, -1)])).toEqual([])
  })
})
