// Test-only level-6 setup. Runs the real server, socket handlers, tick loop and client.
// No test endpoint or cheat is added to the production server.
const Engine = require('../server/game/GameEngine');
const initialize = Engine.prototype.initialize;
Engine.prototype.initialize = function () {
  initialize.call(this);
  for (const p of Object.values(this.players)) {
    const yasuo = p.championId === 'yasuo';
    Object.assign(p, { x: yasuo ? 1100 : 1400, y: 800, targetX: yasuo ? 1100 : 1400, targetY: 800,
      hp: 10000, maxHp: 10000, hpRegen: 0, level: 6, skillRanks: { Q: 1, W: 1, E: 1, R: 1 }, skillPoints: 0 });
    if (p.yasuo) { p.yasuo.lastX = p.x; p.yasuo.lastY = p.y; }
    else { p.ad = 0; p.autoAttackCooldown = 100000; }
  }
  // Keep map/structures visible while isolating champion interactions from waves.
  this.updateMinions = this.updateTurrets = this.updateJungleMonsters = () => {};
};
process.env.PORT = '4176';
require('../server/server');
