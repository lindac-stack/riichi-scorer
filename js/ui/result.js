// result.js — scoreHand の Result と enumerateOutcomes の Outcome[] を描画する。

/** HTML エスケープ。 */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * scoreHand の Result を 1 枚のカードとして描画する。
 * @param {HTMLElement} container
 * @param {object} result  SPEC の Result
 */
export function renderScoreResult(container, result) {
  container.innerHTML = '';
  if (!result) return;

  if (!result.valid) {
    const div = document.createElement('div');
    div.className = 'result-error';
    div.textContent = result.error ? `成立しません: ${result.error}` : '和了形として成立しません。';
    container.appendChild(div);
    return;
  }

  const card = document.createElement('div');
  card.className = 'result-card';

  const yakuman = result.yakuman > 0;
  const limitBadge = result.limit
    ? `<span class="result-limit">${esc(result.limit)}</span>` : '';

  // 見出し（点数）
  const headline = result.display || String(result.points?.total ?? '');
  let sub;
  if (yakuman) {
    sub = `役満 ×${result.yakuman}`;
  } else {
    sub = `${result.han}翻 ${result.fu}符`;
  }

  // 役一覧
  const yakuItems = (result.yaku || []).map((y) => {
    const hanLabel = y.han != null ? `${y.han}翻` : '';
    return `<li><span class="yaku-name">${esc(y.name)}</span><span class="han">${esc(hanLabel)}</span></li>`;
  }).join('');

  // ドラ等
  const extras = [];
  if (result.dora) extras.push(`<li><span class="yaku-name">ドラ</span><span class="han">${result.dora}翻</span></li>`);
  if (result.aka) extras.push(`<li><span class="yaku-name">赤ドラ</span><span class="han">${result.aka}翻</span></li>`);
  if (result.ura) extras.push(`<li><span class="yaku-name">裏ドラ</span><span class="han">${result.ura}翻</span></li>`);

  // 支払い内訳
  const pts = result.points || {};
  let payRow = '';
  if (pts.ron != null) {
    payRow = `<div class="tot-row"><span class="lbl">放銃支払</span><b>${pts.ron}</b></div>`;
  } else if (pts.tsumo) {
    const { dealer, nonDealer } = pts.tsumo;
    payRow = `<div class="tot-row"><span class="lbl">ツモ支払</span><b>子 ${nonDealer} / 親 ${dealer}</b></div>`;
  }

  card.innerHTML = `
    <div class="result-headline">${esc(headline)}${limitBadge}</div>
    <div class="result-sub">${esc(sub)}</div>
    <ul class="yaku-list ${yakuman ? 'yakuman' : ''}">${yakuItems}${extras.join('')}</ul>
    <div class="tot-row"><span class="lbl">総得点</span><b>${esc(pts.total ?? '')}</b></div>
    ${payRow}
  `;
  container.appendChild(card);
}

/**
 * enumerateOutcomes の Outcome[] を得点表として描画する。
 * Outcome = { label, input, result }
 * @param {HTMLElement} container
 * @param {Array} outcomes
 */
export function renderOutcomesTable(container, outcomes) {
  container.innerHTML = '';

  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    const div = document.createElement('div');
    div.className = 'result-error';
    div.textContent = '成立する和了パターンが見つかりませんでした。牌や文脈を確認してください。';
    container.appendChild(div);
    return;
  }

  // 得点降順（enumerate 側でソート済みでも保険として）
  const rows = [...outcomes].sort((a, b) =>
    (b.result?.points?.total ?? 0) - (a.result?.points?.total ?? 0));

  const card = document.createElement('div');
  card.className = 'result-card';

  const body = rows.map((o) => {
    const r = o.result || {};
    const pts = r.points || {};
    const total = pts.total ?? '';
    const hanLabel = r.yakuman > 0 ? `役満×${r.yakuman}` : `${r.han ?? ''}翻`;
    const fuLabel = r.yakuman > 0 ? '—' : `${r.fu ?? ''}符`;
    const limit = r.limit ? ` <span class="result-limit">${esc(r.limit)}</span>` : '';
    const display = r.display ? esc(r.display) : esc(String(total));
    const yakuNames = (r.yaku || []).map((y) => esc(y.name)).join('・');
    return `
      <tr>
        <td>${esc(o.label || '')}${limit}<div class="result-sub" style="font-size:0.8rem;margin:2px 0 0">${yakuNames}</div></td>
        <td class="num">${esc(hanLabel)}</td>
        <td class="num">${esc(fuLabel)}</td>
        <td class="num"><b>${display}</b></td>
      </tr>`;
  }).join('');

  card.innerHTML = `
    <h2 class="section-title" style="margin-top:0">得点表（全パターン）</h2>
    <table class="score-table">
      <thead>
        <tr><th>パターン</th><th class="num">翻</th><th class="num">符</th><th class="num">点数</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
  container.appendChild(card);
}
