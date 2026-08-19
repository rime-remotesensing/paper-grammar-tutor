import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionStatus } from './components/ConnectionStatus'
import { ModelSelector } from './components/ModelSelector'
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_TEMPERATURE,
  OCR_MATCH_TOLERANCE_PX,
  OCR_RENDER_SCALE,
  PADDLE_HIGH_RES_SCALE,
} from './config/settings'
import { AnalysisResultPanel } from './features/grammar/components/AnalysisResultPanel'
import { SentenceInputPanel, type AnalyzePhase } from './features/grammar/components/SentenceInputPanel'
import type { VerifiedSentenceAnalysisWithSyntaxAuthority } from './features/grammar/domain/analyzeSentenceWithSyntaxAuthority'
import { analyzeSentenceWithSyntaxAuthority } from './features/grammar/domain/analyzeSentenceWithSyntaxAuthority'
import { restoreEquationPlaceholdersInFreeText } from './features/grammar/domain/equationPlaceholder'
import { normalizeSentenceForGrammarAnalysis } from './features/grammar/domain/grammarInputNormalization'
import { getModelSizeAdvisory } from './features/grammar/domain/modelSizeAdvisory'
import { OcrFallbackPanel, type OcrStatus, type PaddleStatus, type HighResStatus } from './features/ocr/components/OcrFallbackPanel'
import { matchWordsToRects, toPixelRect, joinOcrWords } from './features/ocr/domain/ocrGeometry'
import { extractPaddleCandidate } from './features/ocr/domain/paddleAdapter'
import { checkPaddleAvailability, recognizePageWithPaddle, resetPaddleCache } from './features/ocr/domain/paddleOcrService'
import { recognizeSelectedLinesHighRes } from './features/ocr/domain/paddleHighResService'
import { resetHighResRenderCache } from './features/ocr/domain/highResPageCache'
import { recognizePage, resetOcrCache } from './features/ocr/domain/ocrService'
import { createRequestGuard } from './features/ocr/domain/requestGuard'
import { applyRuleA, applyRuleB } from './features/ocr/domain/scientificNormalization'
import { PdfViewer, type PdfViewerHandle } from './features/pdf/components/PdfViewer'
import type { PdfSelectionResult } from './features/pdf/domain/pdfViewerState'
import { combineFragments, type SelectionFragment } from './features/pdf/domain/crossPageSelection'
import { OllamaProvider } from './llm/providers/ollama/OllamaProvider'
import type { HealthStatus, ModelInfo } from './llm/types'
import { LLMProviderError } from './llm/types'
import './App.css'

export default function App() {
  const [baseUrlInput, setBaseUrlInput] = useState(DEFAULT_OLLAMA_BASE_URL)
  const [activeBaseUrl, setActiveBaseUrl] = useState(DEFAULT_OLLAMA_BASE_URL)
  const provider = useMemo(() => new OllamaProvider(activeBaseUrl), [activeBaseUrl])

  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [checkingHealth, setCheckingHealth] = useState(false)

  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)

  const [sentence, setSentence] = useState('')
  const [selectionPageNumber, setSelectionPageNumber] = useState<number | null>(null)
  const [analyzePhase, setAnalyzePhase] = useState<AnalyzePhase>('idle')
  const [result, setResult] = useState<VerifiedSentenceAnalysisWithSyntaxAuthority | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  // Guards the "骨格を見る" flow (GrammarAnalysis + automatic forced-core recovery +
  // focused complement verification, Prototype 2.2/2.3I) against a slow in-flight call
  // landing after a newer one has started — same pattern as ocrRequestGuardRef below, but
  // a separate guard since these are two independent async flows. The whole
  // analyzeSentenceWithComplementVerification() call (including its internal focused
  // verifier step) is one guarded flow, so no additional guard is needed for that step.
  const analyzeRequestGuardRef = useRef(createRequestGuard())

  const pdfViewerRef = useRef<PdfViewerHandle>(null)
  // Bumped on every new PDF load; scopes the OCR page cache to "this document" (a
  // filename alone isn't a safe cache key — two different PDFs can share a name).
  const [documentToken, setDocumentToken] = useState(0)
  const [selectionMetadata, setSelectionMetadata] = useState<PdfSelectionResult | null>(null)
  // Prototype 2.4B-R8 item 37: set whenever PdfViewer reports that a cross-block/cross-page
  // selection couldn't be resolved (the local PyMuPDF layout service is unreachable, or
  // returned an error) -- never a silent fallback, so the user sees an explicit message
  // instead of a wrong/partial sentence. Same-block selections never trigger this.
  const [selectionFailedMessage, setSelectionFailedMessage] = useState<string | null>(null)

  // Prototype 2.4B: PdfViewer now reconstructs cross-page/cross-column selections itself
  // (continuous scroll + a single drag) and reports one fragment per touched page in a
  // single onSelection call — no more manual "次ページの続きを選ぶ" step (2.4A's
  // CrossPageContinuationControl/continuationStatus are gone; only the underlying,
  // still-useful fragment/classifier/join modules from 2.4A remain). `crossPageFragments`
  // is kept purely as UI provenance (the "Nページから選択" note, and gating OCR to
  // single-page selections only) — App.tsx no longer builds fragments itself.
  const [crossPageFragments, setCrossPageFragments] = useState<SelectionFragment[]>([])

  // Paddle is the primary OCR engine (Prototype 1.4B). "unavailable"/"alignmentFailed" are
  // distinct terminal states, not folded into "error" — the UI needs to tell them apart
  // (unavailable offers the explicit Tesseract-fallback buttons; alignmentFailed doesn't).
  const [paddleStatus, setPaddleStatus] = useState<PaddleStatus>('idle')
  const [paddleCandidate, setPaddleCandidate] = useState<string | null>(null)
  const [paddleUnavailableReason, setPaddleUnavailableReason] = useState<string | null>(null)

  // High-resolution selected-line second-pass (Prototype 1.5D). Triggered by the same
  // "OCRで読み直す" click, right after the 2x baseline succeeds — never by confidence,
  // regex, or any other automatic signal. Its own independent candidate; never merged
  // into paddleCandidate (see docs/design-notes.md, Prototype 1.5C's consensus findings
  // for why an automatic m/µm merge is not safe).
  const [highResStatus, setHighResStatus] = useState<HighResStatus>('idle')
  const [highResCandidate, setHighResCandidate] = useState<string | null>(null)

  // Tesseract only ever runs when the user explicitly clicks "ブラウザOCRを使う" after
  // Paddle is reported unavailable — never as an automatic fallback (see docs/design-notes.md,
  // Prototype 1.4B). Rule A/B are Tesseract-only extras (they were cross-validated against
  // Tesseract's own failure patterns, not Paddle's — see scientificNormalization.ts).
  const [tesseractStatus, setTesseractStatus] = useState<OcrStatus>('idle')
  const [tesseractCandidate, setTesseractCandidate] = useState<string | null>(null)
  const [ruleACandidate, setRuleACandidate] = useState<string | null>(null)
  const [ruleBCandidate, setRuleBCandidate] = useState<string | null>(null)

  // Shared by both engines: guards against a slow OCR request's result landing after the
  // user has already made a newer selection or loaded a different PDF.
  const ocrRequestGuardRef = useRef(createRequestGuard())

  const refreshModels = useCallback(async () => {
    setModelsLoading(true)
    try {
      const list = await provider.listModels()
      setModels(list)
      setSelectedModel((current) => {
        if (current && list.some((m) => m.name === current)) return current
        return list[0]?.name ?? null
      })
    } catch {
      setModels([])
    } finally {
      setModelsLoading(false)
    }
  }, [provider])

  const refreshConnection = useCallback(async () => {
    setCheckingHealth(true)
    const status = await provider.healthCheck()
    setHealth(status)
    setCheckingHealth(false)
    if (status.ok) {
      void refreshModels()
    } else {
      setModels([])
      setSelectedModel(null)
    }
  }, [provider, refreshModels])

  useEffect(() => {
    void refreshConnection()
  }, [refreshConnection])

  const handleApplyBaseUrl = () => {
    setActiveBaseUrl(baseUrlInput.trim() || DEFAULT_OLLAMA_BASE_URL)
  }

  const handleAnalyze = async () => {
    if (!selectedModel || sentence.trim().length === 0) return
    const requestId = analyzeRequestGuardRef.current.next()
    setAnalyzeError(null)
    try {
      // Prototype 2.5G item 9/10/49 + 2.5H item 5: the textarea's source/display text
      // (equation placeholders as "[式 (N)]", citation markers like "[9]" fully visible)
      // is converted to analysis form ONLY at this one grammar-input boundary -- citations
      // removed entirely (metadata, not a grammatical constituent), equation placeholders
      // normalized to "[EQUATION_N]" -- so the whole analysis pipeline (including span
      // offset resolution) operates on one consistent representation. The textarea itself
      // is never touched.
      const analysisInput = normalizeSentenceForGrammarAnalysis(sentence)
      const outcome = await analyzeSentenceWithSyntaxAuthority({
        provider,
        model: selectedModel,
        sentence: analysisInput,
        temperature: DEFAULT_TEMPERATURE,
        onPhaseChange: (phase) => {
          if (analyzeRequestGuardRef.current.isCurrent(requestId)) setAnalyzePhase(phase)
        },
      })
      if (!analyzeRequestGuardRef.current.isCurrent(requestId)) return
      if (outcome.success) {
        // Item 12/13: restore "[式 (N)]" for display, but ONLY within LLM-generated
        // free-text explanation fields -- never the offset-derived span text (see
        // equationPlaceholder.ts's own doc comment for why).
        setResult({ ...outcome.result, analysis: restoreEquationPlaceholdersInFreeText(outcome.result.analysis) })
      } else {
        setResult(null)
        setAnalyzeError(outcome.error)
      }
    } catch (err) {
      if (!analyzeRequestGuardRef.current.isCurrent(requestId)) return
      setResult(null)
      setAnalyzeError(
        err instanceof LLMProviderError
          ? err.message
          : '解析中に予期しないエラーが発生しました。Ollamaの接続状態を確認してください。',
      )
    } finally {
      if (analyzeRequestGuardRef.current.isCurrent(requestId)) setAnalyzePhase('idle')
    }
  }

  const clearOcrState = () => {
    setPaddleStatus('idle')
    setPaddleCandidate(null)
    setPaddleUnavailableReason(null)
    setHighResStatus('idle')
    setHighResCandidate(null)
    setTesseractStatus('idle')
    setTesseractCandidate(null)
    setRuleACandidate(null)
    setRuleBCandidate(null)
  }

  // Prototype 2.4B: PdfViewer now reconstructs reading order itself (continuous scroll +
  // a single drag can cross a page or column boundary) and hands back one fragment per
  // touched page from a single mouseup -- no more manual "next page" step (2.4A's
  // CrossPageContinuationControl/continuationStatus are gone; the underlying fragment/
  // classifier/join modules from 2.4A remain and are now called inside PdfViewer itself).
  // A new selection always REPLACES the old one, whether it touched one page or several
  // (item 45).
  const handlePdfSelection = (fragments: SelectionFragment[]) => {
    if (fragments.length === 0) return
    setSelectionFailedMessage(null)
    setSentence(combineFragments(fragments))
    setSelectionPageNumber(fragments[0].pageNumber)
    setResult(null)
    setAnalyzeError(null)
    setAnalyzePhase('idle')
    setSelectionMetadata(fragments[0].selection)
    setCrossPageFragments(fragments)
    clearOcrState()
    ocrRequestGuardRef.current.next()
    analyzeRequestGuardRef.current.next()
  }

  // Prototype 2.4B-R8 item 37: a resolution failure never touches the current
  // sentence/selection/analysis state -- only surfaces the message, so a previously
  // accepted selection is never wiped out by an unrelated failed drag.
  const handlePdfSelectionFailed = (message: string) => {
    setSelectionFailedMessage(message)
  }

  // Bound to "クリア" (item 4/44): explicit escape hatch for a failed/unwanted selection.
  // Never touches the PDF itself or the current scroll position -- only the same
  // sentence/analysis/OCR/selection-provenance state a fresh selection would also reset.
  const handleClear = () => {
    setSentence('')
    setSelectionPageNumber(null)
    setResult(null)
    setAnalyzeError(null)
    setAnalyzePhase('idle')
    setSelectionMetadata(null)
    setCrossPageFragments([])
    setSelectionFailedMessage(null)
    clearOcrState()
    ocrRequestGuardRef.current.next()
    analyzeRequestGuardRef.current.next()
  }

  // A different PDF may describe different content entirely; carrying over a selection,
  // sentence, or analysis result from the previous document would be misleading.
  const handlePdfDocumentChange = () => {
    setSentence('')
    setSelectionPageNumber(null)
    setResult(null)
    setAnalyzeError(null)
    setAnalyzePhase('idle')
    setDocumentToken((t) => t + 1)
    setSelectionMetadata(null)
    // Item 64: a new PDF's fragment provenance never carries over.
    setCrossPageFragments([])
    setSelectionFailedMessage(null)
    clearOcrState()
    ocrRequestGuardRef.current.next()
    analyzeRequestGuardRef.current.next()
    resetOcrCache()
    resetPaddleCache()
    resetHighResRenderCache()
  }

  // Bound to "OCRで読み直す" — the Paddle-primary flow. Never falls through to Tesseract on
  // its own; that only happens via handleUseBrowserOcr, triggered by the user clicking
  // "ブラウザOCRを使う" in the "unavailable" state (see docs/design-notes.md, Prototype 1.4B,
  // "explicit fallback, never automatic").
  const handleRequestPaddleOcr = async () => {
    const selection = selectionMetadata
    const viewer = pdfViewerRef.current
    if (!selection || !viewer) return

    const requestId = ocrRequestGuardRef.current.next()
    setPaddleStatus('checking')
    setPaddleCandidate(null)
    setPaddleUnavailableReason(null)
    // A fresh Paddle attempt supersedes any previously-shown explicit Tesseract fallback.
    setTesseractStatus('idle')
    setTesseractCandidate(null)
    setRuleACandidate(null)
    setRuleBCandidate(null)

    const availability = await checkPaddleAvailability()
    if (!ocrRequestGuardRef.current.isCurrent(requestId)) return

    if (!availability.available) {
      setPaddleStatus('unavailable')
      setPaddleUnavailableReason(availability.reason)
      return
    }

    setPaddleStatus('loading')
    let pageResult: Awaited<ReturnType<typeof recognizePageWithPaddle>>
    let pixelRects: ReturnType<typeof toPixelRect>[]
    try {
      const canvas = await viewer.renderPageForOcr(selection.pageNumber, OCR_RENDER_SCALE)
      pageResult = await recognizePageWithPaddle(
        { documentToken: String(documentToken), pageNumber: selection.pageNumber, scale: OCR_RENDER_SCALE },
        canvas,
      )
      pixelRects = selection.ocrRects.map((rect) => toPixelRect(rect, pageResult.imageWidth, pageResult.imageHeight))
      const extraction = extractPaddleCandidate(pageResult.lines, pixelRects, OCR_MATCH_TOLERANCE_PX)

      if (!ocrRequestGuardRef.current.isCurrent(requestId)) return // superseded by a newer selection/document

      if (extraction.failed || extraction.text === null) {
        setPaddleStatus('alignmentFailed')
        return
      }
      setPaddleCandidate(extraction.text)
      setPaddleStatus('success')
      // Rule A/B never apply to Paddle candidates — they were cross-validated specifically
      // against Tesseract's own failure patterns (see scientificNormalization.ts).
    } catch {
      if (!ocrRequestGuardRef.current.isCurrent(requestId)) return
      setPaddleStatus('error')
      return
    }

    // Prototype 1.5D: high-resolution selected-line second-pass, run right after the 2x
    // baseline succeeds, still gated only by this same button click. Its own independent
    // candidate — never merged into paddleCandidate (see paddleHighResService.ts). A
    // failure here is silent (no error UI): the baseline candidate above is already
    // shown and remains fully usable regardless of how this second pass turns out.
    setHighResStatus('loading')
    try {
      const result = await recognizeSelectedLinesHighRes({
        key: { documentToken: String(documentToken), pageNumber: selection.pageNumber, scale: PADDLE_HIGH_RES_SCALE },
        lines: pageResult.lines,
        baselineImageWidth: pageResult.imageWidth,
        baselineImageHeight: pageResult.imageHeight,
        selectionRectsPixel: pixelRects,
        tolerancePx: OCR_MATCH_TOLERANCE_PX,
        renderHighRes: () => viewer.renderPageForOcr(selection.pageNumber, PADDLE_HIGH_RES_SCALE),
      })

      if (!ocrRequestGuardRef.current.isCurrent(requestId)) return

      if (result.failed || result.text === null) {
        setHighResStatus('failed')
        return
      }
      setHighResCandidate(result.text)
      setHighResStatus('success')
    } catch {
      if (!ocrRequestGuardRef.current.isCurrent(requestId)) return
      setHighResStatus('failed')
    }
  }

  const handleRecheckPaddle = () => void handleRequestPaddleOcr()

  // Bound to "ブラウザOCRを使う", shown only while paddleStatus === 'unavailable'. This is
  // the full Tesseract + Rule A/B flow from Prototype 1.2, run only on explicit user action.
  const handleUseBrowserOcr = async () => {
    const selection = selectionMetadata
    const viewer = pdfViewerRef.current
    if (!selection || !viewer) return

    const requestId = ocrRequestGuardRef.current.next()
    setTesseractStatus('loading')
    setTesseractCandidate(null)
    setRuleACandidate(null)
    setRuleBCandidate(null)

    try {
      const canvas = await viewer.renderPageForOcr(selection.pageNumber, OCR_RENDER_SCALE)
      const words = await recognizePage(
        { documentToken: String(documentToken), pageNumber: selection.pageNumber, scale: OCR_RENDER_SCALE },
        canvas,
      )
      const pixelRects = selection.ocrRects.map((rect) => toPixelRect(rect, canvas.width, canvas.height))
      const matched = matchWordsToRects(pixelRects, words, OCR_MATCH_TOLERANCE_PX)

      if (!ocrRequestGuardRef.current.isCurrent(requestId)) return // superseded by a newer selection/document

      if (matched.length === 0) {
        setTesseractStatus('error')
        return
      }
      setTesseractCandidate(joinOcrWords(matched))
      setTesseractStatus('success')

      // Rule A/B are independent, best-effort extras layered on top of a successful OCR
      // pass — cross-validated against `words` (the full page, not just `matched`) since
      // each embedded scientific token has its own tight geometry, not the selection's
      // overall rect. Never generated on OCR failure (see docs/design-notes.md).
      const ruleA = applyRuleA(selection.normalizedText, selection.scientificTokens, words, OCR_MATCH_TOLERANCE_PX, canvas.width, canvas.height)
      setRuleACandidate(ruleA.text)

      const ruleB = applyRuleB(matched)
      setRuleBCandidate(ruleB.changed ? joinOcrWords(ruleB.words) : null)
    } catch {
      if (!ocrRequestGuardRef.current.isCurrent(requestId)) return
      setTesseractStatus('error')
    }
  }

  const handleAcceptPaddleCandidate = () => {
    if (paddleCandidate === null) return
    setSentence(paddleCandidate)
    setResult(null)
    setAnalyzeError(null)
  }

  const handleAcceptHighResCandidate = () => {
    if (highResCandidate === null) return
    setSentence(highResCandidate)
    setResult(null)
    setAnalyzeError(null)
  }

  const handleAcceptTesseractCandidate = () => {
    if (tesseractCandidate === null) return
    setSentence(tesseractCandidate)
    setResult(null)
    setAnalyzeError(null)
  }

  const handleAcceptRuleACandidate = () => {
    if (ruleACandidate === null) return
    setSentence(ruleACandidate)
    setResult(null)
    setAnalyzeError(null)
  }

  const handleAcceptRuleBCandidate = () => {
    if (ruleBCandidate === null) return
    setSentence(ruleBCandidate)
    setResult(null)
    setAnalyzeError(null)
  }

  const modelAdvisory = selectedModel ? getModelSizeAdvisory(selectedModel) : null

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Paper Grammar Tutor</h1>
        <p className="subtitle">PDF論文を読みながら、選択した英文の構造をその場で確認する</p>
        <div className="settings-row">
          <label htmlFor="base-url">Ollama URL</label>
          <input
            id="base-url"
            value={baseUrlInput}
            onChange={(e) => setBaseUrlInput(e.target.value)}
          />
          <button type="button" onClick={handleApplyBaseUrl}>
            適用
          </button>
          <ConnectionStatus
            status={health}
            checking={checkingHealth}
            baseUrl={activeBaseUrl}
            onRefresh={() => void refreshConnection()}
          />
        </div>
        <ModelSelector
          models={models}
          selectedModel={selectedModel}
          loading={modelsLoading}
          onSelect={setSelectedModel}
          onRefresh={() => void refreshModels()}
        />
        {modelAdvisory && <p className="model-advisory">{modelAdvisory}</p>}
      </header>

      <main className="app-main-pdf">
        <section className="pdf-pane">
          <PdfViewer
            ref={pdfViewerRef}
            onSelection={handlePdfSelection}
            onDocumentChange={handlePdfDocumentChange}
            onSelectionFailed={handlePdfSelectionFailed}
          />
          {selectionFailedMessage && (
            <p className="analysis-warning" role="alert">
              {selectionFailedMessage}
            </p>
          )}
        </section>

        <section className="side-pane">
          <div className="input-pane">
            {selectionPageNumber !== null && (
              <p className="pdf-source-note">
                PDFの p.{selectionPageNumber} から取得
                {crossPageFragments.length > 1 && `（${crossPageFragments.length}ページから選択）`}
              </p>
            )}
            <SentenceInputPanel
              sentence={sentence}
              onChange={setSentence}
              onAnalyze={() => void handleAnalyze()}
              onClear={handleClear}
              phase={analyzePhase}
              canAnalyze={Boolean(selectedModel) && sentence.trim().length > 0}
            />
            {crossPageFragments.length > 1 && (
              <p className="empty-note">複数ページの読み直しは次の対応で追加予定です。</p>
            )}
            <OcrFallbackPanel
              visible={selectionMetadata !== null && crossPageFragments.length <= 1}
              paddleStatus={paddleStatus}
              paddleCandidateText={paddleCandidate}
              paddleUnavailableReason={paddleUnavailableReason}
              onRequestPaddleOcr={() => void handleRequestPaddleOcr()}
              onRecheckPaddle={handleRecheckPaddle}
              onAcceptPaddleCandidate={handleAcceptPaddleCandidate}
              onUseBrowserOcr={() => void handleUseBrowserOcr()}
              highResStatus={highResStatus}
              highResCandidateText={highResCandidate}
              onAcceptHighResCandidate={handleAcceptHighResCandidate}
              tesseractStatus={tesseractStatus}
              tesseractCandidateText={tesseractCandidate}
              ruleACandidateText={ruleACandidate}
              ruleBCandidateText={ruleBCandidate}
              onAcceptTesseractCandidate={handleAcceptTesseractCandidate}
              onAcceptRuleACandidate={handleAcceptRuleACandidate}
              onAcceptRuleBCandidate={handleAcceptRuleBCandidate}
            />
            {analyzeError && (
              <p className="analysis-warning" role="alert">
                {analyzeError}
              </p>
            )}
          </div>

          <div className="result-pane">
            {result ? (
              <AnalysisResultPanel
                key={result.analysis.originalText}
                result={result}
                provider={provider}
                model={selectedModel}
              />
            ) : (
              <p className="empty-note">
                PDFで英文を選択するか、上のテキスト欄に直接入力して「解析」を押すと、ここに文の骨格や修飾関係などが表示されます。
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <p>
          AIによる文法解析であり、常に正しいとは限りません。既知の限界は
          <code>README.md</code> を参照してください。
        </p>
        <nav className="legal-links" aria-label="Legal and source links">
          <a href="https://github.com/rime-remotesensing/paper-grammar-tutor" target="_blank" rel="noreferrer">
            Source
          </a>
          <a
            href="https://github.com/rime-remotesensing/paper-grammar-tutor/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer"
          >
            License
          </a>
        </nav>
      </footer>
    </div>
  )
}
