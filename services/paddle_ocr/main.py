"""Prototype 1.4A -- PaddleOCR local OCR service (technical spike).

Not wired into the production "OCRで読み直す" flow. Runs entirely on localhost, loads
PP-OCRv6 medium once at startup on GPU, and reuses the same engine instance for every
request. Deliberately refuses to fall back to CPU if the configured GPU is unavailable
(see `_init_engine`) -- CPU inference for this model takes 27-60s/page (Prototype 1.3),
which would be a silent, unacceptable regression for anyone expecting "the GPU service".

Local-only by design: binds 127.0.0.1 (see __main__), never writes the uploaded page
image to disk, and discards decoded buffers as soon as each request is done.
"""

import io
import time
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

MODEL_DET = "PP-OCRv6_medium_det"
MODEL_REC = "PP-OCRv6_medium_rec"
DEVICE = "gpu"

# Only the dev Vite server may call this service -- see README "CORS" section.
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


class _EngineState:
    engine: Optional[object] = None
    gpu_available: bool = False
    init_error: Optional[str] = None


state = _EngineState()


def _detect_gpu() -> bool:
    import paddle

    return bool(paddle.device.is_compiled_with_cuda()) and paddle.device.cuda.device_count() > 0


def _init_engine() -> None:
    try:
        state.gpu_available = _detect_gpu()
    except Exception as exc:  # defensive: paddle import/detection itself failing
        state.init_error = f"GPU detection failed: {exc}"
        state.gpu_available = False
        return

    if not state.gpu_available:
        state.init_error = "GPU not available (paddle.device.cuda.device_count() == 0)"
        return

    from paddleocr import PaddleOCR

    state.engine = PaddleOCR(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        text_detection_model_name=MODEL_DET,
        text_recognition_model_name=MODEL_REC,
        device=DEVICE,
        return_word_box=True,
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _init_engine()
    yield


app = FastAPI(title="Paper Grammar Tutor - PaddleOCR local service (spike)", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class WordDTO(BaseModel):
    text: str
    confidence: Optional[float] = None
    bbox: list[float]


class LineDTO(BaseModel):
    text: str
    confidence: float
    bbox: list[float]
    words: list[WordDTO]


class PageResultDTO(BaseModel):
    imageWidth: int
    imageHeight: int
    lines: list[LineDTO]
    timingMs: dict[str, float]


@app.get("/health")
def health():
    return {
        "status": "ok" if state.engine is not None else "degraded",
        "model": f"{MODEL_DET}+{MODEL_REC}",
        "device": DEVICE,
        "gpuAvailable": state.gpu_available,
        "modelLoaded": state.engine is not None,
        "error": state.init_error,
    }


def to_bbox(values) -> list[float]:
    """Normalizes a Paddle box array to axis-aligned [x0, y0, x1, y1] floats.

    `rec_boxes` / `text_word_boxes` are already axis-aligned 4-value arrays in the
    Paddle version this service pins (verified empirically -- see docs/design-notes.md,
    Prototype 1.4A). This still defensively collapses a 4-point polygon ([x,y] x4) to its
    bounding box, in case a future Paddle version reintroduces polygon-only output.
    """
    flat = [float(v) for v in np.asarray(values).reshape(-1)]
    if len(flat) == 4:
        return flat
    xs = flat[0::2]
    ys = flat[1::2]
    return [min(xs), min(ys), max(xs), max(ys)]


@app.post("/ocr/page", response_model=PageResultDTO)
async def ocr_page(file: UploadFile = File(...)):
    if state.engine is None:
        raise HTTPException(
            status_code=503,
            detail={"error": "gpu_unavailable", "message": state.init_error or "OCR engine not initialized"},
        )

    t_start = time.monotonic()
    raw = await file.read()
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail={"error": "invalid_image", "message": str(exc)}) from exc
    width, height = image.size
    array = np.array(image)
    del raw, image  # discard the encoded upload and decoded PIL image as soon as possible

    t_decode_done = time.monotonic()
    try:
        results = state.engine.predict(array)
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": "ocr_failed", "message": str(exc)}) from exc
    finally:
        del array  # discard the raw pixel buffer once inference has consumed it
    t_inference_done = time.monotonic()

    lines: list[LineDTO] = []
    for res in results:
        texts = res.get("rec_texts", [])
        scores = res.get("rec_scores", [])
        boxes = res.get("rec_boxes", [])
        word_texts = res.get("text_word") or []
        word_boxes = res.get("text_word_boxes") or []
        for i, text in enumerate(texts):
            words: list[WordDTO] = []
            if i < len(word_texts) and i < len(word_boxes):
                for wt, wb in zip(word_texts[i], word_boxes[i]):
                    words.append(WordDTO(text=wt, bbox=to_bbox(wb)))
            lines.append(
                LineDTO(
                    text=text,
                    confidence=float(scores[i]) if i < len(scores) else 0.0,
                    bbox=to_bbox(boxes[i]) if i < len(boxes) else [0.0, 0.0, 0.0, 0.0],
                    words=words,
                )
            )
    t_serialize_done = time.monotonic()

    return PageResultDTO(
        imageWidth=width,
        imageHeight=height,
        lines=lines,
        timingMs={
            "decode": round((t_decode_done - t_start) * 1000, 1),
            "inference": round((t_inference_done - t_decode_done) * 1000, 1),
            "serialize": round((t_serialize_done - t_inference_done) * 1000, 1),
            "total": round((t_serialize_done - t_start) * 1000, 1),
        },
    )


if __name__ == "__main__":
    import uvicorn

    # 127.0.0.1 only -- never 0.0.0.0. See README "Local-only / security" section.
    uvicorn.run(app, host="127.0.0.1", port=8008)
