"""Prototype 2.6G2.8S1 -- Interior Scientific Span Continuity / Multi-Block Source Recall.

Root cause (live-traced via a synthetic reproduction of the real GOMS/Kananaskis PDF):
`_layout_selection_impl`'s ordinary same-page cross-block branch only ever collected
`first_block`'s own lines (from the start anchor onward) and `last_block`'s own lines (up to
the end anchor) -- classification D, INTERIOR_BLOCK_NOT_INCLUDED_IN_SELECTION. Any block
strictly BETWEEN them in page block-index order was silently dropped; there was no code path
that ever walked it at all. This was invisible for the ordinary two-block case (one block
ends, the very next begins -- the real "cos i" control) and was previously ALSO the correct,
deliberate behavior for a genuine cross-column drag (Failure A: a footnote/caption
geometrically between two different-column endpoints must never be pulled in). The real
regression proved a third shape: ordinary single-column body prose that PyMuPDF fragments
into 3+ blocks (an embedded symbol glyph -- here a degree sign -- that isn't extractable as
text forces a new block boundary the same way it can force a new LINE boundary), where the
"middle" content genuinely IS the next sentence in the same reading flow.

Fixed in `_find_intermediate_prose_blocks` (main.py): a block strictly between the two
selection endpoints is included only when it shares corridor with BOTH endpoints
independently (never the wide union corridor equation search uses) and sits within their
combined vertical extent -- this naturally admits genuine same-column continuation prose
while excluding Failure A's own cross-column footnote/caption (which cannot share corridor
with two DIFFERENT columns at once).

Once intermediate blocks are included, the existing (unmodified) D2 gap-detection/OCR-
recovery pipeline (`_gap_between_lines` / `_attempt_gap_recovery`) already handles the
interior degree-symbol glyphs correctly -- they were never the actual defect; they simply
never got a chance to run because the lines around them were dropped before gap detection.

These are synthetic-PDF/mocked-OCR tests (no external fixture PDF or running Paddle service
needed), matching this suite's own established convention (see test_equation_guard.py /
test_trailing_glyph_recovery.py).
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


def _register(client, pdf_bytes: bytes) -> str:
    return client.post("/document/register", files={"file": ("interior.pdf", pdf_bytes, "application/pdf")}).json()["documentId"]


def _sequential_ocr(responses: list[str]):
    """Returns a `_call_paddle_ocr` replacement that yields each response in `responses` in
    call order (each interior gap crop triggers one OCR call), matching real Paddle OCR
    behavior of recognizing whatever is actually rendered in each specific crop region."""
    state = {"n": 0}

    def _fake_ocr(_png_bytes):
        text = responses[state["n"]] if state["n"] < len(responses) else responses[-1]
        state["n"] += 1
        return [{"text": text, "confidence": 0.97}]

    return _fake_ocr


def _goms_kananaskis_pdf_bytes() -> bytes:
    """Mirrors the real traced GOMS/Kananaskis shape: an opening sentence, then a second
    paragraph whose own first visual row contains TWO interior unowned-ink degree symbols
    (drawn ink standing in for a glyph the embedded font doesn't expose as extractable text,
    never depending on OCR recognizing a specific character -- matching this suite's own
    "leftpart"/"rightpart" convention), each one splitting PyMuPDF's own line/block
    segmentation exactly as it does for the real trailing "90°." case, followed by two more
    ordinary prose lines and a final short block."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((50, 100), "The forest structural inputs to the GOMS model are shown in Table I.", fontsize=12)

    fs = 12
    x, y, gap_w = 50, 250, 30
    t1 = "The model input solar zenith angle (39.31"
    page.insert_text((x, y), t1, fontsize=fs)
    x1_end = x + pymupdf.get_text_length(t1, fontsize=fs)
    page.draw_rect(pymupdf.Rect(x1_end, y - 11, x1_end + 8, y + 2), color=(0, 0, 0), fill=(0, 0, 0))
    x2 = x1_end + gap_w

    t2 = ") and solar azimuth angle (154.32"
    page.insert_text((x2, y), t2, fontsize=fs)
    x2_end = x2 + pymupdf.get_text_length(t2, fontsize=fs)
    page.draw_rect(pymupdf.Rect(x2_end, y - 11, x2_end + 8, y + 2), color=(0, 0, 0), fill=(0, 0, 0))
    x3 = x2_end + gap_w

    t3 = ") corresponded to midday"
    page.insert_text((x3, y), t3, fontsize=fs)

    page.insert_text((50, 270), "(near solar noon) conditions near the peak of the growing", fontsize=12)
    page.insert_text((50, 290), "season for the Kananaskis region.", fontsize=12)

    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _select_full_target(client, document_id):
    return client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 90 / 800, "boundaryText": "The forest structural inputs", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.3, "yNorm": 290 / 800, "boundaryText": "Kananaskis region.", "direction": "backward"},
        },
    )


class TestGomsKananaskisRealRegression:
    def test_interior_prose_and_both_degree_symbols_recovered(self, client, monkeypatch):
        monkeypatch.setattr(
            main,
            "_call_paddle_ocr",
            _sequential_ocr(
                [
                    "The model input solar zenith angle (39.31°) and solar azimuth angle (154.32",
                    ") and solar azimuth angle (154.32°) corresponded to",
                ]
            ),
        )
        document_id = _register(client, _goms_kananaskis_pdf_bytes())
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 200
            text = res.json()["reconstructedText"]
            # Interior prose that was previously dropped entirely (root cause D) is present.
            assert "and solar azimuth angle" in text
            assert "corresponded to" in text
            assert "(near solar noon) conditions" in text
            # Both degree symbols recovered. Prototype 2.6G2.8S1.3 -- the ordinary inter-line
            # gap-recovery loop now honors `RecoveredFragment.leading_separator`/
            # `.trailing_separator` (previously bare-content-only, which left every such
            # recovered glyph exactly one "\n"-join collapse away from a stray preceding
            # space) -- since the OCR evidence here shows the degree symbol touching "39.31"/
            # "154.32" directly (empty separators), the glyph is now tight-spliced with NO
            # embedded newline at all, not merely "correct after whitespace collapse".
            assert text.count("°") == 2
            assert "39.31°" in text
            assert "154.32°" in text
            assert "39.31 °" not in text
            assert "154.32 °" not in text
            # Exact source order.
            assert text == (
                "The forest structural inputs\nThe model input solar zenith angle (39.31°) and solar azimuth angle (154.32°) corresponded to\n"
                "(near solar noon) conditions near the peak of the growing\nKananaskis region."
            )
            # SOURCE_DUPLICATION = 0
            assert text.count("solar zenith angle") == 1
            assert text.count("solar azimuth angle") == 1
            assert text.count("corresponded to") == 1
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_ocr_unavailable_is_a_safe_failure_never_silently_drops_prose(self, client, monkeypatch):
        # When OCR cannot resolve a genuine interior gap, the request must fail explicitly
        # (422) rather than silently omitting the missing glyph AND the surrounding prose --
        # this is the existing D2 "safe failure" contract, unaffected by this phase's fix.
        monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png_bytes: None)
        document_id = _register(client, _goms_kananaskis_pdf_bytes())
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 422
        finally:
            client.post("/document/close", json={"documentId": document_id})


def _multiple_interior_runs_pdf_bytes() -> bytes:
    """Structural fixture (phase spec section 11): two independent parenthesized interior
    scientific runs on the SAME row with ordinary prose ("and") between them, no degree
    symbols this time -- exercises the general block-continuity fix independent of any
    specific glyph shape."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((50, 100), "Overview of the measurement setup.", fontsize=12)

    fs = 12
    x, y, gap_w = 50, 250, 30
    t1 = "The angles ("
    page.insert_text((x, y), t1, fontsize=fs)
    x1_end = x + pymupdf.get_text_length(t1, fontsize=fs)
    page.draw_rect(pymupdf.Rect(x1_end, y - 11, x1_end + 8, y + 2), color=(0, 0, 0), fill=(0, 0, 0))
    x2 = x1_end + gap_w

    t2 = ") and ("
    page.insert_text((x2, y), t2, fontsize=fs)
    x2_end = x2 + pymupdf.get_text_length(t2, fontsize=fs)
    page.draw_rect(pymupdf.Rect(x2_end, y - 11, x2_end + 8, y + 2), color=(0, 0, 0), fill=(0, 0, 0))
    x3 = x2_end + gap_w

    t3 = ") were measured."
    page.insert_text((x3, y), t3, fontsize=fs)

    page.insert_text((50, 290), "Results are shown below.", fontsize=12)

    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


class TestMultipleInteriorScientificRuns:
    def test_both_runs_and_middle_prose_retained_no_duplication(self, client, monkeypatch):
        monkeypatch.setattr(
            main,
            "_call_paddle_ocr",
            _sequential_ocr(
                [
                    "The angles (39.31°) and (154.32",
                    ") and (154.32°) were measured.",
                ]
            ),
        )
        document_id = _register(client, _multiple_interior_runs_pdf_bytes())
        try:
            res = client.post(
                "/layout/selection",
                json={
                    "documentId": document_id,
                    "start": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 90 / 800, "boundaryText": "Overview of the measurement setup.", "direction": "forward"},
                    "end": {"pageNumber": 1, "xNorm": 0.3, "yNorm": 290 / 800, "boundaryText": "Results are shown below.", "direction": "backward"},
                },
            )
            assert res.status_code == 200
            text = res.json()["reconstructedText"]
            normalized = " ".join(text.split())
            assert "the angles" in normalized.lower()
            assert ") and (" in normalized
            assert normalized.count("39.31") == 1
            assert normalized.count("154.32") == 1
            assert normalized.count("were measured") == 1
        finally:
            client.post("/document/close", json={"documentId": document_id})


class TestFailureARegressionStillProtected:
    """The intermediate-block fix must never re-admit a genuine cross-column footnote/caption
    that only shares corridor with ONE of the two (different-column) endpoints, not both --
    the exact shape `_find_intermediate_prose_blocks`'s own corridor gate exists to reject."""

    def test_cross_column_intermediate_block_not_sharing_both_corridors_is_excluded(self, client):
        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        # Left column body, ending mid-column.
        page.insert_text((50, 200), "These techniques have been", fontsize=12)
        # An intermediate, full-width footnote-like block spanning BOTH columns' x-range --
        # shares corridor with neither column narrowly (it's much wider than either).
        page.insert_text((50, 400), "Manuscript received funding information footnote text spanning the full page width here", fontsize=8)
        # Right column body, starting after the footnote.
        page.insert_text((320, 200), "applied in forested areas and are based on an", fontsize=12)
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()

        document_id = _register(client, buf.getvalue())
        try:
            res = client.post(
                "/layout/selection",
                json={
                    "documentId": document_id,
                    "start": {"pageNumber": 1, "xNorm": 0.08, "yNorm": 200 / 800, "boundaryText": "These techniques have been", "direction": "forward"},
                    "end": {"pageNumber": 1, "xNorm": 0.53, "yNorm": 200 / 800, "boundaryText": "applied in forested areas and are based on an", "direction": "backward"},
                },
            )
            assert res.status_code == 200
            text = res.json()["reconstructedText"]
            assert "Manuscript received" not in text
            assert "footnote" not in text
        finally:
            client.post("/document/close", json={"documentId": document_id})
