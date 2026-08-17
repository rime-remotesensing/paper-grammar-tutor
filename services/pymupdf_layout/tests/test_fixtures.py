"""Real-PDF fixture validation (item 47-50) -- exercises the actual production service
against the exact real papers that broke the retired custom PDF.js-only heuristic
(Prototype 2.4B-R1 through R7). Coordinates/boundaryText below are the REAL PDF.js-
extracted values captured during Prototype 2.4B-R7's own spike (see that phase's report).

These PDFs are personal/copyrighted academic papers, not committed to the repository, and
their location is machine-specific -- so no absolute path is hardcoded here. Each fixture's
path comes from an environment variable (see services/pymupdf_layout/README.md); every test
skips cleanly (not fails) if its variable is unset or the file isn't present, so this file
stays safe to run in CI or on another developer's machine while still providing real
validation on this one.
"""

import os

import pytest
from fastapi.testclient import TestClient

import main

SOENEN = os.environ.get("PGT_FIXTURE_SOENEN_PDF")
ELSEVIER = os.environ.get("PGT_FIXTURE_ELSEVIER_PDF")
MDPI = os.environ.get("PGT_FIXTURE_MDPI_PDF")


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def _register(client, path: str | None) -> str:
    if not path:
        pytest.skip("fixture PDF path env var not set on this machine")
    if not os.path.exists(path):
        pytest.skip(f"fixture PDF not present on this machine: {path}")
    with open(path, "rb") as f:
        res = client.post("/document/register", files={"file": (os.path.basename(path), f.read(), "application/pdf")})
    assert res.status_code == 200
    return res.json()["documentId"]


def _select(client, document_id, start, end):
    res = client.post("/layout/selection", json={"documentId": document_id, "start": start, "end": end})
    assert res.status_code == 200
    return res.json()


def test_ocr_never_invoked_for_ordinary_prose_selections(client, monkeypatch):
    """Prototype 2.5E item 55: OCR must never be called for ordinary prose -- Failure A
    (cross-column), Failure B (cross-page), and MDPI ordinary prose all still succeed with
    OCR forcibly disabled, proving the visual-ink gate (not OCR availability) is what
    determines whether these succeed."""
    import main

    def _fail_if_called(_png_bytes):
        raise AssertionError("OCR must never be invoked for ordinary prose selections")

    monkeypatch.setattr(main, "_call_paddle_ocr", _fail_if_called)

    soenen_id = _register(client, SOENEN)
    body_a = _select(
        client,
        soenen_id,
        start={"pageNumber": 1, "xNorm": 0.06666708629629631, "yNorm": 0.7966073803030304, "boundaryText": "These techniques have been", "direction": "forward"},
        end={"pageNumber": 1, "xNorm": 0.5094949494949494, "yNorm": 0.42902714646464646, "boundaryText": "applied in forested areas [1]–[3], [9], [11] and are based on an", "direction": "backward"},
    )
    assert body_a["reconstructedText"] == "These techniques have been\napplied in forested areas [1]–[3], [9], [11] and are based on an"

    body_b = _select(
        client,
        soenen_id,
        start={"pageNumber": 1, "xNorm": 0.5094966267003366, "yNorm": 0.9210726646212118, "boundaryText": "Rocky Mountain forests in", "direction": "forward"},
        end={"pageNumber": 2, "xNorm": 0.06414141414141414, "yNorm": 0.08334532828282837, "boundaryText": "western Canada. We also introduce a powerful approach for to-", "direction": "backward"},
    )
    assert body_b["reconstructedText"] == "Rocky Mountain forests in\nwestern Canada. We also introduce a powerful approach for to-"
    client.post("/document/close", json={"documentId": soenen_id})

    mdpi_id = _register(client, MDPI)
    body_mdpi = _select(
        client,
        mdpi_id,
        start={"pageNumber": 1, "xNorm": 0.12857061262338806, "yNorm": 0.9031599021249807, "boundaryText": "This substitution works extremely well for remotely-sensed data because", "direction": "forward"},
        end={"pageNumber": 2, "xNorm": 0.12857061262338815, "yNorm": 0.10539059734644673, "boundaryText": "they contain extremely strong positive spatial autocorrelation; because of the form of the auto-normal", "direction": "backward"},
    )
    assert "This substitution works extremely well" in body_mdpi["reconstructedText"]
    client.post("/document/close", json={"documentId": mdpi_id})


def test_failure_a_same_page_cross_column(client):
    """Soenen 2005 SCS+C: 'These techniques have been' (LEFT_COLUMN body) -> 'applied in
    forested areas...' (RIGHT_COLUMN body), with an author/funding/e-mail/DOI footnote and
    a Fig. 1 caption both geometrically between the two clicks -- item 22/32."""
    document_id = _register(client, SOENEN)
    body = _select(
        client,
        document_id,
        start={"pageNumber": 1, "xNorm": 0.06666708629629631, "yNorm": 0.7966073803030304, "boundaryText": "These techniques have been", "direction": "forward"},
        end={"pageNumber": 1, "xNorm": 0.5094949494949494, "yNorm": 0.42902714646464646, "boundaryText": "applied in forested areas [1]\u2013[3], [9], [11] and are based on an", "direction": "backward"},
    )
    assert body["sameBlock"] is False
    text = body["reconstructedText"]
    assert text == "These techniques have been\napplied in forested areas [1]\u2013[3], [9], [11] and are based on an"
    for polluted in ["Manuscript received", "funding", "e-mail", "Digital Object Identifier", "Fig. 1", "sloped terrain"]:
        assert polluted not in text
    client.post("/document/close", json={"documentId": document_id})


def test_failure_b_cross_page(client):
    """Soenen 2005 SCS+C: '...Rocky Mountain forests in' (page N, RIGHT_COLUMN) -> 'western
    Canada.' (page N+1, LEFT_COLUMN), excluding the later unrelated sections on page N+1
    (validation methods / Cosine Correction / Minnaert Correction headings) -- item 23/33."""
    document_id = _register(client, SOENEN)
    body = _select(
        client,
        document_id,
        start={"pageNumber": 1, "xNorm": 0.5094966267003366, "yNorm": 0.9210726646212118, "boundaryText": "Rocky Mountain forests in", "direction": "forward"},
        end={"pageNumber": 2, "xNorm": 0.06414141414141414, "yNorm": 0.08334532828282837, "boundaryText": "western Canada. We also introduce a powerful approach for to-", "direction": "backward"},
    )
    assert body["sameBlock"] is False
    text = body["reconstructedText"]
    assert text == "Rocky Mountain forests in\nwestern Canada. We also introduce a powerful approach for to-"
    for polluted in ["validation methods", "Cosine Correction", "Minnaert Correction", "SOENEN et al"]:
        assert polluted not in text
    client.post("/document/close", json={"documentId": document_id})


def test_failure_a_never_enters_equation_aware_sequence_assembler(client, monkeypatch):
    """Prototype 2.5N item 33/35: explicit route assertion -- the real Failure A cross-
    column selection must never reach the unified equation-aware sequence assembler at all
    (not just "produce the right text despite it"). Monkeypatches
    `_resolve_equation_aware_selection` to fail loudly if entered."""

    def _fail_if_called(*args, **kwargs):
        raise AssertionError("Failure A must never enter the equation-aware sequence assembler")

    monkeypatch.setattr(main, "_resolve_equation_aware_selection", _fail_if_called)
    document_id = _register(client, SOENEN)
    body = _select(
        client,
        document_id,
        start={"pageNumber": 1, "xNorm": 0.06666708629629631, "yNorm": 0.7966073803030304, "boundaryText": "These techniques have been", "direction": "forward"},
        end={"pageNumber": 1, "xNorm": 0.5094949494949494, "yNorm": 0.42902714646464646, "boundaryText": "applied in forested areas [1]–[3], [9], [11] and are based on an", "direction": "backward"},
    )
    assert body["reconstructedText"] == "These techniques have been\napplied in forested areas [1]–[3], [9], [11] and are based on an"
    client.post("/document/close", json={"documentId": document_id})


def test_ordinary_same_page_cross_block_never_enters_equation_aware_sequence_assembler(client, monkeypatch):
    """Prototype 2.5N item 35: an ordinary same-page, same-corridor, NO-equation cross-block
    selection must also never reach the unified equation-aware sequence assembler (there's
    no equation-number block for `_find_intermediate_equation_blocks` to find, so routing
    should fall straight through to the existing, unmodified ordinary cross-block path)."""

    def _fail_if_called(*args, **kwargs):
        raise AssertionError("an equation-free same-corridor selection must never enter the equation-aware sequence assembler")

    monkeypatch.setattr(main, "_resolve_equation_aware_selection", _fail_if_called)
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 3, "xNorm": 45 / 594, "yNorm": 197 / 792, "boundaryText": "The parameter C is said to be analogous to the effects of dif-", "direction": "forward"},
            "end": {"pageNumber": 3, "xNorm": 200 / 594, "yNorm": 209 / 792, "boundaryText": "fuse sky irradiance, although the analogy is not exact [2]. The C", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    client.post("/document/close", json={"documentId": document_id})


def test_previous_elsevier_regression(client):
    """The original R1/R3/R4/R5B real-sentence cross-page fixture -- must stay clean."""
    document_id = _register(client, ELSEVIER)
    body = _select(
        client,
        document_id,
        start={"pageNumber": 1, "xNorm": 0.5068544997698641, "yNorm": 0.882380874369376, "boundaryText": "over Asia and Australia using the Japanese Multifunctional Transport", "direction": "forward"},
        end={"pageNumber": 2, "xNorm": 0.07142854731291515, "yNorm": 0.07117288570579683, "boundaryText": "Satellite (MTSAT) imager and the Korean Communication, Ocean and", "direction": "backward"},
    )
    assert body["sameBlock"] is False
    text = body["reconstructedText"]
    assert text == "over Asia and Australia using the Japanese Multifunctional Transport\nSatellite (MTSAT) imager and the Korean Communication, Ocean and"
    for polluted in ["Remote Sensing of Environment 193", "ScienceDirect", "journal homepage", "Corresponding author", "E-mail address", "dx.doi.org"]:
        assert polluted not in text
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_equation_number_endpoint_no_pollution(client):
    """Prototype 2.5A/B/G: the exact real live failure -- a drag ending on/near the "(5)"
    equation-number block on page 2 used to reconstruct as "The value of (5)". The
    boundaryText the browser actually captures at that point IS "(5)" itself (nothing a
    prose anchor search can recover). 2.5B/E made this a safe failure; 2.5G (the PRIMARY
    live-acceptance target, item 34/58) recognizes it as a genuine prose-crossing-into-a-
    display-equation selection and produces the "[式 (N)]" placeholder instead -- never
    equation-number contamination, and no longer a bare failure either."""
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 2, "xNorm": 530 / 594, "yNorm": 230.5 / 792, "boundaryText": "The value", "direction": "forward"},
            "end": {"pageNumber": 2, "xNorm": 545 / 594, "yNorm": 283 / 792, "boundaryText": "(5)", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    body = res.json()
    text = body["reconstructedText"] or ""
    assert "The value of (5)" not in text
    assert text == "The value\nof\nk\ncan then be used as a moderator [9] for the cosine equation,\nas\n[式 (5)]"
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_missing_k_glyph_selection_recovered(client):
    """Prototype 2.5E item 50: 'The value of k can then be used...' -- the inline "k" is
    unextractable by PyMuPDF/PDF.js (see docs/design-notes.md, Prototype 2.5A) but visually
    present (2.5D) and reliably OCR-recoverable via the real, running local Paddle service
    (2.5C). This test requires Paddle to be running at http://127.0.0.1:8008, matching the
    project's existing convention for real-fixture tests -- it is NOT mocked, unlike
    test_equation_guard.py's synthetic-PDF OCR-path tests, specifically so a real,
    end-to-end recovery of the real reported live failure is verified."""
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 2, "xNorm": 530 / 594, "yNorm": 230.5 / 792, "boundaryText": "The value", "direction": "forward"},
            "end": {
                "pageNumber": 2,
                "xNorm": 540 / 594,
                "yNorm": 242.6 / 792,
                "boundaryText": "can then be used as a moderator [9] for the cosine equation,",
                "direction": "backward",
            },
        },
    )
    assert res.status_code == 200
    body = res.json()
    text = body["reconstructedText"] or ""
    assert "(5)" not in text
    assert text == "The value\nof\nk\ncan then be used as a moderator [9] for the cosine equation,"
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_equation_number_endpoint_still_safe_failure_not_ocr_target(client):
    """Prototype 2.5E item 40 (still true after 2.5G): the equation-number endpoint guard
    is independent of missing-glyph recovery -- an equation-number endpoint is never
    treated as an OCR-recoverable glyph gap, regardless of which of the 2.5G outcomes
    (placeholder success or safe failure) it resolves to."""
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 2, "xNorm": 530 / 594, "yNorm": 230.5 / 792, "boundaryText": "The value", "direction": "forward"},
            "end": {"pageNumber": 2, "xNorm": 545 / 594, "yNorm": 283 / 792, "boundaryText": "(5)", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    assert "missing_glyph_unresolved" not in res.text
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_equation_reverse_direction_not_yet_supported_is_safe_failure(client):
    """Prototype 2.5G item 31's explicit scope limit: only a selection TERMINATING on the
    equation number is supported (dragged in the natural prose-first direction). A drag
    physically starting AT the equation number and ending at earlier prose (start_is_eqnum,
    not end_is_eqnum) is not yet validated -- must safe-fail, never silently generalize."""
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 2, "xNorm": 545 / 594, "yNorm": 283 / 792, "boundaryText": "(5)", "direction": "forward"},
            "end": {"pageNumber": 2, "xNorm": 530 / 594, "yNorm": 230.5 / 792, "boundaryText": "The value", "direction": "backward"},
        },
    )
    assert res.status_code == 422
    assert res.json()["detail"]["error"] == "equation_endpoint_unresolved"
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_theta_glyph_selection_recovered(client):
    """Prototype 2.5E item 51: a second, independent real vector-only glyph (theta, the
    solar zenith angle variable) on the same page, validated in 2.5C/D -- confirms recovery
    generalizes beyond the primary "k" case and preserves non-ASCII symbols (item 33)."""
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 2, "xNorm": 95 / 594, "yNorm": 475 / 792, "boundaryText": "reflectance, and", "direction": "forward"},
            "end": {"pageNumber": 2, "xNorm": 115 / 594, "yNorm": 475 / 792, "boundaryText": "is the solar zenith angle (SZA). However, the", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    text = res.json()["reconstructedText"] or ""
    assert "θ" in text  # theta, U+03B8 -- never ASCII-normalized away
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_parenthesized_b_and_a_recovered(client):
    """Prototype 2.5K/2.5L Part A: the real live-reported failure -- "The parameter C is a
    function of the regression slope (b) and intercept (a)..." lost both vector-only glyphs
    tightly hugged by round parens (4.36pt/5.38pt gaps at 9.96pt font, both under the
    ordinary 0.6em/5.98pt candidacy rule -- see docs/design-notes.md, Prototype 2.5K, for
    the full root-cause trace). Requires the real Paddle service, not mocked, matching this
    file's convention for real-glyph-recovery fixtures."""
    document_id = _register(client, SOENEN)
    res_b = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 3, "xNorm": 45 / 594, "yNorm": 73 / 792, "boundaryText": "The parameter C is a function of the regression slope (", "direction": "forward"},
            "end": {"pageNumber": 3, "xNorm": 80 / 594, "yNorm": 85 / 792, "boundaryText": "intercept (", "direction": "backward"},
        },
    )
    assert res_b.status_code == 200
    text_b = res_b.json()["reconstructedText"] or ""
    # Prototype 2.5N item 19: tight-joined, source-faithful -- "(b)", never "( b )".
    assert text_b == "The parameter C is a function of the regression slope (b) and\nintercept ("

    res_a = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 3, "xNorm": 45 / 594, "yNorm": 84 / 792, "boundaryText": "intercept (", "direction": "forward"},
            "end": {"pageNumber": 3, "xNorm": 88 / 594, "yNorm": 84 / 792, "boundaryText": ")", "direction": "backward"},
        },
    )
    assert res_a.status_code == 200
    text_a = res_a.json()["reconstructedText"] or ""
    assert text_a == "intercept (a)"
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_parenthesized_i_recovered_independent_control(client):
    """Prototype 2.5K item 2's independent control glyph: "...the incidence angle (i)
    [defined as..." -- a second, unrelated real instance of the same failure pattern on
    page 2, confirming recovery generalizes beyond the (a)/(b) case without hardcoding
    either letter. Requires the real Paddle service, not mocked."""
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 2, "xNorm": 100 / 594, "yNorm": 387 / 792, "boundaryText": "proportional to the cosine of the incidence angle (", "direction": "forward"},
            "end": {"pageNumber": 2, "xNorm": 250 / 594, "yNorm": 387 / 792, "boundaryText": ") [deﬁned as", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    text = res.json()["reconstructedText"] or ""
    # Prototype 2.5N item 19: tight-joined, source-faithful -- "(i)", never "( i )".
    assert text == "proportional to the cosine of the incidence angle (i) [deﬁned as"
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_equation_eight_region_suppressed_no_leaked_formula_fragment(client):
    """Prototype 2.5K/2.5L Part B: equation (8)'s own formula-body fragment ("C", on the
    same row as the equation number) must never leak into the reconstructed prose -- only
    "[式 (8)]" is contributed, combined with Part A's own (b)/(a) recovery in the same
    selection (the real live-reported before-equation-8 sentence)."""
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 3, "xNorm": 45 / 594, "yNorm": 73 / 792, "boundaryText": "The parameter C is a function of the regression slope (", "direction": "forward"},
            "end": {"pageNumber": 3, "xNorm": 285 / 594, "yNorm": 109 / 792, "boundaryText": "(8)", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    text = res.json()["reconstructedText"] or ""
    # Prototype 2.5N item 19: tight-joined, source-faithful -- "(b)"/"(a)", never "( b )"/"( a )".
    assert text == "The parameter C is a function of the regression slope (b) and\nintercept (a)\n[式 (8)]"
    assert "\nC\n" not in text
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_compound_equation_eight_then_equation_nine_endpoint(client):
    """Prototype 2.5M/2.5N -- the mandatory regression closing the exact missing test shape
    identified in 2.5M: a SINGLE selection containing BOTH an intermediate numbered equation
    (8) AND a final numbered equation (9) AS THE SELECTION'S OWN ENDPOINT, with parenthesized
    missing glyphs "(b)"/"(a)" in the leading prose. Before 2.5N, this was claimed entirely by
    the (then-separate) equation-at-end algorithm -- which had zero awareness of equation (8)
    encountered along the way -- producing "The parameter C is a function of the regression
    slope (\\nb\\n) and\\nintercept (\\na\\n)\\nC\\n(8)\\nand is introduced to the cosine
    correction model as an additive\\nterm\\n[式 (9)]" (real formula fragment "C" and raw "(8)"
    leaking into the prose). Requires the real Paddle service, not mocked -- (b)/(a) are real
    vector-only glyphs."""
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 3, "xNorm": 45 / 594, "yNorm": 73 / 792, "boundaryText": "The parameter C is a function of the regression slope (", "direction": "forward"},
            "end": {"pageNumber": 3, "xNorm": 283 / 594, "yNorm": 172 / 792, "boundaryText": "(9)", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    text = res.json()["reconstructedText"] or ""
    assert text == (
        "The parameter C is a function of the regression slope (b) and\n"
        "intercept (a)\n"
        "[式 (8)]\n"
        "and is introduced to the cosine correction model as an additive\n"
        "term\n"
        "[式 (9)]"
    )
    # Explicit negative checks (item 39/23): no raw formula fragments, no raw equation
    # numbers, exactly one placeholder each, correct order, intermediate prose preserved.
    assert "\nC\n" not in text
    assert "(8)\n" not in text or "[式 (8)]" in text  # only ever appears wrapped in the placeholder
    assert text.count("[式 (8)]") == 1
    assert text.count("[式 (9)]") == 1
    assert text.index("[式 (8)]") < text.index("and is introduced")
    assert text.index("and is introduced") < text.index("[式 (9)]")
    assert "( b )" not in text and "( a )" not in text
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_compound_equation_eight_then_nine_paddle_unavailable_is_safe_failure(client, monkeypatch):
    """Item 41: the compound case's leading prose needs real OCR recovery for (b)/(a) -- if
    Paddle is unavailable, the whole selection must safe-fail explicitly, never silently
    produce "()" for either missing glyph."""
    monkeypatch.setattr(main, "_call_paddle_ocr", lambda _png_bytes: None)
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 3, "xNorm": 45 / 594, "yNorm": 73 / 792, "boundaryText": "The parameter C is a function of the regression slope (", "direction": "forward"},
            "end": {"pageNumber": 3, "xNorm": 283 / 594, "yNorm": 172 / 792, "boundaryText": "(9)", "direction": "backward"},
        },
    )
    assert res.status_code == 422
    assert res.json()["detail"]["error"] == "missing_glyph_unresolved"
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_compound_with_literal_captured_browser_request(client):
    """Prototype 2.5P/2.5Q -- the mandatory regression using the LITERAL runtime request
    captured from the real browser (Prototype 2.5P's dev-only trace facility,
    `PGT_LAYOUT_TRACE=1`), not an approximation. 2.5O's own code-reading-based
    reconstruction of `boundaryText` ("...regression slope () and", zero characters between
    the parens) turned out to still be WRONG -- the literal capture proved PDF.js's own
    text-layer DOM renders the invisible glyph's gap as an actual SPACE character:
    "...regression slope ( ) and". 2.5O's fused-paren detection required an EXACT "()"
    match and so didn't fire for this real shape, falling through to
    `fallback_append_no_fuse_match` and reproducing the exact live-reported corruption. The
    end `boundaryText` is also literal-and-unapproximated: "C (9)" (PDF.js's own text-layer
    capture includes the formula fragment "C" immediately preceding the equation number,
    proving endpoint resolution is robust to that without any special-casing). Coordinates,
    boundaryText, and direction below are ALL taken verbatim from the captured trace --
    never replace this with a hand-derived approximation again."""
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {
                "pageNumber": 3,
                "xNorm": 0.06668244949494949,
                "yNorm": 0.0905296762382944,
                "boundaryText": "The parameter C is a function of the regression slope ( ) and",
                "direction": "forward",
            },
            "end": {
                "pageNumber": 3,
                "xNorm": 0.48930795586069026,
                "yNorm": 0.21643718886455704,
                "boundaryText": "C (9)",
                "direction": "backward",
            },
        },
    )
    assert res.status_code == 200
    text = res.json()["reconstructedText"] or ""
    assert text == (
        "The parameter C is a function of the regression slope (b) and\n"
        "intercept (a)\n"
        "[式 (8)]\n"
        "and is introduced to the cosine correction model as an additive\n"
        "term\n"
        "[式 (9)]"
    )
    # The exact corruption reported live -- must never reappear.
    assert "( ) and" not in text
    assert "() and" not in text
    assert "\nb\n) and" not in text
    assert "( b )" not in text
    assert "C\n(8)" not in text
    assert "(8)" not in text or "[式 (8)]" in text
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_equation_nine_region_suppressed_no_leaked_formula_fragments(client):
    """Prototype 2.5K/2.5L Part B: the primary real target -- equation (9)'s TWO formula-
    body fragments ("C" above and "C" below the equation number, a numerator/denominator
    fraction) must never leak into prose. Confirmed BEFORE this fix (2.5K investigation) to
    reconstruct as "term\\nC\\nC\\n[式 (9)]\\n..."; must now be exactly "term\\n[式 (9)]\\n..."."""
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 3, "xNorm": 45 / 594, "yNorm": 145 / 792, "boundaryText": "term", "direction": "forward"},
            "end": {"pageNumber": 3, "xNorm": 200 / 594, "yNorm": 198 / 792, "boundaryText": "The parameter C is said to be analogous to the effects of dif-", "direction": "backward"},
        },
    )
    assert res.status_code == 200
    text = res.json()["reconstructedText"] or ""
    assert text == "term\n[式 (9)]\nThe parameter C is said to be analogous to the effects of dif-"
    assert "\nC\n" not in text
    assert text.count("[式") == 1
    client.post("/document/close", json={"documentId": document_id})


def test_soenen_equation_six_cross_continuation_recovers_all_glyphs(client):
    """Prototype 2.5I/2.5J: the real live-reported failure -- a selection dragged from prose
    BEFORE equation (6), through the equation, to prose AFTER it ("...using the equation" ->
    equation (6) -> "where Ln is the normalized radiance, a and b are the y-intercept and
    slope of the regression line, respectively, and Lavg is the average of the measured
    radiance data.") used to silently drop the equation number AND all the after-equation
    prose, reconstructing as "...using the equation is the average of the measured radiance
    data." (see docs/design-notes.md, Prototype 2.5I, for the full root-cause trace). This
    requires the real Paddle service running at http://127.0.0.1:8008, matching this file's
    existing convention for real-glyph-recovery fixtures -- not mocked, so the four
    additional real vector-only glyphs in this sentence (Ln, a, b, y, Lavg) are recovered
    end-to-end, exactly as in the real reported failure."""
    document_id = _register(client, SOENEN)
    res = client.post(
        "/layout/selection",
        json={
            "documentId": document_id,
            "start": {"pageNumber": 2, "xNorm": 310 / 594, "yNorm": 510 / 792, "boundaryText": "equation", "direction": "forward"},
            "end": {
                "pageNumber": 2,
                "xNorm": 460 / 594,
                "yNorm": 582 / 792,
                "boundaryText": "the average of the measured radiance data.",
                "direction": "backward",
            },
        },
    )
    assert res.status_code == 200
    text = res.json()["reconstructedText"] or ""
    assert text == (
        "equation\n[式 (6)]\nwhere\nLn\nis the normalized radiance,\na\nand\nb\nare the\ny\n"
        "-inter-\ncept and slope of the regression line, respectively, and\nLavg\nis\n"
        "the average of the measured radiance data."
    )
    # Item 22/23: nothing from the unrelated following sentence ("The rotation of the...").
    assert "The rotation of the" not in text
    assert "Minnaert" not in text
    client.post("/document/close", json={"documentId": document_id})


def test_visual_ink_threshold_separates_real_positives_from_real_false_positives(client):
    """Prototype 2.5E item 79: protects the empirical VISUAL_INK_CENTRAL_RATIO_THRESHOLD
    against real fixture data, not just synthetic numbers -- if a future change shifts the
    ratio calculation, this fails loudly instead of silently reintroducing either the 2.5B
    equation-number-adjacent contamination or the Failure A/B/MDPI false-positive
    regression. Coordinates are the exact real gaps measured in Prototype 2.5D."""
    document_id = _register(client, SOENEN)
    doc_state = main._get_document_state(document_id)
    width, height = 594.0, 792.0

    # Real positives (2.5D): k (both occurrences), e, theta, Ln (both occurrences).
    positive_gaps_pt = [
        (309.44, 237.68, 319.20, 247.64),
        (345.88, 225.56, 353.70, 235.52),
        (325.48, 138.98, 335.16, 148.94),
        (100.55, 470.90, 110.34, 480.86),
        (62.44, 458.78, 81.30, 468.74),
        (325.48, 552.68, 344.34, 562.64),
    ]
    for gap_pt in positive_gaps_pt:
        gap_norm = (gap_pt[0] / width, gap_pt[1] / height, gap_pt[2] / width, gap_pt[3] / height)
        ratio = main._render_gap_ink_ratio(doc_state.doc, 2, gap_norm, width, height)
        assert ratio > main.VISUAL_INK_CENTRAL_RATIO_THRESHOLD, f"real positive gap {gap_pt} unexpectedly below threshold ({ratio})"

    # Real false positives (2.5D): the actual page-wide suspiciousGaps that touch the real
    # Failure A selection's own line -- includes both the within-column word-split gaps and
    # the true cross-column gutter gaps found in 2.5D, all of which must read as no-ink.
    page1 = client.post("/layout/page", json={"documentId": document_id, "pageNumber": 1}).json()
    target_line = next(l for b in page1["blocks"] for l in b["lines"] if "Early photometric techniques developed to reduce t" in l["text"])
    tx0, ty0, tx1, ty1 = target_line["bbox"]
    touching = [
        g for g in page1["suspiciousGaps"]
        if (g["bbox"][1] <= ty1 and ty0 <= g["bbox"][3]) and (tx0 - 0.006 <= g["bbox"][2] and g["bbox"][0] <= tx1 + 0.006)
    ]
    assert len(touching) >= 3
    for g in touching:
        ratio = main._render_gap_ink_ratio(doc_state.doc, 1, tuple(g["bbox"]), width, height)
        assert ratio <= main.VISUAL_INK_CENTRAL_RATIO_THRESHOLD, f"real false-positive gap {g['bbox']} unexpectedly above threshold ({ratio})"

    client.post("/document/close", json={"documentId": document_id})


def test_mdpi_single_column_regression(client):
    """MDPI single-column known-good cross-page sentence, including the page-1-only DOI/
    journal footer (excluded by font-height difference via PyMuPDF's own native blocks)."""
    document_id = _register(client, MDPI)
    body = _select(
        client,
        document_id,
        start={"pageNumber": 1, "xNorm": 0.12857061262338806, "yNorm": 0.9031599021249807, "boundaryText": "This substitution works extremely well for remotely-sensed data because", "direction": "forward"},
        end={"pageNumber": 2, "xNorm": 0.12857061262338815, "yNorm": 0.10539059734644673, "boundaryText": "they contain extremely strong positive spatial autocorrelation; because of the form of the auto-normal", "direction": "backward"},
    )
    assert body["sameBlock"] is False
    text = body["reconstructedText"]
    assert text == "This substitution works extremely well for remotely-sensed data because\nthey contain extremely strong positive spatial autocorrelation; because of the form of the auto-normal"
    for polluted in ["doi:10.3390", "www.mdpi.com"]:
        assert polluted not in text
    client.post("/document/close", json={"documentId": document_id})
