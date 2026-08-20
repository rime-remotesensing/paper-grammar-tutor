"""Prototype 2.5J -- tests for the cross-equation continuation path: a selection whose
start AND end both resolve to ordinary prose, with a genuine numbered display equation
found strictly between them (never an equation-number ENDPOINT -- that's still
`_resolve_equation_crossing`, tested in test_equation_guard.py). See docs/design-notes.md,
Prototype 2.5I/2.5J, for the real Soenen "equation (6)" failure this was built from: the
ordinary cross-block path only ever used the start block's own trailing lines and the end
block's own leading lines, silently dropping every block between them (including the
equation itself and further prose like "where Ln is the normalized radiance, ...").

Synthetic-PDF/mocked-OCR only, matching test_equation_guard.py's own conventions -- the real
Soenen equation (6) fixture regression lives in test_fixtures.py.
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


def _cross_equation_pdf_bytes() -> bytes:
    """One page, two columns, mirroring the real Soenen page 2 shape at a much smaller
    scale.

    RIGHT corridor (x roughly 350-580) -- the primary cross-equation-continuation target:
    - "Content strictly before the selection start." (y=70) -- must NEVER appear (item 48:
      no content before the selection's own start, even though it's in the same block-index
      neighborhood).
    - "Before prose leading into the equation using the value" (y=100) -- before-prose,
      the selection's own START.
    - "(11)" (y=130, x=555) -- isolated equation-number block, in-corridor.
    - "leftpart" / "rightpart continues the sentence." (y=160) -- the real Soenen "Ln" shape:
      one visual row split across two different PyMuPDF blocks by a real ink-positive gap
      (a drawn vector mark, not text) -- proves gap recovery still works when the two
      bounding lines are on different blocks INSIDE the cross-equation continuation walk
      (item 18/21/47's own regression target).
    - "and finally after the equation." (y=190) -- after-prose, the selection's own END.
    - "This unrelated sentence must never appear." (y=220) -- strictly AFTER the selected
      end; must never be included (item 22/48).

    LEFT corridor (x roughly 50-250) -- corridor-exclusion targets:
    - "Left column prose that starts here" (y=100) and "Left column continues with more
      text." (y=160) -- a Failure-A-shaped cross-corridor pair.
    - "(12)" (y=130, x=230) -- an isolated equation-number block that sits at a y position
      (and, depending on PyMuPDF's own block ordering, a block index) BETWEEN the RIGHT
      corridor's own before/after prose, but in the WRONG corridor -- must never be picked
      as that selection's intermediate equation (item 5/6/34/36).

    RIGHT corridor, ordinary (no-equation) cross-block regression target (item 33/46;
    2.6G2.8S1 -- the middle block's own text is now correctly INCLUDED, not skipped, see
    that test's own updated doc comment):
    - "Ordinary first line of a plain sentence" / "ordinary middle line that must be
      skipped" / "ordinary final line of the same plain sentence" (y=500/530/560) -- three
      separate blocks, same corridor, NO equation between them.

    RIGHT corridor, TWO intermediate equations (item 11/49, synthetic-only):
    - "Multi equation prose start here" (y=600) -> "(21)" (y=630) -> "middle prose between
      equations" (y=660) -> "(22)" (y=690) -> "final prose after second equation." (y=720).
    """
    doc = pymupdf.open()
    page = doc.new_page(width=700, height=800)

    # Right corridor -- primary single-equation case.
    page.insert_text((350, 70), "Content strictly before the selection start.", fontsize=12)
    page.insert_text((350, 100), "Before prose leading into the equation using the value", fontsize=12)
    page.insert_text((555, 130), "(11)", fontsize=10)
    page.insert_text((350, 160), "leftpart", fontsize=12)
    page.insert_text((405, 160), "rightpart continues the sentence.", fontsize=12)
    page.draw_line(pymupdf.Point(392, 161), pymupdf.Point(398, 153), color=(0, 0, 0), width=2.0)
    page.insert_text((350, 190), "and finally after the equation.", fontsize=12)
    page.insert_text((350, 220), "This unrelated sentence must never appear.", fontsize=12)

    # Left corridor -- corridor-exclusion targets.
    page.insert_text((50, 100), "Left column prose that starts here", fontsize=12)
    page.insert_text((230, 130), "(12)", fontsize=10)
    page.insert_text((50, 160), "Left column continues with more text.", fontsize=12)

    # Right corridor -- ordinary no-equation cross-block regression.
    page.insert_text((350, 500), "Ordinary first line of a plain sentence", fontsize=12)
    page.insert_text((350, 530), "ordinary middle line that must be skipped", fontsize=12)
    page.insert_text((350, 560), "ordinary final line of the same plain sentence", fontsize=12)

    # Right corridor -- two intermediate equations. Equation-number x position kept close
    # enough to the prose lines' own x-extent that it falls inside their corridor union
    # (see _find_intermediate_equation_blocks's own note on why a short single-line prose
    # block doesn't need to reach the same far-right margin an equation number might sit at).
    page.insert_text((350, 600), "Multi equation prose start here", fontsize=12)
    page.insert_text((500, 630), "(21)", fontsize=10)
    page.insert_text((350, 660), "middle prose between equations", fontsize=12)
    page.insert_text((500, 690), "(22)", fontsize=10)
    page.insert_text((350, 720), "final prose after second equation.", fontsize=12)

    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


@pytest.fixture()
def registered_doc(client):
    res = client.post("/document/register", files={"file": ("crosseq.pdf", _cross_equation_pdf_bytes(), "application/pdf")})
    assert res.status_code == 200
    doc_id = res.json()["documentId"]
    yield doc_id
    client.post("/document/close", json={"documentId": doc_id})


def _norm(x, y, width=700.0, height=800.0):
    return x / width, y / height


def _select(client, doc_id, start, end):
    return client.post("/layout/selection", json={"documentId": doc_id, "start": start, "end": end})


def test_cross_equation_continuation_basic_case(client, registered_doc, monkeypatch):
    calls = []

    def _fake_ocr(_png_bytes):
        calls.append(1)
        return [{"text": "leftpart X rightpart continues the sentence.", "confidence": 0.99}]

    monkeypatch.setattr(main, "_call_paddle_ocr", _fake_ocr)
    x1, y1 = _norm(360, 95)
    x2, y2 = _norm(360, 185)
    res = _select(
        client,
        registered_doc,
        start={"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "Before prose leading into the equation using the value", "direction": "forward"},
        end={"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "and finally after the equation.", "direction": "backward"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reconstructedText"] == (
        "Before prose leading into the equation using the value\n"
        "[式 (11)]\n"
        "leftpart\nX\nrightpart continues the sentence.\n"
        "and finally after the equation."
    )
    # Item 48: nothing before the selection's own start, nothing after its own end.
    assert "Content strictly before the selection start." not in body["reconstructedText"]
    assert "This unrelated sentence must never appear." not in body["reconstructedText"]
    # Item 6/34/36: the wrong-corridor "(12)" is never mistaken for this selection's equation.
    assert "(12)" not in body["reconstructedText"]
    assert body["reconstructedText"].count("[式") == 1
    # Item 18/21/47: the cross-block same-row gap is recovered exactly once, not skipped and
    # not double-recovered by an incorrect per-block grouping.
    assert len(calls) == 1


def test_cross_equation_ordinary_no_equation_cross_block_includes_intermediate_prose(client, registered_doc, monkeypatch):
    def _fail_if_called(_png_bytes):
        raise AssertionError("no equation and no real gap here -- OCR must never be called")

    monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
    x1, y1 = _norm(360, 495)
    x2, y2 = _norm(360, 555)
    res = _select(
        client,
        registered_doc,
        start={"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "Ordinary first line of a plain sentence", "direction": "forward"},
        end={"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "ordinary final line of the same plain sentence", "direction": "backward"},
    )
    assert res.status_code == 200
    body = res.json()
    # Prototype 2.6G2.8S1 -- this test previously asserted the middle block was DROPPED
    # ("existing start-suffix + end-prefix semantics (middle block skipped)"), documenting
    # what turned out to be exactly the real GOMS/Kananaskis regression's own root cause
    # (D. INTERIOR_BLOCK_NOT_INCLUDED_IN_SELECTION) -- three same-corridor blocks with no
    # equation between them is precisely the shape ordinary prose fragmented by an
    # unextractable interior glyph produces. The middle line shares corridor with both
    # endpoints and sits between them, so it is now correctly included; only a genuine
    # cross-column/different-corridor block (Failure A) is still excluded (see
    # test_fixtures.py's own Failure A regressions, still green).
    assert body["reconstructedText"] == (
        "Ordinary first line of a plain sentence\nordinary middle line that must be skipped\nordinary final line of the same plain sentence"
    )


def test_cross_corridor_selection_never_enters_new_path(client, registered_doc, monkeypatch):
    def _fail_if_called(_png_bytes):
        raise AssertionError("a cross-corridor (Failure-A-shaped) selection must never reach OCR")

    monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
    x1, y1 = _norm(55, 95)
    x2, y2 = _norm(360, 185)
    res = _select(
        client,
        registered_doc,
        start={"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "Left column prose that starts here", "direction": "forward"},
        end={"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "and finally after the equation.", "direction": "backward"},
    )
    assert res.status_code == 200
    body = res.json()
    # Item 5/46: different corridor -- even though an equation-number-like block ("(11)" or
    # "(12)") sits block-index-between the two endpoints, the new path must never be entered;
    # this must reconstruct EXACTLY like the existing (pre-2.5J) ordinary cross-block path.
    assert body["reconstructedText"] == "Left column prose that starts here\nand finally after the equation."
    for polluted in ["[式", "(11)", "(12)", "This unrelated sentence"]:
        assert polluted not in body["reconstructedText"]


def test_multiple_intermediate_equations_synthetic(client, registered_doc, monkeypatch):
    def _fail_if_called(_png_bytes):
        raise AssertionError("item 38: no missing glyphs in this fixture -- OCR must never be called")

    monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)
    x1, y1 = _norm(360, 595)
    x2, y2 = _norm(360, 715)
    res = _select(
        client,
        registered_doc,
        start={"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "Multi equation prose start here", "direction": "forward"},
        end={"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "final prose after second equation.", "direction": "backward"},
    )
    assert res.status_code == 200
    body = res.json()
    # Item 11/49: the same walk naturally generalizes to more than one intermediate equation.
    assert body["reconstructedText"] == (
        "Multi equation prose start here\n[式 (21)]\nmiddle prose between equations\n[式 (22)]\nfinal prose after second equation."
    )


def test_cross_equation_paddle_unavailable_is_safe_failure_not_silent_drop(client, registered_doc, monkeypatch):
    # Item 37: the primary case (missing-glyph recovery needed INSIDE the after-equation
    # prose) must still safe-fail explicitly if Paddle is unavailable -- never silently
    # return "...leftpart\nrightpart..." with the real glyph just dropped.
    monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png_bytes: None)
    x1, y1 = _norm(360, 95)
    x2, y2 = _norm(360, 185)
    res = _select(
        client,
        registered_doc,
        start={"pageNumber": 1, "xNorm": x1, "yNorm": y1, "boundaryText": "Before prose leading into the equation using the value", "direction": "forward"},
        end={"pageNumber": 1, "xNorm": x2, "yNorm": y2, "boundaryText": "and finally after the equation.", "direction": "backward"},
    )
    assert res.status_code == 422
    assert res.json()["detail"]["error"] == "missing_glyph_unresolved"


def test_blocks_share_corridor_pure_function():
    right_a = main.Block(blockId="1:0", bbox=(0.583, 0.12, 0.967, 0.15), lines=[])
    right_b = main.Block(blockId="1:1", bbox=(0.583, 0.20, 0.967, 0.23), lines=[])
    left = main.Block(blockId="1:2", bbox=(0.083, 0.12, 0.417, 0.15), lines=[])
    narrow_eqnum = main.Block(blockId="1:3", bbox=(0.925, 0.16, 0.958, 0.18), lines=[])
    assert main._blocks_share_corridor(right_a, right_b) is True
    assert main._blocks_share_corridor(right_a, left) is False
    assert main._blocks_share_corridor(right_a, narrow_eqnum) is True  # narrow block fully inside the wider column


def test_find_intermediate_equation_blocks_excludes_wrong_corridor(client, registered_doc):
    page_blocks = main._extract_page_blocks(registered_doc, 1)
    by_text = {b.lines[0].text.strip(): b for b in page_blocks.blocks if len(b.lines) == 1}
    before_block = next(b for b in page_blocks.blocks if b.lines and b.lines[0].text == "Before prose leading into the equation using the value")
    after_block = next(b for b in page_blocks.blocks if b.lines and b.lines[0].text == "and finally after the equation.")
    found = main._find_intermediate_equation_blocks(page_blocks, before_block, after_block)
    assert len(found) == 1
    assert found[0].blockId == by_text["(11)"].blockId
