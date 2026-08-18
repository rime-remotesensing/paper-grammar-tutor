import json
import sys
from typing import Any

import stanza


def main() -> int:
    payload = json.load(sys.stdin)
    sentences = payload.get("sentences", [])
    lang = payload.get("lang", "en")

    nlp = stanza.Pipeline(
        lang=lang,
        processors="tokenize,pos,lemma,depparse",
        tokenize_no_ssplit=True,
        use_gpu=False,
        verbose=False,
    )

    docs_out: list[dict[str, Any]] = []
    for text in sentences:
        doc = nlp(text)
        sent_out: list[dict[str, Any]] = []
        for sent in doc.sentences:
            tokens_out: list[dict[str, Any]] = []
            for token in sent.tokens:
                for word in token.words:
                    tokens_out.append(
                        {
                            "text": word.text,
                            "lemma": word.lemma,
                            "upos": word.upos,
                            "head": word.head,
                            "deprel": word.deprel,
                            "id": word.id,
                            "start": token.start_char,
                            "end": token.end_char,
                        }
                    )
            sent_out.append({"tokens": tokens_out})
        docs_out.append({"sentences": sent_out})

    json.dump({"docs": docs_out}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
