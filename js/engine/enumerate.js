// enumerate.js — enumerateOutcomes(tiles, ctx) -> Outcome[]
//
// 認識牌から「全パターンの得点」を出す。和了牌候補 × {自摸/栄和} × {親/子} を
// 総当たりし、成立する全組合せを得点降順で返す。役なしは除外。
//
// 牌ヘルパは ../tiles.js から import。

import { normalize, displayName, sortTiles, WINDS } from '../tiles.js';
import { scoreHand } from './score.js';

/**
 * @param {string[]} tiles 認識牌（門前14枚想定。副露は ctx.melds）
 * @param {object} ctx 既定文脈 { seatWind, roundWind, doraIndicators, riichi, ... }
 * @returns {Array<{label, input, result}>} 得点降順
 */
export function enumerateOutcomes(tiles, ctx = {}) {
  const melds = ctx.melds || [];
  const handTiles = tiles.slice();

  // 副露3枚 × meld数 + 手牌 が 13 になっている必要（和了牌込みで14）。
  // tiles は和了牌込みの全手牌想定。和了牌候補 = 手牌中の各ユニーク牌。
  const totalNeeded = 13 - melds.length * 3;
  // 手牌が和了済み14枚相当か、聴牌13枚かを許容するため、
  // 14枚(=totalNeeded+1)を和了形として扱う。
  const candidates = [];

  const seatWinds = ctx.seatWind ? [ctx.seatWind] : ['1z', '2z']; // 親/子の代表
  const roundWind = ctx.roundWind || '1z';

  // 和了牌候補: 手牌中のユニーク牌
  const uniqueTiles = [...new Set(handTiles.map((t) => t))];

  const seen = new Map(); // label -> outcome（同点まとめ）
  const outcomes = [];

  for (const winningTile of uniqueTiles) {
    for (const winType of ['tsumo', 'ron']) {
      // 親(1z)/子(2z) 両方を試す（ctx.seatWind 指定があればそれ優先）
      const seats = ctx.seatWind ? [ctx.seatWind] : ['1z', '2z'];
      for (const seatWind of seats) {
        const input = {
          hand: handTiles,
          winningTile,
          melds,
          winType,
          seatWind,
          roundWind,
          doraIndicators: ctx.doraIndicators || [],
          uraIndicators: ctx.uraIndicators || [],
          taggedDora: ctx.taggedDora || 0,
          riichi: ctx.riichi || false,
          doubleRiichi: ctx.doubleRiichi || false,
          ippatsu: ctx.ippatsu || false,
          rinshan: ctx.rinshan || false,
          chankan: ctx.chankan || false,
          haitei: ctx.haitei || false,
          houtei: ctx.houtei || false,
          tenhou: ctx.tenhou || false,
          chiihou: ctx.chiihou || false,
        };
        const result = scoreHand(input);
        if (!result.valid) continue;

        const isDealer = seatWind === '1z';
        const label = makeLabel({ winningTile, winType, isDealer, result });
        outcomes.push({ label, input, result });
      }
    }
  }

  // 得点降順
  outcomes.sort((a, b) => b.result.points.total - a.result.points.total);
  return outcomes;
}

function makeLabel({ winningTile, winType, isDealer, result }) {
  const oya = isDealer ? '親' : '子';
  const wt = winType === 'tsumo' ? '自摸' : '栄和';
  const yakuNames = result.yaku.map((y) => y.name).join('・');
  return `${oya} ${displayName(winningTile)}${wt} [${yakuNames}] ${result.display}`;
}
