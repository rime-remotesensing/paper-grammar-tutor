# Paper Grammar Tutor

## Quick start（推奨: Docker）

最初に対応する配布環境は、Windows 10/11、Docker Desktop（WSL2 backend）、NVIDIA GPUです。Node.js、Python、Ollamaを個別にインストールする必要はありません。

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) をインストールし、WSL2 backend と NVIDIA GPU support を利用できる状態にします。
2. このrepositoryをcloneするか、GitHubのZIPを展開します。
3. repository rootのPowerShellで次を実行します。

```powershell
.\scripts\start.ps1
```

初回はDocker images、PaddleOCR models、`qwen2.5:7b-instruct`（約4.7 GB）をdownloadするため時間がかかります。起動後は [http://localhost:5173](http://localhost:5173) を開きます。

停止:

```powershell
.\scripts\stop.ps1
```

通常の停止ではmodel cacheを削除しません。状態確認には`.\scripts\status.ps1`を使用できます。Docker非対応環境または開発作業向けの手動setupも[インストールと起動](docs/GETTING_STARTED.md)に残しています。

Paper Grammar Tutorは、日本語話者が英語論文を英語のまま読み進めるための、local-firstな学術英語リーディング支援ツールです。全文を日本語へ置き換えるのではなく、英文の構造、英語の語順、学術語彙、再利用できる語法を理解することを助けます。

現在は**Prototype / active development**です。研究・学習用のローカルアプリとして開発しており、production-stableなリリースではありません。

## このアプリが目指すもの

主目的は、翻訳結果や文法用語の一覧を提示することではありません。

- 英語論文の構造を視覚的に確認する
- 英語を左から読むときの意味の積み上げ方を学ぶ
- 文脈に沿った学術語彙と品詞を確認する
- `be based on ~`など、別の論文でも使える表現・語法を学ぶ

参考訳は補助情報として折りたたまれており、最初から全文訳に依存しないUIになっています。

## 主な機能

- ブラウザ内PDF viewerとPDF text selection
- 単段・多段組み、ページをまたぐ英文選択
- ローカルPyMuPDFサービスによるreading-order reconstruction
- 必要箇所だけを補うPaddleOCRと、明示操作によるブラウザTesseract OCR
- ローカルOllamaと`qwen2.5:7b-instruct`による英文解析
- 文の基本骨格（S / V / IO / O / C）
- 階層的なStructure Tree
- Tree nodeのhover preview、click pinning、Escapeによる解除
- Treeと連動した原英文span highlight
- Treeと連動した「選択した部分の読み方」
- Tree未選択時は文全体、選択時は該当spanだけを示す語彙カード
- 名詞・動詞・形容詞・副詞・句などの品詞表示
- `respectively`のような、論文読解に重要な関係語彙
- Tree選択に左右されず残る「表現・語法」
- 数式をopaqueなplaceholderとして扱う、数式周辺英文の安全な処理

## 学習UIの関係

```text
Structure Tree
  └─ 選択したnodeを読解の基準にする

英文
  └─ nodeが参照するsource spanをhighlight

選択した部分の読み方
  └─ Treeの選択spanに連動

語彙（品詞つき）
  └─ Tree未選択: 文全体
  └─ Tree選択中: 選択span内

表現・語法
  └─ Treeとは独立し、文全体の学習項目として表示
```

## Local-first processing

通常利用に外部クラウドLLMは必要ありません。

- Ollamaによる文解析はローカルで実行されます。
- PDF layout処理とPaddleOCRは`127.0.0.1`上のローカルサービスです。
- PDFはブラウザからローカルPyMuPDFサービスへ渡され、メモリ上で処理されます。
- Paddleのmodel weightは初回セットアップ時に公式配布元からダウンロードされます。

これはネットワークやOS全体について完全なprivacyを保証する表明ではありません。利用する依存ソフトウェアとローカル環境の設定も確認してください。

## はじめる

- [インストールと起動](docs/GETTING_STARTED.md)
- [Paper Grammar Tutorの使い方](docs/USAGE.md)

## 現在の主な制約

- AIによる文法解析と読解説明は常に正しいとは限りません。
- text layerを持たないpure scan PDFは、PDF選択フローの対象外です。
- 数式本体の理解、LaTeX化、MathML化は行いません。
- 複雑な数式配置や未検証のPDF layoutでは安全に停止する場合があります。
- 高精度PaddleOCRサービスは、現在の実装では対応するNVIDIA/CUDA環境を必要とします。

## License

Paper Grammar Tutorのプロジェクト独自コードは、[GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）の下で公開されています。

第三者コンポーネントおよび同梱アセットには、それぞれの上流ライセンスが適用されます。詳細は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)を参照してください。

内部の設計経緯は[docs/design-notes.md](docs/design-notes.md)に保存しています。
