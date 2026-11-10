// Play against the engine built by ./make-web.sh.
//
// The engine is the single source of truth for the rules: after every move the
// page asks it for the position ("d") and the legal moves ("go perft 1"). So if
// a fork changes the rules in src/variant/config.h, this board follows them
// with no JavaScript changes.
"use strict";

// ---------------------------------------------------------------- Engine
// Avatars next to the player names: a drawn person for you, the official
// Stockfish logo (stockfishchess.org, GPLv3) for the engine
var AVATARS = {
  you: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#2f7fd8"/>' +
       '<circle cx="16" cy="12.5" r="5.5" fill="#e8f2ff"/>' +
       '<path d="M6 27.5c1.6-5.2 5.4-8 10-8s8.4 2.8 10 8a16 16 0 0 1-20 0z" fill="#e8f2ff"/></svg>',
  engine: '<img src="stockfish-logo.png" alt="">'
};
var tagState = new WeakMap();
function setTag(el, who, engineName) {
  var name = who === "you" ? "You" : engineName;
  if (tagState.get(el) === who + name) return; // skip rebuilding on every render
  tagState.set(el, who + name);
  el.innerHTML = '<span class="avatar avatar-' + who + '"></span><span class="tag-name"></span>';
  el.firstChild.innerHTML = AVATARS[who];
  el.lastChild.textContent = name;
}

// Small wrapper around the Web Worker. Requests run one at a time; each one
// sends some UCI commands and collects output lines until a "done" line.
function Engine(file) {
  var self = this;
  var listeners = [];
  this.worker = new Worker(file);
  this.worker.onmessage = function (e) {
    String(e.data).split("\n").forEach(function (line) {
      listeners.slice().forEach(function (fn) { fn(line); });
    });
  };
  this.queue = Promise.resolve();

  this.request = function (commands, isDone, onLine) {
    var job = self.queue.then(function () {
      return new Promise(function (resolve) {
        var lines = [];
        function listen(line) {
          lines.push(line);
          if (onLine) onLine(line);
          if (isDone(line)) {
            listeners.splice(listeners.indexOf(listen), 1);
            resolve(lines);
          }
        }
        listeners.push(listen);
        commands.forEach(function (c) { self.worker.postMessage(c); });
      });
    });
    self.queue = job.catch(function () {});
    return job;
  };

  // Sent straight away (not queued) so it can interrupt a search.
  this.stop = function () { self.worker.postMessage("stop"); };
}

// ---------------------------------------------------------------- Helpers
var FILES = "abcdefgh";
var PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
var SCP = "*"; // SCP-096 in the engine's FEN: no color, never moves on its own turn

function pieceImg(p) { // p is a FEN letter, e.g. "N" or "q"
  if (p === SCP) return "pieces/scp096.png";
  var color = p === p.toUpperCase() ? "w" : "b";
  return "pieces/" + color + p.toUpperCase() + ".svg";
}

function parseBoard(fen) { // -> { e4: "P", ... }
  var board = {};
  fen.split(" ")[0].split("/").forEach(function (row, i) {
    var file = 0;
    for (var ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else board[FILES[file++] + (8 - i)] = ch;
    }
  });
  return board;
}

function isWhite(p) { return !!p && /[A-Z]/.test(p); }
function pieceAlt(p) { return p === SCP ? "SCP-096" : (isWhite(p) ? "white " : "black ") + PIECE_NAMES[p.toLowerCase()]; }

// Standard algebraic notation for a UCI move, using the board and the legal
// moves before the move. "+"/"#" are added later, once the engine reports
// whether the new position is check or mate.
function toSan(pos, uci) {
  var from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4];
  var piece = pos.board[from];
  var type = piece.toUpperCase();
  var dx = FILES.indexOf(to[0]) - FILES.indexOf(from[0]);

  if (type === "K" && Math.abs(dx) === 2) return dx > 0 ? "O-O" : "O-O-O";

  var capture = !!pos.board[to] || (type === "P" && dx !== 0);
  if (type === "P") {
    return (capture ? from[0] + "x" : "") + to + (promo ? "=" + promo.toUpperCase() : "");
  }

  var san = type;
  var rivals = pos.legal.filter(function (m) {
    return m !== uci && m.slice(2, 4) === to && pos.board[m.slice(0, 2)] === piece;
  }).map(function (m) { return m.slice(0, 2); });
  if (rivals.length) {
    var sameFile = rivals.some(function (s) { return s[0] === from[0]; });
    var sameRank = rivals.some(function (s) { return s[1] === from[1]; });
    san += !sameFile ? from[0] : !sameRank ? from[1] : from;
  }
  return san + (capture ? "x" : "") + to;
}

function insufficientMaterial(board) {
  var others = Object.values(board).filter(function (p) { return p !== SCP && p.toUpperCase() !== "K"; });
  return others.length === 0 || (others.length === 1 && /[nbNB]/.test(others[0]));
}

// ---------------------------------------------------------------- State
var engine;
var game = {
  moves: [],        // UCI moves from the start position
  san: [],          // matching SAN strings
  repKeys: [],      // position keys, for threefold repetition
  playerColor: "w",
  flipped: false,
  over: null,       // result text when the game has ended
  boards: [],       // snapshot after each ply (0 = start): { board, lastMove, turn, inCheck, ate }
  ate: [],          // per move: what SCP-096 ate right after it, e.g. ["Qd3", "ra3"]
  view: null,       // ply being reviewed, or null for the live position
  token: 0          // bumped on new game / take back to ignore stale engine replies
};
var pos = null;     // { fen, board, turn, legal: [uci], inCheck }
var selected = null;
var thinking = false;

var $ = function (id) { return document.getElementById(id); };
var boardEl = $("board");

// ---------------------------------------------------------------- Engine I/O
function positionCmd(ply) { // ply: how many moves to include (default: all)
  var moves = ply == null ? game.moves : game.moves.slice(0, ply);
  return "position startpos" + (moves.length ? " moves " + moves.join(" ") : "");
}

function refreshPosition() {
  return engine.request([positionCmd(), "d", "go perft 1", "isready"],
    function (l) { return l === "readyok"; }
  ).then(function (lines) {
    var fen = "", inCheck = false, legal = [], ate = [], sees = [];
    lines.forEach(function (l) {
      var m;
      if (l.indexOf("Fen: ") === 0) fen = l.slice(5).trim();
      else if (l.indexOf("Checkers:") === 0) inCheck = l.slice(9).trim().length > 0;
      else if (l.indexOf("SCP-096 ate:") === 0) ate = l.slice(12).trim().split(/\s+/).filter(Boolean);
      else if (l.indexOf("SCP-096 sees:") === 0) sees = l.slice(13).trim().split(/\s+/).filter(Boolean);
      else if ((m = l.match(/^([a-h][1-8][a-h][1-8][qrbn]?): \d+$/))) legal.push(m[1]);
    });
    var parts = fen.split(" ");
    return {
      fen: fen,
      board: parseBoard(fen),
      turn: parts[1],
      halfmove: Number(parts[4]) || 0,
      repKey: parts.slice(0, 4).join(" "),
      legal: legal,
      inCheck: inCheck,
      ate: ate,
      sees: sees
    };
  });
}

function formatScore(info, turn) {
  var m = info.match(/score (cp|mate) (-?\d+)/);
  if (!m) return "";
  var n = Number(m[2]) * (turn === "w" ? 1 : -1); // to White's point of view
  if (m[1] === "mate") return (n > 0 ? "#" : "#-") + Math.abs(n);
  return (n > 0 ? "+" : "") + (n / 100).toFixed(2);
}

function engineMove() {
  var token = game.token;
  var turn = pos.turn;
  var started = performance.now();
  thinking = true;
  render();

  engine.request([positionCmd(), "go movetime " + $("sel-time").value],
    function (l) { return l.indexOf("bestmove") === 0; },
    function (l) {
      if (token !== game.token || l.indexOf("info depth") !== 0) return;
      var depth = (l.match(/ depth (\d+)/) || [])[1];
      var score = formatScore(l, turn);
      if (score) $("engine-line").textContent = "Depth " + depth + " · eval " + score;
    }
  ).then(function (lines) {
    if (token !== game.token) return;
    thinking = false;
    var best = lines[lines.length - 1].split(" ")[1];
    var secs = ((performance.now() - started) / 1000).toFixed(1);
    $("engine-line").textContent += " · " + secs + " s";
    if (best && best !== "(none)") playMove(best);
    else render();
  });
}

// ---------------------------------------------------------------- Eval bar
// Driven by the stock Stockfish build in site/stock-engine/, not your variant,
// so it shows how plain Stockfish rates the game. Your variant may only remove
// moves, so every position it reaches is a normal chess position stock
// Stockfish can judge (it just does not know about your rule changes).
var EVAL_DEPTH = 16;
var evalEngine = null;
var evalKey = null;     // position being analysed
var evalRunning = false;

function winShare(cp) { // centipawns (White's view) -> White's share of the bar, 0..1
  return 1 / (1 + Math.exp(-0.00368208 * cp)); // same curve as Lichess
}

function setEvalBar(share, text, title) {
  var bar = $("evalbar");
  bar.style.setProperty("--white", (share * 100).toFixed(1) + "%");
  bar.classList.toggle("white-better", share >= 0.5);
  bar.title = title;
  $("eval-label").textContent = text;
}

function analyse() {
  if (!evalEngine || !pos || pos.pending || !$("chk-eval").checked) return;
  var key = positionCmd(game.view);
  if (key === evalKey) return;
  evalKey = key;
  if (evalRunning) evalEngine.stop(); // a new position: drop the old search
  evalRunning = true;
  var turn = game.view === null ? pos.turn : game.boards[game.view].turn;
  evalEngine.request([key, "go depth " + EVAL_DEPTH],
    function (l) { return l.indexOf("bestmove") === 0; },
    function (l) {
      if (evalKey !== key || l.indexOf("info depth") !== 0) return;
      var m = l.match(/score (cp|mate) (-?\d+)/);
      if (!m) return;
      var depth = (l.match(/ depth (\d+)/) || [])[1];
      var n = Number(m[2]);
      var title = "Stock Stockfish · depth " + depth;
      if (m[1] === "mate") {
        // "mate 0" = the side to move is already mated
        var whiteWins = n === 0 ? turn === "b" : (n > 0) === (turn === "w");
        setEvalBar(whiteWins ? 1 : 0, n === 0 ? "#" : "M" + Math.abs(n), title);
      } else {
        var cp = turn === "w" ? n : -n;
        setEvalBar(winShare(cp), (Math.abs(cp) / 100).toFixed(1), title + " · " + formatScore(l, turn));
      }
    }
  ).then(function () { if (evalKey === key) evalRunning = false; });
}

function toggleEval() {
  var on = $("chk-eval").checked;
  $("evalbar").classList.toggle("off", !on);
  if (!on && evalRunning) evalEngine.stop();
  evalKey = null; // re-analyse when switched back on
  analyse();
}

// ---------------------------------------------------------------- Game flow
function snapshot(p, lastMove) {
  return { board: p.board, lastMove: lastMove, turn: p.turn, inCheck: p.inCheck, ate: p.ate || [], sees: p.sees || [] };
}

// Review: step through earlier positions without changing the game.
function viewPly(ply) {
  var live = game.boards.length - 1;
  ply = Math.max(0, Math.min(ply, live));
  game.view = ply === live ? null : ply;
  selected = null;
  render();
}
function shownPly() { return game.view === null ? game.boards.length - 1 : game.view; }

function playMove(uci) {
  var token = game.token;
  if (pos.turn === game.playerColor) shapes = []; // your move clears your arrows
  game.san.push(toSan(pos, uci));
  game.ate.push([]);
  game.moves.push(uci);
  selected = null;
  pos = Object.assign({}, pos, { lastMove: uci, pending: true });
  render();

  var moved = performance.now();
  refreshPosition().then(function (next) {
    if (token !== game.token) return;
    next.lastMove = uci;
    if (!next.ate.length) return finish();

    // SCP-096's turn: let Black's move land, show which piece set it off, then eat.
    var scpFrom = Object.keys(pos.board).find(function (s) { return pos.board[s] === SCP; });
    var victim = next.ate[0].slice(1);
    later(Math.max(0, MOVE_MS + SCP_PAUSE_MS - (performance.now() - moved)), function () {
      scpShow = { from: scpFrom, victim: victim };
      render();
      later(SCP_TRIGGER_MS, function () {
        scpShow = null;
        animMs = SCP_EAT_MS;
        finish();
      });
    });

    function finish() {
      pos = next;
      game.repKeys.push(next.repKey);
      game.boards.push(snapshot(next, uci));

      var i = game.san.length - 1;
      game.ate[i] = next.ate;
      if (!next.legal.length) game.san[i] += next.inCheck ? "#" : "";
      else if (next.inCheck) game.san[i] += "+";

      checkGameOver();
      render();
      if (next.ate.length) later(SCP_EAT_MS, maybeEngineTurn);
      else maybeEngineTurn();
    }
  });

  // Run fn after ms, unless a new game or take back happened meanwhile
  function later(ms, fn) {
    setTimeout(function () { if (token === game.token) fn(); }, ms);
  }
}

function checkGameOver() {
  var winner = pos.turn === "w" ? "Black" : "White";
  var kings = Object.values(pos.board);
  if (kings.indexOf("K") < 0 || kings.indexOf("k") < 0) {
    var white = kings.indexOf("K") < 0;
    game.over = "SCP-096 ate the " + (white ? "white" : "black") + " king — " + (white ? "Black" : "White") + " wins";
  } else if (!pos.legal.length) {
    game.over = pos.inCheck ? "Checkmate — " + winner + " wins" : "Stalemate — draw";
  } else if (pos.halfmove >= 100) {
    game.over = "Draw by the 50-move rule";
  } else if (game.repKeys.filter(function (k) { return k === pos.repKey; }).length >= 3) {
    game.over = "Draw by threefold repetition";
  } else if (insufficientMaterial(pos.board)) {
    game.over = "Draw — insufficient material";
  } else {
    game.over = null;
  }
}

function maybeEngineTurn() {
  if (!game.over && pos.turn !== game.playerColor) engineMove();
}

function newGame(color) {
  game.token++;
  if (thinking) engine.stop();
  thinking = false;
  game.moves = []; game.san = []; game.ate = []; game.over = null; scpShow = null;
  game.boards = []; game.view = null;
  game.playerColor = color;
  game.flipped = color === "b";
  selected = null;
  $("engine-line").innerHTML = "&nbsp;";
  engine.request(["ucinewgame", "isready"], function (l) { return l === "readyok"; });
  refreshPosition().then(function (p) {
    pos = p;
    game.repKeys = [p.repKey];
    game.boards = [snapshot(p, null)];
    render();
    maybeEngineTurn();
  });
}

function takeBack() {
  if (!game.moves.length) return;
  game.token++;
  if (thinking) engine.stop();
  thinking = false;
  // Undo back to the last position where it is the player's turn.
  do {
    game.moves.pop(); game.san.pop(); game.ate.pop(); game.repKeys.pop();
  } while (game.moves.length && (game.moves.length % 2 === 0 ? "w" : "b") !== game.playerColor);
  // If that leaves the engine to move (playing Black, all undone), it moves again below.
  game.boards.length = game.moves.length + 1;
  game.view = null;
  game.over = null;
  selected = null;
  scpShow = null;
  refreshPosition().then(function (p) {
    p.lastMove = game.moves[game.moves.length - 1];
    pos = p;
    render();
    maybeEngineTurn();
  });
}

function setStrength() {
  var elo = Number($("sel-elo").value);
  var cmds = elo
    ? ["setoption name UCI_LimitStrength value true", "setoption name UCI_Elo value " + elo]
    : ["setoption name UCI_LimitStrength value false"];
  engine.request(cmds.concat("isready"), function (l) { return l === "readyok"; });
}

// ---------------------------------------------------------------- Input
function canMove() {
  return pos && !pos.pending && !thinking && !game.over && game.view === null &&
    pos.turn === game.playerColor;
}

function movesFrom(sq) {
  return pos.legal.filter(function (m) { return m.slice(0, 2) === sq; });
}

function tryMove(from, to, anchorEl) {
  var options = pos.legal.filter(function (m) { return m.slice(0, 4) === from + to; });
  if (!options.length) return false;
  if (options.length === 1) { playMove(options[0]); return true; }
  showPromotion(options, anchorEl);
  return true;
}

function showPromotion(options, anchorEl) {
  var box = $("promo");
  var white = pos.turn === "w";
  box.innerHTML = "";
  ["q", "n", "r", "b"].forEach(function (p) {
    var uci = options.find(function (m) { return m[4] === p; });
    if (!uci) return; // the variant may forbid underpromotion
    var btn = document.createElement("button");
    btn.setAttribute("aria-label", "Promote to " + PIECE_NAMES[p]);
    btn.innerHTML = '<img src="' + pieceImg(white ? p.toUpperCase() : p) + '" alt="">';
    btn.onclick = function () { box.hidden = true; playMove(uci); };
    box.appendChild(btn);
  });
  var r = anchorEl.getBoundingClientRect();
  box.style.left = r.left + "px";
  box.style.top = r.top + "px";
  box.style.width = r.width + "px";
  Array.from(box.children).forEach(function (b) { b.style.height = r.height + "px"; });
  box.hidden = false;
}

document.addEventListener("pointerdown", function (e) {
  var box = $("promo");
  if (!box.hidden && !box.contains(e.target)) {
    box.hidden = true; selected = null; noAnimSq = null; render();
  }
});

function squareAt(x, y) {
  var el = document.elementFromPoint(x, y);
  var sq = el && el.closest(".sq");
  return sq && boardEl.contains(sq) ? sq : null;
}

var drag = null;

// ---- Annotations: right-click a square for a circle, right-drag for an arrow.
// Shift = red, Alt/Ctrl = blue, Shift+Alt = yellow. Left click clears them.
var shapes = [];      // { from, to, color }; from === to is a circle
var drawing = null;   // the shape being drawn right now
var SHAPE_COLORS = { green: "#15781B", red: "#882020", blue: "#003088", yellow: "#e68f00" };

function shapeColor(e) {
  var alt = e.altKey || e.ctrlKey || e.metaKey;
  return e.shiftKey && alt ? "yellow" : e.shiftKey ? "red" : alt ? "blue" : "green";
}

boardEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });

boardEl.addEventListener("pointerdown", function (e) {
  if (e.button === 2 && !drag) {
    var sqEl = e.target.closest(".sq");
    if (!sqEl) return;
    drawing = { from: sqEl.dataset.sq, to: sqEl.dataset.sq, color: shapeColor(e) };
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    drawShapes();
  } else if (e.button === 0 && shapes.length) {
    shapes = [];
    drawShapes();
  }
});

boardEl.addEventListener("pointermove", function (e) {
  if (!drawing) return;
  var t = squareAt(e.clientX, e.clientY);
  if (t && t.dataset.sq !== drawing.to) { drawing.to = t.dataset.sq; drawShapes(); }
});

boardEl.addEventListener("pointerup", function (e) {
  if (!drawing || e.button !== 2) return;
  var s = drawing;
  drawing = null;
  var i = shapes.findIndex(function (x) { return x.from === s.from && x.to === s.to; });
  if (i < 0) shapes.push(s);
  else if (shapes[i].color === s.color) shapes.splice(i, 1); // same shape again = erase
  else shapes[i] = s;                                       // other color = recolor
  drawShapes();
});

function drawShapes() {
  var svg = $("shapes");
  if (!svg) return;
  var list = drawing ? shapes.concat(Object.assign({ preview: true }, drawing)) : shapes;
  svg.innerHTML = list.map(shapeSvg).join("");
}

function shapeSvg(s) { // board is an 8x8 viewBox, one unit per square
  var a = sqXY(s.from), b = sqXY(s.to);
  var ax = a.x + 0.5, ay = a.y + 0.5, bx = b.x + 0.5, by = b.y + 0.5;
  var color = SHAPE_COLORS[s.color];
  var g = '<g opacity="' + (s.preview ? 0.55 : 0.8) + '">';
  if (s.from === s.to) {
    return g + '<circle cx="' + ax + '" cy="' + ay + '" r="0.46" fill="none" stroke="' + color +
      '" stroke-width="0.07"/></g>';
  }
  var pts = [[ax, ay]];
  var dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  if (dx * dy === 2) pts.push(dy > dx ? [ax, by] : [bx, ay]); // knight jump: draw an L
  var last = pts[pts.length - 1];
  var ux = bx - last[0], uy = by - last[1], len = Math.hypot(ux, uy);
  ux /= len; uy /= len;
  var HEAD = 0.42, HALF = 0.26;
  var baseX = bx - ux * HEAD, baseY = by - uy * HEAD;
  pts.push([baseX + ux * 0.02, baseY + uy * 0.02]);
  var head = [[bx, by], [baseX - uy * HALF, baseY + ux * HALF], [baseX + uy * HALF, baseY - ux * HALF]];
  var str = function (p) { return p.map(function (q) { return q[0].toFixed(3) + "," + q[1].toFixed(3); }).join(" "); };
  return g + '<polyline points="' + str(pts) + '" fill="none" stroke="' + color +
    '" stroke-width="0.16" stroke-linejoin="round"/>' +
    '<polygon points="' + str(head) + '" fill="' + color + '"/></g>';
}

// ---- Moving pieces with the left button (drag or click-click).
boardEl.addEventListener("pointerdown", function (e) {
  var sqEl = e.target.closest(".sq");
  if (!sqEl || !canMove() || e.button > 0) return;
  var sq = sqEl.dataset.sq;
  var piece = pos.board[sq];

  // Clicking a highlighted target finishes a click-move.
  if (selected && sq !== selected && tryMove(selected, sq, sqEl)) return;

  if (piece && (isWhite(piece) ? "w" : "b") === pos.turn) {
    // Capture first: render() below replaces the element under the pointer,
    // and some browsers end the gesture when the pressed element disappears.
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    e.preventDefault();
    var wasSelected = selected === sq;
    selected = sq;
    render();
    startDrag(sq, e, wasSelected);
  } else {
    selected = null;
    render();
  }
});

// The piece is picked up as soon as it is pressed: it pops to the cursor and
// follows it. Releasing without moving counts as a click.
function startDrag(sq, e, wasSelected) {
  var sqEl = squareEl(sq);
  var img = sqEl.querySelector(".piece");
  var size = sqEl.getBoundingClientRect().width;
  var ghost = img.cloneNode();
  ghost.className = "ghost";
  ghost.style.width = ghost.style.height = size + "px";
  ghost.style.left = e.clientX + "px";
  ghost.style.top = e.clientY + "px";
  document.body.appendChild(ghost);
  document.body.classList.add("grabbing");
  img.classList.add("dragging");
  if (!reduceMotion) { // "lift": grow from the square up to the cursor
    var r = img.getBoundingClientRect();
    var ox = r.left + r.width / 2 - e.clientX, oy = r.top + r.height / 2 - e.clientY;
    ghost.animate([
      { transform: "translate(calc(-50% + " + ox + "px), calc(-50% + " + oy + "px)) scale(1)" },
      { transform: "translate(-50%, -50%) scale(1.15)" }
    ], { duration: 120, easing: "ease-out" });
  }
  drag = { from: sq, img: img, ghost: ghost, x: e.clientX, y: e.clientY, moved: false,
           wasSelected: wasSelected, pointerId: e.pointerId };
}

function endDrag() {
  var d = drag;
  drag = null;
  d.ghost.remove();
  document.body.classList.remove("grabbing");
  d.img.classList.remove("dragging");
  if (d.over) d.over.classList.remove("drag-over");
  return d;
}

boardEl.addEventListener("pointermove", function (e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.ghost.style.left = e.clientX + "px";
  drag.ghost.style.top = e.clientY + "px";
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
  drag.moved = true;
  var over = squareAt(e.clientX, e.clientY);
  if (over !== drag.over) {
    if (drag.over) drag.over.classList.remove("drag-over");
    if (over) over.classList.add("drag-over");
    drag.over = over;
  }
});

boardEl.addEventListener("pointerup", function (e) {
  if (!drag || e.button !== 0) return;
  var d = endDrag();
  if (d.moved) {
    var target = squareAt(e.clientX, e.clientY);
    noAnimSq = target && target.dataset.sq; // dropped pieces land in place, no slide
    if (!(target && target.dataset.sq !== d.from && tryMove(d.from, target.dataset.sq, target))) {
      // Illegal drop: let the piece fly back home from where it was let go.
      noAnimSq = null;
      var r = d.img.getBoundingClientRect();
      anims.push({ type: "snap", to: d.from, start: performance.now(), ms: 220,
        dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2) });
      render();
    }
  } else if (d.wasSelected) {
    selected = null; // second click on the same piece deselects it
    render();
  }
});

// The browser can take the pointer away (alt-tab, touch gestures): put the
// piece back instead of leaving it stuck to the cursor.
["pointercancel", "lostpointercapture"].forEach(function (type) {
  boardEl.addEventListener(type, function (e) {
    if (drag && e.pointerId === drag.pointerId) { endDrag(); render(); }
  });
});

// ---------------------------------------------------------------- Animation
// Every redraw compares the new board with the one on screen and slides the
// pieces that moved. That covers your moves, engine moves, castling, take
// backs and new games with one mechanism. Animations in progress survive a
// redraw: they are re-created at the point they had reached.
var MOVE_MS = 420;         // a normal move sliding
var SCP_PAUSE_MS = 450;    // after Black's move lands, before SCP-096 reacts
var SCP_TRIGGER_MS = 1300; // SCP-096 glares at the piece that saw it
var SCP_EAT_MS = 750;      // SCP-096 lunging onto that piece
var animMs = MOVE_MS;      // duration for the animations the next redraw starts
var scpShow = null;        // { from, victim } while SCP-096's turn plays out
var reduceMotion = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
var shownBoard = null;  // board as last drawn
var anims = [];         // { type: "slide"|"fade"|"snap", ... , start }
var noAnimSq = null;    // where a dragged piece was dropped: it should not slide

function sqXY(sq) { // square name -> column/row on screen, 0..7
  var f = FILES.indexOf(sq[0]), r = Number(sq[1]);
  return game.flipped ? { x: 7 - f, y: r - 1 } : { x: f, y: 8 - r };
}

function squareEl(sq) { return boardEl.querySelector('.sq[data-sq="' + sq + '"]'); }

function diffAnims(before, after) {
  if (!before || reduceMotion) return;
  var gone = Object.keys(before).filter(function (s) { return before[s] !== after[s]; });
  var came = Object.keys(after).filter(function (s) { return before[s] !== after[s]; });
  if (!gone.length && !came.length) return;

  var now = performance.now(), used = {};
  function dist(a, b) { var p = sqXY(a), q = sqXY(b); return Math.hypot(p.x - q.x, p.y - q.y); }
  function nearest(to, match) {
    var best = null;
    gone.forEach(function (s) {
      if (!used[s] && match(before[s], s) && (!best || dist(s, to) < dist(best, to))) best = s;
    });
    return best;
  }
  came.forEach(function (to) {
    var p = after[to], pawn = isWhite(p) ? "P" : "p";
    var from = nearest(to, function (q) { return q === p; }) ||
      // promotion: the new piece comes from a pawn next to it
      nearest(to, function (q, s) { return p !== pawn && q === pawn && dist(s, to) < 1.5; });
    if (!from) return;
    used[from] = true;
    if (to !== noAnimSq) anims.push({ type: "slide", from: from, to: to, start: now, ms: animMs });
  });
  // Pieces that vanished were captured: fade them out.
  gone.forEach(function (s) {
    if (!used[s] && s !== noAnimSq) anims.push({ type: "fade", sq: s, piece: before[s], start: now, ms: animMs });
  });
  noAnimSq = null;
  animMs = MOVE_MS;
}

function applyAnims() {
  var now = performance.now(), size = boardEl.clientWidth / 8;
  anims = anims.filter(function (a) { return now - a.start < (a.ms || MOVE_MS); });
  anims.forEach(function (a) {
    var opts = { duration: a.ms || MOVE_MS, easing: "cubic-bezier(0.25, 0.8, 0.25, 1)" };
    var el, anim;
    if (a.type === "fade") {
      el = document.createElement("img");
      el.className = "piece captured";
      el.src = pieceImg(a.piece);
      el.alt = "";
      squareEl(a.sq).appendChild(el);
      anim = el.animate([{ opacity: 1 }, { opacity: 0 }], opts);
      anim.onfinish = function () { el.remove(); };
    } else {
      el = squareEl(a.to).querySelector(".piece:not(.captured)");
      if (!el) return;
      var dx = a.dx, dy = a.dy;
      if (a.type === "slide") {
        var p = sqXY(a.from), q = sqXY(a.to);
        dx = (p.x - q.x) * size; dy = (p.y - q.y) * size;
      }
      el.classList.add("moving");
      anim = el.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }], opts);
      anim.onfinish = function () { el.classList.remove("moving"); };
    }
    anim.currentTime = now - a.start;
  });
}

// ---------------------------------------------------------------- Render
function render() {
  if (!pos) return;
  var flipped = game.flipped;
  var dests = selected ? movesFrom(selected).map(function (m) { return m.slice(2, 4); }) : [];
  var last = pos.lastMove ? [pos.lastMove.slice(0, 2), pos.lastMove.slice(2, 4)] : [];
  var kingSq = null;
  var shown = game.view === null ? null : game.boards[game.view];
  if (shown) last = shown.lastMove ? [shown.lastMove.slice(0, 2), shown.lastMove.slice(2, 4)] : [];
  var src = shown || (pos.pending ? null : pos);
  var live = !shown;
  var eaten = src && src.ate ? src.ate.map(function (a) { return a.slice(1); }) : [];
  var seen = src && src.sees ? src.sees : [];
  if (src && src.inCheck) {
    var k = src.turn === "w" ? "K" : "k";
    kingSq = Object.keys(src.board).find(function (s) { return src.board[s] === k; });
  }

  // While waiting for the engine to confirm a move, show the move already made.
  var board = shown ? shown.board : pos.board;
  if (!shown && pos.pending && pos.lastMove) {
    board = Object.assign({}, board);
    var m = pos.lastMove, from = m.slice(0, 2), to = m.slice(2, 4), p = board[from];
    var df = FILES.indexOf(to[0]) - FILES.indexOf(from[0]);
    delete board[from];
    board[to] = m[4] ? (isWhite(p) ? m[4].toUpperCase() : m[4]) : p;
    if (p.toUpperCase() === "K" && Math.abs(df) === 2) { // castling: move the rook too
      var rFrom = (df > 0 ? "h" : "a") + to[1], rTo = (df > 0 ? "f" : "d") + to[1];
      board[rTo] = board[rFrom];
      delete board[rFrom];
    }
    if (p.toUpperCase() === "P" && df !== 0 && !pos.board[to]) delete board[to[0] + from[1]]; // en passant
  }

  var html = "";
  for (var row = 0; row < 8; row++) {
    for (var col = 0; col < 8; col++) {
      var file = flipped ? 7 - col : col;
      var rank = flipped ? row + 1 : 8 - row;
      var sq = FILES[file] + rank;
      var cls = "sq " + ((file + rank) % 2 ? "dark" : "light");
      if (last.indexOf(sq) >= 0) cls += " last";
      if (sq === selected) cls += " sel";
      if (sq === kingSq) cls += " check";
      if (live && scpShow && sq === scpShow.victim) cls += " trigger";
      if (eaten.indexOf(sq) >= 0) cls += " eaten";
      else if (seen.indexOf(sq) >= 0) cls += " seen";
      if (dests.indexOf(sq) >= 0) cls += " dest" + (board[sq] ? " occupied" : "");
      html += '<div class="' + cls + '" data-sq="' + sq + '" role="gridcell">';
      if (col === 0) html += '<span class="coord rank">' + rank + "</span>";
      if (row === 7) html += '<span class="coord file">' + FILES[file] + "</span>";
      if (board[sq]) {
        var pc = board[sq];
        var raging = live && scpShow && sq === scpShow.from;
        html += '<img class="piece' + (pc === SCP ? " scp" : "") + (raging ? " raging" : "") + '" draggable="false" src="' +
          pieceImg(pc) + '" alt="' + pieceAlt(pc) + '">';
      }
      html += "</div>";
    }
  }
  html += '<svg id="shapes" class="shapes" viewBox="0 0 8 8" aria-hidden="true"></svg>';
  if (live && scpShow) { // SCP-096's gaze: a beam from the piece that saw it
    var a = sqXY(scpShow.victim), b = sqXY(scpShow.from);
    html += '<svg class="scp-beam" viewBox="0 0 8 8" aria-hidden="true"><line x1="' + (a.x + 0.5) + '" y1="' + (a.y + 0.5) +
      '" x2="' + (b.x + 0.5) + '" y2="' + (b.y + 0.5) + '" pathLength="1"/></svg>';
  }
  diffAnims(shownBoard, board);
  shownBoard = board;
  boardEl.innerHTML = html;
  applyAnims();
  drawShapes();

  var engineName = $("engine-name").textContent;
  var youTop = game.playerColor === (flipped ? "w" : "b");
  setTag($("tag-top"), youTop ? "you" : "engine", engineName);
  setTag($("tag-bottom"), youTop ? "engine" : "you", engineName);

  // Status line
  var status;
  if (game.over) status = game.over;
  else if (scpShow) status = "SCP-096 was seen…";
  else if (thinking) status = "Engine is thinking…";
  else if (pos.turn === game.playerColor) status = "Your move" + (pos.inCheck ? " — check!" : "");
  else status = "Waiting…";
  if (game.view !== null) status = "Reviewing move " + game.view + " of " + game.moves.length +
    (thinking ? " · engine is thinking" : "") + " — press End to return";
  $("status").textContent = status;
  $("status").classList.toggle("reviewing", game.view !== null);

  renderMoves();
  $("btn-undo").disabled = !game.moves.length;
  var ply = shownPly(), live = game.boards.length - 1;
  $("btn-first").disabled = $("btn-prev").disabled = ply <= 0;
  $("btn-next").disabled = $("btn-last").disabled = ply >= live;
  $("evalbar").classList.toggle("flipped", flipped);
  analyse();
}

function renderMoves() {
  var body = $("moves");
  var rows = "";
  var cur = shownPly() - 1; // index into game.san of the move shown on the board
  function cell(j) {
    if (j >= game.san.length) return "<td></td>";
    return '<td data-ply="' + (j + 1) + '" class="' + (j === cur ? "current" : "") + '">' + game.san[j] + "</td>";
  }
  // Three movers: White, Black and SCP-096. A SCP-096 turn gets its own row,
  // so a row can hold just White's move ("…" stands in for the other half).
  var i = 0;
  while (i < game.san.length) {
    var num = Math.floor(i / 2) + 1;
    var row = "<tr><td>" + num + ".</td>";
    if (i % 2) row += '<td class="skip">…</td>' + cell(i);
    else if (game.ate[i] && game.ate[i].length) row += cell(i) + '<td class="skip"></td>';
    else row += cell(i) + cell(i + 1);
    rows += row + "</tr>";
    var j = i % 2 || (game.ate[i] && game.ate[i].length) || i + 1 >= game.san.length ? i : i + 1;
    if (game.ate[j] && game.ate[j].length) rows += scpRow(game.ate[j]);
    i = j + 1;
  }
  body.innerHTML = rows;
  $("moves-empty").hidden = game.san.length > 0;
  $("moves-empty").textContent = game.playerColor === "w"
    ? "No moves yet. You play White — make the first move."
    : "No moves yet. The engine plays White.";
  var card = body.closest(".moves-card");
  var curEl = body.querySelector("td.current");
  if (game.view === null) card.scrollTop = card.scrollHeight;
  else if (curEl) curEl.scrollIntoView({ block: "nearest" });
}

function scpRow(ate) {
  var items = ate.map(function (a) {
    return '<span class="scp-eat"><img src="' + pieceImg(a[0]) + '" alt="' + pieceAlt(a[0]) + '">' + a.slice(1) + "</span>";
  }).join(" ");
  return '<tr class="scp-turn"><td><img src="' + pieceImg(SCP) + '" alt="SCP-096"></td>' +
    '<td colspan="2">SCP-096 eats ' + items + "</td></tr>";
}

function pgn() {
  var out = "";
  game.san.forEach(function (s, i) {
    var resume = i % 2 === 1 && game.ate[i - 1] && game.ate[i - 1].length;
    out += (i % 2 === 0 ? (i / 2 + 1) + ". " : resume ? (i + 1) / 2 + "... " : "") + s + " ";
    if (game.ate[i] && game.ate[i].length) out += "{SCP-096 eats " + game.ate[i].join(" ") + "} ";
  });
  if (game.over) {
    out += /White wins/.test(game.over) ? "1-0" : /Black wins/.test(game.over) ? "0-1" : "1/2-1/2";
  }
  return out.trim();
}

// ---------------------------------------------------------------- Start
$("btn-new-white").onclick = function () { newGame("w"); };
$("btn-new-black").onclick = function () { newGame("b"); };
$("btn-undo").onclick = takeBack;
$("btn-flip").onclick = function () { game.flipped = !game.flipped; render(); };
$("btn-copy").onclick = function () {
  var btn = this;
  navigator.clipboard.writeText(pgn()).then(function () {
    btn.textContent = "Copied!";
    setTimeout(function () { btn.textContent = "Copy PGN"; }, 1200);
  });
};
$("sel-elo").onchange = setStrength;
$("btn-first").onclick = function () { viewPly(0); };
$("btn-prev").onclick = function () { viewPly(shownPly() - 1); };
$("btn-next").onclick = function () { viewPly(shownPly() + 1); };
$("btn-last").onclick = function () { viewPly(Infinity); };
$("moves").onclick = function (e) {
  var td = e.target.closest("td[data-ply]");
  if (td) viewPly(Number(td.dataset.ply));
};
document.addEventListener("keydown", function (e) {
  if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  var to = { ArrowLeft: shownPly() - 1, ArrowRight: shownPly() + 1, Home: 0, End: Infinity }[e.key];
  if (to === undefined || !game.boards.length) return;
  e.preventDefault();
  viewPly(to);
});
// Clicking the board while reviewing jumps back to the game.
boardEl.addEventListener("pointerdown", function (e) {
  if (game.view === null || e.button > 0) return;
  e.stopPropagation();
  viewPly(Infinity);
}, true);
$("chk-eval").onchange = toggleEval;

(function start() {
  if (!window.ENGINE_FILE) {
    $("status").textContent = "No engine found. Run ./make-web.sh first.";
    return;
  }
  engine = new Engine(window.ENGINE_FILE);
  // SCP-096 changes the start position and the moves, so stock Stockfish
  // can't follow the game: no eval bar (evalEngine stays null).
  $("chk-eval").closest("label").style.display = "none";
  $("evalbar").classList.add("off");
  engine.worker.onerror = function (e) {
    $("status").textContent = "Engine failed to load: " + (e.message || "unknown error");
  };
  engine.request(["uci"], function (l) { return l === "uciok"; }).then(function (lines) {
    var id = lines.find(function (l) { return l.indexOf("id name ") === 0; });
    var name = id ? id.slice(8) : "Engine";
    $("engine-name").textContent = name;
    document.title = "Play " + name.replace(/ \(based on.*\)/, "");
  });
  newGame("w");
})();
