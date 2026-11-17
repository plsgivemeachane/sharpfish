/* Standalone, read-only PGN/history review. No bots are started here.
 * The recorded game is never edited: navigation, drawing and analysis only
 * change what is displayed and the stored grades. */
(function () {
  "use strict";
  var BADGE_ROOT = (window.SHARPFISH_VARIANT || {}).badgePath || "badges/";
  var SPECIAL_KEY = "sharpfish-special-grading";
  var TIME_KEY = "sharpfish-analysis-time";
  var $ = function (id) { return document.getElementById(id); };
  var LABELS = ["Best", "Excellent", "Good", "OK", "Inaccuracy", "Mistake", "Blunder", "Disaster", "Catastrophe", "Great", "Brilliant"];
  var BAD = { Inaccuracy: 1, Mistake: 1, Blunder: 1, Disaster: 1, Catastrophe: 1 };
  var FILES = "abcdefgh";
  var PIECE_NAMES = { P: "pawn", N: "knight", B: "bishop", R: "rook", Q: "queen", K: "king" };
  var SHAPE_COLORS = { blue: "#2589e8", red: "#882020", purple: "#a855f7", yellow: "#e68f00", green: "#57c7a2" };
  var ANIM_MS = 220, QUICK_MS = 120;
  var motionQuery = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;

  var state = {
    record: null, ply: 0, flipped: false, epoch: 0,
    gradeAnalyzer: null, gradeToken: 0, grading: false, paused: false,
    evalAnalyzer: null, evalToken: 0, evalTimer: 0, evalBusy: false,
    shownKey: null, shownBoard: null, shownRecordId: null, shownFlipped: false, lastNav: 0,
    shapes: [], drawing: null,
    alternative: null, alternativeAnalyzer: null, alternativeToken: 0, alternativePending: false,
    resumeGradingOnRestore: false
  };

  // ------------------------------------------------------------ Positions
  function boardFromFen(fen) {
    var out = {}, rows = String(fen || "").split(" ")[0].split("/");
    rows.forEach(function (row, y) { var x = 0; for (var i = 0; i < row.length; i++) { var c = row[i]; if (/\d/.test(c)) x += Number(c); else out[FILES[x++] + (8 - y)] = c; } });
    return out;
  }
  function boardAt(record, ply) {
    if (state.alternative && record === state.record && ply === state.ply) return state.alternative.position.board;
    if (!record) return SFAnalysis.parseBoard(SFAnalysis.START_FEN).board;
    var snap = record.boards && record.boards[ply];
    if (!snap) return ply === 0 ? SFAnalysis.parseBoard(record.startFen || SFAnalysis.START_FEN).board : {};
    if (snap.board && typeof snap.board === "object") return snap.board;
    return boardFromFen(snap.fen);
  }
  function sideAt(record, ply) { var snap = record && record.boards && record.boards[ply]; return snap && snap.turn || (ply % 2 ? "b" : "w"); }
  function moveCount() { return state.record && state.record.moves ? state.record.moves.length : 0; }
  function isWhite(p) { return !!p && p === p.toUpperCase(); }
  function pieceAsset(piece) { if (piece === "*") return "pieces/scp096.png"; return "pieces/" + (isWhite(piece) ? "w" : "b") + piece.toUpperCase() + ".svg"; }
  function isSupported(record) { return !!window.STOCK_ENGINE_FILE && SFAnalysis.supportsRecord(record); }
  function displayTitle(record) { var h = record.headers || {}; return h.White || h.Black ? (h.White || "White") + " — " + (h.Black || "Black") : (record.result && record.result !== "*" ? record.result : "Saved game"); }
  function resultText(record) { return record.result && record.result !== "*" ? " · " + record.result : " · in progress"; }
  function setError(message) { $("error").hidden = !message; $("error").textContent = message || ""; }
  function labelKey(label) { return String(label || "").toLowerCase().replace(/[^a-z]/g, ""); }
  function reduceMotion() { return !!(motionQuery && motionQuery.matches); }
  function specialOn() { return $("special-toggle").checked; }
  function analysisTime() { return Number($("analysis-time").value); }
  function validGrade(record, index, grade) {
    return !!(window.SFAnalysis && SFAnalysis.isValidGrade(grade, record, index, window.STOCK_ENGINE_FILE, specialOn(), analysisTime()));
  }
  function shownGrade(index) {
    var rec = state.record;
    if (!rec || index < 0 || !$("grade-toggle").checked) return null;
    var grade = rec.grades && rec.grades[index];
    return validGrade(rec, index, grade) && !grade.unavailable ? grade : null;
  }

  // ------------------------------------------------------------ Board
  function sqXY(sq) {
    var f = FILES.indexOf(sq[0]), r = Number(sq[1]);
    return state.flipped ? { x: 7 - f, y: r - 1 } : { x: f, y: 8 - r };
  }
  function squareEl(sq) { return $("board").querySelector('.sq[data-sq="' + sq + '"]'); }

  // Pair vanished pieces with appeared ones: slides, captures (fade out),
  // promotions (pawn slides in as its new piece) and reverse replay (fade in).
  function diffAnims(before, after) {
    var gone = Object.keys(before).filter(function (s) { return before[s] !== after[s]; });
    var came = Object.keys(after).filter(function (s) { return before[s] !== after[s]; });
    var used = {}, list = [];
    function dist(a, b) { var p = sqXY(a), q = sqXY(b); return Math.hypot(p.x - q.x, p.y - q.y); }
    function nearest(to, match) {
      var best = null;
      gone.forEach(function (s) { if (!used[s] && match(before[s], s) && (!best || dist(s, to) < dist(best, to))) best = s; });
      return best;
    }
    came.forEach(function (to) {
      var p = after[to], pawn = isWhite(p) ? "P" : "p";
      var from = nearest(to, function (q) { return q === p; }) ||
        nearest(to, function (q, s) { return p !== pawn && q === pawn && dist(s, to) < 1.5; }) ||
        nearest(to, function (q, s) { return p === pawn && q !== pawn && isWhite(q) === isWhite(p) && dist(s, to) < 1.5; });
      if (from) { used[from] = true; list.push({ type: "slide", from: from, to: to }); }
      else list.push({ type: "appear", sq: to });
    });
    gone.forEach(function (s) { if (!used[s]) list.push({ type: "fade", sq: s, piece: before[s] }); });
    return list;
  }
  function applyAnims(list, duration) {
    var size = $("board").clientWidth / 8, opts = { duration: duration, easing: "cubic-bezier(0.25, 0.8, 0.25, 1)" };
    list.forEach(function (a) {
      var el, anim;
      if (a.type === "fade") {
        var cell = squareEl(a.sq); if (!cell) return;
        el = document.createElement("img"); el.className = "piece captured"; el.src = pieceAsset(a.piece); el.alt = ""; el.draggable = false;
        cell.appendChild(el);
        anim = el.animate([{ opacity: 1 }, { opacity: 0 }], opts);
        anim.onfinish = anim.oncancel = function () { el.remove(); };
      } else {
        var target = squareEl(a.type === "slide" ? a.to : a.sq);
        el = target && target.querySelector(".piece:not(.captured)");
        if (!el) return;
        if (a.type === "appear") { el.animate([{ opacity: 0 }, { opacity: 1 }], opts); return; }
        var p = sqXY(a.from), q = sqXY(a.to);
        el.classList.add("moving");
        anim = el.animate([{ transform: "translate(" + (p.x - q.x) * size + "px," + (p.y - q.y) * size + "px)" }, { transform: "none" }], opts);
        anim.onfinish = function () { el.classList.remove("moving"); };
      }
    });
  }

  function lastMoveSquares() {
    var move = state.alternative ? state.alternative.move : state.record && state.ply > 0 && state.record.moves[state.ply - 1];
    return move ? [move.slice(0, 2), move.slice(2, 4)] : [];
  }
  function checkSquare(board) {
    var snap = state.alternative ? state.alternative.position : state.record && state.record.boards && state.record.boards[state.ply];
    if (!snap || !snap.inCheck) return null;
    var k = snap.turn === "w" ? "K" : "k";
    return Object.keys(board).find(function (s) { return board[s] === k; }) || null;
  }

  // Rebuild squares only when the displayed position or orientation changes.
  // Grade, evaluation and toggle updates patch overlays in place, so a piece
  // that is sliding keeps sliding and no motion is invented.
  function renderBoard() {
    var rec = state.record, key = (rec ? rec.id : "start") + "|" + state.ply + "|" + (state.flipped ? "b" : "w") + "|" + (state.alternative ? state.alternative.move : "played");
    if (key === state.shownKey) { updateOverlay(); drawShapes(); return; }
    var board = boardAt(rec, state.ply), el = $("board");
    var animate = state.shownBoard && !reduceMotion() && state.shownRecordId === (rec && rec.id) && state.shownFlipped === state.flipped;
    var now = performance.now(), duration = now - state.lastNav < ANIM_MS ? QUICK_MS : ANIM_MS;
    var anims = animate ? diffAnims(state.shownBoard, board) : [];
    el.getAnimations && el.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); });
    el.textContent = "";
    var last = lastMoveSquares(), check = checkSquare(board);
    for (var row = 0; row < 8; row++) for (var col = 0; col < 8; col++) {
      var file = state.flipped ? 7 - col : col, rank = state.flipped ? row + 1 : 8 - row, sq = FILES[file] + rank;
      var cell = document.createElement("div");
      cell.className = "sq " + ((file + rank) % 2 ? "dark" : "light") + (last.indexOf(sq) >= 0 ? " last" : "") + (sq === check ? " check" : "");
      cell.dataset.sq = sq; cell.setAttribute("role", "gridcell");
      if (col === 0) { var r = document.createElement("span"); r.className = "coord rank"; r.textContent = rank; cell.appendChild(r); }
      if (row === 7) { var f = document.createElement("span"); f.className = "coord file"; f.textContent = FILES[file]; cell.appendChild(f); }
      var piece = board[sq];
      if (piece) {
        var img = document.createElement("img"); img.className = "piece"; img.draggable = false; img.src = pieceAsset(piece);
        img.alt = piece === "*" ? "SCP-096" : (isWhite(piece) ? "White " : "Black ") + (PIECE_NAMES[piece.toUpperCase()] || "piece");
        cell.setAttribute("aria-label", sq + ", " + img.alt); cell.appendChild(img);
      } else cell.setAttribute("aria-label", sq);
      el.appendChild(cell);
    }
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "shapes"); svg.setAttribute("viewBox", "0 0 8 8"); svg.setAttribute("aria-hidden", "true"); svg.id = "shapes";
    el.appendChild(svg);
    if (anims.length) applyAnims(anims, duration);
    state.lastNav = now;
    state.shownKey = key; state.shownBoard = board; state.shownRecordId = rec && rec.id; state.shownFlipped = state.flipped;
    $("evalbar").classList.toggle("flipped", state.flipped);
    $("flip").setAttribute("aria-pressed", String(state.flipped));
    updateOverlay(); drawShapes();
  }
  function updateOverlay() {
    var board = $("board");
    board.querySelectorAll(".move-grade-overlay").forEach(function (n) { n.remove(); });
    if (state.alternative) return;
    var index = state.ply - 1, grade = shownGrade(index), move = state.record && state.record.moves[index];
    if (!grade || !move) return;
    var cell = squareEl(move.slice(2, 4)); if (!cell) return;
    var key = labelKey(grade.label || grade.objectiveLabel), badge = document.createElement("img");
    badge.className = "move-grade-overlay grade-" + key; badge.src = BADGE_ROOT + key + ".png";
    badge.alt = grade.label; badge.title = grade.label; badge.setAttribute("aria-label", grade.label);
    cell.appendChild(badge);
  }

  // ------------------------------------------------------------ Annotations
  function shapeColor(e) {
    var alt = e.altKey || e.ctrlKey || e.metaKey;
    return e.shiftKey && alt ? "yellow" : e.shiftKey ? "red" : alt ? "purple" : "blue";
  }
  function shapeSvg(s) { // 8x8 viewBox, one unit per square
    var a = sqXY(s.from), b = sqXY(s.to), ax = a.x + 0.5, ay = a.y + 0.5, bx = b.x + 0.5, by = b.y + 0.5;
    var color = SHAPE_COLORS[s.color] || SHAPE_COLORS.blue, g = '<g opacity="' + (s.preview ? 0.55 : 0.8) + '" data-shape="' + s.from + s.to + '">';
    if (s.from === s.to) return g + '<circle cx="' + ax + '" cy="' + ay + '" r="0.46" fill="none" stroke="' + color + '" stroke-width="0.07"/></g>';
    var pts = [[ax, ay]], dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    if (dx * dy === 2) pts.push(dy > dx ? [ax, by] : [bx, ay]); // knight jump: draw an L
    var lastPt = pts[pts.length - 1], ux = bx - lastPt[0], uy = by - lastPt[1], len = Math.hypot(ux, uy);
    ux /= len; uy /= len;
    var HEAD = 0.42, HALF = 0.26, baseX = bx - ux * HEAD, baseY = by - uy * HEAD;
    pts.push([baseX + ux * 0.02, baseY + uy * 0.02]);
    var head = [[bx, by], [baseX - uy * HALF, baseY + ux * HALF], [baseX + uy * HALF, baseY - ux * HALF]];
    var str = function (p) { return p.map(function (q) { return q[0].toFixed(3) + "," + q[1].toFixed(3); }).join(" "); };
    return g + '<polyline points="' + str(pts) + '" fill="none" stroke="' + color + '" stroke-width="0.16" stroke-linejoin="round"/><polygon points="' + str(head) + '" fill="' + color + '"/></g>';
  }
  function drawShapes() {
    var svg = $("shapes"); if (!svg) return;
    var list = state.drawing ? state.shapes.concat(Object.assign({ preview: true }, state.drawing)) : state.shapes;
    if (state.alternative) list = list.concat({ from: state.alternative.move.slice(0, 2), to: state.alternative.move.slice(2, 4), color: "green" });
    svg.innerHTML = list.map(shapeSvg).join("");
  }
  function clearShapes() { state.shapes = []; state.drawing = null; drawShapes(); }
  function squareAt(x, y) {
    var hit = document.elementFromPoint(x, y), cell = hit && hit.closest && hit.closest(".sq");
    return cell && $("board").contains(cell) ? cell : null;
  }
  function finishShape() {
    var s = state.drawing; state.drawing = null; if (!s) return;
    var i = state.shapes.findIndex(function (x) { return x.from === s.from && x.to === s.to; });
    if (i < 0) state.shapes.push(s);
    else if (state.shapes[i].color === s.color) state.shapes.splice(i, 1); // same shape again erases it
    else state.shapes[i] = s;                                              // another color recolors it
    drawShapes();
  }
  var boardEl = $("board");
  boardEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  boardEl.addEventListener("pointerdown", function (e) {
    var cell = e.target.closest(".sq");
    var draws = e.button === 2;
    if (draws && cell) {
      e.preventDefault();
      state.drawing = { from: cell.dataset.sq, to: cell.dataset.sq, color: shapeColor(e), button: e.button };
      try { boardEl.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
      drawShapes();
    } else if (e.button === 0 && state.shapes.length) clearShapes();
  });
  boardEl.addEventListener("pointermove", function (e) {
    if (!state.drawing) return;
    var cell = squareAt(e.clientX, e.clientY);
    if (cell && cell.dataset.sq !== state.drawing.to) { state.drawing.to = cell.dataset.sq; drawShapes(); }
  });
  boardEl.addEventListener("pointerup", function (e) {
    if (!state.drawing || e.button !== state.drawing.button) return;
    var cell = squareAt(e.clientX, e.clientY); if (cell) state.drawing.to = cell.dataset.sq;
    delete state.drawing.button; finishShape();
  });
  boardEl.addEventListener("pointercancel", function () { state.drawing = null; drawShapes(); });

  // ------------------------------------------------------------ Move list
  function renderMoves() {
    var list = $("moves"), rec = state.record, focused = document.activeElement && list.contains(document.activeElement) ? document.activeElement.dataset.ply : null;
    list.textContent = "";
    $("moves-empty").hidden = !!(rec && rec.moves.length);
    $("moves-empty").textContent = rec ? "This game has no moves." : "No game loaded. The board shows the starting position.";
    var counts = { w: {}, b: {} }, showGrades = $("grade-toggle").checked;
    if (!rec) { $("counts").textContent = ""; $("next-mistake").disabled = true; return; }
    var start = rec.startFen ? SFAnalysis.parseBoard(rec.startFen) : { turn: "w", fullmove: 1 }, offset = start.turn === "b" ? 1 : 0;
    (rec.san || []).forEach(function (move, i) {
      var grade = shownGrade(i), raw = rec.grades && rec.grades[i], unavailable = showGrades && validGrade(rec, i, raw) && raw.unavailable;
      var li = document.createElement("li"); li.dataset.ply = i + 1;
      if (state.ply === i + 1) { li.classList.add("selected"); li.setAttribute("aria-current", "step"); }
      var number = document.createElement("span"); number.className = "muted"; number.textContent = (start.fullmove + Math.floor((i + offset) / 2)) + (sideAt(rec, i) === "b" ? "…" : ".");
      var slot = document.createElement("span"); slot.className = "move-grade-slot";
      if (grade) { var icon = document.createElement("img"); icon.className = "move-grade-list-icon"; icon.src = BADGE_ROOT + labelKey(grade.label) + ".png"; icon.alt = ""; slot.appendChild(icon); }
      var text = document.createElement("span"); text.textContent = move || rec.moves[i] || "?";
      var badge = document.createElement("span"); badge.className = "move-label " + labelKey(grade && grade.label);
      badge.textContent = grade ? grade.label : unavailable ? "Unavailable" : showGrades && isSupported(rec) ? "Pending" : "—";
      badge.setAttribute("aria-label", unavailable ? raw.reason : grade ? grade.label : showGrades ? "Grade pending" : "Grade hidden");
      if (unavailable) badge.title = raw.reason;
      if (grade) { var side = sideAt(rec, i); counts[side][grade.label] = (counts[side][grade.label] || 0) + 1; }
      li.tabIndex = 0; li.setAttribute("role", "button"); li.append(number, slot, text, badge);
      li.onclick = function () { goTo(i + 1); };
      li.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goTo(i + 1); } };
      list.appendChild(li);
    });
    if (focused) { var again = list.querySelector('li[data-ply="' + focused + '"]'); if (again) again.focus({ preventScroll: true }); }
    function countText(side) { return Object.keys(counts[side]).sort(function (a, b) { return LABELS.indexOf(a) - LABELS.indexOf(b); }).map(function (key) { return key + " " + counts[side][key]; }).join(" · ") || "—"; }
    $("counts").textContent = showGrades ? "White: " + countText("w") + "  |  Black: " + countText("b") : "";
    $("next-mistake").disabled = !rec.moves.length || !showGrades;
  }
  function scrollMoveIntoView() {
    var list = $("moves"), li = list.querySelector("li.selected");
    if (!li) { if (state.ply === 0) list.scrollTop = 0; return; }
    var top = li.offsetTop - list.offsetTop, bottom = top + li.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }
  function renderDetail() {
    var detail = $("move-detail"), rec = state.record;
    if (!rec) { detail.textContent = "Import a PGN or choose a saved game."; return; }
    var unavailable = rec.grades && rec.grades[state.ply - 1];
    if ($("grade-toggle").checked && validGrade(rec, state.ply - 1, unavailable) && unavailable.unavailable) { detail.textContent = unavailable.reason; return; }
    if (!isSupported(rec)) { detail.textContent = "Replay only: this variant's custom rules cannot be graded by standard Stockfish."; return; }
    if (!$("grade-toggle").checked) { detail.textContent = "Turn on grading to analyze the recorded moves."; return; }
    if (!state.ply) { detail.textContent = "Select a move to see its analysis."; return; }
    var g = shownGrade(state.ply - 1);
    if (!g) { detail.textContent = "This move has not been graded yet."; return; }
    if (state.alternative) { detail.textContent = "Stockfish alternative: " + state.alternative.san + ". The saved game is unchanged."; return; }
    var bits = [g.label]; if (g.bestMove) bits.push("best " + g.bestMove); if (g.pv && g.pv.length) bits.push("line " + g.pv.slice(0, 5).join(" "));
    detail.textContent = bits.join(" · ");
  }
  function renderControls() {
    var rec = state.record, n = moveCount();
    $("game-title").textContent = rec ? displayTitle(rec) + resultText(rec) : "Paste a PGN or open a saved game";
    // Player rows above and below the board, as on the play page; they swap with the flip.
    var h = rec && rec.headers || {};
    [["tag-top", state.flipped ? "w" : "b"], ["tag-bottom", state.flipped ? "b" : "w"]].forEach(function (t) {
      var tag = $(t[0]), white = t[1] === "w";
      tag.querySelector(".tag-side").className = "tag-side " + t[1];
      tag.querySelector(".tag-name").textContent = (white ? h.White : h.Black) || (white ? "White" : "Black");
    });
    $("position-label").textContent = (state.alternative ? "Alternative " : "Position ") + state.ply + " / " + n;
    $("first").disabled = $("prev").disabled = !rec || state.ply === 0;
    $("next").disabled = $("last").disabled = !rec || state.ply >= n;
    $("copy").disabled = !rec;
    var supported = isSupported(rec);
    $("analysis-context").hidden = !rec || !SFAnalysis.snapshotAnalysis(rec);
    $("grade-toggle").disabled = $("eval-toggle").disabled = $("special-toggle").disabled = !!rec && !supported;
    $("analysis-time").disabled = !!rec && !supported;
    var alternativeButton = $("alternative-move");
    alternativeButton.disabled = state.alternativePending || !state.alternative && !alternativeGrade();
    alternativeButton.textContent = state.alternativePending ? "Loading alternative…" : state.alternative ? "Played move" : "Alternative move";
    alternativeButton.setAttribute("aria-pressed", String(!!state.alternative));
    alternativeButton.title = state.alternative ? "Return to the recorded move" : "Show Stockfish's alternative to the recorded move";
    var remaining = rec && supported && $("grade-toggle").checked && rec.moves.some(function (_, i) { return !validGrade(rec, i, rec.grades && rec.grades[i]); });
    var evaluating = state.evalBusy || !!state.evalTimer;
    var resume = !state.grading && !evaluating && state.paused && remaining;
    $("cancel").textContent = resume ? "Resume grading" : state.grading ? "Stop grading" : evaluating ? "Stop evaluation" : "Stop";
    $("cancel").disabled = !(state.grading || evaluating || resume);
    document.querySelectorAll("#history-list button").forEach(function (b) { if (rec && b.dataset.id === rec.id) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
    renderPerformance();
  }
  function renderPerformance() {
    var rec = state.record;
    $("performance").hidden = !rec || !isSupported(rec);
    if (!rec || !isSupported(rec)) return;
    var grades = rec.moves.map(function (_, i) { var grade = rec.grades && rec.grades[i]; return validGrade(rec, i, grade) ? grade : null; });
    var summary = SFAnalysis.performanceSummary(rec, grades), headers = rec.headers || {};
    [["w", "white", "White"], ["b", "black", "Black"]].forEach(function (row) {
      var player = summary[row[0]], prefix = "performance-" + row[1];
      var name = headers[row[2]] || "";
      $(prefix + "-name").textContent = name; $(prefix + "-name").hidden = !name || name === row[2];
      $(prefix + "-accuracy").textContent = player.accuracy == null ? "—" : player.accuracy.toFixed(1) + "%";
      $(prefix + "-accuracy").title = player.analyzed + " / " + player.total + " moves analyzed";
      $(prefix + "-elo").textContent = player.elo == null ? "—" : "≈ " + player.elo;
      $(prefix + "-elo").title = player.elo != null ? "Single-match performance estimate from average objective score loss" :
        player.analyzed < player.total ? "Waiting for this player's moves to be analyzed" : "Needs at least " + summary.minDecisions + " decisions with more than one legal move";
    });
    var analyzed = summary.w.analyzed + summary.b.analyzed, total = rec.moves.length;
    var text = !total ? "No moves to analyze." : analyzed < total ?
      analyzed + " / " + total + " moves analyzed." + (analyzed ? " Accuracy is provisional." : "") : "All " + total + " moves analyzed.";
    if (analyzed < total && !$("grade-toggle").checked) text += " Turn on grading to continue.";
    else if (analyzed === total && total && (summary.w.elo == null || summary.b.elo == null)) text += " Elo needs at least " + summary.minDecisions + " decisions per player.";
    var unavailable = grades.filter(function (grade) { return grade && grade.unavailable; }).length;
    if (unavailable) text += " " + unavailable + " unavailable in ordinary chess.";
    $("performance-progress").textContent = text;
  }
  function render() { renderBoard(); renderMoves(); renderDetail(); renderControls(); }

  function goTo(ply) {
    if (!state.record) return;
    ply = Math.max(0, Math.min(moveCount(), ply));
    if (ply === state.ply && !state.alternative && !state.alternativePending) return;
    var previous = state.ply;
    clearAlternative();
    state.ply = ply; state.shapes = []; state.drawing = null;
    render(); scrollMoveIntoView(); scheduleEval();
    if (window.SFSound && ply !== previous) {
      if (ply > previous) SFSound.move(state.record.boards[ply - 1], state.record.moves[ply - 1], state.record.boards[ply], ply === moveCount() && ["1-0", "0-1", "1/2-1/2"].includes(state.record.result));
      else SFSound.play("move");
    }
  }

  // Preview an engine move on a separate position; never append it to history.
  function alternativeGrade() {
    var grade = shownGrade(state.ply - 1), rec = state.record;
    if (!isSupported(rec) || !grade || ["Best", "Excellent"].includes(grade.label)) return null;
    var move = rec.moves[state.ply - 1], before = rec.boards && rec.boards[state.ply - 1];
    var legal = grade.analysisLegalMoves || (!SFAnalysis.snapshotAnalysis(rec) && before && before.legal);
    return grade.bestMove && grade.bestMove !== move && legal && legal.includes(grade.bestMove) ? grade : null;
  }
  function clearAlternative() {
    state.alternativeToken++;
    if (state.alternativeAnalyzer) state.alternativeAnalyzer.dispose();
    state.alternativeAnalyzer = null; state.alternativePending = false; state.alternative = null;
    $("alternative-status").hidden = true;
  }
  async function toggleAlternative() {
    if (state.alternative) { clearAlternative(); render(); scheduleEval(); return; }
    var grade = alternativeGrade(); if (!grade || state.alternativePending) return;
    var rec = state.record, ply = state.ply, move = grade.bestMove, token = ++state.alternativeToken;
    var analyzer = new SFAnalysis.Analyzer(window.STOCK_ENGINE_FILE);
    state.alternativeAnalyzer = analyzer; state.alternativePending = true;
    $("alternative-status").hidden = false; $("alternative-status").textContent = "Loading Stockfish's alternative…";
    renderControls();
    try {
      var projected = SFAnalysis.snapshotAnalysis(rec), before = projected ? await analyzer.recordPosition(rec, ply - 1) : rec.boards[ply - 1];
      var moves = projected ? [move] : rec.moves.slice(0, ply - 1).concat(move), startFen = projected ? before.fen : rec.startFen;
      var position = await analyzer.position(startFen, moves);
      if (token !== state.alternativeToken || rec !== state.record || ply !== state.ply) return;
      if (!alternativeGrade() || alternativeGrade().bestMove !== move) { clearAlternative(); renderControls(); return; }
      var san = SFAnalysis.sanCore(before, move) + (position.inCheck ? position.legal.length ? "+" : "#" : "");
      state.alternative = { move: move, position: position, san: san,
        record: projected ? { variant: rec.variant, moves: rec.moves.slice(), boards: rec.boards.slice(0, ply).concat(position) } : { startFen: startFen, moves: moves, boards: rec.boards.slice(0, ply).concat(position) } };
      state.shapes = []; state.drawing = null;
      $("alternative-status").textContent = "Stockfish: " + san + " instead of " + (rec.san[ply - 1] || rec.moves[ply - 1]) + ".";
      render(); scheduleEval(true);
      if (window.SFSound) SFSound.move(before, move, position);
    } catch (err) {
      if (token === state.alternativeToken && err.name !== "AbortError") $("alternative-status").textContent = "Could not load the alternative. Try again.";
    } finally {
      analyzer.dispose();
      if (token === state.alternativeToken) { state.alternativeAnalyzer = null; state.alternativePending = false; renderControls(); }
    }
  }

  // ------------------------------------------------------------ Evaluation
  function evalOn() { return !!state.record && isSupported(state.record) && $("eval-toggle").checked && !!window.SFAnalysis; }
  function showEval(visible) { $("evalbar").classList.toggle("off", !visible); $("eval-readout").classList.toggle("off", !visible); }
  function stopEval() {
    clearTimeout(state.evalTimer); state.evalTimer = 0; state.evalToken++;
    if (state.evalBusy && state.evalAnalyzer) state.evalAnalyzer.cancel();
    state.evalBusy = false;
  }
  function scheduleEval(immediate) {
    stopEval();
    if (!evalOn()) { showEval(false); renderControls(); return; }
    showEval(true);
    $("eval-readout").classList.add("pending"); $("eval-label").textContent = "…"; $("eval-detail").textContent = "Evaluating";
    state.evalTimer = setTimeout(function () { state.evalTimer = 0; evaluatePosition(); }, immediate ? 0 : 60); // let rapid replay settle
    renderControls();
  }
  function showEvaluation(e, partial) {
    var cp = e.cp == null ? (e.mateWinner === "w" ? 10000 : e.mateWinner === "b" ? -10000 : 0) : e.cp;
    var share = 1 / (1 + Math.exp(-0.00368208 * cp)); // same curve as the play page
    $("evalbar-white").style.height = (share * 100).toFixed(1) + "%";
    $("eval-label").textContent = e.scoreText || (cp / 100).toFixed(1);
    var lead = e.mate != null ? (e.mateWinner === "w" ? "White" : "Black") + " mates" : e.scoreText === "Draw" ? "Draw" : e.scoreText === "Checkmate" ? "Checkmate" : Math.abs(cp) < 35 ? "Equal" : (cp > 0 ? "White" : "Black") + " better";
    $("eval-detail").textContent = lead + (e.depth ? " · depth " + e.depth : "") + (partial ? "…" : "");
    $("eval-readout").classList.remove("pending");
    $("eval-readout").classList.toggle("black-better", cp < 0);
  }
  async function evaluatePosition() {
    if (!evalOn()) return;
    var token = ++state.evalToken, epoch = state.epoch, ply = state.ply;
    if (!state.evalAnalyzer) state.evalAnalyzer = new SFAnalysis.Analyzer(window.STOCK_ENGINE_FILE);
    state.evalBusy = true; renderControls();
    try {
      var live = function (e) { if (token === state.evalToken && epoch === state.epoch) showEvaluation(e, true); };
      var e = await state.evalAnalyzer.evaluate(state.alternative ? state.alternative.record : state.record, ply, { movetime: analysisTime(), onProgress: live });
      if (token !== state.evalToken || epoch !== state.epoch) return;
      showEvaluation(e, false);
    } catch (err) {
      if (token === state.evalToken && epoch === state.epoch && err.name !== "AbortError") {
        $("eval-label").textContent = "—"; $("eval-detail").textContent = "Unavailable";
        $("eval-readout").classList.remove("pending"); $("eval-readout").title = err.message;
        $("evalbar").classList.add("off");
        if (err.name !== "AnalysisUnavailableError") setError("Evaluation could not finish: " + err.message);
      }
    } finally {
      if (token === state.evalToken) { state.evalBusy = false; renderControls(); }
    }
  }

  // ------------------------------------------------------------ Grading
  function stopGrading(paused) {
    state.gradeToken++;
    if (state.gradeAnalyzer) state.gradeAnalyzer.dispose();
    state.gradeAnalyzer = null; state.grading = false; state.paused = !!paused;
  }
  function onGradeChanged(index) {
    if (index === state.ply - 1 && state.alternative && (!alternativeGrade() || alternativeGrade().bestMove !== state.alternative.move)) { clearAlternative(); render(); scheduleEval(); return; }
    renderMoves(); renderDetail(); renderControls();
    if (index === state.ply - 1) updateOverlay(); // never rebuilds squares
  }
  async function gradeAll() {
    stopGrading(false);
    var rec = state.record;
    if (!rec || !$("grade-toggle").checked || !isSupported(rec) || !window.SFAnalysis) { renderControls(); return; }
    var token = state.gradeToken, epoch = state.epoch, special = specialOn(), movetime = analysisTime();
    var analyzer = new SFAnalysis.Analyzer(window.STOCK_ENGINE_FILE);
    state.gradeAnalyzer = analyzer; state.grading = true; renderControls();
    function current() { return token === state.gradeToken && epoch === state.epoch && state.record === rec && special === specialOn() && movetime === analysisTime() && $("grade-toggle").checked; }
    var done = false;
    try {
      for (var i = 0; i < rec.moves.length; i++) {
        if (!current()) break;
        if (validGrade(rec, i, rec.grades && rec.grades[i])) continue;
        $("progress").textContent = "Grading move " + (i + 1) + " / " + rec.moves.length + "…";
        var grade;
        for (var attempt = 0; attempt < 2; attempt++) {
          try { grade = await analyzer.grade(rec, i, { specialMoves: special, difficulty: true, movetime: movetime }); break; }
          catch (err) {
            if (!current() || attempt === 1) throw err;
            analyzer.dispose(); analyzer = new SFAnalysis.Analyzer(window.STOCK_ENGINE_FILE);
            state.gradeAnalyzer = analyzer;
            $("progress").textContent = "Retrying move " + (i + 1) + " / " + rec.moves.length + "…";
          }
        }
        if (!current()) break; // a stale setting or game must not overwrite the active one
        rec.grades = rec.grades || {}; rec.grades[i] = grade; rec.updatedAt = Date.now();
        onGradeChanged(i);
        var patch = {}; patch[i] = grade;
        try { await SFHistory.updateGrades(rec.id, rec.revision, patch); } catch (_) { $("progress").textContent = "Grade ready; local saving failed."; }
      }
      done = current();
      if (done) {
        var unavailable = Object.keys(rec.grades || {}).filter(function (i) { return validGrade(rec, +i, rec.grades[i]) && rec.grades[i].unavailable; }).length;
        $("progress").textContent = unavailable ? (rec.moves.length - unavailable) + " moves graded; " + unavailable + " unavailable in ordinary chess." : rec.moves.length ? "All " + rec.moves.length + " moves graded." : "";
      }
    } catch (err) {
      if (token === state.gradeToken && err.name !== "AbortError") setError(err.message || "Move grading failed.");
    } finally {
      analyzer.dispose();
      if (state.gradeAnalyzer === analyzer) { state.gradeAnalyzer = null; state.grading = false; state.paused = !done; renderControls(); }
    }
  }
  function SFReviewSetGrade(index, grade) { // used by browser regressions to inject results
    if (!state.record) return;
    state.record.grades = state.record.grades || {}; state.record.grades[index] = grade; onGradeChanged(index);
  }
  window.SFReviewHooks = { setGrade: SFReviewSetGrade, state: function () { return { ply: state.ply, flipped: state.flipped, shapes: state.shapes.slice(), grading: state.grading }; } };

  // ------------------------------------------------------------ Games
  async function openRecord(record) {
    if (window.SFSound) SFSound.stop();
    state.epoch++; stopGrading(false); stopEval(); clearAlternative();
    state.record = record; state.ply = 0; state.shapes = []; state.drawing = null; setError("");
    var supported = isSupported(record);
    $("grade-toggle").checked = $("eval-toggle").checked = supported; // supported games start analyzed
    $("progress").textContent = "";
    render(); $("moves").scrollTop = 0;
    if (!supported) { showEval(false); setError(window.STOCK_ENGINE_FILE ? "This variant has no ordinary-chess analysis adapter yet. Replay is available." : "The stock Stockfish analysis engine is unavailable. Replay is available."); return; }
    gradeAll(); scheduleEval(true);
  }
  var importToken = 0;
  async function importPgn(text) {
    if (!window.SFAnalysis || !SFAnalysis.Analyzer || !window.STOCK_ENGINE_FILE) throw new Error("Analysis engine is unavailable.");
    var token = ++importToken, analyzer = new SFAnalysis.Analyzer(window.STOCK_ENGINE_FILE);
    $("progress").textContent = "Reading PGN…";
    try {
      var rec = await analyzer.replay(text); // the displayed game stays until this validates
      if (token !== importToken) return;
      rec.id = SFHistory.newId(); rec.createdAt = Date.now(); rec.updatedAt = rec.createdAt; rec.revision = 1; rec.grades = {};
      rec.variant = { slug: "classic", title: "Standard chess PGN", path: "/variants/classic/", supported: true };
      await SFHistory.save(rec);
      history.replaceState(null, "", "?game=" + encodeURIComponent(rec.id));
      await openRecord(rec);
      if (!state.grading) $("progress").textContent = "Game saved locally.";
      await refreshHistory();
    } finally { analyzer.dispose(); }
  }
  async function refreshHistory() {
    var list = $("history-list"); list.textContent = "";
    var records = await SFHistory.list(); $("history-empty").hidden = records.length > 0;
    records.forEach(function (rec) {
      var li = document.createElement("li"), button = document.createElement("button");
      button.type = "button"; button.dataset.id = rec.id;
      button.textContent = new Date(rec.createdAt || Date.now()).toLocaleString() + " · " + displayTitle(rec);
      button.onclick = async function () { var fresh = (await SFHistory.get(rec.id)) || rec; await openRecord(fresh); history.replaceState(null, "", "?game=" + encodeURIComponent(rec.id)); };
      li.appendChild(button); list.appendChild(li);
    });
    renderControls();
  }
  function pgnText() {
    if (!state.record) return "";
    var rec = state.record, headers = Object.assign({}, rec.headers || {}), out = "";
    if (SFAnalysis.snapshotAnalysis(rec)) headers.Variant = rec.variant.slug;
    if (rec.startFen) { headers.SetUp = "1"; headers.FEN = rec.startFen; }
    Object.keys(headers).forEach(function (key) { out += "[" + key + " " + JSON.stringify(String(headers[key])) + "]\n"; });
    if (out) out += "\n";
    var initial = rec.startFen ? SFAnalysis.parseBoard(rec.startFen) : { turn: "w", fullmove: 1 }, offset = initial.turn === "b" ? 1 : 0;
    (rec.san || []).forEach(function (move, i) {
      var black = (i + offset) % 2;
      if (!black || i === 0) out += (initial.fullmove + Math.floor((i + offset) / 2)) + (black ? "... " : ". ");
      out += move + " ";
    });
    return (out + (rec.result || "*")).trim();
  }

  // ------------------------------------------------------------ Controls
  if (window.SFSound) SFSound.bindToggle($("sound-toggle"));
  try { $("special-toggle").checked = localStorage.getItem(SPECIAL_KEY) !== "0"; } catch (_) { /* storage blocked */ }
  try { var savedTime = localStorage.getItem(TIME_KEY); if (["1000", "2000", "5000", "10000", "30000"].includes(savedTime)) $("analysis-time").value = savedTime; } catch (_) { /* storage blocked */ }
  $("analysis-time").onchange = function () {
    try { localStorage.setItem(TIME_KEY, this.value); } catch (_) { /* storage blocked */ }
    stopGrading(false); clearAlternative(); render();
    if ($("grade-toggle").checked) gradeAll();
    scheduleEval(true);
  };
  $("analyze").onclick = async function () { setError(""); try { await importPgn($("pgn-input").value); } catch (e) { setError(e.message || "Could not read PGN."); $("progress").textContent = ""; } };
  $("pgn-file").onchange = function () { var file = this.files[0]; if (!file) return; var reader = new FileReader(); reader.onload = function () { $("pgn-input").value = reader.result; }; reader.readAsText(file); };
  $("grade-toggle").onchange = function () {
    var wasAlternative = !!state.alternative; clearAlternative(); if (wasAlternative) scheduleEval();
    if (this.checked) { render(); gradeAll(); }
    else { stopGrading(false); $("progress").textContent = "Grading off."; render(); }
  };
  $("special-toggle").onchange = function () {
    var wasAlternative = !!state.alternative; clearAlternative(); if (wasAlternative) scheduleEval();
    try { localStorage.setItem(SPECIAL_KEY, this.checked ? "1" : "0"); } catch (_) { /* storage blocked */ }
    stopGrading(false); // the in-flight grade used the old setting
    render();
    if ($("grade-toggle").checked) gradeAll();
  };
  $("eval-toggle").onchange = function () { scheduleEval(true); };
  $("cancel").onclick = function () {
    if (state.grading || state.evalBusy || state.evalTimer) {
      var wasGrading = state.grading; stopEval(); $("eval-label").textContent = "–"; $("eval-detail").textContent = "Stopped";
      if (wasGrading) { stopGrading(true); $("progress").textContent = "Grading stopped."; }
      renderControls();
    } else gradeAll();
  };
  $("first").onclick = function () { goTo(0); };
  $("prev").onclick = function () { goTo(state.ply - 1); };
  $("next").onclick = function () { goTo(state.ply + 1); };
  $("last").onclick = function () { goTo(moveCount()); };
  $("flip").onclick = function () { state.flipped = !state.flipped; render(); };
  $("alternative-move").onclick = toggleAlternative;
  $("next-mistake").onclick = function () {
    for (var i = state.ply; i < moveCount(); i++) { var g = shownGrade(i); if (g && BAD[g.label]) { goTo(i + 1); return; } }
  };
  $("refresh-history").onclick = refreshHistory;
  $("copy").onclick = function () { navigator.clipboard && navigator.clipboard.writeText(pgnText()); };
  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === "f" || e.key === "F") { $("flip").click(); return; }
    var step = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key];
    if (step === undefined || !state.record) return;
    e.preventDefault();
    goTo(step === Infinity ? moveCount() : step === -Infinity ? 0 : state.ply + step);
  });
  window.addEventListener("pagehide", function () {
    state.resumeGradingOnRestore = state.grading;
    stopGrading(state.paused); stopEval(); clearAlternative();
    if (state.evalAnalyzer) state.evalAnalyzer.dispose();
    state.evalAnalyzer = null;
  });
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    render();
    if (state.resumeGradingOnRestore && $("grade-toggle").checked) gradeAll();
    state.resumeGradingOnRestore = false;
    scheduleEval(true);
  });

  (async function start() {
    render();
    try {
      await refreshHistory();
      var id = new URLSearchParams(location.search).get("game");
      if (id) { var rec = await SFHistory.get(id); if (rec) await openRecord(rec); else setError("That saved game is no longer in local history."); }
    } catch (e) { setError(e.message || "History is unavailable."); }
  }());
}());
