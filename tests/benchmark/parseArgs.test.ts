import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../benchmark/run.ts'
import { DEFAULT_OLLAMA_BASE_URL } from '../../src/config/settings.ts'

describe('benchmark parseArgs', () => {
  it('parses a single model with no flags, defaulting dataset to development', () => {
    expect(parseArgs(['qwen2.5:3b-instruct'])).toEqual({
      models: ['qwen2.5:3b-instruct'],
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      dataset: 'development',
    })
  })

  it('parses multiple comma-separated models', () => {
    expect(parseArgs(['qwen2.5:3b-instruct,qwen2.5:7b-instruct'])).toEqual({
      models: ['qwen2.5:3b-instruct', 'qwen2.5:7b-instruct'],
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      dataset: 'development',
    })
  })

  it('parses a custom --base-url regardless of flag position', () => {
    expect(parseArgs(['--base-url', 'http://localhost:9999', 'qwen2.5:3b-instruct'])).toEqual({
      models: ['qwen2.5:3b-instruct'],
      baseUrl: 'http://localhost:9999',
      dataset: 'development',
    })
    expect(parseArgs(['qwen2.5:3b-instruct', '--base-url', 'http://localhost:9999'])).toEqual({
      models: ['qwen2.5:3b-instruct'],
      baseUrl: 'http://localhost:9999',
      dataset: 'development',
    })
  })

  it('parses --dataset holdout regardless of flag position', () => {
    expect(parseArgs(['qwen2.5:7b-instruct', '--dataset', 'holdout'])).toEqual({
      models: ['qwen2.5:7b-instruct'],
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      dataset: 'holdout',
    })
    expect(parseArgs(['--dataset', 'holdout', 'qwen2.5:7b-instruct'])).toEqual({
      models: ['qwen2.5:7b-instruct'],
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      dataset: 'holdout',
    })
  })

  it('parses --dataset and --base-url together', () => {
    expect(
      parseArgs(['qwen2.5:7b-instruct,qwen2.5:14b-instruct', '--dataset', 'holdout', '--base-url', 'http://localhost:9999']),
    ).toEqual({
      models: ['qwen2.5:7b-instruct', 'qwen2.5:14b-instruct'],
      baseUrl: 'http://localhost:9999',
      dataset: 'holdout',
    })
  })

  it('rejects an invalid --dataset value', () => {
    expect(() => parseArgs(['qwen2.5:7b-instruct', '--dataset', 'nonsense'])).toThrow(/--dataset/)
  })

  it('throws a usage error when no model is given', () => {
    expect(() => parseArgs([])).toThrow(/Usage:/)
    expect(() => parseArgs(['--base-url', 'http://localhost:9999'])).toThrow(/Usage:/)
    expect(() => parseArgs(['--dataset', 'holdout'])).toThrow(/Usage:/)
  })
})
