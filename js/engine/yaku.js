// yaku.js — 役判定
//
// 標準形の分解(group配列) + 文脈 から成立する役を列挙する。
// 門前/食い下がり/役満を区別。役名は SPEC の日本語表記に厳密準拠。
//
// 牌ヘルパは ../tiles.js から import。

import {
  normalize,
  suitOf,
  rankOf,
  isHonor,
  isTerminal,
  isYaochu,
  isWind,
  isDragon,
  WINDS,
  DRAGONS,
} from '../tiles.js';

// ---- 補助関数 ----

function tileKey(t) {
  return normalize(t);
}

/** group の代表牌（正規化）。 */
function repTile(g) {
  return normalize(g.tiles[0]);
}

/** 全牌（正規化）を平坦に。 */
function allTiles(decomp) {
  const out = [];
  for (const g of decomp) for (const t of g.tiles) out.push(normalize(t));
  return out;
}

/** 順子を represent するソート済みrank。 */
function shuntsuRanks(g) {
  return g.tiles.map((t) => rankOf(t)).sort((a, b) => a - b);
}

// ---- メイン ----

/**
 * 標準形の役判定。
 * @param {object} ctx
 *   - decomp: group配列（4面子1雀頭、副露含む）
 *   - menzen: boolean
 *   - winType, seatWind, roundWind, winningTile
 *   - フラグ: riichi, doubleRiichi, ippatsu, rinshan, chankan, haitei, houtei, tenhou, chiihou
 * @returns {{ yaku: [{name,han}], yakuman: number, isPinfu: boolean }}
 */
export function detectStandardYaku(ctx) {
  const {
    decomp,
    menzen,
    winType,
    seatWind,
    roundWind,
    winningTile,
    riichi,
    doubleRiichi,
    ippatsu,
    rinshan,
    chankan,
    haitei,
    houtei,
    tenhou,
    chiihou,
  } = ctx;

  const yaku = [];
  const yakumanList = [];

  const melds = decomp.filter((g) => g.type !== 'pair');
  const pair = decomp.find((g) => g.type === 'pair');
  const shuntsu = melds.filter((g) => g.type === 'shuntsu');
  const kotsu = melds.filter((g) => g.type === 'kotsu');
  const tiles = allTiles(decomp);

  // ===== 役満判定 =====

  // 国士は別経路（parse側で判定）なのでここでは扱わない。

  // 四暗刻（暗刻4つ。ロンで完成した刻子は暗刻にならない＝四暗刻不成立、単騎は除く）
  const ankouCount = countAnkou(decomp, winType, winningTile);
  if (ankouCount === 4 && menzen) {
    // 単騎待ちなら四暗刻単騎（ダブル役満扱いの流儀もあるが、ここでは役満1）
    yakumanList.push({ name: '四暗刻', mult: 1 });
  }

  // 大三元（白發中すべて刻子/槓子）
  const dragonKotsu = kotsu.filter((g) => isDragon(repTile(g)));
  if (dragonKotsu.length === 3) {
    yakumanList.push({ name: '大三元', mult: 1 });
  }

  // 字一色（全て字牌）
  if (tiles.every((t) => isHonor(t))) {
    yakumanList.push({ name: '字一色', mult: 1 });
  }

  // 緑一色（索子の2,3,4,6,8 と 發 のみ）
  if (isRyuuiisou(tiles)) {
    yakumanList.push({ name: '緑一色', mult: 1 });
  }

  // 清老頭（全て老頭牌 1,9 数牌の刻子）
  if (tiles.every((t) => isTerminal(t))) {
    yakumanList.push({ name: '清老頭', mult: 1 });
  }

  // 四喜和（風牌の刻子）
  const windKotsu = kotsu.filter((g) => isWind(repTile(g)));
  const pairIsWind = pair && isWind(repTile(pair));
  if (windKotsu.length === 4) {
    yakumanList.push({ name: '大四喜', mult: 1 });
  } else if (windKotsu.length === 3 && pairIsWind) {
    yakumanList.push({ name: '小四喜', mult: 1 });
  }

  // 四槓子
  const kanCount = melds.filter((g) => g.kan).length;
  if (kanCount === 4) {
    yakumanList.push({ name: '四槓子', mult: 1 });
  }

  // 九蓮宝燈（門前・清一色で 1112345678999 + 任意1枚）
  if (menzen && isChuuren(decomp)) {
    yakumanList.push({ name: '九蓮宝燈', mult: 1 });
  }

  // 天和・地和
  if (tenhou) yakumanList.push({ name: '天和', mult: 1 });
  if (chiihou) yakumanList.push({ name: '地和', mult: 1 });

  // 役満が成立していれば通常役は数えない
  if (yakumanList.length > 0) {
    const totalMult = yakumanList.reduce((s, y) => s + y.mult, 0);
    return {
      yaku: yakumanList.map((y) => ({ name: y.name, han: 0 })),
      yakuman: totalMult,
      isPinfu: false,
    };
  }

  // ===== 通常役 =====

  // 立直系
  if (doubleRiichi) yaku.push({ name: 'ダブル立直', han: 2 });
  else if (riichi) yaku.push({ name: '立直', han: 1 });
  if (ippatsu && (riichi || doubleRiichi)) yaku.push({ name: '一発', han: 1 });

  // 門前清自摸和
  if (menzen && winType === 'tsumo') yaku.push({ name: '門前清自摸和', han: 1 });

  // 平和
  const pinfu = isPinfu({ decomp, menzen, pair, shuntsu, kotsu, seatWind, roundWind, winningTile });
  if (pinfu) yaku.push({ name: '平和', han: 1 });

  // 断么九（全て中張牌 2-8）
  if (tiles.every((t) => !isYaochu(t))) {
    yaku.push({ name: '断么九', han: 1 });
  }

  // 一盃口 / 二盃口（門前限定）
  if (menzen) {
    const iipeikou = countIipeikou(shuntsu);
    if (iipeikou === 2) yaku.push({ name: '二盃口', han: 3 });
    else if (iipeikou === 1) yaku.push({ name: '一盃口', han: 1 });
  }

  // 役牌
  for (const g of kotsu) {
    const t = repTile(g);
    if (isDragon(t)) {
      yaku.push({ name: `役牌 ${DRAGONS[t]}`, han: 1 });
    }
  }
  for (const g of kotsu) {
    const t = repTile(g);
    if (isWind(t)) {
      if (t === roundWind) yaku.push({ name: `場風 ${WINDS[t]}`, han: 1 });
      if (t === seatWind) yaku.push({ name: `自風 ${WINDS[t]}`, han: 1 });
    }
  }

  // 三色同順
  if (hasSanshokuDoujun(shuntsu)) {
    yaku.push({ name: '三色同順', han: menzen ? 2 : 1 });
  }

  // 三色同刻
  if (hasSanshokuDoukou(kotsu)) {
    yaku.push({ name: '三色同刻', han: 2 });
  }

  // 一気通貫
  if (hasIttsuu(shuntsu)) {
    yaku.push({ name: '一気通貫', han: menzen ? 2 : 1 });
  }

  // 全帯么九 / 純全帯么九（全ての面子と雀頭が么九を含む）
  const chanta = chantaType(decomp);
  if (chanta === 'junchan') {
    yaku.push({ name: '純全帯么九', han: menzen ? 3 : 2 });
  } else if (chanta === 'chanta') {
    yaku.push({ name: '全帯么九', han: menzen ? 2 : 1 });
  }

  // 対々和
  if (kotsu.length === 4) {
    yaku.push({ name: '対々和', han: 2 });
  }

  // 三暗刻
  if (ankouCount === 3) {
    yaku.push({ name: '三暗刻', han: 2 });
  }

  // 三槓子
  if (kanCount === 3) {
    yaku.push({ name: '三槓子', han: 2 });
  }

  // 混老頭（全て么九牌で構成・順子なし）
  if (tiles.every((t) => isYaochu(t)) && shuntsu.length === 0) {
    yaku.push({ name: '混老頭', han: 2 });
  }

  // 小三元（龍2刻 + 龍雀頭）
  if (dragonKotsu.length === 2 && pair && isDragon(repTile(pair))) {
    yaku.push({ name: '小三元', han: 2 });
  }

  // 混一色 / 清一色
  const flush = flushType(tiles);
  if (flush === 'chin') {
    yaku.push({ name: '清一色', han: menzen ? 6 : 5 });
  } else if (flush === 'hon') {
    yaku.push({ name: '混一色', han: menzen ? 3 : 2 });
  }

  // 状況役
  if (rinshan) yaku.push({ name: '嶺上開花', han: 1 });
  if (chankan) yaku.push({ name: '槍槓', han: 1 });
  if (haitei && winType === 'tsumo') yaku.push({ name: '海底摸月', han: 1 });
  if (houtei && winType === 'ron') yaku.push({ name: '河底撈魚', han: 1 });

  return { yaku, yakuman: 0, isPinfu: pinfu };
}

// ---- 役満補助 ----

function isRyuuiisou(tiles) {
  const green = new Set(['2s', '3s', '4s', '6s', '8s', '6z']); // 發=6z
  return tiles.every((t) => green.has(t));
}

function isChuuren(decomp) {
  const tiles = allTiles(decomp);
  // 単一スートの数牌のみ
  const suits = new Set(tiles.map((t) => suitOf(t)));
  if (suits.size !== 1 || suits.has('z')) return false;
  const counts = new Array(10).fill(0);
  for (const t of tiles) counts[rankOf(t)]++;
  // 1112345678999 + 1枚
  const need = [0, 3, 1, 1, 1, 1, 1, 1, 1, 3];
  for (let r = 1; r <= 9; r++) {
    if (counts[r] < need[r]) return false;
  }
  // 余り1枚が 1-9 のいずれか（合計14枚なので自動的に成立）
  let extra = 0;
  for (let r = 1; r <= 9; r++) extra += counts[r] - need[r];
  return extra === 1;
}

/** 暗刻（暗槓含む）の数。ロンで完成した刻子は暗刻に数えない。 */
function countAnkou(decomp, winType, winningTile) {
  const w = normalize(winningTile);
  let n = 0;
  for (const g of decomp) {
    if (g.type !== 'kotsu') continue;
    if (g.open) continue; // 明刻/明槓は暗刻でない
    // ロンで完成した刻子（手牌内、和了牌で third を補完）は明刻扱い
    if (winType === 'ron' && normalize(g.tiles[0]) === w && !g.kan) {
      continue;
    }
    n++;
  }
  return n;
}

// ---- 通常役補助 ----

function isPinfu({ decomp, menzen, pair, shuntsu, kotsu, seatWind, roundWind, winningTile }) {
  if (!menzen) return false;
  if (kotsu.length !== 0) return false; // 全て順子
  if (shuntsu.length !== 4) return false;
  // 雀頭が役牌でない
  const pt = repTile(pair);
  if (isDragon(pt)) return false;
  if (isWind(pt) && (pt === seatWind || pt === roundWind)) return false;
  // 和了牌が「両面待ち」で完成する順子が少なくとも1つ存在すること。
  // 両面 = 和了牌が順子の端(最小or最大rank)で、かつ辺張(123の3待ち/789の7待ち)でない。
  const w = normalize(winningTile);
  const wSuit = suitOf(w);
  const wRank = rankOf(w);
  for (const g of shuntsu) {
    if (suitOf(repTile(g)) !== wSuit) continue;
    const [lo, , hi] = shuntsuRanks(g);
    if (wRank !== lo && wRank !== hi) continue; // 嵌張は不可
    // 辺張除外: 123 で 3 待ち / 789 で 7 待ち
    const isPenchan =
      (lo === 1 && hi === 3 && wRank === 3) || (lo === 7 && hi === 9 && wRank === 7);
    if (!isPenchan) return true;
  }
  return false;
}

function countIipeikou(shuntsu) {
  // 完全同一順子のペア数。二盃口は2ペア。
  const keys = shuntsu.map((g) => `${suitOf(repTile(g))}${shuntsuRanks(g).join('')}`);
  const map = {};
  for (const k of keys) map[k] = (map[k] || 0) + 1;
  let pairs = 0;
  for (const k in map) pairs += Math.floor(map[k] / 2);
  return pairs;
}

function hasSanshokuDoujun(shuntsu) {
  // 同じ開始rankの順子が m,p,s 三色そろう
  const bySuit = { m: new Set(), p: new Set(), s: new Set() };
  for (const g of shuntsu) {
    const s = suitOf(repTile(g));
    if (bySuit[s]) bySuit[s].add(shuntsuRanks(g)[0]);
  }
  for (let r = 1; r <= 7; r++) {
    if (bySuit.m.has(r) && bySuit.p.has(r) && bySuit.s.has(r)) return true;
  }
  return false;
}

function hasSanshokuDoukou(kotsu) {
  const bySuit = { m: new Set(), p: new Set(), s: new Set() };
  for (const g of kotsu) {
    const t = repTile(g);
    const s = suitOf(t);
    if (bySuit[s]) bySuit[s].add(rankOf(t));
  }
  for (let r = 1; r <= 9; r++) {
    if (bySuit.m.has(r) && bySuit.p.has(r) && bySuit.s.has(r)) return true;
  }
  return false;
}

function hasIttsuu(shuntsu) {
  const bySuit = { m: new Set(), p: new Set(), s: new Set() };
  for (const g of shuntsu) {
    const s = suitOf(repTile(g));
    if (bySuit[s]) bySuit[s].add(shuntsuRanks(g)[0]);
  }
  for (const s of ['m', 'p', 's']) {
    if (bySuit[s].has(1) && bySuit[s].has(4) && bySuit[s].has(7)) return true;
  }
  return false;
}

/** 'junchan' | 'chanta' | null */
function chantaType(decomp) {
  let hasShuntsu = false;
  let allHaveTerminal = true; // 純全用（数牌の1/9のみ、字牌なし）
  let allHaveYaochu = true; // 全帯用（么九を含む）
  let anyHonor = false;

  for (const g of decomp) {
    const ts = g.tiles.map((t) => normalize(t));
    if (g.type === 'shuntsu') hasShuntsu = true;
    const hasYao = ts.some((t) => isYaochu(t));
    const hasTerm = ts.some((t) => isTerminal(t));
    if (ts.some((t) => isHonor(t))) anyHonor = true;
    if (!hasYao) allHaveYaochu = false;
    if (!hasTerm) allHaveTerminal = false;
  }
  if (!hasShuntsu) return null; // 順子なしは混老頭/清老頭の領域
  if (allHaveTerminal && !anyHonor) return 'junchan';
  if (allHaveYaochu) return 'chanta';
  return null;
}

/** 'chin'(清一色) | 'hon'(混一色) | null */
function flushType(tiles) {
  const numSuits = new Set();
  let hasHonor = false;
  for (const t of tiles) {
    const s = suitOf(t);
    if (s === 'z') hasHonor = true;
    else numSuits.add(s);
  }
  if (numSuits.size !== 1) return null;
  return hasHonor ? 'hon' : 'chin';
}

/** 国士無双の役。 */
export function kokushiYaku(kokushi) {
  // 13面待ちはダブル役満の流儀もあるが、ここでは役満1。
  return { yaku: [{ name: '国士無双', han: 0 }], yakuman: 1 };
}

/** 七対子の役（門前限定2翻）。立直等の状況役は score 側で別途付与。 */
export function chiitoitsuYaku() {
  return { name: '七対子', han: 2 };
}
