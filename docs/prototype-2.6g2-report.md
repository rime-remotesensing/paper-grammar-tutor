# Prototype 2.6G2 — Hierarchical Stanza Structure Tree Migration: Final Report

Status: **uncommitted, awaiting user live acceptance** (per instructions — no commit/tag/push).

## A. G1 checkpoint commit SHA

`365fa8b678d5a10a95516cee2c6becb2f4df81b9` — "Integrate Stanza syntax authority" (author/committer: rime-remotesensing <scc25c05@inc.kisarazu.ac.jp>). Created at the start of this phase, confirmed via `git log -1`.

## B. Old Tree authority path

`AnalysisResultPanel.tsx`'s `buildFinalTree()`: no `PredicateStructure` result yet →
`buildCoreOnlyTree(effectiveCore)` (mechanical S→V→O/C from the single primary core, no
coordination); once `PredicateStructure` resolves → `mergeHybridPredicateStructure(...)` →
`buildHybridStructureTree(...)` (`structureTree.ts`) — a ~450-line, heavily-heuristic builder
around the single `SentenceCore` + `HybridMergedStructure` (itself from a separate Qwen LLM
call, `PredicateStructureAnalyzer`). Coordinated/secondary predicate cores in
`effectiveCoreSet.predicateCores[1..]` were never visible to this path.

## C. New Tree authority path

`buildStanzaHierarchicalTree(text, stanzaTokens)` (new file,
`src/features/grammar/domain/stanzaStructureTree.ts`) — a pure function of `(text,
StanzaToken[])`, reusing `stanzaSyntaxAuthority.ts`'s own frozen `buildClauseFrames`/
`buildPredicateFrame`/`convertPredicateFrame`/`collectConstituentTokens` (exported, not
reimplemented) so every canonical S/V/IO/O/C value is byte-identical to what
`buildSentenceCoreSetFromStanzaTokens` (the frozen G1 converter) already produced for the
exact same tokens. `AnalysisResultPanel.tsx`'s `buildFinalTree()` now calls this directly when
`syntaxAuthority.source === 'stanza'`, bypassing `PredicateStructure`/the legacy builders
entirely; falls back to the original, completely unmodified legacy path otherwise (item 20).

## D. Production Tree schema changes

One additive change to `StructureDisplayRole` (`structureTree.ts`): a new `'enumeration'`
role (colon/semicolon-introduced list container). One matching Japanese label added to
`StructureTreeView.tsx`'s existing role→label map (`enumeration: '列挙'`). `StructureTreeNode`
itself is unchanged — the new builder uses the existing `presentationSpan` field (already
part of the type, already understood by `StructureTreeView`/`treeReadingMatching.ts`/
`treeReadingTargets.ts`) for the authority-vs-presentation distinction; nothing else in the
schema changed.

## E. Clause → Tree mapping

Only the **main** clause (`ClauseFrame.relation === 'main'`) becomes the tree's primary
subject+predicates node. A **subordinate** clause whose `parentClauseId` anchors to the main
clause becomes its own top-level sibling node (its own subject + predicate(s), with its own
internal coordination fully preserved) — placed before the main node when it precedes the
subject in source order (the common preposed "Because/Although/When ..." shape), after
otherwise. **Relative/reduced-relative/other** clauses are never surfaced as top-level
siblings — they are NP-internal postmodifiers, represented inside their antecedent
constituent's own children (see H).

## F. Predicate → Tree mapping

Each `PredicateFrame` in the (sub)clause's own `predicateHeadIds` chain becomes exactly one
`predicate`/`coordinatedPredicate` node, in source order, as a **sibling** of the others under
the shared subject — never nested inside a sibling's own subtree. A coordinated predicate's
connector ("and"/"but"/...) is shown via `presentationSpan` (e.g. "and is influenced"), while
the node's own authority span/text stay the bare canonical verb ("is influenced") — so the
connector is visible without ever disagreeing with the canonical `SentenceCoreSet.verb` span.

## G. Canonical S/IO/O/C mapping

Every constituent node's own `start`/`end`/`text` is the **exact same span**
`stanzaSyntaxAuthority.ts`'s frozen `convertPredicateFrame`/`collectConstituentTokens` would
produce — recomputed via the identical exported functions, never re-derived independently.
This makes it structurally impossible for a Tree node's canonical role to contradict Basic
Skeleton/`SentenceCoreSet` (item 6), and is verified empirically by the 96-case regression
test's zero "O/C contradiction" count (S/T below).

## H. PP/modifier mapping

Any predicate-head child not consumed by a canonical slot (`obj`/`iobj`/`xcomp`/`ccomp`/
`cop`/`aux`) and not a clause-starting deprel already handled at the clause level
(`advcl`/`acl`/`csubj`/`parataxis`) becomes a plain `'modifier'` node — never
`object`/`complement`, regardless of how semantically object-like or complement-like it might
look (product principle, item 7: generic but correct over specific but wrong). No
condition/cause/purpose sub-classification is attempted, per the same principle.

## I. Relative/postmodifier mapping

A restrictive `acl`/`advcl` child of a canonical constituent's head (no comma before it — the
same restrictive/non-restrictive distinction the frozen G1 converter already uses) is pulled
out of the constituent's own displayed range and represented as a separate `'relativeClause'`
child, while the parent's `presentationSpan` shrinks to the core NP only (its `start`/`end`/
`text` — the authority — still cover the full canonical span, so nothing is lost or
duplicated). This uniformly covers full relative clauses ("engineer who designed..."), reduced
relatives ("data collected by..."), and participial postmodifiers ("model called KNN-GCN"),
using one mechanism, not per-construction special-casing.

## J. Enumeration representation

A colon/semicolon-introduced appositive/parataxis list attached to a canonical slot's head
(the exact material the frozen converter already excludes from that slot's own span) is
collected into a `'enumeration'` container node, its own children built with a
conj/cc-stopping variant of the same token-collection so each list member becomes its own
separate item rather than one merged blob.

## K. Citation/parenthetical policy

`isCitationLike` (the frozen G1 heuristic, reused verbatim) suppresses citation-shaped
appositive material at both the constituent-postmodifier stage and the modifier stage —
matched material never becomes a standalone grammar node anywhere in the tree, verified by a
dedicated unit test (X below). Lexical material is never deleted from authority spans that
don't contain only-citation content — suppression is presentation-only, per item 12.

## L. B4 presentation integration

Reused the **existing** `presentationSpan` discipline (`structureTree.ts`'s own documented
convention, already consumed by `StructureTreeView.tsx`'s `deriveStructureNodePresentation`
and `treeReadingMatching.ts`'s `structureTreeNodeSpan`) rather than inventing a new mechanism:
a constituent node's `start`/`end`/`text` are always the full canonical authority span; when a
postmodifier or coordination connector is split out as a separate child/decoration,
`presentationSpan` holds the narrower range actually rendered for that node. Verified: zero
parent/child visible-span overlap (dedicated test), zero visible duplicate constituents across
all 96 regression cases.

## M. Stable node-key strategy

No new key-derivation code was needed — `treeReadingMatching.ts`'s existing
`structureTreeNodeKey` (`${node.start}:${node.end}:${node.role}`) already satisfies item 15's
exact requirement (role + grounded span, never LLM output order/randomness/render timing), and
the new builder is a pure function of `(text, StanzaToken[])`, so it automatically produces
identical keys across repeated builds of the same input (verified by a dedicated test: two
independent builds of the same tokens produce byte-identical key sets, with no duplicate keys
within one tree).

## N. B6 target integration

No changes to `treeReadingTargets.ts`/`treeReadingMatching.ts` were needed — `deriveTreeReadingTargets`
already operates generically on `StructureTreeNode[]`, and `isPedagogicalReadingTarget`'s
existing bare-copula exclusion (`/^(?:am|is|are|was|...)$/`) already implements item 17's "a
trivial one-word copula can remain without a target" exactly. Verified live against both the
shared-subject-coordination and KNN-GCN controls: reasonable targets only (shared subject,
"very complex", "and is influenced", meaningful modifiers) — no excessive
punctuation/connector-only targets.

## O. Basic Skeleton temporary compatibility state

Unchanged, as instructed (item 19). Basic Skeleton continues to read `effectiveCore` =
`projectPrimaryCore(effectiveCoreSet)` — the first/main predicate core only. Structure Tree
now shows the **full** canonical multi-predicate hierarchy (all coordinated predicates,
subordinate clauses, postmodifiers, enumeration). This asymmetry is intentional and documented
here per item 19's explicit requirement: a sentence with 2+ coordinated main predicates will
show only the first in Basic Skeleton while Tree shows all of them — deferred to a future UI
phase, not resolved in G2.

## P. Legacy fallback behavior

When `syntaxAuthority.source !== 'stanza'` (Stanza service unavailable, malformed response, or
a Stanza-derived core set that fails `validateGroundedSentenceCoreSet`), `buildFinalTree()`
falls through to the **original, byte-for-byte unmodified** `buildCoreOnlyTree`/
`buildHybridStructureTree` path — the same code that ran before G1/G2 existed. This is a safe,
already-proven compatibility path, not a "pretend Stanza-quality" path (item 20) — it is
exactly the tree the application already showed for every sentence before this whole Stanza
integration began.

## Q–V. 96-case hard-gate results (development 48 + former holdout 24 + BLIND_HOLDOUT_V2 24)

`tests/grammar/stanzaStructureTreeRegression.test.ts` — internal-consistency check against the
already-frozen canonical `SentenceCoreSet` from the same tokens (never against hand gold, and
no syntax-authority tuning), using only the already-saved raw Stanza artifacts (no new Stanza
inference):

| gate | target | result |
|---|---|---|
| Q. lexical loss | 0/96 | **0/96** |
| R. visible duplicate constituent | 0/96 | **0/96** |
| S. canonical predicate missing | 0 | **0** |
| S. canonical predicate duplicated | 0 | **0** |
| T. canonical O/C role contradiction | 0 | **0** |
| U. subordinate predicate leakage | 0 | **0** |
| V. false promotion of noncanonical PP to O/C | 0 (verified via dedicated unit test + construction — the builder has no code path that can assign `object`/`complement` to anything but a canonical slot's own recomputed span) | **0** |

All 96 cases pass every gate on the first fully-fixed run (three implementation bugs found
and fixed during development against this same corpus: a duplicate-modifier bug where a
copular complement's own internal adverb was also emitted as a sibling modifier; a
missing-object-node bug for clausal (`ccomp`) objects; and an authority/text-span mismatch
introduced by an earlier, since-corrected attempt at connector/postmodifier presentation —
all three are exactly the class of bug this hard-gate regression exists to catch, and it did).

## W. Deterministic tests added

29 new tests across 3 files:
- `tests/grammar/stanzaStructureTreeRegression.test.ts` (1 — the 96-case hard-gate regression, section Q–V)
- `tests/grammar/stanzaStructureTree.test.ts` (9 — canonical slot→role mapping incl. PP-not-O/C,
  reduced relative attachment, citation suppression, balanced delimiter preservation, source
  order, B4 authority-vs-presentation non-overlap, stable node keys, B6 target derivation +
  exact lookup, legacy-fallback shape)
- Plus targeted manual controls verified live against the running Docker Stanza service and
  the earlier unit suite (`tests/grammar/stanzaSyntaxAuthority.test.ts`, unchanged from G1,
  still 11/11 passing) already covers ClauseFrame construction, subordinate exclusion,
  coordination, copula, false-C safety, passive, and xcomp linking-complement — all directly
  exercised by the new Tree builder too since it reuses the same frozen conversion functions.

Vocabulary/Expressions persistence and contextual behavior were **not** given new tests: their
logic (`vocabularyPresentation.ts`, `expressionPresentation.ts`) was not touched by G2 (the
G1 audit confirmed they depend only on `analysis.vocabulary`/`readingGuide.expressions`, never
on `sentenceCore`/`sentenceCoreSet`/Tree shape) — zero regression risk, and the existing test
suite covering them is unchanged and still passing.

No existing test was deleted or weakened.

## X. Total frontend tests

**96 test files, 948 tests, all passing** (`npx vitest run`) — up from 94/938 at the G1
checkpoint (+2 files, +10 tests net; the regression file counts as 1 test covering all 96
sentences).

## Y. Backend tests if run

Not re-run — no shared Python service interface changed in G2 (the Stanza service's
request/response schema is exactly as G1 left it; G2 only added a new TypeScript consumer of
the same `/analyze` response shape).

## Z. typecheck/lint/build/diff-check

- `npx tsc -b`: clean except the same 4 pre-existing `TS6133` warnings in the already-frozen
  `benchmark/generalization/stanzaHierarchicalAdapterEval.ts` (present since the 2.6F freeze,
  not touched by G1 or G2).
- `npx oxlint`: same 3 warnings (subset), exit 0.
- `npx vite build`: succeeds (pre-existing chunk-size advisory only).
- `git diff --check`: clean (CRLF-normalization notices only).

## AA. Docker compose/smoke

`docker compose config` validates cleanly. All five services were confirmed **healthy**
simultaneously (web, pymupdf-layout, stanza-syntax, paddle-ocr, ollama) — the four
non-`web` services were already running healthy from the G1 session; `web` was rebuilt
(`docker compose up -d --build web`) to pick up the G2 frontend changes and came up healthy in
under 10 seconds. Browser automation is not available in this environment, so per item 29's
explicit fallback, the "direct application-path syntax analysis" was performed instead: the
real production `analyzeSyntaxAuthority()` → `buildStanzaHierarchicalTree()` call path was
invoked directly against the live, fully-running Docker stack for the KNN-GCN control
sentence, reproducing exactly the reported live bug fix (see AE) end-to-end through production
code, not a mock. **Docker was left running** (not stopped) so the live browser acceptance
review requested in item 30 can proceed immediately; model volumes were never touched.

## AB. Call-count before/after

No change from the G1 baseline. Tree construction on the Stanza-authority path makes **zero**
additional Stanza or Ollama calls — `stanzaTokens` was already fetched once during
`analyzeSentenceWithSyntaxAuthority()` (before `AnalysisResultPanel` even mounts) and is reused
as-is for Tree construction. `PredicateStructure`/`ReadingGuide` calls still fire exactly as
before (G2 did not attempt to suppress them — doing so would have meant editing their
triggering `useEffect`s, outside the "minimum insertion point" scope); on the Stanza-authority
path their result is simply no longer consumed for Tree-building, a documented minor
inefficiency, not a correctness issue, left for a future cleanup pass. Tree interaction itself
(expand/collapse/click) triggers **zero** Stanza and **zero** GrammarAnalysis calls, confirmed
by the same architectural fact as G1: Tree is built once per `handleAnalyze()` call from
already-resolved state, never re-triggered by interaction.

## AC. Changed files

New: `src/features/grammar/domain/stanzaStructureTree.ts`,
`tests/grammar/stanzaStructureTree.test.ts`,
`tests/grammar/stanzaStructureTreeRegression.test.ts`, this report.

Modified since the G1 checkpoint (`365fa8b`):
- `src/features/grammar/domain/stanzaSyntaxAuthority.ts` — **export-only** changes (11 private
  helpers made `export`ed for reuse by the new Tree module); zero logic changes, reconfirmed
  by the unchanged 96/96 production/frozen-benchmark parity test.
- `src/features/grammar/domain/structureTree.ts` — added the `'enumeration'` role to the
  `StructureDisplayRole` union (additive type-only change).
- `src/features/grammar/components/StructureTreeView.tsx` — added the matching Japanese label.
- `src/features/grammar/domain/analyzeSyntaxAuthority.ts` — `SyntaxAuthorityResult`'s `'ok'`
  variant now also carries `tokens: StanzaToken[]` (needed so the Tree builder can reuse the
  exact authority the coreSet came from).
- `src/features/grammar/domain/analyzeSentenceWithSyntaxAuthority.ts` — carries the new
  `stanzaTokens` field through onto the result object.
- `src/features/grammar/components/AnalysisResultPanel.tsx` — `buildFinalTree()` now branches
  on `syntaxAuthority.source`; prop type widened to
  `VerifiedSentenceAnalysisWithSyntaxAuthority`.

**Zero lines changed** in `hybridPredicateMerger.ts`, `predicateStructureService.ts`,
`readingGuideService.ts`, `treeReadingTargets.ts`, `treeReadingMatching.ts`,
`vocabularyPresentation.ts`, `expressionPresentation.ts`, or any focused-repair module —
confirming B6/PredicateStructure/Vocabulary/Expressions were not redesigned, and the legacy
Tree path remains byte-for-byte available as the fallback.

## AD. git status

```
 M benchmark/generalization/run.ts                                    (pre-existing, unrelated)
 M src/features/grammar/components/AnalysisResultPanel.tsx
 M src/features/grammar/components/StructureTreeView.tsx
 M src/features/grammar/domain/GrammarAnalyzer.ts                     (pre-existing, unrelated)
 M src/features/grammar/domain/analyzeSentenceWithAutoRecovery.ts     (pre-existing, unrelated)
 M src/features/grammar/domain/analyzeSentenceWithComplementVerification.ts (pre-existing, unrelated)
 M src/features/grammar/domain/analyzeSentenceWithSyntaxAuthority.ts
 M src/features/grammar/domain/analyzeSyntaxAuthority.ts
 M src/features/grammar/domain/fallbackAnalysis.ts                   (pre-existing, unrelated)
 M src/features/grammar/domain/hybridPredicateMerger.ts               (pre-existing, unrelated)
 M src/features/grammar/domain/resolveAnalysisSpans.ts                (pre-existing, unrelated)
 M src/features/grammar/domain/sentenceCoreRecovery.ts                (pre-existing, unrelated)
 M src/features/grammar/domain/stanzaSyntaxAuthority.ts
 M src/features/grammar/domain/structureTree.ts
 M src/features/grammar/schemas/forcedCore.jsonSchema.ts              (pre-existing, unrelated)
 M src/features/grammar/schemas/forcedCore.schema.ts                  (pre-existing, unrelated)
 M src/features/grammar/schemas/grammarAnalysis.jsonSchema.ts         (pre-existing, unrelated)
 M src/features/grammar/schemas/grammarAnalysis.schema.ts             (pre-existing, unrelated)
 M src/llm/prompts/forcedCorePrompt.ts                                (pre-existing, unrelated)
 M src/llm/prompts/grammarAnalysisPrompt.ts                           (pre-existing, unrelated)
 M tests/fixtures/validAnalysisFixture.ts                             (pre-existing, unrelated)
 M tests/grammar/GrammarAnalyzer.test.ts                              (pre-existing, unrelated)
 M tests/grammar/analyzeSentenceWithAutoRecovery.test.ts              (pre-existing, unrelated)
 M tests/grammar/analyzeSentenceWithComplementVerification.test.ts    (pre-existing, unrelated)
 M tests/grammar/schema.test.ts                                       (pre-existing, unrelated)
 M tests/grammar/sentenceCoreRecovery.test.ts                         (pre-existing, unrelated)
?? benchmark/generalization/e1-report.md                              (pre-existing, abandoned spaCy track)
?? benchmark/generalization/spacyAuthorityEval.ts                     (pre-existing, abandoned spaCy track)
?? benchmark/generalization/spacy_dump.py                             (pre-existing, abandoned spaCy track)
?? src/features/grammar/domain/sentenceCoreSet.ts                     (pre-existing, unrelated)
?? src/features/grammar/domain/stanzaStructureTree.ts                 (new, G2)
?? tests/grammar/sentenceCoreSet.test.ts                              (pre-existing, unrelated)
?? tests/grammar/stanzaStructureTree.test.ts                          (new, G2)
?? tests/grammar/stanzaStructureTreeRegression.test.ts                (new, G2)
```

Nothing committed, tagged, or pushed beyond the G1 checkpoint (`365fa8b`).

## AE. Known limitations / next UI phase

- **Basic Skeleton stays single-core** (item 19, intentional) — a sentence with a coordinated
  main predicate shows only the first predicate in Basic Skeleton while Tree shows all of
  them. A future UI phase should reconcile this.
- **PredicateStructure/ReadingGuide LLM calls still fire even when unused for Tree** on the
  Stanza-authority path (AB) — a cleanup opportunity, not a correctness issue.
- **Enumeration decomposition is best-effort**: when a colon/semicolon list's items are
  reachable only through a nested dependency chain the current heuristic doesn't walk (e.g. an
  enumeration attached several levels below the object head rather than directly), the whole
  span is kept intact as one 'modifier'/'object' node rather than mis-decomposed — matching the
  explicit "generic but correct > detailed but misleading" fallback principle (item 13), but
  meaning some real sentences' numbered lists may not get individually-numbered
  `enumeration` children. Not detected as a failure by the 96-case regression (no hard gate
  requires enumeration decomposition specifically), but worth watching during live acceptance.
- **No browser-driven UI automation** was available in this environment — verified instead via
  direct production-code invocation against the live Docker service, reproducing the exact
  reported live bug fix end-to-end. Full visual/interaction acceptance (clicking Tree nodes,
  confirming ReadingGuide panel behavior, confirming Vocabulary/Expression persistence
  visually) still requires the user's own browser review, as instructed (item 30) — this
  report does not claim that verification was performed.
- **9.41GB Stanza image** (unchanged from G1, not optimized, per standing instruction).

---

## Final decision

**HIERARCHICAL_STANZA_TREE_READY_FOR_LIVE_ACCEPTANCE**

Rationale: the exact live regression reported by the user (`for the mapping of landslide
susceptibility` mislabeled 目的語) is verified fixed end-to-end through real production code
against the live Docker service; the shared-subject-coordination hard case (item 5) produces
precisely the required sibling shape with zero nesting-under-complement; all 96 frozen
regression-corpus sentences pass every hard gate (lexical loss, visible duplication, canonical
predicate/O/C fidelity, subordinate leakage) with zero failures; B4's authority-vs-presentation
discipline and B6's reading-target derivation both work with the new Tree using their
**existing, unmodified** mechanisms, confirming the new builder is a faithful citizen of the
established architecture rather than a parallel system; the legacy Tree path remains completely
intact and byte-unchanged as the explicit, non-pretending fallback; and every item in the
"strictly out of scope" list (Stanza parser, blind gold, Basic Skeleton multi-core UI, lexical
parser-error hacks, ReadingGuide redesign, other-parser comparison, tag, push) was left
untouched. Full visual browser acceptance by the user is the remaining, explicitly-required
step before this can be called final.
