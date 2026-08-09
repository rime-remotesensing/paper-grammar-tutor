Prototype 0 baseline (frozen). Prompt/schema as of the initial Prototype 0 delivery
(pattern was LLM-generated; sentenceCore had no `indirectObject`; clause `role` was a
free-text string). Do not regenerate this file — it exists for before/after comparison
against Prototype 0.1 and later.

- 3B run: `benchmark/results/2026-08-09T08-42-54-666Z/` (raw), 2026-08-09
- 7B run: `benchmark/results/2026-08-09T08-46-03-140Z/` (raw), 2026-08-09

| model | n | structured-output success | regeneration rate | avg ms | subject | verb | object | complement | pattern |
|---|---|---|---|---|---|---|---|---|---|
| qwen2.5:3b-instruct | 28 | 100% | 0% | 4936 | 0% | 43% | 46% | 61% | 18% |
| qwen2.5:7b-instruct | 28 | 100% | 0% | 9278 | 100% | 93% | 61% | 36% | 29% |
