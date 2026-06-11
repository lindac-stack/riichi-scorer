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
  const resultArea = $('#result');
  let annotator = null; // 写真アノテーション・オーバーレイ（読み込み毎に再生成）

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
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

  // 画像取得 → 写真の上で領域を手動選択 → 領域ごとに認識して手入力ビルダーへ
  async function handleImage(blob) {
    setStatus('画像を準備しています…');

    // 前処理（EXIF回転焼込み＋縮小）して正立 dataURL を得る
    let dataUrl;
    try {
      const { preprocessImage } = await import('../vision/preprocess.js');
      const pre = await preprocessImage(blob, { maxEdge: 1600 });
      dataUrl = pre.dataUrl;
    } catch {
      dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(r.error || new Error('画像読み込み失敗'));
        r.readAsDataURL(blob);
      });
    }

    // アノテーション・オーバーレイを描画（写真上で領域を手動選択）
    try {
      const { createAnnotator } = await import('../vision/annotate.js');
      if (annotator && typeof annotator.destroy === 'function') annotator.destroy();
      previewWrap.hidden = false;
      previewWrap.innerHTML = '';
      annotator = createAnnotator(previewWrap, dataUrl, { onRecognize: recognizeRegions });
      setStatus('写真の上で「手牌」「副露」「ドラ表示」を四角く囲み、犬/人/山など不要部分は「消去」で塗り潰してから「選択を認識」を押してください。');
    } catch (e) {
      fallbackToManualEntry(`画像の表示に失敗しました（${e.message}）。下のビルダーで手入力できます。`);
    }
  }

  // 副露の種別を推定（3枚同種=ポン / 3枚連番=チー / 4枚=カン）。
  function inferMeld(tiles, normalize) {
    const t = tiles.slice(0, 4);
    if (t.length >= 4) return { type: 'kan', tiles: t.slice(0, 4), open: true };
    if (t.length === 3) {
      const n = t.map(normalize);
      const same = n.every((x) => x === n[0]);
      return { type: same ? 'pon' : 'chi', tiles: t, open: true };
    }
    return { type: 'chi', tiles: t, open: true }; // 2枚以下は暫定（後で手修正）
  }

  // 選択された領域を1つずつ切り出して認識し、手牌/副露/ドラに振り分ける
  async function recognizeRegions(regions, cropRegion) {
    const cfg = getVisionConfig();
    if (!cfg.key) {
      fallbackToManualEntry('APIキーが未設定です。⚙設定 から入力するか、下のビルダーで手入力してください。');
      return;
    }

    let recognizeTiles;
    let normalize;
    try {
      recognizeTiles = await loadVision();
      ({ normalize } = await import('../tiles.js'));
    } catch {
      fallbackToManualEntry('認識モジュールが利用できません。');
      return;
    }

    const handR = regions.filter((r) => r.type === 'hand');
    const meldR = regions.filter((r) => r.type === 'meld');
    const doraR = regions.filter((r) => r.type === 'dora');
    if (!handR.length && !meldR.length && !doraR.length) {
      setStatus('認識する領域がありません。先に「手牌」などを囲んでください。', true);
      return;
    }

    setStatus('選択領域を認識しています…');
    const recog = async (r) => {
      const url = cropRegion(r, { maxEdge: 1200 }); // 領域を切り出した dataURL
      const res = await recognizeTiles(url, { ...cfg, preprocess: false, twoPass: false });
      return (res && res.tiles) || [];
    };

    try {
      const hand = [];
      for (const r of handR) hand.push(...(await recog(r)));
      const melds = [];
      for (const r of meldR) {
        const tiles = await recog(r);
        if (tiles.length) melds.push(inferMeld(tiles, normalize));
      }
      const dora = [];
      for (const r of doraR) dora.push(...(await recog(r)));

      hb.applyRecognition({ hand, melds, dora });

      const parts = [];
      if (hand.length) parts.push(`手牌${hand.length}枚`);
      if (melds.length) parts.push(`副露${melds.length}組`);
      if (dora.length) parts.push(`ドラ表示${dora.length}枚`);
      setStatus(
        `認識結果 → ${parts.join(' / ') || 'なし'}。下のビルダーで誤りを修正し、和了牌を選んで計算してください。`,
      );
    } catch (e) {
      setStatus(`認識に失敗しました（${e.message}）。下のビルダーで手入力できます。`, true);
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
      melds: hb.state.melds.map((m) => ({ ...m, tiles: [...m.tiles] })),
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
