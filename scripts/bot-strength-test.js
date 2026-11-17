#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const bots = require("../site/bots.js");
const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "site/app.js"), "utf8");
const botSource = fs.readFileSync(path.join(root, "site/bots.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

function test(name, run) {
  return Promise.resolve().then(run).then(() => console.log("PASS " + name));
}

function browserContext() {
  const context = vm.createContext({});
  // No CommonJS globals: the existing browser script must expose its helpers.
  vm.runInContext(botSource, context);
  for (const name of ["loadBot", "strengthCommands", "sliderBot", "engineMove"]) {
    const declaration = source.match(new RegExp("^function " + name + "\\([^]*?^\\}", "m"));
    assert(declaration, "Missing app declaration: " + name);
    vm.runInContext(declaration[0], context);
  }
  return context;
}

async function main() {
  await test("all 64 rated slider steps retain their displayed target and monotonic bounded controls", () => {
    let steps = 0;
    let previous = -1;
    for (let target = 0; target <= 3150; target += 50) {
      const bot = bots.customBot(target);
      const config = bots.botSearchConfig(bot, 300);
      assert.equal(bot.elo, target);
      const range = bots.BOT_CALIBRATION.supportedRange;
      assert.equal(bots.botRating(bot), range && (target < range[0] || target > range[1])
        ? "≈" + Math.max(range[0], Math.min(range[1], target)) : String(target));
      assert.equal(config.profile.target, target);
      assert(Number.isInteger(config.profile.engineElo));
      assert(config.profile.engineElo >= previous && config.profile.engineElo <= 3150);
      previous = config.profile.engineElo;
      assert.equal(config.profile.version, bots.BOT_CALIBRATION.version);
      assert.equal(config.profile.status, bots.BOT_CALIBRATION.status);
      assert.deepEqual(config.profile.provenance, bots.BOT_CALIBRATION.provenance);
      if (config.profile.status === "pending-calibration") {
        assert.equal(config.profile.engineElo, target, "pending fallback must remain identity");
        assert.equal(config.profile.provenance, null, "pending fallback must not invent evidence");
      }
      assert.equal(config.profile.estimated, true);
      assert.deepEqual(bot.profile, config.profile);
      assert.equal(config.go, "go nodes 100000 movetime 300");
      assert.deepEqual(config.limits, { nodes: 100000, movetime: 300 });
      steps++;
    }
    assert.equal(steps, 64);
  });

  await test("all 21 named labels and raw controls agree with the measured report", () => {
    const report = require("../calibration/2026-11-17/report.json");
    assert.equal(report.bots.length, 21);
    assert.equal(report.measurement.games, 2400);
    assert.equal(report.measurement.errors, 0);
    assert.equal(report.measurement.plyCapDraws, 0);
    assert.equal(bots.BOT_CALIBRATION.version, report.version);
    for (const measured of report.bots) {
      const bot = bots.findBot(measured.id), profile = bots.botSearchConfig(bot).profile;
      assert.equal(bot.elo, measured.displayElo);
      assert.equal(bot.previousElo, measured.previousElo);
      assert.equal(profile.engineElo, measured.engineElo);
      assert.equal(profile.nodes, 100000);
    }
    assert.equal(bots.ratingProfile(1800).engineElo, 1750);
    assert.equal(bots.ratingProfile(0).supported, false);
    assert.equal(bots.ratingProfile(3150).supported, false);
  });

  await test("interpolation handles knots, plateaus, boundaries, rounding and measured provenance", () => {
    const calibration = {
      version: "synthetic-test-only", status: "synthetic", nodes: 100000,
      provenance: { source: "synthetic regression fixture, not tournament data", movetime: 2000 },
      knots: [[0, 0], [1000, 501], [2000, 501], [3150, 3150]]
    };
    assert.equal(bots.interpolateEngineElo(500, calibration.knots), 250.5);
    assert.equal(bots.interpolateEngineElo(1500, calibration.knots), 501);
    assert.equal(bots.interpolateEngineElo(-100, calibration.knots), 0);
    assert.equal(bots.interpolateEngineElo(9999, calibration.knots), 3150);
    assert.equal(bots.interpolateEngineElo(null, calibration.knots), null);
    for (const [target, engineElo] of calibration.knots)
      assert.equal(bots.ratingProfile(target, calibration).engineElo, Math.round(engineElo / 50) * 50);
    const profile = bots.ratingProfile(500, calibration);
    assert.equal(profile.target, 500);
    assert.equal(profile.engineElo, 250);
    assert.equal(profile.version, calibration.version);
    assert.deepEqual(profile.provenance, calibration.provenance);
    let previous = -1;
    for (let target = 0; target <= 3150; target += 50) {
      const engineElo = bots.ratingProfile(target, calibration).engineElo;
      assert(engineElo >= previous && engineElo >= 0 && engineElo <= 3150);
      previous = engineElo;
    }
    for (const knots of [[], [[0, 0]], [[50, 0], [3150, 3150]], [[0, 0], [3000, 3000]],
      [[0, 0], [0, 20], [3150, 3150]], [[0, 10], [1000, 5], [3150, 3150]],
      [[0, NaN], [3150, 3150]], [[0, 0], [3150, 3151]]])
      assert.throws(() => bots.interpolateEngineElo(500, knots), RangeError);
  });

  await test("named configurations survive relabeling and history records the actual controls", () => {
    const named = { id: "regression-fixture", name: "Fixture", elo: 1800, engineElo: 2200 };
    const config = bots.botSearchConfig(named, 2000);
    assert.equal(config.profile.target, 1800);
    assert.equal(config.profile.engineElo, 2200);
    assert.equal(config.commands.at(-1), "setoption name UCI_Elo value 2200");
    assert.deepEqual(bots.botMetadata(named), { id: named.id, name: named.name, elo: 1800,
      engineElo: 2200, ratingVersion: bots.BOT_CALIBRATION.version, searchNodes: 100000 });
    assert.equal(bots.botMetadata(null), null);
    assert.equal(bots.botMetadata(bots.customBot(null)).engineElo, null);
    assert.equal(bots.botMetadata(bots.customBot(null)).searchNodes, null);
  });

  await test("custom targets sanitize corrupt storage without mistaking it for Full", () => {
    for (const invalid of [undefined, NaN, Infinity, -Infinity, "bad", "", " ", false, true, {}, []])
      assert.equal(bots.customBot(invalid).elo, 250);
    for (const [input, expected] of [[-50, 0], [3200, 3150], [99999, 3150], [450.6, 451], ["1350", 1350]])
      assert.equal(bots.customBot(input).elo, expected);
    assert.equal(bots.customBot(null).elo, null);
    assert.equal(bots.botRating(bots.customBot(null)), "Full");
    const context = browserContext();
    for (const [saved, expected] of [
      [{ id: "custom", elo: 1350, engineElo: 300 }, 1350],
      [{ id: "custom", elo: null }, null], [{ id: "custom" }, 250],
      [{ id: "custom", elo: "corrupt" }, 250], [{ id: "custom", elo: -500 }, 0],
      [{ id: "custom", elo: 5000 }, 3150]
    ]) {
      context.localStorage = { getItem: () => JSON.stringify(saved) };
      assert.equal(context.loadBot().elo, expected);
    }
    context.localStorage = { getItem: () => "{broken" };
    assert.equal(context.loadBot().id, "martin");
    context.$ = () => ({ value: "3200" });
    assert.equal(context.sliderBot().elo, null, "only the UI sentinel becomes Full");
    context.$ = () => ({ value: "3150" });
    assert.equal(context.sliderBot().elo, 3150);
  });

  await test("rated and Full searches reset stale skill settings and preserve the selected safety cap", () => {
    const context = browserContext();
    for (const time of [300, 1000, 2000, 3000, 5000]) {
      const full = bots.botSearchConfig(bots.customBot(null), String(time));
      assert.deepEqual(full.commands, ["setoption name Skill Level value 20",
        "setoption name UCI_LimitStrength value false"]);
      assert.equal(full.go, "go movetime " + time);
      assert.deepEqual(full.limits, { nodes: null, movetime: time });
      assert.equal(full.profile.target, null);
      assert.equal(full.profile.engineElo, null);
      assert.equal(full.profile.estimated, false);
      assert.equal(full.profile.status, "unrestricted");
      const rated = bots.botSearchConfig(bots.customBot(0), time);
      assert.deepEqual(rated.commands, ["setoption name Skill Level value 20",
        "setoption name UCI_LimitStrength value true",
        "setoption name UCI_Elo value " + bots.ratingProfile(0).engineElo]);
      assert.equal(rated.go, "go nodes 100000 movetime " + time);
      assert.deepEqual(plain(context.strengthCommands(context.customBot(null))), full.commands);
      assert.deepEqual(plain(context.strengthCommands(context.customBot(0))), rated.commands);
    }
    for (const invalid of [undefined, NaN, Infinity, -1, 0, "garbage"])
      assert.equal(bots.botSearchConfig(bots.customBot(500), invalid).limits.movetime, 2000);
  });

  await test("engineMove uses mapped controls and capped search for human games and both bot-match sides", async () => {
    const context = browserContext();
    context.BOT_CALIBRATION = { version: "synthetic-test-only", status: "synthetic", provenance: null,
      nodes: 100000, knots: [[0, 0], [1000, 500], [3150, 3150]] };
    for (const match of [false, true]) for (const turn of ["w", "b"]) for (const target of [1000, null]) {
      const active = context.customBot(target);
      context.game = { token: 1, moves: [], botMatch: match, matchBots: { [turn]: active } };
      context.bot = match ? context.customBot(50) : active;
      context.pos = { turn };
      context.performance = { now: () => 0 };
      context.render = () => {};
      context.positionCmd = () => "position startpos";
      context.$ = id => {
        assert.equal(id, "sel-time");
        return { value: "1000" };
      };
      context.minBotMoveMs = () => 0;
      context.setTimeout = callback => callback();
      let played;
      context.playMove = move => { played = move; };
      let sent;
      context.engine = { request(commands, done) {
        sent = plain(commands);
        assert(done("bestmove e2e4"));
        assert(!done("info depth 1"));
        return { then(callback) { context.completed = callback(["bestmove e2e4"]); } };
      } };
      context.engineMove();
      await context.completed;
      assert.deepEqual(sent, ["setoption name Skill Level value 20",
        "setoption name UCI_LimitStrength value " + (target !== null),
        ...(target === null ? [] : ["setoption name UCI_Elo value 500"]),
        "position startpos", target === null ? "go movetime 1000" : "go nodes 100000 movetime 1000"]);
      assert.equal(active.elo, target, "display target must not become the engine control");
      assert.equal(played, "e2e4");
      assert.equal(context.thinking, false);
      assert.equal(context.game.botProfiles.length, 1);
      assert.equal(context.game.botProfiles[0].profile.engineElo, target === null ? null : 500);
      assert.equal(context.game.botProfiles[0].movetime, 1000);
    }
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
