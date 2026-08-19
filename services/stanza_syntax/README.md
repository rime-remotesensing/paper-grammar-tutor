# Stanza syntax authority service (Prototype 2.6G1)

Local-only HTTP wrapper around Stanford Stanza's English dependency parser. Produces
source-grounded dependency tokens only -- no Paper Grammar Tutor five-pattern (S/V/O/C)
semantics. That conversion (`ClauseFrame` -> `PredicateFrame` -> `SentenceCoreSet`) lives in
`src/features/grammar/domain/stanzaSyntaxAuthority.ts`, ported from the frozen benchmark
hierarchical adapter (Prototype 2.6F, commit `da6cb57`).

## Why a separate service (not folded into pymupdf-layout/paddle-ocr)

Stanza previously produced a protobuf/environment compatibility warning when its
dependencies were considered alongside the existing PDF-extraction services' own pinned
dependency sets. Rather than risk a dependency conflict for convenience, Stanza gets its own
container with its own pinned `requirements.txt`.

## Pinned versions

- Python 3.12.3 (matches the other local services)
- `stanza==1.14.0`
- English package: `lang="en", package="default"` (resolves to the "combined" UD-English
  models + 1-billion-word character LM) -- this is the exact package identity used to
  generate every frozen benchmark artifact (development 48 / former holdout 24 /
  BLIND_HOLDOUT_V2 24), so production parity depends on not changing it without re-running
  the 96-case parity test.
- `fastapi==0.141.1`, `uvicorn==0.52.3`

## API

`GET /health` -> `{status, engine, serviceVersion, stanzaVersion, lang, package, modelReady}`

`POST /analyze` body `{"text": "..."}` -> `{"tokens": [{id, text, lemma, upos, head, deprel,
start, end}, ...]}`. Source offsets are re-derived from the original request text via
forward scanning (never trusted blindly from Stanza's own `start_char`/`end_char`), matching
the frozen benchmark's own `alignTokensToSource`. `422` on empty/missing text, `503` if the
pipeline failed to load.

## Model distribution

The English model is downloaded at Docker **build** time (`docker/stanza-syntax/Dockerfile`
runs `stanza.download(...)` during the image build), not at first container start. A running
container never needs network access and never depends on a cloud API. Users never run
`pip install` / `stanza.download(...)` manually.

## Running locally (outside Docker)

```
pip install -r requirements.txt
python -c "import stanza; stanza.download('en', package='default', processors='tokenize,pos,lemma,depparse')"
python main.py
pytest
```

## Local-only / security

Binds `127.0.0.1` outside Docker, `0.0.0.0` inside the container (only reachable via the
compose network / the published loopback port, same as every other local service in this
project). CORS restricted to the Vite dev origins. Sentence text is never sent anywhere
except this local process.
