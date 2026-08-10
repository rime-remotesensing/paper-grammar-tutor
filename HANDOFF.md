# HANDOFF — Paper Grammar Tutor

**この文書だけを読めば、過去の会話履歴が一切ない別PC・別のClaude Codeセッションでも
プロジェクトを正確に理解し、作業を再開できることを目的としている。**

現在の正式な到達点: **Prototype 0 → Prototype 0.1 → Prototype 0.2 → Prototype 1 → Prototype 1.1
まで完了**。**Prototype 1.1のステータスは PASS WITH KNOWN LIMITATIONS**（詳細はJ章）。
次のタスクは **Prototype 2 — Progressive Reading Tutor**（設計案は提示済み、実装は未着手）。

作成日: 2026-08-09。2026-08-10にPrototype 1.1完了に伴い更新。以下の内容はすべて、更新時点で
実際のコード・README・docs・`benchmark/`配下の結果ファイル・Git履歴を確認して書いている
（推測での補完はしていない）。

---

## A. プロジェクトの目的

**Paper Grammar Tutor**は、英語論文を読む日本語話者向けの英文構造読解支援ツール。

設計思想（最重要）:

- **翻訳ツールではない**。目的は「利用者が英文の構造を理解し、最終的には翻訳に依存せず、自力で
  英語論文を読めるようになること」。
- **全文訳は初期状態では絶対に表示しない**。参考訳はユーザーが明示的に開いた場合のみ表示する
  （UI上は折りたたみ`<details>`で閉じた状態がデフォルト）。
- 表示順序は「文の骨格 → 意味のまとまり → 修飾関係 → 節 → 熟語・定型表現 → 重要単語 →
  読み方のヒント → ユーザー自身の解釈（メモ） → 参考訳」の段階的な支援とする。
- ローカル処理を重視: PDF本文・選択英文はOllama以外のどこにも送信しない。標準のOllama接続先は
  `http://localhost:11434`。
- アプリとLLMを分離する設計（`LLMProvider`インターフェース経由。詳細はE章）。
- LLM出力を無条件に信用しない（structured output → schema validation → 正規化・検証 → UI、
  という一方向の流れを必ず通す）。

---

## B. 現在の開発段階

### Prototype 0 — 英文法解析エンジンの技術検証
- **目的**: PDF機能なしで、ローカルLLM（Ollama）による英文法解析がそもそも実用になるかを検証する。
- **実施内容**: React+TS+Vite最小構成、`LLMProvider`/`OllamaProvider`/`GrammarAnalyzer`/
  zod schema/Ollama structured output(JSON Schema)/repair機構/span再照合を実装。評価用英文28文
  （`benchmark/sentences/development.json`、現在の名称。当時は`dataset.json`）を作成し、
  3B/7Bモデルで初回ベンチマーク。
- **重要な知見**: structured output自体は3B/7Bとも非常に安定（28/28件成功）。ただし3Bは
  `sentenceCore.subject`をほぼ常にnullで返し`clauses`へ情報を逃がす、7Bはsubject/verbは
  改善するがobject/complement/patternに問題が残る、という精度面の課題が判明。
- **最終判断**: B（prompt/schemaを改善して再評価すべき）を選択し、Prototype 0.1へ進んだ。

### Prototype 0.1 — Grammar Analysis Accuracy Refinement
- **目的**: JSON形式の安定化ではなく、文法解析内容そのものの正確性改善。
- **実施内容**: (1) `sentenceCore.pattern`をLLM回答から削除し、アプリ側`derivePattern.ts`が
  S/V/indirectObject/O/Cの有無から機械的に導出する方式へ変更。(2) SVOO表現のため
  `sentenceCore.indirectObject`を追加。(3) `Clause.role`（自由記述）を
  `grammaticalRole`(enum) + `roleExplanation`(自由記述日本語)に分離。(4) プロンプトに
  用語定義（特にcomplementは5文型のCのみ、前置詞句や副詞は含まない）と最小限のfew-shot例を追加。
  (5) 14Bモデルを新規評価に追加。
- **重要な知見**: 最初に書いた詳細版プロンプト（約90行）は7Bのsubject/verb精度をbaseline比で
  **悪化**させた（100%→61%、93%→61%）。約45行に圧縮したところ大幅に回復（82%/86%）。
  「プロンプトは長ければ良いわけではない」という教訓（`docs/design-notes.md`に詳細記録）。
  3Bはプロンプト改善後も改善せず、最終的に28/28文でsentenceCoreが崩壊。
- **最終判断**: 7B級を最低推奨モデルとする方針を確認しつつ、B/Cの継続検討を提示。

### Prototype 0.2 — Generalization & Evaluation Hardening
- **目的**: prompt/schemaのさらなるチューニングではなく、**未知の英文への一般化**を検証する。
- **実施内容**: 既存28文を`development set`と明示的にラベル付け（`development.json`へ改名）。
  新規57文の`holdout set`（`benchmark/sentences/holdout.json`）を、モデル出力を一切見ずに
  gold先行確定で作成。`benchmark/run.ts`に`--dataset development|holdout`を追加し、
  Prototype 0.1で確定したprompt/schemaを**変更せずに1回だけ**holdoutを評価。
  評価指標をsubject/subjectHead/verb/indirectObject/objectの個別精度、complementを
  subject complement(SVC)/object complement(SVOC)に分割、pattern不一致の原因を
  constituentフィールドへ帰属させる形に拡張。節・修飾語のattachmentは安全に自動採点できないと
  判断し人間レビュー対象とした。
- **重要な知見**: 7Bはholdoutの方がdevelopmentより**高精度**という意外な結果（constituent平均
  81%→93%）。development setで壊れていたellipsis/inversionの一部は、holdoutの類似カテゴリでは
  正しく解析できており、「カテゴリ全般の弱さ」ではなく特定文の難しさだったと判明。一方
  complementの誤りの"種類"はdevelopmentとholdoutで逆転（development=過剰検出、holdout=見落とし）。
  SVOOのto/for句パラフレーズとの区別は7B/14Bとも依然弱い。14Bは7Bを一貫して上回らなかった。
  詳細数値はC章参照。
- **最終判断**: B（deterministic post-processingを主軸に、prompt/schemaの次サイクル改善を併用）
  を提示したが、ユーザー判断により「技術検証はここで完了」としてPrototype 1へ進むことになった。

### Prototype 1 — PDF Reader Integration
- **目的**: 実際の英語論文PDFを読みながら、選択英文をPrototype 0.2のGrammarAnalyzerで
  同じ画面内で解析できるかを検証する（新しい解析アルゴリズム開発ではない）。
- **実施内容**: `pdfjs-dist`(v6)による自作の最小PDF Viewer（`PdfViewer.tsx`）を実装。
  ローカルPDF読み込み・ページ表示・前後ページ・zoom・text layerからの選択・選択文字列の
  正規化（改行結合・行末ハイフネーション補正・空白正規化）・手動編集・「解析」ボタンによる
  明示的実行（選択だけでは自動解析しない）を実装。`src/features/grammar/**`
  （GrammarAnalyzer/schema/prompt/derivePattern）は**無変更**。3B/7B/14Bの推奨度をUIへ
  軽量表示（`modelSizeAdvisory.ts`、モデル名ハードコードなしのサイズ正規表現ベース）。
  自作の1段組み・2段組みサンプルPDF（`tests/fixtures/pdf/`）で実機検証し、同一ファイル
  再選択時に状態がリセットされないバグを発見・修正済み。
- **重要な知見**: 実機検証（1段組み/2段組み/スキャンPDF疑似/zoom/ページ送り/解析フロー）は
  すべて成功。数式・脚注・複雑な段組みを含む実際の論文PDFでの網羅的検証はまだ行っていない。
- **最終判断**: A（Prototype 1として十分）。完了条件21項目すべて満たす。次はPrototype 1.1へ
  （G章参照）。

---

## C. Prototype 0〜0.2のLLM評価（実ファイルから確認した数値）

### 3B (`qwen2.5:3b-instruct`) — experimental / 非推奨

Prototype 0.1以降、プロンプト改善を経ても改善せず、development/holdout双方で
**sentenceCoreが実質機能しない**ことを確認（`benchmark/results/2026-08-09T09-15-00-870Z/`
以降のすべての最終run、`benchmark/baselines/prototype-0/summary.md`と比較して悪化）。

最終holdout結果（`benchmark/results/2026-08-09T09-47-44-735Z-holdout/` + 3B再実行分
`2026-08-09T10-04-55-916Z-holdout/`、57文）:

| 指標 | 値 |
|---|---|
| structured-output success | 86%（他は100%） |
| subject | **0%** |
| subjectHead | **0%** |
| verb | **0%** |
| object | 35% |
| constituent average | 42% |
| pattern (derived) | 0% |

3Bは57/57文で`sentenceCore`が空（subject/verb等すべてnull）になり、代わりに`clauses`へ
`grammaticalRole:"subject"`のような形で情報を逃がす挙動が、development/holdout双方で確認された。
日本語指定の`roleExplanation`等に英語が混入する例も複数あり。**現在は非推奨**。

### 7B (`qwen2.5:7b-instruct`) — recommended baseline

**Prototype 0.2 holdout（57文、未使用の新規英文、`benchmark/results/2026-08-09T09-47-44-735Z-holdout/summary.md`より）**:

| 指標 | 値 |
|---|---|
| structured-output success | 100% |
| regeneration rate | 0% |
| 平均処理時間 | 5945ms |
| **subject** | **98%** |
| **subjectHead** | **96%** |
| **verb** | **95%** |
| indirectObject | 96% |
| **object** | **86%** |
| subject complement (SVC, n=20) | 85% |
| object complement (SVOC, n=37) | 92% |
| **constituent average** | **93%** |
| **pattern (derived)** | **77%** |

development（28文、prompt/schema調整に使用済み、`benchmark/results/2026-08-09T09-38-49-390Z-development/summary.md`より）: subject 82% / verb 86% / object 71% / constituent avg 81% / pattern(derived) 54%。

→ **holdoutの方がdevelopmentより高精度**という結果が出ている（D章・design-notes.md参照）。

### 14B (`qwen2.5:14b-instruct`) — optional / 7Bを一貫して上回らず

holdout: subject 81% / subjectHead 81% / verb 79% / object 77% / constituent average 82% /
pattern(derived) 60%。development: subject 64% / verb 64% / constituent avg 75% /
pattern(derived) 46%。

**7Bより一貫して優れているわけではない**（特にsubject/verbはholdout・developmentとも7Bより低い）。
処理時間も最長（holdout平均9044ms）。→ **optional扱い**、7Bが依然としてrecommended baseline。

---

## D. development / holdoutの扱い（重要・今後の作業者は必読）

- **development**（`benchmark/sentences/development.json`、28文）: Prototype 0 / 0.1で
  **prompt/schema設計の判断に使用済み**。今後これを「純粋なholdout（未見）test set」として
  扱ってはいけない。あくまで「意図した振る舞いを維持しているか」の回帰確認用。
- **holdout**（`benchmark/sentences/holdout.json`、57文）: Prototype 0.2で初めて評価したが、
  **その結果はすでに人間（このプロジェクトの担当者）が確認済み**。したがって、今後この57文を
  参照してprompt/schema/few-shotを調整した場合、この57文は「一度も見ていないholdout」では
  なくなる。
- **結論**: 将来さらにprompt/schemaを改善したいときは、developmentともholdout(57文)とも異なる、
  **新しい未見のtest setを別途作成する必要がある**。57文をそのまま「次の最終評価」に使い回さない。
- Prototype 1.1（次のタスク）では、そもそもprompt/schemaを変更しない方針のため、この制約は
  直接関係しないが、将来Prototype 2以降で解析精度改善に戻る場合は必ず意識すること。

---

## E. 現在の文法解析アーキテクチャ

```
ユーザー入力 or PDF選択
  → GrammarAnalyzer.analyzeSentence()          (src/features/grammar/domain/GrammarAnalyzer.ts)
      → buildGrammarAnalysisPrompt()            (src/llm/prompts/grammarAnalysisPrompt.ts)
      → LLMProvider.generateStructured()        (src/llm/types.ts … インターフェース)
          → OllamaProvider                       (src/llm/providers/ollama/OllamaProvider.ts)
             Ollamaの /api/chat へ、format=GRAMMAR_ANALYSIS_JSON_SCHEMA を渡す
                                                  (src/features/grammar/schemas/grammarAnalysis.jsonSchema.ts)
      → JSON parse → llmGrammarAnalysisSchema (zod) で validation
                                                  (src/features/grammar/schemas/grammarAnalysis.schema.ts)
      → 失敗時は buildRepairPrompt() で1回だけ repair
      → resolveAnalysisSpans()                   (src/features/grammar/domain/resolveAnalysisSpans.ts)
         LLMが返した span の text を原文へ再照合し、start/end を検証・補正
      → attachDerivedPattern() / derivePattern()  (src/features/grammar/domain/derivePattern.ts)
         S/V/indirectObject/O/C の有無から SV/SVC/SVO/SVOO/SVOC/other を機械的に導出
         （LLMはpatternを一切出力しない）
      → 検証・repairとも失敗した場合は buildFallbackAnalysis() で安全な空解析を返す
                                                  (src/features/grammar/domain/fallbackAnalysis.ts)
  → GrammarAnalysis を UI へ
      → AnalysisResultPanel.tsx                  (src/features/grammar/components/)
```

主要な型・enum:

- `Span { text, start, end }` — すべての抽出箇所の共通表現。
- `SentenceCore { subject, subjectHead, verb, indirectObject, object, complement, pattern }`
  — `pattern`のみアプリが後付けする派生フィールド（LLM出力の型`LlmSentenceCore`には存在しない）。
- `Clause { span, kind, grammaticalRole, roleExplanation }` —
  `grammaticalRole`はenum(`subject|object|complement|modifier|adverbial|apposition|other`)で
  構造データ、`roleExplanation`は日本語自由記述。UIは`grammaticalRole`を日本語ラベルへ変換して
  表示し、生の英語enum値をそのまま見せない。
- `Modifier { phrase, kind, target, explanation }` — `kind`はenum
  (`prepositionalPhrase|participlePhrase|infinitivePhrase|relativeClause|adverbialPhrase|appositive|other`)。

PDF側（Prototype 1、GrammarAnalyzerには一切依存しない完全に独立したレイヤー）:

```
PdfViewer.tsx (src/features/pdf/components/)
  → pdfjs-dist で読み込み・canvas描画・TextLayer構築
  → mouseup で window.getSelection() を読み取り
  → buildSelectionResult() (src/features/pdf/domain/pdfViewerState.ts)
      → normalizePdfSelectionText() (src/features/pdf/utils/pdfTextNormalize.ts)
  → App.tsx の sentence state へ（ここで初めてGrammarAnalyzerのフローに合流）
```

---

## F. 重要な設計判断（要点。詳細な理由は`docs/design-notes.md`）

1. LLMが返す`start`/`end`は信用せず、`text`を原文へ再照合してアプリ側で座標を検証・補正する
   （`resolveSpan`, `resolveAnalysisSpans.ts`）。
2. repairは**1回だけ**（`MAX_REPAIR_ATTEMPTS = 1`, `src/config/settings.ts`）。無限リトライしない。
3. schema validationが1回のrepairでも失敗した場合、例外を投げずアプリを落とさない。
   `needsMoreContext: true`の安全な空解析を返す（`fallbackAnalysis.ts`）。
4. **patternはLLMに判定させず、アプリ側`derivePattern.ts`が機械的に導出する**（Prototype 0.1で
   導入。LLM自身のS/V/O/Cとpattern回答が矛盾する問題を構造的に解消するため）。
5. structured data（enum等）と日本語自由記述（explanation等）を分離する
   （`grammaticalRole`/`roleExplanation`など、Prototype 0.1で導入）。
6. **7Bをrecommended baselineとする**（C章の数値に基づく。3Bはexperimental/非推奨、14Bはoptional）。
7. **Prototype 1ではGrammarAnalyzer本体・schema・prompt・derivePatternを変更していない**
   （`src/features/grammar/**`はPrototype 0.2完了時点のまま）。
8. dependency parser等の外部NLPパーサーは、Prototype 0.2の判断時点でもPrototype 1でも
   まだ導入していない。
9. deterministic post-processing（例: SVOOのto/for句を区別する後処理ルール）も、
   Prototype 0.2で提案はしたが、Prototype 1では明示的な指示により追加していない
   （前置詞句の統語的役割を単純な表面ルールで補正すると別の文を誤修正するリスクがあるため、
   より慎重な検討が必要と判断）。

---

## G-1. 現在判明している文法解析の限界（C章の数値の裏付け）

- SVOOとto/for句の区別を誤る場合がある（例: "gives feedback to the students"の"to the
  students"を誤って`indirectObject`にする、または二重目的語文で両目的語を1つの`object`へ
  結合し`indirectObject`を使わない）。
- complementを見落とす場合がある（本来SVC/SVOCの補語があるべき場面で`complement`をnullのまま
  返す。development setでは逆に副詞・前置詞句をcomplementに誤って含める「過剰検出」が主だった
  ため、傾向は評価セットによって変わり得ることに注意）。
- 曖昧なmodifier attachmentへの気づきが弱い（holdoutの意図的曖昧文2文で、7B/14Bとも
  confidence=1.0・needsMoreContext=false・uncertainties=0のまま単一解釈を断定。3Bのみ1/2で
  不確実性を示したが、3B自体の不安定さによる可能性が高い）。
- AIによる文法解析であり、常に正しいとは限らない。

---

# Prototype 1: PDF機能の実装状態（詳細）

## 実装ファイルと役割

- **pdfjs-dist**: `^6.2.108`（`package.json`の`dependencies`に記載）。
- **`src/features/pdf/components/PdfViewer.tsx`**: 実装の中心。ローカルPDFファイル読み込み
  （`<input type="file">` → `file.arrayBuffer()` → `pdfjsLib.getDocument()`）、
  canvas描画（devicePixelRatio対応の解像度調整込み）、`pdfjsLib.TextLayer`によるtext layer構築、
  ページ送り（前へ/次へ、`pageNumber` state）、zoom（拡大/縮小、`scale` state、
  `PDF_MIN_SCALE`〜`PDF_MAX_SCALE`は`src/config/settings.ts`）、mouseupでの選択取得、
  スキャンPDF判定、エラー状態表示を担当。
- **worker設定**: `pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href`
  （`PdfViewer.tsx`冒頭）。Vite標準パターンで追加設定不要。`vite build`で独立chunkとして出力される
  （約1.2MB、ビルド時にchunk sizeの警告が出るが、PDF.js自体が大きいライブラリであることに起因する
  想定内の事象でエラーではない）。
- **`src/features/pdf/domain/detectTextLayer.ts`**: `hasExtractableText(sampledPageTextLengths)`。
  先頭最大3ページ（`PDF_SCANNED_CHECK_SAMPLE_PAGES`）の抽出文字数合計が閾値
  （`PDF_SCANNED_CHECK_MIN_CHARS = 20`）未満ならスキャンPDF/テキストなしと判定するヒューリスティック。
- **`src/features/pdf/domain/pdfViewerState.ts`**: `resetForNewDocument()`（新規PDF読み込み時に
  ページ1・既定zoomへ戻す）、`buildSelectionResult(rawText, pageNumber)`（選択文字列を正規化し
  `{rawText, normalizedText, pageNumber}`へ構造化、空選択はnullを返す）。
- **`src/features/pdf/utils/pdfTextNormalize.ts`**: `normalizePdfSelectionText()`。
  (1) 行末ハイフン+改行を結合（"signifi-\ncant"→"significant"、ハイフン直後に改行がある場合のみ、
  "state-of-the-art"のような正規の複合語は改行に隣接しない限り触らない）、
  (2) 残りの改行を空白化、(3) 連続空白を1つに圧縮。
- **`src/features/grammar/domain/modelSizeAdvisory.ts`**: `parseModelSizeB(modelName)`が
  モデル名から`\d+b`パターンでパラメータ数(B)を正規表現抽出、`MODEL_SIZE_ADVISORY_THRESHOLD_B`
  (=4)未満なら注意文を返す。**特定モデル名のハードコードなし**（3B系全般に汎用的に反応する）。
- **`src/App.tsx`**: PDF Viewer（左ペイン）と入力欄+解析結果（右ペイン）の2ペイン構成。
  `handlePdfSelection`（選択文字列をsentence stateへ、resultをクリア）、
  `handlePdfDocumentChange`（新規PDF読み込み時にsentence/selectionPageNumber/result/
  analyzeErrorを全てクリア）。

## 選択→解析までのフロー

1. PDF text layer上でドラッグ選択 → `mouseup`で`window.getSelection()`を読む。
2. `buildSelectionResult`で正規化し、右パネルのテキスト欄へ自動反映（**この時点では解析しない**）。
3. ユーザーがテキストを確認・必要なら手動編集（テキストエリアは常に編集可能）。
4. 「解析」ボタンを押すと初めて、Prototype 0.2までと同じ`analyzeSentence()`が呼ばれる。

## PDF変更時のstate reset と 修正済みバグ

- 別のPDFファイルを選択すると`onDocumentChange`が発火し、選択文字列・解析結果・エラー表示を
  すべてクリアする（`resetForNewDocument()`で内部のページ番号/zoomも初期化）。
- **実機検証で発見・修正したバグ**: `<input type="file">`はブラウザの標準動作として、
  **同一ファイルを再選択しても`change`イベントが発火しない**ため、state resetが効かないことが
  あった。`onChange`ハンドラの末尾で`e.target.value = ''`することで解消済み
  （`PdfViewer.tsx`、`docs/design-notes.md`のPrototype 1セクションに詳細記録）。

---

# Prototype 1: 既知のPDF上の制限

**「未修正バグ」ではなく、意図的なPrototype 1の範囲外 / 既知の技術的限界**として記録する
（バグではないため、Prototype 1.1で"再現バグ"として扱わないこと）:

- PDF.jsのtext layerに完全に依存している。複雑なフォント埋め込みを持つPDFではselectionの
  精度が崩れる可能性がある（未検証）。
- 2段組みPDFでカラムをまたいでドラッグ選択すると、reading orderが崩れた文字列になり得る
  （仕様上「完全なreading order復元はしない」と明記されている範囲内。クラッシュはしない）。
- 数式中の特殊文字は、PDF.jsのテキスト抽出精度に依存し、文字化け・欠落の可能性がある。特別な
  対応はしていない。
- 脚注は本文と区別せず、通常のtext layerの一部として扱われる。
- **単一ページ表示のため、ページ境界をまたぐ選択はそもそも不可能**（構造上、複数ページの
  text layerを同時に表示していない）。
- 行末ハイフネーションの結合は「ハイフン直後に改行があるか」のヒューリスティックのみ。
  正規の複合語がたまたま行末に来た場合は誤結合され得る（限界として認識済み）。
- OCR/スキャンPDFは非対応（意図的な範囲外。テキストレイヤーがない場合はエラーメッセージを表示）。

---

# Prototype 1: 実機検証結果

**テストPDFの場所**: `tests/fixtures/pdf/sample-1col.pdf`（1段組み、2ページ、自作HTML→PDF変換）、
`tests/fixtures/pdf/sample-2col.pdf`（2段組み、1ページ、CSS column-count:2、自作）。
どちらも実在の論文ではなく、動作確認専用に自分で書いた文章（自作英文、著作権上の懸念なし）。
スキャンPDFの疑似テスト（画像のみPDF）はscratchpad上で一時生成して検証し、リポジトリには
含めていない（テキストレイヤーが存在しないダミーPDFであり保存する意味がないため）。

Playwright + 実ブラウザ(Edge)による自動操作で検証した結果:

| 項目 | 結果 |
|---|---|
| 1段組みPDF読み込み・描画 | OK（2ページとも表示、ページ送りOK） |
| 2段組みPDF読み込み・描画 | OK（column-count:2のレイアウトのまま描画） |
| text layer selection | OK（ハイライトが実際の文字と正確に重なることをスクリーンショットで確認） |
| page navigation | OK（1/2→2/2、前へ/次へボタンの有効/無効切り替えも正常） |
| zoom | OK（拡大/縮小ボタン、パーセント表示） |
| normalization（改行→空白） | OK（段落をまたぐ選択で改行が空白化されることを実PDFで確認） |
| normalization（hyphenation） | unit testで担保（実PDF生成では意図的な行末ハイフンを確実に
  発生させにくかったため、実PDF上では直接未確認。`tests/pdf/pdfTextNormalize.test.ts`参照） |
| scan PDF検出 | OK（画像のみの疑似PDFで正しくエラーメッセージ表示） |
| 同一PDF再選択 | OK（修正後。修正前は状態がリセットされないバグがあった） |
| GrammarAnalyzer連携・結果表示 | OK（選択→解析→S/V/O/C等の表示まで一気通貫で確認） |
| Ollamaエラー時の耐性 | コード構造上PdfViewerとOllama/解析状態は完全に分離されており、
  解析側のエラーがPDF表示に影響する経路が存在しない（実機での長時間タイムアウト再現は未実施） |

---

# J. Prototype 1.1 — Real-world PDF Acceptance Test（完了、2026-08-10）

## Status: **PASS WITH KNOWN LIMITATIONS**

自作fixtureではなく実際の英語論文PDF（`D:\sugimoto\paper-grammar-tutor-test-pdfs`、
リポジトリ外）を使い、「PDF表示→英文selection→text extraction→normalization→
必要なら手修正→Ollama解析→右側パネル表示」という読書フローのacceptance testを実施した。

## 結果サマリー

- 実PDF **5本**（Springer/単段組み・Elsevier/2段組み・IEEE Soenen/2段組み・
  arXivプレプリント/2段組み・古い複写スキャン(JBIG2+OCR)/単段組み）。出版社・生成元・
  レイアウトを分散。
- 英文selection試行 約**51件**。うち成立48件（**A**（そのまま使用可能）**43** /
  **B**（軽微な手修正で使用可能）**3** / **C**（実用上問題あり）**2**）、
  安全側でselectionが無視された（データ破損なし）ケースが**3件**
  （うち2件はTable内の列間の広い空白によるもの。40px snap範囲の限界として観測のみ、
  ヒューリスティックは変更していない）。
- Grammar analysis: **9/9成功**（fallback/error 0件）。
- latency: median 約**10.6秒**、範囲6.5〜14.1秒、10秒超の頻度約56%、**timeout 0件**。
- 詳細な観測項目（正規化・2段組み・UX等）はこのHANDOFF.mdには転記していない
  （評価時のPDF本文をログ/ドキュメントへ大量保存しない方針のため）。数値のみここに残す。

## Prototype 1.1中に発見・修正した重大バグ（2件、いずれも修正済み・回帰確認済み）

1. **PDF text layerのfont-size欠落による行末selection暴走**
   - 原因: `src/App.css`の`.textLayer span`再実装がpdf.js本来の`font-size`計算式・
     `transform: scaleX(...)`規則を書き写し漏れしており、全spanがブラウザ既定の16pxで
     描画されていた。長い行でspanがページ右マージンを越えてはみ出し、その領域での
     ネイティブ選択ヒットテストが不安定になり、選択がページ先頭など無関係な位置へ
     飛ぶことがあった。
   - 修正: `.textLayer span, .textLayer br`にpdf.js本来のfont-size/transform規則を追加
     （`src/App.css`）。加えて、`PdfViewer.tsx`のmouseup処理に防御的な検証・復元処理
     （テキストノード外に解決された場合、mousedown/mouseup座標から最大40pxの範囲で
     最も近い実テキストへスナップ。それでも解決できない場合は選択を無視）を追加。
   - 回帰確認: 5PDF全て・sample-1col/2col.pdfで再発なし。
   - コミット: `c6eb42d`

2. **pdf.js `wasmUrl`未設定によるJBIG2 scan PDFの本文白紙化**
   - 原因: `pdfjsLib.getDocument()`に`wasmUrl`を渡していなかったため、JBIG2画像
     デコーダのWASM/JSフォールバック双方が初期化に失敗し、例外を投げずに警告のみで
     該当ページの描画がスキップされていた（text layerは別経路で構築されるため、
     本文が透明テキストとしては存在するのに視覚的には白紙、という矛盾した症状）。
   - 修正: pdfjs-dist公式の`wasm/`リソース一式を`public/pdfjs/wasm/`にコピーし、
     `PDF_WASM_URL`（`src/config/settings.ts`）として`getDocument()`に渡すよう変更。
   - 回帰確認: 5PDF全てで描画・selectionとも正常。
   - コミット: `80a22c2`

## Known limitations

**Observed（今回の評価で実際に観測）**:
- PDF内部のフォントエンコーディングに起因する数式文字化け（例: Elsevier論文で`≥`が
  無関係な文字に置換）
- 数式variable/symbolの完全な非抽出（例: IEEE Soenen論文で回帰係数等の斜体変数が
  テキストとして一切存在しない）
- スキャンPDFの既存OCR text layerの認識誤り（例: `μm`→`Jim`、`1`→`I`等）
- table等、列間に広い空白がある構造では、40px snap範囲を超えるとselectionが
  安全側で無視される場合がある（データ破損はしない）

**Known / theoretical（今回は未観測、理論上の残留リスク）**:
- 左右columnを意図的にまたぐselectionのreading orderは引き続き未対応（既知の範囲外）
- 正規のhyphenated compoundがたまたま行末に来た場合の誤結合可能性（今回は0件観測）
- 検証はChromium系ブラウザ（Edge）を主対象としている
- `cMapUrl` / `standardFontDataUrl`は未設定（今回の2件のバグには無関係、非埋め込み
  CJKフォント等を含むPDFでは将来的に類似の問題が起こり得る）
- `pdfjs-dist`をアップデートする際は`public/pdfjs/wasm/`の再コピーが必要
  （README.md参照）
- OCR機能自体は実装していない（既存OCR text layerがあるPDFのみ対象）

## Prototype 1.1で変更しなかったもの（確認事項）

prompt / schema / GrammarAnalyzer / derivePattern / benchmark / normalizationルール /
selection heuristic（40px snap含む）はPrototype 1.1を通じて変更していない。変更したのは
PDF selection暴走の修正（`c6eb42d`）とPDF.js wasmリソース設定（`80a22c2`）のみ。

## 実PDFの取り扱いルール（厳守・継続）

- 評価に使う実論文PDFをrepositoryへコミットしない。
- 著作物をfixtureとして保存しない（`tests/fixtures/pdf/`には自作PDFのみを置く）。
- 機密PDFをrepositoryへコピーしない。
- PDF本文をログへ大量出力・保存しない。

---

# 次のタスク: Prototype 2 — Progressive Reading Tutor

設計案を提示済み（実装は別セッション/別ターンでの判断待ち、このHANDOFF.mdには設計内容の
詳細は転記していない）。既存の`GrammarAnalysis`構造化結果を使い、解析結果を段階的
（Stage 0〜5、骨格→構造→言語補助→自己解釈→参考訳）に開示するUI/UXの検証が目的。
prompt/schema/GrammarAnalyzer/derivePattern/benchmark/Ollama provider/PDF抽出/
normalization/selection logicは変更しない方針。

---

# 現在のファイル構成（実際のリポジトリを確認して記載）

```
paper-grammar-tutor/
  HANDOFF.md               この文書
  README.md                 セットアップ・使い方・既知の限界
  package.json
  src/
    App.tsx / App.css / index.css / main.tsx
    components/              ConnectionStatus.tsx, ModelSelector.tsx
    config/settings.ts        Ollama URL/temperature/timeout/PDF zoom/scanned判定閾値等の定数
    features/grammar/
      components/             SentenceInputPanel.tsx, AnalysisResultPanel.tsx
      domain/                  GrammarAnalyzer.ts, derivePattern.ts, resolveAnalysisSpans.ts,
                                fallbackAnalysis.ts, modelSizeAdvisory.ts
      schemas/                 grammarAnalysis.schema.ts (zod, 正), grammarAnalysis.jsonSchema.ts
                                (Ollama format用、手書き・schema.tsと要同期)
    features/pdf/
      components/PdfViewer.tsx
      domain/                  detectTextLayer.ts, pdfViewerState.ts（isReadingOrderBefore含む）
      utils/pdfTextNormalize.ts
    llm/
      types.ts                 LLMProviderインターフェース
      providers/ollama/OllamaProvider.ts
      prompts/grammarAnalysisPrompt.ts
    utils/                     textNormalize.ts, spanMatch.ts, jsonExtract.ts
  tests/
    grammar/                   schema, spanMatch, textNormalize, jsonExtract, derivePattern,
                                modelSizeAdvisory, GrammarAnalyzer の各テスト
    pdf/                       pdfTextNormalize, detectTextLayer, pdfViewerState, pdfWasmUrl のテスト
    benchmark/                 parseArgs, scoring のテスト
    fixtures/                  validAnalysisFixture.ts, pdf/sample-1col.pdf, pdf/sample-2col.pdf
  public/pdfjs/wasm/            pdfjs-distのJBIG2/JPX/QCMS用wasmリソース一式（公式バンドルの
                                コピー、Vite `public/`配下でハッシュなし配信。pdfjs-dist更新時は
                                再コピーが必要、README.md参照）
  .eslintignore                  public/pdfjs/（pdf.js自身のベンダーコードをlint対象外に）
  benchmark/
    sentences/development.json  28文（development、prompt/schema調整に使用済み）
    sentences/holdout.json      57文（holdout、モデル出力を人間が確認済み。D章参照）
    run.ts                      --dataset development|holdout 対応のベンチマークCLI
    baselines/prototype-0/      Prototype 0時点の3B/7B結果（凍結、比較用、Git管理対象）
    results/                    実行結果の出力先。.gitignore対象（.gitkeepのみ追跡）。
                                重要な数値はこのHANDOFF.md C章とdesign-notes.mdに転記済み
  docs/design-notes.md          全プロトタイプの設計判断の詳細記録（最新が先頭）
```

---

# 環境情報（このPCで実際に確認した値。API키・認証情報は含めない）

| 項目 | 値 |
|---|---|
| OS | Windows（NT 10.0.26200） |
| Node.js | v24.19.0 |
| npm | 11.17.0 |
| Ollama | 0.32.6 |
| インストール済みモデル | qwen2.5:3b-instruct, qwen2.5:7b-instruct, qwen2.5:14b-instruct |
| pdfjs-dist | ^6.2.108（package.jsonの記載。実際のインストール解決版もこの系列） |
| **推奨モデル** | **qwen2.5:7b-instruct**（C章参照。別PCでは同名モデルの`ollama pull`を推奨） |

---

# 別PCでの再開手順

このプロジェクトは現在**Gitコミットされていない**（次章「Git状態」を必ず先に読むこと）。
そのため、以下は「ファイル一式を別PCへコピーした場合、またはコミット後にcloneした場合」の
起動手順である。

```bash
# (Gitで持ってきた場合) cd paper-grammar-tutor
npm install

# Ollamaをインストール・起動しておく（https://ollama.com/）
ollama pull qwen2.5:7b-instruct     # 推奨モデル
ollama pull qwen2.5:14b-instruct    # 任意（比較用）
ollama pull qwen2.5:3b-instruct     # 任意（実験用、非推奨の確認用）

npm run dev
# 表示されたURL（既定 http://localhost:5173）を開く
```

検証コマンド:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

ベンチマーク再実行（任意、Prototype 1.1では通常不要）:

```bash
npm run benchmark -- qwen2.5:7b-instruct,qwen2.5:14b-instruct --dataset development
npm run benchmark -- qwen2.5:7b-instruct,qwen2.5:14b-instruct --dataset holdout
```

---

# Git状態（重要・別PCでの作業者は必ず先に確認すること）

**`paper-grammar-tutor`は現在、専用の独立したGitリポジトリになっている
（このHANDOFF.md初版作成時点では未コミットのモノレポ内ディレクトリだったが、その後
Prototype 1完了時に専用リポジトリへ移行済み）。**

- `origin`リモートは`https://github.com/rime-remotesensing/paper-grammar-tutor.git`
  （Paper Grammar Tutor専用）。以前の版に記載されていた無関係なリポジトリ
  （`Biomass_Burning_Sentinel-2`）の話は解消済みで、現在は無関係。
- `main`ブランチは`origin/main`と同期済み（`git status`で`up to date`）。
- タグ: `prototype-1`（Prototype 1完了時点）、`prototype-1.1`（Prototype 1.1完了時点、
  本セクション更新時に付与）。
- 直近のコミット（新しい順）: `Configure PDF.js WASM resources for image decoding` →
  `Fix PDF text selection near line endings` → `Complete Prototype 1 and prepare
  project handoff`。
- `git clone`すればそのまま別PCで作業を再開できる状態になっている。

`benchmark/results/`配下は引き続き`.gitignore`対象（`.gitkeep`のみ追跡）。重要な数値は
このHANDOFF.md（C章・J章）と`benchmark/baselines/prototype-0/`（Git管理下）と
`docs/design-notes.md`に転記済み。
