// Kit, cooldowns and cast ranges: Riot Data Dragon 16.21.1/Yasuo.json.
// Damage, Flow/shield, tornado speed/width, E duration and crit scaling below
// are explicit local approximations, not a claim of exact live-patch parity.
const { CHAMPIONS } = require('./ChampionData');
const SKILLS = () => CHAMPIONS.yasuo.skills;

function initialize(p) {
  if (p.championId !== 'yasuo') return;
  p.yasuo = { qStacks: 0, qRemaining: 0, eRemaining: 0, rRemaining: 0,
    flow: 0, shieldRemaining: 0, shield: 0, lastX: p.x, lastY: p.y,
    eLocks: Object.create(null), eTargetId: null, eEndX: 0, eEndY: 0,
    eCombo: null, eStacks: 0, eBuffRemaining: 0, rTargets: null };
}

function emit(engine, p, key, phase, variant, duration = 0, target = null, radius = 0) {
  engine.eventsQueue.push({ type: 'yasuoSkill', playerId: p.id, key, phase, variant,
    x: p.x, y: p.y, targetX: target?.x ?? p.x, targetY: target?.y ?? p.y,
    targetId: target?.id ?? null, duration, angle: p.angle || 0, radius });
}

function visible(engine, p, target) {
  if (target.statusEffects?.some(e => e.type === 'STEALTH' && e.duration > 0)) return false;
  if (!target.stealth && !target.inBush || target.revealedTimer > 0) return true;
  for (const bush of engine.map.bushes || []) {
    if (Math.hypot(p.x - bush.x, p.y - bush.y) <= bush.radius &&
        Math.hypot(target.x - bush.x, target.y - bush.y) <= bush.radius) return true;
  }
  return engine.wards.some(w => w.team === p.team && w.duration > 0 && Math.hypot(target.x - w.x, target.y - w.y) <= (w.radius || 300));
}

function airborne(p) { return p.statusEffects?.some(e => e.type === 'AIRBORNE' && e.duration > 0); }
function targetFor(engine, p, key, x, y, id) {
  let best = null, bestDist = Infinity;
  function consider(target) {
    if (!target || !target.isAlive || target.team === p.team || target.isInvulnerable || !visible(engine, p, target)) return;
    if (key === 'R' && (!target.championId || !airborne(target))) return;
    if (Math.hypot(target.x - p.x, target.y - p.y) > SKILLS()[key].range) return;
    if (key === 'E' && (p.yasuo.eLocks[target.id] || 0) > engine.gameTime) return;
    const dist = id != null ? 0 : Math.hypot(target.x - x, target.y - y);
    if (dist <= (target.radius || 26) + 30 && dist < bestDist) { best = target; bestDist = dist; }
  }
  if (id != null) {
    let selected = engine.players[id] || (key === 'E' && (engine.minions[id] || engine.jungleMonsters[id]));
    // Jungle dictionary keys (e.g. dragon) differ from network IDs (elemental_dragon).
    if (!selected && key === 'E') for (const key in engine.jungleMonsters) {
      if (engine.jungleMonsters[key].id === id) { selected = engine.jungleMonsters[key]; break; }
    }
    consider(selected);
  }
  else if (Number.isFinite(x) && Number.isFinite(y)) {
    for (const t of Object.values(engine.players)) consider(t);
    if (key === 'E') { for (const t of Object.values(engine.minions)) consider(t); for (const t of Object.values(engine.jungleMonsters)) consider(t); }
  }
  return best;
}

function pointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function eachEnemy(engine, p, callback) {
  for (let n = 0; n < 3; n++) {
    const collection = n === 0 ? engine.players : n === 1 ? engine.minions : engine.jungleMonsters;
    for (const id in collection) {
      const t = collection[id];
      if (t.isAlive && t.team !== p.team && !t.isInvulnerable) callback(t);
    }
  }
}

function qDamage(p, rank) { return 20 * rank + 1.05 * p.ad; }
function qHit(engine, p, target, damage, tornado, variant) {
  engine.applyDamage(p.id, target, damage, 'physical', false);
  if (tornado && target.statusEffects && target.isAlive) {
    target.statusEffects.push({ type: 'AIRBORNE', duration: 1 }); target.isStunned = true;
  }
  emit(engine, p, 'Q', 'hit', variant, tornado ? 1 : 0, target);
}
function gainQ(p) { p.yasuo.qStacks = Math.min(2, p.yasuo.qStacks + 1); p.yasuo.qRemaining = 6; }
function circle(engine, p, combo) {
  let hit = false;
  eachEnemy(engine, p, t => {
    if (Math.hypot(t.x - p.x, t.y - p.y) > 220 + (t.radius || 0)) return;
    hit = true; qHit(engine, p, t, qDamage(p, combo.rank), combo.tornado, 'circle');
  });
  if (hit && !combo.tornado) gainQ(p);
}

function cast(engine, p, key, x, y, targetId) {
  const s = p.yasuo, rank = p.skillRanks?.[key] || 0, skill = SKILLS()[key];
  if (!s || !skill || !rank || rank > (key === 'R' ? 3 : 5) || p.cooldowns[key] > 0 || s.rRemaining > 0) return false;
  if (key === 'R' ? p.level < 6 + (rank - 1) * 5 : rank > Math.ceil(p.level / 2)) return false;
  if (key === 'E' && (s.eRemaining > 0 || p.isRooted)) return false;
  const target = key === 'E' || key === 'R' ? targetFor(engine, p, key, x, y, targetId) : null;
  if ((key === 'E' || key === 'R') && !target) return false;
  const angle = Number.isFinite(x) && Number.isFinite(y) && (x !== p.x || y !== p.y) ? Math.atan2(y - p.y, x - p.x) : p.angle || 0;
  p.angle = target ? Math.atan2(target.y - p.y, target.x - p.x) : angle;
  engine.cancelRecall(p); p.revealedTimer = 1.5;
  p.cooldowns[key] = skill.cooldowns[rank - 1];
  if (key === 'Q') {
    p.cooldowns.Q = Math.max(1.33, 4 / Math.max(1, p.as / CHAMPIONS.yasuo.stats.attackSpeed));
    const tornado = s.qStacks >= 2;
    if (tornado) { s.qStacks = 0; s.qRemaining = 0; }
    if (s.eRemaining > 0) {
      s.eCombo = { rank, tornado }; emit(engine, p, 'Q', 'cast', 'circle', s.eRemaining, target, 220);
    } else if (tornado) {
      engine.spawnProjectile({ ownerId: p.id, team: p.team, type: 'yasuo_tornado', x: p.x, y: p.y,
        vx: Math.cos(angle), vy: Math.sin(angle), speed: 1200, radius: 65, rangeRemaining: 1200,
        damage: qDamage(p, rank), hits: Object.create(null), color: '#9fe8ed' });
      emit(engine, p, 'Q', 'cast', 'tornado', 1, { x: p.x + Math.cos(angle) * 1200, y: p.y + Math.sin(angle) * 1200 }, 65);
    } else {
      const tx = p.x + Math.cos(angle) * skill.range, ty = p.y + Math.sin(angle) * skill.range;
      emit(engine, p, 'Q', 'cast', 'thrust', 0.3, { x: tx, y: ty }, 35);
      let hit = false;
      eachEnemy(engine, p, t => {
        if (pointSegment(t.x, t.y, p.x, p.y, tx, ty) > 35 + (t.radius || 0)) return;
        hit = true; qHit(engine, p, t, qDamage(p, rank), false, 'thrust');
      });
      if (hit) gainQ(p);
    }
  } else if (key === 'W') {
    const wall = { id: `wall_${engine.nextEntityId++}`, playerId: p.id, team: p.team,
      x: p.x + Math.cos(angle) * 120, y: p.y + Math.sin(angle) * 120, angle, width: 300 + (rank - 1) * 50, remaining: 4 };
    engine.yasuoWalls.push(wall); emit(engine, p, 'W', 'cast', 'wall', 4, wall, wall.width / 2);
  } else if (key === 'E') {
    s.eRemaining = 0.25; s.eTargetId = target.id;
    s.eEndX = p.x + Math.cos(p.angle) * 475; s.eEndY = p.y + Math.sin(p.angle) * 475;
    s.eLocks[target.id] = engine.gameTime + 11 - rank;
    const amount = (50 + rank * 10) * (1 + 0.25 * s.eStacks) + 0.2 * p.ad;
    s.eStacks = Math.min(2, s.eStacks + 1); s.eBuffRemaining = 6;
    engine.applyDamage(p.id, target, amount, 'magic', false);
    p.targetX = p.x; p.targetY = p.y; p.targetEnemyId = null;
    emit(engine, p, 'E', 'cast', 'dash', 0.25, { id: target.id, x: s.eEndX, y: s.eEndY });
    emit(engine, p, 'E', 'hit', 'dash', 0, target);
  } else if (key === 'R') {
    s.eRemaining = 0; s.eCombo = null; s.qStacks = 0; s.qRemaining = 0; s.flow = 100;
    s.rRemaining = 1; s.rTargets = [];
    for (const id in engine.players) {
      const t = engine.players[id];
      if (!t.isAlive || t.team === p.team || !airborne(t) || Math.hypot(t.x - target.x, t.y - target.y) > 400) continue;
      s.rTargets.push(id); t.statusEffects.push({ type: 'AIRBORNE', duration: 1.05, yasuoOwner: p.id }); t.isStunned = true;
    }
    engine.resolvePlayerMovement(p, target.x - Math.cos(p.angle) * 60, target.y - Math.sin(p.angle) * 60, true);
    p.navPath = null;
    p.targetX = p.x; p.targetY = p.y; p.vx = p.vy = 0; s.lastX = p.x; s.lastY = p.y;
    emit(engine, p, 'R', 'cast', 'ultimate', 1, target, 400);
  }
  return true;
}

function releaseR(engine, p) {
  for (const id of p.yasuo.rTargets || []) {
    const t = engine.players[id];
    if (t) t.statusEffects = t.statusEffects.filter(e => e.yasuoOwner !== p.id);
  }
  p.yasuo.rTargets = null;
}
function update(engine, p, dt) {
  const s = p.yasuo;
  if (!s || !p.isAlive) return;
  if (s.qRemaining > 0) {
    s.qRemaining = Math.max(0, s.qRemaining - dt);
    if (!s.qRemaining) { s.qStacks = 0; emit(engine, p, 'Q', 'end', 'thrust'); }
  }
  s.eBuffRemaining = Math.max(0, s.eBuffRemaining - dt);
  if (!s.eBuffRemaining) s.eStacks = 0;
  for (const id in s.eLocks) if (s.eLocks[id] <= engine.gameTime) delete s.eLocks[id];
  if (s.shieldRemaining > 0) {
    s.shieldRemaining = Math.max(0, s.shieldRemaining - dt);
    if (!s.shieldRemaining) { p.shield = Math.max(0, p.shield - s.shield); s.shield = 0; emit(engine, p, 'P', 'end', 'shield'); }
  }
  if (s.eRemaining > 0) {
    if (p.isStunned || p.isRooted) { s.eRemaining = 0; s.eCombo = null; emit(engine, p, 'E', 'end', 'dash'); }
    else {
      const fraction = Math.min(1, dt / s.eRemaining);
      engine.resolvePlayerMovement(p, p.x + (s.eEndX - p.x) * fraction, p.y + (s.eEndY - p.y) * fraction);
      p.targetX = p.x; p.targetY = p.y; s.eRemaining = Math.max(0, s.eRemaining - dt);
      if (s.eRemaining < 1e-8) {
        s.eRemaining = 0;
        if (s.eCombo) circle(engine, p, s.eCombo);
        s.eCombo = null; emit(engine, p, 'E', 'end', 'dash');
      }
    }
  }
  const distance = Math.hypot(p.x - s.lastX, p.y - s.lastY);
  // Recall/Flash/respawn are teleports, not distance walked for Flow.
  if (distance <= 2000 * dt + 1) s.flow = Math.min(100, s.flow + distance / 24);
  s.lastX = p.x; s.lastY = p.y;
  if (s.rRemaining > 0) {
    if (p.isStunned) { s.rRemaining = 0; releaseR(engine, p); emit(engine, p, 'R', 'end', 'ultimate'); }
    else {
      s.rRemaining = Math.max(0, s.rRemaining - dt);
      if (s.rRemaining < 1e-8) {
        s.rRemaining = 0;
        for (const id of s.rTargets || []) {
          const target = engine.players[id];
          if (!target?.isAlive) continue;
          engine.applyDamage(p.id, target, 100 + p.skillRanks.R * 100 + 1.5 * p.ad, 'physical', false);
          emit(engine, p, 'R', 'hit', 'ultimate', 0, target);
        }
        releaseR(engine, p); emit(engine, p, 'R', 'end', 'ultimate');
      }
    }
  }
}

function updateWalls(engine, dt) {
  for (let i = engine.yasuoWalls.length - 1; i >= 0; i--) {
    const wall = engine.yasuoWalls[i]; wall.remaining -= dt;
    if (wall.remaining <= 0) { engine.yasuoWalls.splice(i, 1); const p = engine.players[wall.playerId]; if (p) emit(engine, p, 'W', 'end', 'wall'); }
  }
}
function blocked(engine, proj, x, y) {
  if (engine.structures[proj.ownerId]?.type === 'turret') return false;
  for (const wall of engine.yasuoWalls) {
    if (proj.team === wall.team || wall.remaining <= 0) continue;
    const nx = Math.cos(wall.angle), ny = Math.sin(wall.angle);
    const a = (proj.x - wall.x) * nx + (proj.y - wall.y) * ny;
    const b = (x - wall.x) * nx + (y - wall.y) * ny;
    const thickness = (proj.radius || 0) + 12;
    if (Math.min(a, b) > thickness || Math.max(a, b) < -thickness) continue;
    const t = Math.abs(a - b) > 1e-8 ? Math.max(0, Math.min(1, a / (a - b))) : 0;
    const ix = proj.x + (x - proj.x) * t, iy = proj.y + (y - proj.y) * t;
    if (Math.abs(-(ix - wall.x) * ny + (iy - wall.y) * nx) > wall.width / 2 + (proj.radius || 0)) continue;
    engine.eventsQueue.push({ type: 'yasuoWallBlock', playerId: wall.playerId, wallId: wall.id, x: ix, y: iy }); return true;
  }
  return false;
}
function projectile(engine, proj, dt) {
  const p = engine.players[proj.ownerId];
  const x = proj.x + proj.vx * proj.speed * dt, y = proj.y + proj.vy * proj.speed * dt;
  if (blocked(engine, proj, x, y)) return true;
  if (p) for (let n = 0; n < 3; n++) {
    const collection = n === 0 ? engine.players : n === 1 ? engine.minions : engine.jungleMonsters;
    for (const id in collection) {
      const target = collection[id];
      if (!target.isAlive || target.team === p.team || target.isInvulnerable || proj.hits[id] || pointSegment(target.x, target.y, proj.x, proj.y, x, y) > proj.radius + (target.radius || 0)) continue;
      proj.hits[id] = true; qHit(engine, p, target, proj.damage, true, 'tornado');
    }
  }
  proj.x = x; proj.y = y; proj.rangeRemaining -= proj.speed * dt;
  return proj.rangeRemaining <= 0 || x < 0 || y < 0 || x > engine.map.width || y > engine.map.height;
}
function onDamage(engine, p, attackerId, amount) {
  const s = p.yasuo;
  if (!s || amount <= 0 || s.flow < 100) return;
  if (!engine.players[attackerId] && !engine.jungleMonsters[attackerId]) return;
  p.shield = Math.max(0, (p.shield || 0) - s.shield);
  s.flow = 0; s.shield = 100 + (p.level - 1) * 20; s.shieldRemaining = 1;
  p.shield += s.shield; emit(engine, p, 'P', 'cast', 'shield', 1);
}
function reset(engine, p) {
  if (!p.yasuo) return;
  for (const key of ['E', 'R']) if (p.yasuo[key.toLowerCase() + 'Remaining'] > 0) emit(engine, p, key, 'end', key === 'E' ? 'dash' : 'ultimate');
  releaseR(engine, p); p.shield = Math.max(0, (p.shield || 0) - p.yasuo.shield); initialize(p);
}

module.exports = { initialize, cast, update, updateWalls, blocked, projectile, onDamage, reset };
