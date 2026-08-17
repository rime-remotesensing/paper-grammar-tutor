import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TreeContextualReadingPanel } from '../../src/features/grammar/components/TreeContextualReadingPanel'
import type { TreeReadingTarget } from '../../src/features/grammar/domain/treeReadingTargets'

function target(targetId: string, displayText: string): TreeReadingTarget {
  return {
    targetId, nodeKey: `${targetId}:node`, authoritativeStart: 0, authoritativeEnd: displayText.length,
    interactionStart: 0, interactionEnd: displayText.length, displayText, authorityText: displayText,
    interactionText: displayText, role: 'subject', parentTargetId: null, parentDisplayText: null,
  }
}

function render(activeTarget: TreeReadingTarget | null, notes: Array<{ targetId: string; guidance: string }>, hasActiveNode = true) {
  return renderToStaticMarkup(createElement(TreeContextualReadingPanel, {
    hasActiveNode, activeTarget, readingGuideStatus: 'success', readingSteps: notes, onRetry: vi.fn(),
  }))
}

describe('TreeContextualReadingPanel — exact target lookup', () => {
  const subject = target('tree-0', 'Grid units and slope units')
  const complement = target('tree-0-0-0', 'the two types of evaluation units')
  const modifier = target('tree-0-0-0-0', 'most commonly used in LSM')
  const notes = [
    { targetId: subject.targetId, guidance: '二つの単位をandで並列させ、ひとまとまりとして読む。' },
    { targetId: complement.targetId, guidance: 'まず2種類の評価単位と捉え、後ろの説明を待つ。' },
    { targetId: modifier.targetId, guidance: 'LSMで最も一般的に使われる、が直前のunitsを説明する。' },
  ]

  it.each([
    ['subject', subject, notes[0].guidance],
    ['complement', complement, notes[1].guidance],
    ['modifier', modifier, notes[2].guidance],
  ])('renders only the active %s target guidance', (_label, active, expected) => {
    const markup = render(active, notes)
    expect(markup).toContain(active.displayText)
    expect(markup).toContain(expected)
    for (const other of notes.filter(({ targetId }) => targetId !== active.targetId)) {
      expect(markup).not.toContain(other.guidance)
    }
    expect(markup).not.toContain('(Lima et al. 2022)')
  })

  it('shows the normal empty state for an active trivial predicate with no target', () => {
    const markup = render(null, notes, true)
    expect(markup).toContain('この部分の読解メモはありません。')
  })

  it('never falls back by overlapping span or similar text', () => {
    const unknown = target('tree-9', 'most commonly used in LSM')
    const markup = render(unknown, notes)
    expect(markup).toContain('この部分の読解メモはありません。')
    expect(markup).not.toContain('直前のunits')
  })

  it('shows the normal empty state when an eligible target was omitted by the model', () => {
    const markup = render(complement, notes.filter(({ targetId }) => targetId !== complement.targetId))
    expect(markup).toContain('この部分の読解メモはありません。')
    expect(markup).not.toContain(complement.displayText)
  })

  it('does not invoke retry or any request callback while switching active targets', () => {
    const onRetry = vi.fn()
    for (const activeTarget of [subject, complement, modifier]) {
      renderToStaticMarkup(createElement(TreeContextualReadingPanel, {
        hasActiveNode: true,
        activeTarget,
        readingGuideStatus: 'success',
        readingSteps: notes,
        onRetry,
      }))
    }
    expect(onRetry).not.toHaveBeenCalled()
  })
})
