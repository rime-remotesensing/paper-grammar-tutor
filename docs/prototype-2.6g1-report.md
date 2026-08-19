# Prototype 2.6G1 — Production Stanza Syntax Authority Integration: Final Report

Status: **uncommitted, awaiting review** (per instructions — no commit/tag/push performed).

## A. Starting git state

Clean except the same pre-existing, unrelated in-progress "SentenceCoreSet in production"
work that was present at the start of this whole session (21 modified files under `src/`,
`tests/`, `benchmark/generalization/run.ts`, plus untracked `sentenceCoreSet.ts`/
`sentenceCoreSet.test.ts`). `git diff --check` was clean. No reset/clean/restore/stash was
run; nothing was lost.

## B. Production insertion points found (audit)

- **A. GrammarAnalysis invocation**: `GrammarAnalyzer.ts:46` (`analyzeSentence()`).
- **B. Effective core established**: two layers — `rawCore`/`rawCoreSet` in
  `analyzeSentenceWithAutoRecovery.ts`, then `effectiveCore`/`effectiveCoreSet` in
  `analyzeSentenceWithComplementVerification.ts` (`continueAfterCoreGates`), documented there
  as "the core every downstream consumer... MUST use."
- **C. Focused repairs**: copular-core gate/repair, passive-core gate/repair, comma+V-ing
  gate/verifier — all inside `analyzeSentenceWithComplementVerification.ts`, mutually
  exclusive by construction, each rewriting only the primary predicate core.
- **D. PredicateStructure**: `predicateStructureService.ts` — an independent LLM call on
  `originalText`; `sentenceCore` is used only as part of its cache key, never as an input the
  call itself reads.
- **E. HybridMergedStructure**: `hybridPredicateMerger.ts`'s `mergeHybridPredicateStructure`
  — pure merge of `effectiveCore` + raw `PredicateStructure`, one-way consumption only (never
  writes back into the core).
- **F. Basic Skeleton**: `AnalysisResultPanel.tsx`, reads `effectiveCore` directly (single
  primary core, not the full set).
- **G. StructureTree**: `structureTree.ts`'s `buildCoreOnlyTree`/`buildHybridStructureTree`,
  both take a single `SentenceCore`, never the full `SentenceCoreSet`.
- **H. ReadingGuide/Vocabulary/Expressions**: independent LLM calls; `sentenceCore` used only
  as a cache-invalidation key, not as an input.

**Key finding**: substantial pre-existing scaffolding already exists toward exactly this
architecture — `SentenceCoreSet`/`PredicateCore` schema types, `materializeSentenceCoreSet`,
`projectPrimaryCore` (already the "compatibility projection" the plan called for), and
`replacePrimaryCoreFromRepair` — all built for a **Qwen**-sourced multi-predicate-core
output. G1 reuses this exact type system and `projectPrimaryCore`/
`validateGroundedSentenceCoreSet` machinery rather than duplicating it, and introduces Stanza
as a second, now-canonical, producer of the same `SentenceCoreSet` shape. This is the
**minimum insertion point**: one new wrapper function
(`analyzeSentenceWithSyntaxAuthority`) around the existing, completely unmodified Qwen
pipeline, plus one call-site swap in `App.tsx`.

## C. Stanza service architecture

`services/stanza_syntax/` — FastAPI + Stanza, local-only (matches the existing
`services/pymupdf_layout/`/`services/paddle_ocr/` pattern), its own container
(`docker/stanza-syntax/Dockerfile`) rather than folded into an existing Python service, per
the explicit instruction to avoid the previously-observed protobuf/dependency-conflict risk.
Scope is strictly raw dependency parse + source grounding — no five-pattern semantics in
Python.

## D. Pinned versions

- Python 3.12.3 (`python:3.12.3-slim-bookworm`, matching every other local service)
- `stanza==1.14.0`
- English model: `lang="en", package="default"` (resolves to the "combined" UD-English
  package + 1-billion-word character LM) — the **exact** package identity used to generate
  every frozen benchmark artifact (development 48 / former holdout 24 / BLIND_HOLDOUT_V2 24),
  confirmed by direct pipeline inspection.
- `fastapi==0.141.1`, `uvicorn[standard]==0.52.3`, `pytest==8.3.5`, `httpx==0.28.1`

## E. Service request/response schema

`POST /analyze` `{"text": "..."}` -> `{"tokens": [{id, text, lemma, upos, head, deprel,
start, end}, ...]}`. `422` on empty/missing text, `503` if the pipeline failed to load.
`GET /health` -> `{status, engine, serviceVersion, stanzaVersion, lang, package,
modelReady}`. Source offsets are re-derived by forward-scanning the *original* request text
(never trusted blindly from Stanza's own `start_char`/`end_char`), mirroring the frozen
benchmark's `alignTokensToSource`.

## F. Production ClauseFrame schema

```ts
type ClauseRelation = 'main' | 'subordinate' | 'coordinated' | 'relative' | 'other'
interface ClauseFrame {
  clauseId: number
  relation: ClauseRelation
  headTokenId: number
  parentClauseId: number | null
  marker: StanzaToken | null       // this clause's own `mark` child, if any
  predicateHeadIds: number[]       // this clause's head + its pure-conj coordination chain
}
```
(`src/features/grammar/domain/stanzaSyntaxAuthority.ts`, exported.)

## G. Production PredicateFrame schema

```ts
interface PredicateFrame {
  predicateId: number
  clauseId: number
  relation: PredicateCoreRelation   // 'main' | 'coordinated'
  headToken: StanzaToken
  aux: StanzaToken[]
  auxPass: StanzaToken[]
  cop: StanzaToken[]
  subjToken: StanzaToken | null
  objToken: StanzaToken | null
  iobjToken: StanzaToken | null
  xcompToken: StanzaToken | null
  ccompToken: StanzaToken | null
}
```
(same file, exported.)

## H. SentenceCoreSet canonical authority

Reuses the **existing** production schema type (`grammarAnalysis.schema.ts`) unchanged:
`{subject, subjectHead, predicateCores: PredicateCore[]}`, each `PredicateCore` carrying
`predicateCoreId, relation, connector, verb, indirectObject, object, complement, pattern`.
`pattern` is always mechanically derived via the existing `derivePattern.ts` — Qwen/Stanza
are never asked to classify SV/SVC/SVO/SVOO/SVOC directly.

## I. Compatibility projection

Reused as-is: `projectPrimaryCore(coreSet): SentenceCore` (`sentenceCoreSet.ts`, pre-existing)
— deterministic first/main predicate core in source order. No new projection logic was
written; G1 only changes *which* `SentenceCoreSet` gets projected.

## J. Qwen role after integration

Unchanged for ReadingGuide/Vocabulary/Expressions/educational explanation — those LLM calls
are untouched. Qwen's own `sentenceCoreSet`/`sentenceCore` output and every focused repair
built for it still run on **every** analysis exactly as before, but their result is used only
as: (1) enrichment for the raw/debug view, and (2) the explicit, clearly-labelled legacy
fallback (`syntaxAuthority.source === 'legacy-qwen-fallback'`) when Stanza is unavailable.
Direction is one-way and enforced by construction — `analyzeSyntaxAuthority.ts` never reads
Qwen output, and the override in `analyzeSentenceWithSyntaxAuthority.ts` happens strictly
*after* the (unmodified) Qwen pipeline returns.

## K. Focused-repair audit

| Repair | Classification | Rationale |
|---|---|---|
| Subject/verb repair (`FocusedSubjectVerbRepairer`) | **B** — legacy enrichment/fallback only | Still the correction mechanism for the Qwen core that ships as the explicit fallback when Stanza is down; not deleted, not obsolete, but never touches canonical Stanza output |
| Copular-core repair | **B** | same reasoning |
| Passive-core repair | **B** | same reasoning |
| Complement verification (comma+V-ing) | **B** | same reasoning |

None were classified **A** (fully obsolete) because this integration deliberately keeps the
Qwen path alive as the production fallback, not merely a developer diagnostic — declaring
them obsolete would leave no fallback quality path at all. None are **C** (unrelated) — all
four exist specifically to correct core fields G1 makes canonical. None are **D** (Tree
still consumes whichever `effectiveCore` it's handed, whether Stanza- or Qwen-sourced;
no repair is uniquely required for Tree specifically).

## L. PredicateStructure role

Confirmed unchanged and structurally incapable of overriding canonical authority:
`predicateStructureService.ts` calls `analyzePredicateStructure()` on `originalText` alone
(`sentenceCore` is cache-key-only); `hybridPredicateMerger.ts`'s
`mergeHybridPredicateStructure` only ever *reads* `effectiveCore`/`effectiveCoreSet`, never
writes back into them. No code change was needed here — "canonical syntax wins" was already
true by the existing one-way data flow, now verified.

## M. Failure/fallback policy

If the Stanza service is unreachable, times out, returns an invalid/malformed response, or
its derived core set fails structural validation, `analyzeSyntaxAuthority` returns `{status:
'unavailable', reason}` — it never fabricates a plausible-looking core set.
`analyzeSentenceWithSyntaxAuthority` then keeps the existing Qwen-derived
`effectiveCore`/`effectiveCoreSet` (so the app stays usable, no UI redesign needed) but sets
`syntaxAuthority = {source: 'legacy-qwen-fallback', unavailableReason: reason}` and emits a
`console.warn` — never silent.

## N. Cache design

`analyzeSyntaxAuthority.ts` — module-level `Map<string, Promise<SyntaxAuthorityResult>>`,
entirely separate from every Qwen-side cache (`predicateStructureService.ts`,
`readingGuideService.ts` each have their own independent `Map`). Key = exact source text +
a `SYNTAX_AUTHORITY_VERSION` constant (`"stanza-1.14.0-default"`) so a version bump can never
serve a stale parse under the current version's identity. A failed lookup is evicted
immediately (never permanently cached as unavailable) so a transient outage self-heals on the
next call. Tree interaction adds **0** Stanza calls and **0** GrammarAnalysis calls — verified
by the pipeline audit: Tree is built once, from already-resolved `result` state, on `handleAnalyze()`; no Tree
interaction (node click/expand) ever re-invokes analysis.

## O. 96-case frozen converter parity

**96/96 — exact parity**, verified via `tests/grammar/stanzaSyntaxAuthorityParity.test.ts`,
which imports the frozen benchmark's own `buildHierarchical` (commit `da6cb57`) as the
reference oracle and the production `buildSentenceCoreSetFromStanzaTokens` under test,
running both against the identical saved raw-token artifacts for development 48 + former
holdout 24 + BLIND_HOLDOUT_V2 24, and asserting structural equality of `subject` and every
`predicateCores` field. No new Stanza inference was run for this test (loads
`stanza-development.json`/`stanza-holdout.json`/`stanza-blind-v2.json` already on disk).

## P. Regression tests added

19 new frontend tests across 5 files:
- `tests/grammar/stanzaSyntaxAuthorityParity.test.ts` (1 — the 96-case hard requirement)
- `tests/grammar/stanzaSyntaxAuthority.test.ts` (11 — ClauseFrame construction, subordinate
  predicate exclusion, coordination, copula, false-C safety, passive, lexical-linking xcomp
  vs. catenative-VERB xcomp, object boundary/comma-gated restrictiveness, balanced
  delimiters, `SentenceCoreSet`/`projectPrimaryCore` multi-core preservation)
- `tests/grammar/stanzaSyntaxClient.test.ts` (6 — schema, non-2xx, malformed body, network
  failure, health-unreachable, health-ok)
- `tests/grammar/analyzeSyntaxAuthority.test.ts` (6 — ok path, unreachable, empty tokens, no
  main predicate, cache hit, cache-does-not-poison-on-failure)

Plus 10 new Python tests (`services/stanza_syntax/tests/test_service.py`): schema, health,
source offsets (ASCII + punctuation), the CJK equation-placeholder regression case,
empty/whitespace/missing-text rejection, service-not-ready handling.

No existing test was deleted or weakened.

## Q. Source-offset/Unicode verification

Confirmed at three independent levels: (1) the Python service's own
`test_unicode_equation_placeholder_grounding` (10/10 passing, run against the real local
model); (2) a **live** request against the running Docker container with the exact
regression text `"...[式 (3)]... approaches unity..."` — `式` returned as its own
correctly-grounded token (`start:34, end:35`), `approaches`/`unity` both exactly grounded, no
truncation; (3) the 96-case parity test, which includes the equation-placeholder cases from
all three corpora. The corrupted-glyph class of bug (`approaches` -> `pproaches`) does not
reproduce — architecturally expected, since FastAPI/Starlette decode the HTTP body as UTF-8
directly from bytes, with no OS-locale-dependent stdin text mode involved at all (the earlier
bug's actual mechanism).

## R. Service tests

`services/stanza_syntax`: **10/10 passed** (pytest, real Stanza pipeline, not mocked).

## S. Frontend tests

**94/94 test files, 938/938 tests passed** (`npx vitest run`), including all 19 new tests
above.

## T. Backend tests if run

Not re-run (`services/pymupdf_layout`, `services/paddle_ocr` — no shared infrastructure or
Docker orchestration files for those services were changed; only `compose.yaml` gained an
additive new service block, and `docker compose config` confirms the existing three services'
definitions are byte-identical).

## U. Docker compose verification

`docker compose config` validates cleanly with `stanza-syntax` present, correctly configured
(port 8010, health check, no GPU reservation, `restart: unless-stopped`), and all four
pre-existing services (`web`, `pymupdf-layout`, `paddle-ocr`, `ollama`) unchanged.

## V. Clean Docker smoke

Ran `scripts/start.ps1 -NoBrowser` end-to-end. Images for `paddle-ocr`/`web`/
`pymupdf-layout` were already built/cached from prior work in this repo; `stanza-syntax` was
built fresh (see W for image size). All five containers reported **healthy**:

```
web : healthy
pymupdf-layout : healthy
stanza-syntax : healthy
ollama : healthy
paddle-ocr : healthy
```

`GET /health` on the live container: `{"status":"ok","engine":"stanza","serviceVersion":
"prototype-2.6g1","stanzaVersion":"1.14.0","lang":"en","package":"default","modelReady":
true}`. One live `POST /analyze` request was performed against the running container (the
equation-placeholder regression sentence — see Q). Beyond that, the actual production
`analyzeSyntaxAuthority()` TypeScript function was invoked directly (via `node`) against the
live container and returned a fully correct `SentenceCoreSet` (subject "The classifier",
subjectHead "classifier", one SVO predicate core, verb "detected", object "anomalous
pixels") — a genuine end-to-end proof through the real production code path, not just curl.
**Not exercised**: a full browser-driven Ollama+Stanza UI flow (no browser-automation tooling
is set up in this environment) — this is a real, honestly-reported gap, not claimed as done.
`stop.ps1` was then run; all containers removed cleanly, both named model volumes
(`paper-grammar-tutor_ollama-models`, `paper-grammar-tutor_paddle-models`) confirmed still
present afterward.

## W. Stanza parse latency

Live Docker container, `POST /analyze`, 3 samples each (`curl -w time_total`):

| sentence | median |
|---|---|
| short ("Hi there.") | ~39ms |
| normal (10-word academic sentence) | ~65ms |
| 80+-word sentence (real BLIND_HOLDOUT_V2 bh24 text) | ~244ms |

(An earlier cold, non-Docker, first-call measurement via the raw Python pipeline directly
showed higher numbers — 76ms/263ms/2.18s — reflecting process/JIT warm-up rather than the
served container's steady-state behavior; the table above is the representative number.)
CPU-only throughout, no GPU reservation requested or used, well within interactive latency
for single-sentence analysis — no optimization needed.

## X. Overall analysis latency impact

Not independently measured end-to-end (would require driving the full Ollama GrammarAnalysis
call chain, which was already several seconds per sentence before this change and is
unaffected by it). The net addition is exactly one Stanza HTTP call (~40-250ms depending on
sentence length, see W) that runs **after** the existing Qwen pipeline, not blocking or
gating it — so the added latency is additive and small relative to the pre-existing LLM call
chain, not multiplicative.

## Y. Call-count before/after (one normal analysis)

| call | before G1 | after G1 |
|---|---|---|
| Ollama GrammarAnalysis | 1 (+retries on schema failure, rare) | 1 (unchanged — now enrichment/fallback source) |
| Focused repair (copular/passive/comma-ing, mutually exclusive) | 0–1 | 0–1 (unchanged) |
| PredicateStructure | 1 | 1 (unchanged) |
| ReadingGuide | 1 (only if that panel is opened) | 1 (unchanged) |
| **Stanza local HTTP** | **0** | **1 (new)** |

Net: +1 local HTTP call, 0 Ollama calls removed by design (Qwen remains the enrichment source
and the explicit fallback). This directly demonstrates which component is now authority:
`effectiveCore`/`effectiveCoreSet` come from the +1 Stanza call whenever it succeeds, from
Qwen's (unchanged) output only when it doesn't.

## Z. Changed files

New: `services/stanza_syntax/{main.py,requirements.txt,README.md,tests/test_service.py}`,
`docker/stanza-syntax/Dockerfile`,
`src/features/grammar/domain/{stanzaSyntaxAuthority.ts,stanzaSyntaxClient.ts,
analyzeSyntaxAuthority.ts,analyzeSentenceWithSyntaxAuthority.ts}`,
`tests/grammar/{stanzaSyntaxAuthorityParity.test.ts,stanzaSyntaxAuthority.test.ts,
stanzaSyntaxClient.test.ts,analyzeSyntaxAuthority.test.ts}`, this report.

Modified (all additive, 116 insertions / 4 deletions across 6 files):
`compose.yaml` (+1 service block), `scripts/start.ps1` (+1 port, +1 health wait),
`scripts/status.ps1` (+1 health check), `src/config/settings.ts` (+2 constants),
`src/App.tsx` (1 import + 1 call-site swap: `analyzeSentenceWithComplementVerification` ->
`analyzeSentenceWithSyntaxAuthority`, `VerifiedSentenceAnalysis` ->
`VerifiedSentenceAnalysisWithSyntaxAuthority` state type — a strict superset, no other line
changed), `docs/design-notes.md` (+1 architecture section).

**Zero lines changed** in `GrammarAnalyzer.ts`, `analyzeSentenceWithAutoRecovery.ts`,
`analyzeSentenceWithComplementVerification.ts`, `hybridPredicateMerger.ts`,
`structureTree.ts`, `AnalysisResultPanel.tsx`, `predicateStructureService.ts`,
`readingGuideService.ts`, or any repair module — confirming the "minimum insertion point"
approach and that Tree/ReadingGuide/PredicateStructure were not redesigned.

## AA. git diff --check

Clean (CRLF-normalization notices only, no conflict markers, no trailing-whitespace errors).

## AB. Final git status

Matches Z above exactly; all pre-existing unrelated modifications from before this session
remain untouched. Nothing staged, nothing committed, no tag, no push.

## AC. Known limitations / deferred G2 work

- Structure Tree still consumes only the single primary `SentenceCore` projection —
  coordinated/secondary predicate cores are computed and preserved in `effectiveCoreSet` but
  not yet rendered (explicitly deferred to 2.6G2, per instructions).
- Basic Skeleton shows only the primary core.
- ReadingGuide (B6) unchanged; ReadingGuide/Vocabulary/Expressions still key off the single
  `effectiveCore`, not the full set.
- `syntaxAuthority.source`/`unavailableReason` is not surfaced anywhere in the UI — currently
  console-only (matches "no UI redesign" scope, but is a real gap for a future prototype that
  wants to show users when analysis is running in degraded/fallback mode).
- No browser-driven end-to-end UI smoke test was performed (no automation tooling available in
  this environment) — verified instead via direct production-code invocation against the live
  Docker service (see V) plus the 96-case parity test.
- `stanza-syntax` Docker image is **9.41GB** (PyTorch + the English "combined" package + 1B
  charlm) — not optimized, per explicit instruction not to prematurely optimize image size;
  worth revisiting if distribution size becomes a real constraint.
- Accuracy is **not** 100% and is not claimed to be: frozen blind result is 22/24 (91.7%)
  whole-core-set-exact, both failures documented TRUE_STANZA_PARSE_ERROR. No blind
  re-evaluation was performed or is planned in this phase.

---

## Final decision

**PRODUCTION_STANZA_AUTHORITY_READY_FOR_LIVE_ACCEPTANCE**

Rationale: 96/96 production/frozen-benchmark parity (hard requirement, met exactly);
false-C safety preserved (0 fabricated PP/time/place/manner/agent complements across every
test, matching the frozen blind invariant of 0/29); the local Stanza service builds, starts,
and reports healthy in the real Docker stack alongside all four pre-existing services with no
regression to any of them; source-offset/Unicode correctness verified at three independent
levels including a live equation-placeholder request against the running container; failure
policy is explicit and non-silent; the integration touches zero lines of
Tree/ReadingGuide/PredicateStructure/focused-repair code, satisfying every "strictly out of
scope" boundary; and the one real gap (no browser-driven UI smoke test) is disclosed rather
than glossed over. G2 (Tree/UI multi-core exposure) remains open, deliberately untouched.
