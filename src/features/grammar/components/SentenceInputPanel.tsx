import sampleDataset from '../data/sampleSentences.json'

export type AnalyzePhase = 'idle' | 'analyzing' | 'confirmingCore' | 'repairingSubjectVerb' | 'verifyingComplement'

interface SentenceInputPanelProps {
  sentence: string
  onChange: (sentence: string) => void
  onAnalyze: () => void
  /** Prototype 2.4B item 4/44: explicit escape hatch for a failed/unwanted PDF selection —
   * empties the sentence and any selection/OCR provenance tied to it. Never disabled (even
   * an already-empty sentence is harmless to "clear" again). */
  onClear: () => void
  /** 'analyzing' covers the main GrammarAnalysis call; 'confirmingCore' covers the
   * existing forced-core recovery sub-step (Prototype 2.2); 'repairingSubjectVerb' covers
   * the Focused Subject-Verb Repair sub-step (Prototype 2.3L, only for a
   * SUBJECT_VERB_OVERLAP core); 'verifyingComplement' covers the focused complement
   * verifier sub-step (Prototype 2.3I) — each reached only for its specific failure
   * shape, invisible to the user as a separate action. All four share the same
   * user-facing label; the distinct phase values exist only for internal state clarity. */
  phase: AnalyzePhase
  canAnalyze: boolean
  /** Overrides the textarea placeholder (e.g. Text mode's own guidance copy). Defaults to
   * the PDF-mode example sentence. */
  placeholder?: string
  /** Overrides only the 'idle'-phase button label (e.g. Text mode's "解析する" vs. PDF
   * mode's "骨格を見る") -- every other phase label stays shared, since those describe the
   * same underlying pipeline step regardless of input source. */
  idleLabel?: string
}

const SAMPLE_SENTENCES = sampleDataset.sentences as Array<{ id: string; text: string }>

const PHASE_LABEL: Record<AnalyzePhase, string> = {
  idle: '骨格を見る',
  analyzing: '解析中…',
  confirmingCore: '文の骨格を確認中…',
  repairingSubjectVerb: '文の骨格を確認中…',
  verifyingComplement: '文の骨格を確認中…',
}

export function SentenceInputPanel({
  sentence,
  onChange,
  onAnalyze,
  onClear,
  phase,
  canAnalyze,
  placeholder = '例: The results obtained in the previous experiment indicate that the proposed method is effective.',
  idleLabel = PHASE_LABEL.idle,
}: SentenceInputPanelProps) {
  const buttonLabel = phase === 'idle' ? idleLabel : PHASE_LABEL[phase]
  return (
    <div className="sentence-input-panel">
      <label htmlFor="sentence-input">英文を入力</label>
      <textarea
        id="sentence-input"
        rows={5}
        value={sentence}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <div className="sentence-input-controls">
        <select
          aria-label="評価文から選択"
          value=""
          onChange={(e) => {
            const found = SAMPLE_SENTENCES.find((s) => s.id === e.target.value)
            if (found) onChange(found.text)
          }}
        >
          <option value="">評価文から選択…</option>
          {SAMPLE_SENTENCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}: {s.text.length > 60 ? `${s.text.slice(0, 60)}…` : s.text}
            </option>
          ))}
        </select>
        <button type="button" onClick={onAnalyze} disabled={!canAnalyze || phase !== 'idle'}>
          {buttonLabel}
        </button>
        <button type="button" onClick={onClear} disabled={phase !== 'idle'}>
          クリア
        </button>
      </div>
    </div>
  )
}
