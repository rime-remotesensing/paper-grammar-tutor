FROM python:3.12.3-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STANZA_RESOURCES_DIR=/root/stanza_resources

WORKDIR /app
COPY services/stanza_syntax/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt

# Deterministic model provisioning at build time (Prototype 2.6G1 section 8): the English
# "default" package (tokenize/pos/lemma/depparse + 1B-word charlm) is downloaded into the
# image itself, so a running container never needs network access or a manual
# `stanza.download(...)` step. Pinned to the exact package identity the service loads at
# runtime (see main.py STANZA_LANG/STANZA_PACKAGE) so a build-time download mismatch is
# impossible.
RUN python -c "import stanza; stanza.download('en', package='default', processors='tokenize,pos,lemma,depparse', verbose=False)"

COPY services/stanza_syntax/main.py ./main.py

EXPOSE 8010
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010"]
