"""Prototype 2.6G2.8M1.2 -- OCR anchor typography normalization.

Live-traced real defect: native PyMuPDF text uses a typographic apostrophe
("object’s", U+2019) while Paddle OCR's own output uses a plain ASCII apostrophe
("object's", U+0027) for the SAME word. NFKC does not canonicalize these (they are not
compatibility-equivalent), so an otherwise-correct, high-confidence OCR recovery
("cos i", 0.9975 confidence) was silently discarded by `_recover_gap_text`'s anchor
search, purely because of this typography mismatch -- not a math-recognition failure at all.

`_normalize_for_match` now folds typographic single/double quote variants to their ASCII
form for COMPARISON ONLY -- never applied to reconstructedText, native trusted text, or any
OCR text actually stored for diagnostics.
"""

from main import _normalize_for_match, _recover_gap_text


class TestNormalizeForMatchQuoteFolding:
    def test_typographic_single_quote_matches_ascii_apostrophe(self):
        assert _normalize_for_match("object’s") == _normalize_for_match("object's")

    def test_left_and_right_single_quotation_marks_both_fold(self):
        assert _normalize_for_match("‘value’") == _normalize_for_match("'value'")

    def test_typographic_double_quote_matches_ascii_double_quote(self):
        assert _normalize_for_match("“value”") == _normalize_for_match('"value"')

    def test_single_quote_class_never_matches_double_quote_class(self):
        assert _normalize_for_match("'value'") != _normalize_for_match('"value"')
        assert _normalize_for_match("‘value’") != _normalize_for_match("“value”")

    def test_source_typography_is_never_rewritten_by_the_normalizer_itself(self):
        # _normalize_for_match returns its OWN normalized copy for comparison -- callers
        # must never substitute this back into reconstructedText. This test only guards
        # the function's own return value is the folded copy, not a claim about callers.
        assert _normalize_for_match("object’s") == "object's"
        # The typographic original is untouched by anything else in this module.

    def test_ligature_and_quote_folding_compose(self):
        assert _normalize_for_match("oﬃce’s") == _normalize_for_match("office's")


class TestRecoverGapTextWithQuoteAnchors:
    def test_left_anchor_curly_apostrophe_ocr_ascii_apostrophe_recovers(self):
        left_anchor = "data makes an object’s radiance independent of"
        right_anchor = ". As a re-"
        ocr_text = "data makes an object's radiance independent of cos i. As a re-"
        recovered = _recover_gap_text(left_anchor, right_anchor, ocr_text)
        assert recovered.text == "cos i"

    def test_reverse_direction_left_anchor_ascii_ocr_curly(self):
        left_anchor = "data makes an object's radiance independent of"
        right_anchor = ". As a re-"
        ocr_text = "data makes an object’s radiance independent of cos i. As a re-"
        recovered = _recover_gap_text(left_anchor, right_anchor, ocr_text)
        assert recovered.text == "cos i"

    def test_without_the_fix_this_would_have_failed_sanity_check(self):
        # Documents the exact live-traced failure this phase fixes -- if quote folding were
        # ever removed, this assertion would fail, catching a regression immediately.
        left_anchor = "data makes an object’s radiance independent of"
        right_anchor = ". As a re-"
        ocr_text = "data makes an object's radiance independent of cos i. As a re-"
        assert _normalize_for_match(left_anchor) in _normalize_for_match(ocr_text)


class TestRecoveredFragmentBoundarySpacing:
    """Prototype 2.6G2.8M1.2a -- CONTENT and BOUNDARY SPACING are separate evidence.
    `_recover_gap_text` must never strip a genuine OCR-observed separator, and must never
    fabricate one that OCR didn't show. Both directions are required contrast cases (item 7):
    a real word gap ("of" + "cos i") needs a preserved separator; a symbol that visually
    touches its neighbor ("90" + "°") must never gain a fabricated one."""

    def test_real_word_gap_preserves_a_single_leading_separator(self):
        recovered = _recover_gap_text("independent of", ". As a re-", "independent of cos i. As a re-")
        assert recovered.text == "cos i"
        assert recovered.leading_separator == " "

    def test_symbol_touching_its_neighbor_has_no_leading_separator(self):
        # The "90"+"degree" case: OCR reads the symbol immediately after "90", no gap.
        recovered = _recover_gap_text("angle approaches 90", ". In several studies", "angle approaches 90°. In several studies")
        assert recovered.text == "°"
        assert recovered.leading_separator == ""

    def test_symbol_touching_a_variable_has_no_leading_separator(self):
        # Note: a genuinely superscript digit (e.g. "²") is NOT used as this fixture --
        # `_normalize_for_match`'s own NFKC pass compatibility-decomposes "²" to plain "2"
        # (pre-existing behavior, unrelated to this phase's separator fix; NFKC leaves "°"
        # and other standalone symbols alone). Flagged in this phase's report as a separate,
        # out-of-scope finding rather than fixed here.
        recovered = _recover_gap_text("area is m", ", which is a", "area is m°, which is a")
        assert recovered.text == "°"
        assert recovered.leading_separator == ""

    def test_recovered_symbol_immediately_before_punctuation_has_no_trailing_separator(self):
        recovered = _recover_gap_text("angle approaches 90", ". In several studies", "angle approaches 90°. In several studies")
        assert recovered.trailing_separator == ""

    def test_ordinary_recovered_word_between_two_real_word_gaps(self):
        recovered = _recover_gap_text("the value of", "can then be used", "the value of k can then be used")
        assert recovered.text == "k"
        assert recovered.leading_separator == " "
        assert recovered.trailing_separator == " "

    def test_never_fabricates_a_separator_the_ocr_text_did_not_show(self):
        # OCR shows the recovered content touching BOTH neighbors -- no separator on either
        # side must ever be invented.
        recovered = _recover_gap_text("x", "is the symbol", "x°is the symbol")
        assert recovered.text == "°"
        assert recovered.leading_separator == ""
        assert recovered.trailing_separator == ""
