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

How to read each tile (examine tiles ONE AT A TIME, left to right):
- 萬子 (man, 1m-9m): a kanji number (一二三四五六七八九) above the 萬 character.
- 筒子 (pin, 1p-9p): COUNT the round circles/dots drawn on the tile — that count IS the number.
- 索子 (sou, 1s-9s): COUNT the bamboo sticks drawn on the tile — that count IS the number.
    The 1 of bamboo (1s) is usually drawn as a single bird, not a stick.
- Count carefully: pin and sou 1-9 differ ONLY by how many circles/sticks are shown.

Rules:
- Read tiles left-to-right (and include melds set aside to the right).
- Return one entry per physical tile, in the order they appear.
- Report EXACTLY what each tile shows. Do NOT assume the hand forms runs or
  sequences, and do NOT "fix" tiles into a tidy pattern — duplicated or
  non-sequential tiles are normal and expected.
- A typical hand has 13 or 14 tiles (plus any called-meld tiles); make your
  output length match the number of tiles actually visible.
- Use red-five codes (0m/0p/0s) only when the 5 tile is clearly red.
- Do NOT guess tiles that are not visible. Do NOT add explanations.

Output STRICT JSON only, with this EXACT shape and nothing else:
{"tiles": ["1m","2m","3m","1z"]}

Output ONLY the JSON object. No markdown, no code fences, no prose.`;
