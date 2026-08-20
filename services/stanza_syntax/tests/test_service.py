"""Prototype 2.6G1 -- tests for the Stanza syntax authority service.

Loads the real Stanza pipeline once (module-scoped) -- these are integration tests, not
mocked unit tests, matching services/pymupdf_layout's own test style. Requires the English
model to already be downloaded locally (see README.md).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main as service  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(service.app) as c:
        yield c


def test_health_reports_ready(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["engine"] == "stanza"
    assert body["modelReady"] is True
    assert body["stanzaVersion"]
    assert body["package"] == "default"


def test_analyze_schema_shape(client: TestClient) -> None:
    response = client.post("/analyze", json={"text": "The classifier detected anomalous pixels."})
    assert response.status_code == 200
    body = response.json()
    assert "tokens" in body
    assert len(body["tokens"]) > 0
    for token in body["tokens"]:
        for key in ("id", "text", "lemma", "upos", "head", "deprel", "start", "end", "feats"):
            assert key in token
        assert isinstance(token["id"], int)
        assert isinstance(token["start"], int)
        assert isinstance(token["end"], int)
        assert token["start"] < token["end"]


def test_feats_exposes_verb_form(client: TestClient) -> None:
    # Prototype 2.6G2.6C6A -- the Tree layer's shared-auxiliary compatibility gate reads
    # VerbForm out of this field; confirm it is actually forwarded (not silently null) for an
    # ordinary finite/participle pair, and that a function word with no morphology (a
    # coordinating conjunction) legitimately serializes `feats` as null rather than omitting
    # the key entirely.
    text = "The data were collected and analyzed."
    tokens = client.post("/analyze", json={"text": text}).json()["tokens"]
    collected = next(t for t in tokens if t["text"] == "collected")
    analyzed = next(t for t in tokens if t["text"] == "analyzed")
    and_token = next(t for t in tokens if t["text"] == "and")
    assert collected["feats"] is not None and "VerbForm=Part" in collected["feats"]
    assert analyzed["feats"] is not None and "VerbForm=Part" in analyzed["feats"]
    assert and_token["feats"] is None


def test_source_offsets_are_exact(client: TestClient) -> None:
    text = "The classifier detected anomalous pixels."
    response = client.post("/analyze", json={"text": text})
    tokens = response.json()["tokens"]
    for token in tokens:
        assert text[token["start"] : token["end"]] == token["text"]


def test_root_token_has_zero_head(client: TestClient) -> None:
    text = "The classifier detected anomalous pixels."
    tokens = client.post("/analyze", json={"text": text}).json()["tokens"]
    roots = [t for t in tokens if t["deprel"] == "root"]
    assert len(roots) == 1
    assert roots[0]["head"] == 0


def test_unicode_equation_placeholder_grounding(client: TestClient) -> None:
    # Prototype 2.6G1 hard requirement (section 6): must not reproduce the corrupted-glyph
    # class of bug seen with the CJK equation placeholder over a naive subprocess stdin pipe.
    text = "The normalized score, defined by [式 (3)], approaches unity under ideal conditions."
    response = client.post("/analyze", json={"text": text})
    assert response.status_code == 200
    tokens = response.json()["tokens"]
    for token in tokens:
        assert text[token["start"] : token["end"]] == token["text"], token
    joined_texts = {t["text"] for t in tokens}
    assert "式" in joined_texts or any("式" in t for t in joined_texts)
    # The two known regression symptoms from the earlier subprocess-pipe bug: a truncated
    # "approaches"/"unity" caused by an off-by-one offset drift after the corrupted glyph.
    approaches = next(t for t in tokens if t["text"] == "approaches")
    unity = next(t for t in tokens if t["text"] == "unity")
    assert text[approaches["start"] : approaches["end"]] == "approaches"
    assert text[unity["start"] : unity["end"]] == "unity"


def test_ascii_and_punctuation_grounding(client: TestClient) -> None:
    text = 'Earlier audits reported similar inefficiencies (Chen et al. 2020; Osei et al. 2022).'
    response = client.post("/analyze", json={"text": text})
    tokens = response.json()["tokens"]
    for token in tokens:
        assert text[token["start"] : token["end"]] == token["text"]


def test_empty_text_is_rejected(client: TestClient) -> None:
    response = client.post("/analyze", json={"text": ""})
    assert response.status_code == 422


def test_whitespace_only_text_is_rejected(client: TestClient) -> None:
    response = client.post("/analyze", json={"text": "   "})
    assert response.status_code == 422


def test_missing_text_field_is_rejected(client: TestClient) -> None:
    response = client.post("/analyze", json={})
    assert response.status_code == 422


def test_service_reports_not_ready_without_crashing(client: TestClient) -> None:
    original_pipeline = service._state["pipeline"]
    service._state["pipeline"] = None
    try:
        response = client.post("/analyze", json={"text": "hello"})
        assert response.status_code == 503
        health = client.get("/health").json()
        assert health["status"] == "error"
        assert health["modelReady"] is False
    finally:
        service._state["pipeline"] = original_pipeline
