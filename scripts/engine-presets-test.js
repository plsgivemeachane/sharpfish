#!/usr/bin/env node
"use strict";

// Run against this checkout, or pass variant checkout paths as arguments.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const plain = value => JSON.parse(JSON.stringify(value));

async function check(root) {
  const source = fs.readFileSync(path.join(root, "site/app.js"), "utf8");
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, "site/bots.js"), "utf8"), context);
  for (const name of ["loadBot", "strengthCommands", "engineMove"]) {
    const declaration = source.match(new RegExp("^function " + name + "\\([^]*?^\\}", "m"));
    assert(declaration, "Missing " + name);
    vm.runInContext(declaration[0], context);
  }
  const presets = context.BOT_GROUPS.filter(group => group.name === "Engine").flatMap(group => group.bots);
  assert(presets.length > 0);
  for (const preset of presets) {
    assert.equal(preset.elo, null, "Engine preset must use Full: " + preset.id);
    assert.equal(context.botRating(preset), "Full");
    // Existing saved numeric Engine selections must resolve to the current preset.
    context.localStorage = { getItem: () => JSON.stringify({ id: preset.id, elo: 2800, engineElo: 2800 }) };
    assert.equal(context.loadBot().elo, null);
    for (const match of [false, true]) for (const turn of ["w", "b"]) {
      context.game = { token: 1, moves: [], botMatch: match, matchBots: { [turn]: preset } };
      context.bot = match ? context.findBot("martin") : preset;
      context.pos = { turn };
      context.performance = { now: () => 0 };
      context.render = () => {};
      context.positionCmd = () => "position startpos";
      context.$ = () => ({ value: "1000" });
      context.minBotMoveMs = () => 0;
      context.setTimeout = callback => callback();
      let played, sent;
      context.playMove = move => { played = move; };
      context.engine = { request(commands) {
        sent = plain(commands);
        return { then(callback) { context.completed = callback(["bestmove e2e4"]); } };
      } };
      context.engineMove();
      await context.completed;
      assert.deepEqual(sent, ["setoption name Skill Level value 20",
        "setoption name UCI_LimitStrength value false", "position startpos", "go movetime 1000"]);
      assert.equal(played, "e2e4");
      if (context.botMetadata) {
        assert.equal(context.botMetadata(preset).engineElo, null);
        assert.equal(context.botMetadata(preset).searchNodes, null);
      }
    }
  }
  // Exercise the real selector setup with a minimal DOM.
  const start = source.indexOf('["white-bot", "black-bot"].forEach');
  const end = source.indexOf('$("btn-bot-match")', start);
  assert(start >= 0 && end > start);
  const selectors = Object.fromEntries(["white-bot", "black-bot"].map(id => [id, {
    value: "", options: [], add(option) { this.options.push(option); },
    appendChild(option) { this.options.push(option); }
  }]));
  context.$ = id => selectors[id];
  context.Option = function (text, value) { this.textContent = text; this.value = value; };
  context.document = { createElement: () => ({}) };
  vm.runInContext(source.slice(start, end), context);
  for (const selector of Object.values(selectors)) {
    assert.equal(context.findBot(selector.value).elo, null, "Both sides must default to Full");
    assert(selector.options.some(option => option.textContent.includes("Full")));
  }
  console.log("PASS " + root + ": Engine presets, saved selections, human games, both match sides and defaults");
}

(async () => {
  for (const root of process.argv.slice(2).length ? process.argv.slice(2) : [path.join(__dirname, "..")])
    await check(path.resolve(root));
})().catch(error => { console.error(error); process.exitCode = 1; });
