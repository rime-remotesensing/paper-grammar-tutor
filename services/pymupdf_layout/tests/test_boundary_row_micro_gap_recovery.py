"""Prototype 2.6G2.8S1.2 -- Boundary-Row Continuation + Micro-Gap Ink Recovery.

TRACK A (root cause A: REAL_LINE_HAS_NO_SPAN_CANDIDATE): the resolved selection-start line can
begin partway across its own visual row when a sibling block occupies the same row to its
left, split off by the same unextractable-glyph mechanism that already splits a TRAILING row
(D2's "90°." case) -- but no code path ever looked to the LEFT of the first selected line.
`_find_leading_adjacent_line` (symmetric to the existing `_find_trailing_adjacent_line`) plus
a new leading-gap block in `_assemble_lines_with_gap_recovery` close this gap, with a hard
boundary-safety rule: the recovered glyph is only ever SPLICED into a position already proven
to exist inside the client's own boundary text (`parts[0].endswith(lines[0].text)`) -- never
prepended, so a sibling whose content the user never selected can never expand the result
leftward. These tests construct `PageBlocks`/`Block`/`Line` objects directly (this suite's own
established convention for exact geometry control) rather than relying on PyMuPDF's own
block-detection heuristic, which does not reliably reproduce the real multi-block shape from
simple synthetic `insert_text` calls.

TRACK B (root cause D: CANDIDATE_REJECTED_BY_GEOMETRY): the real second degree-symbol gap
(~4.8pt) sits below `_detect_suspicious_gaps`'s own em-multiplier width gate
(~5.98pt at this font size), so no page-wide `SuspiciousGap` was ever emitted for it -- nothing
downstream had one to match. `_probe_micro_gap_ink` performs a LOCAL, targeted ink probe
directly on the geometric interval between two adjacent same-row native anchors (never a
second page-wide detection pass, never a global threshold change), wired into both the
same-line span-gap path (`_find_span_gap_candidates`, shapes b2/c) and the inter-line path
(the main assembly loop's own `_gap_between_lines` fallback). These tests use real PyMuPDF-
rendered PDFs (ink rendering needs an actual page) with a realistic ~4.8pt gap width.
"""

import io

import pymupdf
import pytest
from fastapi.testclient import TestClient

import main
from main import Block, Line, PageBlocks, Span


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def _register(client, pdf_bytes: bytes) -> str:
    return client.post("/document/register", files={"file": ("boundary.pdf", pdf_bytes, "application/pdf")}).json()["documentId"]


def _sequential_ocr(responses: list[str]):
    state = {"n": 0}

    def _fake_ocr(_png_bytes):
        text = responses[state["n"]] if state["n"] < len(responses) else responses[-1]
        state["n"] += 1
        return [{"text": text, "confidence": 0.97}]

    return _fake_ocr


# ----------------------------------------------------------------------------
# TRACK A
# ----------------------------------------------------------------------------


def _leading_boundary_pdf_bytes() -> bytes:
    """Real ink-positive gap for rendering (`_render_gap_ink_ratio` needs an actual page);
    the BLOCK/LINE structure itself is constructed manually in each test below."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    fs = 9.9626
    y = 250
    tA = "The angle (39.31"
    page.insert_text((50, y), tA, fontsize=fs)
    xA_end = 50 + pymupdf.get_text_length(tA, fontsize=fs)
    page.draw_rect(pymupdf.Rect(xA_end, y - 9, xA_end + 20, y + 1.5), color=(0, 0, 0), fill=(0, 0, 0))
    xB = xA_end + 20
    tB = ") corresponded well with the observed data for the test."
    page.insert_text((xB, y), tB, fontsize=fs)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _leading_page_blocks() -> tuple[PageBlocks, Line]:
    line0 = Line(
        text="The angle (39.31",
        bbox=(0.08333333333333333, 0.29911275863647463, 0.2088621139526367, 0.3162235260009766),
        spans=[Span(text="The angle (39.31", bbox=(0.08333333333333333, 0.29911275863647463, 0.2088621139526367, 0.3162235260009766), size=9.9626, font="Helvetica")],
    )
    line1 = Line(
        text=") corresponded well with the observed data for the test.",
        bbox=(0.2421954257165591, 0.29911275863647463, 0.6464279182225268, 0.3162235260009766),
        spans=[
            Span(
                text=") corresponded well with the observed data for the test.",
                bbox=(0.2421954257165591, 0.29911275863647463, 0.6464279182225268, 0.3162235260009766),
                size=9.9626,
                font="Helvetica",
            )
        ],
    )
    block_a = Block(blockId="1:A", bbox=line0.bbox, lines=[line0])
    block_b = Block(blockId="1:B", bbox=line1.bbox, lines=[line1])
    return PageBlocks(pageNumber=1, width=600.0, height=800.0, blocks=[block_a, block_b], suspiciousGaps=[]), line1


class TestTrackALeadingBoundaryRecovery:
    def test_positive_boundary_text_ending_with_trusted_suffix_splices_correctly(self, client, monkeypatch):
        monkeypatch.setattr(main, "_call_paddle_ocr", _sequential_ocr(["The angle (39.31°) corresponded well with the observed data for the test."]))
        pdf_bytes = _leading_boundary_pdf_bytes()
        doc_id = _register(client, pdf_bytes)
        try:
            doc_state = main._get_document_state(doc_id)
            page_blocks, line1 = _leading_page_blocks()
            result = main._assemble_lines_with_gap_recovery(
                doc_state.doc, 1, page_blocks, [line1], ["The angle (39.31 ) corresponded well with the observed data for the test."], check_leading_gap=True
            )
            assert result == "The angle (39.31°) corresponded well with the observed data for the test."
            assert "39.31 °" not in result
        finally:
            client.post("/document/close", json={"documentId": doc_id})

    def test_negative_boundary_text_not_reaching_sibling_abstains_never_prepends(self, client, monkeypatch):
        # LEADING_BOUNDARY_OVEREXPANSION = 0: the client's own boundary text does NOT extend
        # back to include the sibling's own trailing content -- must never prepend the
        # recovered glyph (or anything else) ahead of what the user actually selected.
        monkeypatch.setattr(main, "_call_paddle_ocr", _sequential_ocr(["The angle (39.31°) corresponded well with the observed data for the test."]))
        pdf_bytes = _leading_boundary_pdf_bytes()
        doc_id = _register(client, pdf_bytes)
        try:
            doc_state = main._get_document_state(doc_id)
            page_blocks, line1 = _leading_page_blocks()
            # boundary text is only the trusted line's own content, truncated -- does not end
            # with the FULL trusted suffix.
            result = main._assemble_lines_with_gap_recovery(doc_state.doc, 1, page_blocks, [line1], [") corresponded well with the observed"], check_leading_gap=True)
            assert result == ") corresponded well with the observed"
            assert "°" not in result
        finally:
            client.post("/document/close", json={"documentId": doc_id})

    def test_no_ink_never_recovers(self, client, monkeypatch):
        def _fail_if_called(_png_bytes):
            raise AssertionError("OCR must never be called when there is no rendered ink")

        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
        # Build a PDF with NO drawn ink between the two segments (pure geometric gap only).
        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        fs = 9.9626
        y = 250
        tA = "The angle (39.31"
        page.insert_text((50, y), tA, fontsize=fs)
        xA_end = 50 + pymupdf.get_text_length(tA, fontsize=fs)
        tB = ") corresponded well with the observed data for the test."
        page.insert_text((xA_end + 20, y), tB, fontsize=fs)
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        doc_id = _register(client, buf.getvalue())
        try:
            doc_state = main._get_document_state(doc_id)
            page_blocks, line1 = _leading_page_blocks()
            result = main._assemble_lines_with_gap_recovery(
                doc_state.doc, 1, page_blocks, [line1], ["The angle (39.31 ) corresponded well with the observed data for the test."], check_leading_gap=True
            )
            assert "°" not in result
            assert result == "The angle (39.31 ) corresponded well with the observed data for the test."
        finally:
            client.post("/document/close", json={"documentId": doc_id})

    def test_no_leading_sibling_at_all_never_errors(self, client):
        # Negative control (section 6): the resolved first line has no leading sibling on its
        # own row at all (an ordinary selection start) -- must be a complete no-op.
        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        page.insert_text((50, 100), "An ordinary sentence with no leading sibling nearby.", fontsize=12)
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        doc_id = _register(client, buf.getvalue())
        try:
            doc_state = main._get_document_state(doc_id)
            line = Line(text="An ordinary sentence with no leading sibling nearby.", bbox=(0.08, 0.1, 0.9, 0.13), spans=[])
            page_blocks = PageBlocks(pageNumber=1, width=600.0, height=800.0, blocks=[Block(blockId="1:0", bbox=line.bbox, lines=[line])], suspiciousGaps=[])
            result = main._assemble_lines_with_gap_recovery(doc_state.doc, 1, page_blocks, [line], [line.text], check_leading_gap=True)
            assert result == line.text
        finally:
            client.post("/document/close", json={"documentId": doc_id})


# ----------------------------------------------------------------------------
# TRACK B
# ----------------------------------------------------------------------------


def _realistic_narrow_gap_pdf_bytes() -> bytes:
    """Section 16's own required fixture: a realistic gap width (~4.8pt) BELOW the
    `SUSPICIOUS_GAP_EM_MULTIPLIER (0.6) x font_size` threshold -- proves the NEW micro-gap
    path fires, not the old wide-gap `SuspiciousGap`-list path S1.1 already covered."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((50, 100), "The forest structural inputs to the GOMS model are shown in Table I.", fontsize=12)

    fs = 9.9626
    x, y = 50, 250
    t1 = "The model input solar zenith angle (39.31"
    page.insert_text((x, y), t1, fontsize=fs)
    x1_end = x + pymupdf.get_text_length(t1, fontsize=fs)
    gap = 4.8
    page.draw_rect(pymupdf.Rect(x1_end, y - 9, x1_end + gap, y + 1.5), color=(0, 0, 0), fill=(0, 0, 0))
    x2 = x1_end + gap

    t2 = ") and solar azimuth angle (154.32"
    page.insert_text((x2, y), t2, fontsize=fs)
    x2_end = x2 + pymupdf.get_text_length(t2, fontsize=fs)
    page.draw_rect(pymupdf.Rect(x2_end, y - 9, x2_end + gap, y + 1.5), color=(0, 0, 0), fill=(0, 0, 0))
    x3 = x2_end + gap

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


class TestTrackBMicroGapRecovery:
    def test_both_narrow_gaps_recovered_no_preceding_space(self, client, monkeypatch):
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
        document_id = _register(client, _realistic_narrow_gap_pdf_bytes())
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 200
            text = res.json()["reconstructedText"]
            assert "solar zenith angle (39.31°) and solar azimuth angle (154.32°) corresponded" in text
            assert text.count("°") == 2
            assert "39.31 °" not in text
            assert "154.32 °" not in text
            assert "and solar azimuth angle" in text
            assert text.count("solar zenith angle") == 1
            assert text.count("solar azimuth angle") == 1
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_ink_negative_twin_no_recovery_no_ocr(self, client, monkeypatch):
        def _fail_if_called(_png_bytes):
            raise AssertionError("SAME_LINE_FALSE_RECOVERY: OCR must never be called for an ink-negative micro-gap")

        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        page.insert_text((50, 100), "The forest structural inputs to the GOMS model are shown in Table I.", fontsize=12)
        fs = 9.9626
        x, y = 50, 250
        t1 = "The model input solar zenith angle (39.31"
        page.insert_text((x, y), t1, fontsize=fs)
        x1_end = x + pymupdf.get_text_length(t1, fontsize=fs)
        x2 = x1_end + 4.8
        t2 = ") and solar azimuth angle (154.32"
        page.insert_text((x2, y), t2, fontsize=fs)
        x2_end = x2 + pymupdf.get_text_length(t2, fontsize=fs)
        x3 = x2_end + 4.8
        t3 = ") corresponded to midday"
        page.insert_text((x3, y), t3, fontsize=fs)
        page.insert_text((50, 270), "(near solar noon) conditions near the peak of the growing", fontsize=12)
        page.insert_text((50, 290), "season for the Kananaskis region.", fontsize=12)
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        document_id = _register(client, buf.getvalue())
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 200
            text = res.json()["reconstructedText"]
            assert "°" not in text
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_ordinary_word_spacing_never_probed_as_micro_gap(self, client, monkeypatch):
        # Ordinary prose with normal word spacing must never trigger OCR merely because a
        # geometric gap exists between words.
        def _fail_if_called(_png_bytes):
            raise AssertionError("ordinary word spacing must never trigger OCR")

        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        page.insert_text((50, 100), "This is an entirely ordinary sentence with normal spacing throughout.", fontsize=12)
        page.insert_text((50, 130), "A second ordinary sentence follows immediately after this one here.", fontsize=12)
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        document_id = _register(client, buf.getvalue())
        try:
            res = client.post(
                "/layout/selection",
                json={
                    "documentId": document_id,
                    "start": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 100 / 800, "boundaryText": "This is an entirely ordinary sentence with normal spacing throughout.", "direction": "forward"},
                    "end": {"pageNumber": 1, "xNorm": 0.3, "yNorm": 130 / 800, "boundaryText": "A second ordinary sentence follows immediately after this one here.", "direction": "backward"},
                },
            )
            assert res.status_code == 200
        finally:
            client.post("/document/close", json={"documentId": document_id})
