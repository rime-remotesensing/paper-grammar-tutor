"""Core service unit tests (item 45/46) -- use a small synthetic PDF built with PyMuPDF
itself, so these never depend on any external/personal file and can run in CI. Real-PDF
fixture validation (Failure A/B, Elsevier, MDPI) lives in test_fixtures.py and skips
cleanly when those personal Downloads-folder files aren't present on the machine.
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


def _sample_pdf_bytes() -> bytes:
    """Two pages, each with two well-separated paragraphs (two distinct native PyMuPDF
    blocks) at different font sizes on page 2, so same-block/different-block/cross-page
    resolution can all be exercised deterministically."""
    doc = pymupdf.open()
    page1 = doc.new_page(width=400, height=600)
    page1.insert_text((50, 100), "First paragraph body text goes here on page one.", fontsize=12)
    page1.insert_text((50, 400), "Second paragraph body text lower on page one.", fontsize=12)
    page2 = doc.new_page(width=400, height=600)
    page2.insert_text((50, 100), "Third paragraph continues on page two.", fontsize=12)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


@pytest.fixture()
def registered_doc(client):
    res = client.post("/document/register", files={"file": ("sample.pdf", _sample_pdf_bytes(), "application/pdf")})
    assert res.status_code == 200
    body = res.json()
    yield body["documentId"]
    client.post("/document/close", json={"documentId": body["documentId"]})


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["engine"] == "pymupdf"
    assert "serviceVersion" in body


def test_register_valid_pdf(client):
    res = client.post("/document/register", files={"file": ("sample.pdf", _sample_pdf_bytes(), "application/pdf")})
    assert res.status_code == 200
    body = res.json()
    assert "documentId" in body and body["documentId"]
    assert body["numPages"] == 2
    client.post("/document/close", json={"documentId": body["documentId"]})


def test_register_rejects_invalid_pdf(client):
    res = client.post("/document/register", files={"file": ("bad.pdf", b"not a real pdf", "application/pdf")})
    assert res.status_code == 400
    assert res.json()["detail"]["error"] == "invalid_pdf"


def test_layout_page_returns_blocks(client, registered_doc):
    res = client.post("/layout/page", json={"documentId": registered_doc, "pageNumber": 1})
    assert res.status_code == 200
    body = res.json()
    assert body["pageNumber"] == 1
    assert body["width"] == 400
    assert body["height"] == 600
    assert len(body["blocks"]) == 2  # two well-separated paragraphs
    for block in body["blocks"]:
        assert "blockId" in block and "bbox" in block and "lines" in block
        assert len(block["bbox"]) == 4


def test_layout_page_bad_page_number(client, registered_doc):
    res = client.post("/layout/page", json={"documentId": registered_doc, "pageNumber": 99})
    assert res.status_code == 400
    assert res.json()["detail"]["error"] == "bad_page_number"


def test_layout_page_unknown_document(client):
    res = client.post("/layout/page", json={"documentId": "does-not-exist", "pageNumber": 1})
    assert res.status_code == 404
    assert res.json()["detail"]["error"] == "unknown_document"


def test_selection_same_block(client, registered_doc):
    # Both endpoints inside the same first-paragraph block.
    text = "First paragraph body text goes here on page one."
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 0.16, "boundaryText": text, "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 0.16, "boundaryText": text, "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["sameBlock"] is True
    assert body["startBlockId"] == body["endBlockId"]
    assert body["reconstructedText"] is None
    assert body["fragments"] == []


def test_selection_different_block_same_page(client, registered_doc):
    start_text = "First paragraph body text goes here on page one."
    end_text = "Second paragraph body text lower on page one."
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 0.16, "boundaryText": start_text, "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 0.66, "boundaryText": end_text, "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["sameBlock"] is False
    assert body["startBlockId"] != body["endBlockId"]
    assert body["reconstructedText"] == f"{start_text}\n{end_text}"


def _three_page_pdf_bytes() -> bytes:
    doc = pymupdf.open()
    p1 = doc.new_page(width=400, height=600)
    p1.insert_text((50, 500), "Start page tail paragraph text right here.", fontsize=12)
    p2 = doc.new_page(width=400, height=600)
    p2.insert_text((50, 50), "Middle page running header text.", fontsize=8)
    p2.insert_text((50, 150), "Middle page body paragraph fully spanned by the selection.", fontsize=12)
    p3 = doc.new_page(width=400, height=600)
    p3.insert_text((50, 100), "End page head paragraph text right here.", fontsize=12)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def test_selection_three_page_includes_middle_page_body_excludes_header(client):
    document_id = client.post("/document/register", files={"file": ("three.pdf", _three_page_pdf_bytes(), "application/pdf")}).json()["documentId"]
    start_text = "Start page tail paragraph text right here."
    end_text = "End page head paragraph text right here."
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 0.83, "boundaryText": start_text, "direction": "forward"},
            "end": {"pageNumber": 3, "xNorm": 0.12, "yNorm": 0.16, "boundaryText": end_text, "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["sameBlock"] is False
    pages = [f["pageNumber"] for f in body["fragments"]]
    assert pages == [1, 2, 3]
    middle_fragment = body["fragments"][1]
    assert "Middle page body paragraph fully spanned" in middle_fragment["text"]
    assert "running header" not in middle_fragment["text"]
    client.post("/document/close", json={"documentId": document_id})


def test_selection_reverse_drag_normalizes_to_same_result(client):
    document_id = client.post("/document/register", files={"file": ("three.pdf", _three_page_pdf_bytes(), "application/pdf")}).json()["documentId"]
    start_text = "Start page tail paragraph text right here."
    end_text = "End page head paragraph text right here."
    forward = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 0.83, "boundaryText": start_text, "direction": "forward"},
            "end": {"pageNumber": 3, "xNorm": 0.12, "yNorm": 0.16, "boundaryText": end_text, "direction": "backward"},
        },
    ).json()
    # Reverse: the user physically dragged from page 3 to page 1 -- request labels are
    # swapped, but the reconstructed result must be identical.
    reverse = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 3, "xNorm": 0.12, "yNorm": 0.16, "boundaryText": end_text, "direction": "backward"},
            "end": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 0.83, "boundaryText": start_text, "direction": "forward"},
        },
    ).json()
    assert forward["reconstructedText"] == reverse["reconstructedText"]
    client.post("/document/close", json={"documentId": document_id})


def test_selection_cross_page(client, registered_doc):
    start_text = "Second paragraph body text lower on page one."
    end_text = "Third paragraph continues on page two."
    res = client.post(
        "/layout/selection",
        json={
            "documentId": registered_doc,
            "start": {"pageNumber": 1, "xNorm": 0.12, "yNorm": 0.66, "boundaryText": start_text, "direction": "forward"},
            "end": {"pageNumber": 2, "xNorm": 0.12, "yNorm": 0.16, "boundaryText": end_text, "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["sameBlock"] is False
    assert body["reconstructedText"] == f"{start_text}\n{end_text}"
    assert len(body["fragments"]) == 2
    assert body["fragments"][0]["pageNumber"] == 1
    assert body["fragments"][1]["pageNumber"] == 2


def test_close_document(client):
    res = client.post("/document/register", files={"file": ("sample.pdf", _sample_pdf_bytes(), "application/pdf")})
    document_id = res.json()["documentId"]
    close_res = client.post("/document/close", json={"documentId": document_id})
    assert close_res.status_code == 200
    assert close_res.json()["closed"] is True


def test_closed_document_access_fails(client):
    res = client.post("/document/register", files={"file": ("sample.pdf", _sample_pdf_bytes(), "application/pdf")})
    document_id = res.json()["documentId"]
    client.post("/document/close", json={"documentId": document_id})
    layout_res = client.post("/layout/page", json={"documentId": document_id, "pageNumber": 1})
    assert layout_res.status_code == 404


def test_close_unknown_document_is_a_noop(client):
    res = client.post("/document/close", json={"documentId": "never-registered"})
    assert res.status_code == 200
    assert res.json()["closed"] is False


def test_selection_bad_document_id(client):
    res = client.post(
        "/layout/selection",
        json={
            "documentId": "does-not-exist",
            "start": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 0.1, "boundaryText": "x", "direction": "forward"},
            "end": {"pageNumber": 1, "xNorm": 0.1, "yNorm": 0.1, "boundaryText": "x", "direction": "backward"},
        },
    )
    assert res.status_code == 404


def test_no_raw_filesystem_path_endpoint_exists(client):
    # Item 46: confirm there is no production endpoint that accepts an arbitrary
    # filesystem path as selection-time authority -- only documentId (from /document/register)
    # is ever valid. /layout/page and /layout/selection both reject a documentId that
    # looks like a path rather than treating it as one.
    res = client.post("/layout/page", json={"documentId": "C:/Users/whoever/some.pdf", "pageNumber": 1})
    assert res.status_code == 404
