"""Prototype 2.6G2.8S1.3 -- Repeated Inline Scientific Glyph Consistency.

Live-traced real sentence: "Slope values were varied between 0[deg] and 46[deg] at 2[deg]
intervals, aspect was varied over the full 360[deg] range, using a 20[deg] increment, ..."
exposed that five occurrences of the SAME visible glyph took different (and inconsistently
successful) recovery paths in one selection:

- 0[deg]/46[deg]: each sits between two SEPARATE BLOCKS on the SAME visual row ("...between
  0" | "and 46" | "at 2" -- three sibling blocks split horizontally). S1's own
  `_find_intermediate_prose_blocks` -- tuned for VERTICALLY-stacked continuation blocks -- can
  never match these (zero x-overlap between blocks on the same row, by construction), so they
  were silently dropped entirely: classification A generalized one level more granular.
  Fixed via a same-row CHAIN extension to `_find_intermediate_prose_blocks`, gated on rendered
  ink (never a width threshold, since this exact document's own column gutter is narrower than
  some legitimate missing-glyph gaps).

- 2[deg]: sits at a genuine LINE-WRAP boundary (the row has no more width left for the next
  WORD, so it wraps) -- `_find_trailing_adjacent_line` finds nothing (there is no sibling
  block to find). Fixed via `wrap_next_line` fallback in `_try_trailing_gap_recovery`, using
  the TRUE next line in reading order (which necessarily has a SMALLER x0 than `line`, since
  it starts the next row back at the page's own margin) -- this exposed and fixed a second,
  independent bug: `_attempt_gap_recovery`'s own x-position anchor sort silently swapped the
  anchors for a cross-row pair, producing a spurious `anchor_not_found`. New `reading_order`
  parameter bypasses the sort for callers that already know the true order.

- 360[deg]/20[deg]: were already recoverable (S1.2's own same-line micro-gap path) but
  rendered with a stray preceding space ("360 [deg]") because the ordinary inter-line
  "ordinary_append" branch never consulted `RecoveredFragment.leading_separator`/
  `.trailing_separator` the way the trailing-gap path already did -- fixed by extending that
  same evidence-based tight-merge to the ordinary loop too.

These are synthetic-PDF/mocked-OCR tests (no external fixture PDF or running Paddle service
needed), matching this suite's own established convention. The synthetic PDF reproduces the
exact real block/line topology (verified via direct extraction during this phase's own
investigation): three same-row sibling blocks (row 1) is naturally what PyMuPDF's own
block-detection produces here.
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
    return client.post("/document/register", files={"file": ("s13.pdf", pdf_bytes, "application/pdf")}).json()["documentId"]


def _sequential_ocr(responses: list[str]):
    state = {"n": 0}

    def _fake_ocr(_png_bytes):
        text = responses[state["n"]] if state["n"] < len(responses) else responses[-1]
        state["n"] += 1
        return [{"text": text, "confidence": 0.97}]

    return _fake_ocr


def _slope_aspect_pdf_bytes() -> bytes:
    """Row 1: three same-row sibling blocks (0[deg] and 46[deg] are inter-block gaps; 2[deg]
    is a genuine line-wrap trailing gap, nothing further right on that row at all). Row 2:
    the start of the next sentence fragment, confirming the wrap boundary."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    fs = 9.9626
    y1 = 250
    t1 = "Slope values were varied between 0"
    page.insert_text((50, y1), t1, fontsize=fs)
    x1_end = 50 + pymupdf.get_text_length(t1, fontsize=fs)
    page.draw_rect(pymupdf.Rect(x1_end, y1 - 9, x1_end + 8, y1 + 1.5), color=(0, 0, 0), fill=(0, 0, 0))
    x2 = x1_end + 30
    t2 = "and 46"
    page.insert_text((x2, y1), t2, fontsize=fs)
    x2_end = x2 + pymupdf.get_text_length(t2, fontsize=fs)
    page.draw_rect(pymupdf.Rect(x2_end, y1 - 9, x2_end + 8, y1 + 1.5), color=(0, 0, 0), fill=(0, 0, 0))
    x3 = x2_end + 30
    t3 = "at 2"
    page.insert_text((x3, y1), t3, fontsize=fs)
    x3_end = x3 + pymupdf.get_text_length(t3, fontsize=fs)
    # Wrap-trailing gap: small ink sliver right at the row's own margin, nothing after it.
    page.draw_rect(pymupdf.Rect(x3_end, y1 - 9, x3_end + 6, y1 + 1.5), color=(0, 0, 0), fill=(0, 0, 0))

    y2 = 280
    t4 = "intervals, aspect was varied over the full 360"
    page.insert_text((50, y2), t4, fontsize=fs)

    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _slope_aspect_ink_negative_pdf_bytes() -> bytes:
    """Same geometry, no drawn ink anywhere -- must never fabricate any of the three glyphs."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    fs = 9.9626
    y1 = 250
    t1 = "Slope values were varied between 0"
    page.insert_text((50, y1), t1, fontsize=fs)
    x1_end = 50 + pymupdf.get_text_length(t1, fontsize=fs)
    x2 = x1_end + 30
    t2 = "and 46"
    page.insert_text((x2, y1), t2, fontsize=fs)
    x2_end = x2 + pymupdf.get_text_length(t2, fontsize=fs)
    x3 = x2_end + 30
    t3 = "at 2"
    page.insert_text((x3, y1), t3, fontsize=fs)

    y2 = 280
    t4 = "intervals, aspect was varied over the full 360"
    page.insert_text((50, y2), t4, fontsize=fs)

    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


class TestSlopeAspectRealRegression:
    def test_all_three_row1_degree_symbols_recovered_tight(self, client, monkeypatch):
        monkeypatch.setattr(
            main,
            "_call_paddle_ocr",
            _sequential_ocr(
                [
                    "Slope values were varied between 0° and 46",
                    "and 46° at 2",
                    "at 2° intervals, aspect was varied over the full 360",
                ]
            ),
        )
        document_id = _register(client, _slope_aspect_pdf_bytes())
        try:
            res = client.post(
                "/layout/selection",
                json={
                    "documentId": document_id,
                    "start": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 250 / 800, "boundaryText": "Slope values were varied between 0 and 46 at 2", "direction": "forward"},
                    "end": {"pageNumber": 1, "xNorm": 0.3, "yNorm": 280 / 800, "boundaryText": "intervals, aspect was varied over the full 360", "direction": "backward"},
                },
            )
            assert res.status_code == 200
            text = res.json()["reconstructedText"]
            assert text.count("°") == 3
            assert "0°" in text
            assert "46°" in text
            assert "2°" in text
            assert "0 °" not in text
            assert "46 °" not in text
            assert "2 °" not in text
            normalized = " ".join(text.split())
            assert normalized == "Slope values were varied between 0° and 46° at 2° intervals, aspect was varied over the full 360"
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_ink_negative_twin_recovers_nothing(self, client, monkeypatch):
        def _fail_if_called(_png_bytes):
            raise AssertionError("SAME_LINE_FALSE_RECOVERY: OCR must never be called for an ink-negative gap")

        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
        document_id = _register(client, _slope_aspect_ink_negative_pdf_bytes())
        try:
            res = client.post(
                "/layout/selection",
                json={
                    "documentId": document_id,
                    "start": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 250 / 800, "boundaryText": "Slope values were varied between 0 and 46 at 2", "direction": "forward"},
                    "end": {"pageNumber": 1, "xNorm": 0.3, "yNorm": 280 / 800, "boundaryText": "intervals, aspect was varied over the full 360", "direction": "backward"},
                },
            )
            assert res.status_code == 200
            text = res.json()["reconstructedText"]
            assert "°" not in text
        finally:
            client.post("/document/close", json={"documentId": document_id})


class TestOrdinarySpaceEvidenceStillHonored:
    def test_of_cos_i_style_gap_keeps_its_genuine_space(self, client, monkeypatch):
        # Regression control for the new evidence-based tight-merge in the ordinary
        # inter-line loop: a gap whose OCR evidence shows a REAL space (e.g. "of" + " cos i")
        # must still get that space, never collapsed to touching notation.
        def _fake_ocr(_png_bytes):
            return [{"text": "a function of cos i and the slope", "confidence": 0.97}]

        monkeypatch.setattr(main, "_call_paddle_ocr", _fake_ocr)
        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        fs = 12.0
        y = 250
        t1 = "a function of"
        page.insert_text((50, y), t1, fontsize=fs)
        x1_end = 50 + pymupdf.get_text_length(t1, fontsize=fs)
        page.draw_rect(pymupdf.Rect(x1_end, y - 10, x1_end + 8, y + 2), color=(0, 0, 0), fill=(0, 0, 0))
        x2 = x1_end + 30
        t2 = "and the slope"
        page.insert_text((x2, y), t2, fontsize=fs)
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        document_id = _register(client, buf.getvalue())
        try:
            res = client.post(
                "/layout/selection",
                json={
                    "documentId": document_id,
                    "start": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 240 / 800, "boundaryText": "a function of", "direction": "forward"},
                    "end": {"pageNumber": 1, "xNorm": 0.3, "yNorm": 260 / 800, "boundaryText": "and the slope", "direction": "backward"},
                },
            )
            assert res.status_code == 200
            text = res.json()["reconstructedText"]
            normalized = " ".join(text.split())
            assert "of cos i and" in normalized
            assert "ofcos i" not in normalized
        finally:
            client.post("/document/close", json={"documentId": document_id})
