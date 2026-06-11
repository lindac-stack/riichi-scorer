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
Identify ONLY the tiles whose printed FACE is clearly visible — the player's hand,
called melds (副露: chi/pon/kan) and any winning tile.

${TILE_LEGEND}

Before reading, ORIENT the image:
- The photo may be rotated or taken at an angle. Mentally rotate it so the tile
  faces are upright (number/kanji readable) BEFORE identifying anything.

What to READ vs IGNORE:
- READ: tiles lying face-up showing their white printed face.
- IGNORE completely: tiles showing only their colored BACK or side (e.g. plain
  yellow/green/blue backs with no symbol), the unbroken wall, the discard pond,
  hands, arms, people, animals, furniture and background. These are NOT hand tiles.

How to read each FACE-up tile (examine ONE AT A TIME):
- 萬子 (man, 1m-9m): a kanji number (一二三四五六七八九) above the 萬 character.
- 筒子 (pin, 1p-9p): COUNT the round circles/dots — that count IS the number.
- 索子 (sou, 1s-9s): COUNT the bamboo sticks — that count IS the number.
    The 1 of bamboo (1s) is usually a single bird, not a stick.
- Count carefully: pin and sou 1-9 differ ONLY by how many circles/sticks show.
- A tile printed with RED characters/circles/sticks where the others are black is
  a special tile: a red dragon 中 (7z) if it is the 中 kanji, otherwise a red five
  (0m/0p/0s). Do not silently drop it.

CRITICAL — report what you SEE, never what you EXPECT:
- Report EXACTLY what each tile shows. Do NOT assume the hand forms runs/sequences
  and do NOT "fix" tiles into a tidy pattern. Duplicates and gaps are normal.
- Do NOT pad the list to reach 13 or 14. If only 6 faces are readable, return 6.
- Do NOT invent honor tiles (especially do NOT output a full 1z..7z set) to fill space.
- If NO tile faces are clearly readable, return an empty list: {"tiles": []}.
- Use red-five codes (0m/0p/0s) only when the 5 tile is clearly red.

Output STRICT JSON only, with this EXACT shape and nothing else:
{"tiles": ["1m","2m","3m","1z"]}

Output ONLY the JSON object. No markdown, no code fences, no prose.`;

/**
 * 2パス認識の Pass 1: 採点対象の牌が写っている領域の bounding box を返させる。
 * 山・捨て牌・人・背景を除外し、手牌/副露/和了牌の塊だけを囲ませる。
 * 正規化座標 [0,1]（原点=左上）。検出不能なら box:null。
 */
export const LOCATE_PROMPT = `You are localizing mahjong tiles in a photo.
Find ONE tight bounding box that contains the player's SCORABLE tiles —
the face-up hand, any called melds, and the winning tile (the tiles to be read).

IGNORE and keep OUTSIDE the box: the undealt wall, the discard pond, people,
hands, arms, animals, furniture, background, and any tiles showing only their
colored back (no symbol).

Return STRICT JSON with normalized coordinates in [0,1], origin = top-left:
{"box": {"x0": 0.12, "y0": 0.40, "x1": 0.95, "y1": 0.72}}
- x0,y0 = top-left corner of the box; x1,y1 = bottom-right corner.
- Make the box TIGHT around the face-up tiles but include all of them.
- If you cannot find any face-up scorable tiles, return {"box": null}.

Output ONLY the JSON object. No markdown, no code fences, no prose.`;

/**
 * 旧プロンプト（回帰比較用）。実写真ベンチで before/after を測るために保持。
 * アプリ本体は上の改良版 RECOGNIZE_PROMPT を使う。
 */
export const RECOGNIZE_PROMPT_LEGACY = `You are a precise mahjong (Japanese riichi) tile recognizer.
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
