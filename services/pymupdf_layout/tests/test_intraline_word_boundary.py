"""Prototype 2.6G2.5A -- intra-line word-boundary reconstruction (see main.py's own
"Intra-line word-boundary reconstruction" section docs).

Root cause, confirmed against a real live-failing academic PDF (see
docs/design-notes.md, Prototype 2.6G2.5A, for the full trace): PyMuPDF's own "dict"-mode
span-joining relies on an internal synthetic-space heuristic whose threshold is sometimes
too strict for a given font/PDF -- a genuine ~14.8%-of-font-size glyph gap between two real
words was left unjoined ("trainingandtesting..."), while every intra-word glyph-to-glyph gap
on the same page measured ~0%. `_reconstruct_line_span_texts` independently re-derives each
span's text from "rawdict" mode's own per-character bounding boxes and inserts a single
space wherever the horizontal gap exceeds a font-size-normalized threshold -- never a
dictionary, never English-specific tokenization, never a hardcoded phrase repair.

These are synthetic-PDF, pure-function/HTTP tests (no external fixture PDF or running
Paddle OCR needed) so they always run in CI, mirroring test_equation_guard.py's own
convention. The real-PDF regression against the actual failing academic paper is exercised
manually (env-var-gated fixture, matching test_fixtures.py's convention) since that PDF is
personal/copyrighted and not committed to the repository.
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


def _place_words(page: "pymupdf.Page", y: float, words: list[tuple[str, float]], fontsize: float = 12.0, x0: float = 50.0) -> None:
    """Places each (text, gap_before_this_word_pt) pair left-to-right on one visual line,
    gap_before measured from the PREVIOUS word's own right edge (0.0 for the first word).
    Uses PyMuPDF's own reported glyph width to place each subsequent word, so the requested
    gap is the real geometric gap PyMuPDF itself will later report via get_text -- never a
    hand-guessed pixel offset."""
    x = x0
    for text, gap_before in words:
        x += gap_before
        page.insert_text((x, y), text, fontsize=fontsize)
        width = pymupdf.get_text_length(text, fontsize=fontsize)
        x += width


def _one_line_pdf_bytes(words: list[tuple[str, float]], fontsize: float = 12.0) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    _place_words(page, 100, words, fontsize=fontsize)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def _register_and_get_line_text(client, pdf_bytes: bytes) -> str:
    res = client.post("/document/register", files={"file": ("t.pdf", pdf_bytes, "application/pdf")})
    assert res.status_code == 200
    doc_id = res.json()["documentId"]
    page = client.post("/layout/page", json={"documentId": doc_id, "pageNumber": 1}).json()
    lines = [l["text"] for b in page["blocks"] for l in b["lines"]]
    client.post("/document/close", json={"documentId": doc_id})
    assert len(lines) == 1, f"expected exactly one line, got {lines!r}"
    return lines[0]


# Calibration (see docstring): at fontsize 12, PyMuPDF's own dict-mode heuristic already
# inserts a space above ~2.0pt but not below ~1.5pt for two touching English words -- so a
# 1.5pt gap is the deliberate "PyMuPDF alone would miss this" fixture, and a 4.0pt gap is
# "PyMuPDF alone already gets this right" (used as a control, not the fix's own target).
MISSED_GAP_PT = 1.5
CONTROL_ALREADY_HANDLED_GAP_PT = 4.0
TOUCHING_GAP_PT = 0.0


def test_a_separate_word_items_with_visible_gap_get_reconstructed_with_one_space(client):
    text = _register_and_get_line_text(client, _one_line_pdf_bytes([("training", 0.0), ("and", MISSED_GAP_PT), ("testing", MISSED_GAP_PT)]))
    assert text == "training and testing"


def test_b_adjacent_style_change_inside_one_word_with_near_zero_gap_stays_fused(client):
    # Simulates a font/style change mid-word (e.g. bold->regular) at an ordinary touching
    # kerning distance -- must NOT be treated as a word boundary.
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((50, 100), "trai", fontsize=12, fontname="Helvetica-Bold")
    w = pymupdf.get_text_length("trai", fontsize=12, fontname="Helvetica-Bold")
    page.insert_text((50 + w, 100), "ning", fontsize=12)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    text = _register_and_get_line_text(client, buf.getvalue())
    assert text == "training"


def test_c_explicit_trailing_space_already_present_is_never_doubled(client):
    text = _register_and_get_line_text(client, _one_line_pdf_bytes([("training", 0.0), ("and testing", CONTROL_ALREADY_HANDLED_GAP_PT)]))
    assert text == "training and testing"
    assert "  " not in text


def test_d_punctuation_followed_by_normal_word_gap_gets_reconstructed(client):
    text = _register_and_get_line_text(client, _one_line_pdf_bytes([("steps:", 0.0), ("next", MISSED_GAP_PT)]))
    assert text == "steps: next"


def test_e_multiple_consecutive_word_items_all_get_exactly_one_space_each(client):
    words = [("the", 0.0), ("training", MISSED_GAP_PT), ("and", MISSED_GAP_PT), ("testing", MISSED_GAP_PT), ("datasets", MISSED_GAP_PT)]
    text = _register_and_get_line_text(client, _one_line_pdf_bytes(words))
    assert text == "the training and testing datasets"
    assert "  " not in text


def test_f_selection_endpoint_landing_inside_a_reconstructed_span_still_resolves(client):
    """Item 6F: a selection starting/ending inside a word that required reconstruction must
    still resolve correctly through the existing endpoint-resolution machinery -- this
    prototype only changes Span/Line `.text` content, never the Block/Line/Span shape or
    bbox geometry endpoint resolution depends on."""
    pdf_bytes = _one_line_pdf_bytes([("training", 0.0), ("and", MISSED_GAP_PT), ("testing", MISSED_GAP_PT), ("datasets", MISSED_GAP_PT)])
    res = client.post("/document/register", files={"file": ("t.pdf", pdf_bytes, "application/pdf")})
    doc_id = res.json()["documentId"]
    page = client.post("/layout/page", json={"documentId": doc_id, "pageNumber": 1}).json()
    line = page["blocks"][0]["lines"][0]
    assert line["text"] == "training and testing datasets"
    width, height = page["width"], page["height"]
    lx0, ly0, lx1, ly1 = line["bbox"]
    y_mid_norm = (ly0 + ly1) / 2
    res_sel = client.post(
        "/layout/selection",
        json={
            "documentId": doc_id,
            "start": {"pageNumber": 1, "xNorm": lx0, "yNorm": y_mid_norm, "boundaryText": "training and testing datasets", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": lx1, "yNorm": y_mid_norm, "boundaryText": "training and testing datasets", "direction": "backward"},
        },
    )
    assert res_sel.status_code == 200
    assert res_sel.json()["sameBlock"] is True
    client.post("/document/close", json={"documentId": doc_id})


def test_touching_glyphs_never_get_a_spurious_space(client):
    """Negative control: a zero-gap boundary (immediately adjacent glyphs, as in ordinary
    kerned same-word letters) must never receive a synthesized space."""
    text = _register_and_get_line_text(client, _one_line_pdf_bytes([("train", 0.0), ("ing", TOUCHING_GAP_PT)]))
    assert text == "training"


def test_reconstruction_never_fires_when_rawdict_span_count_mismatches(monkeypatch):
    """Defensive fallback: if rawdict's own span count for a line ever disagrees with
    dict-mode's (a structural mismatch that should not happen), the original dict-mode text
    must be returned completely unmodified -- never a guess."""
    dict_spans = [{"text": "trainingand", "size": 12.0}]
    result = main._reconstruct_line_span_texts(dict_spans, [["mismatched"], ["extra", "list"]])
    assert result == ["trainingand"]


def test_reconstruction_returns_original_when_no_rawdict_data():
    dict_spans = [{"text": "trainingand", "size": 12.0}]
    assert main._reconstruct_line_span_texts(dict_spans, None) == ["trainingand"]
    assert main._reconstruct_line_span_texts(dict_spans, []) == ["trainingand"]


def test_hard_regressions_preserved(client):
    """Prototype 2.6A's own inter-line join is unaffected (this prototype changes intra-line
    span text only, never Line.text's own line-to-line joining, which lives entirely in
    _join_prose_fragments / _assemble_lines_with_gap_recovery and is untouched here).
    Hyphenation across an explicit hyphen glyph must stay exactly as PyMuPDF reports it."""
    # Hyphenation: an explicit hyphen at the end of one word run, touching the continuation.
    text = _register_and_get_line_text(client, _one_line_pdf_bytes([("multi-", 0.0), ("temporal", TOUCHING_GAP_PT)]))
    assert text == "multi-temporal"

    # URL/DOI-style unspaced technical string must never gain a spurious space merely
    # because individual characters are wide/narrow -- no gap was ever requested here.
    text_url = _register_and_get_line_text(client, _one_line_pdf_bytes([("https://doi.org/10.1007/s11004", 0.0)]))
    assert text_url == "https://doi.org/10.1007/s11004"
    assert " " not in text_url
