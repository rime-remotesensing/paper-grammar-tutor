import { describe, expect, it } from 'vitest'
import {
  AUTO_MIN_SIDE_BY_SIDE_WIDTH,
  readStoredLayoutMode,
  resolveEffectiveLayout,
  writeStoredLayoutMode,
  type LayoutMode,
} from '../../src/features/layout/domain/layoutPreference.ts'

/** Minimal in-memory Storage stand-in -- avoids depending on jsdom's own localStorage
 * implementation (this codebase has no browser-environment test setup), and lets a "storage
 * throws" case be simulated directly. */
function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
}

function throwingStorage() {
  return {
    getItem: (): string => {
      throw new Error('storage unavailable')
    },
    setItem: (): void => {
      throw new Error('storage unavailable')
    },
  }
}

describe('Prototype 2.6G2.7A -- resolveEffectiveLayout', () => {
  it('(12) manual side-by-side always wins regardless of geometry', () => {
    expect(resolveEffectiveLayout('side-by-side', 300, 900)).toBe('side-by-side')
    expect(resolveEffectiveLayout('side-by-side', 3000, 400)).toBe('side-by-side')
  })

  it('(14) manual stacked always wins regardless of geometry', () => {
    expect(resolveEffectiveLayout('stacked', 3000, 400)).toBe('stacked')
    expect(resolveEffectiveLayout('stacked', 300, 900)).toBe('stacked')
  })

  it('(13) auto + wide/landscape -> side-by-side', () => {
    expect(resolveEffectiveLayout('auto', 1600, 900)).toBe('side-by-side')
    expect(resolveEffectiveLayout('auto', AUTO_MIN_SIDE_BY_SIDE_WIDTH, 500)).toBe('side-by-side')
  })

  it('(13) auto + narrow/portrait -> stacked', () => {
    expect(resolveEffectiveLayout('auto', 400, 900)).toBe('stacked') // narrow
    expect(resolveEffectiveLayout('auto', 900, 1600)).toBe('stacked') // wide enough but portrait aspect
  })

  it('auto is never device-name-based -- only viewport width/aspect drive the decision', () => {
    // Two very different "devices" with the SAME geometry must resolve identically.
    const wideLaptop = resolveEffectiveLayout('auto', 1440, 900)
    const wideExternalMonitor = resolveEffectiveLayout('auto', 1440, 900)
    expect(wideLaptop).toBe(wideExternalMonitor)
  })

  it('boundary at exactly the minimum width, landscape-ish, resolves to side-by-side', () => {
    expect(resolveEffectiveLayout('auto', AUTO_MIN_SIDE_BY_SIDE_WIDTH, AUTO_MIN_SIDE_BY_SIDE_WIDTH)).toBe('side-by-side')
    expect(resolveEffectiveLayout('auto', AUTO_MIN_SIDE_BY_SIDE_WIDTH - 1, AUTO_MIN_SIDE_BY_SIDE_WIDTH - 2)).toBe('stacked')
  })
})

describe('Prototype 2.6G2.7A -- persistence', () => {
  it('(11) default preference is auto when nothing stored', () => {
    expect(readStoredLayoutMode(memoryStorage())).toBe('auto')
  })

  it('(16) persists and re-reads a manual preference', () => {
    const storage = memoryStorage()
    writeStoredLayoutMode('side-by-side', storage)
    expect(readStoredLayoutMode(storage)).toBe('side-by-side')
    writeStoredLayoutMode('stacked', storage)
    expect(readStoredLayoutMode(storage)).toBe('stacked')
  })

  it('(17) invalid/stale stored value falls back to auto', () => {
    const storage = memoryStorage({ 'paperGrammarTutor.layoutMode': 'grid-3x3' })
    expect(readStoredLayoutMode(storage)).toBe('auto')
  })

  it('a stale value from a since-removed mode also falls back to auto', () => {
    const storage = memoryStorage({ 'paperGrammarTutor.layoutMode': 'tabbed' })
    expect(readStoredLayoutMode(storage)).toBe('auto')
  })

  it('null storage (unavailable) falls back to auto without throwing', () => {
    expect(readStoredLayoutMode(null)).toBe('auto')
  })

  it('a throwing storage implementation falls back to auto without throwing', () => {
    expect(readStoredLayoutMode(throwingStorage())).toBe('auto')
  })

  it('write silently no-ops against a throwing storage implementation', () => {
    expect(() => writeStoredLayoutMode('stacked', throwingStorage())).not.toThrow()
  })

  it('every valid LayoutMode round-trips through storage', () => {
    const storage = memoryStorage()
    const modes: LayoutMode[] = ['auto', 'side-by-side', 'stacked']
    for (const mode of modes) {
      writeStoredLayoutMode(mode, storage)
      expect(readStoredLayoutMode(storage)).toBe(mode)
    }
  })
})
