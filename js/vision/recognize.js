// recognize.js — 画像から麻雀牌を認識する（ユーザー保有 Vision API キー / サーバー不要）。
//
// recognizeTiles(image, opts) -> { tiles, raw, provider }
//   image: Blob | File | dataURL(string)
//   opts : { provider, key }  省略時は localStorage から読む。
//
// 対応プロバイダ: 'gemini' | 'openai' | 'anthropic'
// すべてブラウザから直接 fetch する。API キーはハードコードしない。

import { allTileTypes } from '../tiles.js';
import { RECOGNIZE_PROMPT, LOCATE_PROMPT } from './prompt.js';
import { preprocessImage, canPreprocess, cropNormalizedBox } from './preprocess.js';

// ---- localStorage キー ----
export const LS_PROVIDER_KEY = 'riichi_vision_provider';
export const LS_API_KEY = 'riichi_vision_key';
const DEFAULT_PROVIDER = 'gemini';

// ---- プロバイダ毎のモデル名（変更しやすいよう定数化）----
export const MODELS = {
  gemini: 'gemini-2.0-flash',          // 代替: 'gemini-1.5-flash'
  openai: 'gpt-4.1',                   // bench: gpt-4o-mini 42% → gpt-4o/4.1 ~70%（牌の数え分け）
  anthropic: 'claude-3-5-sonnet-latest', // 代替: 'claude-opus-4-1' 等
};

// ---- 有効な牌トークンの集合（tiles.js を単一の真実として参照）----
const VALID_TILES = new Set([...allTileTypes(), '0m', '0p', '0s']); // 通常牌 + 赤五
// 形式チェック用の正規表現（1-9 の数牌, 0 赤五, 1-7 字牌）。
const TILE_RE = /^(?:[1-9][mps]|0[mps]|[1-7]z)$/;

/** トークンが有効な tiles.js 表記か。 */
function isValidTile(tok) {
  return typeof tok === 'string' && TILE_RE.test(tok) && VALID_TILES.has(tok);
}

/**
 * モデルの生応答テキストから牌配列を防御的に抽出・検証する（テスト可能なよう独立関数）。
 * - markdown コードフェンスを除去
 * - 最初の {...} JSON オブジェクトを抜き出して JSON.parse
 * - tiles 配列の各要素を tiles.js 表記で検証し、無効トークンは捨てる
 * @param {string} text モデルの生応答
 * @returns {string[]} 検証済みの牌配列（抽出失敗時は []）
 */
export function extractTiles(text) {
  if (!text || typeof text !== 'string') return [];

  // 1) ```json ... ``` / ``` ... ``` のフェンスを剥がす
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();

  // 2) 最初の波括弧オブジェクトを抽出（前後の説明文があっても拾う）
  let jsonStr = cleaned;
  const start = cleaned.indexOf('{');
  if (start !== -1) {
    // 対応する閉じ括弧を文字列リテラルを考慮して探す
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          jsonStr = cleaned.slice(start, i + 1);
          break;
        }
      }
    }
  }

  // 3) JSON.parse
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }

  // 4) tiles 配列を取り出して検証（配列直書きにも一応対応）
  let arr;
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && Array.isArray(parsed.tiles)) arr = parsed.tiles;
  else return [];

  return arr
    .map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : t))
    .filter(isValidTile);
}

// ---- image -> { dataUrl, base64, mime } 変換 ----

/** dataURL 文字列を { base64, mime } に分解。 */
function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('画像の dataURL 形式が不正です。');
  return { mime: m[1] || 'image/jpeg', base64: m[2] };
}

/** Blob/File を dataURL に変換（ブラウザ: FileReader / Node: arrayBuffer フォールバック）。 */
async function blobToDataUrl(blob) {
  const mime = blob.type || 'image/jpeg';
  if (typeof FileReader !== 'undefined') {
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('画像の読み込みに失敗しました。'));
      r.readAsDataURL(blob);
    });
  }
  // Node 等 FileReader が無い環境
  const buf = Buffer.from(await blob.arrayBuffer());
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * image(Blob|File|dataURL) を正規化して { dataUrl, base64, mime } を返す。
 * 既定で前処理（EXIF回転の焼き込み＋縮小＋軽い補正）を行う。ブラウザ非対応や
 * 失敗時は生データにフォールバックする。opts.preprocess===false で無効化。
 */
async function toImageParts(image, opts = {}) {
  if (opts.preprocess !== false && canPreprocess()) {
    try {
      const pre = await preprocessImage(image, opts.preprocessOpts);
      const { base64, mime } = parseDataUrl(pre.dataUrl);
      return { dataUrl: pre.dataUrl, base64, mime };
    } catch {
      /* 前処理に失敗 → 従来経路へフォールバック */
    }
  }

  let dataUrl;
  if (typeof image === 'string') {
    if (!image.startsWith('data:')) {
      throw new Error('画像が dataURL 文字列ではありません（Blob/File か data: URL を渡してください）。');
    }
    dataUrl = image;
  } else if (image && typeof image.arrayBuffer === 'function') {
    dataUrl = await blobToDataUrl(image);
  } else {
    throw new Error('画像は Blob / File / dataURL のいずれかである必要があります。');
  }
  const { base64, mime } = parseDataUrl(dataUrl);
  return { dataUrl, base64, mime };
}

/**
 * 複数パスの認識結果を multiset 多数決で統合する（自己整合アンサンブル）。
 * - 過半数のパスに出現した牌だけを採用（ノイズ/幻覚を抑制）
 * - 各牌の枚数はパス間の中央値で決める
 * @param {string[][]} runs 各パスの牌配列
 * @returns {string[]} 統合後の牌配列（tiles.js 表記）
 */
export function voteTiles(runs) {
  if (!runs || !runs.length) return [];
  if (runs.length === 1) return runs[0].slice();
  const counts = new Map(); // tile -> 各パスでの枚数の配列
  for (const tiles of runs) {
    const c = new Map();
    for (const t of tiles) c.set(t, (c.get(t) || 0) + 1);
    for (const [t, n] of c) {
      if (!counts.has(t)) counts.set(t, []);
      counts.get(t).push(n);
    }
  }
  const half = runs.length / 2;
  const out = [];
  for (const [t, arr] of counts) {
    if (arr.length > half) {
      arr.sort((a, b) => a - b);
      const med = arr[Math.floor(arr.length / 2)];
      // 同一牌は最大4枚（麻雀の制約）。アンサンブルの不一致で超過しても切り詰める。
      for (let i = 0; i < Math.min(med, 4); i++) out.push(t);
    }
  }
  return out;
}

/**
 * LOCATE_PROMPT の応答から正規化 box を抽出する（2パス認識 Pass 1 用）。
 * {"box":{x0,y0,x1,y1}} / 直書き {x0..} / {x,y,w,h} に対応。無効なら null。
 * @param {string} text モデル生応答
 * @returns {{x0:number,y0:number,x1:number,y1:number}|null}
 */
export function extractBox(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  let jsonStr = cleaned.slice(start);
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { jsonStr = cleaned.slice(start, i + 1); break; }
    }
  }

  let parsed;
  try { parsed = JSON.parse(jsonStr); } catch { return null; }
  const b = parsed && parsed.box !== undefined ? parsed.box : parsed;
  if (!b || typeof b !== 'object') return null;

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  let x0 = num(b.x0);
  let y0 = num(b.y0);
  let x1 = num(b.x1);
  let y1 = num(b.y1);
  // {x,y,w,h} 形式にも対応
  if (x0 === null && num(b.x) !== null && num(b.w) !== null) {
    x0 = b.x; y0 = b.y; x1 = b.x + b.w; y1 = b.y + b.h;
  }
  if (x0 === null || y0 === null || x1 === null || y1 === null) return null;

  const clamp = (v) => Math.max(0, Math.min(1, v));
  x0 = clamp(x0); y0 = clamp(y0); x1 = clamp(x1); y1 = clamp(y1);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

// ---- HTTP エラーを UI 表示可能な形で投げる ----
async function throwHttpError(provider, res) {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* noop */
  }
  const excerpt = body ? body.slice(0, 300) : '(本文なし)';
  throw new Error(`Vision API エラー [${provider}] HTTP ${res.status}: ${excerpt}`);
}

// ---- プロバイダ別の呼び出し ----

// Gemini: generateContent REST。キーは ?key= クエリ。
// body: { contents:[{ parts:[{text},{inline_data:{mime_type,data}}] }] }
async function callGemini(parts, key, temperature = 0, prompt = RECOGNIZE_PROMPT) {
  const model = MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: parts.mime, data: parts.base64 } },
          ],
        },
      ],
      generationConfig: { temperature },
    }),
  });
  if (!res.ok) await throwHttpError('gemini', res);
  const json = await res.json();
  // 応答テキストは candidates[0].content.parts[*].text を連結
  const cand = json.candidates && json.candidates[0];
  const textParts = (cand && cand.content && cand.content.parts) || [];
  return textParts.map((p) => p.text || '').join('');
}

// OpenAI: chat completions。image_url に dataURL を渡す。x-api-key ではなく Bearer。
// content: [{type:'text'},{type:'image_url', image_url:{url: dataURL}}]
async function callOpenAI(parts, key, temperature = 0, prompt = RECOGNIZE_PROMPT) {
  const model = MODELS.openai;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            // detail:'high' で全解像度タイル処理 → 筒子/索子の pip 数え分けが安定する
            { type: 'image_url', image_url: { url: parts.dataUrl, detail: 'high' } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) await throwHttpError('openai', res);
  const json = await res.json();
  const choice = json.choices && json.choices[0];
  return (choice && choice.message && choice.message.content) || '';
}

// Anthropic: Messages API。image source は base64。
// ブラウザ直叩きには anthropic-dangerous-direct-browser-access ヘッダが必要。
// content: [{type:'image', source:{type:'base64', media_type, data}},{type:'text'}]
async function callAnthropic(parts, key, temperature = 0, prompt = RECOGNIZE_PROMPT) {
  const model = MODELS.anthropic;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: parts.mime, data: parts.base64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) await throwHttpError('anthropic', res);
  const json = await res.json();
  // content は [{type:'text', text:'...'}, ...]
  const blocks = json.content || [];
  return blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

/**
 * 画像から牌を認識する。
 * @param {Blob|File|string} image Blob/File か dataURL 文字列
 * @param {{provider?:string, key?:string, passes?:number, temperature?:number,
 *          preprocess?:boolean, preprocessOpts?:object, twoPass?:boolean,
 *          cropOpts?:object}} [opts]
 *   - passes>1: 複数回認識し multiset 多数決（自己整合アンサンブル）。
 *   - twoPass: Pass1 で牌領域の box を取得→切り抜き拡大→Pass2 で認識。
 *     box 取得・切り抜きに失敗したら全体画像にフォールバック。
 * @returns {Promise<{tiles:string[], raw:string, raws:string[], runs:string[][],
 *   provider:string, passes:number, twoPass:boolean, box:object|null}>}
 */
export async function recognizeTiles(image, opts = {}) {
  const ls = typeof localStorage !== 'undefined' ? localStorage : null;

  const provider =
    opts.provider || (ls && ls.getItem(LS_PROVIDER_KEY)) || DEFAULT_PROVIDER;
  const key = opts.key || (ls && ls.getItem(LS_API_KEY)) || '';

  if (!key) {
    throw new Error(
      'Vision API キーが設定されていません。設定モーダルからキーを入力してください（手入力でも計算できます）。'
    );
  }

  // プロバイダ呼び出し（parts と prompt を差し替えられるよう汎用化）
  const call = (parts, t, prompt) => {
    switch (provider) {
      case 'gemini':
        return callGemini(parts, key, t, prompt);
      case 'openai':
        return callOpenAI(parts, key, t, prompt);
      case 'anthropic':
        return callAnthropic(parts, key, t, prompt);
      default:
        throw new Error(`未知の Vision プロバイダです: ${provider}`);
    }
  };

  const fullParts = await toImageParts(image, opts);

  // ---- Pass 1: 牌領域の特定 → 切り抜き拡大（twoPass かつ canvas 対応時のみ）----
  let recogParts = fullParts;
  let box = null;
  let locateRaw = '';
  if (opts.twoPass && canPreprocess()) {
    try {
      locateRaw = await call(fullParts, 0, LOCATE_PROMPT);
      box = extractBox(locateRaw);
      // box が極端に小さい/ほぼ全面なら切り抜きの意味が薄い → そのまま全体
      if (box) {
        const area = (box.x1 - box.x0) * (box.y1 - box.y0);
        if (area >= 0.01 && area <= 0.98) {
          const cropped = await cropNormalizedBox(fullParts.dataUrl, box, opts.cropOpts);
          const { base64, mime } = parseDataUrl(cropped.dataUrl);
          recogParts = { dataUrl: cropped.dataUrl, base64, mime };
        }
      }
    } catch {
      recogParts = fullParts; // 失敗時は全体画像で続行
    }
  }

  // ---- Pass 2: 認識（任意でアンサンブル）----
  const passes = Math.max(1, opts.passes || 1);
  const temperature = opts.temperature != null ? opts.temperature : passes > 1 ? 0.4 : 0;

  const raws = [];
  const runs = [];
  for (let i = 0; i < passes; i++) {
    const raw = await call(recogParts, temperature, RECOGNIZE_PROMPT);
    raws.push(raw);
    runs.push(extractTiles(raw));
  }

  let tiles = passes > 1 ? voteTiles(runs) : runs[0];

  // 切り抜きで1枚も読めなかった場合（box が細すぎる/外した等）は全体画像で再試行する。
  if (tiles.length === 0 && recogParts !== fullParts) {
    const raw = await call(fullParts, 0, RECOGNIZE_PROMPT);
    const fb = extractTiles(raw);
    if (fb.length) {
      tiles = fb;
      raws.push(raw);
      runs.push(fb);
    }
  }

  return {
    tiles,
    raw: raws[raws.length - 1],
    raws,
    runs,
    provider,
    passes,
    twoPass: !!opts.twoPass,
    box,
  };
}
