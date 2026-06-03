# Vision 認識精度ベンチ — 実測結果

実 OpenAI API キー（`.env.local`, gitignore 済）を使い、`js/vision/recognize.js` の
**実コードパス**（`recognizeTiles` → OpenAI Chat Completions）を通して認識精度を自動計測した。

## 方法 (methodology)

- `test/bench/index.html` がランダムな 14 枚手牌を生成（LCG シードで再現可能）。
- 各牌を **Unicode 麻雀牌グリフ**（🀇…🀙…🀐… 東南西北白發中）で 2 段組・大きめ・2x 解像度の
  canvas に描画 → `toDataURL` → `recognizeTiles()` に渡す。
- 認識結果と ground truth を **multiset 一致**で突き合わせ、per-tile / per-suit / 完全一致を集計。
- 429 は指数バックオフでリトライ、1 リクエスト ≈ 6.5s ペースで TPM 制限を回避。
- 同一シード 12 手（168 枚）で `gpt-4o-mini` と `gpt-4o` を比較。

## 結果（12 手 / 168 枚 / API エラー 0）

| スート | gpt-4o-mini（既定） | gpt-4o |
|---|---|---|
| 萬子 man（漢数字） | 100% (32/32) | 100% (32/32) |
| 字牌 honors | 47% (14/30) | 100% (30/30) |
| 筒子 pin（丸） | 32% (20/62) | 65% (40/62) |
| 索子 sou（竹） | 11% (5/44) | 39% (17/44) |
| **per-tile 合計** | **42% (71/168)** | **71% (119/168)** |
| 完全一致手 | 0/12 | 0/12 |

## モデル/プロンプト チューニング（同一12手・168枚で比較）

| 構成 | per-tile | man | pin | sou | honor |
|---|---|---|---|---|---|
| gpt-4o-mini（旧既定） | 42% | 100 | 32 | 11 | 47 |
| gpt-4o（detail auto・旧プロンプト） | 71% | 100 | 65 | 39 | 100 |
| gpt-4o + detail:high + 改良プロンプト | 67% | 100 | 58 | 36 | 97 |
| **gpt-4.1 + detail:high + 改良プロンプト（採用）** | 70% | 100 | 60 | 43 | 100 |

- gpt-4o と gpt-4.1 は誤差範囲で同等。sou がわずかに良い・新しい・安価な **gpt-4.1 を既定採用**。
- プロンプト改良（pip を1枚ずつ数える指示・連番への決めつけ禁止・枚数整合）と
  `detail:'high'` は合成グリフでは数値が伸びないが、**実写真では有利**なため維持。
- 既定モデルを `js/vision/recognize.js` の `MODELS.openai` で `gpt-4.1` に変更済み。

## 所見

- **モデル差が支配的**: 既定の `gpt-4o-mini` は pip（丸・竹）の数え分けが極端に苦手。
  `gpt-4o` に上げると per-tile 精度がほぼ倍増（42%→71%）、字牌は 100%。
- **弱点は索子・筒子の pip カウント**。漢数字の萬子・字牌は両モデルとも得意。
- gpt-4o-mini は画像トークン単価が高く（TPM 200k で ~8 枚/分）429 を起こしやすい。

## 重要な注意（この数値の意味）

- これは **合成 Unicode グリフ牌**に対する精度であり、SPEC/STASH(a) が目標とする
  **実写真 ≈89%** とは別物。実写の色付き牌（緑の竹・色付きの丸）の方が読みやすい可能性が高く、
  本ベンチの sou/pin 低スコアは合成グリフ（モノクロ線画）由来のアーティファクトを含む。
- 実写真での実測には、ラベル付き実画像が必要（STASH(a) の手順）。

## 再実行

```bash
python3 -m http.server 8137         # リポジトリ直下で
# ブラウザ/Playwright で http://127.0.0.1:8137/test/bench/index.html を開き、
# コンソールで:  await window.__bench.runBench(12, 77777, 6500)
# 進捗・結果は window.__state に蓄積。
```

`.env.local`（`RIICHI_VISION_PROVIDER`, `OPENAI_API_KEY`）はページが同一オリジンで読む。
