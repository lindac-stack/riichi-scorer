# 麻雀得点計算機 — モジュール契約 (SPEC)

静的 SPA（ビルド不要・ES Modules）。GitHub Pages にそのまま配置。
UI 表示は **日本語漢字**（立直・自摸・栄和・親・子・翻・符・萬子・筒子・索子・字牌 等）。

## 牌表記（js/tiles.js が単一の真実 — 変更禁止、import して使う）

- 数牌: `1m`..`9m`(萬子) `1p`..`9p`(筒子) `1s`..`9s`(索子)
- 字牌: `1z`=東 `2z`=南 `3z`=西 `4z`=北 `5z`=白 `6z`=發 `7z`=中
- 赤五: `0m` `0p` `0s`（構造上は 5、ドラ +1）

`tiles.js` の公開API: `normalize, isRed, suitOf, rankOf, isHonor, isWind, isDragon,
isTerminal, isYaochu, doraFromIndicator, displayName, sortTiles, allTileTypes,
parseTileInput, WINDS, DRAGONS`

## 採点エンジン (js/engine/)

### `scoreHand(input) -> Result`  （engine/score.js が公開）

```
input = {
  hand:        string[],   // 副露を除く手牌。和了牌も含めた全枚数(13-x枚 + 和了牌)。
                           //   例: 門前なら 14 枚（和了牌込み）。副露1つ毎に手牌から3枚減る。
  winningTile: string,     // 和了牌（hand に必ず1枚含まれていること）
  melds:       Meld[],     // 副露（無ければ []）
  winType:     'tsumo' | 'ron',
  seatWind:    '1z'|'2z'|'3z'|'4z',   // 自風
  roundWind:   '1z'|'2z'|'3z'|'4z',   // 場風
  doraIndicators: string[],  // ドラ表示牌（無ければ []）
  uraIndicators:  string[],  // 裏ドラ表示牌（立直時のみ意味を持つ）
  // フラグ（すべて省略時 false）
  riichi, doubleRiichi, ippatsu, rinshan, chankan, haitei, houtei, tenhou, chiihou
}

Meld = { type: 'chi'|'pon'|'kan', tiles: string[], open: boolean }
       // ankan(暗槓) は type:'kan', open:false
```

```
Result = {
  valid:   boolean,        // 和了形として成立し、かつ役ありか
  error:   string|null,    // 不成立理由（"役なし" / "和了形でない" 等）
  han:     number,
  fu:      number,
  yaku:    [{ name: string(日本語), han: number }],   // 役満は han に 13/26... 換算しない、yakuman を見る
  yakuman: number,         // 役満の倍数（0=非役満, 1=役満, 2=ダブル役満...）
  dora:    number, aka: number, ura: number,
  limit:   ''|'満貫'|'跳満'|'倍満'|'三倍満'|'役満'|'数え役満',
  points:  {
    total: number,                 // 和了者の総収入
    ron:   number|null,            // ロン時の放銃者支払額
    tsumo: { dealer:number, nonDealer:number }|null  // ツモ時の各家支払額
  },
  display: string,          // 例 "8000", "2000/3900(親4000)", "4翻30符 7700" など人間可読
}
```

エンジンが対応すべき役（門前/食い下がり/役満を区別して実装）:
- 1翻: 立直 / 一発 / 門前清自摸和 / 平和 / 断么九 / 一盃口 / 役牌(白發中・場風・自風) / 嶺上開花 / 槍槓 / 海底摸月 / 河底撈魚
- 2翻: ダブル立直 / 三色同順(食1) / 一気通貫(食1) / 全帯么九(食1) / 七対子 / 対々和 / 三暗刻 / 三槓子 / 三色同刻 / 混老頭 / 小三元
- 3翻: 混一色(食2) / 純全帯么九(食2) / 二盃口
- 6翻: 清一色(食5)
- 役満: 国士無双 / 四暗刻 / 大三元 / 字一色 / 緑一色 / 清老頭 / 四喜和(大/小) / 九蓮宝燈 / 四槓子 / 天和 / 地和
- ドラ / 赤ドラ / 裏ドラ

符計算: 副底20 + 門前ロン10 + ツモ2 + 待ち(嵌張/辺張/単騎 2) + 雀頭(役牌2,連風4) + 面子(明刻/暗刻/明槓/暗槓 × 中張/么九) を加算し 1の位切り上げ。
平和ツモ20符固定、七対子25符固定、喰い平和形ロン30符。
点数: 基本点 = 符 × 2^(2+翻)。満貫(2000)/跳満(3000)/倍満(4000)/三倍満(6000)/役満(8000) で頭打ち。
親 = 基本点×6(ロン)/×2各(ツモ)、子 = 基本点×4(ロン)/親×2子×1(ツモ)。100点単位切り上げ。

### `enumerateOutcomes(tiles, ctx) -> Outcome[]`  （engine/enumerate.js が公開）

写真認識で「全パターンの得点」を出すための関数。
- `tiles`: 認識された牌（門前14枚想定。副露があれば ctx.melds で渡す）
- `ctx`: { seatWind, roundWind, doraIndicators, riichi, ... } の既定文脈（省略可）
- 戻り値 `Outcome[]`: 和了牌候補 × {自摸/栄和} × {親/子} を総当たりし、成立する全組合せを
  `{ label: string(日本語), input, result }` で返す。役なしは除外。
  得点降順で返す。同点はまとめてよい。

## 画像認識 (js/vision/)

### `recognizeTiles(imageBlobOrDataUrl, opts) -> Promise<{tiles, raw, provider}>`  （vision/recognize.js）

- ユーザー保有の Vision API キーを使用（`localStorage` 保存）。サーバー不要。
- プロバイダ: Gemini / OpenAI / Anthropic を切替可能（既定 Gemini）。
- プロンプトで「画像内の麻雀牌をすべて tiles.js 表記の配列で返す」よう指示し、JSON を厳格パース。
- 返り値 `tiles`: string[]（tiles.js 表記）。`raw`: モデル生応答。
- キー未設定や失敗時は例外を投げ、UI は手入力にフォールバックさせる。

### `captureImage()` 系 （vision/capture.js）

- `<input type="file" accept="image/*" capture="environment">` でカメラ/写真ライブラリ起動。
- 任意で `getUserMedia` ライブカメラ＋静止画キャプチャ。

## UI (js/ui/, index.html)

- モバイル前提・日本語漢字。タブ: 「写真で計算」「手入力で計算」。
- 写真タブ: 撮影/画像選択 → recognizeTiles → 認識牌を編集可能チップで表示 →
  enumerateOutcomes の結果を**得点表**で一覧（全パターン）。
- 手入力タブ: 牌選択パレット（萬筒索字＋赤）＋文脈（親子/場風自風/自摸栄和/立直/ドラ）→ scoreHand。
- API キー設定モーダル（プロバイダ選択＋キー入力、localStorage 保存）。

## テスト

- `test/engine.test.js`: node 実行（`node --test` か素の assert）。既知手牌の翻符点を検証。
- Playwright: 手入力フロー・得点表表示・キー設定モーダルを検証（メインが実施）。
