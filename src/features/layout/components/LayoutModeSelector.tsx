import type { LayoutMode } from '../domain/layoutPreference.ts'

const OPTIONS: { mode: LayoutMode; label: string }[] = [
  { mode: 'auto', label: '自動' },
  { mode: 'side-by-side', label: '横並び' },
  { mode: 'stacked', label: '縦並び' },
]

/**
 * Prototype 2.6G2.7A item 17/23 -- a compact segmented control for the reading workspace's
 * PDF/analysis layout, deliberately placed by the caller near the PDF/workspace controls
 * (never inside grammar-analysis settings -- this controls the reading workspace, not the
 * parser). Each option is a native `<button>` with `aria-pressed` reflecting selection state
 * (keyboard-focusable and activatable by default, no custom ARIA widget pattern needed for
 * a 3-way toggle group).
 */
export function LayoutModeSelector({ mode, onChange }: { mode: LayoutMode; onChange: (mode: LayoutMode) => void }) {
  return (
    <div className="layout-mode-selector" role="group" aria-label="レイアウト">
      <span className="layout-mode-label">レイアウト</span>
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          className={`layout-mode-button${mode === option.mode ? ' is-selected' : ''}`}
          aria-pressed={mode === option.mode}
          onClick={() => onChange(option.mode)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
