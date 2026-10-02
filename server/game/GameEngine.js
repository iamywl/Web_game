/**
 * GameEngine.js
 * 30 FPS Authoritative Game Engine for MOBA Arena
 * Handles movement, collisions, projectiles, skill execution, turrets, and victory conditions.
 */

const { CHAMPIONS, SUMMONER_SPELLS } = require('./ChampionData');

const TICK_RATE = 60;
const DT = 1 / TICK_RATE; // ~0.01666s (60 FPS tick)
const MAP_WIDTH = 2400;
const MAP_HEIGHT = 1600;

class GameEngine {
  constructor(room, io) {
    this.room = room;
    this.io = io;
    this.timerHandle = null;
    this.gameTime = 0; // seconds

    this.map = {
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      obstacles: [
        // Jungle stone pillars and rocks
        { id: 'rock_top_left', type: 'circle', x: 800, y: 480, radius: 95 },
        { id: 'rock_top_right', type: 'circle', x: 1600, y: 480, radius: 95 },
        { id: 'rock_bot_left', type: 'circle', x: 800, y: 1120, radius: 95 },
        { id: 'rock_bot_right', type: 'circle', x: 1600, y: 1120, radius: 95 },
        { id: 'pillar_top', type: 'box', x: 1150, y: 280, width: 100, height: 160 },
        { id: 'pillar_bot', type: 'box', x: 1150, y: 1160, width: 100, height: 160 }
      ],
      bushes: [
        { id: 'bush_river_top', x: 1200, y: 520, radius: 90 },
        { id: 'bush_river_bot', x: 1200, y: 1080, radius: 90 },
        { id: 'bush_mid_blue', x: 960, y: 720, radius: 80 },
        { id: 'bush_mid_red', x: 1440, y: 880, radius: 80 }
      ],
      bases: {
        blue: { x: 260, y: 800, spawnX: 340, spawnY: 800 },
        red: { x: 2140, y: 800, spawnX: 2060, spawnY: 800 }
      }
    };

    // Structures (Nexus Cores & Turrets)
    this.structures = {
      blue_nexus: {
        id: 'blue_nexus',
        team: 'blue',
        type: 'nexus',
        name: '블루 넥서스',
        x: 260,
        y: 800,
        radius: 65,
        hp: 3500,
        maxHp: 3500,
        armor: 30,
        isAlive: true
      },
      red_nexus: {
        id: 'red_nexus',
        team: 'red',
        type: 'nexus',
        name: '레드 넥서스',
        x: 2140,
        y: 800,
        radius: 65,
        hp: 3500,
        maxHp: 3500,
        armor: 30,
        isAlive: true
      },
      blue_turret: {
        id: 'blue_turret',
        team: 'blue',
        type: 'turret',
        name: '블루 포탑',
        x: 650,
        y: 800,
        radius: 45,
        hp: 2200,
        maxHp: 2200,
        armor: 35,
        range: 340,
        attackCooldown: 0,
        attackInterval: 1.2,
        damage: 85,
        isAlive: true
      },
      red_turret: {
        id: 'red_turret',
        team: 'red',
        type: 'turret',
        name: '레드 포탑',
        x: 1750,
        y: 800,
        radius: 45,
        hp: 2200,
        maxHp: 2200,
        armor: 35,
        range: 340,
        attackCooldown: 0,
        attackInterval: 1.2,
        damage: 85,
        isAlive: true
      }
    };

    this.players = {}; // socketId -> Player
    this.projectiles = []; // array of active skillshots
    this.aoeZones = []; // array of ground delay/persistent zones
    this.eventsQueue = []; // damage numbers, CC alerts, kills to broadcast this tick

    this.scores = {
      blue: 0,
      red: 0
    };

    this.nextEntityId = 1;
  }

  initialize() {
    const roomPlayers = this.room.players;
    let blueSpawnIndex = 0;
    let redSpawnIndex = 0;

    for (const [socketId, p] of Object.entries(roomPlayers)) {
      const champId = p.championId || 'blademaster';
      const champData = CHAMPIONS[champId] || CHAMPIONS.blademaster;

      let spawnX, spawnY;
      if (p.team === 'blue') {
        spawnX = this.map.bases.blue.spawnX;
        spawnY = this.map.bases.blue.spawnY + (blueSpawnIndex * 70 - 70);
        blueSpawnIndex++;
      } else {
        spawnX = this.map.bases.red.spawnX;
        spawnY = this.map.bases.red.spawnY + (redSpawnIndex * 70 - 70);
        redSpawnIndex++;
      }

      this.players[socketId] = {
        id: socketId,
        nickname: p.nickname,
        team: p.team,
        championId: champId,
        avatar: champData.avatar,
        color: champData.color,
        accentColor: champData.accentColor,
        x: spawnX,
        y: spawnY,
        targetX: spawnX,
        targetY: spawnY,
        vx: 0,
        vy: 0,
        angle: p.team === 'blue' ? 0 : Math.PI,
        radius: champData.stats.radius,

        // Vitals
        hp: champData.stats.maxHp,
        maxHp: champData.stats.maxHp,
        hpRegen: champData.stats.hpRegen,
        mp: champData.stats.maxMp,
        maxMp: champData.stats.maxMp,
        mpRegen: champData.stats.mpRegen,
        shield: 0,

        // Combat Stats
        baseAd: champData.stats.attackDamage,
        ad: champData.stats.attackDamage,
        baseAs: champData.stats.attackSpeed,
        as: champData.stats.attackSpeed,
        armor: champData.stats.armor,
        mr: champData.stats.magicResist,
        baseMoveSpeed: champData.stats.moveSpeed,
        moveSpeed: champData.stats.moveSpeed,
        attackRange: champData.stats.attackRange,

        // Cooldowns
        cooldowns: { Q: 0, W: 0, E: 0, R: 0, D: 0, F: 0 },
        autoAttackCooldown: 0,
        spellD: p.spellD || 'flash',
        spellF: p.spellF || 'ignite',

        // CC & Buffs
        statusEffects: [], // { type, duration, value }
        isAlive: true,
        respawnTimer: 0,

        // KDA
        kills: 0,
        deaths: 0,
        assists: 0,

        // Specific Champion Mechanic Trackers
        passiveCount: 0,
        passiveTimer: 0,
        comboStacks: 0,
        stealth: false,
        deathMark: null, // for Shadow Assassin R
        targetEnemyId: null // target for auto attack
      };
    }
  }

  start() {
    if (this.timerHandle) return;
    this.timerHandle = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        console.error(`[GameEngine ${this.room.id}] Tick Error:`, err);
      }
    }, 1000 / TICK_RATE);
  }

  stop() {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  removePlayer(socketId) {
    delete this.players[socketId];
  }

  tick() {
    this.gameTime += DT;

    // 1. Process Status Effects & Regenerations
    this.updatePlayerStatuses();

    // 2. Process Movements & Collisions
    this.updatePlayerMovements();

    // 3. Process Turrets & Attacks
    this.updateTurrets();
    this.updateAutoAttacks();

    // 4. Process Projectiles
    this.updateProjectiles();

    // 5. Process AoE Zones
    this.updateAoeZones();

    // 6. Broadcast Tick State
    this.broadcastTick();

    // Clear frame events
    this.eventsQueue = [];
  }

  updatePlayerStatuses() {
    for (const p of Object.values(this.players)) {
      if (!p.isAlive) {
        p.respawnTimer -= DT;
        if (p.respawnTimer <= 0) {
          this.respawnPlayer(p);
        }
        continue;
      }

      // Regens
      p.hp = Math.min(p.maxHp, p.hp + p.hpRegen * DT);
      p.mp = Math.min(p.maxMp, p.mp + p.mpRegen * DT);

      // Fountain healing if near base
      const base = this.map.bases[p.team];
      const distToBase = Math.hypot(p.x - base.x, p.y - base.y);
      if (distToBase < 220) {
        p.hp = Math.min(p.maxHp, p.hp + 60 * DT);
        p.mp = Math.min(p.maxMp, p.mp + 40 * DT);
      }

      // Decrement Cooldowns
      for (const key of Object.keys(p.cooldowns)) {
        if (p.cooldowns[key] > 0) {
          p.cooldowns[key] = Math.max(0, p.cooldowns[key] - DT);
        }
      }
      if (p.autoAttackCooldown > 0) {
        p.autoAttackCooldown = Math.max(0, p.autoAttackCooldown - DT);
      }

      // Update Buffs / Debuffs
      let speedMult = 1.0;
      let adBonus = 0;
      let asBonus = 0;
      let isStealthed = false;
      let isStunned = false;
      let isRooted = false;
      let isImmune = false;

      // Berserker Passive: missing health scaling
      if (p.championId === 'berserker') {
        const missingPct = Math.max(0, (p.maxHp - p.hp) / p.maxHp);
        asBonus += missingPct * 0.8;
        adBonus += missingPct * 45;
      }

      for (let i = p.statusEffects.length - 1; i >= 0; i--) {
        const eff = p.statusEffects[i];
        eff.duration -= DT;

        if (eff.type === 'SLOW') speedMult *= (1 - (eff.value || 0.3));
        if (eff.type === 'SPEED') speedMult *= (1 + (eff.value || 0.25));
        if (eff.type === 'STUN' || eff.type === 'AIRBORNE') isStunned = true;
        if (eff.type === 'ROOT') isRooted = true;
        if (eff.type === 'STEALTH') isStealthed = true;
        if (eff.type === 'IMMUNE') isImmune = true;
        if (eff.type === 'AS_BUFF') asBonus += (eff.value || 0.5);
        if (eff.type === 'AD_BUFF') adBonus += (eff.value || 30);

        // DoT (Damage over time, e.g. Ignite or Blaze)
        if (eff.type === 'DOT') {
          eff.tickCounter = (eff.tickCounter || 0) + DT;
          if (eff.tickCounter >= 0.5) {
            eff.tickCounter = 0;
            this.applyDamage(eff.sourcePlayerId, p, eff.dps * 0.5, 'magic', false);
          }
        }

        if (eff.duration <= 0) {
          // Expiration handling
          if (eff.type === 'SHIELD') {
            p.shield = Math.max(0, p.shield - eff.value);
          }
          if (eff.type === 'COUNTER_GUARD' && p.championId === 'brawler') {
            // Trigger brawler stun shockwave on expiration
            this.createAoeBlast(p.id, p.team, p.x, p.y, 220, 70, 'STUN', 1.0);
          }
          p.statusEffects.splice(i, 1);
        }
      }

      p.stealth = isStealthed;
      p.isStunned = isStunned;
      p.isRooted = isRooted;
      p.isImmune = isImmune;
      p.moveSpeed = p.baseMoveSpeed * speedMult;
      p.ad = p.baseAd + adBonus;
      p.as = p.baseAs * (1 + asBonus);
    }
  }

  updatePlayerMovements() {
    for (const p of Object.values(this.players)) {
      if (!p.isAlive || p.isStunned || p.isRooted) continue;

      const dx = p.targetX - p.x;
      const dy = p.targetY - p.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 4) {
        const step = Math.min(dist, p.moveSpeed * DT);
        const safeDist = dist > 0.001 ? dist : 1;
        const nx = p.x + (dx / safeDist) * step;
        const ny = p.y + (dy / safeDist) * step;

        p.angle = Math.atan2(dy, dx);
        this.resolvePlayerMovement(p, nx, ny);
      } else {
        p.vx = 0;
        p.vy = 0;
      }
    }
  }

  resolvePlayerMovement(p, nx, ny) {
    if (isNaN(nx) || isNaN(ny)) {
      return;
    }

    // 1. Arena Boundaries
    nx = Math.max(p.radius, Math.min(MAP_WIDTH - p.radius, nx));
    ny = Math.max(p.radius, Math.min(MAP_HEIGHT - p.radius, ny));

    // 2. Obstacles Collision (Circles and Boxes)
    for (const obs of this.map.obstacles) {
      if (obs.type === 'circle') {
        const odx = nx - obs.x;
        const ody = ny - obs.y;
        const odist = Math.hypot(odx, ody);
        const minDist = obs.radius + p.radius;
        if (odist < minDist) {
          const push = minDist - odist;
          const safeDist = odist > 0.001 ? odist : 1;
          const dirX = odist > 0.001 ? (odx / safeDist) : 1;
          const dirY = odist > 0.001 ? (ody / safeDist) : 0;
          nx += dirX * push;
          ny += dirY * push;
        }
      } else if (obs.type === 'box') {
        // AABB pushback
        const closestX = Math.max(obs.x, Math.min(nx, obs.x + obs.width));
        const closestY = Math.max(obs.y, Math.min(ny, obs.y + obs.height));
        const bdx = nx - closestX;
        const bdy = ny - closestY;
        const bdist = Math.hypot(bdx, bdy);
        if (bdist < p.radius) {
          if (bdist === 0) {
            nx = obs.x - p.radius;
          } else {
            nx = closestX + (bdx / bdist) * p.radius;
            ny = closestY + (bdy / bdist) * p.radius;
          }
        }
      }
    }

    // 3. Structure collision
    for (const s of Object.values(this.structures)) {
      if (!s.isAlive) continue;
      const sdx = nx - s.x;
      const sdy = ny - s.y;
      const sdist = Math.hypot(sdx, sdy);
      const minDist = s.radius + p.radius;
      if (sdist < minDist) {
        const safeDist = sdist > 0.001 ? sdist : 1;
        const dirX = sdist > 0.001 ? (sdx / safeDist) : 1;
        const dirY = sdist > 0.001 ? (sdy / safeDist) : 0;
        nx = s.x + dirX * minDist;
        ny = s.y + dirY * minDist;
      }
    }

    if (!isNaN(nx) && !isNaN(ny)) {
      p.x = nx;
      p.y = ny;
    }
  }

  updateTurrets() {
    for (const [turretKey, turret] of Object.entries(this.structures)) {
      if (turret.type !== 'turret' || !turret.isAlive) continue;

      if (turret.attackCooldown > 0) {
        turret.attackCooldown -= DT;
        continue;
      }

      // Find closest enemy player in range
      let closestEnemy = null;
      let closestDist = turret.range;

      for (const p of Object.values(this.players)) {
        if (!p.isAlive || p.team === turret.team || p.stealth) continue;
        const dist = Math.hypot(p.x - turret.x, p.y - turret.y);
        if (dist <= closestDist) {
          closestDist = dist;
          closestEnemy = p;
        }
      }

      if (closestEnemy) {
        turret.attackCooldown = turret.attackInterval;
        // Fire turret missile
        this.spawnProjectile({
          ownerId: turret.id,
          team: turret.team,
          type: 'turret_bullet',
          x: turret.x,
          y: turret.y,
          targetId: closestEnemy.id,
          speed: 650,
          radius: 12,
          damage: turret.damage,
          rangeRemaining: 500,
          color: turret.team === 'blue' ? '#38ada9' : '#e55039'
        });
      }
    }
  }

  updateAutoAttacks() {
    for (const p of Object.values(this.players)) {
      if (!p.isAlive || p.isStunned) continue;

      // Auto-target acquisition if idle or in attack-move mode
      if (!p.targetEnemyId && !p.stealth) {
        const isIdle = Math.hypot(p.targetX - p.x, p.targetY - p.y) < 10;
        if (isIdle || p.isAttackMove) {
          let nearestEnemy = null;
          let nearestDist = p.attackRange + 30;
          for (const ep of Object.values(this.players)) {
            if (!ep.isAlive || ep.team === p.team || ep.stealth) continue;
            const ed = Math.hypot(ep.x - p.x, ep.y - p.y);
            if (ed <= nearestDist) {
              nearestDist = ed;
              nearestEnemy = ep;
            }
          }
          if (!nearestEnemy) {
            for (const s of Object.values(this.structures)) {
              if (!s.isAlive || s.team === p.team) continue;
              const sd = Math.hypot(s.x - p.x, s.y - p.y);
              if (sd <= nearestDist) {
                nearestDist = sd;
                nearestEnemy = s;
              }
            }
          }
          if (nearestEnemy) {
            p.targetEnemyId = nearestEnemy.id;
            p.isAttackMove = false;
          }
        }
      }

      if (!p.targetEnemyId) continue;

      const target = this.players[p.targetEnemyId] || this.structures[p.targetEnemyId];
      if (!target || !target.isAlive || target.team === p.team) {
        p.targetEnemyId = null;
        continue;
      }

      const dist = Math.hypot(target.x - p.x, target.y - p.y);
      const attackRangeThreshold = p.attackRange + (target.radius || 20);

      if (dist > attackRangeThreshold) {
        // Target is out of range: chase enemy until in attack range!
        p.targetX = target.x;
        p.targetY = target.y;
      } else {
        // Within attack range: halt movement and perform attack
        p.targetX = p.x;
        p.targetY = p.y;
        p.vx = 0;
        p.vy = 0;
        p.angle = Math.atan2(target.y - p.y, target.x - p.x);

        if (p.autoAttackCooldown <= 0) {
          p.autoAttackCooldown = 1 / p.as;

          // Broadcast attack event for animations & sounds
          this.eventsQueue.push({
            type: 'attack',
            attackerId: p.id,
            targetId: target.id,
            isRanged: p.attackRange > 150,
            x: p.x,
            y: p.y
          });

          if (p.attackRange <= 150) {
            // Melee instant strike
            this.executeBasicAttack(p, target);
          } else {
            // Ranged projectile
            this.spawnProjectile({
              ownerId: p.id,
              team: p.team,
              type: 'basic_attack',
              x: p.x,
              y: p.y,
              targetId: target.id,
              speed: 780,
              radius: 9,
              damage: p.ad,
              rangeRemaining: p.attackRange + 120,
              color: p.color
            });
          }
        }
      }
    }
  }

  executeBasicAttack(attacker, target) {
    let rawDamage = attacker.ad;
    let isCrit = false;

    // Sniper Passive: bonus crit damage at range
    if (attacker.championId === 'sniper') {
      const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
      if (dist >= 300) {
        rawDamage *= 1.4;
        isCrit = true;
      }
    }

    // Shadow Assassin Passive: Health-based scaling
    if (attacker.championId === 'shadow_assassin' && target.maxHp) {
      if (target.hp / target.maxHp >= 0.5) {
        rawDamage += target.hp * 0.06;
      } else {
        rawDamage += (target.maxHp - target.hp) * 0.10;
        isCrit = true;
      }
    }

    // Blademaster Passive: Every 3rd hit deals bonus true damage
    if (attacker.championId === 'blademaster') {
      attacker.passiveCount = (attacker.passiveCount || 0) + 1;
      if (attacker.passiveCount >= 3) {
        attacker.passiveCount = 0;
        rawDamage += attacker.ad * 0.5;
        isCrit = true;
        attacker.statusEffects.push({ type: 'SPEED', duration: 1.5, value: 0.20 });
      }
    }

    // Shadow Hunter W Passive: 3-stack true damage
    if (attacker.championId === 'shadow_hunter') {
      attacker.passiveCount = (attacker.passiveCount || 0) + 1;
      if (attacker.passiveCount >= 3) {
        attacker.passiveCount = 0;
        const bonusTrue = (target.maxHp || 1000) * 0.09;
        this.applyDamage(attacker.id, target, bonusTrue, 'true', true);
      }
    }

    // Berserker W Lifesteal
    const wBuff = attacker.statusEffects.find(e => e.type === 'AS_BUFF');
    if (wBuff && attacker.championId === 'berserker') {
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + rawDamage * 0.25);
    }

    this.applyDamage(attacker.id, target, rawDamage, 'physical', isCrit);

    // Unstealth upon attack
    if (attacker.stealth) {
      attacker.stealth = false;
      attacker.statusEffects = attacker.statusEffects.filter(e => e.type !== 'STEALTH');
    }
  }

  updateProjectiles() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];

      // Homing target (turret missile, ranged auto attack)
      if (proj.targetId) {
        const target = this.players[proj.targetId] || this.structures[proj.targetId];
        if (!target || !target.isAlive) {
          this.projectiles.splice(i, 1);
          continue;
        }

        const dx = target.x - proj.x;
        const dy = target.y - proj.y;
        const dist = Math.hypot(dx, dy);

        if (dist < proj.radius + (target.radius || 20)) {
          // Hit target!
          this.applyDamage(proj.ownerId, target, proj.damage, 'physical', false);
          this.projectiles.splice(i, 1);
          continue;
        }

        const step = proj.speed * DT;
        proj.x += (dx / dist) * step;
        proj.y += (dy / dist) * step;
      } else {
        // Skillshot straight line
        const step = proj.speed * DT;
        proj.x += proj.vx * step;
        proj.y += proj.vy * step;
        proj.rangeRemaining -= step;

        // Collision check against enemy champions
        let hit = false;
        for (const p of Object.values(this.players)) {
          if (!p.isAlive || p.team === proj.team) continue;
          const dist = Math.hypot(p.x - proj.x, p.y - proj.y);
          if (dist < proj.radius + p.radius) {
            this.handleSkillshotHit(proj, p);
            hit = true;
            if (!proj.piercing) break;
          }
        }

        // Structure collision for skillshots
        if (!hit && !proj.piercing) {
          for (const s of Object.values(this.structures)) {
            if (!s.isAlive || s.team === proj.team) continue;
            const dist = Math.hypot(s.x - proj.x, s.y - proj.y);
            if (dist < proj.radius + s.radius) {
              this.applyDamage(proj.ownerId, s, proj.damage, 'magic', false);
              hit = true;
              break;
            }
          }
        }

        if (hit && !proj.piercing) {
          this.projectiles.splice(i, 1);
          continue;
        }

        // Expiration or out of map
        if (proj.rangeRemaining <= 0 || proj.x < 0 || proj.x > MAP_WIDTH || proj.y < 0 || proj.y > MAP_HEIGHT) {
          if (proj.type === 'bouncing_bomb') {
            // Explode on landing!
            this.createAoeBlast(proj.ownerId, proj.team, proj.x, proj.y, 160, proj.damage, null);
          }
          this.projectiles.splice(i, 1);
        }
      }
    }
  }

  handleSkillshotHit(proj, victim) {
    const owner = this.players[proj.ownerId];

    // Calculate damage
    let finalDmg = proj.damage;
    if (proj.type === 'sniper_r') {
      // Missing HP amplifier
      const missingPct = (victim.maxHp - victim.hp) / victim.maxHp;
      finalDmg *= (1 + missingPct * 0.8);
    }

    this.applyDamage(proj.ownerId, victim, finalDmg, proj.dmgType || 'magic', false);

    // Apply projectile-specific CC/Effects
    if (proj.type === 'frost_q') {
      victim.statusEffects.push({ type: 'SLOW', duration: 2.0, value: 0.35 });
      this.addFrostStack(victim, proj.ownerId);
    } else if (proj.type === 'berserker_q') {
      victim.statusEffects.push({ type: 'SLOW', duration: 2.0, value: 0.40 });
    } else if (proj.type === 'pyro_q') {
      // Explosive AoE on fireball hit
      this.createAoeBlast(proj.ownerId, proj.team, victim.x, victim.y, 140, proj.damage * 0.5, null);
      this.applyPyromancerPassive(victim, proj.ownerId);
    }
  }

  updateAoeZones() {
    for (let i = this.aoeZones.length - 1; i >= 0; i--) {
      const zone = this.aoeZones[i];

      if (zone.delayRemaining > 0) {
        zone.delayRemaining -= DT;
        if (zone.delayRemaining <= 0) {
          // Delayed burst triggers!
          this.triggerAoeZone(zone);
          if (zone.durationRemaining <= 0) {
            this.aoeZones.splice(i, 1);
            continue;
          }
        }
      } else if (zone.durationRemaining > 0) {
        zone.durationRemaining -= DT;
        // Persistent area tick (Glacial Path, Trap, Minefield)
        this.tickPersistentZone(zone);

        if (zone.durationRemaining <= 0) {
          this.aoeZones.splice(i, 1);
        }
      }
    }
  }

  triggerAoeZone(zone) {
    // E.g. Pyro W (Pillar of Flame), Pyro R (Meteor), Guardian R, Demolitionist R
    for (const p of Object.values(this.players)) {
      if (!p.isAlive || p.team === zone.team) continue;
      const dist = Math.hypot(p.x - zone.x, p.y - zone.y);
      if (dist <= zone.radius + p.radius) {
        this.applyDamage(zone.ownerId, p, zone.damage, 'magic', false);

        if (zone.type === 'meteor') {
          p.statusEffects.push({ type: 'STUN', duration: zone.stunDuration || 1.0 });
          this.eventsQueue.push({ type: 'status', status: 'STUN', targetId: p.id, x: p.x, y: p.y });
          this.applyPyromancerPassive(p, zone.ownerId);
        } else if (zone.type === 'earthquake') {
          p.statusEffects.push({ type: 'AIRBORNE', duration: zone.airborneDuration || 1.4 });
          this.eventsQueue.push({ type: 'status', status: 'AIRBORNE', targetId: p.id, x: p.x, y: p.y });
        } else if (zone.type === 'pillar_flame') {
          this.applyPyromancerPassive(p, zone.ownerId);
        }
      }
    }
  }

  tickPersistentZone(zone) {
    if (zone.type === 'glacial_path') {
      for (const p of Object.values(this.players)) {
        if (!p.isAlive) continue;
        const dist = Math.hypot(p.x - zone.x, p.y - zone.y);
        if (dist <= zone.radius + p.radius) {
          if (p.team !== zone.team) {
            p.statusEffects.push({ type: 'SLOW', duration: 0.3, value: 0.55 });
            this.applyDamage(zone.ownerId, p, zone.dps * DT, 'magic', false);
          } else {
            p.statusEffects.push({ type: 'SPEED', duration: 0.3, value: 0.20 });
          }
        }
      }
    } else if (zone.type === 'trap') {
      for (const p of Object.values(this.players)) {
        if (!p.isAlive || p.team === zone.team) continue;
        const dist = Math.hypot(p.x - zone.x, p.y - zone.y);
        if (dist <= zone.radius + p.radius) {
          // Trap triggered!
          p.statusEffects.push({ type: 'ROOT', duration: zone.rootDuration || 1.5 });
          this.applyDamage(zone.ownerId, p, zone.damage, 'physical', false);
          this.eventsQueue.push({ type: 'status', status: 'ROOT', targetId: p.id, x: p.x, y: p.y });
          zone.durationRemaining = 0; // consumed
          break;
        }
      }
    } else if (zone.type === 'minefield') {
      for (const p of Object.values(this.players)) {
        if (!p.isAlive || p.team === zone.team) continue;
        const dist = Math.hypot(p.x - zone.x, p.y - zone.y);
        if (dist <= zone.radius + p.radius) {
          p.statusEffects.push({ type: 'SLOW', duration: 1.5, value: 0.40 });
          this.applyDamage(zone.ownerId, p, zone.damagePerMine || 45, 'magic', false);
          this.eventsQueue.push({ type: 'status', status: 'SLOW', targetId: p.id, x: p.x, y: p.y });
          zone.durationRemaining = 0;
          break;
        }
      }
    }
  }

  createAoeBlast(ownerId, team, x, y, radius, damage, ccType, ccDuration) {
    for (const p of Object.values(this.players)) {
      if (!p.isAlive || p.team === team) continue;
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist <= radius + p.radius) {
        if (damage) this.applyDamage(ownerId, p, damage, 'magic', false);
        if (ccType) {
          p.statusEffects.push({ type: ccType, duration: ccDuration || 1.0 });
          this.eventsQueue.push({ type: 'status', status: ccType, targetId: p.id, x: p.x, y: p.y });
        }
      }
    }
    this.eventsQueue.push({ type: 'aoe_blast', x, y, radius, team });
  }

  applyDamage(attackerId, target, rawAmount, type, isCrit) {
    if (!target || !target.isAlive || target.isImmune) return;

    // Berserker Ragnarok Check: Cannot die below 1 HP
    const isUndying = target.statusEffects && target.statusEffects.some(e => e.type === 'IMMUNE' || e.type === 'UNDYING');

    // Armor / MR Reduction
    let finalAmount = rawAmount;
    if (type === 'physical') {
      const arm = Math.max(0, target.armor || 25);
      finalAmount = rawAmount * (100 / (100 + arm));
    } else if (type === 'magic') {
      const res = Math.max(0, target.mr || 25);
      finalAmount = rawAmount * (100 / (100 + res));
    }

    // Guardian W Iron Defense reduction
    if (target.statusEffects) {
      const ironDef = target.statusEffects.find(e => e.type === 'DEFENSE_UP');
      if (ironDef) {
        finalAmount *= (1 - (ironDef.value || 0.45));
      }
    }

    // Shield absorption
    if (target.shield && target.shield > 0) {
      if (target.shield >= finalAmount) {
        target.shield -= finalAmount;
        finalAmount = 0;
      } else {
        finalAmount -= target.shield;
        target.shield = 0;
      }
    }

    if (finalAmount > 0) {
      if (isUndying && target.hp - finalAmount <= 1) {
        target.hp = 1;
      } else {
        target.hp = Math.max(0, target.hp - finalAmount);
      }
    }

    // Emit damage event
    this.eventsQueue.push({
      type: 'damage',
      targetId: target.id,
      amount: Math.round(finalAmount),
      isCrit: !!isCrit,
      x: target.x,
      y: target.y
    });

    // Guardian Passive Check: HP <= 35% shield proc
    if (target.championId === 'guardian' && target.isAlive && target.hp <= target.maxHp * 0.35 && !target.guardianShieldOnCd) {
      target.guardianShieldOnCd = true;
      const shieldVal = target.maxHp * 0.25;
      target.shield = (target.shield || 0) + shieldVal;
      target.statusEffects.push({ type: 'SHIELD', duration: 4.0, value: shieldVal });
      setTimeout(() => { if (target) target.guardianShieldOnCd = false; }, 60000);
    }

    // Target Death Check
    if (target.hp <= 0 && target.isAlive) {
      this.handleDeath(attackerId, target);
    }
  }

  handleDeath(killerId, victim) {
    if (!victim) return;
    victim.isAlive = false;
    victim.hp = 0;

    const killer = this.players[killerId];

    if (victim.type === 'nexus') {
      // GAME OVER!
      const winningTeam = victim.team === 'blue' ? 'red' : 'blue';
      this.room.endGame(winningTeam, `${winningTeam === 'blue' ? '블루 팀' : '레드 팀'}이 상대 넥서스를 파괴하여 승리했습니다!`);
      return;
    }

    if (victim.type === 'turret') {
      this.eventsQueue.push({
        type: 'kill',
        killerName: killer ? killer.nickname : '미니언/포탑',
        victimName: victim.name,
        killerTeam: killer ? killer.team : 'neutral',
        victimTeam: victim.team
      });
      return;
    }

    // Player Death
    victim.deaths++;
    victim.respawnTimer = 7.0; // 7s respawn

    if (killer) {
      killer.kills++;
      this.scores[killer.team]++;
    }

    // Demolitionist Passive: Last Laugh (Bomb drop on death)
    if (victim.championId === 'demolitionist') {
      setTimeout(() => {
        if (victim && this.timerHandle) {
          this.createAoeBlast(victim.id, victim.team, victim.x, victim.y, 220, 260, null);
        }
      }, 1500);
    }

    this.eventsQueue.push({
      type: 'kill',
      killerName: killer ? killer.nickname : '포탑',
      victimName: victim.nickname,
      killerTeam: killer ? killer.team : 'neutral',
      victimTeam: victim.team
    });
  }

  respawnPlayer(p) {
    if (!p) return;
    p.isAlive = true;
    p.hp = p.maxHp;
    p.mp = p.maxMp;
    p.statusEffects = [];
    const base = this.map.bases[p.team];
    p.x = base.spawnX;
    p.y = base.spawnY;
    p.targetX = base.spawnX;
    p.targetY = base.spawnY;
  }

  applyPyromancerPassive(target, sourceId) {
    if (!target || !target.statusEffects) return;
    target.statusEffects.push({
      type: 'DOT',
      duration: 3.0,
      dps: 25,
      sourcePlayerId: sourceId
    });
  }

  addFrostStack(target, sourceId) {
    if (!target || !target.statusEffects) return;
    target.frostStacks = (target.frostStacks || 0) + 1;
    if (target.frostStacks >= 3) {
      target.frostStacks = 0;
      target.statusEffects.push({ type: 'STUN', duration: 1.2 });
      this.eventsQueue.push({ type: 'status', status: 'FROZEN', targetId: target.id, x: target.x, y: target.y });
    }
  }

  spawnProjectile(config) {
    this.projectiles.push({
      id: `proj_${this.nextEntityId++}`,
      ...config
    });
  }

  // Handle Client Commands
  handleMoveInput(socketId, targetX, targetY) {
    const p = this.players[socketId];
    if (!p || !p.isAlive || p.isStunned || p.isRooted) return;
    p.targetX = Math.max(20, Math.min(MAP_WIDTH - 20, targetX));
    p.targetY = Math.max(20, Math.min(MAP_HEIGHT - 20, targetY));
    p.targetEnemyId = null; // moving clears auto-attack target unless targeted click
    p.isAttackMove = false;
  }

  handleAttackTarget(socketId, targetId) {
    const p = this.players[socketId];
    if (!p || !p.isAlive || p.isStunned) return;
    p.targetEnemyId = targetId;
    p.isAttackMove = false;

    // If out of range, immediately set target coordinates towards enemy
    const target = this.players[targetId] || this.structures[targetId];
    if (target) {
      const dist = Math.hypot(target.x - p.x, target.y - p.y);
      if (dist > p.attackRange + (target.radius || 20)) {
        p.targetX = target.x;
        p.targetY = target.y;
      }
    }
  }

  handleAttackMove(socketId, targetX, targetY) {
    const p = this.players[socketId];
    if (!p || !p.isAlive || p.isStunned || p.isRooted) return;

    // Check if an enemy is close to the clicked point or player
    let closestEnemy = null;
    let closestDist = 200; // click tolerance

    for (const ep of Object.values(this.players)) {
      if (!ep.isAlive || ep.team === p.team || ep.stealth) continue;
      const dClick = Math.hypot(ep.x - targetX, ep.y - targetY);
      if (dClick < closestDist) {
        closestDist = dClick;
        closestEnemy = ep;
      }
    }
    if (!closestEnemy) {
      for (const s of Object.values(this.structures)) {
        if (!s.isAlive || s.team === p.team) continue;
        const dClick = Math.hypot(s.x - targetX, s.y - targetY);
        if (dClick < closestDist) {
          closestDist = dClick;
          closestEnemy = s;
        }
      }
    }

    if (closestEnemy) {
      this.handleAttackTarget(socketId, closestEnemy.id);
    } else {
      p.targetX = Math.max(20, Math.min(MAP_WIDTH - 20, targetX));
      p.targetY = Math.max(20, Math.min(MAP_HEIGHT - 20, targetY));
      p.targetEnemyId = null;
      p.isAttackMove = true;
    }
  }

  handleStop(socketId) {
    const p = this.players[socketId];
    if (!p || !p.isAlive) return;
    p.targetX = p.x;
    p.targetY = p.y;
    p.vx = 0;
    p.vy = 0;
    p.targetEnemyId = null;
    p.isAttackMove = false;
  }

  handleCastSkill(socketId, skillKey, targetX, targetY) {
    const p = this.players[socketId];
    if (!p || !p.isAlive || p.isStunned) return;

    const champData = CHAMPIONS[p.championId];
    if (!champData || !champData.skills[skillKey]) return;

    const skill = champData.skills[skillKey];

    // Check cooldown & mana
    if (p.cooldowns[skillKey] > 0 || p.mp < skill.mana) return;

    // Deduct mana & apply cooldown
    p.mp -= skill.mana;
    p.cooldowns[skillKey] = skill.cooldown;

    // Execute skill logic by champion and key
    this.executeSkill(p, skillKey, skill, targetX, targetY);
  }

  handleCastSpell(socketId, slot, targetX, targetY) {
    const p = this.players[socketId];
    if (!p || !p.isAlive || p.isStunned) return;

    const spellKey = slot === 'D' ? p.spellD : p.spellF;
    const spellData = SUMMONER_SPELLS[spellKey];
    if (!spellData || p.cooldowns[slot] > 0) return;

    p.cooldowns[slot] = spellData.cooldown;

    if (spellData.type === 'teleport') {
      // Flash: Instant teleport toward target up to range
      const dx = (typeof targetX === 'number' && !isNaN(targetX) ? targetX : p.x + 100) - p.x;
      const dy = (typeof targetY === 'number' && !isNaN(targetY) ? targetY : p.y) - p.y;
      const dist = Math.hypot(dx, dy);
      const safeDist = dist > 0.001 ? dist : 1;
      const flashDist = Math.min(dist, spellData.range);
      const nx = p.x + (dist > 0.001 ? (dx / safeDist) * flashDist : spellData.range);
      const ny = p.y + (dist > 0.001 ? (dy / safeDist) * flashDist : 0);
      this.resolvePlayerMovement(p, nx, ny);
      p.targetX = p.x;
      p.targetY = p.y;
      this.eventsQueue.push({ type: 'flash', x: p.x, y: p.y });
    } else if (spellData.type === 'target_dot') {
      // Ignite: find closest enemy champion near target
      let bestEnemy = null;
      let minDist = 300;
      for (const ep of Object.values(this.players)) {
        if (!ep.isAlive || ep.team === p.team) continue;
        const d = Math.hypot(ep.x - targetX, ep.y - targetY);
        if (d < minDist) {
          minDist = d;
          bestEnemy = ep;
        }
      }
      if (bestEnemy) {
        bestEnemy.statusEffects.push({
          type: 'DOT',
          duration: spellData.duration,
          dps: spellData.totalDamage / spellData.duration,
          sourcePlayerId: p.id
        });
        this.eventsQueue.push({ type: 'status', status: 'IGNITE', targetId: bestEnemy.id, x: bestEnemy.x, y: bestEnemy.y });
      }
    } else if (spellData.type === 'self_heal') {
      // Heal: heals self & speed buff
      p.hp = Math.min(p.maxHp, p.hp + spellData.healAmount);
      p.statusEffects.push({ type: 'SPEED', duration: spellData.duration, value: spellData.speedBonus });
      this.eventsQueue.push({ type: 'heal', targetId: p.id, amount: spellData.healAmount, x: p.x, y: p.y });
    }
  }

  executeSkill(p, key, skill, tx, ty) {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist;
    const dirY = dy / dist;

    // 1. BLADEMASTER (검객)
    if (p.championId === 'blademaster') {
      if (key === 'Q') {
        // Dash slash
        const dashStep = Math.min(dist, skill.range);
        const nx = p.x + dirX * dashStep;
        const ny = p.y + dirY * dashStep;
        this.resolvePlayerMovement(p, nx, ny);
        p.targetX = p.x;
        p.targetY = p.y;
        this.createAoeBlast(p.id, p.team, p.x, p.y, 140, skill.damage, null);
      } else if (key === 'W') {
        // Whirlwind
        this.createAoeBlast(p.id, p.team, p.x, p.y, skill.radius, skill.damage, null);
      } else if (key === 'E') {
        // Shield + Speed
        p.shield = (p.shield || 0) + skill.shieldAmount;
        p.statusEffects.push({ type: 'SHIELD', duration: skill.duration, value: skill.shieldAmount });
        p.statusEffects.push({ type: 'SPEED', duration: skill.duration, value: skill.speedBonus });
      } else if (key === 'R') {
        // Omnislash airborne
        const jumpDist = Math.min(dist, skill.range);
        p.x += dirX * jumpDist;
        p.y += dirY * jumpDist;
        p.targetX = p.x;
        p.targetY = p.y;
        this.createAoeBlast(p.id, p.team, p.x, p.y, skill.radius, skill.damage, 'AIRBORNE', skill.airborneDuration);
      }
    }

    // 2. SNIPER (저격수)
    else if (p.championId === 'sniper') {
      if (key === 'Q') {
        // Piercing shot
        this.spawnProjectile({
          ownerId: p.id,
          team: p.team,
          type: 'sniper_q',
          x: p.x,
          y: p.y,
          vx: dirX,
          vy: dirY,
          speed: skill.speed,
          radius: skill.radius,
          damage: skill.damage,
          rangeRemaining: skill.range,
          piercing: true,
          color: '#ff9f43'
        });
      } else if (key === 'W') {
        // Trap
        this.aoeZones.push({
          id: `trap_${this.nextEntityId++}`,
          ownerId: p.id,
          team: p.team,
          type: 'trap',
          x: tx,
          y: ty,
          radius: skill.radius,
          damage: skill.damage,
          rootDuration: skill.rootDuration,
          durationRemaining: 40.0
        });
      } else if (key === 'E') {
        // Tumble back (opposite to mouse)
        const nx = p.x - dirX * skill.distance;
        const ny = p.y - dirY * skill.distance;
        this.resolvePlayerMovement(p, nx, ny);
        p.targetX = p.x;
        p.targetY = p.y;
        p.statusEffects.push({ type: 'AD_BUFF', duration: 3.0, value: skill.empoweredDamage });
      } else if (key === 'R') {
        // Ultimate Snipe
        this.spawnProjectile({
          ownerId: p.id,
          team: p.team,
          type: 'sniper_r',
          x: p.x,
          y: p.y,
          vx: dirX,
          vy: dirY,
          speed: skill.speed,
          radius: skill.radius,
          damage: skill.damage,
          rangeRemaining: skill.range,
          piercing: false,
          color: '#ee5253'
        });
      }
    }

    // 3. PYROMANCER (화염술사)
    else if (p.championId === 'pyromancer') {
      if (key === 'Q') {
        // Fireball
        this.spawnProjectile({
          ownerId: p.id,
          team: p.team,
          type: 'pyro_q',
          x: p.x,
          y: p.y,
          vx: dirX,
          vy: dirY,
          speed: skill.speed,
          radius: skill.radius,
          damage: skill.damage,
          rangeRemaining: skill.range,
          color: '#ff5252'
        });
      } else if (key === 'W') {
        // Pillar of flame (delay)
        this.aoeZones.push({
          id: `pyro_w_${this.nextEntityId++}`,
          ownerId: p.id,
          team: p.team,
          type: 'pillar_flame',
          x: tx,
          y: ty,
          radius: skill.radius,
          damage: skill.damage,
          delayRemaining: skill.delay,
          durationRemaining: 0
        });
      } else if (key === 'E') {
        // Blast wave knockback
        for (const ep of Object.values(this.players)) {
          if (!ep.isAlive || ep.team === p.team) continue;
          const edist = Math.hypot(ep.x - p.x, ep.y - p.y);
          if (edist <= skill.radius) {
            const pushDirX = (ep.x - p.x) / (edist || 1);
            const pushDirY = (ep.y - p.y) / (edist || 1);
            ep.x += pushDirX * skill.knockbackDist;
            ep.y += pushDirY * skill.knockbackDist;
            this.applyDamage(p.id, ep, skill.damage, 'magic', false);
            this.applyPyromancerPassive(ep, p.id);
          }
        }
      } else if (key === 'R') {
        // Meteor Strike
        this.aoeZones.push({
          id: `meteor_${this.nextEntityId++}`,
          ownerId: p.id,
          team: p.team,
          type: 'meteor',
          x: tx,
          y: ty,
          radius: skill.radius,
          damage: skill.damage,
          delayRemaining: skill.delay,
          stunDuration: skill.stunDuration,
          durationRemaining: 0
        });
      }
    }

    // 4. SHADOW ASSASSIN (암살자)
    else if (p.championId === 'shadow_assassin') {
      if (key === 'Q') {
        // Shuriken
        this.spawnProjectile({
          ownerId: p.id,
          team: p.team,
          type: 'shuriken',
          x: p.x,
          y: p.y,
          vx: dirX,
          vy: dirY,
          speed: skill.speed,
          radius: skill.radius,
          damage: skill.damage,
          rangeRemaining: skill.range,
          color: '#5f27cd'
        });
      } else if (key === 'W') {
        // Shadow Cloak
        p.statusEffects.push({ type: 'STEALTH', duration: skill.stealthDuration });
        p.statusEffects.push({ type: 'SPEED', duration: skill.stealthDuration, value: skill.speedBonus });
      } else if (key === 'E') {
        // Shadow Step Blink
        const blinkDist = Math.min(dist, skill.range);
        p.x += dirX * blinkDist;
        p.y += dirY * blinkDist;
        p.targetX = p.x;
        p.targetY = p.y;
        this.createAoeBlast(p.id, p.team, p.x, p.y, 130, skill.damage, null);
      } else if (key === 'R') {
        // Death Mark
        let bestTarget = null;
        for (const ep of Object.values(this.players)) {
          if (!ep.isAlive || ep.team === p.team) continue;
          const d = Math.hypot(ep.x - tx, ep.y - ty);
          if (d <= skill.range) { bestTarget = ep; break; }
        }
        if (bestTarget) {
          p.x = bestTarget.x - dirX * 50;
          p.y = bestTarget.y - dirY * 50;
          this.applyDamage(p.id, bestTarget, skill.initialDamage, 'physical', true);
          setTimeout(() => {
            if (bestTarget && bestTarget.isAlive) {
              this.applyDamage(p.id, bestTarget, skill.initialDamage * 0.8, 'physical', true);
            }
          }, skill.delay * 1000);
        }
      }
    }

    // 5. GUARDIAN (수호자)
    else if (p.championId === 'guardian') {
      if (key === 'Q') {
        // Shield Bash Dash
        const dashDist = Math.min(dist, skill.range);
        p.x += dirX * dashDist;
        p.y += dirY * dashDist;
        p.targetX = p.x;
        p.targetY = p.y;
        this.createAoeBlast(p.id, p.team, p.x, p.y, 150, skill.damage, 'STUN', skill.stunDuration);
      } else if (key === 'W') {
        // Iron Defense
        p.statusEffects.push({ type: 'DEFENSE_UP', duration: skill.duration, value: skill.damageReduction });
      } else if (key === 'E') {
        // Roar of Challenge (Taunt + Slow)
        this.createAoeBlast(p.id, p.team, p.x, p.y, skill.radius, skill.damage, 'SLOW', skill.duration);
      } else if (key === 'R') {
        // Earthquake Shockwave
        this.aoeZones.push({
          id: `earthquake_${this.nextEntityId++}`,
          ownerId: p.id,
          team: p.team,
          type: 'earthquake',
          x: tx,
          y: ty,
          radius: skill.radius,
          damage: skill.damage,
          delayRemaining: 0.2,
          airborneDuration: skill.airborneDuration,
          durationRemaining: 0
        });
      }
    }

    // 6. FROST MAGE (빙결술사)
    else if (p.championId === 'frost_mage') {
      if (key === 'Q') {
        // Ice Shard
        this.spawnProjectile({
          ownerId: p.id,
          team: p.team,
          type: 'frost_q',
          x: p.x,
          y: p.y,
          vx: dirX,
          vy: dirY,
          speed: skill.speed,
          radius: skill.radius,
          damage: skill.damage,
          rangeRemaining: skill.range,
          color: '#0abde3'
        });
      } else if (key === 'W') {
        // Glacial Path
        this.aoeZones.push({
          id: `glacial_${this.nextEntityId++}`,
          ownerId: p.id,
          team: p.team,
          type: 'glacial_path',
          x: tx,
          y: ty,
          radius: skill.radius,
          dps: skill.dps,
          durationRemaining: skill.duration,
          delayRemaining: 0
        });
      } else if (key === 'E') {
        // Frost Shield
        p.shield = (p.shield || 0) + skill.shieldAmount;
        p.statusEffects.push({ type: 'SHIELD', duration: skill.duration, value: skill.shieldAmount });
      } else if (key === 'R') {
        // Absolute Zero
        this.createAoeBlast(p.id, p.team, p.x, p.y, skill.radius, skill.damage, 'STUN', skill.freezeDuration);
      }
    }

    // 7. BERSERKER (광전사)
    else if (p.championId === 'berserker') {
      if (key === 'Q') {
        // Undertow Axe
        this.spawnProjectile({
          ownerId: p.id,
          team: p.team,
          type: 'berserker_q',
          x: p.x,
          y: p.y,
          vx: dirX,
          vy: dirY,
          speed: skill.speed,
          radius: skill.radius,
          damage: skill.damage,
          rangeRemaining: skill.range,
          color: '#c0392b'
        });
      } else if (key === 'W') {
        // Frenzy Rage
        p.statusEffects.push({ type: 'AS_BUFF', duration: skill.duration, value: skill.asBonus });
      } else if (key === 'E') {
        // Reckless Swing (True damage + self damage)
        p.hp = Math.max(1, p.hp - skill.selfDamage);
        this.createAoeBlast(p.id, p.team, p.x, p.y, skill.range, skill.trueDamage, null);
      } else if (key === 'R') {
        // Ragnarok Undying
        p.statusEffects.push({ type: 'UNDYING', duration: skill.duration });
        p.statusEffects.push({ type: 'SPEED', duration: skill.duration, value: skill.speedBonus });
      }
    }

    // 8. SHADOW HUNTER (그림자 사냥꾼)
    else if (p.championId === 'shadow_hunter') {
      if (key === 'Q') {
        // Tumble
        const nx = p.x + dirX * skill.distance;
        const ny = p.y + dirY * skill.distance;
        this.resolvePlayerMovement(p, nx, ny);
        p.targetX = p.x;
        p.targetY = p.y;
        p.statusEffects.push({ type: 'AD_BUFF', duration: 3.0, value: skill.bonusDamage });
        const hasR = p.statusEffects.find(e => e.type === 'FINAL_HOUR');
        if (hasR) p.statusEffects.push({ type: 'STEALTH', duration: 1.0 });
      } else if (key === 'W') {
        // Passive skill
      } else if (key === 'E') {
        // Condemn knockback
        for (const ep of Object.values(this.players)) {
          if (!ep.isAlive || ep.team === p.team) continue;
          const edist = Math.hypot(ep.x - p.x, ep.y - p.y);
          if (edist <= skill.range) {
            const pushX = ep.x + dirX * skill.knockbackDist;
            const pushY = ep.y + dirY * skill.knockbackDist;
            ep.x = pushX;
            ep.y = pushY;
            this.applyDamage(p.id, ep, skill.damage, 'physical', false);
            break;
          }
        }
      } else if (key === 'R') {
        // Final Hour
        p.statusEffects.push({ type: 'FINAL_HOUR', duration: skill.duration });
        p.statusEffects.push({ type: 'AD_BUFF', duration: skill.duration, value: skill.bonusAd });
      }
    }

    // 9. BRAWLER (격투가)
    else if (p.championId === 'brawler') {
      if (key === 'Q') {
        // Heavy Punch
        this.spawnProjectile({
          ownerId: p.id,
          team: p.team,
          type: 'punch',
          x: p.x,
          y: p.y,
          vx: dirX,
          vy: dirY,
          speed: skill.speed,
          radius: skill.radius,
          damage: skill.damage,
          rangeRemaining: skill.range,
          piercing: true,
          color: '#d35400'
        });
      } else if (key === 'W') {
        // Counter Guard
        p.statusEffects.push({ type: 'COUNTER_GUARD', duration: skill.duration });
      } else if (key === 'E') {
        // Knee Dash
        const dashDist = Math.min(dist, skill.range);
        p.x += dirX * dashDist;
        p.y += dirY * dashDist;
        p.targetX = p.x;
        p.targetY = p.y;
        this.createAoeBlast(p.id, p.team, p.x, p.y, 140, skill.damage, 'SLOW', skill.slowDuration);
      } else if (key === 'R') {
        // Rising Dragon Fist
        const jumpDist = Math.min(dist, skill.range);
        p.x += dirX * jumpDist;
        p.y += dirY * jumpDist;
        p.targetX = p.x;
        p.targetY = p.y;
        this.createAoeBlast(p.id, p.team, p.x, p.y, 160, skill.damage, 'AIRBORNE', skill.airborneDuration);
      }
    }

    // 10. DEMOLITIONIST (폭탄광)
    else if (p.championId === 'demolitionist') {
      if (key === 'Q') {
        // Bouncing bomb
        this.spawnProjectile({
          ownerId: p.id,
          team: p.team,
          type: 'bouncing_bomb',
          x: p.x,
          y: p.y,
          vx: dirX,
          vy: dirY,
          speed: skill.speed,
          radius: skill.radius,
          damage: skill.damage,
          rangeRemaining: skill.range,
          color: '#f1c40f'
        });
      } else if (key === 'W') {
        // Satchel charge
        this.createAoeBlast(p.id, p.team, tx, ty, skill.radius, skill.damage, null);
        // Self bounce if near
        const selfDist = Math.hypot(p.x - tx, p.y - ty);
        if (selfDist < skill.radius + 50) {
          const sDirX = (p.x - tx) / (selfDist || 1);
          const sDirY = (p.y - ty) / (selfDist || 1);
          p.x += sDirX * skill.knockbackDist;
          p.y += sDirY * skill.knockbackDist;
        }
      } else if (key === 'E') {
        // Minefield
        this.aoeZones.push({
          id: `mine_${this.nextEntityId++}`,
          ownerId: p.id,
          team: p.team,
          type: 'minefield',
          x: tx,
          y: ty,
          radius: skill.radius,
          damagePerMine: skill.damagePerMine,
          durationRemaining: 15.0,
          delayRemaining: 0
        });
      } else if (key === 'R') {
        // Mega Inferno Bomb
        this.aoeZones.push({
          id: `inferno_${this.nextEntityId++}`,
          ownerId: p.id,
          team: p.team,
          type: 'meteor',
          x: tx,
          y: ty,
          radius: skill.radius,
          damage: skill.damage,
          delayRemaining: skill.delay,
          durationRemaining: 0
        });
      }
    }
  }

  getMapData() {
    return {
      width: this.map.width,
      height: this.map.height,
      obstacles: this.map.obstacles,
      bushes: this.map.bushes,
      bases: this.map.bases
    };
  }

  getState() {
    return {
      gameTime: Math.floor(this.gameTime),
      scores: this.scores,
      players: Object.values(this.players).map(p => ({
        id: p.id,
        nickname: p.nickname,
        team: p.team,
        championId: p.championId,
        avatar: p.avatar,
        color: p.color,
        accentColor: p.accentColor,
        x: Math.round(p.x),
        y: Math.round(p.y),
        angle: p.angle,
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
        mp: Math.round(p.mp),
        maxMp: p.maxMp,
        shield: Math.round(p.shield || 0),
        isAlive: p.isAlive,
        respawnTimer: Math.ceil(p.respawnTimer),
        cooldowns: p.cooldowns,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        spellD: p.spellD,
        spellF: p.spellF,
        stealth: p.stealth
      })),
      structures: Object.values(this.structures).map(s => ({
        id: s.id,
        name: s.name,
        team: s.team,
        type: s.type,
        x: s.x,
        y: s.y,
        hp: Math.round(s.hp),
        maxHp: s.maxHp,
        isAlive: s.isAlive
      })),
      projectiles: this.projectiles.map(pr => ({
        id: pr.id,
        type: pr.type,
        x: Math.round(pr.x),
        y: Math.round(pr.y),
        radius: pr.radius,
        color: pr.color || '#fff'
      })),
      aoeZones: this.aoeZones.map(z => ({
        id: z.id,
        type: z.type,
        x: Math.round(z.x),
        y: Math.round(z.y),
        radius: z.radius,
        team: z.team,
        delayRemaining: Math.max(0, z.delayRemaining)
      })),
      events: this.eventsQueue
    };
  }

  broadcastTick() {
    this.io.to(this.room.id).emit('gameTick', this.getState());
  }
}

module.exports = GameEngine;
