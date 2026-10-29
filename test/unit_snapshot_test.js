const assert = require('node:assert/strict');
const test = require('node:test');
const GameEngine = require('../server/game/GameEngine');

// Exercise authoritative combat with ordinary units. No renderer or server timers.
function fixture(mode = '1v1') {
  const e = new GameEngine({ id: 'unit-model-regression', mode, endGame() {}, players: {
    blue: { nickname: 'Blue', championId: 'blademaster', team: 'blue' },
    red: { nickname: 'Red', championId: 'blademaster', team: 'red' }
  } }, { to: () => ({ emit() {} }) });
  e.initialize();
  e.map.obstacles = []; e.map.bushes = []; e.jungleMonsters = {};
  e.minionWaveTimer = 100000;
  for (const p of Object.values(e.players)) Object.assign(p, {
    x: p.team === 'blue' ? 100 : 2300, y: 100, targetX: p.team === 'blue' ? 100 : 2300,
    targetY: 100, hp: 10000, maxHp: 10000, hpRegen: 0, armor: 0, mr: 0
  });
  if (mode === '1v1') e.structures = {};
  return e;
}
const snapshot = e => JSON.parse(JSON.stringify(e.getState()));
const minion = (e, id) => snapshot(e).minions.find(m => m.id === id);
function tower(e, team = 'blue') {
  const t = { id: 'unit_test_turret', type: 'turret', team, x: 1000, y: 800,
    radius: 46, range: 380, hp: 2500, maxHp: 2500, armor: 40,
    attackCooldown: 0, attackInterval: 1.1, damage: 130, targetId: null,
    isAlive: true, isInvulnerable: false };
  e.structures[t.id] = t;
  return t;
}

test('all eight team/type combinations expose initial animation telemetry without changing stats', () => {
  const e = fixture();
  for (const team of ['blue', 'red']) for (const type of ['melee', 'caster', 'cannon', 'super']) {
    const m = e.createMinion(team, type, 1000, 800);
    const s = minion(e, m.id);
    assert.equal(s.type, type); assert.equal(s.team, team);
    assert.equal(s.attackSequence, 0); assert.equal(s.vx, 0); assert.equal(s.vy, 0);
    assert.equal(s.as, m.as); assert.equal(s.speed, m.speed); assert.equal(s.hp, m.maxHp);
    assert.equal(s.targetId, null); assert.equal(s.isAttacking, false);
  }
});

test('movement snapshot reports resolved signed velocity and returns to zero when attacking', () => {
  for (const team of ['blue', 'red']) {
    const e = fixture(), m = e.createMinion(team, 'melee', 1000, 800);
    const x = m.x, y = m.y;
    e.updateMinions();
    const moving = minion(e, m.id);
    assert.ok(team === 'blue' ? moving.vx > 0 : moving.vx < 0);
    assert.ok(Math.abs(moving.vx - (m.x - x) * 60) < 1e-6);
    assert.ok(Math.abs(moving.vy - (m.y - y) * 60) < 1e-6);
    const enemy = e.players[team === 'blue' ? 'red' : 'blue'];
    Object.assign(enemy, { x: m.x + (team === 'blue' ? 45 : -45), y: m.y });
    m.attackCooldown = 0; e.updateMinions();
    const stopped = minion(e, m.id);
    assert.equal(stopped.vx, 0); assert.equal(stopped.vy, 0);
    assert.equal(stopped.attackSequence, 1); assert.equal(stopped.targetId, enemy.id);
  }
});

test('melee attack sequence advances exactly once per real strike, never per cooldown snapshot', () => {
  const e = fixture(), m = e.createMinion('blue', 'melee', 1000, 800), p = e.players.red;
  Object.assign(p, { x: 1050, y: 800 }); m.attackCooldown = 0;
  const hp = p.hp; e.updateMinions();
  assert.equal(p.hp, hp - m.damage); assert.equal(m.attackSequence, 1);
  assert.equal(minion(e, m.id).isAttacking, true);
  for (let i = 0; i < 30; i++) { e.updateMinions(); snapshot(e); }
  assert.equal(p.hp, hp - m.damage); assert.equal(m.attackSequence, 1);
  assert.equal(minion(e, m.id).isAttacking, false);
  m.attackCooldown = 0; e.updateMinions();
  assert.equal(m.attackSequence, 2); assert.equal(p.hp, hp - 2 * m.damage);
  p.x = 2200; m.attackCooldown = 0; e.updateMinions();
  assert.equal(m.attackSequence, 2); assert.equal(minion(e, m.id).targetId, null);
});

test('caster/cannon/super retain existing projectile damage and one animation sequence per shot', () => {
  for (const type of ['caster', 'cannon', 'super']) {
    const e = fixture(), m = e.createMinion('blue', type, 1000, 800), p = e.players.red;
    Object.assign(p, { x: 1050, y: 800 }); m.attackCooldown = 0;
    const hp = p.hp; e.updateMinions();
    assert.equal(m.attackSequence, 1); assert.equal(e.projectiles.length, 1); assert.equal(p.hp, hp);
    assert.equal(e.projectiles[0].type, type === 'cannon' ? 'cannon_bullet' : 'minion_bolt');
    for (let i = 0; i < 15; i++) e.updateProjectiles();
    assert.equal(e.projectiles.length, 0); assert.equal(p.hp, hp - m.damage);
    e.updateMinions(); assert.equal(m.attackSequence, 1); assert.equal(e.projectiles.length, 0);
  }
});

test('hard structure separation still resolves movement before animation telemetry', () => {
  const e = fixture(), t = tower(e), m = e.createMinion('blue', 'melee', t.x, t.y);
  const x = m.x, y = m.y; e.updateMinions();
  assert.ok(Math.hypot(m.x - t.x, m.y - t.y) >= t.radius + m.radius + 6 - 1e-8);
  const s = minion(e, m.id);
  assert.ok(Math.abs(s.vx - (m.x - x) * 60) < 1e-6);
  assert.ok(Math.abs(s.vy - (m.y - y) * 60) < 1e-6);
});

test('turret sequence advances only for emitted missiles; cooldown and target loss remain authoritative', () => {
  const e = fixture(), t = tower(e), p = e.players.red;
  Object.assign(p, { x: 1200, y: 800 });
  e.updateTurrets(); assert.equal(t.attackSequence, 1); assert.equal(e.projectiles.length, 1);
  assert.equal(snapshot(e).structures[0].attackSequence, 1);
  assert.equal(e.projectiles[0].type, 'turret_bullet'); assert.equal(e.projectiles[0].targetId, p.id);
  for (let i = 0; i < 30; i++) e.updateTurrets();
  assert.equal(t.attackSequence, 1); assert.equal(e.projectiles.length, 1);
  const hp = p.hp; for (let i = 0; i < 30; i++) e.updateProjectiles();
  assert.equal(p.hp, hp - t.damage);
  p.x = 2000; t.attackCooldown = 0; e.updateTurrets();
  assert.equal(t.attackSequence, 1); assert.equal(t.targetId, null);
});

test('neighbor separation contributes to both minions resolved velocity', () => {
  const e = fixture(), a = e.createMinion('blue', 'melee', 1000, 800), b = e.createMinion('blue', 'melee', 1008, 800);
  const start = [{ m: a, x: a.x, y: a.y }, { m: b, x: b.x, y: b.y }];
  e.updateMinions();
  for (const { m, x, y } of start) {
    const s = minion(e, m.id);
    assert.ok(Math.abs(s.vx - (m.x - x) * 60) < 1e-6);
    assert.ok(Math.abs(s.vy - (m.y - y) * 60) < 1e-6);
    assert.equal(s.attackSequence, 0);
  }
});

test('turret chooses minion before champion; champion aggression still retargets turret', () => {
  const e = fixture(), t = tower(e), m = e.createMinion('red', 'caster', 1150, 800);
  Object.assign(e.players.red, { x: 1200, y: 800 }); Object.assign(e.players.blue, { x: 1100, y: 900 });
  e.updateTurrets(); assert.equal(t.targetId, m.id); assert.equal(t.attackSequence, 1);
  e.applyDamage('red', e.players.blue, 10, 'physical', false);
  assert.equal(t.targetId, 'red'); assert.equal(t.attackSequence, 1);
  assert.ok(e.eventsQueue.some(ev => ev.type === 'turret_dive_alert' && ev.targetId === 'red'));
  t.attackCooldown = 0; e.updateTurrets();
  assert.equal(t.attackSequence, 2); assert.equal(e.projectiles.at(-1).targetId, 'red');
});

test('invulnerable turret stays damage-proof and may attack; destroyed turret stops firing', () => {
  const e = fixture(), t = tower(e);
  Object.assign(e.players.red, { x: 1200, y: 800 }); t.isInvulnerable = true;
  e.applyDamage('red', t, 10000, 'true', false); assert.equal(t.hp, 2500);
  e.updateTurrets(); assert.equal(t.attackSequence, 1);
  assert.equal(snapshot(e).structures[0].isInvulnerable, true);
  t.isInvulnerable = false; e.applyDamage('red', t, 10000, 'true', false);
  assert.equal(t.isAlive, false); assert.equal(t.hp, 0);
  t.attackCooldown = 0; const projectiles = e.projectiles.length; e.updateTurrets();
  assert.equal(e.projectiles.length, projectiles); assert.equal(t.attackSequence, 1); assert.equal(t.targetId, null);
  const destroyed = snapshot(e).structures[0]; assert.equal(destroyed.isAlive, false); assert.equal(destroyed.hp, 0);
});

test('dead minions immediately leave gameplay snapshot while CS/gold/XP rewards remain unchanged', async () => {
  const e = fixture(), p = e.players.blue, m = e.createMinion('red', 'melee', 1100, 800);
  Object.assign(p, { x: 1000, y: 800 }); const gold = p.gold, cs = p.cs || 0, exp = p.exp;
  e.applyDamage(p.id, m, 10000, 'true', false);
  assert.equal(m.isAlive, false); assert.equal(m.hp, 0); assert.equal(minion(e, m.id), undefined);
  assert.equal(p.gold, gold + 21); assert.equal(p.cs, cs + 1); assert.equal(p.exp, exp + 55);
  const sequence = m.attackSequence; e.updateMinions(); assert.equal(m.attackSequence, sequence);
  await new Promise(resolve => setTimeout(resolve, 1550)); assert.equal(e.minions[m.id], undefined);
});

test('three-lane waves keep ordinary type counts and super spawning after inhibitor destruction', () => {
  const e = fixture('5v5'); e.spawnMinionWave();
  assert.equal(Object.values(e.minions).length, 36);
  for (const lane of ['top', 'mid', 'bot']) assert.equal(Object.values(e.minions).filter(m => m.lane === lane).length, 12);
  e.minions = {}; e.minionWaveCount = 2; e.spawnMinionWave();
  assert.equal(Object.values(e.minions).filter(m => m.type === 'cannon').length, 6);
  e.minions = {}; e.structures.red_mid_inhibitor.isAlive = false; e.spawnMinionWave();
  const supers = Object.values(e.minions).filter(m => m.type === 'super');
  assert.equal(supers.length, 1); assert.equal(supers[0].team, 'blue'); assert.equal(supers[0].lane, 'mid');
  assert.equal(minion(e, supers[0].id).attackSequence, 0);
});
