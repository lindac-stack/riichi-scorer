// parse.js — 手牌の分解（面子分解）
//
// 14枚の手牌（副露を除く手牌 + 和了牌）を、すべての有効な「標準形(4面子1雀頭)」へ分解する。
// さらに七対子(chiitoitsu)・国士無双(kokushi)を判定する。
// 副露(melds)は固定面子として扱い、手牌側に残った牌のみを分解する。
//
// すべての牌ヘルパは ../tiles.js から import する（重複定義しない）。

import { normalize, suitOf, rankOf, isHonor, isYaochu, sortTiles } from '../tiles.js';

// 面子(group)の表現:
//   { type: 'shuntsu'|'kotsu', tiles: [Tile,Tile,Tile] }   // 順子 / 刻子
//   雀頭(pair): { type: 'pair', tiles: [Tile,Tile] }
//
// 副露由来の面子は parse 時に { ...group, open: bool, fromMeld: true, kan: bool } を付加する。

/** 正規化した牌の34種カウント配列を作る。index: m0-8, p9-17, s18-26, z27-33 */
function toCounts(tiles) {
  const counts = new Array(34).fill(0);
  for (const t of tiles) {
    counts[tileIndex(normalize(t))]++;
  }
  return counts;
}

/** 正規化済み牌 -> 0..33 のインデックス。 */
export function tileIndex(tile) {
  const s = suitOf(tile);
  const r = rankOf(tile);
  if (s === 'm') return r - 1;
  if (s === 'p') return 9 + r - 1;
  if (s === 's') return 18 + r - 1;
  return 27 + r - 1; // z
}

/** インデックス -> 正規化牌。 */
export function indexTile(idx) {
  if (idx < 9) return `${idx + 1}m`;
  if (idx < 18) return `${idx - 9 + 1}p`;
  if (idx < 27) return `${idx - 18 + 1}s`;
  return `${idx - 27 + 1}z`;
}

/**
 * 標準形(4面子1雀頭)の全分解を返す。
 * @param {string[]} handTiles - 手牌側の牌（副露を除く。雀頭+面子に分解されるべき枚数）
 * @returns {Array<Array<group>>} 分解の配列。各分解は group の配列（面子 + 雀頭1つ）。
 */
export function decomposeStandard(handTiles) {
  const counts = toCounts(handTiles);
  const results = [];
  const seen = new Set();

  // 雀頭候補を総当たり
  for (let p = 0; p < 34; p++) {
    if (counts[p] >= 2) {
      counts[p] -= 2;
      // 残り牌を刻子/順子のみで分解する全パターンを列挙し、各々に雀頭を加える。
      for (const combo of collectMeldCombos(counts)) {
        const groups = [
          { type: 'pair', tiles: [indexTile(p), indexTile(p)] },
          ...combo,
        ];
        const key = canonicalKey(groups);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(groups);
        }
      }
      counts[p] += 2;
    }
  }
  return results;
}

/**
 * 残り牌(counts)を面子(刻子/順子)のみで分解する全パターンを返す。
 * @returns {Array<Array<group>>}
 */
function collectMeldCombos(counts) {
  const c = counts.slice();
  const out = [];
  recurse(c, 0, [], out);
  return out;
}

function recurse(counts, start, acc, out) {
  // 先頭の非ゼロ牌を探す
  let i = start;
  while (i < 34 && counts[i] === 0) i++;
  if (i === 34) {
    out.push(acc.map((g) => ({ type: g.type, tiles: g.tiles.slice() })));
    return;
  }

  // 刻子として取る
  if (counts[i] >= 3) {
    counts[i] -= 3;
    acc.push({ type: 'kotsu', tiles: [indexTile(i), indexTile(i), indexTile(i)] });
    recurse(counts, i, acc, out);
    acc.pop();
    counts[i] += 3;
  }

  // 順子として取る（数牌のみ、i, i+1, i+2 が同一スート内）
  if (canShuntsu(i, counts)) {
    counts[i]--;
    counts[i + 1]--;
    counts[i + 2]--;
    acc.push({
      type: 'shuntsu',
      tiles: [indexTile(i), indexTile(i + 1), indexTile(i + 2)],
    });
    recurse(counts, i, acc, out);
    acc.pop();
    counts[i]++;
    counts[i + 1]++;
    counts[i + 2]++;
  }
}

/** index i から順子が組めるか（同一数牌スート内 i,i+1,i+2）。 */
function canShuntsu(i, counts) {
  if (i >= 27) return false; // 字牌
  const rank = (i % 9) + 1;
  if (rank > 7) return false; // 8,9 始まりは不可
  return counts[i] > 0 && counts[i + 1] > 0 && counts[i + 2] > 0;
}

/** 分解を一意キー化（重複排除用）。 */
function canonicalKey(groups) {
  return groups
    .map((g) => `${g.type}:${[...g.tiles].sort().join(',')}`)
    .sort()
    .join('|');
}

/** 七対子か判定（門前限定・7種それぞれ2枚、計14枚、副露なし）。 */
export function detectChiitoitsu(handTiles) {
  if (handTiles.length !== 14) return null;
  const counts = toCounts(handTiles);
  const pairs = [];
  for (let i = 0; i < 34; i++) {
    if (counts[i] === 2) pairs.push(indexTile(i));
    else if (counts[i] !== 0) return null; // 4枚使いなどは七対子として無効
  }
  if (pairs.length !== 7) return null;
  return { type: 'chiitoitsu', pairs };
}

/** 国士無双か判定（門前限定・么九13種＋いずれか1枚重複、計14枚、副露なし）。 */
export function detectKokushi(handTiles) {
  if (handTiles.length !== 14) return null;
  const yaochuIdx = [];
  for (let i = 0; i < 34; i++) {
    const t = indexTile(i);
    if (isYaochu(t)) yaochuIdx.push(i);
  }
  const counts = toCounts(handTiles);
  // 么九以外があれば不可
  for (let i = 0; i < 34; i++) {
    if (counts[i] > 0 && !isYaochu(indexTile(i))) return null;
  }
  let pairTile = null;
  for (const i of yaochuIdx) {
    if (counts[i] === 0) return null; // 13種すべて必要
    if (counts[i] === 2) {
      if (pairTile !== null) return null; // 対子は1つだけ
      pairTile = indexTile(i);
    } else if (counts[i] !== 1) {
      return null; // 3枚以上は不可
    }
  }
  if (!pairTile) return null; // 単騎の対子が必要（13面待ちでも和了形では1つ重複）
  return { type: 'kokushi', pairTile, thirteenWait: false };
}

/**
 * 手牌+副露をまとめて分解し、すべての有効な和了形を返す。
 * @returns {{ standard: Array<Array<group>>, chiitoitsu: object|null, kokushi: object|null }}
 *   standard の各分解は、副露由来の面子も含めた完全な4面子1雀頭。
 */
export function decompose(handTiles, melds = []) {
  // 副露を group 化
  const meldGroups = melds.map((m) => meldToGroup(m));
  const concealedCount = 4 - meldGroups.length; // 手牌側で組むべき面子数

  // 標準形: 手牌側を (concealedCount 面子 + 雀頭) に分解
  const rawStandard = decomposeStandard(handTiles);
  const standard = [];
  for (const groups of rawStandard) {
    const meldsInGroups = groups.filter((g) => g.type !== 'pair').length;
    if (meldsInGroups !== concealedCount) continue;
    standard.push([...groups.map((g) => ({ ...g, fromMeld: false })), ...meldGroups]);
  }

  // 七対子・国士は副露なし時のみ
  const chiitoitsu = melds.length === 0 ? detectChiitoitsu(handTiles) : null;
  const kokushi = melds.length === 0 ? detectKokushi(handTiles) : null;

  return { standard, chiitoitsu, kokushi };
}

/** 副露 Meld -> group。 */
function meldToGroup(meld) {
  const tiles = meld.tiles.slice();
  const norm = tiles.map(normalize);
  if (meld.type === 'chi') {
    return { type: 'shuntsu', tiles, fromMeld: true, open: true, kan: false };
  }
  if (meld.type === 'pon') {
    return { type: 'kotsu', tiles, fromMeld: true, open: true, kan: false };
  }
  // kan
  return {
    type: 'kotsu',
    tiles,
    fromMeld: true,
    open: meld.open !== false, // ankan は open:false
    kan: true,
  };
}
