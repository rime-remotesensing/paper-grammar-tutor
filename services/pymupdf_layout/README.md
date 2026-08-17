# PyMuPDF local layout service (Prototype 2.5Q)

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
{ "status": "ok", "engine": "pymupdf", "serviceVersion": "prototype-2.5q" }
```

`serviceVersion` exists specifically so a stale process from an earlier code change can be
told apart from a freshly-restarted one — bump it whenever `main.py`'s selection-
reconstruction logic changes. (A stale process silently serving pre-fix behavior after an
apparently-successful restart was a real issue during Prototype 2.4B-R7's own development;
see `docs/design-notes.md` for that incident.)

### Diagnostic request trace (Prototype 2.5P, dev-only, default OFF, retained)

```powershell
$env:PGT_LAYOUT_TRACE = "1"
venv\Scripts\python main.py
```

Prints `"[PGT-TRACE] ..."` lines (mirroring the frontend's own existing trace convention in
`PdfViewer.tsx`) for every `/layout/selection` request: the exact incoming request, the
resolved start/end blocks, every missing-glyph gap/OCR/assembly decision, and the final
response. Zero behavior change — verified by running the full test suite with the flag on
and off. Added in Prototype 2.5P to capture a real browser request that TWO rounds of
code-reading-based reconstruction (2.5O) had failed to fully reproduce — the literal
capture is what actually found Prototype 2.5Q's root cause (see `docs/design-notes.md`).
**Deliberately kept** (not removed) as a maintained diagnostic facility: default OFF,
clearly dev-only, and it logs only request/response fields and text this service already
extracts/returns — never raw PDF bytes or anything beyond what `/layout/selection` itself
already processes.

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

The real Soenen "k"/"θ" missing-glyph recovery tests (`test_soenen_missing_k_glyph_selection_recovered`, `test_soenen_theta_glyph_selection_recovered`) additionally require the real Paddle OCR service running at `http://127.0.0.1:8008` — they are not mocked, unlike `test_equation_guard.py`'s synthetic-PDF OCR-path tests (which always run, Paddle or not). `tests/test_cross_equation_continuation.py` (Prototype 2.5J, synthetic-PDF/mocked-OCR, always runs) covers the cross-equation continuation routing/corridor logic; the real Soenen equation (6) regression is in `test_fixtures.py`. `tests/test_equation_region_suppression.py` (Prototype 2.5L, always runs — most fixtures use hand-built `PageBlocks` injected directly into the document cache rather than relying on PyMuPDF's own block segmentation of freshly-synthesized text, which proved too fragile to control precisely via coordinates alone) covers both the parenthesized-gap candidacy rule and display-equation region suppression; the real Soenen "(a)"/"(b)"/"(i)" and equation (8)/(9) regressions are in `test_fixtures.py`. The real Soenen COMPOUND case (Prototype 2.5N: "(b)"/"(a)" prose → equation (8) → prose → equation (9) as the selection's own endpoint) is `test_soenen_compound_equation_eight_then_equation_nine_endpoint`/`..._paddle_unavailable_is_safe_failure` in `test_fixtures.py`, with explicit route-assertion regressions (`_resolve_equation_aware_selection` monkeypatched to fail if entered) for Failure A and an ordinary equation-free same-corridor cross-block selection alongside it. `test_soenen_compound_with_literal_captured_browser_request` (Prototype 2.5P/2.5Q) is the SAME compound case but with the LITERAL request captured via the `PGT_LAYOUT_TRACE=1` trace facility (real coordinates, real `boundaryText` including the whitespace-fused paren shape and the "C (9)" end boundary) — never an approximation; this is the authoritative regression for the live-reported failure. `test_equation_region_suppression.py` has two synthetic, mocked-OCR equivalents: `test_parenthesized_glyph_recovered_with_browser_style_fused_boundary_text` (2.5O's own zero-width fused shape, still a valid input variant) and `test_parenthesized_glyph_recovered_with_whitespace_fused_boundary_text` (2.5Q's whitespace-fused shape, the one that actually matches real browser behavior).

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

`sameBlock: true` with `reconstructedText: null` (and `fragments: []`) means the caller
should use the browser's own native selection text — the fast, common case, unaffected by
anything below. **Whenever `reconstructedText` is non-null, use it — regardless of
`sameBlock`.** As of Prototype 2.5E, a same-block selection whose native Range text would
be missing a recovered glyph gets its own repaired `reconstructedText`/`fragments` here
too (see "Missing-glyph recovery" below); `sameBlock` alone is no longer sufficient to
decide the routing.

Can also respond `422` with:
- `{"detail": {"error": "equation_endpoint_unresolved", ...}}` — an endpoint resolved to
  an equation-number-like block with no recoverable nearby prose (see "Equation-number
  endpoint guard" below).
- `{"detail": {"error": "missing_glyph_unresolved", ...}}` — a visually-present but
  text-unextractable glyph inside the selection could not be confidently recovered (see
  "Missing-glyph recovery" below).

Both are explicit, safe failures — the caller should surface a generic message and never
fall back to a different heuristic or silently drop the glyph.

### `POST /layout/page` response — `suspiciousGaps`

Also includes `suspiciousGaps: [{ "bbox": [x0, y0, x1, y1] }]` (normalized 0-1, top-down):
page-space regions between two adjacent spans on the same visual row that are geometric
CANDIDATES for a missing-glyph gap (see below — geometry alone is never sufficient; every
candidate is visually gated before anything acts on it). Diagnostic/internal.

## Equation-number endpoint guard and display-equation placeholder (Prototype 2.5B → 2.5G)

Added after a real live-browser failure (see `docs/design-notes.md`, Prototype 2.5A/B): a
selection ending near a display equation on the Soenen (2005) paper reconstructed as `"The
value of (5)"` — the drag's real endpoint had resolved to the bare equation-number `"(5)"`
text object instead of the intended prose. `_is_equation_number_like_block` in `main.py`:
a block is never accepted as a normal prose endpoint if it has exactly one line whose
ENTIRE text is nothing but `"(N)"` and a small bbox. Deliberately narrow — ordinary prose
like `"(5) shows that..."` always has more text than just the number, or spans multiple
lines, and is never affected. If resolution lands on such a block, one more anchor-based
recovery is tried first (restricted to non-equation-number blocks, and skipped entirely if
`boundaryText` itself is just an equation-number token, since searching for `"(5)"` as a
substring is exactly the kind of short/ambiguous anchor that can match unrelated prose
elsewhere on the page).

**Prototype 2.5G**: if that recovery doesn't find real prose, the endpoint is no longer an
automatic failure — the routing checks whether the selection genuinely crosses from real
prose into this numbered display equation (both endpoints resolved, same page, prose's row
at or before the equation's own row) and, if so, hands off to the unified equation-aware
sequence assembler (see "Equation-aware sequence assembly" below), which builds
`"<prose text>\n[式 (N)]"` — a placeholder using **only** the equation-number block's own
already-reliably-extracted text (no OCR, no equation-body recognition of any kind). If the
selection is the equation-number token alone (both endpoints resolve to the same block),
the placeholder is returned directly with **no prose ever collected/prepended**. If the
context genuinely doesn't support this (e.g. a reverse-direction drag starting at the
equation — not yet supported, see `docs/design-notes.md` for the scope limit — or two
different equation numbers spanned at once), the endpoint still `422`s as
`equation_endpoint_unresolved`, exactly as in 2.5B/E. This is completely independent from
missing-glyph recovery below; an equation number is never treated as an OCR-recoverable
glyph gap, and placeholder creation itself never calls Paddle.

## Equation-aware sequence assembly (Prototype 2.5I → 2.5J → 2.5M → 2.5N)

Prototype 2.5G only ever handled a display equation at a selection's own **endpoint**. A
live-acceptance failure during 2.5H found a different, real case on the same Soenen
paper's equation (6): a selection starting in prose **before** the equation, dragged
**through** it, ending in prose **after** it ("...using the equation" → equation (6) →
"where Ln is the normalized radiance, a and b are the y-intercept..."). Both endpoints
resolve to ordinary prose here (neither is the equation-number block itself), so the
equation-at-end path was never even entered — the selection fell through to the ordinary
cross-block path, which only ever uses the start block's own trailing lines and the end
block's own leading lines. Every block strictly between them — the equation number *and*
several further prose blocks — was silently dropped (see `docs/design-notes.md`, Prototype
2.5I, for the full root-cause trace).

Prototype 2.5J's fix (a narrowly-gated intermediate-equation-continuation branch) and
Prototype 2.5G's own equation-at-end path started out as two **separate, mutually unaware**
algorithms. Live acceptance of 2.5L found the real consequence: a selection whose own END
endpoint IS an equation number (e.g. Soenen's equation (9)) was claimed entirely by the
equation-at-end path, which had zero awareness of any OTHER equation-number block (e.g.
equation (8)) encountered earlier in the SAME selection — leaking its raw formula fragments
and raw equation number straight into the prose, even though each mechanism worked
correctly in isolation (see `docs/design-notes.md`, "Prototype 2.5M", for the full
investigation this was diagnosed from).

Prototype 2.5N replaces both with **one unified equation-aware sequence assembler**
(`_resolve_equation_aware_selection`), reached via a single, narrowly-gated routing branch
— deliberately kept separate from (never merged into) the ordinary cross-block path, so a
genuine cross-column selection (e.g. the real Failure A case) can never enter it just
because block IDs happen to lie between the endpoints:

1. **Entry**: either (a) both endpoints are ordinary prose on the same page sharing a local
   **corridor** (`_blocks_share_corridor` — deliberately *not* a global
   `LEFT_COLUMN`/`RIGHT_COLUMN`/`FULL_WIDTH` classifier, Prototype 2.4B retired those; purely
   local, relative-to-width geometry), or (b) the end endpoint IS a confirmed equation-number
   block and the start endpoint is prose at or before its own row (2.5G's own original,
   unconditional-once-past-the-checks permissiveness, preserved exactly).
2. **Discovery**: `_find_intermediate_equation_blocks` finds every genuine
   `_is_equation_number_like_block` match in the walked range, sharing the corridor
   established by the two endpoints TOGETHER (their union — a single short prose line
   legitimately doesn't reach as far as a narrow equation number sitting at a column's
   outer margin) — including the end block itself when it's the selection's own equation
   endpoint (`include_after=True`, the central 2.5N generalization: an equation encountered
   earlier in the selection is now found by the exact same mechanism as the terminal one).
3. **Region resolution**: every discovered equation's own `_display_equation_region_blocks`
   is resolved BEFORE any assembly starts — a formula fragment is never appended to prose
   and deleted later via string replacement.
4. **Assembly**: the block range is walked once, building an ordered
   `[PROSE_GROUP, DISPLAY_EQUATION, PROSE_GROUP, ...]` sequence. Each `DISPLAY_EQUATION`
   emits exactly one `[式 (N)]` placeholder (consuming its own region's member blocks
   entirely); each `PROSE_GROUP` is fed through `_assemble_lines_with_gap_recovery` exactly
   once. **Critical implementation detail** (found during 2.5I's own first, incorrect spike
   attempt, preserved through every later phase): gap recovery must run once per
   **contiguous prose line-group**, never per individual PyMuPDF block — a real
   post-equation sentence (Soenen's "where Ln is the normalized radiance, a and b are the
   y-intercept...") can be split across several different blocks on the same visual row, and
   splitting per-block breaks that same-row adjacency, silently skipping real missing-glyph
   recovery.
5. If no equation qualifies at all, execution falls straight through to the existing,
   completely unmodified ordinary cross-block path.

## Missing-glyph recovery (Prototype 2.5B → 2.5D → 2.5E)

The real Soenen "(5)" paragraph also has an inline math variable ("k") that produces
**zero text items** in both PDF.js and PyMuPDF — a pure vector-only glyph, invisible to
text extraction on either side, but visually present on the rendered page. Prototype 2.5B
first added a candidate-gap detector (`_detect_suspicious_gaps`) but warned
unconditionally on every candidate — which turned out to also fire on ordinary column
gutters and (on some PDFs) ordinary inter-word spacing, a real regression found in
Prototype 2.5C/D testing (see `docs/design-notes.md`). Prototype 2.5E fixes this and
completes the recovery pipeline:

1. **Candidate generation** (unchanged from 2.5B): spans across the WHOLE page are grouped
   into visual rows (independent of PyMuPDF's own block boundaries, since two spans on the
   same row can legitimately land in different blocks — this is itself part of what the
   real Soenen paragraph does), and any same-row adjacent-span gap exceeding normal
   spacing (relative to font size, never a fixed pixel value, plus an absolute floor) is a
   candidate.
2. **Adjacency restriction** (new, 2.5E): a candidate is only ever acted on when it sits
   directly between two lines that are actually ADJACENT in a specific selection's own
   assembled reading order — never "any candidate that happens to touch a page-wide line
   somewhere," which is what let column-gutter/unrelated-row noise through in 2.5B.
3. **Visual-ink gate** (2.5D → 2.5E, `_render_gap_ink_ratio`): the remaining candidate is
   rendered (PyMuPDF pixmap, grayscale, 4x scale) and classified by the fraction of
   clearly-non-background pixels in its horizontally-inset central region
   (`VISUAL_INK_CENTRAL_RATIO_THRESHOLD`, currently `0.05`) — background is estimated
   per-crop (90th brightness percentile), never hardcoded pure white. **Empirical, not
   universal**: validated against real k/e/θ/Ln positives (0.1185–0.2068) and real
   column-gutter/MDPI-word-gap/ordinary-space negatives (all exactly `0.0000`) — see
   `docs/design-notes.md`, Prototype 2.5D, for the full dataset. No ink → the candidate is
   dropped silently (no error, no OCR call). Ink present → step 4.
4. **Localized OCR recovery** (`_attempt_gap_recovery`): renders the crop formed by the
   union of the gap's own two bounding lines (never the whole page-wide row — a two-column
   PDF may have unrelated content at the same y in the other column), OCRs it via the
   existing local Paddle service (`PADDLE_OCR_URL`, `/ocr/page` — never a second engine),
   and recovers **only** the substring strictly between the two lines' own trusted,
   PyMuPDF-extracted text (comparison-normalized for ligatures/NFKC/whitespace, matching
   `_normalize_for_match`) found in that order within the OCR result. PyMuPDF/PDF.js text
   is never replaced wholesale by OCR output — recovery fails (→ `missing_glyph_unresolved`)
   if Paddle is unreachable, confidence is below `OCR_CONFIDENCE_THRESHOLD` (`0.90`), or
   either anchor isn't found. Paddle is only ever called for a visual-ink-positive
   candidate — an ordinary selection with no such gap never touches Paddle at all, so
   Paddle being offline never affects ordinary PDF reading.

Validated against the real Soenen PDF (`tests/test_fixtures.py`, requires the real Paddle
service running): the live-failure equation endpoint still safe-fails with zero `"(5)"`
contamination, the real "k" (and, independently, "θ") are recovered exactly and inserted
into the final sentence, and Failure A/Failure B/MDPI ordinary prose succeed with OCR
forcibly disabled via a test-time mock — proving these no longer depend on, or trigger,
any OCR call at all.

## Parenthesized inline glyph recovery (Prototype 2.5K → 2.5L Part A → 2.5N → 2.5O → 2.5Q)

A vector-only inline glyph tightly hugged by round parentheses with no surrounding spaces
(the real Soenen `"regression slope (b) and intercept (a)"`) produces a gap **narrower**
than the missing-glyph pipeline's existing width-based candidacy rule requires — the
opposite failure mode from the original "k" case (a *wide* gap from a whole missing word
between two normally-spaced words). Real measured gaps: 4.36pt/5.38pt at 9.96pt font,
both under the 0.6em/5.98pt requirement. Rather than lowering that threshold globally
(which would also flag ordinary inter-word spaces everywhere as candidates), a SECOND,
independent structural rule was added to `_detect_suspicious_gaps`: a gap is also a
candidate when it clears the same absolute floor AND its left neighbor span's text ends
with `"("` and its right neighbor's text starts with `")"`. Round parentheses only for now
— the validated real corpus is `"(a)"`/`"(b)"`/`"(i)"`; square/curly brackets interact with
citation-bracket semantics (2.5H) and aren't needed yet. The visual-ink gate and localized
OCR stages are completely unchanged and unaware this rule exists; the glyph itself always
still comes exclusively from OCR, never a hardcoded letter-to-symbol table.

**Source-faithful assembly (2.5N)**: recovering the glyph is only half the story — the
recovered "b" and its two flanking line texts used to become THREE separate parts, joined
by `_assemble_lines_with_gap_recovery`'s own newline-then-space frontend normalization into
the non-source-faithful `"( b )"` (correct for an ordinary word-boundary recovery like
`"of"`/`"k"`/`"can"` → `"of k can"`, wrong for punctuation that hugs its content with zero
space). When the recovered gap is bounded by round parentheses, the glyph and its two
flanking texts are now merged into ONE part with no separator at all — `"(b)"`. This check
is provenance-aware (per-gap, using the actual flanking text at assembly time), never a
global punctuation-cleanup regex pass over the final string.

**Boundary-text-aware shape detection (2.5O)**: 2.5N's live acceptance still failed on this
exact mechanism — the SHAPE check ("does this gap sit between round parens?") originally
inspected `text`/`next_text`, the strings actually being EMITTED for each line position.
At a selection's own start/end, that string isn't always PyMuPDF's own line text — it's the
caller's `boundaryText` (see `_line_texts_with_boundary`), and a real live failure showed
these can genuinely diverge: PDF.js's own text-layer DOM has literally zero node for the
invisible glyph, so a forward `boundaryText` capture (`extractWithinLine` in
`src/features/pdf/components/PdfViewer.tsx`, which walks the DOM to the next `<br>`) reads
straight through the fused `"()"` and continues onto whatever further same-row text
follows — for the real Soenen sentence, that's `"...regression slope () and"` (parens
already fused, "and" already absorbed from what PyMuPDF itself extracts as a SEPARATE
block), producing the exact live-reported corruption `"slope ( ) and b ) and intercept
(a)"` (the recovered glyph appended at the wrong position, `") and"` then duplicated).
The automated fixture test that validated 2.5N never caught this because its hand-supplied
`boundaryText` happened to be an exact, unmodified copy of PyMuPDF's own line text.

Fixed by splitting the check in two: the SHAPE check now always uses `lines[i].text`/
`lines[i + 1].text` — PyMuPDF's own trusted, never-mutated extraction — regardless of what's
actually being emitted; the INSERTION POINT is then chosen based on what `text` (the
possibly-boundary-substituted string) actually contains: if it cleanly ends in `"("` (the
ordinary case), merge forward as before; otherwise, if `text` ENDS WITH `next_text`, the
glyph is inserted directly before that suffix and `next_text` is never separately
emitted — its content is already present, verbatim, inside `text`, so emitting it again
would duplicate it. Any other shape falls back to appending the glyph as its own
(non-tight-joined) part — the glyph itself is never silently dropped, only possibly not
perfectly tight-joined in an unanticipated shape.

**Whitespace-tolerant, literal-trace-verified (2.5Q)**: 2.5O's own fix still failed live —
its own fused-paren detection required an EXACT `"()"` match (zero characters between the
parens), an assumption formed by reading `extractWithinLine`'s source rather than capturing
a real request. Prototype 2.5P added a dev-only request trace (`PGT_LAYOUT_TRACE=1`,
**deliberately retained** — see "Diagnostic request trace" above) specifically because this
same code-reading approach had now produced two plausible-but-wrong reconstructions in a
row; the literal capture proved PDF.js's own text layer renders the invisible glyph's gap
as an actual SPACE character — `"...regression slope ( ) and"`, not `"...slope () and"`.
2.5Q generalizes the insertion check accordingly: rather than requiring an exact `"()"`
substring, it locates the `"("` immediately preceding wherever `next_text` begins as a
trailing match within `text`, and requires only that the characters between that `"("` and
the start of `next_text` are WHITESPACE-ONLY (zero or more — `"()"`, `"( )"`, `"(  )"` are
all the same structural state) — never a page-wide or arbitrary-parenthesis search, and
still entirely provenance-based (no regex cleanup of the final assembled string).

## Display-equation region suppression (Prototype 2.5K → 2.5L Part B)

Some display equations (the real Soenen equations (8)/(9)) contain extractable text
fragments belonging to the formula's own body — e.g. a bare `"C"` on the equation's own
row, or on a fraction's numerator/denominator row — alongside the equation-number block.
Before this fix, both the equation-at-end path (2.5G) and the cross-equation-continuation
path (2.5J) treated these fragments as ordinary prose, leaking them into the reconstructed
text (confirmed via a real live call: equation (9) reconstructed as
`"term\nC\nC\n[式 (9)]\n..."`). Product rule: once a region is confidently associated with
a numbered display equation, its internal extracted text is never trusted as prose,
regardless of whether the formula is 0% extractable, partly extractable, or heavily
fragmented — the whole region contributes exactly one `[式 (N)]` placeholder.

`_display_equation_region_blocks(page_blocks, eqnum_block, corridor_reference_block)`
implements this: starting ONLY from an already-confirmed `_is_equation_number_like_block`
anchor (never invented from arbitrary tiny blocks alone), it walks a tightly bounded,
local region in both directions — stopping at the first block that isn't formula-fragment
shaped (`_is_formula_fragment_block`: single line, single token, narrow —
`EQUATION_REGION_FRAGMENT_MAX_WIDTH_NORM`'s own derivation has the real measurements this
is based on), that's more than one line-height away vertically
(`EQUATION_REGION_MAX_VERTICAL_GAP_EM`), or that falls outside the corridor established by
a wide prose block the caller already trusts (`_blocks_share_corridor` against that
reference, not against the equation-number block itself — two narrow blocks, like a
formula fragment and its own equation number, frequently don't literally overlap in x even
within the same column). `EQUATION_REGION_MAX_FRAGMENTS` is a defensive cap only. If two
equations' regions would ever claim the same block (not observed on any real fixture), that
block is excluded from suppression entirely — left as ordinary prose — rather than guessed.
A selection endpoint landing directly ON a formula-fragment block (e.g. clicking the bare
"C") is a safe failure (`formula_fragment_endpoint_unresolved`), never silently treated as
prose.

A read-only survey of all 11 equation-number anchors across the real 12-page Soenen
document found fragment members on only 3 (equations (8), (9), (11) — all a single "C" each,
consistent with this paper's own correction-factor notation); the remaining 8 equations are
fully vector-only and correctly return just the equation-number block itself. Zero
unexpected/prose blocks were ever absorbed.

## Local-only / security

- Binds `127.0.0.1` only.
- CORS restricted to `http://localhost:5173` / `http://127.0.0.1:5173` — not `*`.
- No filesystem path is ever accepted from a client — only `documentId` values this
  service itself issued via `/document/register`.
- Uploaded PDF bytes are never written to disk; released on `/document/close` or process
  exit.
- No external layout/document API of any kind is called besides the local Paddle OCR
  service (`PADDLE_OCR_URL`, default `http://127.0.0.1:8008` — the existing PaddleOCR
  service's own port, distinct from this service's own `8009`) — PyMuPDF itself is a
  local C-library binding, not a network client.
- Single request at a time; no queue/concurrency control, matching
  `services/paddle_ocr/`'s own documented limitation.

### Paddle is optional (Prototype 2.5E)

This service works normally for ordinary text selection — including cross-block/
cross-page reconstruction — with **no Paddle dependency at all**. Paddle is only ever
called when a selection's own candidate gap passes the visual-ink gate (step 3 above);
this is rare (most PDFs, most selections, have none). `/health` reports only this
service's own status, never Paddle's — a missing-glyph recovery attempt failing because
Paddle is offline surfaces as that one selection's own explicit `422`, not a
service-wide outage.

## License

PyMuPDF is available under GNU AGPL v3, with a commercial license available from Artifex.
Paper Grammar Tutor's project-authored code is distributed under `AGPL-3.0-only`; the
repository-level [LICENSE](../../LICENSE), [third-party notices](../../THIRD_PARTY_NOTICES.md),
and the app footer provide the applicable license and source links. Third-party components
remain under their respective upstream licenses.

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
  needed),
- the Soenen paper's real missing-glyph recovery ("k" and, independently, "θ" — both
  genuinely vector-only, zero-text-item inline math variables), and
- Failure A/Failure B/MDPI ordinary prose succeeding with Paddle OCR forcibly disabled
  (a test-time mock that raises if called), confirming these paths never depend on or
  invoke OCR at all.
- the Soenen paper's real cross-equation continuation (equation (6): prose before → the
  equation → prose after, including four further real vector-only missing glyphs in the
  after-equation sentence — Ln, a, b, y, Lavg — all recovered in the same pass).

- the Soenen paper's real parenthesized inline glyphs "(b)"/"(a)"/"(i)" (Prototype 2.5L
  Part A) and real equation (8)/(9) region suppression with zero leaked formula fragments
  (Prototype 2.5L Part B).
- the Soenen paper's real COMPOUND case (Prototype 2.5M/2.5N): a single selection
  containing parenthesized missing glyphs "(b)"/"(a)", an intermediate equation (8), further
  prose, and equation (9) as the selection's own endpoint — the exact shape that exposed the
  equation-at-end/intermediate-equation divergence bug, now producing zero leaked formula
  fragments and both placeholders correctly, in one pass.
- the SAME compound case reconstructed with the real browser's own `boundaryText` shape
  (Prototype 2.5O) — fused parens, absorbed next-block text — rather than the idealized,
  PyMuPDF-exact string 2.5N's own fixture happened to use; this is the one that actually
  reproduces the live-reported "(  ) and b )" corruption pre-2.5O.

**Resolved in Prototype 2.5ZG-BACKEND.** Exact-fixture reproduction corrected the earlier
root-cause description: PyMuPDF places a DOI line and the copyright/license line together
in a separate bottom-of-page native block (`1:17`), not in the preceding article-prose
block. The captured browser endpoint resolves geometrically to that footer block;
boundary substitution replaces its first DOI line with the trusted selected prose, while
the second legal line used to remain in the result. Reconstruction now removes only a
high-confidence trailing boilerplate line when all conservative layout signals agree:
extreme bottom position, final-line position, smaller-than-body font, footer-like width,
and at least two independent legal-publication signals. The clicked endpoint line is
always retained, publisher names are not classifier evidence, and uncertain lines remain.
`test_previous_elsevier_regression` and synthetic keyword/bottom-footnote controls cover
the fix.

## Equation-aware selection — scope (Prototype 2.5J → 2.5L → 2.5N → 2.5O → 2.5Q)

**Supported:**
- a display equation at a selection's own endpoint (Prototype 2.5G)
- one or more numbered display equations strictly between two ordinary-prose endpoints in
  the same local corridor on the same page (Prototype 2.5J)
- BOTH of the above combined in a single selection — an intermediate equation followed by
  further prose followed by a terminal equation endpoint (Prototype 2.5N; this was the exact
  gap between 2.5G and 2.5J that 2.5M diagnosed and 2.5N closed)
- a vector-only inline glyph tightly hugged by round parentheses, e.g. "(a)"/"(b)"/"(i)",
  assembled as one source-faithful tight-joined unit (Prototype 2.5L Part A → 2.5N),
  correctly even when the recovery sits at the selection's OWN start/end and the caller's
  `boundaryText` doesn't literally match PyMuPDF's own line text (Prototype 2.5O — see the
  real browser DOM shape this was derived from, above)
- a numbered display equation whose own formula-body fragments (e.g. a bare "C") are
  extractable text — the whole region still contributes exactly one placeholder, never the
  raw fragment (Prototype 2.5L Part B)

**Still unsupported / not guaranteed:**
- arbitrary unnumbered display equations
- equation contents (no OCR, no LaTeX, no MathML reconstruction — the number is the only
  thing ever extracted)
- an equation-aware selection spanning a page boundary
- square/curly-bracket-hugged missing glyphs (round parentheses only so far)
- a selection endpoint landing directly on a formula-body fragment (safe failure, not
  resolved as prose or as the equation)
- highly complex multi-column equation layouts not covered by the real Soenen fixture or
  the synthetic corridor tests
