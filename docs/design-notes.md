# 設計判断メモ

仕様書に明示されていなかったため、実装時に判断した点を記録する。

---

# Prototype 1.1 バグ修正 — PDF text selectionが離れた位置へ暴走する問題

Prototype 1.1（Real-world PDF Acceptance Test）の1本目評価中に発見され、
`tests/fixtures/pdf/sample-1col.pdf`を人間が操作した際にも再現が確認された、
PDF selectionのバグ修正記録。**文法解析（`src/features/grammar/**`）・benchmark・
normalizationルールは一切変更していない。** 変更したのは
`src/App.css`・`src/features/pdf/components/PdfViewer.tsx`・
`src/features/pdf/domain/pdfViewerState.ts`・`tests/pdf/pdfViewerState.test.ts`のみ。

## 症状

PDF上でテキストをドラッグ選択した際、行末付近やページ内の特定位置まで
ドラッグすると、選択範囲が意図しない場所（ページ先頭・見出しなど）へ
飛んでしまうことがあった。`sample-1col.pdf`・実論文PDF（Springer社刊行、
`s11004-023-10132-3.pdf`）の両方で再現。

## 原因（2つの独立した要因が重なっていた）

### 主因: `.textLayer span`に`font-size`が設定されていなかった

`src/App.css`の`.textLayer`関連CSSは、Prototype 1で
`pdfjs-dist/web/pdf_viewer.css`から必要な部分だけを手で書き写した
「最小限の再実装」（design-notesの Prototype 1 セクション参照）。この際、
`font-size: calc(var(--text-scale-factor) * var(--font-height));`という、
pdf.jsが各spanへ個別にインラインで設定する`--font-height`（PDFのフォントサイズ由来）
とテキストレイヤーのスケール係数から実際のfont-sizeを計算する規則が、
書き写し漏れで欠落していた。同様に`--scale-x`（文字幅の補正係数）を反映する
`transform: scaleX(var(--scale-x)) ...`も欠落していた。

結果として、すべてのspanがブラウザのデフォルトfont-size（16px）で描画されており、
PDFが指定する実際のfont-size（今回のSpringer論文では本文12.45px程度）より
大きく描画されていた。texthiddenレイヤーは透明(`color:transparent`)なので
視覚的には気づかないが、**「選択可能な当たり判定」であるspanの矩形（特に幅）が、
本来より約1.3倍広く**なっていた。長い行では、この誤差が蓄積して
spanの右端がページの右マージンを超えてはみ出す状態になっていた
（実測: 修正前は行末が789px付近まで達していたが、ページの実際の右端は756.6px
だった。修正後は行末が692px付近に収まり、ページ内に収まる）。

ブラウザの`caretRangeFromPoint`/ネイティブのドラッグ選択ヒットテストは、
実際に描画されている要素に基づいて位置を解決する。誤って肥大化したspanの
「本来は無地であるべき」右端部分（＝ページの余白部分に描画されてしまった領域）
にマウスが入ると、そこは実際には何のテキストも描画されていない場所のため、
ヒットテストが失敗し、ブラウザは最も近い祖先要素の子要素インデックスに基づく
別の位置（しばしばページの先頭付近）へfocus/anchorを解決してしまっていた。

**修正**: `.textLayer span, .textLayer br`に、pdf.js本来の
`font-size`計算式と`transform: scaleX(...)`を追加（`src/App.css`）。
`pdfjs-dist/web/pdf_viewer.css`（`node_modules`内）の該当箇所と突き合わせて
正確な式を復元した。

### 副因: 行と行の間の「隙間」でのヒットテスト不安定性

主因を修正した後も、複数行にまたがるドラッグの途中でマウスが
「ある行のspan矩形の下端」と「次の行のspan矩形の上端」の間の薄い隙間
（pdf.jsの各行spanは`line-height:1`で個別に絶対配置されており、行間に
隙間が生じ得る）を通過する瞬間や、行の実際の最後の文字よりわずかに右で
mouseupした場合（＝ユーザーが行末の少し先までドラッグして離す、という
ごく普通の操作）に、ネイティブ選択のfocus/anchorが一時的に
テキストノードではなく要素ノードへ解決されることがあった
（`document.caretPositionFromPoint`で直接確認）。多くの場合は
その後のマウス移動で自己修復するが、**ちょうどそのタイミングでmouseupが
発生すると、壊れた状態のまま採用されてしまう**。

**修正**: `PdfViewer.tsx`の`handleMouseUp`に防御的な検証と復元処理を追加。
mouseup時点の`window.getSelection()`のanchorNode/focusNodeが両方とも
textLayer内のテキストノードであることを確認し、そうでない場合は
mousedown時点の座標とmouseup時点の座標から`caretPositionFromPoint`
（フォールバックで`caretRangeFromPoint`）を使って選択範囲を再構築する。
それでも解決できない座標（テキストの真上ではない）は、上下左右方向に
最大40pxまで4px刻みで探索し、最も近い実テキスト位置にスナップする
（`resolveCaretInLayer`, `resolveCaretAtExactPoint`）。再構築後の
開始/終了の順序判定には、DOM構造の比較ではなく単純な読み順（Y座標→X座標）
の比較を用いている（`isReadingOrderBefore`, `pdfViewerState.ts`。
2段組みでのカラムをまたぐreading orderの問題はPrototype 1の既知の
範囲外のままなので、この比較は「同一カラム内の通常の複数行選択」を
壊さないことだけを目的とした簡易なものであり、意図的にDOM順序の
厳密な比較は行っていない）。

再構築後も判定に失敗する場合（対応する実テキストが見つからない等）は、
何もしない（＝ユーザーの選択操作をそのまま無視する）。誤った文字列を
解析パネルへ渡すよりも、選択が一見反応しなかったように見える方が安全と
判断した。

## 変更ファイル

- `src/App.css` — `.textLayer span, .textLayer br`にfont-size/transform規則を追加。
- `src/features/pdf/components/PdfViewer.tsx` — mousedown位置の記録、
  mouseup時の選択検証・復元ロジックを追加。
- `src/features/pdf/domain/pdfViewerState.ts` — `isReadingOrderBefore`
  （読み順比較のpure関数）を追加。
- `tests/pdf/pdfViewerState.test.ts` — `isReadingOrderBefore`の単体テストを追加。

## テスト

`isReadingOrderBefore`は純粋関数のため`tests/pdf/pdfViewerState.test.ts`に
単体テストを追加した（4ケース）。一方、今回の主因・副因とも
「実際のブラウザのレイアウト・ヒットテスト・CSS計算結果」に依存する問題であり、
このプロジェクトのvitest環境（`environment: 'node'`、jsdom等は未導入）では
意味のある形で再現・検証できない。jsdomはレイアウト計算
（`getBoundingClientRect`・`caretRangeFromPoint`等）を実装しないため、
jsdomを追加してもこの種のバグは検出できない。そのため、この部分は
自動ユニットテスト化を無理に行わず、以下の手動回帰手順を残す。

### 手動回帰手順（DOM/ブラウザ依存のため）

以下はPlaywright等のブラウザ自動化ツールでも、実際のブラウザで手動でも
実施できる。`npm run dev`でアプリを起動した状態で実施する。

1. **sample-1col.pdf**（`tests/fixtures/pdf/sample-1col.pdf`）を開く。
   - 1つの行の中間だけをドラッグ選択 → 正しく選択されること。
   - 2〜3行にまたがるドラッグ選択 → 改行が正しく含まれ、全行が選択されること。
   - ある行の実際の最後の文字ちょうどまでドラッグして選択 → その行の最後まで
     正しく選択され、次の行や無関係な位置に飛ばないこと。
   - ある行の最後の文字より少し手前で選択を終える → その位置までで
     正しく選択されること。
   - 段落の最終行（他の行より短い行）まで選択 → 段落全体が正しく選択され、
     余計な文字が混入しないこと。
2. 上記5パターンを、著作権上リポジトリに含められない実論文PDF
   （査読論文・単段組み）でも実施する。特に行の右端付近まで
   ドラッグしたときに、選択が別の行やページの先頭・見出しなどへ
   飛ばないことを確認する。
3. 2段組みの実論文PDFで、同一カラム内での複数行選択・行末選択を確認する
   （カラムをまたぐ選択のreading orderが乱れるのは既知の仕様であり、
   このテストの対象外）。
4. すべてのステップで、選択結果が右側のテキスト欄に反映され、
   「解析」ボタンから最後まで解析が実行できることを確認する。

いずれかのステップで選択が無関係な位置に飛ぶ、または選択が完全に無反応に
なる場合は回帰が疑われる。

---

# Prototype 1 (PDF Reader Integration)

目的は新しい文法解析アルゴリズムの開発ではなく、「PDFを読みながら選択英文をPrototype 0.2の
GrammarAnalyzerでその場解析できるか」の検証。`GrammarAnalyzer`本体・schema・prompt・
derivePatternは一切変更していない（`src/features/grammar/**`への変更はゼロ、変更したのは
`src/App.tsx`・新規`src/features/pdf/**`・`src/config/settings.ts`へのPDF用定数追加のみ）。

## PDF.jsは単一ページ表示、独自の最小Viewerを実装した

`pdfjs-dist`（v6系）を直接使用し、`pdfjs-dist/web/pdf_viewer.js`が提供するフル機能の
Viewer UIコンポーネント（サムネイル・アウトライン・検索・複数ページ連続スクロール等を含む）は
使わず、1ページずつ表示する最小の自作コンポーネント（`PdfViewer.tsx`）にした。仕様書が要求する
機能（読み込み・ページ表示・前後ページ・ページ番号・zoom・text layer・選択）と一致し、
「サムネイル一覧・outline・検索は不要」という明記された非対応項目とも整合する。全ページを
同時にtext layer付きでレンダリングする継続スクロール方式は実装・パフォーマンス面で複雑さが
増すため見送った。

## テキストレイヤーのCSSは`pdf_viewer.css`全体をimportせず、必要な部分だけ自前で書いた

`pdfjs-dist/web/pdf_viewer.css`は`.textLayer`のスタイル以外にツールバー・サイドバー・
annotation editor等、このアプリが使わないUIチンプまで含む大きなファイルのため、
`TextLayer`クラスが要求する最小限のCSS（`position:absolute`、`span`の透明テキスト＋
`user-select:text`、`--total-scale-factor`変数）だけを`App.css`に書き写した。ページ
コンテナには`--scale-factor`をJS側から`style.setProperty`で設定し、`--total-scale-factor`
がそれを参照する。

## workerはVite標準の`new URL(..., import.meta.url)`パターンで解決

```ts
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href
```

追加のVite設定（`optimizeDeps`等）は不要だった。`vite build`は`pdf.worker.min.mjs`を
independent chunk（約1.2MB）として出力する。バンドルサイズ警告が出るが、PDF.js自体が
大きいライブラリであることに起因する既知の事象であり、Prototype 1では code splitting
などの最適化は行わない（過剰実装を避ける）。

## スキャンPDF判定はヒューリスティック（先頭数ページのテキスト長合計）

`page.getTextContent()`で先頭最大3ページ分の抽出文字数を合計し、閾値
（`PDF_SCANNED_CHECK_MIN_CHARS = 20`）未満ならスキャンPDF/テキストなしと判定する
（`detectTextLayer.ts`）。1ページだけだと表紙ページなどでの誤判定リスクがあるため
複数ページをサンプリングしている。完全な判定ではなく、あくまで「一般的な論文PDFかどうか」を
実用的に見分けるための簡易ヒューリスティックである。

## `<input type="file">`の同一ファイル再選択バグ

実装後の実機検証（Playwright + Edge、自作PDFで検証）で、同じPDFファイルを再度選択しても
`onChange`が発火せず、別のPDFに切り替えたときの状態リセット（仕様書18章）が効かないケースを
発見した。原因はブラウザの標準動作で、`<input type="file">`は選択された`FileList`が
（参照として）変化しない場合に`change`イベントを発火しないため。`onChange`ハンドラの末尾で
`e.target.value = ''`してから処理することで、同じパスを再選択しても常に新しい`change`が
発火するようにした（React/ファイルアップロードUIでよく使われる標準的な回避策）。

## Ollamaエラー時にPDF Viewerが落ちない根拠

`PdfViewer`コンポーネントはOllama/GrammarAnalyzerの状態を一切参照しない
（`onSelection`/`onDocumentChange`という2つのコールバックのみで親と疎結合）。解析エラーは
`App.tsx`の`handleAnalyze`内のtry/catchで`analyzeError`state化される、Prototype 0から
存在する既存パターンをそのまま踏襲している。構造的にOllama側のエラーがPDF表示コンポーネントへ
伝播する経路が存在しないため、実機での長時間タイムアウト（120秒）を伴う再現テストは行わず、
コード構造のレビューで代替した。

## deterministic post-processingは追加していない（明示的な指示により見送り）

Prototype 0.2の報告で提案した「give X to Y」のようなto/for句とindirectObjectを区別する
後処理は、Prototype 1では実装しないよう明示的に指示されたため着手していない。derivePatternは
「S/V/O/Cの有無からpatternを一意に導出する」という決定的写像であるのに対し、to/for句の判定は
前置詞句の統語的役割そのものを判定する必要があり、単純な表面ルールでは別の英文を誤修正する
リスクがあるため、次フェーズで慎重に検討する対象として保留する。

---

# Prototype 0.2 (Generalization & Evaluation Hardening)

developmentセット（28文、prompt/schema調整に使用済み）とholdoutセット（57文、未使用・
gold先行確定）を分離し、Prototype 0.1で確定したprompt/schemaを一切変更せずに1回だけ
holdoutを評価した。

## development.json / holdout.json の分離

`benchmark/sentences/dataset.json`を`development.json`にリネームし、`setRole:
"development"`を明記。新規に`holdout.json`（57文、gold先行確定、モデル出力を見てから
編集しない）を追加した。`benchmark/run.ts`は`--dataset development|holdout`で選択できる
（省略時development、既存呼び出しとの後方互換）。gold欄はdevelopment
（subject/verb/indirectObject/object/complement/pattern）とholdout
（subject/subjectHead/mainVerb/indirectObject/object/complement/expectedPattern、
clauses/modifiers/ambiguous/alternativeAcceptableAnswersを追加で許容）で異なる
フィールド名を使っており、`loadDataset()`で共通表現に正規化してからスコアリングしている。

## 節・修飾語のattachmentは自動採点していない

`clauses`/`modifiers`のgoldはholdoutの一部の文にのみ付与した（可能な範囲の追加情報）。
複数spanの対応付けを安全に自動判定するロジックは作らず、モデルのanalysisとgoldを
同じper-sentence JSONに並べて出力するだけに留めた（人間レビュー用）。subject/verb/
indirectObject/object/complementのような単一spanの一致判定と異なり、複数要素の
対応付けは誤った採点ロジックが「精度が高く見える／低く見える」を人為的に作り出す
リスクが大きいと判断したため。

## complementをsubject complement / object complementに分割して集計

gold.objectがnullかどうかでSVC相当（subject complement）とSVOC相当（object
complement）のバケツに分け、それぞれのcomplement一致率を別集計にした（gold自体に
複層フィールドを追加してはいない。既存の単一`complement`フィールドのままで、
集計時にバケツ分けするだけで十分表現できた）。

## pattern不一致の原因をconstituentフィールドへ帰属させる

`derivePattern`は決定的関数なので、patternの不一致は必ずverb/indirectObject/object/
complementのいずれかの抽出誤りに起因する（subjectはpattern導出に関与しないため
原因になり得ない）。`run.ts`はpattern不一致ごとに、gold と食い違っているどの
constituentフィールドが原因かをタリーし、summaryへ出力する。「pattern engine
accuracy」という表現は使わない（そもそもpattern engineという可変な"精度"を持つ
コンポーネントは存在せず、derivePattern自体はunit testで保証済みの固定ロジックの
ため）。

## 曖昧文の扱い

holdoutの2文（h54, h55）に`ambiguous: true`と`alternativeAcceptableAnswers`
（modifierTargetの複数候補）を設定した。ただしこの2文のS/V/O/Cそのものは曖昧では
なく、曖昧なのは修飾語(with a new battery / before the deadline)の attachment 先
のみだったため、alternativeAcceptableAnswersは実質的にconstituent自動採点へは
影響しない（そもそもattachmentは人間レビュー対象）。代わりに
`ambiguityAwareness`（needsMoreContext / confidence<0.7 / uncertaintiesの
いずれかが立っているか）を参考指標として記録し、正誤判定はしていない。

## Generalization gap は「developmentより悪化」ではなく「複雑な逆転」だった

7Bのconstituent平均はdevelopment 81% → holdout 93%と、holdoutの方がむしろ高かった。
個別に見ると、development setで壊れていたellipsis（ellipsis-01）やinversion
（inversion-01）はholdoutの類似カテゴリ（h48/h49, h50/h51）では正しく解析できており、
「ellipsis/inversionというカテゴリ全般が弱い」のではなく、development set内の
特定の文（構文がより入り組んでいた、またはたまたまモデルが苦手な語彙選択だった）
に起因する誤りだった可能性が高い。一方でcomplementの誤りの"種類"はdevelopmentと
holdoutで逆転した: developmentでは副詞・前置詞句・不定詞句をcomplementに誤って
含める「過剰検出」が主だったが、holdoutでは逆に本来complementがあるべき場面で
nullを返す「見落とし」が主だった（h03/h15/h16/h35/h42/h43など）。プロンプトで
「complementは疑わしい場合はnullのままにせよ」と強く指示したことが、holdoutの
より複雑な文（副詞節が先行する文、不定詞句主語の文など）で過剰にnullへ倒れる
副作用を生んだ可能性がある。

## SVOOはto/for句化との区別が依然弱い

holdoutのSVOO 5文中、"gives users feedback"型3文中2文は正しくindirectObject/
objectを分離できたが、"gives feedback to users"型のto句化パラフレーズ（h10）は
7B/14BともindirectObjectに"the students"（本来はmodifierとして"to the students"
全体をgaveの修飾句とすべき）を誤って割り当てた。もう1つの二重目的語文（h11）では
逆に両目的語を1つの`object`文字列へ結合してしまい、`indirectObject`を使わなかった。
モデルが「誰が受益者か」という意味役割は認識できても、それをindirectObjectという
統語的スロットへ正しく写像できていない・to句をindirectObjectと混同する、という
2種類の異なる失敗モードが確認された。

---

# Prototype 0.1 (文法解析精度の改善)

Prototype 0のベンチマークで判明した「3Bはsubjectをほぼ常にnullで返す」「7Bでも
complement/patternの精度が低い」「patternがS/V/O/Cの中身と矛盾することがある」
という問題に対応するための変更。目的は「JSON形式の安定化」ではなく「解析内容の
正確性の改善」であり、structured output自体（Prototype 0で28/28件成功）には
変更を加えていない。

## patternはLLMに答えさせず、アプリ側でS/V/O/Cから機械的に導出する

**変更**: `llmGrammarAnalysisSchema`（LLMに要求する形）から`sentenceCore.pattern`を
完全に削除した。LLMはもう`pattern`フィールドを一切出力しない。代わりに
`src/features/grammar/domain/derivePattern.ts`が、検証済みのsubject/verb/
indirectObject/object/complementの有無だけから機械的に`SV/SVC/SVO/SVOO/SVOC/other`
を導出し、`GrammarAnalyzer.analyzeSentence`が span 検証の直後に付与する
(`attachDerivedPattern`)。

**理由**: Prototype 0では「7Bがcomplementに`"in the previous experiment"`（本来は
`obtained`を修飾する前置詞句であり補語ではない）を入れた上でpatternを`SVOO`と回答する」
など、LLM自身が出したS/V/O/Cと、LLM自身が出したpatternラベルが矛盾する例が実際に
見つかった。patternの導出規則自体はS/V/O/Cの組み合わせから一意に決まる機械的な写像
なので、これをLLMに「答えさせる」対象から外し、確定的なコードに置き換えることで、
この種の内部矛盾はそもそも発生しなくなる（`tests/grammar/GrammarAnalyzer.test.ts`の
「derives pattern from constituents even if the LLM output would have implied a
different one」がこれを回帰テストとして固定している）。

**データモデルへの影響**: 既存の`object`一つだけではSVOO（間接目的語+直接目的語）を
正しく表現できなかったため、`sentenceCore`に`indirectObject`（nullable Span）を追加した。
`indirectObject`と`object`が両方埋まっている場合のみSVOOと判定し、`indirectObject`だけが
埋まって`object`が空という文法的に不整合な組み合わせは`other`として扱う
（`derivePattern.ts`のコメント参照）。

**評価指標への影響**: `benchmark/run.ts`で「constituent extraction accuracy」
（subject/verb/indirectObject/object/complementの一致率の平均）と「pattern (derived)
accuracy」を明確に分けて集計するようにした。前者はLLMの抽出精度、後者は
「抽出結果からのpattern導出が正しいか」を示す。導出規則自体は決定的なので、
pattern (derived) の誤りは実質的にconstituent抽出側の誤りに起因する（規則のバグを除く）。

## Clause.role を enum(grammaticalRole) + 自由記述(roleExplanation) に分離した

**変更**: `clauseSchema.role: z.string()`（自由記述）を廃止し、
`grammaticalRole: enum(subject|object|complement|modifier|adverbial|apposition|other)`と
`roleExplanation: z.string()`（日本語自由記述）の2フィールドに分離した。
UIは`grammaticalRole`を`GRAMMATICAL_ROLE_LABEL`で日本語ラベルに変換して表示し、
enum値を生の英語のままユーザーに見せない。

**理由**: Prototype 0の実データで、7Bモデルが`role: "indirectObject"`という英語を
そのまま返す例が確認された（プロンプトで「日本語で書け」と指示していたにもかかわらず）。
自由記述フィールドは意味分類にも文章による補足説明にも使われてしまい、UIでの
一貫した日本語表示を保証できない。文法上の分類として有限集合にできるものはenum化し、
説明文（"なぜそう判断したか"）は別フィールドの自由記述として残す、という方針に分離した。
explanation/roleExplanation/meaning/readingHint/uncertaintiesのような、そもそも
定型化できない日本語の自由記述はenum化していない。

## プロンプトに用語定義とfew-shot例を追加した

**変更**: システムプロンプトに (1) sentenceCoreを最優先で埋め、`clauses`は従属節
専用（主節自身のS/V/Oを`clauses`に書かない）という優先順位の指示、(2) subject/
subjectHead/main verb/object・indirectObject/complementの厳密な定義（特に
complementは「5文型のCのみ」であり、前置詞句・時や場所や方法を表す修飾語句は
complementではないと明記）、(3) 5パターン分の最小限のfew-shot例（SVO/SVC/SVOC/
分詞後置修飾/that名詞節、うち1つは前置詞句がcomplementではない例を明示）を追加した。

**理由**: 3Bモデルの「subjectをnullにして`clauses`へS相当の情報を詰め込む」挙動は、
schemaが弱いからというよりプロンプトが「まずsentenceCoreを埋めるべき」という優先順位を
明示していなかったことが一因と考えられたため、まずプロンプト側で対応した
（schemaに「subjectを必ず非nullにする」制約を入れる案は、省略や倒置などを含む
英文では不適切なため見送った）。few-shot例は仕様書の指示どおり最小限（5例）に留め、
大量の例でモデルを誘導しすぎないようにしている。

## ベンチマークデータセット(28文)の変更点

既存28文の英文・タグ・notesは変更していない。SVOOの例文
(`svoo-01`, "The system gives users immediate feedback.") のgoldのみ、新しい
`indirectObject`フィールドに対応させるため`object: "users immediate feedback"`を
`indirectObject: "users"` / `object: "immediate feedback"`に分割した
（`subject`/`verb`/`pattern`は変更なし）。評価を良く見せるための書き換えではなく、
スキーマ変更に伴う機械的な追従であることを明記しておく。

## プロンプトの長さがsentenceCore抽出を悪化させた（発見・修正）

最初に書いた詳細版プロンプト（用語定義+優先順位指示+5例のfew-shotで約90行）を7Bで
実行したところ、`subject`/`verb`一致率がbaselineの100%/93%から61%/61%へ**悪化**した。
実際の出力を確認すると、単純な文("The temperature increased gradually.")を含む
11/28文で`sentenceCore`が丸ごとnullになり、代わりに主語・動詞の情報が`phrases`
（本来は熟語・定型表現用）や`vocabulary`に迷い込んでいた。confidenceは1.0、
uncertaintiesは空で、readingHintの説明文には正しい主語・動詞が書かれていたにも
かかわらずsentenceCoreには反映されないというパターンで、「曖昧だから確信度を下げて
書かない」という意図された振る舞いではなく、プロンプトが長くなったことで
「まずsentenceCoreを埋める」という指示自体への注意が薄まったことが疑われた。

対処として、同じ内容を約45行に圧縮し、例を5個→3個に減らし、冗長な言い回しを削除した
（現在の`grammarAnalysisPrompt.ts`）。7Bで再実行した結果、subject 61%→82%、
verb 61%→86%、constituent avg 74%→81%まで回復した（baselineの100%/93%までは
戻っていない）。一方、complement（36%→71%）とpattern (derived)（29%→54%）は
圧縮後も明確にbaselineを上回っており、用語定義とpattern導出の変更自体の効果は
残っている。

**教訓**: プロンプトへ指示を追加するほど精度が上がるとは限らない。特に7B程度の
モデルでは、指示文の長さそのものが構造化フィールドの抽出精度に対するコストになり得る。
今後さらにprompt/schemaを調整する場合は、追加のたびにベンチマーク全体を回して
このような回帰がないか確認する必要がある（次段階への判断Bとして提示する）。

## 3Bモデルはプロンプト変更後、sentenceCoreを一貫して埋められなくなった

最終ベンチマーク（`benchmark/results/2026-08-09T09-15-00-870Z/`）で、3Bモデルは
**28文中28文すべて**でsentenceCoreが空（subject/verb/object/complement全てnull、
pattern="other"）になった。Prototype 0 baselineではsubjectは元々0%だったが、
verbは43%当たっていたため、これは悪化である。実際の出力を見ると、3Bは今回のプロンプトの
「clausesは従属節専用、主節のS/V/Oをclausesへ書くな」という指示があるにもかかわらず、
依然として主語らしき情報を`clauses`へ`grammaticalRole: "subject"`として書き込み、
`sentenceCore`は空のままにしている（例: svo-01で`clauses: [{span: "The researchers",
kind: "nounClause", grammaticalRole: "subject", ...}]`）。日本語指定の
`roleExplanation`やreadingHintも英語で書かれており、指示の遵守自体が7B/14Bと比べて
明確に弱い。7Bでは同種の問題を大幅に改善できたのに対し、3Bでは改善しなかったことから、
これはプロンプトの表現だけでなく3Bモデル自体の instruction-following 能力の限界による
部分が大きいと考えられる。

## complementの誤判定は完全には解消していない

用語定義を追加した後も、"The method that we proposed improved accuracy significantly."
に対して7B・14Bともに副詞"significantly"を`complement`に入れる誤りが残った
（正しくはnull、"significantly"は"improved"を修飾する副詞）。7Bでは
"...to improve classification accuracy"という目的の不定詞句をcomplementに
入れる誤りも見られた。プロンプトでの用語定義追加は一定の改善をもたらした
（baseline比でcomplement精度は7B 36%→68%、14B [beforeデータなし]→75%）ものの、
「動詞の直後に来る修飾要素」を補語と誤認する傾向は完全にはなくなっていない。

## Prototype 0 baseline の保存場所

Prototype 0時点（LLMがpatternを直接回答し、`role`が自由記述だった頃）の3B/7B
ベンチマーク結果を`benchmark/baselines/prototype-0/`にコピーして保存した
（`benchmark/results/`は`.gitignore`対象のため、比較用の固定スナップショットは
別ディレクトリに置いている）。Prototype 0.1以降の結果と比較する際はこのディレクトリを
参照する。

## Ollamaの structured output は JSON Schema をそのまま渡す方式にした

`format` に `"json"`（緩いJSONモード）ではなく、`GRAMMAR_ANALYSIS_JSON_SCHEMA`
(`src/features/grammar/schemas/grammarAnalysis.jsonSchema.ts`) を直接渡している。
実装前に Ollama 0.32.6 + qwen2.5:3b-instruct に対して、`anyOf: [object, null]` による
nullable なネストしたオブジェクト (span) が正しく grammar-constrained decode されることを
`curl` 相当のリクエストで確認済み。small モデルでも安定してスキーマ通りのJSONを返せるかが
Prototype 0 の検証項目の一つ（仕様書 4章 9番）そのものであるため、より制約の強い方式を
採用して検証する価値があると判断した。

## zod が正、JSON Schemaは手書きで追従

`grammarAnalysis.schema.ts`（zod、実行時バリデーションの正）と
`grammarAnalysis.jsonSchema.ts`（Ollamaの`format`に渡す手書きJSON Schema）は別ファイル。
`zod-to-json-schema` 等の自動変換ライブラリは依存を増やすため導入せず、代わりに
jsonSchema側の冒頭コメントで「変更したら両方直すこと」を明記している。フィールド数が
少ない Prototype 0 では手動同期のコストは小さいと判断したが、フィールドが増える場合は
自動生成への切り替えを検討すべき。

## span の start/end はアプリ側で必ず再計算する

LLMが返す `start`/`end` は文字カウントを誤りやすい（3b/7bモデルで実際にずれを確認済み）。
`resolveSpan`（`src/utils/spanMatch.ts`）は
1. 申告された offset がそのまま正しいか確認
2. ずれていても `text` が原文の厳密な部分文字列なら `indexOf` で座標を補正
3. 空白の違い（改行・連続空白など）だけがずれの原因なら空白非依存の正規表現で再探索
4. それでも見つからなければ `resolved: false` とし、`GrammarAnalysis.uncertainties` に
   日本語の注記を追加する（UIはこれを「解析の確からしさ」セクションに表示する）
という順で解決する。座標を捏造せず、見つからない場合は明示的に「不明」として扱う。

## repair は1回だけ、失敗時はフォールバックの空解析を返す

`GrammarAnalyzer.analyzeSentence` は無限リトライしない
(`MAX_REPAIR_ATTEMPTS = 1`, `src/config/settings.ts`)。
1回の repair でも schema validation に通らない場合は例外を投げず、
`needsMoreContext: true` / `confidence: 0` / `uncertainties` にエラー概要を積んだ
空の `GrammarAnalysis` を返す（`buildFallbackAnalysis`）。UIはこれを警告バナー付きで
表示し、アプリ全体は落ちない。

## vocabulary（重要単語）は Span を持たない

活用形・派生形で原文と完全一致しないことが多い語彙項目（例: 原文 "indicated" に対し
辞書形 "indicate" を挙げたい場合）を許容するため、`vocabulary` の `word` はテキストのみで
`start`/`end` を要求しない設計にした。厳密な原文照合が必要な要素（chunks/modifiers/clauses/
phrases/sentenceCore）とは非対称だが、意図的な簡略化。

## ドメイン層はブラウザ(Vite)とNode(ベンチマークCLI)の両方から実行できるようにした

`src/config`, `src/utils`, `src/llm`, `src/features/grammar/schemas`,
`src/features/grammar/domain` はUIを一切importしない。`benchmark/run.ts` は
Node 24 のネイティブTypeScript実行（型ストリッピング、追加パッケージ不要）でこれらを
直接importし、アプリ本体と同じ `GrammarAnalyzer` でベンチマークを回す。これにより
「アプリでの見え方」と「ベンチマーク結果」が乖離しない。ただし Node は相対importに
拡張子を要求するため、上記ドメイン層内の相対importだけは明示的に `.ts` を付けている
（`tsconfig.app.json`/`tsconfig.node.json` はどちらも `allowImportingTsExtensions: true`
なのでVite側もこの書き方を問題なく解決できる）。UIの `.tsx` ファイルはVite専用で
Nodeから直接実行されないため、この制約を受けず拡張子なしのままにしている。

## サンプル文の二重利用

`benchmark/sentences/dataset.json` の28文は、(a) `npm run benchmark` での複数モデル比較と
(b) UIの「評価文から選択」ドロップダウン（`SentenceInputPanel`）の両方から参照している。
一つのデータセットを手動確認と自動比較の両方に使うことで、food-for-thoughtな文の追加・
修正が両方の用途に反映される。

## Prototype 0 で意図的に入れなかったUI要素

- temperature スライダー: `DEFAULT_TEMPERATURE = 0.1` 固定。文法解析用途では低温度が
  妥当という前提（仕様書8章）で、まずは調整UIなしで精度を評価する。
- 解析履歴の保存: 仕様書は「解析履歴を外部送信しない」とは述べているが、
  ローカル保存自体もPrototype 0の完了条件（21章）に含まれていないため未実装。

---

# Prototype 2.4B — PDF selection reconstruction: PDF.js-only heuristics retired in favor of a local PyMuPDF service

**Final architecture (Prototype 2.4 checkpoint):**

```
PDF.js (browser, src/features/pdf)
  - rendering, continuous scroll, canvas, text layer
  - native drag interaction
  - acquires selection ENDPOINTS ONLY: page-local normalized (0-1, top-down) x/y
    coordinates + exact boundary text (click-to-end-of-line / start-of-line-to-click)
  - never used as a cross-block/cross-page membership or reconstruction authority

PyMuPDF local service (services/pymupdf_layout, Python, local-only)
  - native paragraph/block extraction via page.get_text("dict")
  - resolves each endpoint to its own native block (coordinate hit-test, falling back to
    exact boundary-text search — never fuzzy/semantic matching)
  - reconstructs the text between two different blocks/pages when they differ

Routing (every selection, no shortcuts):
  same PyMuPDF block  -> use the browser's own native Range selection text, unchanged
  different blocks    -> use the service's reconstructedText/fragments
  service unreachable/errors -> explicit failure message to the user; NEVER a silent
                                 fallback to the retired custom heuristic

Grammar pipeline (src/features/grammar) and OCR (src/features/ocr) are unchanged by any
of this — they only ever see the final selected/reconstructed string.
```

## Why the custom PDF.js-only heuristic was retired (R1–R5B)

Six rounds (R1–R5B) of a hand-built, PDF.js-only geometry/typography heuristic — column-
anchor detection, gutter-crossing checks, FULL_WIDTH/LEFT/RIGHT zone classification,
font-height-based paragraph/block segmentation, drop-cap merging — were built to solve
cross-column and cross-page selection reconstruction. Each round passed its own
Node/pdfjs-dist simulation cleanly, then failed live-browser acceptance on a **new**
real paper, each time via a genuinely new failure mode not covered by the existing rules
(narrow inter-column gutters, decorative drop-cap openers, a caption/footnote sharing its
column's own x-range, a click landing in the gap between two blocks). Continuing to add
publisher-specific thresholds was not converging.

## Why PyMuPDF (R6/R7)

R6 spike-tested PyMuPDF's own native `page.get_text("dict")` block segmentation against
the exact real PDFs that had broken the custom heuristic. It separated body/footnote/
caption blocks correctly with **zero** custom geometry logic. R7 built an end-to-end
spike (repo-external FastAPI service + a Node client using real PDF.js-captured
coordinates) and confirmed exact, zero-pollution reconstruction on all failing fixtures,
after fixing one real bug: a block hit-test's nearest-block fallback must use nearest
**edge** distance (not center distance), preferring x-overlapping blocks — a large
block's center can be closer than a small, correctly-adjacent block's edge. PDF.js's
`page.view` and PyMuPDF's `page.rect` were confirmed numerically identical for the same
page (both top-down, 0-1 normalizable, no unit conversion needed).

R8 integrated this into production (`services/pymupdf_layout/main.py`), carrying the
edge-distance fix forward verbatim, adding document registration (a browser `File`/`Blob`
never exposes a filesystem path, so upload-by-bytes + an opaque `documentId` is the only
viable API — no raw-path endpoint exists), and adding middle-page handling for 3+ page
selections (a page fully spanned by a selection contributes every block within 12% of the
page's own median font size, excluding header/footer/footnote-sized blocks).

## Staged retirement

`src/features/pdf/domain/pageLayoutClassifier.ts` (the custom block/zone model) was kept
in the repository, unused by production code, through R8's live-acceptance step —
deliberately reversible in case live acceptance failed again. Live acceptance passed
(Failure A same-page cross-column, Failure B cross-page, the Elsevier regression fixture,
continuous scroll — all confirmed PASS in a real browser) at the Prototype 2.4 checkpoint,
and a usage search confirmed zero production importers, so the module and its two
dedicated test files (`tests/pdf/pageLayoutClassifier.test.ts`,
`tests/pdf/multiPageReconstruction.test.ts`) were deleted at that point. `pageTextClassifier.ts`
(repetition-based header/footer/page-number filtering) and `crossPageSelection.ts`/
`fragmentJoin.ts` (fragment joining) are a separate, orthogonal concern — not part of this
retirement, still actively used downstream of whatever text PyMuPDF supplies.

## Known limitation: display equations

Selections that land near a display equation can misresolve — e.g. selecting text ending
"...can then be used as a moderator..." near an equation numbered "(5)" can pick up the
equation-number text object instead of (or appended to) the intended body text. Equation
numbers, equation bodies, and surrounding prose are frequently separate text objects with
layout that doesn't cleanly match ordinary paragraph-block assumptions. This is an
explicit, accepted Prototype 2.4 limitation, not fixed in this phase — normal academic
prose selection (the checkpoint's actual acceptance scope) is unaffected. A future phase
could treat a display equation as a logical placeholder (e.g. `[Equation (5)]`) and stitch
the surrounding prose around it, but no equation-specific heuristic was added now to avoid
reopening the same "keep layering special cases" trap R1–R5B fell into.

## A real incident worth remembering: stale process masking a fix (R7)

After editing the service and attempting to restart it, `/health` kept returning success
from what turned out to be the *old*, unfixed process — a `pkill` invoked from git-bash
had failed to actually terminate the Windows-spawned Python process, and the new process
had silently failed to bind (port already held). This is why `/health` returns a
`serviceVersion` string: bump it whenever `main.py`'s selection-reconstruction logic
changes, and check it after every restart during development.

## License

PyMuPDF is AGPL-3.0, with a commercial license available from Artifex. Local/personal
development and use is unaffected. Distributing this app to others (public release,
hosted service, sale) would require either an AGPL-compatible release or a commercial
license — a decision deferred to when that's actually being considered, not resolved
here. No AGPL notice is shown in the app's own UI; see `services/pymupdf_layout/README.md`
for the full note.
