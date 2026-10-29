// Real browser input -> production client -> Socket.IO -> real 60Hz engine.
// Run test/serve_yasuo_match.js first. Only level/positions are seeded by that fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const out = path.join(__dirname, 'yasuo-results'); fs.mkdirSync(out, { recursive: true });
const report = { checks: [], errors: [], limitations: ['Controlled level-6 match; normal production handlers and browser input, seeded spawn and stationary durable opponent; lane AI disabled.'] };
let browser, page;
function pass(name, details) { report.checks.push({ name, pass: true, details }); console.log('PASS', name); }
async function read() { return page.evaluate(() => { const r=window.qaRenderer, p=r.gameState.players.find(p=>p.id===r.localPlayerId), t=r.gameState.players.find(p=>p.id!==r.localPlayerId); return {p,t,clip:r.threePlayerMeshes[p.id]?.userData.yasuo?.current,walls:r.gameState.yasuoWalls}; }); }
async function aimEnemy() { const xy=await page.evaluate(()=>{const r=window.qaRenderer,t=r.gameState.players.find(p=>p.id!==r.localPlayerId);return r.worldToScreen(t.x,t.y);});await page.mouse.move(xy.x,xy.y);return xy; }
async function cast(key) { await aimEnemy(); await page.keyboard.press(key.toLowerCase()); }
async function event(key,phase='cast',variant) { await page.waitForFunction(({key,phase,variant})=>window.qaEvents.some(e=>e.type==='yasuoSkill'&&e.key===key&&e.phase===phase&&(!variant||e.variant===variant)),{key,phase,variant},{timeout:7000}); }
async function run() {
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 page=await browser.newPage({viewport:{width:1440,height:900}});
 page.setDefaultTimeout(12000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.addInitScript(()=>{
  window.qaEvents=[];window.qaClips=[];
  let Renderer;
  Object.defineProperty(window,'GameRenderer',{configurable:true,get(){return Renderer;},set(Base){Renderer=class extends Base {
    constructor(...args){super(...args);window.qaRenderer=this;}
    render(...args){super.render(...args);const rig=this.threePlayerMeshes[this.localPlayerId]?.userData.yasuo;if(rig&&!window.qaClips.includes(rig.current))window.qaClips.push(rig.current);}
  };}});
  Object.defineProperty(window,'io',{configurable:true,set(original){Object.defineProperty(window,'io',{configurable:true,writable:true,value:function(...args){const s=original(...args);s.on('gameTick',state=>window.qaEvents.push(...(state.events||[])));return s;}});}});
 });
 await page.goto('http://127.0.0.1:4176/');
 await page.locator('#input-nickname').fill('Yasuo Browser QA');await page.locator('#btn-enter-lobby').click();
 await page.locator('#btn-open-create-room').click();await page.locator('#input-room-name').fill('Yasuo input verification');
 await page.locator('label.mode-card:has(input[value="1v1"])').click();await page.locator('#form-create-room button[type=submit]').click();
 await page.locator('#btn-start-draft').click();
 await page.locator('#champ-card-yasuo').waitFor();assert.equal(await page.locator('[id^=champ-card-]').count(),12);pass('12 existing/new champions appear in actual draft');
 await page.locator('#champ-card-yasuo').click();await page.locator('#btn-lock-champion').click();
 await page.waitForFunction(()=>window.qaRenderer?.threePlayerMeshes[window.qaRenderer.localPlayerId]?.userData.yasuo);
 await page.waitForTimeout(600);
 let s=await read();assert.equal(s.p.championId,'yasuo');assert.equal(s.p.level,6);pass('Actual game loads Yasuo GLB and level-6 skill HUD');
 const xy=await page.evaluate(()=>window.qaRenderer.worldToScreen(1180,880));await page.mouse.click(xy.x,xy.y,{button:'right'});
 await page.waitForFunction(()=>window.qaClips.includes(1));await page.waitForTimeout(500);s=await read();assert.ok(s.p.x>1140&&s.p.y>840);pass('Right-click moves server player and plays original run clip',s.p.yasuo);
 const enemy=await aimEnemy();await page.mouse.click(enemy.x,enemy.y,{button:'right'});
 await page.waitForFunction(()=>window.qaEvents.some(e=>e.type==='attack'&&e.attackerId===window.qaRenderer.localPlayerId));
 await page.waitForFunction(()=>window.qaClips.some(c=>c>=2&&c<=5));s=await read();assert.ok(s.t.hp<10000);pass('Enemy right-click executes melee basic attack, damage and original animation');
 await page.keyboard.press('s');
 await cast('R');await page.waitForTimeout(100);assert.equal((await read()).p.cooldowns.R,0);pass('R on grounded enemy is rejected without cooldown');
 await cast('W');await event('W');s=await read();assert.equal(s.walls.length,1);await page.screenshot({path:path.join(out,'match-wall.png')});pass('W keyboard cast creates server wall and original effect');
 await cast('Q');await page.waitForFunction(()=>window.qaRenderer.gameState.players.find(p=>p.id===window.qaRenderer.localPlayerId)?.yasuo.qStacks===1);
 await page.waitForFunction(()=>window.qaRenderer.gameState.players.find(p=>p.id===window.qaRenderer.localPlayerId)?.cooldowns.Q===0);await cast('Q');
 await page.waitForFunction(()=>window.qaRenderer.gameState.players.find(p=>p.id===window.qaRenderer.localPlayerId)?.yasuo.qStacks===2);pass('Two Q hits build two stacks through normal cooldowns');
 await page.waitForFunction(()=>window.qaRenderer.gameState.players.find(p=>p.id===window.qaRenderer.localPlayerId)?.cooldowns.Q===0);await cast('Q');
 await page.waitForFunction(()=>window.qaRenderer.gameState.players.some(p=>p.id!==window.qaRenderer.localPlayerId&&p.airborneRemaining>0));
 await cast('R');await event('R');await page.screenshot({path:path.join(out,'match-ultimate.png')});await event('R','hit');pass('Q3 hits and knocks up; cursor R selects airborne enemy, teleports and damages');
 await page.waitForFunction(()=>window.qaRenderer.gameState.players.find(p=>p.id===window.qaRenderer.localPlayerId)?.yasuo.rRemaining===0);
 const before=(await read()).p;await cast('E');await event('E');await page.waitForTimeout(400);s=await read();assert.ok(Math.hypot(s.p.x-before.x,s.p.y-before.y)>300);pass('E cursor targeting dashes through enemy and plays original animation');
 const eCount=await page.evaluate(()=>window.qaEvents.filter(e=>e.type==='yasuoSkill'&&e.key==='E'&&e.phase==='cast').length);await page.waitForTimeout(200);await cast('E');await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>window.qaEvents.filter(e=>e.type==='yasuoSkill'&&e.key==='E'&&e.phase==='cast').length),eCount);pass('E same-target lock prevents repeat dash');
 report.observed=await page.evaluate(()=>({clips:window.qaClips,events:window.qaEvents.filter(e=>e.type==='yasuoSkill'),audioReady:Object.keys(window.qaRenderer.yasuoAudio.buffers).length,effectTextures:Object.keys(window.qaRenderer.yasuoEffects.textures).length}));
 assert.ok([1,6,7,8,10,11,12].every(c=>report.observed.clips.includes(c)));assert.equal(report.observed.audioReady,17);assert.equal(report.observed.effectTextures,17);pass('Actual match exercised move, AA and all QWER clips; 17 sounds and 17 textures loaded');
 await page.screenshot({path:path.join(out,'match-finished.png')});assert.deepEqual(report.errors,[]);pass('No browser JavaScript or resource errors');
}
run().catch(async e=>{report.error=e.stack;process.exitCode=1;console.error(e);if(page){report.debug=await page.evaluate(()=>({renderer:!!window.qaRenderer,players:window.qaRenderer?.gameState?.players,meshes:Object.keys(window.qaRenderer?.threePlayerMeshes||{}),text:document.body.innerText.slice(-2500)})).catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}}).finally(async()=>{if(browser)await browser.close();report.status=report.error?'FAIL':'PASS';fs.writeFileSync(path.join(out,'browser-match.json'),JSON.stringify(report,null,2));console.log(report.status,report.checks.length);});

