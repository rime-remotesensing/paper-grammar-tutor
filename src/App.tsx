import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionStatus } from './components/ConnectionStatus'
import { ModelSelector } from './components/ModelSelector'
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_TEMPERATURE, OCR_MATCH_TOLERANCE_PX, OCR_RENDER_SCALE } from './config/settings'
import { AnalysisResultPanel } from './features/grammar/components/AnalysisResultPanel'
import { SentenceInputPanel } from './features/grammar/components/SentenceInputPanel'
import { analyzeSentence, type AnalyzeSentenceResult } from './features/grammar/domain/GrammarAnalyzer'
import { getModelSizeAdvisory } from './features/grammar/domain/modelSizeAdvisory'
import { OcrFallbackPanel, type OcrStatus, type PaddleStatus } from './features/ocr/components/OcrFallbackPanel'
import { matchWordsToRects, toPixelRect, joinOcrWords } from './features/ocr/domain/ocrGeometry'
import { extractPaddleCandidate } from './features/ocr/domain/paddleAdapter'
import { checkPaddleAvailability, recognizePageWithPaddle, resetPaddleCache } from './features/ocr/domain/paddleOcrService'
import { recognizePage, resetOcrCache } from './features/ocr/domain/ocrService'
import { createRequestGuard } from './features/ocr/domain/requestGuard'
import { applyRuleA, applyRuleB } from './features/ocr/domain/scientificNormalization'
import { PdfViewer, type PdfViewerHandle } from './features/pdf/components/PdfViewer'
import type { PdfSelectionResult } from './features/pdf/domain/pdfViewerState'
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
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalyzeSentenceResult | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  const pdfViewerRef = useRef<PdfViewerHandle>(null)
  // Bumped on every new PDF load; scopes the OCR page cache to "this document" (a
  // filename alone isn't a safe cache key — two different PDFs can share a name).
  const [documentToken, setDocumentToken] = useState(0)
  const [selectionMetadata, setSelectionMetadata] = useState<PdfSelectionResult | null>(null)

  // Paddle is the primary OCR engine (Prototype 1.4B). "unavailable"/"alignmentFailed" are
  // distinct terminal states, not folded into "error" — the UI needs to tell them apart
  // (unavailable offers the explicit Tesseract-fallback buttons; alignmentFailed doesn't).
  const [paddleStatus, setPaddleStatus] = useState<PaddleStatus>('idle')
  const [paddleCandidate, setPaddleCandidate] = useState<string | null>(null)
  const [paddleUnavailableReason, setPaddleUnavailableReason] = useState<string | null>(null)

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
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      const analyzeResult = await analyzeSentence({
        provider,
        model: selectedModel,
        sentence,
        temperature: DEFAULT_TEMPERATURE,
      })
      setResult(analyzeResult)
    } catch (err) {
      setResult(null)
      setAnalyzeError(
        err instanceof LLMProviderError
          ? err.message
          : '解析中に予期しないエラーが発生しました。Ollamaの接続状態を確認してください。',
      )
    } finally {
      setAnalyzing(false)
    }
  }

  const clearOcrState = () => {
    setPaddleStatus('idle')
    setPaddleCandidate(null)
    setPaddleUnavailableReason(null)
    setTesseractStatus('idle')
    setTesseractCandidate(null)
    setRuleACandidate(null)
    setRuleBCandidate(null)
  }

  const handlePdfSelection = (selection: PdfSelectionResult) => {
    setSentence(selection.normalizedText)
    setSelectionPageNumber(selection.pageNumber)
    setResult(null)
    setAnalyzeError(null)
    setSelectionMetadata(selection)
    clearOcrState()
    ocrRequestGuardRef.current.next()
  }

  // A different PDF may describe different content entirely; carrying over a selection,
  // sentence, or analysis result from the previous document would be misleading.
  const handlePdfDocumentChange = () => {
    setSentence('')
    setSelectionPageNumber(null)
    setResult(null)
    setAnalyzeError(null)
    setDocumentToken((t) => t + 1)
    setSelectionMetadata(null)
    clearOcrState()
    ocrRequestGuardRef.current.next()
    resetOcrCache()
    resetPaddleCache()
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
    try {
      const canvas = await viewer.renderPageForOcr(selection.pageNumber, OCR_RENDER_SCALE)
      const pageResult = await recognizePageWithPaddle(
        { documentToken: String(documentToken), pageNumber: selection.pageNumber, scale: OCR_RENDER_SCALE },
        canvas,
      )
      const pixelRects = selection.ocrRects.map((rect) => toPixelRect(rect, pageResult.imageWidth, pageResult.imageHeight))
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
          <PdfViewer ref={pdfViewerRef} onSelection={handlePdfSelection} onDocumentChange={handlePdfDocumentChange} />
        </section>

        <section className="side-pane">
          <div className="input-pane">
            {selectionPageNumber !== null && (
              <p className="pdf-source-note">PDFの p.{selectionPageNumber} から取得</p>
            )}
            <SentenceInputPanel
              sentence={sentence}
              onChange={setSentence}
              onAnalyze={() => void handleAnalyze()}
              analyzing={analyzing}
              canAnalyze={Boolean(selectedModel) && sentence.trim().length > 0}
            />
            <OcrFallbackPanel
              visible={selectionMetadata !== null}
              paddleStatus={paddleStatus}
              paddleCandidateText={paddleCandidate}
              paddleUnavailableReason={paddleUnavailableReason}
              onRequestPaddleOcr={() => void handleRequestPaddleOcr()}
              onRecheckPaddle={handleRecheckPaddle}
              onAcceptPaddleCandidate={handleAcceptPaddleCandidate}
              onUseBrowserOcr={() => void handleUseBrowserOcr()}
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
              <AnalysisResultPanel key={result.analysis.originalText} result={result} />
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
      </footer>
    </div>
  )
}
