// fu.js — 符計算
//
// 副底20 + 門前ロン10 + ツモ2 + 待ち2 + 雀頭 + 面子 を加算し、1の位を切り上げ。
// 平和ツモは20符固定、七対子は25符固定、喰い平和形ロンは30符。
//
// 牌ヘルパは ../tiles.js から import。

import { normalize, suitOf, rankOf, isYaochu, isWind, isDragon } from '../tiles.js';

/**
 * 符を計算する。
 * @param {object} args
 *   - decomp: 標準形の group 配列（4面子1雀頭、副露含む）
 *   - winType: 'tsumo'|'ron'
 *   - menzen: boolean（門前か）
 *   - winningTile: Tile（和了牌）
 *   - seatWind, roundWind: 字牌Tile
 *   - isPinfu: boolean（平和成立か）
 *   - isChiitoitsu: boolean
 * @returns {{ fu: number, detail: object }}
 */
export function calcFu(args) {
  const {
    decomp,
    winType,
    menzen,
    winningTile,
    seatWind,
    roundWind,
    isPinfu,
    isChiitoitsu,
  } = args;

  // 七対子は25符固定
  if (isChiitoitsu) {
    return { fu: 25, detail: { base: 25, note: '七対子固定' } };
  }

  // 平和ツモは20符固定
  if (isPinfu && winType === 'tsumo') {
    return { fu: 20, detail: { base: 20, note: '平和ツモ固定' } };
  }
  // 平和ロン（門前）は 副底20 + 門前ロン10 = 30符固定
  if (isPinfu && winType === 'ron') {
    return { fu: 30, detail: { base: 20, menzenRon: 10, note: '平和ロン固定' } };
  }

  let fu = 20; // 副底
  const detail = { base: 20, parts: [] };

  // 門前ロン +10
  if (menzen && winType === 'ron') {
    fu += 10;
    detail.parts.push({ name: '門前加符', fu: 10 });
  }

  // ツモ +2（門前/副露問わず。ただし平和ツモは上で処理済み）
  if (winType === 'tsumo') {
    fu += 2;
    detail.parts.push({ name: 'ツモ', fu: 2 });
  }

  const wNorm = normalize(winningTile);

  // 面子の符
  for (const g of decomp) {
    if (g.type === 'shuntsu' || g.type === 'pair') continue;
    if (g.type !== 'kotsu') continue;
    const tile = normalize(g.tiles[0]);
    const yao = isYaochu(tile);
    let f = 0;
    if (g.kan) {
      // 槓子
      f = g.open ? (yao ? 16 : 8) : yao ? 32 : 16; // 明槓 / 暗槓
    } else {
      // 刻子: ロンで完成した刻子は明刻扱い
      let concealed = !g.open; // 副露ポンは open:true
      if (concealed && winType === 'ron' && tile === wNorm && completedByWin(g, winningTile)) {
        concealed = false; // ロンで third を取った暗刻 → 明刻扱い
      }
      if (concealed) {
        f = yao ? 8 : 4; // 暗刻
      } else {
        f = yao ? 4 : 2; // 明刻
      }
    }
    fu += f;
    detail.parts.push({ name: kotsuName(g), tile, fu: f });
  }

  // 雀頭の符（役牌対子）
  const pair = decomp.find((g) => g.type === 'pair');
  if (pair) {
    const pt = normalize(pair.tiles[0]);
    let pf = 0;
    if (isDragon(pt)) pf += 2;
    if (isWind(pt)) {
      if (pt === seatWind) pf += 2;
      if (pt === roundWind) pf += 2; // 連風牌は +4
    }
    if (pf > 0) {
      fu += pf;
      detail.parts.push({ name: '雀頭', tile: pt, fu: pf });
    }
  }

  // 待ちの符（嵌張/辺張/単騎 +2）
  const waitFu = waitFuValue(decomp, winningTile);
  if (waitFu > 0) {
    fu += waitFu;
    detail.parts.push({ name: '待ち', fu: waitFu });
  }

  // 1の位切り上げ
  const rounded = Math.ceil(fu / 10) * 10;
  detail.raw = fu;
  detail.fu = rounded;
  return { fu: rounded, detail };
}

function kotsuName(g) {
  if (g.kan) return g.open ? '明槓' : '暗槓';
  return g.open ? '明刻' : '暗刻';
}

/** ロンで完成した刻子か（対象牌が和了牌と一致）。 */
function completedByWin(g, winningTile) {
  return normalize(g.tiles[0]) === normalize(winningTile);
}

/**
 * 待ちの形による符。和了牌が
 *  - 単騎（雀頭の片割れ）: +2
 *  - 嵌張（順子の真ん中）: +2
 *  - 辺張（123の3 or 789の7）: +2
 *  - 両面/双碰: +0
 * 複数解釈可能なら符が高くなる方を選ぶ余地があるが、
 * ここでは「和了牌が属し得る面子」のうち最も符の高い解釈を採る。
 */
function waitFuValue(decomp, winningTile) {
  const w = normalize(winningTile);
  let best = 0;

  // 単騎: 雀頭が和了牌
  const pair = decomp.find((g) => g.type === 'pair');
  if (pair && normalize(pair.tiles[0]) === w) {
    best = Math.max(best, 2);
  }

  for (const g of decomp) {
    if (g.type !== 'shuntsu') continue;
    const ranks = g.tiles.map((t) => rankOf(t));
    const suit = suitOf(normalize(g.tiles[0]));
    const wSuit = suitOf(w);
    const wRank = rankOf(w);
    if (suit !== wSuit) continue;
    if (!ranks.includes(wRank)) continue;
    const sorted = [...ranks].sort((a, b) => a - b);
    // 嵌張: 真ん中
    if (wRank === sorted[1]) {
      best = Math.max(best, 2);
    }
    // 辺張: 123 で 3 を待つ / 789 で 7 を待つ
    if (sorted[0] === 1 && sorted[2] === 3 && wRank === 3) best = Math.max(best, 2);
    if (sorted[0] === 7 && sorted[2] === 9 && wRank === 7) best = Math.max(best, 2);
    // 両面は +0（端でない両面）
  }
  return best;
}
