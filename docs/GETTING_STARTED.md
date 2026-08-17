# インストールと起動

この手順は、WindowsとPowerShellでPaper Grammar Tutorをローカル起動するためのものです。開発者固有の絶対パスは使用しません。

## 1. Documented environment

このrepositoryで確認されている構成は次のとおりです。

| 項目 | Documented value |
| --- | --- |
| OS | Windows / PowerShell |
| Node.js | Viteの要件: `^20.19.0 || >=22.12.0`。開発時確認: `24.19.0` |
| npm | 開発時確認: `11.17.0` |
| Python | `3.12`（開発時確認: `3.12.3`） |
| Ollama model | `qwen2.5:7b-instruct` |
| PyMuPDF | `1.28.2` |
| PaddleOCR | `3.7.0` |
| PaddlePaddle GPU | `3.3.1`、CUDA 12.9 build |

Node/Python packageの正確なversionは`package-lock.json`と各serviceの`requirements.txt`に固定されています。

## 2. 必要なソフトウェア

必須:

1. [Git](https://git-scm.com/download/win)
2. [Node.js](https://nodejs.org/)
3. [Python 3.12](https://www.python.org/downloads/)
4. [Ollama for Windows](https://ollama.com/download/windows)

機能別:

- PyMuPDF layout service: PDFのcross-block、multi-column、cross-page選択に必要です。GPUは不要です。
- PaddleOCR service: 高精度OCRと一部の欠落glyph回復に使用します。現在のservice実装はGPU専用です。
- Paddle非対応環境でも、serviceが利用できないときにUIから「ブラウザOCRを使う」を明示選択できます。ただしpure scan PDF全体を読み込めるようにする機能ではありません。

## 3. Cloneとfrontend dependencies

```powershell
git clone https://github.com/rime-remotesensing/paper-grammar-tutor.git
cd paper-grammar-tutor
npm ci
```

`npm ci`はrepository rootの`package-lock.json`を使用します。

## 4. Ollama model

Ollamaを起動し、modelを取得します。

```powershell
ollama pull qwen2.5:7b-instruct
```

Ollama desktop appが起動していない環境では、別terminalで次を実行します。

```powershell
ollama serve
```

確認:

```powershell
Invoke-RestMethod http://localhost:11434/api/tags
```

## 5. PyMuPDF layout service（推奨）

repository rootから実行します。

```powershell
cd services\pymupdf_layout
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..\..
```

起動:

```powershell
.\services\pymupdf_layout\.venv\Scripts\python.exe .\services\pymupdf_layout\main.py
```

serviceは`127.0.0.1:8009`だけでlistenします。別terminalで確認します。

```powershell
Invoke-RestMethod http://127.0.0.1:8009/health
```

`status`が`ok`、`engine`が`pymupdf`なら起動しています。

> PyMuPDFはAGPLまたは商用licenseで提供されます。Paper Grammar Tutorのプロジェクト独自コードは`AGPL-3.0-only`で公開されています。公開・再配布時は、[LICENSE](../LICENSE)、[第三者通知](../THIRD_PARTY_NOTICES.md)、[PyMuPDF公式のlicense説明](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright)を確認してください。

## 6. PaddleOCR service（対応GPUがある場合）

このserviceはCPUへ自動fallbackしません。検証済み構成は`paddlepaddle-gpu==3.3.1`のCUDA 12.9 buildです。RTX 4070 Ti SUPERで検証されていますが、特定のRTX製品名を必須条件とはしていません。

```powershell
cd services\paddle_ocr
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install paddlepaddle-gpu==3.3.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..\..
```

起動:

```powershell
.\services\paddle_ocr\.venv\Scripts\python.exe .\services\paddle_ocr\main.py
```

serviceは`127.0.0.1:8008`だけでlistenします。初回起動時はPaddleの公式model hubからOCR modelがダウンロードされるため、時間がかかります。

```powershell
Invoke-RestMethod http://127.0.0.1:8008/health
```

利用可能な状態では、`status: ok`、`gpuAvailable: true`、`modelLoaded: true`、`device: gpu`になります。

## 7. Frontendを起動

Python serviceとは別のterminalでrepository rootから実行します。

```powershell
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

ブラウザで次を開きます。

```text
http://127.0.0.1:5173
```

port 5173はローカルPython serviceのCORS設定と一致させる必要があります。

## 8. Startup checklist

- [ ] Ollamaが起動している
- [ ] `qwen2.5:7b-instruct`がinstallされている
- [ ] PyMuPDF layout serviceがport 8009で起動している
- [ ] 高精度OCRを使う場合、PaddleOCR serviceがport 8008で起動している
- [ ] `npm ci`が完了している
- [ ] frontendがport 5173で起動している
- [ ] 画面上部のOllama接続とmodel選択を確認した

## 9. PowerShellの注意

PowerShell policyによって`npm.ps1`が拒否される場合は、policyをglobal変更せず次を使用できます。

```powershell
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

この手順ではvenvをactivateせず、`.venv\Scripts\python.exe`を直接実行するため、activation scriptのpolicy変更は不要です。activateしたい場合だけ、現在のterminal processに限定して次を使用してください。

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## 10. Troubleshooting

### `npm`または`node`が見つからない

Node.jsをinstall後、PowerShellを開き直して`node --version`と`npm.cmd --version`を確認してください。

### Ollamaへ接続できない

Ollamaが起動していること、画面のOllama URLが`http://localhost:11434`であること、`/api/tags`へ応答があることを確認してください。

### modelが表示されない

`ollama list`で`qwen2.5:7b-instruct`を確認し、なければ`ollama pull qwen2.5:7b-instruct`を実行します。その後、画面でmodel一覧を再読み込みします。

### Paddle serviceが利用できない

`/health`の`gpuAvailable`、`modelLoaded`、`error`を確認してください。現在のserviceはCPUへ自動fallbackしません。Paddleが利用できない場合は、対象selectionで表示される「ブラウザOCRを使う」を必要に応じて選択します。

### PyMuPDF serviceが利用できない

`http://127.0.0.1:8009/health`を確認してください。service停止中は、cross-block/cross-page selectionを正しく再構成できず、画面に確認メッセージが表示されます。

### PDF textを選択できない

現在のPDF flowはextractableなtext layerを必要とします。画像だけのpure scan PDFは未対応です。password保護、破損、特殊なlayoutも原因になり得ます。

### 最初の解析が遅い

Ollama modelの初回load、PaddleOCR modelの初回download/load、初回PDF解析には時間がかかることがあります。同じmodelやpageの後続処理ではcacheが使われる箇所があります。

## 11. 開発時の検証

Frontend:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

PyMuPDF service:

```powershell
Push-Location .\services\pymupdf_layout
.\.venv\Scripts\python.exe -m pytest .\tests
Pop-Location
```

PaddleOCR service:

```powershell
Push-Location .\services\paddle_ocr
.\.venv\Scripts\python.exe -m pytest .\tests
Pop-Location
```

実論文fixtureはrepositoryへ含まれず、環境変数が未設定ならskipされます。詳細は各service directoryのREADMEを参照してください。
