// vision-extract.test.js — recognize.js の extractTiles() を node --test で検証。
// ライブAPIは叩かず、モデル生応答のサンプルを与えてクリーニング結果を確認する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTiles, voteTiles, extractBox } from '../js/vision/recognize.js';

test('素の JSON をそのまま抽出できる', () => {
  const out = extractTiles('{"tiles": ["1m","2m","3m","1z","7z"]}');
  assert.deepEqual(out, ['1m', '2m', '3m', '1z', '7z']);
});

test('```json コードフェンス付きを剥がして抽出', () => {
  const text = '```json\n{"tiles": ["5p","0p","6z"]}\n```';
  assert.deepEqual(extractTiles(text), ['5p', '0p', '6z']);
});

test('言語指定なしの ``` フェンスも剥がす', () => {
  const text = '```\n{"tiles": ["9s","9s","9s"]}\n```';
  assert.deepEqual(extractTiles(text), ['9s', '9s', '9s']);
});

test('前後に説明文があっても最初の {...} を拾う', () => {
  const text = 'Here are the tiles I found:\n{"tiles": ["1p","2p","3p"]}\nHope this helps!';
  assert.deepEqual(extractTiles(text), ['1p', '2p', '3p']);
});

test('無効トークンは捨て、有効牌は残す', () => {
  const text = '{"tiles": ["1m","XX","10m","2m","banana","3z","0m","9z","  4s "]}';
  // 10m(不正), XX, banana, 9z(字牌は7まで) は除外。"  4s " は trim される。
  assert.deepEqual(extractTiles(text), ['1m', '2m', '3z', '0m', '4s']);
});

test('大文字表記を正規化して受理', () => {
  assert.deepEqual(extractTiles('{"tiles": ["1M","2P","3S","1Z"]}'), ['1m', '2p', '3s', '1z']);
});

test('JSON 内に余分なキーがあっても tiles だけ使う', () => {
  const text = '{"confidence": 0.9, "tiles": ["7m","8m","9m"], "note": "ok"}';
  assert.deepEqual(extractTiles(text), ['7m', '8m', '9m']);
});

test('配列直書きにも対応', () => {
  assert.deepEqual(extractTiles('["1s","2s","3s"]'), ['1s', '2s', '3s']);
});

test('壊れた JSON は空配列', () => {
  assert.deepEqual(extractTiles('{"tiles": ["1m", "2m"'), []);
});

test('JSON が無いテキストは空配列', () => {
  assert.deepEqual(extractTiles('I could not read any tiles.'), []);
});

test('null/空文字は空配列', () => {
  assert.deepEqual(extractTiles(''), []);
  assert.deepEqual(extractTiles(null), []);
});

test('赤五 0m/0p/0s は有効、0z は無効', () => {
  assert.deepEqual(extractTiles('{"tiles":["0m","0p","0s","0z"]}'), ['0m', '0p', '0s']);
});

// ---- voteTiles（自己整合アンサンブル）----

test('voteTiles: 単一runはそのまま', () => {
  assert.deepEqual(voteTiles([['1m', '2m', '3m']]), ['1m', '2m', '3m']);
});

test('voteTiles: 過半数のrunに出た牌だけ採用（少数派は捨てる）', () => {
  const runs = [
    ['1m', '2m', '3m', '9p'],
    ['1m', '2m', '3m'],
    ['1m', '2m', '3m', '5s'], // 9p/5s は1回ずつ＝過半数未満で除外
  ];
  const out = voteTiles(runs).sort();
  assert.deepEqual(out, ['1m', '2m', '3m']);
});

test('voteTiles: 枚数はパス間の中央値で決める', () => {
  // 1z は [3,1,3] -> 中央値3枚、2回出現で過半数
  const runs = [['1z', '1z', '1z'], ['1z'], ['1z', '1z', '1z']];
  assert.deepEqual(voteTiles(runs), ['1z', '1z', '1z']);
});

test('voteTiles: 同一牌は最大4枚に切り詰める', () => {
  const runs = [
    ['7p', '7p', '7p', '7p', '7p', '7p'],
    ['7p', '7p', '7p', '7p', '7p', '7p'],
    ['7p', '7p', '7p', '7p', '7p', '7p'],
  ];
  assert.deepEqual(voteTiles(runs), ['7p', '7p', '7p', '7p']);
});

test('voteTiles: 空入力は空配列', () => {
  assert.deepEqual(voteTiles([]), []);
});

// ---- extractBox（2パス認識 Pass 1）----

test('extractBox: {"box":{x0..}} を抽出', () => {
  assert.deepEqual(
    extractBox('{"box": {"x0": 0.1, "y0": 0.4, "x1": 0.9, "y1": 0.7}}'),
    { x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.7 },
  );
});

test('extractBox: コードフェンス/前後文があっても拾う', () => {
  const t = 'Here:\n```json\n{"box":{"x0":0,"y0":0,"x1":1,"y1":1}}\n```';
  assert.deepEqual(extractBox(t), { x0: 0, y0: 0, x1: 1, y1: 1 });
});

test('extractBox: {x,y,w,h} 形式に対応', () => {
  assert.deepEqual(extractBox('{"x":0.2,"y":0.2,"w":0.5,"h":0.3}'),
    { x0: 0.2, y0: 0.2, x1: 0.7, y1: 0.5 });
});

test('extractBox: 範囲外座標は [0,1] にクランプ', () => {
  assert.deepEqual(extractBox('{"box":{"x0":-0.2,"y0":0.1,"x1":1.5,"y1":0.9}}'),
    { x0: 0, y0: 0.1, x1: 1, y1: 0.9 });
});

test('extractBox: box:null / 退化した box / 非JSON は null', () => {
  assert.equal(extractBox('{"box": null}'), null);
  assert.equal(extractBox('{"box":{"x0":0.5,"y0":0.5,"x1":0.5,"y1":0.5}}'), null); // x1<=x0
  assert.equal(extractBox('no json here'), null);
  assert.equal(extractBox(''), null);
});
