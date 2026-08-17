import type { ReadingNote } from '../schemas/readingGuide.schema'
import type { TreeReadingTarget } from '../domain/treeReadingTargets'

type ReadingGuideStatus = 'idle' | 'loading' | 'success' | 'error'

interface TreeContextualReadingPanelProps {
  hasActiveNode: boolean
  activeTarget: TreeReadingTarget | null
  readingGuideStatus: ReadingGuideStatus
  readingSteps: readonly ReadingNote[]
  onRetry: () => void
}

/** Renders an exact application-owned targetId lookup. Source labels come from the final
 * Tree target; model output contributes guidance only. */
export function TreeContextualReadingPanel({
  hasActiveNode,
  activeTarget,
  readingGuideStatus,
  readingSteps,
  onRetry,
}: TreeContextualReadingPanelProps) {
  const note = activeTarget
    ? readingSteps.find(({ targetId }) => targetId === activeTarget.targetId) ?? null
    : null

  return (
    <div className="tree-reading-context" aria-live="polite">
      <h3>選択した部分の読み方</h3>
      {!hasActiveNode && (
        <p className="empty-note">文の構造にカーソルを合わせると、その部分の読み方を確認できます。クリックすると固定できます。</p>
      )}
      {hasActiveNode && readingGuideStatus === 'loading' && <p className="empty-note">読み方を解析中…</p>}
      {hasActiveNode && readingGuideStatus === 'error' && (
        <>
          <p className="analysis-warning" role="alert">読み方ガイドを作成できませんでした。</p>
          <button type="button" onClick={onRetry}>再試行</button>
        </>
      )}
      {hasActiveNode && readingGuideStatus === 'success' && note === null && (
        <p className="empty-note">この部分の読解メモはありません。</p>
      )}
      {note && activeTarget && (
        <ol className="reading-steps contextual-cards">
          <li className="is-active">
            <p className="card-title">{activeTarget.displayText}</p>
            <p>{note.guidance}</p>
          </li>
        </ol>
      )}
    </div>
  )
}
