const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../server/game/GameEngine');
const Yasuo = require('../server/game/YasuoMechanics');
const { CHAMPIONS } = require('../server/game/ChampionData');
function fixture() {
  const e = new Engine({id:'yasuo-test',mode:'1v1',players:{y:{championId:'yasuo',team:'blue',nickname:'Yasuo'},t:{championId:'blademaster',team:'red',nickname:'Target'}}},{to:()=>({emit(){}})});
  e.initialize(); e.map.obstacles=[]; e.map.bushes=[]; e.structures={}; e.jungleMonsters={}; e.minions={};
  const p=e.players.y,t=e.players.t;
  Object.assign(p,{x:1000,y:800,targetX:1000,targetY:800,level:6,skillRanks:{Q:1,W:1,E:1,R:1},hp:10000,maxHp:10000});
  Object.assign(t,{x:1200,y:800,targetX:1200,targetY:800,hp:10000,maxHp:10000,armor:0,mr:0});
  p.yasuo.lastX=p.x;p.yasuo.lastY=p.y;
  return {e,p,t};
}
function advance(e,seconds) {for(let n=0;n<Math.round(seconds*60);n++){e.gameTime+=1/60;e.updatePlayerStatuses();e.updatePlayerMovements();for(const id in e.players)Yasuo.update(e,e.players[id],1/60);Yasuo.updateWalls(e,1/60);e.updateProjectiles();}}
const cast=(e,key,target='t')=>e.handleCastSkill('y',key,e.players[target]?.x||1400,e.players[target]?.y||800,target);
test('12 independent champions; Yasuo is manaless without replacing originals',()=>{
  const {e,p,t}=fixture();assert.equal(Object.keys(CHAMPIONS).length,12);assert.equal(t.maxMp,300);assert.equal(p.maxMp,0);assert.equal(t.yasuo,undefined);assert.equal(CHAMPIONS.garen.name,'가렌');
  p.level=18;e.recalculatePlayerStats(p);assert.equal(p.maxMp,0);
});
test('Movement builds Flow and a real in-range basic attack deals damage',()=>{
  const {e,p,t}=fixture();e.handleMoveInput('y',1100,800);advance(e,.2);assert.ok(p.x>1000);assert.ok(p.yasuo.flow>0);
  t.x=p.x+100;e.handleAttackTarget('y','t');e.updateAutoAttacks();assert.ok(t.hp<10000);assert.ok(e.eventsQueue.some(v=>v.type==='attack'));
});
test('Q hits build exactly one stack each, third cast launches piercing airborne tornado',()=>{
  const {e,p,t}=fixture();cast(e,'Q');assert.equal(p.yasuo.qStacks,1);p.cooldowns.Q=0;cast(e,'Q');assert.equal(p.yasuo.qStacks,2);
  p.cooldowns.Q=0;cast(e,'Q');assert.equal(p.yasuo.qStacks,0);assert.equal(e.projectiles[0].type,'yasuo_tornado');advance(e,.25);
  assert.ok(t.statusEffects.some(s=>s.type==='AIRBORNE'));assert.ok(e.getState().players.find(s=>s.id==='t').airborneRemaining>0);
  const hits=e.eventsQueue.filter(v=>v.type==='yasuoSkill'&&v.variant==='tornado'&&v.phase==='hit');assert.equal(hits.length,1);
});
test('Missed Q grants no stack; Q stacks expire; cooldown rejects duplicates',()=>{
  const {e,p}=fixture();assert.equal(e.handleCastSkill('y','Q',1000,1300),true);assert.equal(p.yasuo.qStacks,0);assert.equal(cast(e,'Q'),false);
  p.cooldowns.Q=0;cast(e,'Q');advance(e,6.2);assert.equal(p.yasuo.qStacks,0);
});
test('W blocks swept enemy projectile, passes allies and turret shots, expires',()=>{
  const {e,p}=fixture();cast(e,'W');assert.equal(e.yasuoWalls.length,1);
  const missile={ownerId:'t',team:'red',x:1500,y:800,radius:5};assert.equal(Yasuo.blocked(e,missile,900,800),true);
  assert.equal(Yasuo.blocked(e,{...missile,team:'blue'},900,800),false);
  e.structures.tower={type:'turret'};assert.equal(Yasuo.blocked(e,{...missile,ownerId:'tower'},900,800),false);
  assert.equal(Yasuo.blocked(e,{...missile,y:1100},900,1100),false);advance(e,4.1);assert.equal(e.yasuoWalls.length,0);
});
test('Engine projectile processing removes blocked missiles before damage',()=>{
  const {e,p}=fixture();cast(e,'W');e.spawnProjectile({ownerId:'t',team:'red',x:1140,y:800,vx:-1,vy:0,speed:20000,radius:5,rangeRemaining:2000,damage:500,type:'sniper_q'});
  const hp=p.hp;e.updateProjectiles();assert.equal(e.projectiles.length,0);assert.equal(p.hp,hp);
});
test('E moves through enemy and same-target lock rejects recast without cooldown',()=>{
  const {e,p,t}=fixture();const hp=t.hp;assert.equal(cast(e,'E'),true);assert.ok(t.hp<hp);advance(e,.3);assert.ok(p.x>t.x);p.cooldowns.E=0;
  assert.equal(cast(e,'E'),false);assert.equal(p.cooldowns.E,0);assert.ok(p.yasuo.eLocks.t>e.gameTime);
});
test('E targets minions and E-Q circular attack damages around dash endpoint',()=>{
  const {e,p,t}=fixture();e.minions.m={id:'m',team:'red',isAlive:true,hp:1000,maxHp:1000,x:1200,y:800,radius:20,armor:0,mr:0};
  t.x=1470;assert.equal(e.handleCastSkill('y','E',1200,800,'m'),true);assert.equal(cast(e,'Q'),true);advance(e,.3);
  assert.ok(t.hp<10000);assert.equal(p.yasuo.qStacks,1);assert.ok(e.eventsQueue.some(v=>v.type==='yasuoSkill'&&v.variant==='circle'));
});
test('Stacked E-Q knocks up, allowing R immediately afterward',()=>{
  const {e,p,t}=fixture();p.yasuo.qStacks=2;p.yasuo.qRemaining=6;t.x=1450;
  cast(e,'E');cast(e,'Q');advance(e,.3);assert.ok(t.statusEffects.some(s=>s.type==='AIRBORNE'));assert.equal(cast(e,'R'),true);
});
test('E resolves jungle network IDs independently of dictionary keys',()=>{
  const {e,p}=fixture();const monster={id:'elemental_dragon',team:'neutral',isAlive:true,hp:4500,maxHp:4500,x:1250,y:800,radius:54,armor:35,mr:0};
  e.jungleMonsters.dragon=monster;assert.equal(e.handleCastSkill('y','E',1250,800,'elemental_dragon'),true);
  assert.ok(monster.hp<4500);advance(e,.3);assert.ok(p.x>1250);
});
test('R rejects grounded/ally/invalid/far/unlearned targets without cost',()=>{
  const {e,p,t}=fixture();assert.equal(cast(e,'R'),false);assert.equal(e.handleCastSkill('y','R',1000,800,'y'),false);assert.equal(e.handleCastSkill('y','R',1000,800,'missing'),false);
  t.statusEffects.push({type:'AIRBORNE',duration:2});t.x=2500;assert.equal(cast(e,'R'),false);t.x=1200;p.level=5;assert.equal(cast(e,'R'),false);assert.equal(p.cooldowns.R,0);
});
test('R follows airborne target, holds it, deals delayed damage and refills Flow',()=>{
  const {e,p,t}=fixture();t.statusEffects.push({type:'AIRBORNE',duration:1});const hp=t.hp;assert.equal(cast(e,'R'),true);assert.ok(p.x>1000);assert.equal(p.yasuo.flow,100);
  assert.equal(t.hp,hp);const x=p.x;e.handleMoveInput('y',1800,800);advance(e,.5);assert.equal(p.x,x);advance(e,.6);assert.ok(t.hp<hp);assert.equal(p.yasuo.rRemaining,0);
});
test('Full Flow shields incoming damage and only removes its own shield on expiry',()=>{
  const {e,p}=fixture();p.yasuo.flow=100;p.shield=50;const hp=p.hp;e.applyDamage('t',p,100,'physical',false);assert.equal(p.yasuo.flow,0);assert.equal(p.hp,hp);assert.ok(p.yasuo.shieldRemaining>0);advance(e,1.1);assert.equal(p.shield,50);
});
test('Silence and rank locks reject casts; death cancels pending E/R and resets states',()=>{
  const {e,p,t}=fixture();p.statusEffects.push({type:'SILENCE',duration:1});assert.equal(cast(e,'Q'),false);p.statusEffects=[];p.skillRanks.Q=5;assert.equal(cast(e,'Q'),false);p.skillRanks.Q=1;
  t.statusEffects.push({type:'AIRBORNE',duration:2});cast(e,'R');Yasuo.reset(e,p);p.isAlive=false;advance(e,2);assert.equal(p.yasuo.rRemaining,0);assert.equal(t.hp,10000);
});


