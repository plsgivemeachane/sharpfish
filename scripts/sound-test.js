#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("site/sound.js", "utf8");

function setup({ muted = false, broken = false, noAudio = false, blockedStorage = false, slow = false } = {}) {
  const listeners = {}, played = [], stopped = [], fetched = [], stored = new Map();
  if (muted) stored.set("sharpfish-sound", "0");
  let created = 0, now = 0;
  const pending = [];
  const win = {
    addEventListener(name, fn) { listeners[name] = fn; },
    AudioContext: noAudio ? undefined : function () {
      created++;
      this.state = "suspended";
      this.createGain = () => ({ gain: {}, connect() {} });
      this.resume = async () => { this.state = "running"; };
      this.decodeAudioData = async data => data;
      this.createBufferSource = () => {
        const node = { connect() {}, disconnect() {}, start() { played.push(node.buffer); }, stop() { stopped.push(node.buffer); } };
        return node;
      };
    }
  };
  const sandbox = {
    window: win, document: { addEventListener(name, fn) { listeners[name] = fn; } },
    localStorage: { getItem(key) { if (blockedStorage) throw Error("blocked"); return stored.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw Error("blocked"); stored.set(key, value); } },
    performance: { now: () => now },
    fetch(url) {
      fetched.push(url);
      if (broken) return Promise.reject(Error("offline"));
      const response = { ok: true, arrayBuffer: async () => url };
      return slow ? new Promise(resolve => pending.push(() => resolve(response))) : Promise.resolve(response);
    }
  };
  vm.runInNewContext(source, sandbox);
  return { api: win.SFSound, played, stopped, fetched, listeners, stored, get created() { return created; },
    advance(ms) { now += ms; }, finishDownloads() { pending.forEach(fn => fn()); }, unlock() { listeners.pointerdown(); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  const s = setup(), toggle = {};
  s.api.bindToggle(toggle);
  assert.equal(toggle.checked, true);
  assert.equal(s.created, 0, "loading the page does not initialize or play audio");
  s.api.play("move"); await flush(); assert.equal(s.played.length, 0);
  s.unlock(); await flush();
  const before = { board: { e2: "P", d5: "p", e1: "K", f1: "R", h1: "R", a7: "P", a8: "r" } };
  for (const [move, after, finished, name] of [
    ["e2e4", {}, false, "move"], ["e2d5", {}, false, "capture"],
    ["e2d3", {}, false, "capture"], // en passant has an empty destination
    ["e1h1", {}, false, "castle"], ["e1f1", {}, false, "castle"], ["e1g1", {}, false, "castle"], ["e1c1", {}, false, "castle"],
    ["a7a8q", {}, false, "promotion"], ["a7a8q", { inCheck: true }, false, "check"],
    ["e2e4", { inCheck: true }, true, "end"], ["e2e4", {}, true, "end"],
    ["e2e4", { ate: ["Bd5"] }, false, "capture"]
  ]) {
    s.api.move(before, move, after, finished); await flush();
    assert.equal(s.played.at(-1), `sounds/${name}.mp3`, move + " routing");
  }
  assert.equal(s.created, 1, "reuse one audio context");
  assert.equal(s.fetched.length, 7, "fetch each sample only once");
  const prior = s.played.length;
  toggle.checked = false; toggle.onchange();
  assert.equal(s.stored.get("sharpfish-sound"), "0");
  s.api.play("move"); await flush(); assert.equal(s.played.length, prior);
  assert(s.stopped.length > 0, "mute stops any playing sound");
  s.stored.set("sharpfish-sound", "1"); s.listeners.storage({ key: "sharpfish-sound" });
  assert.equal(toggle.checked, true, "other tabs update the toggle");
  s.api.play("move"); s.api.play("capture"); await flush();
  assert.equal(s.played.length, prior + 1, "only latest pending event plays");
  assert.equal(s.played.at(-1), "sounds/capture.mp3");
  s.api.play("check"); s.listeners.pagehide(); await flush();
  assert.equal(s.played.length, prior + 1, "pagehide cancels pending audio");

  const muted = setup({ muted: true }), other = {};
  muted.api.bindToggle(other); muted.unlock(); muted.api.play("move"); await flush();
  assert.equal(other.checked, false); assert.equal(muted.created, 0); assert.equal(muted.fetched.length, 0);
  other.checked = true; other.onchange(); await flush(); muted.api.play("move"); await flush();
  assert.equal(muted.played.at(-1), "sounds/move.mp3", "unmuting unlocks playback");

  const delayed = setup({ slow: true }); delayed.unlock(); delayed.api.play("move");
  delayed.advance(500); delayed.finishDownloads(); await flush();
  assert.equal(delayed.played.length, 0, "slow downloads never play stale move sounds later");
  for (const options of [{ broken: true }, { noAudio: true }, { blockedStorage: true }]) {
    const quiet = setup(options); quiet.unlock(); await flush(); quiet.api.play("move"); await flush();
    const checkbox = {}; quiet.api.bindToggle(checkbox); checkbox.checked = false; checkbox.onchange();
  }
  console.log("PASS sound routing, autoplay unlock, mute/persistence, cancellation, caching, slow/offline audio and blocked storage");
})().catch(error => { console.error(error); process.exitCode = 1; });
