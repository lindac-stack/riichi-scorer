// vision-extract.test.js — recognize.js の extractTiles() を node --test で検証。
// ライブAPIは叩かず、モデル生応答のサンプルを与えてクリーニング結果を確認する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTiles } from '../js/vision/recognize.js';

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
