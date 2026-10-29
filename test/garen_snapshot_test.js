const assert = require('node:assert/strict');
const test = require('node:test');
const GameEngine = require('../server/game/GameEngine');

// No timers or sockets: exercise the same authoritative methods used by tick().
function fixture() {
  const room = {
    id: 'garen-animation-regression',
    mode: '1v1',
    players: {
      blue: { nickname: 'Garen', team: 'blue', championId: 'garen' },
      red: { nickname: 'Target', team: 'red', championId: 'guardian' }
    }
  };
  const engine = new GameEngine(room, { to: () => ({ emit() {} }) });
  engine.initialize();
  engine.map.obstacles = [];
  engine.structures = {};
  const attacker = engine.players.blue;
  const target = engine.players.red;
  Object.assign(attacker, { x: 800, y: 800, targetX: 800, targetY: 800 });
  Object.assign(target, { x: 1400, y: 800, targetX: 1400, targetY: 800, isStunned: true });
  return { engine, attacker, target };
}

function playerSnapshot(engine) {
  // JSON serialization is part of Socket.IO delivery; undefined velocities disappear.
  return JSON.parse(JSON.stringify(engine.getState())).players.find(p => p.id === 'blue');
}

function attacks(engine) {
  return engine.eventsQueue.filter(e => e.type === 'attack' && e.attackerId === 'blue');
}

test('stationary snapshots explicitly deliver zero velocity', () => {
  const { engine } = fixture();
  const snapshot = playerSnapshot(engine);
  assert.equal(snapshot.vx, 0);
  assert.equal(snapshot.vy, 0);
});

test('snapshots preserve signed motion, attack speed and facing', () => {
  const { engine, attacker } = fixture();
  Object.assign(attacker, { vx: -125.5, vy: 37.25, angle: 2.2, as: 1.75 });
  const snapshot = playerSnapshot(engine);
  assert.equal(snapshot.vx, attacker.vx);
  assert.equal(snapshot.vy, attacker.vy);
  assert.equal(snapshot.angle, attacker.angle);
  assert.equal(snapshot.as, attacker.as);
});

test('a real move produces velocity and stop clears it', () => {
  const { engine, attacker } = fixture();
  engine.handleMoveInput('blue', 900, 900);
  const x = attacker.x, y = attacker.y;
  engine.updatePlayerMovements();
  const moving = playerSnapshot(engine);
  assert.ok(attacker.x > x && attacker.y > y, 'player must actually move');
  assert.ok(moving.vx > 0 && moving.vy > 0, 'snapshot must select run');
  assert.ok(Math.abs(moving.vx - (attacker.x - x) * 60) < 0.01);
  assert.ok(Math.abs(moving.vy - (attacker.y - y) * 60) < 0.01);
  engine.handleStop('blue');
  engine.updatePlayerMovements();
  const stopped = playerSnapshot(engine);
  assert.equal(stopped.vx, 0);
  assert.equal(stopped.vy, 0);
});

test('stun, root and death clear stale movement telemetry', () => {
  for (const status of ['isStunned', 'isRooted', 'isAlive']) {
    const { engine, attacker } = fixture();
    Object.assign(attacker, { vx: 200, vy: -20, targetX: 900, targetY: 700 });
    attacker[status] = status !== 'isAlive';
    engine.updatePlayerMovements();
    assert.equal(attacker.x, 800);
    assert.equal(attacker.y, 800);
    const snapshot = playerSnapshot(engine);
    assert.equal(snapshot.vx, 0, status);
    assert.equal(snapshot.vy, 0, status);
  }
});

test('pushing into a wall reports resolved zero motion instead of requested run velocity', () => {
  const { engine, attacker } = fixture();
  engine.map.obstacles = [{ type: 'box', x: 900, y: 700, width: 100, height: 200 }];
  attacker.x = 900 - attacker.radius;
  engine.handleMoveInput('blue', 1000, 800);
  engine.updatePlayerMovements();
  const snapshot = playerSnapshot(engine);
  assert.equal(attacker.x, 900 - attacker.radius);
  assert.equal(snapshot.vx, 0);
  assert.equal(snapshot.vy, 0);
});

test('targeting out of range chases without emitting an attack', () => {
  const { engine, attacker, target } = fixture();
  engine.handleAttackTarget('blue', 'red');
  engine.updateAutoAttacks();
  assert.equal(attacks(engine).length, 0);
  assert.equal(attacker.targetX, target.x);
  engine.updatePlayerMovements();
  assert.ok(playerSnapshot(engine).vx > 0);
});

test('only an authoritative in-range strike emits a new swing; cooldown and move cancel are respected', () => {
  const { engine, attacker, target } = fixture();
  Object.assign(target, { x: 900, y: 800, targetX: 900, targetY: 800 });
  attacker.as = 1.5;
  engine.handleAttackTarget('blue', 'red');
  engine.updateAutoAttacks();
  assert.equal(attacks(engine).length, 1);
  assert.equal(attacks(engine)[0].targetId, 'red');
  assert.equal(attacks(engine)[0].isRanged, false);
  assert.equal(attacker.autoAttackCooldown, 1 / attacker.as);
  assert.ok(target.hp < target.maxHp, 'event accompanies real melee damage');
  engine.updateAutoAttacks();
  assert.equal(attacks(engine).length, 1, 'same cooldown must not restart animation');
  attacker.autoAttackCooldown = 0;
  engine.updateAutoAttacks();
  assert.equal(attacks(engine).length, 2, 'next strike must emit another swing');
  engine.handleMoveInput('blue', 600, 800);
  attacker.autoAttackCooldown = 0;
  engine.updateAutoAttacks();
  assert.equal(attacks(engine).length, 2, 'move order cancels target before another strike');
  assert.equal(attacker.targetEnemyId, null);
});
