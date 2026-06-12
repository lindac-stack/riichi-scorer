// engine.test.js — 採点エンジンの既知手牌テスト
// node --test test/engine.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { scoreHand } from '../js/engine/score.js';
import { enumerateOutcomes } from '../js/engine/enumerate.js';

// 共通文脈ヘルパ
function base(overrides = {}) {
  return {
    melds: [],
    seatWind: '2z', // 子（南家）
    roundWind: '1z', // 東場
    doraIndicators: [],
    uraIndicators: [],
    ...overrides,
  };
}

// 1. 平和ツモ門前（子）: 234m 567m 234p 678p 33s, ツモ和了牌=4m(両面)
//    平和+ツモ = 2翻 20符固定 → 子ツモ 400/700
test('1. 平和ツモ門前 → 20符2翻 400/700', () => {
  const r = scoreHand(
    base({
      hand: ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '7p', '8p', '9p', '3s', '3s'],
      winningTile: '4m', // 23m に 4m → 両面（789pで断么九は不成立）
      winType: 'tsumo',
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  assert.strictEqual(r.fu, 20);
  assert.strictEqual(r.han, 2); // 平和 + 門前清自摸和
  const names = r.yaku.map((y) => y.name);
  assert.ok(names.includes('平和'));
  assert.ok(names.includes('門前清自摸和'));
  assert.strictEqual(r.points.tsumo.nonDealer, 400);
  assert.strictEqual(r.points.tsumo.dealer, 700);
});

// 2. 立直一発ツモ平和ドラ1（子）
//    立直1 + 一発1 + ツモ1 + 平和1 + ドラ1 = 5翻 → 満貫 子ツモ 2000/4000
test('2. 立直一発ツモ平和ドラ1 → 満貫 2000/4000', () => {
  const r = scoreHand(
    base({
      hand: ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '7p', '8p', '9p', '3s', '3s'],
      winningTile: '4m', // 23m → 両面
      winType: 'tsumo',
      riichi: true,
      ippatsu: true,
      doraIndicators: ['1m'], // ドラ=2m, 手に2m 1枚（789pで断么九は不成立）
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  assert.strictEqual(r.han, 5); // 立直+一発+ツモ+平和+ドラ1
  assert.strictEqual(r.dora, 1);
  assert.strictEqual(r.limit, '満貫');
  assert.strictEqual(r.points.tsumo.nonDealer, 2000);
  assert.strictEqual(r.points.tsumo.dealer, 4000);
});

// 3. 断么九のみ ロン 子: 234m 567m 345p 678p 55s, ロン和了牌=2m(両面)
//    断么九1翻、副底20+門前ロン10+雀頭0+待ち0 = 30→ あれ 40符?
//    全順子・雀頭5s非役牌・両面待ち → ピンフ形だが断么九のみ指定でテスト。
//    門前ロンでピンフ非成立にするため雀頭を役牌でない数牌、待ちを嵌張にして40符化。
//    234m 567m 345p 678p 55s で 4p嵌張ロン → 副底20+門前ロン10+嵌張2=32→40符
test('3. 断么九のみ ロン 子 → 1翻40符 1300', () => {
  const r = scoreHand(
    base({
      hand: ['2m', '3m', '4m', '5m', '6m', '7m', '3p', '4p', '5p', '6p', '7p', '8p', '5s', '5s'],
      winningTile: '4p', // 35p の嵌張4p
      winType: 'ron',
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  const names = r.yaku.map((y) => y.name);
  assert.ok(names.includes('断么九'));
  assert.strictEqual(r.han, 1);
  assert.strictEqual(r.fu, 40);
  assert.strictEqual(r.points.ron, 1300);
});

// 4. 七対子 門前ロン → 25符2翻 子ロン 1600
test('4. 七対子 門前ロン → 25符2翻 1600', () => {
  const r = scoreHand(
    base({
      hand: ['1m', '1m', '4m', '4m', '7m', '7m', '2p', '2p', '5p', '5p', '8p', '8p', '3s', '3s'],
      winningTile: '3s',
      winType: 'ron',
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  assert.strictEqual(r.fu, 25);
  assert.strictEqual(r.han, 2);
  assert.ok(r.yaku.map((y) => y.name).includes('七対子'));
  assert.strictEqual(r.points.ron, 1600);
});

// 5. 暗刻4つ門前ツモ単騎 → 四暗刻（役満）として扱われること
//    111m 777m 333p 555s 99s 単騎9sツモ。menzen で暗刻4つ → 四暗刻。
test('5. 暗刻4つ門前ツモ単騎 → 四暗刻(役満)', () => {
  const r = scoreHand(
    base({
      hand: ['1m', '1m', '1m', '7m', '7m', '7m', '3p', '3p', '3p', '5s', '5s', '5s', '9s', '9s'],
      winningTile: '9s', // 単騎ツモ（雀頭）→ 暗刻4つ温存
      winType: 'tsumo',
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  assert.strictEqual(r.yakuman, 1);
  assert.ok(r.yaku.map((y) => y.name).includes('四暗刻'));
});

// 5b. 対々和三暗刻（明刻1つ混ぜて四暗刻を回避）: ポン1組
//    111m(ポン明刻) 333p暗 555s暗 777m暗 99s。対々和2+三暗刻2=4翻。
//    非門前なのでツモ符付与。
test('5b. 対々和三暗刻（ポン込み） 子ロン', () => {
  const r = scoreHand(
    base({
      hand: ['7m', '7m', '7m', '3p', '3p', '3p', '5s', '5s', '5s', '9s', '9s'],
      melds: [{ type: 'pon', tiles: ['1m', '1m', '1m'], open: true }],
      winningTile: '9s',
      winType: 'ron',
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  const names = r.yaku.map((y) => y.name);
  assert.ok(names.includes('対々和'), names.join(','));
  assert.ok(names.includes('三暗刻'), names.join(','));
  assert.strictEqual(r.han, 4);
});

// 6. 混一色 / 清一色 食い下がり
test('6a. 混一色 門前 = 3翻 / 6b. 清一色 門前 = 6翻', () => {
  // 混一色 門前ロン: 123m 456m 789m 11m... 字牌込み単一スート
  // 手: 123m 345m 678m 99m + 555z(白) → 副露なし門前
  const hon = scoreHand(
    base({
      hand: ['1m', '2m', '3m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '9m', '5z', '5z', '5z'],
      winningTile: '1m',
      winType: 'ron',
    })
  );
  assert.strictEqual(hon.valid, true, hon.error || '');
  const hn = hon.yaku.map((y) => y.name);
  assert.ok(hn.includes('混一色'), hn.join(','));
  // 混一色3翻 + 役牌白1翻 = 4翻
  const honitsuYaku = hon.yaku.find((y) => y.name === '混一色');
  assert.strictEqual(honitsuYaku.han, 3); // 門前

  // 清一色 門前: 全て萬子14枚（九蓮形を避ける）
  // 123m 234m 567m 789m 5m5m, 和了牌=3m(両面)
  const chin = scoreHand(
    base({
      hand: ['1m', '2m', '3m', '2m', '3m', '4m', '5m', '6m', '7m', '7m', '8m', '9m', '5m', '5m'],
      winningTile: '3m',
      winType: 'ron',
    })
  );
  assert.strictEqual(chin.valid, true, chin.error || '');
  const chinitsu = chin.yaku.find((y) => y.name === '清一色');
  assert.ok(chinitsu, chin.yaku.map((y) => y.name).join(','));
  assert.strictEqual(chinitsu.han, 6); // 門前
});

test('6c. 混一色 副露（チー）= 食い下がり2翻', () => {
  // 食い下がり確認: 副露ありの混一色
  const r = scoreHand(
    base({
      hand: ['3m', '4m', '5m', '6m', '7m', '8m', '9m', '9m', '5z', '5z', '5z'],
      melds: [{ type: 'chi', tiles: ['1m', '2m', '3m'], open: true }],
      winningTile: '9m',
      winType: 'ron',
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  const h = r.yaku.find((y) => y.name === '混一色');
  assert.ok(h, r.yaku.map((y) => y.name).join(','));
  assert.strictEqual(h.han, 2); // 食い下がり
});

// 7. 国士無双 — 親ロン48000 / 子ロン32000
test('7. 国士無双 役満 親ロン48000 / 子ロン32000', () => {
  const hand = ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z', '1m'];
  const dealer = scoreHand(base({ hand, winningTile: '1m', winType: 'ron', seatWind: '1z' }));
  assert.strictEqual(dealer.valid, true, dealer.error || '');
  assert.strictEqual(dealer.yakuman, 1);
  assert.ok(dealer.yaku.map((y) => y.name).includes('国士無双'));
  assert.strictEqual(dealer.points.ron, 48000);

  const nonDealer = scoreHand(base({ hand, winningTile: '1m', winType: 'ron', seatWind: '2z' }));
  assert.strictEqual(nonDealer.points.ron, 32000);
});

// 8. 四暗刻 ツモ（子）→ 役満 子ツモ 8000オール? いや子は 16000(8000親/各?)
//    子の役満ツモ: 親8000 + 子4000×2 = 16000 → 役満 base8000, 子ツモ: 親16000?
//    子役満ツモ total=32000? 計算: base=8000, 子ツモ dealerPay=base*2=16000, nonDealer=base*1=8000
//    total = 16000 + 8000*2 = 32000
test('8. 四暗刻 子ツモ → 役満 16000/8000 total32000', () => {
  const r = scoreHand(
    base({
      hand: ['2m', '2m', '2m', '5p', '5p', '5p', '8s', '8s', '8s', '3z', '3z', '3z', '9m', '9m'],
      winningTile: '9m', // 単騎ツモ
      winType: 'tsumo',
      seatWind: '2z',
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  assert.strictEqual(r.yakuman, 1);
  assert.ok(r.yaku.map((y) => y.name).includes('四暗刻'));
  assert.strictEqual(r.points.tsumo.dealer, 16000);
  assert.strictEqual(r.points.tsumo.nonDealer, 8000);
  assert.strictEqual(r.points.total, 32000);
});

// 9. 大三元（子ロン）→ 役満 32000
test('9. 大三元 子ロン → 役満 32000', () => {
  const r = scoreHand(
    base({
      hand: ['5z', '5z', '5z', '6z', '6z', '6z', '7z', '7z', '7z', '2m', '3m', '4m', '9p', '9p'],
      winningTile: '4m',
      winType: 'ron',
      seatWind: '2z',
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  assert.strictEqual(r.yakuman, 1);
  assert.ok(r.yaku.map((y) => y.name).includes('大三元'));
  assert.strictEqual(r.points.ron, 32000);
});

// 10. ドラ/赤ドラ検証: 断么九 + 赤5m + ドラ
//     手: 234m 567m(5mを赤0mに) 345p 678p 55s, ロン4p嵌張
//     断么九1 + 赤1 + ドラ(表示3p→ドラ4p, 手に4p... 和了牌4p=ドラ1)
//     han = 断么九1 + dora1 + aka1 = 3翻40符 子ロン: base=40*2^5=1280, ×4=5120→5200
test('10. ドラ/赤検証: 断么九+赤1+ドラ1 → 3翻40符 5200', () => {
  const r = scoreHand(
    base({
      hand: ['2m', '3m', '4m', '0m', '6m', '7m', '3p', '4p', '5p', '6p', '7p', '8p', '5s', '5s'],
      winningTile: '4p', // 35p 嵌張
      winType: 'ron',
      doraIndicators: ['3p'], // ドラ=4p。手に4p 1枚(和了牌)
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  assert.strictEqual(r.aka, 1, '赤5m');
  assert.strictEqual(r.dora, 1, 'ドラ4p');
  assert.ok(r.yaku.map((y) => y.name).includes('断么九'));
  assert.strictEqual(r.han, 3); // 断么九1 + 赤1 + ドラ1
  assert.strictEqual(r.fu, 40);
  assert.strictEqual(r.points.ron, 5200);
});

// 12. 門前フラグの尊重: menzen:false で門前限定役（門前清自摸和/平和）が落ちること。
//     副露が無くても「門前を外す」と非門前として採点される（手入力で開いた手を表現できる）。
test('12. menzen:false で門前清自摸和・平和が外れる（門前トグルが効く）', () => {
  const hand = ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '7p', '8p', '9p', '3s', '3s'];
  const closed = scoreHand(base({ hand, winningTile: '4m', winType: 'tsumo' }));
  assert.strictEqual(closed.valid, true, closed.error || '');
  const cn = closed.yaku.map((y) => y.name);
  assert.ok(cn.includes('門前清自摸和'), cn.join(','));
  assert.ok(cn.includes('平和'), cn.join(','));

  // 門前を外す → 門前限定役は消える。この手は他に役が無いので役なし。
  const open = scoreHand(base({ hand, winningTile: '4m', winType: 'tsumo', menzen: false }));
  const on = open.yaku.map((y) => y.name);
  assert.ok(!on.includes('門前清自摸和'), on.join(','));
  assert.ok(!on.includes('平和'), on.join(','));
});

// 13. 四暗刻は門前限定: 11122233344455m を「門前」だとツモ四暗刻だが、
//     門前を外す（鳴いた手）と四暗刻にならない（対々和・清一色 等）。
test('13. 11122233344455m は門前ツモのみ四暗刻、非門前では役満にしない', () => {
  const hand = ['1m', '1m', '1m', '2m', '2m', '2m', '3m', '3m', '3m', '4m', '4m', '4m', '5m', '5m'];

  // 門前ツモ（既定）→ 四暗刻（役満）
  const closed = scoreHand(base({ hand, winningTile: '1m', winType: 'tsumo' }));
  assert.strictEqual(closed.valid, true, closed.error || '');
  assert.strictEqual(closed.yakuman, 1, '門前ツモは四暗刻');
  assert.ok(closed.yaku.map((y) => y.name).includes('四暗刻'));

  // 門前を外す → 役満にならない（四暗刻不成立）
  const open = scoreHand(base({ hand, winningTile: '1m', winType: 'tsumo', menzen: false }));
  assert.strictEqual(open.valid, true, open.error || '');
  assert.strictEqual(open.yakuman, 0, '非門前は四暗刻にならない');
  assert.ok(!open.yaku.map((y) => y.name).includes('四暗刻'));
});

// 14. 暗槓込みの手が採点され、暗槓は門前を維持する（カンを宣言できる）。
test('14. 暗槓込みの手が採点され門前を維持', () => {
  const r = scoreHand(
    base({
      hand: ['2p', '3p', '4p', '5p', '6p', '7p', '2s', '3s', '4s', '9s', '9s'], // 11枚=3面子+雀頭
      melds: [{ type: 'kan', tiles: ['1m', '1m', '1m', '1m'], open: false }], // 暗槓
      winningTile: '4s',
      winType: 'tsumo',
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  assert.ok(r.yaku.map((y) => y.name).includes('門前清自摸和'), '暗槓は門前を維持');
});

// 15. 明槓は門前を崩す（門前清自摸和が付かない）。断么九で和了形は維持。
test('15. 明槓は門前を崩す（断么九のみ）', () => {
  const r = scoreHand(
    base({
      hand: ['3p', '4p', '5p', '6p', '7p', '8p', '2s', '3s', '4s', '5s', '5s'],
      melds: [{ type: 'kan', tiles: ['2m', '2m', '2m', '2m'], open: true }], // 明槓
      winningTile: '4s',
      winType: 'tsumo',
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  const names = r.yaku.map((y) => y.name);
  assert.ok(!names.includes('門前清自摸和'), names.join(',')); // 非門前
  assert.ok(names.includes('断么九'), names.join(','));
});

// 16. 非門前で暗刻4つ（門前を外した状態）でも三暗刻を拾う（ankouCount>=3）。
test('16. 非門前の暗刻4つ → 三暗刻を拾う', () => {
  const r = scoreHand(
    base({
      hand: ['1m', '1m', '1m', '2m', '2m', '2m', '3m', '3m', '3m', '4m', '4m', '4m', '5m', '5m'],
      winningTile: '5m', // 単騎ロン
      winType: 'ron',
      menzen: false, // 門前を外す
    })
  );
  assert.strictEqual(r.valid, true, r.error || '');
  assert.strictEqual(r.yakuman, 0, '非門前は四暗刻にならない');
  assert.ok(r.yaku.map((y) => y.name).includes('三暗刻'), r.yaku.map((y) => y.name).join(','));
});

// 17. taggedDora（牌に直接付けたドラ印）が翻・ドラ数に加算される。
test('17. taggedDora が翻に加算される', () => {
  const h = {
    hand: ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '7p', '8p', '9p', '3s', '3s'],
    winningTile: '4m',
    winType: 'tsumo',
  };
  const noDora = scoreHand(base(h));
  const withDora = scoreHand(base({ ...h, taggedDora: 2 }));
  assert.strictEqual(noDora.valid, true, noDora.error || '');
  assert.strictEqual(withDora.dora, noDora.dora + 2);
  assert.strictEqual(withDora.han, noDora.han + 2);
});

// 11. enumerateOutcomes が役なしを除外し降順で返すこと
test('11. enumerateOutcomes 基本動作', () => {
  const outcomes = enumerateOutcomes(
    ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '6p', '7p', '8p', '3s', '3s'],
    { seatWind: '2z', roundWind: '1z' }
  );
  assert.ok(outcomes.length > 0);
  // 降順
  for (let i = 1; i < outcomes.length; i++) {
    assert.ok(outcomes[i - 1].result.points.total >= outcomes[i].result.points.total);
  }
  // 全て役あり
  for (const o of outcomes) assert.ok(o.result.valid);
});
