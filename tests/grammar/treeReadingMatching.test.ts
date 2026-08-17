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

  it('rejects a broader reading step containing a narrow tree node', () => {
    const item = step('containing item', 5, 25)
    expect(findReadingStepsForTreeNode({ start: 10, end: 20 }, [item])).toEqual([])
  })

  it('rejects partial overlap', () => {
    const item = step('partial', 15, 25)
    expect(findReadingStepsForTreeNode({ start: 10, end: 20 }, [item])).toEqual([])
  })

  it('rejects both broad live-shape overlaps around an active complement', () => {
    const items = [step('left broad step', 0, 64), step('right broad step', 65, 109)]
    expect(findReadingStepsForTreeNode({ start: 31, end: 90 }, items)).toEqual([])
  })

  it('keeps both source-ordered steps fully contained by the active complement', () => {
    const items = [step('base complement', 31, 64), step('modifier', 65, 90)]
    expect(findReadingStepsForTreeNode({ start: 31, end: 90 }, items)).toEqual(items)
  })

  it('prefers the exact child step over a broad containing complement step', () => {
    const broad = step('broad complement', 31, 90)
    const exact = step('exact modifier', 65, 90)
    expect(findReadingStepsForTreeNode({ start: 65, end: 90 }, [broad, exact])).toEqual([exact])
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
