// app.js — コントローラ。設定モーダル・写真認識→手入力ビルダー→計算 の結線。
//
// 設計方針: 採点エンジン(score.js / enumerate.js)と画像認識(vision/*)は
// 動的 import で読み込み、失敗しても手入力ビルダーが壊れないよう防御的に扱う。

import { createHandBuilder } from './handbuilder.js';
import { renderScoreResult, renderOutcomesTable } from './result.js';

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
// 統合ページ（写真認識 → 手入力ビルダー → 計算 / 全パターン列挙）
// ---------------------------------------------------------------------------
function setupMain() {
  const statusEl = $('#photoStatus');
  const previewWrap = $('#photoPreview');
  const previewImg = $('#photoImg');
  const resultArea = $('#result');

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function showPreview(blobOrUrl) {
    try {
      const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
      previewImg.src = url;
      previewWrap.hidden = false;
    } catch { /* プレビューは任意 */ }
  }

  // 手入力ビルダーを1度だけ生成。計算は従来の手入力フローと同じ。
  const hb = createHandBuilder($('#handbuilder'), async (payload) => {
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

  // 画像取得 → 認識 → 手入力ビルダーへ流し込む
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
      hb.loadTiles(tiles);
      setStatus('認識しました。誤りがあれば牌をタップ/パレットで修正してください。');
    } catch (e) {
      fallbackToManualEntry(`認識に失敗しました（${e.message}）。`);
    }
  }

  // 認識できない場合でも手入力ビルダーで続行可能にする
  function fallbackToManualEntry(reason) {
    setStatus(
      `${reason} ⚙設定 からAPIキーを設定するか、下のビルダーに手で牌を入力して計算できます。`,
      true,
    );
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

  // 全パターン列挙（和了牌・文脈の指定なしでも）
  $('#enumerateBtn').addEventListener('click', async () => {
    if (!hb.state.hand.length) {
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

    // 文脈はビルダーの現在状態から組み立てる
    const ctx = {
      seatWind: hb.state.seatWind,
      roundWind: hb.state.roundWind,
      doraIndicators: [...hb.state.doraIndicators],
      uraIndicators: [...hb.state.uraIndicators],
    };
    try {
      const outcomes = enumerateOutcomes(hb.state.hand, ctx);
      renderOutcomesTable(resultArea, outcomes);
    } catch (e) {
      resultArea.innerHTML =
        `<div class="result-error">計算でエラーが発生しました: ${escapeText(e.message)}</div>`;
    }
  });
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
  setupSettings();
  setupMain();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
