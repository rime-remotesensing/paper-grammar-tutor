import { MODEL_SIZE_ADVISORY_THRESHOLD_B } from '../../../config/settings'

/**
 * Parses a leading parameter-count-in-billions out of a model name like
 * "qwen2.5:3b-instruct" or "llama3:70b". Returns null when no such pattern is found,
 * rather than guessing — this is intentionally generic (a regex over naming
 * conventions), not a lookup table of specific model names, so it works for model
 * families we've never evaluated.
 */
export function parseModelSizeB(modelName: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*b(?:[^a-z]|$)/i.exec(modelName)
  if (!match) return null
  const value = Number.parseFloat(match[1])
  return Number.isFinite(value) ? value : null
}

/**
 * Returns a short Japanese advisory for the model selector, or null when none applies.
 * Based on Prototype 0.2's holdout evaluation: models below ~4B failed to extract even
 * a sentence's subject/verb reliably. This only reacts to the parsed size, never to a
 * specific model name, so it doesn't need updating when new model names appear.
 */
export function getModelSizeAdvisory(modelName: string): string | null {
  const sizeB = parseModelSizeB(modelName)
  if (sizeB === null) return null
  if (sizeB < MODEL_SIZE_ADVISORY_THRESHOLD_B) {
    return `${sizeB}B級モデルはPrototype 0.2の評価で文の骨格（主語・動詞）抽出の精度が不足しました。動作確認以外の用途では、より大きいモデルを推奨します。`
  }
  return null
}
