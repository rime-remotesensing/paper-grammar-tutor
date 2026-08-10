export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'

export const DEFAULT_TEMPERATURE = 0.1
export const MIN_TEMPERATURE = 0
export const MAX_TEMPERATURE = 0.2

export const HEALTH_CHECK_TIMEOUT_MS = 5_000
export const LIST_MODELS_TIMEOUT_MS = 5_000
export const GENERATE_TIMEOUT_MS = 120_000

export const MAX_REPAIR_ATTEMPTS = 1

export const PDF_DEFAULT_SCALE = 1.25
export const PDF_MIN_SCALE = 0.5
export const PDF_MAX_SCALE = 3
export const PDF_SCALE_STEP = 0.25

/** How many leading pages to sample when checking whether a PDF has an extractable text layer. */
export const PDF_SCANNED_CHECK_SAMPLE_PAGES = 3
/** Below this many extracted characters (summed across the sampled pages), treat the PDF as scanned/no text layer. */
export const PDF_SCANNED_CHECK_MIN_CHARS = 20

/** Below this parameter count (in billions, parsed from the model name), show the "not recommended" advisory. */
export const MODEL_SIZE_ADVISORY_THRESHOLD_B = 4

/**
 * Trailing-slash URL pdf.js appends its wasm/JS decoder filenames to (jbig2.wasm,
 * openjpeg.wasm, qcms_bg.wasm, and their no-wasm JS fallbacks) when decoding embedded
 * JBIG2/JPX images and doing color management. Without this, pdf.js silently fails to
 * decode those images (console warnings only, no thrown error) and the page renders
 * blank — this bit real scanned PDFs during Prototype 1.1 testing. The files themselves
 * are pdfjs-dist's own prebuilt `wasm/` bundle, copied as-is into `public/pdfjs/wasm/`
 * so Vite serves them at a stable, unhashed path in both dev and build (see README for
 * the copy command; re-run it after bumping the pdfjs-dist version).
 */
export const PDF_WASM_URL = '/pdfjs/wasm/'
