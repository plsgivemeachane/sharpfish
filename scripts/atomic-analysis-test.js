const assert = require("assert");
const core = require("../site/analysis-core.js");

const adjacent = core.parseBoard("8/8/8/8/8/8/4kK2/8 w - - 0 1", { atomic: true });
assert.equal(adjacent.board.e2, "k");
assert.equal(adjacent.board.f2, "K");
const terminal = core.parseBoard("8/8/8/8/8/8/8/4K3 b - - 0 1", { atomic: true });
assert.equal(terminal.board.e1, "K");
assert.throws(() => core.parseBoard("8/8/8/8/8/8/4kK2/8 w - - 0 1"), /adjacent/);
const pgn = core.parsePgn('[Variant "Atomic"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0');
assert.equal(pgn.atomic, true);
assert.equal(pgn.headers.Variant, "Atomic");
assert.equal(core.supportsRecord({ variant: { slug: "atomic", supported: true } }), true);
assert.equal(core.snapshotAnalysis({ variant: { slug: "atomic", analysisMode: "atomic" } }), false);
const atomicEnv = { SHARPFISH_VARIANT: { slug: "atomic" }, ENGINE_FILE: "local-atomic", STOCK_ENGINE_FILE: "local-atomic", SHARPFISH_ANALYSIS_ENGINES: { atomic: "registered-atomic", standard: "registered-standard" } };
assert.equal(core.engineForRecord({ variant: { slug: "atomic" } }, atomicEnv), "registered-atomic");
assert.equal(core.engineForRecord({ variant: { slug: "classic" } }, atomicEnv), "registered-standard");
assert.equal(core.engineForRecord({ variant: { slug: "atomic", analysisEnginePath: "record-atomic" } }, { SHARPFISH_VARIANT: { slug: "classic" }, SHARPFISH_ANALYSIS_ENGINES: { standard: "registered-standard" } }), "record-atomic");
assert.equal(core.engineForRecord({ variant: { slug: "classic" } }, { SHARPFISH_VARIANT: { slug: "atomic" }, ENGINE_FILE: "wrong-atomic" }), null);
assert.throws(() => core.parseBoard("8/8/8/8/8/8/8/4K3 w - - 0 1", { atomic: true }), /terminal side/);
assert.equal(core.parseBoard("4k3/8/8/8/8/8/8/8 w - - 0 1", { atomic: true }).turn, "w");
const record = { variant: { slug: "atomic" }, moves: ["e2e4"], startFen: null };
const grade = { version: core.VERSION, model: "centipawn", depth: 8, label: "Best", objectiveLabel: "Best",
  historyKey: core.historyKey(record, 1), config: { model: "centipawn", movetime: 2000, specialMoves: false, atomic: true, engine: "atomic" } };
assert.equal(core.isValidGrade(grade, record, 0, "atomic", true), true);
assert.equal(core.isValidGrade(Object.assign({}, grade, { label: "Brilliant" }), record, 0, "atomic", true), false);
assert.equal(core.isValidGrade(grade, Object.assign({}, record, { variant: { slug: "classic" } }), 0, "atomic", false), false);
const history = require("../site/game-history.js");
const stale = Object.assign({}, record, { id: "atomic-stale", revision: 1, accuracy: 99, estimatedElo: 2500, grades: { 0: Object.assign({}, grade, { label: "Brilliant" }) } });
const clean = history.merge(stale, stale);
assert.equal(clean.grades[0].label, "Best");
assert.equal(clean.accuracy, undefined);
assert.equal(clean.estimatedElo, undefined);
const unproven = history.normalize(Object.assign({}, stale, { grades: { 0: Object.assign({}, grade, { config: { specialMoves: true } }) } }));
assert.equal(unproven.grades[0], undefined);
assert.equal(core.isValidGrade({ version: core.VERSION, model: "centipawn", depth: 8,
  historyKey: core.historyKey({ variant: { slug: "atomic" }, moves: [], startFen: null }, 1),
  config: { model: "centipawn", movetime: 2000, specialMoves: false, atomic: true, engine: "atomic", version: core.VERSION } },
  { variant: { slug: "atomic" }, moves: [], startFen: null }, 0, "atomic", true, 2000), false);
console.log("PASS Atomic FEN/PGN validation and capability routing");
