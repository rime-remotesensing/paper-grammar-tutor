"""Prototype 2.6G2.8M2.2 -- authoritative scientific source reconstruction plumbing.

Live-traced root cause: `_extract_page_blocks` applies D3's suspect-native/superscript
recovery to `Line.text`, but for a selection whose boundary falls mid-line, that boundary
line's own contribution came ENTIRELY from the client's own (uncorrected) boundaryText --
D3's corrections never had a chance to reach it. `_prefer_trusted_line_text_for_boundary`
reconciles the two representations back into ONE authoritative text path.

Includes the mandatory end-to-end service-level fixture (item 11): the assertion hits the
actual `/layout/selection` HTTP response (`reconstructedText`/`Fragment.text`), the same
representation the web app itself consumes -- never just the helper function's own output.
"""

import io

import pymupdf
import pytest
from fastapi.testclient import TestClient

import main
from main import Block, Line, PageBlocks, Span, _prefer_trusted_line_text_for_boundary, _try_align_boundary_to_trusted_line


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


class TestTryAlignBoundaryToTrustedLine:
    def test_aligns_a_suffix_correcting_a_suspect_codepoint(self):
        trusted = "as t = 200,000 m², a = 5,000 m²"
        client_text = "as t \x02 200,000 m2, a \x02 5,000 m²"  # only the FIRST "=" and "m2" broken here
        result = _try_align_boundary_to_trusted_line(client_text, trusted, from_end=False)
        assert result == trusted[: len(client_text)]

    def test_aligns_a_prefix(self):
        trusted = "as t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10."
        client_text = "c \x02 0.3, and r \x02 10."
        result = _try_align_boundary_to_trusted_line(client_text, trusted, from_end=True)
        assert result == "c = 0.3, and r = 10."

    def test_returns_none_when_already_identical(self):
        trusted = "ordinary prose with no corrections needed"
        assert _try_align_boundary_to_trusted_line(trusted, trusted, from_end=False) is None

    def test_returns_none_when_boundary_longer_than_line(self):
        assert _try_align_boundary_to_trusted_line("way too long a string", "short", from_end=False) is None

    def test_abstains_on_a_structurally_different_string(self):
        trusted = "the parameters were determined as t = 200,000 m²"
        client_text = "a completely unrelated sentence with no relation at all"
        assert _try_align_boundary_to_trusted_line(client_text, trusted, from_end=False) is None

    def test_abstains_when_a_difference_is_outside_known_correction_classes(self):
        # A genuine ordinary typo/difference (not a suspect codepoint, not a digit-vs-
        # superscript pair) must never be silently overwritten.
        trusted = "the value was measured as k"
        client_text = "the value was measured as x"  # ordinary letter difference, not a D3 class
        assert _try_align_boundary_to_trusted_line(client_text, trusted, from_end=False) is None

    def test_accepts_multiple_corrections_in_one_boundary_string(self):
        trusted = "t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10."
        client_text = "t \x02 200,000 m2, a \x02 5,000 m2, c \x02 0.3, and r \x02 10."
        result = _try_align_boundary_to_trusted_line(client_text, trusted, from_end=False)
        assert result == trusted


class TestPreferTrustedLineTextForBoundary:
    def test_tries_suffix_then_prefix_and_returns_whichever_succeeds(self):
        own_line = Line(text="as t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10.", bbox=(0, 0, 1, 1), spans=[])
        # A PREFIX-shaped client boundary (start-of-line-to-click).
        client_text = "as t \x02 200,000 m2, a \x02 5,000 m2, c \x02 0.3,"
        result = _prefer_trusted_line_text_for_boundary(client_text, own_line)
        assert result == "as t = 200,000 m², a = 5,000 m², c = 0.3,"

    def test_falls_back_to_original_when_neither_alignment_succeeds(self):
        own_line = Line(text="an entirely unrelated trusted line", bbox=(0, 0, 1, 1), spans=[])
        client_text = "something that matches neither prefix nor suffix at all, ever"
        assert _prefer_trusted_line_text_for_boundary(client_text, own_line) == client_text

    def test_never_touches_ordinary_prose_with_no_corrections(self):
        own_line = Line(text="ordinary prose with no scientific content here", bbox=(0, 0, 1, 1), spans=[])
        client_text = "ordinary prose with no scientific"
        assert _prefer_trusted_line_text_for_boundary(client_text, own_line) == client_text


def _blank_pdf_bytes() -> bytes:
    doc = pymupdf.open()
    doc.new_page(width=600, height=800)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


class TestEndToEndServiceLevelReconstruction:
    """Item 11's mandatory end-to-end fixture: injects a hand-built, already-D3-corrected
    `PageBlocks` directly into the document's page cache (D3's OWN glyph-level correction
    logic is independently covered by test_suspect_native_recovery.py -- this test's only
    job is to prove the REAL `/layout/selection` endpoint's boundary-line handling actually
    surfaces that already-corrected text, not the client's raw uncorrected boundary text)."""

    def _register_with_precomputed_blocks(self, client, page_blocks: PageBlocks) -> str:
        document_id = client.post("/document/register", files={"file": ("blank.pdf", _blank_pdf_bytes(), "application/pdf")}).json()["documentId"]
        main.state.documents[document_id].page_cache[1] = page_blocks
        return document_id

    def test_parameter_sentence_reconstructs_with_corrected_equals_and_superscripts(self, client):
        line0 = Line(
            text="study (Deng et al. 2022), the parameters for the r.slopeunits algorithm were determined",
            bbox=(0.1, 0.10, 0.9, 0.15),
            spans=[Span(text="study (Deng et al. 2022), the parameters for the r.slopeunits algorithm were determined", bbox=(0.1, 0.10, 0.9, 0.15), size=10.0, font="Times-Roman")],
        )
        line1 = Line(
            text="as t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10. Eventually, more text follows",
            bbox=(0.1, 0.16, 0.9, 0.21),
            spans=[Span(text="as t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10. Eventually, more text follows", bbox=(0.1, 0.16, 0.9, 0.21), size=10.0, font="Times-Roman")],
        )
        block = Block(blockId="1:0", bbox=(0.1, 0.10, 0.9, 0.21), lines=[line0, line1])
        page_blocks = PageBlocks(pageNumber=1, width=600.0, height=800.0, blocks=[block], suspiciousGaps=[])
        document_id = self._register_with_precomputed_blocks(client, page_blocks)
        try:
            # The client's own (uncorrected) boundary text -- PDF.js decodes the SAME broken
            # MTSYN mapping, so it shows the identical defects as PyMuPDF's own pre-D3 text.
            client_start_boundary = "study (Deng et al. 2022), the parameters for the r.slopeunits algorithm were determined"
            client_end_boundary = "as t \x02 200,000 m2, a \x02 5,000 m2, c \x02 0.3, and r \x02 10."
            res = client.post(
                "/layout/selection",
                json={
                    "documentId": document_id,
                    "start": {"pageNumber": 1, "xNorm": 0.15, "yNorm": 0.12, "boundaryText": client_start_boundary, "direction": "forward"},
                    "end": {"pageNumber": 1, "xNorm": 0.5, "yNorm": 0.18, "boundaryText": client_end_boundary, "direction": "backward"},
                },
            )
            assert res.status_code == 200
            body = res.json()
            reconstructed = body["reconstructedText"]
            # This is the SAME representation the web app consumes -- not a helper-function
            # call, the actual SelectionResponse the endpoint returns.
            assert "t = 200,000 m²" in reconstructed
            assert "a = 5,000 m²" in reconstructed
            assert "c = 0.3" in reconstructed
            assert "r = 10" in reconstructed
            assert "\x02" not in reconstructed
            assert "m2," not in reconstructed  # the uncorrected baseline-digit form must be gone
            assert body["fragments"][0]["text"] == reconstructed
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_all_four_assignments_independently_present_with_no_duplication(self, client):
        line0 = Line(
            text="study (Deng et al. 2022), the parameters for the algorithm were determined",
            bbox=(0.1, 0.10, 0.9, 0.15),
            spans=[Span(text="study (Deng et al. 2022), the parameters for the algorithm were determined", bbox=(0.1, 0.10, 0.9, 0.15), size=10.0, font="Times-Roman")],
        )
        line1 = Line(
            text="as t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10. Eventually, more text follows",
            bbox=(0.1, 0.16, 0.9, 0.21),
            spans=[Span(text="as t = 200,000 m², a = 5,000 m², c = 0.3, and r = 10. Eventually, more text follows", bbox=(0.1, 0.16, 0.9, 0.21), size=10.0, font="Times-Roman")],
        )
        block = Block(blockId="1:0", bbox=(0.1, 0.10, 0.9, 0.21), lines=[line0, line1])
        page_blocks = PageBlocks(pageNumber=1, width=600.0, height=800.0, blocks=[block], suspiciousGaps=[])
        document_id = self._register_with_precomputed_blocks(client, page_blocks)
        try:
            res = client.post(
                "/layout/selection",
                json={
                    "documentId": document_id,
                    "start": {
                        "pageNumber": 1, "xNorm": 0.15, "yNorm": 0.12,
                        "boundaryText": "study (Deng et al. 2022), the parameters for the algorithm were determined", "direction": "forward",
                    },
                    "end": {
                        "pageNumber": 1, "xNorm": 0.5, "yNorm": 0.18,
                        "boundaryText": "as t \x02 200,000 m2, a \x02 5,000 m2, c \x02 0.3, and r \x02 10.", "direction": "backward",
                    },
                },
            )
            assert res.status_code == 200
            reconstructed = res.json()["reconstructedText"]
            for fragment in ["t = 200,000 m²", "a = 5,000 m²", "c = 0.3", "r = 10"]:
                assert reconstructed.count(fragment) == 1, f"{fragment!r} must appear exactly once"
        finally:
            client.post("/document/close", json={"documentId": document_id})
