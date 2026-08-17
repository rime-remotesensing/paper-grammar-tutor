import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  PDF_DEFAULT_SCALE,
  PDF_MAX_SCALE,
  PDF_MIN_SCALE,
  PDF_SCALE_STEP,
  PDF_SCANNED_CHECK_SAMPLE_PAGES,
  PDF_WASM_URL,
} from '../../../config/settings'
import { hasExtractableText } from '../domain/detectTextLayer'
import {
  computeNormalizedSelectionRects,
  findDigitMiddotMatches,
  isReadingOrderBefore,
  resetForNewDocument,
  sliceBetweenCaretOffsets,
  type EmbeddedScientificToken,
  type PdfSelectionResult,
  type PointerPoint,
} from '../domain/pdfViewerState'
import { normalizePdfSelectionText } from '../utils/pdfTextNormalize'
import { extractPageLines, classifyPageLines, type PageLine, type RawTextItem } from '../domain/pageTextClassifier'
import { buildFilteredFragmentText, buildNuisancePredicate, combineFragments, type SelectionFragment } from '../domain/crossPageSelection'
import {
  closeLayoutDocument,
  registerDocumentWithLayoutService,
  resolveSelectionWithLayoutService,
  SelectionResolutionError,
  type SelectionEndpointInput,
} from '../domain/pymupdfLayoutService'
import { createRequestGuard } from '../../ocr/domain/requestGuard'
import { PdfPageView } from './PdfPageView'

/**
 * Prototype 2.4B-R2 item 3-4 (kept through R5B item 29): dev-only (never present in a
 * production build -- `import.meta.env.DEV` is compiled away by Vite) diagnostic trace for
 * the selection-reconstruction pipeline. Exists because R1's fix passed every
 * Node/pdfjs-dist simulation this app has no browser to fully replicate, but FAILED
 * live-browser acceptance -- meaning something about the real browser pipeline diverges
 * from simulation in ways static analysis alone couldn't pin down. Never changes
 * reconstruction behavior; only reports what the existing code actually decided and why.
 */
const TRACE_ENABLED = import.meta.env.DEV

// Prototype 2.5B item 14: user-facing message when the layout service is unreachable or
// erroring generically -- unchanged wording from R8, never names PyMuPDF/the service.
const SERVICE_UNAVAILABLE_MESSAGE = '文の読み取りを確認できませんでした。レイアウトサービスが起動していることを確認してください。'
// Prototype 2.5B item 14/25: distinct message for a selection that resolved to (or crosses)
// content the layout service can't reliably extract -- an equation-number endpoint with no
// recoverable prose, or a suspicious unextractable-glyph gap inside the selected text.
// Deliberately never mentions "equation"/"glyph"/PyMuPDF -- item 14's own example wording.
const UNREADABLE_SYMBOL_MESSAGE = '選択範囲に正確に読み取れない記号が含まれています。'

// Vite resolves this to a hashed asset URL; pdf.js runs its parser/renderer in this
// worker rather than the main thread. Must be set once, before the first getDocument().
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

function isTextNodeInsideAnyTextLayer(node: Node | null): node is Text {
  if (node === null || node.nodeType !== Node.TEXT_NODE) return false
  const el = node.parentElement
  return el !== null && el.closest('.textLayer') !== null
}

/** Walks up from `node` to the nearest `[data-page-number]` ancestor (each PdfPageView's own
 * wrapper) and returns its page number, or null if `node` isn't inside any rendered page. */
function pageNumberOfNode(node: Node): number | null {
  const el = node instanceof Element ? node : node.parentElement
  const container = el?.closest('[data-page-number]')
  const attr = container?.getAttribute('data-page-number')
  return attr ? Number(attr) : null
}

function pageContainerOf(pageNumber: number, root: HTMLElement): HTMLElement | null {
  return root.querySelector(`[data-page-number="${pageNumber}"]`)
}

function textLayerOf(pageContainer: Element): HTMLElement | null {
  return pageContainer.querySelector('.textLayer')
}

/**
 * Prototype 2.4A's `extractScientificTokens`, generalized to take an explicit `range`
 * parameter (unchanged logic otherwise) so it can be scoped to a single page's sub-range of
 * a cross-page/cross-column selection, not just "the one and only page's whole selection".
 */
function extractScientificTokens(range: Range, layer: HTMLElement, canvasRect: DOMRect): EmbeddedScientificToken[] {
  const tokens: EmbeddedScientificToken[] = []
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (range.intersectsNode(node)) {
      const text = node.textContent ?? ''
      const localStart = node === range.startContainer ? range.startOffset : 0
      const localEnd = node === range.endContainer ? range.endOffset : text.length
      const selectedSlice = sliceBetweenCaretOffsets(text, localStart, localEnd)
      for (const m of findDigitMiddotMatches(selectedSlice)) {
        const subRange = document.createRange()
        subRange.setStart(node, localStart + m.start)
        subRange.setEnd(node, localStart + m.end)
        const rects = computeNormalizedSelectionRects(Array.from(subRange.getClientRects()), canvasRect)
        if (rects.length > 0) tokens.push({ text: m.text, rects })
      }
    }
    node = walker.nextNode()
  }
  return tokens
}

function resolveCaretAtExactPoint(point: PointerPoint, layer: HTMLElement | null): { node: Text; offset: number } | null {
  let node: Node | null = null
  let offset = 0
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(point.x, point.y)
    if (pos) {
      node = pos.offsetNode
      offset = pos.offset
    }
  } else if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(point.x, point.y)
    if (range) {
      node = range.startContainer
      offset = range.startOffset
    }
  }
  if (!isTextNodeInsideAnyTextLayer(node) || (layer && !layer.contains(node))) return null
  return { node, offset }
}

/**
 * Resolves the precise text-node caret at a viewport point (Prototype 1.1) — used to
 * rebuild a selection from scratch when the native Selection object has landed outside any
 * text node. Unchanged from Prototype 2.4A except `layer` narrows the search to one
 * specific page's text layer (determined by the caller from the point's own page first),
 * rather than assuming a single always-mounted layer.
 */
function resolveCaretInLayer(point: PointerPoint, layer: HTMLElement | null): { node: Text; offset: number } | null {
  const direct = resolveCaretAtExactPoint(point, layer)
  if (direct) return direct
  const maxNudgePx = 40
  const stepPx = 4
  for (let r = stepPx; r <= maxNudgePx; r += stepPx) {
    const candidates: PointerPoint[] = [
      { x: point.x - r, y: point.y },
      { x: point.x + r, y: point.y },
      { x: point.x, y: point.y - r },
      { x: point.x, y: point.y + r },
    ]
    for (const candidate of candidates) {
      const resolved = resolveCaretAtExactPoint(candidate, layer)
      if (resolved) return resolved
    }
  }
  return null
}

/** Prototype 2.4B-R1 item 12/13 (extended R8 item 12/13): converts a selection boundary
 * (text node + offset) to its normalized (0-1) page-local point, in the same convention
 * `services/pymupdf_layout` uses for its own bbox normalization (top-down Y, left-origin X)
 * -- verified numerically identical in Prototype 2.4B-R7. A zero-width Range's
 * `getClientRects()` gives a caret-height rect at the exact boundary in every browser this
 * app targets; the parent element's own rect is used as a fallback only if that ever comes
 * back empty. */
function normalizedPointOfBoundary(node: Node, offset: number, canvasRect: DOMRect): { x: number; y: number } {
  const pointRange = document.createRange()
  pointRange.setStart(node, offset)
  pointRange.setEnd(node, offset)
  let rect: DOMRect | undefined = pointRange.getClientRects()[0]
  if (!rect) {
    const el = node instanceof Element ? node : node.parentElement
    rect = el?.getBoundingClientRect()
  }
  if (!rect || canvasRect.height === 0 || canvasRect.width === 0) return { x: 0, y: 0 }
  const centerY = (rect.top + rect.bottom) / 2
  return {
    x: (rect.left - canvasRect.left) / canvasRect.width,
    y: (centerY - canvasRect.top) / canvasRect.height,
  }
}

/**
 * Prototype 2.4B-R1 item 22: "最初と最後のline/spanだけはnative selection offsetを使用" — the
 * ONLY place this file still trusts native DOM Range membership is for extracting the exact
 * partial text of the single line the user's click point landed on. pdf.js's TextLayer
 * inserts a real `<br>` element at every `hasEOL` boundary (confirmed against the actual
 * pdfjs-dist build), so "the rest of this one line" can be found by walking the text layer's
 * flat node sequence from the click point until the nearest `<br>` in the requested
 * direction — a small, local DOM operation, not a page-wide sweep. Every other included
 * line in a multi-page/multi-column selection comes from the geometric line model's own
 * text instead (never from this function or from DOM traversal).
 */
function extractWithinLine(layer: HTMLElement, node: Text, offset: number, direction: 'forward' | 'backward'): string {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT
      if (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'BR') return NodeFilter.FILTER_ACCEPT
      return NodeFilter.FILTER_SKIP
    },
  })
  const flatNodes: Node[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) flatNodes.push(n)
  const nodeIndex = flatNodes.indexOf(node)
  if (nodeIndex === -1) return node.textContent ?? ''

  if (direction === 'forward') {
    const nodeText = node.textContent ?? ''
    let text = sliceBetweenCaretOffsets(nodeText, offset, nodeText.length)
    for (let i = nodeIndex + 1; i < flatNodes.length; i++) {
      const cur = flatNodes[i]
      if (cur.nodeType === Node.ELEMENT_NODE) break
      text += cur.textContent ?? ''
    }
    return text
  }
  const prefixParts: string[] = []
  for (let i = nodeIndex - 1; i >= 0; i--) {
    const cur = flatNodes[i]
    if (cur.nodeType === Node.ELEMENT_NODE) break
    prefixParts.unshift(cur.textContent ?? '')
  }
  return prefixParts.join('') + sliceBetweenCaretOffsets(node.textContent ?? '', 0, offset)
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface PdfViewerProps {
  /** Prototype 2.4B: always one fragment per touched page (length 1 for an ordinary
   * same-page — including cross-column, item 24-26 — selection; length > 1 only when the
   * drag genuinely crosses a page boundary). The host app combines them (crossPageSelection.ts,
   * unchanged from 2.4A) — this file never joins text itself. */
  onSelection: (fragments: SelectionFragment[]) => void
  /** Fired once, synchronously, whenever the user picks a (new) PDF file — before it's read or parsed — so the host app can clear any selection/analysis state tied to the previous document. */
  onDocumentChange: () => void
  /** Prototype 2.4B-R8 item 37: fired when a cross-block/cross-page selection could not be
   * resolved (the local PyMuPDF layout service is unreachable, or returned an error) --
   * never a silent fallback to the retired custom heuristic (item 6/38). Same-block
   * selections are unaffected and never trigger this, since they don't depend on the
   * service at all. */
  onSelectionFailed?: (message: string) => void
  /** Fired whenever the page nearest the viewport center changes (IntersectionObserver-driven, item 16), for the page indicator. */
  /** Optional: most consumers don't need this now that the page indicator is
   * self-contained in this component's own toolbar (item 16/17). */
  onPageChange?: (pageNumber: number, numPages: number) => void
}

export interface PdfViewerHandle {
  /** Renders `pageNumber` to a detached canvas at `scale`, independent of the viewer's
   * current on-screen zoom. Throws if no document is loaded or the page fails to render;
   * callers are expected to catch (see the OCR fallback's error handling). */
  renderPageForOcr(pageNumber: number, scale: number): Promise<HTMLCanvasElement>
  /** Synchronous, authoritative current-page (viewport-center) / total pages. */
  getPageInfo(): { pageNumber: number; numPages: number }
  /** Returns `pageNumber`'s text lines (cached per page for the lifetime of the current
   * document — item 21/55/66: never scans the whole document eagerly, only the specific
   * pages the marginal-text classifier actually asks for). */
  getPageLines(pageNumber: number): Promise<PageLine[]>
}

const NEIGHBOR_RANGE = 3

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  { onSelection, onDocumentChange, onSelectionFailed, onPageChange },
  ref,
) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(PDF_DEFAULT_SCALE)
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [currentPageNumber, setCurrentPageNumber] = useState(1)
  // First page's own measured size, reused as every other page's placeholder estimate
  // (item 9's continuous layout needs SOME height before a page has been lazily rendered;
  // academic PDFs are overwhelmingly one uniform page size, so this avoids fetching every
  // page's real geometry up front just for placeholder sizing -- item 68).
  const [estimatedPageSize, setEstimatedPageSize] = useState({ width: 600, height: 800 })

  const pageLinesCacheRef = useRef<Map<number, Promise<PageLine[]>>>(new Map())
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const dragStartPointRef = useRef<PointerPoint | null>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  useEffect(() => {
    docRef.current = doc
  }, [doc])

  // Prototype 2.4B-R8: the PyMuPDF layout service's own document identity for the
  // currently-loaded PDF (item 14/16) -- a Promise, not a plain value, so `handleMouseUp`
  // can safely await it even if a selection happens before registration has resolved.
  // `null` (after resolving) means registration failed; every cross-block selection on
  // this document will explicitly fail (item 6/38: never a silent fallback) until a new
  // document is opened. Cleared and re-registered on every file change (item 55); the
  // previous document is explicitly closed server-side, never left registered forever.
  const documentIdPromiseRef = useRef<Promise<{ documentId: string; numPages: number } | null> | null>(null)
  const currentDocumentIdRef = useRef<string | null>(null)
  const layoutRequestGuardRef = useRef(createRequestGuard())

  useEffect(() => {
    // Item 55: release the layout service's document handle on unmount, same as an
    // explicit file change.
    return () => {
      const id = currentDocumentIdRef.current
      if (id) void closeLayoutDocument(id)
    }
  }, [])

  const getPageLinesImpl = useCallback((targetPageNumber: number): Promise<PageLine[]> => {
    const cached = pageLinesCacheRef.current.get(targetPageNumber)
    if (cached) return cached
    const currentDoc = docRef.current
    if (!currentDoc) return Promise.resolve([])
    const promise = (async () => {
      const page = await currentDoc.getPage(targetPageNumber)
      const textContent = await page.getTextContent()
      const [x0, y0, x1, y1] = page.view
      const pageHeight = y1 - y0
      const pageWidth = x1 - x0
      // pdf.js's TextItem has far more fields than RawTextItem needs; the runtime check
      // narrows out TextMarkedContent (which never has `str`), and the remainder is an
      // accurate, deliberate cast -- every field RawTextItem reads genuinely exists on the
      // real TextItem objects that survive this filter (see PdfViewer's prior version).
      const items = textContent.items.filter((it) => 'str' in it).map((it) => it as unknown as RawTextItem)
      return extractPageLines(items, pageHeight, pageWidth)
    })()
    pageLinesCacheRef.current.set(targetPageNumber, promise)
    return promise
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      async renderPageForOcr(pageNumber, ocrScale) {
        const currentDoc = docRef.current
        if (!currentDoc) throw new Error('PDFが読み込まれていません。')
        const page = await currentDoc.getPage(pageNumber)
        const viewport = page.getViewport({ scale: ocrScale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('canvasを初期化できませんでした。')
        await page.render({ canvas, canvasContext: ctx, viewport }).promise
        return canvas
      },
      getPageInfo() {
        return { pageNumber: currentPageNumber, numPages }
      },
      getPageLines: getPageLinesImpl,
    }),
    [currentPageNumber, numPages, getPageLinesImpl],
  )

  const handleFileChange = useCallback(
    async (file: File) => {
      onDocumentChange()
      setDoc(null)
      setNumPages(0)
      const initial = resetForNewDocument()
      setScale(initial.scale)
      setCurrentPageNumber(1)
      setErrorMessage(null)
      setStatus('loading')
      pageLinesCacheRef.current = new Map()

      // Item 55: release the previous document's layout-service handle before registering
      // the new one -- never left registered indefinitely across a file change.
      const previousDocumentId = currentDocumentIdRef.current
      currentDocumentIdRef.current = null
      if (previousDocumentId) void closeLayoutDocument(previousDocumentId)

      try {
        const data = await file.arrayBuffer()

        // Item 14/16: register the SAME bytes with the local PyMuPDF layout service,
        // in parallel with pdf.js's own load below -- File.arrayBuffer() re-reads the
        // source Blob on each call rather than consuming/transferring it, so this is safe
        // to call a second time independently of the `data` passed to pdf.js. Selections
        // made before this resolves simply await it (see handleMouseUp); the PDF becomes
        // visible/selectable well before registration typically finishes.
        documentIdPromiseRef.current = (async () => {
          const registerBytes = await file.arrayBuffer()
          const result = await registerDocumentWithLayoutService(registerBytes)
          currentDocumentIdRef.current = result?.documentId ?? null
          return result
        })()

        const pdf = await pdfjsLib.getDocument({ data, wasmUrl: PDF_WASM_URL }).promise

        const sampleCount = Math.min(PDF_SCANNED_CHECK_SAMPLE_PAGES, pdf.numPages)
        const sampleLengths: number[] = []
        for (let i = 1; i <= sampleCount; i++) {
          const page = await pdf.getPage(i)
          const textContent = await page.getTextContent()
          const length = textContent.items.reduce((sum, item) => sum + ('str' in item ? item.str.length : 0), 0)
          sampleLengths.push(length)
        }

        if (!hasExtractableText(sampleLengths)) {
          setStatus('error')
          setErrorMessage('このPDFからテキストを取得できません。Prototype 1ではスキャンPDF/OCRには対応していません。')
          return
        }

        const firstPage = await pdf.getPage(1)
        const firstViewport = firstPage.getViewport({ scale: initial.scale })
        setEstimatedPageSize({ width: firstViewport.width, height: firstViewport.height })

        setDoc(pdf)
        setNumPages(pdf.numPages)
        setStatus('ready')
      } catch (err) {
        setStatus('error')
        setErrorMessage(err instanceof Error ? `PDFを開けませんでした: ${err.message}` : 'PDFを開けませんでした。')
      }
    },
    [onDocumentChange],
  )

  // Prototype 2.4B item 16: tracks whichever rendered page is nearest the viewport center
  // as "current", for the page indicator -- driven by the same scroll container every page
  // is mounted in, independent of which pages have actually rendered yet.
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || status !== 'ready') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        // Nearest to vertical center of the viewport wins.
        const containerRect = container.getBoundingClientRect()
        const centerY = containerRect.top + containerRect.height / 2
        let best: { pageNumber: number; distance: number } | null = null
        for (const entry of visible) {
          const attr = entry.target.getAttribute('data-page-number')
          if (!attr) continue
          const rect = entry.boundingClientRect
          const distance = Math.abs((rect.top + rect.bottom) / 2 - centerY)
          if (best === null || distance < best.distance) best = { pageNumber: Number(attr), distance }
        }
        if (best) setCurrentPageNumber(best.pageNumber)
      },
      { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    for (const el of container.querySelectorAll('[data-page-number]')) observer.observe(el)
    return () => observer.disconnect()
  }, [status, numPages])

  useEffect(() => {
    if (doc) onPageChange?.(currentPageNumber, numPages)
  }, [doc, currentPageNumber, numPages, onPageChange])

  const scrollToPage = useCallback((pageNumber: number) => {
    const container = scrollContainerRef.current
    if (!container) return
    const target = pageContainerOf(pageNumber, container)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const handleMeasured = useCallback((_pageNumber: number, _width: number, _height: number) => {
    // Reserved for a future per-page geometry cache; PdfPageView already keeps its own
    // measured size for its own placeholder, so there is nothing else to do here today.
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragStartPointRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return
      const scrollContainer = scrollContainerRef.current
      if (!scrollContainer) return

      const selectionLooksValid =
        isTextNodeInsideAnyTextLayer(selection.anchorNode) && isTextNodeInsideAnyTextLayer(selection.focusNode)

      let range: Range
      const pointerStart = dragStartPointRef.current
      const pointerEnd: PointerPoint = { x: e.clientX, y: e.clientY }
      const pointerStartPageEl = pointerStart
        ? document.elementFromPoint(pointerStart.x, pointerStart.y)?.closest('[data-page-number]') ?? null
        : null
      const pointerEndPageEl = document.elementFromPoint(pointerEnd.x, pointerEnd.y)?.closest('[data-page-number]') ?? null
      const exactStartCaret = pointerStart
        ? resolveCaretAtExactPoint(pointerStart, pointerStartPageEl ? textLayerOf(pointerStartPageEl) : null)
        : null
      const exactEndCaret = resolveCaretAtExactPoint(pointerEnd, pointerEndPageEl ? textLayerOf(pointerEndPageEl) : null)

      // Browser drag selection can snap the native focus one glyph beyond the pointer
      // (the real Springer case visually ended after "2022)." but Range.endOffset included
      // the next sentence's "I"). Prefer exact pointer carets when both exist. DOM Range
      // end offsets are half-open, so the caret after the period excludes that next glyph.
      if (pointerStart && exactStartCaret && exactEndCaret) {
        const startCaretPage = pageNumberOfNode(exactStartCaret.node)
        const endCaretPage = pageNumberOfNode(exactEndCaret.node)
        const startIsFirst =
          startCaretPage !== null && endCaretPage !== null && startCaretPage !== endCaretPage
            ? startCaretPage < endCaretPage
            : isReadingOrderBefore(pointerStart, pointerEnd)
        const [from, to] = startIsFirst ? [exactStartCaret, exactEndCaret] : [exactEndCaret, exactStartCaret]
        const precise = document.createRange()
        precise.setStart(from.node, from.offset)
        precise.setEnd(to.node, to.offset)
        if (precise.collapsed) return
        selection.removeAllRanges()
        selection.addRange(precise)
        range = precise
      } else if (selectionLooksValid) {
        range = selection.getRangeAt(0)
      } else {
        // Prototype 1.1/2.4A: pdf.js's absolutely-positioned line spans can make native
        // hit-testing land outside any text node when a drag passes through the gap
        // between two lines. Rebuild the range from the actual pointer positions instead.
        const start = pointerStart
        if (!start) return
        const end = pointerEnd
        const startPageEl = document.elementFromPoint(start.x, start.y)?.closest('[data-page-number]') ?? null
        const endPageEl = document.elementFromPoint(end.x, end.y)?.closest('[data-page-number]') ?? null
        const startCaret = resolveCaretInLayer(start, startPageEl ? textLayerOf(startPageEl) : null)
        const endCaret = resolveCaretInLayer(end, endPageEl ? textLayerOf(endPageEl) : null)
        if (!startCaret || !endCaret) return

        const startCaretPage = pageNumberOfNode(startCaret.node)
        const endCaretPage = pageNumberOfNode(endCaret.node)
        // Cross-page ordering uses page number (scroll-position independent); same-page
        // ordering falls back to the original viewport-Y comparison (item 22/74).
        const startIsFirst =
          startCaretPage !== null && endCaretPage !== null && startCaretPage !== endCaretPage
            ? startCaretPage < endCaretPage
            : isReadingOrderBefore(start, end)
        const [from, to] = startIsFirst ? [startCaret, endCaret] : [endCaret, startCaret]
        const rebuilt = document.createRange()
        rebuilt.setStart(from.node, from.offset)
        rebuilt.setEnd(to.node, to.offset)
        if (rebuilt.collapsed) return
        selection.removeAllRanges()
        selection.addRange(rebuilt)
        range = rebuilt
      }

      const startPage = pageNumberOfNode(range.startContainer)
      const endPage = pageNumberOfNode(range.endContainer)
      if (startPage === null || endPage === null) return

      if (TRACE_ENABLED) {
        console.groupCollapsed('[PGT-TRACE] mouseup')
        console.log('A. start page:', startPage)
        console.log('B. end page:', endPage)
        console.log('C. start DOM node text:', JSON.stringify(range.startContainer.textContent), 'offset', range.startOffset)
        console.log('D. end DOM node text:', JSON.stringify(range.endContainer.textContent), 'offset', range.endOffset)
        console.groupEnd()
      }

      async function buildNuisancePredicateFor(pageNumber: number) {
        const distances: number[] = []
        for (let d = 1; d <= NEIGHBOR_RANGE; d++) {
          if (pageNumber - d >= 1) distances.push(-d)
          if (pageNumber + d <= numPages) distances.push(d)
        }
        const currentLines = await getPageLinesImpl(pageNumber)
        const neighbors = await Promise.all(
          distances.map(async (pageDistance) => ({ pageDistance, lines: await getPageLinesImpl(pageNumber + pageDistance) })),
        )
        const classified = classifyPageLines(currentLines, neighbors)
        return buildNuisancePredicate(classified)
      }

      // Captured synchronously (a standing concern since 2.4A: the live window Selection can
      // change before async work below finishes) so these plain DOM references stay valid
      // regardless of how long block/nuisance resolution takes.
      const startContainer = range.startContainer
      const startOffset = range.startOffset
      const endContainer = range.endContainer
      const endOffset = range.endOffset
      if (startContainer.nodeType !== Node.TEXT_NODE || endContainer.nodeType !== Node.TEXT_NODE) return

      const startPageContainer = pageContainerOf(startPage, scrollContainer)
      const endPageContainer = pageContainerOf(endPage, scrollContainer)
      const startLayer = startPageContainer ? textLayerOf(startPageContainer) : null
      const endLayer = endPageContainer ? textLayerOf(endPageContainer) : null
      const startCanvas = startPageContainer?.querySelector('canvas') ?? null
      const endCanvas = endPageContainer?.querySelector('canvas') ?? null
      if (!startPageContainer || !endPageContainer || !startLayer || !endLayer || !startCanvas || !endCanvas) return
      const startCanvasRect = startCanvas.getBoundingClientRect()
      const endCanvasRect = endCanvas.getBoundingClientRect()

      // Prototype 2.4B-R5B item 3/19/35: native-path artifacts, computed synchronously so
      // they're ready immediately if routing (below) lands on "same page, same text block" --
      // the untouched Prototype 1.1 native Range selection, exactly as it has always worked.
      const nativeText = range.toString()
      const nativeOcrRects = computeNormalizedSelectionRects(Array.from(range.getClientRects()), startCanvasRect)
      const nativeScientificTokens = extractScientificTokens(range, startLayer, startCanvasRect)

      const runNativePath = () => {
        if (nativeText.trim().length === 0) return
        if (TRACE_ENABLED) console.log('[PGT-TRACE] mode = SINGLE_PAGE_NATIVE_RANGE', { page: startPage })
        void (async () => {
          const isNuisance = await buildNuisancePredicateFor(startPage)
          const normalizedText = normalizePdfSelectionText(nativeText)
          const filteredText = buildFilteredFragmentText(nativeText, isNuisance)
          if (TRACE_ENABLED) console.log('[PGT-TRACE] SINGLE_PAGE final filtered text:', JSON.stringify(filteredText))
          const selectionResult: PdfSelectionResult = {
            rawText: nativeText,
            normalizedText,
            pageNumber: startPage,
            ocrRects: nativeOcrRects,
            scientificTokens: nativeScientificTokens,
          }
          onSelection([{ pageNumber: startPage, selection: selectionResult, filteredText }])
        })()
      }

      // Prototype 2.4B-R8 item 4/29: unified routing via the local PyMuPDF layout service --
      // "same page" alone is no longer sufficient to trust native Range/DOM order (R4's
      // confirmed live failure: a same-page LEFT_COLUMN->RIGHT_COLUMN drag can have
      // footnote/front-matter content sitting in DOM order between the two columns; R7/R8
      // confirmed PyMuPDF's own native blocks solve this with no custom geometry needed).
      // Every selection is sent to the service for block resolution; `sameBlock: true` means
      // "use the native Range text you already have" (below), `sameBlock: false` means "use
      // the service's own reconstructed text." No coordinate-only fast path (item 28): the
      // R4 same-page-cross-column failure is exactly why "same page -> native" can't be
      // assumed safe without checking block identity first.
      const startPoint = normalizedPointOfBoundary(startContainer, startOffset, startCanvasRect)
      const endPoint = normalizedPointOfBoundary(endContainer, endOffset, endCanvasRect)
      const startBoundaryText = extractWithinLine(startLayer, startContainer as Text, startOffset, 'forward')
      const endBoundaryText = extractWithinLine(endLayer, endContainer as Text, endOffset, 'backward')

      if (TRACE_ENABLED) {
        console.log('[PGT-TRACE] PDF.js selected text:', JSON.stringify(nativeText))
        console.log('[PGT-TRACE] layout endpoints:', {
          start: { pageNumber: startPage, xNorm: startPoint.x, yNorm: startPoint.y, boundaryText: startBoundaryText, offset: startOffset },
          end: { pageNumber: endPage, xNorm: endPoint.x, yNorm: endPoint.y, boundaryText: endBoundaryText, offset: endOffset },
        })
      }

      void (async () => {
        const requestId = layoutRequestGuardRef.current.next()
        const docInfo = await documentIdPromiseRef.current
        if (!layoutRequestGuardRef.current.isCurrent(requestId)) return // superseded while awaiting registration

        if (!docInfo) {
          if (TRACE_ENABLED) console.log('[PGT-TRACE] mode = SERVICE_UNAVAILABLE (no registered document)')
          onSelectionFailed?.(SERVICE_UNAVAILABLE_MESSAGE)
          return
        }

        const startEndpoint: SelectionEndpointInput = { pageNumber: startPage, xNorm: startPoint.x, yNorm: startPoint.y, boundaryText: startBoundaryText, direction: 'forward' }
        const endEndpoint: SelectionEndpointInput = { pageNumber: endPage, xNorm: endPoint.x, yNorm: endPoint.y, boundaryText: endBoundaryText, direction: 'backward' }

        let response
        try {
          response = await resolveSelectionWithLayoutService(docInfo.documentId, startEndpoint, endEndpoint)
        } catch (err) {
          if (!layoutRequestGuardRef.current.isCurrent(requestId)) return
          // Prototype 2.5B/E: a recognized service error code means the service is telling
          // us THIS specific selection is unresolvable -- either "equation_endpoint_unresolved"
          // (an equation-number endpoint with no recoverable prose) or "missing_glyph_unresolved"
          // (a visually-present glyph the local OCR recovery couldn't confidently resolve) --
          // distinct from the service being unreachable/erroring generically.
          const isKnownUnresolvableSelection = err instanceof SelectionResolutionError && err.code !== null
          if (TRACE_ENABLED) console.log('[PGT-TRACE] mode = SERVICE_UNAVAILABLE (request failed)', { isKnownUnresolvableSelection, err })
          onSelectionFailed?.(isKnownUnresolvableSelection ? UNREADABLE_SYMBOL_MESSAGE : SERVICE_UNAVAILABLE_MESSAGE)
          return
        }
        if (!layoutRequestGuardRef.current.isCurrent(requestId)) return // superseded while awaiting resolution

        // Prototype 2.5E item 38: sameBlock alone is no longer sufficient to trust native
        // Range text -- a same-block selection that needed missing-glyph recovery now
        // carries its OWN repaired reconstructedText/fragments (fragments.length > 0) even
        // though sameBlock is still structurally true. Only the genuinely unaffected common
        // case (no recovery involved at all) has an empty fragments array here.
        if (response.sameBlock && response.fragments.length === 0) {
          if (TRACE_ENABLED) console.log('[PGT-TRACE] mode = SERVICE_SAME_BLOCK_NATIVE', { blockId: response.startBlockId })
          runNativePath()
          return
        }

        if (TRACE_ENABLED) {
          const mode = response.sameBlock ? 'SERVICE_SAME_BLOCK_RECOVERED' : 'SERVICE_RECONSTRUCTION'
          console.log(`[PGT-TRACE] mode = ${mode}`, { startBlockId: response.startBlockId, endBlockId: response.endBlockId })
          console.log('[PGT-TRACE] fragments (pre-filter):', response.fragments)
        }

        const fragments: SelectionFragment[] = []
        for (const frag of response.fragments) {
          if (frag.text.trim().length === 0) continue
          const isNuisance = await buildNuisancePredicateFor(frag.pageNumber)
          const normalizedText = normalizePdfSelectionText(frag.text)
          const filteredText = buildFilteredFragmentText(frag.text, isNuisance)
          if (TRACE_ENABLED) console.log(`[PGT-TRACE] page ${frag.pageNumber}: filtered fragment text:`, JSON.stringify(filteredText))
          // Item 41/42: OCR stays single-region/native-Range-only -- a service-reconstructed
          // fragment's rects/tokens are never used (the OCR panel gates on fragment count in
          // the host app), so they are left empty here, same as the retired custom path did.
          const selectionResult: PdfSelectionResult = { rawText: frag.text, normalizedText, pageNumber: frag.pageNumber, ocrRects: [], scientificTokens: [] }
          fragments.push({ pageNumber: frag.pageNumber, selection: selectionResult, filteredText })
        }

        if (TRACE_ENABLED) console.log('[PGT-TRACE] final text (preview via combineFragments):', combineFragments(fragments))

        if (fragments.length > 0) {
          onSelection(fragments)
        } else if (TRACE_ENABLED) {
          console.log('[PGT-TRACE] no fragments produced -- selection dropped')
        }
      })()
    },
    [numPages, onSelection, onSelectionFailed, getPageLinesImpl],
  )

  const pageNumbers = useMemo(() => Array.from({ length: numPages }, (_, i) => i + 1), [numPages])

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
            <button type="button" onClick={() => scrollToPage(Math.max(1, currentPageNumber - 1))} disabled={currentPageNumber <= 1}>
              前へ
            </button>
            <span className="pdf-page-indicator">
              {currentPageNumber} / {numPages}
            </span>
            <button
              type="button"
              onClick={() => scrollToPage(Math.min(numPages, currentPageNumber + 1))}
              disabled={currentPageNumber >= numPages}
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
        {status === 'ready' && doc && (
          <div className="pdf-scroll-container" ref={scrollContainerRef} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp}>
            {pageNumbers.map((pageNumber) => (
              <PdfPageView
                key={pageNumber}
                doc={doc}
                pageNumber={pageNumber}
                scale={scale}
                estimatedWidth={estimatedPageSize.width}
                estimatedHeight={estimatedPageSize.height}
                onMeasured={handleMeasured}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
