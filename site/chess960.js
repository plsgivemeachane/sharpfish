/* Chess960 uses Scharnagl numbers 0..959 and UCI king-to-rook castling. */
(function (root) {
  "use strict";
  var files = "abcdefgh";
  function start(id) {
    if (!Number.isInteger(id) || id < 0 || id > 959) throw new RangeError("Position must be 0..959");
    var n = id, row = Array(8).fill("");
    row[(n % 4) * 2 + 1] = "B"; n = Math.floor(n / 4);
    row[(n % 4) * 2] = "B"; n = Math.floor(n / 4);
    function empty() { return row.map(function (p, i) { return p ? -1 : i; }).filter(function (i) { return i >= 0; }); }
    row[empty()[n % 6]] = "Q"; n = Math.floor(n / 6);
    var pairs = [[0,1],[0,2],[0,3],[0,4],[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]];
    var squares = empty();
    pairs[n].forEach(function (i) { row[squares[i]] = "N"; });
    empty().forEach(function (f, i) { row[f] = "RKR"[i]; });
    var rights = row.map(function (p, i) { return p === "R" ? files[i].toUpperCase() : ""; }).join("");
    var rank = row.join("");
    return rank.toLowerCase() + "/pppppppp/8/8/8/8/PPPPPPPP/" + rank + " w " + rights + rights.toLowerCase() + " - 0 1";
  }
  function random() {
    var value = new Uint32Array(1);
    do { root.crypto.getRandomValues(value); } while (value[0] >= 4294967040);
    return value[0] % 960;
  }
  function castle(board, move) {
    var from = move.slice(0, 2), to = move.slice(2, 4), king = board[from];
    if (!king || king.toUpperCase() !== "K" || board[to] !== (king === "K" ? "R" : "r") || from[1] !== to[1]) return null;
    var right = to[0] > from[0];
    return { kingFrom: from, rookFrom: to, kingTo: (right ? "g" : "c") + from[1], rookTo: (right ? "f" : "d") + from[1], san: right ? "O-O" : "O-O-O" };
  }
  function apply(board, move) {
    var next = Object.assign({}, board), c = castle(board, move);
    var from = move.slice(0, 2), to = move.slice(2, 4), p = board[from];
    if (c) {
      delete next[c.kingFrom]; delete next[c.rookFrom];
      next[c.kingTo] = p; next[c.rookTo] = p === "K" ? "R" : "r";
    } else {
      delete next[from];
      next[to] = move[4] ? (p === p.toUpperCase() ? move[4].toUpperCase() : move[4]) : p;
      if (p.toUpperCase() === "P" && from[0] !== to[0] && !board[to]) delete next[to[0] + from[1]];
    }
    return next;
  }
  root.SF960 = { start: start, random: random, castle: castle, apply: apply };
  if (typeof module !== "undefined") module.exports = root.SF960;
})(typeof window !== "undefined" ? window : globalThis);
