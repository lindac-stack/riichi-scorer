# 麻雀得点計算機 (Riichi Scorer)

立直麻雀（リーチマージャン）の点数を計算する静的 SPA です。
**写真**または**手入力**で手牌を取り込み、和了形の点数と全パターンを列挙します。

- **写真で計算**: 局面のスクリーンショット/写真を読み込み、Vision API で牌を認識 → 和了牌候補 × 自摸/栄和 × 親/子 を総当たりし、成立する全パターンの点数を一覧表示します。
- **手入力で計算**: 牌選択パレット（萬子・筒子・索子・字牌＋赤五）と文脈（親子・場風・自風・自摸/栄和・立直・ドラ等）から `scoreHand` で翻・符・点数を算出します。

ビルド不要のプレーンな ES Modules + `index.html` で構成され、**GitHub Pages** にそのまま配置できます。

## ライブデモ (Live demo)

https://lindac-stack.github.io/riichi-scorer/

## プライバシーと Vision API キー

画像認識（写真タブ）には、**ユーザー自身が用意した Vision API キー**を使用します。

- 対応プロバイダ: **Gemini / OpenAI / Anthropic**（既定は Gemini）。
- API キーは**ブラウザの `localStorage` のみに保存**されます。バックエンドはありません。
- キーは**ブラウザから一切外部へ送信されません**（あなたが選んだ Vision プロバイダの API へ画像認識リクエストを送る時を除く）。当アプリ独自のサーバーは存在せず、収集・保存・中継も行いません。
- 鍵の設定は画面右上の **⚙ 設定** から行います（プロバイダ選択＋キー入力 → `localStorage` に保存）。

### 手入力は完全オフライン

**手入力タブは API キー不要・完全オフライン**で動作します。
点数計算ロジック（`js/engine/`）はすべてブラウザ内で完結するため、キーを設定しなくても手入力での得点計算は全機能利用できます。Vision API キーが必要なのは写真認識のみです。

## ローカルで動かす

ビルド不要です。リポジトリのルートで簡易 HTTP サーバーを立てて開くだけです（ES Modules のため `file://` 直開きではなく HTTP 経由が必要です）。

```sh
python3 -m http.server 8000
```

ブラウザで http://localhost:8000 を開きます。

## PWA / manifest

`manifest.webmanifest`（PWA マニフェスト）を同梱しています。
`index.html` の `<head>` に次の `<link>` を追加してください（`index.html` は UI 担当が管理）:

```html
<link rel="manifest" href="manifest.webmanifest">
```

アイコンは現在 `icons/icon.svg`（牌スタイルの SVG プレースホルダ）を同梱しています。
`icons/icon-192.png` / `icons/icon-512.png` は後から SVG から書き出せます（[アイコン](#アイコン) 参照）。

## アイコン

`icons/icon.svg` を元に、必要に応じて PNG を生成できます:

```sh
# 例: rsvg-convert / ImageMagick / Inkscape のいずれかで
rsvg-convert -w 192 -h 192 icons/icon.svg -o icons/icon-192.png
rsvg-convert -w 512 -h 512 icons/icon.svg -o icons/icon-512.png
```

## デプロイ (GitHub Pages)

`main` ブランチへの push で `.github/workflows/deploy.yml`（GitHub Actions）が走り、
リポジトリのルート（静的ファイル一式、`.git` を除く）を GitHub Pages へ公開します。
ビルドステップはありません。

公開 URL（owner `lindac-stack` / repo `riichi-scorer` の場合）:
https://lindac-stack.github.io/riichi-scorer/

## ディレクトリ構成

```
.
├── index.html              # SPA エントリ（UI 担当が管理）
├── manifest.webmanifest    # PWA マニフェスト
├── icons/                  # アプリアイコン（icon.svg ＋ 後で生成する PNG）
├── css/                    # スタイル
├── js/
│   ├── tiles.js            # 牌表記の単一の真実（変更禁止）
│   ├── engine/             # 採点・列挙ロジック（オフライン完結）
│   ├── vision/             # Vision API 連携（写真認識）
│   └── ui/                 # UI ロジック
├── test/                   # node テスト
├── SPEC.md                 # モジュール契約
└── STASH.md                # 保留・要ユーザー入力の項目ログ
```

詳細なモジュール契約は [SPEC.md](SPEC.md) を参照してください。
