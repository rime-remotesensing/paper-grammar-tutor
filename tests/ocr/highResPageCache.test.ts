import { describe, expect, it, vi } from 'vitest'
import { getOrRenderHighRes, resetHighResRenderCache } from '../../src/features/ocr/domain/highResPageCache'

function fakeCanvas(): HTMLCanvasElement {
  return {} as HTMLCanvasElement
}

describe('getOrRenderHighRes', () => {
  it('calls render() on a cache miss', async () => {
    resetHighResRenderCache()
    const render = vi.fn(async () => fakeCanvas())
    await getOrRenderHighRes({ documentToken: 'doc-1', pageNumber: 4, scale: 6 }, render)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('reuses the cached render for the same document+page+scale without calling render again', async () => {
    resetHighResRenderCache()
    const render = vi.fn(async () => fakeCanvas())
    const key = { documentToken: 'doc-2', pageNumber: 4, scale: 6 }
    await getOrRenderHighRes(key, render)
    await getOrRenderHighRes(key, render)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('treats a different page number as a cache miss', async () => {
    resetHighResRenderCache()
    const render = vi.fn(async () => fakeCanvas())
    await getOrRenderHighRes({ documentToken: 'doc-3', pageNumber: 1, scale: 6 }, render)
    await getOrRenderHighRes({ documentToken: 'doc-3', pageNumber: 2, scale: 6 }, render)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('invalidates the cache after resetHighResRenderCache (new PDF loaded)', async () => {
    const render = vi.fn(async () => fakeCanvas())
    const key = { documentToken: 'doc-4', pageNumber: 1, scale: 6 }
    await getOrRenderHighRes(key, render)
    resetHighResRenderCache()
    await getOrRenderHighRes(key, render)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('does not poison the cache with a failed render — a later retry gets a clean call', async () => {
    resetHighResRenderCache()
    const key = { documentToken: 'doc-5', pageNumber: 1, scale: 6 }
    const failingRender = vi.fn(async () => {
      throw new Error('render failed')
    })
    await expect(getOrRenderHighRes(key, failingRender)).rejects.toThrow('render failed')

    const succeedingRender = vi.fn(async () => fakeCanvas())
    const canvas = await getOrRenderHighRes(key, succeedingRender)
    expect(canvas).toBeDefined()
    expect(succeedingRender).toHaveBeenCalledTimes(1)
  })

  it('keeps a separate cache entry per scale for the same document+page', async () => {
    resetHighResRenderCache()
    const render = vi.fn(async () => fakeCanvas())
    await getOrRenderHighRes({ documentToken: 'doc-6', pageNumber: 1, scale: 6 }, render)
    await getOrRenderHighRes({ documentToken: 'doc-6', pageNumber: 1, scale: 2 }, render)
    expect(render).toHaveBeenCalledTimes(2)
  })
})
