import json
import sys
from typing import Any

import spacy


def main() -> int:
    payload = json.load(sys.stdin)
    model = payload.get("model", "en_core_web_sm")
    sentences = payload.get("sentences", [])
    cleaned_sentences = [s.encode("utf-8", errors="replace").decode("utf-8") for s in sentences]

    nlp = spacy.load(model)
    docs = list(nlp.pipe(cleaned_sentences))

    out_docs: list[dict[str, Any]] = []
    for doc in docs:
        tokens = []
        for t in doc:
            tokens.append(
                {
                    "i": t.i,
                    "text": t.text,
                    "lemma": t.lemma_,
                    "pos": t.pos_,
                    "tag": t.tag_,
                    "dep": t.dep_,
                    "head": t.head.i,
                    "start": t.idx,
                    "end": t.idx + len(t.text),
                }
            )
        out_docs.append({"tokens": tokens})

    json.dump({"model": model, "docs": out_docs}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
