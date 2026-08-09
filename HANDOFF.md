# HANDOFF — Paper Grammar Tutor

**この文書だけを読めば、過去の会話履歴が一切ない別PC・別のClaude Codeセッションでも
プロジェクトを正確に理解し、作業を再開できることを目的としている。**

現在の正式な到達点: **Prototype 0 → Prototype 0.1 → Prototype 0.2 → Prototype 1 まで完了**。
**Prototype 1.1（Real-world PDF Acceptance Test）は未着手**。この文書はPrototype 1完了時点を
引き継ぎ基準点として書かれている。

作成日: 2026-08-09。以下の内容はすべて、このHANDOFF.md作成時点で実際のコード・README・docs・
`benchmark/`配下の結果ファイルを確認して書いている（推測での補完はしていない）。

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

# 次のタスク: Prototype 1.1 — Real-world PDF Acceptance Test

## 目的

新機能開発ではない。**自作fixtureではなく、実際の英語論文PDFを使って**、

```
PDF表示 → 英文selection → text extraction → normalization
  → 必要なら手修正 → Ollama解析 → 右側パネル表示
```

という実際の読書フローが実用になるかどうかを確認する**acceptance test**。

## 評価方針

- 可能なら5〜10本程度の実論文PDF、合計50〜100程度の英文selectionを試す。ただし件数の達成自体が
  目的ではない。
- 異なるレイアウト・異なるPDF生成元（LaTeX組版、Wordから出力、出版社のtypesetting等）で評価する。
- 確認する観点: PDF rendering / text selection / selected textの順序 / 改行 / hyphenation /
  citation（引用番号）/ 上付き文字 / 数式付近 / 脚注付近 / 1段組み / 2段組み / 手動修正のしやすさ /
  GrammarAnalyzerへの入力としての妥当性 / 解析結果 / latency / PDFと解析パネル間の視線移動 /
  長い解析結果のスクロール / 読書の流れを妨げないか。

## 変更してはいけないもの（最初の実PDF評価が終わるまで）

- prompt / schema / GrammarAnalyzer / derivePattern
- benchmark / model evaluation logic
- PDF側の実装も、まず現状のままで評価する

**明確な再現バグが実PDFで確認された場合だけ**、原因を特定して最小限の修正を行う
（Prototype 1で行った「同一ファイル再選択バグ」修正のような対応が許容される前例）。

## 追加しないもの

OCR / RAG / Zotero / Anki / IndexedDB / 履歴機能 / 注釈永続化 / dependency parser /
PDF全文解析 / PDF全文翻訳 / cloud LLM / streaming / cache / 新しいprompt tuning /
新しいbenchmark tuning。Prototype 1.1はacceptance testであり、機能追加フェーズではない。

## 実PDFの取り扱いルール（厳守）

- 評価に使う実論文PDFをrepositoryへコミットしない。
- 著作物をfixtureとして保存しない（`tests/fixtures/pdf/`には自作PDFのみを置く）。
- 機密PDFをrepositoryへコピーしない。
- PDF本文をログへ大量出力・保存しない。

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
      domain/                  detectTextLayer.ts, pdfViewerState.ts
      utils/pdfTextNormalize.ts
    llm/
      types.ts                 LLMProviderインターフェース
      providers/ollama/OllamaProvider.ts
      prompts/grammarAnalysisPrompt.ts
    utils/                     textNormalize.ts, spanMatch.ts, jsonExtract.ts
  tests/
    grammar/                   schema, spanMatch, textNormalize, jsonExtract, derivePattern,
                                modelSizeAdvisory, GrammarAnalyzer の各テスト
    pdf/                       pdfTextNormalize, detectTextLayer, pdfViewerState のテスト
    benchmark/                 parseArgs, scoring のテスト
    fixtures/                  validAnalysisFixture.ts, pdf/sample-1col.pdf, pdf/sample-2col.pdf
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

**`paper-grammar-tutor`はこのHANDOFF.md作成時点で一度もGitコミットされていない。**

- `paper-grammar-tutor`ディレクトリは独立したGitリポジトリではなく、親ディレクトリ
  `F:\sugimoto`配下の大きなGitリポジトリ（衛星リモートセンシング系の複数の無関係な
  プロジェクトが同居するモノレポ）の一部として存在している。
- その親リポジトリの`origin`リモートは`https://github.com/rime-remotesensing/Biomass_Burning_Sentinel-2`
  を指しており、**Paper Grammar Tutorとは全く無関係な別プロジェクトのリポジトリ**である。
- したがって、`paper-grammar-tutor`ディレクトリ全体が`git status`上は未追跡（untracked）
  として扱われる。**現時点で「git clone すれば別PCでも作業を再開できる」状態にはなっていない。**
- 本セッションではこの状況を発見した時点で、ユーザーの明示的な許可なくコミット・新規リモート
  作成・pushのいずれも行っていない（安全側に倒した）。

**別PCへの引き継ぎ方法についてユーザーの判断が必要**:
1. Paper Grammar Tutor専用の新しいGitリポジトリを作成し、そこへコミット・push する。
2. 現在の`F:\sugimoto`モノレポ内にそのままコミットする（ただしremoteが別プロジェクト名の
   ままなので、pushする場合は宛先の再確認が必須）。
3. Gitを使わず、フォルダを直接コピーして別PCへ持ち込む（この場合、`node_modules`/`dist`は
   除外して良い。`.gitignore`に記載の対象と同じ）。

いずれの方法を取るにせよ、**`benchmark/results/`配下（.gitignore対象）はコピーしないと
別PCから失われる**。ただし重要な数値はすべてこのHANDOFF.md（C章）と`benchmark/baselines/
prototype-0/`（Git管理下）と`docs/design-notes.md`に転記済みなので、生JSON自体は
必須ではない（人間によるレビュー目的で残したい場合のみ、フォルダごとコピーすること）。
