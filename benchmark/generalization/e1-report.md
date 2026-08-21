# Prototype 2.6E1 final report

Decision: **MULTI_PREDICATE_CORE_AUTHORITY_BLOCKED**

The canonical authority itself met the frozen development count/V/pattern/false-C targets,
but the locked holdout per-core pattern target and the Tree hard gates did not pass. E2 UI
migration must not start from this checkpoint.

## A. Prototype 2.6D checkpoint

- Commit: `050a1e743a7cc96a92930b25fe38ba33a127aadd`
- Author: `rime-remotesensing <scc25c05@inc.kisarazu.ac.jp>`
- Subject: `Add complex sentence generalization benchmark`
- No tag and no push were performed by E1.

## B-F. Canonical authority

- `SentenceCoreSet` holds one sentence-level `subject`/`subjectHead` and one-or-more
  `PredicateCore` values.
- The compact LLM core contains only `connector`, `verb`, `indirectObject`, `object`, and
  `complement`. The app derives `predicateCoreId`, `relation`, and the five-pattern label.
- Relation is deterministic: source-order index 0 is `main`; later cores are `coordinated`.
- The legacy projection is always the first/main source-order core. The only direction is
  canonical set -> primary projection; no code reconstructs canonical data from the projection.
- GrammarAnalysis still uses one general request. The prompt distinguishes predicate
  coordination from coordination inside C/O and enforces strict per-core C semantics.
- Grounding resolves repeated predicate verbs sequentially after the shared subject and prior
  verb. A connector is accepted only inside the gap before its core verb. IDs, relation,
  source order, overlap, connector placement, and at-least-one-core are deterministic checks.
- General canonical normalization removes empty placeholder cores, separates a trailing
  preposition from V, rejects PP-shaped slots after passive V, converts bare-copula O to C,
  and handles a passive participle placed at the start of a copular C. No literal KNN-GCN,
  `is applied`, or benchmark-sentence rule was added.

## G. Focused-repair compatibility audit

| Existing layer | Classification | E1 behavior |
|---|---|---|
| canonical copular/passive normalization | A / D | Runs independently on every core; makes the mechanically provable bare-copula and passive-PP shapes redundant before focused repair. |
| forced-core recovery | C | Migrated from one legacy core to shared subject + one-or-more compact predicate cores; forms canonical authority in the existing one repair call. |
| focused subject/verb repair | C | Repairs primary formation evidence and preserves all secondary canonical cores. |
| focused copular repair | B / D | Retained for ambiguous primary-core cases; it cannot collapse secondary cores. Common bare-copula slot correction is now redundant. |
| focused passive repair | B / D | Retained for ambiguous primary-core cases; mechanically provable PP cases are normalized per core first. |
| focused complement verification | B | Remains primary-only; accepted evidence updates only primary canonical slots and preserves secondary cores. |
| focused relative/where repair | C | Attachment/presentation analysis outside canonical five-pattern formation; it does not author predicate count. |

No repair was duplicated automatically across every predicate. One known blocked edge remains:
if the model omits a leading preposition from an O span, source-independent passive slot
normalization may retain that O candidate after clearing C.

## H. PredicateStructure and merger

- GrammarAnalysis `SentenceCoreSet` is the only five-pattern/count authority.
- PredicateStructure remains enrichment for attachments and presentation.
- `HybridMergedStructure` carries `canonicalCoreSet` metadata so the authority survives the
  merger boundary. The visible Tree still consumes the primary projection in E1.
- Basic Skeleton, StructureTreeView, ReadingGuide, vocabulary, and expressions received no
  visible redesign. ReadingGuide therefore remains Tree-target-based and behaviorally unchanged.

## I-M. Frozen development (48)

Frozen artifact: ignored runtime output `benchmark/results/generalization/e1-development-frozen.json`.

| Metric | Result |
|---|---:|
| shared subject exact | 41/48 (85.4%) |
| multi-predicate count exact | 9/9 (100.0%) |
| under / over split on multi cases | 0 / 0 |
| per-core V exact | 58/61 (95.1%) |
| per-core IO exact | 58/61 (95.1%) |
| per-core O exact | 44/61 (72.1%) |
| per-core C exact | 59/61 (96.7%) |
| per-core pattern exact | 49/61 (80.3%) |
| false-C where gold C is null | 0/51 (0.0%) |
| whole core-set exact | 30/48 (62.5%) |
| schema failures | 0/48 |
| forced-core recovery | 18/48 (baseline: 20/48) |

The provisional development count, V, pattern, false-C, and schema targets passed.

## N-Q. Locked complex holdout (24, opened once after freeze)

Frozen artifact: ignored runtime output `benchmark/results/generalization/e1-holdout-frozen.json`.

| Metric | Result |
|---|---:|
| shared subject exact | 15/24 (62.5%) |
| multi-predicate count exact | 8/8 (100.0%) |
| under / over split on multi cases | 0 / 0 |
| per-core V exact | 31/36 (86.1%) |
| per-core IO exact | 34/36 (94.4%) |
| per-core O exact | 20/36 (55.6%) |
| per-core C exact | 32/36 (88.9%) |
| per-core pattern exact | 21/36 (58.3%) |
| false-C where gold C is null | 1/30 (3.3%) |
| whole core-set exact | 8/24 (33.3%) |
| schema failures | 0/24 |
| forced-core recovery | 11/24 |

Count, V, false-C, and schema targets passed. Pattern missed the frozen 70% target. No
holdout-driven patch was made.

## R. Primary-projection compatibility

| Split | S | V | O | C | derived pattern |
|---|---:|---:|---:|---:|---:|
| development | 41/48 (85.4%) | 45/48 (93.8%) | 37/48 (77.1%) | 46/48 (95.8%) | 39/48 (81.3%) |
| locked complex holdout | 15/24 (62.5%) | 20/24 (83.3%) | 15/24 (62.5%) | 21/24 (87.5%) | 16/24 (66.7%) |

## S. Historical holdout

- New post-complex-holdout run: `benchmark/results/2026-08-18T04-21-44-146Z-holdout/`.
- 57/57 completed, structured-output success 100%, regeneration 0%.
- S 75%, subjectHead 75%, V 72%, IO 96%, O 74%, subject-C 70% (n=20), object-C
  92% (n=37), constituent average 80%, primary derived pattern 54%, average 6464 ms.
- This runner is the existing historical lenient scorer and is reported separately from
  canonical exact metrics.

## T. Stochastic stability (18 x 3 fresh runs)

Frozen artifact: ignored runtime output `benchmark/results/generalization/e1-stability-frozen.json`.

- Predicate-count sequence stable: 17/18 sentences.
- Core-set-exact outcome stable: 17/18.
- Whole predicted pattern sequence stable: 15/18.
- Per-gold-core predicted pattern stable: 23/28.
- First-failure stage stable: 15/18.
- Unstable cases: `d01` (failure stage), `d18` (pattern), `d27` (set/pattern/stage),
  and `d34` (count/pattern/stage).

## U-V. Tree safety

| Split | lexical loss | visible duplication |
|---|---:|---:|
| development | 1/48 (`d46-semicolon-clauses`) | 0/48 |
| locked holdout | 3/24 (`h10`, `h17`, `h23`) | 1/24 (`h12`) |

Both requirements are hard gates. The result is therefore blocked even though canonical
development targets passed.

## W-X. External controls

- KNN-GCN control (full source text was not committed): subject `a new slope-unit-based model
  called KNN-GCN`; one core, V `is applied`, IO/O/C null, pattern SV.
- Mixed-predicate control (full source text was not committed): subject `The occurrence of
  landslides`; core 1 V `is`, C `very complex`, SVC; core 2 connector `and`, V
  `is influenced`, C null, SV. Citation material did not enter a core.

## Y. Calls, cache initialization, and fresh-response evidence

General-call architecture before/after is unchanged: one GrammarAnalysis call per initial
analysis; E1 added **zero** general-purpose calls and Tree interaction adds zero calls. Existing
focused calls remain conditional. Development recorded 48 GrammarAnalysis delegate calls for
48 sentences; locked holdout 24/24; stability 54/54; each external control 1/1.

The exact cache initialization used by `benchmark/generalization/run.ts` is
`resetPipelineCaches()`. Immediately before **every sentence, repetition, or external control**
it calls all seven functions:

1. `resetFocusedComplementVerifierCache()`
2. `resetFocusedCopularCoreRepairCache()`
3. `resetFocusedPassiveCoreRepairCache()`
4. `resetFocusedRelativeLinkCache()`
5. `resetFocusedSubjectVerbRepairCache()`
6. `resetFocusedWhereClauseRepairCache()`
7. `resetPredicateStructureCache()`

It then increments and stores `cacheResetSequence`. Verified sequences were exactly 1-48 for
development, 1-24 for locked holdout, 1-54 for stability, and 1 for each standalone control.

`TracingProvider.generateStructured()` awaits the real delegate and only then records call
index, SHA-256 of raw response text, and UTF-8 byte count. Verification found a valid 64-hex
hash and positive byte count for every GrammarAnalysis call above. Stability had 53 unique
hashes across 54 real calls: two `d16` responses were byte-identical, but they were separate
delegate calls at reset/call `(6,12)` and `(24,56)`, proving deterministic equality rather
than cache reuse. The historical runner uses a fresh process and directly invoked Ollama for
all 57 rows (57 `ok` raw outputs); it does not use the seven focused-service caches.

## Z. Changed files

- Canonical schemas/prompts: `grammarAnalysis.schema.ts`, `grammarAnalysis.jsonSchema.ts`,
  `grammarAnalysisPrompt.ts`, `forcedCore.schema.ts`, `forcedCore.jsonSchema.ts`,
  `forcedCorePrompt.ts`.
- Canonical domain/compatibility: new `sentenceCoreSet.ts`, `GrammarAnalyzer.ts`,
  `resolveAnalysisSpans.ts`, `sentenceCoreRecovery.ts`, auto-recovery/complement integration,
  fallback, merger, and the unchanged-visible panel wiring.
- Benchmark: dataset gold migration, canonical metrics, runner capture, and this report.
- Tests: dataset/schema/analyzer/recovery/complement fixtures and new
  `sentenceCoreSet.test.ts`.

## AA. Verification

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm test`: pass, 90 files / 914 tests.
- `npm run build`: pass (existing chunk-size warning only).
- `git diff --check`: pass (line-ending conversion notices only).
- Backend suites: not run; no backend or Docker architecture source changed.
- Benchmark Docker Ollama was stopped with `scripts/stop.ps1`; model-cache volume was kept.

## AB. Git status and stop condition

- E1 is intentionally uncommitted for review.
- The worktree contains only the E1 source/test/report changes listed above; ignored runtime
  benchmark outputs are not staged or committed.
- No E1 tag, push, E2 UI work, or `prototype-2.5` modification was performed.

Final decision: **MULTI_PREDICATE_CORE_AUTHORITY_BLOCKED**.

Blocking evidence is the locked-holdout pattern result (58.3% < 70%) plus nonzero Tree lexical
loss and visible duplication. Stop here; do not begin E2.
