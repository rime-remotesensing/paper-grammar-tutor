import { describe, expect, it } from 'vitest'
import { activeTreeNodeKey, EMPTY_TREE_READING_INTERACTION, reduceTreeReadingInteraction } from '../../src/features/grammar/domain/treeReadingInteraction'

describe('Tree reading hover/click/pin interaction', () => {
  it('previews a hovered or focused node', () => {
    const state = reduceTreeReadingInteraction(EMPTY_TREE_READING_INTERACTION, { type: 'preview', key: 'a' })
    expect(activeTreeNodeKey(state)).toBe('a')
  })

  it('removes an unpinned preview on leave', () => {
    const hovered = reduceTreeReadingInteraction(EMPTY_TREE_READING_INTERACTION, { type: 'preview', key: 'a' })
    expect(activeTreeNodeKey(reduceTreeReadingInteraction(hovered, { type: 'leave', key: 'a' }))).toBeNull()
  })

  it('pins on click and toggles off on a second click', () => {
    const pinned = reduceTreeReadingInteraction(EMPTY_TREE_READING_INTERACTION, { type: 'togglePin', key: 'a' })
    expect(activeTreeNodeKey(pinned)).toBe('a')
    expect(activeTreeNodeKey(reduceTreeReadingInteraction(pinned, { type: 'togglePin', key: 'a' }))).toBeNull()
  })

  it('temporarily previews another node and restores the pin on leave', () => {
    const pinned = reduceTreeReadingInteraction(EMPTY_TREE_READING_INTERACTION, { type: 'togglePin', key: 'a' })
    const preview = reduceTreeReadingInteraction(pinned, { type: 'preview', key: 'b' })
    expect(activeTreeNodeKey(preview)).toBe('b')
    expect(activeTreeNodeKey(reduceTreeReadingInteraction(preview, { type: 'leave', key: 'b' }))).toBe('a')
  })

  it('clicking another node replaces the pin', () => {
    const pinned = reduceTreeReadingInteraction(EMPTY_TREE_READING_INTERACTION, { type: 'togglePin', key: 'a' })
    const moved = reduceTreeReadingInteraction(pinned, { type: 'togglePin', key: 'b' })
    expect(moved.pinnedKey).toBe('b')
  })

  it('Escape action clears the pin without discarding a current hover preview', () => {
    const state = { hoveredKey: 'b', pinnedKey: 'a' }
    const cleared = reduceTreeReadingInteraction(state, { type: 'clearPin' })
    expect(cleared).toEqual({ hoveredKey: 'b', pinnedKey: null })
    expect(activeTreeNodeKey(cleared)).toBe('b')
  })
})
