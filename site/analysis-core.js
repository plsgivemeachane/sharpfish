/* Sharpfish analysis core. Browser UMD module with no dependencies. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SFAnalysis = api;
}(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = "1.5.1";
  var GRADE_TIME_MS = 2000;
  function gradeTime(value) { return Number.isFinite(value) ? Math.max(1000, Math.min(30000, Math.floor(value))) : GRADE_TIME_MS; }
  function now() { return typeof performance === "object" ? performance.now() : Date.now(); }
  var START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  var RESULT = { "1-0": true, "0-1": true, "1/2-1/2": true, "*": true };
  var FILES = "abcdefgh";
  var PIECES = "pnbrqkPNBRQK";

  function fail(message, index) {
    var e = new Error(message + (index == null ? "" : " (at token " + index + ")"));
    e.code = "PGN_ERROR";
    e.index = index;
    throw e;
  }
  function cleanTag(v) { return String(v).replace(/\\([\\"])/g, "$1"); }
  function normalizeSan(s) {
    return String(s).trim().replace(/[!?]+$/g, "").replace(/[+#]+$/g, "").replace(/0/g, "O").replace(/e\.p\.?$/i, "");
  }
  function parseBoard(fen) {
    var p = String(fen).trim().split(/\s+/);
    if (p.length < 4 || p.length > 6 || !/^[wb]$/.test(p[1])) fail("Invalid FEN");
    var board = {};
    var ranks = p[0].split("/");
    if (ranks.length !== 8) fail("Invalid FEN: expected 8 ranks");
    ranks.forEach(function (row, ri) {
      var file = 0;
      for (var i = 0; i < row.length; ++i) {
        var c = row[i];
        if (/^[1-8]$/.test(c)) file += +c;
        else if (PIECES.indexOf(c) >= 0 && file < 8) board[FILES[file++] + (8 - ri)] = c;
        else fail("Invalid FEN board");
      }
      if (file !== 8) fail("Invalid FEN rank");
    });
    var squares = Object.keys(board);
    if (squares.filter(function (sq) { return board[sq] === "K"; }).length !== 1 || squares.filter(function (sq) { return board[sq] === "k"; }).length !== 1) fail("FEN must contain exactly one king per side");
    var wk = squares.filter(function (sq) { return board[sq] === "K"; })[0], bk = squares.filter(function (sq) { return board[sq] === "k"; })[0];
    if (Math.abs(FILES.indexOf(wk[0]) - FILES.indexOf(bk[0])) <= 1 && Math.abs(+wk[1] - +bk[1]) <= 1) fail("FEN kings may not be adjacent");
    if (p[2] !== "-" && (!/^[KQkq]+$/.test(p[2]) || /(.).*\1/.test(p[2]))) fail("Invalid FEN castling rights");
    if (p[3] !== "-" && !/^[a-h][36]$/.test(p[3])) fail("Invalid FEN en-passant square");
    if (p.length >= 5 && (!/^\d+$/.test(p[4]) || +p[4] < 0)) fail("Invalid FEN halfmove clock");
    if (p.length >= 6 && (!/^\d+$/.test(p[5]) || +p[5] < 1)) fail("Invalid FEN fullmove number");
    if (squares.some(function (sq) { return /[pP]/.test(board[sq]) && /[18]/.test(sq[1]); })) fail("FEN pawn on promotion rank");
    if (+p[4] > 100000 || +p[5] > 100000) fail("FEN move clock is too large");
    var rights = { K: ["e1", "K", "h1", "R"], Q: ["e1", "K", "a1", "R"], k: ["e8", "k", "h8", "r"], q: ["e8", "k", "a8", "r"] };
    if (p[2] !== "-") p[2].split("").forEach(function (right) {
      var required = rights[right];
      if (board[required[0]] !== required[1] || board[required[2]] !== required[3]) fail("FEN castling rights require the king and rook");
    });
    if (p[3] !== "-") {
      if (p[3][1] !== (p[1] === "w" ? "6" : "3") || board[p[3]] || board[p[3][0] + (p[1] === "w" ? "5" : "4")] !== (p[1] === "w" ? "p" : "P")) fail("Invalid FEN en-passant state");
    }
    if (attacked(board, p[1] === "w" ? bk : wk, p[1] === "w")) fail("FEN side not to move is in check");
    p[4] = p[4] || "0"; p[5] = p[5] || "1";
    return { fen: p.join(" "), board: board, turn: p[1], halfmove: +(p[4] || 0), fullmove: +(p[5] || 1), castling: p[2], ep: p[3] };
  }
  function boardFromFen(fen) { return parseBoard(fen).board; }
  function sanCore(pos, uci) {
    var from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4];
    var piece = pos.board[from];
    if (!piece) return "";
    var type = piece.toUpperCase();
    var dx = FILES.indexOf(to[0]) - FILES.indexOf(from[0]);
    if (type === "K" && Math.abs(dx) === 2) return dx > 0 ? "O-O" : "O-O-O";
    var capture = !!pos.board[to] || (type === "P" && dx !== 0);
    if (type === "P") return (capture ? from[0] + "x" : "") + to + (promo ? "=" + promo.toUpperCase() : "");
    var san = type;
    var rivals = (pos.legal || []).filter(function (m) { return m !== uci && m.slice(2, 4) === to && pos.board[m.slice(0, 2)] === piece; }).map(function (m) { return m.slice(0, 2); });
    if (rivals.length) {
      var file = rivals.some(function (s) { return s[0] === from[0]; });
      var rank = rivals.some(function (s) { return s[1] === from[1]; });
      san += !file ? from[0] : !rank ? from[1] : from;
    }
    return san + (capture ? "x" : "") + to;
  }
  function tokenize(text) {
    text = String(text || "").replace(/\r/g, "");
    var tags = Object.create(null), body = text, tokens = [], i = 0, started = false;
    while (i < body.length) {
      if (/\s/.test(body[i])) { ++i; continue; }
      if (body[i] === "[") {
        if (started) fail("Only one game per import is supported");
        var tag = body.slice(i).match(/^\[\s*([A-Za-z0-9_]+)\s+"((?:\\[\\"]|[^"\\])*)"\s*\]/);
        if (!tag || Object.prototype.hasOwnProperty.call(tags, tag[1])) fail("Invalid or duplicate PGN tag");
        tags[tag[1]] = cleanTag(tag[2]); i += tag[0].length; continue;
      }
      if (body[i] === "{") { var end = body.indexOf("}", i + 1); if (end < 0) fail("Unclosed PGN comment"); i = end + 1; continue; }
      if (body[i] === ";") { var nl = body.indexOf("\n", i + 1); i = nl < 0 ? body.length : nl + 1; continue; }
      if (body[i] === "(") { tokens.push("("); ++i; continue; }
      if (body[i] === ")") { tokens.push(")"); ++i; continue; }
      if (body[i] === "}") fail("Unexpected PGN comment close");
      started = true;
      var j = i;
      while (j < body.length && !/[\s{}();]/.test(body[j])) ++j;
      tokens.push(body.slice(i, j)); i = j;
    }
    return { tags: tags, tokens: tokens };
  }
  function parsePgn(text, limits) {
    limits = limits || {};
    if (String(text || "").length > (limits.maxBytes || 1024 * 1024)) fail("PGN is too large");
    var data = tokenize(text), tokens = data.tokens, main = [], depth = 0, variations = 0, result = data.tags.Result || "*";
    if (!RESULT[result]) fail("Invalid PGN result");
    var sawResult = false;
    for (var i = 0; i < tokens.length; ++i) {
      var t = tokens[i];
      if (t === "(") { if (++depth > (limits.maxVariationDepth || 8)) fail("PGN variation nesting is too deep", i); ++variations; continue; }
      if (t === ")") { if (!depth--) fail("Unexpected variation close", i); continue; }
      if (depth) continue;
      var compact = t.match(/^(\d+)\.(\.\.)?(.+)$/);
      if (compact) { t = compact[3]; if (!t) continue; }
      if (/^\$\d+$/.test(t) || /^\d+\.(\.\.)?$/.test(t) || /^\.+$/.test(t)) continue;
      if (RESULT[t]) { if (sawResult) fail("Only one game per import is supported", i); if (result !== "*" && result !== t) fail("Conflicting PGN result", i); result = t; sawResult = true; continue; }
      if (/^[!?+#=]+$/.test(t)) continue;
      if (sawResult) fail("Moves found after PGN result", i);
      if (!/^(?:O-O(?:-O)?|0-0(?:-0)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?[!?]*$/.test(t)) fail("Invalid SAN token: " + t, i);
      main.push(t);
      if (main.length > (limits.maxMoves || 4000)) fail("PGN has too many moves", i);
    }
    if (depth) fail("Unclosed PGN variation");
    if (data.tags.SetUp === "1" && !data.tags.FEN) fail("SetUp tag requires FEN");
    if (data.tags.SetUp && data.tags.SetUp !== "0" && data.tags.SetUp !== "1") fail("Invalid SetUp tag");
    if (data.tags.SetUp === "0" && data.tags.FEN) fail("FEN conflicts with SetUp tag");
    if (data.tags.Variant && data.tags.Variant.toLowerCase() !== "standard") fail("Unsupported PGN variant");
    var start = data.tags.FEN ? parseBoard(data.tags.FEN).fen : null;
    return { headers: data.tags, tokens: main, result: result, variationCount: variations, startFen: start };
  }

  function expectedScore(ev, side) {
    if (!ev) return null;
    var white;
    if (ev.mateWinner) white = ev.mateWinner === "w" ? 1 : 0;
    else if (ev.mate != null) white = ev.mate > 0 ? 1 : 0;
    else if (ev.wdl && ev.wdl.length === 3) white = (ev.wdl[0] + ev.wdl[1] / 2) / 1000;
    else if (ev.cp != null && Number.isFinite(ev.cp)) white = 1 / (1 + Math.exp(-0.00368208 * ev.cp));
    else return null;
    return side === "b" ? 1 - white : white;
  }
  // CP scores are White-oriented. Mate remains a separate ordered outcome.
  function centipawnLoss(best, played, side) {
    if (!best || !played || !Number.isFinite(best.cp) || !Number.isFinite(played.cp)) return null;
    return (side === "b" ? -1 : 1) * (best.cp - played.cp);
  }
  function moverScore(ev, side) {
    if (ev && ev.mateWinner) return ev.mateWinner === (side || "w") ? Infinity : -Infinity;
    return ev && Number.isFinite(ev.cp) ? ev.cp * (side === "b" ? -1 : 1) : null;
  }
  // Keep ordinary/lost positions linear; compress the surplus of a large win.
  function qualityScore(cp) { return cp <= 300 ? cp : 300 + 100 * Math.log1p((cp - 300) / 100); }
  function scoresConflict(best, played, side, tolerance) {
    var cp = centipawnLoss(best, played, side);
    if (cp != null) return cp < -(tolerance || 20);
    var a = moverScore(best, side), b = moverScore(played, side);
    if (a == null || b == null) return true;
    if (a !== b) return b > a;
    if (!best.mateWinner) return false;
    return best.mateWinner === (side || "w") ? Math.abs(played.mate) < Math.abs(best.mate) : Math.abs(played.mate) > Math.abs(best.mate);
  }
  var LABELS = ["Best", "Excellent", "Good", "OK", "Inaccuracy", "Mistake", "Blunder", "Disaster", "Catastrophe"];
  function objectiveLabel(loss) {
    if (!Number.isFinite(loss) || loss < 0) throw new Error("Invalid centipawn loss");
    if (loss <= 10) return "Best";
    if (loss <= 25) return "Excellent";
    if (loss <= 50) return "Good";
    if (loss <= 75) return "OK";
    if (loss <= 125) return "Inaccuracy";
    if (loss <= 250) return "Mistake";
    if (loss <= 500) return "Blunder";
    return "Disaster";
  }
  function worsensShortMate(best, played, side) {
    var opponent = side === "b" ? "w" : "b";
    return !!(best && played && played.mateWinner === opponent && Number.isFinite(played.mate) &&
      Math.abs(played.mate) >= 1 && Math.abs(played.mate) <= 5 &&
      (best.mateWinner !== opponent || Math.abs(best.mate) > Math.abs(played.mate)));
  }
  function classify(input) {
    input = input || {};
    var loss = centipawnLoss(input.best, input.played, input.side), qualityLoss = null, objective, mateChange = null;
    if (loss == null && Number.isFinite(input.loss)) loss = input.loss;
    if (loss != null) {
      if (loss < -20) throw new Error("Played move score conflicts with best score; deeper analysis needed");
      loss = Math.max(0, loss); qualityLoss = loss;
      if (input.best && input.played && Number.isFinite(input.best.cp) && Number.isFinite(input.played.cp) && !input.best.mateWinner && !input.played.mateWinner) {
        qualityLoss = Math.max(0, qualityScore(moverScore(input.best, input.side)) - qualityScore(moverScore(input.played, input.side)));
      }
      objective = objectiveLabel(qualityLoss);
    } else {
      var best = input.best, played = input.played, side = input.side || "w", opponent = side === "w" ? "b" : "w";
      if (!best || !played || !best.mateWinner && !played.mateWinner) throw new Error("Cannot classify an incomplete engine score");
      if (scoresConflict(best, played, side)) throw new Error("Played move score conflicts with best score; deeper analysis needed");
      if (best.mateWinner && best.mateWinner === played.mateWinner) {
        var bestDistance = Math.abs(best.mate), playedDistance = Math.abs(played.mate);
        mateChange = { winner: played.mateWinner, bestDistance: bestDistance, playedDistance: playedDistance };
        objective = bestDistance === playedDistance ? "Best" : played.mateWinner === opponent ? "Blunder" : "Good";
      } else if (played.mateWinner === opponent) objective = "Disaster";
      else if (played.mateWinner === side) objective = "Best";
      else {
        var remaining = moverScore(played, side);
        objective = remaining >= 300 ? "Inaccuracy" : remaining >= 0 ? "Mistake" : remaining >= -200 ? "Blunder" : "Disaster";
      }
    }
    var opponent = input.side === "b" ? "w" : "b", mate = input.mateEvidence;
    // Only verified, newly allowed or accelerated M1-M5 can earn the last tier.
    if (worsensShortMate(input.best, input.played, input.side) && mate && mate.winner === opponent &&
        Number.isInteger(mate.distance) && mate.distance >= 1 && mate.distance <= 5 &&
        (input.best.mateWinner !== opponent || Math.abs(input.best.mate) > mate.distance) &&
        mate.confirmed === true && mate.depth > 0 && mate.bestDepth > 0) objective = "Catastrophe";
    var idx = LABELS.indexOf(objective), d = input.difficulty || {};
    var discovery = d.discoverability === "very-hard" ? 2 : d.discoverability === "hard" ? 1 : 0;
    var natural = d.naturalness === "very-unnatural" ? 2 : d.naturalness === "unnatural" ? 1 : 0;
    var hard = discovery + natural + (d.delayed ? 1 : 0), adjustment = 0;
    if (hard >= 1) adjustment = hard >= 4 ? 2 : 1;
    if (!hard && d.discoverability === "very-easy" && d.naturalness === "very-natural" && d.immediate === true && (loss >= 25 || idx >= 6)) adjustment = -1;
    var worst = objective === "Catastrophe" ? 8 : 7;
    var finalIdx = objective === "Best" ? 0 : Math.max(1, Math.min(worst, idx - adjustment));
    var label = LABELS[finalIdx];
    if (input.brilliant === true && idx <= 1) label = "Brilliant";
    else if (input.great === true && idx <= 1) label = "Great";
    return { label: label, key: label.toLowerCase(), objectiveLabel: objective, adjustment: idx - finalIdx,
      lossCp: loss, qualityLossCp: qualityLoss, lossPoints: loss == null ? null : loss / 100, mateChange: mateChange, model: "centipawn", difficulty: d,
      mateEvidence: mate || null, version: VERSION };
  }

  function parseInfo(lines, turn, count) {
    var depths = {};
    lines.forEach(function (line) {
      if (!/^info depth\b/.test(line) || /\b(?:lowerbound|upperbound)\b/.test(line)) return;
      var depth = line.match(/\bdepth (\d+)/), score = line.match(/\bscore (cp|mate) (-?\d+)/);
      if (!depth || !score) return;
      var mpv = +(line.match(/\bmultipv (\d+)/) || [0, 1])[1];
      var pv = line.match(/\bpv\s+(.+)$/), wdl = line.match(/\bwdl (\d+) (\d+) (\d+)/);
      var n = +score[2] * (turn === "w" ? 1 : -1);
      var row = { cp: score[1] === "cp" ? n : null, mate: score[1] === "mate" ? n : null,
        depth: +depth[1], pv: pv ? pv[1].trim().split(/\s+/) : [], wdl: null };
      if (row.mate != null) row.mateWinner = +score[2] === 0 ? (turn === "w" ? "b" : "w") : n > 0 ? "w" : "b";
      if (wdl) row.wdl = turn === "w" ? [+wdl[1], +wdl[2], +wdl[3]] : [+wdl[3], +wdl[2], +wdl[1]];
      (depths[row.depth] || (depths[row.depth] = {}))[mpv] = row;
    });
    var completed = Object.keys(depths).map(Number).sort(function (a, b) { return b - a; }).find(function (depth) {
      for (var i = 1; i <= count; i++) if (!depths[depth][i]) return false;
      return true;
    });
    if (completed == null) throw new Error("Engine returned no completed exact evaluation");
    var result = Object.assign({}, depths[completed][1]);
    result.alternatives = [];
    for (var i = 1; i <= count; i++) result.alternatives.push(depths[completed][i]);
    result.scoreText = result.mate != null ? (result.mateWinner === "b" ? "−M" : "M") + Math.abs(result.mate) :
      (result.cp >= 0 ? "+" : "") + (result.cp / 100).toFixed(2);
    return result;
  }

  // Match performance v1: an explicit heuristic, independent of human labels.
  // Mate transitions use the objective tier's loss proxy, never its adjusted label.
  var MATE_PERFORMANCE_LOSS = { Best: 0, Good: 40, Inaccuracy: 100, Mistake: 180, Blunder: 350, Disaster: 700, Catastrophe: 1000 };
  function performanceLoss(grade) {
    if (!grade) return null;
    if (Number.isFinite(grade.qualityLossCp) && grade.qualityLossCp >= 0) return Math.min(1000, grade.qualityLossCp);
    if (Number.isFinite(grade.lossCp) && grade.lossCp >= 0) return Math.min(1000, grade.lossCp);
    var raw = grade.raw;
    if (raw && raw.best && raw.played && (raw.best.mateWinner || raw.played.mateWinner) &&
        Object.prototype.hasOwnProperty.call(MATE_PERFORMANCE_LOSS, grade.objectiveLabel)) return MATE_PERFORMANCE_LOSS[grade.objectiveLabel];
    return null;
  }
  function performanceSummary(record, grades) {
    function empty() { return { total: 0, analyzed: 0, decisions: 0, accuracy: null, elo: null, averageLossCp: null }; }
    var result = { w: empty(), b: empty(), minDecisions: 5 }, sums = { w: { accuracy: 0, loss: 0 }, b: { accuracy: 0, loss: 0 } };
    var initial = record && record.startFen ? parseBoard(record.startFen).turn : "w";
    ((record && record.moves) || []).forEach(function (_, index) {
      var pos = record.boards && record.boards[index], grade = grades && grades[index];
      var side = grade && grade.side || pos && pos.turn || (index % 2 ? initial === "w" ? "b" : "w" : initial);
      var player = result[side], loss = performanceLoss(grade);
      player.total++;
      if (loss == null) return;
      player.analyzed++; sums[side].accuracy += 100 * Math.exp(-loss / 200);
      var choices = grade && Number.isInteger(grade.legalMoveCount) ? grade.legalMoveCount : pos && Array.isArray(pos.legal) ? pos.legal.length : 0;
      if (choices > 1) { player.decisions++; sums[side].loss += loss; }
    });
    ["w", "b"].forEach(function (side) {
      var player = result[side];
      if (player.analyzed) player.accuracy = sums[side].accuracy / player.analyzed;
      if (player.decisions) player.averageLossCp = sums[side].loss / player.decisions;
      if (player.analyzed === player.total && player.decisions >= result.minDecisions) {
        player.elo = Math.round(Math.max(100, Math.min(2800, 2800 - 700 * Math.log1p(player.averageLossCp / 10))) / 50) * 50;
      }
    });
    return result;
  }

  var VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
  function white(piece) { return !!piece && piece === piece.toUpperCase(); }
  function attacked(board, square, byWhite) {
    var tx = FILES.indexOf(square[0]), ty = +square[1];
    return Object.keys(board).some(function (from) {
      var piece = board[from]; if (white(piece) !== byWhite) return false;
      var x = FILES.indexOf(from[0]), y = +from[1], dx = tx - x, dy = ty - y, ax = Math.abs(dx), ay = Math.abs(dy), type = piece.toUpperCase();
      if (!ax && !ay) return false;
      if (type === "P") return ax === 1 && dy === (byWhite ? 1 : -1);
      if (type === "N") return ax * ay === 2;
      if (type === "K") return Math.max(ax, ay) === 1;
      if (!(type === "B" && ax === ay || type === "R" && (!dx || !dy) || type === "Q" && (ax === ay || !dx || !dy))) return false;
      var sx = Math.sign(dx), sy = Math.sign(dy); x += sx; y += sy;
      while (x !== tx || y !== ty) { if (board[FILES[x] + y]) return false; x += sx; y += sy; }
      return true;
    });
  }
  function applyBoard(board, move) {
    var next = Object.assign({}, board), from = move.slice(0, 2), to = move.slice(2, 4), piece = next[from];
    if (!piece) return null;
    if (piece.toUpperCase() === "P" && from[0] !== to[0] && !next[to]) delete next[to[0] + from[1]];
    delete next[from]; next[to] = move[4] ? (white(piece) ? move[4].toUpperCase() : move[4]) : piece;
    if (piece.toUpperCase() === "K" && Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) === 2) {
      var rookFrom = (to[0] === "g" ? "h" : "a") + from[1], rookTo = (to[0] === "g" ? "f" : "d") + from[1];
      next[rookTo] = next[rookFrom]; delete next[rookFrom];
    }
    return next;
  }
  function material(board, side) {
    return Object.keys(board).reduce(function (sum, sq) {
      var piece = board[sq], v = VALUE[piece.toUpperCase()] || 0;
      return sum + (white(piece) === (side === "w") ? v : -v);
    }, 0);
  }
  function naturalness(pos, move) {
    var piece = pos.board[move.slice(0, 2)], target = pos.board[move.slice(2, 4)], next = applyBoard(pos.board, move);
    if (!piece || !next) return { category: "unknown", check: false, obvious: false, capture: false };
    var sideWhite = white(piece), king = Object.keys(next).find(function (sq) { return next[sq] === (sideWhite ? "k" : "K"); });
    var check = !!king && attacked(next, king, sideWhite), capture = !!target || piece.toUpperCase() === "P" && move[0] !== move[2];
    var safe = !attacked(next, move.slice(2, 4), !sideWhite), sacrifice = !safe && (!target || VALUE[target.toUpperCase()] < VALUE[piece.toUpperCase()] - 150);
    var obvious = capture && safe && target && VALUE[target.toUpperCase()] >= 300;
    return { category: obvious ? "very-natural" : sacrifice ? "unnatural" : capture || check ? "natural" : "neutral",
      check: check, obvious: !!obvious, capture: capture, sacrifice: sacrifice, quiet: !check && !capture };
  }
  function delayedPayoff(pos, pv) {
    var board = pos.board, side = pos.turn, initial = material(board, side), first = pv[0] && naturalness(pos, pv[0]);
    if (!first || !first.quiet) return false;
    for (var i = 0; i < Math.min(8, pv.length); i++) {
      board = applyBoard(board, pv[i]); if (!board) return false;
      if (material(board, side) - initial >= 200) return i >= 4;
    }
    return false;
  }
  function supportsRecord(record) {
    var variant = record && record.variant;
    return !!record && (!variant || ["classic", "elo-ladder", "alternating-colors", "scp-096", "sufferfish"].includes(variant.slug) || variant.supported !== false);
  }
  function snapshotAnalysis(record) {
    var variant = record && record.variant;
    return !!variant && (["alternating-colors", "scp-096", "courier"].includes(variant.slug) || variant.analysisMode === "standard-snapshot");
  }
  function unavailable(message) {
    var error = new Error(message); error.name = "AnalysisUnavailableError"; return error;
  }
  // Replay owns the original variant snapshots. Only this validated projection
  // reaches ordinary Stockfish; automatic SCP captures are never replayed as moves.
  function analysisFen(record, ply) {
    var snapshot = record.boards && record.boards[ply], fen = snapshot && snapshot.fen;
    if (!fen) throw unavailable("This position has no saved board for ordinary chess analysis.");
    var fields = String(fen).trim().split(/\s+/).slice(0, 6), originalRights = fields[2], ep = fields[3];
    if (record.variant && record.variant.slug === "scp-096") {
      fields[0] = fields[0].replace(/\*/g, "1").replace(/[1-8]+/g, function (run) {
        return String(Array.from(run).reduce(function (sum, digit) { return sum + Number(digit); }, 0));
      });
    }
    try {
      fields[2] = fields[3] = "-";
      var parsed = parseBoard(fields.join(" ")), board = parsed.board;
      var rights = { K: ["e1", "K", "h1", "R"], Q: ["e1", "K", "a1", "R"], k: ["e8", "k", "h8", "r"], q: ["e8", "k", "a8", "r"] };
      fields[2] = Object.keys(rights).filter(function (right) {
        var required = rights[right];
        return String(originalRights).includes(right) && board[required[0]] === required[1] && board[required[2]] === required[3];
      }).join("") || "-";
      fields[3] = ep;
      try { parseBoard(fields.join(" ")); } catch (_) { fields[3] = "-"; }
      return parseBoard(fields.join(" ")).fen;
    } catch (error) { throw unavailable("Unavailable in ordinary chess: " + error.message); }
  }
  function positionCommand(record, ply, extra) {
    if (snapshotAnalysis(record)) return "position fen " + analysisFen(record, ply) + (extra && extra.length ? " moves " + extra.join(" ") : "");
    var moves = record.moves.slice(0, ply).concat(extra || []);
    return (record.startFen ? "position fen " + record.startFen : "position startpos") + (moves.length ? " moves " + moves.join(" ") : "");
  }
  function historyKey(record, ply) {
    var key = (record.startFen || START_FEN) + "|" + record.moves.slice(0, ply).join(" ");
    if (snapshotAnalysis(record)) key += "|standard-snapshot-v1|" + ((record.boards && record.boards[ply - 1] || {}).fen || "missing");
    return key;
  }
  function isValidGrade(grade, record, index, engine, specialMoves, movetime) {
    return !!(grade && record && record.moves && index >= 0 && index < record.moves.length &&
      grade.version === VERSION && grade.model === "centipawn" && (grade.depth > 0 || grade.unavailable === true) &&
      grade.config && grade.config.model === "centipawn" && grade.config.movetime === gradeTime(movetime) &&
      grade.config.specialMoves === (specialMoves !== false) &&
      grade.config.engine === engine && grade.historyKey === historyKey(record, index + 1));
  }
  function abortError() { var error = new Error("Analysis cancelled"); error.name = "AbortError"; return error; }

  function Analyzer(workerFile) {
    var self = this, worker = null, active = null, ready = null, disposed = false, generation = 0, queue = Promise.resolve();
    function assertActive(token) { if (disposed || token !== generation) throw abortError(); }
    function stopWorker(error) {
      if (active) active.reject(error || abortError());
      if (worker) worker.terminate();
      worker = null; ready = null;
    }
    function request(commands, done, token, timeout) {
      assertActive(token);
      return new Promise(function (resolve, reject) {
        var lines = [], currentWorker = worker;
        var timer = setTimeout(function () { stopWorker(new Error("Engine timed out; try again")); }, timeout || 25000);
        function finish(error) {
          if (active !== item) return;
          clearTimeout(timer); active = null;
          if (error) reject(error); else resolve(lines);
        }
        var item = { reject: finish, line: function (line) { lines.push(line); if (done(line)) finish(); } };
        active = item;
        try { commands.forEach(function (command) { currentWorker.postMessage(command); }); } catch (error) { finish(error); }
      });
    }
    function ensureReady(token) {
      assertActive(token);
      if (ready) return ready;
      worker = new Worker(workerFile);
      var created = worker;
      created.onmessage = function (event) {
        if (worker !== created || !active) return;
        String(event.data).split("\n").forEach(function (line) { if (active) active.line(line); });
      };
      created.onerror = function (event) { if (event.preventDefault) event.preventDefault(); if (worker === created) stopWorker(new Error("Engine failed to load: " + (event.message || "unknown error"))); };
      ready = (async function () {
        await request(["uci"], function (line) { return line === "uciok"; }, token, 15000);
        await request(["setoption name UCI_LimitStrength value false", "setoption name Skill Level value 20", "setoption name UCI_ShowWDL value true", "isready"], function (line) { return line === "readyok"; }, token);
      }());
      return ready;
    }
    function run(operation) {
      var token = generation;
      var job = queue.then(async function () { assertActive(token); await ensureReady(token); assertActive(token); return operation(token); });
      queue = job.catch(function () {});
      return job;
    }
    async function position(record, ply, token, extra, timeout) {
      assertActive(token);
      var lines = await request([positionCommand(record, ply, extra), "d", "go perft 1", "isready"], function (line) { return line === "readyok"; }, token, timeout);
      var fen = "", check = false, legal = [];
      lines.forEach(function (line) {
        if (line.indexOf("Fen: ") === 0) fen = line.slice(5).trim();
        else if (line.indexOf("Checkers:") === 0) check = !!line.slice(9).trim();
        else { var m = line.match(/^([a-h][1-8][a-h][1-8][qrbn]?): \d+$/); if (m) legal.push(m[1]); }
      });
      if (!fen) throw new Error("Engine did not return a position");
      var parsed = parseBoard(fen);
      return { fen: fen, board: parsed.board, turn: parsed.turn, legal: legal, inCheck: check };
    }
    async function recordPosition(record, ply, token, timeout) {
      if (snapshotAnalysis(record)) return position(record, ply, token, null, timeout);
      var cached = record.boards && record.boards[ply];
      if (cached && cached.fen && cached.legal) return cached;
      return position(record, ply, token, null, timeout);
    }
    async function evaluate(record, ply, options, token) {
      options = options || {}; assertActive(token);
      var pos = await recordPosition(record, ply, token, options.timeout);
      if (!pos.legal.length) {
        var winner = pos.inCheck ? (pos.turn === "w" ? "b" : "w") : null;
        return { cp: winner ? null : 0, mate: winner ? 0 : null, mateWinner: winner, wdl: winner === "w" ? [1000, 0, 0] : winner === "b" ? [0, 0, 1000] : [0, 1000, 0], depth: 0, pv: [], alternatives: [], scoreText: winner ? "Checkmate" : "Draw" };
      }
      var timed = Number.isFinite(options.movetime), depth = options.depth || (timed ? null : 12);
      var forced = options.searchmoves ? [].concat(options.searchmoves) : null;
      if (forced && forced.some(function (move) { return !pos.legal.includes(move); })) throw new Error("Cannot evaluate an illegal move");
      var count = Math.min(options.multiPV || 2, forced ? forced.length : pos.legal.length);
      var limit = (timed ? "movetime " + Math.max(1, Math.floor(options.movetime)) : "") +
        (depth ? (timed ? " " : "") + "depth " + depth : "");
      var commands = options.keepHash ? [] : ["setoption name Clear Hash"];
      commands.push("setoption name MultiPV value " + count, positionCommand(record, ply),
        "go " + limit + (forced ? " searchmoves " + forced.join(" ") : ""));
      var onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
      var lines = await request(commands, function (line) {
        // Stream each completed principal line so the UI can follow the search live.
        if (onProgress && /^info depth\b/.test(line) && generation === token) {
          var partial = null;
          try { partial = parseInfo([line], pos.turn, 1); } catch (_) {}
          if (partial) onProgress(partial);
        }
        return /^bestmove\b/.test(line);
      }, token,
        options.timeout || (timed ? options.movetime + 2000 : 120000));
      assertActive(token);
      var info = parseInfo(lines, pos.turn, count);
      if (!timed && info.depth < depth) throw new Error("Search stopped before the requested depth");
      return info;
    }
    this.position = function (fen, moves) { return run(function (token) { return position({ startFen: fen, moves: moves || [] }, (moves || []).length, token); }); };
    this.recordPosition = function (record, ply) { return run(function (token) { return recordPosition(record, ply, token); }); };
    this.replay = function (text) {
      var parsed;
      try { parsed = parsePgn(text); } catch (error) { return Promise.reject(error); }
      return run(async function (token) {
        var record = { startFen: parsed.startFen, moves: [], san: [], boards: [], headers: parsed.headers, result: parsed.result, variationCount: parsed.variationCount };
        record.boards.push(await position(record, 0, token));
        for (var i = 0; i < parsed.tokens.length; i++) {
          assertActive(token);
          var pos = record.boards[i], wanted = normalizeSan(parsed.tokens[i]);
          var candidates = pos.legal.filter(function (move) { return normalizeSan(sanCore(pos, move)) === wanted; });
          if (candidates.length !== 1) fail((candidates.length ? "Ambiguous" : "Illegal") + " SAN: " + parsed.tokens[i], i + 1);
          record.moves.push(candidates[0]);
          var next = await position(record, i + 1, token);
          if (/#/.test(parsed.tokens[i]) && !(next.inCheck && !next.legal.length)) fail("Checkmate suffix does not match position", i + 1);
          if (/\+/.test(parsed.tokens[i]) && !next.inCheck) fail("Check suffix does not match position", i + 1);
          record.san.push(sanCore(pos, candidates[0]) + (next.inCheck ? next.legal.length ? "+" : "#" : ""));
          record.boards.push(next);
        }
        return record;
      });
    };
    this.evaluate = function (record, ply, options) { return run(function (token) { return evaluate(record, ply, options, token); }); };
    this.grade = function (record, index, options) {
      options = options || {};
      var originalRecord = record, originalIndex = index;
      return run(async function (token) {
        var budget = gradeTime(options.movetime), scale = budget / GRADE_TIME_MS;
        var started = now(), deadline = started + budget;
        var pos = await recordPosition(record, index, token, budget + 200), move = record.moves[index];
        if (!pos.legal.includes(move)) {
          if (snapshotAnalysis(record)) throw unavailable("The recorded move is unavailable in ordinary chess when custom rules are ignored.");
          throw new Error("No legal move at requested index");
        }
        if (snapshotAnalysis(record)) {
          record = { startFen: pos.fen, moves: [move], boards: [pos] }; index = 0;
        }
        async function search(ply, quota, settings) {
          var remaining = Math.floor(deadline - now());
          if (remaining < 10) return null;
          return evaluate(record, ply, Object.assign({}, settings, { movetime: Math.min(quota, remaining), timeout: remaining + 200 }), token);
        }
        var root = await search(index, 800 * scale, { multiPV: 2 });
        if (!root) throw new Error("Analysis budget expired before the position was evaluated");
        var best = root, played = root.alternatives.find(function (line) { return line.pv[0] === move; });
        if (!played) {
          // Compare both candidates in the same completed MultiPV iteration.
          // Separate forced searches can disagree even at the same depth.
          best = await search(index, 600 * scale, { multiPV: 2, searchmoves: [root.pv[0], move], keepHash: true });
          if (!best) throw new Error("Analysis budget expired before the played move was evaluated");
          played = best.alternatives.find(function (line) { return line.pv[0] === move; });
        }
        if (!played) throw new Error("Engine did not evaluate the played move");
        var raw = { best: best, played: played, root: root };
        var provisional = classify({ best: best, played: played, side: pos.turn });
        var afterPos = await recordPosition(record, index + 1, token, Math.max(1, deadline - now()) + 200);
        var mateEvidence = null, difficulty = {}, opponent = pos.turn === "w" ? "b" : "w";
        if (provisional.objectiveLabel !== "Best" && afterPos.legal.length) {
          var deep = await search(index + 1, 300 * scale, { multiPV: 1 });
          if (deep && worsensShortMate(best, played, pos.turn)) {
            raw.mateConfirmation = deep;
            if (deep.mateWinner === opponent && Number.isFinite(deep.mate)) {
              mateEvidence = { winner: opponent, distance: Math.abs(deep.mate),
                depth: deep.depth, bestDepth: best.depth, confirmed: true };
            }
          }
          if (deep && options.difficulty !== false) {
            var shallow = await search(index + 1, 20, { depth: 4, multiPV: 1 });
            var medium = await search(index + 1, 40, { depth: 7, multiPV: 1 });
            // A diagnostic that did not finish below the main reply depth
            // cannot establish that a reply is hard for a human to discover.
            if (shallow && medium && deep.depth > medium.depth && medium.depth >= shallow.depth) {
              var unseen = centipawnLoss(deep, shallow, afterPos.turn);
              var mediumGap = centipawnLoss(deep, medium, afterPos.turn);
              var same = shallow.pv[0] === deep.pv[0] && medium.pv[0] === deep.pv[0];
              var recognized = same && moverScore(shallow, afterPos.turn) >= 200 && moverScore(medium, afterPos.turn) >= 200;
              var hiddenMate = deep.mateWinner === afterPos.turn && shallow.mateWinner !== afterPos.turn && !recognized;
              var stable = unseen != null && Math.abs(unseen) < 25 || deep.mateWinner === shallow.mateWinner && deep.mate === shallow.mate || recognized;
              var natural = naturalness(afterPos, deep.pv[0]);
              if (hiddenMate && medium.mateWinner !== afterPos.turn || unseen > 150 && mediumGap > 60) difficulty.discoverability = "very-hard";
              else if (hiddenMate || unseen > 60 || mediumGap > 40) difficulty.discoverability = "hard";
              else difficulty.discoverability = same && stable ? "very-easy" : "normal";
              difficulty.naturalness = natural.category;
              if (natural.quiet && difficulty.discoverability === "very-hard") difficulty.naturalness = "unnatural";
              difficulty.delayed = difficulty.discoverability !== "very-easy" && delayedPayoff(afterPos, deep.pv);
              difficulty.immediate = natural.obvious || deep.mate != null && Math.abs(deep.mate) === 1 && natural.check;
              if (difficulty.immediate && natural.check && deep.mate != null) difficulty.naturalness = "very-natural";
              difficulty.evidence = { shallowDepth: shallow.depth, mediumDepth: medium.depth, deepDepth: deep.depth, shallowReply: shallow.pv[0], mediumReply: medium.pv[0], deepReply: deep.pv[0], unseenGain: unseen, mediumGap: mediumGap, natural: natural };
              raw.probes = { shallow: shallow, medium: medium, deep: deep };
            }
          }
        }
        var great = false, brilliant = false, specialEvidence = null;
        // Special labels require an unrestricted root comparison, rather than
        // treating a two-candidate recheck as the complete field of alternatives.
        var alternative = root.alternatives.find(function (line) { return line.pv[0] !== move; });
        var rootPlayed = root.alternatives.find(function (line) { return line.pv[0] === move; });
        if (options.specialMoves !== false && rootPlayed && ["Best", "Excellent"].includes(provisional.objectiveLabel) && pos.legal.length > 1) {
          var vb = moverScore(best, pos.turn), vp = moverScore(played, pos.turn);
          var altScore = alternative ? moverScore(alternative, pos.turn) : null;
          great = !!alternative && vb - altScore >= 125 && (vb >= -50 && altScore < -150 || vb >= 200 && altScore < 100);
          // A winning alternative does not make a sound tactical offer ordinary.
          // Exclude surplus-material giveaways using the actual starting material.
          var accepts = !pos.inCheck && vb >= -50 && material(pos.board, pos.turn) <= 500 ? afterPos.legal.filter(function (reply) {
            var square = reply.slice(2, 4), offered = afterPos.board[square];
            return offered && VALUE[offered.toUpperCase()] >= 300 &&
              (square === move.slice(2, 4) || !attacked(pos.board, square, pos.turn === "b"));
          }) : [];
          if (accepts.length) {
            var accepted = [], sound = true, meaningful = false;
            for (var ai = 0; ai < accepts.length; ai++) {
              var reply = accepts[ai], quota = Math.min(400 * scale, Math.floor((deadline - now()) / (accepts.length - ai)));
              var acceptance = await search(index + 1, quota, { searchmoves: reply, multiPV: 1 });
              if (!acceptance) { sound = false; break; }
              var compensation = moverScore(acceptance, pos.turn);
              var afterCapture = await position(record, index + 1, token, [reply], Math.max(1, deadline - now()) + 200);
              // Measure what was offered before counting compensation such as
              // winning a queen on the next move. Equal trades do not qualify;
              // the 150cp floor includes rook-for-minor exchange sacrifices.
              var offeredDeficit = material(afterCapture.board, pos.turn) - material(pos.board, pos.turn);
              // A protected piece is not an offer if recapturing on its square
              // already restores the material (e.g. Qxh4 Rxh4). Compensation
              // elsewhere, such as Rxf2 Rxh2 winning a queen, remains eligible.
              var recaptureDeficit = afterCapture.legal.reduce(function (change, candidate) {
                if (candidate.slice(2, 4) !== reply.slice(2, 4)) return change;
                return Math.max(change, material(applyBoard(afterCapture.board, candidate), pos.turn) - material(pos.board, pos.turn));
              }, offeredDeficit);
              var response = acceptance.pv[1], returned = response ? applyBoard(afterCapture.board, response) : afterCapture.board;
              var deficit = returned ? material(returned, pos.turn) - material(pos.board, pos.turn) : 0;
              accepted.push({ reply: reply, scoreCp: Number.isFinite(compensation) ? compensation : null, mateWinner: acceptance.mateWinner || null, offeredMaterialChange: offeredDeficit, recaptureMaterialChange: recaptureDeficit, materialChange: deficit, depth: acceptance.depth });
              if (compensation == null || compensation < -50 || Number.isFinite(vp) && Number.isFinite(compensation) && qualityScore(vp) - qualityScore(compensation) > 50 || vp === Infinity && compensation !== Infinity) sound = false;
              if (offeredDeficit <= -150 && recaptureDeficit <= -150) meaningful = true;
            }
            brilliant = sound && meaningful && accepted.length === accepts.length;
            specialEvidence = { verifiedDepth: best.depth, acceptances: accepted };
          }
        }
        var result = classify({ best: best, played: played, side: pos.turn, difficulty: difficulty,
          mateEvidence: mateEvidence, great: great, brilliant: brilliant });
        return Object.assign(result, { bestMove: best.pv[0], playedMove: move, pv: best.pv,
          depth: Math.min(best.depth, played.depth), elapsedMs: Math.round(now() - started), raw: raw,
          side: pos.turn, legalMoveCount: pos.legal.length, analysisLegalMoves: pos.legal.slice(), beforeFen: pos.fen,
          specialEvidence: specialEvidence, historyKey: historyKey(originalRecord, originalIndex + 1),
          config: { model: "centipawn", movetime: budget, specialMoves: options.specialMoves !== false, engine: workerFile, version: VERSION },
          configKey: VERSION + "|movetime=" + budget + "|specialMoves=" + (options.specialMoves !== false) + "|engine=" + workerFile });
      }).catch(function (error) {
        if (error.name !== "AnalysisUnavailableError") throw error;
        return { unavailable: true, reason: error.message, version: VERSION, model: "centipawn", depth: 0,
          historyKey: historyKey(originalRecord, originalIndex + 1),
          config: { model: "centipawn", movetime: gradeTime(options.movetime), specialMoves: options.specialMoves !== false, engine: workerFile, version: VERSION } };
      });
    };
    this.cancel = function () { generation++; stopWorker(abortError()); queue = Promise.resolve(); };
    this.dispose = function () { disposed = true; self.cancel(); };
  }
  return { VERSION: VERSION, START_FEN: START_FEN, parsePgn: parsePgn, parseBoard: parseBoard, classify: classify,
    objectiveLabel: objectiveLabel, centipawnLoss: centipawnLoss, expectedScore: expectedScore, parseInfo: parseInfo, historyKey: historyKey, isValidGrade: isValidGrade,
    attacked: attacked, naturalness: naturalness, delayedPayoff: delayedPayoff, sanCore: sanCore,
    performanceSummary: performanceSummary, supportsRecord: supportsRecord, snapshotAnalysis: snapshotAnalysis, analysisFen: analysisFen, Analyzer: Analyzer };
}));
