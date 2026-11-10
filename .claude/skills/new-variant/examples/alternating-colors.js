// Rule check for the alternating-colors variant (branch alternating-colors):
// each engine move must land on the opposite square color from the engine's
// previous move, except when the engine is in check.
//
// ctx: { move, moves, ply, color, inCheck, engineMoves: [{ move, ply, inCheck }], allowed }
// Return true if the move follows the rule, or a string saying why not.

// Stockfish encodes castling as "king takes own rook"; the king lands on g/c.
const CASTLE = { e1h1: "g1", e1a1: "c1", e8h8: "g8", e8a8: "c8" };
const dest = m => CASTLE[m] || m.slice(2, 4);
const light = sq => ((sq.charCodeAt(0) - 97) + (sq.charCodeAt(1) - 49)) & 1;

exports.check = function (ctx) {
  const prev = ctx.engineMoves[ctx.engineMoves.length - 1];
  if (!prev || ctx.inCheck) return true; // first move and check evasions are free
  return light(dest(ctx.move)) !== light(dest(prev.move))
    ? true
    : `lands on the same color as the previous engine move ${prev.move}`;
};
