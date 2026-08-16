"""Prototype 2.4B-R8 -- PyMuPDF local layout service (production).

Selection-reconstruction authority for cross-block/cross-page PDF text selection (see
docs/design-notes.md, Prototype 2.4B-R1 through R8, for the full history of why a custom
PDF.js-only heuristic was retired in favor of this). PDF.js remains the viewer (continuous
scroll, canvas, text layer, native drag, endpoint acquisition) -- this service is consulted
only to resolve a drag's start/end endpoints to PyMuPDF's own native paragraph blocks and,
when they differ, reconstruct the block-bounded text between them.

Local-only by design, matching services/paddle_ocr/main.py's own conventions: binds
127.0.0.1, CORS restricted to the Vite dev origins, no PDF content is ever sent anywhere
else. Uploaded PDF bytes are held in memory only (PyMuPDF opened via `stream=`, never
written to disk) for the lifetime of a registered document; `/document/close` releases them.
"""

import re
import unicodedata
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import pymupdf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

SERVICE_VERSION = "prototype-2.4b-r8"

# Matches services/paddle_ocr/main.py -- only the dev Vite server may call this service.
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


class _DocumentState:
    def __init__(self, doc: "pymupdf.Document"):
        self.doc = doc
        self.page_cache: dict[int, "PageBlocks"] = {}


class _ServiceState:
    documents: dict[str, _DocumentState] = {}


state = _ServiceState()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    for doc_state in state.documents.values():
        doc_state.doc.close()
    state.documents.clear()


app = FastAPI(title="Paper Grammar Tutor - PyMuPDF layout service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


# --- DTOs -------------------------------------------------------------------------------


class Span(BaseModel):
    text: str
    bbox: tuple[float, float, float, float]  # normalized (0-1) x0,y0,x1,y1, top-down
    size: float
    font: str


class Line(BaseModel):
    text: str
    bbox: tuple[float, float, float, float]
    spans: list[Span]


class Block(BaseModel):
    blockId: str
    bbox: tuple[float, float, float, float]
    lines: list[Line]


class PageBlocks(BaseModel):
    pageNumber: int
    width: float
    height: float
    blocks: list[Block]


class RegisterResponse(BaseModel):
    documentId: str
    numPages: int


class PageRequest(BaseModel):
    documentId: str
    pageNumber: int


class SelectionEndpoint(BaseModel):
    pageNumber: int
    xNorm: float
    yNorm: float
    boundaryText: str
    direction: str  # 'forward' | 'backward'


class SelectionRequest(BaseModel):
    documentId: str
    start: SelectionEndpoint
    end: SelectionEndpoint


class Fragment(BaseModel):
    pageNumber: int
    text: str


class SelectionResponse(BaseModel):
    startBlockId: str
    endBlockId: str
    sameBlock: bool
    reconstructedText: Optional[str]
    fragments: list[Fragment]


class CloseRequest(BaseModel):
    documentId: str


class CloseResponse(BaseModel):
    closed: bool


# --- Document / page-block resolution ---------------------------------------------------


def _get_document_state(document_id: str) -> _DocumentState:
    doc_state = state.documents.get(document_id)
    if doc_state is None:
        raise HTTPException(status_code=404, detail={"error": "unknown_document", "message": "documentId not registered (or already closed)."})
    return doc_state


def _extract_page_blocks(document_id: str, page_number: int) -> PageBlocks:
    doc_state = _get_document_state(document_id)
    if page_number in doc_state.page_cache:
        return doc_state.page_cache[page_number]

    doc = doc_state.doc
    if page_number < 1 or page_number > doc.page_count:
        raise HTTPException(status_code=400, detail={"error": "bad_page_number", "message": f"page {page_number} out of range (1-{doc.page_count})"})
    page = doc[page_number - 1]
    width, height = page.rect.width, page.rect.height
    d = page.get_text("dict")

    blocks: list[Block] = []
    for bi, raw_block in enumerate(d["blocks"]):
        if raw_block.get("type") != 0:  # image blocks carry no selectable text
            continue
        lines: list[Line] = []
        for raw_line in raw_block["lines"]:
            spans: list[Span] = []
            line_text_parts = []
            for raw_span in raw_line["spans"]:
                bx0, by0, bx1, by1 = raw_span["bbox"]
                spans.append(Span(text=raw_span["text"], bbox=(bx0 / width, by0 / height, bx1 / width, by1 / height), size=raw_span["size"], font=raw_span["font"]))
                line_text_parts.append(raw_span["text"])
            if not spans:
                continue
            lx0, ly0, lx1, ly1 = raw_line["bbox"]
            lines.append(Line(text="".join(line_text_parts), bbox=(lx0 / width, ly0 / height, lx1 / width, ly1 / height), spans=spans))
        if not lines:
            continue
        bx0, by0, bx1, by1 = raw_block["bbox"]
        blocks.append(Block(blockId=f"{page_number}:{bi}", bbox=(bx0 / width, by0 / height, bx1 / width, by1 / height), lines=lines))

    result = PageBlocks(pageNumber=page_number, width=width, height=height, blocks=blocks)
    doc_state.page_cache[page_number] = result
    return result


def _find_block_at(blocks: list[Block], x: float, y: float) -> Optional[Block]:
    """Smallest containing block first; else nearest by bbox EDGE distance (not center --
    see docs/design-notes.md, Prototype 2.4B-R7, for the real click-in-inter-block-gap
    failure a center-distance fallback produced), preferring x-overlapping blocks."""
    containing = [b for b in blocks if b.bbox[0] <= x <= b.bbox[2] and b.bbox[1] <= y <= b.bbox[3]]
    if containing:
        def area(b: Block) -> float:
            return (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])
        return min(containing, key=area)
    if not blocks:
        return None

    def edge_dist(b: Block) -> float:
        dx = max(b.bbox[0] - x, 0, x - b.bbox[2])
        dy = max(b.bbox[1] - y, 0, y - b.bbox[3])
        return (dx * dx + dy * dy) ** 0.5

    x_overlapping = [b for b in blocks if b.bbox[0] <= x <= b.bbox[2]]
    pool = x_overlapping if x_overlapping else blocks
    return min(pool, key=edge_dist)


def _find_line_in_block(block: Block, y: float) -> Optional[Line]:
    containing = [l for l in block.lines if l.bbox[1] <= y <= l.bbox[3]]
    if containing:
        return containing[0]
    if not block.lines:
        return None
    def dist(l: Line) -> float:
        cy = (l.bbox[1] + l.bbox[3]) / 2
        return abs(cy - y)
    return min(block.lines, key=dist)


_LIGATURES = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl"}


def _normalize_for_match(text: str) -> str:
    """Comparison-only normalization (ligatures + NFKC + whitespace collapse) -- never
    applied to text actually returned to the caller."""
    for lig, plain in _LIGATURES.items():
        text = text.replace(lig, plain)
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", " ", text).strip()


def _find_line_containing_anchor(page_blocks: PageBlocks, norm_anchor: str, near_x: float, near_y: float) -> Optional[tuple[Block, Line]]:
    """Page-wide exact-substring anchor search (never fuzzy/semantic). If the anchor text
    appears on more than one line, the coordinate-nearest match wins (never the first
    textual match) -- a short/common boundaryText could otherwise recur elsewhere on the
    page."""
    candidates: list[tuple[Block, Line]] = []
    for b in page_blocks.blocks:
        for l in b.lines:
            if norm_anchor in _normalize_for_match(l.text):
                candidates.append((b, l))
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    def dist(pair: tuple[Block, Line]) -> float:
        _, l = pair
        cx, cy = (l.bbox[0] + l.bbox[2]) / 2, (l.bbox[1] + l.bbox[3]) / 2
        return (cx - near_x) ** 2 + (cy - near_y) ** 2
    return min(candidates, key=dist)


def _resolve_endpoint(document_id: str, ep: SelectionEndpoint) -> tuple[PageBlocks, Block, Line]:
    page_blocks = _extract_page_blocks(document_id, ep.pageNumber)
    x, y = ep.xNorm, ep.yNorm
    block = _find_block_at(page_blocks.blocks, x, y)
    if block is None:
        raise HTTPException(status_code=422, detail={"error": "no_block", "message": "no text block found on page"})
    line = _find_line_in_block(block, y)
    if line is None:
        raise HTTPException(status_code=422, detail={"error": "no_line", "message": "no line found in block"})

    norm_anchor = _normalize_for_match(ep.boundaryText)
    if norm_anchor and norm_anchor not in _normalize_for_match(line.text):
        same_block_candidates = [l for l in block.lines if norm_anchor in _normalize_for_match(l.text)]
        if same_block_candidates:
            line = same_block_candidates[0]
        else:
            page_wide = _find_line_containing_anchor(page_blocks, norm_anchor, x, y)
            if page_wide is not None:
                block, line = page_wide
        # else: keep the coordinate-based block/line -- conservative, no fabricated jump.
    return page_blocks, block, line


def _middle_page_text(document_id: str, page_number: int) -> str:
    """A page fully spanned by a 3+ page selection (neither the start nor end page) --
    every block's own text, in the page's own block order, EXCLUDING blocks whose dominant
    font size differs from the page's own most common (body) size by more than 12% (the
    same tolerance the retired custom heuristic used for its own font-height block
    splitting, R5B). This keeps a running header/footer or footnote-sized block from being
    silently re-injected just because a page happens to be fully spanned, without needing
    any zone/column concept -- PyMuPDF's blocks carry no such label."""
    page_blocks = _extract_page_blocks(document_id, page_number)
    if not page_blocks.blocks:
        return ""
    sizes = [span.size for b in page_blocks.blocks for l in b.lines for span in l.spans]
    sizes.sort()
    dominant = sizes[len(sizes) // 2] if sizes else 0.0
    lines_out: list[str] = []
    for b in page_blocks.blocks:
        block_sizes = [span.size for l in b.lines for span in l.spans]
        block_dominant = sorted(block_sizes)[len(block_sizes) // 2] if block_sizes else 0.0
        if dominant > 0 and abs(block_dominant - dominant) / dominant > 0.12:
            continue
        lines_out.extend(l.text for l in b.lines)
    return "\n".join(lines_out)


def _assemble_block_boundary_text(block: Block, line: Line, direction: str, boundary_text: str) -> str:
    idx = block.lines.index(line)
    if direction == "forward":
        other = block.lines[idx + 1 :]
        other_text = "\n".join(l.text for l in other)
        return "\n".join(t for t in [boundary_text, other_text] if t)
    other = block.lines[:idx]
    other_text = "\n".join(l.text for l in other)
    return "\n".join(t for t in [other_text, boundary_text] if t)


# --- Endpoints ----------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok", "engine": "pymupdf", "serviceVersion": SERVICE_VERSION}


@app.post("/document/register", response_model=RegisterResponse)
async def register_document(file: UploadFile = File(...)):
    """Item 13-16: the ONLY way a PDF reaches this service -- multipart upload of the bytes
    the browser already has in memory (a browser File/Blob exposes no filesystem path at
    all, so this isn't a design choice among alternatives so much as the only option). No
    raw filesystem path is ever accepted as selection-time input; only the opaque
    `documentId` this endpoint returns is valid on later calls."""
    raw = await file.read()
    try:
        doc = pymupdf.open(stream=raw, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=400, detail={"error": "invalid_pdf", "message": str(exc)}) from exc
    finally:
        del raw
    document_id = str(uuid.uuid4())
    state.documents[document_id] = _DocumentState(doc)
    return RegisterResponse(documentId=document_id, numPages=doc.page_count)


@app.post("/document/close", response_model=CloseResponse)
def close_document(req: CloseRequest):
    doc_state = state.documents.pop(req.documentId, None)
    if doc_state is not None:
        doc_state.doc.close()
    return CloseResponse(closed=doc_state is not None)


@app.post("/layout/page", response_model=PageBlocks)
def layout_page(req: PageRequest):
    _get_document_state(req.documentId)  # 404s cleanly if unknown/closed
    return _extract_page_blocks(req.documentId, req.pageNumber)


@app.post("/layout/selection", response_model=SelectionResponse)
def layout_selection(req: SelectionRequest):
    _get_document_state(req.documentId)
    start_page, start_block, start_line = _resolve_endpoint(req.documentId, req.start)
    end_page, end_block, end_line = _resolve_endpoint(req.documentId, req.end)

    same_block = req.start.pageNumber == req.end.pageNumber and start_block.blockId == end_block.blockId
    if same_block:
        return SelectionResponse(startBlockId=start_block.blockId, endBlockId=end_block.blockId, sameBlock=True, reconstructedText=None, fragments=[])

    # Item 13/23: normalize to logical first/last by page number -- earlier page always
    # wins, independent of which endpoint the caller physically labeled "start" vs "end"
    # (a reverse drag across pages must reconstruct identically to a forward one).
    if req.start.pageNumber <= req.end.pageNumber:
        first_page, first_block, first_line, first_boundary = req.start.pageNumber, start_block, start_line, req.start.boundaryText
        last_page, last_block, last_line, last_boundary = req.end.pageNumber, end_block, end_line, req.end.boundaryText
    else:
        first_page, first_block, first_line, first_boundary = req.end.pageNumber, end_block, end_line, req.end.boundaryText
        last_page, last_block, last_line, last_boundary = req.start.pageNumber, start_block, start_line, req.start.boundaryText

    first_text = _assemble_block_boundary_text(first_block, first_line, "forward", first_boundary)
    last_text = _assemble_block_boundary_text(last_block, last_line, "backward", last_boundary)

    if first_page == last_page:
        # Same page, different block (e.g. same-page cross-column) -- one fragment, no
        # middle-page concept applies.
        combined = first_text + "\n" + last_text
        fragments = [Fragment(pageNumber=first_page, text=combined)]
    else:
        fragments = [Fragment(pageNumber=first_page, text=first_text)]
        # Item 5 (R1)/45 (R5B), preserved: a page fully spanned by a 3+ page selection
        # contributes its own body-height content, never re-injecting header/footer/
        # footnote-sized blocks just because the page happens to be fully spanned.
        for mid_page in range(first_page + 1, last_page):
            mid_text = _middle_page_text(req.documentId, mid_page)
            if mid_text.strip():
                fragments.append(Fragment(pageNumber=mid_page, text=mid_text))
        fragments.append(Fragment(pageNumber=last_page, text=last_text))
        combined = "\n".join(f.text for f in fragments)

    return SelectionResponse(startBlockId=start_block.blockId, endBlockId=end_block.blockId, sameBlock=False, reconstructedText=combined, fragments=fragments)


if __name__ == "__main__":
    import uvicorn

    # 127.0.0.1 only -- never 0.0.0.0. See README "Local-only / security" section.
    uvicorn.run(app, host="127.0.0.1", port=8009)
