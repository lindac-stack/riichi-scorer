// score.js — scoreHand(input) -> Result
//
// 全分解を試し、最高得点の有効な和了形を選ぶ。
// ドラ/赤/裏を数え、基本点→点数→display を計算する。
//
// 牌ヘルパは ../tiles.js から import。

import { normalize, isRed, doraFromIndicator } from '../tiles.js';
import { decompose } from './parse.js';
import { detectStandardYaku, chiitoitsuYaku } from './yaku.js';
import { calcFu } from './fu.js';

/**
 * @param {object} input  SPEC の input
 * @returns {object} Result（SPEC）
 */
export function scoreHand(input) {
  const {
    hand = [],
    winningTile,
    melds = [],
    winType,
    seatWind,
    roundWind,
    doraIndicators = [],
    uraIndicators = [],
    riichi = false,
    doubleRiichi = false,
    ippatsu = false,
    rinshan = false,
    chankan = false,
    haitei = false,
    houtei = false,
    tenhou = false,
    chiihou = false,
    taggedDora = 0, // UI で牌に直接「ドラ」印を付けた枚数（表示牌からの算出に加算）
  } = input;

  const isDealer = seatWind === '1z'; // 東家＝親

  // 門前か。開いた副露（ポン/チー/明槓）が1つでもあれば必ず非門前。暗槓は門前を崩さない。
  // 開副露が無い場合は呼び出し側の menzen フラグを尊重する（手入力で「門前」を外せる）。
  // enumerate など menzen 未指定（undefined）の経路では既定で門前扱い。
  const hasOpenMeld = melds.some((m) => !(m.type === 'kan' && m.open === false));
  const menzen = !hasOpenMeld && input.menzen !== false;

  // 和了牌が手牌に含まれているか軽くチェック（寛容）
  const { standard, chiitoitsu, kokushi } = decompose(hand, melds);

  const candidates = [];

  const flags = {
    winType,
    seatWind,
    roundWind,
    winningTile,
    menzen,
    riichi,
    doubleRiichi,
    ippatsu,
    rinshan,
    chankan,
    haitei,
    houtei,
    tenhou,
    chiihou,
  };

  // ドラ/赤/裏の枚数（手牌全体 = hand + 副露牌）
  const fullTiles = [...hand, ...melds.flatMap((m) => m.tiles)];
  const doraCount = countDora(fullTiles, doraIndicators) + (taggedDora || 0);
  const uraCount = (riichi || doubleRiichi) ? countDora(fullTiles, uraIndicators) : 0;
  const akaCount = fullTiles.filter((t) => isRed(t)).length;
  const extraDora = doraCount + uraCount + akaCount;

  // ---- 国士無双 ----
  if (kokushi) {
    const yakuList = [{ name: '国士無双', han: 0 }];
    // 天和/地和の重複は流儀次第。ここでは国士単独の役満とする。
    let yakuman = 1;
    candidates.push(
      buildResult({
        yaku: yakuList,
        yakuman,
        fu: 0,
        dora: doraCount,
        aka: akaCount,
        ura: uraCount,
        isDealer,
        winType,
      })
    );
  }

  // ---- 七対子 ----
  if (chiitoitsu) {
    // 七対子は標準形に分解できない（または別解）ので独立評価。
    const yaku = [];
    if (doubleRiichi) yaku.push({ name: 'ダブル立直', han: 2 });
    else if (riichi) yaku.push({ name: '立直', han: 1 });
    if (ippatsu && (riichi || doubleRiichi)) yaku.push({ name: '一発', han: 1 });
    if (menzen && winType === 'tsumo') yaku.push({ name: '門前清自摸和', han: 1 });
    yaku.push(chiitoitsuYaku());
    // 七対子と複合し得る役: 断么九 / 混一色 / 清一色 / 字一色(役満) / 混老頭
    const tiles = chiitoitsu.pairs.map((t) => normalize(t));
    addChiitoitsuComboYaku(yaku, tiles, menzen);
    addSituationalYaku(yaku, flags);

    if (hasNonBonusYaku(yaku)) {
      candidates.push(
        buildResult({
          yaku,
          yakuman: 0,
          fu: 25,
          dora: doraCount,
          aka: akaCount,
          ura: uraCount,
          isDealer,
          winType,
        })
      );
    }
  }

  // ---- 標準形 ----
  for (const decomp of standard) {
    const ctx = { ...flags, decomp };
    const { yaku, yakuman, isPinfu } = detectStandardYaku(ctx);

    if (yakuman > 0) {
      candidates.push(
        buildResult({
          yaku,
          yakuman,
          fu: 0,
          dora: doraCount,
          aka: akaCount,
          ura: uraCount,
          isDealer,
          winType,
        })
      );
      continue;
    }

    // 役なし（ドラのみ）は不成立
    if (!hasNonBonusYaku(yaku)) continue;

    const { fu } = calcFu({
      decomp,
      winType,
      menzen,
      winningTile,
      seatWind,
      roundWind,
      isPinfu,
      isChiitoitsu: false,
    });

    candidates.push(
      buildResult({
        yaku,
        yakuman: 0,
        fu,
        dora: doraCount,
        aka: akaCount,
        ura: uraCount,
        isDealer,
        winType,
      })
    );
  }

  if (candidates.length === 0) {
    // 和了形だが役なし、または和了形でない
    const formExists = standard.length > 0 || chiitoitsu || kokushi;
    return {
      valid: false,
      error: formExists ? '役なし' : '和了形でない',
      han: 0,
      fu: 0,
      yaku: [],
      yakuman: 0,
      dora: doraCount,
      aka: akaCount,
      ura: uraCount,
      limit: '',
      points: { total: 0, ron: null, tsumo: null },
      display: formExists ? '役なし' : '和了形でない',
    };
  }

  // 最高得点を選ぶ（同点なら翻数→符の高い方）
  candidates.sort((a, b) => {
    if (b.points.total !== a.points.total) return b.points.total - a.points.total;
    if (b.yakuman !== a.yakuman) return b.yakuman - a.yakuman;
    if (b.han !== a.han) return b.han - a.han;
    return b.fu - a.fu;
  });

  return candidates[0];
}

// ---- ドラ計算 ----

function countDora(tiles, indicators) {
  if (!indicators || indicators.length === 0) return 0;
  const doraTiles = indicators.map((ind) => doraFromIndicator(ind));
  let n = 0;
  for (const t of tiles) {
    const nt = normalize(t);
    for (const d of doraTiles) if (nt === d) n++;
  }
  return n;
}

// ---- 七対子複合役 ----

function addChiitoitsuComboYaku(yaku, tiles, menzen) {
  // 断么九
  if (tiles.every((t) => !isYaochuLocal(t))) yaku.push({ name: '断么九', han: 1 });
  // 字一色は役満（七対子の字牌のみ）
  if (tiles.every((t) => t[1] === 'z')) {
    // 役満に格上げ — 呼び出し側では通常役扱いなので、ここでは扱わない（稀。割愛）。
  }
  // 混老頭（全て么九）
  if (tiles.every((t) => isYaochuLocal(t))) yaku.push({ name: '混老頭', han: 2 });
  // 混一色 / 清一色
  const numSuits = new Set();
  let hasHonor = false;
  for (const t of tiles) {
    if (t[1] === 'z') hasHonor = true;
    else numSuits.add(t[1]);
  }
  if (numSuits.size === 1) {
    if (hasHonor) yaku.push({ name: '混一色', han: menzen ? 3 : 2 });
    else yaku.push({ name: '清一色', han: menzen ? 6 : 5 });
  }
}
function isYaochuLocal(t) {
  if (t[1] === 'z') return true;
  const r = Number(t[0]) === 0 ? 5 : Number(t[0]);
  return r === 1 || r === 9;
}

function addSituationalYaku(yaku, flags) {
  if (flags.rinshan) yaku.push({ name: '嶺上開花', han: 1 });
  if (flags.chankan) yaku.push({ name: '槍槓', han: 1 });
  if (flags.haitei && flags.winType === 'tsumo') yaku.push({ name: '海底摸月', han: 1 });
  if (flags.houtei && flags.winType === 'ron') yaku.push({ name: '河底撈魚', han: 1 });
}

// ---- 役の有無（ドラ・赤は yaku 配列に入れないため、配列が空でなければ役あり） ----
function hasNonBonusYaku(yaku) {
  return yaku.length > 0;
}

// ---- 点数計算 ----

const LIMIT_BASE = {
  満貫: 2000,
  跳満: 3000,
  倍満: 4000,
  三倍満: 6000,
  役満: 8000,
};

function roundUp100(x) {
  return Math.ceil(x / 100) * 100;
}

/**
 * 役・符・ドラから Result を構築。
 */
function buildResult({ yaku, yakuman, fu, dora, aka, ura, isDealer, winType }) {
  const yakuHan = yaku.reduce((s, y) => s + (y.han || 0), 0);
  const bonusHan = dora + aka + ura;
  const han = yakuHan + bonusHan;

  let base;
  let limit = '';

  if (yakuman > 0) {
    base = 8000 * yakuman;
    limit = yakuman === 1 ? '役満' : `役満`; // 表示は倍数を別途
  } else {
    // 基本点 = 符 × 2^(2+翻)
    base = fu * Math.pow(2, 2 + han);
    if (han >= 13) {
      base = 8000;
      limit = '数え役満';
    } else if (han >= 11) {
      base = 6000;
      limit = '三倍満';
    } else if (han >= 8) {
      base = 4000;
      limit = '倍満';
    } else if (han >= 6) {
      base = 3000;
      limit = '跳満';
    } else if (han >= 5 || base >= 2000) {
      // 満貫: 5翻、または 基本点が2000以上に達した場合（頭打ち）
      base = 2000;
      limit = '満貫';
    }
  }

  const points = computePoints(base, isDealer, winType);

  // display 文字列
  const display = makeDisplay({ han, fu, yakuman, limit, isDealer, winType, points });

  return {
    valid: true,
    error: null,
    han: yakuman > 0 ? yakuman * 13 : han, // 役満は便宜上 13×倍数を han に入れる
    fu: yakuman > 0 ? 0 : fu,
    yaku,
    yakuman,
    dora,
    aka,
    ura,
    limit: yakuman > 0 ? '役満' : limit,
    points,
    display,
  };
}

/**
 * 基本点から各支払額を計算。
 * 親ロン = base×6, 子ロン = base×4。
 * 親ツモ = base×2 各家(×3)、子ツモ = 親 base×2 / 子 base×1。
 * すべて100点切り上げ。
 */
function computePoints(base, isDealer, winType) {
  if (winType === 'ron') {
    const pay = isDealer ? roundUp100(base * 6) : roundUp100(base * 4);
    return { total: pay, ron: pay, tsumo: null };
  }
  // tsumo
  if (isDealer) {
    const each = roundUp100(base * 2);
    return {
      total: each * 3,
      ron: null,
      tsumo: { dealer: each, nonDealer: each },
    };
  }
  const dealerPay = roundUp100(base * 2);
  const nonDealerPay = roundUp100(base * 1);
  return {
    total: dealerPay + nonDealerPay * 2,
    ron: null,
    tsumo: { dealer: dealerPay, nonDealer: nonDealerPay },
  };
}

function makeDisplay({ han, fu, yakuman, limit, isDealer, winType, points }) {
  let head = '';
  if (yakuman > 0) {
    const names = ['', '役満', 'ダブル役満', 'トリプル役満', '四倍役満', '五倍役満', '六倍役満'];
    head = names[yakuman] || `${yakuman}倍役満`;
  } else if (limit) {
    head = `${han}翻 ${limit}`;
  } else {
    head = `${han}翻${fu}符`;
  }

  let pts;
  if (winType === 'ron') {
    pts = `${points.ron}`;
  } else if (isDealer) {
    pts = `${points.tsumo.dealer}オール (${points.total})`;
  } else {
    pts = `${points.tsumo.nonDealer}/${points.tsumo.dealer} (${points.total})`;
  }
  return `${head} ${pts}`;
}
