#!/usr/bin/env node
"use strict";
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(path.resolve(process.argv[2],'node_modules/playwright'));
const origin=(process.argv[3]||'http://localhost:8096/variants/classic').replace(/\/$/,'');
(async()=>{
  const browser=await chromium.launch(),page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.__evalSearches=[];window.__workerNumber=0;
    const positions=new WeakMap(),ids=new WeakMap(),send=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(command,...args){
      if(!ids.has(this))ids.set(this,++window.__workerNumber);
      if(typeof command==='string'&&command.startsWith('position '))positions.set(this,command);
      if(typeof command==='string'&&command.startsWith('go movetime'))window.__evalSearches.push({worker:ids.get(this),position:positions.get(this)});
      return send.call(this,command,...args);
    };
  });
  const ready=()=>page.waitForFunction(()=>/^(?:[+−-]?\d|[−-]?M\d|Checkmate|Draw)/.test(document.getElementById('eval-label').textContent),null,{timeout:10000});
  async function load(pgn,count){await page.locator('#pgn-input').fill(pgn);await page.locator('#analyze').click();await page.waitForFunction(n=>document.querySelectorAll('#moves li').length===n,count);await page.locator('#grade-toggle').uncheck();}
  const restore=()=>page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  try{
    await page.goto(origin+'/analysis.html');
    await load('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 *',6);
    await ready();
    await page.locator('#next').click();await page.locator('#next').click();await page.locator('#prev').click();await page.locator('#next').click();
    await ready();
    assert.match(await page.locator('#position-label').innerText(),/Position 2 \/ 6/);
    const last=await page.evaluate(()=>window.__evalSearches.at(-1));
    assert.equal(last.position,'position startpos moves e2e4 e7e5','rapid navigation evaluates the final displayed position');
    // Reproduce browser back/forward restoration through the exact lifecycle events.
    // Before the fix this leaves a disposed analyzer and permanent “Evaluating”.
    await restore();
    await ready();
    const restored=await page.evaluate(()=>window.__evalSearches.at(-1));
    assert.notEqual(restored.worker,last.worker,'history restoration creates a fresh evaluation worker');
    assert.equal(restored.position,last.position);
    assert.equal(await page.locator('#cancel').isDisabled(),true,'completed evaluation releases its running state');
    await page.locator('#next').click(); // return while the replay debounce/search is still pending
    await restore();await ready();
    assert.equal((await page.evaluate(()=>window.__evalSearches.at(-1))).position,'position startpos moves e2e4 e7e5 g1f3');
    assert.notEqual(await page.locator('#eval-detail').innerText(),'Evaluating');
    // Position reconstructed from the reported stuck evaluation screenshot.
    await load('[FEN "1r5r/5kpp/8/2n2P2/1p2P3/1P1P2R1/P5PP/1R4K1 b - - 0 25"]\n*',0);
    await ready();
    assert.notEqual(await page.locator('#eval-label').innerText(),'?');
    const fill=await page.locator('#evalbar-white').evaluate(e=>parseFloat(e.style.height));
    assert(Number.isFinite(fill)&&fill>=0&&fill<=100);
    await page.locator('#flip').click();assert(await page.locator('#evalbar').evaluate(e=>e.classList.contains('flipped')));
    await page.locator('#eval-toggle').uncheck();assert(await page.locator('#evalbar').evaluate(e=>e.classList.contains('off')));
    await page.locator('#eval-toggle').check();await ready();
    await load('1. f3 e5 2. g4 Qh4# 0-1',4);await page.locator('#last').click();await ready();
    assert.equal(await page.locator('#eval-label').innerText(),'Checkmate');
    assert.equal(await page.locator('#evalbar-white').evaluate(e=>e.style.height),'0%');
    assert.deepEqual(errors,[]);
    console.log('PASS evaluation after rapid replay, cached-page restoration (idle/pending), fresh worker recovery, reported position, flip/toggles and terminal mate');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
