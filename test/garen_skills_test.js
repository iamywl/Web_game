const assert = require('node:assert/strict');
const test = require('node:test');
const GameEngine = require('../server/game/GameEngine');
const Garen = require('../server/game/GarenMechanics');
const { CHAMPIONS } = require('../server/game/ChampionData');
const DT = 1 / 60;

function fixture(enemyChampion = 'sniper') {
  const room = { id: 'garen-kit-test', mode: '1v1', players: {
    garen: { team: 'blue', nickname: 'Garen', championId: 'garen' },
    enemy: { team: 'red', nickname: 'Enemy', championId: enemyChampion }
  } };
  const engine = new GameEngine(room, { to: () => ({ emit() {} }) });
  engine.initialize();
  engine.map.obstacles = []; engine.structures = {}; engine.jungleMonsters = {};
  const player = engine.players.garen, enemy = engine.players.enemy;
  Object.assign(player, { x: 1000, y: 800, targetX: 1000, targetY: 800, level: 6, hpRegen: 0, skillRanks: { Q: 1, W: 1, E: 1, R: 1 } });
  Object.assign(enemy, { x: 1100, y: 800, targetX: 1100, targetY: 800, hp: 10000, maxHp: 10000, hpRegen: 0, armor: 0, mr: 0 });
  return { engine, player, enemy };
}

function advance(engine, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    engine.gameTime += DT;
    engine.updatePlayerStatuses();
    engine.updatePlayerMovements();
    for (const id in engine.players) Garen.update(engine, engine.players[id], DT);
  }
}

function events(engine, key, phase) {
  return engine.eventsQueue.filter(e => e.type === 'garenSkill' && e.key === key && e.phase === phase);
}

test('Garen is manaless after spawn, level growth and item stat recalculation', () => {
  const { engine, player } = fixture();
  assert.equal(CHAMPIONS.garen.name, '가렌');
  assert.equal(player.mp, 0); assert.equal(player.maxMp, 0);
  player.level = 18; engine.recalculatePlayerStats(player);
  assert.equal(player.maxMp, 0);
  for (const skill of Object.values(CHAMPIONS.garen.skills)) assert.equal(skill.mana, 0);
});

test('Q cleanses slows, grants speed and resets attack cooldown without dashing', () => {
  const { engine, player } = fixture();
  player.statusEffects.push({ type: 'SLOW', duration: 3, value: 0.5 });
  player.autoAttackCooldown = 1;
  assert.equal(engine.handleCastSkill('garen', 'Q', 2000, 800), true);
  assert.equal(player.x, 1000);
  assert.equal(player.autoAttackCooldown, 0);
  assert.equal(player.statusEffects.some(e => e.type === 'SLOW'), false);
  assert.equal(player.moveSpeed, player.baseMoveSpeed * 1.35);
  assert.equal(events(engine, 'Q', 'cast').length, 1);
  assert.equal(player.cooldowns.Q, 8);
});

test('Q empowers exactly one attack and immediately silences enemy skill casts', () => {
  const { engine, player, enemy } = fixture();
  engine.handleCastSkill('garen', 'Q');
  const before = enemy.hp;
  engine.executeBasicAttack(player, enemy);
  assert.equal(before - enemy.hp, player.ad * 1.5 + 30);
  assert.equal(player.garen.qRemaining, 0);
  assert.equal(enemy.isSilenced, true);
  const cooldown = enemy.cooldowns.Q;
  engine.handleCastSkill('enemy', 'Q', 1000, 800);
  assert.equal(enemy.cooldowns.Q, cooldown);
  const afterQ = enemy.hp; engine.executeBasicAttack(player, enemy);
  assert.equal(afterQ - enemy.hp, player.ad);
  assert.equal(events(engine, 'Q', 'hit').length, 1);
  advance(engine, 1.6);
  assert.equal(enemy.isSilenced, false);
});

test('Garen Q expires unused and never triggers Blademaster third-hit passive', () => {
  const { engine, player, enemy } = fixture();
  engine.handleCastSkill('garen', 'Q'); advance(engine, 8.1);
  assert.equal(player.garen.qRemaining, 0);
  const before = enemy.hp;
  for (let i = 0; i < 3; i++) engine.executeBasicAttack(player, enemy);
  assert.equal(before - enemy.hp, 3 * player.ad);
  assert.equal(player.statusEffects.some(e => e.type === 'SPEED'), false);
});

test('W grants a short shield and tenacity but a longer 30% damage reduction', () => {
  const { engine, player } = fixture();
  player.armor = 0;
  engine.handleCastSkill('garen', 'W');
  assert.equal(player.shield, 65);
  const before = player.hp;
  engine.applyDamage('enemy', player, 200, 'physical', false);
  assert.ok(Math.abs(player.hp - (before - 75)) < 0.001);
  player.statusEffects.push({ type: 'STUN', duration: 2 });
  advance(engine, DT);
  assert.ok(player.statusEffects[0].duration < 0.8);
  advance(engine, 0.8);
  assert.equal(player.shield, 0); assert.ok(player.garen.wRemaining > 0);
  const hp = player.hp; engine.applyDamage('enemy', player, 100, 'physical', false);
  assert.ok(Math.abs(hp - player.hp - 70) < 0.001);
});

test('W does not reduce true damage and expiry preserves unrelated shields', () => {
  const { engine, player } = fixture();
  player.shield = 100;
  engine.handleCastSkill('garen', 'W');
  assert.equal(player.shield, 165);
  engine.applyDamage('enemy', player, 20, 'true', false);
  assert.equal(player.shield, 145);
  advance(engine, 0.8);
  assert.equal(player.shield, 100);
  player.shield = 0;
  const hp = player.hp; engine.applyDamage('enemy', player, 50, 'true', false);
  assert.equal(hp - player.hp, 50);
});

test('E deals seven periodic physical hits, shreds armor, and does not hit structures/allies', () => {
  const { engine, player, enemy } = fixture();
  const turret = { id: 'tower', type: 'turret', isAlive: true, isInvulnerable: false, team: 'red', x: 1100, y: 800, hp: 1000, maxHp: 1000, radius: 20, armor: 0 };
  engine.structures.tower = turret;
  const hp = player.hp;
  engine.handleCastSkill('garen', 'E');
  assert.equal(enemy.hp, 10000, 'damage begins on simulation tick');
  advance(engine, 3);
  assert.equal(events(engine, 'E', 'hit').filter(e => e.targetId === 'enemy').length, 7);
  assert.ok(enemy.hp < 10000);
  assert.equal(turret.hp, 1000);
  assert.equal(player.hp, hp);
  assert.ok(enemy.statusEffects.some(e => e.type === 'GAREN_ARMOR_SHRED'));
  assert.equal(player.garen.eRemaining, 0);
  assert.equal(events(engine, 'E', 'end').length, 1);
});

test('E follows movement and suppresses basic attacks while allowing Q and W', () => {
  const { engine, player } = fixture();
  engine.handleCastSkill('garen', 'E');
  engine.handleAttackTarget('garen', 'enemy'); engine.updateAutoAttacks();
  assert.equal(engine.eventsQueue.some(e => e.type === 'attack' && e.attackerId === player.id), false);
  engine.handleMoveInput('garen', 1300, 800); advance(engine, 0.25);
  assert.ok(player.x > 1000);
  assert.equal(engine.handleCastSkill('garen', 'Q'), true);
  assert.equal(engine.handleCastSkill('garen', 'W'), true);
  assert.ok(player.garen.eRemaining > 0);
});

test('E early recast works after one second without consuming a second cooldown', () => {
  const { engine, player } = fixture();
  engine.handleCastSkill('garen', 'E');
  assert.equal(engine.handleCastSkill('garen', 'E'), false);
  advance(engine, 1.1);
  const cooldown = player.cooldowns.E;
  assert.equal(engine.handleCastSkill('garen', 'E'), true);
  assert.equal(player.garen.eRemaining, 0);
  assert.equal(player.cooldowns.E, cooldown);
});

test('R invalid targets, distance and locked skill ranks consume no cooldown', () => {
  const { engine, player, enemy } = fixture();
  player.skillRanks.W = 0;
  assert.equal(engine.handleCastSkill('garen', 'W'), false);
  assert.equal(player.cooldowns.W, 0);
  assert.equal(engine.handleCastSkill('garen', 'R', 2000, 800), false);
  assert.equal(engine.handleCastSkill('garen', 'R', 1100, 800, 'garen'), false);
  engine.minions.minion = { id: 'minion', team: 'red', x: 1100, y: 800, isAlive: true };
  assert.equal(engine.handleCastSkill('garen', 'R', 1100, 800, 'minion'), false);
  enemy.x = 1600;
  assert.equal(engine.handleCastSkill('garen', 'R', enemy.x, enemy.y, 'enemy'), false);
  enemy.x = 1100; player.level = 5;
  assert.equal(engine.handleCastSkill('garen', 'R', enemy.x, enemy.y, 'enemy'), false);
  assert.equal(player.cooldowns.R, 0);
});

test('R interrupts E, locks movement briefly, and applies delayed missing-health true damage', () => {
  const { engine, player, enemy } = fixture();
  enemy.hp = 8000; enemy.armor = 10000; enemy.mr = 10000;
  engine.handleCastSkill('garen', 'E');
  assert.equal(engine.handleCastSkill('garen', 'R', 1100, 800, 'enemy'), true);
  assert.equal(player.garen.eRemaining, 0);
  assert.equal(player.cooldowns.R, 120);
  engine.handleMoveInput('garen', 1500, 800);
  advance(engine, 0.25);
  assert.equal(enemy.hp, 8000); assert.equal(player.x, 1000);
  advance(engine, 0.25);
  assert.equal(enemy.hp, 7350);
  assert.equal(events(engine, 'R', 'hit').length, 1);
  assert.equal(player.garen.rRemaining, 0);
});

test('R rejects hidden bush targets but accepts shared-bush or allied-ward visibility', () => {
  const hidden = fixture();
  hidden.engine.map.bushes = [{ x: 1100, y: 800, radius: 50 }];
  hidden.enemy.inBush = true; hidden.enemy.stealth = true; hidden.enemy.revealedTimer = 0;
  assert.equal(hidden.engine.handleCastSkill('garen', 'R', 1100, 800, 'enemy'), false);
  assert.equal(hidden.player.cooldowns.R, 0);
  hidden.player.x = 1070;
  assert.equal(hidden.engine.handleCastSkill('garen', 'R', 1100, 800, 'enemy'), true);
  const warded = fixture();
  warded.enemy.inBush = true; warded.enemy.stealth = true;
  warded.engine.wards.push({ team: 'blue', x: 1100, y: 800, radius: 300, duration: 10 });
  assert.equal(warded.engine.handleCastSkill('garen', 'R', 1100, 800, 'enemy'), true);
  const invisible = fixture();
  invisible.enemy.statusEffects.push({ type: 'STEALTH', duration: 2 });
  assert.equal(invisible.engine.handleCastSkill('garen', 'R', 1100, 800, 'enemy'), false);
});

test('Garen basic and ultimate ranks respect champion-level unlocks', () => {
  const { engine, player } = fixture();
  player.level = 1; player.skillPoints = 5;
  assert.equal(engine.handleUpgradeSkill('garen', 'Q').success, false);
  assert.equal(player.skillPoints, 5);
  player.skillRanks.Q = 2;
  assert.equal(engine.handleCastSkill('garen', 'Q'), false);
  player.level = 3;
  assert.equal(engine.handleCastSkill('garen', 'Q'), true);
  player.level = 10; player.skillRanks.R = 2;
  assert.equal(engine.handleCastSkill('garen', 'R', 1100, 800, 'enemy'), false);
  player.level = 11;
  assert.equal(engine.handleCastSkill('garen', 'R', 1100, 800, 'enemy'), true);
  assert.equal(player.cooldowns.R, 100);
});

test('death cancels pending R and all temporary Garen states; respawn restores mana-free state', () => {
  const { engine, player, enemy } = fixture();
  engine.handleCastSkill('garen', 'Q'); engine.handleCastSkill('garen', 'W');
  engine.handleCastSkill('garen', 'R', 1100, 800, 'enemy');
  engine.handleDeath('enemy', player);
  assert.equal(player.garen.qRemaining + player.garen.wRemaining + player.garen.rRemaining, 0);
  advance(engine, 0.6);
  assert.equal(events(engine, 'R', 'hit').length, 0);
  assert.equal(engine.eventsQueue.some(e => e.type === 'damage' && e.targetId === enemy.id), false);
  engine.respawnPlayer(player);
  assert.equal(player.mp, 0); assert.equal(player.isAlive, true);
});

test('Perseverance is blocked by champion damage for eight seconds, then heals', () => {
  const { engine, player } = fixture();
  player.hp = player.maxHp - 100;
  engine.applyDamage('enemy', player, 10, 'true', false);
  const hp = player.hp;
  advance(engine, 7.9); assert.equal(player.hp, hp);
  advance(engine, 0.3); assert.ok(player.hp > hp);
});

test('Courage kill resistances cap at 30 and survive death/respawn/stat rebuilds', () => {
  const { engine, player, enemy } = fixture();
  for (let i = 0; i < 200; i++) Garen.onKill(engine, player, enemy);
  assert.equal(player.garen.wResists, 30);
  const armor = player.armor, mr = player.mr;
  engine.handleDeath('enemy', player); engine.respawnPlayer(player);
  engine.recalculatePlayerStats(player);
  assert.equal(player.garen.wResists, 30);
  assert.equal(player.armor, armor); assert.equal(player.mr, mr);
});

test('snapshots carry skill phases and silence without exposing internal hit maps', () => {
  const { engine } = fixture();
  engine.handleCastSkill('garen', 'E');
  const snapshot = engine.getState().players.find(p => p.id === 'garen');
  assert.deepEqual(Object.keys(snapshot.garen).sort(), ['eRemaining', 'qRemaining', 'rRemaining', 'wRemaining']);
  assert.equal(snapshot.garen.eRemaining, 3);
  assert.equal(snapshot.isSilenced, false);
});


test('Garen and restored Blademaster coexist with independent mana, definitions and snapshots', () => {
  const { engine, player, enemy: blade } = fixture('blademaster');
  assert.equal(Object.keys(CHAMPIONS).length, 12);
  assert.equal(CHAMPIONS.blademaster.name, '검객');
  assert.equal(CHAMPIONS.blademaster.stats.maxHp, 640);
  assert.equal(CHAMPIONS.blademaster.skills.Q.type, 'dash_line');
  assert.equal(CHAMPIONS.garen.skills.Q.type, 'self_buff');
  assert.notEqual(CHAMPIONS.garen.skills, CHAMPIONS.blademaster.skills);
  assert.equal(player.maxMp, 0); assert.equal(blade.maxMp, 300);
  assert.equal(blade.garen, undefined);
  player.level = 18; blade.level = 18;
  engine.recalculatePlayerStats(player); engine.recalculatePlayerStats(blade);
  assert.equal(player.maxMp, 0); assert.ok(blade.maxMp > 300);
  const state = engine.getState();
  assert.ok(state.players.find(p => p.id === 'garen').garen);
  assert.equal(state.players.find(p => p.id === 'enemy').garen, null);
});

test('Blademaster Q dash, W burst, E shield and R airborne retain original mana/cooldowns', () => {
  const { engine, player, enemy: blade } = fixture('blademaster');
  Object.assign(player, { hp: 10000, maxHp: 10000, armor: 0, mr: 0 });
  engine.handleCastSkill('garen', 'Q');
  assert.equal(player.x, 1000);
  engine.handleCastSkill('enemy', 'Q', 1000, 800);
  assert.equal(blade.x, 1000);
  assert.equal(player.hp, 9910); assert.equal(blade.mp, 255);
  assert.equal(blade.cooldowns.Q, 6);
  engine.handleCastSkill('enemy', 'Q', 1200, 800);
  assert.equal(blade.x, 1000); assert.equal(blade.mp, 255);
  engine.handleCastSkill('enemy', 'W', player.x, player.y);
  assert.equal(player.hp, 9800); assert.equal(blade.mp, 205);
  assert.equal(blade.cooldowns.W, 8);
  engine.handleCastSkill('enemy', 'E', player.x, player.y);
  assert.equal(blade.shield, 180); assert.equal(blade.mp, 150);
  assert.equal(blade.cooldowns.E, 11);
  assert.ok(blade.statusEffects.some(e => e.type === 'SPEED' && e.value === 0.25));
  engine.handleCastSkill('enemy', 'R', player.x, player.y);
  assert.equal(player.hp, 9520); assert.equal(blade.mp, 50);
  assert.equal(blade.cooldowns.R, 45);
  assert.ok(player.statusEffects.some(e => e.type === 'AIRBORNE' && e.duration === 1.2));
  assert.equal(player.mp, 0); assert.equal(player.garen.qRemaining, 8);
  assert.equal(engine.eventsQueue.filter(e => e.type === 'garenSkill' && e.playerId === blade.id).length, 0);
});

test('Blademaster triple-hit passive is restored without leaking into Garen attacks', () => {
  const { engine, player, enemy: blade } = fixture('blademaster');
  Object.assign(player, { hp: 10000, maxHp: 10000, armor: 0 });
  for (let i = 0; i < 3; i++) engine.executeBasicAttack(blade, player);
  assert.equal(10000 - player.hp, blade.ad * 3.5);
  assert.equal(blade.passiveCount, 0);
  assert.ok(blade.statusEffects.some(e => e.type === 'SPEED' && e.value === 0.2));
  const hp = blade.hp;
  for (let i = 0; i < 3; i++) engine.executeBasicAttack(player, blade);
  assert.equal(hp - blade.hp, player.ad * 3);
  assert.equal(player.statusEffects.some(e => e.type === 'SPEED'), false);
});

test('Blademaster insufficient mana rejects skills while Garen can cast at zero mana', () => {
  const { engine, player, enemy: blade } = fixture('blademaster');
  blade.mp = 44;
  engine.handleCastSkill('enemy', 'Q', 1000, 800);
  assert.equal(blade.mp, 44); assert.equal(blade.cooldowns.Q, 0); assert.equal(blade.x, 1100);
  assert.equal(engine.handleCastSkill('garen', 'Q'), true);
  assert.equal(player.mp, 0); assert.equal(player.cooldowns.Q, 8);
});
