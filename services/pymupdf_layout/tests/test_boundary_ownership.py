"""Prototype 2.6G2.8D1 -- server-side boundary-ownership clipping
(`_clip_forward_boundary_overreach` / `_clip_backward_boundary_overreach` /
`_line_texts_with_boundary` in main.py).

Root cause (live-traced, 2.6G2.8C): a client-supplied boundary string can, due to a DOM
line-boundary detection gap on an extraction-invisible glyph (now separately fixed client-side
in PdfViewer.tsx's `extractWithinLine`), already contain an entire SUBSEQUENT trusted line's
own text glued onto the boundary line. `_line_texts_with_boundary` used to substitute that
string verbatim for the boundary line with no validation, so the same trusted line's content
was later emitted a second time as its own normal contribution -- the exact observed
duplication ("k values, the denominator is increased and" reappearing).

These are pure-function tests -- no PDF/FastAPI fixture needed, matching this suite's own
"pure-function tests always run in CI" convention (see test_equation_guard.py's own docstring).
"""

import io

import pymupdf
import pytest
from fastapi.testclient import TestClient

import main
from main import Line, Span, _clip_backward_boundary_overreach, _clip_forward_boundary_overreach, _line_texts_with_boundary


def _line(text: str) -> Line:
    """A minimal trusted Line -- bbox/spans are never read by the ownership-clip functions
    under test, only `.text`, so dummy-but-valid values are enough."""
    return Line(text=text, bbox=(0.0, 0.0, 1.0, 1.0), spans=[Span(text=text, bbox=(0.0, 0.0, 1.0, 1.0), size=12.0, font="dummy")])


class TestClipForwardBoundaryOverreach:
    def test_exact_traced_shape_clips_to_just_the_boundary_lines_own_content(self):
        overreaching = "In the case of lower values, the denominator is increased and"
        subsequent = [_line("values, the denominator is increased and"), _line("counteracts the overcorrection that occurs when the incidence")]
        assert _clip_forward_boundary_overreach(overreaching, subsequent) == "In the case of lower"

    def test_no_overreach_leaves_the_boundary_text_untouched(self):
        boundary = "In the case of lower"
        subsequent = [_line("values, the denominator is increased and")]
        assert _clip_forward_boundary_overreach(boundary, subsequent) == boundary

    def test_stops_at_the_first_non_matching_line_never_searches_ahead(self):
        # Overreaches into line 1 but NOT line 2 -- only line 1's content must be clipped;
        # the walk must stop there, never skip ahead searching for a match further out.
        overreaching = "start of clause values, the denominator is increased and"
        subsequent = [_line("values, the denominator is increased and"), _line("something entirely unrelated that never appears in boundary_text")]
        assert _clip_forward_boundary_overreach(overreaching, subsequent) == "start of clause"

    def test_overreach_spanning_two_consecutive_lines_clips_both_in_order(self):
        overreaching = "start of clause line one text line two text"
        subsequent = [_line("line one text"), _line("line two text")]
        assert _clip_forward_boundary_overreach(overreaching, subsequent) == "start of clause"

    def test_legitimate_repeated_phrase_that_is_not_an_exact_trailing_match_is_left_alone(self):
        # Prototype 2.6G2.8D1 item 11's required negative: repeated wording across two real,
        # independent lines must never be treated as an ownership overlap.
        boundary = "The value was measured"
        subsequent = [_line("The value was measured again")]
        assert _clip_forward_boundary_overreach(boundary, subsequent) == boundary

    def test_empty_subsequent_line_list_is_a_no_op(self):
        boundary = "In the case of lower"
        assert _clip_forward_boundary_overreach(boundary, []) == boundary

    def test_does_not_clip_past_an_empty_result(self):
        # If clipping a line would consume the entire boundary text, stop there rather than
        # continuing to check further lines against an empty/blank remainder.
        overreaching = "values, the denominator is increased and"
        subsequent = [_line("values, the denominator is increased and"), _line("counteracts the overcorrection")]
        assert _clip_forward_boundary_overreach(overreaching, subsequent) == ""


class TestClipBackwardBoundaryOverreach:
    def test_mirror_shape_clips_a_leading_overreach_into_a_preceding_line(self):
        overreaching = "counteracts the overcorrection that occurs when the incidence angle approaches 90"
        # preceding_lines is in REVERSE reading order (immediately-before line first).
        preceding = [_line("counteracts the overcorrection that occurs when the incidence")]
        assert _clip_backward_boundary_overreach(overreaching, preceding) == "angle approaches 90"

    def test_no_overreach_leaves_the_boundary_text_untouched(self):
        boundary = "angle approaches 90"
        preceding = [_line("counteracts the overcorrection that occurs when the incidence")]
        assert _clip_backward_boundary_overreach(boundary, preceding) == boundary

    def test_legitimate_repeated_phrase_negative(self):
        boundary = "was measured again."
        preceding = [_line("The value was measured")]
        assert _clip_backward_boundary_overreach(boundary, preceding) == boundary


class TestLineTextsWithBoundaryIsPlainSubstitution:
    """Prototype 2.6G2.8D1 (post block-scoping fix): `_line_texts_with_boundary` itself no
    longer clips -- it only knows about ONE block's own `lines`, which is not enough context
    to safely clip an overreach that spans into a DIFFERENT block (the traced live bug's exact
    shape -- see `_layout_selection_impl`'s own call site, which now clips against the full
    cross-block `combined_lines` sequence BEFORE calling this function). These tests confirm
    the substitution contract alone; the clip-then-substitute call pattern is exercised by
    `TestCrossBlockOwnershipEndToEnd` below, against the actual HTTP endpoint."""

    def test_forward_direction_is_plain_substitution(self):
        lines = [_line("In the case of lower"), _line("values, the denominator is increased and")]
        result = _line_texts_with_boundary(lines, "already clipped by the caller", "forward")
        assert result == ["already clipped by the caller", "values, the denominator is increased and"]

    def test_backward_direction_is_plain_substitution(self):
        lines = [_line("In the case of lower"), _line("values, the denominator is increased and")]
        result = _line_texts_with_boundary(lines, "already clipped by the caller", "backward")
        assert result == ["In the case of lower", "already clipped by the caller"]

    def test_empty_lines_list_returns_empty(self):
        assert _line_texts_with_boundary([], "anything", "forward") == []

    def test_single_line_selection_is_unaffected(self):
        lines = [_line("Using these values, the method was applied.")]
        boundary = "the method was applied."
        result = _line_texts_with_boundary(lines, boundary, "forward")
        assert result == ["the method was applied."]


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def _cross_block_multiline_pdf_bytes() -> bytes:
    """Prototype 2.6G2.8D1 regression fixture -- reproduces the EXACT structural shape of the
    real traced live bug (2.6G2.8C): the selection's START endpoint resolves into a block that
    is only ONE line long ("In the case of lower"), while the very next trusted line
    ("values, the denominator is increased and") belongs to a DIFFERENT block entirely (a
    well-separated `insert_text` call, mirroring how the real academic PDF's own paragraph
    happened to be split across two native PyMuPDF blocks). This is exactly the shape a
    per-block-scoped clip (checking only `first_block`'s own `lines`) cannot see, and only a
    clip against the true combined cross-block sequence catches.
    """
    doc = pymupdf.open()
    page = doc.new_page(width=400, height=600)
    page.insert_text((50, 100), "In the case of lower", fontsize=12)
    # Well-separated from the block above, and an embedded "\n" (not three separate
    # insert_text calls, each of which PyMuPDF gives its own block) so this becomes ONE
    # multi-line block -- the exact real shape (a single trusted line's own block containing
    # several visual lines) the traced live bug needed a cross-block-scoped clip to catch.
    page.insert_text(
        (50, 250),
        "values, the denominator is increased and\ncounteracts the overcorrection that occurs\nwhen the incidence angle approaches ninety.",
        fontsize=12,
    )
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


class TestCrossBlockOwnershipEndToEnd:
    """True end-to-end regression (through the actual /layout/selection HTTP endpoint) for
    Prototype 2.6G2.8D1 -- this is the level the original bug actually lived at; the earlier
    pure-function tests alone would NOT have caught the block-scoping gap this class exists to
    guard against."""

    def test_overreaching_start_boundary_across_a_block_seam_is_clipped_no_duplication(self, client):
        document_id = client.post(
            "/document/register", files={"file": ("cross_block.pdf", _cross_block_multiline_pdf_bytes(), "application/pdf")}
        ).json()["documentId"]
        try:
            # Simulates the real live client bug: the START boundary text already contains
            # the NEXT block's own first line glued onto the click line's own text.
            overreaching_start = "In the case of lower values, the denominator is increased and"
            res = client.post(
                "/layout/selection",
                json={
                    "documentId": document_id,
                    "start": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 100 / 600, "boundaryText": overreaching_start, "direction": "forward"},
                    "end": {
                        "pageNumber": 1,
                        "xNorm": 0.12,
                        "yNorm": 278 / 600,
                        "boundaryText": "when the incidence angle approaches ninety.",
                        "direction": "backward",
                    },
                },
            )
            assert res.status_code == 200
            body = res.json()
            assert body["sameBlock"] is False
            reconstructed = body["reconstructedText"]
            # The exact target shape (2.6G2.8D1 item 15/18): "k" is not part of this synthetic
            # fixture (no OCR/gap involved here -- this fixture isolates the ownership-overlap
            # mechanism only), but the duplication/ordering invariant is identical.
            assert reconstructed == (
                "In the case of lower\n"
                "values, the denominator is increased and\n"
                "counteracts the overcorrection that occurs\n"
                "when the incidence angle approaches ninety."
            )
            # PDF_SELECTION_TOKEN_DUPLICATION = 0
            assert reconstructed.count("values, the denominator is increased and") == 1
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_non_overreaching_boundaries_are_completely_unaffected(self, client):
        document_id = client.post(
            "/document/register", files={"file": ("cross_block.pdf", _cross_block_multiline_pdf_bytes(), "application/pdf")}
        ).json()["documentId"]
        try:
            res = client.post(
                "/layout/selection",
                json={
                    "documentId": document_id,
                    "start": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 100 / 600, "boundaryText": "In the case of lower", "direction": "forward"},
                    "end": {
                        "pageNumber": 1,
                        "xNorm": 0.12,
                        "yNorm": 278 / 600,
                        "boundaryText": "when the incidence angle approaches ninety.",
                        "direction": "backward",
                    },
                },
            )
            assert res.status_code == 200
            assert res.json()["reconstructedText"] == (
                "In the case of lower\n"
                "values, the denominator is increased and\n"
                "counteracts the overcorrection that occurs\n"
                "when the incidence angle approaches ninety."
            )
        finally:
            client.post("/document/close", json={"documentId": document_id})
