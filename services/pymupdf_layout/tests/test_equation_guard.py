"""Prototype 2.5B/E -- tests for the equation-number-like endpoint guard, the candidate
gap detector, the 2.5D visual-ink gate, and 2.5E's localized missing-glyph OCR recovery
(see docs/design-notes.md, Prototype 2.5A-E, for the real Soenen failures these were built
from). Synthetic-PDF/pure-function/mocked-OCR only so these always run in CI without a
running Paddle service; the real-PDF regression (including a REAL Paddle recovery of the
real Soenen "k") is in test_fixtures.py.
"""

import io

import pymupdf
import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def _equation_adjacent_pdf_bytes() -> bytes:
    """One page mirroring the real Soenen shape at a much smaller scale:
    - block 0: ordinary single-span prose line (no gap at all)
    - block 1: "of" (line 0) then "can then be used as intended." (line 1) -- same visual
      paragraph, split into two lines by PyMuPDF with a large (~30pt) BLANK (no-ink) gap
      between them -- a candidate gap with nothing actually drawn in it, i.e. the visual-ink
      gate must classify this negative and drop it silently (never OCR it)
    - block 2: isolated "(5)" -- equation-number-like
    - block 3: isolated "12" -- short, but no parens -- must NOT be treated as equation-number-like
    - block 4: "As shown in (5) it is clear." -- ordinary prose containing "(5)", NOT isolated
    - block 5: "leftpart" / "rightpart continues the sentence." with a real drawn ink mark
      (a vector line, not text) in the gap between them -- a candidate gap that DOES have
      real ink, standing in for the real Soenen "k" without depending on OCR recognizing a
      specific character (OCR itself is mocked in the tests that use this).
    - block 6: "Prose leading toward an equation." directly above an isolated "(7)" --
      the primary prose-crossing-placeholder target for this synthetic fixture.
    - block 7: isolated "(8)" positioned nearby but NOT the endpoint any test actually
      clicks -- exists purely so a "nearest number" heuristic (which this service does NOT
      use) would give the WRONG answer if it were ever accidentally introduced.
    - block 8: "See citation [5] here." -- a square-bracket citation-style reference,
      never parens, must never be treated as an equation number.
    """
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((50, 100), "This sentence continues onto the next line ending with the value", fontsize=12)
    page.insert_text((50, 120), "of", fontsize=12)
    page.insert_text((90, 120), "can then be used as intended.", fontsize=12)
    page.insert_text((550, 150), "(5)", fontsize=10)
    page.insert_text((550, 700), "12", fontsize=10)
    page.insert_text((50, 300), "As shown in (5) it is clear.", fontsize=12)
    page.insert_text((50, 400), "leftpart", fontsize=12)
    page.insert_text((105, 400), "rightpart continues the sentence.", fontsize=12)
    page.draw_line(pymupdf.Point(92, 401), pymupdf.Point(98, 393), color=(0, 0, 0), width=2.0)
    page.insert_text((550, 430), "(9)", fontsize=10)
    page.insert_text((50, 500), "Prose leading toward an equation.", fontsize=12)
    page.insert_text((550, 530), "(7)", fontsize=10)
    page.insert_text((550, 560), "(8)", fontsize=10)
    page.insert_text((50, 600), "See citation [5] here.", fontsize=12)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


@pytest.fixture()
def registered_doc(client):
    res = client.post("/document/register", files={"file": ("eq.pdf", _equation_adjacent_pdf_bytes(), "application/pdf")})
    assert res.status_code == 200
    doc_id = res.json()["documentId"]
    yield doc_id
    client.post("/document/close", json={"documentId": doc_id})


def _norm(x, y, width=600.0, height=800.0):
    return x / width, y / height


# --- Pure-function unit tests -------------------------------------------------------------


def test_isolated_equation_number_recognized():
    block = main.Block(blockId="1:0", bbox=(0.9, 0.17, 0.94, 0.19), lines=[main.Line(text="(5)", bbox=(0.9, 0.17, 0.94, 0.19), spans=[])])
    assert main._is_equation_number_like_block(block) is True


def test_prose_containing_number_in_parens_not_recognized_as_isolated():
    block = main.Block(
        blockId="1:0",
        bbox=(0.08, 0.35, 0.31, 0.38),
        lines=[main.Line(text="As shown in (5) it is clear.", bbox=(0.08, 0.35, 0.31, 0.38), spans=[])],
    )
    assert main._is_equation_number_like_block(block) is False


def test_short_block_without_parens_not_recognized_as_equation_number():
    block = main.Block(blockId="1:0", bbox=(0.9, 0.86, 0.94, 0.88), lines=[main.Line(text="12", bbox=(0.9, 0.86, 0.94, 0.88), spans=[])])
    assert main._is_equation_number_like_block(block) is False


def test_multiline_block_never_recognized_even_if_one_line_is_just_a_number():
    block = main.Block(
        blockId="1:0",
        bbox=(0.08, 0.1, 0.3, 0.15),
        lines=[
            main.Line(text="(5)", bbox=(0.08, 0.1, 0.12, 0.12), spans=[]),
            main.Line(text="continues on a second line", bbox=(0.08, 0.13, 0.3, 0.15), spans=[]),
        ],
    )
    assert main._is_equation_number_like_block(block) is False


def test_suspicious_gap_detected_between_adjacent_spans():
    spans = [
        {"x0": 50.0, "y0": 107.1, "x1": 60.0, "y1": 123.6, "size": 12.0},
        {"x0": 90.0, "y0": 107.1, "x1": 250.8, "y1": 123.6, "size": 12.0},
    ]
    gaps = main._detect_suspicious_gaps(spans, width=600.0, height=800.0)
    assert len(gaps) == 1
    gx0, gy0, gx1, gy1 = gaps[0].bbox
    assert gx0 == pytest.approx(60.0 / 600.0)
    assert gx1 == pytest.approx(90.0 / 600.0)


def test_ordinary_word_spacing_not_flagged_as_suspicious():
    # ~0.28em gap at 12pt (a normal single space), well under the 0.6em threshold.
    spans = [
        {"x0": 50.0, "y0": 100.0, "x1": 100.0, "y1": 112.0, "size": 12.0},
        {"x0": 103.4, "y0": 100.0, "x1": 150.0, "y1": 112.0, "size": 12.0},
    ]
    gaps = main._detect_suspicious_gaps(spans, width=600.0, height=800.0)
    assert gaps == []


def test_gap_below_absolute_floor_not_flagged_even_if_relatively_large():
    # A huge relative multiple of a tiny font, but under the absolute floor -- must not fire.
    spans = [
        {"x0": 50.0, "y0": 100.0, "x1": 52.0, "y1": 101.0, "size": 1.0},
        {"x0": 53.5, "y0": 100.0, "x1": 55.0, "y1": 101.0, "size": 1.0},
    ]
    gaps = main._detect_suspicious_gaps(spans, width=600.0, height=800.0)
    assert gaps == []


# --- Prototype 2.5L Part A: parenthesized-gap candidacy rule --------------------------------


def test_parenthesized_gap_below_em_multiplier_still_flagged():
    # Real Soenen "(b)" geometry: 4.36pt gap at 9.96pt font -- 0.438em, under the 0.6em
    # ordinary rule (would need >5.98pt), but the left/right spans are "(" and ")".
    spans = [
        {"x0": 50.0, "y0": 100.0, "x1": 54.36, "y1": 110.0, "size": 9.96, "text": "("},
        {"x0": 58.72, "y0": 100.0, "x1": 62.0, "y1": 110.0, "size": 9.96, "text": ")"},
    ]
    gaps = main._detect_suspicious_gaps(spans, width=600.0, height=800.0)
    assert len(gaps) == 1


def test_parenthesized_gap_below_absolute_floor_still_not_flagged():
    # The absolute floor still applies even for bracket-adjacency -- a near-zero gap (normal
    # kerning) must never become a candidate just because it sits between parens.
    spans = [
        {"x0": 50.0, "y0": 100.0, "x1": 54.36, "y1": 110.0, "size": 9.96, "text": "("},
        {"x0": 55.5, "y0": 100.0, "x1": 58.0, "y1": 110.0, "size": 9.96, "text": ")"},
    ]
    gaps = main._detect_suspicious_gaps(spans, width=600.0, height=800.0)
    assert gaps == []


def test_non_parenthesized_narrow_gap_still_not_flagged():
    # Same narrow gap width as the real "(b)" case, but the spans aren't "(" / ")" -- must
    # not be treated as a candidate by the new rule (and is under the em-multiplier too).
    spans = [
        {"x0": 50.0, "y0": 100.0, "x1": 54.36, "y1": 110.0, "size": 9.96, "text": "of"},
        {"x0": 58.72, "y0": 100.0, "x1": 62.0, "y1": 110.0, "size": 9.96, "text": "the"},
    ]
    gaps = main._detect_suspicious_gaps(spans, width=600.0, height=800.0)
    assert gaps == []


def test_gap_detection_tolerates_spans_without_text_key():
    # Backward-compat: a caller that only cares about the ordinary width rule (as this
    # file's own earlier tests do) never needs to supply "text" -- must not KeyError.
    spans = [
        {"x0": 50.0, "y0": 107.1, "x1": 60.0, "y1": 123.6, "size": 12.0},
        {"x0": 90.0, "y0": 107.1, "x1": 250.8, "y1": 123.6, "size": 12.0},
    ]
    gaps = main._detect_suspicious_gaps(spans, width=600.0, height=800.0)
    assert len(gaps) == 1


# --- Integration tests (synthetic PDF via the real service) -------------------------------


def test_equation_number_selected_alone_returns_placeholder_without_prepending_prose(client, registered_doc):
    # Prototype 2.5G item 7/33: both endpoints resolve to the SAME equation-number block
    # (the user selected just "(5)", nothing else) -- the placeholder is returned directly,
    # with NO prose ever collected/prepended.
    x, y = _norm(556, 145)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "(5)", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "(5)", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reconstructedText"] == "[式 (5)]"
    assert body["fragments"] == [{"pageNumber": 1, "text": "[式 (5)]"}]


def test_endpoint_coordinate_on_equation_number_recovered_by_exact_prose_anchor(client, registered_doc):
    # Coordinate lands squarely on the "(5)" block, but the REAL boundaryText the browser
    # captured is unambiguous prose text found nowhere near there -- exactly the 2.5A
    # overlapping-block-tiebreak shape (a wrong coordinate guess corrected by anchor text).
    x, y = _norm(556, 145)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "ending with the value", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "ending with the value", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["sameBlock"] is True
    assert body["startBlockId"] == "1:0"


def test_prose_number_reference_block_never_rejected_by_equation_guard(client, registered_doc):
    x, y = _norm(60, 295)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "As shown in (5) it is clear.", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "As shown in (5) it is clear.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    assert res.json()["sameBlock"] is True


def test_tiny_non_equation_block_never_rejected_by_equation_guard(client, registered_doc):
    x, y = _norm(556, 696)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "12", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "12", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    assert res.json()["sameBlock"] is True


def test_selection_crossing_blank_candidate_gap_succeeds_silently_no_ocr(client, registered_doc, monkeypatch):
    # Same block ("of" line -> "can then be used as intended." line): a CANDIDATE gap
    # exists geometrically, but nothing is actually drawn there -- item 19: the visual-ink
    # gate must classify it negative and drop it silently. No warning field exists anymore
    # (Prototype 2.5E) -- success is silent; failing this test's own OCR-call guard would
    # mean the no-ink path incorrectly reached OCR (item 55's principle).
    def _fail_if_called(_png_bytes):
        raise AssertionError("OCR must never be called for a visual-ink-negative candidate gap")

    monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
    x1, y1 = _norm(55, 115)
    x2, y2 = _norm(200, 115)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "of", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "can then be used as intended.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["sameBlock"] is True
    assert body["reconstructedText"] == "of\ncan then be used as intended."


def test_selection_within_single_span_line_has_no_reconstructed_text(client, registered_doc):
    # No adjacent-line pair at all (one single-span line) -- the fast native-Range path:
    # sameBlock=True, reconstructedText=None.
    x, y = _norm(60, 95)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "This sentence continues onto the next line ending with the value", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "This sentence continues onto the next line ending with the value", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["sameBlock"] is True
    assert body["reconstructedText"] is None


# --- Visual-ink gate + OCR recovery (mocked Paddle -- deterministic, no real service needed) --


def test_ink_positive_gap_recovered_with_mocked_ocr(client, registered_doc, monkeypatch):
    def _fake_ocr(_png_bytes):
        return [{"text": "leftpart X rightpart continues the sentence.", "confidence": 0.99}]

    monkeypatch.setattr(main, "_call_paddle_ocr", _fake_ocr)
    x1, y1 = _norm(55, 405)
    x2, y2 = _norm(200, 405)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "leftpart", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "rightpart continues the sentence.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reconstructedText"] == "leftpart\nX\nrightpart continues the sentence."


def test_ink_positive_gap_ocr_unavailable_is_safe_failure(client, registered_doc, monkeypatch):
    monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png_bytes: None)
    x1, y1 = _norm(55, 405)
    x2, y2 = _norm(200, 405)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "leftpart", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "rightpart continues the sentence.", "direction": "backward"},
        },
    )
    assert res.status_code == 422
    assert res.json()["detail"]["error"] == "missing_glyph_unresolved"


def test_ink_positive_gap_low_confidence_is_safe_failure(client, registered_doc, monkeypatch):
    def _low_confidence_ocr(_png_bytes):
        return [{"text": "leftpart X rightpart continues the sentence.", "confidence": 0.5}]

    monkeypatch.setattr(main, "_call_paddle_ocr", _low_confidence_ocr)
    x1, y1 = _norm(55, 405)
    x2, y2 = _norm(200, 405)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "leftpart", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "rightpart continues the sentence.", "direction": "backward"},
        },
    )
    assert res.status_code == 422
    assert res.json()["detail"]["error"] == "missing_glyph_unresolved"


def test_ink_positive_gap_anchors_not_found_is_safe_failure(client, registered_doc, monkeypatch):
    def _unrelated_ocr(_png_bytes):
        return [{"text": "completely unrelated OCR text with no anchors", "confidence": 0.99}]

    monkeypatch.setattr(main, "_call_paddle_ocr", _unrelated_ocr)
    x1, y1 = _norm(55, 405)
    x2, y2 = _norm(200, 405)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "leftpart", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "rightpart continues the sentence.", "direction": "backward"},
        },
    )
    assert res.status_code == 422
    assert res.json()["detail"]["error"] == "missing_glyph_unresolved"


def test_ink_positive_gap_ocr_replacement_forbidden_only_gap_substring_inserted(client, registered_doc, monkeypatch):
    # Item 32: even if OCR's own line text disagrees with the trusted extracted text
    # elsewhere, only the anchor-bounded substring is ever used -- the trusted anchors
    # themselves are never replaced by whatever OCR produced for them.
    def _fake_ocr(_png_bytes):
        return [{"text": "leftpart X rightpart continues the sentence.", "confidence": 0.99}]

    monkeypatch.setattr(main, "_call_paddle_ocr", _fake_ocr)
    x1, y1 = _norm(55, 405)
    x2, y2 = _norm(200, 405)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "leftpart", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "rightpart continues the sentence.", "direction": "backward"},
        },
    )
    body = res.json()
    assert body["reconstructedText"].startswith("leftpart\n")
    assert body["reconstructedText"].endswith("\nrightpart continues the sentence.")


def test_recover_gap_text_pure_function_anchor_alignment():
    assert main._recover_gap_text("of", "can then be used", "of k can then be used") == "k"


def test_recover_gap_text_returns_none_when_anchor_missing():
    assert main._recover_gap_text("of", "can then be used", "totally different text") is None


def test_recover_gap_text_returns_none_when_recovered_substring_empty():
    # Anchors found immediately adjacent with nothing between them -- item 43's "recovered
    # substring empty when visual ink exists" safe-failure case.
    assert main._recover_gap_text("of", "can then be used", "ofcan then be used") is None


# --- Display-equation placeholder (Prototype 2.5G) -----------------------------------------


def test_equation_display_token_uses_the_blocks_own_number():
    block = main.Block(blockId="1:0", bbox=(0.9, 0.17, 0.94, 0.19), lines=[main.Line(text="(7)", bbox=(0.9, 0.17, 0.94, 0.19), spans=[])])
    assert main._equation_display_token(block) == "[式 (7)]"


def test_prose_crossing_into_equation_produces_placeholder_no_ocr(client, registered_doc, monkeypatch):
    def _fail_if_called(_png_bytes):
        raise AssertionError("equation placeholder creation must never call OCR (item 38/39)")

    monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
    x1, y1 = _norm(55, 505)
    x2, y2 = _norm(556, 535)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "Prose leading toward an equation.", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "(7)", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reconstructedText"] == "Prose leading toward an equation.\n[式 (7)]"


def test_wrong_nearby_equation_number_never_used_only_actual_endpoint(client, registered_doc, monkeypatch):
    # Item 28: page has both "(7)" and a numerically-close "(8)" nearby -- the endpoint the
    # user actually clicked (identity, not nearest-number search) must be the one used.
    monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png_bytes: (_ for _ in ()).throw(AssertionError("no OCR expected")))
    x1, y1 = _norm(55, 505)
    x2, y2 = _norm(556, 535)  # lands on "(7)", not "(8)"
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "Prose leading toward an equation.", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "(7)", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    assert res.json()["reconstructedText"].endswith("[式 (7)]")
    assert "(8)" not in res.json()["reconstructedText"]


def test_ordinary_inline_equation_number_reference_unaffected_by_placeholder_logic(client, registered_doc):
    x, y = _norm(60, 305)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "As shown in (5) it is clear.", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "As shown in (5) it is clear.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["sameBlock"] is True
    assert body["reconstructedText"] is None  # native path -- never treated as an equation endpoint at all


def test_citation_bracket_never_treated_as_equation_number(client, registered_doc):
    x, y = _norm(60, 605)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "See citation [5] here.", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x, "yNorm": y, "boundaryText": "See citation [5] here.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["sameBlock"] is True
    assert body["reconstructedText"] is None


def test_equation_crossing_with_paddle_unavailable_for_missing_k_safe_fails_no_silent_drop(client, registered_doc, monkeypatch):
    # Item 37: the primary combined case (missing-glyph recovery needed INSIDE the prose
    # portion of an equation-crossing selection) must still safe-fail explicitly if Paddle
    # is unavailable -- never silently drop the glyph just because a placeholder is also
    # being built. Uses the "leftpart"/"rightpart..." ink-positive gap (block 5), which is
    # immediately followed by equation number "(9)" (block 6) in this fixture.
    monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png_bytes: None)
    x1, y1 = _norm(55, 405)  # "leftpart" -- the real ink-positive gap needing recovery
    x2, y2 = _norm(556, 425)  # "(9)" equation number
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "leftpart", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "(9)", "direction": "backward"},
        },
    )
    assert res.status_code == 422
    assert res.json()["detail"]["error"] == "missing_glyph_unresolved"
