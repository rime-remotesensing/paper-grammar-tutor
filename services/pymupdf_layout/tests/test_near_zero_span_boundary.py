"""Near-zero adjacent-span boundaries must never be ink-probed as micro-gaps.

Live-traced false positive: a PDF that emits every word and every inter-word space as
SEPARATE spans (word in CharisSIL, space in LMRoman10) has a float-level seam between a word
span and the space span it touches -- "recent" | " " differ by 0.000015pt. Shape (c) of
`_find_span_gap_candidates` probed that seam; `_render_gap_ink_ratio` rounds its clip OUTWARD
to whole pixels, so at render scale 4 the seam became a 1px column made only of the "t"'s own
right-edge pixels (visualInkRatio 3/32 = 0.09375 > 0.05), OCR recovery could not anchor on the
whitespace-only right span, and the whole selection failed with `missing_glyph_unresolved`.

The rule under test (`_has_resolvable_interior_pixel_column`): a gap is ink-probed only if at
least one device pixel column at the probe's render scale lies wholly inside it. These
fixtures draw a glyph stroke whose ink reaches exactly to each word span's right edge (the
real "t" shape), so the seam column genuinely bleeds -- the gate, not a lucky glyph bearing,
is what keeps them from firing.

Second live-traced shape on the same page (exposed once the seam gate let line 0 pass): a
JUSTIFIED line whose space span reaches 1.75pt INTO the next word (" " 74.634-77.952 vs.
"techniques" from 76.201). The probe used min/max of the two edges, so it probed that
overlap -- the next word's own first glyph -- and read it as ink. Anchors that overlap in X
leave no uncovered interval at all and are never probed (outcome "anchors_overlap").
"""

import io

import pymupdf
import pytest
from fastapi.testclient import TestClient

import main
from main import Block, Line, PageBlocks, Span

PAGE_W, PAGE_H = 600.0, 800.0
FS = 8.0
SPACE_W = 3.3176  # space span width (pt), real trace: 82.914 -> 86.23156
WORD_GAP = 0.74  # real trace: the empty interval between a space span and the next word
JUSTIFIED_WORD_GAP = -1.75  # real trace, line 1: the space span reaches 1.75pt into the next word
# Real seam widths from the live trace: "recent"|" " (+0.000015), "of"|" " (+0.00102),
# "most"|" " (-0.0033, the space span starts slightly INSIDE the word's own bbox).
SEAMS = (0.000015, 0.00102, -0.0033)

LINE_TEXTS = (
    "In recent years, ensemble learning has become one of the most",
    "prominent techniques in the field of Machine Learning, offering im-",
    "proved accuracy, robustness, and generalization by combining models.",
)


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def _norm(x0, y0, x1, y1):
    return (x0 / PAGE_W, y0 / PAGE_H, x1 / PAGE_W, y1 / PAGE_H)


def _draw_word_space_line(page, text: str, x: float, baseline: float, seam_index: int, word_gap: float = WORD_GAP) -> tuple[Line, int]:
    """Draws `text` word by word and returns a Line whose spans alternate word | " " exactly
    like the live PDF, every word/space seam near-zero (cycling through SEAMS). A negative
    `word_gap` makes each space span overlap the next word (the justified-line shape)."""
    y0, y1 = baseline - FS, baseline + 2.0
    spans: list[Span] = []
    words = text.split(" ")
    for i, word in enumerate(words):
        page.insert_text((x, baseline), word, fontsize=FS)
        x_end = x + pymupdf.get_text_length(word, fontsize=FS)
        # Glyph ink touching the span's own right edge (the real CharisSIL "t"); partial row
        # height, like real glyph ink, so the clip's own background percentile stays white.
        page.draw_rect(pymupdf.Rect(x_end - 1.0, baseline - 6.0, x_end, baseline), color=None, fill=(0, 0, 0))  # fill only: an outline would spill past the edge
        spans.append(Span(text=word, bbox=_norm(x, y0, x_end, y1), size=FS, font="CharisSIL"))
        if i == len(words) - 1:
            break
        space_x0 = x_end + SEAMS[seam_index % len(SEAMS)]
        seam_index += 1
        spans.append(Span(text=" ", bbox=_norm(space_x0, y0, space_x0 + SPACE_W, y1), size=9.96, font="LMRoman10-Regular"))
        x = space_x0 + SPACE_W + word_gap
    line = Line(text="".join(s.text for s in spans), bbox=(spans[0].bbox[0], y0 / PAGE_H, spans[-1].bbox[2], y1 / PAGE_H), spans=spans)
    return line, seam_index


def _word_space_document() -> tuple[bytes, PageBlocks]:
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    lines: list[Line] = []
    seam_index = 0
    for i, text in enumerate(LINE_TEXTS):
        word_gap = JUSTIFIED_WORD_GAP if i == 1 else WORD_GAP
        line, seam_index = _draw_word_space_line(page, text, 50.0, 250.0 + i * 12.0, seam_index, word_gap)
        lines.append(line)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    block = Block(blockId="1:0", bbox=(lines[0].bbox[0], lines[0].bbox[1], max(l.bbox[2] for l in lines), lines[-1].bbox[3]), lines=lines)
    return buf.getvalue(), PageBlocks(pageNumber=1, width=PAGE_W, height=PAGE_H, blocks=[block], suspiciousGaps=[])


def _register(client, pdf_bytes: bytes, page_blocks: PageBlocks | None = None) -> str:
    document_id = client.post("/document/register", files={"file": ("seams.pdf", pdf_bytes, "application/pdf")}).json()["documentId"]
    if page_blocks is not None:
        main.state.documents[document_id].page_cache[1] = page_blocks
    return document_id


def _select_all_lines(client, document_id, page_blocks: PageBlocks):
    lines = page_blocks.blocks[0].lines
    first, last = lines[0], lines[-1]
    return client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 1, "xNorm": first.bbox[0] + 0.001, "yNorm": (first.bbox[1] + first.bbox[3]) / 2, "boundaryText": first.text, "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": last.bbox[2] - 0.001, "yNorm": (last.bbox[1] + last.bbox[3]) / 2, "boundaryText": last.text, "direction": "backward"},
        },
    )


def _seam_pairs(line: Line) -> list[tuple[Span, Span]]:
    spans = sorted(line.spans, key=lambda s: s.bbox[0])
    return [(a, b) for a, b in zip(spans, spans[1:]) if a.text.strip() and not b.text.strip()]


def _fail_if_ocr_called(_png_bytes):
    raise AssertionError("a near-zero span seam must never reach OCR recovery")


class TestResolvableInteriorPixelColumn:
    """The geometric rule itself, at the production render scale."""

    def test_live_traced_recent_seam_is_not_resolvable(self):
        assert not main._has_resolvable_interior_pixel_column(82.91399, 82.91400)

    @pytest.mark.parametrize("seam", [0.000015, 0.00102, 0.0033])
    def test_float_level_seams_are_not_resolvable(self, seam):
        for x0 in (82.91399, 252.64198, 288.94, 100.0, 100.24):
            assert not main._has_resolvable_interior_pixel_column(x0, x0 + seam)

    def test_narrower_than_one_column_is_never_resolvable_at_any_alignment(self):
        scale = main.VISUAL_INK_RENDER_SCALE
        width = 1.0 / scale - 1e-6
        for k in range(200):
            x0 = 50.0 + k * 0.0137
            assert not main._has_resolvable_interior_pixel_column(x0, x0 + width)

    def test_two_columns_wide_is_always_resolvable_at_any_alignment(self):
        scale = main.VISUAL_INK_RENDER_SCALE
        width = 2.0 / scale
        for k in range(200):
            x0 = 50.0 + k * 0.0137
            assert main._has_resolvable_interior_pixel_column(x0, x0 + width)

    def test_boundary_one_column_depends_on_alignment(self):
        # Exactly one column wide: resolvable only when it lines up with the pixel grid.
        assert main._has_resolvable_interior_pixel_column(100.0, 100.25)
        assert not main._has_resolvable_interior_pixel_column(100.1, 100.35)

    def test_ordinary_word_gap_is_resolvable(self):
        assert main._has_resolvable_interior_pixel_column(86.23156, 86.97200)  # 0.74pt, real trace


class TestNearZeroSeamProbe:
    def test_fixture_seam_really_bleeds_neighbor_ink_when_rendered(self, client):
        # Guards the fixture: without the gate, the seam column WOULD read as ink-positive.
        pdf_bytes, page_blocks = _word_space_document()
        document_id = _register(client, pdf_bytes)
        try:
            doc = main.state.documents[document_id].doc
            a, b = _seam_pairs(page_blocks.blocks[0].lines[0])[1]  # "recent" | " "
            assert a.text == "recent"
            seam_bbox = (a.bbox[2], max(a.bbox[1], b.bbox[1]), b.bbox[0], min(a.bbox[3], b.bbox[3]))
            ratio = main._render_gap_ink_ratio(doc, 1, seam_bbox, PAGE_W, PAGE_H)
            assert ratio > main.VISUAL_INK_CENTRAL_RATIO_THRESHOLD
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_every_word_space_seam_is_rejected_by_the_probe(self, client):
        pdf_bytes, page_blocks = _word_space_document()
        document_id = _register(client, pdf_bytes)
        try:
            doc = main.state.documents[document_id].doc
            pairs = [p for line in page_blocks.blocks[0].lines for p in _seam_pairs(line)]
            assert len(pairs) >= 25
            for a, b in pairs:
                assert main._probe_micro_gap_ink(doc, 1, page_blocks, a.bbox, b.bbox, FS) is None, (a.text, b.text)
        finally:
            client.post("/document/close", json={"documentId": document_id})


class TestOverlappingAnchorsProbe:
    def _justified_space_word_pairs(self, page_blocks: PageBlocks) -> list[tuple[Span, Span]]:
        spans = sorted(page_blocks.blocks[0].lines[1].spans, key=lambda s: s.bbox[0])
        return [(a, b) for a, b in zip(spans, spans[1:]) if not a.text.strip() and b.text.strip()]

    def test_fixture_overlap_really_contains_the_next_words_ink(self, client):
        # Guards the fixture: the old min/max interval (the overlap itself) reads as ink.
        pdf_bytes, page_blocks = _word_space_document()
        document_id = _register(client, pdf_bytes)
        try:
            doc = main.state.documents[document_id].doc
            a, b = self._justified_space_word_pairs(page_blocks)[0]  # " " | "techniques"
            assert b.text == "techniques" and b.bbox[0] < a.bbox[2]
            overlap_bbox = (b.bbox[0], max(a.bbox[1], b.bbox[1]), a.bbox[2], min(a.bbox[3], b.bbox[3]))
            assert main._render_gap_ink_ratio(doc, 1, overlap_bbox, PAGE_W, PAGE_H) > main.VISUAL_INK_CENTRAL_RATIO_THRESHOLD
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_every_justified_overlap_is_not_probed(self, client, monkeypatch):
        traces: list[tuple[str, dict]] = []
        monkeypatch.setattr(main, "_trace", lambda label, **fields: traces.append((label, fields)))
        pdf_bytes, page_blocks = _word_space_document()
        document_id = _register(client, pdf_bytes)
        try:
            doc = main.state.documents[document_id].doc
            pairs = self._justified_space_word_pairs(page_blocks)
            assert len(pairs) >= 8
            for a, b in pairs:
                assert main._probe_micro_gap_ink(doc, 1, page_blocks, a.bbox, b.bbox, FS) is None, (a.text, b.text)
            outcomes = [f["outcome"] for label, f in traces if label == "MICRO_GAP_PROBE"]
            assert outcomes == ["anchors_overlap"] * len(pairs)
        finally:
            client.post("/document/close", json={"documentId": document_id})


class TestWordSpaceSeamSelection:
    def test_selection_over_many_seams_succeeds_without_gap_ink_or_ocr(self, client, monkeypatch):
        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_ocr_called)
        traces: list[tuple[str, dict]] = []
        monkeypatch.setattr(main, "_trace", lambda label, **fields: traces.append((label, fields)))
        pdf_bytes, page_blocks = _word_space_document()
        document_id = _register(client, pdf_bytes, page_blocks)
        try:
            res = _select_all_lines(client, document_id, page_blocks)
            assert res.status_code == 200, res.text
            assert "missing_glyph_unresolved" not in res.text
            assert not [f for label, f in traces if label == "GAP_INK" and f.get("outcome") == "ink_positive_candidate"]
            probes = [f for label, f in traces if label == "MICRO_GAP_PROBE"]
            skipped = {"too_narrow_to_probe", "anchors_overlap"}
            too_narrow = [f for f in probes if f["outcome"] == "too_narrow_to_probe"]
            overlaps = [f for f in probes if f["outcome"] == "anchors_overlap"]
            rendered = [f for f in probes if f["outcome"] not in skipped]
            assert len(too_narrow) >= 15  # the positive float-level word|space seams
            justified_line = page_blocks.blocks[0].lines[1]
            assert len(overlaps) >= len(_seam_pairs(justified_line))  # every justified space|word overlap
            # Ordinary (resolvable) word-gap probes still run, and still find no ink.
            assert rendered and all(f["outcome"] == "no_ink" for f in rendered)
            assert all(f["widthPt"] > 0.5 for f in rendered)
        finally:
            client.post("/document/close", json={"documentId": document_id})

    def test_reconstruction_including_hyphenated_wrap_is_unchanged(self, client, monkeypatch):
        # Oracle: the same selection with micro-gap probing disabled entirely. The gate must
        # only remove false candidates, never alter ordinary/hyphenated-wrap reconstruction.
        monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_ocr_called)
        pdf_bytes, page_blocks = _word_space_document()
        document_id = _register(client, pdf_bytes, page_blocks)
        try:
            gated = _select_all_lines(client, document_id, page_blocks)
            assert gated.status_code == 200, gated.text
            with monkeypatch.context() as m:
                m.setattr(main, "_probe_micro_gap_ink", lambda *args, **kwargs: None)
                oracle = _select_all_lines(client, document_id, page_blocks)
            assert oracle.status_code == 200
            assert gated.json()["reconstructedText"] == oracle.json()["reconstructedText"]
            text = gated.json()["reconstructedText"]
            assert "offering im-" in text and "proved accuracy" in text
        finally:
            client.post("/document/close", json={"documentId": document_id})


class TestResolvableRealGapStillDetected:
    """Just above the resolvable width, an inked gap is still a candidate (and an empty one
    is not) -- the gate removes only gaps no pixel can belong to."""

    def _two_span_line(self, gap_pt: float, ink: bool) -> tuple[bytes, Line]:
        doc = pymupdf.open()
        page = doc.new_page(width=PAGE_W, height=PAGE_H)
        baseline, y0, y1 = 250.0, 250.0 - FS, 252.0
        left, right = "angle (39", ") and"
        page.insert_text((50.0, baseline), left, fontsize=FS)
        x_end = 50.0 + pymupdf.get_text_length(left, fontsize=FS)
        if ink:
            page.draw_rect(pymupdf.Rect(x_end, baseline - 6.0, x_end + gap_pt, baseline - 2.0), color=None, fill=(0, 0, 0))  # fill only: an outline would spill past the edge
        x2 = x_end + gap_pt
        page.insert_text((x2, baseline), right, fontsize=FS)
        x2_end = x2 + pymupdf.get_text_length(right, fontsize=FS)
        spans = [
            Span(text=left, bbox=_norm(50.0, y0, x_end, y1), size=FS, font="Helvetica"),
            Span(text=right, bbox=_norm(x2, y0, x2_end, y1), size=FS, font="Helvetica"),
        ]
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        return buf.getvalue(), Line(text=left + right, bbox=(spans[0].bbox[0], spans[0].bbox[1], spans[1].bbox[2], spans[1].bbox[3]), spans=spans)

    def _probe(self, client, gap_pt: float, ink: bool):
        pdf_bytes, line = self._two_span_line(gap_pt, ink)
        page_blocks = PageBlocks(pageNumber=1, width=PAGE_W, height=PAGE_H, blocks=[Block(blockId="1:0", bbox=line.bbox, lines=[line])])
        document_id = _register(client, pdf_bytes)
        try:
            doc = main.state.documents[document_id].doc
            return main._probe_micro_gap_ink(doc, 1, page_blocks, line.spans[0].bbox, line.spans[1].bbox, FS)
        finally:
            client.post("/document/close", json={"documentId": document_id})

    @pytest.mark.parametrize("gap_pt", [0.6, 1.0, 4.8])
    def test_inked_resolvable_gap_is_still_a_candidate(self, client, gap_pt):
        assert self._probe(client, gap_pt, ink=True) is not None

    @pytest.mark.parametrize("gap_pt", [0.6, 1.0, 4.8])
    def test_empty_resolvable_gap_is_not_a_candidate(self, client, gap_pt):
        assert self._probe(client, gap_pt, ink=False) is None

    def test_inked_but_unresolvable_gap_is_skipped(self, client):
        # 0.1pt < one column (0.25pt at scale 4): even real ink there cannot be told apart
        # from the neighbors' own edge pixels, so it is not probed.
        assert self._probe(client, 0.1, ink=True) is None
