import { useCallback, useEffect, useState } from 'react'
import {
  readStoredLayoutMode,
  resolveEffectiveLayout,
  writeStoredLayoutMode,
  type EffectiveLayout,
  type LayoutMode,
} from './layoutPreference.ts'

export interface WorkspaceLayout {
  /** The user's persisted preference ('auto' | 'side-by-side' | 'stacked'). */
  mode: LayoutMode
  /** What should actually render right now -- equals `mode` unless `mode` is 'auto', in
   * which case it is derived from the live viewport (section 19: never persisted itself). */
  effective: EffectiveLayout
  setMode: (mode: LayoutMode) => void
}

/**
 * Prototype 2.6G2.7A item 18 -- in AUTO mode, resizing the window or rotating the device
 * updates `effective` live (the `resize` listener below re-resolves on every change); in an
 * explicit manual mode, resize events are still received but `resolveEffectiveLayout` short-
 * circuits to the manual mode regardless of geometry, so a manual choice is never silently
 * reset by orientation changes -- only an explicit `setMode` call changes it.
 */
export function useWorkspaceLayout(): WorkspaceLayout {
  const [mode, setModeState] = useState<LayoutMode>(() => readStoredLayoutMode())
  const [effective, setEffective] = useState<EffectiveLayout>(() =>
    resolveEffectiveLayout(mode, typeof window !== 'undefined' ? window.innerWidth : 1280, typeof window !== 'undefined' ? window.innerHeight : 800),
  )

  useEffect(() => {
    const recompute = () => setEffective(resolveEffectiveLayout(mode, window.innerWidth, window.innerHeight))
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [mode])

  const setMode = useCallback((next: LayoutMode) => {
    setModeState(next)
    writeStoredLayoutMode(next)
  }, [])

  return { mode, effective, setMode }
}
