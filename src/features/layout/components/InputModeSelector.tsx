export type InputMode = 'pdf' | 'text'

/** Text mode item 1: a fresh load must always start on PDF mode (never persisted, unlike
 * layout mode) -- exported as a named constant so "the default is PDF" is a directly
 * testable source-level fact, not something only observable by mounting App.tsx. */
export const DEFAULT_INPUT_MODE: InputMode = 'pdf'

const OPTIONS: { mode: InputMode; label: string }[] = [
  { mode: 'pdf', label: 'PDFを読む' },
  { mode: 'text', label: 'テキストを解析' },
]

/**
 * Top-level input-source switch: PDF selection vs. directly typed/pasted text. Both modes
 * feed the exact same `sentence` state and analysis pipeline in App.tsx -- this component
 * only decides which input surface (PdfViewer vs. a plain textarea) is visible, mirroring
 * LayoutModeSelector's segmented-control pattern (native `<button aria-pressed>`, no custom
 * ARIA widget needed for a 2-way toggle).
 */
export function InputModeSelector({ mode, onChange }: { mode: InputMode; onChange: (mode: InputMode) => void }) {
  return (
    <div className="input-mode-selector" role="group" aria-label="入力モード">
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          className={`input-mode-button${mode === option.mode ? ' is-selected' : ''}`}
          aria-pressed={mode === option.mode}
          onClick={() => onChange(option.mode)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
