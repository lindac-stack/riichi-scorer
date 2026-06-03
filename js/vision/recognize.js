// recognize.js — 画像から麻雀牌を認識する（ユーザー保有 Vision API キー / サーバー不要）。
//
// recognizeTiles(image, opts) -> { tiles, raw, provider }
//   image: Blob | File | dataURL(string)
//   opts : { provider, key }  省略時は localStorage から読む。
//
// 対応プロバイダ: 'gemini' | 'openai' | 'anthropic'
// すべてブラウザから直接 fetch する。API キーはハードコードしない。

import { allTileTypes } from '../tiles.js';
import { RECOGNIZE_PROMPT } from './prompt.js';

// ---- localStorage キー ----
export const LS_PROVIDER_KEY = 'riichi_vision_provider';
export const LS_API_KEY = 'riichi_vision_key';
const DEFAULT_PROVIDER = 'gemini';

// ---- プロバイダ毎のモデル名（変更しやすいよう定数化）----
export const MODELS = {
  gemini: 'gemini-2.0-flash',          // 代替: 'gemini-1.5-flash'
  openai: 'gpt-4o-mini',               // 代替: 'gpt-4o'
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

/** image(Blob|File|dataURL) を正規化して { dataUrl, base64, mime } を返す。 */
async function toImageParts(image) {
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
async function callGemini(parts, key) {
  const model = MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: RECOGNIZE_PROMPT },
            { inline_data: { mime_type: parts.mime, data: parts.base64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
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
async function callOpenAI(parts, key) {
  const model = MODELS.openai;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: RECOGNIZE_PROMPT },
            { type: 'image_url', image_url: { url: parts.dataUrl } },
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
async function callAnthropic(parts, key) {
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
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: parts.mime, data: parts.base64 },
            },
            { type: 'text', text: RECOGNIZE_PROMPT },
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
 * @param {{provider?:string, key?:string}} [opts]
 * @returns {Promise<{tiles:string[], raw:string, provider:string}>}
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

  const parts = await toImageParts(image);

  let raw;
  switch (provider) {
    case 'gemini':
      raw = await callGemini(parts, key);
      break;
    case 'openai':
      raw = await callOpenAI(parts, key);
      break;
    case 'anthropic':
      raw = await callAnthropic(parts, key);
      break;
    default:
      throw new Error(`未知の Vision プロバイダです: ${provider}`);
  }

  const tiles = extractTiles(raw);
  return { tiles, raw, provider };
}
