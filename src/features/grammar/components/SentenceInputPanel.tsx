import sampleDataset from '../../../../benchmark/sentences/development.json'

interface SentenceInputPanelProps {
  sentence: string
  onChange: (sentence: string) => void
  onAnalyze: () => void
  analyzing: boolean
  canAnalyze: boolean
}

const SAMPLE_SENTENCES = sampleDataset.sentences as Array<{ id: string; text: string }>

export function SentenceInputPanel({
  sentence,
  onChange,
  onAnalyze,
  analyzing,
  canAnalyze,
}: SentenceInputPanelProps) {
  return (
    <div className="sentence-input-panel">
      <label htmlFor="sentence-input">英文を入力</label>
      <textarea
        id="sentence-input"
        rows={5}
        value={sentence}
        onChange={(e) => onChange(e.target.value)}
        placeholder="例: The results obtained in the previous experiment indicate that the proposed method is effective."
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
        <button type="button" onClick={onAnalyze} disabled={!canAnalyze || analyzing}>
          {analyzing ? '解析中…' : '解析'}
        </button>
      </div>
    </div>
  )
}
