import type { HealthStatus } from '../llm/types'

interface ConnectionStatusProps {
  status: HealthStatus | null
  checking: boolean
  baseUrl: string
  onRefresh: () => void
}

export function ConnectionStatus({ status, checking, baseUrl, onRefresh }: ConnectionStatusProps) {
  const dotColor = checking ? '#c9a227' : status?.ok ? '#2e9e4f' : '#c0392b'
  const label = checking
    ? '接続確認中…'
    : status?.ok
      ? `接続済み (${baseUrl})`
      : `未接続: ${status?.message ?? '不明なエラー'}`

  return (
    <div className="connection-status">
      <span className="status-dot" style={{ backgroundColor: dotColor }} aria-hidden="true" />
      <span>{label}</span>
      <button type="button" onClick={onRefresh} disabled={checking}>
        再確認
      </button>
    </div>
  )
}
