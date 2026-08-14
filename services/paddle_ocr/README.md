# PaddleOCR local service (Prototype 1.4B — primary production OCR)

**Status: primary production OCR engine.** The Paper Grammar Tutor app's "OCRで読み直す"
button calls this service first (`src/features/ocr/domain/paddleOcrClient.ts` /
`paddleAdapter.ts` / `paddleOcrService.ts`). If it isn't running or isn't GPU-ready, the
app shows an explicit "高精度OCRサービスを利用できません" message with a "再確認" button
and a "ブラウザOCRを使う" button — it never falls back to the existing Tesseract.js path
automatically (see `docs/design-notes.md`, Prototype 1.4B, "explicit fallback, never
automatic"). This service must be started manually before using OCR in development; the
app never spawns it, and there is currently no installer/launcher (no PowerShell script,
Electron packaging, bundled Python, .exe, Docker image, or system tray icon) — see
"Setup"/"Running" below for the manual flow.

## Why a separate Python service

The app's Tesseract fallback path runs entirely in-browser (WASM). PaddleOCR has no
practical in-browser WASM/GPU path with comparable accuracy, so a local Python process is
the only way to use it — see `docs/design-notes.md` (Prototype 1.3/1.3B) for the
accuracy/latency comparison that led to choosing it as the primary engine.

## Version policy

Pinned to the exact environment already validated in Prototype 1.3 / 1.3B. Do not bump
to "latest" without re-running that validation — GPU wheels, model tiers, and the word/
line bbox response shape (`rec_boxes` / `text_word_boxes` being pre-computed axis-aligned
`[x0,y0,x1,y1]`, not polygons) were all verified against these specific versions.

- Python 3.12
- `paddlepaddle-gpu==3.3.1` (CUDA 12.9 build)
- `paddleocr==3.7.0`, `paddlex==3.7.2`
- Models: `PP-OCRv6_medium_det` + `PP-OCRv6_medium_rec`
- GPU: validated on an NVIDIA RTX 4070 Ti SUPER (16GB VRAM, compute capability 8.9);
  should work on any CUDA 12.9-capable GPU with a few GB of free VRAM (peak usage
  measured at ~1.5GB above baseline — see Prototype 1.3B).

## Setup (manual — no installer yet)

Model weights, the venv, and any Python binaries are **not** committed — only this
source file, `requirements.txt`, and this README live in the repository.

```bash
cd services/paddle_ocr
python -m venv venv
venv/Scripts/pip install paddlepaddle-gpu==3.3.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
venv/Scripts/pip install -r requirements.txt
```

The first `PaddleOCR(...)` call downloads the `PP-OCRv6_medium_det`/`_rec` model weights
(~134MB total) to `~/.paddlex/official_models/` (not into this repo) — this one-time
download requires internet access. Every OCR request after that runs entirely offline:
no document, page image, or extracted text is ever sent anywhere outside this machine
(see "Local-only / security" below).

## Running

Start the service, confirm it's healthy, then start the app's dev server:

```bash
venv/Scripts/python main.py
```

Binds `127.0.0.1:8008` only — never `0.0.0.0`. Not reachable from any other machine on
the network.

```bash
curl http://127.0.0.1:8008/health
```

Check the response before relying on it for OCR — `status`, `gpuAvailable`,
`modelLoaded` must all be truthy/`"ok"` and `device` must be `"gpu"` (see `GET /health`
below); the app applies this same "actually usable" check itself before ever treating
the service as available, not just a bare HTTP 200.

```bash
# from the repo root, in a separate terminal
npm run dev
```

The app's dev server must run on `http://localhost:5173` (or `127.0.0.1:5173`) — this
service's CORS is restricted to exactly those two origins (see `ALLOWED_ORIGINS` in
`main.py`); a dev server on any other port cannot call it from the browser.

```bash
venv/Scripts/python -m pytest
```

## API

### `GET /health`

```json
{
  "status": "ok",
  "model": "PP-OCRv6_medium_det+PP-OCRv6_medium_rec",
  "device": "gpu",
  "gpuAvailable": true,
  "modelLoaded": true,
  "error": null
}
```

If the configured GPU is not available at startup, the service **does not silently fall
back to CPU** (PP-OCRv6 medium on CPU takes 27-60s/page — see Prototype 1.3 — an
unacceptable, silent regression for something billed as "the GPU service"). Instead,
`gpuAvailable`/`modelLoaded` are `false`, `error` explains why, `/ocr/page` returns
`503`, and the caller is expected to surface this to the user rather than proceed.

### `POST /ocr/page`

Multipart upload, field name `file`, a PNG (or any Pillow-decodable) page image — render
it with PDF.js first (e.g. `page.render()` at scale=2x into a canvas, then
`canvas.toBlob()`). The service never receives the original PDF, and never writes the
uploaded image to disk — it's decoded in memory and discarded once the request finishes.

Response (stable DTO — a shim over PaddleOCR's own version-specific object shape, so the
browser never depends on Paddle-internal structures directly):

```json
{
  "imageWidth": 1229,
  "imageHeight": 1590,
  "lines": [
    {
      "text": "The signal is recorded on 1 nm centres in the 0·4 to 0·8 µm region and on 4 nm centres",
      "confidence": 0.983,
      "bbox": [305, 624, 972, 641],
      "words": [
        { "text": "The", "bbox": [305, 624, 330, 640] },
        { "text": " ", "bbox": [330, 624, 336, 640] }
      ]
    }
  ],
  "timingMs": { "decode": 3.2, "inference": 470.1, "serialize": 0.4, "total": 473.7 }
}
```

`bbox` is always `[x0, y0, x1, y1]` in the *uploaded image's own pixel space* — the
caller is responsible for converting to/from its own coordinate system. See
`src/features/ocr/domain/paddleAdapter.ts` for how the browser side does this (selection
rects converted with the existing `NormalizedRect`/`toPixelRect` geometry, then matched
against these line/word boxes) and `src/features/ocr/schemas/paddleOcr.schema.ts` for the
Zod validation applied to this response before anything downstream trusts it.

`words` intentionally includes whitespace/punctuation as their own tokens (this is
Paddle's own tokenization, not something this service adds) — concatenating
`words.map(w => w.text)` with **no separator** reproduces `line.text` byte-for-byte, but
joining with spaces does not. Do not `.join(' ')` word text to reconstruct a sentence —
`paddleAdapter.ts` always slices `line.text` itself instead; see the "Selected text
reconstruction" note in `docs/design-notes.md` (Prototype 1.4A) for why.

## Local-only / security

- Binds `127.0.0.1` only.
- CORS restricted to `http://localhost:5173` / `http://127.0.0.1:5173` (the Vite dev
  server) — not `*`.
- No page image is ever written to disk; decoded buffers are discarded after each
  request.
- No external OCR API of any kind is called. Model weights are downloaded once, from
  PaddlePaddle's own official model hub, on first use — not per-request.
- No document text is logged.
- Single request at a time; no queue/concurrency control. Not a problem for this app's
  actual usage pattern (one user, one selection OCR'd at a time), but a known limitation
  worth revisiting if this service is ever asked to serve more than one client at once.
