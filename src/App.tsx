import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConnectionStatus } from './components/ConnectionStatus'
import { ModelSelector } from './components/ModelSelector'
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_TEMPERATURE } from './config/settings'
import { AnalysisResultPanel } from './features/grammar/components/AnalysisResultPanel'
import { SentenceInputPanel } from './features/grammar/components/SentenceInputPanel'
import { analyzeSentence, type AnalyzeSentenceResult } from './features/grammar/domain/GrammarAnalyzer'
import { getModelSizeAdvisory } from './features/grammar/domain/modelSizeAdvisory'
import { PdfViewer } from './features/pdf/components/PdfViewer'
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

  const handlePdfSelection = (selection: PdfSelectionResult) => {
    setSentence(selection.normalizedText)
    setSelectionPageNumber(selection.pageNumber)
    setResult(null)
    setAnalyzeError(null)
  }

  // A different PDF may describe different content entirely; carrying over a selection,
  // sentence, or analysis result from the previous document would be misleading.
  const handlePdfDocumentChange = () => {
    setSentence('')
    setSelectionPageNumber(null)
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
          <PdfViewer onSelection={handlePdfSelection} onDocumentChange={handlePdfDocumentChange} />
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
