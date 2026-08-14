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

/**
 * Local-only Tesseract.js asset paths (worker script, WASM core, English traineddata),
 * copied from `node_modules/tesseract.js` / `tesseract.js-core` into `public/tesseract/`
 * so the OCR fallback never depends on Tesseract.js's default jsDelivr CDN paths — the
 * project's PDF content must never leave the machine, and by default Tesseract.js fetches
 * its worker script, WASM core, and language data from a CDN. `OCR_CORE_PATH` is a
 * directory (not a specific file): Tesseract.js feature-detects WASM SIMD support at
 * runtime and picks the matching `tesseract-core-*lstm.wasm.js` file itself, so all three
 * variants (plain/simd/relaxedsimd, LSTM-only engine) are served from this directory. See
 * README for provenance of the bundled `eng.traineddata.gz` and the exact copy commands
 * (re-run after bumping the tesseract.js / tesseract.js-core version).
 */
export const OCR_WORKER_PATH = '/tesseract/worker/worker.min.js'
export const OCR_CORE_PATH = '/tesseract/core/'
export const OCR_LANG_PATH = '/tesseract/lang/'

/** Render scale used for the OCR fallback's page-wide render, matching the scale validated
 * during the Prototype 1.2A/B/C feasibility spikes (accuracy plateaus at 2x; higher scales
 * cost more time/memory without further improving Tesseract's recognition). */
export const OCR_RENDER_SCALE = 2

/** Selection-rect-to-OCR-word matching tolerance in OCR-canvas pixels, carried over
 * unchanged from the Prototype 1.2C spike (see docs/design-notes.md). Reused by the
 * Paddle path too — the underlying geometry (selection rect vs. word bbox center) is the
 * same regardless of which engine produced the word boxes. */
export const OCR_MATCH_TOLERANCE_PX = 3

/**
 * Local-only PaddleOCR service (Prototype 1.4A/1.4B) — the primary OCR engine.
 * `services/paddle_ocr/` must be started manually in development (see its README); this
 * app never spawns it. 127.0.0.1 only, matching the service's own bind address — this is
 * never a configurable remote host.
 */
export const PADDLE_SERVICE_URL = 'http://127.0.0.1:8008'

/** `/health` should answer near-instantly if the service is up at all; a short timeout
 * here just bounds how long "OCRで読み直す" can hang before falling through to the
 * explicit "利用できません" state when the service isn't running. */
export const PADDLE_HEALTH_TIMEOUT_MS = 3_000

/** `/ocr/page` warm latency measured 0.47-1.06s across the pages tested in
 * Prototype 1.3B/1.4A; this leaves generous headroom (the service's model is already
 * loaded by the time `/health` reports `modelLoaded: true`, so a "cold" inference within
 * a session shouldn't occur) without leaving the user staring at a hung UI indefinitely
 * if the service becomes unresponsive mid-session. */
export const PADDLE_OCR_TIMEOUT_MS = 10_000

/**
 * Render scale for the user-selected-line high-resolution second-pass (Prototype 1.5D).
 * Fixed at 6x per the Prototype 1.5B/1.5C benchmarks (2x/3x/4x page-wide scale changes
 * showed no meaningful accuracy gain — see docs/design-notes.md — but a 6x *targeted*
 * re-render of just the selected line(s), recognition-only, reliably recovered the
 * dropped-µ failure case with zero incorrect patches across the benchmarked corpus). Not
 * re-tuned here — re-validate against the same benchmark methodology before changing it.
 */
export const PADDLE_HIGH_RES_SCALE = 6

/**
 * Padding added around each selected line's bbox before cropping for the high-res
 * second-pass, as a fraction of that line's own character height. Validated at 10% in
 * Prototype 1.5B/1.5C/1.5D and this remains the production value.
 *
 * Prototype 1.5E found a real failure case ("Data was recorded...", Reno) where 10%
 * padding was insufficient for a *recognition-only* model to keep a µ it otherwise
 * dropped. Raising padding to 20% (1.5F) or adding a synthetic blank-margin border at
 * 10%+10% (1.5G) both fixed that case but introduced new dropped-µ/decimal-point
 * failures elsewhere (dense multi-line captions on Reno p11) — both were rejected. The
 * actual fix (1.5H/1.5I) was not a padding change at all: the selected-line second-pass
 * now runs through the same full det+rec pipeline `/ocr/page` uses (see
 * `PADDLE_LINES_TIMEOUT_MS` below), not a separate recognition-only model, which
 * resolved the 1.5E failure case without the padding-driven regressions. See
 * docs/design-notes.md, Prototype 1.5E-1.5I.
 */
export const PADDLE_HIGH_RES_PADDING_FRAC = 0.1

/** `/ocr/lines` now runs the selected line crop(s) through the same full det+rec
 * PP-OCRv6 pipeline `/ocr/page` uses (Prototype 1.5I) — not a separate recognition-only
 * model, which Prototype 1.5H found to be less accurate on line crops despite being
 * faster. Measured ~35ms/line once warm (vs ~13ms/line for the recognition-only
 * approach it replaced) — still small next to the 6x render's own cost on a cache miss,
 * so the timeout is not cut tight. */
export const PADDLE_LINES_TIMEOUT_MS = 10_000
