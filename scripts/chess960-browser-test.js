'use strict';
const assert = require('node:assert/strict');
const {chromium} = require(process.argv[2] + '/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.argv[3] || 'http://localhost:8098');
    await page.waitForFunction(() => pos && !pos.pending);
    assert.equal(await page.evaluate(() => SFAnalysis.parseBoard(game.startFen).turn), 'w');
    await page.locator('#chess960-position').fill('0');
    await page.locator('#btn-new-white').click();
    await page.waitForFunction(() => pos && !pos.pending && game.position960 === 0);
    assert.match(await page.locator('#chess960-current').textContent(), /#0/);
    assert.match(await page.evaluate(() => pos.fen), /BBQNNRKR/);
    await page.evaluate(() => { document.getElementById('sel-delay').value = '0'; playMove(pos.legal.find(m => m.startsWith('a2'))); });
    await page.waitForFunction(() => game.moves.length >= 2 && !pos.pending && !thinking);
    assert.equal(await page.evaluate(() => historyRecord().headers.Variant), 'Chess960');
    assert.match(await page.evaluate(() => historyRecord().startFen), /BBQNNRKR/);
    await page.evaluate(() => takeBack());
    await page.waitForFunction(() => game.moves.length === 0 && !pos.pending);
    assert.match(await page.evaluate(() => pos.fen), /BBQNNRKR/);
    await page.setViewportSize({width:390, height:844});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile overflow');
    await page.setViewportSize({width:1280, height:900});
    await page.locator('#btn-new-black').click();
    await page.waitForFunction(() => game.playerColor === 'b' && game.moves.length === 1 && !pos.pending && !thinking);
    await page.evaluate(() => { document.getElementById('white-bot').value='martin'; document.getElementById('black-bot').value='martin'; newGame('w',true); });
    await page.waitForFunction(() => game.botMatch && game.moves.length >= 2);
    // Real engine legality plus DOM click handling for overlapping and stationary castling.
    for (const [fen, move, san, kingSq, rookSq] of [
      ['4k3/8/8/8/8/8/8/5KR1 w G - 0 1','f1g1','O-O','g1','f1'],
      ['4k3/8/8/8/8/8/8/6KR w H - 0 1','g1h1','O-O','g1','f1'],
      ['4k3/8/8/8/8/8/8/R1K5 w A - 0 1','c1a1','O-O-O','c1','d1'],
      ['4k3/8/8/8/8/8/8/1K1R4 w D - 0 1','b1d1','O-O','g1','f1']
    ]) {
      await page.evaluate(async fen => {
        engine.stop(); game.token++; thinking = false; clearPremoves(); game.startFen=fen;
        game.moves=[]; game.san=[]; game.over=null; game.view=null; game.playerColor='w'; game.botMatch=false;
        game.historyId=null; game.grades={}; maybeEngineTurn = function () {};
        pos = await refreshPosition(); game.boards=[snapshot(pos,null)]; game.repKeys=[pos.repKey]; render();
      },fen);
      assert(await page.evaluate(move => pos.legal.includes(move), move), 'castling must be engine-legal: '+move);
      await page.locator('[data-sq="'+move.slice(0,2)+'"]').click();
      await page.locator('[data-sq="'+move.slice(2,4)+'"]').click();
      await page.waitForFunction(() => game.moves.length === 1 && !pos.pending);
      assert.equal(await page.evaluate(() => game.san[0]), san);
      assert.equal(await page.evaluate(sq => pos.board[sq], kingSq), 'K');
      assert.equal(await page.evaluate(sq => pos.board[sq], rookSq), 'R');
      const replayed = await page.evaluate(async () => {
        const analyzer = new SFAnalysis.Analyzer(window.STOCK_ENGINE_FILE);
        try {
          const record = await analyzer.replay(pgn());
          const evaluation = await analyzer.evaluate(record, 0, {movetime: 100, multiPV: 1});
          return {move: record.moves[0], san: record.san[0], board: record.boards[1].board, depth: evaluation.depth};
        } finally { analyzer.dispose(); }
      });
      assert.equal(replayed.move, move);
      assert.equal(replayed.san, san);
      assert.equal(replayed.board[kingSq], 'K');
      assert(replayed.depth > 0);
    }
    // Castling through check is rejected by Stockfish.
    const forbidden = await page.evaluate(async () => {
      game.startFen='k4r2/8/8/8/8/8/8/4K2R w H - 0 1'; game.moves=[];
      return (await refreshPosition()).legal.includes('e1h1');
    });
    assert.equal(forbidden, false);
    assert.deepEqual(errors, []);
    console.log('PASS: Chess960 bot reply, history FEN, undo, click castling, stationary king, swapped pieces, check restriction');
  } finally { await browser.close(); }
})().catch(e => {console.error(e); process.exitCode=1;});
