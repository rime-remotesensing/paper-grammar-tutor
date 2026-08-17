# Paper Grammar Tutorの使い方

Paper Grammar Tutorは全文翻訳を得るための画面ではなく、英文を自分で読み進めるための学習UIです。

## 1. 基本の流れ

1. Ollama、PyMuPDF layout service、必要ならPaddleOCR serviceを起動します。
2. Paper Grammar Tutorをブラウザで開きます。
3. 画面上部でOllama接続状態と`qwen2.5:7b-instruct`の選択を確認します。
4. PDFを開くか、「英文を入力」欄へ1文を入力します。
5. PDFでは読みたい文をdrag selectionします。選択した英文が入力欄へ入ります。
6. 必要なら選択英文を編集し、「骨格を見る」を押します。
7. 基本の骨格、Structure Tree、英文highlight、読み方、語彙、表現・語法を確認します。

## 2. PDFを読む

PDF viewerの「PDFファイルを選択」からローカルPDFを開きます。PDFはブラウザで表示され、単段・多段組みや複数ページにまたがる選択は、ローカルPyMuPDF serviceがreading orderを再構成します。

同一pageの選択について埋め込みtextが壊れている場合は、「OCRで読み直す」からPaddleOCR候補を確認できます。Paddleが利用できない場合だけ、「ブラウザOCRを使う」を明示的に選べます。OCR候補は自動採用されないため、原文PDFと照合してから使用してください。

新しいPDFを開くと、前のPDFから得たselectionと解析結果はclearされます。

## 3. 基本の骨格

解析結果の最初に、文の中心を短く表示します。

| 表示 | 意味 |
| --- | --- |
| S | 主語 |
| V | 述語動詞 |
| IO | 間接目的語。真の二重目的語構文で表示 |
| O | 目的語 |
| C | 補語。日本の5文型でいうSVC/SVOCのC |

前置詞句や一般的な副詞句をCとして表示するものではありません。AI解析なので、論文の意味と合わない場合は原文を優先してください。

## 4. Structure Tree

Structure Treeは、主語、述語、目的語、補語、修飾、節、並列関係などを階層表示します。

- hover: nodeを一時的にpreviewします。
- click: nodeをpinします。
- pin中に別nodeをhover: hoverしたnodeへ一時的に切り替わります。
- mouseleave: pinしていたnodeへ戻ります。
- Escape: pinを解除し、文全体の状態へ戻ります。

Tree nodeの選択は、「英文」「選択した部分の読み方」「語彙」の3領域へ同じsource spanとして伝わります。

## 5. 原英文highlight

Tree nodeを選択すると、そのnodeが解析用英文のどの部分を参照しているかが「英文」上でhighlightされます。

ここに表示されるのはraw textareaの完全な複製ではなく、文構造と同じnormalized referenceです。

- 採番済み数式は`[EQUATION_N]`と表示される場合があります。
- 引用番号は文法要素ではないため、解析用referenceから省略される場合があります。

highlightはLLMが返した数値offsetではなく、アプリがnormalized textへ再照合したspanを使用します。

## 6. 選択した部分の読み方

これは翻訳欄ではありません。英語を左から読み、情報をどの順番で追加するかを示します。

例:

```text
is based
→ まず「基づいている」と捉える

on observations
→ 次に、何に基づくのかを追加する
```

Treeで選んだspanに対応するReadingStepだけが表示されます。該当するstepがないnodeでは、読解メモがないことを示します。

## 7. 語彙

語彙カードは短い文脈上の意味と、粗い品詞を示します。

- Tree未選択: 文全体のgrounded vocabulary
- Tree選択中: 選択span内のvocabulary

例:

| Word | 品詞 | 文脈上の意味 |
| --- | --- | --- |
| `radiance` | 名詞 | 放射輝度 |
| `normalize` | 動詞 | 正規化する |
| `respectively` | 副詞 | それぞれ、各々その順に |
| `spatial variability` | 名詞句 | 空間的変動性 |

専門用語だけでなく、`approximately`、`subsequently`、`thereby`のように論文の対応・程度・順序・論理関係を理解するための語も対象です。基本的な冠詞、be動詞、一般的な前置詞などは通常表示しません。

## 8. 表現・語法

「表現・語法」はTree selectionから独立しており、文全体の学習項目として表示され続けます。

例:

- `be based on ~`: 〜に基づく
- `account for ~`: 〜を考慮する、説明する
- `result in ~`: 〜という結果になる
- `be analogous to ~`: 〜に類似している

単純な品詞名や基本文法labelではなく、別の論文でも再利用できるacademic usageを扱います。

## 9. `respectively`の読み方

```text
a and b are the y-intercept and slope, respectively.
```

文末の`respectively`は、前後に並んだ項目を同じ順で対応させます。

```text
a → y-intercept
b → slope
```

このとき各channelの役割は異なります。

- 語彙: `respectively / 副詞 / それぞれ、各々その順に`
- 選択した部分の読み方: 並んだ項目を同じ順で対応させる方法
- 表現・語法: LLMが安定して抽出できた場合、再利用可能なcorrespondence pattern

## 10. 数式を含む英文

Paper Grammar Tutorは数式の内容を理解するsystemではありません。数式本体は必要に応じて`[式 (N)]`または解析内部の`[EQUATION_N]`というopaque placeholderとして扱い、周囲の英語proseへ集中します。

対応していないもの:

- 数式内容のOCR
- LaTeX/MathML reconstruction
- 数式の意味の推論
- 任意の複雑な数式layout

安全に英文を再構成できないselectionは、誤った英文を解析する代わりにエラーになります。

## 11. PDFとOCRの既知の制約

- pure scan PDFなどextractableなtext layerがないPDFは開けません。
- PaddleOCRは現在GPU serviceとして実装され、CPUへ自動fallbackしません。
- browser OCRは、text layerを持つPDFの選択箇所を読み直す補助機能です。
- 複数ページselectionのOCR再読込は未対応です。
- equation-aware selectionはpage boundaryをまたぐ場合など、未対応の形があります。
- AIによる文法解析、品詞、読解説明は誤ることがあります。

## 12. 自分の解釈と参考訳

「あなた自身の解釈（メモ）」へ、参考訳を見る前の理解を書けます。このメモは現在永続保存されません。

参考訳は「参考訳（必要な場合のみ開く）」の中に折りたたまれています。構造と語順を確認したあと、必要な場合だけ比較してください。
