/**
 * Prototype 2.6G2.7A -- Responsive PDF Reading Workspace.
 *
 * Separates two concepts (section 19 of the phase spec):
 *
 * `LayoutMode` -- the user's own PERSISTED preference: 'auto' lets the workspace choose
 * based on viewport geometry; 'side-by-side'/'stacked' are explicit manual overrides that
 * must survive resize/orientation changes untouched.
 *
 * `EffectiveLayout` -- what is actually rendered right now. Equal to the manual preference
 * when one is set; derived from viewport geometry only when the preference is 'auto'.
 * Never itself persisted -- persisting the RESOLVED value would silently overwrite 'auto'
 * with a specific mode the next time geometry changed, which is exactly the bug section 19
 * warns against.
 */

export type LayoutMode = 'auto' | 'side-by-side' | 'stacked'
export type EffectiveLayout = 'side-by-side' | 'stacked'

const STORAGE_KEY = 'paperGrammarTutor.layoutMode'
const VALID_MODES: readonly LayoutMode[] = ['auto', 'side-by-side', 'stacked']

function isLayoutMode(value: unknown): value is LayoutMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value)
}

/** Reads the persisted layout preference. Any missing/invalid/stale value (including a
 * value from a future/removed mode) falls back to 'auto' -- never throws, never leaves the
 * workspace in an unrenderable state. Safe to call outside a browser (returns 'auto'). */
export function readStoredLayoutMode(storage: Pick<Storage, 'getItem'> | null = safeLocalStorage()): LayoutMode {
  if (!storage) return 'auto'
  try {
    const raw = storage.getItem(STORAGE_KEY)
    return isLayoutMode(raw) ? raw : 'auto'
  } catch {
    // Storage can throw in a locked-down/private-browsing context -- never let a read
    // failure break the workspace; 'auto' is always a safe, immediately-usable default.
    return 'auto'
  }
}

/** Persists the layout preference. Silently no-ops if storage is unavailable (e.g. private
 * browsing quota errors) -- persistence is a convenience, never a hard requirement for the
 * workspace to function within the current session. */
export function writeStoredLayoutMode(mode: LayoutMode, storage: Pick<Storage, 'setItem'> | null = safeLocalStorage()): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, mode)
  } catch {
    // Ignore -- see readStoredLayoutMode's own note.
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** The minimum viewport width (CSS px) AUTO mode requires before it will ever choose
 * side-by-side -- matches the workspace's own existing `.app-main-pdf` grid breakpoint
 * (1000px), which was already tuned as "enough room for a real PDF pane and a readable
 * analysis pane at once" before this phase. Reused rather than re-derived so AUTO's
 * decision and the CSS breakpoint driving `.layout-side-by-side` never disagree. */
export const AUTO_MIN_SIDE_BY_SIDE_WIDTH = 1000

/**
 * Resolves what should actually render right now. A manual preference always wins outright
 * (section 10) -- geometry is only consulted for 'auto'. AUTO's own rule (section 9) is
 * geometry-based, never a device-name/UA sniff: wide enough AND landscape-ish (width >=
 * height) chooses side-by-side; anything narrower or taller-than-wide chooses stacked. Pure
 * function -- no DOM access -- so it is fully unit-testable and reusable from both the
 * initial render and every resize/orientation event.
 */
export function resolveEffectiveLayout(mode: LayoutMode, viewportWidth: number, viewportHeight: number): EffectiveLayout {
  if (mode === 'side-by-side') return 'side-by-side'
  if (mode === 'stacked') return 'stacked'
  const isWideEnough = viewportWidth >= AUTO_MIN_SIDE_BY_SIDE_WIDTH
  const isLandscapeIsh = viewportWidth >= viewportHeight
  return isWideEnough && isLandscapeIsh ? 'side-by-side' : 'stacked'
}
