# PyMuPDF local layout service (Prototype 2.4B-R8)

**Status: selection-reconstruction authority for cross-block/cross-page PDF text
selection.** PDF.js remains the viewer (continuous scroll, canvas, text layer, native
drag, endpoint acquisition); this service resolves a drag's start/end endpoints to
PyMuPDF's own native paragraph blocks and reconstructs the text between them when they
differ. Same-block selections continue to use the browser's own native selection text
directly — this service is never consulted for those.

This service must be started manually before cross-block/cross-page PDF selection will
work, exactly like `services/paddle_ocr/`; the app never spawns it and there is no
installer/launcher yet.

## Why a separate Python service

Six rounds of a PDF.js-only, hand-built geometry/typography heuristic (column-anchor
inference, gutter detection, font-height block segmentation, drop-cap merging — see
`docs/design-notes.md`, Prototype 2.4B-R1 through R5B) kept finding new failure classes on
new real papers. Prototype 2.4B-R6 compared this against dedicated PDF layout libraries on
the exact PDFs that had broken the custom approach; PyMuPDF's own native
`page.get_text("dict")` block segmentation solved every one of them with zero custom
heuristics (R6/R7). There is no practical in-browser equivalent with comparable native
block-segmentation quality, so — same reasoning as the PaddleOCR service — a local Python
process is the only realistic way to use it.

## Version policy

Pinned to the exact versions validated in Prototype 2.4B-R6/R7/R8. Do not bump to
"latest" without re-running the Failure A/B + Elsevier/MDPI fixture validation described
below — block-boundary behavior can shift between PyMuPDF versions.

- Python 3.12 (any modern 3.x should work; not independently verified below 3.12)
- `pymupdf==1.28.2`
- `fastapi==0.141.1`, `uvicorn==0.52.3`, `python-multipart==0.0.32`

No GPU, no large downloaded model weights — PyMuPDF is a C-library binding, not a
learned model.

## Setup (manual — no installer yet)

The venv is **not** committed — only this source, `requirements.txt`, and this README
live in the repository, matching `services/paddle_ocr/`.

```powershell
cd services/pymupdf_layout
python -m venv venv
venv\Scripts\pip install -r requirements.txt
```

## Running

```powershell
venv\Scripts\python main.py
```

Binds `127.0.0.1:8009` only — never `0.0.0.0`. Chosen to sit next to the PaddleOCR
service's `8008` without colliding.

```powershell
curl http://127.0.0.1:8009/health
```

```json
{ "status": "ok", "engine": "pymupdf", "serviceVersion": "prototype-2.4b-r8" }
```

`serviceVersion` exists specifically so a stale process from an earlier code change can be
told apart from a freshly-restarted one — bump it whenever `main.py`'s selection-
reconstruction logic changes. (A stale process silently serving pre-fix behavior after an
apparently-successful restart was a real issue during Prototype 2.4B-R7's own development;
see `docs/design-notes.md` for that incident.)

```powershell
# from the repo root, in a separate terminal
npm run dev
```

The app's dev server must run on `http://localhost:5173` (or `127.0.0.1:5173`) — CORS is
restricted to exactly those two origins (`ALLOWED_ORIGINS` in `main.py`), matching
`services/paddle_ocr/`.

```powershell
venv\Scripts\python -m pytest
```

`tests/test_service.py` (synthetic PDFs, always runs) covers the core API. `tests/test_fixtures.py`
additionally validates against real personal papers that are never committed to the
repository — each fixture's path comes from an environment variable, and its test skips
cleanly (not fails) if that variable is unset or the file isn't present:

```powershell
$env:PGT_FIXTURE_SOENEN_PDF   = "D:\path\to\your\soenen-2005-scs-c.pdf"
$env:PGT_FIXTURE_ELSEVIER_PDF = "C:\path\to\your\elsevier-paper.pdf"
$env:PGT_FIXTURE_MDPI_PDF     = "C:\path\to\your\mdpi-paper.pdf"
venv\Scripts\python -m pytest
```

### Restarting during development

`uvicorn`'s default (non-`--reload`) mode does not pick up code changes automatically.
Kill the running process by PID (`Get-Process python | Where-Object Path -like
"*pymupdf_layout*" | Stop-Process -Force`) before relaunching, and re-check `/health`'s
`serviceVersion` to confirm the new process is actually serving.

## API

### `GET /health`

See above. The app's own availability check should treat a non-`"ok"` `status`, a missing
response, or a connection failure as "cross-block reconstruction unavailable" — same-page/
same-block selections are unaffected either way, since they never call this service.

### `POST /document/register`

Multipart upload, field name `file`, the PDF bytes the browser already has in memory from
the file input (a browser `File`/`Blob` never exposes a filesystem path, so this is the
only way a PDF can reach this service — no raw-path API exists here at all). Response:

```json
{ "documentId": "3fa4...c21", "numPages": 12 }
```

Call this once when the user opens a PDF; use `documentId` for every subsequent call for
that document. The uploaded bytes are held in memory only (`pymupdf.open(stream=...)`,
never written to disk) until `/document/close` is called or the service process exits.

### `POST /document/close`

```json
{ "documentId": "3fa4...c21" }
```

Releases the document handle and its per-page block cache. Call this when the user opens
a different PDF or navigates away — do not leave old documents registered indefinitely.

### `POST /layout/page` (diagnostic/optional for the frontend)

```json
{ "documentId": "3fa4...c21", "pageNumber": 1 }
```

Returns that page's native PyMuPDF text blocks (paragraph-level, with per-line/per-span
bbox and font size), normalized to top-down (0-1) page fractions. Cached per
`(documentId, pageNumber)` — never re-parses a page that's already been extracted for this
document.

### `POST /layout/selection` (primary)

```json
{
  "documentId": "3fa4...c21",
  "start": { "pageNumber": 1, "xNorm": 0.0667, "yNorm": 0.7966, "boundaryText": "These techniques have been", "direction": "forward" },
  "end":   { "pageNumber": 1, "xNorm": 0.5095, "yNorm": 0.4290, "boundaryText": "applied in forested areas [1]–[3], [9], [11] and are based on an", "direction": "backward" }
}
```

- `xNorm`/`yNorm`: page-local normalized (0-1, top-down) coordinates of the drag endpoint
  — the same convention PDF.js's own text-item geometry already uses in this app (see
  `src/features/pdf/domain/pageTextClassifier.ts`), no unit conversion needed on either
  side.
- `boundaryText`: the exact click-to-end-of-line (`forward`) or start-of-line-to-click
  (`backward`) text, produced the same way the app's existing `extractWithinLine` DOM
  traversal already does. **Never a DOM character offset** — PDF.js and PyMuPDF can
  legitimately disagree about ligature/whitespace-normalized character positions, so this
  service verifies the coordinate-identified line by exact substring match against
  `boundaryText` (never fuzzy/semantic matching) and falls back to a page-wide exact
  search if the coordinate guess and the text disagree — this is what makes endpoint
  resolution robust to imprecise clicks (confirmed necessary by a real bug found in
  Prototype 2.4B-R7: a click landing in the gap between two blocks).

Response:

```json
{
  "startBlockId": "1:12",
  "endBlockId": "1:18",
  "sameBlock": false,
  "reconstructedText": "These techniques have been\napplied in forested areas [1]–[3], [9], [11] and are based on an",
  "fragments": [{ "pageNumber": 1, "text": "These techniques have been\napplied in forested areas [1]–[3], [9], [11] and are based on an" }]
}
```

`sameBlock: true` means the caller should use the browser's own native selection text
instead — `reconstructedText`/`fragments` are empty in that case, since native Range
selection is already exact for a same-block selection and needn't be second-guessed.

## Local-only / security

- Binds `127.0.0.1` only.
- CORS restricted to `http://localhost:5173` / `http://127.0.0.1:5173` — not `*`.
- No filesystem path is ever accepted from a client — only `documentId` values this
  service itself issued via `/document/register`.
- Uploaded PDF bytes are never written to disk; released on `/document/close` or process
  exit.
- No external layout/document API of any kind is called — PyMuPDF is a local C-library
  binding, not a network client.
- Single request at a time; no queue/concurrency control, matching
  `services/paddle_ocr/`'s own documented limitation.

## License

PyMuPDF is licensed under **AGPL-3.0**, with a commercial license available from Artifex
(the maintainer) for proprietary use. Local/personal development and use is unaffected.
**If Paper Grammar Tutor is ever distributed to others** (public release, hosted service,
sale), this requires either releasing the app under an AGPL-compatible license or
purchasing a commercial license from Artifex — a decision to make at that time, not
resolved here. No AGPL notice is shown in the app's own UI; this is a developer-facing
note only.

## Real-fixture validation

This service's block-boundary behavior was validated against the exact real PDFs that
broke the retired custom heuristic (Prototype 2.4B-R7/R8) — see
`tests/test_fixtures.py` for the automated version of that validation, covering:

- the Soenen (2005) "SCS+C" paper's same-page cross-column selection (author footnote and
  figure caption both correctly excluded, despite the footnote sharing the left column's
  x-range and the caption sharing the right column's),
- its cross-page selection (unrelated later sections excluded),
- the Elsevier remote-sensing paper's cross-page selection (previously validated clean in
  R3/R4/R5B),
- the MDPI single-column paper's cross-page selection, including its page-1-only
  DOI/journal footer (excluded by font-height difference, no repetition-based detection
  needed).
