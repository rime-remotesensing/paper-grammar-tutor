import { describe, expect, it } from 'vitest'
import { createRequestGuard } from '../../src/features/ocr/domain/requestGuard'

describe('createRequestGuard', () => {
  it('reports the most recently issued id as current', () => {
    const guard = createRequestGuard()
    const id = guard.next()
    expect(guard.isCurrent(id)).toBe(true)
  })

  it('marks an earlier id as stale once a newer one has been issued', () => {
    const guard = createRequestGuard()
    const staleId = guard.next()
    const currentId = guard.next()
    expect(guard.isCurrent(staleId)).toBe(false)
    expect(guard.isCurrent(currentId)).toBe(true)
  })

  it('rejects a slow async result after a newer request supersedes it', async () => {
    const guard = createRequestGuard()
    const slowId = guard.next()
    // A second, newer request starts (e.g. the user made a new selection) before the
    // first one's async work finishes.
    guard.next()
    await Promise.resolve()
    expect(guard.isCurrent(slowId)).toBe(false)
  })

  it('issues sequential, distinct ids on successive calls', () => {
    const guard = createRequestGuard()
    const first = guard.next()
    const second = guard.next()
    expect(second).not.toBe(first)
    expect(guard.isCurrent(second)).toBe(true)
    expect(guard.isCurrent(first)).toBe(false)
  })
})
