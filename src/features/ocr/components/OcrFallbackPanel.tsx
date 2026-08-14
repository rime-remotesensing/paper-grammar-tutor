export type PaddleStatus = 'idle' | 'checking' | 'loading' | 'success' | 'unavailable' | 'alignmentFailed' | 'error'
export type OcrStatus = 'idle' | 'loading' | 'success' | 'error'

interface OcrFallbackPanelProps {
  /** Hidden entirely when there's no PDF selection to OCR — free-typed text in the
   * textarea has no page/geometry to re-read. */
  visible: boolean

  // Paddle (high-accuracy, GPU, primary — Prototype 1.4B). Bound to "OCRで読み直す".
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
 * Manual, user-triggered OCR fallback for embedded PDF text that came out garbled (see
 * docs/design-notes.md, Prototype 1.2/1.4B). Never auto-runs and never overwrites the
 * sentence textarea by itself — every candidate is shown separately until the user
 * explicitly accepts it, and accepting one never touches the others.
 *
 * Paddle (high-accuracy, GPU-backed) is the primary engine, triggered by "OCRで読み直す".
 * If the Paddle service is unavailable, this shows a fixed message plus two buttons —
 * "再確認" (retry the health check) and "ブラウザOCRを使う" (explicitly opt into the
 * Tesseract fallback). Tesseract NEVER runs automatically; it only runs after that second
 * button is clicked. Rule A/B are Tesseract-only extras (see scientificNormalization.ts)
 * and never apply to Paddle candidates.
 */
export function OcrFallbackPanel({
  visible,
  paddleStatus,
  paddleCandidateText,
  onRequestPaddleOcr,
  onRecheckPaddle,
  onAcceptPaddleCandidate,
  onUseBrowserOcr,
  tesseractStatus,
  tesseractCandidateText,
  ruleACandidateText,
  ruleBCandidateText,
  onAcceptTesseractCandidate,
  onAcceptRuleACandidate,
  onAcceptRuleBCandidate,
}: OcrFallbackPanelProps) {
  if (!visible) return null

  const paddleBusy = paddleStatus === 'checking' || paddleStatus === 'loading'
  const paddleButtonLabel =
    paddleStatus === 'checking' ? '確認しています…' : paddleStatus === 'loading' ? '高精度OCRを実行しています…' : 'OCRで読み直す'

  return (
    <div className="ocr-fallback-panel">
      <button type="button" className="ocr-request-button" onClick={onRequestPaddleOcr} disabled={paddleBusy}>
        {paddleButtonLabel}
      </button>

      {paddleStatus === 'success' && paddleCandidateText !== null && (
        <div className="ocr-candidate">
          <p className="ocr-candidate-label">高精度OCR候補:</p>
          <p className="ocr-candidate-text">{paddleCandidateText}</p>
          <button type="button" onClick={onAcceptPaddleCandidate}>
            この候補を使う
          </button>
        </div>
      )}

      {paddleStatus === 'unavailable' && (
        <div className="ocr-paddle-unavailable">
          <p className="analysis-warning" role="alert">
            高精度OCRサービスを利用できません。
            <br />
            PaddleOCRサービスが起動していることを確認してください。
          </p>
          <div className="ocr-unavailable-actions">
            <button type="button" onClick={onRecheckPaddle}>
              再確認
            </button>
            <button type="button" onClick={onUseBrowserOcr}>
              ブラウザOCRを使う
            </button>
          </div>
        </div>
      )}

      {paddleStatus === 'alignmentFailed' && (
        <p className="analysis-warning" role="alert">
          高精度OCR結果を選択範囲へ正しく対応付けられませんでした。
          <br />
          元の文字列は変更されていません。
        </p>
      )}

      {paddleStatus === 'error' && (
        <p className="analysis-warning" role="alert">
          高精度OCRの実行中にエラーが発生しました。元の文字列は変更されていません。
        </p>
      )}

      {tesseractStatus !== 'idle' && (
        <div className="ocr-tesseract-fallback">
          {tesseractStatus === 'loading' && <p>ブラウザOCRを実行しています…</p>}

          {tesseractStatus === 'success' && tesseractCandidateText !== null && (
            <div className="ocr-candidate">
              <p className="ocr-candidate-label">ブラウザOCR候補:</p>
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
              ブラウザOCRで読み取れませんでした。元の文字列は変更されていません。
            </p>
          )}
        </div>
      )}
    </div>
  )
}
