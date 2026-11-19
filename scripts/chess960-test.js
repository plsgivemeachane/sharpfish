"use strict";
const assert = require('node:assert/strict');
const chess = require('../site/chess960.js');
const analysis = require('../site/analysis-core.js');
const ranks = new Set();
for (let id = 0; id < 960; id++) {
  const fen = chess.start(id), rank = fen.split('/')[7].split(' ')[0];
  ranks.add(rank);
  assert.equal(analysis.parseBoard(fen).chess960, true);
  assert.equal([...rank].sort().join(''), 'BBKNNQRR');
  const bishops = [...rank].flatMap((p, i) => p === 'B' ? [i] : []);
  assert.notEqual(bishops[0] % 2, bishops[1] % 2);
  assert(rank.indexOf('R') < rank.indexOf('K') && rank.indexOf('K') < rank.lastIndexOf('R'));
  assert.equal(fen.split('/')[0], rank.toLowerCase());
}
assert.equal(ranks.size, 960);
assert(chess.start(518).includes('RNBQKBNR w AHah'));
for (const id of [-1, 960, 1.5, NaN]) assert.throws(() => chess.start(id), RangeError);
for (const [board, move, kingTo, rookTo, san] of [
  [{e1:'K',h1:'R'}, 'e1h1','g1','f1','O-O'],
  [{b1:'K',d1:'R'}, 'b1d1','g1','f1','O-O'],
  [{g1:'K',h1:'R'}, 'g1h1','g1','f1','O-O'],
  [{e1:'K',f1:'R'}, 'e1f1','g1','f1','O-O'],
  [{f1:'K',g1:'R'}, 'f1g1','g1','f1','O-O'],
  [{d8:'k',c8:'r'}, 'd8c8','c8','d8','O-O-O'],
  [{c1:'K',a1:'R'}, 'c1a1','c1','d1','O-O-O']
]) {
  const result = chess.apply(board, move), white = move[1] === '1';
  assert.equal(result[kingTo], white ? 'K' : 'k');
  assert.equal(result[rookTo], white ? 'R' : 'r');
  assert.equal(Object.keys(result).length, 2);
  assert.equal(chess.castle(board, move).san, san);
}
assert.deepEqual(chess.apply({e5:'P',d5:'p'}, 'e5d6'), {d6:'P'});
assert.deepEqual(chess.apply({a7:'P'}, 'a7a8q'), {a8:'Q'});
console.log('PASS: all 960 unique legal setups; castling overlap/stationary cases, promotion and en passant');
