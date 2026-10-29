// Behavior/cooldowns: Riot Data Dragon 16.21.1 Garen.json.
// Damage, shield and duration magnitudes are explicit local gameplay approximations;
// DDragon's current tooltips leave these values as unresolved formulas.
const { CHAMPIONS } = require('./ChampionData');
const Q_DAMAGE = [30, 60, 90, 120, 150];
const Q_SPEED_DURATION = [1, 1.65, 2.3, 2.95, 3.6];
const W_DURATION = [2, 2.75, 3.5, 4.25, 5];
const E_DAMAGE = [4, 8, 12, 16, 20];
const E_RATIO = [0.32, 0.34, 0.36, 0.38, 0.4];
const R_DAMAGE = [150, 300, 450];
const R_MISSING_HP = [0.25, 0.30, 0.35];
const TENACITY_TYPES = new Set(['STUN', 'ROOT', 'SLOW', 'SILENCE']);

function initialize(player) {
  if (player.championId !== 'garen') return;
  player.garen = {
    qRemaining: 0, qSpeedRemaining: 0, wRemaining: 0,
    wTenacityRemaining: 0, wShieldRemaining: 0, wShield: 0, wResists: 0,
    eRemaining: 0, eElapsed: 0, eNextPulse: 0, ePulseCount: 0,
    eTotalPulses: 0, eHits: null,
    rRemaining: 0, rTargetId: null, passiveBlockedUntil: 0
  };
}

function emit(engine, player, key, phase, duration = 0, target = null) {
  engine.eventsQueue.push({
    type: 'garenSkill', playerId: player.id, key, phase, duration,
    x: player.x, y: player.y,
    targetId: target ? target.id : null,
    targetX: target ? target.x : player.x, targetY: target ? target.y : player.y
  });
}

function endSpin(engine, player) {
  if (!player.garen || player.garen.eRemaining <= 0) return;
  player.garen.eRemaining = 0;
  player.garen.eHits = null;
  emit(engine, player, 'E', 'end');
}

function visibleTo(engine, player, target) {
  // The legacy engine folds bush concealment into stealth, so distinguish a
  // true invisibility effect from a bush that this team can currently see.
  if (target.statusEffects?.some(e => e.type === 'STEALTH' && e.duration > 0)) return false;
  if (!target.inBush) return !target.stealth;
  if (target.revealedTimer > 0) return true;
  for (const bush of engine.map.bushes) {
    if (Math.hypot(player.x - bush.x, player.y - bush.y) <= bush.radius &&
        Math.hypot(target.x - bush.x, target.y - bush.y) <= bush.radius) return true;
  }
  for (const ward of engine.wards) {
    if (ward.team === player.team && ward.duration > 0 &&
        Math.hypot(target.x - ward.x, target.y - ward.y) <= (ward.radius || 300)) return true;
  }
  return false;
}

function targetForR(engine, player, x, y, targetId) {
  const range = CHAMPIONS.garen.skills.R.range;
  if (targetId != null) {
    const target = engine.players[targetId];
    return target && target.isAlive && target.team !== player.team && visibleTo(engine, player, target) &&
      !target.isInvulnerable && Math.hypot(target.x - player.x, target.y - player.y) <= range ? target : null;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let best = null, bestDistance = Infinity;
  for (const id in engine.players) {
    const target = engine.players[id];
    if (!target.isAlive || target.team === player.team || !visibleTo(engine, player, target) || target.isInvulnerable) continue;
    const clickDistance = Math.hypot(target.x - x, target.y - y);
    if (clickDistance > (target.radius || 26) + 24 || clickDistance >= bestDistance) continue;
    if (Math.hypot(target.x - player.x, target.y - player.y) > range) continue;
    best = target; bestDistance = clickDistance;
  }
  return best;
}

function cast(engine, player, key, x, y, targetId) {
  const state = player.garen;
  const rank = player.skillRanks?.[key] || 0;
  const skill = CHAMPIONS.garen.skills[key];
  if (!state || !skill || rank < 1 || rank > (key === 'R' ? 3 : 5) || state.rRemaining > 0) return false;
  if (key === 'R' && player.level < 6 + (rank - 1) * 5) return false;
  if (key !== 'R' && rank > Math.min(5, Math.ceil(player.level / 2))) return false;
  if (key === 'E' && state.eRemaining > 0) {
    if (state.eElapsed < 1) return false;
    endSpin(engine, player);
    return true;
  }
  if (player.cooldowns[key] > 0) return false;
  const target = key === 'R' ? targetForR(engine, player, x, y, targetId) : null;
  if (key === 'R' && !target) return false;
  engine.cancelRecall(player);
  player.revealedTimer = 1.5;
  player.cooldowns[key] = skill.cooldowns[rank - 1];
  if (key === 'Q') {
    for (let i = player.statusEffects.length - 1; i >= 0; i--) {
      if (player.statusEffects[i].type === 'SLOW') player.statusEffects.splice(i, 1);
    }
    state.qRemaining = 8;
    state.qSpeedRemaining = Q_SPEED_DURATION[rank - 1];
    player.autoAttackCooldown = 0;
    player.moveSpeed = player.baseMoveSpeed * 1.35;
    emit(engine, player, 'Q', 'cast', state.qRemaining);
  } else if (key === 'W') {
    // Track only the unconsumed W shield so expiry cannot remove another shield.
    player.shield = Math.max(0, player.shield - state.wShield);
    state.wRemaining = W_DURATION[rank - 1];
    state.wTenacityRemaining = state.wShieldRemaining = 0.75;
    state.wShield = 65 + (rank - 1) * 20 + Math.max(0, player.maxHp - CHAMPIONS.garen.stats.maxHp - (player.level - 1) * 85) * 0.18;
    player.shield += state.wShield;
    emit(engine, player, 'W', 'cast', state.wRemaining);
  } else if (key === 'E') {
    state.eRemaining = 3; state.eElapsed = 0; state.eNextPulse = 0;
    state.ePulseCount = 0;
    state.eTotalPulses = 7 + Math.floor(Math.max(0, player.as / CHAMPIONS.garen.stats.attackSpeed - 1) / 0.25);
    state.eHits = Object.create(null);
    emit(engine, player, 'E', 'cast', state.eRemaining);
  } else if (key === 'R') {
    endSpin(engine, player);
    state.rRemaining = 0.5; state.rTargetId = target.id;
    player.targetX = player.x; player.targetY = player.y;
    player.vx = player.vy = 0;
    player.angle = Math.atan2(target.y - player.y, target.x - player.x);
    target.revealedTimer = 1;
    emit(engine, player, 'R', 'cast', state.rRemaining, target);
  }
  return true;
}

function nearestInCollection(player, collection, radius, closest) {
  for (const id in collection) {
    const target = collection[id];
    if (!target.isAlive || target.team === player.team) continue;
    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    if (dist > radius + (target.radius || 0)) continue;
    if (!closest || dist < Math.hypot(closest.x - player.x, closest.y - player.y)) closest = target;
  }
  return closest;
}

function damageSpinCollection(engine, player, collection, closest, damage, radius) {
  for (const id in collection) {
    const target = collection[id];
    if (!target.isAlive || target.team === player.team || Math.hypot(target.x - player.x, target.y - player.y) > radius + (target.radius || 0)) continue;
    engine.applyDamage(player.id, target, damage * (target === closest ? 1.25 : 1), 'physical', false);
    emit(engine, player, 'E', 'hit', 0, target);
    if (target.championId && target.isAlive) {
      const hits = player.garen.eHits[target.id] = (player.garen.eHits[target.id] || 0) + 1;
      if (hits >= 6) {
        let shred = target.statusEffects.find(e => e.type === 'GAREN_ARMOR_SHRED');
        if (shred) shred.duration = 6;
        else target.statusEffects.push({ type: 'GAREN_ARMOR_SHRED', duration: 6, value: 0.25 });
      }
    }
  }
}

function update(engine, player, dt) {
  const state = player.garen;
  if (!state || !player.isAlive) return;
  if (engine.gameTime >= state.passiveBlockedUntil) {
    const regenPercent = 0.015 + (player.level - 1) * (0.101 / 17);
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * regenPercent / 5 * dt);
  }
  if (state.qRemaining > 0) {
    state.qRemaining = Math.max(0, state.qRemaining - dt);
    if (!state.qRemaining) emit(engine, player, 'Q', 'end');
  }
  state.qSpeedRemaining = Math.max(0, state.qSpeedRemaining - dt);
  state.wTenacityRemaining = Math.max(0, state.wTenacityRemaining - dt);
  if (state.wShieldRemaining > 0) {
    state.wShieldRemaining = Math.max(0, state.wShieldRemaining - dt);
    if (!state.wShieldRemaining) {
      player.shield = Math.max(0, player.shield - state.wShield); state.wShield = 0;
    }
  }
  if (state.wRemaining > 0) {
    state.wRemaining = Math.max(0, state.wRemaining - dt);
    if (!state.wRemaining) emit(engine, player, 'W', 'end');
  }
  if (state.eRemaining > 0) {
    state.eElapsed += dt;
    while (state.ePulseCount < state.eTotalPulses && state.eElapsed + 1e-8 >= state.eNextPulse) {
      const radius = CHAMPIONS.garen.skills.E.radius;
      let closest = nearestInCollection(player, engine.players, radius, null);
      closest = nearestInCollection(player, engine.minions, radius, closest);
      closest = nearestInCollection(player, engine.jungleMonsters, radius, closest);
      const rank = player.skillRanks.E;
      const damage = E_DAMAGE[rank - 1] + (player.level - 1) * 8.2 / 17 + E_RATIO[rank - 1] * player.ad;
      damageSpinCollection(engine, player, engine.players, closest, damage, radius);
      damageSpinCollection(engine, player, engine.minions, closest, damage, radius);
      damageSpinCollection(engine, player, engine.jungleMonsters, closest, damage, radius);
      state.ePulseCount++;
      state.eNextPulse = state.ePulseCount * 3 / state.eTotalPulses;
    }
    if (state.eElapsed + 1e-8 >= 3) endSpin(engine, player);
    else state.eRemaining = 3 - state.eElapsed;
  }
  if (state.rRemaining > 0) {
    state.rRemaining = Math.max(0, state.rRemaining - dt);
    if (state.rRemaining < 1e-8) {
      state.rRemaining = 0;
      const target = engine.players[state.rTargetId];
      if (target?.isAlive && target.team !== player.team) {
        const rank = player.skillRanks.R;
        const amount = R_DAMAGE[rank - 1] + R_MISSING_HP[rank - 1] * Math.max(0, target.maxHp - target.hp);
        engine.applyDamage(player.id, target, amount, 'true', true);
        emit(engine, player, 'R', 'hit', 0, target);
      }
      emit(engine, player, 'R', 'end', 0, target);
      state.rTargetId = null;
    }
  }
}

function empowerAttack(engine, player, target, rawDamage) {
  const state = player.garen;
  if (!state || state.qRemaining <= 0) return rawDamage;
  state.qRemaining = 0;
  if (target.statusEffects) {
    target.statusEffects.push({ type: 'SILENCE', duration: 1.5 });
    target.isSilenced = true;
  }
  emit(engine, player, 'Q', 'hit', 0, target);
  return rawDamage + Q_DAMAGE[player.skillRanks.Q - 1] + player.ad * 0.5;
}

function applyTenacity(player, effect) {
  if (player.garen?.wTenacityRemaining > 0 && TENACITY_TYPES.has(effect.type) && !effect.garenTenacityApplied) {
    effect.duration *= 0.4; effect.garenTenacityApplied = true;
  }
}

function onDamage(engine, player, attackerId, rawAmount) {
  if (!player.garen || rawAmount <= 0) return;
  const attacker = engine.players[attackerId] || engine.structures[attackerId];
  let epic = false;
  for (const id in engine.jungleMonsters) {
    const monster = engine.jungleMonsters[id];
    if (monster.id === attackerId && (monster.type === 'dragon' || monster.type === 'baron')) epic = true;
  }
  if (attacker?.championId || attacker?.type === 'turret' || epic) player.garen.passiveBlockedUntil = engine.gameTime + 8;
}

function onKill(engine, killer, victim) {
  if (!killer?.garen || !(victim.championId || victim.isMinion || victim.team === 'neutral')) return;
  const before = killer.garen.wResists;
  killer.garen.wResists = Math.min(30, before + 0.2);
  if (killer.garen.wResists !== before) engine.recalculatePlayerStats(killer);
}

function reset(engine, player) {
  const state = player.garen;
  if (!state) return;
  for (const key of ['Q', 'W', 'E', 'R']) {
    if (state[key.toLowerCase() + 'Remaining'] > 0) emit(engine, player, key, 'end');
  }
  const resists = state.wResists;
  player.shield = Math.max(0, player.shield - state.wShield);
  initialize(player);
  player.garen.wResists = resists;
  player.garen.passiveBlockedUntil = engine.gameTime + 8;
}

module.exports = { initialize, cast, update, empowerAttack, applyTenacity, onDamage, onKill, reset };
