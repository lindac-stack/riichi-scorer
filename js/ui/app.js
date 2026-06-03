// app.js — コントローラ。タブ切替・設定モーダル・手入力/写真フローの結線。
//
// 設計方針: 採点エンジン(score.js / enumerate.js)と画像認識(vision/*)は
// 動的 import で読み込み、失敗しても手入力タブが壊れないよう防御的に扱う。

import { createHandBuilder } from './handbuilder.js';
import { renderScoreResult, renderOutcomesTable } from './result.js';
import {
  displayName, sortTiles, parseTileInput, isRed, suitOf,
} from '../tiles.js';

const LS_PROVIDER = 'riichi_vision_provider';
const LS_KEY = 'riichi_vision_key';

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// 動的 import（モジュール未配置でも UI を起動させる）
// ---------------------------------------------------------------------------
async function loadScoreHand() {
  const mod = await import('../engine/score.js');
  if (typeof mod.scoreHand !== 'function') throw new Error('scoreHand 未実装');
  return mod.scoreHand;
}
async function loadEnumerate() {
  const mod = await import('../engine/enumerate.js');
  if (typeof mod.enumerateOutcomes !== 'function') throw new Error('enumerateOutcomes 未実装');
  return mod.enumerateOutcomes;
}
async function loadVision() {
  const mod = await import('../vision/recognize.js');
  if (typeof mod.recognizeTiles !== 'function') throw new Error('recognizeTiles 未実装');
  return mod.recognizeTiles;
}
async function loadCapture() {
  try {
    return await import('../vision/capture.js');
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// タブ切替
// ---------------------------------------------------------------------------
function setupTabs() {
  const tabPhoto = $('#tabPhoto');
  const tabManual = $('#tabManual');
  const panelPhoto = $('#panelPhoto');
  const panelManual = $('#panelManual');

  function select(which) {
    const photo = which === 'photo';
    tabPhoto.classList.toggle('is-active', photo);
    tabManual.classList.toggle('is-active', !photo);
    tabPhoto.setAttribute('aria-selected', String(photo));
    tabManual.setAttribute('aria-selected', String(!photo));
    panelPhoto.hidden = !photo;
    panelManual.hidden = photo;
  }
  tabPhoto.addEventListener('click', () => select('photo'));
  tabManual.addEventListener('click', () => select('manual'));
  select('manual');
}

// ---------------------------------------------------------------------------
// 設定モーダル
// ---------------------------------------------------------------------------
function setupSettings() {
  const modal = $('#settingsModal');
  const providerSel = $('#providerSelect');
  const keyInput = $('#apiKeyInput');

  function open() {
    providerSel.value = localStorage.getItem(LS_PROVIDER) || 'gemini';
    keyInput.value = localStorage.getItem(LS_KEY) || '';
    modal.hidden = false;
  }
  function close() { modal.hidden = true; }

  $('#settingsBtn').addEventListener('click', open);
  $('#settingsSave').addEventListener('click', () => {
    localStorage.setItem(LS_PROVIDER, providerSel.value);
    localStorage.setItem(LS_KEY, keyInput.value.trim());
    close();
  });
  modal.querySelectorAll('[data-close]').forEach((el) =>
    el.addEventListener('click', close));
}

function getVisionConfig() {
  return {
    provider: localStorage.getItem(LS_PROVIDER) || 'gemini',
    key: localStorage.getItem(LS_KEY) || '',
  };
}

// ---------------------------------------------------------------------------
// 手入力タブ
// ---------------------------------------------------------------------------
function setupManual() {
  const resultArea = $('#manualResult');
  createHandBuilder($('#handbuilder'), async (payload) => {
    resultArea.innerHTML = '<div class="status">計算中…</div>';

    if (!payload.winningTile) {
      resultArea.innerHTML =
        '<div class="result-error">和了牌を指定してください（手牌のチップを1回タップ）。</div>';
      return;
    }

    let scoreHand;
    try {
      scoreHand = await loadScoreHand();
    } catch (e) {
      resultArea.innerHTML =
        `<div class="result-error">採点エンジンを読み込めませんでした（${escapeText(e.message)}）。</div>`;
      return;
    }

    try {
      const result = scoreHand(payload);
      renderScoreResult(resultArea, result);
    } catch (e) {
      resultArea.innerHTML =
        `<div class="result-error">計算でエラーが発生しました: ${escapeText(e.message)}</div>`;
    }
  });
}

// ---------------------------------------------------------------------------
// 写真タブ
// ---------------------------------------------------------------------------
function setupPhoto() {
  const statusEl = $('#photoStatus');
  const previewWrap = $('#photoPreview');
  const previewImg = $('#photoImg');
  const handSection = $('#photoHandSection');
  const chipsEl = $('#photoHandChips');
  const resultArea = $('#photoResult');

  // 認識牌（編集可能）の状態
  const photoState = { tiles: [] };

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function renderChips() {
    chipsEl.innerHTML = '';
    photoState.tiles = sortTiles(photoState.tiles);
    photoState.tiles.forEach((t, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tile-chip' + (isRed(t) ? ' is-red' : '');
      chip.innerHTML = `${escapeText(displayName(t))}<span class="chip-x">✕</span>`;
      chip.title = 'タップで削除';
      chip.addEventListener('click', () => {
        photoState.tiles.splice(i, 1);
        renderChips();
      });
      chipsEl.appendChild(chip);
    });
  }

  function showHandSection(tiles) {
    photoState.tiles = sortTiles(tiles || []);
    handSection.hidden = false;
    renderChips();
    resultArea.innerHTML = '';
  }

  function showPreview(blobOrUrl) {
    try {
      const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
      previewImg.src = url;
      previewWrap.hidden = false;
    } catch { /* プレビューは任意 */ }
  }

  // 画像取得 → 認識
  async function handleImage(blob) {
    showPreview(blob);
    setStatus('画像を認識しています…');

    let recognizeTiles;
    try {
      recognizeTiles = await loadVision();
    } catch (e) {
      fallbackToManualEntry('画像認識モジュールが利用できません。');
      return;
    }

    const cfg = getVisionConfig();
    if (!cfg.key) {
      fallbackToManualEntry('APIキーが未設定です。');
      return;
    }

    try {
      const res = await recognizeTiles(blob, cfg);
      const tiles = Array.isArray(res) ? res : (res && res.tiles) || [];
      if (!tiles.length) {
        fallbackToManualEntry('牌を認識できませんでした。');
        return;
      }
      setStatus('認識しました。誤りがあればチップをタップして修正してください。');
      showHandSection(tiles);
    } catch (e) {
      fallbackToManualEntry(`認識に失敗しました（${e.message}）。`);
    }
  }

  // 認識できない場合でも手入力で続行可能にする
  function fallbackToManualEntry(reason) {
    setStatus(
      `${reason} ⚙設定 からAPIキーを設定するか、下の入力欄に手で牌を入力して計算できます。` +
      '（手入力タブも利用できます）',
      true,
    );
    showHandSection(photoState.tiles);
  }

  // ボタン結線（capture.js の有無を実行時に確認）
  $('#captureBtn').addEventListener('click', async () => {
    const cap = await loadCapture();
    try {
      if (typeof cap.captureImage === 'function') {
        const blob = await cap.captureImage();
        if (blob) await handleImage(blob);
      } else {
        fallbackToManualEntry('撮影機能が利用できません。');
      }
    } catch (e) {
      fallbackToManualEntry(`撮影に失敗しました（${e.message}）。`);
    }
  });

  $('#pickBtn').addEventListener('click', async () => {
    const cap = await loadCapture();
    try {
      if (typeof cap.pickImage === 'function') {
        const blob = await cap.pickImage();
        if (blob) await handleImage(blob);
      } else {
        // フォールバック: 自前のファイル選択
        pickViaInput().then((blob) => { if (blob) handleImage(blob); });
      }
    } catch (e) {
      fallbackToManualEntry(`画像選択に失敗しました（${e.message}）。`);
    }
  });

  // クイック追加（手修正用）
  $('#photoQuickAddBtn').addEventListener('click', () => {
    const input = $('#photoQuickInput');
    const added = parseTileInput(input.value);
    if (added.length) {
      photoState.tiles = photoState.tiles.concat(added);
      // 認識結果が無いまま手入力した場合もセクションを出す
      handSection.hidden = false;
      renderChips();
    }
    input.value = '';
  });
  $('#photoQuickInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#photoQuickAddBtn').click(); }
  });

  // 得点表計算
  $('#photoCalcBtn').addEventListener('click', async () => {
    if (!photoState.tiles.length) {
      resultArea.innerHTML = '<div class="result-error">牌がありません。</div>';
      return;
    }
    resultArea.innerHTML = '<div class="status">計算中…</div>';

    let enumerateOutcomes;
    try {
      enumerateOutcomes = await loadEnumerate();
    } catch (e) {
      resultArea.innerHTML =
        `<div class="result-error">得点計算エンジンを読み込めませんでした（${escapeText(e.message)}）。</div>`;
      return;
    }

    const ctx = {
      ...getDefaultCtx(),
    };
    try {
      const outcomes = enumerateOutcomes(photoState.tiles, ctx);
      renderOutcomesTable(resultArea, outcomes);
    } catch (e) {
      resultArea.innerHTML =
        `<div class="result-error">計算でエラーが発生しました: ${escapeText(e.message)}</div>`;
    }
  });
}

// 写真フロー用の既定文脈（明示的指定が無い場合の既定値）
function getDefaultCtx() {
  return {
    seatWind: '1z',
    roundWind: '1z',
    doraIndicators: [],
    uraIndicators: [],
  };
}

// 自前ファイル選択フォールバック
function pickViaInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => resolve(input.files && input.files[0]));
    input.click();
  });
}

function escapeText(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
function init() {
  setupTabs();
  setupSettings();
  setupManual();
  setupPhoto();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
