/* Standalone, read-only PGN/history review. No bots are started here. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var LABELS = ["Best", "Excellent", "Good", "OK", "Inaccuracy", "Mistake", "Blunder", "Disaster", "Catastrophe", "Great", "Brilliant"];
  var BAD = { Inaccuracy: 1, Mistake: 1, Blunder: 1, Disaster: 1, Catastrophe: 1 };
  var state = { record: null, ply: 0, analyzer: null, evalAnalyzer: null, grading: false, evaluating: false, epoch: 0, gradeToken: 0, evalToken: 0 };
  var FILES = "abcdefgh";

  function escText(value) { return value == null ? "" : String(value); }
  function boardFromFen(fen) {
    var out = {}, rows = String(fen || "").split(" ")[0].split("/");
    rows.forEach(function (row, y) { var x = 0; for (var i = 0; i < row.length; i++) { var c = row[i]; if (/\d/.test(c)) x += Number(c); else out[FILES[x++] + (8 - y)] = c; } });
    return out;
  }
  function boardAt(record, ply) {
    var snap = record && record.boards && record.boards[ply];
    if (!snap) return record ? {} : SFAnalysis.parseBoard(SFAnalysis.START_FEN).board;
    if (snap.board && typeof snap.board === "object") return snap.board;
    return boardFromFen(snap.fen);
  }
  function fenAt(record, ply) { var snap = record && record.boards && record.boards[ply]; return snap && snap.fen || ""; }
  function sideAt(record, ply) { var snap = record && record.boards && record.boards[ply]; return snap && snap.turn || (ply % 2 ? "b" : "w"); }
  function pieceAsset(piece) { if (piece === "*") return "/variants/scp-096/pieces/scp096.png"; return "pieces/" + (piece === piece.toUpperCase() ? "w" : "b") + piece.toUpperCase() + ".svg"; }
  function isSupported(record) { return !record.variant || record.variant.supported !== false; }
  function displayTitle(record) { var h = record.headers || {}; return h.White || h.Black ? (h.White || "White") + " — " + (h.Black || "Black") : (record.result && record.result !== "*" ? record.result : "Saved game"); }
  function setError(message) { $("error").hidden = !message; $("error").textContent = message || ""; }
  function resultText(record) { return record.result && record.result !== "*" ? " · " + record.result : " · in progress"; }

  function renderBoard() {
    var board = $("board"); board.textContent = "";
    var data = boardAt(state.record, state.ply);
    for (var rank = 8; rank >= 1; rank--) for (var file = 0; file < 8; file++) {
      var square = FILES[file] + rank, cell = document.createElement("div");
      cell.className = "square " + ((file + rank) % 2 ? "dark" : "light"); cell.dataset.sq = square; cell.setAttribute("role", "gridcell");
      var piece = data[square]; if (piece) { var img = document.createElement("img"); img.className = "piece"; img.src = pieceAsset(piece); img.alt = (piece === piece.toUpperCase() ? "White " : "Black ") + ({P:"pawn",N:"knight",B:"bishop",R:"rook",Q:"queen",K:"king"}[piece.toUpperCase()] || "piece"); cell.appendChild(img);
        var moveIndex = state.ply - 1, shownMove = state.record && state.record.moves && state.record.moves[moveIndex];
        var grade = state.record && state.record.grades && validGrade(state.record, moveIndex, state.record.grades[moveIndex]) ? state.record.grades[moveIndex] : null;
        if (shownMove && shownMove.slice(2, 4) === square && $("grade-toggle").checked && grade) {
          var key = labelKey(grade.label || grade.objectiveLabel), badge = document.createElement("img"); badge.className = "move-grade-overlay grade-" + key; badge.src = "badges/" + key + ".png"; badge.alt = grade.label; badge.title = grade.label; badge.setAttribute("aria-label", grade.label); cell.appendChild(badge);
        }
      }
      board.appendChild(cell);
    }
    $("position-label").textContent = "Position " + state.ply + " / " + ((state.record && state.record.moves) || []).length;
  }
  function labelKey(label) { return String(label || "").toLowerCase().replace(/[^a-z]/g, ""); }
  function validGrade(record, index, grade) {
    return SFAnalysis.isValidGrade(grade, record, index, window.STOCK_ENGINE_FILE);
  }
  function renderMoves() {
    var list = $("moves"); list.textContent = ""; var rec = state.record; if (!rec) return;
    var grades = rec.grades || {}, san = rec.san || [], counts = { w: {}, b: {} }, showGrades = $("grade-toggle").checked;
    san.forEach(function (move, i) {
      var grade = validGrade(rec, i, grades[i]) ? grades[i] : null, li = document.createElement("li"); li.dataset.ply = i + 1; if (state.ply === i + 1) li.classList.add("selected");
      var start = rec.startFen ? SFAnalysis.parseBoard(rec.startFen) : { turn: "w", fullmove: 1 };
      var offset = start.turn === "b" ? 1 : 0;
      var number = document.createElement("span"); number.className = "muted"; number.textContent = (start.fullmove + Math.floor((i + offset) / 2)) + (sideAt(rec, i) === "b" ? "…" : ".");
      var text = document.createElement("span"); text.textContent = move || rec.moves[i] || "?";
      var badge = document.createElement("span"); badge.className = "move-label " + labelKey(grade && grade.label); badge.textContent = showGrades && grade && grade.label || (showGrades ? "Pending" : "—"); badge.setAttribute("aria-label", showGrades && grade ? grade.label : "Grade hidden");
      if (showGrades && grade) { var side = sideAt(rec, i); counts[side][grade.label] = (counts[side][grade.label] || 0) + 1; }
      var slot = document.createElement("span"); slot.className = "move-grade-slot";
      if (showGrades && grade) { var icon = document.createElement("img"); icon.className = "move-grade-list-icon"; icon.src = "badges/" + labelKey(grade.label) + ".png"; icon.alt = ""; slot.appendChild(icon); }
      li.tabIndex = 0; li.setAttribute("role", "button"); li.append(number, slot, text, badge); var select = function () { state.ply = Number(li.dataset.ply); render(); if ($("eval-toggle").checked) evaluatePosition(); }; li.onclick = select; li.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } };
      list.appendChild(li);
    });
    function countText(side) { return Object.keys(counts[side]).sort(function (a, b) { return LABELS.indexOf(a) - LABELS.indexOf(b); }).map(function (key) { return key + " " + counts[side][key]; }).join(" · ") || "—"; }
    $("counts").textContent = "White: " + countText("w") + "  |  Black: " + countText("b");
    $("next-mistake").disabled = !rec.moves.length;
  }
  function renderDetail() {
    var detail = $("move-detail"), g = state.record && state.record.grades && validGrade(state.record, state.ply - 1, state.record.grades[state.ply - 1]) ? state.record.grades[state.ply - 1] : null; detail.textContent = "";
    if (!$("grade-toggle").checked) { detail.textContent = "Turn on grading to analyze the recorded moves."; return; }
    if (!g) { detail.textContent = state.ply ? "This move has not been graded yet." : "Select a move to see its analysis."; return; }
    var bits = [g.label || "Pending"]; if (g.bestMove) bits.push("best " + g.bestMove); if (g.pv && g.pv.length) bits.push("line " + g.pv.slice(0, 5).join(" ")); detail.textContent = bits.join(" · ");
  }
  function render() { renderBoard(); renderMoves(); renderDetail(); $("game-title").textContent = state.record ? displayTitle(state.record) + resultText(state.record) : "Paste a PGN to begin"; $("copy").disabled = !state.record; }

  async function openRecord(record) {
    state.epoch++; state.gradeToken++; state.evalToken++; if (state.analyzer) state.analyzer.cancel && state.analyzer.cancel(); if (state.evalAnalyzer) state.evalAnalyzer.cancel && state.evalAnalyzer.cancel(); state.record = record; state.ply = 0; state.grading = false; $("grade-toggle").checked = false; $("eval-toggle").checked = false; $("evalbar").classList.add("off"); setError(""); render();
    if (record && record.grades) renderMoves();
    $("grade-toggle").disabled = $("eval-toggle").disabled = !isSupported(record);
    if (!isSupported(record)) setError("This variant can be replayed here. Standard chess grading and evaluation are unavailable for its custom rules.");
  }
  async function importPgn(text) {
    if (!window.SFAnalysis || !SFAnalysis.Analyzer) throw new Error("Analysis engine is unavailable.");
    var previous = state.analyzer; if (previous) previous.cancel && previous.cancel(); state.analyzer = new SFAnalysis.Analyzer(window.STOCK_ENGINE_FILE || window.ENGINE_FILE); var token = ++state.gradeToken, epoch = ++state.epoch; var importAnalyzer = state.analyzer;
    $("progress").textContent = "Reading PGN…";
    try { var rec = await importAnalyzer.replay(text); if (token !== state.gradeToken || epoch !== state.epoch) return; rec.id = SFHistory.newId(); rec.createdAt = Date.now(); rec.updatedAt = rec.createdAt; rec.revision = 1; rec.grades = {}; rec.variant = { slug: "classic", title: "Standard chess PGN", path: "/variants/classic/", supported: true }; await SFHistory.save(rec); await openRecord(rec); $("progress").textContent = "Game saved locally."; await refreshHistory(); }
    finally { importAnalyzer.dispose && importAnalyzer.dispose(); if (state.analyzer === importAnalyzer) state.analyzer = null; }
  }
  async function gradeAll() {
    if (!state.record || !$("grade-toggle").checked || !isSupported(state.record) || !window.SFAnalysis) return;
    var token = ++state.gradeToken, epoch = state.epoch, analyzer = new SFAnalysis.Analyzer(window.STOCK_ENGINE_FILE || window.ENGINE_FILE); state.analyzer = analyzer; state.grading = true; $("cancel").disabled = false; var rec = state.record;
    try { for (var i = 0; i < rec.moves.length; i++) { if (token !== state.gradeToken || epoch !== state.epoch || !$("grade-toggle").checked) break; if (validGrade(rec, i, rec.grades && rec.grades[i])) continue; $("progress").textContent = "Grading move " + (i + 1) + " / " + rec.moves.length + "…"; var grade = await analyzer.grade(rec, i, { difficulty: true }); if (token !== state.gradeToken || epoch !== state.epoch) break; rec.grades = rec.grades || {}; rec.grades[i] = grade; rec.updatedAt = Date.now(); renderBoard(); renderMoves(); renderDetail(); var patch = {}; patch[i] = grade; await SFHistory.updateGrades(rec.id, rec.revision, patch); } $("progress").textContent = token === state.gradeToken ? "Grading complete." : "Grading paused."; }
    catch (err) { if (token === state.gradeToken) setError(err.message || "Move grading failed."); }
    finally { analyzer.dispose && analyzer.dispose(); if (state.analyzer === analyzer) { state.analyzer = null; state.grading = false; $("cancel").disabled = true; } }
  }
  async function evaluatePosition() {
    if (!state.record || !$("eval-toggle").checked || !window.SFAnalysis || !isSupported(state.record)) return;
    var token = ++state.evalToken, epoch = state.epoch; if (state.evalAnalyzer) state.evalAnalyzer.cancel && state.evalAnalyzer.cancel(); var analyzer = new SFAnalysis.Analyzer(window.STOCK_ENGINE_FILE || window.ENGINE_FILE); state.evalAnalyzer = analyzer;
    $("evalbar").classList.remove("off"); $("eval-label").textContent = "…";
    try { var e = await analyzer.evaluate(state.record, state.ply, { depth: 14 }); if (token !== state.evalToken || epoch !== state.epoch) return; var cp = e.cp == null ? (e.mateWinner === "w" ? 10000 : e.mateWinner === "b" ? -10000 : 0) : e.cp; var share = 1 / (1 + Math.exp(-0.00368208 * cp)); $("evalbar-white").style.height = (share * 100).toFixed(1) + "%"; $("eval-label").textContent = e.scoreText || (cp / 100).toFixed(1); }
    catch (err) { if (token === state.evalToken && epoch === state.epoch && err.name !== "AbortError") { $("eval-label").textContent = "?"; setError("Evaluation could not finish: " + err.message); } }
    finally { analyzer.dispose && analyzer.dispose(); if (state.evalAnalyzer === analyzer) state.evalAnalyzer = null; }
  }
  async function refreshHistory() {
    var list = $("history-list"); list.textContent = ""; var records = await SFHistory.list(); $("history-empty").hidden = records.length > 0;
    records.forEach(function (rec) { var li = document.createElement("li"), button = document.createElement("button"); button.type = "button"; button.textContent = new Date(rec.createdAt || Date.now()).toLocaleString() + " · " + displayTitle(rec); button.onclick = async function () { await openRecord(rec); history.replaceState(null, "", "?game=" + encodeURIComponent(rec.id)); }; li.appendChild(button); list.appendChild(li); });
  }
  function pgnText() {
    if (!state.record) return "";
    var rec = state.record, headers = Object.assign({}, rec.headers || {}), out = "";
    if (rec.startFen) { headers.SetUp = "1"; headers.FEN = rec.startFen; }
    Object.keys(headers).forEach(function (key) {
      out += "[" + key + " " + JSON.stringify(String(headers[key])) + "]\n";
    });
    if (out) out += "\n";
    var initial = rec.startFen ? SFAnalysis.parseBoard(rec.startFen) : { turn: "w", fullmove: 1 };
    var offset = initial.turn === "b" ? 1 : 0;
    (rec.san || []).forEach(function (move, i) {
      var black = (i + offset) % 2;
      if (!black || i === 0) out += (initial.fullmove + Math.floor((i + offset) / 2)) + (black ? "... " : ". ");
      out += move + " ";
    });
    return (out + (rec.result || "*")).trim();
  }
  $("analyze").onclick = async function () { setError(""); try { await importPgn($("pgn-input").value); } catch (e) { setError(e.message || "Could not read PGN."); $("progress").textContent = ""; } };
  $("pgn-file").onchange = function () { var file = this.files[0]; if (!file) return; var reader = new FileReader(); reader.onload = function () { $("pgn-input").value = reader.result; }; reader.readAsText(file); };
  $("grade-toggle").onchange = function () { render(); if (this.checked) gradeAll(); else { state.gradeToken++; if (state.analyzer) state.analyzer.cancel && state.analyzer.cancel(); $("progress").textContent = "Grading paused."; $("cancel").disabled = true; } };
  $("eval-toggle").onchange = function () { if (this.checked) evaluatePosition(); else { state.evalToken++; if (state.evalAnalyzer) state.evalAnalyzer.cancel && state.evalAnalyzer.cancel(); $("evalbar").classList.add("off"); } };
  $("cancel").onclick = function () { state.gradeToken++; state.evalToken++; if (state.analyzer) state.analyzer.cancel && state.analyzer.cancel(); if (state.evalAnalyzer) state.evalAnalyzer.cancel && state.evalAnalyzer.cancel(); $("cancel").disabled = true; $("progress").textContent = "Analysis cancelled."; };
  $("first").onclick = function () { state.ply = 0; render(); if ($("eval-toggle").checked) evaluatePosition(); };
  $("prev").onclick = function () { state.ply = Math.max(0, state.ply - 1); render(); if ($("eval-toggle").checked) evaluatePosition(); };
  $("next").onclick = function () { state.ply = Math.min(state.record ? state.record.moves.length : 0, state.ply + 1); render(); if ($("eval-toggle").checked) evaluatePosition(); };
  $("last").onclick = function () { state.ply = state.record ? state.record.moves.length : 0; render(); if ($("eval-toggle").checked) evaluatePosition(); };
  $("next-mistake").onclick = function () { var grades = state.record && state.record.grades || {}; for (var i = state.ply; i < (state.record ? state.record.moves.length : 0); i++) if (BAD[grades[i] && grades[i].label]) { state.ply = i + 1; render(); if ($("eval-toggle").checked) evaluatePosition(); return; } };
  $("refresh-history").onclick = refreshHistory;
  $("copy").onclick = function () { navigator.clipboard && navigator.clipboard.writeText(pgnText()); };
  document.addEventListener("keydown", function (e) { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; var key = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key]; if (key === undefined || !state.record) return; e.preventDefault(); state.ply = key === Infinity ? state.record.moves.length : key === -Infinity ? 0 : Math.max(0, Math.min(state.record.moves.length, state.ply + key)); render(); if ($("eval-toggle").checked) evaluatePosition(); });
  (async function start() { try { await refreshHistory(); var id = new URLSearchParams(location.search).get("game"); if (id) { var rec = await SFHistory.get(id); if (rec) await openRecord(rec); } render(); } catch (e) { setError(e.message || "History is unavailable."); } }());
}());
