'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Engine=require('../server/game/GameEngine');
function fixture(champion='blademaster') {
  const e=new Engine({id:'sr-jungle-qa',mode:'5v5',endGame(){},players:{blue:{team:'blue',championId:champion,nickname:'Blue'},red:{team:'red',championId:'yasuo',nickname:'Red'}}},{to:()=>({emit(){}})});
  e.initialize();e.minionWaveTimer=1e6;return e;
}
function near(p,m,d=70){Object.assign(p,{x:m.x+d,y:m.y,targetX:m.x+d,targetY:m.y,hp:10000,maxHp:10000,autoAttackCooldown:0});}
function tick(e,n=1){for(let i=0;i<n;i++){e.gameTime+=1/60;e.updateJungleMonsters();e.updateProjectiles();}}
test('All16 source camp entities resolve network IDs, including aliases for baron and dragon',()=>{
  const e=fixture();assert.equal(Object.keys(e.jungleMonsters).length,16);
  for(const m of Object.values(e.jungleMonsters))assert.equal(e.findCombatTarget(m.id),m,m.id);
  assert.equal(e.findCombatTarget('baron_nashor'),e.jungleMonsters.baron);
  assert.equal(e.findCombatTarget('elemental_dragon'),e.jungleMonsters.dragon);
  assert.equal(e.findCombatTarget('not-a-target'),null);
});
test('Explicit melee jungle targeting damages the camp and triggers original animation sequence retaliation',()=>{
  const e=fixture(),p=e.players.blue,m=e.jungleMonsters.blue_buff_blue;near(p,m);
  const hp=m.hp;tick(e);assert.equal(m.attackSequence||0,0);assert.equal(p.hp,10000);
  e.handleAttackTarget(p.id,m.id);assert.equal(p.targetEnemyId,m.id);e.updateAutoAttacks();
  assert.ok(m.hp<hp);assert.equal(m.targetId,p.id);assert.ok(e.eventsQueue.some(v=>v.type==='attack'&&v.targetId===m.id));
  tick(e);assert.equal(m.attackSequence,1);assert.ok(p.hp<10000);const after=p.hp;
  tick(e,20);assert.equal(m.attackSequence,1);assert.equal(p.hp,after);
  const snapshot=e.getState().jungleMonsters.find(s=>s.id===m.id);assert.equal(snapshot.attackSequence,1);assert.equal(snapshot.targetId,p.id);
});
test('Ranged basic attacks home to a jungle network ID and apply damage on impact',()=>{
  const e=fixture('sniper'),p=e.players.blue,m=e.jungleMonsters.baron;near(p,m,250);const hp=m.hp;
  e.handleAttackTarget(p.id,m.id);e.updateAutoAttacks();assert.equal(m.hp,hp);
  assert.ok(e.projectiles.some(v=>v.targetId==='baron_nashor'&&v.ownerId===p.id));
  for(let i=0;i<40;i++)e.updateProjectiles();assert.ok(m.hp<hp);assert.equal(m.targetId,p.id);assert.equal(e.projectiles.length,0);
});
test('A high-speed projectile aimed at jungle cannot tunnel through enemy Yasuo Wind Wall',()=>{
  const e=fixture('sniper'),p=e.players.blue,y=e.players.red,m=e.jungleMonsters.baron;
  Object.assign(y,{x:1500,y:1600,targetX:1500,targetY:1600,level:6,skillRanks:{Q:1,W:1,E:1,R:1}});
  Object.assign(m,{x:1450,y:1600});assert.equal(e.handleCastSkill(y.id,'W',1800,1600),true);const hp=m.hp;
  e.spawnProjectile({ownerId:p.id,team:'blue',type:'basic_attack',x:1800,y:1600,targetId:m.id,speed:30000,radius:9,damage:500,rangeRemaining:2000});
  e.updateProjectiles();assert.equal(e.projectiles.length,0);assert.equal(m.hp,hp);
});
for(const type of ['baron','buff_blue','buff_red','gromp','wolves','raptors','krugs'])test(type+' death awards neutral rewards without champion kills, deaths, score or first blood',()=>{
  const e=fixture(),p=e.players.blue,m=Object.values(e.jungleMonsters).find(m=>m.type===type);
  p.maxExp=100000;const gold=p.gold,exp=p.exp,kills=p.kills,score={...e.scores};e.eventsQueue=[];
  e.applyDamage(p.id,m,m.hp*100,'true',false);assert.equal(m.isAlive,false);assert.equal(m.hp,0);
  assert.equal(p.gold,gold+m.goldValue);assert.equal(p.exp,exp+m.expValue);assert.equal(p.kills,kills);
  assert.deepEqual(e.scores,score);assert.equal(e.firstBloodClaimed,false);assert.equal(m.deaths,undefined);assert.equal(m.targetId,null);
  assert.ok(!e.eventsQueue.some(v=>v.type==='kill'||v.event==='FIRST_BLOOD'));assert.ok(m.respawnTimer>0);
  const seq=m.attackSequence||0;tick(e,2);assert.equal(m.attackSequence||0,seq);assert.equal(e.getState().jungleMonsters.find(s=>s.id===m.id).isAlive,false);
  m.respawnTimer=.01;tick(e);assert.equal(m.isAlive,true);assert.equal(m.hp,m.maxHp);assert.equal(m.targetId,null);
});
test('Dragon retains its neutral reward, animation sequence, projectile and respawn behavior',()=>{
  const e=fixture(),p=e.players.blue,m=e.jungleMonsters.dragon;near(p,m,100);tick(e);assert.equal(m.attackSequence,1);
  assert.ok(e.projectiles.some(v=>v.ownerId===m.id&&v.targetId===p.id));tick(e,20);assert.ok(p.hp<10000);
  const score={...e.scores},gold=p.gold;e.applyDamage(p.id,m,m.hp*100,'true',false);assert.equal(m.isAlive,false);assert.equal(p.gold,gold+m.goldValue+75);
  assert.deepEqual(e.scores,score);assert.equal(e.firstBloodClaimed,false);assert.equal(p.dragonBuffStacks,1);
  m.respawnTimer=.01;tick(e);assert.equal(m.isAlive,true);assert.equal(m.hp,m.maxHp);assert.equal(m.targetId,null);
});
test('Both scuttles patrol original terrain without clipping and remain peaceful when attacked',()=>{
  const e=fixture(),p=e.players.blue,crabs=Object.values(e.jungleMonsters).filter(m=>m.type==='scuttle');assert.equal(crabs.length,2);
  const distance=new Map(crabs.map(m=>[m.id,0]));
  for(let i=0;i<600;i++){const old=crabs.map(m=>({x:m.x,y:m.y}));tick(e);crabs.forEach((m,j)=>{e.navigation.team=null;assert.ok(e.navigation.isWalkable(m.x,m.y,m.radius),`${m.id} tick${i}: ${m.x},${m.y}`);distance.set(m.id,distance.get(m.id)+Math.hypot(m.x-old[j].x,m.y-old[j].y));assert.ok(m.y>=m.patrolMinY-m.speed/60-.01&&m.y<=m.patrolMaxY+m.speed/60+.01);});}
  for(const m of crabs){assert.ok(distance.get(m.id)>100,m.id+' patrol');near(p,m);e.applyDamage(p.id,m,1,'true',false);tick(e);assert.ok(!m.targetId);assert.equal(m.attackSequence||0,0);assert.equal(p.hp,10000);
    const gold=p.gold;e.applyDamage(p.id,m,m.hp*100,'true',false);assert.equal(p.gold,gold+m.goldValue);assert.equal(e.firstBloodClaimed,false);m.respawnTimer=.01;tick(e);assert.equal(m.isAlive,true);assert.equal(m.hp,m.maxHp);e.navigation.team=null;assert.ok(e.navigation.isWalkable(m.x,m.y,m.radius));}
});
