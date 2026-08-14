"""Integration tests against the real GPU engine (matches how this service actually
runs -- see README "Version policy"). Requires the GPU environment from Prototype 1.3B;
these are not meant to run in CI without a GPU.
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


def _sample_page_png() -> bytes:
    img = Image.new("RGB", (400, 120), "white")
    draw = ImageDraw.Draw(img)
    draw.text((20, 40), "The signal is recorded on 1 nm centres.", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_health_reports_gpu_loaded(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["gpuAvailable"] is True
    assert body["modelLoaded"] is True
    assert body["device"] == "gpu"
    assert body["model"] == "PP-OCRv6_medium_det+PP-OCRv6_medium_rec"
    assert body["error"] is None


def test_model_is_a_singleton_across_requests(client):
    client.post("/ocr/page", files={"file": ("page.png", _sample_page_png(), "image/png")})
    engine_after_first = id(main.state.engine)
    client.post("/ocr/page", files={"file": ("page.png", _sample_page_png(), "image/png")})
    engine_after_second = id(main.state.engine)
    # Same object identity -> no per-request re-initialization (see main._init_engine,
    # only called once from the lifespan startup hook).
    assert engine_after_first == engine_after_second


def test_ocr_page_line_and_word_dto_shape(client):
    res = client.post("/ocr/page", files={"file": ("page.png", _sample_page_png(), "image/png")})
    assert res.status_code == 200
    body = res.json()
    assert body["imageWidth"] == 400
    assert body["imageHeight"] == 120
    assert "timingMs" in body
    for key in ("decode", "inference", "serialize", "total"):
        assert key in body["timingMs"]
    assert len(body["lines"]) >= 1
    line = body["lines"][0]
    assert set(["text", "confidence", "bbox", "words"]).issubset(line.keys())
    assert len(line["bbox"]) == 4
    assert len(line["words"]) >= 1
    word = line["words"][0]
    assert "text" in word and "bbox" in word
    assert len(word["bbox"]) == 4
    # Concatenating word text with no separator must reproduce the line text verbatim
    # (Paddle's own tokenization already includes whitespace/punctuation as tokens) --
    # this is the property the browser-side alignment algorithm depends on.
    assert "".join(w["text"] for w in line["words"]) == line["text"]


def test_ocr_page_rejects_invalid_image(client):
    res = client.post("/ocr/page", files={"file": ("bad.png", b"not a real png", "image/png")})
    assert res.status_code == 400
    assert res.json()["detail"]["error"] == "invalid_image"
