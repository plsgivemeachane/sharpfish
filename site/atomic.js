/* Presentation-only blast geometry. The C++ engine owns move legality. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SFAtomic = factory();
})(typeof self === "object" ? self : globalThis, function () {
  "use strict";
  var files = "abcdefgh";
  function blast(board, move) {
    if (!move) return null;
    var from = move.slice(0, 2), to = move.slice(2, 4), piece = board[from];
    if (!piece) return null;
    var ep = piece.toUpperCase() === "P" && from[0] !== to[0] && !board[to];
    if (!board[to] && !ep) return null;
    var area = [], removed = [from], immune = [];
    if (ep) removed.push(to[0] + from[1]);
    var file = files.indexOf(to[0]), rank = Number(to[1]);
    for (var df = -1; df <= 1; df++) for (var dr = -1; dr <= 1; dr++) {
      var f = file + df, r = rank + dr;
      if (f < 0 || f > 7 || r < 1 || r > 8) continue;
      var square = files[f] + r, occupant = board[square];
      area.push(square);
      if (!occupant || square === from) continue;
      if (square === to || occupant.toUpperCase() !== "P" || removed.indexOf(square) >= 0) removed.push(square);
      else immune.push(square);
    }
    return { from: from, center: to, area: area, removed: Array.from(new Set(removed)), immune: immune };
  }
  function project(board, move) {
    var next = Object.assign({}, board), explosion = blast(board, move);
    var from = move.slice(0, 2), to = move.slice(2, 4), piece = board[from];
    if (!piece) return next;
    if (explosion) {
      explosion.removed.forEach(function (sq) { delete next[sq]; });
      delete next[to];
    } else {
      delete next[from];
      next[to] = move[4] ? (piece === piece.toUpperCase() ? move[4].toUpperCase() : move[4]) : piece;
      if (piece.toUpperCase() === "K" && Math.abs(files.indexOf(to[0]) - files.indexOf(from[0])) === 2) {
        var rook = (to[0] === "g" ? "h" : "a") + from[1];
        next[(to[0] === "g" ? "f" : "d") + from[1]] = next[rook];
        delete next[rook];
      }
    }
    return next;
  }
  return { blast: blast, project: project };
});
