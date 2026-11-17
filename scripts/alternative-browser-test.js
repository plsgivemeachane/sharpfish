#!/usr/bin/env node
"use strict";
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(path.resolve(process.argv[2], 'node_modules/playwright'));
const origin = (process.argv[3] || 'http://localhost:8096/variants/classic').replace(/\/$/, '');
(async () => {
  const browser = await chromium.launch(), page = await browser.newPage({viewport:{width:1366,height:900}}), errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  const alternative = page.locator('#alternative-move');
  async function load(pgn, count) {
    await page.locator('#pgn-input').fill(pgn);
    await page.locator('#analyze').click();
    await page.waitForFunction(n=>document.querySelectorAll('#moves li').length===n, count);
    if(await page.locator('#cancel').isEnabled()) await page.locator('#cancel').click();
    await page.locator('#eval-toggle').uncheck();
    await page.locator('#last').click();
    return page.evaluate(async()=>{const r=(await SFHistory.list())[0];return {id:r.id,moves:r.moves,san:r.san,boards:r.boards,result:r.result,createdAt:r.createdAt};});
  }
  async function seed(label,bestMove,index) {
    await page.evaluate(async ({label,bestMove,index})=>{
      const r=(await SFHistory.list())[0];
      SFReviewHooks.setGrade(index,{label,objectiveLabel:label,bestMove,version:SFAnalysis.VERSION,model:'centipawn',depth:12,historyKey:SFAnalysis.historyKey(r,index+1),config:{model:'centipawn',movetime:2000,specialMoves:true,engine:STOCK_ENGINE_FILE}});
    },{label,bestMove,index});
  }
  const piece = (square, name) => page.locator(`.sq[data-sq="${square}"] .piece:not(.captured)${name?'[alt="'+name+'"]':''}`);
  async function preview() { await alternative.click();await page.waitForFunction(()=>document.getElementById('alternative-move').getAttribute('aria-pressed')==='true'); }
  async function played() { await alternative.click();await page.waitForFunction(()=>document.getElementById('alternative-move').getAttribute('aria-pressed')==='false'); }
  try {
    await page.goto(origin+'/analysis.html');
    assert.equal(await page.locator('#draw-mode, #clear-shapes').count(),0,'drawing buttons are removed');
    assert(await alternative.isDisabled());
    const original=await load('1. f3 *',1);
    assert(await alternative.isDisabled(),'an ungraded move has no recommendation');
    for(const label of ['Best','Excellent']) { await seed(label,'e2e4',0);assert(await alternative.isDisabled(),label+' does not show an alternative'); }
    for(const label of ['Great','Brilliant','Good','OK','Inaccuracy','Mistake','Blunder','Disaster','Catastrophe']) { await seed(label,'e2e4',0);assert(await alternative.isEnabled(),label+' can show an alternative'); }
    await seed('Mistake','f2f3',0);assert(await alternative.isDisabled(),'identical engine and played moves have no alternative');
    await seed('Mistake','a1a8',0);assert(await alternative.isDisabled(),'illegal cached recommendations are not offered');
    await seed('Mistake','e2e4',0);
    await preview();
    await page.waitForFunction(()=>!document.getAnimations().some(a=>a.effect.target.classList.contains('piece')&&a.playState==='running'));
    assert.equal(await piece('e4','White pawn').count(),1);
    assert.equal(await piece('f2','White pawn').count(),1,'the actual f3 move was undone before previewing e4');
    assert.equal(await piece('f3').count(),0);
    assert.equal(await page.locator('#shapes g[data-shape="e2e4"]').count(),1,'engine move has a green arrow');
    assert.equal(await page.locator('.move-grade-overlay').count(),0,'played-move grade is not attached to the alternative');
    assert.match(await page.locator('#alternative-status').innerText(),/Stockfish: e4 instead of f3/);
    await page.locator('#flip').click();
    assert.equal(await piece('e4','White pawn').count(),1,'flip preserves the alternative');
    await seed('Mistake','e2e4',0);
    assert.equal(await alternative.getAttribute('aria-pressed'),'true','grade refresh preserves the same preview');
    // Record positions sent to actual timed evaluation, excluding perft-only preview computation.
    await page.evaluate(()=>{window.__evalPositions=[];const send=Worker.prototype.postMessage;const positions=new WeakMap();Worker.prototype.postMessage=function(command,...args){if(typeof command==='string'&&command.startsWith('position '))positions.set(this,command);if(typeof command==='string'&&command.startsWith('go movetime'))window.__evalPositions.push(positions.get(this));return send.call(this,command,...args);};});
    await page.locator('#eval-toggle').check();
    await page.waitForFunction(()=>window.__evalPositions.includes('position startpos moves e2e4'));
    await played();
    await page.waitForFunction(()=>window.__evalPositions.includes('position startpos moves f2f3'));
    assert.equal(await piece('f3','White pawn').count(),1);
    assert.equal(await page.locator('#shapes g[data-shape="e2e4"]').count(),0);
    assert.equal(await page.locator('.move-grade-overlay').evaluate(e=>e.closest('.sq').dataset.sq),'f3');
    await preview();await page.locator('#first').click();
    assert.equal(await alternative.getAttribute('aria-pressed'),'false','navigation closes preview');
    assert(await alternative.isDisabled(),'starting position has no alternative');
    await page.locator('#last').click();await preview();
    await page.locator('#grade-toggle').uncheck();
    assert.equal(await alternative.getAttribute('aria-pressed'),'false','turning grades off restores recorded position');
    assert.equal(await piece('f3','White pawn').count(),1);
    const stored=await page.evaluate(id=>SFHistory.get(id),original.id);
    assert.deepEqual([stored.moves,stored.san,stored.boards,stored.result,stored.createdAt],[original.moves,original.san,original.boards,original.result,original.createdAt],'preview does not edit saved game');
    await load('1. f3 e5 *',2);await page.locator('#prev').click();await seed('Mistake','e2e4',0);
    await page.evaluate(()=>{const Original=SFAnalysis.Analyzer;SFAnalysis.Analyzer=function(file){SFAnalysis.Analyzer=Original;const a=new Original(file),position=a.position;a.position=async(...args)=>{await new Promise(r=>setTimeout(r,180));return position(...args);};return a;};});
    await alternative.click();await page.locator('#next').click();await page.waitForTimeout(350);
    assert.equal(await alternative.getAttribute('aria-pressed'),'false','a pending preview cannot overwrite navigation');
    assert.match(await page.locator('#position-label').innerText(),/Position 2/);
    assert(await page.locator('#alternative-status').isHidden());
    await load('1. e4 a6 *',2);await seed('Mistake','e7e5',1);await preview();
    assert.equal(await piece('e4','White pawn').count(),1,'Black alternative preserves White move');
    assert.equal(await piece('e5','Black pawn').count(),1);assert.equal(await piece('a7','Black pawn').count(),1);
    await load('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. h3 *',7);await seed('Mistake','e1g1',6);await preview();
    assert.equal(await piece('g1','White king').count(),1);assert.equal(await piece('f1','White rook').count(),1);
    assert.match(await page.locator('#alternative-status').innerText(),/O-O/);
    await load('1. e4 a6 2. e5 d5 3. Nf3 *',5);await seed('Mistake','e5d6',4);await preview();
    assert.equal(await piece('d6','White pawn').count(),1);assert.equal(await piece('d5').count(),0,'en passant removes the captured pawn');
    assert.equal(await piece('g1','White knight').count(),1);
    await load('1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Nbd7 5. bxa8=R *',9);await seed('Mistake','b7a8q',8);await preview();
    assert.equal(await piece('a8','White queen').count(),1);assert.match(await page.locator('#alternative-status').innerText(),/bxa8=Q/);
    await played();assert.equal(await piece('a8','White rook').count(),1,'return restores the actual underpromotion');
    // An outer-corner badge must remain visible outside the board without page overflow.
    await page.locator('#flip').click(); // restore White orientation after the earlier flip
    await load('[FEN "7r/6P1/7k/8/8/8/8/K7 w - - 0 1"]\n1. gxh8=Q+ *',1);await seed('Good','g7g8q',0);
    for(const width of [1366,320]) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(()=>scrollTo(0,0));
      const box=await page.locator('.move-grade-overlay').evaluate(img=>{const b=img.getBoundingClientRect(),s=img.parentElement.getBoundingClientRect(),board=document.getElementById('board').getBoundingClientRect();return {dx:b.x+b.width/2-s.right,dy:b.y+b.height/2-s.top,outside:b.right>board.right&&b.top<board.top,inViewport:b.right<=innerWidth&&b.top>=0,overflow:document.documentElement.scrollWidth>innerWidth,clip:getComputedStyle(document.getElementById('board')).overflow};});
      assert(Math.abs(box.dx)<1&&Math.abs(box.dy)<1,'badge centre matches the corner');
      assert(box.outside,'outer-corner badge crosses board edges');assert(box.inViewport&&!box.overflow,'edge badge fits viewport: '+JSON.stringify(box));assert.equal(box.clip,'visible');
      if (process.argv[4]) await page.screenshot({path:path.join(process.argv[4], 'corner-badge-'+width+'.png')});
    }
    assert.deepEqual(errors,[]);
    console.log('PASS alternative eligibility, engine preview/return, before-move position, evaluation context, flips, grade refresh, navigation, history immutability, Black/castling/en-passant/promotion and unclipped corner badges');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
