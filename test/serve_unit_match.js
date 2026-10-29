// Controlled spawn only; production AI, collision, targeting, damage, socket
// handlers and client run unchanged. No test endpoint added to production.
const Engine=require('../server/game/GameEngine');
const original=Engine.prototype.initialize;
Engine.prototype.initialize=function(){
 original.call(this);
 for(const p of Object.values(this.players)) {
   const human=p.id!=='bot_practice_ai';Object.assign(p,{x:human?1450:2100,y:human?1050:700,targetX:human?1450:2100,targetY:human?1050:700,hp:10000,maxHp:10000});
   if(p.yasuo){p.yasuo.lastX=p.x;p.yasuo.lastY=p.y;}
 }
 this.minionWaveTimer=30;
 for(const [i,type] of ['melee','caster','cannon','super'].entries()){
  this.createMinion('blue',type,1060,670+i*70);
  this.createMinion('red',type,1300,670+i*70);
 }
 const lastHit=this.createMinion('red','melee',1700,1100);lastHit.hp=20;lastHit.speed=0;
 // This standard cannon naturally attacks the outer turret and draws fire.
 this.createMinion('blue','cannon',1510,800);
 this.structures.red_outer_turret.hp=180;
};
process.env.PORT='4177';require('../server/server');
