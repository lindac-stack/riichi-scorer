// tiles.js — 共有牌モデル（全モジュールが参照する単一の真実）
//
// 牌表記 (notation):
//   萬子: "1m".."9m"   筒子: "1p".."9p"   索子: "1s".."9s"
//   字牌: "1z".."7z"   ( 1z=東 2z=南 3z=西 4z=北 5z=白 6z=發 7z=中 )
//   赤五: "0m" "0p" "0s"  ( 構造上は 5 として扱い、ドラ +1 )
//
// すべての関数は上記の文字列(以下 Tile)を基本単位とする。

export const SUITS = ['m', 'p', 's', 'z'];

export const WINDS = { '1z': '東', '2z': '南', '3z': '西', '4z': '北' };
export const DRAGONS = { '5z': '白', '6z': '發', '7z': '中' };

// 表示名（日本語漢字）
const NUM_KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT_KANJI = { m: '萬', p: '筒', s: '索' };

/** 赤五を通常の五に正規化（構造判定用）。"0m"->"5m" 等。 */
export function normalize(tile) {
  if (tile === '0m') return '5m';
  if (tile === '0p') return '5p';
  if (tile === '0s') return '5s';
  return tile;
}

/** 赤ドラ牌か。 */
export function isRed(tile) {
  return tile === '0m' || tile === '0p' || tile === '0s';
}

export function suitOf(tile) {
  return tile[1];
}

/** 数牌の数(1-9)。字牌は 0 を返さず番号(1-7)。赤五は 5。 */
export function rankOf(tile) {
  const n = Number(tile[0]);
  return n === 0 ? 5 : n;
}

export function isHonor(tile) {
  return suitOf(tile) === 'z';
}

export function isWind(tile) {
  return tile in WINDS;
}

export function isDragon(tile) {
  return tile in DRAGONS;
}

export function isTerminal(tile) {
  // 老頭牌 (1,9 の数牌)
  if (isHonor(tile)) return false;
  const r = rankOf(tile);
  return r === 1 || r === 9;
}

/** 么九牌 (1,9 数牌 + 字牌)。 */
export function isYaochu(tile) {
  return isHonor(tile) || isTerminal(tile);
}

/** ドラ表示牌からドラ本体を求める。 */
export function doraFromIndicator(indicator) {
  const t = normalize(indicator);
  const s = suitOf(t);
  if (s === 'z') {
    const r = rankOf(t);
    if (r <= 4) return `${(r % 4) + 1}z`; // 東→南→西→北→東
    return `${((r - 5 + 1) % 3) + 5}z`; // 白→發→中→白
  }
  const r = rankOf(t);
  return `${r === 9 ? 1 : r + 1}${s}`;
}

/** 表示用の日本語名。例 "5m"->"五萬", "0p"->"赤五筒", "1z"->"東", "7z"->"中"。 */
export function displayName(tile) {
  const s = suitOf(tile);
  if (s === 'z') {
    return WINDS[tile] || DRAGONS[tile] || tile;
  }
  const r = rankOf(tile);
  const red = isRed(tile) ? '赤' : '';
  return `${red}${NUM_KANJI[r]}${SUIT_KANJI[s]}`;
}

/** ソート用の安定キー。 m<p<s<z, 数字昇順, 赤五は5の直前。 */
export function sortKey(tile) {
  const order = { m: 0, p: 1, s: 2, z: 3 };
  const r = rankOf(tile);
  const redAdj = isRed(tile) ? -0.5 : 0; // 赤五を5の前に
  return order[suitOf(tile)] * 100 + (r + redAdj);
}

export function sortTiles(tiles) {
  return [...tiles].sort((a, b) => sortKey(a) - sortKey(b));
}

/** 全種類の牌(赤含まず)。UIの牌選択や認識候補に。 */
export function allTileTypes() {
  const out = [];
  for (const s of ['m', 'p', 's']) for (let n = 1; n <= 9; n++) out.push(`${n}${s}`);
  for (let n = 1; n <= 7; n++) out.push(`${n}z`);
  return out;
}

/**
 * 入力の自由表記をTile配列に解析する。
 * 受理する書式の例:
 *   "123m456p789s11z2z2z" (まとめ書き, MPSZ)
 *   "1m 2m 3m ..." (空白区切り)
 *   "東南白發中" などの日本語漢字 / "1z" 直接
 * 解析できない断片は無視する(寛容パーサ)。
 * @returns {string[]} Tile配列
 */
export function parseTileInput(text) {
  if (!text) return [];
  const tiles = [];

  // 日本語漢字 字牌の直接マッピング
  const kanjiHonor = { 東: '1z', 南: '2z', 西: '3z', 北: '4z', 白: '5z', 發: '6z', 发: '6z', 中: '7z' };
  // 数牌の漢数字+漢字スート(例: 五萬)
  const kanjiNum = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 〇: 5 };
  const kanjiSuit = { 萬: 'm', 万: 'm', 筒: 'p', 餅: 'p', 索: 's', 條: 's', 条: 's' };

  // 1) MPSZ まとめ書き / 空白区切りの英数字
  //    数字の並び + スート文字 のグループを拾う
  const groupRe = /([0-9]+)\s*([mpsz])/gi;
  let m;
  let consumed = false;
  while ((m = groupRe.exec(text)) !== null) {
    consumed = true;
    const digits = m[1];
    const suit = m[2].toLowerCase();
    for (const d of digits) tiles.push(`${d}${suit}`);
  }

  // 2) 漢字表記の処理（英数字で拾えていない部分を補完）
  //    赤五(赤)プレフィックスにも対応
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (kanjiHonor[ch]) {
      tiles.push(kanjiHonor[ch]);
    } else if (kanjiNum[ch] && kanjiSuit[text[i + 1]]) {
      const n = kanjiNum[ch];
      tiles.push(`${n}${kanjiSuit[text[i + 1]]}`);
      i++;
    } else if (ch === '赤' && kanjiNum[text[i + 1]] === 5 && kanjiSuit[text[i + 2]]) {
      tiles.push(`0${kanjiSuit[text[i + 2]]}`);
      i += 2;
    }
  }

  return tiles;
}
