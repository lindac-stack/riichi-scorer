// prompt.js — Vision モデルへ渡すプロンプト/凡例（再利用・テスト可能なよう定数化）
//
// すべての Vision プロバイダ(Gemini/OpenAI/Anthropic)で同一の指示文を使う。
// モデルには tiles.js 表記の配列のみを STRICT JSON で返させる。

/** 牌表記の凡例（モデルがスート/字牌を正しく対応づけられるよう簡潔に説明）。 */
export const TILE_LEGEND = `Tile notation legend (use EXACTLY these codes):
- Suited tiles (数牌):
    1m-9m = 萬子 (man / characters / "10k" looking kanji-number tiles)
    1p-9p = 筒子 (pin / circles / dots / coins)
    1s-9s = 索子 (sou / bamboo / sticks)
  The leading digit (1-9) is the number shown on the tile.
- Honor tiles (字牌):
    1z = 東 East wind
    2z = 南 South wind
    3z = 西 West wind
    4z = 北 North wind
    5z = 白 White dragon (haku, the blank / framed tile)
    6z = 發 Green dragon (hatsu, the green 發 character)
    7z = 中 Red dragon (chun, the red 中 character)
- Red fives (赤五): a red-colored 5 tile is
    0m = red five man, 0p = red five pin, 0s = red five sou.`;

/** モデルへの本体指示。STRICT JSON のみを返すよう強く要求する。 */
export const RECOGNIZE_PROMPT = `You are a precise mahjong (Japanese riichi) tile recognizer.
Identify EVERY mahjong tile visible in the image, including tiles in called melds (副露: chi/pon/kan) and any winning tile.

${TILE_LEGEND}

Rules:
- Read tiles left-to-right (and include melds set aside to the right).
- Return one entry per physical tile, in the order they appear.
- Use red-five codes (0m/0p/0s) only when the 5 tile is clearly red.
- Do NOT guess tiles that are not visible. Do NOT add explanations.

Output STRICT JSON only, with this EXACT shape and nothing else:
{"tiles": ["1m","2m","3m","1z"]}

Output ONLY the JSON object. No markdown, no code fences, no prose.`;
