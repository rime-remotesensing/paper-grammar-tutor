# Paper Grammar Tutor

英語論文を読む日本語話者向けの、英文構造読解支援ツール。**翻訳ツールではない**。
目的は、利用者が英文の主語・動詞・修飾関係・節構造などを理解し、最終的に翻訳に頼らず
論文を読めるようになること。全文訳は初期状態では表示されず、折りたたみを開いたときのみ見える。

ローカルのPDF論文をブラウザで開き、PDF上で英文を選択し、その場でローカルOllamaによる
文法構造解析を確認できる（Prototype 1）。PDF本文・選択英文はOllama以外のどこへも送信しない。

## アーキテクチャ

```
UI (React)
  -> GrammarAnalyzer (src/features/grammar/domain)     … プロンプト構築・検証・repairを orchestrate
  -> LLMProvider interface (src/llm/types.ts)           … Ollama固有の型を知らない境界
       -> OllamaProvider (src/llm/providers/ollama)     … Ollamaの/api/chat, /api/tagsだけを知る実装
```

- **アプリとLLMを分離**: UI/ドメインロジックは `LLMProvider` インターフェースにのみ依存する。
  将来 Ollama 以外のバックエンドを追加する場合、`OllamaProvider` と同じ形の新しい実装を
  `src/llm/providers/` に追加するだけでよく、`GrammarAnalyzer` やコンポーネントは変更不要。
- **LLM出力を信用しない**: `GrammarAnalyzer.analyzeSentence` は
  「JSON parse → zod validation → 1回だけrepair → span検証・補正 → normalize」を必ず通す。
  検証に失敗してもアプリは落とさず、`needsMoreContext: true` の空の解析結果を返す
  (`src/features/grammar/domain/fallbackAnalysis.ts`)。
- **文字位置(start/end)はLLMを信用しない**: LLMが返す span の `text` を原文へ照合し直し、
  ずれていれば座標を補正、見つからなければ `uncertainties` に記録する
  (`src/utils/spanMatch.ts`, `src/features/grammar/domain/resolveAnalysisSpans.ts`)。
- **ローカル処理**: PDFファイルはブラウザ内で読み込むだけで、外部サーバーへアップロードしない。
  選択英文の解析対象送信先はローカルOllamaのみ。解析履歴・アノテーションの永続保存はまだ実装していない。
  Ollama の接続先は既定で `http://localhost:11434`。
- **PDF統合はGrammarAnalyzerを変更しない**: `src/features/pdf` はPDF.jsでの表示・テキストレイヤーからの
  選択・最小限の正規化のみを担当し、選択後の文字列を既存の`analyzeSentence`にそのまま渡す。
  PDF統合のためだけに文法解析ロジック（schema/prompt/derivePattern等）を変更していない。

## ディレクトリ構成

```
src/
  components/            アプリ全体で使う小さめのUI (接続状態, モデル選択)
  features/grammar/
    components/          文入力・解析結果表示のUI
    domain/               GrammarAnalyzer, span解決, フォールバック生成, derivePattern, モデルサイズ注意文
    schemas/               zodスキーマ（正）と、Ollamaのformatへ渡すJSON Schema（手書き・要同期）
  features/pdf/
    components/PdfViewer.tsx  PDF.js統合本体（読み込み・描画・ページ送り・zoom・text layer・選択）
    domain/                    scanned-PDF判定, viewer state reset, 選択文字列の構造化
    utils/pdfTextNormalize.ts  改行結合・ハイフネーション補正・空白正規化（最小限、section 9準拠）
  llm/
    types.ts              LLMProvider インターフェース（アプリ全体が依存する境界）
    providers/ollama/      Ollama固有の実装
    prompts/                プロンプト文言を一元管理
  config/settings.ts       Ollama URL / temperature / timeout / PDF zoom・scanned判定閾値などの定数
  utils/                   文字正規化, span照合, JSON抽出

tests/                    vitest（ロジックのみ。UIコンポーネントテストは未実装）
  fixtures/pdf/            自作のサンプルPDF（1段組み/2段組み、動作確認用。機密PDFは含めない）
benchmark/
  sentences/
    development.json      prompt/schema調整に使ってきた28文（development set。もはやholdoutではない）
    holdout.json           prompt/schema調整に一切使っていない57文（holdout set。goldはモデル出力を見る前に確定）
  run.ts                   development/holdoutを指定して複数モデルを比較実行するCLI
  baselines/prototype-0/   Prototype 0時点のベンチマーク結果（比較用に凍結、上書きしない）
  results/                 実行結果の出力先（gitignore対象、.gitkeepのみ追跡）
docs/design-notes.md       重要な設計判断の記録
```

## 必要環境

- Node.js 20+ (開発時は 24.19.0 で確認)
- [Ollama](https://ollama.com/) がローカルで起動していること
- 日本語文法説明・JSON構造化に使うモデル（例: `qwen2.5:3b-instruct`, `qwen2.5:7b-instruct`）

```bash
# Ollama側の準備（初回のみ）
ollama pull qwen2.5:7b-instruct    # 推奨（Prototype 0.2 holdout評価: constituent平均93%）
ollama pull qwen2.5:14b-instruct   # 任意。7Bより一貫して良いわけではない（docs/design-notes.md参照）
ollama pull qwen2.5:3b-instruct    # 任意・実験用。sentenceCore抽出が実質機能しないため通常は非推奨
```

推奨モデル: **7B級**。3B級はモデル選択時にUI上へ簡潔な注意を表示する（詳細は下記「既知の限界」）。
Ollama はデフォルトで `http://localhost:11434` で待ち受ける。アプリ画面右上の「Ollama URL」欄で変更可能。

## セットアップと起動

```bash
npm install
npm run dev
```

表示されたURL（既定 `http://localhost:5173`）を開く。画面上部でOllamaの接続状態とモデル一覧を確認し、
モデルを選ぶ。「ファイルの選択」からローカルのPDF（テキストレイヤー付き、スキャンPDF不可）を開き、
PDF上で英文をドラッグして選択すると右側の入力欄へ自動で入る（自動解析はしない）。内容を確認・修正して
から「解析」を押す。PDFを使わず、右側のテキスト欄に直接入力・「評価文から選択」
（`benchmark/sentences/development.json`）でも従来どおり解析できる。

## 検証コマンド

```bash
npm run typecheck   # tsc -b
npm run lint        # oxlint
npm run test        # vitest run
npm run build        # tsc -b && vite build
```

## モデル比較ベンチマーク

`--dataset` で development（prompt/schema調整に使ってきた28文）か holdout（未使用の57文）を選び、
指定したモデルすべてに対してアプリと同じ`GrammarAnalyzer`で解析する。既定は`development`。

```bash
npm run benchmark -- qwen2.5:7b-instruct,qwen2.5:14b-instruct --dataset development
npm run benchmark -- qwen2.5:7b-instruct,qwen2.5:14b-instruct --dataset holdout
npm run benchmark -- qwen2.5:3b-instruct --dataset holdout --base-url http://localhost:11434
```

集計する指標: 構造化出力の成功率・repair発生率・処理時間、subject/subjectHead/verb/indirectObject/object
の一致率、complementはsubject complement（SVC相当）とobject complement（SVOC相当）に分けて集計、
pattern(derived)はアプリが導出した値とgoldの一致率。一致率判定はgoldテキストとの正規化後の完全一致/
部分一致による簡易評価であり、精緻な自動採点ではない。

patternはLLMではなくアプリが `derivePattern.ts` で導出するため「pattern engine accuracy」とは呼ばない。
patternが不一致だった場合、原因となったconstituentフィールド(verb/indirectObject/object/complement)を
summary.mdに集計する。

**節(clauses)の種類・役割・修飾語の attachment 先は自動採点していない**（安全に自動採点できないと判断
したため）。各文のJSON出力にgoldとモデル解析結果を並べて出力するので、人間によるレビューを想定している。
`ambiguous: true` の文についても、単一の正解を強制せず、モデルが不確実性（needsMoreContext/confidence/
uncertainties）を示せたかを`ambiguityAwareness`として記録するのみで、正誤判定はしていない。

結果は `benchmark/results/<timestamp>-<dataset>/` に、モデルごとのJSON（全項目・生の解析結果込み）と
`summary.md`（比較表）として出力される。

## PDF機能について

- 対応: ローカルPDFファイルの読み込み・ページ表示・前後ページ移動・zoom in/out・テキストレイヤーからの
  選択。選択は自動解析を開始しない（誤選択で無駄にLLMを実行しないため）。選択された文字列は
  改行結合・行末ハイフネーション補正・空白正規化のみ行った上で右側のテキスト欄に表示し、解析前に
  手動編集できる（PDF抽出には不要な改行やハイフネーションの乱れがあるため）。
- 非対応: pure scan PDF（テキストレイヤーがないPDFはエラー表示。テキストレイヤーはあるが品質が低い
  PDFについては、下記のOCR fallbackで手動の読み直しができる）、複数カラムのreading-order自動復元
  （選択範囲をそのまま解析対象にする。カラムをまたいだ不自然な選択でもアプリは落ちない）、前後文の
  自動取得、解析履歴・注釈の永続保存。
- 別のPDFを開くと、選択中の英文・解析結果は破棄される（異なる論文の解析結果が残り続けないように）。
- JBIG2/JPEG2000形式で画像化された古いスキャンPDF（デジタル化された複写論文などで多い）を正しく
  描画するため、`pdfjs-dist`本体の`wasm/`リソース一式を`public/pdfjs/wasm/`にコピーして同梱している
  （`src/config/settings.ts`の`PDF_WASM_URL`が参照）。`pdfjs-dist`をアップデートした場合は、
  以下のコマンドで再コピーすること（バージョンが古いままだと、この種のPDFだけ本文ページが
  真っ白に描画される問題が再発する）。
  ```bash
  cp node_modules/pdfjs-dist/wasm/*.wasm node_modules/pdfjs-dist/wasm/*.js public/pdfjs/wasm/
  ```

## OCR fallback（Prototype 1.2）について

embedded text layerを持つPDFで、そのtext layer自体の品質が低い場合（古い複写スキャン論文などで、
数字・小数点・`μm`のような単位記号が誤認識されていることがある）向けの、手動のOCR再読み込み機能。

- **常にlocal-only**。PDF本文・画像を外部へ送信することはない。OCRエンジンは
  [Tesseract.js](https://github.com/naptha/tesseract.js) `7.0.0`（`tesseract.js-core`
  同梱バージョン）を使用し、worker script・WASM core・英語traineddataのすべてを
  `public/tesseract/`配下から同一originで配信する（Tesseract.jsの既定はjsDelivr CDNから
  取得するため、`createWorker`の`workerPath`/`corePath`/`langPath`を明示的にlocalへ上書きしている。
  `src/features/ocr/domain/ocrService.ts`参照）。
- **完全にユーザー操作時のみ実行**。「OCRで読み直す」ボタンを押すまで、OCR workerの初期化も
  言語データの読み込みもページのOCRも一切行わない。通常のembedded text layer選択フローは
  従来どおり変更していない。
- 方式は **page-wide OCR + spatial extraction**（フィージビリティ検証はPrototype
  1.2A〜1.2Cを参照、`docs/design-notes.md`）。選択領域だけを直接OCRする方式は精度が
  明確に悪化したため不採用。実際には、選択したページ全体をscale=2xで一度だけOCRし
  （同一ページ・同一PDF内であれば2回目以降はキャッシュを再利用してOCRを再実行しない）、
  OCRが返す単語ごとのbounding boxと、PDF選択範囲の`Range.getClientRects()`（幽霊rectを除外し、
  複数行でも1つのbounding boxへ統合しない）を空間的に照合して、選択範囲に対応する単語だけを
  抽出する。
- **raw OCRは完全ではない**。実測では、`μm`のような単位記号はembedded textよりOCRの方が
  読みやすくなる一方、小数点の表記（原文の中黒`·`など）はembedded textの方が正確なケースが
  あった。OCR候補を無条件に正解として扱わないこと。
- ローカルアセットの出所:
  - `public/tesseract/worker/worker.min.js` ← `node_modules/tesseract.js/dist/worker.min.js`
  - `public/tesseract/core/*` ← `node_modules/tesseract.js-core/tesseract-core*-lstm.wasm.js`
    （LSTM-onlyエンジン用。plain/SIMD/RelaxedSIMDの3種類を同梱し、Tesseract.js側の
    feature detectionで実行時に選択させている。非LSTM系Legacy engine用ファイルは同梱していない）
  - `public/tesseract/lang/eng.traineddata.gz` ← Tesseract.jsの既定CDN
    （`https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`、
    LSTM-onlyモデル）から取得したものと同一系統のtraineddataを、このリポジトリでgzip圧縮して同梱
    （生データはPDF本文ではなく汎用の英語言語モデルであり、本文送信の禁止事項には抵触しない）。
  - `tesseract.js`/`tesseract.js-core`をアップデートした場合は、上記コピー元から再コピーすること。
  - **Greek（`ell`）等の追加言語traineddataは使用していない**（Prototype 1.2Dで比較検証した結果、
    English proseの認識精度を明確に悪化させる一方でμm認識の改善効果がなかったため不採用。
    `public/tesseract/lang/`はengのみを維持する）。

### Scientific notation候補（Rule A / Rule B）

OCR結果・embedded text双方に対して、**極めて限定的な**scientific notation候補を独立した
第3・第4候補として表示する（`src/features/ocr/domain/scientificNormalization.ts`）。いずれも
**候補のみ**であり、自動補正・自動反映は行わない。ユーザーがボタンを押すまでtextareaは変更されず、
raw embedded text・raw OCR textは常にそのまま別枠で表示され続ける。

- **Rule A（小数点表記の候補）**: embedded text自身が`digit·digit`（例: `0·8`）を含む場合のみ対象。
  さらに、同一空間位置にあるOCR側wordの数字列が一致する場合のみ（cross-validation）、
  `·`を`.`に正規化した候補を生成する（`0·8`→`0.8`）。OCR側だけが`0-8`のような表記を返した場合に
  decimalへ変換することは**絶対にしない**（trigger authorityは常にembedded text自身の literal
  "·"）。`2-5`や`1775-1795`のような実在のhyphen/range表記は、そもそも"·"を含まないため対象外。
  OCR自体が失敗した場合はRule A候補も生成しない（cross-validationができないため）。
- **Rule B（単位表記の候補）**: OCR word列の中で、対象wordが**厳密に**`"um"`と一致し、かつ直前の
  wordが数量らしい表記（`1`、`2.5`、`0-8`等）である場合のみ、`um`→`μm`に変換した候補を生成する。
  `ym`/`jum`/`pm`/`nm`等、`"um"`以外のトークンには一切触れない。文末の`"um."`のように句読点が
  同じトークンへ結合されている場合は対象外（厳密一致条件のため）。
- 両ruleとも、5本の実PDF（scan PDF 1本＋Springer/Elsevier/IEEE/arXivの計4本）でfalse positive
  0件を確認した上で採用（Prototype 1.2E）。

### 現時点の限界

- 選択が単語境界からずれている場合、境界の単語が欠落する可能性がある（通常の文単位selectionでは
  未確認）。
- Rule Aは、embedded text自体が既に破損している箇所（例: 本来`0.4`のはずが埋め込み時点で
  `0-4`になっているケース）を復元できない。
- Rule Bは、対象の`"um"`トークンに句読点が結合されている場合（文末など）に候補を生成しない。
  - **text layerを持たないpure scan PDF（画像のみのPDF）はまだ対象外**。現状は
    `hasExtractableText`判定でエラー表示のままであり、OCR fallbackはembedded text layerが
    存在するPDFの補助としてのみ機能する。

## 既知の限界

Prototype 0.2のholdout評価（未使用の57文、詳細は`docs/design-notes.md`）で判明した、現時点の
文法解析エンジンの既知の限界:

1. **SVOOとto/for句の区別を誤る場合がある**（例: "gives feedback to the students"の"to the students"を
   誤って`indirectObject`として扱う、または"gives the students feedback"の二重目的語を1つの`object`に
   結合してしまう）。
2. **complementを見落とす場合がある**（本来SVC/SVOCの補語があるべき場面で`complement`をnullのまま返す）。
3. **曖昧なmodifier attachmentを単一解釈として断定する場合がある**（意図的に複数解釈可能な文でも、
   不確実性を示さず1つの読みだけを高い確信度で返すことがある）。
4. AIによる文法解析であり、常に正しいとは限らない。重要な判断には利用者自身の読解と併用すること。

これらはPrototype 1の実装を妨げるものとは扱っていない（既知の制約として記録し、精度改善は別フェーズで
行う）。UI下部にも簡潔な注意文を常時表示している。

## Prototype 1 の範囲外

Pure scan PDF（text layerなし画像のみのPDF）向けOCR・Zotero連携・Anki連携・クラウドLLM・RAG・vector DB・論文要約・論文QA・PDF全文翻訳・
複数PDF同時利用・注釈の永続保存・ユーザーアカウント・バックエンドサーバー・DB・dependency parser等の
NLPパーサー併用・デスクトップアプリ化・解析/PDF履歴機能は、この段階では未実装。
