// annotate.js — 写真上で領域を手動選択するオーバーレイ。
//
// なぜ: Vision モデルは雑然とした写真全体から手牌だけを切り出すのも、pip を
// 数えるのも苦手。そこで「どこが手牌/副露/ドラか」という分割を人間が指で囲って
// 与える。各領域を個別に切り出して認識すれば、少数牌の認識精度は大幅に上がる。
//
// createAnnotator(host, imageDataUrl, { onRecognize }) を呼ぶと host に
// ツールバー + canvas を描画する。ユーザは種別を選んで矩形をドラッグ。
// 「選択を認識」で onRecognize(regions, cropRegion) が呼ばれる。
//   regions  : [{type:'hand'|'meld'|'dora'|'erase', x0,y0,x1,y1}]（正規化座標）
//   cropRegion(region, opts) -> dataURL（消去領域を塗り潰した上で region を拡大切り出し）

export const REGION_TYPES = {
  hand: { label: '手牌', color: '#37b06f', short: '手' },
  meld: { label: '副露(鳴き)', color: '#e0a800', short: '鳴' },
  dora: { label: 'ドラ表示', color: '#5b9bf3', short: 'ド' },
  erase: { label: '消去', color: '#ff5a5a', short: '×' },
};

export function createAnnotator(host, imageDataUrl, opts = {}) {
  host.innerHTML = `
    <div class="annot">
      <div class="annot-tools" role="toolbar" aria-label="領域の種別">
        ${Object.entries(REGION_TYPES)
          .map(([k, v]) => `<button type="button" class="annot-mode" data-mode="${k}" style="--c:${v.color}">${v.label}</button>`)
          .join('')}
        <span class="annot-sep"></span>
        <button type="button" class="annot-act" data-act="rotate" title="写真を90°回転">↻ 回転</button>
        <button type="button" class="annot-act" data-act="undo">取消</button>
        <button type="button" class="annot-act" data-act="clear">全消去</button>
        <button type="button" class="annot-recog primary-btn small" data-act="recognize">選択を認識</button>
      </div>
      <p class="annot-hint">種別を選び、写真の上を指/マウスでなぞって四角く囲みます。手牌・副露・ドラ表示を囲み、犬や人や山など不要な部分は「消去」で塗り潰してから「選択を認識」。</p>
      <div class="annot-stage">
        <canvas class="annot-canvas"></canvas>
      </div>
    </div>`;

  const canvas = host.querySelector('.annot-canvas');
  const ctx = canvas.getContext('2d');
  const stage = host.querySelector('.annot-stage');

  const state = {
    mode: 'hand',
    regions: [],          // {type,x0,y0,x1,y1} normalized
    drag: null,           // {x0,y0,x1,y1} during drag (normalized)
  };

  const img = new Image();
  let natW = 0;
  let natH = 0;
  let dispW = 0;
  let dispH = 0;

  img.onload = () => {
    natW = img.naturalWidth;
    natH = img.naturalHeight;
    layout();
    draw();
  };
  img.src = imageDataUrl;

  function layout() {
    // 横幅にフィット（縦は比率維持、上限で画面に収める）
    const maxW = stage.clientWidth || host.clientWidth || 360;
    const maxH = Math.max(260, Math.min(window.innerHeight * 0.6, 640));
    let w = maxW;
    let h = (natH / natW) * w;
    if (h > maxH) { h = maxH; w = (natW / natH) * h; }
    dispW = Math.round(w);
    dispH = Math.round(h);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(dispW * dpr);
    canvas.height = Math.round(dispH * dpr);
    canvas.style.width = `${dispW}px`;
    canvas.style.height = `${dispH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (!natW) return;
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(img, 0, 0, dispW, dispH);
    const all = state.drag
      ? state.regions.concat([{ type: state.mode, ...state.drag }])
      : state.regions;
    for (const r of all) {
      const t = REGION_TYPES[r.type] || REGION_TYPES.hand;
      const x = r.x0 * dispW;
      const y = r.y0 * dispH;
      const w = (r.x1 - r.x0) * dispW;
      const h = (r.y1 - r.y0) * dispH;
      if (r.type === 'erase') {
        ctx.fillStyle = 'rgba(255,90,90,0.55)';
        ctx.fillRect(x, y, w, h);
      } else {
        ctx.fillStyle = hexToRgba(t.color, 0.18);
        ctx.fillRect(x, y, w, h);
      }
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = t.color;
      ctx.strokeRect(x, y, w, h);
      // ラベルバッジ
      ctx.fillStyle = t.color;
      ctx.fillRect(x, Math.max(0, y - 16), 18, 16);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px -apple-system,sans-serif';
      ctx.fillText(t.short, x + 4, Math.max(11, y - 4));
    }
  }

  // ---- ポインタ操作（マウス/タッチ共通）----
  function ptNorm(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    return { x: clamp01(x), y: clamp01(y) };
  }
  let startPt = null;
  function onDown(ev) {
    ev.preventDefault();
    try { canvas.setPointerCapture?.(ev.pointerId); } catch { /* 合成イベント等では無視 */ }
    startPt = ptNorm(ev);
    state.drag = { x0: startPt.x, y0: startPt.y, x1: startPt.x, y1: startPt.y };
  }
  function onMove(ev) {
    if (!startPt) return;
    const p = ptNorm(ev);
    state.drag = {
      x0: Math.min(startPt.x, p.x), y0: Math.min(startPt.y, p.y),
      x1: Math.max(startPt.x, p.x), y1: Math.max(startPt.y, p.y),
    };
    draw();
  }
  function onUp() {
    if (state.drag) {
      const d = state.drag;
      // 極小（誤タップ）は無視
      if ((d.x1 - d.x0) > 0.02 && (d.y1 - d.y0) > 0.02) {
        state.regions.push({ type: state.mode, ...d });
      }
    }
    state.drag = null;
    startPt = null;
    draw();
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  // ---- ツールバー ----
  function setMode(m) {
    state.mode = m;
    host.querySelectorAll('.annot-mode').forEach((b) =>
      b.classList.toggle('is-on', b.dataset.mode === m));
  }
  host.querySelectorAll('.annot-mode').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));
  setMode('hand');

  host.querySelector('[data-act="undo"]').addEventListener('click', () => {
    state.regions.pop();
    draw();
  });
  host.querySelector('[data-act="clear"]').addEventListener('click', () => {
    state.regions = [];
    draw();
  });
  host.querySelector('[data-act="rotate"]').addEventListener('click', rotate90);

  // 写真を 90°時計回りに回転（向きが合わないとき手動で直す）。
  // 座標系が変わるため選択中の領域はクリアする。
  function rotate90() {
    if (!natW) return;
    const c = document.createElement('canvas');
    c.width = natH;
    c.height = natW;
    const cx = c.getContext('2d');
    cx.translate(natH, 0);
    cx.rotate(Math.PI / 2);
    cx.drawImage(img, 0, 0, natW, natH);
    state.regions = [];
    img.onload = () => { natW = img.naturalWidth; natH = img.naturalHeight; layout(); draw(); };
    img.src = c.toDataURL('image/jpeg', 0.92);
  }
  host.querySelector('[data-act="recognize"]').addEventListener('click', () => {
    if (typeof opts.onRecognize === 'function') {
      opts.onRecognize(state.regions.slice(), cropRegion);
    }
  });

  window.addEventListener('resize', onResize);
  function onResize() { layout(); draw(); }

  /**
   * 領域を切り出して dataURL を返す。消去領域を先に felt 色で塗り潰し、
   * region をマージン付き・最大2倍拡大で切り出す（牌を大きく見せる）。
   */
  function cropRegion(region, o = {}) {
    const { marginFrac = 0.06, maxEdge = 1200, fill = '#2f7d52' } = o;
    // 元解像度の作業キャンバスに描画 → 消去塗り
    const work = document.createElement('canvas');
    work.width = natW; work.height = natH;
    const wctx = work.getContext('2d');
    wctx.drawImage(img, 0, 0, natW, natH);
    wctx.fillStyle = fill;
    for (const e of state.regions) {
      if (e.type !== 'erase') continue;
      wctx.fillRect(e.x0 * natW, e.y0 * natH, (e.x1 - e.x0) * natW, (e.y1 - e.y0) * natH);
    }
    // region + マージン
    let x0 = clamp01(region.x0 - (region.x1 - region.x0) * marginFrac);
    let y0 = clamp01(region.y0 - (region.y1 - region.y0) * marginFrac);
    let x1 = clamp01(region.x1 + (region.x1 - region.x0) * marginFrac);
    let y1 = clamp01(region.y1 + (region.y1 - region.y0) * marginFrac);
    const sx = Math.round(x0 * natW);
    const sy = Math.round(y0 * natH);
    const sw = Math.max(8, Math.round((x1 - x0) * natW));
    const sh = Math.max(8, Math.round((y1 - y0) * natH));
    const scale = Math.min(2, maxEdge / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const out = document.createElement('canvas');
    out.width = dw; out.height = dh;
    const octx = out.getContext('2d');
    try { octx.filter = 'contrast(1.06) saturate(1.08)'; } catch { /* noop */ }
    octx.drawImage(work, sx, sy, sw, sh, 0, 0, dw, dh);
    return out.toDataURL('image/jpeg', 0.92);
  }

  function destroy() {
    window.removeEventListener('resize', onResize);
    host.innerHTML = '';
  }

  return {
    getRegions: () => state.regions.slice(),
    cropRegion,
    setMode,
    destroy,
  };
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return `rgba(55,176,111,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}
