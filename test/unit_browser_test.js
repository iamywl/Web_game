const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const out=path.join(__dirname,'unit-results');fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],limitations:['Level-1 real client and production server handlers/AI. Test-only seeded unit positions, extra cannon/super units, durable player, one weakened minion/turret accelerate coverage.']};
let browser,page;const pass=name=>{report.checks.push({name,pass:true});console.log('PASS',name);};
async function run(){
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});page=await browser.newPage({viewport:{width:1500,height:950}});page.setDefaultTimeout(25000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.addInitScript(()=>{
  window.qa={models:[],runs:[],attacks:[],corpses:[],disposed:[],shots:[],turrets:[],events:[]};const tracked=new Map();let Renderer;
  Object.defineProperty(window,'GameRenderer',{configurable:true,get(){return Renderer;},set(Base){Renderer=class extends Base{
   constructor(...args){super(...args);window.qaRenderer=this;}
   render(...args){super.render(...args);const q=window.qa;
    for(const m of this.gameState.minions||[]){const g=this.threeMinionMeshes[m.id],r=g?.userData.unit;if(!r)continue;tracked.set(m.id,g);const key=m.team+'-'+m.type;if(!q.models.includes(key))q.models.push(key);if(r.current===r.run&&!q.runs.includes(key))q.runs.push(key);if(r.attacks.includes(r.current)&&!q.attacks.includes(key))q.attacks.push(key);}
    for(const [id,g] of tracked){if(g.userData.unit.dead&&!q.corpses.includes(id))q.corpses.push(id);if(g.userData.disposed&&!q.disposed.includes(id))q.disposed.push(id);}
    for(const s of this.gameState.structures||[]){const g=this.threeStructureMeshes[s.id];if(s.type==='turret'&&g?.userData.unit){const key=s.team+'-'+(s.isAlive?'alive':'dead');if(!q.turrets.includes(key))q.turrets.push(key);}}
    for(const p of this.gameState.projectiles||[])if(p.type==='turret_bullet'&&!q.shots.includes(p.id))q.shots.push(p.id);
   }
  };}});
  Object.defineProperty(window,'io',{configurable:true,set(original){Object.defineProperty(window,'io',{configurable:true,writable:true,value:function(...args){const s=original(...args);s.on('gameTick',state=>window.qa.events.push(...(state.events||[])));return s;}});}});
 });
 await page.goto('http://127.0.0.1:4177/');await page.locator('#input-nickname').fill('Unit original QA');await page.locator('#btn-enter-lobby').click();await page.locator('#btn-open-create-room').click();await page.locator('#input-room-name').fill('Original unit integration');await page.locator('label.mode-card:has(input[value="1v1"])').click();await page.locator('#form-create-room button[type=submit]').click();await page.locator('#btn-start-draft').click();
 await page.locator('#champ-card-yasuo').waitFor();assert.equal(await page.locator('[id^=champ-card-]').count(),12);pass('Actual draft retains all 12 champions');await page.locator('#champ-card-yasuo').click();await page.locator('#btn-lock-champion').click();
 await page.waitForFunction(()=>window.qaRenderer?.threePlayerMeshes[window.qaRenderer.localPlayerId]?.userData.yasuo);pass('Existing Yasuo model and HUD load in same match');
 await page.waitForFunction(()=>window.qa.models.length===8&&window.qa.turrets.includes('blue-alive')&&window.qa.turrets.includes('red-alive'));pass('All eight original minion variants and both turret factions load during real match');
 await page.screenshot({path:path.join(out,'match-units.png')});
 await page.waitForFunction(()=>window.qa.runs.length>0&&window.qa.attacks.length>=4&&window.qa.shots.length>0);pass('Real AI movement/attacks select original clips and turrets fire actual missiles');
 const target=await page.evaluate(()=>{const r=window.qaRenderer,m=r.gameState.minions.find(m=>m.team==='red'&&m.hp<=20&&m.y>1000);return m?{id:m.id,...r.worldToScreen(m.x,m.y)}:null;});assert.ok(target,'weakened minion survives until user attack');
 const initial=await page.evaluate(()=>{const r=window.qaRenderer,p=r.gameState.players.find(p=>p.id===r.localPlayerId);return{cs:p.cs,gold:p.gold};});await page.mouse.click(target.x,target.y,{button:'right'});
 await page.waitForFunction(id=>!window.qaRenderer.gameState.minions.some(m=>m.id===id),target.id);
 const earned=await page.evaluate(()=>{const r=window.qaRenderer,p=r.gameState.players.find(p=>p.id===r.localPlayerId);return{cs:p.cs,gold:p.gold};});assert.ok(earned.cs>initial.cs&&earned.gold>initial.gold);pass('Right-click last hit removes target and preserves CS/gold reward');
 await page.waitForFunction(()=>Number(document.getElementById('cs-display').textContent)>0);pass('Last-hit CS count reaches the live HUD');
 await page.waitForFunction(()=>window.qa.corpses.length>0&&window.qa.disposed.length>0);pass('Killed minions play visual-only death then release their rigs');
 const tower=await page.evaluate(()=>{const r=window.qaRenderer,s=r.gameState.structures.find(s=>s.id==='red_outer_turret');return r.worldToScreen(s.x,s.y);});await page.mouse.click(tower.x,tower.y,{button:'right'});
 await page.waitForFunction(()=>window.qa.turrets.includes('red-dead'));pass('Real damage destroys original turret and switches to rubble');
 await page.screenshot({path:path.join(out,'match-destruction.png')});
 await page.waitForFunction(()=>window.qaRenderer.threeStructureMeshes.red_outer_turret?.userData.unit.finished);
 const dead=await page.evaluate(()=>{const g=window.qaRenderer.threeStructureMeshes.red_outer_turret;return{visible:g.visible,parts:g.userData.unit.meshes.filter(m=>m.visible).map(m=>m.userData.unitPart),laser:g.userData.laser.visible,range:g.userData.rangeMesh.visible,shield:g.userData.shield.visible};});assert.ok(dead.visible);assert.ok(dead.parts.every(n=>n==='Rubble'||n==='RubbleBase'));assert.ok(!dead.laser&&!dead.range&&!dead.shield);pass('Destroyed turret retains original rubble with targeting/attack overlays disabled');
 report.observed=await page.evaluate(()=>window.qa);assert.deepEqual(report.errors,[]);pass('No JavaScript, missing-resource or WebGL errors in actual match');
}
run().catch(async e=>{report.error=e.stack;process.exitCode=1;console.error(e);if(page){report.observed=await page.evaluate(()=>window.qa).catch(()=>null);await page.screenshot({path:path.join(out,'match-failure.png')}).catch(()=>{});}}).finally(async()=>{if(browser)await browser.close();report.status=report.error?'FAIL':'PASS';fs.writeFileSync(path.join(out,'browser-match.json'),JSON.stringify(report,null,2));console.log(report.status,report.checks.length);});
