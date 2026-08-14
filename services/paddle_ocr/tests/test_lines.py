"""Integration tests for POST /ocr/lines against the real GPU full det+rec pipeline
(Prototype 1.5I). Same conventions as test_service.py -- requires the GPU environment,
not meant to run in CI without a GPU.
"""
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

import main


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def _line_crop_png(text: str, width: int = 300, height: int = 40) -> bytes:
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    draw.text((10, 10), text, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _blank_png(width: int = 300, height: int = 40) -> bytes:
    img = Image.new("RGB", (width, height), "white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _two_line_png(text_top: str, text_bottom: str, width: int = 400, height: int = 200) -> bytes:
    # Two widely-separated lines of text in one image, so detection is expected to
    # split this into two separate regions -- used for the "multiple detections" case.
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    draw.text((10, 10), text_top, fill="black")
    draw.text((10, height - 30), text_bottom, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_ocr_lines_uses_the_existing_page_engine_no_separate_engine(client):
    # Prototype 1.5I removed the standalone recognition-only model entirely -- there is
    # no `rec_engine` attribute on state anymore, and /ocr/lines must still work using
    # only `state.engine` (the same instance /ocr/page uses).
    assert not hasattr(main.state, "rec_engine")
    assert main.state.engine is not None
    res = client.post("/ocr/lines", files=[("files", ("l.png", _line_crop_png("hello"), "image/png"))])
    assert res.status_code == 200


def test_one_detection_succeeds(client):
    res = client.post("/ocr/lines", files=[("files", ("l.png", _line_crop_png("hello world"), "image/png"))])
    assert res.status_code == 200
    body = res.json()
    assert len(body["lines"]) == 1
    line = body["lines"][0]
    assert line["detectionCount"] == 1
    assert "hello" in line["text"].lower()
    assert isinstance(line["confidence"], float)


def test_zero_detections_reports_failure_for_that_line(client):
    res = client.post("/ocr/lines", files=[("files", ("blank.png", _blank_png(), "image/png"))])
    assert res.status_code == 200
    body = res.json()
    line = body["lines"][0]
    assert line["detectionCount"] == 0
    assert line["text"] is None
    assert line["confidence"] is None


def test_multiple_detections_reports_failure_for_that_line(client):
    res = client.post(
        "/ocr/lines",
        files=[("files", ("two.png", _two_line_png("alpha uno text here", "bravo dos text here"), "image/png"))],
    )
    assert res.status_code == 200
    body = res.json()
    line = body["lines"][0]
    assert line["detectionCount"] >= 2
    assert line["text"] is None
    assert line["confidence"] is None


def test_multiple_line_batch_preserves_upload_order(client):
    files = [
        ("files", ("l0.png", _line_crop_png("alpha uno"), "image/png")),
        ("files", ("l1.png", _line_crop_png("bravo dos"), "image/png")),
        ("files", ("l2.png", _line_crop_png("charlie tres"), "image/png")),
    ]
    res = client.post("/ocr/lines", files=files)
    body = res.json()
    assert len(body["lines"]) == 3
    assert "alpha" in body["lines"][0]["text"].lower()
    assert "bravo" in body["lines"][1]["text"].lower()
    assert "charlie" in body["lines"][2]["text"].lower()


def test_empty_request_is_rejected(client):
    res = client.post("/ocr/lines", files=[])
    assert res.status_code in (400, 422)


def test_invalid_image_is_rejected(client):
    res = client.post("/ocr/lines", files=[("files", ("bad.png", b"not a real png", "image/png"))])
    assert res.status_code == 400
    assert res.json()["detail"]["error"] == "invalid_image"


def test_inference_failure_returns_500(client, monkeypatch):
    def raise_predict(_array):
        raise RuntimeError("simulated inference failure")

    monkeypatch.setattr(main.state.engine, "predict", raise_predict)
    res = client.post("/ocr/lines", files=[("files", ("l.png", _line_crop_png("hello"), "image/png"))])
    assert res.status_code == 500
    assert res.json()["detail"]["error"] == "ocr_failed"


def test_gpu_unavailable_returns_503(client, monkeypatch):
    monkeypatch.setattr(main.state, "engine", None)
    res = client.post("/ocr/lines", files=[("files", ("l.png", _line_crop_png("hello"), "image/png"))])
    assert res.status_code == 503
    assert res.json()["detail"]["error"] == "gpu_unavailable"
