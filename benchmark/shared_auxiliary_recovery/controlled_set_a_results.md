# Set A — Controlled Challenge Set (20 sentences, 27 evaluated conjunct pairs)

Gold labels are manually specified (grammar judgment, never derived from Stanza/spaCy/an
LLM), per section 9's human-gold policy. `Main aux (Stanza)` / `Main aux (spaCy)` are the
main predicate's own grounded auxiliary chain; `Match?` is whether that tagger's own later
VerbForm equals the main predicate's own VerbForm (the exact production P0 rule, replicated
per-tagger for spaCy in the P1 column).

## POSITIVE — passive

| id | sentence | later conjunct(s) | gold | Stanza main/later VerbForm | P0 (Stanza-only) | spaCy main/later VerbForm | spaCy-supports-Part? |
|---|---|---|---|---|---|---|---|
| POS_passive1 | The data were collected and analyzed. | analyzed | SHARED | Part/Part | SHARED (TP) | Part/Part | yes |
| POS_passive2 | The concentrations were measured and recorded. | recorded | SHARED | Part/Part | SHARED (TP) | Part/Part | yes |
| POS_passive3 | The voltage was calculated and normalized. | normalized | SHARED | Part/Part | SHARED (TP) | Part/Part | yes |
| POS_passive_multi | The data were collected, converted, and cropped. | converted | SHARED | Part/Part | SHARED (TP) | Part/**Fin** | **no** |
| POS_passive_multi | (same) | cropped | SHARED | Part/Part | SHARED (TP) | Part/**Fin** | **no** |
| POS_passive_multi4 | The data were collected, filtered, normalized, and analyzed. | filtered | SHARED | Part/Part | SHARED (TP) | Part/Part | yes |
| POS_passive_multi4 | (same) | normalized | SHARED | Part/Part | SHARED (TP) | Part/Part | yes |
| POS_passive_multi4 | (same) | analyzed | SHARED | Part/Part | SHARED (TP) | Part/Part | yes |

**Finding:** on the 3-conjunct "collected, converted, and cropped" construction —
structurally the closest analog to the real production target — Stanza is fully correct
(Part/Part/Part) while spaCy independently mistags **both** later conjuncts as finite. This
is not merely "spaCy fails to help"; on this exact construction shape spaCy is *less*
accurate than the system already in production.

## POSITIVE — perfect

| id | sentence | later | gold | Stanza | P0 | spaCy | spaCy-supports? |
|---|---|---|---|---|---|---|---|
| POS_perfect1 | The researchers have collected and analyzed the samples. | analyzed | SHARED | Part/Part | SHARED (TP) | Part/**Fin** | **no** |
| POS_perfect2 | The method has been tested and validated. | validated | SHARED | Part/Part | SHARED (TP) | Part/Part | yes |

## POSITIVE — modal

| id | sentence | later | gold | Stanza | P0 | spaCy | spaCy-supports? |
|---|---|---|---|---|---|---|---|
| POS_modal1 | The method can collect and analyze the data. | analyze | SHARED | Inf/Inf | SHARED (TP) | Inf/Inf | yes |
| POS_modal2 | The method can be applied and extended. | extended | SHARED | Part/Part | SHARED (TP) | Part/Part | yes |
| POS_modal3 | The results should be measured and reported. | reported | SHARED | Part/Part | SHARED (TP) | Part/Part | yes |

## POSITIVE — long-distance (the motivating class)

| id | sentence | later | gold | Stanza | P0 | spaCy | spaCy-supports? |
|---|---|---|---|---|---|---|---|
| POS_longdist1 | ...collected and then converted to the same coordinate system and cropped to the boundary. | converted | SHARED | Part/Part | SHARED (TP) | Part/**Fin** | **no** |
| POS_longdist1 | (same) | cropped | SHARED | Part/**Fin** | **ABSTAIN (FN)** | Part/**Fin** | **no** |
| POS_longdist_full | full live target sentence | converted | SHARED | Part/Part | SHARED (TP) | Part/**Fin** | **no** |
| POS_longdist_full | (same) | **cropped** | SHARED | Part/**Fin** | **ABSTAIN (FN)** | Part/**Fin** | **no** |

**This is the decisive result.** For the exact motivating case, spaCy does not
independently support the participle reading either — it agrees with Stanza's mistake, not
correcting it. A `P1` rescue policy that only fires when a second tagger *positively*
supports the required form therefore **cannot recover `cropped`**, in either phrasing
tested.

## NEGATIVE

| id | sentence | later | gold | Stanza | P0 | spaCy | spaCy-supports? |
|---|---|---|---|---|---|---|---|
| NEG_finite1 | She has visited Paris and lives in London. | lives | NOT_SHARED | Part/Fin | ABSTAIN (TN) | Part/Fin | no (correctly) |
| NEG_finite2 | The system was tested and works well. | works | NOT_SHARED | Part/Fin | ABSTAIN (TN) | Part/Fin | no (correctly) |
| NEG_finite3 | He is running and sings loudly. | sings | NOT_SHARED | Part/Fin | ABSTAIN (TN) | Part/Fin | no (correctly) |
| NEG_finite4 | He has finished the experiment and will write the paper. | write | NOT_SHARED | own-aux (structural abstain, VerbForm never consulted) | ABSTAIN (TN) | own-aux (`will`) | excluded from P1 by structural precondition |

All four negatives correctly abstain under both P0 and hypothetical P1 — spaCy never
disagrees with Stanza in the direction that would create a false positive here.

## AMBIGUOUS

| id | sentence | later | gold | Stanza | P0 | spaCy | spaCy-supports? |
|---|---|---|---|---|---|---|---|
| AMBIG1 | The system was tested and failed. | failed | AMBIGUOUS | Part/Fin | ABSTAIN (safe) | Part/Fin | no (correctly) |
| AMBIG2 | The sample was heated and expanded. | expanded | AMBIGUOUS | Part/**Part** | **SHARED** (pre-existing P0 gap, unrelated to spaCy) | Part/Part | yes (would not have prevented this) |
| AMBIG3 | The pressure was measured and increased. | increased | AMBIGUOUS | Part/**Part** | **SHARED** (pre-existing P0 gap, unrelated to spaCy) | Part/Part | yes (would not have prevented this) |
| AMBIG4 | The condition has changed and remains unstable. | remains | AMBIGUOUS | Part/Fin | ABSTAIN (safe) | Part/Fin | no (correctly) |

**Side finding, out of this benchmark's scope but worth recording:** AMBIG2/AMBIG3 show
that current production P0 *already* confidently shares in two genuinely ambiguous
constructions ("was heated and expanded", "was measured and increased") because Stanza
itself tags both readings as compatible participles. This is a pre-existing characteristic
of the accepted C6A criterion, not something spaCy consultation could have prevented (spaCy
agrees with Stanza here too) or something this benchmark was asked to fix. Recorded for a
future phase, not acted on here.

## Metrics (27 evaluated conjunct pairs; SHARED vs NOT_SHARED reviewed subset = 21 pairs, excluding the 4 AMBIGUOUS + accounting for the "own-aux" NEG case separately)

- **P0 (production baseline):** TP=15, FN=2 (`cropped` × 2 phrasings, same underlying word/construction), FP=0, TN=4.
  Precision = 100%, Recall = 15/17 = 88.2%, Specificity = 100%.
- **P1 (spaCy rescue, fires only on Stanza-abstain cases where spaCy positively supports the required VerbForm):**
  TP=15 (unchanged — P1 never touches an already-successful P0 decision), **FN=2 (unchanged — 0 rescues)**, FP=0 (unchanged), TN=4 (unchanged).
- **RECOVERY_PRECISION:** 0/0 — undefined (P1 attempted zero rescues on this benchmark; spaCy never positively supported the required form on any P0-abstain case).
- **RECOVERY_COUNT (genuine Stanza false negatives recovered):** 0.
- **AMBIGUOUS_RECOVERY_COUNT (P1 confidently resolving an AMBIGUOUS-gold case):** 0 (P1 never fires on the AMBIGUOUS set either — spaCy's own tags for AMBIG1/AMBIG4 don't support rescue, and AMBIG2/AMBIG3 were already resolved by P0 alone before P1 is ever consulted).
- **`cropped` (primary target), both phrasings:** NOT recovered. spaCy tags it `VBD`/`VerbForm=Fin`, matching Stanza's own mistake.

## Context sensitivity (short vs long, both taggers)

| Construction | Stanza | spaCy |
|---|---|---|
| "...collected, converted, and cropped." (short, no PP) | Part/Part/Part (correct) | Part/**Fin**/**Fin** (wrong on 2/3) |
| "...collected and then converted to the same coordinate system and cropped to the boundary [...]." (long, PP-laden) | Part/**Fin** (wrong on cropped only) | Part/**Fin**/**Fin** (wrong on both) |

Both taggers show *some* long-distance/PP-attachment sensitivity, but spaCy's degradation is
broader and appears even on the shorter, PP-free 3-conjunct list where Stanza is fully
correct — weakening rather than strengthening the case for using spaCy as a rescue signal in
this domain.
