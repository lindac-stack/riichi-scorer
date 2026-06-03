// handbuilder.js — 手入力タブ。牌パレット + 文脈コントロール + 計算ボタン。
// API キー不要・完全オフラインで動作する。

import {
  displayName, sortTiles, parseTileInput, allTileTypes,
  isRed, suitOf, normalize, WINDS,
} from '../tiles.js';

const WIND_OPTS = [
  ['1z', '東'], ['2z', '南'], ['3z', '西'], ['4z', '北'],
];
const ROUND_OPTS = [
  ['1z', '東'], ['2z', '南'],
];

/**
 * 手入力ビルダーを生成する。
 * @param {HTMLElement} root  描画先コンテナ
 * @param {(payload)=>void} onCalc  「計算」押下時コールバック。scoreHand 入力 + winningTile を受け取る。
 */
export function createHandBuilder(root, onCalc) {
  const state = {
    hand: [],            // string[] 手牌（和了牌含む）
    winningTile: null,   // string  和了牌（hand の1要素を指す。インデックスで管理）
    winIndex: -1,
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

  root.innerHTML = `
    <h2 class="section-title">手牌</h2>
    <div id="hbHandChips" class="hand-chips" aria-live="polite"></div>
    <p class="field-note">チップをタップで和了牌に指定、もう一度で削除します。</p>

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
      <span class="ctx-name">ドラ表示牌</span>
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

  // ----- パレット構築 -----
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
        // 赤五モードかつ 5m/5p/5s なら赤に
        if (state.akaMode && (t === '5m' || t === '5p' || t === '5s')) {
          t = '0' + suitOf(t);
        }
        addTile(t);
      });
    });
    $('#hbAka').addEventListener('click', () => {
      state.akaMode = !state.akaMode;
      $('#hbAka').classList.toggle('is-on', state.akaMode);
      $('#hbAka').innerHTML = `赤五で追加: <b>${state.akaMode ? 'オン' : 'オフ'}</b>`;
    });
  }

  // ----- 風セグメント -----
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
    el.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.v === cur);
    });
  }

  // ----- フラグ -----
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
    flagsEl.querySelectorAll('.flag-chip').forEach((b) => {
      b.classList.toggle('is-on', !!state.flags[b.dataset.flag]);
    });
  }

  // ----- 手牌操作 -----
  function addTile(t) {
    if (state.hand.length >= 18) return; // 余裕を持った上限（14 + 槓考慮）
    state.hand.push(t);
    state.hand = sortTiles(state.hand);
    // winIndex は牌内容で再解決するため、winningTile 値を保持
    renderHand();
  }
  function renderHand() {
    handChips.innerHTML = '';
    state.hand.forEach((t, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tile-chip';
      if (isRed(t)) chip.classList.add('is-red');
      if (i === state.winIndex) chip.classList.add('is-win');
      chip.textContent = displayName(t);
      chip.title = '1回目: 和了牌に指定 / 2回目: 削除';
      chip.addEventListener('click', () => {
        if (state.winIndex === i) {
          // 既に和了牌 → 削除
          state.hand.splice(i, 1);
          state.winIndex = -1;
          renderHand();
        } else {
          state.winIndex = i;
          renderHand();
        }
      });
      handChips.appendChild(chip);
    });
  }

  function setDoraFromText(text, key, chipsEl) {
    const tiles = parseTileInput(text);
    state[key] = tiles;
    chipsEl.innerHTML = tiles.map((t) => {
      const cls = isRed(t) ? 'tile-chip is-red' : 'tile-chip';
      return `<span class="${cls}">${displayName(t)}</span>`;
    }).join('');
  }

  // ----- ワイヤリング -----
  buildPalette();
  buildFlags();
  buildWindSeg($('#hbRound'), ROUND_OPTS, () => state.roundWind, (v) => state.roundWind = v);
  // 自風セグ：自風＝東 を選べば親、それ以外は子（親/子セグと連動）
  buildWindSeg($('#hbSeat'), WIND_OPTS, () => state.seatWind, (v) => {
    state.seatWind = v;
    state.isDealer = v === '1z';
    syncSeg($('#hbDealer'), () => (state.isDealer ? '1' : '0'));
  });

  // 親/子セグ：親なら自風＝東、子なら自風が東のとき南へ（矛盾状態を作らない）
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

  // 自摸/栄和セグ
  $('#hbWinType').querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      state.winType = b.dataset.v;
      $('#hbWinType').querySelectorAll('.seg-btn').forEach((x) =>
        x.classList.toggle('is-on', x.dataset.v === state.winType));
    });
  });
  $('#hbWinType').querySelector('[data-v="tsumo"]').classList.add('is-on');

  $('#hbQuickBtn').addEventListener('click', () => {
    const tiles = parseTileInput($('#hbQuick').value);
    for (const t of tiles) {
      if (state.hand.length >= 18) break;
      state.hand.push(t);
    }
    state.hand = sortTiles(state.hand);
    $('#hbQuick').value = '';
    renderHand();
  });
  $('#hbQuick').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#hbQuickBtn').click(); }
  });

  $('#hbClear').addEventListener('click', () => {
    state.hand = [];
    state.winIndex = -1;
    renderHand();
  });

  $('#hbDoraBtn').addEventListener('click', () =>
    setDoraFromText($('#hbDoraInput').value, 'doraIndicators', $('#hbDoraChips')));
  $('#hbUraBtn').addEventListener('click', () =>
    setDoraFromText($('#hbUraInput').value, 'uraIndicators', $('#hbUraChips')));

  $('#hbCalc').addEventListener('click', () => {
    const winningTile = state.winIndex >= 0 ? state.hand[state.winIndex] : null;
    const payload = {
      hand: [...state.hand],
      winningTile,
      melds: [],
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

  // 外部（写真認識など）から認識牌を流し込む
  function loadTiles(tiles) {
    state.hand = sortTiles(Array.isArray(tiles) ? [...tiles] : []);
    state.winIndex = -1;
    renderHand();
  }

  return { state, loadTiles };
}
