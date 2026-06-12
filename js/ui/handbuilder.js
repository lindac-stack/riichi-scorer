// handbuilder.js — 手入力タブ。牌パレット + 文脈コントロール + 計算ボタン。
// API キー不要・完全オフラインで動作する。
//
// 手牌と副露(furo)は分けない。牌をすべて1か所に並べ、色（ブラシ）を牌へドラッグ＆
// ドロップ（またはタップで色を選んで牌をタップ）して役割を付ける:
//   和了牌(win) / 鳴き(called=furo) / ドラ(dora)
// 副露の種別はタグ済みの牌から自動判定する（同3=ポン / 連3=チー / 同4=明カン）。
// 「鳴き」を付けていない同一4枚は暗カンとして自動的に扱う（枚数から判断）。

import {
  displayName, parseTileInput, isRed, suitOf, rankOf, normalize, WINDS,
} from '../tiles.js';

const WIND_OPTS = [
  ['1z', '東'], ['2z', '南'], ['3z', '西'], ['4z', '北'],
];
const ROUND_OPTS = [
  ['1z', '東'], ['2z', '南'],
];

// 牌に付けられる色（ブラシ）。win は単一、called/dora は複数可。
const BRUSHES = [
  { key: 'win', label: '和了牌', cls: 'b-win' },
  { key: 'called', label: '鳴き', cls: 'b-called' },
  { key: 'dora', label: 'ドラ', cls: 'b-dora' },
  { key: 'clear', label: '印を消す', cls: 'b-clear' },
  { key: 'del', label: '牌を削除', cls: 'b-del' },
];

/**
 * 手入力ビルダーを生成する。
 * @param {HTMLElement} root  描画先コンテナ
 * @param {(payload)=>void} onCalc  「計算」押下時コールバック。scoreHand 入力 + winningTile を受け取る。
 */
export function createHandBuilder(root, onCalc) {
  const state = {
    hand: [],            // [{ t:'1m', called:false, dora:false, win:false }]（全牌を1か所で管理）
    akaMode: false,      // 赤五で追加するか
    seatWind: '2z',      // 既定は子なので自風は南（自風東＝親と矛盾しないように）
    roundWind: '1z',
    isDealer: false,     // 親=true / 子=false（自風＝東 と連動）
    winType: 'tsumo',
    flags: { riichi: false, doubleRiichi: false, ippatsu: false, menzen: true,
             rinshan: false, chankan: false, haitei: false, houtei: false,
             tenhou: false, chiihou: false },
    doraIndicators: [],
    uraIndicators: [],
  };

  let armedBrush = 'win'; // タップ時に塗られる色（既定は和了牌）

  root.innerHTML = `
    <h2 class="section-title">手牌</h2>
    <div id="hbHandChips" class="hand-chips" aria-live="polite"></div>
    <div id="hbBrushes" class="brush-bar" role="toolbar" aria-label="牌に付ける印"></div>
    <p class="field-note">
      下の色を牌に<b>ドラッグ＆ドロップ</b>（またはタップで色を選んでから牌をタップ）して印を付けます。
      <b class="lg-win">和了牌</b>＝あがり牌 /
      <b class="lg-called">鳴き</b>＝副露(furo) /
      <b class="lg-dora">ドラ</b>＝ドラ牌。
      <br>鳴きの同じ4枚＝<b>明カン</b>、印なしの同じ4枚＝<b>暗カン</b>として自動判定します（枚数から判断）。
    </p>

    <div class="quick-add-row">
      <input id="hbQuick" class="quick-input" type="text" inputmode="latin"
             placeholder="一括入力: 例 123m456p789s11z2z" />
      <button id="hbQuickBtn" class="secondary-btn small" type="button">解析追加</button>
    </div>
    <div class="quick-add-row">
      <button id="hbClear" class="secondary-btn small" type="button">手牌をクリア</button>
    </div>

    <h2 class="section-title">牌を選ぶ</h2>
    <div id="hbPalette" class="palette"></div>

    <h2 class="section-title">文脈</h2>
    <div class="ctx-grid">
      <div class="ctx-field">
        <span class="ctx-name">親 / 子</span>
        <div class="seg" id="hbDealer">
          <button class="seg-btn" data-v="0" type="button">子</button>
          <button class="seg-btn" data-v="1" type="button">親</button>
        </div>
      </div>
      <div class="ctx-field">
        <span class="ctx-name">和了の種類</span>
        <div class="seg" id="hbWinType">
          <button class="seg-btn" data-v="tsumo" type="button">自摸</button>
          <button class="seg-btn" data-v="ron" type="button">栄和</button>
        </div>
      </div>
      <div class="ctx-field">
        <span class="ctx-name">場風</span>
        <div class="seg" id="hbRound"></div>
      </div>
      <div class="ctx-field">
        <span class="ctx-name">自風</span>
        <div class="seg" id="hbSeat"></div>
      </div>
    </div>

    <div class="ctx-field" style="margin-top:12px">
      <span class="ctx-name">フラグ</span>
      <div class="flags-row" id="hbFlags"></div>
    </div>

    <div class="ctx-field" style="margin-top:12px">
      <span class="ctx-name">ドラ表示牌（任意 / 「ドラ」色で牌に直接印を付けてもOK）</span>
      <div class="dora-row">
        <input id="hbDoraInput" class="quick-input" type="text" inputmode="latin"
               placeholder="例 1m 5z" style="flex:1" />
        <button id="hbDoraBtn" class="secondary-btn small" type="button">設定</button>
      </div>
      <div id="hbDoraChips" class="dora-chips" style="margin-top:8px"></div>
    </div>

    <div class="ctx-field" style="margin-top:12px">
      <span class="ctx-name">裏ドラ表示牌（立直時）</span>
      <div class="dora-row">
        <input id="hbUraInput" class="quick-input" type="text" inputmode="latin"
               placeholder="例 9p" style="flex:1" />
        <button id="hbUraBtn" class="secondary-btn small" type="button">設定</button>
      </div>
      <div id="hbUraChips" class="dora-chips" style="margin-top:8px"></div>
    </div>

    <button id="hbCalc" class="primary-btn wide" type="button">計算</button>
  `;

  const $ = (sel) => root.querySelector(sel);
  const handChips = $('#hbHandChips');
  const paletteEl = $('#hbPalette');
  const flagsEl = $('#hbFlags');

  // ===== 牌の並び順 =====
  const SUIT_ORDER = { m: 0, p: 1, s: 2, z: 3 };
  function tileSortKey(t) {
    const n = normalize(t);
    return (SUIT_ORDER[suitOf(n)] ?? 9) * 100 + rankOf(n) + (isRed(t) ? 0.5 : 0); // 赤5は通常5の直後
  }
  function sortHand() {
    state.hand.sort((a, b) => tileSortKey(a.t) - tileSortKey(b.t));
  }

  // ===== パレット =====
  function buildPalette() {
    const groups = [
      ['萬子', ['1m','2m','3m','4m','5m','6m','7m','8m','9m']],
      ['筒子', ['1p','2p','3p','4p','5p','6p','7p','8p','9p']],
      ['索子', ['1s','2s','3s','4s','5s','6s','7s','8s','9s']],
      ['字牌', ['1z','2z','3z','4z','5z','6z','7z']],
    ];
    let html = '';
    for (const [label, tiles] of groups) {
      html += `<div class="palette-row"><span class="palette-label">${label}</span>`;
      for (const t of tiles) {
        html += `<button class="tile-chip" type="button" data-tile="${t}">${displayName(t)}</button>`;
      }
      html += `</div>`;
    }
    html += `<div class="palette-row">
      <button id="hbAka" class="aka-toggle" type="button">赤五で追加: <b>オフ</b></button>
    </div>`;
    paletteEl.innerHTML = html;

    paletteEl.querySelectorAll('.tile-chip[data-tile]').forEach((b) => {
      b.addEventListener('click', () => {
        let t = b.dataset.tile;
        if (state.akaMode && (t === '5m' || t === '5p' || t === '5s')) t = '0' + suitOf(t);
        addTile(t);
      });
    });
    $('#hbAka').addEventListener('click', () => {
      state.akaMode = !state.akaMode;
      $('#hbAka').classList.toggle('is-on', state.akaMode);
      $('#hbAka').innerHTML = `赤五で追加: <b>${state.akaMode ? 'オン' : 'オフ'}</b>`;
    });
  }

  // ===== 風セグメント / フラグ =====
  function buildWindSeg(el, opts, getter, setter) {
    el.innerHTML = opts.map(([v, label]) =>
      `<button class="seg-btn" data-v="${v}" type="button">${label}</button>`).join('');
    el.querySelectorAll('.seg-btn').forEach((b) => {
      b.addEventListener('click', () => { setter(b.dataset.v); syncSeg(el, getter); });
    });
    syncSeg(el, getter);
  }
  function syncSeg(el, getter) {
    const cur = String(getter());
    el.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', b.dataset.v === cur));
  }

  const FLAG_DEFS = [
    ['riichi', '立直'], ['doubleRiichi', 'ダブル立直'], ['ippatsu', '一発'],
    ['menzen', '門前'], ['rinshan', '嶺上開花'], ['chankan', '槍槓'],
    ['haitei', '海底摸月'], ['houtei', '河底撈魚'], ['tenhou', '天和'], ['chiihou', '地和'],
  ];
  function buildFlags() {
    flagsEl.innerHTML = FLAG_DEFS.map(([k, label]) =>
      `<button class="flag-chip" type="button" data-flag="${k}">${label}</button>`).join('');
    flagsEl.querySelectorAll('.flag-chip').forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.flag;
        state.flags[k] = !state.flags[k];
        b.classList.toggle('is-on', state.flags[k]);
      });
    });
    syncFlags();
  }
  function syncFlags() {
    flagsEl.querySelectorAll('.flag-chip').forEach((b) =>
      b.classList.toggle('is-on', !!state.flags[b.dataset.flag]));
  }
  // 鳴き印が1つでもあれば門前ではない（暗カンは「鳴き」を付けないので門前を維持）。
  function recomputeMenzen() {
    state.flags.menzen = !state.hand.some((h) => h.called);
    syncFlags();
  }

  // ===== 手牌 =====
  function addTile(t) {
    if (state.hand.length >= 18) return; // 14 + 槓を考慮した上限
    state.hand.push({ t, called: false, dora: false, win: false });
    sortHand();
    renderHand();
  }
  function renderHand() {
    handChips.innerHTML = '';
    if (!state.hand.length) {
      handChips.innerHTML = '<span class="field-note" style="margin:0">下のパレットか一括入力で牌を追加してください。</span>';
      return;
    }
    state.hand.forEach((h, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tile-chip';
      chip.dataset.idx = String(i);
      if (isRed(h.t)) chip.classList.add('is-red');
      if (h.win) chip.classList.add('is-win');
      if (h.called) chip.classList.add('is-called');
      if (h.dora) chip.classList.add('is-dora');
      chip.textContent = displayName(h.t);
      chip.title = '色を選んでタップ／色をドラッグして印を付けます';
      chip.addEventListener('click', () => { if (armedBrush) applyBrush(i, armedBrush); });
      handChips.appendChild(chip);
    });
  }
  function applyBrush(i, brush) {
    const h = state.hand[i];
    if (!h) return;
    if (brush === 'win') { const was = h.win; state.hand.forEach((x) => (x.win = false)); h.win = !was; }
    else if (brush === 'called') h.called = !h.called;
    else if (brush === 'dora') h.dora = !h.dora;
    else if (brush === 'clear') { h.win = h.called = h.dora = false; }
    else if (brush === 'del') state.hand.splice(i, 1);
    recomputeMenzen();
    renderHand();
  }

  // ===== ブラシ（ドラッグ＆ドロップ / タップ塗り）=====
  function buildBrushes() {
    const bar = $('#hbBrushes');
    bar.innerHTML = BRUSHES.map((b) =>
      `<button type="button" class="brush ${b.cls}" data-brush="${b.key}" title="ドラッグして牌へ／タップで選択">${b.label}</button>`).join('');
    bar.querySelectorAll('.brush').forEach((el) => {
      el.addEventListener('pointerdown', (e) => startBrushPointer(e, el.dataset.brush));
    });
    syncBrushes();
  }
  function syncBrushes() {
    $('#hbBrushes').querySelectorAll('.brush').forEach((el) =>
      el.classList.toggle('is-armed', el.dataset.brush === armedBrush));
  }
  function chipUnder(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('#hbHandChips .tile-chip') : null;
  }
  function clearDropHighlight() {
    handChips.querySelectorAll('.drop-target').forEach((c) => c.classList.remove('drop-target'));
  }
  // マウス/タッチ共通のドラッグ。閾値未満の動きは「タップ＝ブラシ選択」とみなす。
  function startBrushPointer(e, brush) {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    let moved = false;
    let ghost = null;
    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
        moved = true;
        ghost = document.createElement('div');
        ghost.className = 'brush-ghost ' + (BRUSHES.find((b) => b.key === brush)?.cls || '');
        ghost.textContent = BRUSHES.find((b) => b.key === brush)?.label || '';
        document.body.appendChild(ghost);
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
        clearDropHighlight();
        const c = chipUnder(ev.clientX, ev.clientY);
        if (c) c.classList.add('drop-target');
      }
    };
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (moved) {
        const c = chipUnder(ev.clientX, ev.clientY);
        if (c) applyBrush(Number(c.dataset.idx), brush);
        if (ghost) ghost.remove();
        clearDropHighlight();
      } else {
        // タップ → ブラシ選択（同じブラシ再タップで解除）
        armedBrush = armedBrush === brush ? null : brush;
        syncBrushes();
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // ===== ドラ表示牌（任意の補助入力）=====
  function renderDoraChips(tiles, chipsEl) {
    chipsEl.innerHTML = tiles.map((t) =>
      `<span class="tile-chip${isRed(t) ? ' is-red' : ''}">${displayName(t)}</span>`).join('');
  }
  function setDoraFromText(text, key, chipsEl) {
    const tiles = parseTileInput(text);
    state[key] = tiles;
    renderDoraChips(tiles, chipsEl);
  }

  // ===== タグ → 採点入力（手牌/副露/和了牌/ドラ）への変換 =====
  // 34種インデックス（赤5は通常5に正規化）。
  function tIndex(t) {
    const n = normalize(t), s = suitOf(n), r = rankOf(n);
    if (s === 'm') return r - 1;
    if (s === 'p') return 9 + r - 1;
    if (s === 's') return 18 + r - 1;
    return 27 + r - 1;
  }
  function tFromIndex(i) {
    if (i < 9) return `${i + 1}m`;
    if (i < 18) return `${i - 9 + 1}p`;
    if (i < 27) return `${i - 18 + 1}s`;
    return `${i - 27 + 1}z`;
  }
  function canChi(i, counts) {
    if (i >= 27) return false;
    if (i % 9 > 6) return false; // 8,9 始まり不可
    return counts[i] > 0 && counts[i + 1] > 0 && counts[i + 2] > 0;
  }
  // 鳴き牌（called）を完全な面子（ポン/チー/カン）へ分解。できなければ null。
  function recurseMelds(counts, start, out) {
    let i = start;
    while (i < 34 && counts[i] === 0) i++;
    if (i === 34) return true;
    if (counts[i] >= 4) { // 明カン
      counts[i] -= 4; out.push({ type: 'kan', idxs: [i, i, i, i] });
      if (recurseMelds(counts, i, out)) return true;
      out.pop(); counts[i] += 4;
    }
    if (counts[i] >= 3) { // ポン
      counts[i] -= 3; out.push({ type: 'pon', idxs: [i, i, i] });
      if (recurseMelds(counts, i, out)) return true;
      out.pop(); counts[i] += 3;
    }
    if (canChi(i, counts)) { // チー
      counts[i]--; counts[i + 1]--; counts[i + 2]--;
      out.push({ type: 'chi', idxs: [i, i + 1, i + 2] });
      if (recurseMelds(counts, i, out)) return true;
      out.pop(); counts[i]++; counts[i + 1]++; counts[i + 2]++;
    }
    return false;
  }
  // called 牌（実牌, 赤保持）を open 面子配列へ。判別不能は null。
  function groupCalledIntoMelds(calledTiles) {
    if (!calledTiles.length) return [];
    const buckets = {};
    for (const t of calledTiles) { const n = normalize(t); (buckets[n] = buckets[n] || []).push(t); }
    const counts = new Array(34).fill(0);
    for (const n in buckets) counts[tIndex(n)] = buckets[n].length;
    const melds = [];
    if (!recurseMelds(counts, 0, melds)) return null;
    // idx 列を実牌へ戻す（赤5を保持するため bucket から取り出す）
    return melds.map((m) => ({
      type: m.type, open: true,
      tiles: m.idxs.map((i) => {
        const n = tFromIndex(i);
        return (buckets[n] && buckets[n].length) ? buckets[n].shift() : n;
      }),
    }));
  }
  // 門前の同一4枚を暗カンとして取り出す。枚数の超過分(=カン数)だけ取り出す。
  function extractAnkans(concealedTiles, numAnkan) {
    const buckets = {}; const order = [];
    for (const t of concealedTiles) {
      const n = normalize(t);
      if (!(n in buckets)) { buckets[n] = []; order.push(n); }
      buckets[n].push(t);
    }
    const ankans = [];
    let need = numAnkan;
    for (const n of order) {
      if (need > 0 && buckets[n].length === 4) { ankans.push({ type: 'kan', tiles: buckets[n].slice(), open: false }); buckets[n] = []; need--; }
    }
    const handTiles = [];
    for (const n of order) handTiles.push(...buckets[n]);
    return { handTiles, ankans };
  }
  /**
   * タグ済みの手牌から scoreHand 用の { hand, melds, winningTile, taggedDora } を作る。
   * - called 牌 → open 面子（ポン/チー/明カン）
   * - 残り(門前)の超過枚数 → 暗カンとして取り出す（枚数=カン数）
   * - win 牌 → winningTile / dora 牌の数 → taggedDora
   */
  function getScoringInput() {
    const called = state.hand.filter((h) => h.called).map((h) => h.t);
    const concealed = state.hand.filter((h) => !h.called).map((h) => h.t);
    const winningTile = (state.hand.find((h) => h.win) || {}).t || null;
    const taggedDora = state.hand.filter((h) => h.dora).length;

    // called が完全な面子を成さない（途中の指定など）場合は、捨てずに門前側へ戻す。
    const grouped = groupCalledIntoMelds(called);
    const calledMelds = grouped || [];
    const concealedAll = grouped ? concealed : [...concealed, ...called];
    const concealedMeldsNeeded = 4 - calledMelds.length;
    const numAnkan = Math.max(0, concealedAll.length - (3 * concealedMeldsNeeded + 2));
    const { handTiles, ankans } = extractAnkans(concealedAll, numAnkan);

    return { hand: handTiles, melds: [...calledMelds, ...ankans], winningTile, taggedDora };
  }

  // ===== ワイヤリング =====
  buildPalette();
  buildBrushes();
  buildFlags();
  buildWindSeg($('#hbRound'), ROUND_OPTS, () => state.roundWind, (v) => (state.roundWind = v));
  buildWindSeg($('#hbSeat'), WIND_OPTS, () => state.seatWind, (v) => {
    state.seatWind = v;
    state.isDealer = v === '1z';
    syncSeg($('#hbDealer'), () => (state.isDealer ? '1' : '0'));
  });

  $('#hbDealer').querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      state.isDealer = b.dataset.v === '1';
      if (state.isDealer) state.seatWind = '1z';
      else if (state.seatWind === '1z') state.seatWind = '2z';
      syncSeg($('#hbDealer'), () => (state.isDealer ? '1' : '0'));
      syncSeg($('#hbSeat'), () => state.seatWind);
    });
  });
  $('#hbDealer').querySelector('[data-v="0"]').classList.add('is-on');

  $('#hbWinType').querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      state.winType = b.dataset.v;
      $('#hbWinType').querySelectorAll('.seg-btn').forEach((x) =>
        x.classList.toggle('is-on', x.dataset.v === state.winType));
    });
  });
  $('#hbWinType').querySelector('[data-v="tsumo"]').classList.add('is-on');

  $('#hbQuickBtn').addEventListener('click', () => {
    for (const t of parseTileInput($('#hbQuick').value)) {
      if (state.hand.length >= 18) break;
      state.hand.push({ t, called: false, dora: false, win: false });
    }
    sortHand();
    $('#hbQuick').value = '';
    renderHand();
  });
  $('#hbQuick').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#hbQuickBtn').click(); }
  });

  $('#hbClear').addEventListener('click', () => {
    state.hand = [];
    recomputeMenzen();
    renderHand();
  });

  $('#hbDoraBtn').addEventListener('click', () =>
    setDoraFromText($('#hbDoraInput').value, 'doraIndicators', $('#hbDoraChips')));
  $('#hbUraBtn').addEventListener('click', () =>
    setDoraFromText($('#hbUraInput').value, 'uraIndicators', $('#hbUraChips')));

  $('#hbCalc').addEventListener('click', () => {
    const si = getScoringInput();
    const payload = {
      hand: si.hand,
      winningTile: si.winningTile,
      melds: si.melds,
      taggedDora: si.taggedDora,
      winType: state.winType,
      seatWind: state.seatWind,
      roundWind: state.roundWind,
      isDealer: state.isDealer,
      doraIndicators: [...state.doraIndicators],
      uraIndicators: [...state.uraIndicators],
      ...state.flags,
    };
    onCalc(payload, { state });
  });

  renderHand();

  // ===== 外部（写真認識など）からの流し込み =====
  function pushTiles(tiles, { called = false } = {}) {
    for (const t of tiles) {
      if (state.hand.length >= 18) break;
      state.hand.push({ t, called, dora: false, win: false });
    }
  }
  function loadTiles(tiles) {
    state.hand = [];
    pushTiles(Array.isArray(tiles) ? tiles : []);
    sortHand();
    recomputeMenzen();
    renderHand();
  }
  /** 副露をセット（写真認識から）: 副露牌は「鳴き」印付きで手牌に取り込む（暗カンは検出不可なので明扱い）。 */
  function setMelds(melds) {
    if (!Array.isArray(melds)) return;
    for (const m of melds) {
      if (m && Array.isArray(m.tiles)) pushTiles(m.tiles, { called: true });
    }
    sortHand();
    recomputeMenzen();
    renderHand();
  }
  function setDora(tiles) {
    state.doraIndicators = Array.isArray(tiles) ? [...tiles] : [];
    renderDoraChips(state.doraIndicators, $('#hbDoraChips'));
  }
  /** 写真の領域認識結果をまとめて反映。append=false で手牌を置き換える。 */
  function applyRecognition({ hand, melds, dora } = {}, { append = false } = {}) {
    if (!append && (Array.isArray(hand) || Array.isArray(melds))) state.hand = [];
    if (Array.isArray(hand)) pushTiles(hand, { called: false });
    if (Array.isArray(melds)) for (const m of melds) if (m && Array.isArray(m.tiles)) pushTiles(m.tiles, { called: true });
    if (Array.isArray(hand) || Array.isArray(melds)) { sortHand(); recomputeMenzen(); renderHand(); }
    if (Array.isArray(dora)) setDora(append ? [...state.doraIndicators, ...dora] : dora);
  }

  return { state, getScoringInput, loadTiles, setMelds, setDora, applyRecognition };
}
