import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import {
  PDF_DEFAULT_SCALE,
  PDF_MAX_SCALE,
  PDF_MIN_SCALE,
  PDF_SCALE_STEP,
  PDF_SCANNED_CHECK_SAMPLE_PAGES,
} from '../../../config/settings'
import { hasExtractableText } from '../domain/detectTextLayer'
import { buildSelectionResult, resetForNewDocument, type PdfSelectionResult } from '../domain/pdfViewerState'

// Vite resolves this to a hashed asset URL; pdf.js runs its parser/renderer in this
// worker rather than the main thread. Must be set once, before the first getDocument().
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface PdfViewerProps {
  onSelection: (selection: PdfSelectionResult) => void
  /** Fired once, synchronously, whenever the user picks a (new) PDF file — before it's read or parsed — so the host app can clear any selection/analysis state tied to the previous document. */
  onDocumentChange: () => void
}

export function PdfViewer({ onSelection, onDocumentChange }: PdfViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(PDF_DEFAULT_SCALE)
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const pageContainerRef = useRef<HTMLDivElement>(null)

  const handleFileChange = useCallback(async (file: File) => {
    onDocumentChange()
    setDoc(null)
    setNumPages(0)
    const initial = resetForNewDocument()
    setPageNumber(initial.pageNumber)
    setScale(initial.scale)
    setErrorMessage(null)
    setStatus('loading')

    try {
      const data = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data }).promise

      const sampleCount = Math.min(PDF_SCANNED_CHECK_SAMPLE_PAGES, pdf.numPages)
      const sampleLengths: number[] = []
      for (let i = 1; i <= sampleCount; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        const length = textContent.items.reduce(
          (sum, item) => sum + ('str' in item ? item.str.length : 0),
          0,
        )
        sampleLengths.push(length)
      }

      if (!hasExtractableText(sampleLengths)) {
        setStatus('error')
        setErrorMessage(
          'このPDFからテキストを取得できません。Prototype 1ではスキャンPDF/OCRには対応していません。',
        )
        return
      }

      setDoc(pdf)
      setNumPages(pdf.numPages)
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? `PDFを開けませんでした: ${err.message}` : 'PDFを開けませんでした。')
    }
  }, [onDocumentChange])

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    let renderTask: RenderTask | null = null

    async function renderPage() {
      const page = await doc!.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale })

      const canvas = canvasRef.current
      const textLayerDiv = textLayerRef.current
      const pageContainer = pageContainerRef.current
      if (!canvas || !textLayerDiv || !pageContainer) return

      const outputScale = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      pageContainer.style.width = `${viewport.width}px`
      pageContainer.style.height = `${viewport.height}px`
      pageContainer.style.setProperty('--scale-factor', String(scale))

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined

      renderTask = page.render({ canvas, canvasContext: ctx, viewport, transform })
      await renderTask.promise
      if (cancelled) return

      textLayerDiv.replaceChildren()
      const textContent = await page.getTextContent()
      if (cancelled) return
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      })
      await textLayer.render()
    }

    renderPage().catch((err: unknown) => {
      if (!cancelled) console.error('PDF page render failed', err)
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [doc, pageNumber, scale])

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    const text = selection.toString()
    if (text.trim().length === 0) return
    const anchorNode = selection.anchorNode
    if (!anchorNode || !textLayerRef.current?.contains(anchorNode)) return
    const result = buildSelectionResult(text, pageNumber)
    if (result) onSelection(result)
  }, [pageNumber, onSelection])

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0]
            // Reset the input so re-selecting the same file path still fires a change
            // event next time — browsers otherwise treat an unchanged FileList as a
            // no-op and never call onChange again for that path.
            e.target.value = ''
            if (file) void handleFileChange(file)
          }}
        />
        {status === 'ready' && (
          <>
            <button type="button" onClick={() => setPageNumber((p) => Math.max(1, p - 1))} disabled={pageNumber <= 1}>
              前へ
            </button>
            <span className="pdf-page-indicator">
              {pageNumber} / {numPages}
            </span>
            <button
              type="button"
              onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
              disabled={pageNumber >= numPages}
            >
              次へ
            </button>
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(PDF_MIN_SCALE, Number((s - PDF_SCALE_STEP).toFixed(2))))}
              disabled={scale <= PDF_MIN_SCALE}
            >
              縮小
            </button>
            <span className="pdf-page-indicator">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(PDF_MAX_SCALE, Number((s + PDF_SCALE_STEP).toFixed(2))))}
              disabled={scale >= PDF_MAX_SCALE}
            >
              拡大
            </button>
          </>
        )}
      </div>

      <div className="pdf-canvas-area">
        {status === 'idle' && <p className="empty-note">PDFファイルを選択してください。</p>}
        {status === 'loading' && <p className="empty-note">読み込み中…</p>}
        {status === 'error' && (
          <p className="analysis-warning" role="alert">
            {errorMessage}
          </p>
        )}
        {status === 'ready' && (
          <div className="pdf-page-container" ref={pageContainerRef} onMouseUp={handleMouseUp}>
            <canvas ref={canvasRef} />
            <div className="textLayer" ref={textLayerRef} />
          </div>
        )}
      </div>
    </div>
  )
}
