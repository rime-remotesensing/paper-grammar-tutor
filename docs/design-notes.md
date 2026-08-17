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

PyMuPDF is available under GNU AGPL v3, with a commercial license available from Artifex.
The distribution decision was finalized in Prototype 2.5ZJ: Paper Grammar Tutor's
project-authored code is released as `AGPL-3.0-only`. The root `LICENSE`,
`THIRD_PARTY_NOTICES.md`, and the app footer now expose the applicable license/source
information; third-party components retain their upstream licenses.

---

# Prototype 2.5A/B — equation-adjacent selection: root cause and the safety-guard fix

Prototype 2.4's live acceptance passed for normal academic prose (same-column,
cross-column, cross-page) but found a new failure near display equations: selecting
"The value of k can then be used as a moderator [9] for the cosine equation," on the
Soenen (2005) paper's page 2 (near equation (5)) reconstructed as `"The value of (5)"`.

## Root cause (2.5A diagnosis)

Traced empirically by running real PDF.js/PyMuPDF coordinate/text dumps through an
instrumented copy of the production endpoint-resolution logic. Two independent, real
findings, both confirmed against the actual PDF:

1. **The equation number "(5)" is a real, resolvable PyMuPDF block sitting close to a
   plausible drag path.** The equation *body* itself is pure vector graphics (zero
   extractable text) — a large text-free gap — so the bare `"(5)"` text is the only real,
   resolvable content in that whole region. A drag ending on/near it (a very plausible
   action when trying to select a sentence that grammatically continues "...for the
   cosine equation, as [Eq. 5]...") resolves cleanly, by the code's own existing logic, to
   that equation-number block — the R7 boundaryText-anchor safety net doesn't help here,
   because the boundaryText genuinely *is* `"(5)"` in this case; there's nothing to
   recover.
2. **The inline math variable "k" produces zero text items in both PDF.js and PyMuPDF** —
   confirmed on the actual page: it's a pure vector-only glyph, invisible to text
   extraction on either engine (a PDF-authoring-level limitation, not an engine bug). This
   left an anomalously large (~9.8pt) gap between the two spans "of" and "can then be used
   as a moderator..." on the same visual row — which turned out to sit in **two different
   PyMuPDF blocks** despite being on the same physical text row (PyMuPDF's own block
   clustering treated the gap as a paragraph boundary). A second real PDF (MDPI) confirmed
   this is a general PyMuPDF-native-block phenomenon around complex/inline math, not
   Soenen-specific — its equation region fragments into 7+ tiny, cryptic blocks instead.

Neither finding implicated the R7/R8 architecture itself — the boundaryText anchor logic,
edge-distance fallback, and coordinate hit-testing all behaved exactly as designed. The
gap was conceptual: nothing in the system had any notion that an isolated `"(N)"` block is
categorically different from prose, or that a large unexplained span gap might mean a
glyph is silently missing.

## The fix (2.5B)

Two narrow, geometry-only safety checks in `services/pymupdf_layout/main.py` — see that
service's own README ("Equation-adjacent safety checks") for the full mechanism. Neither
attempts equation transcription, OCR, or semantic parsing; both are pure safe-failure
signals:

1. An **equation-number-like endpoint guard**: a block is never accepted as a final
   endpoint if its entire content is nothing but `"(N)"`, with one narrow recovery
   attempt (anchor search restricted to non-equation-number blocks, skipped entirely when
   the anchor text is itself just an equation-number token) before falling back to an
   explicit `422 equation_endpoint_unresolved`.
2. A **suspicious-gap detector**: spans are grouped into visual rows across the whole
   page (independent of block membership, since the real "of"/"can then be used..." case
   sits in two different blocks on one row) and any same-row gap clearly exceeding normal
   spacing (relative to font size) is flagged. `/layout/selection` returns
   `warnings: ["UNEXTRACTABLE_GLYPH_GAP"]` whenever a selection's lines touch such a gap
   — checked even for `sameBlock: true`, since native Range text is missing the same
   glyph a reconstruction would be. The frontend treats any warning as a safe failure
   (`"選択範囲に正確に読み取れない記号が含まれています。"`), never a silent partial
   success.

A real bug was caught and fixed during this phase's own test-writing (not by the user):
the equation-number recovery's anchor search could itself match an unrelated `"(5)"`
substring inside ordinary prose elsewhere on the page when `boundaryText` was just the
short token `"(5)"` — fixed by skipping recovery entirely when the anchor text is itself
equation-number-shaped, going straight to safe failure instead.

## What's still deferred

- **Equation transcription / reconstruction** of any kind (LaTeX, MathML, formula OCR,
  semantic parsing) — out of scope for this app's purpose (English grammar reading
  support, not equation understanding).
- **Placeholder text** (e.g. `[式 (5)]`) for a sentence that genuinely crosses a display
  equation — conceptually feasible for Soenen's isolated-number shape (2.5A prototyped
  it informally), but MDPI's fragmented-block shape has no single clean block to
  placeholder; would need its own dedicated feasibility round.
- **Localized OCR recovery** of a single missing vector-only glyph — implemented in
  Prototype 2.5E (see below); this bullet is kept only as a historical record of the
  phase-2.5B scoping decision.

---

# Prototype 2.5C/D/E — localized missing-glyph OCR recovery

Prototype 2.5B's `UNEXTRACTABLE_GLYPH_GAP` warning made the "k" case safe (never silently
wrong) but not actually *usable*: the live-accepted sentence "The value of k can then be
used..." simply failed to read at all. Three further rounds closed this gap.

## 2.5C — is localized OCR even feasible?

Repo-external spike (no production code touched). Rendered the exact "k" gap at several
crop strategies (tight gap-only, padded gap-only, full visual line, two-line context) and
scales (2x–8x) via PyMuPDF pixmap, OCR'd via the existing local Paddle service. Findings:

- **`FULL_VISUAL_LINE` at 4x is both sufficient and reliable**: OCR read the entire line
  — `"of k can then be used as a moderator [9] for the cosine equation,"` — correctly,
  confidence 0.986–1.000, 100% repeatable across runs. **Padding the tight gap-only crop
  made things WORSE** (`"f k c"` — pulled in neighbor-letter fragments), contradicting the
  a priori assumption that more context always helps; a tight or full-line crop both beat
  a padded gap crop.
- Generalized cleanly to three more real, independently-verified vector-only glyphs on the
  same page: "e" (exitance angle), "θ" (solar zenith angle — U+03B8, confirmed via raw
  codepoint since a terminal encoding issue made it *look* like a misread at first), and
  "Ln" (radiance, two occurrences).
- **Alignment strategy validated**: given trusted left/right extracted text as anchors,
  searching for both (in order) within the OCR line and taking the substring between them
  recovers exactly the missing text — never trusts OCR beyond that bounded substring.
- Negative controls (ordinary word spacing, blank page space) never invented characters.
- Searched MDPI for a second real positive — found none (stated honestly rather than
  manufactured) — but this search surfaced a *different* real problem: MDPI renders many
  words as individual spans, so ordinary inter-word spacing registers as a "suspicious
  gap" under 2.5B's own detector. Also discovered, independently: even the *already
  live-accepted* Failure A/Failure B selections carried `UNEXTRACTABLE_GLYPH_GAP` on the
  real Soenen PDF — the ~12pt column gutter falls in the same numeric range as a genuine
  missing-glyph gap. **This meant 2.5B, exactly as it stood, would very likely have broken
  ordinary cross-column selection** — a live regression the existing test suite never
  caught, because no test asserted an empty-warnings condition on Failure A/B.

Decision: `LOCALIZED_GLYPH_OCR_FEASIBLE` + `LINE_CONTEXT_OCR_FEASIBLE`, with an explicit
recommendation to fix the newly-found false-positive modes before shipping OCR recovery on
top of them.

## 2.5D — can a false-positive gap be told apart from a real one without OCR?

The correction to attempt was explicitly constrained: **not** "restrict to the same
PyMuPDF block" — the real "k" gap sits *between* two different blocks (`2:128`/`2:130`)
that happen to share one visual row, so a same-block restriction would delete the exact
signal being recovered. Instead: render the candidate gap itself (no OCR) and classify it
by whether it contains any actual ink.

Built a deterministic pixel-ratio classifier (no ML): render at 4x, grayscale; estimate
background per-crop (90th brightness percentile, not a hardcoded pure white); count
clearly-non-background pixels in the horizontally-inset central 70% (avoids edge-bleed
from neighboring glyphs). Tested against 6 real positives (k×2, e, θ, Ln×2) and 27 real/
realistic false positives (ordinary Soenen spaces, the real gaps touching Failure A/B's
own included lines — both the column-gutter kind and a within-column word-split kind, and
genuine ordinary-prose MDPI word gaps, re-derived after an initial mistake pulled
candidates from MDPI's equation region instead by accident). Result: **every tested
positive read ≥0.1185; every tested false positive read exactly 0.0000** — a wide,
clean separation. A block-x-range-overlap prefilter was also tested (real-k block pair:
100% overlap; gutter block pair: 0% overlap) and works, but wasn't needed given the
visual-ink gate alone already achieves clean separation at near-zero cost.

Decision: `VISUAL_INK_GATE_FEASIBLE`, `GEOMETRY_PREFILTER_NOT_NEEDED`.

## 2.5E — production integration

Combines 2.5B's candidate generation + a new adjacency restriction + 2.5D's visual-ink
gate + 2.5C's localized-line OCR recovery, in `services/pymupdf_layout/main.py` (see that
service's own README for the full mechanism and API surface). Key design points not
already covered above:

- **Adjacency restriction** (the other half of the 2.5B fix, alongside the visual-ink
  gate): a candidate gap is only ever considered when it sits directly between two lines
  that are ADJACENT in a *specific selection's own* assembled reading order — never "any
  candidate gap that happens to touch a page-wide line somewhere." This alone excludes
  nearly all cross-column/unrelated-row noise, and combined with the visual-ink gate gives
  two independent, mutually-reinforcing fixes for the same 2.5C-discovered regression.
- **Schema change from 2.5B**: the `warnings` field is gone. A missing-glyph gap that
  passes the visual-ink gate is either recovered silently (no signal needed — the
  reconstructed text is simply correct) or fails the whole selection explicitly (`422
  missing_glyph_unresolved`) — there is no longer an intermediate "succeeded, but here's a
  warning" state. `reconstructedText` non-null is now the sole "use this text" signal,
  regardless of `sameBlock` (a same-block selection that needed recovery gets its own
  repaired `reconstructedText`/`fragments`, structurally still `sameBlock: true`).
- **Trust model**: PyMuPDF/PDF.js text is authoritative everywhere it exists. Paddle OCR
  is authoritative *only* for the exact substring strictly between two trusted anchor
  texts (comparison-normalized for ligatures/NFKC/whitespace — a real bug caught during
  this phase's own test-writing: the raw PyMuPDF text for "reflectance" contains the
  ligature codepoint `ﬂ`, which Paddle naturally OCRs as plain `fl`, so anchor matching
  must normalize both sides the same way `_normalize_for_match` already does elsewhere in
  this file, or a perfectly correct OCR read gets discarded as unrecoverable).
- **Paddle is optional**: only ever called for a visual-ink-positive candidate; an
  ordinary selection (the overwhelming majority) never touches it, so Paddle being offline
  never affects ordinary PDF reading — proven by a test suite that forcibly disables OCR
  (raises if called) for Failure A/Failure B/MDPI prose and confirms they still succeed.
- **Scope limit, not yet needed by evidence**: missing-glyph recovery is not attempted for
  middle-page text in a 3+ page selection, nor at a first-page/last-page transition in a
  cross-page selection — a visual row can never physically span two rendered pages, and no
  real case has been found requiring within-middle-page recovery. If one turns up, extend
  `_middle_page_text` the same way `_assemble_lines_with_gap_recovery` already works.
- **numpy**: used in the 2.5D spike; deliberately NOT added to the production service —
  the crop is tiny, so a plain-Python grayscale-byte loop is negligible-cost and avoids a
  new dependency. Numerically verified to agree with the 2.5D numpy reference (0.17857...
  vs. 0.1786 for the same real "k" gap).

Live-accepted target: selecting "The value of k can then be used as a moderator [9] for
the cosine equation," now reads correctly, "k" included, with no equation-number
contamination and no regression in Failure A/Failure B/previous-Elsevier/MDPI prose.

---

# Prototype 2.5F/G — display-equation placeholder

2.5E's live acceptance found the "k" recovery worked, but a drag continuing through the
display equation to its equation number ("(5)") still just failed — the pre-existing
2.5B equation-number endpoint guard was (correctly) rejecting it, since there was no
prose anchor to recover into. 2.5F diagnosed this precisely (repo-external, read-only)
before any implementation:

## 2.5F diagnosis

- The equation-number endpoint guard and missing-glyph recovery are **geometrically
  disjoint** mechanisms — the guard fires when an ENDPOINT resolves to an isolated `"(N)"`
  block; missing-glyph recovery fires on a HORIZONTAL gap between two spans sharing a
  ROW. A display equation occupies its own VERTICAL band between two different rows
  (confirmed by rendering the actual equation region: a real, fully visible
  `Ln = L[cosθ/cos i]^k` expression) — a pattern neither existing mechanism was built to
  see, so there was no pipeline-ordering conflict to resolve, only a missing third
  behavior.
- The equation number is **already** reliably extracted text (that's exactly what the
  2.5B guard's own pattern match confirms) — building a placeholder needs no OCR of the
  equation body at all.
- A grammar A/B test (manually-typed sentences only, never automatic PDF output) showed
  `"...as [EQUATION_5]."` is handled substantially more coherently by the LLM than a bare
  `"...as (5)."` — recognized as its own reference-like unit (paralleling how `[9]`
  citation markers are already handled) rather than absorbed into an undifferentiated
  clause span with an awkward translation. The model's own classification of it as a
  `nounClause`, however, was not the desired grammatical treatment.

## 2.5G production integration

`_resolve_equation_crossing` in `main.py` (see that service's own README for the full
mechanism): when an endpoint resolves to an equation-number block with no recoverable
prose anchor, instead of failing immediately, checks whether the OTHER endpoint is
genuine prose on the same page, at or before the equation's own row — a real
prose-crossing selection, not a guess. If so, builds `"<prose>\n[式 (N)]"`, reusing the
EXISTING missing-glyph-aware line-assembly pipeline unchanged for the prose portion (so a
sentence needing both "k" recovery AND an equation placeholder — the actual real live
sentence — gets both, in one pass). If the selection is the equation-number token alone,
returns the placeholder with no prose ever collected. Otherwise (two different equation
numbers, or the not-yet-supported reverse drag direction — see below) it still fails
exactly as 2.5B/E did.

**Explicit scope limit**: only a selection *terminating* on the equation number is
supported (the natural prose-first drag direction). A drag physically starting at the
equation number and ending at earlier prose was not validated by 2.5F and is not
implemented — it safe-fails rather than silently generalizing beyond evidence. Cross-page
equation crossing is similarly out of scope (never validated, and a display equation
can't itself span a page boundary).

**Grammar-side**: `src/features/grammar/domain/equationPlaceholder.ts` converts between
the PDF-selection display form (`"[式 (5)]"`, shown in the textarea, never touched) and
the analysis-facing form (`"[EQUATION_5]"`) at exactly one boundary —
`App.tsx`'s `handleAnalyze`, right before the sentence is sent to the LLM. One minimal
rule was added to `grammarAnalysisPrompt.ts` ("[EQUATION] or [EQUATION_n] represents one
opaque displayed mathematical expression...") — deliberately NOT added to
`predicateStructurePrompt.ts` (the separate "detailed structure" / 骨格を見る prompt),
which carries a standing "do not tune" constraint from Prototype 2.3C and wasn't the
subject of 2.5F's own evidence.

**Span-authority handling (item 13)**: rather than trying to bridge two different-length
string representations at the span/offset level (`"[式 (5)]"` is 7 characters, `"[EQUATION_5]"`
is 12 — converting one to the other mid-pipeline would shift every subsequent offset), the
ENTIRE analysis pipeline (originalText, normalizedText, every span's `start`/`end`, and
StructureTreeView's own position-based rendering) operates on the analysis-facing
(`[EQUATION_5]`) text throughout, unconverted. Only `readingHint`, `referenceTranslation`,
and the free-text `contextualMeaning`/`meaning`/`explanation`/`roleExplanation` fields —
LLM-generated prose, not slices of the source sentence — are converted back to `"[式 (5)]"`
for display, via `restoreEquationPlaceholdersInFreeText`. **Known, deliberate scope
limit**: span-derived text (sentenceCore fields, chunk/modifier/clause/phrase `.span.text`,
and StructureTreeView's own rendering) still shows the raw `[EQUATION_5]` token literally.
Fixing this fully would require `StructureTreeView` to know the placeholder mapping and
substitute the display form only where it renders that exact span — deferred rather than
risked without dedicated testing of that rendering path.

## Grammar benchmark result (5 real runs, qwen2.5:7b-instruct)

Ran the exact production analysis-facing sentence (`"...as [EQUATION_5]."`) through the
real pipeline, with the new prompt rule, 5 times: **0/5 runs classified `[EQUATION_5]` as
`nounClause`** (the specific failure 2.5F found) — 4/5 used `clauses[].kind: "other"`,
1/5 used `"adverbClause"`; neither is on the explicitly-forbidden list (nounClause,
relative clause, main clause). sentenceCore (subject="The value of k", verb="can be
used") was consistent across all 5 runs. A separate check of the DETAILED structure path
("骨格を見る") found an occasional grounding failure ("can be used" not found verbatim) —
confirmed, by testing the identical sentence without any equation placeholder at all, to
be a **pre-existing, equation-unrelated** LLM behavior (the sentence's own "can **then**
be used" phrasing occasionally gets paraphrased without "then" by the detailed-structure
call specifically), not something this phase introduced.

---

# Prototype 2.5H — citation-free grammar analysis normalization

2.5G's live acceptance confirmed the display-equation placeholder worked, but surfaced a
new, unrelated grammar-quality issue: the citation marker `"[9]"` (bibliographic
metadata, entirely unrelated to the equation work) was appearing as its own standalone
grammatical node — confirmed directly: with `"[9]"` present, the basic analysis's own
`chunks` array literally contained `"[9]"` as a THIRD, isolated chunk between the two real
clause halves. Product decision: citation markers stay fully visible in the source
textarea/PDF, but never participate in grammar analysis at all.

## Design

`src/features/grammar/domain/citationNormalization.ts` removes a run of numeric-only
bracket citations (`"[9]"`, a range `"[1]–[3]"`, a list `"[9], [11]"`, or a combined
sequence `"[1]–[3], [9], [11]"` — the exact real Failure A/B fixture shape) as one unit,
together with exactly one adjacent whitespace character, so no double space or dangling
comma/dash is ever left behind. Deliberately narrow, matching the equation-number guard's
own discipline: a citation token is a bracket containing ONLY digits — `"[Equation]"`,
`"[x]"`, `"[see Appendix A]"`, `"[式 (5)]"`, `"[EQUATION_5]"`, and malformed lookalikes
(`"[9a]"`, `"[1-foo]"`) never match, by construction, without needing to know anything
about the equation-placeholder feature specifically. Citations are **removed entirely**,
not converted to a `"[CITATION_9]"`-style token — a decision made explicitly against
giving the LLM yet another opaque structural unit to place somewhere, since a citation
(unlike a display equation) has no grammatical role to represent at all.

`src/features/grammar/domain/grammarInputNormalization.ts` composes citation removal and
equation-placeholder normalization into the ONE boundary `App.tsx`'s `handleAnalyze`
calls — citation removal first, equation normalization second (order is actually
irrelevant here, proven by a dedicated test, since citation removal's `\[\d+\]`-only
pattern can never match an equation placeholder's non-numeric bracket contents).

No new prompt rule was added — citations are gone before the LLM ever sees the sentence,
so there's nothing for a prompt instruction to suppress. No reverse-display mapping is
needed either (unlike the equation placeholder): since the analysis text never contains
any citation-derived token at all, there's nothing to restore for display.

## Live-observed problem, reproduced and fixed

Real `qwen2.5:7b-instruct` benchmark on the exact Soenen sentence:
- **With `"[9]"` present** (1 run): `chunks` = `["The value of k can then be used as a
  moderator", "[9]", "for the cosine equation, as [EQUATION_5]."]` — `"[9]"` literally its
  own chunk, exactly the reported defect.
- **Citation-free** (5 runs): citation absent from every clause/modifier/phrase node in
  all 5 runs (`citationAppearsAsNode: null` every time); chunk breakdowns instead split
  sensibly into the two real clause halves (e.g. `["...for the cosine equation,",
  "[EQUATION_5]."]`). sentenceCore (subject="The value of k", verb="can be used") and
  equation handling (`clauses[].kind: "other"`, never `nounClause`) stayed identical to
  2.5G's own result — no regression.

The DETAILED structure path ("骨格を見る") still occasionally hits the SAME pre-existing
"then"-grounding failure documented in the 2.5G section above (reproduced again here,
byte-identical error message) — reconfirmed unrelated to citation removal, since it was
already shown to occur on a sentence with neither a citation nor an equation placeholder
at all.

# Prototype 2.5I — cross-equation continuation: root-cause investigation

2.5H's live acceptance surfaced a new, distinct failure: a selection dragged from prose
BEFORE the Soenen paper's equation (6), through the equation, to prose AFTER it produced a
garbled textarea sentence ("...using the equation is the average of the measured radiance
data.") and a manual-re-read warning ("読み取り結果を選択範囲へ正しく対応付けられませんでした").
2.5G only ever validated "equation AT a selection's own end" — this new case has the
equation strictly INSIDE the selection, with real prose expected to continue after it.
Repo-external investigation only; no production edit this phase.

## Root cause, confirmed by direct code trace + a live call against the real fixture

Both the user's actual start and end coordinates resolve to ORDINARY PROSE (neither is the
equation-number block itself) — `_resolve_equation_crossing` (2.5G's whole equation-aware
mechanism) is gated on `start_is_eqnum or end_is_eqnum` and was therefore **never entered
at all**. The selection fell through to the ordinary same-page cross-block path, which only
ever uses `_block_boundary_lines(first_block, ..., "forward")` (the start block's own
trailing lines) and `_block_boundary_lines(last_block, ..., "backward")` (the end block's
own leading lines) — it never walks any block in between. Between the real before/after
prose sat the equation-number block itself AND five further prose blocks (PyMuPDF split
"where Ln is the normalized radiance, a and b are the y-intercept and slope of the
regression line, respectively, and Lavg is the average of the measured radiance data."
across six separate blocks on account of the same four vector-only missing glyphs the
existing recovery pipeline is built for: Ln, a, b, y, Lavg) — all silently skipped. A live
`/layout/selection` call against the real, unmodified production service reproduced this
exactly: `200 OK`, `reconstructedText = "equation\nis\nthe average of the measured radiance
data."`

## The UI warning was a downstream symptom, not the cause

`「読み取り結果を選択範囲へ正しく対応付けられませんでした」` is
`OcrFallbackPanel.tsx`'s `paddleStatus === 'alignmentFailed'` message — a completely
separate subsystem (the manual "読み直す" re-read button's own word-by-word alignment
check, `paddleAdapter.ts`'s `alignWordsToLine`). The user, seeing the garbled selection
result, clicked "読み直す" to try to fix it; fresh OCR naturally read the true visible
words ("where", "Ln", "y", ...), which cannot sequentially align against the already-wrong
base sentence, so alignment correctly refused rather than guessing. The textarea's garbled
text was traced (not assumed) to be **newly produced by the failing selection itself**, not
stale content from an earlier interaction.

## Validated fix architecture (prototyped repo-externally, not yet in production at this
point)

Walking every block strictly between the two prose endpoints (mirroring
`_prose_lines_up_to_equation`'s own pattern, generalized), substituting any genuine
equation-number-like block encountered along the way with its `[式 (N)]` placeholder,
reproduced the correct target text INCLUDING all five missing glyphs — but only once gap
recovery was run per CONTIGUOUS prose line-group rather than per individual PyMuPDF block
(the first prototype attempt grouped per-block and silently lost all five recoveries,
because "where"/"is the normalized radiance," etc. are on the SAME visual row but
DIFFERENT blocks — recovery needs them in one combined line list to detect that adjacency
at all).

**Decision**: `INTERMEDIATE_EQUATION_INSERTION_FEASIBLE`,
`CURRENT_FAILURE_IS_BACKEND_ASSEMBLY`. Next phase: Prototype 2.5J, production integration.

# Prototype 2.5J — cross-equation continuation production integration

Implements 2.5I's validated architecture, with one explicit correction from the review of
2.5I's own recommendation: **do not** generalize the ordinary same-page cross-block path
itself to walk every intermediate block — that would risk reintroducing the original
Prototype 2.4 Failure A pollution problem (a same-page cross-column selection can have
unrelated footnotes/captions/other-column blocks sitting between its two endpoint block
IDs). Instead, a narrowly-gated THIRD routing branch, entered only under specific,
locally-verifiable conditions, sitting alongside (never replacing) the existing ordinary
cross-block path.

## Routing model

```
same block                                         -> existing native/gap-repair path
equation number is an endpoint                     -> existing 2.5G _resolve_equation_crossing
both endpoints prose + same corridor + intermediate
  equation-number block found between them          -> NEW cross-equation continuation path
everything else                                     -> existing, UNMODIFIED ordinary
                                                        cross-block path
```

## "Same corridor" — local geometry, not a revived global column classifier

`_blocks_share_corridor(block_a, block_b)`: the two blocks' own x-ranges must overlap by at
least half of the NARROWER block's own width. Deliberately relative-to-width (not a fixed
pt tolerance), so a narrow equation-number block (~12pt wide in the real Soenen case)
correctly reads as "inside" a much wider prose column. Empirical margin, from real Soenen
page 2 geometry: the real equation (6) case measures a full `1.0` overlap ratio; the real
Failure A cross-column case measures `0.0` (the two columns' bboxes don't touch at all) —
wide margin either side of the `0.5` threshold.

This check gates the WHOLE new branch: `_blocks_share_corridor(start_block, end_block)`
must pass BEFORE any intermediate-block search happens at all, so a genuine cross-column
selection (Failure A's own shape) can never reach the new branch merely because an
equation-number-like block happens to sit at a block index between the two endpoints —
confirmed by a dedicated synthetic test (`test_cross_corridor_selection_never_enters_new_path`)
that places exactly such a block between two different-corridor endpoints and asserts the
existing ordinary-path output is reproduced byte-for-byte, with the equation-number-like
block's own text never appearing anywhere in the result.

## Finding an intermediate equation, and why it's checked against the endpoints' UNION

`_find_intermediate_equation_blocks` searches only the blocks strictly between the two
endpoints in the page's own PyMuPDF block-index order (never page-wide — a stray equation
number elsewhere on the page must never be picked). A candidate must sit at a compatible
vertical position AND share a corridor with the **union** of the two endpoint blocks' own
x-ranges, not each endpoint block checked separately. This was found necessary while
building the synthetic regression test: a single short prose line (e.g. the very last line
of a paragraph) legitimately doesn't reach as far right as a narrow equation-number block
sitting at a column's outer margin, so requiring the candidate to overlap BOTH endpoint
blocks individually is too strict. Using the union is safe specifically because the caller
only ever reaches this function after `_blocks_share_corridor(start_block, end_block)` has
already confirmed the two endpoints are themselves a genuinely narrow single column — their
union can never silently span two disjoint columns. (In the real Soenen fixture this
distinction doesn't matter, since both endpoint blocks there are multi-line paragraphs
whose own bbox union already reaches the column's right margin; the distinction matters for
selections ending on a short single-line block, which the synthetic fixture specifically
exercises.)

The same walk naturally generalizes to more than one intermediate equation without any
extra complexity — validated by a synthetic two-equation test
(`test_multiple_intermediate_equations_synthetic`).

## Contiguous line-group assembly (the bug 2.5I's own first prototype attempt found)

`_resolve_cross_equation_continuation` walks the block range once, accumulating lines into
a single running list; whenever an equation-number block is encountered, the accumulated
lines so far are flushed through `_assemble_lines_with_gap_recovery` as ONE group, the
placeholder token is appended, and a new group starts. This preserves same-row adjacency
across a block boundary (the real Soenen "where"/"is the normalized radiance," pair, on the
same row but different blocks) — grouping per individual block instead (2.5I's own first,
corrected, spike attempt) silently breaks that adjacency and drops real missing-glyph
recovery entirely.

## Real-fixture verification

A live call against the real, now-modified production service, using the exact
before/after coordinates matching the user's reported drag, produces:

> "Before prose...\n[式 (6)]\nwhere\nLn\nis the normalized radiance,\na\nand\nb\nare the\ny\n
> -inter-\ncept and slope of the regression line, respectively, and\nLavg\nis\nthe average
> of the measured radiance data."

— all five real vector-only glyphs (Ln, a, b, y, Lavg) recovered correctly in the same
pass, matching the target output after the frontend's existing newline-to-space
normalization.

## Test suite

`tests/test_cross_equation_continuation.py` (new, synthetic-PDF/mocked-OCR, always runs):
basic single-equation case (with a real cross-block same-row gap, asserting OCR is called
exactly once — protects against the per-block-grouping regression specifically), ordinary
no-equation cross-block selection unaffected, cross-corridor selection never enters the new
path, two intermediate equations (synthetic-only), Paddle-unavailable-inside-cross-equation
safe failure, and two pure-function tests for the corridor/discovery helpers directly.
`test_fixtures.py` gained the real Soenen equation (6) regression
(`test_soenen_equation_six_cross_continuation_recovers_all_glyphs`).

## A pre-existing, unrelated finding surfaced during verification

`test_previous_elsevier_regression` (previously validated clean through 2.5E/2.5G/2.5H)
failed at this point: the reconstructed text included an extra copyright/license line
between the two expected fragments. Disabling the entire 2.5J routing branch reproduced it
identically, proving it unrelated to equation-aware continuation. It remained deferred
during this phase.

Prototype 2.5ZG-BACKEND later reproduced the native geometry and corrected the original
root-cause assumption. The DOI and legal line occupy their own bottom-of-page PyMuPDF block
(`1:17`); the captured browser endpoint resolves to that block, then trusted boundary-text
substitution replaces the DOI line while the trailing legal line remained. A conservative
line-level reconstruction filter now requires bottom-margin geometry, final-line position,
smaller-than-body font, footer-like width, and multiple independent legal-publication
signals. It never uses publisher identity, never deletes the selected endpoint line, and
retains uncertain content. The exact fixture is green with synthetic body-keyword,
bottom-prose, footnote-like, and insufficient-evidence controls.

**Decision**: `CROSS_EQUATION_CONTINUATION_READY_FOR_LIVE_ACCEPTANCE`, with the Elsevier
finding above called out as a known, pre-existing, unrelated issue not blocking this
phase's own acceptance.

# Prototype 2.5K — parenthesized glyph recovery & display-equation region suppression:
investigation

2.5J's live acceptance surfaced two more, distinct failures on the same Soenen paper. Case
A: `"The parameter C is a function of the regression slope (b) and intercept (a)..."` lost
both vector-only glyphs, tightly hugged by round parentheses. Case B: equations (8)/(9)
contain extractable formula-body fragments (a bare `"C"`) that leaked into reconstructed
prose alongside the equation number. Repo-external investigation only.

## Case A root cause

Font size 9.96pt → the existing `SUSPICIOUS_GAP_EM_MULTIPLIER=0.6` requires a gap
`>5.98pt`. The two real gaps measure 4.36pt and 5.38pt — both real, both under threshold.
Root cause: the em-multiplier was tuned to catch a WIDE gap (a whole missing word between
two normally-spaced words, the "k" case); a single letter with NO surrounding spaces,
tightly hugged by parens, produces a NARROWER gap than an ordinary inter-word space (3.35pt/
0.336em in this document) needs to even trigger the rule — the opposite failure mode from
"k", not a smaller version of it.

Prototyped and validated end-to-end against the real PDF and the real running Paddle
service: extending the candidacy rule with "gap exceeds the absolute floor AND the left
span ends with '(' / right span starts with ')'" recovered both "(b)" (0.320 ink ratio,
OCR "ope (b) and" @ 0.9998) and "(a)" (0.221 ink ratio, OCR "cept (a)" @ 0.9733) — zero
changes needed to the ink-gate, OCR-recovery, or anchor-insertion stages. A full 12-page
document scan for the new rule (excluding matches the existing rule already caught) found
exactly 7 candidates total, ALL ink-positive (100% precision on this document) — a spot
check recovered an independent third instance, "the incidence angle (i)", confirming the
fix generalizes without hardcoding any specific letter.

## Case B: equation (8)/(9) block membership

Equation (8) = `{3:6 ("C", same row as the number), 3:10 ("(8)")}`. Equation (9) =
`{3:21 ("C", above), 3:27 ("C", below), 3:29 ("(9)")}` — a fraction, numerator and
denominator both containing "C", the fraction bar itself pure vector graphics. Both "C"
fragments measure ~6.6pt wide (0.011 normalized) versus real prose lines at 200+pt (0.34+
normalized) — a wide, safe separation margin. A live `/layout/selection` call against the
real, then-current 2.5J production code, spanning "...as an additive term" → equation (9)
→ "The parameter C is said...", confirmed the bug is real and reproducible:
`"term\nC\nC\n[式 (9)]\nThe parameter C is said to be analogous to the effects of dif-"`.

**Decisions**: `PARENTHESIZED_INLINE_GLYPH_RECOVERY_FEASIBLE`,
`DISPLAY_EQUATION_REGION_SUPPRESSION_FEASIBLE`. Next phase: Prototype 2.5L.

# Prototype 2.5L — parenthesized glyph recovery + display-equation region suppression:
production integration

Two independent, narrowly-scoped fixes, implemented as separate mechanisms per the user's
own explicit instruction ("do not create one generic 'math detector' that controls both").

## Part A: parenthesized inline glyph recovery

`_detect_suspicious_gaps` gained a second, independent candidacy rule (`PARENTHESIZED_GAP_OPEN`/
`PARENTHESIZED_GAP_CLOSE`, literal round parens only for now — square/curly brackets
interact with citation semantics and aren't needed by the real corpus yet): a gap is also a
candidate when it clears `SUSPICIOUS_GAP_MIN_PT` and its left/right neighbor spans end/start
with "("/")" respectively — deliberately NOT a lowered `SUSPICIOUS_GAP_EM_MULTIPLIER`, which
would also flag ordinary inter-word spaces everywhere. Required threading span `text`
through `raw_spans_pt` (previously geometry-only, by explicit original design to avoid
"content guessing" — threading through the span's own already-reliably-extracted PyMuPDF
text is structural matching, the same category as the existing equation-number regex, not
guessing). Every downstream stage — visual-ink gate, localized OCR, anchor-only insertion —
is completely unchanged.

Live production verification (real Paddle): the exact live-reported sentence now
reconstructs as `"The parameter C is a function of the regression slope (\nb\n) and\n
intercept (\na\n)"` — both glyphs recovered — and combined, in the SAME selection, with
Part B's equation (8) region suppression (see below), correctly producing both fixes
together with no interaction issues.

## Part B: display-equation region suppression

`_display_equation_region_blocks(page_blocks, eqnum_block, corridor_reference_block)`
walks a tightly bounded, LOCAL region from an already-confirmed `_is_equation_number_like_block`
anchor (never an unbounded "walk until it looks like prose" heuristic) — stopping at the
first block that isn't formula-fragment shaped (`_is_formula_fragment_block`: single line,
single token, narrow — `EQUATION_REGION_FRAGMENT_MAX_WIDTH_NORM=0.05` sits with a wide
margin between the real "C" fragments (~0.011) and the nearest real prose (≥0.069)), that's
more than one line-height away vertically (`EQUATION_REGION_MAX_VERTICAL_GAP_EM=1.0`; real
fragments measure vertical gap 0, the nearest real prose paragraph sits 1.5x line-height
away), or that falls outside the corridor established by a WIDE reference block the caller
already trusts.

**Corridor design note** (found while wiring this up, not anticipated in the 2.5K
investigation): checking a fragment candidate against `eqnum_block` itself (as
`_find_intermediate_equation_blocks` does for equation-vs-prose corridor checks) fails for
this case, because an equation-number block and a narrow formula fragment are BOTH narrow
and frequently don't literally overlap in x at all even within the same column (the real
"C" at x=151-158 vs "(8)" at x=279-291 on the same 39.6-290.7pt column). Fixed by checking
each fragment candidate against a WIDE prose block the caller already trusts instead (the
click's own prose block for the equation-at-end path; the union of both selection endpoints
for the cross-equation-continuation path, reusing the exact same union-Block construction
`_find_intermediate_equation_blocks` already built).

Both consuming paths were updated: `_prose_lines_up_to_equation` (2.5G equation-at-end)
now stops at the first block belonging to the target equation's own region, not just the
equation-number block itself; `_resolve_cross_equation_continuation` (2.5J) computes every
discovered equation's region BEFORE assembly starts (never appends a fragment and deletes
it via string replacement afterward) and skips every non-eqnum region member entirely
during the walk. If a block is ever claimed by more than one equation's region (not
observed on any real fixture — a defensive-only check), it's excluded from suppression
entirely and left as ordinary prose, rather than guessed.

Live production verification (real Paddle where relevant):
- equation (9): `"term\n[式 (9)]\nThe parameter C is said to be analogous to the effects of
  dif-"` — zero leaked "C" fragments (was `"term\nC\nC\n[式 (9)]\n..."` before the fix).
- equation (8), combined with Part A in the same selection: `"...regression slope (\nb\n)
  and\nintercept (\na\n)\n[式 (8)]"`.
- A read-only survey of all 11 equation-number anchors across the real 12-page document
  found fragment members on only 3 (equations (8)/(9)/(11), each a single "C") — the other
  8 are fully vector-only and correctly return just the equation number; zero unexpected
  prose absorption anywhere.

**Endpoint safety** (item 41/42): a NEW `_endpoint_is_formula_fragment` check makes a
selection endpoint landing directly ON a formula-fragment block (e.g. clicking the bare
"C") a safe failure (`formula_fragment_endpoint_unresolved`) rather than silently treating
it as ordinary prose — deliberately skips the corridor check (no wide reference exists yet
at endpoint-resolution time), accepting that over-triggering this rare safe-failure is far
less harmful than fabricating prose from formula debris.

## Testing

`tests/test_equation_region_suppression.py` (new, 16 tests) — PyMuPDF's own block
segmentation for freshly-synthesized text turned out to merge adjacent short `insert_text()`
calls (e.g. "C" and "(11)") far more readily than the real Soenen PDF's own content-stream
structure does, making coordinate-tuned synthetic PDFs unreliable for this specific shape;
most fixtures here inject a hand-built `PageBlocks` directly into the document's page cache
instead, giving exact deterministic control while still exercising the real production code
path. `test_equation_guard.py` gained 4 pure-function tests for the parenthesized
candidacy rule (including a backward-compat check that omitting "text" from a span dict
never KeyErrors). `test_fixtures.py` gained 4 real-fixture tests (Paddle-backed where
relevant): "(b)"/"(a)", "(i)" independent control, equation (8), equation (9).

## Known pre-existing finding, re-confirmed unrelated

`test_previous_elsevier_regression` still fails identically (byte-for-byte, re-verified by
disabling both 2.5L branches and re-running) — the same PyMuPDF block-segmentation
quirk on this specific PDF documented in 2.5J's own report, unrelated to either Part A or
Part B. Not fixed in this phase.

## Verification

Backend: 83 passed, 2 skipped (MDPI fixture unavailable), 1 known-unrelated failure
(Elsevier). Frontend: typecheck/lint/build clean, 676/676 tests passing, zero frontend
files touched. Paddle service: 16/16 unchanged. Performance (real Paddle, 5-run average):
ordinary selection 9.2ms, parenthesized recovery (1 OCR call) 89.0ms, equation (9) region
suppression (no OCR needed) 2.0ms, equation (6) continuation (5 OCR calls) 210.3ms — all
consistent with real OCR network/inference latency, not new algorithmic overhead.

**Decision**: `EQUATION_REGION_SUPPRESSION_READY_FOR_LIVE_ACCEPTANCE`.

# Prototype 2.5M — compound equation-end routing investigation

2.5L's live acceptance FAILED on a real compound selection: "...regression slope (b) and
intercept (a)" → equation (8) → "...additive term" → equation (9) as the selection's own
endpoint. Real reported symptom: raw formula fragment "C" and raw "(8)" leaking into the
prose, while equation (9) alone succeeded. 83/86 tests passing had never been in tension
with this, since no test combined an intermediate equation with a terminal equation
endpoint in one selection. Repo-external investigation only.

## Root cause, confirmed by direct trace

A live routing trace confirmed `end_is_eqnum=True` for the real coordinates, which trips
`/layout/selection`'s very first branch — the equation-at-end path — before the 2.5J
corridor/intermediate-equation logic ever runs. The equation-at-end path's own prose walk
(`_prose_lines_up_to_equation`) only ever protected its OWN target equation's region
(equation (9)); it had zero awareness that equation (8) sat between the prose and its own
destination, so equation (8)'s blocks (`3:6` "C", `3:10` "(8)") were walked straight
through as if they were ordinary prose lines. Equation (9) "succeeded" only because it was
the function's own designated destination, not because of any general mechanism.

A live call against the real, unmodified production service confirmed the exact raw
backend output: `"...slope (\nb\n) and\nintercept (\na\n)\nC\n(8)\nand is introduced...\n
term\n[式 (9)]"` — (b)/(a) recovery itself was already correct; only the equation (8)
leak was the bug. (The user's own paraphrased "( ) and b )" description wasn't reproduced
byte-for-byte, but a real, related, separately-confirmed frontend artifact was found:
`normalizePdfSelectionText`'s newline-to-space collapse turns `"(\nb\n)"` into `"( b )"`
— correct for word joins, wrong for punctuation that hugs its content.)

## Unified sequence model — prototyped and validated

A repo-external `unified_reconstruct` function that treats an equation-number endpoint as
just the terminal item of the SAME ordered `[PROSE_GROUP, DISPLAY_EQUATION, ...]` walk 2.5J
already used for intermediate equations reproduced the exact target for the compound case,
AND reproduced equations (5)/(6)/(8)-alone/(9)-midselect byte-for-byte identical to their
existing passing test assertions — no regression risk from the design itself, since it's
the same corridor gate (unchanged from 2.5J) protecting Failure A/B.

**Decisions**: `COMPOUND_EQUATION_END_ROUTING_BUG_CONFIRMED`,
`EQUATION_AT_END_ASSEMBLY_DIVERGENCE_CONFIRMED`, `EQUATION_REGION_CONSUMPTION_BUG_CONFIRMED`,
`UNIFIED_SELECTION_SEQUENCE_FEASIBLE`. Next phase: Prototype 2.5N.

# Prototype 2.5N — unified equation selection sequence production integration

Replaces the two separate, mutually unaware equation-assembly algorithms
(`_resolve_equation_crossing` and `_resolve_cross_equation_continuation`) with ONE shared
`_resolve_equation_aware_selection`, and fixes the related parenthesized-join formatting gap.

## Parenthesized source-faithful assembly

`_assemble_lines_with_gap_recovery` now merges a recovered gap into ONE part with its two
flanking line texts, with NO separator, whenever the gap is bounded by round parentheses
(the same shape `_detect_suspicious_gaps`'s own parenthesized rule checks) — "(b)", never
"(" + newline + "b" + newline + ")". Implemented via a `pending_tight_merge` flag so every
adjacent line pair is STILL individually gap-checked (nothing is skipped); only how the
FOLLOWING line's text gets appended changes. An ordinary word-boundary recovery ("of"/"k"/
"can") is completely unaffected. Live-verified: `"...slope (\nb\n) and..."` became
`"...slope (b) and..."` immediately, with zero changes to the ink-gate or OCR stages.

## Unified equation-aware sequence assembler

`_find_intermediate_equation_blocks` gained `include_after`/`corridor_reference` parameters
(defaults preserve the exact old call signature/behavior, so the one existing test calling
it directly needed no changes) — when `include_after=True`, the search range extends to
include `after_block` itself, which trivially qualifies as its own equation candidate since
the corridor reference is built FROM it. This is the central generalization: an equation
found earlier in a selection (equation (8)) is now discovered by the EXACT SAME mechanism
as the selection's own terminal equation (equation (9)), never missed.

`_resolve_equation_aware_selection` replaces both old functions: discovers every qualifying
equation in the range (via the above), resolves every discovered equation's own
`_display_equation_region_blocks` BEFORE assembly starts, then walks the block range once
building `[PROSE_GROUP, DISPLAY_EQUATION, ...]` segments — a block belonging only to some
equation's fragment region is skipped entirely; a block that IS a discovered equation
number flushes the current prose group and emits its placeholder, breaking the walk
immediately if it's also the selection's own endpoint (nothing trails it).

`/layout/selection`'s routing was restructured into: (1) equation-only/reverse-direction
intent guards (unchanged from 2.5G, kept as a separate early gate — intent is not assembly
mechanics), (2) same-block path (unchanged), (3) ONE equation-aware branch handling BOTH
the "end is an equation" shape (2.5G's own permissive page/row check, no corridor gate,
preserving 2.5G's already-validated behavior exactly) and the "both prose, corridor-gated"
shape (2.5J's own corridor gate, unchanged) — both funnelling into the same assembler, (4)
the existing, completely unmodified ordinary cross-block/cross-page path.

## Real-fixture verification

The exact live-reported compound selection, called against the real, now-modified
production service:
```
The parameter C is a function of the regression slope (b) and
intercept (a)
[式 (8)]
and is introduced to the cosine correction model as an additive
term
[式 (9)]
```
— exactly the target: zero raw "C", zero raw "(8)", both placeholders exactly once, correct
order, intermediate prose preserved, (b)/(a) tight-joined. Every existing single-equation
real-fixture test (5/6/8-alone/9-midselect) continued passing unchanged after updating four
STALE test assertions that had encoded the old, non-tight-joined `"( b )"` format (a
necessary, expected consequence of the parenthesized-assembly fix, not a regression).

## Testing

Two new real-fixture tests: the primary compound case with an exact full-string assertion
plus explicit order/no-leak checks, and its Paddle-unavailable safe-failure counterpart.
Two new explicit ROUTE-assertion tests (monkeypatching `_resolve_equation_aware_selection`
to raise if entered) for Failure A and an ordinary equation-free same-corridor cross-block
selection — proving these never reach the equation-aware assembler at all, not merely that
they happen to produce the right text.

## Verification

Backend: 90 tests total (+4 from 2.5L's 86: compound success, compound Paddle-unavailable,
two route-assertions), 87 passed, 2 skipped (MDPI unavailable), 1 known-unrelated failure
(Elsevier, re-confirmed byte-for-byte identical with 2.5N's own new branch disabled).
Frontend: typecheck/lint/build clean, 676/676 tests passing, zero frontend files touched.
Paddle service: 16/16 unchanged. Performance (real Paddle, 5-run average): ordinary
selection 8.2ms (unchanged), equation (5) endpoint 112.8ms, equation (6) continuation
220.5ms, compound equation(8)→(9) case 90.6ms — all consistent with real OCR latency, no
new algorithmic overhead from the routing unification itself.

**Decision**: `UNIFIED_EQUATION_SEQUENCE_READY_FOR_LIVE_ACCEPTANCE`.

# Prototype 2.5O — real-browser parenthesized glyph placement investigation + fix

2.5N's live acceptance was very close but not clean: the real browser textarea read
`"...regression slope ( ) and b ) and\nintercept (a) [式 (8)] and is introduced..."` — (a),
both equation placeholders, no formula-fragment leaks, and intermediate prose were all
correct; only "(b)" -- specifically the ONE parenthesized recovery sitting at the
selection's own START -- was structurally wrong. The user explicitly forbade re-touching
equation routing/region suppression/placeholders: this phase was scoped to diagnosis-first,
backend-only, on the parenthesized-assembly mechanism alone.

## Root cause, found by reading the frontend and confirmed by exact reproduction

`src/features/pdf/components/PdfViewer.tsx`'s `extractWithinLine` (which builds
`boundaryText`) walks the PDF.js text-layer DOM from the click point forward to the next
`<br>` — but the invisible "b" glyph has literally ZERO DOM node (PDF.js can't render what
it never extracted as text), so a forward capture starting before "(b)" reads straight
through the fused `"()"` and keeps going onto whatever further same-row text follows. Since
"(" (the end of PyMuPDF block 3:1) and ") and" (the start of PyMuPDF block 3:3) sit on the
exact same visual row, the real browser's own `boundaryText` for this click is
`"The parameter C is a function of the regression slope () and"` — NOT the idealized,
PyMuPDF-line-exact string 2.5N's own compound fixture happened to use.

A live call using this RECONSTRUCTED value (derived from reading the frontend code, then
empirically confirmed) reproduced the exact live-reported corruption byte-for-byte:
`"...slope () and\nb\n) and\nintercept (a)\n..."` → after the frontend's own newline-
collapse, `"...slope () and b ) and intercept (a)..."`. Root cause located precisely:
`_assemble_lines_with_gap_recovery`'s `is_parenthesized` shape check inspected `text`
(`line_texts[i]`) — which, for the SELECTION'S OWN START line, is the caller's
`boundaryText`, not PyMuPDF's own line text — so `text.endswith("(")` was `False` even
though this genuinely is a parenthesized gap; the glyph fell through to the ordinary,
non-tight-joined path, AND the next PyMuPDF line (") and") got emitted a second time
(already redundantly present inside the browser's own fused boundaryText).

Confirmed contrast with "(a)" (item 9): (a)'s surrounding lines are purely INTERNAL to the
walked range, never boundary-substituted, so `line_texts` there always holds PyMuPDF's own
untouched text — correctly ending in "(" / starting with ")". Confirmed missing-test-shape
(item 19/23): 2.5N's own compound fixture's hand-supplied `boundaryText` was an exact copy
of PyMuPDF's own line text, which a real browser drag never produces once an invisible
glyph is involved at the selection's own boundary — no existing test exercised this.

## Fix — provenance-split shape check, never string post-cleanup

Split the check in `_assemble_lines_with_gap_recovery` into two independent questions: the
SHAPE check ("is this gap parenthesis-bounded at all?") now always uses `lines[i].text`/
`lines[i + 1].text` — PyMuPDF's own trusted, never-mutated extraction — regardless of what's
actually being emitted. The INSERTION behavior then branches on what `text` (the actually-
emitted, possibly boundary-substituted string) contains: ends cleanly in "(" → merge forward
as 2.5N already did; contains a fused "()" whose tail exactly equals `next_text` → insert
the glyph directly between that literal "("/")" and skip emitting `next_text` at all (a new
`skip_next_text` state flag, alongside the existing `pending_tight_merge`) — its content is
already present, verbatim, inside `text`. Any other shape safely falls back to appending the
glyph as its own untied part (never silently dropped).

Re-running the exact reconstructed real-browser call after the fix: `"...regression slope
(b) and\nintercept (a)\n[式 (8)]\n..."` — exactly the target, no duplication.

## Testing

Added `test_soenen_compound_with_real_browser_boundary_text_shape` (real Paddle) using the
literal reconstructed browser `boundaryText`, kept as an INDEPENDENT regression alongside
the existing idealized compound test (both matter — one proves the assembler's own logic,
the other proves it survives what a real browser actually sends). Added a synthetic,
mocked-OCR equivalent (`test_parenthesized_glyph_recovered_with_browser_style_fused_boundary_text`)
in `test_equation_region_suppression.py` for fast, deterministic coverage — which also
happens to exercise this fix through the ORDINARY cross-block path (not just the
equation-aware one), since `_assemble_lines_with_gap_recovery` is shared by both.

## Verification

Backend: 92 tests total (+2 from 2.5N's 90), 89 passed, 2 skipped (MDPI unavailable), 1
known-unrelated failure (Elsevier, re-confirmed unrelated). All existing equation (5)/(6)/
(8)/(9)/compound/Failure-A/B regressions unaffected — zero equation-routing, region-
suppression, or placeholder code touched, per the user's explicit scope restriction.
Frontend: typecheck/lint/build clean, 676/676 tests passing, zero frontend files touched
(diagnosis only — no frontend fix was needed; `extractWithinLine`'s own behavior is
legitimate DOM traversal, not a bug, once the backend correctly accounts for it). Paddle
service: 16/16 unchanged.

**Decision**: `BACKEND_PARENTHESES_ASSEMBLY_BUG_CONFIRMED`. (Not
`BROWSER_ENDPOINT_FIXTURE_MISMATCH_CONFIRMED` alone, `FRONTEND_NORMALIZATION_BUG_CONFIRMED`,
or `TIGHT_MERGE_STATE_BUG_CONFIRMED` as originally hypothesized — `pending_tight_merge`'s
own state machine was correct; the bug was specifically the SHAPE check reading the wrong
provenance. `ATOMIC_PARENTHESIZED_RECOVERY_FEASIBLE` in the sense implemented — the shape
decision and the insertion decision are now cleanly separated, though the existing
part-list/flag model proved sufficient without needing a dedicated object.)

# Prototype 2.5P — exact browser request capture & boundary provenance investigation

Live acceptance of 2.5O still failed, with the SAME symptom: `"slope ( ) and b )"`. The
user's own correction: 2.5O never captured the literal browser request — it INFERRED
`boundaryText` by reading `extractWithinLine`'s own implementation, and that inferred value
now passes cleanly against the current code (verified again in this phase) while the real
browser still fails. This proves the inference itself is not authoritative enough; there
must be some further, still-unidentified difference between the real request and the
reconstructed one (different coordinate, different resolved line, a further boundaryText
divergence `extractWithinLine`'s static reading didn't anticipate, or some combination).

## Diagnostic instrumentation added (dev-only, default OFF)

`services/pymupdf_layout/main.py` gained a trace facility, mirroring the frontend's own
existing `"[PGT-TRACE]"` convention (`PdfViewer.tsx`, gated by `import.meta.env.DEV`):
`LAYOUT_TRACE_ENABLED = os.environ.get("PGT_LAYOUT_TRACE") == "1"` (default off) and a
`_trace(label, **fields)` helper that prints `"[PGT-TRACE] {label} {fields}"` only when
enabled. Instrumented three points, all read-only (zero behavior change, verified: full
regression suite identical pass/fail with tracing on or off):
- `/layout/selection` (now a thin wrapper `layout_selection` around the renamed
  `_layout_selection_impl`, since the real logic has many return/raise points): logs the
  exact incoming request (documentId, both endpoints' full field set) BEFORE any
  processing (already past fetch/JSON-serialization, therefore authoritative), the resolved
  start/end block+trusted-line-text+is_eqnum immediately after `_resolve_endpoint`, and the
  exact response or HTTPException detail at the end.
- `_attempt_gap_recovery`: logs the crop rect, both trusted anchors, the raw OCR text,
  confidence, and the recovered substring (or the specific reason recovery failed).
- `_assemble_lines_with_gap_recovery`: logs every loop iteration's trusted line text,
  effective (possibly boundary-substituted) text, gap/ink-ratio outcome, and — for every
  parenthesized-shape recovery — which of the three branches
  (`tight_merge_forward`/`fused_paren_insert`/`fallback_append_no_fuse_match`) fired, plus
  the full `parts` list before and after.

## Verification the reconstructed request still passes (re-confirmed, not re-assumed)

Ran the exact 2.5O-reconstructed request again with tracing on: `RESOLVED_START` shows
`blockId='3:1'`, trusted line text ending in `"("` as expected; the `(b)` gap correctly
takes the `fused_paren_insert` branch (`fusedIdx=54`, `skip_next_text=True`); final
`RESPONSE.reconstructedText` is `"...regression slope (b) and\nintercept (a)\n[式 (8)]\n..."`
— clean, matching the target. This reconfirms 2.5O's own fix is correct FOR THE INPUT IT
WAS GIVEN; the remaining gap is entirely in NOT YET knowing the real browser's actual input.

## Next step: literal capture required from the user

The trace facility is ready but cannot supply the missing evidence itself — it requires
the user to (1) restart the layout service with `PGT_LAYOUT_TRACE=1`, (2) reopen the PDF,
(3) reproduce the exact compound selection ONCE, (4) share the resulting terminal output.
No further hypothesis will be formed or acted on until that literal trace is available;
the previous "read the frontend source and infer" approach has now twice produced a
plausible-but-incomplete reconstruction. This diagnostic instrumentation must be removed
or clearly isolated before any future checkpoint that commits this file.

**Update**: the user captured the literal trace and provided it — see "Prototype 2.5Q"
below for the resolution.

# Prototype 2.5Q — whitespace-fused parenthesized recovery fix

The literal captured browser trace (Prototype 2.5P) provided the missing authoritative
evidence. Real request: start `boundaryText = "The parameter C is a function of the
regression slope ( ) and"`, end `boundaryText = "C (9)"` (both at their own real, non-round
coordinates). Resolved endpoints matched expectation exactly: start → block `3:1`, end →
block `3:29` (`"(9)"`, `isEqnum=True`) — endpoint resolution needed no changes at all,
including correctly ignoring the "C" prefix PDF.js's own capture included in the end
boundary.

## Root cause, now precise

2.5O's own fused-paren detection required an EXACT `"()"` substring (zero characters
between the trusted parens) — an assumption formed by READING `extractWithinLine`'s source,
not by observing a real request. The literal trace showed the real gap is `"( ) and"` — a
literal SPACE character between the parens, not zero characters. PDF.js's own text layer
apparently renders the invisible glyph's "nothing" as a single space in the selection text,
not as true adjacency. 2.5O's `text.rfind("()")` found no match against `"( ) and"`, so the
gap fell through to `fallback_append_no_fuse_match` — recovering "b" correctly (OCR itself
was never the problem, reconfirmed: `visualInkRatio=0.320`, `confidence=0.992`,
`ocrText="...slope (b) and"`) but appending it as its own untied part, reproducing the
exact live-reported corruption. The trace also reconfirmed (a) as a clean positive control
in the SAME request (interior line, never boundary-substituted, `tight_merge_forward`
branch, unaffected) and equation (8)/(9) as fully correct (unified sequence assembly and
region suppression were never implicated).

## Fix — generalized to tolerate whitespace, still fully provenance-based

Replaced the exact-`"()"`-substring check with: does `text` (the effective, possibly
boundary-substituted string) END WITH `next_text` (the trusted right-side line)? If so,
take the prefix before that suffix, find the last `"("` in it, and require only that
everything after that `"("` (up to where `next_text` begins) is WHITESPACE — zero or more
characters, so `"()"`, `"( )"`, `"(  )"` are all recognized as the same structural state.
Insertion becomes `text[:open_idx+1] + recovered + next_text`, with `next_text` still never
separately emitted (`skip_next_text`). This is a strict generalization of 2.5O's own check
(2.5O's exact-adjacency case is the whitespace-length-zero special case of this new rule),
not a replacement of the underlying model — still keyed entirely off the trusted
`lines[i].text`/`lines[i+1].text` shape check, never a global regex over the final string.

## Verification against the literal captured request (not an approximation)

Fed the EXACT captured request (verbatim coordinates, verbatim `boundaryText` for both
endpoints) through the fixed code: `reconstructedText` = `"The parameter C is a function of
the regression slope (b) and\nintercept (a)\n[式 (8)]\nand is introduced to the cosine
correction model as an additive\nterm\n[式 (9)]"` — exactly the target, first try.

## Testing

`test_soenen_compound_with_literal_captured_browser_request` replaces the prior
approximated compound-boundary test with the literal trace values (never to be replaced
with an approximation again, per explicit instruction) — real Paddle, asserts the exact
string plus explicit absence of every corrupted shape previously seen (`"( ) and"`,
`"() and"`, `"\nb\n) and"`, `"( b )"`, raw `"C\n(8)"`, raw `"(8)"`). Added
`test_parenthesized_glyph_recovered_with_whitespace_fused_boundary_text` (synthetic, mocked
OCR) alongside the existing zero-width-fused test, so both real shapes stay covered fast
and deterministically.

## Trace disposition

Kept `PGT_LAYOUT_TRACE` (Prototype 2.5P) as a maintained diagnostic facility rather than
removing it: default OFF, clearly dev-only, logs only request/response fields and text this
service already extracts/returns (never raw PDF bytes), and it directly produced the
evidence that solved a bug two rounds of code-reading-based inference had missed — real
value for any future class of "reconstruction assumption vs. actual browser behavior"
divergence.

## Verification

Backend: 93 tests total (+1 from 2.5P's 92: the new whitespace-fused synthetic test; the
literal-request test replaced rather than added to the prior approximated one), 90 passed,
2 skipped (MDPI unavailable), 1 known-unrelated failure (Elsevier, unaffected — this
phase's only change is the fused-paren whitespace tolerance, nowhere near the Elsevier
cross-page block-merge issue). Frontend: typecheck/lint/build clean, 676/676 tests passing,
zero frontend files touched (the literal trace proved the corruption was already present in
the backend's own `reconstructedText`, confirming no frontend fix was ever needed). Paddle
service: 16/16 unchanged.

**Decision**: `WHITESPACE_FUSED_PAREN_RECOVERY_READY_FOR_LIVE_ACCEPTANCE`.
