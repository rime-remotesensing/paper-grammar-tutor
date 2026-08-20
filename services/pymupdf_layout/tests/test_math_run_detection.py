"""Prototype 2.6G2.8M2 -- Structured Prose/Math Segmentation Foundation.

Pure, text-level, STRONG-evidence-only math-run detection (`_detect_math_runs`/
`_classify_math_token`/`_build_fragment`). Deliberately does NOT use font/flag-based
evidence (only available earlier, per-span, inside `_extract_page_blocks`) -- this trades
away some detection power for the ability to run uniformly across every text-producing
branch of `/layout/selection`. See main.py's own module-level doc comment for the full
architecture rationale, and the M2 report for an honest accounting of what this pass does
and does not detect.
"""

from main import _build_fragment, _classify_math_token, _detect_math_runs


def _runs_text(text: str) -> list[str]:
    return [text[s:e] for s, e in _detect_math_runs(text)]


class TestClassifyMathToken:
    def test_evidence_operators(self):
        for tok in ["=", "<", ">", "≤", "≥", "≠", "≈", "±", "×", "·", "°"]:
            assert _classify_math_token(tok) == "EVIDENCE"

    def test_evidence_greek_letters(self):
        assert _classify_math_token("α") == "EVIDENCE"
        assert _classify_math_token("β") == "EVIDENCE"
        assert _classify_math_token("θ") == "EVIDENCE"
        assert _classify_math_token("Δ") == "EVIDENCE"

    def test_evidence_superscript_digit(self):
        assert _classify_math_token("m²") == "EVIDENCE"
        assert _classify_math_token("²") == "EVIDENCE"

    def test_evidence_subscript_underscore(self):
        assert _classify_math_token("x_i") == "EVIDENCE"
        assert _classify_math_token("x_i²") == "EVIDENCE"

    def test_numeric_tokens(self):
        assert _classify_math_token("200,000") == "NUMERIC"
        assert _classify_math_token("0.5") == "NUMERIC"
        assert _classify_math_token("0.3,") == "NUMERIC"
        assert _classify_math_token("10.") == "NUMERIC"  # trailing-period stem check

    def test_symbol_token(self):
        assert _classify_math_token("+") == "SYMBOL"

    def test_single_letter_token(self):
        assert _classify_math_token("k") == "SINGLE_LETTER"
        assert _classify_math_token("a") == "SINGLE_LETTER"
        assert _classify_math_token("R") == "SINGLE_LETTER"

    def test_allcaps_identifier_token(self):
        assert _classify_math_token("NDVI") == "ALLCAPS_IDENTIFIER"
        assert _classify_math_token("SUM") == "ALLCAPS_IDENTIFIER"

    def test_ordinary_prose_word(self):
        for tok in ["The", "value", "cos", "sin", "and", "et", "al."]:
            assert _classify_math_token(tok) == "PROSE", tok

    def test_citation_bracket_is_prose_not_evidence(self):
        assert _classify_math_token("[9]") == "PROSE"


class TestDetectMathRunsRealCorpus:
    """Item 13's mandatory real cases (source text, post D1/D2/D3 recovery)."""

    def test_bare_k_in_ordinary_prose_is_not_detected(self):
        # Honest limitation (never claimed otherwise): a bare single letter carries no
        # positive evidence by itself -- D1's real "k" recovery is a native-ink-mismatch
        # (UNOWNED_MATH_INK) case, a different evidence category not wired into this
        # text-only pass yet.
        assert _runs_text("In the case of lower k values, the denominator is increased.") == []

    def test_degree_symbol_is_detected(self):
        text = "the incidence angle approaches 90°."
        assert _runs_text(text) == ["90°"]

    def test_cos_i_is_not_detected_from_bare_text(self):
        # Matches M1.1's own honest finding: neither "cos" (ordinary prose word) nor "i"
        # (a bare single letter) carries positive evidence on its own -- this is NOT a
        # "cos" keyword rule (there isn't one); it is the absence of any evidence at all.
        assert _runs_text("radiance independent of cos i.") == []

    def test_parameter_sentence_splits_at_the_prose_conjunction_and(self):
        text = "t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10."
        runs = _runs_text(text)
        # "and" is genuine, ordinary English prose -- bridging OVER it would require a
        # clause-continuation heuristic bordering on the semantic reconstruction this phase
        # explicitly forbids. Two adjacent runs, split at the natural "and" boundary, is the
        # honest, conservative result -- reported as such, not silently merged.
        assert runs == ["t = 200,000 m², a = 5,000 m², c = 0.3,", "r = 10"]

    def test_each_of_the_four_assignments_is_covered_independently(self):
        # Item 15's own requirement: verify all four independently.
        text = "t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10."
        runs = _detect_math_runs(text)
        combined = " ".join(text[s:e] for s, e in runs)
        for fragment in ["t = 200,000 m²", "a = 5,000 m²", "c = 0.3", "r = 10"]:
            assert fragment in combined, fragment


class TestDetectMathRunsSyntheticMatrix:
    """Item 14's mandatory synthetic coverage matrix."""

    def test_k_equals_0_5(self):
        assert _runs_text("k = 0.5") == ["k = 0.5"]

    def test_k_less_than_0_5(self):
        assert _runs_text("k < 0.5") == ["k < 0.5"]

    def test_k_greater_than_0_5(self):
        assert _runs_text("k > 0.5") == ["k > 0.5"]

    def test_k_le_0_5(self):
        assert _runs_text("k ≤ 0.5") == ["k ≤ 0.5"]

    def test_k_ge_0_5(self):
        assert _runs_text("k ≥ 0.5") == ["k ≥ 0.5"]

    def test_0_lt_k_lt_1(self):
        assert _runs_text("0 < k < 1") == ["0 < k < 1"]

    def test_0_le_ndvi_le_1_bridges_the_allcaps_identifier(self):
        assert _runs_text("0 ≤ NDVI ≤ 1") == ["0 ≤ NDVI ≤ 1"]

    def test_r2_ge_0_8(self):
        assert _runs_text("R² ≥ 0.8") == ["R² ≥ 0.8"]

    def test_temperature_with_plusminus_and_unit(self):
        assert _runs_text("T = 300 ± 2 K") == ["T = 300 ± 2 K"]

    def test_alpha_plus_beta_bridges_the_bare_symbol(self):
        assert _runs_text("α + β") == ["α + β"]

    def test_sin_theta_only_detects_the_symbol_not_the_function_name(self):
        # Honest, reported limitation (M1.1 flagged this as unproven; still unproven here).
        assert _runs_text("sin θ") == ["θ"]

    def test_cos_i_synthetic_matches_real_corpus_non_detection(self):
        assert _runs_text("cos i") == []

    def test_x_squared(self):
        assert _runs_text("x²") == ["x²"]

    def test_x_cubed(self):
        assert _runs_text("x³") == ["x³"]

    def test_x_subscript_i(self):
        assert _runs_text("x_i") == ["x_i"]

    def test_x_subscript_i_squared(self):
        assert _runs_text("x_i²") == ["x_i²"]


class TestNegativeProseControls:
    """Item 3's required negative controls -- none of these may ever become a MathRun."""

    def test_et_al(self):
        assert _runs_text("as shown by Smith et al. in the prior study.") == []

    def test_species_name_italic_text_is_unaffected_by_this_text_only_pass(self):
        # This pass has no font/style information at all -- italic emphasis alone can never
        # seed a run (trivially satisfies "weak evidence alone must never seed").
        assert _runs_text("the species Homo sapiens was observed.") == []

    def test_ordinary_bold_emphasis_text(self):
        assert _runs_text("this result is important for the analysis.") == []

    def test_section_heading_fragment(self):
        assert _runs_text("Materials and Methods") == []

    def test_citation_marker(self):
        assert _runs_text("as shown previously [9] in related work.") == []

    def test_ordinary_sentence_with_trailing_number_and_period(self):
        assert _runs_text("the sample size was 10.") == []


class TestSentenceFinalPeriodTrimming:
    def test_period_before_capitalized_next_sentence_is_trimmed(self):
        text = "and r = 10. Eventually, the slope unit map was produced."
        runs = _runs_text(text)
        assert runs == ["r = 10"]
        assert "10." not in runs[0]

    def test_period_at_end_of_text_is_trimmed(self):
        assert _runs_text("the result was k = 5.") == ["k = 5"]

    def test_decimal_period_is_never_trimmed(self):
        assert _runs_text("k = 0.5 was used.") == ["k = 0.5"]


class TestBuildFragmentDisplayVsInline:
    def test_display_equation_placeholder_is_its_own_display_run(self):
        fragment = _build_fragment(1, "using the equation [式 (6)] where Ln is defined")
        display_runs = [r for r in fragment.mathRuns if r.classification == "display"]
        assert len(display_runs) == 1
        assert display_runs[0].text == "[式 (6)]"

    def test_inline_run_never_overlaps_a_display_run(self):
        # "6" inside the placeholder must never ALSO be picked up as inline evidence.
        fragment = _build_fragment(1, "the equation [式 (6)]")
        for run in fragment.mathRuns:
            if run.classification == "inline":
                assert "式" not in run.text

    def test_fragment_text_is_never_modified_by_detection(self):
        text = "t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10."
        fragment = _build_fragment(1, text)
        assert fragment.text == text

    def test_no_math_evidence_produces_empty_math_runs(self):
        fragment = _build_fragment(1, "This is an ordinary sentence with no scientific content.")
        assert fragment.mathRuns == []

    def test_math_run_records_carry_the_exact_source_offsets(self):
        text = "the value was k = 0.5 in this case."
        fragment = _build_fragment(1, text)
        assert len(fragment.mathRuns) == 1
        run = fragment.mathRuns[0]
        assert text[run.start : run.end] == run.text == "k = 0.5"
