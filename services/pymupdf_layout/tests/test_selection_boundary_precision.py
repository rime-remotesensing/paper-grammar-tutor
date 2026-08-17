"""Prototype 2.6A regressions for visual-line joins and half-open endpoints."""

import io

import pymupdf
from fastapi.testclient import TestClient

import main


LINE_1 = "Grid units and slope units are the two types of evaluation units most commonly used"
LINE_2 = "in LSM (Lima et al. 2022). In the present study, slope-unit-based units were selected"
EXPECTED = f"{LINE_1}\nin LSM (Lima et al. 2022)."


def _springer_shape_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_textbox(pymupdf.Rect(50, 100, 550, 180), f"{LINE_1}\n{LINE_2}", fontsize=10)
    data = io.BytesIO()
    doc.save(data)
    doc.close()
    return data.getvalue()


def _register(client: TestClient) -> tuple[str, dict, dict]:
    document_id = client.post(
        "/document/register",
        files={"file": ("springer-shape.pdf", _springer_shape_pdf(), "application/pdf")},
    ).json()["documentId"]
    blocks = client.post("/layout/page", json={"documentId": document_id, "pageNumber": 1}).json()["blocks"]
    block = next(block for block in blocks if any(line["text"] == LINE_1 for line in block["lines"]))
    return document_id, block["lines"][0], block["lines"][1]


def _endpoint(line: dict, boundary_text: str, direction: str) -> dict:
    x0, y0, x1, y1 = line["bbox"]
    return {
        "pageNumber": 1,
        "xNorm": (x0 + x1) / 2,
        "yNorm": (y0 + y1) / 2,
        "boundaryText": boundary_text,
        "direction": direction,
    }


def _select(client: TestClient, document_id: str, first: dict, second: dict) -> dict:
    response = client.post(
        "/layout/selection",
        json={"documentId": document_id, "start": first, "end": second},
    )
    assert response.status_code == 200
    return response.json()


def test_springer_wrapped_sentence_preserves_space_and_excludes_next_sentence_initial():
    with TestClient(main.app) as client:
        document_id, first_line, second_line = _register(client)
        body = _select(
            client,
            document_id,
            _endpoint(first_line, LINE_1, "forward"),
            _endpoint(second_line, "in LSM (Lima et al. 2022).", "backward"),
        )
        assert body["sameBlock"] is True
        assert body["reconstructedText"] == EXPECTED
        assert "usedin" not in body["reconstructedText"]
        assert not body["reconstructedText"].endswith(" I")


def test_backward_drag_reconstructs_the_same_half_open_selection():
    with TestClient(main.app) as client:
        document_id, first_line, second_line = _register(client)
        body = _select(
            client,
            document_id,
            _endpoint(second_line, "in LSM (Lima et al. 2022).", "backward"),
            _endpoint(first_line, LINE_1, "forward"),
        )
        assert body["reconstructedText"] == EXPECTED


def test_endpoint_can_intentionally_include_the_next_sentence():
    with TestClient(main.app) as client:
        document_id, first_line, second_line = _register(client)
        body = _select(
            client,
            document_id,
            _endpoint(first_line, LINE_1, "forward"),
            _endpoint(second_line, "in LSM (Lima et al. 2022). In the present study", "backward"),
        )
        assert body["reconstructedText"].endswith("In the present study")


def test_line_join_policy_is_boundary_aware():
    assert main._join_prose_fragments(["used", "in"]) == "used\nin"
    assert main._join_prose_fragments(["measured ", "radiance"]) == "measured radiance"
    assert main._join_prose_fragments(["multi-", "temporal"]) == "multi-\ntemporal"
    assert main._join_prose_fragments([")", "In"]) == ")\nIn"
    assert main._join_prose_fragments(["[式", " (5)]"]) == "[式 (5)]"
    assert main._join_prose_fragments(["https://example.org/path/", "segment"]) == "https://example.org/path/segment"
    assert main._join_prose_fragments(["10.1007/s11004-", "023-10132-3"]) == "10.1007/s11004-023-10132-3"
