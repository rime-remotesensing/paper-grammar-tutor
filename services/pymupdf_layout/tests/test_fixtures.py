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
