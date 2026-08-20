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
from typing import NamedTuple, Optional

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
PADDLE_OCR_URL = os.environ.get("PGT_PADDLE_OCR_URL", "http://127.0.0.1:8008").rstrip("/")
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


class MathRun(BaseModel):
    """Prototype 2.6G2.8M2 -- a contiguous, evidence-seeded inline/display math run within
    one `Fragment`'s own `.text` (offsets are LOCAL to that fragment, never global across a
    multi-page selection -- the client's own fragment-combination step is responsible for
    shifting these when it concatenates fragments, exactly as it already does for the plain
    text itself). See `_detect_math_runs`'s own doc comment for the detection/grouping rule."""

    start: int
    end: int
    text: str
    classification: str  # "inline" | "display"


class Fragment(BaseModel):
    pageNumber: int
    text: str
    mathRuns: list[MathRun] = []


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


# --- Intra-line word-boundary reconstruction (Prototype 2.6G2.5A) -----------------------
#
# "dict"-mode span text (raw_span["text"]) is PyMuPDF's own already-joined text for one
# font-run, produced by an internal heuristic that inserts a synthetic space wherever it
# judges a glyph-to-glyph gap large enough. For some fonts/PDFs that heuristic's own
# threshold is too strict and multiple genuinely separate words are returned as a single,
# spaceless run (e.g. a real failing control measured a ~14.8%-of-font-size gap between
# "training" and "and" that PyMuPDF's own heuristic did not treat as a word boundary, while
# every intra-word glyph-to-glyph gap on the same page measured ~0%). This never touches
# Stanza/SentenceCoreSet/Structure Tree/ReadingGuide -- it is strictly about the English text
# that reaches the textarea before analysis ever begins.
#
# The fix is a SEPARATE, independent geometry pass ("rawdict" mode, which exposes each
# character's own bbox) used ONLY to REPAIR a span's text when its own char geometry proves
# a word gap dict-mode's text does not represent -- never a wholesale replacement of
# PyMuPDF's own extraction. No dictionary, no known-phrase table, no language-specific
# tokenization: the sole signal is the horizontal gap between two adjacent glyphs' bounding
# boxes, normalized by font size.
_WORD_GAP_RATIO = 0.10
_WORD_GAP_MIN_PT = 0.3


def _bbox_key(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    return tuple(round(v, 1) for v in bbox)


# Prototype 2.6G2.8D3 -- superscript fidelity. PyMuPDF's own dict/rawdict-mode span "flags"
# is a per-span bitmask sourced directly from the font/glyph encoding (never inferred from
# neighboring text) -- bit 0 is TEXT_FONT_SUPERSCRIPT (see PyMuPDF's own documented flag
# bits). Live-verified (2.6G2.8D3 trace against the real "m²" case): the superscript "2"
# in "200,000 m2"/"5,000 m2" sits in its OWN span, distinct from the surrounding body-text
# span, with flags=5 (bit 0 set) and size=7.57pt vs the body span's flags=4/size=9.96pt --
# i.e. PyMuPDF already tells us, from the font encoding itself, exactly which characters are
# genuinely rendered as superscripts. This is therefore glyph-identity/encoding evidence, not
# a word-pattern rule ("m followed by a raised digit") -- the SAME span-flags check applies
# regardless of which letter/word precedes the superscript.
TEXT_FONT_SUPERSCRIPT_BIT = 1

# Deliberately narrow to the characters with a well-established, unambiguous Unicode
# superscript codepoint (item 8's own audited cases: m/x/R + digit). A superscript-flagged
# character with NO entry here is left completely unchanged -- never fabricated, never
# dropped -- so an as-yet-unaudited superscript (e.g. a footnote marker using a symbol
# outside this table) safely falls back to plain baseline text instead of guessing.
SUPERSCRIPT_CHAR_MAP: dict[str, str] = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
}


def _apply_superscript_encoding(span_text: str, flags: int) -> str:
    """Prototype 2.6G2.8D3: maps each character of `span_text` through
    `SUPERSCRIPT_CHAR_MAP` when the span's own PyMuPDF flags mark it as a genuine encoded
    superscript (never when the bit is unset, and never for a character with no table
    entry -- both left byte-for-byte unchanged, no fabrication)."""
    if not (flags & TEXT_FONT_SUPERSCRIPT_BIT):
        return span_text
    return "".join(SUPERSCRIPT_CHAR_MAP.get(c, c) for c in span_text)


# Prototype 2.6G2.8D3 -- SUSPECT_NATIVE classification and recovery (item 5/6). Live-traced
# real case: the "=" glyph in "t = 200,000" decodes, via PyMuPDF's own dict/rawdict
# extraction, to U+0002 (a C0 control code) in the "MTSYN" font -- a MathType-style embedded
# symbol font with no usable ToUnicode mapping for this glyph. A control codepoint can NEVER
# be genuine visible document text (unlike an uncommon-but-legitimate scientific symbol --
# alpha/beta/<=/>=/degree/superscript-two/mu/... are never flagged), so this is an
# objective, general signal -- never a per-document/per-glyph special case.
_ORDINARY_WHITESPACE_CONTROL_CODEPOINTS = {0x09, 0x0A, 0x0D, 0x0B, 0x0C}  # tab/LF/CR/VT/FF


def _is_suspect_native_codepoint(c: str) -> bool:
    if len(c) != 1:
        return False
    cp = ord(c)
    if cp in _ORDINARY_WHITESPACE_CONTROL_CODEPOINTS:
        return False
    return cp < 0x20 or 0x7F <= cp <= 0x9F


# Prototype 2.6G2.8M2.2 -- authoritative scientific source reconstruction plumbing. Live-
# traced root cause: `_extract_page_blocks` applies D3's suspect-native/superscript recovery
# to `Line.text`, but for a selection whose start/end boundary falls MID-LINE, the boundary
# line's own contribution comes not from `Line.text` at all -- it comes from the CLIENT's own
# boundaryText (PDF.js's raw DOM Range extraction), needed because only the client knows
# exactly where within the line the click landed. PDF.js decodes the SAME broken MTSYN
# ToUnicode mapping PyMuPDF's own dict-mode text does (confirmed live: the client's own raw
# selected text also shows literal U+0002), so this was a genuine SECOND, uncorrected text
# authority competing with the first -- D3's corrections never had a chance to reach a
# boundary line's own content, only interior lines.
#
# This is TWO representations of the exact same underlying glyphs, not two different pieces
# of content -- so reconciling them is a per-character alignment, not a guess: the client's
# boundary text and the trusted line's own (already-corrected) text differ ONLY at the exact
# positions D3 already knows how to correct (a suspect codepoint, or a plain digit standing
# in for a corrected superscript). Wherever they align this way, the trusted, corrected
# characters become authoritative for the boundary line too -- collapsing this back down to
# ONE text authority (item 5's own explicit requirement), never two. Abstains (returns
# `boundary_text` completely unchanged) whenever the two strings don't align cleanly -- a
# structurally different string is never assumed to be "the same text with typos".
_MAX_TOLERATED_BOUNDARY_CORRECTIONS = 32
_SUPERSCRIPT_DIGIT_TO_PLAIN = {v: k for k, v in SUPERSCRIPT_CHAR_MAP.items()}


def _try_align_boundary_to_trusted_line(boundary_text: str, own_text: str, from_end: bool) -> Optional[str]:
    n = len(boundary_text)
    if n == 0 or n > len(own_text):
        return None
    aligned = own_text[-n:] if from_end else own_text[:n]
    if aligned == boundary_text:
        return None  # already identical -- nothing to correct, let the caller keep the original
    diff_positions = [i for i in range(n) if boundary_text[i] != aligned[i]]
    if len(diff_positions) > _MAX_TOLERATED_BOUNDARY_CORRECTIONS:
        return None  # too different to confidently be "the same text" -- abstain
    for i in diff_positions:
        client_char, trusted_char = boundary_text[i], aligned[i]
        is_suspect_correction = _is_suspect_native_codepoint(client_char)
        is_superscript_correction = client_char.isdigit() and _SUPERSCRIPT_DIGIT_TO_PLAIN.get(trusted_char) == client_char
        if not (is_suspect_correction or is_superscript_correction):
            return None  # a difference outside D3's own known correction classes -- abstain
    return aligned


def _prefer_trusted_line_text_for_boundary(boundary_text: str, own_line: Line) -> str:
    """Tries aligning `boundary_text` against `own_line.text` as BOTH a suffix (the common
    'forward'/click-to-line-end shape) and a prefix (the common 'backward'/line-start-to-
    click shape) -- a reverse-drag selection can swap which of `req.start`/`req.end` ends up
    owning `line_texts[0]` vs `line_texts[-1]` in the same-block branch, so the caller cannot
    always know which shape applies just from array position. Returns the FIRST alignment
    that succeeds (a wrong-shape attempt is expected to show far more than
    `_MAX_TOLERATED_BOUNDARY_CORRECTIONS` differences and abstain on its own), or
    `boundary_text` unchanged if neither alignment succeeds."""
    for from_end in (True, False):
        aligned = _try_align_boundary_to_trusted_line(boundary_text, own_line.text, from_end)
        if aligned is not None:
            return aligned
    return boundary_text


def _recover_suspect_native_char(
    doc: "pymupdf.Document",
    page_number: int,
    width: float,
    height: float,
    char_bbox_pt: tuple[float, float, float, float],
    left_anchor: str,
    right_anchor: str,
) -> Optional[str]:
    """Item 6's SUSPECT_NATIVE_RECOVERY contract: native geometry (`char_bbox_pt`) is
    authoritative for LOCATION only; a confident OCR read of a tightly local crop is the sole
    source ever trusted for WHICH character is actually rendered there. Requires rendered ink
    at the suspect glyph's own location (the same visual-ink gate gap recovery already uses),
    OCR confidence >= OCR_CONFIDENCE_THRESHOLD, and an anchor-bounded recovered result that is
    EXACTLY ONE character -- never a multi-character substitution for a single glyph (that
    would risk duplication/false insertion). Returns None (leave the suspect character
    exactly as extracted) whenever any of these can't be confidently established -- never
    guesses, e.g. never infers "=" merely because parameter assignments usually use it."""
    cx0, cy0, cx1, cy1 = char_bbox_pt
    cw = max(cx1 - cx0, 1.0)
    chh = max(cy1 - cy0, 1.0)
    # Prototype 2.6G2.8M2.2a Track A -- live-traced real defect: `left_anchor`/`right_anchor`
    # can be up to 6 characters of SURROUNDING text (see `_recover_suspect_native_in_span`),
    # but the horizontal padding here was scaled only by the SUSPECT GLYPH's own width (`cw`)
    # -- often much narrower than an ordinary text character (a symbol-font "=" measured
    # ~7.8pt wide in the real trace, giving only ~15.5pt of padding per side, nowhere near
    # enough to render 5-6 digit/letter characters for OCR to read). Three of four real "="
    # occurrences failed anchor matching for exactly this reason (`outcome="not_single_char"`
    # with `recovered=None`, i.e. the anchor was never found because the crop was cropped
    # before reaching it) -- only the one whose neighboring text happened to be short enough
    # to fit within the too-narrow crop recovered. `chh` (line/character HEIGHT, correlated
    # with the surrounding TEXT's own font size regardless of how narrow the suspect glyph
    # itself is) is a more reliable proxy for "how wide is a typical neighboring character
    # here" -- floored against the existing `cw`-based term so neither shrinks the crop for
    # font/glyph combinations where `cw` was already generous.
    horizontal_padding = max(cw * 2.0, chh * 3.0)
    crop_rect = (cx0 - horizontal_padding, cy0 - chh * 0.5, cx1 + horizontal_padding, cy1 + chh * 0.5)
    ink_ratio = _render_gap_ink_ratio(doc, page_number, (crop_rect[0] / width, crop_rect[1] / height, crop_rect[2] / width, crop_rect[3] / height), width, height)
    if ink_ratio < VISUAL_INK_CENTRAL_RATIO_THRESHOLD:
        _trace("SUSPECT_NATIVE_RECOVERY", cropRectPt=crop_rect, leftAnchor=left_anchor, rightAnchor=right_anchor, inkRatio=ink_ratio, outcome="no_ink")
        return None
    page = doc[page_number - 1]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(VISUAL_INK_RENDER_SCALE, VISUAL_INK_RENDER_SCALE), clip=pymupdf.Rect(*crop_rect))
    ocr_lines = _call_paddle_ocr(pix.tobytes("png"))
    if not ocr_lines:
        _trace("SUSPECT_NATIVE_RECOVERY", cropRectPt=crop_rect, leftAnchor=left_anchor, rightAnchor=right_anchor, outcome="no_ocr_result")
        return None
    best = max(ocr_lines, key=lambda l: l.get("confidence") or 0.0)
    confidence = best.get("confidence") or 0.0
    if confidence < OCR_CONFIDENCE_THRESHOLD:
        _trace("SUSPECT_NATIVE_RECOVERY", cropRectPt=crop_rect, leftAnchor=left_anchor, rightAnchor=right_anchor, ocrText=best.get("text"), confidence=confidence, outcome="low_confidence")
        return None
    fragment = _recover_gap_text(left_anchor, right_anchor, best.get("text") or "")
    if fragment is None or len(fragment.text) != 1:
        _trace(
            "SUSPECT_NATIVE_RECOVERY",
            cropRectPt=crop_rect, leftAnchor=left_anchor, rightAnchor=right_anchor, ocrText=best.get("text"), confidence=confidence, recovered=fragment, outcome="not_single_char",
        )
        return None
    _trace(
        "SUSPECT_NATIVE_RECOVERY",
        cropRectPt=crop_rect, leftAnchor=left_anchor, rightAnchor=right_anchor, ocrText=best.get("text"), confidence=confidence, recovered=fragment, outcome="recovered",
    )
    return fragment.text


def _recover_suspect_native_in_span(
    doc: "pymupdf.Document",
    page_number: int,
    width: float,
    height: float,
    span_text: str,
    raw_chars: list[dict],
    prev_span_tail: str,
    next_span_head: str,
) -> str:
    """Scans `span_text` for SUSPECT_NATIVE characters and attempts to recover each one via
    `_recover_suspect_native_char`. `raw_chars` is this span's own rawdict character list,
    used only to find the suspect character's exact bbox (never its text -- that's the same
    value already in `span_text`). `span_text` may contain extra inserted spaces relative to
    `raw_chars` (see `_reconstruct_line_span_texts`'s own contract: it only ever ADDS spaces,
    never removes/reorders characters), so a simple two-pointer walk stays correctly aligned
    without needing its own separate reconciliation pass."""
    if not any(_is_suspect_native_codepoint(c) for c in span_text):
        return span_text
    result_chars = list(span_text)
    raw_idx = 0
    for i, c in enumerate(result_chars):
        if raw_idx < len(raw_chars) and raw_chars[raw_idx].get("c") == c:
            if _is_suspect_native_codepoint(c):
                char_bbox = raw_chars[raw_idx].get("bbox")
                if char_bbox is not None:
                    left_anchor = (prev_span_tail + span_text[:i])[-6:]
                    right_anchor = (span_text[i + 1 :] + next_span_head)[:6]
                    recovered = _recover_suspect_native_char(doc, page_number, width, height, char_bbox, left_anchor, right_anchor)
                    if recovered is not None:
                        result_chars[i] = recovered
            raw_idx += 1
        # else: `c` is a gap-recovery-inserted space with no `raw_chars` counterpart --
        # skip it without advancing raw_idx, keeping the two streams aligned.
    return "".join(result_chars)


# --- Prototype 2.6G2.8M2: math-run detection (foundation) -------------------------------
#
# Operates on already-ASSEMBLED text (a Fragment's own final `.text`, after D1/D2/D3
# recovery has already run) rather than on raw PyMuPDF spans. This intentionally trades away
# font/flag-based evidence (only available earlier, per-span, inside `_extract_page_blocks`)
# for the ability to run uniformly across every text-producing branch of `/layout/selection`
# (same-block multi-line, cross-block, equation-aware) without threading detection through
# each one's own bespoke assembly logic -- a real architectural simplification for this
# foundation phase, reported honestly rather than claimed complete (font-based `symbol_font`/
# `native_ink_mismatch` evidence from the M1 report is NOT wired into this pass; see the
# M2 report's own "files M3 might implement" note).
#
# STRONG evidence only (M1.1 item 2's own requirement): weak typography evidence (font/size/
# baseline/style differences) is not even inspected here, so it can never seed OR extend a
# run -- trivially satisfying "weak evidence alone must never seed math" for this phase.
# A genuinely uncommon scientific Unicode character is never itself suspicious (item 4's own
# explicit non-goal) -- only a CLOSED, evidence-based set of operators/Greek letters/symbols
# that essentially never occur in ordinary English running prose is used. "_" is included
# because it essentially never appears in ordinary English prose either, and is the one
# widely-used plain-ASCII convention for subscript notation in scientific text ("x_i") --
# still a structural/character-class signal, never a word/phrase rule.
_MATH_EVIDENCE_UNICODE_CHARS: frozenset[str] = frozenset(
    "<>=≤≥≠≈±×·°_"
    "¹²³⁰⁴⁵⁶⁷⁸⁹"
    "αβγδεζηθικλμνξοπρστυφχψω"
    "ΓΔΘΛΞΠΣΦΨΩ"
    "∑∫√∞"
)

# Item 9's own default policy split: an expression carrying one of these characters is
# "RELATIONAL/ASSIGNMENT" (Stanza-unreliable, per M1.1's live-traced "t = 0.5" fabricated-
# clause finding) rather than "SIMPLE/STABLE".
_RELATIONAL_OPERATOR_CHARS: frozenset[str] = frozenset("=<>≤≥≠≈")

_NUMERIC_TOKEN_PATTERN = re.compile(r"^[\d.,%]+$")
_SYMBOL_TOKEN_PATTERN = re.compile(r"^[^\w\s]+$")
_ALLCAPS_IDENTIFIER_PATTERN = re.compile(r"^[A-Z]{2,}$")


def _is_text_math_evidence_char(c: str) -> bool:
    return c in _MATH_EVIDENCE_UNICODE_CHARS or _is_suspect_native_codepoint(c)


def _classify_math_token(token: str) -> str:
    """Purely structural classification (never a word/phrase dictionary): EVIDENCE (contains
    a strong math-evidence character), NUMERIC (digits/decimal/comma/percent only, an
    optional single trailing period stripped first -- a sentence-final period is handled
    separately, at the run level, in `_detect_math_runs`), SYMBOL (pure punctuation, no
    letters/digits -- e.g. a lone "+"), SINGLE_LETTER (one alphabetic character -- a bare
    variable name), ALLCAPS_IDENTIFIER (2+ letters, ALL uppercase -- the common scientific
    convention for a multi-letter symbolic name like "NDVI"/"SUM", distinguished from an
    ordinary word purely by capitalization pattern, never by a word list), or PROSE
    (anything else, i.e. an ordinary multi-letter word)."""
    if any(_is_text_math_evidence_char(c) for c in token):
        return "EVIDENCE"
    stem = token[:-1] if token.endswith(".") and len(token) > 1 else token
    if _NUMERIC_TOKEN_PATTERN.match(stem):
        return "NUMERIC"
    if _SYMBOL_TOKEN_PATTERN.match(token):
        return "SYMBOL"
    if len(token) == 1 and token.isalpha():
        return "SINGLE_LETTER"
    if _ALLCAPS_IDENTIFIER_PATTERN.match(token):
        return "ALLCAPS_IDENTIFIER"
    return "PROSE"


_BRIDGEABLE_TOKEN_KINDS = {"EVIDENCE", "NUMERIC", "SYMBOL", "SINGLE_LETTER", "ALLCAPS_IDENTIFIER"}


def _detect_math_runs(text: str) -> list[tuple[int, int]]:
    """Prototype 2.6G2.8M2 -- groups EVIDENCE-seeded tokens with their immediately
    surrounding BRIDGEABLE tokens (NUMERIC/SYMBOL/SINGLE_LETTER/ALLCAPS_IDENTIFIER -- never a
    genuine multi-letter PROSE word) into contiguous character ranges. A PROSE token always
    terminates extension in that direction -- this is a deliberate, honestly-reported
    limitation: "sin θ"/"cos i" only detect the evidence-bearing symbol itself ("θ") when the
    function name ("sin"/"cos") is ordinary lowercase prose with no evidence of its own (see
    the M2 report's own coverage matrix; M1.1 already flagged this as unproven). Multiple
    EVIDENCE tokens separated only by bridgeable tokens merge into ONE run (the real live
    "t = 200,000 m²" shape: "=" and "²" are two separate EVIDENCE tokens bridged by the
    NUMERIC/SINGLE_LETTER tokens between them). A lone EVIDENCE token with no bridgeable
    neighbor stays a single-token run. A trailing sentence period is trimmed off the very end
    of a run when it looks sentence-final (the same general capitalization signal
    `scientificTextShielding.ts` already uses client-side -- never a word-specific rule)."""
    tokens: list[tuple[int, int, str]] = []
    for m in re.finditer(r"\S+", text):
        tokens.append((m.start(), m.end(), _classify_math_token(m.group())))

    evidence_indices = [i for i, (_s, _e, kind) in enumerate(tokens) if kind == "EVIDENCE"]
    if not evidence_indices:
        return []

    included = [False] * len(tokens)
    for idx in evidence_indices:
        included[idx] = True
        i = idx - 1
        while i >= 0 and tokens[i][2] in _BRIDGEABLE_TOKEN_KINDS:
            included[i] = True
            i -= 1
        i = idx + 1
        while i < len(tokens) and tokens[i][2] in _BRIDGEABLE_TOKEN_KINDS:
            included[i] = True
            i += 1

    runs: list[tuple[int, int]] = []
    run_start: Optional[int] = None
    prev_end: Optional[int] = None
    for i, (start, end, _kind) in enumerate(tokens):
        if included[i]:
            if run_start is None:
                run_start = start
            prev_end = end
        else:
            if run_start is not None:
                runs.append((run_start, prev_end))
                run_start = None
    if run_start is not None:
        runs.append((run_start, prev_end))

    trimmed: list[tuple[int, int]] = []
    for start, end in runs:
        if end > start and text[end - 1] == ".":
            rest = text[end:].lstrip()
            if rest == "" or rest[0].isupper() or not rest[0].isalnum():
                end -= 1
        if end > start:
            trimmed.append((start, end))
    return trimmed


_DISPLAY_MATH_TOKEN_PATTERN = re.compile(r"\[式\s*(?:\(\d{1,3}\))?\]")


def _build_fragment(page_number: int, text: str) -> Fragment:
    """Prototype 2.6G2.8M2 -- the single construction point for every `Fragment` this
    endpoint returns, so math-run detection runs uniformly rather than being repeated (and
    risking drift) at each of this file's several `Fragment(...)` call sites. Display-
    equation placeholders (`_equation_display_token`'s own "[式 (N)]" spelling) are always
    surfaced as their own `classification="display"` run -- reusing that ALREADY-established
    provenance, never re-detected from scratch. Inline runs come from `_detect_math_runs`."""
    runs: list[MathRun] = []
    for m in _DISPLAY_MATH_TOKEN_PATTERN.finditer(text):
        runs.append(MathRun(start=m.start(), end=m.end(), text=m.group(), classification="display"))
    display_ranges = [(r.start, r.end) for r in runs]
    for start, end in _detect_math_runs(text):
        if any(start < de and ds < end for ds, de in display_ranges):
            continue  # never double-count text already claimed by a display placeholder
        runs.append(MathRun(start=start, end=end, text=text[start:end], classification="inline"))
    runs.sort(key=lambda r: r.start)
    return Fragment(pageNumber=page_number, text=text, mathRuns=runs)


def _rawdict_chars_by_line(page: "pymupdf.Page") -> dict[tuple[float, float, float, float], list[list[dict]]]:
    """Maps each line's rounded bbox -> one char list per span (rawdict mode), used only to
    independently verify/repair "dict"-mode's word-boundary reconstruction. Returns {} if
    rawdict extraction fails outright for this page -- callers then leave every span's
    dict-mode text completely unmodified (the pre-2.6G2.5A behavior), never guess."""
    try:
        rd = page.get_text("rawdict")
    except Exception:
        return {}
    result: dict[tuple[float, float, float, float], list[list[dict]]] = {}
    for raw_block in rd.get("blocks", []):
        if raw_block.get("type") != 0:
            continue
        for raw_line in raw_block.get("lines", []):
            key = _bbox_key(tuple(raw_line.get("bbox", (0.0, 0.0, 0.0, 0.0))))
            result[key] = [span.get("chars", []) for span in raw_line.get("spans", [])]
    return result


def _has_word_gap(prev_char: dict, next_char: dict) -> bool:
    gap = next_char["bbox"][0] - prev_char["bbox"][2]
    size = max(prev_char.get("size", 0.0), next_char.get("size", 0.0)) or 1.0
    return gap > max(_WORD_GAP_MIN_PT, _WORD_GAP_RATIO * size)


def _reconstruct_line_span_texts(dict_spans: list[dict], raw_span_chars: Optional[list[list[dict]]]) -> list[str]:
    """Returns one text string per span in `dict_spans`, same order. Prefers each span's own
    PyMuPDF "dict"-mode text unchanged; only substitutes a geometry-reconstructed text for a
    span whose own rawdict character stream proves a word gap exists that dict-mode's text
    does not represent -- and only ever ADDS a single space at a proven gap, never removes or
    otherwise alters any character. Falls back to the original dict-mode text entirely when
    rawdict data is unavailable or its span count doesn't line up with dict-mode's own (a
    structural mismatch that should not happen but is treated as "leave alone")."""
    original_texts = [s["text"] for s in dict_spans]
    if not raw_span_chars or len(raw_span_chars) != len(dict_spans):
        return original_texts

    result: list[str] = []
    prev_last_char: Optional[dict] = None
    for span_index, chars in enumerate(raw_span_chars):
        original = original_texts[span_index]
        size = dict_spans[span_index].get("size", 0.0)
        pieces: list[str] = []
        need_leading_space = False
        if chars and prev_last_char is not None:
            first_c = chars[0].get("c", "")
            if first_c and not first_c.isspace() and not prev_last_char.get("c", "").isspace():
                if _has_word_gap(prev_last_char, {**chars[0], "size": size}):
                    need_leading_space = True
        for i, ch in enumerate(chars):
            c = ch.get("c", "")
            if i > 0:
                prev = chars[i - 1]
                if c and not c.isspace() and not prev.get("c", "").isspace():
                    if _has_word_gap({**prev, "size": size}, {**ch, "size": size}):
                        pieces.append(" ")
            pieces.append(c)
        reconstructed = ("" if not need_leading_space else " ") + "".join(pieces)

        stripped_reconstructed = reconstructed.replace(" ", "")
        stripped_original = original.replace(" ", "")
        if chars and stripped_reconstructed == stripped_original and len(reconstructed) >= len(original) and reconstructed != original:
            result.append(reconstructed)
        else:
            result.append(original)

        prev_last_char = {**chars[-1], "size": size} if chars else None
    return result


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
    raw_chars_by_line = _rawdict_chars_by_line(page)

    blocks: list[Block] = []
    raw_spans_pt: list[dict] = []  # every span's own raw (pt, unnormalized) geometry, across ALL blocks -- gap detection needs to compare adjacent spans regardless of which block PyMuPDF happened to put them in (see docs/design-notes.md, Prototype 2.5A: two spans on the SAME visual row can legitimately land in different blocks).
    for bi, raw_block in enumerate(d["blocks"]):
        if raw_block.get("type") != 0:  # image blocks carry no selectable text
            continue
        lines: list[Line] = []
        for raw_line in raw_block["lines"]:
            spans: list[Span] = []
            # Prototype 2.6G2.5A: PyMuPDF's own "dict"-mode span text (raw_span["text"]) is
            # PREFERRED as-is -- it already carries whatever whitespace the PDF's content
            # stream and PyMuPDF's own internal heuristic produced. It is only OVERRIDDEN,
            # span-by-span, when this line's independently-computed char-geometry
            # reconstruction (_line_text_from_raw_chars) proves a different, gap-justified
            # result -- see that function's own docs for why this is a strict repair, never a
            # wholesale replacement of PyMuPDF's own text.
            line_raw_chars = raw_chars_by_line.get(_bbox_key(raw_line["bbox"]))
            span_texts = _reconstruct_line_span_texts(raw_line["spans"], line_raw_chars)
            span_texts = [_apply_superscript_encoding(t, s.get("flags", 0)) for t, s in zip(span_texts, raw_line["spans"])]
            # Prototype 2.6G2.8D3 item 6: SUSPECT_NATIVE recovery -- applied AFTER superscript
            # encoding (unrelated concerns; superscript only ever touches digits with a table
            # entry, never a control codepoint) and BEFORE anything downstream ever sees this
            # line's text, so a recovered "=" is indistinguishable from ordinary trusted text
            # to every later consumer (gap detection, boundary clipping, etc).
            if line_raw_chars and len(line_raw_chars) == len(span_texts):
                for span_index in range(len(span_texts)):
                    if not any(_is_suspect_native_codepoint(c) for c in span_texts[span_index]):
                        continue
                    prev_tail = span_texts[span_index - 1][-6:] if span_index > 0 else ""
                    next_head = span_texts[span_index + 1][:6] if span_index + 1 < len(span_texts) else ""
                    span_texts[span_index] = _recover_suspect_native_in_span(
                        doc, page_number, width, height, span_texts[span_index], line_raw_chars[span_index], prev_tail, next_head
                    )
            line_text_parts = []
            for raw_span, span_text in zip(raw_line["spans"], span_texts):
                bx0, by0, bx1, by1 = raw_span["bbox"]
                spans.append(Span(text=span_text, bbox=(bx0 / width, by0 / height, bx1 / width, by1 / height), size=raw_span["size"], font=raw_span["font"]))
                line_text_parts.append(span_text)
                if raw_span["text"].strip():
                    # Prototype 2.5L item 9: "text" is threaded through so the punctuation-
                    # bounded candidacy rule below can check bracket-adjacency; this is the
                    # span's own already-reliably-extracted PyMuPDF text (never OCR/guessed),
                    # so it doesn't compromise _detect_suspicious_gaps's existing "pure
                    # geometry, no dictionary/content guessing" contract for the ordinary rule.
                    # Deliberately still keyed on raw_span["text"] (not span_text) -- gap
                    # detection's own candidacy rule is unrelated to intra-span word-boundary
                    # reconstruction and must stay unaffected by it.
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


def _find_trailing_adjacent_line(page_blocks: PageBlocks, line: Line) -> Optional[Line]:
    """Prototype 2.6G2.8D2 -- TYPE C (trailing/edge) gap support. `_assemble_lines_with_gap_
    recovery`'s own loop only ever checks `_gap_between_lines` for CONSECUTIVE lines already
    inside the one selection's own assembled `lines` list -- the LAST line has no `lines[i+1]`
    to pair against at all, so a genuine missing glyph sitting between its own last character
    and whatever native text immediately follows it (in a different, not-necessarily-selected
    block -- e.g. the very next sentence's own leading punctuation, exactly the real "90°."
    case: PyMuPDF splits "angle approaches 90" and ". In several studies..." into two separate
    blocks) was never inspected at all.

    Purely geometric (item 1: never special-cased to any specific glyph/paper/font): searches
    every block's own lines for one on the SAME visual row (y-overlap) whose own left edge
    sits at or immediately after `line`'s own right edge, and returns the closest such line
    (or None). This only ever LOCATES a candidate right-anchor for the existing anchor-bounded
    gap-recovery pipeline below (`_gap_between_lines` / `_attempt_gap_recovery`, both
    completely unchanged) -- it never contributes its own text to the reconstructed selection
    beyond what that pipeline's own confidence-gated recovery actually returns."""
    candidates = [
        candidate
        for block in page_blocks.blocks
        for candidate in block.lines
        if candidate is not line
        and candidate.bbox[1] < line.bbox[3]
        and candidate.bbox[3] > line.bbox[1]
        and candidate.bbox[0] >= line.bbox[2] - _LINE_GAP_X_TOL
    ]
    return min(candidates, key=lambda c: c.bbox[0]) if candidates else None
    return None


def _find_leading_adjacent_line(page_blocks: PageBlocks, line: Line) -> Optional[Line]:
    """Prototype 2.6G2.8S1.2 TRACK A -- symmetric to `_find_trailing_adjacent_line` above, for
    the START side. Live-traced real defect: the selection's own resolved start line (") and
    solar") begins partway across its visual row (x ~= 0.417, not the page's own left margin)
    -- a SIBLING BLOCK occupies the same row to its left ("...zenith angle (39.31", ending
    right where the missing degree symbol sits), split off into its own block by the exact
    same unextractable-glyph mechanism that splits a trailing row (D2). The assembly loop only
    ever pairs CONSECUTIVE lines already inside `lines[]` -- the FIRST line has no `lines[-1]`
    on its own left to pair against, so this gap was never inspected at all.

    Purely geometric, same shape as the trailing search: same visual row (y-overlap), closest
    candidate whose own RIGHT edge sits at or immediately before `line`'s own LEFT edge. Never
    contributes text beyond what the confidence-gated recovery pipeline actually returns --
    boundary safety comes from the caller's own requirement that the client's boundary text
    already ends with `line`'s own trusted text (see the leading-gap block below), so a
    candidate whose content the user never actually selected can never expand the result."""
    candidates = [
        candidate
        for block in page_blocks.blocks
        for candidate in block.lines
        if candidate is not line
        and candidate.bbox[1] < line.bbox[3]
        and candidate.bbox[3] > line.bbox[1]
        and candidate.bbox[2] <= line.bbox[0] + _LINE_GAP_X_TOL
    ]
    return max(candidates, key=lambda c: c.bbox[2]) if candidates else None


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


class RecoveredFragment(NamedTuple):
    """Prototype 2.6G2.8M1.2a -- CONTENT and BOUNDARY SPACING are different pieces of source
    evidence (item 5's own explicit requirement): `text` is the recovered content with no
    surrounding whitespace; `leading_separator`/`trailing_separator` carry whatever
    whitespace (if any) the OCR text itself showed immediately before/after that content,
    evidence-based, never fabricated -- "" when the OCR text shows the content touching its
    neighbor directly (e.g. "90" immediately followed by "°"), a single space when it shows a
    genuine word gap (e.g. "of" followed by " cos i"). Callers decide what to do with the
    separator; `_recover_gap_text` itself never guesses spacing from the content's own
    semantic identity (a letter-string is not, by itself, evidence of a preceding space)."""

    text: str
    leading_separator: str
    trailing_separator: str


def _recover_gap_text(left_anchor: str, right_anchor: str, ocr_text: str) -> Optional[RecoveredFragment]:
    """Prototype 2.5C/E item 30/31/32: recovery is allowed ONLY when both trusted anchors
    (the two bounding lines' own PyMuPDF-extracted text) are found in `ocr_text`, in
    order -- the recovered substring is exactly what lies between them. Never trusts OCR
    beyond that bounded substring; never invents/guesses (item 34).

    Item 31's comparison-only normalization (ligatures + quote-folding + NFKC + whitespace
    collapse) is applied to BOTH the anchors and the OCR text before searching (real PyMuPDF
    text can contain a ligature codepoint like "reﬂectance" that an OCR engine naturally
    outputs as plain "reflectance", or a typographic apostrophe an OCR engine emits as a
    plain ASCII one -- without this, a perfectly correct OCR read fails to anchor-match and
    gets discarded as unrecoverable). The recovered substring itself is taken from the
    NORMALIZED text, which is safe here: what's actually being recovered is a single
    inline-math variable/symbol/short run (k, e, theta, cos i, ...), never a
    ligature/quote-bearing word run.

    Prototype 2.6G2.8M1.2a: because `_normalize_for_match`'s own whitespace collapse
    (`\\s+` -> single space) already runs before this search, any separator surviving in the
    sliced substring is either "" (content touches its neighbor with no gap at all) or
    exactly one space (a genuine gap) -- never fabricated, always read directly off what the
    OCR text itself showed at that exact position."""
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
    raw_between = norm_ocr_text[left_idx + len(norm_left) : right_idx]
    content = raw_between.strip()
    if not content:
        return None
    leading_separator = raw_between[: len(raw_between) - len(raw_between.lstrip())]
    trailing_separator = raw_between[len(raw_between.rstrip()) :]
    return RecoveredFragment(text=content, leading_separator=leading_separator, trailing_separator=trailing_separator)


def _attempt_gap_recovery(
    doc: "pymupdf.Document",
    page_number: int,
    width: float,
    height: float,
    line_a: Line,
    line_b: Line,
    reading_order: bool = False,
    extra_crop_bbox: Optional[tuple[float, float, float, float]] = None,
) -> Optional[RecoveredFragment]:
    """Prototype 2.5E item 24-30: renders the LOCAL two-line crop (never the whole page-wide
    row -- item 25, a two-column PDF may have unrelated content at the same y in the other
    column) bounding a visual-ink-positive gap, OCRs it via the existing Paddle service, and
    returns only the anchor-aligned recovered fragment, or None if recovery can't be
    confidently completed (Paddle unavailable, low confidence, anchors not found/ordered).
    Prototype 2.6G2.8M1.2a: returns the full `RecoveredFragment` (content + evidence-based
    separators), not just its `.text` -- callers that only ever needed bare content (the
    ordinary inter-line loop below) use `.text` unchanged; the trailing-gap splice uses
    `.leading_separator` too, since that is exactly where the real "of"+"cos i" bug lived.

    `reading_order`: Prototype 2.6G2.8S1.3 -- the default x-position sort below is only valid
    when both lines sit on the SAME visual row (the overwhelming common case this function was
    built for). For a genuine LINE-WRAP gap (`line_a` ends one row, `line_b` is the true next
    line in reading order but starts the FOLLOWING row back at the page's own left margin),
    x-sorting silently SWAPS the anchors -- `line_b`'s smaller x0 would be read as "left" even
    though it comes SECOND -- and `_recover_gap_text` then searches for the wrong anchor order
    entirely, live-traced as a spurious `anchor_not_found` on a real, genuinely-recoverable
    gap. Callers that already know the true reading order (never inferred from geometry alone)
    pass `reading_order=True` to use `line_a`/`line_b` exactly as given, unsorted."""
    left_line, right_line = (line_a, line_b) if reading_order or line_a.bbox[0] <= line_b.bbox[0] else (line_b, line_a)
    crop_rect = _lines_pt_bbox_union(left_line, right_line, width, height)
    if extra_crop_bbox is not None:
        # Prototype 2.6G2.8S1.3a -- live-traced real defect: the union of the two TRUSTED
        # lines' own extracted bboxes does not always contain the missing glyph's actual
        # pixels. For the wrap-trailing case specifically, the glyph sits in the small
        # ink-verified region immediately past `line_a`'s own trailing edge (that is the
        # whole reason a synthetic probe was needed at all) -- `line_b` (the next row) starts
        # further LEFT, back at the page margin, so the plain two-line union never reaches
        # that region. OCR then reads real neighboring text but never sees the glyph itself,
        # producing an empty (not missing) gap between the two anchors -- a silent false
        # negative, not the anchor-order bug already fixed above. Extending the crop with the
        # caller's own already-ink-verified probe bbox (never a blind guess) fixes this
        # without touching the same-row default path, which never passes this parameter.
        ex0, ey0, ex1, ey1 = extra_crop_bbox
        cx0, cy0, cx1, cy1 = crop_rect
        crop_rect = (min(cx0, ex0 * width), min(cy0, ey0 * height), max(cx1, ex1 * width), max(cy1, ey1 * height))
    page = doc[page_number - 1]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(VISUAL_INK_RENDER_SCALE, VISUAL_INK_RENDER_SCALE), clip=pymupdf.Rect(*crop_rect))
    ocr_lines = _call_paddle_ocr(pix.tobytes("png"))
    if not ocr_lines:
        _trace("GAP_RECOVERY", cropRectPt=crop_rect, leftAnchor=left_line.text, rightAnchor=right_line.text, ocrResult=None, outcome="no_ocr_result")
        return None
    if reading_order:
        # Prototype 2.6G2.8S1.3a -- live-traced real defect: a wrap-fallback crop spans TWO
        # separate visual rows by construction (`left_line` ends one row, `right_line` starts
        # the next), so Paddle legitimately detects and returns TWO separate text-line entries
        # in `lines` (already in top-to-bottom detection order -- confirmed by the OCR
        # service's own multi-line test fixture). Picking only the single highest-confidence
        # entry (the same-row default below) silently discards whichever row lost that
        # comparison -- observed live as `rightAnchor` never appearing in `ocrText` at all,
        # a spurious `anchor_not_found` on a genuinely recoverable gap. Joining every detected
        # line keeps this confined to the wrap path alone: `reading_order` is only ever True
        # from the wrap-trailing caller, never the same-row default below.
        best_text = " ".join((l.get("text") or "") for l in ocr_lines)
        confidence = min((l.get("confidence") or 0.0) for l in ocr_lines)
    else:
        best = max(ocr_lines, key=lambda l: l.get("confidence") or 0.0)
        best_text = best.get("text") or ""
        confidence = best.get("confidence") or 0.0
    if confidence < OCR_CONFIDENCE_THRESHOLD:
        _trace("GAP_RECOVERY", cropRectPt=crop_rect, leftAnchor=left_line.text, rightAnchor=right_line.text, ocrText=best_text, confidence=confidence, outcome="low_confidence")
        return None
    fragment = _recover_gap_text(left_line.text, right_line.text, best_text)
    _trace(
        "GAP_RECOVERY",
        cropRectPt=crop_rect,
        leftAnchor=left_line.text,
        rightAnchor=right_line.text,
        ocrText=best_text,
        confidence=confidence,
        recovered=fragment,
        outcome="recovered" if fragment is not None else "anchor_not_found",
    )
    return fragment


MICRO_GAP_MAX_WIDTH_EM = 1.5  # generous upper bound for a SINGLE missing glyph's own width --
# never a whole missing word/phrase/column jump (section 9's own "locally bounded and sane").

# Prototype 2.6G2.8S1.3a -- used ONLY by the wrap-trailing synthetic probe in
# `_try_trailing_gap_recovery` (never `_probe_micro_gap_ink`'s own same-line/inter-line
# candidates above, which stay on `MICRO_GAP_MAX_WIDTH_EM` unchanged). The wrap-trailing case
# has no real right-anchor block to bound the probe region against (that is precisely why it
# falls to a synthetic guess at all) -- live-traced real defect: reusing the SAME generous
# 1.5em bound here diluted a real, ink-positive degree-symbol region (an isolated glyph
# occupying only a small fraction of that width, with mostly blank page margin filling the
# rest) below `VISUAL_INK_CENTRAL_RATIO_THRESHOLD` (0.0238 measured vs. 0.05 required) --
# NOT an ink-negative case, a too-wide-probe case. Rather than guess a second single magic
# width, try increasingly wide probes (narrowest first) and stop at the first one that clears
# the ink threshold -- the narrowest width that already contains the glyph gives the least-
# diluted ratio. Capped at `MICRO_GAP_MAX_WIDTH_EM`, the same bound the same-line/inter-line
# probes already enforce, so this never searches wider than an ordinary character either.
WRAP_TRAILING_PROBE_WIDTHS_EM = (0.35, 0.5, 0.75, 1.0, MICRO_GAP_MAX_WIDTH_EM)


def _probe_micro_gap_ink(
    doc: "pymupdf.Document", page_number: int, page_blocks: PageBlocks, left_bbox: tuple[float, float, float, float], right_bbox: tuple[float, float, float, float], ref_size: float
) -> Optional[SuspiciousGap]:
    """Prototype 2.6G2.8S1.2 TRACK B -- root cause D (CANDIDATE_REJECTED_BY_GEOMETRY). The
    real second degree-symbol gap (~4.8pt) sits BELOW `_detect_suspicious_gaps`'s own
    `SUSPICIOUS_GAP_EM_MULTIPLIER (0.6) x font_size (~9.96pt) ~= 5.98pt` threshold -- that
    page-wide detector is deliberately tuned for a FULL missing character (the original "k"/
    "cos i" cases) and never emitted a `SuspiciousGap` here at all, so nothing downstream
    (same-line or inter-line) ever had one to match against.

    Per section 8's own key principle: candidate strength for a SAME-ROW adjacent-native
    interval should come from NO NATIVE OWNERSHIP + LOCAL RENDERED INK, never from requiring
    the missing region to be as wide as an ordinary character -- small scientific glyphs
    (deg., middle dot, primes, ...) are legitimately narrower than that. This performs a
    LOCAL, targeted ink probe directly on the geometric interval between two specific
    candidate anchors (reusing the exact same `_render_gap_ink_ratio` machinery the page-wide
    detector's own downstream ink gate already uses) -- never a second page-wide detection
    pass, and never globally loosening `SUSPICIOUS_GAP_EM_MULTIPLIER` (section 7's explicit
    prohibition: that would raise false candidates across ALL ordinary typography). Bounded to
    `MICRO_GAP_MAX_WIDTH_EM` so a genuine missing WORD or a large column gap can never reach
    this path (that shape stays exclusively the page-wide detector's own concern). Requires a
    real, positive Y-overlap (same visual row) and a real, positive X interval (spans/lines
    that already touch or overlap have nothing to probe). Ordinary word-spacing reliably has
    NO ink in its own interval (section 17's own required negative) -- this is what keeps the
    mechanism from firing on ordinary prose: the geometry alone never decides, only rendered
    ink does."""
    gx0, gx1 = min(left_bbox[2], right_bbox[0]), max(left_bbox[2], right_bbox[0])
    if gx1 <= gx0:
        return None
    gy0, gy1 = max(left_bbox[1], right_bbox[1]), min(left_bbox[3], right_bbox[3])
    if gy1 <= gy0:
        return None  # no real Y overlap -- not the same visual row
    width_pt = (gx1 - gx0) * page_blocks.width
    if width_pt > MICRO_GAP_MAX_WIDTH_EM * max(ref_size, 1.0):
        return None  # too wide to be a single missing glyph
    candidate_bbox = (gx0, gy0, gx1, gy1)
    ink_ratio = _render_gap_ink_ratio(doc, page_number, candidate_bbox, page_blocks.width, page_blocks.height)
    _trace("MICRO_GAP_PROBE", gapBbox=candidate_bbox, widthPt=width_pt, refSize=ref_size, visualInkRatio=ink_ratio, outcome="ink_positive" if ink_ratio > VISUAL_INK_CENTRAL_RATIO_THRESHOLD else "no_ink")
    if ink_ratio <= VISUAL_INK_CENTRAL_RATIO_THRESHOLD:
        return None
    return SuspiciousGap(bbox=candidate_bbox)


def _find_span_gap_candidates(doc: "pymupdf.Document", page_number: int, page_blocks: PageBlocks, line: Line) -> list[tuple[Span, Span, SuspiciousGap]]:
    """Prototype 2.6G2.8S1.1 -- root cause C (same-line native intervals are never
    inspected). `_gap_between_lines` only ever checks a `SuspiciousGap` against two
    DIFFERENT `Line` objects that are consecutive in a selection's own assembled sequence --
    a gap sitting between two SPANS of the SAME line (the live-traced real shape: "...angle
    (39.31" and ") and solar..." are two spans of ONE PyMuPDF line once the surrounding text
    is close enough together not to force a separate line) was never checked against
    anything at all.

    Two independent shapes are checked, both reusing the exact SuspiciousGap list
    `_detect_suspicious_gaps` already computed (never a second gap-detection pass):

    (a) EMPTY-INTERVAL shape: an ordinary gap sitting strictly BETWEEN two adjacent spans'
    own bboxes, with no span at all inside it (the shape `_gap_between_lines` already
    handles, here applied at span- rather than line-granularity).

    (b) PLACEHOLDER-SPAN shape (the live-traced real one): PyMuPDF's own dict-mode text
    extraction sometimes synthesizes a SEPARATE SPAN for an unrecognized glyph's own
    geometric region, containing nothing but a single space character, its bbox exactly
    matching one of `_detect_suspicious_gaps`'s own detected gaps -- not an empty interval
    between two spans, but a real (whitespace-only) span coinciding with one. The flanking
    NON-whitespace spans immediately before/after it are the genuine anchors."""
    spans_sorted = sorted(line.spans, key=lambda s: s.bbox[0])
    candidates: list[tuple[Span, Span, SuspiciousGap]] = []
    seen_gap_ids: set[int] = set()

    def _gap_key(gap: SuspiciousGap) -> int:
        return id(gap)

    # Shape (a): empty interval between two adjacent spans.
    for a, b in zip(spans_sorted, spans_sorted[1:]):
        for gap in page_blocks.suspiciousGaps:
            gx0, gy0, gx1, gy1 = gap.bbox
            y_ok = (a.bbox[1] <= gy1 and gy0 <= a.bbox[3]) and (b.bbox[1] <= gy1 and gy0 <= b.bbox[3])
            if not y_ok:
                continue
            if abs(a.bbox[2] - gx0) <= _LINE_GAP_X_TOL and abs(b.bbox[0] - gx1) <= _LINE_GAP_X_TOL:
                candidates.append((a, b, gap))
                seen_gap_ids.add(_gap_key(gap))
                break

    # Shape (b): a whitespace-only span whose own bbox coincides with a detected gap.
    for idx, mid in enumerate(spans_sorted):
        if mid.text.strip() or idx == 0 or idx == len(spans_sorted) - 1:
            continue
        prev_span, next_span = spans_sorted[idx - 1], spans_sorted[idx + 1]
        for gap in page_blocks.suspiciousGaps:
            if _gap_key(gap) in seen_gap_ids:
                continue
            gx0, gy0, gx1, gy1 = gap.bbox
            y_ok = mid.bbox[1] <= gy1 and gy0 <= mid.bbox[3]
            x_ok = abs(mid.bbox[0] - gx0) <= _LINE_GAP_X_TOL and abs(mid.bbox[2] - gx1) <= _LINE_GAP_X_TOL
            if y_ok and x_ok:
                candidates.append((prev_span, next_span, gap))
                seen_gap_ids.add(_gap_key(gap))
                break

    # Shape (b2) -- Prototype 2.6G2.8S1.2 TRACK B: the SAME placeholder-span shape as (b),
    # but no page-wide `SuspiciousGap` survived the em-multiplier width gate for a narrow
    # scientific glyph (root cause D -- the real second degree symbol's own placeholder span
    # is exactly this shape at ~4.8pt, under the ~5.98pt threshold). Probes the placeholder
    # span's OWN bbox directly -- shape (c) below only ever looks at the interval BETWEEN two
    # adjacent non-empty spans, which is zero-width here since the placeholder span already
    # fills it edge-to-edge.
    already_placeholder_paired = {(prev.bbox, nxt.bbox) for prev, nxt, _ in candidates}
    for idx, mid in enumerate(spans_sorted):
        if mid.text.strip() or idx == 0 or idx == len(spans_sorted) - 1:
            continue
        prev_span, next_span = spans_sorted[idx - 1], spans_sorted[idx + 1]
        if (prev_span.bbox, next_span.bbox) in already_placeholder_paired:
            continue
        probed = _probe_micro_gap_ink(doc, page_number, page_blocks, prev_span.bbox, next_span.bbox, _line_font_size(line))
        if probed is not None:
            candidates.append((prev_span, next_span, probed))
            already_placeholder_paired.add((prev_span.bbox, next_span.bbox))

    # Shape (c) -- Prototype 2.6G2.8S1.2 TRACK B: no page-wide `SuspiciousGap` survived the
    # em-multiplier width gate (root cause D), but a genuinely ink-positive micro-interval
    # still exists between two adjacent spans. Priority: an existing page-wide match (shapes
    # a/b above) always wins first (section 10 -- never a duplicate probe when one already
    # succeeded); this only ever fires for a pair with NO match in either shape.
    already_paired = {(a.bbox, b.bbox) for a, b, _ in candidates}
    for a, b in zip(spans_sorted, spans_sorted[1:]):
        if (a.bbox, b.bbox) in already_paired:
            continue
        probed = _probe_micro_gap_ink(doc, page_number, page_blocks, a.bbox, b.bbox, _line_font_size(line))
        if probed is not None:
            candidates.append((a, b, probed))

    return candidates


def _recover_interior_line_gaps(doc: "pymupdf.Document", page_number: int, page_blocks: PageBlocks, line: Line, text: str) -> str:
    """Prototype 2.6G2.8S1.1 -- for each genuinely ink-positive same-line span gap (see
    `_find_span_gap_candidates`), reuses the EXACT same OCR-recovery mechanism the D2
    inter-line/trailing-gap pipeline already uses (`_attempt_gap_recovery`/
    `_recover_gap_text`/`RecoveredFragment`) -- never a separate OCR architecture -- by
    wrapping each of the two flanking spans in a minimal pseudo-`Line` (same `.text`/`.bbox`
    contract `_attempt_gap_recovery` already reads). `text` (not `line.text`) is the value
    actually being spliced, matching the caller's own boundary-substitution -- a gap whose
    flanking span text is no longer findable in `text` (fully clipped out of the selection by
    a boundary) is silently skipped, never recovered from outside the user's own selection.

    Splice position: `_reconstruct_line_span_texts` (D1) may have already converted the exact
    same missing-glyph gap into a bare inserted SPACE (proven word-gap geometry, no character
    evidence to insert one) -- if `text` has a single space immediately at the splice point,
    it is CONSUMED (not left behind alongside the recovered glyph), matching hard gate
    SAME_LINE_FALSE_SPACE_INSERTION -- never `"39.31 °"`, always `"39.31°"` unless the OCR
    evidence itself showed a genuine separator (`RecoveredFragment.leading_separator`/
    `.trailing_separator`, honored below, never a universal prepend-space rule)."""
    for a, b, gap in _find_span_gap_candidates(doc, page_number, page_blocks, line):
        idx = text.find(a.text)
        if idx == -1:
            continue
        insert_at = idx + len(a.text)
        if text.find(b.text, insert_at) == -1:
            continue
        ink_ratio = _render_gap_ink_ratio(doc, page_number, gap.bbox, page_blocks.width, page_blocks.height)
        if ink_ratio <= VISUAL_INK_CENTRAL_RATIO_THRESHOLD:
            _trace("GAP_INK", scope="same_line", gapBbox=gap.bbox, visualInkRatio=ink_ratio, outcome="no_ink_dropped")
            continue  # ordinary whitespace -- never OCR'd (SAME_LINE_FALSE_RECOVERY = 0)
        _trace("GAP_INK", scope="same_line", gapBbox=gap.bbox, visualInkRatio=ink_ratio, outcome="ink_positive_candidate")
        pseudo_a = Line(text=a.text, bbox=a.bbox, spans=[a])
        pseudo_b = Line(text=b.text, bbox=b.bbox, spans=[b])
        fragment = _attempt_gap_recovery(doc, page_number, page_blocks.width, page_blocks.height, pseudo_a, pseudo_b)
        if fragment is None:
            raise HTTPException(
                status_code=422,
                detail={"error": "missing_glyph_unresolved", "message": "a visually-present but text-unextractable glyph could not be confidently recovered"},
            )
        remainder = text[insert_at:]
        consumed_placeholder = 1 if remainder.startswith(" ") else 0
        spliced = fragment.leading_separator + fragment.text + fragment.trailing_separator
        text = text[:insert_at] + spliced + remainder[consumed_placeholder:]
    return text


def _clip_forward_boundary_overreach(boundary_text: str, subsequent_lines: list[Line]) -> str:
    """Prototype 2.6G2.8D1 -- server-side defense in depth (item 5/8): even though the client
    (PdfViewer.tsx's `extractWithinLine`) now scopes its own boundary text geometrically, this
    service must not blindly trust that a client-supplied boundary string never overreaches
    into a SUBSEQUENT trusted line's own content -- the traced live bug (2.8C) was exactly a
    client boundary text ("In the case of lower values, the denominator is increased and")
    that already contained the ENTIRE next trusted line ("values, the denominator is increased
    and") glued onto the click line, which then got emitted a SECOND time as that next line's
    own normal contribution.

    This is ownership CLIPPING by trusted-line identity, in strict source order -- never
    arbitrary output-string deduplication (item 1/10/11): `subsequent_lines` (already in
    reading order, starting immediately after the boundary line) form a set of CONSECUTIVE
    candidate runs -- all of them, then all but the last, and so on down to just the first --
    and the LONGEST run whose joined text is an exact trailing match of `boundary_text` is
    clipped away in one step (this correctly handles an overreach spanning more than one
    subsequent line, never just the immediately-next one, while still only ever considering a
    CONSECUTIVE prefix of `subsequent_lines` starting at the boundary line -- never skipping
    ahead to a later line, never matching a non-contiguous run). A genuinely repeated phrase
    that is not an exact trailing match to any such consecutive run (e.g. "The value was
    measured" followed by "The value was measured again" -- item 11's own required negative)
    is left completely untouched, because no run's joined text is ever a trailing match there.

    Uses plain, exact (not ligature/whitespace-normalized) matching only -- normalizing for
    comparison would require re-deriving the matched length in the ORIGINAL string, which is
    not always safe when normalization changes string length (e.g. a ligature codepoint
    collapsing to two ASCII characters); the traced bug and its regression fixture are both
    exact-text overreaches, so the simpler, safer rule is preferred and a normalization-
    requiring overreach (rare) is left unclipped rather than risk a wrong clip.
    """
    stripped = boundary_text.rstrip()
    for run_length in range(len(subsequent_lines), 0, -1):
        candidates = [subsequent_lines[i].text.strip() for i in range(run_length)]
        if any(not c for c in candidates):
            continue
        joined = " ".join(candidates)
        if stripped.endswith(joined):
            return stripped[: len(stripped) - len(joined)].rstrip()
    return boundary_text


def _clip_backward_boundary_overreach(boundary_text: str, preceding_lines: list[Line]) -> str:
    """Mirror image of `_clip_forward_boundary_overreach` for the 'backward' direction (the
    selection's END boundary, which owns text from the start of its own line up to the click):
    checks CONSECUTIVE runs of `preceding_lines` (already in reverse reading order, starting
    immediately before the boundary line) against the accumulated text's own LEADING region
    instead of its trailing one, trimming the longest matching run from the front. Same exact-
    match-only, strict-order, longest-consecutive-run discipline."""
    stripped = boundary_text.lstrip()
    for run_length in range(len(preceding_lines), 0, -1):
        candidates = [preceding_lines[i].text.strip() for i in range(run_length)]
        if any(not c for c in candidates):
            continue
        # preceding_lines[0] is the line immediately before the boundary line, i.e. the one
        # closest to the boundary text's own leading edge -- so the run must be joined in
        # REVERSE of `preceding_lines`' own order to read correctly left-to-right.
        joined = " ".join(reversed(candidates))
        if stripped.startswith(joined):
            return stripped[len(joined):].lstrip()
    return boundary_text


def _line_texts_with_boundary(lines: list[Line], boundary_text: str, direction: str) -> list[str]:
    """The click may land mid-line, so the click line itself must contribute only
    `boundary_text` (click-to-end-of-line, or start-of-line-to-click) -- never its own full
    `line.text`, which could include content before/after the click that isn't part of the
    selection. `lines` is `_block_boundary_lines`'s own output: the click line is first for
    'forward', last for 'backward'.

    Prototype 2.6G2.8D1: `boundary_text` passed in here is expected to have ALREADY been
    clipped by the caller (`_clip_forward_boundary_overreach`/`_clip_backward_boundary_
    overreach`) against the FULL reading-order line sequence for this fragment -- which, for
    a same-page cross-BLOCK selection, spans more than just this one block's own `lines` (see
    `_layout_selection_impl`'s own call site, which clips against `combined_lines` before
    calling this function). This function itself only knows about one block's lines, so it
    cannot safely re-derive that broader context -- it stays a plain substitution."""
    texts = [l.text for l in lines]
    if not texts:
        return texts
    if direction == "forward":
        texts[0] = _prefer_trusted_line_text_for_boundary(boundary_text, lines[0])
    else:
        texts[-1] = _prefer_trusted_line_text_for_boundary(boundary_text, lines[-1])
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


def _try_trailing_gap_recovery(doc: "pymupdf.Document", page_number: int, page_blocks: PageBlocks, line: Line, text: str, wrap_next_line: Optional[Line] = None) -> str:
    """Prototype 2.6G2.8D2 (TYPE C trailing/edge gap), factored out unchanged and generalized
    in Prototype 2.6G2.8S1.3 to run for ANY line reached by the assembly, not only the true
    final line of the whole selection. Live-traced real defect (the "at 2[°] intervals,"
    shape): the missing glyph sits at a genuine LINE-WRAP boundary interior to the selection
    -- `line`'s own same-row trailing sibling is NOT `lines[i + 1]` in the assembled sequence
    at all (that next entry is the FOLLOWING VISUAL ROW, on a completely different Y), so
    neither the ordinary inter-line loop nor the same-line micro-gap fallback (both of which
    only ever compare `line` against the sequence's own declared "next" line) can find it. The
    original `check_trailing_gap`-only version of this logic only ever ran once, for
    `lines[-1]`; this same, otherwise-unmodified mechanism is now reusable for every interior
    line too. Same non-blocking abstain semantics as the original: the adjacent line sits
    OUTSIDE the user's own selected line sequence, so failing to recover it must never fail
    the whole request -- it silently leaves `text` unchanged instead.

    `wrap_next_line`: a SECOND live-traced shape, one level narrower than the block-sibling
    case above -- the missing glyph sits at `line`'s own row's own RIGHT MARGIN, with no
    further block on that row at all (the row has too little remaining width for the next
    WORD to also fit, so it wraps -- the classic word-wrap point, just with the wrapped
    glyph itself unowned). `_find_trailing_adjacent_line` finds nothing here by construction
    (there is no candidate block to find). When the caller supplies the TRUE next line in
    reading order (which visually sits on the FOLLOWING row, geometrically unrelated to
    `line`'s own row), a small synthetic probe immediately past `line`'s own trailing edge
    is ink-checked instead of a discovered block's own geometry, and that same next-line
    text is used as `_attempt_gap_recovery`'s own right anchor -- OCR crops the union of the
    two lines' bboxes regardless of row difference, exactly as the ordinary D2 trailing case
    already does when the two lines it bridges are NOT visually adjacent either."""
    trailing_adjacent = _find_trailing_adjacent_line(page_blocks, line)
    is_wrap_fallback = False
    if trailing_adjacent is not None:
        gap_width_pt = (trailing_adjacent.bbox[0] - line.bbox[2]) * page_blocks.width
        if gap_width_pt <= SUSPICIOUS_GAP_MIN_PT:
            return text
        trailing_gap_bbox = (line.bbox[2], min(line.bbox[1], trailing_adjacent.bbox[1]), trailing_adjacent.bbox[0], max(line.bbox[3], trailing_adjacent.bbox[3]))
    elif wrap_next_line is not None:
        # Prototype 2.6G2.8S1.3a -- there is no real right-anchor block to bound this probe
        # against (that is precisely why this is a synthetic guess at all), so a SINGLE fixed
        # width risks either missing a narrow glyph (too tight) or diluting a real one below
        # threshold with surrounding blank margin (too wide -- the live-traced actual defect:
        # a 1.5em probe measured 0.0238 ink, under the 0.05 gate, on a genuinely ink-positive
        # degree symbol). Adaptive instead of a second guessed magic number: try increasingly
        # wide probes, narrowest first, and use the FIRST one that clears the ink threshold --
        # a real, isolated trailing glyph is concentrated near `line`'s own edge, so the
        # narrowest width that already contains it gives the least-diluted, most reliable
        # ratio; still hard-capped at `MICRO_GAP_MAX_WIDTH_EM` (the same "never wider than an
        # ordinary character" bound the same-line/inter-line probes already enforce).
        font_size = max(_line_font_size(line), 1.0)
        trailing_gap_bbox = None
        trailing_ink_ratio = 0.0
        for probe_em in WRAP_TRAILING_PROBE_WIDTHS_EM:
            probe_width_norm = (probe_em * font_size) / page_blocks.width
            candidate_bbox = (line.bbox[2], line.bbox[1], min(line.bbox[2] + probe_width_norm, 1.0), line.bbox[3])
            candidate_ratio = _render_gap_ink_ratio(doc, page_number, candidate_bbox, page_blocks.width, page_blocks.height)
            _trace("S1_3A_WRAP_PROBE", probeEm=probe_em, gapBbox=candidate_bbox, visualInkRatio=candidate_ratio)
            if candidate_ratio > VISUAL_INK_CENTRAL_RATIO_THRESHOLD:
                trailing_gap_bbox = candidate_bbox
                trailing_ink_ratio = candidate_ratio
                break
        if trailing_gap_bbox is None:
            trailing_gap_bbox = (line.bbox[2], line.bbox[1], min(line.bbox[2] + (WRAP_TRAILING_PROBE_WIDTHS_EM[-1] * font_size) / page_blocks.width, 1.0), line.bbox[3])
        trailing_adjacent = wrap_next_line
        is_wrap_fallback = True
    else:
        return text
    if not is_wrap_fallback:
        trailing_ink_ratio = _render_gap_ink_ratio(doc, page_number, trailing_gap_bbox, page_blocks.width, page_blocks.height)
    if trailing_ink_ratio <= VISUAL_INK_CENTRAL_RATIO_THRESHOLD:
        _trace("GAP_INK", i="trailing", gapBbox=trailing_gap_bbox, visualInkRatio=trailing_ink_ratio, outcome="no_ink_dropped")
        return text
    _trace("GAP_INK", i="trailing", gapBbox=trailing_gap_bbox, visualInkRatio=trailing_ink_ratio, outcome="ink_positive_candidate")
    # is_wrap_fallback: `line`/`trailing_adjacent` are on DIFFERENT rows -- `trailing_adjacent`
    # (the next row) always has a SMALLER x0 (back at the left margin) despite coming SECOND
    # in reading order, so the default x-position sort would silently swap the anchors.
    trailing_recovered = _attempt_gap_recovery(
        doc,
        page_number,
        page_blocks.width,
        page_blocks.height,
        line,
        trailing_adjacent,
        reading_order=is_wrap_fallback,
        extra_crop_bbox=trailing_gap_bbox if is_wrap_fallback else None,
    )
    if trailing_recovered is None:
        _trace("ASSEMBLE_TRAILING_GAP", recovered=None, adjacentLineText=trailing_adjacent.text, outcome="abstained_unresolved")
        return text
    trusted_prefix = line.text
    if text.startswith(trusted_prefix):
        insert_at = len(trusted_prefix)
        remainder = text[insert_at:]
        if remainder[:1].isspace():
            remainder = remainder[1:]
        result = trusted_prefix + trailing_recovered.leading_separator + trailing_recovered.text + remainder
    else:
        result = text + trailing_recovered.leading_separator + trailing_recovered.text
    _trace("ASSEMBLE_TRAILING_GAP", recovered=trailing_recovered, adjacentLineText=trailing_adjacent.text, textAfter=result)
    return result


def _assemble_lines_with_gap_recovery(
    doc: "pymupdf.Document", page_number: int, page_blocks: PageBlocks, lines: list[Line], line_texts: list[str], check_trailing_gap: bool = False, check_leading_gap: bool = False
) -> str:
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
        # Prototype 2.6G2.8S1.1 -- same-line interior gap recovery, checked for EVERY line
        # actually reached by this assembly (not just the two ordinary-loop endpoints below,
        # which only ever compare ADJACENT LINES against each other -- a gap living entirely
        # inside one line's own span sequence needs its own, independent check here).
        text = _recover_interior_line_gaps(doc, page_number, page_blocks, lines[i], text)
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
        if os.environ.get("PGT_S1_1A_DEBUG") == "1":
            _trace(
                "S1_1A_LINE_SPANS",
                i=i,
                lineBbox=lines[i].bbox,
                lineText=lines[i].text,
                spans=[{"bbox": s.bbox, "text": s.text, "font": s.font, "size": s.size} for s in lines[i].spans],
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
            # Prototype 2.6G2.8S1.2 TRACK B -- the real second degree-symbol gap is this
            # exact shape: TWO SEPARATE `Line` objects, genuinely adjacent on the same visual
            # row, whose own micro-gap never survived `_detect_suspicious_gaps`'s em-width
            # gate (root cause D). Same local-ink-probe fallback as the same-line span case,
            # applied here for cross-Line same-row adjacency instead.
            gap = _probe_micro_gap_ink(doc, page_number, page_blocks, lines[i].bbox, lines[i + 1].bbox, max(_line_font_size(lines[i]), _line_font_size(lines[i + 1])))
        if os.environ.get("PGT_S1_1A_DEBUG") == "1":
            nearby = [
                g.bbox
                for g in page_blocks.suspiciousGaps
                if (lines[i].bbox[1] <= g.bbox[3] and g.bbox[1] <= lines[i].bbox[3])
                or (lines[i + 1].bbox[1] <= g.bbox[3] and g.bbox[1] <= lines[i + 1].bbox[3])
            ]
            _trace(
                "S1_1A_GAP_CHECK",
                i=i,
                lineIBbox=lines[i].bbox,
                lineI1Bbox=lines[i + 1].bbox,
                matchedGap=gap.bbox if gap else None,
                nearbySuspiciousGaps=nearby,
            )
        if gap is None:
            # Prototype 2.6G2.8S1.3 -- root cause "interior line-wrap trailing gap": neither
            # the ordinary inter-line check nor the same-row micro-gap fallback above found
            # anything between `lines[i]` and `lines[i + 1]` -- meaning, if `lines[i]` has its
            # OWN same-row trailing sibling at all, it is NOT `lines[i + 1]` (which therefore
            # sits on a genuinely different row: the natural line-wrap continuation). The real
            # "at 2[°] intervals," case is exactly this shape: "2" ends its own row's own last
            # included block, the wrap continues on the NEXT VISUAL ROW ("intervals,..."),
            # and the missing glyph sits in the gap between "2" and whatever ELSE shares its
            # own row (never `lines[i + 1]`). Reuses `_try_trailing_gap_recovery` (the SAME
            # mechanism previously only applied to the whole sequence's own final line) for
            # every interior line too -- if `lines[i]` has no same-row trailing sibling at all
            # (the overwhelmingly common case, ordinary paragraph text), this is a no-op.
            if parts:
                parts[-1] = _try_trailing_gap_recovery(doc, page_number, page_blocks, lines[i], parts[-1], wrap_next_line=lines[i + 1])
            if LAYOUT_TRACE_ENABLED:
                _trace("ASSEMBLE_ITER_END", i=i, nextTrustedLineText=lines[i + 1].text, partsAfter=list(parts), gapCandidate=False)
            continue
        ink_ratio = _render_gap_ink_ratio(doc, page_number, gap.bbox, page_blocks.width, page_blocks.height)
        if ink_ratio <= VISUAL_INK_CENTRAL_RATIO_THRESHOLD:
            _trace("GAP_INK", i=i, gapBbox=gap.bbox, visualInkRatio=ink_ratio, outcome="no_ink_dropped")
            continue  # ordinary whitespace/gutter -- ignore entirely, no warning, no OCR (item 19)
        _trace("GAP_INK", i=i, gapBbox=gap.bbox, visualInkRatio=ink_ratio, outcome="ink_positive_candidate")
        recovered_fragment = _attempt_gap_recovery(doc, page_number, page_blocks.width, page_blocks.height, lines[i], lines[i + 1])
        if recovered_fragment is None:
            raise HTTPException(
                status_code=422,
                detail={"error": "missing_glyph_unresolved", "message": "a visually-present but text-unextractable glyph could not be confidently recovered"},
            )
        # Prototype 2.6G2.8S1.3 -- this ordinary inter-line/inter-span gap loop now DOES use
        # the fragment's own separator evidence (previously bare-content-only, "audited and
        # deliberately left alone" -- but that left every recovered glyph reached THIS path,
        # rather than the same-line splice path, with a stray preceding space after the
        # frontend's own "\n" -> " " normalization: real "0[gap]and 46" -- three genuinely
        # separate LINES/blocks, so this IS the path they take -- rendered "0 °" instead of
        # "0°" for exactly this reason). Same principle M1.2a already established for the
        # trailing-gap case: `leading_separator`/`trailing_separator` are read directly off
        # the OCR evidence, never inferred from content -- "of" + " cos i" still gets its
        # genuine space (separator is a real " " there), only a PROVEN-touching glyph like a
        # degree symbol collapses tight.
        recovered = recovered_fragment.text
        next_text = line_texts[i + 1]
        is_parenthesized = lines[i].text.rstrip().endswith(PARENTHESIZED_GAP_OPEN) and lines[i + 1].text.lstrip().startswith(PARENTHESIZED_GAP_CLOSE)
        if not is_parenthesized:
            if recovered_fragment.leading_separator == "" and parts:
                parts[-1] += recovered
            else:
                parts.append(recovered)
            if recovered_fragment.trailing_separator == "":
                pending_tight_merge = True
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
    # Prototype 2.6G2.8D2 -- TYPE C (trailing/edge) gap: see _find_trailing_adjacent_line's
    # own doc comment. The candidate gap's own bbox is built DIRECTLY from the two trusted
    # lines' own geometry, in the SAME shape `_detect_suspicious_gaps` computes internally
    # (`(leftLine.x1, min(y0s), rightLine.x0, max(y1s))`) -- never from that function's own
    # PRE-COMPUTED, PAGE-WIDE `suspiciousGaps` list (`_gap_between_lines`'s own lookup): that
    # list groups spans into visual ROWS by y-CENTER proximity across the WHOLE PAGE, and a
    # live real-PDF trace proved this inter-BLOCK pair can land in two slightly different rows
    # by that grouping even though their own line bboxes plainly overlap in Y -- silently
    # missing a genuine candidate. Computing the gap directly from the two ALREADY-CONFIRMED-
    # ADJACENT lines sidesteps that row-grouping fragility entirely. Reuses the SAME
    # suspicious-width threshold constants `_detect_suspicious_gaps` uses (never a new/looser
    # rule) and the exact same ink-check + anchor-bounded OCR recovery as every inter-line gap
    # above (`_render_gap_ink_ratio`, `_attempt_gap_recovery` -- neither modified for this).
    #
    # Deliberately does NOT raise `missing_glyph_unresolved` on an unrecoverable ink-positive
    # trailing candidate the way the inter-line loop does: the adjacent line here sits OUTSIDE
    # the user's own selected line sequence (often the start of a different, unselected
    # sentence), so failing to recover it should not block the user's entire selection -- it
    # abstains instead (item 14), leaving the trailing text exactly as the client's own
    # boundary already had it.
    #
    # `check_trailing_gap` is only True when `lines` represents the TRUE final segment of the
    # whole user selection (the same_block branch; the same-page cross-block branch's
    # `combined_lines`; the cross-page branch's `last_lines` only, never `first_lines`) --
    # otherwise `lines[-1]` is merely where THIS page/segment's own contribution happens to
    # stop before the selection continues elsewhere, and treating whatever native text
    # follows it as a "trailing gap" candidate would be wrong.
    if check_trailing_gap and lines and parts:
        parts[-1] = _try_trailing_gap_recovery(doc, page_number, page_blocks, lines[-1], parts[-1])

    # Prototype 2.6G2.8S1.2 TRACK A -- symmetric LEADING-side counterpart of the trailing
    # block above (root cause A: REAL_LINE_HAS_NO_SPAN_CANDIDATE). Live-traced real defect:
    # the resolved start line (") and solar") begins partway across its own visual row; the
    # preceding content on that SAME row ("...zenith angle (39.31") lives in a sibling block
    # this selection's own `lines[]` never includes at all -- the missing degree symbol sits
    # in the gap between that sibling's own trailing edge and `lines[0]`'s own leading edge.
    #
    # Boundary safety (never expand the user's own selection leftward): the client's own
    # boundary text for the start position (`parts[0]`) is trusted AS-IS -- this only ever
    # SPLICES a recovered glyph INTO a position already proven to exist inside that string
    # (`parts[0].endswith(trusted_suffix)`, mirroring the trailing block's own `startswith`
    # check). A leading sibling whose content the user never selected (a different column, a
    # footnote, a neighboring paragraph -- section 6's own negative controls) can never cause
    # `parts[0]` to grow, because nothing is ever PREPENDED, only spliced inside an existing
    # match.
    if check_leading_gap and lines and parts:
        leading_adjacent = _find_leading_adjacent_line(page_blocks, lines[0])
        if leading_adjacent is not None:
            gap_width_pt = (lines[0].bbox[0] - leading_adjacent.bbox[2]) * page_blocks.width
            # Same absolute-floor pre-filter as the trailing block (never the em-multiplier
            # ratio -- calibrated for ordinary word gaps, proven too coarse for a narrow
            # scientific glyph); the mandatory ink-ratio check below is the real gate.
            is_suspicious = gap_width_pt > SUSPICIOUS_GAP_MIN_PT
            if is_suspicious:
                leading_gap_bbox = (
                    leading_adjacent.bbox[2],
                    min(lines[0].bbox[1], leading_adjacent.bbox[1]),
                    lines[0].bbox[0],
                    max(lines[0].bbox[3], leading_adjacent.bbox[3]),
                )
                leading_ink_ratio = _render_gap_ink_ratio(doc, page_number, leading_gap_bbox, page_blocks.width, page_blocks.height)
                if leading_ink_ratio > VISUAL_INK_CENTRAL_RATIO_THRESHOLD:
                    _trace("GAP_INK", i="leading", gapBbox=leading_gap_bbox, visualInkRatio=leading_ink_ratio, outcome="ink_positive_candidate")
                    leading_recovered = _attempt_gap_recovery(doc, page_number, page_blocks.width, page_blocks.height, leading_adjacent, lines[0])
                    if leading_recovered is not None:
                        # Boundary safety (section 4): SPLICE ONLY -- never prepend. If the
                        # client's own boundary text does not already end with this line's
                        # trusted suffix (i.e. it never actually reached back far enough to
                        # include the sibling's own selected content in the first place, or
                        # the sibling is genuinely unrelated -- a different column, a
                        # footnote, a neighboring paragraph), abstain entirely rather than
                        # growing `parts[0]` leftward with content the user may never have
                        # selected. This is intentionally STRICTER than the trailing block's
                        # own fallback-append (appending extra TRAILING content is low-risk;
                        # prepending unselected LEADING content is exactly what section 4
                        # forbids).
                        trusted_suffix = lines[0].text
                        if parts[0].endswith(trusted_suffix):
                            insert_at = len(parts[0]) - len(trusted_suffix)
                            prefix = parts[0][:insert_at]
                            if prefix[-1:].isspace():
                                prefix = prefix[:-1]
                            parts[0] = prefix + leading_recovered.text + leading_recovered.trailing_separator + trusted_suffix
                            _trace("ASSEMBLE_LEADING_GAP", recovered=leading_recovered, adjacentLineText=leading_adjacent.text, partsAfter=list(parts))
                        else:
                            _trace("ASSEMBLE_LEADING_GAP", recovered=leading_recovered, adjacentLineText=leading_adjacent.text, outcome="abstained_boundary_suffix_mismatch")
                    else:
                        _trace("ASSEMBLE_LEADING_GAP", recovered=None, adjacentLineText=leading_adjacent.text, outcome="abstained_unresolved")
                else:
                    _trace("GAP_INK", i="leading", gapBbox=leading_gap_bbox, visualInkRatio=leading_ink_ratio, outcome="no_ink_dropped")

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

# Prototype 2.6G2.8M1.2 -- live-traced real defect: native PyMuPDF text uses a typographic
# apostrophe ("object's", U+2019) while Paddle OCR's own output uses a plain ASCII apostrophe
# ("object's", U+0027) for the SAME word -- NFKC does not canonicalize these (they are not
# compatibility-equivalent), so an otherwise-correct, high-confidence OCR recovery
# ("cos i", 0.9975 confidence) was silently discarded by `_recover_gap_text`'s anchor search.
# Comparison-only (see `_normalize_for_match`'s own contract): never applied to
# reconstructedText, native trusted text, or any OCR text actually stored for diagnostics --
# only to the throwaway comparison copies used to locate an anchor. Single/double quote
# classes are kept SEPARATE (never collapsed together) so an apostrophe can never anchor-match
# a double-quote character or vice versa. U+02BC (MODIFIER LETTER APOSTROPHE) is not included
# here -- no real case has justified it yet (see module-level scope discipline: only add an
# equivalence a real, traced case actually proves necessary).
_SINGLE_QUOTE_VARIANTS = '‘’'''  # LEFT/RIGHT SINGLE QUOTATION MARK, APOSTROPHE
_DOUBLE_QUOTE_VARIANTS = '“”"'  # LEFT/RIGHT DOUBLE QUOTATION MARK, QUOTATION MARK
_QUOTE_MATCH_TRANSLATION = str.maketrans(
    {**{c: "'" for c in _SINGLE_QUOTE_VARIANTS}, **{c: '"' for c in _DOUBLE_QUOTE_VARIANTS}}
)


def _normalize_for_match(text: str) -> str:
    """Comparison-only normalization (ligatures + typographic-quote folding + NFKC +
    whitespace collapse) -- never applied to text actually returned to the caller."""
    for lig, plain in _LIGATURES.items():
        text = text.replace(lig, plain)
    text = text.translate(_QUOTE_MATCH_TRANSLATION)
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


def _find_intermediate_prose_blocks(doc: "pymupdf.Document", page_number: int, page_blocks: PageBlocks, first_block: Block, last_block: Block) -> list[Block]:
    """Prototype 2.6G2.8S1 -- root cause D (INTERIOR_BLOCK_NOT_INCLUDED_IN_SELECTION). The
    ordinary same-page cross-block assembly path only ever collected `first_block`'s own
    lines (from the start anchor onward) and `last_block`'s own lines (up to the end anchor)
    -- ANY block strictly between them in page block-index order was silently dropped, with
    no code path that ever walked it at all. This was invisible for the common two-block
    case (the real "cos i" control: one block ends, the very next block begins, nothing sits
    between them), and was previously ALSO the deliberately correct behavior for a genuine
    cross-column drag (Failure A: a footnote/figure-caption block geometrically between two
    column endpoints must never be pulled in, since it was never part of the reading flow the
    user actually dragged through). The real, live-traced GOMS/Kananaskis regression proved a
    THIRD shape: ordinary single-column body prose that PyMuPDF happens to fragment into 3+
    blocks (a symbol glyph the embedded font doesn't expose as extractable text can force a
    new block boundary exactly the way it already forces a new LINE boundary in the trailing-
    glyph/D2 case) -- here the "middle" block genuinely IS the next sentence in the same
    reading flow and must be recovered, not skipped.

    Distinguishing the two shapes needs no new heuristic: `_blocks_share_corridor` (already
    used for the equation-aware walk) checked against BOTH endpoints INDEPENDENTLY -- never
    the wide union corridor `_equation_corridor_reference` builds, which stays scoped to the
    equation-number search precisely because it tolerates a narrow number block not literally
    overlapping either side -- naturally excludes Failure A's footnote/caption (which shares
    corridor with, at best, ONE of two different-column endpoints, never both) while including
    genuine same-column continuation prose (which by construction shares the same x-range as
    both the block before and the block after it). The vertical-position bound mirrors
    `_find_intermediate_equation_blocks`'s own -- a candidate must sit between the two
    endpoints' own y-extents, never elsewhere on the page.

    Prototype 2.6G2.8S1.3 -- a FOURTH shape, live-traced from a real selection: a single
    visual ROW split HORIZONTALLY into 3+ sibling blocks by consecutive unextractable-glyph
    gaps ("...between 0" / "and 46" / "at 2" -- three separate blocks, one narrow degree-
    symbol-sized gap between each). These siblings have ZERO x-overlap with each other by
    construction (each occupies a disjoint horizontal slice of the same row), so the
    vertical-corridor rule above -- correctly tuned for blocks STACKED underneath each other
    -- can never match them; they were silently dropped exactly like the original root-cause-D
    prose was, one level more granular.

    Chain-walked separately from the vertical rule (never replacing it): starting from
    `first_block`, each subsequent candidate in block-index order is ALSO accepted when it is
    SAME-ROW-ADJACENT to the most recently accepted block in the chain (real Y-overlap,
    positioned to its right). Deliberately NOT gated by a geometric width threshold alone --
    this document's own left/right column gutter (~12pt) is narrower than some real missing-
    glyph gaps can legitimately be, so no single width cutoff safely separates "genuine same-
    row continuation" from "the start of a different column that happens to share a Y row by
    coincidence." Reuses the SAME evidence this whole file already trusts for that exact
    distinction: rendered ink. A genuine missing glyph is, by definition, ink-positive (the
    reason the OCR-recovery pipeline exists at all); a genuine column gutter is, by
    definition, blank. `_render_gap_ink_ratio` on the geometric interval between the chain
    tail and the candidate is the deciding gate -- never a width number. This keeps Failure
    A's own cross-column exclusion intact through TWO independent guarantees: those endpoints
    sit on entirely different Y rows to begin with (no chain step ever starts there), and even
    a coincidental same-row column-start candidate would still fail the ink gate (a gutter has
    no ink to find)."""
    first_idx = page_blocks.blocks.index(first_block)
    last_idx = page_blocks.blocks.index(last_block)
    if last_idx <= first_idx + 1:
        return []
    lo_y = min(first_block.bbox[1], last_block.bbox[1])
    hi_y = max(first_block.bbox[3], last_block.bbox[3])
    result: list[Block] = []
    chain_tail = first_block
    for b in page_blocks.blocks[first_idx + 1 : last_idx]:
        vertical_ok = _blocks_share_corridor(b, first_block) and _blocks_share_corridor(b, last_block) and lo_y <= b.bbox[1] <= hi_y
        same_row_ok = False
        if not vertical_ok and b.bbox[1] < chain_tail.bbox[3] and b.bbox[3] > chain_tail.bbox[1] and b.bbox[0] >= chain_tail.bbox[2]:
            probe_bbox = (chain_tail.bbox[2], min(chain_tail.bbox[1], b.bbox[1]), b.bbox[0], max(chain_tail.bbox[3], b.bbox[3]))
            if probe_bbox[2] > probe_bbox[0]:
                ink_ratio = _render_gap_ink_ratio(doc, page_number, probe_bbox, page_blocks.width, page_blocks.height)
                same_row_ok = ink_ratio > VISUAL_INK_CENTRAL_RATIO_THRESHOLD
                _trace("S1_3_SAME_ROW_CHAIN_PROBE", chainTailBlockId=chain_tail.blockId, candidateBlockId=b.blockId, gapBbox=probe_bbox, visualInkRatio=ink_ratio, outcome="chained" if same_row_ok else "no_ink_excluded")
        if vertical_ok or same_row_ok:
            result.append(b)
            chain_tail = b
    return result


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
        startBlockId=before_block.blockId, endBlockId=after_block.blockId, sameBlock=False, reconstructedText=combined, fragments=[_build_fragment(page_number, combined)]
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
            return SelectionResponse(startBlockId=start_block.blockId, endBlockId=end_block.blockId, sameBlock=True, reconstructedText=token, fragments=[_build_fragment(req.start.pageNumber, token)])
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
        # Prototype 2.6G2.8D1: clip each boundary against the OTHER selected_lines before
        # substituting -- a client boundary string can overreach into an interior trusted
        # line's own content exactly as it did in the traced cross-block bug (see
        # `_clip_forward_boundary_overreach`'s own doc comment); same-block selections have
        # the identical foot-gun shape and are defended the same way.
        # Prototype 2.6G2.8M2.2: after clipping overreach into OTHER lines, also reconcile
        # the boundary line's own remaining content against ITS OWN trusted (D3-corrected)
        # text -- see `_prefer_trusted_line_text_for_boundary`'s own doc comment.
        line_texts[0] = _prefer_trusted_line_text_for_boundary(
            _clip_forward_boundary_overreach(lo_boundary, selected_lines[1:]), selected_lines[0]
        )
        line_texts[-1] = _prefer_trusted_line_text_for_boundary(
            _clip_backward_boundary_overreach(hi_boundary, list(reversed(selected_lines[:-1]))), selected_lines[-1]
        )
        repaired = _assemble_lines_with_gap_recovery(doc_state.doc, req.start.pageNumber, start_page, selected_lines, line_texts, check_trailing_gap=True, check_leading_gap=True)
        return SelectionResponse(
            startBlockId=start_block.blockId, endBlockId=end_block.blockId, sameBlock=True, reconstructedText=repaired, fragments=[_build_fragment(req.start.pageNumber, repaired)]
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

    if first_page == last_page:
        # Same page, different block (e.g. same-page cross-column, or the real Soenen "k"
        # case: two different blocks on the SAME visual row) -- one fragment, no
        # middle-page concept applies. A candidate gap can legitimately sit exactly at the
        # first_lines/last_lines seam (item 26), so they're checked together as one list.
        #
        # Prototype 2.6G2.8D1 root-cause fix: `first_boundary`/`last_boundary` must be
        # clipped against the FULL cross-block `combined_lines` sequence, not just
        # `first_lines`/`last_lines` individually -- the traced live bug's overreaching start
        # boundary swallowed a trusted line that belonged to a DIFFERENT block than
        # `first_block` (it was the first line of `last_lines`, e.g. `first_block` held only
        # "In the case of lower" while the swallowed "values, the denominator is increased
        # and" was `last_block`'s own first line) -- a per-block-scoped clip could never see
        # it. Clipping against the true combined reading-order sequence catches this
        # regardless of which block each trusted line happens to belong to.
        # Prototype 2.6G2.8S1 root-cause fix (D. INTERIOR_BLOCK_NOT_INCLUDED_IN_SELECTION):
        # any block strictly between `first_block` and `last_block` that shares the same
        # reading-flow corridor as BOTH of them (see `_find_intermediate_prose_blocks`'s own
        # doc comment) contributes its own full, trusted lines here -- previously nothing
        # between `first_lines`/`last_lines` was ever collected at all, silently dropping
        # every genuinely intervening sentence/paragraph whenever ordinary same-column prose
        # happened to land in 3+ PyMuPDF blocks between the two selection endpoints.
        intermediate_lines: list[Line] = [line for block in _find_intermediate_prose_blocks(doc_state.doc, first_page, first_page_blocks, first_block, last_block) for line in block.lines]
        if os.environ.get("PGT_S1_1A_DEBUG") == "1":
            row_blocks = [
                {"blockId": b.blockId, "bbox": b.bbox, "lines": [{"bbox": l.bbox, "text": l.text} for l in b.lines]}
                for b in first_page_blocks.blocks
                if b.bbox[1] < first_block.bbox[3] and b.bbox[3] > first_block.bbox[1]
            ]
            _trace(
                "S1_1A_FIRST_BLOCK_FULL",
                blockId=first_block.blockId,
                blockBbox=first_block.bbox,
                allLines=[{"bbox": l.bbox, "text": l.text} for l in first_block.lines],
                firstLineResolved=first_line.bbox,
            )
            _trace("S1_3_SAME_ROW_BLOCKS", firstBlockId=first_block.blockId, rowBlocks=row_blocks)
        combined_lines = first_lines + intermediate_lines + last_lines
        first_boundary = _clip_forward_boundary_overreach(first_boundary, combined_lines[1:])
        last_boundary = _clip_backward_boundary_overreach(last_boundary, list(reversed(combined_lines[:-1])))
        first_line_texts = _line_texts_with_boundary(first_lines, first_boundary, "forward")
        last_line_texts = _line_texts_with_boundary(last_lines, last_boundary, "backward")
        intermediate_line_texts = [line.text for line in intermediate_lines]
        combined_line_texts = first_line_texts + intermediate_line_texts + last_line_texts
        combined = _assemble_lines_with_gap_recovery(doc_state.doc, first_page, first_page_blocks, combined_lines, combined_line_texts, check_trailing_gap=True, check_leading_gap=True)
        fragments = [_build_fragment(first_page, combined)]
    else:
        # Cross-page: a visual row can never span two rendered pages, so a client boundary
        # string cannot overreach across this seam -- first_lines and last_lines are checked
        # independently (each may still have its own internal gap), no cross-block ownership
        # clip needed here.
        first_line_texts = _line_texts_with_boundary(first_lines, first_boundary, "forward")
        last_line_texts = _line_texts_with_boundary(last_lines, last_boundary, "backward")
        first_text = _assemble_lines_with_gap_recovery(doc_state.doc, first_page, first_page_blocks, first_lines, first_line_texts, check_leading_gap=True)
        last_text = _assemble_lines_with_gap_recovery(doc_state.doc, last_page, last_page_blocks, last_lines, last_line_texts, check_trailing_gap=True)
        fragments = [_build_fragment(first_page, first_text)]
        # Item 5 (R1)/45 (R5B), preserved: a page fully spanned by a 3+ page selection
        # contributes its own body-height content, never re-injecting header/footer/
        # footnote-sized blocks just because the page happens to be fully spanned.
        # Missing-glyph recovery is not attempted here -- see _middle_page_text's own note.
        for mid_page in range(first_page + 1, last_page):
            mid_text = _middle_page_text(req.documentId, mid_page)
            if mid_text.strip():
                fragments.append(_build_fragment(mid_page, mid_text))
        fragments.append(_build_fragment(last_page, last_text))
        combined = "\n".join(f.text for f in fragments)

    return SelectionResponse(startBlockId=start_block.blockId, endBlockId=end_block.blockId, sameBlock=False, reconstructedText=combined, fragments=fragments)


if __name__ == "__main__":
    import uvicorn

    # 127.0.0.1 only -- never 0.0.0.0. See README "Local-only / security" section.
    uvicorn.run(app, host="127.0.0.1", port=8009)
