import type { ModelInfo } from '../llm/types'

interface ModelSelectorProps {
  models: ModelInfo[]
  selectedModel: string | null
  loading: boolean
  onSelect: (model: string) => void
  onRefresh: () => void
}

export function ModelSelector({
  models,
  selectedModel,
  loading,
  onSelect,
  onRefresh,
}: ModelSelectorProps) {
  return (
    <div className="model-selector">
      <label htmlFor="model-select">モデル</label>
      <select
        id="model-select"
        value={selectedModel ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        disabled={loading || models.length === 0}
      >
        {models.length === 0 && <option value="">モデルが見つかりません</option>}
        {models.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={onRefresh} disabled={loading}>
        {loading ? '取得中…' : 'モデル一覧を更新'}
      </button>
    </div>
  )
}
