'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Engine=require('../server/game/GameEngine');
const {CHAMPIONS}=require('../server/game/ChampionData');
const Yasuo=require('../server/game/YasuoMechanics');
const placements=require('../public/assets/maps/summoners-rift/placements.json');
const DT=1/60;
function fixture(champion='blademaster',mode='5v5'){
  const e=new Engine({id:'sr-engine-qa',mode,endGame(){},players:{blue:{team:'blue',championId:champion,nickname:'Blue'},red:{team:'red',championId:'garen',nickname:'Red'}}},{to:()=>({emit(){}})});
  e.initialize();e.minionWaveTimer=1e6;
  return e;
}
function assertClear(e,p,label){e.navigation.team=p.team;assert.ok(e.navigation.isWalkable(p.x,p.y,p.radius),`${label}: ${p.x},${p.y} radius${p.radius}`);}
function advanceMovement(e,seconds,check=true){for(let i=0;i<Math.round(seconds*60);i++){
  e.gameTime+=DT;e.updatePlayerStatuses();e.updatePlayerMovements();
  for(const p of Object.values(e.players)){Yasuo.update(e,p,DT);if(check&&p.isAlive)assertClear(e,p,'player tick'+i);}
  Yasuo.updateWalls(e,DT);e.updateProjectiles();
}}
function place(e,p,x,y){e.navigation.team=p.team;const i=e.navigation.nearest(x,y,p.radius);assert.ok(i>=0);p.x=e.navigation.centerX(i);p.y=e.navigation.centerY(i);p.targetX=p.x;p.targetY=p.y;p.navPath=null;p.navX=p.x;p.navY=p.y;if(p.yasuo){p.yasuo.lastX=p.x;p.yasuo.lastY=p.y;}}
test('All30 structure placements match original map records without changing structure counts',()=>{
  const e=fixture(),actual=Object.values(e.structures).filter((s,i,all)=>all.indexOf(s)===i);assert.equal(actual.length,30);
  assert.equal(actual.filter(s=>s.type==='turret').length,22);assert.equal(actual.filter(s=>s.type==='inhibitor').length,6);
  for(const s of placements.structures){let id=s.id.replace(/_nexus_turret1$/,'_nexus_turret_l').replace(/_nexus_turret2$/,'_nexus_turret_r').replace('_inhib_turret','_inhibitor_turret').replace(/_inhib$/,'_inhibitor');if(/_outer$|_inner$/.test(id))id+='_turret';
    const live=e.structures[id];assert.ok(live,id);assert.equal(live.x,s.x,id);assert.equal(live.y,s.y,id);assert.equal(live.height,s.height,id);assert.equal(live.rotation,s.rotation,id);
  }
});
test('All12 champion selections still initialize as independent playable characters',()=>{
  const names=['blademaster','garen','yasuo','sniper','pyromancer','shadow_assassin','guardian','frost_mage','berserker','shadow_hunter','brawler','demolitionist'];assert.deepEqual(Object.keys(CHAMPIONS).sort(),names.sort());
  for(const champion of names){const e=fixture(champion),p=e.players.blue;assert.equal(p.championId,champion);assert.ok(p.hp>0);assertClear(e,p,champion+' spawn');assert.equal(p.skillRanks.Q,1);}
  assert.ok(fixture('blademaster').players.blue.maxMp>0);assert.notDeepEqual(CHAMPIONS.blademaster,CHAMPIONS.garen);
});
test('Player follows a clear fountain-to-mid path and arrives rather than sticking on base walls',()=>{
  const e=fixture(),p=e.players.blue,target=placements.routes.blue_mid[8];e.handleMoveInput(p.id,target.x,target.y);advanceMovement(e,20);
  assert.ok(Math.hypot(p.x-target.x,p.y-target.y)<5,`remaining${Math.hypot(p.x-target.x,p.y-target.y)}`);
});
test('Blue buff to wolves takes a terrain detour and never penetrates a wall',()=>{
  const e=fixture(),p=e.players.blue,blue=placements.camps.find(c=>c.name==='Order Blue'),wolves=placements.camps.find(c=>c.name==='Order Wolves');place(e,p,blue.x,blue.y);
  const start={x:p.x,y:p.y},straight=Math.hypot(wolves.x-p.x,wolves.y-p.y);e.handleMoveInput(p.id,wolves.x,wolves.y);
  let distance=0,lastX=p.x,lastY=p.y;
  for(let i=0;i<900;i++){advanceMovement(e,DT);distance+=Math.hypot(p.x-lastX,p.y-lastY);lastX=p.x;lastY=p.y;}
  assert.ok(Math.hypot(p.x-wolves.x,p.y-wolves.y)<5,`stuck at${p.x},${p.y}`);
  assert.ok(distance>straight+5,`expected detour from${start.x},${start.y}: ${distance} vs${straight}`);
});
for(const [routeName,route]of Object.entries(placements.routes))test(routeName+' minions progress20seconds with original terrain and all structure collisions',()=>{
  const e=fixture(),[team,lane]=routeName.split('_');for(const p of Object.values(e.players))p.isAlive=false;
  // Isolate route traversal from enemy aggro; keep every physical structure.
  for(const s of Object.values(e.structures))s.team=team;
  const p=route[0],m=e.createMinion(team,'melee',p.x,p.y,lane,route),start={x:m.x,y:m.y};let travelled=0,lastX=m.x,lastY=m.y;
  for(let i=0;i<1200;i++){e.gameTime+=DT;e.updatePlayerMovements();e.updateMinions();assertClear(e,m,routeName+' tick'+i);travelled+=Math.hypot(m.x-lastX,m.y-lastY);lastX=m.x;lastY=m.y;}
  assert.ok(travelled>2400,`${routeName} travelled${travelled},wp${m.waypointIndex}`);assert.ok(m.waypointIndex>=7,`${routeName} waypoint${m.waypointIndex}`);assert.ok(Math.hypot(m.x-start.x,m.y-start.y)>1000);
});
test('Normal full three-lane wave advances and all36 units remain outside terrain',()=>{
  const e=fixture();e.spawnMinionWave();assert.equal(Object.keys(e.minions).length,36);
  for(let i=0;i<600;i++){e.gameTime+=DT;e.updatePlayerMovements();e.updateMinions();for(const m of Object.values(e.minions))if(m.isAlive)assertClear(e,m,'fullwave tick'+i);}
  for(const team of ['blue','red'])for(const lane of ['top','mid','bot'])assert.ok(Object.values(e.minions).filter(m=>m.team===team&&m.lane===lane).every(m=>m.waypointIndex>=3),team+lane+' progression');
});
test('Minion displaced off its planned segment replans around the nearby source turret',()=>{
  const e=fixture();for(const p of Object.values(e.players))p.isAlive=false;for(const s of Object.values(e.structures))s.team='blue';e.updatePlayerMovements();
  const route=placements.routes.blue_bot,m=e.createMinion('blue','caster',903.1610192441719,2892.8,'bot',route);
  Object.assign(m,{waypointIndex:2,navPath:[{x:751.7642887369793,y:2867.6787630208337},{x:1033.387,y:2892.8}],navIndex:1,navGoalX:1033.387,navGoalY:2892.8,navX:1033.387,navY:2892.8,navRevision:e.navigation.revision,navReplanAt:0});
  e.navigation.team='blue';assert.equal(e.navigation.lineClear(m.x,m.y,m.navX,m.navY,m.radius),false);
  for(let i=0;i<300;i++){e.gameTime+=DT;e.updatePlayerMovements();e.updateMinions();assertClear(e,m,'displaced minion');}
  assert.ok(m.x>1100&&m.waypointIndex>=3,`stuck at${m.x},${m.y} waypoint${m.waypointIndex}`);
});
test('Stop clears a pending route without resuming old movement',()=>{
  const e=fixture(),p=e.players.blue;e.handleMoveInput(p.id,1600,1600);advanceMovement(e,.5);assert.ok(p.navPath?.length);e.handleStop(p.id);const x=p.x,y=p.y;advanceMovement(e,2);assert.equal(p.x,x);assert.equal(p.y,y);assert.equal(p.navPath,null);
});
test('ARAM stop followed by a new move ignores stale navigation coordinates',()=>{
  const e=fixture('blademaster','1v1'),p=e.players.blue;assert.ok(!e.navigation);p.y=730;p.targetY=730;
  const x=p.x,y=p.y;e.handleStop(p.id);e.handleMoveInput(p.id,x+100,y);advanceMovement(e,1,false);
  assert.ok(p.x>x+95,`ARAM stuck after stop at ${p.x},${p.y}`);
});
test('ARAM stop then death/respawn permits a fresh move without old navigation state',()=>{
  const e=fixture('blademaster','1v1'),p=e.players.blue;e.handleStop(p.id);e.handleDeath('red',p);p.respawnTimer=.05;advanceMovement(e,.2,false);
  assert.equal(p.isAlive,true);const x=p.x,y=p.y;e.handleMoveInput(p.id,x,y-100);advanceMovement(e,1,false);
  assert.ok(p.y<y-95,`ARAM respawn stuck at ${p.x},${p.y}`);
});
test('Recall channels in place and ends at fountain without resuming old route',()=>{
  const e=fixture(),p=e.players.blue;place(e,p,1580,1620);e.handleMoveInput(p.id,1000,1000);advanceMovement(e,.2);const x=p.x,y=p.y;assert.equal(e.handleRecall(p.id).success,true);advanceMovement(e,1);assert.equal(p.x,x);assert.equal(p.y,y);advanceMovement(e,7.5);
  assert.equal(p.recalling,false);assert.equal(p.x,e.map.bases.blue.spawnX);assert.equal(p.y,e.map.bases.blue.spawnY);advanceMovement(e,2);assert.equal(p.x,e.map.bases.blue.spawnX);assert.equal(p.y,e.map.bases.blue.spawnY);
});
test('Death respawn cancels the old route and restores a clear fountain position',()=>{
  const e=fixture(),p=e.players.blue;e.handleMoveInput(p.id,1600,1600);advanceMovement(e,.5);e.handleDeath('red',p);p.respawnTimer=.05;advanceMovement(e,.2);assert.equal(p.isAlive,true);const x=p.x,y=p.y;assertClear(e,p,'respawn');advanceMovement(e,2);assert.equal(p.x,x);assert.equal(p.y,y);assert.equal(p.navPath,null);
});
test('Turret death and inhibitor revival rebuild navigation collision caches',()=>{
  const e=fixture(),tower=e.structures.blue_mid_outer_turret,inh=e.structures.blue_mid_inhibitor;e.updatePlayerMovements();e.navigation.team='blue';e.navigation.layer(0);
  assert.equal(e.navigation.isWalkable(tower.x,tower.y),false);e.handleDeath('red',tower);e.updatePlayerMovements();e.navigation.team='blue';assert.equal(e.navigation.isWalkable(tower.x,tower.y),true);assert.equal(e.navigation.layer(0)[e.navigation.index(tower.x,tower.y)],1);
  e.handleDeath('red',inh);e.updatePlayerMovements();e.navigation.team='blue';assert.equal(e.navigation.isWalkable(inh.x,inh.y),true);assert.equal(e.navigation.layer(0)[e.navigation.index(inh.x,inh.y)],1);
  inh.respawnTimer=.001;e.updateStructureInvulnerability();e.updatePlayerMovements();e.navigation.team='blue';assert.equal(inh.isAlive,true);assert.equal(e.navigation.isWalkable(inh.x,inh.y),false);assert.equal(e.navigation.layer(0)[e.navigation.index(inh.x,inh.y)],0);
});
test('Flash aimed into original jungle wall lands clear and clears prior movement',()=>{
  const e=fixture(),p=e.players.blue;place(e,p,830,1521);const n=e.navigation;let target;
  for(let i=0;i<n.size;i++){const x=n.centerX(i),y=n.centerY(i),d=Math.hypot(x-p.x,y-p.y);if(d>80&&d<220&&!n.isWalkable(x,y,0)){target={x,y};break;}}
  assert.ok(target);e.handleMoveInput(p.id,1500,1500);e.updatePlayerMovements();e.handleCastSpell(p.id,'D',target.x,target.y);assertClear(e,p,'flash');assert.ok(p.cooldowns.D>0);assert.equal(p.navPath,null);const x=p.x,y=p.y;advanceMovement(e,1);assert.equal(p.x,x);assert.equal(p.y,y);
});
test('Yasuo Q stacks/W/E/R remain usable on original terrain with collision-safe movement',()=>{
  const e=fixture('yasuo'),p=e.players.blue,t=e.players.red;place(e,p,1510,1660);place(e,t,p.x+120,p.y);Object.assign(p,{level:6,skillRanks:{Q:1,W:1,E:1,R:1},hp:10000,maxHp:10000});Object.assign(t,{hp:10000,maxHp:10000,armor:0,mr:0});
  const cast=key=>e.handleCastSkill(p.id,key,t.x,t.y,t.id);
  assert.equal(cast('Q'),true);assert.equal(p.yasuo.qStacks,1);p.cooldowns.Q=0;assert.equal(cast('Q'),true);assert.equal(p.yasuo.qStacks,2);
  assert.equal(cast('W'),true);assert.equal(e.yasuoWalls.length,1);
  assert.equal(cast('E'),true);advanceMovement(e,.3);assertClear(e,p,'YasuoE');
  t.statusEffects.push({type:'AIRBORNE',duration:2});const hp=t.hp;assert.equal(cast('R'),true);advanceMovement(e,1.2);assert.ok(t.hp<hp);assert.equal(p.yasuo.rRemaining,0);assertClear(e,p,'YasuoR');
});
