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
