# Prototype 2.6F — Hierarchical Stanza Adapter Spike

Scope: benchmark-only. No production/UI/Tree/ReadingGuide/Docker changes. No new blind holdout.
No commit/tag/push (report content only — the actual freeze commit is a separate, later action).

## B. Formal flat-adapter baseline (development 48, no new Stanza inference)

| metric | value |
|---|---|
| subject exact | 93.8% (45/48) |
| predicate count exact | 95.8% (46/48) |
| per-core V | 95.1% (58/61) |
| per-core O | 96.7% (59/61) |
| per-core C | 90.2% (55/61) |
| per-core pattern | 86.9% (53/61) |
| false-C | 0.0% (0/51) |
| **whole core-set exact** | **79.2% (38/48)** |

Former-holdout-24 flat baseline (re-derived from the already-saved raw artifact, no new parse):

| metric | value |
|---|---|
| subject exact | 91.7% (22/24) |
| predicate count exact | 95.8% (23/24) |
| per-core V | 86.1% (31/36) |
| per-core O | 75.0% (27/36) |
| per-core C | 88.9% (32/36) |
| per-core pattern | 86.1% (31/36) |
| false-C | 0.0% (0/30) |
| **whole core-set exact** | **66.7% (16/24)** |

## C. What "79.2% (38/48)" was

It is the **development whole-core-set-exact rate of the frozen flat adapter** — the fraction of
the 48 development sentences (38 of them) for which the flat `SentenceCoreSet` matched gold on
*every* per-core field simultaneously (subject, verb, indirect object, object, complement,
pattern, relation, connector, for every predicate core in the sentence). It is not a holdout
number, not a single-slot accuracy, and not an average of the other rows — it is the strictest,
whole-sentence pass/fail rate on development only. Not to be confused with the former-holdout
flat baseline (66.7%, 16/24) reported above.

## D. ClauseFrame schema (implemented)

```ts
type ClauseRelation = 'main' | 'subordinate' | 'coordinated' | 'relative' | 'other'

interface ClauseFrame {
  clauseId: number            // = the clause head token's id
  relation: ClauseRelation
  headTokenId: number
  parentClauseId: number | null
  marker: ParsedToken | null  // this clause's own `mark` child token, if any
  predicateHeadIds: number[]  // this clause's own head + its pure-conj coordination chain
}
```

## E. PredicateFrame schema (implemented)

```ts
interface PredicateFrame {
  predicateId: number
  clauseId: number
  relation: PredicateCoreRelation   // 'main' | 'coordinated' (position within the clause)
  headToken: ParsedToken
  aux: ParsedToken[]
  auxPass: ParsedToken[]
  cop: ParsedToken[]
  subjToken: ParsedToken | null
  objToken: ParsedToken | null
  iobjToken: ParsedToken | null
  xcompToken: ParsedToken | null
  ccompToken: ParsedToken | null
}
```

S/V/O/C is derived from this frame in a separate `convertPredicateFrame` step (never mapping a UD
relation straight to a 5-pattern slot).

## F. Clause detection logic

A token starts a new `ClauseFrame` iff its (normalized) deprel is in
`{root, advcl, acl, ccomp, csubj, parataxis}` **and** it is predicate-like (`VERB`/`AUX`, or an
`ADJ`/`NOUN`/`PROPN` root that has its own `cop` child). `xcomp` is deliberately excluded from
clause-starting deprels — an xcomp has no subject of its own in UD, so it is folded into the
governing `PredicateFrame` instead of becoming a clause (section 7). `ccomp` *is* registered as
its own clause (to protect its internal coordination scope) but is folded back into the governing
predicate's object slot as one grounded span rather than exploded into a nested S/V/O.

Relation labels: `root` → main; `advcl` → subordinate; `acl:relcl` → relative; plain `acl`/`ccomp`/
`csubj`/`parataxis` → other.

## G. Predicate-coordination scope logic

Within one clause head H, `collectCoordinatedPredicates(H)` walks *only* `conj`-labelled,
predicate-like children, transitively, and stops the moment a candidate's own deprel is itself a
clause-starting deprel (that candidate becomes its own `ClauseFrame`, parented to H, instead of a
sibling predicate). This is the fix for "Because A omits X and contains Y, the model combines P,
assigns Q, and reports R" leakage: `contain` (parataxis/conj-in-subordinate) never enters the main
clause's `predicateHeadIds` at all.

One further, general, punctuation-based (not lexical) rule was required: a `conj` child reached
**across a semicolon** is excluded from the coordination chain even when it is a *direct* conj
child of the clause head (e.g. "followed four steps: A were dried; B were recorded; ... and D were
assigned" — "assigned" attaches directly via `conj` to the root, indistinguishable from true
root-level coordination on dependency labels alone; the semicolon in the gap is the only general
signal UD leaves for "this is a colon-introduced enumeration item, not a further coordinated
action of the subject"). Dependency-ancestry alone could not resolve this case; **this is reported
per the spec rather than solved by any case-ID or lexical branch.**

## H. Copula handling

Unchanged in spirit from the flat adapter, reimplemented on `PredicateFrame`: when `cop.length > 0`,
V = cop(+aux) tokens only (never the lexical head), C = the lexical head's own constituent, with
`nsubj`/`csubj`/`cop` excluded from that constituent walk (a copula's subject attaches to the
*lexical head*, not to the copula, in UD — an early bug in this spike let a copular complement
swallow its own subject and its own coordinated sibling predicate; both are now excluded by
construction, see J).

## I. Lexical-linking / xcomp handling policy

`xcomp` is folded into C **only** when the open complement's own head UPOS is `ADJ`/`NOUN`/`PROPN`
— i.e. it is a predicative phrase (lexical linking verb: remain/become/appear + ADJ; or an
object-complement small clause: deem/find/consider + NP + ADJ, C attached alongside an `obj`
sibling). A **VERB-headed** `xcomp` (catenative "began/tried/wanted to VERB") is left unmapped —
it is a different, non-5-pattern construction and is not forced into C. `xcomp = always C` was not
implemented, per the explicit prohibition. `ccomp` is never mapped to C; it fills O as one whole
grounded span (matches gold's existing "noun clause as object" policy). `iobj` is wired directly to
indirect-object (previously hardcoded null in the flat adapter).

## J. Subject span policy

`collectConstituentTokens` walks the subject head's dependents with an **allowlist-by-exclusion**
approach: `punct` is never walked into directly (balanced-delimiter pass reattaches it, see L);
`appos`/`parataxis` are excluded as non-restrictive **unless** the appos child itself has its own
`case` child (meaning Stanza attached what is structurally a PP as `appos` instead of `nmod` — kept,
same as any other PP); `acl`/`advcl` are excluded only when comma-delimited from the head
(non-restrictive), and kept otherwise (restrictive: "stations *that recorded* ...", "network
*trained on* ..." both stay in the subject, matching established gold convention); postnominal
`amod` is excluded and reattached as a complement candidate instead of an NP-internal modifier.
A separate `boundaryIds` set (the clause's own coordinated predicate-head ids) stops any
constituent walk from reaching across `conj` into a sibling predicate.

## K. Object span policy

Same `collectConstituentTokens` allowlist as the subject, applied to the `obj`/`iobj` head. One
open, **UD-undecidable** case was found and is reported rather than patched: a trailing
participial/PP modifier attached via `acl`/`nmod` **directly to the object head noun** (not to the
verb) is structurally identical, on dependency labels alone, to a legitimate restrictive NP
postmodifier that must stay in the object (same relation, same lack of comma). Example (former
h19): "recalibrated **rainfall thresholds** `acl`→ *using five years of gauge observations*" —
Stanza attaches the instrumental participial phrase to the object noun, not the verb, with the
exact same `acl`/no-comma shape as a genuine restrictive postmodifier (former h08's "network
`acl`→ *trained on multispectral patches*", which gold explicitly wants **kept**). No general
dependency-only rule can tell these apart; resolving it would require lexical/valency knowledge
(which participles denote manner/instrument vs. defining property) that is out of scope for this
spike. **Left unresolved and reported, not patched.**

## L. Delimiter policy

Generic bracket-matching over `() [] {}`, not tied to any literal string: after a constituent's
token span is computed as `[min(start), max(end)]`, `balanceDelimiters` scans the resulting slice;
if it contains an unmatched opener, the span is extended forward to that opener's matching closer
(bounded lookahead). This fixed h16 ("[式 (7)]" no longer truncates to "...(7"), verified via direct
token-level trace, and the sentence-wide `delimiterCorruption` diagnostic is 0 on both splits under
the hierarchical spike.

## M/N. Development: flat vs. hierarchical

| metric | flat | hierarchical |
|---|---|---|
| subject exact | 93.8% (45/48) | 93.8% (45/48) |
| predicate count exact | 95.8% (46/48) | **97.9% (47/48)** |
| per-core V | 95.1% (58/61) | **96.7% (59/61)** |
| per-core O | 96.7% (59/61) | **98.4% (60/61)** |
| per-core C | 90.2% (55/61) | **96.7% (59/61)** |
| per-core pattern | 86.9% (53/61) | **98.4% (60/61)** |
| false-C | 0.0% (0/51) | 0.0% (0/51) |
| **whole core-set exact** | 79.2% (38/48) | **91.7% (44/48)** |

## O/P. Former holdout (24): flat vs. hierarchical

| metric | flat | hierarchical |
|---|---|---|
| subject exact | 91.7% (22/24) | **100.0% (24/24)** |
| predicate count exact | 95.8% (23/24) | 91.7% (22/24) *(see note)* |
| per-core V | 86.1% (31/36) | **88.9% (32/36)** |
| per-core O | 75.0% (27/36) | **77.8% (28/36)** |
| per-core C | 88.9% (32/36) | **100.0% (36/36)** |
| per-core pattern | 86.1% (31/36) | **94.4% (34/36)** |
| false-C | 0.0% (0/30) | 0.0% (0/30) |
| **whole core-set exact** | 66.7% (16/24) | **87.5% (21/24)** |

Note on predicate-count: the one new count miss is h20 — clause-scoping now correctly excludes the
leaked subordinate-clause verb, but on this 80+ word, 8-clause sentence Stanza's own conj-chain for
the main clause does not cleanly reach a 4th coordinate verb ("estimates"); 3 of 4 main-clause
predicates are recovered with fully correct verb/object spans (previously 0 of 4 were correct —
subject, verbs and objects were all scrambled under the flat adapter).

## Q. Subordinate predicate leakage: before / after

- **Flat**: 1 confirmed instance (former h20 — "contain", a `conj` verb inside the subordinate
  "Because ... omits X and contains Y" clause, was pulled into the top-level predicate array,
  scrambling subject/verb/object alignment for the whole sentence).
- **Hierarchical**: 0 instances on both splits. Verified directly: h20's main-clause cores no
  longer contain "contain" at all.

## R. Fixed case IDs (flat-failing → hierarchical-passing, no case-specific code)

- Development (6): `d03-simple-svc`, `d22-although`, `d25-when`, `d36-passive-true-svc`,
  `d38-svoo`, `d39-clause-object`.
- Former holdout (5): `h05-stacked-pp`, `h06-svc-svc`, `h07-svc-passive`,
  `h12-subordinate-coordination`, `h16-equation`.

## S. Newly broken case IDs

**None**, on either split, in the final state of this spike.

## T. Remaining TRUE_STANZA_PARSE_ERROR (untouched, as instructed)

- `d15-svc-svc-coordination`, `d23-whereas`, `d43-coordinated-clauses`, `d34-long-80`,
  `h10-three-predicates`.

## U. Remaining GENERAL_ADAPTER_ERROR (UD-undecidable, reported not patched)

- `h19-long-50`, `h20-long-80` — see sections K and M/N.

## V/W. false-C and whole-core-set-exact: before / after

false-C: development 0/51 → 0/51; former holdout 0/30 → 0/30 (unchanged both splits).
Whole core-set exact: development 79.2% (38/48) → 91.7% (44/48); former holdout 66.7% (16/24) →
87.5% (21/24).

## Decision

**HIERARCHICAL_STANZA_ADAPTER_READY_FOR_FREEZE**
