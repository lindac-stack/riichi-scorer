// preprocess.js — Vision へ送る前に画像を正規化する（ブラウザ canvas）。
//
// なぜ必要か:
//   スマホ写真は EXIF Orientation（例 tag 6 = 90°回転）で「表示時に回す」前提の
//   横長ピクセルを保存している。FileReader.readAsDataURL は生バイトを渡すため、
//   Vision API は EXIF を適用せず **横倒しの牌**を見てしまう（認識率が大きく落ちる）。
//   ここで createImageBitmap({imageOrientation:'from-image'}) により EXIF 回転を
//   ピクセルに焼き込み、さらに 4032px 級の巨大画像を縮小して無駄なトークンを削る。
//
// preprocessImage(input, opts) -> Promise<{ dataUrl, mime, width, height, applied }>
//   input: Blob | File | dataURL(string)
//   opts : { maxEdge=1600, mime='image/jpeg', quality=0.9, contrast=1.06, saturate=1.08 }
//   applied: 前処理を実際に適用できたか（非対応環境では false で生データを返す）

const DEFAULTS = {
  maxEdge: 1600,        // 長辺の上限。pip(丸/竹)の数え分けに十分かつトークン節約。
  mime: 'image/jpeg',
  quality: 0.9,
  contrast: 1.06,       // 牌の輪郭/字をわずかに強調（やり過ぎると白飛び）
  saturate: 1.08,       // 赤五・緑發・色付きスートを少し際立たせる
};

/** ブラウザに canvas/createImageBitmap が揃っているか。 */
export function canPreprocess() {
  return (
    typeof createImageBitmap === 'function' &&
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  );
}

/** input(Blob|File|dataURL) を Blob に揃える。 */
async function toBlob(input) {
  if (input && typeof input.arrayBuffer === 'function') return input; // Blob/File
  if (typeof input === 'string' && input.startsWith('data:')) {
    const res = await fetch(input); // dataURL -> Blob（ブラウザ）
    return await res.blob();
  }
  throw new Error('preprocessImage: Blob/File か data: URL を渡してください。');
}

/**
 * EXIF 回転を焼き込み、長辺を maxEdge に縮小、軽くコントラスト補正して再エンコード。
 * 失敗・非対応時は元の dataUrl をそのまま返す（applied:false）。
 */
export async function preprocessImage(input, opts = {}) {
  const o = { ...DEFAULTS, ...opts };

  if (!canPreprocess()) {
    const blob = await toBlob(input);
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, mime: blob.type || o.mime, width: 0, height: 0, applied: false };
  }

  const blob = await toBlob(input);

  let bitmap;
  try {
    // EXIF Orientation をピクセルに反映（これが本丸の修正点）。
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // 一部ブラウザは options 非対応 → 素で生成（回転は焼けないが縮小はできる）。
    bitmap = await createImageBitmap(blob);
  }

  const { width: sw, height: sh } = bitmap;
  const scale = Math.min(1, o.maxEdge / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  // filter 非対応ブラウザでは黙って無視される（描画は成立する）。
  try {
    ctx.filter = `contrast(${o.contrast}) saturate(${o.saturate})`;
  } catch { /* noop */ }
  ctx.drawImage(bitmap, 0, 0, dw, dh);
  if (typeof bitmap.close === 'function') bitmap.close();

  const dataUrl = canvas.toDataURL(o.mime, o.quality);
  return { dataUrl, mime: o.mime, width: dw, height: dh, applied: true };
}

/**
 * 正規化 box [0,1] で input を切り抜き、長辺を maxEdge まで（最大2倍まで）拡大して返す。
 * 2パス認識の Pass 2 用。牌領域だけを大きく見せることで pip 数え分けを助ける。
 * @param {Blob|File|string} input
 * @param {{x0:number,y0:number,x1:number,y1:number}} box
 * @param {{marginFrac?:number, maxEdge?:number, mime?:string, quality?:number}} [opts]
 * @returns {Promise<{dataUrl:string, width:number, height:number, box:object}>}
 */
export async function cropNormalizedBox(input, box, opts = {}) {
  if (!canPreprocess()) throw new Error('cropNormalizedBox: canvas 非対応環境');
  const { marginFrac = 0.05, maxEdge = 1400, mime = 'image/jpeg', quality = 0.92 } = opts;
  const clamp = (v) => Math.max(0, Math.min(1, v));

  const blob = await toBlob(input);
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    bmp = await createImageBitmap(blob);
  }
  const W = bmp.width;
  const H = bmp.height;

  let x0 = clamp(box.x0);
  let y0 = clamp(box.y0);
  let x1 = clamp(box.x1);
  let y1 = clamp(box.y1);
  if (x1 <= x0 || y1 <= y0) throw new Error('cropNormalizedBox: box が不正');

  // マージンを付けて余白を確保（端の牌が切れないように）
  const mx = (x1 - x0) * marginFrac;
  const my = (y1 - y0) * marginFrac;
  x0 = clamp(x0 - mx); y0 = clamp(y0 - my); x1 = clamp(x1 + mx); y1 = clamp(y1 + my);

  // 細すぎる box（例: 1行の手牌で高さがごく薄い）は読めないので、各辺を最低 minFrac まで
  // 中心を保って広げる。極端なアスペクト比を避け、牌の上下が切れないようにする。
  const minFrac = opts.minFrac != null ? opts.minFrac : 0.16;
  if (x1 - x0 < minFrac) { const cx = (x0 + x1) / 2; x0 = clamp(cx - minFrac / 2); x1 = clamp(cx + minFrac / 2); }
  if (y1 - y0 < minFrac) { const cy = (y0 + y1) / 2; y0 = clamp(cy - minFrac / 2); y1 = clamp(cy + minFrac / 2); }

  const sx = Math.round(x0 * W);
  const sy = Math.round(y0 * H);
  const sw = Math.round((x1 - x0) * W);
  const sh = Math.round((y1 - y0) * H);
  if (sw < 16 || sh < 16) throw new Error('cropNormalizedBox: 切り抜きが小さすぎる');

  // 牌を大きく見せるため最大2倍まで拡大（長辺 maxEdge を上限）
  const scale = Math.min(2, maxEdge / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  try {
    ctx.filter = 'contrast(1.06) saturate(1.08)';
  } catch { /* noop */ }
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);
  if (typeof bmp.close === 'function') bmp.close();

  return { dataUrl: canvas.toDataURL(mime, quality), width: dw, height: dh, box: { x0, y0, x1, y1 } };
}

/** Blob/File を dataURL に変換（フォールバック用）。 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('画像の読み込みに失敗しました。'));
    r.readAsDataURL(blob);
  });
}
