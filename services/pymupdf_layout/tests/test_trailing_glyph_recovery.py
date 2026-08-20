"""Prototype 2.6G2.8D2 -- TYPE C (trailing/edge) missing-glyph recovery
(`_find_trailing_adjacent_line`, and the trailing-gap block appended to
`_assemble_lines_with_gap_recovery`).

Root cause (live-traced, 2.6G2.8D2 item 3): the real "90°." case is NOT the same class of bug
as D1's "k" duplication. PyMuPDF's own rawdict character stream for the trusted line "angle
approaches 90" ends exactly at "0" -- no degree symbol, no period, nothing further at all. The
period the user sees is genuinely native, correctly-extracted PyMuPDF text -- it just belongs
to a DIFFERENT, immediately-adjacent block ("`. In several studies, the Minnaert correc-`")
that the selection's own end-line resolution never looks at, because the existing gap-
detection loop only ever pairs CONSECUTIVE lines already inside the one selection's own
assembled `lines` list -- the last line has no `lines[i+1]` to check against at all. The
missing glyph ("°") sits in the small gap between the trusted end-line's own last character
and that adjacent block's own first character.

These are synthetic-PDF/mocked-OCR tests (no external fixture PDF or running Paddle service
needed), matching this suite's own established convention (see test_equation_guard.py).
"""

import io

import pymupdf
import pytest
from fastapi.testclient import TestClient

import main
from main import Line, PageBlocks, _find_trailing_adjacent_line


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def _trailing_gap_pdf_bytes() -> bytes:
    """Mirrors the real traced "90°." shape at a much smaller scale: a multi-line block
    ending in "...angle approaches 90" (no punctuation of its own), a real drawn ink mark
    (never depending on OCR recognizing a specific character, matching test_equation_guard.py's
    own "leftpart"/"rightpart" convention) standing in for the missing glyph, and a SEPARATE
    adjacent block starting with ". Next sentence begins here." immediately to its right on
    the same row -- exactly the real "angle approaches 90[°]. In several studies..." shape.
    """
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((50, 100), "In the case of lower", fontsize=12)
    page.insert_text(
        (50, 250),
        "values, the denominator is increased and\ncounteracts the overcorrection that occurs\nwhen the incidence angle approaches 90",
        fontsize=12,
    )
    page.draw_rect(pymupdf.Rect(279, 275, 289, 286), color=(0, 0, 0), fill=(0, 0, 0))
    page.insert_text((300, 286.5), ". Next sentence begins here.", fontsize=12)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _register(client, pdf_bytes: bytes = None) -> str:
    return client.post(
        "/document/register", files={"file": ("trailing.pdf", pdf_bytes or _trailing_gap_pdf_bytes(), "application/pdf")}
    ).json()["documentId"]


def _select_full_target(client, document_id: str, end_boundary: str = "when the incidence angle approaches 90"):
    return client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 100 / 800, "boundaryText": "In the case of lower", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.3, "yNorm": 278 / 800, "boundaryText": end_boundary, "direction": "backward"},
        },
    )


class TestTrailingGapRecoveryEndToEnd:
    def test_ink_positive_trailing_gap_recovered_with_mocked_ocr(self, client, monkeypatch):
        def _fake_ocr(_png_bytes):
            return [{"text": "when the incidence angle approaches 90°. Next sentence begins here.", "confidence": 0.97}]

        monkeypatch.setattr(main, "_call_paddle_ocr", _fake_ocr)
        document_id = _register(client)
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 200
            reconstructed = res.json()["reconstructedText"]
            assert reconstructed.endswith("angle approaches 90°")
            # SCIENTIFIC_OPERATOR_DUPLICATION / no accidental inclusion of the adjacent,
            # unselected next sentence.
            assert "Next sentence" not in reconstructed
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_recovered_glyph_is_spliced_at_the_gap_not_appended_at_the_string_end(self, client, monkeypatch):
        """Regression for a live-caught splice-position bug: the client's own boundary text
        (unlike the pure trusted-line-text case above) typically already carries a
        placeholder whitespace character standing in for the very glyph being recovered
        (pdf.js's own fallback for an unmapped glyph) -- e.g. "angle approaches 90 ." for the
        real "90°." case. Appending the recovered glyph at the end of that string produced
        the wrong "90 .°" the first time this was live-verified; the fix inserts it
        immediately after the trusted prefix and consumes exactly the one placeholder space."""

        def _fake_ocr(_png_bytes):
            return [{"text": "when the incidence angle approaches 90°. Next sentence begins here.", "confidence": 0.97}]

        monkeypatch.setattr(main, "_call_paddle_ocr", _fake_ocr)
        document_id = _register(client)
        try:
            # The client's own boundary text: trusted prefix + a placeholder space (standing
            # in for the missing "°") + the real, correctly-extracted trailing period.
            res = _select_full_target(client, document_id, end_boundary="when the incidence angle approaches 90 .")
            assert res.status_code == 200
            reconstructed = res.json()["reconstructedText"]
            assert reconstructed.endswith("angle approaches 90°.")
            assert "90 .°" not in reconstructed
            assert "90°." in reconstructed
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_ocr_unavailable_abstains_never_blocks_the_whole_selection(self, client, monkeypatch):
        # Prototype 2.6G2.8D2's deliberate divergence from the inter-line case (item 14):
        # the adjacent line sits OUTSIDE the user's own selected line sequence, so an
        # unrecoverable trailing candidate must not fail the whole request.
        monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png_bytes: None)
        document_id = _register(client)
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 200
            reconstructed = res.json()["reconstructedText"]
            assert reconstructed.endswith("angle approaches 90")
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_ocr_low_confidence_abstains(self, client, monkeypatch):
        def _low_confidence_ocr(_png_bytes):
            return [{"text": "angle approaches 90°. Next sentence begins here.", "confidence": 0.2}]

        monkeypatch.setattr(main, "_call_paddle_ocr", _low_confidence_ocr)
        document_id = _register(client)
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 200
            assert res.json()["reconstructedText"].endswith("angle approaches 90")
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_anchors_not_found_in_ocr_text_abstains(self, client, monkeypatch):
        def _unrelated_ocr(_png_bytes):
            return [{"text": "completely unrelated OCR misread", "confidence": 0.99}]

        monkeypatch.setattr(main, "_call_paddle_ocr", _unrelated_ocr)
        document_id = _register(client)
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 200
            assert res.json()["reconstructedText"].endswith("angle approaches 90")
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_no_ocr_call_at_all_when_no_ink_is_actually_present(self, client, monkeypatch):
        """False-positive control (item 13): an ordinary, small, non-suspicious same-row gap
        with NO drawn ink at all must never trigger OCR."""

        def _fail_if_called(_png_bytes):
            raise AssertionError("OCR should never be called for a genuinely blank gap")

        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        page.insert_text((50, 100), "In the case of lower", fontsize=12)
        page.insert_text(
            (50, 250),
            "values, the denominator is increased and\ncounteracts the overcorrection that occurs\nwhen the incidence angle approaches 90",
            fontsize=12,
        )
        # No ink drawn in the gap this time -- ordinary trailing whitespace only.
        page.insert_text((300, 286.5), ". Next sentence begins here.", fontsize=12)
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        document_id = _register(client, buf.getvalue())
        try:
            res = _select_full_target(client, document_id)
            assert res.status_code == 200
            assert res.json()["reconstructedText"].endswith("angle approaches 90")
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_no_adjacent_line_at_all_is_a_no_op(self, client, monkeypatch):
        """A selection whose end-line genuinely has nothing after it at all (real end of
        document/column) must not error or attempt any recovery."""

        def _fail_if_called(_png_bytes):
            raise AssertionError("OCR should never be called when there is no adjacent line")

        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        page.insert_text((50, 100), "In the case of lower", fontsize=12)
        page.insert_text((50, 250), "values, the denominator is increased and\nthis is the final line of the document.", fontsize=12)
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        document_id = _register(client, buf.getvalue())
        try:
            res = client.post(
                "/layout/selection",
                json={
                    "documentId": document_id,
                    "start": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 100 / 800, "boundaryText": "In the case of lower", "direction": "forward"},
                    "end": {
                        "pageNumber": 1,
                        "xNorm": 0.3,
                        "yNorm": 267 / 800,
                        "boundaryText": "this is the final line of the document.",
                        "direction": "backward",
                    },
                },
            )
            assert res.status_code == 200
        finally:
            client.post("/document/close", json={"documentId": document_id})


def _line(text: str, bbox: tuple[float, float, float, float]) -> Line:
    return Line(text=text, bbox=bbox, spans=[])


class TestFindTrailingAdjacentLinePureFunction:
    def test_finds_the_immediately_following_line_on_the_same_row(self):
        target = _line("angle approaches 90", (0.10, 0.30, 0.40, 0.33))
        adjacent = _line(". Next sentence.", (0.41, 0.30, 0.60, 0.33))
        page_blocks = PageBlocks(pageNumber=1, width=600, height=800, blocks=[
            main.Block(blockId="a", bbox=target.bbox, lines=[target]),
            main.Block(blockId="b", bbox=adjacent.bbox, lines=[adjacent]),
        ])
        result = _find_trailing_adjacent_line(page_blocks, target)
        assert result is adjacent

    def test_ignores_a_line_on_a_different_row(self):
        target = _line("angle approaches 90", (0.10, 0.30, 0.40, 0.33))
        different_row = _line("Unrelated header text", (0.10, 0.05, 0.40, 0.08))
        page_blocks = PageBlocks(pageNumber=1, width=600, height=800, blocks=[
            main.Block(blockId="a", bbox=target.bbox, lines=[target]),
            main.Block(blockId="b", bbox=different_row.bbox, lines=[different_row]),
        ])
        assert _find_trailing_adjacent_line(page_blocks, target) is None

    def test_ignores_a_line_to_the_left(self):
        target = _line("angle approaches 90", (0.30, 0.30, 0.60, 0.33))
        to_the_left = _line("Some earlier text", (0.05, 0.30, 0.29, 0.33))
        page_blocks = PageBlocks(pageNumber=1, width=600, height=800, blocks=[
            main.Block(blockId="a", bbox=target.bbox, lines=[target]),
            main.Block(blockId="b", bbox=to_the_left.bbox, lines=[to_the_left]),
        ])
        assert _find_trailing_adjacent_line(page_blocks, target) is None

    def test_returns_the_closest_of_several_candidates(self):
        target = _line("angle approaches 90", (0.10, 0.30, 0.40, 0.33))
        far = _line("Far away text", (0.70, 0.30, 0.90, 0.33))
        near = _line(". Next sentence.", (0.41, 0.30, 0.60, 0.33))
        page_blocks = PageBlocks(pageNumber=1, width=600, height=800, blocks=[
            main.Block(blockId="a", bbox=target.bbox, lines=[target]),
            main.Block(blockId="b", bbox=far.bbox, lines=[far]),
            main.Block(blockId="c", bbox=near.bbox, lines=[near]),
        ])
        assert _find_trailing_adjacent_line(page_blocks, target) is near

    def test_returns_none_with_no_candidates_at_all(self):
        target = _line("angle approaches 90", (0.10, 0.30, 0.40, 0.33))
        page_blocks = PageBlocks(pageNumber=1, width=600, height=800, blocks=[main.Block(blockId="a", bbox=target.bbox, lines=[target])])
        assert _find_trailing_adjacent_line(page_blocks, target) is None
