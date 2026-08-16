import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

/**
 * Prototype 2.4B — one page within the continuous-scroll viewer (item 9). Extracted from
 * what used to be PdfViewer's single hardcoded page-rendering block; the render effect
 * itself (canvas + TextLayer) is otherwise UNCHANGED from Prototype 1.1/2.4A — only the
 * lazy-mount timing and the wrapping container are new.
 *
 * Lazy rendering (item 13/68): starts as a lightweight placeholder (sized from
 * `estimatedHeight`/`estimatedWidth` so the surrounding scroll layout doesn't jump once the
 * real page renders) and only asks pdf.js to render once `IntersectionObserver` reports the
 * page is near the viewport (rootMargin preloads roughly ±1-2 pages ahead, item 14). Once a
 * page has rendered, it is NEVER unmounted or torn down again for the lifetime of the
 * document (item 12/13.D/15: text-layer DOM churn during an active selection risks breaking
 * the browser's own Selection object) — this file has no "release far pages" logic at all;
 * that is an explicitly-deferred future optimization (item 12 permits, does not require it).
 */
interface PdfPageViewProps {
  doc: PDFDocumentProxy
  pageNumber: number
  scale: number
  estimatedWidth: number
  estimatedHeight: number
  onMeasured: (pageNumber: number, width: number, height: number) => void
}

const PRELOAD_ROOT_MARGIN = '1500px 0px 1500px 0px'

export function PdfPageView({ doc, pageNumber, scale, estimatedWidth, estimatedHeight, onMeasured }: PdfPageViewProps) {
  const [shouldRender, setShouldRender] = useState(false)
  const [rendered, setRendered] = useState(false)
  // The wrapper's real size, once known -- kept in React state (not a manual DOM mutation)
  // so a later re-render (e.g. triggered by an unrelated prop change) can never stomp it
  // back to the placeholder estimate via JSX's own `style` reconciliation.
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || shouldRender) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShouldRender(true)
      },
      { rootMargin: PRELOAD_ROOT_MARGIN },
    )
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [shouldRender])

  useEffect(() => {
    if (!shouldRender) return
    let cancelled = false
    let renderTask: RenderTask | null = null

    async function renderPage() {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale })

      const canvas = canvasRef.current
      const textLayerDiv = textLayerRef.current
      const wrapper = wrapperRef.current
      if (!canvas || !textLayerDiv || !wrapper) return

      onMeasured(pageNumber, viewport.width, viewport.height)
      setMeasuredSize({ width: viewport.width, height: viewport.height })

      const outputScale = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      wrapper.style.setProperty('--scale-factor', String(scale))

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined

      renderTask = page.render({ canvas, canvasContext: ctx, viewport, transform })
      await renderTask.promise
      if (cancelled) return

      textLayerDiv.replaceChildren()
      const textContent = await page.getTextContent()
      if (cancelled) return
      const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport })
      await textLayer.render()
      if (cancelled) return
      setRendered(true)
    }

    renderPage().catch((err: unknown) => {
      if (!cancelled) console.error(`PDF page ${pageNumber} render failed`, err)
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
    // Deliberately re-runs on `scale` change even after first render (unlike the mount
    // gate above) -- zoom must re-render every already-rendered page, not just the one
    // currently in view (item 18). `onMeasured` must be a stable (useCallback'd) reference
    // from the caller, or this would re-render every page on every unrelated parent update.
  }, [shouldRender, doc, pageNumber, scale, onMeasured])

  const width = measuredSize?.width ?? estimatedWidth
  const height = measuredSize?.height ?? estimatedHeight

  return (
    <div ref={wrapperRef} className="pdf-page-container" data-page-number={pageNumber} style={{ width, height }}>
      {shouldRender ? (
        <>
          <canvas ref={canvasRef} />
          <div className="textLayer" ref={textLayerRef} data-rendered={rendered} />
        </>
      ) : (
        <div className="pdf-page-placeholder" aria-hidden="true" />
      )}
    </div>
  )
}
