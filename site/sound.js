/* Shared chess sounds. Samples are served locally; see sounds/README.md. */
(function () {
  "use strict";
  var KEY = "sharpfish-sound", ROOT = (window.SHARPFISH_VARIANT || {}).soundPath || "sounds/";
  var NAMES = ["move", "capture", "check", "castle", "promotion", "start", "end"];
  var context = null, gain = null, files = {}, buffers = {}, active = [], generation = 0, toggles = [];
  var enabled = readPreference();

  function readPreference() {
    try { return localStorage.getItem(KEY) !== "0"; } catch (_) { return true; }
  }
  function fetchFile(name) {
    if (!files[name]) files[name] = fetch(ROOT + name + ".mp3").then(function (response) {
      if (!response.ok) throw new Error("Sound unavailable");
      return response.arrayBuffer();
    }).catch(function () { return null; });
    return files[name];
  }
  function preload() { if (enabled) NAMES.forEach(fetchFile); }
  function buffer(name) {
    if (!buffers[name]) buffers[name] = fetchFile(name).then(function (data) {
      return data && context ? context.decodeAudioData(data.slice(0)) : null;
    }).catch(function () { return null; });
    return buffers[name];
  }
  // Only create/resume audio inside a gesture. Initial page loads stay silent,
  // and browsers that block audio never interrupt chess or accumulate a queue.
  function unlock() {
    if (!enabled) return;
    try {
      if (!context) {
        var Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        context = new Audio(); gain = context.createGain(); gain.gain.value = 0.55;
        gain.connect(context.destination);
      }
      if (context.state !== "running") context.resume().catch(function () {});
      NAMES.forEach(buffer);
    } catch (_) { /* Audio is optional. */ }
  }
  function stop() {
    generation++;
    active.forEach(function (source) { try { source.stop(); } catch (_) { /* already ended */ } });
    active = [];
  }
  function play(name) {
    if (!enabled || !context || context.state !== "running" || NAMES.indexOf(name) < 0) return;
    stop();
    var token = generation, started = performance.now();
    buffer(name).then(function (decoded) {
      if (!decoded || !enabled || token !== generation || context.state !== "running" || performance.now() - started > 400) return;
      try {
        var source = context.createBufferSource(); source.buffer = decoded; source.connect(gain);
        source.onended = function () { source.disconnect(); active = active.filter(function (s) { return s !== source; }); };
        active.push(source); source.start();
      } catch (_) { /* Missing audio hardware must not affect play. */ }
    });
  }
  function move(before, uci, after, finished) {
    if (!before || !after || !before.board || !uci) return;
    var from = uci.slice(0, 2), to = uci.slice(2, 4), piece = (before.board[from] || "").toUpperCase();
    var name = finished ? "end" : after.inCheck ? "check" : uci.length === 5 ? "promotion" :
      piece === "K" && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2 ? "castle" :
      before.board[to] || (piece === "P" && from[0] !== to[0]) || (after.ate && after.ate.length) ? "capture" : "move";
    play(name);
  }
  function sync() { toggles.forEach(function (el) { el.checked = enabled; }); }
  function bindToggle(el) {
    if (!el) return;
    toggles.push(el); sync();
    el.onchange = function () {
      enabled = el.checked; stop();
      try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch (_) { /* session preference still works */ }
      sync();
      if (enabled) { preload(); unlock(); }
    };
  }
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
  window.addEventListener("storage", function (event) {
    if (event.key === KEY || event.key === null) { enabled = readPreference(); if (!enabled) stop(); sync(); preload(); }
  });
  window.addEventListener("pageshow", function () { enabled = readPreference(); if (!enabled) stop(); sync(); preload(); });
  window.addEventListener("pagehide", stop);
  window.SFSound = { play: play, move: move, stop: stop, bindToggle: bindToggle };
  preload();
}());
