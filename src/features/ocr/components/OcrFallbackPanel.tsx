import { useEffect, useState } from 'react'
import { diffForDisplay, type DiffSegment } from '../domain/textDiff'
import { getCandidateLabels } from '../domain/candidateLabels'

export type PaddleStatus = 'idle' | 'checking' | 'loading' | 'success' | 'unavailable' | 'alignmentFailed' | 'error'
export type OcrStatus = 'idle' | 'loading' | 'success' | 'error'
export type HighResStatus = 'idle' | 'loading' | 'success' | 'failed'

/** Renders diff segments with changed spans lightly marked — display only, never alters
 * the underlying candidate text (Prototype 1.5I item 10/11). */
function renderDiffSegments(segments: readonly DiffSegment[]) {
  return segments.map((seg, i) =>
    seg.changed ? (
      <mark key={i} className="ocr-diff-mark">
        {seg.text}
      </mark>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  )
}

interface OcrFallbackPanelProps {
  /** Hidden entirely when there's no PDF selection to re-read — free-typed text in the
   * textarea has no page/geometry to re-read. */
  visible: boolean

  // Paddle (high-accuracy, GPU, primary — Prototype 1.4B). Bound to "読み直す". Internal
  // engine name never surfaces in user-facing text (Prototype 2.2 item 18/19).
  paddleStatus: PaddleStatus
  paddleCandidateText: string | null
  /** Human-readable reason the last health check failed; not shown verbatim in the UI
   * (the "unavailable" message is intentionally fixed/minimal), kept for future debug use. */
  paddleUnavailableReason: string | null
  onRequestPaddleOcr: () => void
  onRecheckPaddle: () => void
  onAcceptPaddleCandidate: () => void
  /** Explicit-only Tesseract fallback trigger — never called automatically. */
  onUseBrowserOcr: () => void

  // High-resolution selected-line second-pass (Prototype 1.5D). Runs automatically right
  // after paddleStatus reaches 'success', still gated only by the same button click —
  // never shown as a separate trigger. Its candidate is only rendered when it differs
  // from paddleCandidateText (identical → no extra block, per item 2/18); it is never
  // auto-merged into the primary candidate (see paddleHighResService.ts / Prototype
  // 1.5C's consensus findings for why an automatic merge is not safe).
  highResStatus: HighResStatus
  highResCandidateText: string | null
  onAcceptHighResCandidate: () => void

  // Tesseract (browser-only fallback — Prototype 1.2), run only via onUseBrowserOcr.
  tesseractStatus: OcrStatus
  tesseractCandidateText: string | null
  /** Rule A: embedded-guided decimal middle-dot candidate (see scientificNormalization.ts). */
  ruleACandidateText: string | null
  /** Rule B: exact "um" -> "μm" OCR candidate (see scientificNormalization.ts). */
  ruleBCandidateText: string | null
  onAcceptTesseractCandidate: () => void
  onAcceptRuleACandidate: () => void
  onAcceptRuleBCandidate: () => void
}

/**
 * Manual, user-triggered re-read of embedded PDF text that came out garbled (see
 * docs/design-notes.md, Prototype 1.2/1.4B). Never auto-runs and never overwrites the
 * sentence textarea by itself — every candidate is shown separately until the user
 * explicitly accepts it, and accepting one never touches the others. User-facing text
 * deliberately never names the internal engines (OCR/Paddle/Tesseract/high-resolution) —
 * see Prototype 2.2 item 18; those names remain as internal prop/type/class identifiers.
 *
 * Paddle (high-accuracy, GPU-backed) is the primary engine, triggered by "読み直す". If
 * unavailable, this shows a fixed message plus two buttons — "再確認" (retry the health
 * check) and "別の方法で読み直す" (explicitly opt into the Tesseract fallback). Tesseract
 * NEVER runs automatically; it only runs after that second button is clicked. Rule A/B
 * are Tesseract-only extras (see scientificNormalization.ts) and never apply to Paddle
 * candidates.
 *
 * The candidate area (Prototype 2.2 item 21/22) is a collapsible panel: it opens
 * automatically the moment fresh candidates/results are ready, and closes automatically
 * the moment the user adopts one — reopenable any time via its summary, with all
 * underlying candidate/diff state preserved (nothing is unmounted on close, only hidden).
 */
export function OcrFallbackPanel({
  visible,
  paddleStatus,
  paddleCandidateText,
  onRequestPaddleOcr,
  onRecheckPaddle,
  onAcceptPaddleCandidate,
  onUseBrowserOcr,
  highResStatus,
  highResCandidateText,
  onAcceptHighResCandidate,
  tesseractStatus,
  tesseractCandidateText,
  ruleACandidateText,
  ruleBCandidateText,
  onAcceptTesseractCandidate,
  onAcceptRuleACandidate,
  onAcceptRuleBCandidate,
}: OcrFallbackPanelProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [adoptedLabel, setAdoptedLabel] = useState<string | null>(null)

  // Auto-open the instant a fresh read finishes (success or a terminal failure state) —
  // item 21. A brand-new "読み直す" click always starts from paddleStatus 'checking', so
  // this reliably fires again on every fresh attempt, not just the first one.
  useEffect(() => {
    if (paddleStatus === 'success' || paddleStatus === 'unavailable' || paddleStatus === 'alignmentFailed' || paddleStatus === 'error') {
      setPanelOpen(true)
    }
    if (paddleStatus === 'checking' || paddleStatus === 'loading') {
      setAdoptedLabel(null)
    }
  }, [paddleStatus])

  if (!visible) return null

  const paddleBusy = paddleStatus === 'checking' || paddleStatus === 'loading'
  const paddleButtonLabel =
    paddleStatus === 'checking' ? '確認しています…' : paddleStatus === 'loading' ? '読み直しています…' : '読み直す'

  const showHighRes =
    paddleStatus === 'success' && highResStatus === 'success' && highResCandidateText !== null && highResCandidateText !== paddleCandidateText
  // Pure text diff, computed only when both candidates are actually shown side by side —
  // never alters either candidate string, purely a display aid (item 10/11).
  const diff = showHighRes && paddleCandidateText !== null ? diffForDisplay(paddleCandidateText, highResCandidateText) : null
  // Neutral, non-judgmental labels (Prototype 1.5J, reworded 2.2) — never implies either
  // candidate is "correct"/"recommended", since baseline is sometimes right when high-res
  // is wrong and vice versa (see docs/design-notes.md, Prototype 1.5H/1.5I).
  const candidateLabels = getCandidateLabels(showHighRes)

  const candidateCount = paddleStatus === 'success' && paddleCandidateText !== null ? (showHighRes ? 2 : 1) : 0
  const panelSummary = adoptedLabel ? `${adoptedLabel}を使用中` : `読み取り候補（${candidateCount}件）`

  const acceptPrimary = () => {
    onAcceptPaddleCandidate()
    setAdoptedLabel(candidateLabels.primary.label)
    setPanelOpen(false)
  }
  const acceptSecondary = () => {
    onAcceptHighResCandidate()
    setAdoptedLabel(candidateLabels.secondary.label)
    setPanelOpen(false)
  }

  return (
    <div className="ocr-fallback-panel">
      <button type="button" className="ocr-request-button" onClick={onRequestPaddleOcr} disabled={paddleBusy}>
        {paddleButtonLabel}
      </button>

      {candidateCount > 0 && (
        <details
          className="ocr-candidate-panel"
          open={panelOpen}
          onToggle={(e) => setPanelOpen(e.currentTarget.open)}
        >
          <summary>{panelSummary}</summary>

          <div className="ocr-candidate">
            <p className="ocr-candidate-label">{candidateLabels.primary.label}:</p>
            <p className="ocr-candidate-text">{diff ? renderDiffSegments(diff.aSegments) : paddleCandidateText}</p>
            <button type="button" onClick={acceptPrimary}>
              {candidateLabels.primary.buttonText}
            </button>
          </div>

          {showHighRes && highResCandidateText !== null && (
            <div className="ocr-candidate">
              <p className="ocr-candidate-label">{candidateLabels.secondary.label}:</p>
              <p className="ocr-candidate-text">{diff ? renderDiffSegments(diff.bSegments) : highResCandidateText}</p>
              <button type="button" onClick={acceptSecondary}>
                {candidateLabels.secondary.buttonText}
              </button>
            </div>
          )}
        </details>
      )}

      {paddleStatus === 'success' && highResStatus === 'loading' && (
        <p className="ocr-highres-loading">さらに詳しく読み直しています…</p>
      )}

      {paddleStatus === 'unavailable' && (
        <div className="ocr-paddle-unavailable">
          <p className="analysis-warning" role="alert">
            高精度な読み取りを利用できません。
            <br />
            読み取りサービスが起動していることを確認してください。
          </p>
          <div className="ocr-unavailable-actions">
            <button type="button" onClick={onRecheckPaddle}>
              再確認
            </button>
            <button type="button" onClick={onUseBrowserOcr}>
              別の方法で読み直す
            </button>
          </div>
        </div>
      )}

      {paddleStatus === 'alignmentFailed' && (
        <p className="analysis-warning" role="alert">
          読み取り結果を選択範囲へ正しく対応付けられませんでした。
          <br />
          元の文字列は変更されていません。
        </p>
      )}

      {paddleStatus === 'error' && (
        <p className="analysis-warning" role="alert">
          読み取り中にエラーが発生しました。元の文字列は変更されていません。
        </p>
      )}

      {tesseractStatus !== 'idle' && (
        <div className="ocr-tesseract-fallback">
          {tesseractStatus === 'loading' && <p>読み取っています…</p>}

          {tesseractStatus === 'success' && tesseractCandidateText !== null && (
            <div className="ocr-candidate">
              <p className="ocr-candidate-label">候補:</p>
              <p className="ocr-candidate-text">{tesseractCandidateText}</p>
              <button type="button" onClick={onAcceptTesseractCandidate}>
                この候補を使う
              </button>
            </div>
          )}

          {tesseractStatus === 'success' && ruleACandidateText !== null && (
            <div className="ocr-candidate">
              <p className="ocr-candidate-label">小数点表記の候補:</p>
              <p className="ocr-candidate-text">{ruleACandidateText}</p>
              <button type="button" onClick={onAcceptRuleACandidate}>
                この候補を使う
              </button>
            </div>
          )}

          {tesseractStatus === 'success' && ruleBCandidateText !== null && (
            <div className="ocr-candidate">
              <p className="ocr-candidate-label">単位表記の候補:</p>
              <p className="ocr-candidate-text">{ruleBCandidateText}</p>
              <button type="button" onClick={onAcceptRuleBCandidate}>
                この候補を使う
              </button>
            </div>
          )}

          {tesseractStatus === 'error' && (
            <p className="analysis-warning" role="alert">
              読み取れませんでした。元の文字列は変更されていません。
            </p>
          )}
        </div>
      )}
    </div>
  )
}
