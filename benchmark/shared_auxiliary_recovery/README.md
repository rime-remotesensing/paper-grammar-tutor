# Prototype 2.6G2.6C7 — Independent Morphology Disagreement Recovery Benchmark

Benchmark-only evaluation of whether spaCy (`en_core_web_sm`) can safely recover the
accepted upstream Stanza morphology false negative documented in C6B (`cropped` in the
full Relevant-data live sentence). **No production code changed.** See the top-level
conversation report for full analysis; this directory holds the raw artifacts.

## Files

- `spacy_controlled_raw.txt` — raw spaCy tag/morph dump (`pos_`, `tag_`, `morph`, `dep_`,
  `head`) for all 20 controlled Set A cases (POS/NEG/AMBIG), produced via the locally
  installed `en_core_web_sm` model (spaCy 3.8.15).
- `find_natural_candidates.mjs` — scans the full 96-sentence frozen corpus
  (`DEVELOPMENT_CASES` + `LOCKED_HOLDOUT_CASES` + `BLIND_HOLDOUT_V2`) via the real Stanza
  service for sentences structurally matching the shared-auxiliary use case (same-subject
  predicate coordination, later conjunct with no own aux/aux:pass, main predicate has a
  shareable aux/aux:pass). Result: **0 natural candidates found** — the corpus was built
  for S/V/O/C extraction accuracy, not predicate-coordination auxiliary sharing, and
  genuinely contains none of this shape.
- `controlled_set_a_results.md` — the full per-case gold/Stanza/spaCy/P0/P1 comparison
  table and computed metrics.

## Headline finding

spaCy (`en_core_web_sm`) does **not** independently support `VerbForm=Part` for the one
motivating case (`cropped` in the long target sentence — spaCy tags it `VBD`/`VerbForm=Fin`,
agreeing with Stanza's own mistake, not correcting it). A conservative "only rescue when
spaCy positively supports the required form" policy therefore recovers **zero** genuine
Stanza false negatives on this benchmark, while also introducing **zero** false positives
(it simply never fires). Separately, spaCy was observed to be actively *less* reliable
than Stanza on other cases in this exact domain (long, PP-laden research-sentence style
predicate coordination) that Stanza already gets right — see the full table.
