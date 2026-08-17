"""Prototype 2.5G -- PyMuPDF local layout service (production).

Selection-reconstruction authority for cross-block/cross-page PDF text selection (see
docs/design-notes.md, Prototype 2.4B-R1 through R8, for the full history of why a custom
PDF.js-only heuristic was retired in favor of this). PDF.js remains the viewer (continuous
scroll, canvas, text layer, native drag, endpoint acquisition) -- this service is consulted
only to resolve a drag's start/end endpoints to PyMuPDF's own native paragraph blocks and,
when they differ, reconstruct the block-bounded text between them.

Prototype 2.5B added two equation-adjacent safety checks: an "equation-number-like"
isolated-block guard (never accept a bare "(N)" block as a real endpoint) and a
suspicious-gap detector (flag a likely untextracted vector-only glyph -- e.g. an inline
math variable with no Unicode mapping -- between two adjacent spans on the same visual
row). 2.5B's gap detector, however, warned on EVERY suspicious gap unconditionally,
which turned out to also fire on ordinary column gutters and (in some PDFs) ordinary
inter-word spacing -- a real regression found in Prototype 2.5C/D testing, not merely a
theoretical risk (see docs/design-notes.md). Prototype 2.5E fixes this and completes the
missing-glyph story:

- A gap is only ever acted on when it sits directly between two lines that are actually
  ADJACENT in a selection's own assembled reading order (never "any gap that happens to
  touch a page-wide line somewhere") -- this alone excludes nearly all cross-column/
  unrelated-row noise.
- Any remaining candidate gap is rendered and visually classified (2.5D's "visual ink
  gate" -- deterministic pixel analysis, no ML) before anything else happens: no ink ->
  the candidate is dropped silently (ordinary whitespace/gutter); ink present -> it's a
  genuine unextractable-glyph recovery candidate.
- A genuine candidate is recovered via a localized crop of its own two bounding lines,
  OCR'd through the existing local Paddle service, and only the substring strictly
  between two exact, trusted (PyMuPDF-extracted) anchor texts is ever inserted --
  PyMuPDF/PDF.js text is never replaced wholesale by OCR output. If recovery can't be
  confidently completed (Paddle unavailable, no confident anchor match, low confidence),
  the whole selection fails explicitly rather than silently dropping the glyph.

The isolated equation-number endpoint guard (2.5B) is a separate, independent mechanism
from missing-glyph recovery. Prototype 2.5G extends it: rather than always failing when an
endpoint resolves to an equation-number block with no recoverable prose, it now recognizes
a genuine prose-crossing-into-a-display-equation selection and builds a "[式 (N)]"
placeholder from the equation-number block's own already-extracted text (no OCR, no
equation-body recognition) -- see this service's own README ("Equation-number endpoint
guard and display-equation placeholder").

Local-only by design, matching services/paddle_ocr/main.py's own conventions: binds
127.0.0.1, CORS restricted to the Vite dev origins, no PDF content is ever sent anywhere
else. Uploaded PDF bytes are held in memory only (PyMuPDF opened via `stream=`, never
written to disk) for the lifetime of a registered document; `/document/close` releases them.

Prototype 2.5J adds a THIRD, narrowly-gated routing branch: a selection whose start AND end
both resolve to ordinary prose (neither is an equation-number endpoint), on the same page,
in the same local corridor, with a genuine display-equation-number block found strictly
between them in reading order. This was found missing in Prototype 2.5I: the ordinary
cross-block path (below) only ever uses the start block's own trailing lines and the end
block's own leading lines -- it never walks blocks in between, so a display equation (plus
any further prose after it, like Soenen's "where Ln is the normalized radiance, ...")
sitting between two prose endpoints was silently dropped, not reconstructed. This stays a
SEPARATE branch from the ordinary cross-block path's own semantics (Failure A's
cross-column selection, with an unrelated footnote and figure caption geometrically between
its two blocks, must never enter an intermediate-block walk merely because block IDs lie
between the endpoints).

Prototype 2.5L adds two more, deliberately independent fixes found during live acceptance
of 2.5J (see docs/design-notes.md, "Prototype 2.5K", for the investigation both were built
from):

- **Parenthesized inline glyph recovery**: a vector-only inline glyph tightly hugged by
  parentheses with NO surrounding spaces (e.g. "(b)", the real Soenen "regression slope
  (b) and intercept (a)") produces a NARROWER gap than an ordinary inter-word space needs
  to trigger the existing width-based candidate rule -- the opposite failure mode from the
  original "k" case (a wide gap from a whole missing word between two spaced words). Fixed
  by adding a second, independent structural candidacy rule to `_detect_suspicious_gaps`:
  a gap whose left neighbor span ends with "(" and right neighbor starts with ")" is also a
  candidate once it clears the same absolute floor -- the visual-ink gate and localized OCR
  stages are entirely unchanged and unaware this rule exists.
- **Display-equation region suppression**: some display equations (the real Soenen
  equations (8)/(9)) contain extractable text fragments belonging to the formula's own
  body (e.g. a bare "C" on the equation's own row, or on a fraction's numerator/denominator
  row) alongside the equation-number block. Prior to 2.5L, the two then-separate equation
  assembly paths both treated these fragments as ordinary prose, leaking them into the
  reconstructed text (confirmed via a real live call: "term\nC\nC\n[式 (9)]\n...").
  `_display_equation_region_blocks` anchors ONLY on an already-confirmed
  `_is_equation_number_like_block` match and walks a tightly bounded, local region around it
  (same corridor, small vertical gap, single-line/single-token/narrow-width fragment blocks
  only) -- every member block is consumed as part of the ONE `[式 (N)]` placeholder, never
  emitted as its own text.

Prototype 2.5M/2.5N: live acceptance of 2.5L found a real, reproducible COMPOUND-selection
bug -- a selection whose own END endpoint IS an equation number (e.g. "...(b) and intercept
(a)" -> equation (8) -> "...additive term" -> equation (9) as the actual selection end) was
claimed entirely by the (then-separate) equation-at-end algorithm, which had zero awareness
of any OTHER equation-number block (equation (8)) encountered earlier in the same
selection -- leaking its raw formula fragments and raw equation number straight into the
prose, even though EACH mechanism worked correctly in isolation (2.5L's own 86 tests never
covered a selection containing two equations where the first is intermediate and the second
is the endpoint). Prototype 2.5N replaces the two separate, mutually unaware algorithms with
ONE unified equation-aware sequence assembler (`_resolve_equation_aware_selection`): an
equation-number endpoint is now just the terminal item of the same ordered
[PROSE_GROUP, DISPLAY_EQUATION, ...] walk 2.5J already used for intermediate equations, so
every equation-number block in the selected range -- endpoint or intermediate -- is
discovered and region-suppressed by the exact same mechanism before any text is assembled.
Also fixes a related, previously-unnoticed formatting gap: a parenthesized recovered glyph
("(b)") used to be joined into three separate newline-then-space-collapsed parts by the
frontend's own normalization, becoming the non-source-faithful "( b )" -- now assembled as
one tight logical unit at the point of recovery (`_assemble_lines_with_gap_recovery`), so
ordinary word-boundary recovery ("of"/"k"/"can" -> "of k can") is completely unaffected.
"""

import os
import re
import unicodedata
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import httpx
import pymupdf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

SERVICE_VERSION = "prototype-2.5q"

# Prototype 2.5P: dev-only diagnostic trace for /layout/selection -- default OFF, mirrors
# the frontend's own existing "[PGT-TRACE]" convention (src/features/pdf/components/
# PdfViewer.tsx, gated by import.meta.env.DEV). Never changes reconstruction behavior; only
# reports the request/response and internal resolution the existing code already produced.
# Logs the request's own boundaryText/coordinates and reconstructed text, never raw PDF
# bytes or unrelated document content. Intended to be removed or clearly isolated before any
# checkpoint that ships this file -- see docs/design-notes.md, "Prototype 2.5P".
LAYOUT_TRACE_ENABLED = os.environ.get("PGT_LAYOUT_TRACE") == "1"


def _trace(label: str, **fields) -> None:
    if not LAYOUT_TRACE_ENABLED:
        return
    rendered = " ".join(f"{k}={fields[k]!r}" for k in fields)
    print(f"[PGT-TRACE] {label} {rendered}")

# Prototype 2.5B item 4/5: an "equation-number-like" block is a single-line block whose
# ENTIRE text is nothing but "(N)" -- deliberately narrow (see docs/design-notes.md,
# Prototype 2.5A) so ordinary prose like "(5) shows that..." (more text than just the
# number, or spread across multiple lines) is never affected. Isolation (the block has no
# other content at all) is the safety margin, not a right-margin/position assumption.
EQUATION_NUMBER_PATTERN = re.compile(r"^\(\d{1,3}\)$")
# Normalized (0-1) page-width fraction; the real Soenen "(5)" block measured ~0.02 wide.
EQUATION_NUMBER_BLOCK_MAX_WIDTH_NORM = 0.08

# Prototype 2.5B item 10/11: a gap between two adjacent spans on the same visual row is a
# CANDIDATE (never acted on by itself -- see the 2.5D visual-ink gate below) when it
# clearly exceeds normal inter-word/inter-span spacing -- expressed relative to font size
# (never a fixed pixel value, so it scales with the document's own typography) plus an
# absolute floor to avoid noise on very small fonts.
SUSPICIOUS_GAP_EM_MULTIPLIER = 0.6
SUSPICIOUS_GAP_MIN_PT = 2.0

# Prototype 2.5L item 6/7/8: a SECOND, independent candidacy rule -- a vector-only glyph
# tightly hugged by round parentheses with no surrounding spaces (the real Soenen
# "regression slope (b) and intercept (a)") produces a gap NARROWER than the em-multiplier
# rule above requires (real measured gaps: 4.36pt/5.38pt at 9.96pt font, both under the
# em-multiplier's 5.98pt requirement, but both above SUSPICIOUS_GAP_MIN_PT). Deliberately
# does NOT lower SUSPICIOUS_GAP_EM_MULTIPLIER globally (item 5 -- that would also start
# flagging ordinary inter-word spaces, this document's own measuring 3.35pt/0.336em, as
# candidates everywhere). Round parentheses only for now (item 7) -- the validated real
# corpus is "(a)"/"(b)"/"(i)"; square/curly brackets interact with citation-bracket
# semantics (2.5H) and are out of scope until a real case needs them. The glyph itself
# still comes exclusively from the unchanged visual-ink + localized-OCR + anchor-only
# pipeline below (item 8) -- this only ever widens which gaps become CANDIDATES.
PARENTHESIZED_GAP_OPEN = "("
PARENTHESIZED_GAP_CLOSE = ")"

# Prototype 2.5L item 23/26: display-equation region suppression -- deliberately a TIGHTLY
# LOCAL, bounded walk from an already-confirmed equation-number anchor (never an unbounded
# "walk until it looks like prose" heuristic). EQUATION_REGION_FRAGMENT_MAX_WIDTH_NORM is
# derived from real Soenen equation (8)/(9) geometry: the real "C" formula-fragment blocks
# measure ~6.6pt wide (~0.011 normalized on this page), while every real prose block nearby
# -- including the short tail-of-paragraph "intercept (" at 41.18pt/0.069 normalized --
# measures at least 0.069, nearly 6x higher. 0.05 sits with a wide margin on both sides.
# EQUATION_REGION_MAX_VERTICAL_GAP_EM: the real "C" fragments sit at vertical gap 0 (same
# row as the equation number, or an immediately adjacent/overlapping row); the nearest real
# prose paragraph sits 15.3pt away (~1.5x the equation-number block's own line height) --
# 1.0x line height leaves comfortable margin on both sides. EQUATION_REGION_MAX_FRAGMENTS
# is a defensive cap only (the vertical-gap/corridor/fragment-shape conditions are expected
# to terminate the walk well before this in practice).
EQUATION_REGION_FRAGMENT_MAX_WIDTH_NORM = 0.05
EQUATION_REGION_MAX_VERTICAL_GAP_EM = 1.0
EQUATION_REGION_MAX_FRAGMENTS = 4

# Prototype 2.5D/E: deterministic visual-ink classification of a candidate gap, ported
# from the 2.5D spike (see docs/design-notes.md for the full derivation and dataset).
# Rendered at this scale, grayscale; a per-crop background is estimated from its own 90th
# brightness percentile (never a hardcoded pure-white 255, in case a page background isn't
# pure white) and a pixel counts as "ink" once it's clearly darker than that. The ratio is
# measured only in the horizontally-inset central region, to avoid edge-bleed/antialiasing
# from neighboring glyphs just outside the crop. EMPIRICAL, not a universal constant: 2.5D
# measured real positives (k/e/theta/Ln) at 0.1185-0.2068 and every tested false-positive
# (ordinary spaces, column gutters, ordinary MDPI word gaps) at exactly 0.0000 -- the
# threshold sits with a wide margin below the observed positive floor, but the corpus this
# was validated against is finite; keep safe-failure available for anything it misjudges.
VISUAL_INK_RENDER_SCALE = 4
VISUAL_INK_BACKGROUND_PERCENTILE = 0.90
VISUAL_INK_BACKGROUND_DELTA = 40
VISUAL_INK_CENTRAL_INSET_FRACTION = 0.15
VISUAL_INK_CENTRAL_RATIO_THRESHOLD = 0.05

# Prototype 2.5E: the existing local Paddle OCR service (services/paddle_ocr) -- reused
# as-is, never a second OCR engine. Only ever called for a visual-ink-positive gap; never
# for ordinary selections (item 23/64 -- Paddle being offline must not affect ordinary
# text-only PDF reading). Confidence threshold is conservative relative to the 2.5C
# spike's observed real-recovery range (0.959-1.000).
PADDLE_OCR_URL = "http://127.0.0.1:8008"
PADDLE_OCR_TIMEOUT_S = 10.0
OCR_CONFIDENCE_THRESHOLD = 0.90

# Prototype 2.5J: local-geometry "same corridor" test for the cross-equation continuation
# path -- deliberately NOT a global LEFT_COLUMN/RIGHT_COLUMN/FULL_WIDTH classifier (2.4B
# retired those; see docs/design-notes.md). Two blocks share a corridor when their own
# x-ranges overlap by at least this fraction of the NARROWER block's own width -- relative
# to width (not a fixed pt tolerance) so a narrow equation-number block (e.g. ~12pt wide)
# correctly reads as fully contained within a much wider prose column. Empirical margin from
# real Soenen page 2 geometry (Prototype 2.5I): the real equation (6) case measures a full
# 1.0 overlap ratio (eqnum block x=[540.6,552.2]pt entirely inside prose column
# x=[301.1,552.2]pt); the real Failure A cross-column case measures 0.0 (left column
# x1~=293pt sits strictly left of right column x0~=302pt, no overlap at all) -- wide margin
# on both sides of this threshold.
CORRIDOR_X_OVERLAP_MIN_FRACTION = 0.5

# Prototype 2.5ZG-BACKEND: conservative line-level footer-boilerplate filtering. These
# thresholds come from the reproduced Elsevier fixture, whose polluted line is at
# y=[0.9309, 0.9390], spans 0.699 of the page width, and uses 6.376pt text versus the
# page body's 7.970pt. Geometry is the authority: textual legal markers are only
# supporting evidence, and at least two independent marker groups are required. A line
# that fails any one condition is retained.
BOILERPLATE_BOTTOM_Y_MIN_NORM = 0.90
BOILERPLATE_MIN_WIDTH_NORM = 0.50
BOILERPLATE_MAX_BODY_FONT_RATIO = 0.88
BODY_FONT_SAMPLE_MAX_Y_NORM = 0.85

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


class SuspiciousGap(BaseModel):
    """A page-space region (normalized 0-1) between two adjacent spans on the same visual
    row where a glyph likely exists but produced no extractable text at all -- see
    docs/design-notes.md, Prototype 2.5A/B, for the real "k" case this was built from."""

    bbox: tuple[float, float, float, float]


class PageBlocks(BaseModel):
    pageNumber: int
    width: float
    height: float
    blocks: list[Block]
    suspiciousGaps: list[SuspiciousGap] = []


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
    # Structural fact only (same PyMuPDF block) -- Prototype 2.5E item 38: no longer the
    # sole routing signal. `reconstructedText` non-null means "use this text" regardless
    # of sameBlock (a same-block selection whose native Range text would be missing a
    # recovered glyph gets its OWN repaired reconstructedText here); sameBlock=True with
    # reconstructedText=None is the fast, unaffected common case (native Range text, no
    # gap involved at all).
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
    raw_spans_pt: list[dict] = []  # every span's own raw (pt, unnormalized) geometry, across ALL blocks -- gap detection needs to compare adjacent spans regardless of which block PyMuPDF happened to put them in (see docs/design-notes.md, Prototype 2.5A: two spans on the SAME visual row can legitimately land in different blocks).
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
                if raw_span["text"].strip():
                    # Prototype 2.5L item 9: "text" is threaded through so the punctuation-
                    # bounded candidacy rule below can check bracket-adjacency; this is the
                    # span's own already-reliably-extracted PyMuPDF text (never OCR/guessed),
                    # so it doesn't compromise _detect_suspicious_gaps's existing "pure
                    # geometry, no dictionary/content guessing" contract for the ordinary rule.
                    raw_spans_pt.append({"x0": bx0, "y0": by0, "x1": bx1, "y1": by1, "size": raw_span["size"], "text": raw_span["text"]})
            if not spans:
                continue
            lx0, ly0, lx1, ly1 = raw_line["bbox"]
            lines.append(Line(text="".join(line_text_parts), bbox=(lx0 / width, ly0 / height, lx1 / width, ly1 / height), spans=spans))
        if not lines:
            continue
        bx0, by0, bx1, by1 = raw_block["bbox"]
        blocks.append(Block(blockId=f"{page_number}:{bi}", bbox=(bx0 / width, by0 / height, bx1 / width, by1 / height), lines=lines))

    suspicious_gaps = _detect_suspicious_gaps(raw_spans_pt, width, height)
    result = PageBlocks(pageNumber=page_number, width=width, height=height, blocks=blocks, suspiciousGaps=suspicious_gaps)
    doc_state.page_cache[page_number] = result
    return result


def _detect_suspicious_gaps(spans_pt: list[dict], width: float, height: float) -> list[SuspiciousGap]:
    """Prototype 2.5B item 10/11: groups spans into visual rows by y-center proximity
    (independent of block membership -- see _extract_page_blocks), then flags any
    same-row adjacent-span gap that clearly exceeds normal spacing relative to font size.
    Pure/deterministic; never uses content (no dictionary/LLM guessing, item 9)."""
    if not spans_pt:
        return []
    rows: list[list[dict]] = []
    for s in sorted(spans_pt, key=lambda s: (s["y0"] + s["y1"]) / 2):
        cy = (s["y0"] + s["y1"]) / 2
        s_height = max(s["y1"] - s["y0"], 1.0)
        placed = False
        for row in rows:
            row_cy = sum((r["y0"] + r["y1"]) / 2 for r in row) / len(row)
            row_height = max(max(r["y1"] - r["y0"] for r in row), 1.0)
            tol = 0.4 * min(s_height, row_height)
            if abs(cy - row_cy) <= tol:
                row.append(s)
                placed = True
                break
        if not placed:
            rows.append([s])

    gaps: list[SuspiciousGap] = []
    for row in rows:
        row_sorted = sorted(row, key=lambda s: s["x0"])
        for a, b in zip(row_sorted, row_sorted[1:]):
            gap = b["x0"] - a["x1"]
            if gap <= 0:
                continue
            ref_size = max(a["size"], b["size"], 1.0)
            ordinary_rule = gap > SUSPICIOUS_GAP_EM_MULTIPLIER * ref_size and gap > SUSPICIOUS_GAP_MIN_PT
            # Prototype 2.5L item 6: a SECOND, independent candidacy rule for a glyph tightly
            # hugged by round parentheses -- see PARENTHESIZED_GAP_OPEN's own note for why the
            # em-multiplier rule above structurally can't catch this case. Never hardcodes
            # which glyph is missing (item 8) -- only the bounding punctuation shape.
            parenthesized_rule = gap > SUSPICIOUS_GAP_MIN_PT and a.get("text", "").rstrip().endswith(PARENTHESIZED_GAP_OPEN) and b.get("text", "").lstrip().startswith(PARENTHESIZED_GAP_CLOSE)
            if ordinary_rule or parenthesized_rule:
                gaps.append(SuspiciousGap(bbox=(a["x1"] / width, min(a["y0"], b["y0"]) / height, b["x0"] / width, max(a["y1"], b["y1"]) / height)))
    return gaps


def _is_equation_number_like_block(block: Block) -> bool:
    """Prototype 2.5B item 4/5/30/31: deliberately narrow -- a block must have exactly one
    line whose ENTIRE text is nothing but "(N)", and a small bbox. Ordinary prose containing
    "(5) shows..." always has more text than just the number (or spans multiple lines) and
    never matches; a page number ("12", no parens) never matches the pattern at all."""
    if len(block.lines) != 1:
        return False
    text = block.lines[0].text.strip()
    if not EQUATION_NUMBER_PATTERN.fullmatch(text):
        return False
    width_norm = block.bbox[2] - block.bbox[0]
    return width_norm <= EQUATION_NUMBER_BLOCK_MAX_WIDTH_NORM


def _equation_display_token(block: Block) -> str:
    """Prototype 2.5G item 11: the user-facing placeholder for a display equation,
    derived ENTIRELY from the equation-number block's own already-reliably-extracted text
    -- no OCR, no equation-body recognition of any kind (item 39). Only ever called on a
    block already confirmed by _is_equation_number_like_block, so the match always
    succeeds; the fallback "?" is unreachable in practice and only guards the type."""
    match = EQUATION_NUMBER_PATTERN.fullmatch(block.lines[0].text.strip())
    number = match.group(0)[1:-1] if match else "?"
    return f"[式 ({number})]"


_LINE_GAP_X_TOL = 0.006  # normalized page-width fraction (~3-4pt on a typical page), just enough for float/line-bbox-union slack


def _gap_between_lines(page_blocks: PageBlocks, line_a: Line, line_b: Line) -> Optional[SuspiciousGap]:
    """Prototype 2.5E item 7/8/19: a candidate gap is only ever considered when it sits
    directly between two lines that are ADJACENT in a selection's own assembled reading
    order -- never "any gap that happens to touch a line somewhere on the page" (2.5B's
    mistake, which fired on unrelated column-gutter/cross-row content). Checks both
    orderings since `line_a`/`line_b` may not already be in left-to-right order."""
    for gap in page_blocks.suspiciousGaps:
        gx0, gy0, gx1, gy1 = gap.bbox
        y_ok = (line_a.bbox[1] <= gy1 and gy0 <= line_a.bbox[3]) and (line_b.bbox[1] <= gy1 and gy0 <= line_b.bbox[3])
        if not y_ok:
            continue
        forward = abs(line_a.bbox[2] - gx0) <= _LINE_GAP_X_TOL and abs(line_b.bbox[0] - gx1) <= _LINE_GAP_X_TOL
        backward = abs(line_b.bbox[2] - gx0) <= _LINE_GAP_X_TOL and abs(line_a.bbox[0] - gx1) <= _LINE_GAP_X_TOL
        if forward or backward:
            return gap
    return None


def _render_gap_ink_ratio(doc: "pymupdf.Document", page_number: int, gap_bbox_norm: tuple[float, float, float, float], width: float, height: float) -> float:
    """Prototype 2.5D visual-ink gate, ported to plain PyMuPDF grayscale pixel bytes (no
    numpy in production -- item 10/78 of Prototype 2.5E; numerically validated against the
    2.5D numpy reference during this port, see services/pymupdf_layout/tests)."""
    gx0, gy0, gx1, gy1 = gap_bbox_norm
    rect_pt = pymupdf.Rect(gx0 * width, gy0 * height, gx1 * width, gy1 * height)
    page = doc[page_number - 1]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(VISUAL_INK_RENDER_SCALE, VISUAL_INK_RENDER_SCALE), clip=rect_pt, colorspace=pymupdf.csGRAY, alpha=False)
    w, h = pix.width, pix.height
    if w == 0 or h == 0:
        return 0.0
    samples = pix.samples  # bytes, length w*h, one grayscale byte per pixel (no alpha)
    background = sorted(samples)[int(VISUAL_INK_BACKGROUND_PERCENTILE * (len(samples) - 1))]
    threshold = background - VISUAL_INK_BACKGROUND_DELTA
    x_inset = max(1, int(w * VISUAL_INK_CENTRAL_INSET_FRACTION))
    x0, x1 = (x_inset, w - x_inset) if w - x_inset > x_inset else (0, w)
    central_total = 0
    central_ink = 0
    for y in range(h):
        row_offset = y * w
        for x in range(x0, x1):
            central_total += 1
            if samples[row_offset + x] < threshold:
                central_ink += 1
    return central_ink / central_total if central_total else 0.0


def _lines_pt_bbox_union(line_a: Line, line_b: Line, width: float, height: float) -> tuple[float, float, float, float]:
    ax0, ay0, ax1, ay1 = line_a.bbox
    bx0, by0, bx1, by1 = line_b.bbox
    return (min(ax0, bx0) * width, min(ay0, by0) * height, max(ax1, bx1) * width, max(ay1, by1) * height)


def _call_paddle_ocr(png_bytes: bytes) -> Optional[list[dict]]:
    """Best-effort call to the existing local Paddle OCR service -- returns None on ANY
    failure (unreachable, timeout, non-200, bad body), never raises, so the caller always
    treats it as "recovery unavailable" rather than crashing the whole selection request."""
    try:
        resp = httpx.post(f"{PADDLE_OCR_URL}/ocr/page", files={"file": ("crop.png", png_bytes, "image/png")}, timeout=PADDLE_OCR_TIMEOUT_S)
    except Exception:
        return None
    if resp.status_code != 200:
        return None
    try:
        body = resp.json()
    except Exception:
        return None
    lines = body.get("lines")
    return lines if isinstance(lines, list) else None


def _recover_gap_text(left_anchor: str, right_anchor: str, ocr_text: str) -> Optional[str]:
    """Prototype 2.5C/E item 30/31/32: recovery is allowed ONLY when both trusted anchors
    (the two bounding lines' own PyMuPDF-extracted text) are found in `ocr_text`, in
    order -- the recovered substring is exactly what lies between them. Never trusts OCR
    beyond that bounded substring; never invents/guesses (item 34).

    Item 31's comparison-only normalization (ligatures + NFKC + whitespace collapse) is
    applied to BOTH the anchors and the OCR text before searching (real PyMuPDF text can
    contain a ligature codepoint like "reﬂectance" that an OCR engine naturally outputs as
    plain "reflectance" -- without this, a perfectly correct OCR read fails to anchor-match
    and gets discarded as unrecoverable). The recovered substring itself is taken from the
    NORMALIZED text, which is safe here: what's actually being recovered is a single
    inline-math variable/symbol (k, e, theta, ...), never a ligature-bearing word run."""
    norm_left, norm_right = _normalize_for_match(left_anchor), _normalize_for_match(right_anchor)
    if not norm_left or not norm_right:
        return None
    norm_ocr_text = _normalize_for_match(ocr_text)
    left_idx = norm_ocr_text.find(norm_left)
    if left_idx == -1:
        return None
    right_idx = norm_ocr_text.find(norm_right, left_idx + len(norm_left))
    if right_idx == -1:
        return None
    recovered = norm_ocr_text[left_idx + len(norm_left) : right_idx].strip()
    return recovered or None


def _attempt_gap_recovery(doc: "pymupdf.Document", page_number: int, width: float, height: float, line_a: Line, line_b: Line) -> Optional[str]:
    """Prototype 2.5E item 24-30: renders the LOCAL two-line crop (never the whole page-wide
    row -- item 25, a two-column PDF may have unrelated content at the same y in the other
    column) bounding a visual-ink-positive gap, OCRs it via the existing Paddle service, and
    returns only the anchor-aligned recovered substring, or None if recovery can't be
    confidently completed (Paddle unavailable, low confidence, anchors not found/ordered)."""
    left_line, right_line = (line_a, line_b) if line_a.bbox[0] <= line_b.bbox[0] else (line_b, line_a)
    crop_rect = _lines_pt_bbox_union(left_line, right_line, width, height)
    page = doc[page_number - 1]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(VISUAL_INK_RENDER_SCALE, VISUAL_INK_RENDER_SCALE), clip=pymupdf.Rect(*crop_rect))
    ocr_lines = _call_paddle_ocr(pix.tobytes("png"))
    if not ocr_lines:
        _trace("GAP_RECOVERY", cropRectPt=crop_rect, leftAnchor=left_line.text, rightAnchor=right_line.text, ocrResult=None, outcome="no_ocr_result")
        return None
    best = max(ocr_lines, key=lambda l: l.get("confidence") or 0.0)
    confidence = best.get("confidence") or 0.0
    if confidence < OCR_CONFIDENCE_THRESHOLD:
        _trace("GAP_RECOVERY", cropRectPt=crop_rect, leftAnchor=left_line.text, rightAnchor=right_line.text, ocrText=best.get("text"), confidence=confidence, outcome="low_confidence")
        return None
    recovered = _recover_gap_text(left_line.text, right_line.text, best.get("text") or "")
    _trace(
        "GAP_RECOVERY",
        cropRectPt=crop_rect,
        leftAnchor=left_line.text,
        rightAnchor=right_line.text,
        ocrText=best.get("text"),
        confidence=confidence,
        recovered=recovered,
        outcome="recovered" if recovered is not None else "anchor_not_found",
    )
    return recovered


def _line_texts_with_boundary(lines: list[Line], boundary_text: str, direction: str) -> list[str]:
    """The click may land mid-line, so the click line itself must contribute only
    `boundary_text` (click-to-end-of-line, or start-of-line-to-click) -- never its own full
    `line.text`, which could include content before/after the click that isn't part of the
    selection. `lines` is `_block_boundary_lines`'s own output: the click line is first for
    'forward', last for 'backward'."""
    texts = [l.text for l in lines]
    if not texts:
        return texts
    if direction == "forward":
        texts[0] = boundary_text
    else:
        texts[-1] = boundary_text
    return texts


def _looks_like_wrapped_url_or_doi(left: str) -> bool:
    """True only when the final whitespace-delimited token is clearly URL/DOI-shaped.

    A visual line wrap inside one of these identifiers is a true token continuation, not
    prose.  Keeping the separator empty preserves the identifier; ordinary words and
    punctuation still retain an explicit visual-line boundary for the frontend's existing
    whitespace/hyphenation normalizer.
    """
    tail = left.rstrip().split()[-1] if left.rstrip() else ""
    return bool(re.match(r"(?i)(?:https?://|www\.|doi:|10\.\d{4,9}/)\S*$", tail))


def _join_prose_fragments(fragments: list[str]) -> str:
    """Join visual-line fragments without losing lexical boundary provenance.

    ``\n`` is deliberate: the frontend already owns the established wrap-hyphenation and
    whitespace policy. Existing edge whitespace is not duplicated, URL/DOI continuations
    remain one token, and an equation placeholder split across extraction fragments is
    never separated internally.
    """
    result = ""
    for fragment in (part for part in fragments if part):
        if not result:
            result = fragment
            continue
        if result[-1].isspace() or fragment[0].isspace():
            separator = ""
        elif _looks_like_wrapped_url_or_doi(result):
            separator = ""
        elif result.count("[") > result.count("]") and "]" in fragment:
            separator = ""
        else:
            separator = "\n"
        result += separator + fragment
    return result


def _assemble_lines_with_gap_recovery(doc: "pymupdf.Document", page_number: int, page_blocks: PageBlocks, lines: list[Line], line_texts: list[str]) -> str:
    """Joins `line_texts` in order with `_join_prose_fragments` (ordinary visual prose
    boundaries remain ``\\n`` so the frontend's existing normalizePdfSelectionText applies
    its established whitespace/hyphenation policy); `lines` supplies
    the geometry for gap-detection in parallel (same length/order as `line_texts`, but the
    text actually emitted for each position comes from `line_texts` -- see
    _line_texts_with_boundary). Between each adjacent pair, checks for a real,
    visually-confirmed missing-glyph gap (item 7/8/19/20): no candidate gap there -> nothing
    inserted; visual-ink-negative candidate -> silently dropped (item 19, never a warning,
    never OCR'd); visual-ink-positive candidate -> must be confidently recovered or the
    WHOLE selection fails explicitly (item 43) -- a genuinely visible glyph is never
    silently omitted.

    Prototype 2.5N item 19/21: when the recovered gap is bounded by round parentheses (the
    same left-ends-with-"("/right-starts-with-")" shape `_detect_suspicious_gaps`'s own
    parenthesized rule checks), the recovered glyph and its two flanking line texts are
    merged into ONE part with no separator at all -- "(b)", never "(" + newline + "b" +
    newline + ")" (which the frontend's own newline-to-space collapse would otherwise turn
    into the non-source-faithful "( b )"). This is provenance-aware (checked per-gap, using
    the actual flanking text), never a global punctuation-cleanup regex pass over the final
    string -- an ordinary word-boundary recovery like "of"/"k"/"can" is unaffected and still
    becomes three separate parts ("of k can" after the frontend's own normalization). EVERY
    adjacent pair is still individually gap-checked -- merging a recovered part into the
    previous one only changes how the FOLLOWING line's text is appended (no separator
    instead of becoming a new list entry), it never skips a pair's own gap check.

    Prototype 2.5O/2.5Q: the SHAPE check (is this gap parenthesis-bounded at all?) uses
    `lines[i].text`/`lines[i + 1].text` -- PyMuPDF's own trusted extraction, never
    `text`/`next_text` -- because at a selection's own start/end position, `text`/`next_text`
    may instead be the CALLER's boundaryText (see `_line_texts_with_boundary`), and a real
    live failure showed this can legitimately diverge from PyMuPDF's own line text: the
    browser's own PDF.js text layer has literally zero DOM node for the invisible glyph, so
    a forward boundaryText capture reads straight through the gap and continues onto further
    same-row text PyMuPDF itself put in the NEXT block. A LITERAL browser trace (Prototype
    2.5P, captured after 2.5O's own code-reading-based reconstruction turned out to still be
    wrong) proved PDF.js renders that gap as an actual SPACE character, not always zero
    characters -- the real Soenen boundaryText for "The parameter C is a function of the
    regression slope (b)" arrives as `"...regression slope ( ) and"` (a literal space
    between the parens, "and" already absorbed from what PyMuPDF considers block 3:3's own
    content) -- not the tighter `"...slope () and"` 2.5O's own static reading of
    `extractWithinLine` assumed. Checking `text.endswith("(")` against either shape is false
    even though this genuinely is a parenthesized gap, so the automated fixture test (whose
    hand-supplied boundaryText happened to exactly equal PyMuPDF's own unmodified line text)
    never caught it. Once the shape check confirms a parenthesized gap, the recovered glyph
    is inserted into whichever of two positions genuinely holds both trusted anchors: if
    `text` itself already ends in "(" (the ordinary case -- an interior line, or a boundary
    text that happens to stop exactly there), merge forward as before; if `text` instead
    ENDS WITH `next_text` (the browser-boundary case above) and the "(" found immediately
    before that suffix has nothing but whitespace (zero or more characters -- "()", "( )",
    "(  )" are all the same structural state) between it and where `next_text` begins,
    insert the glyph directly between that literal "(" and `next_text` and never separately
    emit `next_text` at all -- its content is already present, verbatim, inside `text`, so
    emitting it again would duplicate it. Any other shape (structural check passed but
    neither pattern matches `text`) safely falls back to appending the glyph as its own
    part -- never silently dropped, just not tight-joined."""
    parts: list[str] = []
    pending_tight_merge = False
    skip_next_text = False
    for i, text in enumerate(line_texts):
        if LAYOUT_TRACE_ENABLED:
            _trace(
                "ASSEMBLE_ITER_START",
                i=i,
                trustedLineText=lines[i].text,
                effectiveText=text,
                pendingTightMergeBefore=pending_tight_merge,
                skipNextTextBefore=skip_next_text,
                partsBefore=list(parts),
            )
        if skip_next_text:
            skip_next_text = False
        elif pending_tight_merge and parts:
            parts[-1] += text
        else:
            parts.append(text)
        pending_tight_merge = False
        if i + 1 >= len(lines):
            if LAYOUT_TRACE_ENABLED:
                _trace("ASSEMBLE_ITER_END", i=i, partsAfter=list(parts), gapCandidate=False)
            continue
        gap = _gap_between_lines(page_blocks, lines[i], lines[i + 1])
        if gap is None:
            if LAYOUT_TRACE_ENABLED:
                _trace("ASSEMBLE_ITER_END", i=i, nextTrustedLineText=lines[i + 1].text, partsAfter=list(parts), gapCandidate=False)
            continue
        ink_ratio = _render_gap_ink_ratio(doc, page_number, gap.bbox, page_blocks.width, page_blocks.height)
        if ink_ratio <= VISUAL_INK_CENTRAL_RATIO_THRESHOLD:
            _trace("GAP_INK", i=i, gapBbox=gap.bbox, visualInkRatio=ink_ratio, outcome="no_ink_dropped")
            continue  # ordinary whitespace/gutter -- ignore entirely, no warning, no OCR (item 19)
        _trace("GAP_INK", i=i, gapBbox=gap.bbox, visualInkRatio=ink_ratio, outcome="ink_positive_candidate")
        recovered = _attempt_gap_recovery(doc, page_number, page_blocks.width, page_blocks.height, lines[i], lines[i + 1])
        if recovered is None:
            raise HTTPException(
                status_code=422,
                detail={"error": "missing_glyph_unresolved", "message": "a visually-present but text-unextractable glyph could not be confidently recovered"},
            )
        next_text = line_texts[i + 1]
        is_parenthesized = lines[i].text.rstrip().endswith(PARENTHESIZED_GAP_OPEN) and lines[i + 1].text.lstrip().startswith(PARENTHESIZED_GAP_CLOSE)
        if not is_parenthesized:
            parts.append(recovered)
            if LAYOUT_TRACE_ENABLED:
                _trace("ASSEMBLE_ITER_END", i=i, nextTrustedLineText=lines[i + 1].text, gapCandidate=True, isParenthesized=False, recovered=recovered, branch="ordinary_append", partsAfter=list(parts))
            continue
        if text.rstrip().endswith(PARENTHESIZED_GAP_OPEN):
            parts[-1] += recovered
            pending_tight_merge = True
            if LAYOUT_TRACE_ENABLED:
                _trace(
                    "ASSEMBLE_ITER_END", i=i, nextTrustedLineText=lines[i + 1].text, gapCandidate=True, isParenthesized=True, recovered=recovered,
                    branch="tight_merge_forward", pendingTightMergeAfter=True, skipNextTextAfter=False, partsAfter=list(parts),
                )
            continue
        # Prototype 2.5Q: browser-boundary fused case, generalized to tolerate WHITESPACE
        # between the two trusted parens -- the literal browser trace (Prototype 2.5P)
        # proved PDF.js's own DOM selection text renders the invisible glyph's gap as an
        # actual space character, not always zero characters ("( ) and", not only the
        # "() and" 2.5O's own reconstruction assumed). Recognized ONLY when `text` ends
        # with `next_text` (the trusted right-side line, e.g. ") and") AND the "(" found
        # immediately before that suffix has nothing but whitespace between it and where
        # `next_text` begins -- never a page-wide or arbitrary-parenthesis search.
        if next_text and text.endswith(next_text):
            prefix = text[: len(text) - len(next_text)]
            open_idx = prefix.rfind(PARENTHESIZED_GAP_OPEN)
        else:
            open_idx = -1
        if open_idx != -1 and prefix[open_idx + 1 :].strip() == "":
            insert_at = open_idx + 1
            parts[-1] = text[:insert_at] + recovered + next_text
            skip_next_text = True
            if LAYOUT_TRACE_ENABLED:
                _trace(
                    "ASSEMBLE_ITER_END", i=i, nextTrustedLineText=lines[i + 1].text, gapCandidate=True, isParenthesized=True, recovered=recovered,
                    branch="fused_paren_insert", openIdx=open_idx, whitespaceBetween=prefix[open_idx + 1 :], pendingTightMergeAfter=False, skipNextTextAfter=True, partsAfter=list(parts),
                )
        else:
            parts.append(recovered)
            if LAYOUT_TRACE_ENABLED:
                _trace(
                    "ASSEMBLE_ITER_END", i=i, nextTrustedLineText=lines[i + 1].text, gapCandidate=True, isParenthesized=True, recovered=recovered,
                    branch="fallback_append_no_fuse_match", partsAfter=list(parts),
                )
    result = _join_prose_fragments(parts)
    _trace("ASSEMBLE_RESULT", result=result)
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


def _find_line_containing_anchor(
    page_blocks: PageBlocks, norm_anchor: str, near_x: float, near_y: float, exclude_equation_number_like: bool = False
) -> Optional[tuple[Block, Line]]:
    """Page-wide exact-substring anchor search (never fuzzy/semantic). If the anchor text
    appears on more than one line, the coordinate-nearest match wins (never the first
    textual match) -- a short/common boundaryText could otherwise recur elsewhere on the
    page. `exclude_equation_number_like` is used only by the Prototype 2.5B equation-number
    recovery path (item 6): an anchor search trying to escape an equation-number block must
    not be allowed to "recover" into a different equation-number block."""
    candidates: list[tuple[Block, Line]] = []
    for b in page_blocks.blocks:
        if exclude_equation_number_like and _is_equation_number_like_block(b):
            continue
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


def _endpoint_is_formula_fragment(page_blocks: PageBlocks, block: Block) -> bool:
    """Prototype 2.5L item 41/42: a defensive check for a selection endpoint landing
    DIRECTLY on a display-equation's own formula-body fragment (e.g. clicking the bare "C"
    inside equation (9)) rather than genuine prose. First-version safe failure (item 41/42's
    own acceptance bar) -- never silently treats a formula fragment as ordinary prose and
    collects unrelated surrounding text. Deliberately skips the corridor check
    `_display_equation_region_blocks` normally requires (there is no wide prose reference
    available yet at endpoint-resolution time, before a selection's own before/after blocks
    are known) -- over-triggering this safe-failure on a rare, directly-ambiguous click is
    far less harmful than under-triggering it and fabricating prose from formula debris."""
    if not _is_formula_fragment_block(block):
        return False
    idx = page_blocks.blocks.index(block)
    max_gap = EQUATION_REGION_MAX_VERTICAL_GAP_EM * max(block.bbox[3] - block.bbox[1], 0.0001)
    for offset in range(1, EQUATION_REGION_MAX_FRAGMENTS + 1):
        for candidate_idx in (idx - offset, idx + offset):
            if 0 <= candidate_idx < len(page_blocks.blocks):
                candidate = page_blocks.blocks[candidate_idx]
                if _is_equation_number_like_block(candidate):
                    vertical_gap = max(0.0, max(block.bbox[1], candidate.bbox[1]) - min(block.bbox[3], candidate.bbox[3]))
                    if vertical_gap <= max_gap:
                        return True
    return False


def _resolve_endpoint(document_id: str, ep: SelectionEndpoint) -> tuple[PageBlocks, Block, Line, bool]:
    """Returns (page_blocks, block, line, is_unresolved_equation_number). The last element
    is True only when the endpoint resolved to a genuine equation-number-like block AND its
    own anchor-based recovery (below) could not resolve it to real prose. Prototype 2.5G
    item 4/6: this no longer raises immediately in that case -- the caller
    (/layout/selection) decides whether it's a valid prose-crossing display-equation
    placeholder case or a genuine safe failure, so the equation-number-endpoint detector
    itself is unchanged from 2.5B/E, only what happens next is new."""
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

    # Prototype 2.5B item 4/6: an equation-number-like block (see docs/design-notes.md,
    # Prototype 2.5A -- this is exactly the real "The value of (5)" contamination) is never
    # accepted as a final endpoint. Try one more targeted recovery restricted to non-
    # equation-number blocks; if the boundaryText anchor doesn't confidently identify real
    # prose elsewhere, this endpoint is genuinely unresolvable as PROSE -- but (2.5G) may
    # still be a valid display-equation placeholder target, decided by the caller.
    if _is_equation_number_like_block(block):
        # If boundaryText ITSELF is just an equation-number token (the click's real DOM
        # boundary text genuinely was "(5)"), there is nothing to recover -- searching the
        # page for that same short token as a substring is exactly the "short boundary
        # text" ambiguity flagged in Prototype 2.5A item 29 (it can trivially match an
        # unrelated "(5)" inside ordinary prose elsewhere on the page). Go straight to safe
        # failure rather than risk recovering into the wrong, unrelated block.
        anchor_is_equation_number = bool(norm_anchor) and EQUATION_NUMBER_PATTERN.fullmatch(norm_anchor)
        recovered = (
            _find_line_containing_anchor(page_blocks, norm_anchor, x, y, exclude_equation_number_like=True)
            if norm_anchor and not anchor_is_equation_number
            else None
        )
        if recovered is None:
            return page_blocks, block, line, True
        block, line = recovered

    # Prototype 2.5L item 41/42: a click landing directly on a formula-body fragment (never
    # on the equation-number block itself -- that's the branch above) must not silently be
    # treated as ordinary prose either.
    if _endpoint_is_formula_fragment(page_blocks, block):
        raise HTTPException(
            status_code=422,
            detail={"error": "formula_fragment_endpoint_unresolved", "message": "selection endpoint resolved to a display-equation's own formula-body fragment, not ordinary prose"},
        )

    return page_blocks, block, line, False


def _middle_page_text(document_id: str, page_number: int) -> str:
    """A page fully spanned by a 3+ page selection (neither the start nor end page) --
    every block's own text, in the page's own block order, EXCLUDING blocks whose dominant
    font size differs from the page's own most common (body) size by more than 12% (the
    same tolerance the retired custom heuristic used for its own font-height block
    splitting, R5B). This keeps a running header/footer or footnote-sized block from being
    silently re-injected just because a page happens to be fully spanned, without needing
    any zone/column concept -- PyMuPDF's blocks carry no such label.

    Prototype 2.5E scope note: missing-glyph recovery is NOT attempted for middle-page
    text (no real-world evidence required it, and a visual row can never span a page
    boundary anyway) -- see docs/design-notes.md."""
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


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2


def _line_font_size(line: Line) -> float:
    return _median([span.size for span in line.spans if span.text.strip()])


def _page_body_font_size(page_blocks: PageBlocks) -> float:
    """A conservative body-font reference sampled above the footer/footnote region.

    If no usable upper-page text exists, return 0 and disable filtering. This avoids
    inferring a body size from the suspected footer itself on sparse or unusual pages.
    """
    sizes = [
        span.size
        for block in page_blocks.blocks
        for line in block.lines
        if line.bbox[1] < BODY_FONT_SAMPLE_MAX_Y_NORM
        for span in line.spans
        if span.text.strip()
    ]
    return _median(sizes)


def _legal_boilerplate_evidence_count(text: str) -> int:
    """Count independent legal-publication signals; no publisher name is a signal."""
    normalized = unicodedata.normalize("NFKC", text).lower()
    checks = (
        bool(re.search(r"©|\bcopyright\b", normalized)),
        bool(re.search(r"\b(?:open access|creative commons|licen[cs]e)\b|\bcc\s+by(?:-[a-z]+)*\b", normalized)),
        bool(re.search(r"\ball rights reserved\b", normalized)),
        bool(re.match(r"^\s*\d{4}-\d{3}[\dx]\s*/", normalized)),
    )
    return sum(checks)


def _is_probable_document_boilerplate_line(page_blocks: PageBlocks, block: Block, line: Line) -> bool:
    """True only for high-confidence, footer-shaped legal publication boilerplate.

    False deletion is worse than visible boilerplate, so every structural condition is
    mandatory. Words such as "copyright", "license", or a publisher name never decide
    this alone. The selected endpoint line is protected separately by the filter helper.
    """
    if not block.lines or line is not block.lines[-1]:
        return False
    x0, y0, x1, _ = line.bbox
    if y0 < BOILERPLATE_BOTTOM_Y_MIN_NORM or (x1 - x0) < BOILERPLATE_MIN_WIDTH_NORM:
        return False
    body_size = _page_body_font_size(page_blocks)
    line_size = _line_font_size(line)
    if body_size <= 0 or line_size <= 0 or line_size / body_size > BOILERPLATE_MAX_BODY_FONT_RATIO:
        return False
    return _legal_boilerplate_evidence_count(line.text) >= 2


def _filter_block_lines_for_selection(page_blocks: PageBlocks, block: Block, lines: list[Line], protected_line: Line) -> list[Line]:
    """Remove only high-confidence boilerplate, never the user's endpoint line itself."""
    return [line for line in lines if line is protected_line or not _is_probable_document_boilerplate_line(page_blocks, block, line)]


def _block_boundary_lines(block: Block, line: Line, direction: str) -> list[Line]:
    """The Line objects a selection touches within one block, starting at the click line
    itself: forward includes the click line through the block's end; backward includes the
    block's start through (and including) the click line."""
    idx = block.lines.index(line)
    return block.lines[idx:] if direction == "forward" else block.lines[: idx + 1]


def _blocks_share_corridor(block_a: Block, block_b: Block) -> bool:
    """Prototype 2.5J: local, deterministic geometry only -- never a global column label
    (see CORRIDOR_X_OVERLAP_MIN_FRACTION's own derivation). Overlap is measured relative to
    the NARROWER of the two blocks' own widths, so a narrow equation-number block correctly
    reads as "sharing" a much wider prose column's corridor."""
    ax0, _, ax1, _ = block_a.bbox
    bx0, _, bx1, _ = block_b.bbox
    overlap = min(ax1, bx1) - max(ax0, bx0)
    if overlap <= 0:
        return False
    narrower_width = min(ax1 - ax0, bx1 - bx0)
    if narrower_width <= 0:
        return False
    return (overlap / narrower_width) >= CORRIDOR_X_OVERLAP_MIN_FRACTION


def _is_formula_fragment_block(block: Block) -> bool:
    """Prototype 2.5L item 26/27: the SHAPE signal a display-equation body fragment shares --
    single line, a single token (no internal whitespace -- multiple words is real prose,
    item 27), and narrow (EQUATION_REGION_FRAGMENT_MAX_WIDTH_NORM's own note has the real
    Soenen measurements this is derived from). Never matches a genuine equation-number block
    itself (item 34/35 -- a different equation's own number must stop the region walk, never
    be absorbed as "this" equation's fragment)."""
    if len(block.lines) != 1:
        return False
    text = block.lines[0].text.strip()
    if not text or len(text.split()) > 1:
        return False
    width_norm = block.bbox[2] - block.bbox[0]
    if width_norm > EQUATION_REGION_FRAGMENT_MAX_WIDTH_NORM:
        return False
    return not _is_equation_number_like_block(block)


def _display_equation_region_blocks(page_blocks: PageBlocks, eqnum_block: Block, corridor_reference_block: Block) -> list[Block]:
    """Prototype 2.5L item 20/22/23/26: given an ALREADY-CONFIRMED equation-number anchor
    (never invented from arbitrary tiny blocks alone -- item 20), walks a tightly bounded,
    local region around it in both directions: a small vertical gap relative to the anchor's
    own line height (item 25/26), and a formula-fragment shape (_is_formula_fragment_block).
    Stops (does not skip-and-continue) at the first block failing any condition --
    deliberately NOT an unbounded "walk until it looks like prose" heuristic (item 23);
    EQUATION_REGION_MAX_FRAGMENTS is a defensive cap only. Always includes `eqnum_block`
    itself (item 22); the returned list is in the page's own reading order.

    `corridor_reference_block` -- item 24, local geometry only, never a revived global
    column classifier -- is a WIDE block the caller already trusts as genuine prose in this
    selection's own column (the click's own prose block, or the union of the two selection
    endpoints; see the callers). Each FRAGMENT candidate is corridor-checked against this
    wide reference, not against `eqnum_block` itself: an equation-number block is, BY
    DEFINITION (EQUATION_NUMBER_BLOCK_MAX_WIDTH_NORM), narrow and sits at the column's own
    outer margin, so two narrow blocks (the equation number and a narrow formula fragment
    like the real Soenen "C") frequently don't literally overlap in x at all even though
    both sit within the very same column -- checking each fragment against a wide reference
    (which, once confirmed to contain the fragment, reliably establishes "same column")
    avoids that false negative without reviving any global LEFT/RIGHT classification."""
    eq_idx = page_blocks.blocks.index(eqnum_block)
    eq_line_height = max(eqnum_block.bbox[3] - eqnum_block.bbox[1], 0.0001)
    max_gap = EQUATION_REGION_MAX_VERTICAL_GAP_EM * eq_line_height

    region_before: list[Block] = []
    for b in reversed(page_blocks.blocks[:eq_idx]):
        if len(region_before) >= EQUATION_REGION_MAX_FRAGMENTS:
            break
        if not _is_formula_fragment_block(b):
            break
        if not _blocks_share_corridor(b, corridor_reference_block):
            break
        vertical_gap = max(0.0, eqnum_block.bbox[1] - b.bbox[3])
        if vertical_gap > max_gap:
            break
        region_before.append(b)
    region_before.reverse()

    region_after: list[Block] = []
    for b in page_blocks.blocks[eq_idx + 1 :]:
        if len(region_after) >= EQUATION_REGION_MAX_FRAGMENTS:
            break
        if not _is_formula_fragment_block(b):
            break
        if not _blocks_share_corridor(b, corridor_reference_block):
            break
        vertical_gap = max(0.0, b.bbox[1] - eqnum_block.bbox[3])
        if vertical_gap > max_gap:
            break
        region_after.append(b)

    return region_before + [eqnum_block] + region_after


def _equation_corridor_reference(before_block: Block, after_block: Block) -> Block:
    """The union bbox of two endpoint blocks, used as a wide, local corridor reference for
    equation-number/fragment discovery (see `_display_equation_region_blocks`'s own note on
    why a narrow equation-number block frequently doesn't literally overlap another narrow
    block even within the same column)."""
    return Block(
        blockId="__corridor__",
        bbox=(
            min(before_block.bbox[0], after_block.bbox[0]),
            min(before_block.bbox[1], after_block.bbox[1]),
            max(before_block.bbox[2], after_block.bbox[2]),
            max(before_block.bbox[3], after_block.bbox[3]),
        ),
        lines=[],
    )


def _find_intermediate_equation_blocks(page_blocks: PageBlocks, before_block: Block, after_block: Block, include_after: bool = False, corridor_reference: Optional[Block] = None) -> list[Block]:
    """Prototype 2.5J item 6/9/34/35/36: searches the blocks between `before_block` and
    `after_block` in the page's own PyMuPDF block-index order (never page-wide -- item 9/34,
    a stray equation-number block elsewhere on the page must never be treated as this
    selection's intermediate equation). A candidate must sit at a vertical position between
    the two endpoints (item 7) and share the CORRIDOR ESTABLISHED BY THEM TOGETHER -- the
    union of `before_block`'s and `after_block`'s own x-ranges, not each one checked
    separately (see `_equation_corridor_reference`). `_is_equation_number_like_block`'s own
    narrow single-line "(N)"-only pattern already excludes inline references like
    "Eq. (6)"/"see (6)" (item 35, unchanged from 2.5B). Returns every qualifying block in
    reading order -- item 11/49: the same walk naturally generalizes to more than one
    intermediate equation, so this is not artificially capped at one; `before_block`/
    `after_block` are assumed already normalized so `before_block` precedes `after_block` in
    block-index order (see the caller).

    Prototype 2.5N item 9: `include_after=True` also considers `after_block` ITSELF a
    candidate (trivially qualifying, since the corridor reference is built FROM it) -- the
    generalization that lets a selection whose own endpoint IS an equation number
    (previously `_resolve_equation_crossing`'s own separate, unaware algorithm) share this
    exact same discovery mechanism, so an equation encountered earlier in the same selection
    (e.g. equation (8), with equation (9) as the actual endpoint) is never missed."""
    before_idx = page_blocks.blocks.index(before_block)
    after_idx = page_blocks.blocks.index(after_block)
    lo_y = min(before_block.bbox[1], after_block.bbox[1])
    hi_y = max(before_block.bbox[3], after_block.bbox[3])
    corridor = corridor_reference if corridor_reference is not None else _equation_corridor_reference(before_block, after_block)
    upper = after_idx + 1 if include_after else after_idx
    return [b for b in page_blocks.blocks[before_idx + 1 : upper] if _is_equation_number_like_block(b) and _blocks_share_corridor(b, corridor) and lo_y <= b.bbox[1] <= hi_y]


def _resolve_equation_aware_selection(
    page_number: int,
    doc_state: "_DocumentState",
    page_blocks: PageBlocks,
    before_block: Block,
    before_line: Line,
    before_boundary: str,
    after_block: Block,
    after_line: Line,
    after_boundary: str,
    after_is_eqnum: bool,
) -> "SelectionResponse":
    """Prototype 2.5N: the UNIFIED equation-aware sequence assembler, replacing the formerly
    separate and mutually unaware Prototype 2.5G "equation at end" (`_resolve_equation_crossing`)
    and Prototype 2.5J "intermediate equation" (`_resolve_cross_equation_continuation`)
    algorithms. See docs/design-notes.md, "Prototype 2.5M", for the real, reproducible bug
    this fixes: a selection whose own END endpoint IS an equation number (e.g. equation (9))
    used to be claimed entirely by the old equation-at-end algorithm, which had zero
    awareness of any OTHER equation-number block encountered earlier in the same selection
    (e.g. equation (8)) -- leaking its raw formula fragments ("C") and raw equation number
    ("(8)") straight into the prose. `before_block` is always ordinary prose (never itself an
    equation number -- the caller safe-fails that reverse-direction case before ever reaching
    here); `after_block` may be either ordinary prose (the 2.5J shape) or an equation-number
    block that IS the selection's own endpoint (the 2.5G shape) -- `after_is_eqnum` is the
    only thing that distinguishes them from here on; both are assembled by the exact same
    walk.

    Builds an ordered logical sequence -- PROSE_GROUP, DISPLAY_EQUATION, PROSE_GROUP, ... --
    between the two endpoints:

    1. Every qualifying equation-number block in the walked range is discovered FIRST, via
       `_find_intermediate_equation_blocks(..., include_after=after_is_eqnum)` -- INCLUDING
       `after_block` itself when it's the selection's own equation endpoint. This is the
       central fix: an equation encountered earlier in the selection (equation (8)) is now
       found by the exact same mechanism as the terminal one (equation (9)), never missed.
    2. Every discovered equation's own display-equation region
       (`_display_equation_region_blocks`) is resolved BEFORE any assembly starts (2.5L item
       37's own principle, generalized to N equations) -- a formula fragment is never
       appended to prose and deleted later via string replacement (item 21/38). If a block
       is ever claimed by more than one equation's region (not observed on any real fixture,
       a defensive-only check), it's excluded from suppression entirely and left as ordinary
       prose, rather than silently guessing which equation it belongs to (item 11/35).
    3. The block range is walked once. A block belonging only to some equation's own
       fragment region is skipped entirely -- never its own prose. A block that IS a
       discovered equation number flushes the accumulated prose group (if any) and emits
       exactly one `[式 (N)]` placeholder; if it's also `after_block` itself (2.5G shape),
       nothing trails it and the walk stops there. Otherwise, lines accumulate into the
       current prose group -- CONTIGUOUS across PyMuPDF block seams (2.5I's own finding,
       preserved unchanged): a real post-equation sentence (Soenen's "where Ln is the
       normalized radiance, a and b are the y-intercept...") can be split across several
       blocks on the same visual row, and splitting per-block breaks that same-row adjacency,
       silently skipping real missing-glyph recovery -- so each contiguous run is fed through
       `_assemble_lines_with_gap_recovery` together, exactly once."""
    before_idx = page_blocks.blocks.index(before_block)
    after_idx = page_blocks.blocks.index(after_block)
    corridor_reference = _equation_corridor_reference(before_block, after_block)
    eqnum_blocks = _find_intermediate_equation_blocks(page_blocks, before_block, after_block, include_after=after_is_eqnum, corridor_reference=corridor_reference)
    eq_indices = {page_blocks.blocks.index(b): b for b in eqnum_blocks}

    fragment_claim_counts: dict[str, int] = {}
    for eq_block in eqnum_blocks:
        for member in _display_equation_region_blocks(page_blocks, eq_block, corridor_reference):
            if member.blockId != eq_block.blockId:
                fragment_claim_counts[member.blockId] = fragment_claim_counts.get(member.blockId, 0) + 1
    fragment_only_ids = {block_id for block_id, count in fragment_claim_counts.items() if count == 1}

    # segments: list of ("prose", list[Line]) | ("eq", placeholder token str)
    segments: list[tuple] = []
    current_lines: list[Line] = list(_block_boundary_lines(before_block, before_line, "forward"))
    for idx in range(before_idx + 1, after_idx + 1):
        block = page_blocks.blocks[idx]
        if block.blockId in fragment_only_ids:
            continue  # consumed as part of an equation's own region -- never its own prose
        if idx in eq_indices:
            segments.append(("prose", current_lines))
            segments.append(("eq", _equation_display_token(eq_indices[idx])))
            current_lines = []
            if idx == after_idx:
                break  # the equation IS the selection's own endpoint -- nothing trails it
            continue
        if idx == after_idx:
            current_lines = current_lines + list(_block_boundary_lines(after_block, after_line, "backward"))
        else:
            current_lines = current_lines + list(block.lines)
    segments.append(("prose", current_lines))

    prose_segment_indices = [i for i, seg in enumerate(segments) if seg[0] == "prose"]

    parts: list[str] = []
    for i, seg in enumerate(segments):
        if seg[0] == "eq":
            parts.append(seg[1])
            continue
        lines = seg[1]
        if not lines:
            continue
        texts = [l.text for l in lines]
        if prose_segment_indices and i == prose_segment_indices[0]:
            texts[0] = before_boundary
        if prose_segment_indices and i == prose_segment_indices[-1] and not after_is_eqnum:
            texts[-1] = after_boundary
        parts.append(_assemble_lines_with_gap_recovery(doc_state.doc, page_number, page_blocks, lines, texts))

    combined = "\n".join(p for p in parts if p.strip())
    return SelectionResponse(
        startBlockId=before_block.blockId, endBlockId=after_block.blockId, sameBlock=False, reconstructedText=combined, fragments=[Fragment(pageNumber=page_number, text=combined)]
    )


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
    """Prototype 2.5P: the dev-only trace wraps `_layout_selection_impl` rather than being
    inlined at every one of that function's many return/raise points -- logs the exact
    request as received (post fetch/JSON-serialization, therefore authoritative), the
    resolved start/end endpoints, and the exact response or error, all guarded by
    LAYOUT_TRACE_ENABLED (default off)."""
    _trace(
        "REQUEST",
        documentId=req.documentId,
        startPageNumber=req.start.pageNumber,
        startXNorm=req.start.xNorm,
        startYNorm=req.start.yNorm,
        startBoundaryText=req.start.boundaryText,
        startDirection=req.start.direction,
        endPageNumber=req.end.pageNumber,
        endXNorm=req.end.xNorm,
        endYNorm=req.end.yNorm,
        endBoundaryText=req.end.boundaryText,
        endDirection=req.end.direction,
    )
    try:
        response = _layout_selection_impl(req)
    except HTTPException as exc:
        _trace("RESPONSE_ERROR", statusCode=exc.status_code, detail=exc.detail)
        raise
    _trace("RESPONSE", startBlockId=response.startBlockId, endBlockId=response.endBlockId, sameBlock=response.sameBlock, reconstructedText=response.reconstructedText)
    return response


def _layout_selection_impl(req: SelectionRequest) -> "SelectionResponse":
    doc_state = _get_document_state(req.documentId)
    start_page, start_block, start_line, start_is_eqnum = _resolve_endpoint(req.documentId, req.start)
    end_page, end_block, end_line, end_is_eqnum = _resolve_endpoint(req.documentId, req.end)
    _trace("RESOLVED_START", blockId=start_block.blockId, trustedLineText=start_line.text, isEqnum=start_is_eqnum)
    _trace("RESOLVED_END", blockId=end_block.blockId, trustedLineText=end_line.text, isEqnum=end_is_eqnum)

    # Prototype 2.5G/2.5N item 6/7: equation-number endpoint intent guards -- unchanged
    # semantics from 2.5G, kept SEPARATE from the unified assembly below (item 6 -- intent
    # is not assembly mechanics).
    if start_is_eqnum and end_is_eqnum:
        if req.start.pageNumber == req.end.pageNumber and start_block.blockId == end_block.blockId:
            # The user selected the equation-number token itself, alone -- no prose is ever
            # collected/prepended for this case (item 18/31).
            token = _equation_display_token(start_block)
            return SelectionResponse(startBlockId=start_block.blockId, endBlockId=end_block.blockId, sameBlock=True, reconstructedText=token, fragments=[Fragment(pageNumber=req.start.pageNumber, text=token)])
        # Two different equation-number blocks selected directly -- ambiguous, never guess.
        raise HTTPException(status_code=422, detail={"error": "equation_endpoint_unresolved", "message": "selection spans two different equation-number blocks"})
    if start_is_eqnum and not end_is_eqnum:
        # Item 31 scope limit (unchanged from 2.5G): the primary supported case is a
        # selection TERMINATING on the equation (dragged in the natural prose-first
        # direction). A drag physically starting at the equation number and ending at
        # earlier prose is not yet validated -- safe-fail rather than silently generalizing.
        raise HTTPException(
            status_code=422, detail={"error": "equation_endpoint_unresolved", "message": "selection starts on an equation number -- reverse-direction equation crossing is not yet supported"}
        )

    same_block = req.start.pageNumber == req.end.pageNumber and start_block.blockId == end_block.blockId
    if same_block:
        # Prototype 2.5E item 38: sameBlock=True still means "trust the browser's own
        # native Range text" in the common case (no gap at all between the two click
        # points) -- but that native text would be missing the exact same unextractable
        # glyph a reconstruction would be, so a real gap here is recovered (or fails
        # explicitly) BEFORE falling back to native. Order by line index, not by which
        # endpoint the caller physically labeled "start" vs "end" (same reasoning as the
        # cross-block reverse-drag normalization below).
        start_idx = start_block.lines.index(start_line)
        end_idx = end_block.lines.index(end_line)
        if start_idx <= end_idx:
            lo, hi, lo_boundary, hi_boundary = start_idx, end_idx, req.start.boundaryText, req.end.boundaryText
        else:
            lo, hi, lo_boundary, hi_boundary = end_idx, start_idx, req.end.boundaryText, req.start.boundaryText
        selected_lines = start_block.lines[lo : hi + 1]
        if len(selected_lines) == 1:
            return SelectionResponse(startBlockId=start_block.blockId, endBlockId=end_block.blockId, sameBlock=True, reconstructedText=None, fragments=[])
        line_texts = [l.text for l in selected_lines]
        # A native DOM Range omits pdf.js's visual <br> elements from Range.toString(), so
        # same-block wrapped prose such as "used" / "in" otherwise becomes "usedin".
        # Multi-line same-block selections therefore use the browser's exact edge-line
        # boundaries plus PyMuPDF's trusted interior lines. A genuinely single-line
        # selection keeps the unchanged native fast path above.
        line_texts[0], line_texts[-1] = lo_boundary, hi_boundary
        repaired = _assemble_lines_with_gap_recovery(doc_state.doc, req.start.pageNumber, start_page, selected_lines, line_texts)
        return SelectionResponse(
            startBlockId=start_block.blockId, endBlockId=end_block.blockId, sameBlock=True, reconstructedText=repaired, fragments=[Fragment(pageNumber=req.start.pageNumber, text=repaired)]
        )

    # Prototype 2.5J -> 2.5N: the UNIFIED equation-aware sequence assembler -- one shared
    # branch for BOTH shapes that used to be separate, mutually unaware algorithms (see
    # docs/design-notes.md, "Prototype 2.5M", for the real, reproducible bug that caused).
    # Kept a SEPARATE branch from the ordinary cross-block path below (never merged into
    # it -- see the module docstring): Failure A's cross-column selection must never enter
    # an equation-aware walk merely because block IDs lie between the endpoints.
    if req.start.pageNumber == req.end.pageNumber:
        if end_is_eqnum:
            # The 2.5G shape: prose ending ON an equation number. Item 6 conditions
            # (unchanged from 2.5G): prose must be at or before the equation's own row -- a
            # genuine prose-crossing selection always drags TOWARD the equation, never
            # "after" it. No separate corridor gate here (matching 2.5G's own original,
            # already-validated permissiveness) -- an equation-number endpoint is already a
            # narrow, high-confidence signal Failure A's own shape never produces.
            if start_line.bbox[1] > end_block.bbox[1]:
                raise HTTPException(
                    status_code=422, detail={"error": "equation_endpoint_unresolved", "message": "selection endpoint resolved to an equation number, with no valid prose-crossing context"}
                )
            return _resolve_equation_aware_selection(
                req.start.pageNumber, doc_state, start_page, start_block, start_line, req.start.boundaryText, end_block, end_line, req.end.boundaryText, True
            )
        # The 2.5J shape: both endpoints ordinary prose -- narrowly gated on the same local
        # corridor (item 12/24, unchanged from 2.5J) so a genuine cross-column selection
        # (Failure A's own shape) can never reach an equation-aware walk merely because an
        # equation-number-like block happens to sit at a block index between the endpoints.
        if _blocks_share_corridor(start_block, end_block):
            start_block_idx = start_page.blocks.index(start_block)
            end_block_idx = start_page.blocks.index(end_block)
            if start_block_idx <= end_block_idx:
                before_block, before_line, before_boundary = start_block, start_line, req.start.boundaryText
                after_block, after_line, after_boundary = end_block, end_line, req.end.boundaryText
            else:
                before_block, before_line, before_boundary = end_block, end_line, req.end.boundaryText
                after_block, after_line, after_boundary = start_block, start_line, req.start.boundaryText
            if _find_intermediate_equation_blocks(start_page, before_block, after_block):
                return _resolve_equation_aware_selection(
                    req.start.pageNumber, doc_state, start_page, before_block, before_line, before_boundary, after_block, after_line, after_boundary, False
                )

    # Item 13/23: normalize to logical first/last by page number -- earlier page always
    # wins, independent of which endpoint the caller physically labeled "start" vs "end"
    # (a reverse drag across pages must reconstruct identically to a forward one).
    if req.start.pageNumber <= req.end.pageNumber:
        first_page, first_block, first_line, first_boundary = req.start.pageNumber, start_block, start_line, req.start.boundaryText
        last_page, last_block, last_line, last_boundary = req.end.pageNumber, end_block, end_line, req.end.boundaryText
        first_page_blocks, last_page_blocks = start_page, end_page
    else:
        first_page, first_block, first_line, first_boundary = req.end.pageNumber, end_block, end_line, req.end.boundaryText
        last_page, last_block, last_line, last_boundary = req.start.pageNumber, start_block, start_line, req.start.boundaryText
        first_page_blocks, last_page_blocks = end_page, start_page

    first_lines = _filter_block_lines_for_selection(
        first_page_blocks, first_block, _block_boundary_lines(first_block, first_line, "forward"), first_line
    )
    last_lines = _filter_block_lines_for_selection(
        last_page_blocks, last_block, _block_boundary_lines(last_block, last_line, "backward"), last_line
    )
    first_line_texts = _line_texts_with_boundary(first_lines, first_boundary, "forward")
    last_line_texts = _line_texts_with_boundary(last_lines, last_boundary, "backward")

    if first_page == last_page:
        # Same page, different block (e.g. same-page cross-column, or the real Soenen "k"
        # case: two different blocks on the SAME visual row) -- one fragment, no
        # middle-page concept applies. A candidate gap can legitimately sit exactly at the
        # first_lines/last_lines seam (item 26), so they're checked together as one list.
        combined_lines = first_lines + last_lines
        combined_line_texts = first_line_texts + last_line_texts
        combined = _assemble_lines_with_gap_recovery(doc_state.doc, first_page, first_page_blocks, combined_lines, combined_line_texts)
        fragments = [Fragment(pageNumber=first_page, text=combined)]
    else:
        # Cross-page: a visual row can never span two rendered pages, so first_lines and
        # last_lines are checked independently (each may still have its own internal gap).
        first_text = _assemble_lines_with_gap_recovery(doc_state.doc, first_page, first_page_blocks, first_lines, first_line_texts)
        last_text = _assemble_lines_with_gap_recovery(doc_state.doc, last_page, last_page_blocks, last_lines, last_line_texts)
        fragments = [Fragment(pageNumber=first_page, text=first_text)]
        # Item 5 (R1)/45 (R5B), preserved: a page fully spanned by a 3+ page selection
        # contributes its own body-height content, never re-injecting header/footer/
        # footnote-sized blocks just because the page happens to be fully spanned.
        # Missing-glyph recovery is not attempted here -- see _middle_page_text's own note.
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
