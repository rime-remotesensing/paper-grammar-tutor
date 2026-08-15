import { describe, expect, it } from 'vitest'
import { shouldCallFocusedRelativeLink } from '../../src/features/grammar/domain/relativeLinkPrefilter'

// Prototype 2.3O item 16/17 — token-aware (word-boundary) call-trigger prefilter tests.
// This is a call-trigger ONLY, never relative-clause authority (item 29 of the 2.3M order,
// reapplied here) -- these tests only check whether the analyzer gets called, not whether
// what it finds is a genuine relative clause.

describe('shouldCallFocusedRelativeLink', () => {
  it('triggers on "that"', () => {
    expect(shouldCallFocusedRelativeLink('The device that failed was replaced.')).toBe(true)
  })

  it('triggers on "which"', () => {
    expect(shouldCallFocusedRelativeLink('The results which we obtained were consistent.')).toBe(true)
  })

  it('triggers on "who"', () => {
    expect(shouldCallFocusedRelativeLink('The scientist who discovered the compound won an award.')).toBe(true)
  })

  it('triggers on content-clause "that" too (prefilter is not relative-clause authority, item 18/29)', () => {
    expect(shouldCallFocusedRelativeLink('The study showed that temperature increased.')).toBe(true)
  })

  it('does not trigger when no candidate token is present', () => {
    expect(shouldCallFocusedRelativeLink('The sensor recorded data.')).toBe(false)
  })

  it('does not trigger on a substring inside an unrelated word (item 17 word-boundary discipline)', () => {
    expect(shouldCallFocusedRelativeLink('Somewhat surprisingly, the device worked.')).toBe(false)
  })

  it('does not trigger on "whose"/"whom" alone (deferred words are not production trigger tokens by themselves unless that/which/who also co-occurs)', () => {
    expect(shouldCallFocusedRelativeLink('The sensor whose calibration was updated produced stable measurements.')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(shouldCallFocusedRelativeLink('THAT is unusual.')).toBe(true)
    expect(shouldCallFocusedRelativeLink('Who called?')).toBe(true)
  })
})
