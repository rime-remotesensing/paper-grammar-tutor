"""Prototype 2.5L -- tests for the two independent fixes found during 2.5J live
acceptance (see docs/design-notes.md, "Prototype 2.5K"/"Prototype 2.5L", for the real
Soenen failures these were built from):

- Part A: parenthesized inline glyph recovery -- a vector-only glyph tightly hugged by
  round parentheses (e.g. "(b)") produces a gap narrower than the existing em-multiplier
  candidacy rule requires. Synthetic-PDF/mocked-OCR integration tests live here; the
  pure-function _detect_suspicious_gaps tests live in test_equation_guard.py; the real
  Soenen "(a)"/"(b)"/"(i)" regression (real Paddle) is in test_fixtures.py.
- Part B: display-equation region suppression -- a numbered display equation's own
  extractable formula-body fragments (e.g. the real Soenen equation (9)'s two "C" symbols)
  must never leak into reconstructed prose; the whole equation contributes exactly one
  "[式 (N)]" placeholder. Synthetic-PDF tests live here; the real Soenen equation (8)/(9)
  regression is in test_fixtures.py.
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


def _norm(x, y, width=700.0, height=800.0):
    return x / width, y / height


# --- Part A: parenthesized inline glyph recovery (real PDF pixels + hand-built PageBlocks) --
#
# The ink-gate needs REAL rendered pixels, so these still use a real PDF page -- but (see
# the Part B note above) a hand-built `PageBlocks` is injected for the text/geometry side,
# giving exact, reliable control over span text/positions independent of PyMuPDF's own
# block-merging behavior for freshly-synthesized text.


def _paren_span(text: str, x0: float, y0: float, x1: float, y1: float) -> "main.Span":
    return main.Span(text=text, bbox=(x0 / 700.0, y0 / 800.0, x1 / 700.0, y1 / 800.0), size=12.0, font="synthetic")


def _paren_gap_pdf_and_blocks(draw_ink: bool):
    """Builds a real PDF page with "(" ... ")" drawn with a real, measured gap between them
    (ink drawn in the gap iff `draw_ink`), plus a hand-built PageBlocks with matching exact
    geometry -- "(" and ")" as two separate one-line blocks on the same row, mirroring the
    real Soenen shape (block 3:1 ending in "(", block 3:3/3:5 starting with ")")."""
    doc = pymupdf.open()
    page = doc.new_page(width=700, height=800)
    fontsize = 12.0
    left_text = "The intercept ("
    right_text = ") is shown."
    x0 = 50.0
    left_width = pymupdf.get_text_length(left_text, fontsize=fontsize)
    gap = 5.0  # pt -- above SUSPICIOUS_GAP_MIN_PT (2.0), below the em-multiplier requirement (7.2)
    right_x0 = x0 + left_width + gap
    page.insert_text((x0, 100), left_text, fontsize=fontsize)
    page.insert_text((right_x0, 100), right_text, fontsize=fontsize)
    if draw_ink:
        page.draw_line(pymupdf.Point(x0 + left_width + 1, 101), pymupdf.Point(right_x0 - 1, 93), color=(0, 0, 0), width=2.0)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()

    y0, y1 = 100 - 9.62, 100 + 2.4  # matches PyMuPDF's own ascent/descent for this fontsize closely enough
    left_bbox = (x0 / 700.0, y0 / 800.0, (x0 + left_width) / 700.0, y1 / 800.0)
    right_bbox = (right_x0 / 700.0, y0 / 800.0, (right_x0 + pymupdf.get_text_length(right_text, fontsize=fontsize)) / 700.0, y1 / 800.0)
    blocks = [
        main.Block(blockId="1:0", bbox=left_bbox, lines=[main.Line(text=left_text, bbox=left_bbox, spans=[_paren_span(left_text, x0, y0, x0 + left_width, y1)])]),
        main.Block(
            blockId="1:1", bbox=right_bbox, lines=[main.Line(text=right_text, bbox=right_bbox, spans=[_paren_span(right_text, right_x0, y0, right_x0 + (right_bbox[2] - right_bbox[0]) * 700.0, y1)])]
        ),
    ]
    raw_spans = [
        {"x0": x0, "y0": y0, "x1": x0 + left_width, "y1": y1, "size": fontsize, "text": left_text},
        {"x0": right_x0, "y0": y0, "x1": right_x0 + pymupdf.get_text_length(right_text, fontsize=fontsize), "y1": y1, "size": fontsize, "text": right_text},
    ]
    suspicious_gaps = main._detect_suspicious_gaps(raw_spans, 700.0, 800.0)
    page_blocks = main.PageBlocks(pageNumber=1, width=700.0, height=800.0, blocks=blocks, suspiciousGaps=suspicious_gaps)
    return buf.getvalue(), page_blocks


@pytest.fixture()
def paren_ink_doc(client):
    pdf_bytes, page_blocks = _paren_gap_pdf_and_blocks(draw_ink=True)
    res = client.post("/document/register", files={"file": ("paren.pdf", pdf_bytes, "application/pdf")})
    assert res.status_code == 200
    doc_id = res.json()["documentId"]
    main.state.documents[doc_id].page_cache[1] = page_blocks
    yield doc_id
    client.post("/document/close", json={"documentId": doc_id})


@pytest.fixture()
def paren_no_ink_doc(client):
    pdf_bytes, page_blocks = _paren_gap_pdf_and_blocks(draw_ink=False)
    res = client.post("/document/register", files={"file": ("paren.pdf", pdf_bytes, "application/pdf")})
    assert res.status_code == 200
    doc_id = res.json()["documentId"]
    main.state.documents[doc_id].page_cache[1] = page_blocks
    yield doc_id
    client.post("/document/close", json={"documentId": doc_id})


def test_parenthesized_gap_is_a_real_candidate_with_ink(paren_ink_doc):
    page_blocks = main._extract_page_blocks(paren_ink_doc, 1)
    assert len(page_blocks.suspiciousGaps) == 1


def test_parenthesized_glyph_recovered_with_mocked_ocr(client, paren_ink_doc, monkeypatch):
    def _fake_ocr(_png_bytes):
        return [{"text": "The intercept (a) is shown.", "confidence": 0.99}]

    monkeypatch.setattr(main, "_call_paddle_ocr", _fake_ocr)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": paren_ink_doc,
            "start": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 0.125, "boundaryText": "The intercept (", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.4, "yNorm": 0.125, "boundaryText": ") is shown.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    # Prototype 2.5N item 19: tight-joined, source-faithful -- "(a)", never "( a )".
    assert body["reconstructedText"] == "The intercept (a) is shown."


def test_parenthesized_glyph_recovered_with_browser_style_fused_boundary_text(client, paren_ink_doc, monkeypatch):
    """Prototype 2.5O: the real live-reported failure -- a genuine browser drag's own
    boundaryText capture (see src/features/pdf/components/PdfViewer.tsx's
    `extractWithinLine`) walks the PDF.js DOM forward from the click point to the next
    `<br>`; since the invisible glyph produces literally zero DOM node, this legitimately
    fuses "(" and ")" together and continues onto whatever further same-row text follows --
    here, simulating that shape directly: `boundaryText` is "The intercept () is shown."
    (parens already fused, "is shown." already absorbed from what PyMuPDF itself extracts as
    the SECOND block's own text) rather than the idealized "The intercept (" the other test
    above uses. Must still recover to "The intercept (a) is shown." -- not the corrupted
    "The intercept () is shown. a is shown." shape this exact bug produced live."""

    def _fake_ocr(_png_bytes):
        return [{"text": "The intercept (a) is shown.", "confidence": 0.99}]

    monkeypatch.setattr(main, "_call_paddle_ocr", _fake_ocr)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": paren_ink_doc,
            "start": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 0.125, "boundaryText": "The intercept () is shown.", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.4, "yNorm": 0.125, "boundaryText": ") is shown.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reconstructedText"] == "The intercept (a) is shown."


def test_parenthesized_glyph_recovered_with_whitespace_fused_boundary_text(client, paren_ink_doc, monkeypatch):
    """Prototype 2.5P/2.5Q: the LITERAL captured browser request (Prototype 2.5P's
    `PGT_LAYOUT_TRACE=1` trace) proved 2.5O's own "zero characters between the parens"
    assumption was still wrong -- PDF.js's own text-layer DOM renders the invisible glyph's
    gap as an actual SPACE character: "The intercept ( ) is shown.", not "The intercept ()
    is shown.". Must still recover to "The intercept (a) is shown." -- the fused-paren
    detection must tolerate whitespace of any length between the two trusted parens, not
    just an exact zero-width match."""

    def _fake_ocr(_png_bytes):
        return [{"text": "The intercept (a) is shown.", "confidence": 0.99}]

    monkeypatch.setattr(main, "_call_paddle_ocr", _fake_ocr)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": paren_ink_doc,
            "start": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 0.125, "boundaryText": "The intercept ( ) is shown.", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.4, "yNorm": 0.125, "boundaryText": ") is shown.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reconstructedText"] == "The intercept (a) is shown."


def test_empty_parentheses_with_no_ink_never_invents_a_glyph(client, paren_no_ink_doc, monkeypatch):
    # Item 10/15: a real gap exists between "(" and ")" geometrically, but nothing is drawn
    # there -- the visual-ink gate must still classify it negative and drop it silently,
    # exactly as for the ordinary rule. No warning, no OCR call.
    def _fail_if_called(_png_bytes):
        raise AssertionError("OCR must never be called for a visual-ink-negative candidate, even inside parens")

    monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": paren_no_ink_doc,
            "start": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 0.125, "boundaryText": "The intercept (", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.4, "yNorm": 0.125, "boundaryText": ") is shown.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reconstructedText"] == "The intercept (\n) is shown."


def test_contiguous_parenthesized_marker_never_becomes_a_candidate():
    # Item 16/17: "(a)" already extracted as ONE span (a caption/list marker, no missing
    # glyph at all) -- pure-function check that a single contiguous span produces no
    # suspicious gap at all (nothing to split "(" and ")" apart).
    raw_spans = [{"x0": 50.0, "y0": 100.0, "x1": 90.0, "y1": 112.0, "size": 12.0, "text": "(a) Forest stand on sloped terrain."}]
    gaps = main._detect_suspicious_gaps(raw_spans, width=700.0, height=800.0)
    assert gaps == []


def test_citation_brackets_never_trigger_parenthesized_rule():
    # Item 18: square-bracket citations must never trigger the round-paren rule.
    raw_spans = [
        {"x0": 50.0, "y0": 100.0, "x1": 90.0, "y1": 112.0, "size": 12.0, "text": "See citation ["},
        {"x0": 96.0, "y0": 100.0, "x1": 110.0, "y1": 112.0, "size": 12.0, "text": "] here."},
    ]
    gaps = main._detect_suspicious_gaps(raw_spans, width=700.0, height=800.0)
    assert gaps == []


# --- Part B: display-equation region suppression (hand-built PageBlocks) -------------------
#
# PyMuPDF's own block-segmentation heuristic for a freshly-synthesized PDF turns out to
# merge adjacent short insert_text() calls (e.g. "C" and "(11)") into ONE block/multiple
# LINES far more readily than the real Soenen PDF's own content-stream structure does --
# empirically fragile to control via coordinates alone. Since `_display_equation_region_blocks`
# and `_resolve_cross_equation_continuation` only ever consume already-built `Block`/`Line`
# objects (never PyMuPDF's raw dict directly), these tests inject a hand-built `PageBlocks`
# straight into the document's page cache instead -- exact, deterministic control over block
# geometry, exercising the exact same production code path real requests use.


def _blank_pdf_bytes() -> bytes:
    doc = pymupdf.open()
    doc.new_page(width=700, height=800)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _line(text: str, bbox) -> "main.Line":
    return main.Line(text=text, bbox=bbox, spans=[main.Span(text=text, bbox=bbox, size=10.0, font="synthetic")])


def _equation_region_page_blocks() -> "main.PageBlocks":
    """Mirrors the real Soenen equation (8)/(9) shape, in normalized (0-1) coordinates on a
    700x800 page:
    - block 0: before-prose "Prose before the first equation continues here."
    - block 1/2: "C" (fragment, same row) / "(11)" -- the eq(8)-shaped case.
    - block 3: between-prose "and some prose between the two equations."
    - block 4/5/6: "C" (above) / "(12)" / "C" (below) -- the eq(9)-shaped case.
    - block 7: after-prose "After prose following the second equation."
    - block 8: a DIFFERENT-corridor "C", vertically near (12)'s own row but far to the left --
      must never be swept into (12)'s region (item 24/34).
    """
    blocks = [
        main.Block(blockId="1:0", bbox=(0.43, 0.10, 0.78, 0.13), lines=[_line("Prose before the first equation continues here.", (0.43, 0.10, 0.78, 0.13))]),
        main.Block(blockId="1:1", bbox=(0.57, 0.16, 0.59, 0.18), lines=[_line("C", (0.57, 0.16, 0.59, 0.18))]),
        main.Block(blockId="1:2", bbox=(0.75, 0.16, 0.79, 0.18), lines=[_line("(11)", (0.75, 0.16, 0.79, 0.18))]),
        main.Block(blockId="1:3", bbox=(0.43, 0.20, 0.79, 0.23), lines=[_line("and some prose between the two equations.", (0.43, 0.20, 0.79, 0.23))]),
        main.Block(blockId="1:4", bbox=(0.57, 0.26, 0.59, 0.28), lines=[_line("C", (0.57, 0.26, 0.59, 0.28))]),
        main.Block(blockId="1:5", bbox=(0.75, 0.285, 0.79, 0.305), lines=[_line("(12)", (0.75, 0.285, 0.79, 0.305))]),
        main.Block(blockId="1:6", bbox=(0.57, 0.31, 0.59, 0.33), lines=[_line("C", (0.57, 0.31, 0.59, 0.33))]),
        main.Block(blockId="1:7", bbox=(0.43, 0.36, 0.75, 0.39), lines=[_line("After prose following the second equation.", (0.43, 0.36, 0.75, 0.39))]),
        main.Block(blockId="1:8", bbox=(0.07, 0.285, 0.09, 0.305), lines=[_line("C", (0.07, 0.285, 0.09, 0.305))]),
    ]
    return main.PageBlocks(pageNumber=1, width=700.0, height=800.0, blocks=blocks, suspiciousGaps=[])


@pytest.fixture()
def region_doc(client):
    res = client.post("/document/register", files={"file": ("region.pdf", _blank_pdf_bytes(), "application/pdf")})
    assert res.status_code == 200
    doc_id = res.json()["documentId"]
    main.state.documents[doc_id].page_cache[1] = _equation_region_page_blocks()
    yield doc_id
    client.post("/document/close", json={"documentId": doc_id})


def test_single_fragment_equation_region_suppressed(client, region_doc, monkeypatch):
    # eq(8)-shaped: one "C" fragment on the SAME row as the equation number.
    def _fail_if_called(_png_bytes):
        raise AssertionError("no missing glyph in this fixture -- OCR must never be called")

    monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": region_doc,
            "start": {"pageNumber": 1, "xNorm": 0.5, "yNorm": 0.115, "boundaryText": "Prose before the first equation continues here.", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.5, "yNorm": 0.215, "boundaryText": "and some prose between the two equations.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reconstructedText"] == "Prose before the first equation continues here.\n[式 (11)]\nand some prose between the two equations."
    assert "\nC\n" not in body["reconstructedText"]


def test_two_fragment_equation_region_suppressed(client, region_doc, monkeypatch):
    # eq(9)-shaped: two "C" fragments straddling the equation number -- the primary target
    # this phase was built from (real Soenen: "term\nC\nC\n[式 (9)]\n..." before the fix).
    def _fail_if_called(_png_bytes):
        raise AssertionError("no missing glyph in this fixture -- OCR must never be called")

    monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": region_doc,
            "start": {"pageNumber": 1, "xNorm": 0.5, "yNorm": 0.215, "boundaryText": "and some prose between the two equations.", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.5, "yNorm": 0.375, "boundaryText": "After prose following the second equation.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reconstructedText"] == "and some prose between the two equations.\n[式 (12)]\nAfter prose following the second equation."
    assert "\nC\n" not in body["reconstructedText"]
    assert body["reconstructedText"].count("[式") == 1


def test_equation_regions_do_not_swallow_each_other(client, region_doc):
    # Item 34: a selection spanning BOTH equations must produce both placeholders, neither
    # region consuming the other's fragment or number.
    res = client.post(
        "/layout/selection",
        json={
            "documentId": region_doc,
            "start": {"pageNumber": 1, "xNorm": 0.5, "yNorm": 0.115, "boundaryText": "Prose before the first equation continues here.", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.5, "yNorm": 0.375, "boundaryText": "After prose following the second equation.", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reconstructedText"] == (
        "Prose before the first equation continues here.\n[式 (11)]\nand some prose between the "
        "two equations.\n[式 (12)]\nAfter prose following the second equation."
    )
    assert "\nC\n" not in body["reconstructedText"]


def test_different_corridor_fragment_never_suppressed(client, region_doc):
    # Item 24/34: the far-left decoy "C" sits near (12)'s own row but in a different
    # corridor -- confirm it's untouched (still resolvable as ordinary same-block text, not
    # silently deleted or absorbed into (12)'s region).
    page_blocks = main._extract_page_blocks(region_doc, 1)
    decoy = next(b for b in page_blocks.blocks if b.lines and b.lines[0].text == "C" and b.bbox[0] < 0.2)
    eq12 = next(b for b in page_blocks.blocks if b.lines and b.lines[0].text == "(12)")
    region = main._display_equation_region_blocks(page_blocks, eq12, page_blocks.blocks[page_blocks.blocks.index(eq12) - 1])
    assert decoy.blockId not in {b.blockId for b in region}


def test_display_equation_region_blocks_pure_function_eq8_shape():
    eqnum = main.Block(blockId="1:2", bbox=(0.7, 0.16, 0.79, 0.18), lines=[main.Line(text="(11)", bbox=(0.7, 0.16, 0.79, 0.18), spans=[])])
    fragment = main.Block(blockId="1:1", bbox=(0.57, 0.16, 0.585, 0.18), lines=[main.Line(text="C", bbox=(0.57, 0.16, 0.585, 0.18), spans=[])])
    before_prose = main.Block(blockId="1:0", bbox=(0.43, 0.12, 0.99, 0.14), lines=[main.Line(text="Prose before.", bbox=(0.43, 0.12, 0.99, 0.14), spans=[])])
    page_blocks = main.PageBlocks(pageNumber=1, width=700.0, height=800.0, blocks=[before_prose, fragment, eqnum], suspiciousGaps=[])
    region = main._display_equation_region_blocks(page_blocks, eqnum, before_prose)
    assert [b.blockId for b in region] == ["1:1", "1:2"]


def test_wide_prose_block_never_treated_as_formula_fragment():
    # Item 27: a genuinely wide, multi-word block must never be misclassified as a fragment
    # regardless of proximity to an equation number.
    wide = main.Block(blockId="1:0", bbox=(0.05, 0.1, 0.9, 0.12), lines=[main.Line(text="This is real prose, not a formula fragment.", bbox=(0.05, 0.1, 0.9, 0.12), spans=[])])
    assert main._is_formula_fragment_block(wide) is False


def test_multi_word_narrow_block_never_treated_as_formula_fragment():
    # Item 27: even a narrow block is NOT a fragment if it contains more than one token --
    # width alone is not a sufficient signal.
    narrow_but_wordy = main.Block(blockId="1:0", bbox=(0.05, 0.1, 0.09, 0.12), lines=[main.Line(text="a b", bbox=(0.05, 0.1, 0.09, 0.12), spans=[])])
    assert main._is_formula_fragment_block(narrow_but_wordy) is False


def test_equation_number_block_never_treated_as_another_equations_fragment():
    # Item 34/35: an equation-number block must never be absorbed as a "fragment" of a
    # DIFFERENT equation, even if narrow/single-token (it always is, by construction).
    other_eqnum = main.Block(blockId="1:0", bbox=(0.7, 0.1, 0.79, 0.12), lines=[main.Line(text="(5)", bbox=(0.7, 0.1, 0.79, 0.12), spans=[])])
    assert main._is_formula_fragment_block(other_eqnum) is False


# --- Part B item 41/42: selection endpoint landing directly on a formula fragment ----------


def test_selection_starting_on_formula_fragment_is_safe_failure(client, region_doc):
    # Item 41: clicking directly on equation (12)'s own "C" fragment (not the equation
    # number, not ordinary prose) must never be silently treated as prose.
    res = client.post(
        "/layout/selection",
        json={
            "documentId": region_doc,
            "start": {"pageNumber": 1, "xNorm": 0.58, "yNorm": 0.27, "boundaryText": "C", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.5, "yNorm": 0.375, "boundaryText": "After prose following the second equation.", "direction": "backward"},
        },
    )
    assert res.status_code == 422
    assert res.json()["detail"]["error"] == "formula_fragment_endpoint_unresolved"


def test_selection_ending_on_formula_fragment_is_safe_failure(client, region_doc):
    # Item 42: same principle for the end endpoint.
    res = client.post(
        "/layout/selection",
        json={
            "documentId": region_doc,
            "start": {"pageNumber": 1, "xNorm": 0.5, "yNorm": 0.115, "boundaryText": "Prose before the first equation continues here.", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.58, "yNorm": 0.27, "boundaryText": "C", "direction": "backward"},
        },
    )
    assert res.status_code == 422
    assert res.json()["detail"]["error"] == "formula_fragment_endpoint_unresolved"


def test_endpoint_is_formula_fragment_pure_function():
    eqnum = main.Block(blockId="1:2", bbox=(0.7, 0.16, 0.775, 0.18), lines=[main.Line(text="(11)", bbox=(0.7, 0.16, 0.775, 0.18), spans=[])])
    fragment = main.Block(blockId="1:1", bbox=(0.57, 0.16, 0.585, 0.18), lines=[main.Line(text="C", bbox=(0.57, 0.16, 0.585, 0.18), spans=[])])
    prose = main.Block(blockId="1:0", bbox=(0.43, 0.12, 0.99, 0.14), lines=[main.Line(text="Prose before.", bbox=(0.43, 0.12, 0.99, 0.14), spans=[])])
    page_blocks = main.PageBlocks(pageNumber=1, width=700.0, height=800.0, blocks=[prose, fragment, eqnum], suspiciousGaps=[])
    assert main._endpoint_is_formula_fragment(page_blocks, fragment) is True
    assert main._endpoint_is_formula_fragment(page_blocks, prose) is False
    assert main._endpoint_is_formula_fragment(page_blocks, eqnum) is False  # its own equation-number guard handles this, not this check
