# Third-Party Notices

Paper Grammar Tutorのプロジェクト独自コードは`AGPL-3.0-only`で公開されています。以下の第三者コンポーネントおよびアセットはAGPLへ再ライセンスされるものではなく、それぞれの上流ライセンスに従います。

この文書は、リポジトリが実際に再配布するアセットを対象としています。`npm install`または`pip install`で利用者が別途取得する依存パッケージの完全な一覧ではありません。

## PDF.js WebAssembly assets

- Component: PDF.js (`pdfjs-dist` 6.2.108)
- Upstream: <https://github.com/mozilla/pdf.js/tree/v6.2.108>
- Package: <https://www.npmjs.com/package/pdfjs-dist/v/6.2.108>
- License: Apache License 2.0。JBIG2、OpenJPEG、QCMS、QuickJSの組み込み部分には、以下の個別ライセンスも適用されます。
- Included files: `jbig2.wasm`, `jbig2_nowasm_fallback.js`, `openjpeg.wasm`, `openjpeg_nowasm_fallback.js`, `qcms_bg.wasm`, `quickjs-eval.js`, `quickjs-eval.wasm`
- Repository location: `public/pdfjs/wasm/`
- License location: `public/pdfjs/wasm/licenses/`

`public/pdfjs/wasm/`の実行アセットは、lockfileで固定された`pdfjs-dist` 6.2.108の対応ファイルと同一です。上流パッケージのライセンスファイルは改変せず保存しています。

Individual notices:

- PDF.js: Apache-2.0, `LICENSE_PDFJS`
- PDFium JBIG2: BSD-3-Clause; Copyright 2014 The PDFium Authors, `LICENSE_JBIG2`
- Mozilla PDF.js JBIG2 integration: Apache-2.0; Copyright 2026 Mozilla Foundation, `LICENSE_PDFJS_JBIG2`
- OpenJPEG: BSD-2-Clause and the copyright notices listed in `LICENSE_OPENJPEG`
- Mozilla PDF.js OpenJPEG integration: BSD-2-Clause; Copyright (c) 2024 Mozilla Foundation, `LICENSE_PDFJS_OPENJPEG`
- qcms: MIT; Copyright (C) 2009-2024 Mozilla Corporation and Copyright (C) 1998-2007 Marti Maria, `LICENSE_QCMS`
- Mozilla PDF.js QCMS integration: BSD-2-Clause; Copyright (c) 2025 Mozilla Foundation, `LICENSE_PDFJS_QCMS`
- QuickJS engine: MIT; Copyright (c) 2017-2021 Fabrice Bellard and Charlie Gordon, `LICENSE_QUICKJS`
- PDF.js QuickJS build/integration: MIT; Copyright (c) 2026 Mozilla Foundation, `LICENSE_PDFJS_QUICKJS`

## Tesseract.js worker

- Component: Tesseract.js 7.0.0
- Upstream: <https://github.com/naptha/tesseract.js/tree/v7.0.0>
- License: Apache License 2.0
- Included file: `public/tesseract/worker/worker.min.js`
- License: `public/tesseract/licenses/LICENSE_TESSERACT_JS`
- Bundled-code notices required by the minified worker: `public/tesseract/worker/worker.min.js.LICENSE.txt`

`worker.min.js`は、lockfileで固定された`tesseract.js` 7.0.0の`dist/worker.min.js`と同一です。参照先の`worker.min.js.LICENSE.txt`も同じパッケージから改変せず配置しています。同ファイルには、workerへ含まれるBuffer、ieee754、regenerator-runtime、zlib.jsのMITまたはBSD通知があります。

## Tesseract Core WebAssembly assets

- Component: Tesseract.js Core 7.0.0
- Upstream: <https://github.com/naptha/tesseract.js-core/tree/v7.0.0>
- License: Apache License 2.0
- Included files: `public/tesseract/core/`にあるLSTM用JavaScript/WASMの通常版、SIMD版、relaxed-SIMD版
- License: `public/tesseract/licenses/LICENSE_TESSERACT_CORE`

## English Tesseract trained data

- Component: `@tesseract.js-data/eng` 1.0.0, `4.0.0_best_int`
- Upstream: <https://github.com/naptha/tessdata>
- Published asset: <https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz>
- License: Apache License 2.0
- Included file: `public/tesseract/lang/eng.traineddata.gz`
- SHA-256: `143C5B0C5821573BA720B5C02BA5600D5C6CED935750F44633C44C23EC56A9A9`
- License: `public/tesseract/licenses/LICENSE_TESSDATA`

## Separately installed components

Ollama、`qwen2.5:7b-instruct`のモデルウェイト、PyMuPDF、PaddleOCR、PaddlePaddle、CUDA、cuDNN、NVIDIA DLL、Paddle model weightsは、このリポジトリには再配布されません。利用者がセットアップ手順に従って別途取得します。これらには各配布元のライセンスと利用条件が適用されます。

特に、PyMuPDF 1.28.2はGNU Affero General Public License v3またはArtifexの商用ライセンスで提供されます。本プロジェクトは公開ソース配布についてAGPLの経路を採用します。
