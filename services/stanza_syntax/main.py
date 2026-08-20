"""Prototype 2.6G1 -- local Stanza syntax authority service (production).

Scope: raw Stanza dependency parse only, source-grounded to the exact input text. Paper
Grammar Tutor's own five-pattern (S/V/O/C) semantics -- ClauseFrame, PredicateFrame,
SentenceCoreSet -- are deliberately NOT computed here; that logic lives in the TypeScript
domain layer (src/features/grammar/domain/stanzaSyntaxAuthority.ts), which was ported from
the frozen benchmark hierarchical adapter (Prototype 2.6F, commit da6cb57). This service's
only job is: text in, source-grounded dependency tokens out.

Local-only by design, matching services/pymupdf_layout/main.py and services/paddle_ocr/
main.py's own conventions: binds 127.0.0.1 for local dev, 0.0.0.0 inside the Docker
container (never reachable except via the compose network / published loopback port). No
sentence text is ever sent anywhere else.

Source-offset correctness (Prototype 2.6G1 hard requirement): earlier benchmark work found
that piping text through a Python subprocess's OS-locale-dependent stdin text mode could
corrupt non-ASCII characters (a CJK equation placeholder like the exact string
"[式 (7)]" was seen coming back with a corrupted glyph, e.g. rendered as "approaches" ->
"pproaches"-class truncation once the corrupted offsets propagated). FastAPI/Starlette reads
the HTTP request body as raw bytes and decodes it as UTF-8 per the JSON spec, regardless of
OS locale -- there is no stdin text-mode encoding involved at all -- so that whole class of
bug does not apply to this transport. `_ground_tokens` below re-derives every token's
start/end by scanning the ORIGINAL request text directly (never trusting Stanza's own
`start_char`/`end_char` blindly), which is the same defensive technique the frozen benchmark
extraction script (`stanzaRawEval.ts`) already used, so production and benchmark stay
mechanically comparable.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

import stanza
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

SERVICE_VERSION = "prototype-2.6g1"
STANZA_VERSION = stanza.__version__
STANZA_LANG = "en"
STANZA_PACKAGE = "default"  # resolves to the "combined" UD-English package + 1B-word charlm
STANZA_PROCESSORS = "tokenize,pos,lemma,depparse"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stanza_syntax")

ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

_state: dict[str, Any] = {"pipeline": None, "error": None}


def _load_pipeline() -> None:
    try:
        _state["pipeline"] = stanza.Pipeline(
            lang=STANZA_LANG,
            processors=STANZA_PROCESSORS,
            package=STANZA_PACKAGE,
            tokenize_no_ssplit=True,
            use_gpu=False,
            verbose=False,
        )
        _state["error"] = None
        logger.info("Stanza pipeline ready (stanza=%s, package=%s)", STANZA_VERSION, STANZA_PACKAGE)
    except Exception as exc:  # noqa: BLE001 -- reported via /health, not swallowed silently
        _state["pipeline"] = None
        _state["error"] = str(exc)
        logger.exception("Stanza pipeline failed to load")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _load_pipeline()
    yield


app = FastAPI(title="Paper Grammar Tutor - Stanza syntax authority service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    text: str


class Token(BaseModel):
    id: int
    text: str
    lemma: str | None
    upos: str | None
    head: int
    deprel: str
    start: int
    end: int
    # Prototype 2.6G2.6C6A -- raw UD morphological features string (e.g.
    # "Tense=Past|VerbForm=Part|Voice=Pass"), forwarded verbatim from Stanza's own `pos`
    # processor output (already computed as part of STANZA_PROCESSORS -- no new processor
    # needed). Consumed by the TypeScript Tree layer's shared-auxiliary compatibility gate;
    # this service still does no grammar interpretation of its own.
    feats: str | None = None


class AnalyzeResponse(BaseModel):
    tokens: list[Token]


def _ground_tokens(text: str, sentence) -> list[Token]:
    """Re-derive every token's start/end from the ORIGINAL text via forward scanning,
    mirroring the frozen benchmark's `alignTokensToSource` (stanzaRawEval.ts). Never trusts
    Stanza's own start_char/end_char blindly -- those are recomputed here as a fallback only
    when the forward scan cannot find the token's own text (e.g. a rare MWT split)."""
    tokens: list[Token] = []
    cursor = 0
    for word in (w for token in sentence.tokens for w in token.words):
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        found = text.find(word.text, cursor)
        if found < 0:
            found = text.find(word.text)
        if found >= 0:
            start = found
            end = found + len(word.text)
        else:
            # Fallback: trust Stanza's own char offsets (still whole Unicode codepoints in
            # Python -- there is no byte/codepoint confusion possible here since `text` and
            # every `word.text` are both native Python str).
            token = next(t for t in sentence.tokens if word in t.words)
            start = token.start_char if token.start_char is not None else cursor
            end = token.end_char if token.end_char is not None else start + len(word.text)
        tokens.append(
            Token(
                id=word.id if isinstance(word.id, int) else word.id[0],
                text=word.text,
                lemma=word.lemma,
                upos=word.upos,
                head=word.head,
                deprel=word.deprel,
                start=start,
                end=end,
                feats=word.feats,
            )
        )
        cursor = end
    return tokens


@app.get("/health")
def health():
    ready = _state["pipeline"] is not None
    payload = {
        "status": "ok" if ready else "error",
        "engine": "stanza",
        "serviceVersion": SERVICE_VERSION,
        "stanzaVersion": STANZA_VERSION,
        "lang": STANZA_LANG,
        "package": STANZA_PACKAGE,
        "modelReady": ready,
    }
    if not ready and _state["error"]:
        payload["error"] = _state["error"]
    return payload


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest):
    pipeline = _state["pipeline"]
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Stanza pipeline is not ready")
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=422, detail="text must be non-empty")

    doc = pipeline(request.text)
    if len(doc.sentences) == 0:
        return AnalyzeResponse(tokens=[])

    # tokenize_no_ssplit=True means the whole input is always treated as one sentence --
    # matches the frozen benchmark extraction (stanzaRawEval.ts), which only ever reads
    # docs[idx].sentences[0]. Only the first sentence is used, for exact parity.
    tokens = _ground_tokens(request.text, doc.sentences[0])
    return AnalyzeResponse(tokens=tokens)


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("PGT_STANZA_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=8010)
