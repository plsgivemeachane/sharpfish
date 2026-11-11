// Play against the engine built by ./make-web.sh.
//
// The engine is the single source of truth for the rules: after every move the
// page asks it for the position ("d") and the legal moves ("go perft 1"). So if
// a fork changes the rules in src/variant/config.h, this board follows them
// with no JavaScript changes.
"use strict";

// ---------------------------------------------------------------- Engine
// Avatar next to your name: a drawn person. The engine's avatar comes from
// the chosen bot (bots.js); Stockfish's is the official logo
// (stockfishchess.org, GPLv3).
var YOU_AVATAR = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#2f7fd8"/>' +
       '<circle cx="16" cy="12.5" r="5.5" fill="#e8f2ff"/>' +
       '<path d="M6 27.5c1.6-5.2 5.4-8 10-8s8.4 2.8 10 8a16 16 0 0 1-20 0z" fill="#e8f2ff"/></svg>';
var tagState = new WeakMap();
function setTag(el, who, engineName, selectedBot) {
  var displayBot = selectedBot || bot;
  var name = who === "you" ? "You" : displayBot.id === "stockfish" ? engineName : displayBot.name;
  var rating = who === "you" ? "" : botRating(displayBot);
  var key = who + name + rating + displayBot.avatar;
  if (tagState.get(el) === key) return; // skip rebuilding on every render
  tagState.set(el, key);
  var avatarClass = who === "you" ? "avatar-you" : displayBot.id === "stockfish" ? "avatar-engine" : "avatar-bot";
  el.innerHTML = '<span class="avatar ' + avatarClass + '"></span><span class="tag-name"></span>' +
    '<span class="tag-rating"></span>';
  if (who === "you") el.firstChild.innerHTML = YOU_AVATAR;
  else el.firstChild.appendChild(avatarImg(displayBot));
  el.children[1].textContent = name;
  el.children[2].textContent = rating ? "(" + rating + ")" : "";
}

function avatarImg(b) {
  var img = document.createElement("img");
  img.src = b.avatar;
  img.alt = "";
  return img;
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

function pieceImg(p) { // p is a FEN letter, e.g. "N" or "q"
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

function isWhite(p) { return p && p === p.toUpperCase(); }

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
  var others = Object.values(board).filter(function (p) { return p.toUpperCase() !== "K"; });
  return others.length === 0 || (others.length === 1 && /[nbNB]/.test(others[0]));
}

// ---------------------------------------------------------------- State
var engine;
var engineName = "Stockfish";
var game = {
  moves: [],        // UCI moves from the start position
  san: [],          // matching SAN strings
  repKeys: [],      // position keys, for threefold repetition
  playerColor: "w",
  flipped: false,
  over: null,       // result text when the game has ended
  boards: [],       // snapshot after each ply (0 = start): { board, lastMove, turn, inCheck }
  view: null,       // ply being reviewed, or null for the live position
  token: 0          // bumped on new game / take back to ignore stale engine replies
};
var pos = null;     // { fen, board, turn, legal: [uci], inCheck }
var selected = null;
var thinking = false;
var premoves = []; // queued UCI moves, checked against engine legality one at a time

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
    var fen = "", inCheck = false, legal = [];
    lines.forEach(function (l) {
      var m;
      if (l.indexOf("Fen: ") === 0) fen = l.slice(5).trim();
      else if (l.indexOf("Checkers:") === 0) inCheck = l.slice(9).trim().length > 0;
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
      inCheck: inCheck
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

var MIN_BOT_MOVE_MS = 2100; // leave a little more than two seconds for premoves

function engineMove() {
  var token = game.token;
  var turn = pos.turn;
  var started = performance.now();
  thinking = true;
  render();

  var activeBot = game.botMatch ? game.matchBots[turn] : bot;
  engine.request(strengthCommands(activeBot).concat([positionCmd(), "go movetime " + $("sel-time").value]),
    function (l) { return l.indexOf("bestmove") === 0; },
    function (l) {
      if (token !== game.token || l.indexOf("info depth") !== 0) return;
      if (/ multipv (?!1 )\d+/.test(l)) return; // weak bots score every move; show the main line
      var depth = (l.match(/ depth (\d+)/) || [])[1];
      var score = formatScore(l, turn);
      if (score) $("engine-line").textContent = "Depth " + depth + " · eval " + score;
    }
  ).then(async function (lines) {
    if (token !== game.token) return;
    // A fast search still leaves time to plan. This wait does not occupy the
    // engine request queue; a new game/takeback can start immediately.
    await new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, MIN_BOT_MOVE_MS - (performance.now() - started)));
    });
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
  return { board: p.board, lastMove: lastMove, turn: p.turn, inCheck: p.inCheck };
}

// Review: step through earlier positions without changing the game.
function viewPly(ply) {
  var live = game.boards.length - 1;
  ply = Math.max(0, Math.min(ply, live));
  clearPremoves();
  game.view = ply === live ? null : ply;
  selected = null;
  render();
}
function shownPly() { return game.view === null ? game.boards.length - 1 : game.view; }

function playMove(uci) {
  $("promo").hidden = true;
  var token = game.token;
  if (pos.turn === game.playerColor) shapes = []; // your move clears your arrows
  game.san.push(toSan(pos, uci));
  game.moves.push(uci);
  if (!drag) selected = null;
  pos = Object.assign({}, pos, { lastMove: uci, pending: true });
  render();

  refreshPosition().then(function (next) {
    if (token !== game.token) return;
    next.lastMove = uci;
    pos = next;
    game.repKeys.push(next.repKey);
    game.boards.push(snapshot(next, uci));

    var i = game.san.length - 1;
    if (!next.legal.length) game.san[i] += next.inCheck ? "#" : "";
    else if (next.inCheck) game.san[i] += "+";

    checkGameOver();
    if (game.over) clearPremoves();
    if (runPremove()) return;
    render();
    maybeEngineTurn();
  });
}

function checkGameOver() {
  var winner = pos.turn === "w" ? "Black" : "White";
  if (!pos.legal.length) {
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
  if (pos && !pos.pending && !thinking && !game.over && (game.botMatch || pos.turn !== game.playerColor)) engineMove();
}

function newGame(color, botMatch) {
  clearPremoves();
  var token = ++game.token;
  pos = null;
  if (thinking) engine.stop();
  thinking = false;
  game.moves = []; game.san = []; game.over = null;
  game.boards = []; game.view = null;
  game.botMatch = !!botMatch;
  game.matchBots = botMatch ? { w: findBot($("white-bot").value), b: findBot($("black-bot").value) } : null;
  game.playerColor = color;
  game.flipped = color === "b";
  selected = null;
  $("engine-line").innerHTML = "&nbsp;";
  engine.request(["ucinewgame", "isready"], function (l) { return l === "readyok"; });
  refreshPosition().then(function (p) {
    if (token !== game.token) return;
    pos = p;
    game.repKeys = [p.repKey];
    game.boards = [snapshot(p, null)];
    render();
    maybeEngineTurn();
  });
}

function takeBack() {
  if (game.botMatch) return;
  clearPremoves();
  if (!game.moves.length) return;
  var token = ++game.token;
  pos = Object.assign({}, pos, { pending: true });
  if (thinking) engine.stop();
  thinking = false;
  // Undo back to the last position where it is the player's turn.
  do {
    game.moves.pop(); game.san.pop(); game.repKeys.pop();
  } while (game.moves.length && (game.moves.length % 2 === 0 ? "w" : "b") !== game.playerColor);
  // If that leaves the engine to move (playing Black, all undone), it moves again below.
  game.boards.length = game.moves.length + 1;
  game.view = null;
  game.over = null;
  selected = null;
  refreshPosition().then(function (p) {
    if (token !== game.token) return;
    p.lastMove = game.moves[game.moves.length - 1];
    pos = p;
    render();
    maybeEngineTurn();
  });
}

// ---------------------------------------------------------------- Bots
// The opponent: a bot from bots.js, or a custom Elo from the slider.
var bot = loadBot();

function loadBot() {
  try {
    var saved = JSON.parse(localStorage.getItem("sharpfish-bot"));
    if (saved && saved.id === "custom") return customBot(saved.elo);
    if (saved && findBot(saved.id)) return findBot(saved.id);
  } catch (e) { /* storage blocked: use the default */ }
  return findBot("martin");
}

function chooseBot(b) {
  bot = b;
  try {
    localStorage.setItem("sharpfish-bot", JSON.stringify({ id: b.id, elo: b.elo }));
  } catch (e) { /* storage blocked: fine, just not remembered */ }
  setStrength();
  renderBots();
  render();
}

function strengthCommands(selectedBot) {
  return selectedBot.elo === FULL
    ? ["setoption name UCI_LimitStrength value false"]
    : ["setoption name UCI_LimitStrength value true", "setoption name UCI_Elo value " + selectedBot.elo];
}

function setStrength() {
  engine.request(strengthCommands(bot).concat("isready"), function (l) { return l === "readyok"; });
}

function renderBots() {
  var box = $("bot-groups");
  if (!box.firstChild) {
    BOT_GROUPS.forEach(function (g) {
      var group = document.createElement("div");
      group.className = "bot-group";
      group.innerHTML = '<div class="bot-group-name"></div><div class="bot-grid"></div>';
      group.firstChild.textContent = g.name;
      g.bots.forEach(function (b) {
        var btn = document.createElement("button");
        btn.className = "bot";
        btn.dataset.id = b.id;
        btn.title = b.name + " (" + botRating(b) + ")";
        btn.setAttribute("aria-label", btn.title);
        btn.appendChild(avatarImg(b));
        btn.onclick = function () { chooseBot(b); };
        group.lastChild.appendChild(btn);
      });
      box.appendChild(group);
    });
  }
  box.querySelectorAll(".bot").forEach(function (btn) {
    btn.classList.toggle("chosen", btn.dataset.id === bot.id);
    btn.setAttribute("aria-pressed", btn.dataset.id === bot.id);
  });
  $("bot-current").textContent = (bot.custom ? "Custom" : bot.name) + " · " + botRating(bot);
  var slider = $("rng-elo");
  slider.value = bot.elo === FULL ? slider.max : bot.elo;
  $("elo-out").textContent = bot.elo === FULL ? "Full" : bot.elo;
}

function sliderBot() {
  var v = Number($("rng-elo").value);
  return customBot(v > ELO_MAX ? FULL : v);
}

// ---------------------------------------------------------------- Input
function canMove() {
  return !game.botMatch && pos && !pos.pending && !thinking && !game.over && game.view === null &&
    pos.turn === game.playerColor;
}

// Premoves are speculative: geometry is only a preview. The engine's legal
// moves remain authoritative when each queued move reaches the player's turn.
function canPremove() {
  return !game.botMatch && pos && !pos.pending && !game.over && game.view === null &&
    pos.turn !== game.playerColor;
}

function clearPremoves() {
  premoves = [];
  selected = null;
  $("promo").hidden = true;
  if (drag) endDrag();
}

function premoveBoard(base) {
  var board = Object.assign({}, base || pos.board);
  premoves.forEach(function (uci) {
    var from = uci.slice(0, 2), to = uci.slice(2, 4), piece = board[from];
    if (!piece || (isWhite(piece) ? "w" : "b") !== game.playerColor) return;
    if (piece.toUpperCase() === "P" && from[0] !== to[0] && !board[to]) {
      var captured = to[0] + from[1];
      if (board[captured] === (isWhite(piece) ? "p" : "P")) delete board[captured];
    }
    delete board[from];
    board[to] = uci[4] ? (isWhite(piece) ? uci[4].toUpperCase() : uci[4]) : piece;
    if (piece.toUpperCase() === "K" && Math.abs(FILES.indexOf(to[0]) - FILES.indexOf(from[0])) === 2) {
      var rookFrom = (to[0] === "g" ? "h" : "a") + from[1];
      var rookTo = (to[0] === "g" ? "f" : "d") + from[1];
      if (board[rookFrom] === (isWhite(piece) ? "R" : "r")) {
        board[rookTo] = board[rookFrom];
        delete board[rookFrom];
      }
    }
  });
  return board;
}

function premoveMoves(from) {
  var board = premoveBoard(), piece = board[from];
  if (!piece || (isWhite(piece) ? "w" : "b") !== game.playerColor) return [];
  var moves = [], type = piece.toUpperCase(), direction = isWhite(piece) ? 1 : -1;
  for (var f = 0; f < 8; f++) for (var rank = 1; rank <= 8; rank++) {
    var to = FILES[f] + rank, target = board[to];
    if (to === from || (target && isWhite(target) === isWhite(piece))) continue;
    var dx = Math.abs(f - FILES.indexOf(from[0])), dy = rank - Number(from[1]), ay = Math.abs(dy);
    var allowed = type === "N" ? dx * ay === 2 :
      type === "B" ? dx === ay : type === "R" ? dx === 0 || dy === 0 :
      type === "Q" ? dx === ay || dx === 0 || dy === 0 :
      type === "K" ? Math.max(dx, ay) === 1 ||
        (from === (isWhite(piece) ? "e1" : "e8") && dy === 0 && dx === 2) :
      type === "P" && ((dy === direction && dx <= 1) ||
        (dx === 0 && dy === direction * 2 && Number(from[1]) === (isWhite(piece) ? 2 : 7)));
    if (!allowed) continue;
    if (type === "P" && (rank === 1 || rank === 8)) {
      ["q", "r", "b", "n"].forEach(function (p) { moves.push(from + to + p); });
    } else moves.push(from + to);
  }
  return moves;
}

function queuePremove(uci) {
  premoves.push(uci);
  selected = null;
  noAnimSq = null;
  render();
}

function runPremove() {
  if (!premoves.length || !canMove()) return false;
  var uci = premoves.shift();
  if (pos.legal.indexOf(uci) < 0) { clearPremoves(); return false; }
  playMove(uci);
  return true;
}

function movesFrom(sq) {
  return canPremove() ? premoveMoves(sq) : pos.legal.filter(function (m) { return m.slice(0, 2) === sq; });
}

function tryMove(from, to, anchorEl) {
  var queued = canPremove();
  if (!queued && !canMove()) return false;
  var options = movesFrom(from).filter(function (m) { return m.slice(2, 4) === to; });
  if (!options.length) return false;
  var commit = queued ? function (uci) { if (canPremove()) queuePremove(uci); } :
    function (uci) { if (canMove() && pos.legal.indexOf(uci) >= 0) playMove(uci); };
  if (options.length === 1) { commit(options[0]); return true; }
  showPromotion(options, anchorEl, commit);
  return true;
}

function showPromotion(options, anchorEl, commit) {
  var box = $("promo");
  var white = game.playerColor === "w";
  box.innerHTML = "";
  ["q", "n", "r", "b"].forEach(function (p) {
    var uci = options.find(function (m) { return m[4] === p; });
    if (!uci) return; // the variant may forbid underpromotion
    var btn = document.createElement("button");
    btn.setAttribute("aria-label", "Promote to " + PIECE_NAMES[p]);
    btn.innerHTML = '<img src="' + pieceImg(white ? p.toUpperCase() : p) + '" alt="">';
    btn.onclick = function () { box.hidden = true; commit(uci); };
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
}, true);

function squareAt(x, y) {
  var el = document.elementFromPoint(x, y);
  var sq = el && el.closest(".sq");
  return sq && boardEl.contains(sq) ? sq : null;
}

var drag = null;

// ---- Annotations: right-click a square for a circle, right-drag for an arrow.
// Default = blue, Shift = red, Alt/Ctrl = purple, Shift+Alt = yellow. Left click clears them.
var shapes = [];      // { from, to, color }; from === to is a circle
var drawing = null;   // the shape being drawn right now
var SHAPE_COLORS = { blue: "#2589e8", red: "#882020", purple: "#a855f7", yellow: "#e68f00" };

function shapeColor(e) {
  var alt = e.altKey || e.ctrlKey || e.metaKey;
  return e.shiftKey && alt ? "yellow" : e.shiftKey ? "red" : alt ? "purple" : "blue";
}

boardEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });
boardEl.addEventListener("auxclick", function (e) { if (e.button === 1) e.preventDefault(); });

boardEl.addEventListener("pointerdown", function (e) {
  if (e.button === 1) {
    e.preventDefault();
    clearPremoves();
    render();
    return;
  }
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
  if (!sqEl || (!canMove() && !canPremove()) || e.button > 0) return;
  var sq = sqEl.dataset.sq;
  var piece = (canPremove() ? premoveBoard() : pos.board)[sq];

  // Clicking a highlighted target finishes a click-move.
  if (selected && sq !== selected && tryMove(selected, sq, sqEl)) return;

  if (piece && (isWhite(piece) ? "w" : "b") === game.playerColor) {
    // Capture first: render() below replaces the element under the pointer,
    // and some browsers end the gesture when the pressed element disappears.
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    e.preventDefault();
    var wasSelected = selected === sq;
    selected = sq;
    render();
    startDrag(sq, e, wasSelected);
  } else {
    clearPremoves();
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
      anims.push({ type: "snap", to: d.from, start: performance.now(),
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
var ANIM_MS = 220;
var reduceMotion = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
var shownPremoves = false; // speculative boards must not seed real-move animations
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
    if (to !== noAnimSq) anims.push({ type: "slide", from: from, to: to, start: now });
  });
  // Pieces that vanished were captured: fade them out.
  gone.forEach(function (s) {
    if (!used[s] && s !== noAnimSq) anims.push({ type: "fade", sq: s, piece: before[s], start: now });
  });
  noAnimSq = null;
}

function applyAnims() {
  var now = performance.now(), size = boardEl.clientWidth / 8;
  anims = anims.filter(function (a) { return now - a.start < ANIM_MS; });
  anims.forEach(function (a) {
    var opts = { duration: ANIM_MS, easing: "cubic-bezier(0.25, 0.8, 0.25, 1)" };
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

  // Keep the final queue projection visible even while a played move is
  // awaiting confirmation. Never animate between speculative snapshots.
  var projecting = !shown && premoves.length > 0;
  if (projecting) board = premoveBoard(board);

  var html = "";
  for (var row = 0; row < 8; row++) {
    for (var col = 0; col < 8; col++) {
      var file = flipped ? 7 - col : col;
      var rank = flipped ? row + 1 : 8 - row;
      var sq = FILES[file] + rank;
      var cls = "sq " + ((file + rank) % 2 ? "dark" : "light");
      if (last.indexOf(sq) >= 0) cls += " last";
      if (sq === selected) cls += " sel";
      var queuedAt = game.view === null ? premoves.reduce(function (list, m, i) {
        if (m.slice(2, 4) === sq) list.push(i + 1);
        return list;
      }, []) : [];
      if (queuedAt.length) cls += " premove";
      if (sq === kingSq) cls += " check";
      if (dests.indexOf(sq) >= 0) cls += " dest" + (board[sq] ? " occupied" : "");
      html += '<div class="' + cls + '" data-sq="' + sq + '" role="gridcell">';
      if (col === 0) html += '<span class="coord rank">' + rank + "</span>";
      if (row === 7) html += '<span class="coord file">' + FILES[file] + "</span>";
      if (board[sq]) {
        var pc = board[sq];
        html += '<img class="piece" draggable="false" src="' + pieceImg(pc) + '" alt="' +
          (isWhite(pc) ? "white " : "black ") + PIECE_NAMES[pc.toLowerCase()] + '">';
      }
      if (queuedAt.length) html += '<span class="premove-order">' + queuedAt.join(",") + "</span>";
      html += "</div>";
    }
  }
  html += '<svg id="shapes" class="shapes" viewBox="0 0 8 8" aria-hidden="true"></svg>';
  if (projecting || shownPremoves) { anims = []; noAnimSq = null; }
  else diffAnims(shownBoard, board);
  shownPremoves = projecting;
  shownBoard = board;
  boardEl.innerHTML = html;
  applyAnims();
  // The board DOM changes when the bot moves, but the user's pointer capture
  // and ghost belong to the ongoing gesture. Rebind its source image.
  if (drag) {
    var source = squareEl(drag.from).querySelector(".piece:not(.captured)");
    if (source && source.getAttribute("src") === drag.ghost.getAttribute("src")) {
      drag.img = source;
      source.classList.add("dragging");
    } else {
      endDrag();
      selected = null; // the bot captured the piece being held
    }
  }
  drawShapes();

  var youTop = game.playerColor === (flipped ? "w" : "b");
  if (game.botMatch) {
    setTag($("tag-top"), "engine", engineName, game.matchBots[flipped ? "w" : "b"]);
    setTag($("tag-bottom"), "engine", engineName, game.matchBots[flipped ? "b" : "w"]);
  } else {
    setTag($("tag-top"), youTop ? "you" : "engine", engineName);
    setTag($("tag-bottom"), youTop ? "engine" : "you", engineName);
  }

  // Status line
  var status;
  if (game.over) status = game.over;
  else if (thinking) status = game.botMatch ? game.matchBots[pos.turn].name + " is thinking…" : "Engine is thinking…";
  else if (!game.botMatch && pos.turn === game.playerColor) status = "Your move" + (pos.inCheck ? " — check!" : "");
  else status = "Waiting…";
  if (game.view !== null) status = "Reviewing move " + game.view + " of " + game.moves.length +
    (thinking ? " · engine is thinking" : "") + " — press End to return";
  $("premove-state").hidden = !premoves.length;
  $("premove-count").textContent = premoves.length + (premoves.length === 1 ? " premove queued" : " premoves queued");
  $("status").textContent = status;
  $("status").classList.toggle("reviewing", game.view !== null);

  renderMoves();
  $("btn-undo").disabled = game.botMatch || !game.moves.length;
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
  for (var i = 0; i < game.san.length; i += 2) {
    rows += "<tr><td>" + (i / 2 + 1) + ".</td>" + cell(i) + cell(i + 1) + "</tr>";
  }
  body.innerHTML = rows;
  $("moves-empty").hidden = game.san.length > 0;
  $("moves-empty").textContent = game.botMatch ? "The bots are ready to play." : game.playerColor === "w"
    ? "No moves yet. You play White — make the first move."
    : "No moves yet. The engine plays White.";
  var card = body.closest(".moves-card");
  var curEl = body.querySelector("td.current");
  if (game.view === null) card.scrollTop = card.scrollHeight;
  else if (curEl) curEl.scrollIntoView({ block: "nearest" });
}

function pgn() {
  var out = "";
  game.san.forEach(function (s, i) { out += (i % 2 === 0 ? (i / 2 + 1) + ". " : "") + s + " "; });
  if (game.over) {
    out += /White wins/.test(game.over) ? "1-0" : /Black wins/.test(game.over) ? "0-1" : "1/2-1/2";
  }
  return out.trim();
}

// ---------------------------------------------------------------- Start
function syncGameMode() {
  var bots = $("game-mode").value === "bots";
  $("bot-match-options").hidden = !bots;
  $("btn-new-white").parentElement.hidden = bots;
}
$("game-mode").onchange = syncGameMode;
window.addEventListener("pageshow", syncGameMode);
syncGameMode();
["white-bot", "black-bot"].forEach(function (id) {
  BOT_GROUPS.forEach(function (group) {
    group.bots.forEach(function (b) {
      var option = document.createElement("option");
      option.value = b.id;
      option.textContent = b.name + " · " + botRating(b);
      $(id).appendChild(option);
    });
  });
});
$("white-bot").value = "martin";
$("black-bot").value = "stockfish";
$("btn-bot-match").onclick = function () { newGame("w", true); };
$("btn-new-white").onclick = function () { newGame("w"); };
$("btn-new-black").onclick = function () { newGame("b"); };
$("btn-undo").onclick = takeBack;
$("btn-cancel-premoves").onclick = function () { clearPremoves(); render(); };
$("btn-flip").onclick = function () { game.flipped = !game.flipped; render(); };
$("btn-copy").onclick = function () {
  var btn = this;
  navigator.clipboard.writeText(pgn()).then(function () {
    btn.textContent = "Copied!";
    setTimeout(function () { btn.textContent = "Copy PGN"; }, 1200);
  });
};
$("rng-elo").oninput = function () {  // live label while dragging
  var b = sliderBot();
  $("elo-out").textContent = b.elo === FULL ? "Full" : b.elo;
};
$("rng-elo").onchange = function () { chooseBot(sliderBot()); };
$("btn-first").onclick = function () { viewPly(0); };
$("btn-prev").onclick = function () { viewPly(shownPly() - 1); };
$("btn-next").onclick = function () { viewPly(shownPly() + 1); };
$("btn-last").onclick = function () { viewPly(Infinity); };
$("moves").onclick = function (e) {
  var td = e.target.closest("td[data-ply]");
  if (td) viewPly(Number(td.dataset.ply));
};
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") { clearPremoves(); render(); return; }
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
  $("evalbar").classList.toggle("off", !$("chk-eval").checked); // off unless ticked
  if (window.STOCK_ENGINE_FILE) {
    evalEngine = new Engine(window.STOCK_ENGINE_FILE);
    evalEngine.worker.onerror = function () { $("evalbar").classList.add("off"); evalEngine = null; };
    evalEngine.request(["uci"], function (l) { return l === "uciok"; });
  } else {
    $("evalbar").classList.add("off");
  }
  engine.worker.onerror = function (e) {
    $("status").textContent = "Engine failed to load: " + (e.message || "unknown error");
  };
  renderBots();
  engine.request(["uci"], function (l) { return l === "uciok"; }).then(function (lines) {
    var id = lines.find(function (l) { return l.indexOf("id name ") === 0; });
    var name = id ? id.slice(8) : "Engine";
    engineName = name;
    document.title = "Sharpfish · " + name.replace(/ \(based on.*\)/, "");
    render();
  });
  setStrength();
  newGame("w");
})();
