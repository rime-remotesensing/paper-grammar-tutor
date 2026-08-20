"""Prototype 2.6G2.8D3 -- SUSPECT_NATIVE classification and recovery.

Live-traced real case: the "=" glyph in "t = 200,000 m2, a = 5,000 m2, ..." decodes, via
PyMuPDF's own dict/rawdict extraction, to U+0002 (a C0 control code) in the "MTSYN" font --
a MathType-style embedded symbol font with no usable ToUnicode mapping for this glyph.
Native geometry stays authoritative for LOCATION; recovery is only ever accepted from a
confident, anchor-bounded, single-character OCR read of a tightly local crop -- never a
guess (never inferring "=" merely because parameter assignments usually use it).

These are pure/mocked tests -- no external fixture PDF or running Paddle service needed,
matching this suite's own established convention (see test_trailing_glyph_recovery.py).
"""

import io

import pymupdf
import pytest

import main
from main import (
    SUPERSCRIPT_CHAR_MAP,
    _apply_superscript_encoding,
    _is_suspect_native_codepoint,
    _recover_suspect_native_char,
    _recover_suspect_native_in_span,
)


class TestIsSuspectNativeCodepoint:
    def test_c0_control_codes_are_suspect(self):
        assert _is_suspect_native_codepoint("\x02") is True  # the real live "=" case
        assert _is_suspect_native_codepoint("\x01") is True
        assert _is_suspect_native_codepoint("\x1f") is True

    def test_c1_control_codes_are_suspect(self):
        assert _is_suspect_native_codepoint("\x7f") is True
        assert _is_suspect_native_codepoint("\x90") is True
        assert _is_suspect_native_codepoint("\x9f") is True

    def test_ordinary_whitespace_controls_are_not_suspect(self):
        for c in ("\t", "\n", "\r", "\x0b", "\x0c", " "):
            assert _is_suspect_native_codepoint(c) is False

    def test_legitimate_scientific_symbols_are_never_suspect(self):
        # Item 5's own explicit non-goal: uncommon != suspicious.
        for c in "αβ≤≥°²³μ×±≠≈":
            assert _is_suspect_native_codepoint(c) is False, f"{c!r} must never be flagged as suspect"

    def test_ordinary_ascii_letters_and_digits_are_not_suspect(self):
        for c in "AbC123=+-.,":
            assert _is_suspect_native_codepoint(c) is False

    def test_multi_character_string_is_not_suspect(self):
        assert _is_suspect_native_codepoint("ab") is False
        assert _is_suspect_native_codepoint("") is False


class TestSuperscriptEncoding:
    def test_superscript_flag_maps_digits(self):
        assert _apply_superscript_encoding("2", 5) == "²"  # flags=5, bit 0 set
        assert _apply_superscript_encoding("3", 5) == "³"

    def test_flag_unset_leaves_digits_unchanged(self):
        assert _apply_superscript_encoding("2", 4) == "2"  # flags=4, bit 0 unset -- the real ordinary "200,000"/"m2" case
        assert _apply_superscript_encoding("200,000", 4) == "200,000"

    def test_never_transforms_baseline_digits_into_superscripts(self):
        # SOURCE_FALSE_INSERTION=0: an ordinary baseline "m2" (flags without the superscript
        # bit) must NEVER become "m²".
        assert _apply_superscript_encoding("m2", 4) == "m2"

    def test_character_with_no_table_entry_is_left_unchanged_even_when_flagged(self):
        assert _apply_superscript_encoding("m", 5) == "m"  # no fabrication for unmapped chars

    def test_every_digit_zero_through_nine_has_a_mapping(self):
        for d in "0123456789":
            assert d in SUPERSCRIPT_CHAR_MAP


class TestRecoverSuspectNativeChar:
    """Exercises `_recover_suspect_native_char` directly, mocking only the two external
    calls it makes (`_render_gap_ink_ratio`, `_call_paddle_ocr`) -- mirrors gap recovery's
    own established test pattern (test_trailing_glyph_recovery.py)."""

    @pytest.fixture
    def blank_doc(self):
        doc = pymupdf.open()
        doc.new_page(width=600, height=800)
        yield doc
        doc.close()

    def test_recovers_exactly_one_confident_anchor_bounded_character(self, blank_doc, monkeypatch):
        monkeypatch.setattr(main, "_render_gap_ink_ratio", lambda *a, **k: 0.2)
        monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png: [{"text": "t = 200,000", "confidence": 0.97}])
        recovered = _recover_suspect_native_char(blank_doc, 1, 600.0, 800.0, (10, 10, 18, 20), "t ", " 200,000")
        assert recovered == "="

    def test_abstains_when_no_ink_present(self, blank_doc, monkeypatch):
        monkeypatch.setattr(main, "_render_gap_ink_ratio", lambda *a, **k: 0.0)

        def _fail_if_called(_png):
            raise AssertionError("OCR must never be called when no ink is present")

        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
        recovered = _recover_suspect_native_char(blank_doc, 1, 600.0, 800.0, (10, 10, 18, 20), "t ", " 200,000")
        assert recovered is None

    def test_abstains_on_low_confidence(self, blank_doc, monkeypatch):
        monkeypatch.setattr(main, "_render_gap_ink_ratio", lambda *a, **k: 0.2)
        monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png: [{"text": "t = 200,000", "confidence": 0.5}])
        recovered = _recover_suspect_native_char(blank_doc, 1, 600.0, 800.0, (10, 10, 18, 20), "t ", " 200,000")
        assert recovered is None

    def test_abstains_when_ocr_unavailable(self, blank_doc, monkeypatch):
        monkeypatch.setattr(main, "_render_gap_ink_ratio", lambda *a, **k: 0.2)
        monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png: None)
        recovered = _recover_suspect_native_char(blank_doc, 1, 600.0, 800.0, (10, 10, 18, 20), "t ", " 200,000")
        assert recovered is None

    def test_abstains_when_anchors_not_found(self, blank_doc, monkeypatch):
        monkeypatch.setattr(main, "_render_gap_ink_ratio", lambda *a, **k: 0.2)
        monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png: [{"text": "completely unrelated text", "confidence": 0.99}])
        recovered = _recover_suspect_native_char(blank_doc, 1, 600.0, 800.0, (10, 10, 18, 20), "t ", " 200,000")
        assert recovered is None

    def test_never_accepts_a_multi_character_recovery_for_a_single_glyph(self, blank_doc, monkeypatch):
        # SOURCE_FALSE_INSERTION/SOURCE_DUPLICATION=0: a single suspect glyph must never be
        # "recovered" as more than one character, even if OCR's own bounded substring is
        # longer (e.g. it misread neighbouring context as part of the gap).
        monkeypatch.setattr(main, "_render_gap_ink_ratio", lambda *a, **k: 0.2)
        monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png: [{"text": "t == 200,000", "confidence": 0.99}])
        recovered = _recover_suspect_native_char(blank_doc, 1, 600.0, 800.0, (10, 10, 18, 20), "t ", " 200,000")
        assert recovered is None

    def test_never_infers_equals_sign_merely_from_assignment_context(self, blank_doc, monkeypatch):
        # Never guesses "=" just because "t <suspect> 200,000" LOOKS like an assignment --
        # only a genuinely OCR-read "=" between the exact anchors is ever accepted.
        monkeypatch.setattr(main, "_render_gap_ink_ratio", lambda *a, **k: 0.2)
        monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png: [{"text": "t : 200,000", "confidence": 0.97}])
        recovered = _recover_suspect_native_char(blank_doc, 1, 600.0, 800.0, (10, 10, 18, 20), "t ", " 200,000")
        assert recovered == ":"  # exactly what the crop's own OCR read shows -- not "="

    def test_crop_is_wide_enough_for_the_real_live_traced_anchor_geometry(self, blank_doc, monkeypatch):
        # Prototype 2.6G2.8M2.2a Track A -- live-traced real defect: 3 of 4 real "="
        # occurrences failed with `recovered=None` because the OLD crop (padded only by the
        # SUSPECT GLYPH's own ~7.8pt width) was too narrow to ever show the full 5-6 character
        # right anchor to OCR at all -- not an OCR/confidence/anchor-matching problem, a crop
        # GEOMETRY problem. This asserts the crop passed to rendering is now wide enough to
        # contain the exact real anchor text, using the EXACT real bbox/anchors traced live.
        captured_crop_rect = {}

        def _capture_ink(_doc, _page_number, gap_bbox_norm, width, height):
            captured_crop_rect["rect"] = (gap_bbox_norm[0] * width, gap_bbox_norm[1] * height, gap_bbox_norm[2] * width, gap_bbox_norm[3] * height)
            return 0.2

        monkeypatch.setattr(main, "_render_gap_ink_ratio", _capture_ink)
        # The real OCR text a WIDE-ENOUGH crop would show (the old crop's own OCR read,
        # 'as t = 200', proves confidence/anchor-matching already work perfectly at 0.9995 --
        # it was truncated only because the crop itself ended mid-anchor).
        monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png: [{"text": "as t = 200,000 m", "confidence": 0.9995}])
        # Exact real live-traced geometry for the first "=" occurrence.
        char_bbox_pt = (67.86732452392578, 519.8724670410156, 75.63946575927734, 531.7876379394531)
        recovered = _recover_suspect_native_char(blank_doc, 1, 600.0, 800.0, char_bbox_pt, " t ", " 200,0")
        assert recovered == "="
        rect = captured_crop_rect["rect"]
        crop_width = rect[2] - rect[0]
        assert crop_width > 38.85, "crop must be wider than the old (too-narrow) real-traced 38.85pt width"

    def test_all_four_real_traced_equals_occurrences_recover_with_a_wide_enough_crop(self, blank_doc, monkeypatch):
        # Item 15's own requirement: verify all four independently, using the real live-
        # traced anchors/OCR shapes (widened to show the full anchor, as the fixed crop now
        # allows) for each of the four assignments.
        monkeypatch.setattr(main, "_render_gap_ink_ratio", lambda *a, **k: 0.2)
        cases = [
            (" t ", " 200,0", "as t = 200,000 m"),
            (" a ", " 5,000", "m, a = 5,000 m"),
            (" c ", " 0.3, ", "m, c = 0.3, and"),
            (" r ", " 10. E", "and r = 10. Eventually"),
        ]
        for left_anchor, right_anchor, wide_ocr_text in cases:
            monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png, t=wide_ocr_text: [{"text": t, "confidence": 0.97}])
            recovered = _recover_suspect_native_char(blank_doc, 1, 600.0, 800.0, (67.9, 519.9, 75.6, 531.8), left_anchor, right_anchor)
            assert recovered == "=", f"assignment for {left_anchor.strip()!r} did not recover independently"


class TestRecoverSuspectNativeInSpan:
    @pytest.fixture
    def blank_doc(self):
        doc = pymupdf.open()
        doc.new_page(width=600, height=800)
        yield doc
        doc.close()

    def _char(self, c, x0):
        return {"c": c, "bbox": (x0, 10.0, x0 + 6.0, 20.0)}

    def test_no_suspect_chars_is_a_pure_noop_no_ocr_call(self, blank_doc, monkeypatch):
        def _fail_if_called(_png):
            raise AssertionError("OCR must never be called when there is nothing suspect")

        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
        raw_chars = [self._char(c, i * 6.0) for i, c in enumerate("t = 200")]
        result = _recover_suspect_native_in_span(blank_doc, 1, 600.0, 800.0, "t = 200", raw_chars, "", "")
        assert result == "t = 200"

    def test_splices_recovered_character_at_the_correct_position(self, blank_doc, monkeypatch):
        text = "t \x02 200,000"
        raw_chars = [self._char(c, i * 6.0) for i, c in enumerate(text)]
        monkeypatch.setattr(main, "_render_gap_ink_ratio", lambda *a, **k: 0.2)
        monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png: [{"text": "t = 200,000", "confidence": 0.98}])
        result = _recover_suspect_native_in_span(blank_doc, 1, 600.0, 800.0, text, raw_chars, "", "")
        assert result == "t = 200,000"

    def test_all_four_assignments_recovered_independently(self, blank_doc, monkeypatch):
        # Item 15's own explicit requirement: verify all four "t =/a =/c =/r =" occurrences
        # independently, not accept the fix merely because the first one recovers.
        monkeypatch.setattr(main, "_render_gap_ink_ratio", lambda *a, **k: 0.2)
        for var, rest in (("t", "200,000 m2"), ("a", "5,000 m2"), ("c", "0.3"), ("r", "10")):
            text = f"{var} \x02 {rest}"
            raw_chars = [self._char(c, i * 6.0) for i, c in enumerate(text)]
            monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png, rest=rest, var=var: [{"text": f"{var} = {rest}", "confidence": 0.97}])
            result = _recover_suspect_native_in_span(blank_doc, 1, 600.0, 800.0, text, raw_chars, "", "")
            assert result == f"{var} = {rest}", f"assignment for {var!r} was not independently recovered"

    def test_leaves_suspect_character_unchanged_when_recovery_is_not_confident(self, blank_doc, monkeypatch):
        text = "t \x02 200,000"
        raw_chars = [self._char(c, i * 6.0) for i, c in enumerate(text)]
        monkeypatch.setattr(main, "_render_gap_ink_ratio", lambda *a, **k: 0.0)  # no ink
        result = _recover_suspect_native_in_span(blank_doc, 1, 600.0, 800.0, text, raw_chars, "", "")
        assert result == text  # unchanged, never corrupted further

    def test_uses_neighbouring_span_text_as_anchors(self, blank_doc, monkeypatch):
        # The suspect char sits alone in its own span (matching the real live trace: "="
        # lives in a separate MTSYN-font span from the surrounding Times-Roman text) --
        # anchors must come from the prev/next SPAN's own text, not just this span's text.
        captured = {}

        def _fake_ocr(_png):
            return [{"text": "t = 200,000", "confidence": 0.98}]

        def _capture_ink(*args, **kwargs):
            return 0.2

        monkeypatch.setattr(main, "_render_gap_ink_ratio", _capture_ink)
        monkeypatch.setattr(main, "_call_paddle_ocr", _fake_ocr)
        raw_chars = [self._char("\x02", 0.0)]
        result = _recover_suspect_native_in_span(blank_doc, 1, 600.0, 800.0, "\x02", raw_chars, "t ", " 200,000")
        assert result == "="
