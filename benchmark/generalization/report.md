# Prototype 2.6D — Complex Sentence Generalization Benchmark

Measurement date: 2026-08-18 (Asia/Tokyo)

Model/provider: `qwen2.5:7b-instruct` / local Ollama, production temperature and schemas

Production grammar, Tree, ReadingGuide, and Docker code changes during 2.6D: **none**

## Executive decision

**COMPLEX_SENTENCE_GENERALIZATION_ARCHITECTURE_READY_FOR_REVIEW**

The audit is complete and reproducible. The present single-core Stage-1 schema is not adequate as the canonical authority for shared-subject predicates with different five-pattern structures. For Prototype 2.6E, use **one shared subject plus multiple grounded predicate cores** as canonical authority, while deriving a primary-core compatibility projection for the existing simple-sentence UI. Add Stage-0 grounded structural regions and an enumeration container; retain a coarse-but-correct fallback. This is a recommendation only—no production implementation was made.

## A. Benchmark dataset composition

- New synthetic/paraphrased academic set: 72 sentences: 48 development + 24 locked holdout.
- Every gold S/V/IO/O/C span is deterministic and source-grounded; the loader rejects missing or ambiguous source spans.
- Gold C follows the Japanese five-pattern definition. Post-verbal PPs are modifiers unless they are genuine predicate complements.
- Development tag counts: active-passive=1, although=1, baseline=4, because=1, citation=4, clause-coordination=2, colon=1, coordination=12, enumeration=3, equation=1, if=1, infinitive=3, internal-np-coordination=2, long-50-80=1, long-80+=1, long-np=1, mixed-pattern=2, modifier-types=1, multiple-modifier-depths=1, multiple-pp=1, noun-clause=1, object-complement=1, object-coordination=1, opening-modifier=1, parenthetical=1, participle=1, passive=11, passive-pp=3, postmodifier=4, postnominal-participle=1, PP-modifier=1, predicate-coordination=7, reduced-relative=4, relative-clause=2, respectively=1, semicolon=2, shared-subject=7, stacked-pp=1, subject-coordination=1, subordinate-clause=7, SV=4, SVC=5, SVC+SV=1, SVC+SVC=1, SVO=17, SVO+SVO=1, SVOC=1, SVOO=1, three-predicates=2, true-complement=1, when=1, whereas=1.
- Locked holdout tag counts: active-passive=1, citation=3, clause-coordination=1, colon=1, coordination=9, enumeration=2, equation=1, infinitive=1, internal-np-coordination=1, long-50-80=1, long-80+=1, long-np=1, mixed-pattern=1, multiple-modifier-depths=2, multiple-pp=1, object-complement=1, passive=6, passive-pp=2, postmodifier=1, reduced-relative=2, relative-clause=1, respectively=1, semicolon=1, shared-subject=6, stacked-pp=1, subordinate-clause=3, SV=1, SVC=1, SVC+SV=1, SVC+SVC=1, SVO=6, SVO+SVO=1, SVOC=1, three-predicates=1, whereas=1.
- The locked holdout was frozen before the unchanged production pipeline was run, and was evaluated once.
- The initial development JSON also contains one unscored non-development artifact produced by an early absent-flag parser bug. Aggregation is explicitly filtered to `split === development` and exactly 48 IDs; no scored row is affected. The parser was fixed before stability and external-control runs. The baseline was not rerun or replaced after holdout inspection.

## B. Legacy holdout status

- Files: `benchmark/sentences/development.json` (28) and `benchmark/sentences/holdout.json` (57). Text and gold were not edited.
- Legacy structural coverage includes SV/SVO/SVC/SVOO/SVOC, passives, PPs, relatives, gerund subjects, coordination, clauses, ambiguity, and modifier cases.
- It is a **legacy holdout, not fully blind**. Two sentences have been reused in recent Prototype 2.x prompt/tests: `h25-relative-who` (focused S/V prompt, hybrid merger, relative-link prefilter) and `h37-gerund-subject` (comma-ing gate, hybrid merger).
- Post-complex-holdout run (57): schema 100%, regeneration 0%, subject 74%, subjectHead 74%, verb 70%, IO 95%, object 77%, subject-complement 70% (n=20), object-complement 92% (n=37), constituent average 80%, derived pattern 56%; average 6171 ms.

## C. Complexity distribution

| Word bin | Sentences |
|---|---:|
| <=20 | 68 |
| >80 | 1 |
| 21-40 | 1 |
| 41-60 | 2 |

| Clauses | Sentences |
|---|---:|
| 1 | 41 |
| 2 | 21 |
| 3+ | 10 |

| Modifiers | Sentences |
|---|---:|
| 0-1 | 52 |
| 2-3 | 13 |
| 4+ | 7 |

## D–I. Current core baseline

False-C uses only gold-C-null sentences as its denominator; false-O analogously uses gold-O-null sentences.

| Split | n | Schema | S exact | V exact | O exact | C exact | Pattern | False C | False O | Missing slot |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Development | 48 | 100.0% (48/48) | 95.8% (46/48) | 81.3% (39/48) | 58.3% (28/48) | 81.3% (39/48) | 47.9% (23/48) | 7.7% (3/39) | 36.4% (8/22) | 35.4% (17/48) |
| Locked holdout | 24 | 100.0% (24/24) | 91.7% (22/24) | 87.5% (21/24) | 45.8% (11/24) | 79.2% (19/24) | 45.8% (11/24) | 10.5% (2/19) | 40.0% (4/10) | 37.5% (9/24) |
| Combined | 72 | 100.0% (72/72) | 94.4% (68/72) | 83.3% (60/72) | 54.2% (39/72) | 80.6% (58/72) | 47.2% (34/72) | 8.6% (5/58) | 37.5% (12/32) | 36.1% (26/72) |

### D. Current baseline S accuracy

Development 95.8% (46/48); locked holdout 91.7% (22/24).

### E. Current baseline V accuracy

Development 81.3% (39/48); locked holdout 87.5% (21/24).

### F. Current baseline O accuracy

Development 58.3% (28/48); locked holdout 45.8% (11/24).

### G. Current baseline C accuracy

Development 81.3% (39/48); locked holdout 79.2% (19/24).

### H. Sentence-pattern accuracy

Development 47.9% (23/48); locked holdout 45.8% (11/24).

### I. False-complement rate

Development 7.7% (3/39); locked holdout 10.5% (2/19).

Development verb overcapture: 6.3% (3/48); undercapture: 0.0% (0/48).

Locked-holdout verb overcapture: 4.2% (1/24); undercapture: 0.0% (0/24).

## J. Results by sentence length

| Split / word bin | n | S | V | O | C | Pattern | False C |
|---|---:|---:|---:|---:|---:|---:|---:|
| Development <=20 | 46 | 95.7% (44/46) | 80.4% (37/46) | 60.9% (28/46) | 80.4% (37/46) | 47.8% (22/46) | 8.1% (3/37) |
| Development 21-40 | 1 | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/1) |
| Development 41-60 | 1 | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (1/1) | 0.0% (0/1) | 0.0% (0/1) |
| Holdout <=20 | 22 | 90.9% (20/22) | 86.4% (19/22) | 50.0% (11/22) | 77.3% (17/22) | 45.5% (10/22) | 11.8% (2/17) |
| Holdout >80 | 1 | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (1/1) | 0.0% (0/1) | 0.0% (0/1) |
| Holdout 41-60 | 1 | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/1) | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/1) |

The >80-word bin is intentionally small and therefore diagnostic, not a population estimate. The longer/enumerated examples show that structural attachment degrades more sharply than schema validity.

## K. Results by structure category

“Any Tree defect” is the union of the deterministic Tree metrics.

| Category | n | All 5 core fields exact | Pattern | False C | Any Tree defect |
|---|---:|---:|---:|---:|---:|
| baseline | 4 | 75.0% (3/4) | 75.0% (3/4) | 0.0% (0/3) | 0.0% (0/4) |
| passive | 17 | 17.6% (3/17) | 17.6% (3/17) | 7.1% (1/14) | 70.6% (12/17) |
| passive-pp | 5 | 0.0% (0/5) | 0.0% (0/5) | 20.0% (1/5) | 80.0% (4/5) |
| infinitive | 4 | 25.0% (1/4) | 50.0% (2/4) | 0.0% (0/4) | 25.0% (1/4) |
| reduced-relative | 6 | 83.3% (5/6) | 83.3% (5/6) | 0.0% (0/6) | 0.0% (0/6) |
| relative-clause | 3 | 66.7% (2/3) | 66.7% (2/3) | 0.0% (0/3) | 0.0% (0/3) |
| postnominal-participle | 1 | 100.0% (1/1) | 100.0% (1/1) | 0.0% (0/1) | 0.0% (0/1) |
| long-np | 2 | 100.0% (2/2) | 100.0% (2/2) | 0.0% (0/1) | 0.0% (0/2) |
| multiple-pp | 2 | 0.0% (0/2) | 0.0% (0/2) | 0.0% (0/2) | 100.0% (2/2) |
| coordination | 21 | 14.3% (3/21) | 28.6% (6/21) | 6.7% (1/15) | 57.1% (12/21) |
| shared-subject | 13 | 23.1% (3/13) | 30.8% (4/13) | 0.0% (0/7) | 69.2% (9/13) |
| mixed-pattern | 3 | 0.0% (0/3) | 0.0% (0/3) | N/A | 100.0% (3/3) |
| three-predicates | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/2) | 66.7% (2/3) |
| internal-np-coordination | 3 | 66.7% (2/3) | 66.7% (2/3) | 33.3% (1/3) | 100.0% (3/3) |
| subordinate-clause | 10 | 20.0% (2/10) | 40.0% (4/10) | 0.0% (0/7) | 50.0% (5/10) |
| enumeration | 5 | 40.0% (2/5) | 60.0% (3/5) | 0.0% (0/5) | 60.0% (3/5) |
| respectively | 2 | 0.0% (0/2) | 0.0% (0/2) | 0.0% (0/2) | 50.0% (1/2) |
| citation | 7 | 42.9% (3/7) | 42.9% (3/7) | 14.3% (1/7) | 100.0% (7/7) |
| equation | 2 | 100.0% (2/2) | 100.0% (2/2) | 0.0% (0/2) | 50.0% (1/2) |
| multiple-modifier-depths | 3 | 66.7% (2/3) | 66.7% (2/3) | 0.0% (0/3) | 33.3% (1/3) |
| long-50-80 | 2 | 0.0% (0/2) | 100.0% (2/2) | 0.0% (0/2) | 0.0% (0/2) |
| long-80+ | 2 | 0.0% (0/2) | 0.0% (0/2) | 0.0% (0/2) | 50.0% (1/2) |

Boolean strata required by the audit are represented above: passive, enumeration, coordination, and citation; word, clause, and modifier strata are in C/J.

## L–N. Tree metrics

| Split | n | Duplicate visible | Parent-child overlap | Lexical loss | Wrong role | Unattached span | Bogus predicate | Citation node | Equation corruption |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Development | 48 | 0.0% (0/48) | 4.2% (2/48) | 0.0% (0/48) | 18.8% (9/48) | 29.2% (14/48) | 4.2% (2/48) | 8.3% (4/48) | 0.0% (0/48) |
| Locked holdout | 24 | 0.0% (0/24) | 12.5% (3/24) | 0.0% (0/24) | 25.0% (6/24) | 12.5% (3/24) | 8.3% (2/24) | 12.5% (3/24) | 0.0% (0/24) |
| Combined | 72 | 0.0% (0/72) | 6.9% (5/72) | 0.0% (0/72) | 20.8% (15/72) | 23.6% (17/72) | 5.6% (4/72) | 9.7% (7/72) | 0.0% (0/72) |

### L. Tree duplicate rate

Development 0.0% (0/48); locked holdout 0.0% (0/24).

### M. Tree lexical-loss rate

Development 0.0% (0/48); locked holdout 0.0% (0/24).

### N. Tree wrong-role rate

Development 18.8% (9/48); locked holdout 25.0% (6/24).

The required presentation invariant held: **lexical loss = 0**. Duplicate visible constituents also remained 0; the residual parent-child overlap metric identifies semantic/authority overlap rather than duplicate presentation rows.

## O. Failure taxonomy

| Root-cause class | Development | Holdout | Total |
|---|---:|---:|---:|
| CORE_MISSING_SLOT | 17 | 9 | 26 |
| TREE_WRONG_ROLE | 9 | 6 | 15 |
| CORE_COORDINATED_PREDICATE_LOSS | 6 | 6 | 12 |
| CITATION_AS_TREE_NODE | 4 | 3 | 7 |
| COORDINATION_FAILURE | 4 | 1 | 5 |
| CORE_FALSE_COMPLEMENT | 3 | 1 | 4 |
| CORE_VERB_OVERCAPTURE | 3 | 1 | 4 |
| PREDICATE_STAGE2_PSEUDO_PREDICATE | 2 | 2 | 4 |
| CORE_MIXED_PATTERN_COORDINATION_FAILURE | 2 | 1 | 3 |
| ENUMERATION_ATTACHMENT_FAILURE | 1 | 1 | 2 |
| POSTMODIFIER_ATTACHMENT_FAILURE | 1 | 0 | 1 |
| CORE_PASSIVE_PP_AS_COMPLEMENT | 0 | 1 | 1 |

The coordination categories are supported by multiple synthetic cases. The second live control additionally exhibits predicate-coordination nesting and internal-NP-coordination loss, but those two labels are kept as live-control findings rather than promoted to corpus-level taxonomy without multiple scored cases.

## P. First-failure-stage distribution

| First stage | Development | Holdout | Total |
|---|---:|---:|---:|
| GrammarAnalysis | 11 | 6 | 17 |
| PredicateStructure | 1 | 0 | 1 |
| Tree construction | 8 | 2 | 10 |
| focused repair | 15 | 10 | 25 |
| none | 12 | 6 | 18 |
| presentation | 1 | 0 | 1 |

This distribution prevents downstream Tree defects from being incorrectly attributed to Tree construction when Stage 1 or Stage 2 was already corrupt.

## Q. Focused-repair invocation/success audit

Development status inventory:

- Stage-1 core recovery: none=27, forced-core=20, focused-sv=1 (status: not-needed=27, repaired=21).
- Copular repair: not_applicable=47, repaired=1.
- Passive repair: not_applicable=48.
- Complement verification: not_applicable=48.
- Where-clause repair: not_applicable=46, not_run=2.

| Mechanism | Invoked | Mechanism success | Gold-positive/improved | Unnecessary/no-op | Regression |
|---|---:|---:|---:|---:|---:|
| Stage-1 core recovery (forced/focused) | 21 | 21 | N/A | N/A | N/A |
| Focused copular core | 1 | 1 | 1 | 0 | 0 |
| Focused passive core | 0 | 0 | 0 | 0 | 0 |
| Focused complement verification | 0 | 0 | 0 | 0 | 0 |
| Focused where-clause repair | 0 | 0 | N/A | N/A | N/A |

Important limitation: `rawGrammarAnalysis`/`rawCore` are already post auto-recovery. Therefore forced-core and focused-S/V pre-repair authority is not exposed, and their true-positive/unnecessary/regression counts cannot be reconstructed without rerunning a modified production pipeline; they are reported as N/A rather than guessed. For focused copular/passive/complement layers, `rawCore` versus `effectiveCore` is available. The 20/48 forced-core rate is itself strong evidence that the current architecture relies heavily on recovery.

## Stability and fresh-response verification

- Representative set: 18 sentences spanning correct, borderline, failed, passive, coordination, equation, citation, 50–80 words, >80 words, and enumeration.
- Runs: original baseline + 2 new runs = 3 per sentence. First-failure stage stable: 18/18; core metrics stable: 17/18; Tree metrics stable: 18/18. Core-metric variation: d27-colon-enumeration.
- Before **every** new run, the runner calls: `resetPredicateStructureCache`, `resetFocusedRelativeLinkCache`, `resetFocusedWhereClauseRepairCache`, `resetFocusedSubjectVerbRepairCache`, `resetFocusedComplementVerifierCache`, `resetFocusedCopularCoreRepairCache`, and `resetFocusedPassiveCoreRepairCache`. GrammarAnalysis has no result cache.
- Fresh-call proof: 36/36 runs contain a delegate-level GrammarAnalysis call; 36/36 unique reset sequences; 96 delegate calls with 96 unique monotonic call indices 1–96; minimum 2 actual LLM request(s) per run. Evidence gate: **PASS**.
- Response SHA-256 and byte length were recorded after every delegate response. 18/18 sentence IDs had differing whole-trace response fingerprints across the two new runs. Identical hashes are valid deterministic regenerations because the delegate call index proves a new HTTP generation occurred; hash equality is not used as evidence of a cache hit.

## R. External KNN-GCN failure trace

- External/noncommitted control; its full source sentence is not in the benchmark dataset or this report.
- Stage 1 after auto-recovery: S=“a new slope-unit-based model called KNN-GCN” [15, 58), V=“is applied” [59, 69), C covered the entire post-verbal PP/list payload, pattern=SVC. This is the first false-C point: GrammarAnalysis/forced-core recovery.
- Focused passive repair ran and shortened C to “for the mapping of landslide susceptibility” [70, 113), but retained pattern=SVC. Thus it improved span size without correcting complement semantics.
- PredicateStructure required two actual generation calls, then emitted one `is applied` predicate whose “object” covered the complete PP plus enumeration. It also emitted two broad, overlapping `other` regions; it did not create an enumeration container.
- Predicate acceptance preserved that single predicate. The hybrid merger then combined the broad Stage-2 object with the overlapping Stage-1 C. Tree construction preserved both plus overlapping list regions.
- Root cause: **both Stage 1 and Stage 2**. Stage 1 created SVC/false C; Stage 2 flattened the list into oversized overlapping dependents. Acceptance and merger did not originate the errors, but did not enforce consistency against them.
- LLM proof for this control: 5 delegate calls, reset sequence 1, response hashes recorded.

### External live control 2 — shared-subject mixed predicates

- Stage 1 selected only V=“is influenced” [49, 62), pattern=SV. “is very complex” disappears at GrammarAnalysis/forced-core recovery.
- PredicateStructure did **not** identify two predicates. It emitted one predicate `is`; `very complex` became a condition and the full passive predicate became an object dependent. This is the first subordination error.
- Predicate acceptance retained the already-corrupt single branch; it did not independently drop a correctly represented second predicate. The hybrid merger retained the nesting; Tree construction rendered it.
- The citation was a Stage-2 sentence modifier and became a visible `other` grammar node in Tree construction. Internal “geological conditions and environmental factors” remained opaque inside one broad object span, so internal NP coordination was not represented.
- Basic Skeleton conclusion: a single S/V/IO/O/C/pattern cannot faithfully preserve SVC + SV under one subject.

## S. Architecture spike A — current full-sentence pipeline

- Development cases: 48.
- All predicate cores visible: 95.8% (46/48).
- Multi-predicate cases: 9; all predicate cores visible: 88.9% (8/9).
- Core pattern accuracy remains the limiting authority metric (D–I), even when the final Tree happens to expose additional predicates.

## T. Architecture spike B — main-clause/core-first

- Non-production deterministic region-isolation feasibility only; no production prompt/rule changes.
- Main subject+verb authority retained: 100.0% (48/48).
- Required subordinate/enumeration/citation payload separated: 95.8% (46/48).
- This supports a Stage-0 grounded-region boundary before assigning five-pattern roles.

## U. Architecture spike C — hierarchical/shared-subject predicate cores

- Multi-predicate cases: 9.
- All gold predicates covered: raw PredicateStructure 88.9% (8/9), predicate acceptance 88.9% (8/9), hybrid 88.9% (8/9), final Tree 88.9% (8/9).
- The loss usually occurs before acceptance/merger, supporting a canonical shared-subject + multiple-predicate-core representation rather than more downstream repair gates.

## V. Coarse-fallback result

- Detailed defective development Trees: 26.
- A core-only coarse presentation avoided presentation hazards in 84.6% (22/26).
- It was both presentation-safe and backed by fully correct core authority in only 34.6% (9/26).
- Therefore fallback is useful, but must be gated on core/region consistency; coarse output cannot rescue a wrong Stage-1 core.

## W. Recommended Prototype 2.6E production architecture

1. Stage 0: produce grounded, non-five-pattern structural regions (opening modifier, main subject region, predicate regions, PP/modifier regions, citation, enumeration container and members).
2. Canonical authority: **one shared subject + multiple predicate cores**, each with its own V/IO/O/C/pattern and grounded spans.
3. Compatibility projection: expose a deterministic primary core for current simple-sentence UI/API, plus explicit coordinated predicate structures. Do not silently collapse mixed predicates into one label.
4. Stage 2 attaches modifiers/clauses/list containers to predicate cores under invariants: post-verbal PP ≠ C by position; list payload cannot enter V/O/C without justification; Stage 2 cannot broaden/replace an accepted core verb.
5. Confidence/consistency gate: if detailed attachment is unsafe but the canonical core/regions are sound, render a coarse Tree rather than a detailed misleading Tree.

Representation comparison:

| Representation | Simple compatibility | Current UI migration | Tree/ReadingGuide authority | Five-pattern pedagogy | Decision |
|---|---|---|---|---|---|
| A. Single core | Excellent | None | Loses mixed coordinated predicates | Misleading for SVC+SV | Reject as canonical |
| B. Shared subject + multiple predicate cores | Excellent for one predicate | Add coordinated-core view | Best grounded authority/targets | Teaches each predicate pattern explicitly | **Canonical choice** |
| C. Primary core + coordinated structures | Excellent | Easiest transition | Good only if secondary structures are equally authoritative | Risk of overemphasizing “primary” | Use as compatibility projection of B |

ReadingGuide remains downstream and unchanged; it should consume final Tree targets after Tree authority is corrected.

## X. Proposed Prototype 2.6E acceptance thresholds

These targets are proposed after observing the baseline:

- Structured-output success ≥99%; regeneration ≤2%.
- S exact ≥97%, V exact ≥95%, O exact ≥90%, C exact ≥95%, pattern ≥90% overall.
- Gold-C-null false-C ≤2%; passive+PP false-C = 0.
- Multi-predicate all-core preservation ≥95%, including all locked SVC+SV/SVC+SVC/SVO+SVO cases.
- 41–80 and >80 word pattern ≥85% (report bins separately; do not hide small n).
- Duplicate visible constituent = 0; lexical loss = 0; parent-child visible overlap ≤1%.
- Citation-as-grammar-node = 0; equation corruption = 0; bogus predicate ≤2%; wrong-role ≤5%.
- Stability set: ≥95% identical core decisions and ≥90% identical first-failure/success classification over 3 fresh generations.
- Forced-core recovery invocation ≤10%; every repair must expose auditable pre/post authority, true-positive, unnecessary, and regression counts.

## Y. Changed files

- `benchmark/generalization/dataset.ts` — 48 development + 24 locked cases and exact-span materialization.
- `benchmark/generalization/metrics.ts` — deterministic core/Tree metrics.
- `benchmark/generalization/run.ts` — unchanged-pipeline runner, full stage capture, per-run cache resets, delegate request evidence, external-control mode.
- `benchmark/generalization/spikes.ts` — non-production A–D feasibility spikes.
- `benchmark/generalization/report.ts` / `report.md` — reproducible aggregation and this report.
- `tests/benchmark/generalizationDataset.test.ts` — lock, span, coverage, length, passive-C, and mixed-predicate assertions.
- Ignored raw outputs: `benchmark/results/generalization/*.json`; no copyrighted external control was committed into source assets.

## Z. Git status and scope

- Phase-0 checkpoint: `f1e9a53c8cd64c5c6d6d67f57b0f32c9152db368` — `Add Docker distribution and Tree-authoritative reading guidance`.
- 2.6D state before any new commit: `?? benchmark/generalization/`, `?? tests/benchmark/generalizationDataset.test.ts`.
- Production grammar/UI/ReadingGuide/Docker files: unchanged during 2.6D.
- Tag: none. Push: none. Winning architecture: not implemented.

## Verification record

- Phase 0: frontend 88 files / 893 tests; typecheck, lint, tests, build, diff-check passed. PyMuPDF 103 passed / 2 fixture skips. Paddle 16 passed. Docker config and short live smoke passed; the smoke stack was stopped. The benchmark-only Ollama service was stopped after 2.6D.
- 2.6D dataset test: 6/6 passed; typecheck passed after runner instrumentation.
- Development baseline: one controlled run on 48. Locked complex holdout: one run on 24 after freeze. Legacy holdout: one run on 57 after complex holdout.
