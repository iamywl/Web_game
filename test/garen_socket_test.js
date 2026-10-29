// Real protocol test: two ordinary clients, no engine imports/admin endpoints.
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const fs = require('node:fs');
const path = require('node:path');
const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:3000';
const report = { startedAt: new Date().toISOString(), serverUrl: SERVER_URL, checks: [], skillEvents: [], limitations: ['R is intentionally tested while level-locked; successful level-6 execution and target selection are covered by garen_skills_test.js, not this live match.'] };
const sockets = [];
let latest, myId;

function waitFor(socket, event, predicate = () => true, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const listener = value => {
      if (!predicate(value)) return;
      clearTimeout(timer); socket.off(event, listener); resolve(value);
    };
    const timer = setTimeout(() => {
      socket.off(event, listener); reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    socket.on(event, listener);
  });
}

function request(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const callback = (err, response) => err ? reject(err) : resolve(response);
    if (payload === undefined) socket.timeout(4000).emit(event, callback);
    else socket.timeout(4000).emit(event, payload, callback);
  });
}

function me(state = latest) { return state.players.find(p => p.id === myId); }
function count(key, phase) { return report.skillEvents.filter(e => e.key === key && e.phase === phase).length; }
function tickCount(socket, count = 8) { let seen = 0; return waitFor(socket, 'gameTick', () => ++seen >= count); }
function passed(name, details = {}) { report.checks.push({ name, passed: true, ...details }); console.log(`PASS ${name}`); }

async function run() {
  for (let i = 0; i < 2; i++) sockets.push(io(SERVER_URL, { transports: ['websocket'], reconnection: false, autoConnect: false }));
  const [garen, enemy] = sockets;
  await Promise.all(sockets.map(socket => { const connected = waitFor(socket, 'connect'); socket.connect(); return connected; }));
  myId = garen.id;
  garen.on('gameTick', state => {
    latest = state;
    for (const event of state.events || []) {
      if (event.type === 'garenSkill' && event.playerId === myId) report.skillEvents.push({ ...event, observedAt: Date.now() });
    }
  });
  const suffix = Date.now().toString(36).slice(-5);
  assert.equal((await request(garen, 'registerUser', { nickname: `Garen_${suffix}` })).success, true);
  assert.equal((await request(enemy, 'registerUser', { nickname: `Enemy_${suffix}` })).success, true);
  const created = await request(garen, 'createRoom', { name: 'Garen skill protocol QA', mode: '1v1' });
  assert.equal(created.success, true);
  assert.equal((await request(enemy, 'joinRoom', { roomId: created.room.id })).success, true);
  await request(enemy, 'switchTeam', { team: 'red' });
  await request(enemy, 'toggleReady');
  assert.equal((await request(garen, 'startDraft')).success, true);
  const battle = waitFor(garen, 'battleStarted');
  assert.equal((await request(garen, 'lockChampion', { championId: 'garen' })).success, true);
  assert.equal((await request(enemy, 'lockChampion', { championId: 'blademaster' })).success, true);
  await battle;
  await tickCount(garen, 2);
  assert.equal(me().championId, 'garen');
  assert.equal(me().maxMp, 0); assert.equal(me().mp, 0);
  assert.equal(me().skillRanks.Q, 1); assert.equal(me().skillRanks.E, 0);
  assert.equal(me().garen.qRemaining, 0); assert.equal(me().isSilenced, false);
  passed('actual lobby/draft/match yields manaless Garen and skill state');
  const blade = latest.players.find(p => p.id === enemy.id);
  assert.equal(blade.championId, 'blademaster');
  assert.equal(blade.maxMp, 300); assert.equal(blade.garen, null);
  passed('Garen and Blademaster occupy the same real match with separate resources and states');
  const shielded = waitFor(garen, 'gameTick', state => state.players.some(p => p.id === enemy.id && p.shield > 0));
  enemy.emit('castSkill', { key: 'E', targetX: blade.x, targetY: blade.y });
  const shieldState = await shielded;
  const bladeAfter = shieldState.players.find(p => p.id === enemy.id);
  assert.equal(bladeAfter.shield, 180);
  assert.ok(bladeAfter.mp >= 245 && bladeAfter.mp < 250);
  assert.ok(bladeAfter.cooldowns.E > 10);
  assert.equal(bladeAfter.garen, null);
  assert.equal(me(shieldState).mp, 0); assert.equal(me(shieldState).garen.eRemaining, 0);
  passed('Blademaster E remains a mana-costing shield and does not trigger Garen spin');


  const qCast = waitFor(garen, 'gameTick', state => (state.events || []).some(e => e.type === 'garenSkill' && e.playerId === myId && e.key === 'Q' && e.phase === 'cast'));
  garen.emit('castSkill', { key: 'Q', targetX: me().x, targetY: me().y });
  const qState = await qCast;
  assert.ok(me(qState).garen.qRemaining > 7);
  assert.ok(me(qState).cooldowns.Q > 7);
  const firstRemaining = me(qState).garen.qRemaining;
  passed('Q cast event and armed/cooldown timers reach the client');

  garen.emit('castSkill', { key: 'Q', targetId: enemy.id });
  await tickCount(garen);
  assert.equal(count('Q', 'cast'), 1);
  assert.ok(me().garen.qRemaining < firstRemaining);
  assert.ok(me().cooldowns.Q < 8);
  passed('Q recast on cooldown is rejected without duplicate event or timer reset');

  garen.emit('castSkill', { key: 'E' });
  await tickCount(garen);
  assert.equal(count('E', 'cast'), 0);
  assert.equal(me().garen.eRemaining, 0); assert.equal(me().cooldowns.E, 0);
  passed('unlearned E is rejected');

  const upgrade = await request(garen, 'upgradeSkill', { key: 'E' });
  assert.equal(upgrade.success, true); assert.equal(upgrade.skillRanks.E, 1);
  const eCast = waitFor(garen, 'gameTick', state => (state.events || []).some(e => e.type === 'garenSkill' && e.playerId === myId && e.key === 'E' && e.phase === 'cast'));
  garen.emit('castSkill', { key: 'E', targetId: enemy.id });
  const eState = await eCast;
  assert.ok(me(eState).garen.eRemaining > 2.8);
  assert.ok(me(eState).cooldowns.E > 8.8);
  passed('ordinary upgradeSkill unlocks E; cast starts authoritative spin');

  garen.emit('castSkill', { key: 'E' });
  await tickCount(garen, 4);
  assert.equal(count('E', 'end'), 0); assert.ok(me().garen.eRemaining > 0);
  passed('E cannot be cancelled before the one-second recast window');

  const eEnd = await waitFor(garen, 'gameTick', state => (state.events || []).some(e => e.type === 'garenSkill' && e.playerId === myId && e.key === 'E' && e.phase === 'end'), 5000);
  assert.equal(me(eEnd).garen.eRemaining, 0);
  assert.equal(count('E', 'cast'), 1); assert.equal(count('E', 'end'), 1);
  assert.ok(me(eEnd).cooldowns.E > 5.5);
  passed('E naturally ends once after three seconds and retains cooldown');

  garen.emit('castSkill', { key: 'E' });
  await tickCount(garen);
  assert.equal(count('E', 'cast'), 1); assert.equal(me().garen.eRemaining, 0);
  passed('ended E cannot immediately restart during cooldown');

  const lockedUpgrade = await request(garen, 'upgradeSkill', { key: 'R' });
  assert.equal(lockedUpgrade.success, false);
  for (const targetId of [enemy.id, myId, 'missing-target']) {
    garen.emit('castSkill', { key: 'R', targetX: me().x, targetY: me().y, targetId });
  }
  await tickCount(garen);
  assert.equal(count('R', 'cast'), 0); assert.equal(count('R', 'hit'), 0);
  assert.equal(me().cooldowns.R, 0); assert.equal(me().garen.rRemaining, 0);
  passed('level-locked R requests with enemy/self/unknown targetId produce no cast or cooldown');
  report.finalSnapshot = me();
}

run().catch(error => {
  report.error = error.stack; process.exitCode = 1; console.error(error);
}).finally(() => {
  for (const socket of sockets) { socket.removeAllListeners(); socket.disconnect(); }
  report.finishedAt = new Date().toISOString();
  report.status = report.error ? 'FAIL' : 'PASS';
  const folder = path.join(__dirname, 'garen-results'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'skills-socket.json'), JSON.stringify(report, null, 2));
  console.log(`${report.status}: ${report.checks.length} checks; all sockets disconnected`);
});
