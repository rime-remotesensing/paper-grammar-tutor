"""Prototype 2.6G2.8S1.1 -- Same-Line Intra-Line Unowned Glyph Recovery.

Root cause (live-traced via the S1 real GOMS/Kananaskis reproduction, after S1's own
intermediate-block fix restored the surrounding prose): classification C, "same-line native
intervals are never inspected". `_gap_between_lines`/`_assemble_lines_with_gap_recovery`'s
own gap-detection loop only ever compares two DIFFERENT `Line` objects that are consecutive
in a selection's own assembled line sequence -- when the two anchors around a genuinely
missing glyph belong to the SAME PyMuPDF line (i.e. the surrounding text is close enough
together that PyMuPDF never splits it into separate lines), that interior gap was never
checked against anything, regardless of `_detect_suspicious_gaps` correctly having already
flagged it at extraction time.

A second, more specific finding: PyMuPDF's own dict-mode text extraction does not always
leave an EMPTY interval for an unrecognized glyph's own geometric region -- it frequently
synthesizes a separate SPAN containing nothing but a single space character, whose bbox
exactly coincides with the detected `SuspiciousGap`. This is why the live symptom is a
literal inserted space ("(39.31 )") rather than simply missing characters: D1's own dict-vs-
rawdict word-gap reconciliation (`_reconstruct_line_span_texts`) correctly proves a genuine
word-gap exists there and adds a space (its only available action -- it has no character
evidence to insert), but nothing downstream ever recognized that gap as OCR-eligible.

Fixed via two new functions (`_find_span_gap_candidates` / `_recover_interior_line_gaps`)
that reuse the EXISTING D2 OCR-recovery machinery (`_attempt_gap_recovery` /
`_recover_gap_text` / `RecoveredFragment`) unchanged, wrapping the two flanking spans in
minimal pseudo-`Line` objects -- no second OCR architecture. Wired into
`_assemble_lines_with_gap_recovery`'s own per-line loop, so every line reached by ANY
selection (cross-block or same-block) gets checked, not just the two-block "cos i" shape.

These are synthetic-PDF/mocked-OCR tests (no external fixture PDF or running Paddle service
needed), matching this suite's own established convention.
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
    return client.post("/document/register", files={"file": ("intraline.pdf", pdf_bytes, "application/pdf")}).json()["documentId"]


def _sequential_ocr(responses: list[str]):
    state = {"n": 0}

    def _fake_ocr(_png_bytes):
        text = responses[state["n"]] if state["n"] < len(responses) else responses[-1]
        state["n"] += 1
        return [{"text": text, "confidence": 0.97}]

    return _fake_ocr


def _goms_kananaskis_single_line_pdf_bytes() -> bytes:
    """The REAL live shape: a NARROW ink gap (unlike S1's own wide-gap fixture, which forced
    separate PyMuPDF lines and exercised the intermediate-BLOCK fix instead) keeps the whole
    sentence as ONE PyMuPDF line with interior placeholder-space spans -- exactly what the
    real GOMS/Kananaskis PDF produces and what S1's own fix could not recover."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((50, 100), "The forest structural inputs to the GOMS model are shown in Table I.", fontsize=12)

    fs = 12
    x, y, gap_w = 50, 250, 8
    t1 = "The model input solar zenith angle (39.31"
    page.insert_text((x, y), t1, fontsize=fs)
    x1_end = x + pymupdf.get_text_length(t1, fontsize=fs)
    page.draw_rect(pymupdf.Rect(x1_end, y - 11, x1_end + gap_w, y + 2), color=(0, 0, 0), fill=(0, 0, 0))
    x2 = x1_end + gap_w

    t2 = ") and solar azimuth angle (154.32"
    page.insert_text((x2, y), t2, fontsize=fs)
    x2_end = x2 + pymupdf.get_text_length(t2, fontsize=fs)
    page.draw_rect(pymupdf.Rect(x2_end, y - 11, x2_end + gap_w, y + 2), color=(0, 0, 0), fill=(0, 0, 0))
    x3 = x2_end + gap_w

    t3 = ") corresponded to midday"
    page.insert_text((x3, y), t3, fontsize=fs)

    page.insert_text((50, 270), "(near solar noon) conditions near the peak of the growing", fontsize=12)
    page.insert_text((50, 290), "season for the Kananaskis region.", fontsize=12)

    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _goms_ink_negative_twin_pdf_bytes() -> bytes:
    """Same native anchors, same geometric gap width, but NO drawn ink at all -- an ordinary
    space, never OCR-eligible."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((50, 100), "The forest structural inputs to the GOMS model are shown in Table I.", fontsize=12)

    fs = 12
    x, y, gap_w = 50, 250, 8
    t1 = "The model input solar zenith angle (39.31"
    page.insert_text((x, y), t1, fontsize=fs)
    x1_end = x + pymupdf.get_text_length(t1, fontsize=fs)
    x2 = x1_end + gap_w

    t2 = ") and solar azimuth angle (154.32"
    page.insert_text((x2, y), t2, fontsize=fs)
    x2_end = x2 + pymupdf.get_text_length(t2, fontsize=fs)
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


class TestGomsKananaskisSameLineRealRegression:
    def test_both_degree_symbols_recovered_no_spurious_space(self, client, monkeypatch):
        monkeypatch.setattr(
            main,
            "_call_paddle_ocr",
            _sequential_ocr(
                [
                    "The model input solar zenith angle (39.31°) and solar azimuth angle (154.32",
                    ") and solar azimuth angle (154.32°) corresponded to midday",
                ]
            ),
        )
        document_id = _register(client, _goms_kananaskis_single_line_pdf_bytes())
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 200
            text = res.json()["reconstructedText"]
            # Required exact critical substring (phase spec section 10).
            assert "solar zenith angle (39.31°) and solar azimuth angle (154.32°) corresponded" in text
            # DEGREE_SYMBOL_COUNT = 2
            assert text.count("°") == 2
            # DEGREE_PRECEDING_SPACE_COUNT = 0 -- never "39.31 °"/"154.32 °".
            assert "39.31 °" not in text
            assert "154.32 °" not in text
            assert " °" not in text
            # MIDDLE_PROSE_RETENTION / SOURCE_ORDER / SOURCE_DUPLICATION.
            assert "and solar azimuth angle" in text
            assert "corresponded to midday" in text
            assert text.count("solar zenith angle") == 1
            assert text.count("solar azimuth angle") == 1
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_ocr_unavailable_is_a_safe_failure(self, client, monkeypatch):
        monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png_bytes: None)
        document_id = _register(client, _goms_kananaskis_single_line_pdf_bytes())
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 422
        finally:
            client.post("/document/close", json={"documentId": document_id})


class TestInkNegativeControl:
    def test_no_drawn_ink_never_triggers_ocr_or_fabricates_a_glyph(self, client, monkeypatch):
        def _fail_if_called(_png_bytes):
            raise AssertionError("SAME_LINE_FALSE_RECOVERY: OCR must never be called for an ink-negative gap")

        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
        document_id = _register(client, _goms_ink_negative_twin_pdf_bytes())
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 200
            text = res.json()["reconstructedText"]
            assert "°" not in text
            assert "and solar azimuth angle" in text
            assert "corresponded to midday" in text
        finally:
            client.post("/document/close", json={"documentId": document_id})


def _same_line_two_runs_pdf_bytes() -> bytes:
    """Phase spec section 12: a TRUE one-visual-line fixture, "The angles (39.31°) and
    (154.32°) were measured." -- confirmed (via direct extraction inspection during this
    phase's own investigation) to produce exactly ONE PyMuPDF line with two interior
    placeholder-space spans, never separate lines/blocks."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((50, 100), "Overview of the measurement setup.", fontsize=12)

    fs = 12
    x, y, gap_w = 50, 250, 8
    t1 = "The angles (39.31"
    page.insert_text((x, y), t1, fontsize=fs)
    x1_end = x + pymupdf.get_text_length(t1, fontsize=fs)
    page.draw_rect(pymupdf.Rect(x1_end, y - 11, x1_end + gap_w, y + 2), color=(0, 0, 0), fill=(0, 0, 0))
    x2 = x1_end + gap_w

    t2 = ") and (154.32"
    page.insert_text((x2, y), t2, fontsize=fs)
    x2_end = x2 + pymupdf.get_text_length(t2, fontsize=fs)
    page.draw_rect(pymupdf.Rect(x2_end, y - 11, x2_end + gap_w, y + 2), color=(0, 0, 0), fill=(0, 0, 0))
    x3 = x2_end + gap_w

    t3 = ") were measured."
    page.insert_text((x3, y), t3, fontsize=fs)

    page.insert_text((50, 290), "Results are shown below.", fontsize=12)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _same_line_two_runs_ink_negative_pdf_bytes() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((50, 100), "Overview of the measurement setup.", fontsize=12)

    fs = 12
    x, y, gap_w = 50, 250, 8
    t1 = "The angles (39.31"
    page.insert_text((x, y), t1, fontsize=fs)
    x1_end = x + pymupdf.get_text_length(t1, fontsize=fs)
    x2 = x1_end + gap_w

    t2 = ") and (154.32"
    page.insert_text((x2, y), t2, fontsize=fs)
    x2_end = x2 + pymupdf.get_text_length(t2, fontsize=fs)
    x3 = x2_end + gap_w

    t3 = ") were measured."
    page.insert_text((x3, y), t3, fontsize=fs)

    page.insert_text((50, 290), "Results are shown below.", fontsize=12)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


class TestSameLineTwoRunsStructuralFixture:
    def test_both_runs_recovered_middle_and_retained_no_duplication(self, client, monkeypatch):
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
        document_id = _register(client, _same_line_two_runs_pdf_bytes())
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
            assert "39.31°" in text
            assert "154.32°" in text
            assert "39.31 °" not in text
            assert "154.32 °" not in text
            assert ") and (" in text
            assert text.count("were measured") == 1
            assert text.count("°") == 2
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_ink_negative_twin_no_recovery(self, client, monkeypatch):
        def _fail_if_called(_png_bytes):
            raise AssertionError("SAME_LINE_FALSE_RECOVERY: OCR must never be called for an ink-negative gap")

        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
        document_id = _register(client, _same_line_two_runs_ink_negative_pdf_bytes())
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
            assert "°" not in text
            assert "were measured" in text
        finally:
            client.post("/document/close", json={"documentId": document_id})
