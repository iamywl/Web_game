/**
 * GameEngine.js
 * 30 FPS Authoritative Game Engine for MOBA Arena
 * Handles movement, collisions, projectiles, skill execution, turrets, and victory conditions.
 */

const { CHAMPIONS, SUMMONER_SPELLS } = require('./ChampionData');
const { ITEMS } = require('./ItemData');
const Garen = require('./GarenMechanics');
const Yasuo = require('./YasuoMechanics');
const MapNavigation = require('../../public/js/mapNavigation').default;

const TICK_RATE = 60;
const DT = 1 / TICK_RATE; // ~0.01666s (60 FPS tick)
const MAP_WIDTH_ARAM = 2400;
const MAP_HEIGHT_ARAM = 1600;
const MAP_WIDTH_SR = 3200;
const MAP_HEIGHT_SR = 3200;

const SR_PLACEMENTS = require('../../public/assets/maps/summoners-rift/placements.json');
const MINION_ROUTES = SR_PLACEMENTS.routes;

class GameEngine {
  constructor(room, io) {
    this.room = room;
    this.io = io;
    this.timerHandle = null;
    this.gameTime = 0; // seconds

    this.isSummonersRift = (this.room && (this.room.mapType === 'summoners_rift' || this.room.mode === 'custom' || this.room.mode === '5v5' || this.room.mode === '2v2'));

    if (this.isSummonersRift) {
      this.map = this.createSummonersRiftMap();
      this.structures = this.createSummonersRiftStructures();
      this.jungleMonsters = this.createSummonersRiftJungle();
      this.navigation = new MapNavigation(require('../../public/assets/maps/summoners-rift/navigation.json'));
      this.navigation.setStructures(Object.values(this.structures).filter((s, i, all) => all.indexOf(s) === i));
      const campNames = { 'Order Wolves': 'wolves_blue', 'Order Blue': 'blue_buff_blue', 'Order OwlBear': 'gromp_blue', 'Order Red': 'red_buff_blue', 'Order Wraiths': 'raptors_blue', 'Order Small Golems': 'krugs_blue', 'Chaos Wolves': 'wolves_red', 'Chaos Blue': 'blue_buff_red', 'Chaos OwlBear': 'gromp_red', 'Chaos Red': 'red_buff_red', 'Chaos Wraiths': 'raptors_red', 'Chaos Small Golems': 'krugs_red', Baron: 'baron', Dragon: 'dragon', 'Baron Crab': 'scuttle_top', 'Dragon Crab': 'scuttle_bot' };
      for (const camp of SR_PLACEMENTS.camps) {
        const monster = this.jungleMonsters[campNames[camp.name]];
        if (!monster) continue;
        monster.x = camp.x; monster.y = camp.y;
        monster.spawnX = camp.x; monster.spawnY = camp.y;
        if (monster.type === 'scuttle') {
          monster.patrolMinX = camp.x - 80; monster.patrolMaxX = camp.x + 80;
          monster.patrolMinY = camp.y - 80; monster.patrolMaxY = camp.y + 80;
        }
      }
    } else {
      this.map = this.createAramMap();
      this.structures = this.createAramStructures();
      this.jungleMonsters = this.createAramJungle();
    }

    // Minion Wave & Combat System
    this.minions = {}; // minionId -> Minion object
    this.minionWaveTimer = 2.0; // First wave marches out at 2.0s
    this.minionWaveInterval = this.isSummonersRift ? 30.0 : 25.0;
    this.minionWaveCount = 0;

    this.players = {}; // socketId -> Player
    this.yasuoWalls = [];
    this.projectiles = []; // array of active skillshots
    this.aoeZones = []; // array of ground delay/persistent zones
    this.eventsQueue = []; // damage numbers, CC alerts, kills to broadcast this tick

    this.scores = {
      blue: 0,
      red: 0
    };

    // Vision Wards System
    this.wards = []; // { id, team, ownerId, x, y, radius, duration }
    this.firstBloodClaimed = false;

    this.nextEntityId = 1;
  }

  createSummonersRiftMap() {
    const blue = SR_PLACEMENTS.spawns.blue, red = SR_PLACEMENTS.spawns.red;
    return {
      width: MAP_WIDTH_SR, height: MAP_HEIGHT_SR, isSummonersRift: true,
      obstacles: [], bushes: [],
      bases: {
        blue: { x: blue.x, y: blue.y, spawnX: blue.x, spawnY: blue.y },
        red: { x: red.x, y: red.y, spawnX: red.x, spawnY: red.y }
      }
    };
  }

  createSummonersRiftStructures() {
    const s = {};

    // Helper to register structure
    const reg = (id, obj) => { s[id] = obj; return obj; };

    // --- BLUE TEAM (11 Turrets, 3 Inhibitors, 1 Nexus) ---
    // Top Lane
    reg('blue_top_outer_turret', { id: 'blue_top_outer_turret', team: 'blue', lane: 'top', tier: 1, type: 'turret', name: '블루 탑 1차 포탑', x: 450, y: 1650, radius: 46, hp: 3800, maxHp: 3800, armor: 40, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 170, targetId: null, isAlive: true, isInvulnerable: false });
    reg('blue_top_inner_turret', { id: 'blue_top_inner_turret', team: 'blue', lane: 'top', tier: 2, type: 'turret', name: '블루 탑 2차 포탑', x: 450, y: 2150, radius: 46, hp: 4000, maxHp: 4000, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 190, targetId: null, isAlive: true, isInvulnerable: true });
    reg('blue_top_inhibitor_turret', { id: 'blue_top_inhibitor_turret', team: 'blue', lane: 'top', tier: 3, type: 'turret', name: '블루 탑 3차 포탑', x: 450, y: 2450, radius: 46, hp: 4200, maxHp: 4200, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 210, targetId: null, isAlive: true, isInvulnerable: true });
    reg('blue_top_inhibitor', { id: 'blue_top_inhibitor', team: 'blue', lane: 'top', type: 'inhibitor', name: '블루 탑 억제기', x: 450, y: 2550, radius: 42, hp: 4000, maxHp: 4000, armor: 20, isAlive: true, isInvulnerable: true, respawnTimer: 0 });

    // Mid Lane (Distance: 1555.6px between outers, Neutral Zone: 795.6px)
    reg('blue_mid_outer_turret', { id: 'blue_mid_outer_turret', team: 'blue', lane: 'mid', tier: 1, type: 'turret', name: '블루 미드 1차 포탑', x: 1050, y: 2150, radius: 46, hp: 3800, maxHp: 3800, armor: 40, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 170, targetId: null, isAlive: true, isInvulnerable: false });
    reg('blue_mid_inner_turret', { id: 'blue_mid_inner_turret', team: 'blue', lane: 'mid', tier: 2, type: 'turret', name: '블루 미드 2차 포탑', x: 850, y: 2350, radius: 46, hp: 4000, maxHp: 4000, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 190, targetId: null, isAlive: true, isInvulnerable: true });
    reg('blue_mid_inhibitor_turret', { id: 'blue_mid_inhibitor_turret', team: 'blue', lane: 'mid', tier: 3, type: 'turret', name: '블루 미드 3차 포탑', x: 680, y: 2520, radius: 46, hp: 4200, maxHp: 4200, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 210, targetId: null, isAlive: true, isInvulnerable: true });
    reg('blue_mid_inhibitor', { id: 'blue_mid_inhibitor', team: 'blue', lane: 'mid', type: 'inhibitor', name: '블루 미드 억제기', x: 620, y: 2580, radius: 42, hp: 4000, maxHp: 4000, armor: 20, isAlive: true, isInvulnerable: true, respawnTimer: 0 });

    // Bot Lane
    reg('blue_bot_outer_turret', { id: 'blue_bot_outer_turret', team: 'blue', lane: 'bot', tier: 1, type: 'turret', name: '블루 바텀 1차 포탑', x: 1550, y: 2750, radius: 46, hp: 3800, maxHp: 3800, armor: 40, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 170, targetId: null, isAlive: true, isInvulnerable: false });
    reg('blue_bot_inner_turret', { id: 'blue_bot_inner_turret', team: 'blue', lane: 'bot', tier: 2, type: 'turret', name: '블루 바텀 2차 포탑', x: 1050, y: 2750, radius: 46, hp: 4000, maxHp: 4000, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 190, targetId: null, isAlive: true, isInvulnerable: true });
    reg('blue_bot_inhibitor_turret', { id: 'blue_bot_inhibitor_turret', team: 'blue', lane: 'bot', tier: 3, type: 'turret', name: '블루 바텀 3차 포탑', x: 750, y: 2750, radius: 46, hp: 4200, maxHp: 4200, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 210, targetId: null, isAlive: true, isInvulnerable: true });
    reg('blue_bot_inhibitor', { id: 'blue_bot_inhibitor', team: 'blue', lane: 'bot', type: 'inhibitor', name: '블루 바텀 억제기', x: 650, y: 2750, radius: 42, hp: 4000, maxHp: 4000, armor: 20, isAlive: true, isInvulnerable: true, respawnTimer: 0 });

    // Nexus & Twins
    reg('blue_nexus_turret_l', { id: 'blue_nexus_turret_l', team: 'blue', lane: 'base', tier: 4, type: 'turret', name: '블루 넥서스 좌 포탑', x: 580, y: 2660, radius: 46, hp: 4500, maxHp: 4500, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 230, targetId: null, isAlive: true, isInvulnerable: true });
    reg('blue_nexus_turret_r', { id: 'blue_nexus_turret_r', team: 'blue', lane: 'base', tier: 4, type: 'turret', name: '블루 넥서스 우 포탑', x: 620, y: 2620, radius: 46, hp: 4500, maxHp: 4500, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 230, targetId: null, isAlive: true, isInvulnerable: true });
    reg('blue_nexus', { id: 'blue_nexus', team: 'blue', type: 'nexus', name: '블루 넥서스', x: 480, y: 2720, radius: 65, hp: 5500, maxHp: 5500, armor: 30, isAlive: true, isInvulnerable: true });

    // --- RED TEAM (11 Turrets, 3 Inhibitors, 1 Nexus) ---
    // Top Lane
    reg('red_top_outer_turret', { id: 'red_top_outer_turret', team: 'red', lane: 'top', tier: 1, type: 'turret', name: '레드 탑 1차 포탑', x: 1650, y: 450, radius: 46, hp: 3800, maxHp: 3800, armor: 40, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 170, targetId: null, isAlive: true, isInvulnerable: false });
    reg('red_top_inner_turret', { id: 'red_top_inner_turret', team: 'red', lane: 'top', tier: 2, type: 'turret', name: '레드 탑 2차 포탑', x: 2150, y: 450, radius: 46, hp: 4000, maxHp: 4000, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 190, targetId: null, isAlive: true, isInvulnerable: true });
    reg('red_top_inhibitor_turret', { id: 'red_top_inhibitor_turret', team: 'red', lane: 'top', tier: 3, type: 'turret', name: '레드 탑 3차 포탑', x: 2450, y: 450, radius: 46, hp: 4200, maxHp: 4200, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 210, targetId: null, isAlive: true, isInvulnerable: true });
    reg('red_top_inhibitor', { id: 'red_top_inhibitor', team: 'red', lane: 'top', type: 'inhibitor', name: '레드 탑 억제기', x: 2550, y: 450, radius: 42, hp: 4000, maxHp: 4000, armor: 20, isAlive: true, isInvulnerable: true, respawnTimer: 0 });

    // Mid Lane
    reg('red_mid_outer_turret', { id: 'red_mid_outer_turret', team: 'red', lane: 'mid', tier: 1, type: 'turret', name: '레드 미드 1차 포탑', x: 2150, y: 1050, radius: 46, hp: 3800, maxHp: 3800, armor: 40, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 170, targetId: null, isAlive: true, isInvulnerable: false });
    reg('red_mid_inner_turret', { id: 'red_mid_inner_turret', team: 'red', lane: 'mid', tier: 2, type: 'turret', name: '레드 미드 2차 포탑', x: 2350, y: 850, radius: 46, hp: 4000, maxHp: 4000, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 190, targetId: null, isAlive: true, isInvulnerable: true });
    reg('red_mid_inhibitor_turret', { id: 'red_mid_inhibitor_turret', team: 'red', lane: 'mid', tier: 3, type: 'turret', name: '레드 미드 3차 포탑', x: 2520, y: 680, radius: 46, hp: 4200, maxHp: 4200, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 210, targetId: null, isAlive: true, isInvulnerable: true });
    reg('red_mid_inhibitor', { id: 'red_mid_inhibitor', team: 'red', lane: 'mid', type: 'inhibitor', name: '레드 미드 억제기', x: 2580, y: 620, radius: 42, hp: 4000, maxHp: 4000, armor: 20, isAlive: true, isInvulnerable: true, respawnTimer: 0 });

    // Bot Lane
    reg('red_bot_outer_turret', { id: 'red_bot_outer_turret', team: 'red', lane: 'bot', tier: 1, type: 'turret', name: '레드 바텀 1차 포탑', x: 2750, y: 1550, radius: 46, hp: 3800, maxHp: 3800, armor: 40, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 170, targetId: null, isAlive: true, isInvulnerable: false });
    reg('red_bot_inner_turret', { id: 'red_bot_inner_turret', team: 'red', lane: 'bot', tier: 2, type: 'turret', name: '레드 바텀 2차 포탑', x: 2750, y: 2150, radius: 46, hp: 4000, maxHp: 4000, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 190, targetId: null, isAlive: true, isInvulnerable: true });
    reg('red_bot_inhibitor_turret', { id: 'red_bot_inhibitor_turret', team: 'red', lane: 'bot', tier: 3, type: 'turret', name: '레드 바텀 3차 포탑', x: 2750, y: 2450, radius: 46, hp: 4200, maxHp: 4200, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 210, targetId: null, isAlive: true, isInvulnerable: true });
    reg('red_bot_inhibitor', { id: 'red_bot_inhibitor', team: 'red', lane: 'bot', type: 'inhibitor', name: '레드 바텀 억제기', x: 2750, y: 2550, radius: 42, hp: 4000, maxHp: 4000, armor: 20, isAlive: true, isInvulnerable: true, respawnTimer: 0 });

    // Nexus & Twins
    reg('red_nexus_turret_l', { id: 'red_nexus_turret_l', team: 'red', lane: 'base', tier: 4, type: 'turret', name: '레드 넥서스 좌 포탑', x: 2620, y: 580, radius: 46, hp: 4500, maxHp: 4500, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 230, targetId: null, isAlive: true, isInvulnerable: true });
    reg('red_nexus_turret_r', { id: 'red_nexus_turret_r', team: 'red', lane: 'base', tier: 4, type: 'turret', name: '레드 넥서스 우 포탑', x: 2580, y: 620, radius: 46, hp: 4500, maxHp: 4500, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 230, targetId: null, isAlive: true, isInvulnerable: true });
    reg('red_nexus', { id: 'red_nexus', team: 'red', type: 'nexus', name: '레드 넥서스', x: 2720, y: 480, radius: 65, hp: 5500, maxHp: 5500, armor: 30, isAlive: true, isInvulnerable: true });

    // Source placements replace geometry only; IDs, combat stats and hierarchy stay intact.
    for (const placement of SR_PLACEMENTS.structures) {
      let id = placement.id.replace('_inhib_turret', '_inhibitor_turret').replace(/_inhib$/, '_inhibitor');
      id = id.replace(/_nexus_turret1$/, '_nexus_turret_l').replace(/_nexus_turret2$/, '_nexus_turret_r');
      if (/_outer$|_inner$/.test(id)) id += '_turret';
      const structure = s[id];
      if (!structure) throw new Error('Unmapped original structure: ' + placement.id);
      structure.x = placement.x; structure.y = placement.y;
      structure.height = placement.height; structure.rotation = placement.rotation;
      structure.radius = (structure.type === 'turret' ? 125 : structure.type === 'nexus' ? 304 : 213.75) * (3200 / 15000);
      // The web game's spell/attack distances remain unchanged. Keep ranged
      // minions within tower retaliation while leaving a safe mid-lane gap.
      if (structure.type === 'turret') structure.range = 300;
    }

    // Backwards compatibility aliases
    s.blue_outer_turret = s.blue_mid_outer_turret;
    s.blue_inner_turret = s.blue_mid_inner_turret;
    s.blue_turret = s.blue_mid_inner_turret;
    s.red_outer_turret = s.red_mid_outer_turret;
    s.red_inner_turret = s.red_mid_inner_turret;
    s.red_turret = s.red_mid_inner_turret;

    return s;
  }

  createSummonersRiftJungle() {
    return {
      baron: { id: 'baron_nashor', name: '내셔 남작 (Baron Nashor)', type: 'baron', team: 'neutral', x: 1000, y: 900, radius: 65, hp: 9000, maxHp: 9000, armor: 50, damage: 160, range: 350, attackCooldown: 0, attackInterval: 1.3, goldValue: 300, expValue: 600, targetId: null, isAlive: true, respawnTimer: 0 },
      dragon: { id: 'elemental_dragon', name: '원소 드래곤 (Elemental Dragon)', type: 'dragon', team: 'neutral', x: 2200, y: 2300, radius: 54, hp: 4500, maxHp: 4500, armor: 35, damage: 85, range: 300, attackCooldown: 0, attackInterval: 1.4, goldValue: 150, expValue: 350, targetId: null, isAlive: true, respawnTimer: 0 },
      scuttle_top: { id: 'scuttle_top', name: '상단 바위게', type: 'scuttle', team: 'neutral', x: 1000, y: 1000, radius: 28, hp: 1200, maxHp: 1200, armor: 20, speed: 130, patrolMinX: 800, patrolMaxX: 1250, patrolMinY: 800, patrolMaxY: 1250, patrolDir: 1, goldValue: 70, expValue: 120, isAlive: true, respawnTimer: 0 },
      scuttle_bot: { id: 'scuttle_bot', name: '하단 바위게', type: 'scuttle', team: 'neutral', x: 2150, y: 2150, radius: 28, hp: 1200, maxHp: 1200, armor: 20, speed: 130, patrolMinX: 1950, patrolMaxX: 2400, patrolMinY: 1950, patrolMaxY: 2400, patrolDir: 1, goldValue: 70, expValue: 120, isAlive: true, respawnTimer: 0 },
      // Blue Top Jungle
      blue_buff_blue: { id: 'blue_buff_blue', name: '푸른 파수꾼 (블루 버프)', type: 'buff_blue', team: 'neutral', x: 850, y: 1650, radius: 45, hp: 2100, maxHp: 2100, armor: 30, damage: 60, range: 120, attackCooldown: 0, attackInterval: 1.2, goldValue: 90, expValue: 140, targetId: null, isAlive: true, respawnTimer: 0 },
      gromp_blue: { id: 'gromp_blue', name: '심술두꺼비 (Gromp)', type: 'gromp', team: 'neutral', x: 600, y: 1900, radius: 38, hp: 1650, maxHp: 1650, armor: 25, damage: 55, range: 180, attackCooldown: 0, attackInterval: 1.1, goldValue: 80, expValue: 120, targetId: null, isAlive: true, respawnTimer: 0 },
      wolves_blue: { id: 'wolves_blue', name: '어스름 늑대', type: 'wolves', team: 'neutral', x: 1050, y: 1900, radius: 36, hp: 1200, maxHp: 1200, armor: 20, damage: 45, range: 100, attackCooldown: 0, attackInterval: 1.0, goldValue: 68, expValue: 95, targetId: null, isAlive: true, respawnTimer: 0 },
      // Blue Bot Jungle
      red_buff_blue: { id: 'red_buff_blue', name: '붉은 덩굴정령 (레드 버프)', type: 'buff_red', team: 'neutral', x: 1650, y: 2350, radius: 45, hp: 2100, maxHp: 2100, armor: 30, damage: 65, range: 120, attackCooldown: 0, attackInterval: 1.2, goldValue: 90, expValue: 140, targetId: null, isAlive: true, respawnTimer: 0 },
      raptors_blue: { id: 'raptors_blue', name: '칼날부리', type: 'raptors', team: 'neutral', x: 1400, y: 2150, radius: 34, hp: 1100, maxHp: 1100, armor: 20, damage: 35, range: 100, attackCooldown: 0, attackInterval: 1.0, goldValue: 75, expValue: 100, targetId: null, isAlive: true, respawnTimer: 0 },
      krugs_blue: { id: 'krugs_blue', name: '돌거북', type: 'krugs', team: 'neutral', x: 1900, y: 2600, radius: 40, hp: 1400, maxHp: 1400, armor: 25, damage: 50, range: 110, attackCooldown: 0, attackInterval: 1.1, goldValue: 85, expValue: 115, targetId: null, isAlive: true, respawnTimer: 0 },
      // Red Top Jungle
      red_buff_red: { id: 'red_buff_red', name: '붉은 덩굴정령 (적 레드)', type: 'buff_red', team: 'neutral', x: 1550, y: 850, radius: 45, hp: 2100, maxHp: 2100, armor: 30, damage: 65, range: 120, attackCooldown: 0, attackInterval: 1.2, goldValue: 90, expValue: 140, targetId: null, isAlive: true, respawnTimer: 0 },
      raptors_red: { id: 'raptors_red', name: '칼날부리 (적 칼날)', type: 'raptors', team: 'neutral', x: 1800, y: 1050, radius: 34, hp: 1100, maxHp: 1100, armor: 20, damage: 35, range: 100, attackCooldown: 0, attackInterval: 1.0, goldValue: 75, expValue: 100, targetId: null, isAlive: true, respawnTimer: 0 },
      krugs_red: { id: 'krugs_red', name: '돌거북 (적 돌거북)', type: 'krugs', team: 'neutral', x: 1300, y: 600, radius: 40, hp: 1400, maxHp: 1400, armor: 25, damage: 50, range: 110, attackCooldown: 0, attackInterval: 1.1, goldValue: 85, expValue: 115, targetId: null, isAlive: true, respawnTimer: 0 },
      // Red Bot Jungle
      blue_buff_red: { id: 'blue_buff_red', name: '푸른 파수꾼 (적 블루)', type: 'buff_blue', team: 'neutral', x: 2350, y: 1550, radius: 45, hp: 2100, maxHp: 2100, armor: 30, damage: 60, range: 120, attackCooldown: 0, attackInterval: 1.2, goldValue: 90, expValue: 140, targetId: null, isAlive: true, respawnTimer: 0 },
      gromp_red: { id: 'gromp_red', name: '심술두꺼비 (적 두꺼비)', type: 'gromp', team: 'neutral', x: 2600, y: 1300, radius: 38, hp: 1650, maxHp: 1650, armor: 25, damage: 55, range: 180, attackCooldown: 0, attackInterval: 1.1, goldValue: 80, expValue: 120, targetId: null, isAlive: true, respawnTimer: 0 },
      wolves_red: { id: 'wolves_red', name: '어스름 늑대 (적 늑대)', type: 'wolves', team: 'neutral', x: 2150, y: 1300, radius: 36, hp: 1200, maxHp: 1200, armor: 20, damage: 45, range: 100, attackCooldown: 0, attackInterval: 1.0, goldValue: 68, expValue: 95, targetId: null, isAlive: true, respawnTimer: 0 }
    };
  }

  createAramMap() {
    return {
      width: MAP_WIDTH_ARAM,
      height: MAP_HEIGHT_ARAM,
      isSummonersRift: false,
      obstacles: [
        { id: 'rock_top_left', type: 'circle', x: 800, y: 480, radius: 95 },
        { id: 'rock_top_right', type: 'circle', x: 1600, y: 480, radius: 95 },
        { id: 'rock_bot_left', type: 'circle', x: 800, y: 1120, radius: 95 },
        { id: 'rock_bot_right', type: 'circle', x: 1600, y: 1120, radius: 95 },
        { id: 'pillar_top', type: 'box', x: 1150, y: 280, width: 100, height: 160 }
      ],
      bushes: [
        { id: 'bush_river_top', x: 1200, y: 520, radius: 90 },
        { id: 'bush_river_bot', x: 1200, y: 1080, radius: 90 },
        { id: 'bush_mid_blue', x: 880, y: 620, radius: 80 },
        { id: 'bush_mid_red', x: 1520, y: 980, radius: 80 }
      ],
      bases: {
        blue: { x: 260, y: 800, spawnX: 340, spawnY: 800 },
        red: { x: 2140, y: 800, spawnX: 2060, spawnY: 800 }
      }
    };
  }

  createAramStructures() {
    const blueOuter = { id: 'blue_outer_turret', team: 'blue', type: 'turret', name: '블루 1차 포탑', x: 650, y: 800, radius: 46, hp: 2500, maxHp: 2500, armor: 40, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 130, targetId: null, isAlive: true };
    const blueInner = { id: 'blue_inner_turret', team: 'blue', type: 'turret', name: '블루 2차 포탑', x: 420, y: 800, radius: 46, hp: 2800, maxHp: 2800, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 155, targetId: null, isAlive: true };
    const redOuter = { id: 'red_outer_turret', team: 'red', type: 'turret', name: '레드 1차 포탑', x: 1750, y: 800, radius: 46, hp: 2500, maxHp: 2500, armor: 40, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 130, targetId: null, isAlive: true };
    const redInner = { id: 'red_inner_turret', team: 'red', type: 'turret', name: '레드 2차 포탑', x: 1980, y: 800, radius: 46, hp: 2800, maxHp: 2800, armor: 45, range: 380, attackCooldown: 0, attackInterval: 1.1, damage: 155, targetId: null, isAlive: true };

    return {
      blue_nexus: { id: 'blue_nexus', team: 'blue', type: 'nexus', name: '블루 넥서스', x: 260, y: 800, radius: 65, hp: 3500, maxHp: 3500, armor: 30, isAlive: true },
      red_nexus: { id: 'red_nexus', team: 'red', type: 'nexus', name: '레드 넥서스', x: 2140, y: 800, radius: 65, hp: 3500, maxHp: 3500, armor: 30, isAlive: true },
      blue_outer_turret: blueOuter,
      blue_inner_turret: blueInner,
      blue_turret: blueInner,
      red_outer_turret: redOuter,
      red_inner_turret: redInner,
      red_turret: redInner
    };
  }

  createAramJungle() {
    return {
      scuttle: { id: 'scuttle_crab', name: '바위게 (Scuttle Crab)', type: 'scuttle', team: 'neutral', x: 1200, y: 800, radius: 28, hp: 1200, maxHp: 1200, armor: 20, speed: 130, patrolMinY: 560, patrolMaxY: 1040, patrolDir: 1, goldValue: 70, expValue: 120, isAlive: true, respawnTimer: 0 },
      dragon: { id: 'elemental_dragon', name: '원소 드래곤 (Elemental Dragon)', type: 'dragon', team: 'neutral', x: 1200, y: 1350, radius: 54, hp: 4500, maxHp: 4500, armor: 35, damage: 85, range: 300, attackCooldown: 0, attackInterval: 1.4, goldValue: 150, expValue: 350, targetId: null, isAlive: true, respawnTimer: 0 }
    };
  }

  updateStructureInvulnerability() {
    if (!this.isSummonersRift) return;
    const s = this.structures;

    // 1. Blue Turrets & Inhibitors
    if (s.blue_top_inner_turret) s.blue_top_inner_turret.isInvulnerable = s.blue_top_outer_turret.isAlive;
    if (s.blue_top_inhibitor_turret) s.blue_top_inhibitor_turret.isInvulnerable = s.blue_top_inner_turret.isAlive;
    if (s.blue_top_inhibitor) s.blue_top_inhibitor.isInvulnerable = s.blue_top_inhibitor_turret.isAlive;

    if (s.blue_mid_inner_turret) s.blue_mid_inner_turret.isInvulnerable = s.blue_mid_outer_turret.isAlive;
    if (s.blue_mid_inhibitor_turret) s.blue_mid_inhibitor_turret.isInvulnerable = s.blue_mid_inner_turret.isAlive;
    if (s.blue_mid_inhibitor) s.blue_mid_inhibitor.isInvulnerable = s.blue_mid_inhibitor_turret.isAlive;

    if (s.blue_bot_inner_turret) s.blue_bot_inner_turret.isInvulnerable = s.blue_bot_outer_turret.isAlive;
    if (s.blue_bot_inhibitor_turret) s.blue_bot_inhibitor_turret.isInvulnerable = s.blue_bot_inner_turret.isAlive;
    if (s.blue_bot_inhibitor) s.blue_bot_inhibitor.isInvulnerable = s.blue_bot_inhibitor_turret.isAlive;

    const anyBlueInhibitorDown = (!s.blue_top_inhibitor.isAlive || !s.blue_mid_inhibitor.isAlive || !s.blue_bot_inhibitor.isAlive);
    if (s.blue_nexus_turret_l) s.blue_nexus_turret_l.isInvulnerable = !anyBlueInhibitorDown;
    if (s.blue_nexus_turret_r) s.blue_nexus_turret_r.isInvulnerable = !anyBlueInhibitorDown;
    if (s.blue_nexus) s.blue_nexus.isInvulnerable = (s.blue_nexus_turret_l.isAlive || s.blue_nexus_turret_r.isAlive);

    // 2. Red Turrets & Inhibitors
    if (s.red_top_inner_turret) s.red_top_inner_turret.isInvulnerable = s.red_top_outer_turret.isAlive;
    if (s.red_top_inhibitor_turret) s.red_top_inhibitor_turret.isInvulnerable = s.red_top_inner_turret.isAlive;
    if (s.red_top_inhibitor) s.red_top_inhibitor.isInvulnerable = s.red_top_inhibitor_turret.isAlive;

    if (s.red_mid_inner_turret) s.red_mid_inner_turret.isInvulnerable = s.red_mid_outer_turret.isAlive;
    if (s.red_mid_inhibitor_turret) s.red_mid_inhibitor_turret.isInvulnerable = s.red_mid_inner_turret.isAlive;
    if (s.red_mid_inhibitor) s.red_mid_inhibitor.isInvulnerable = s.red_mid_inhibitor_turret.isAlive;

    if (s.red_bot_inner_turret) s.red_bot_inner_turret.isInvulnerable = s.red_bot_outer_turret.isAlive;
    if (s.red_bot_inhibitor_turret) s.red_bot_inhibitor_turret.isInvulnerable = s.red_bot_inner_turret.isAlive;
    if (s.red_bot_inhibitor) s.red_bot_inhibitor.isInvulnerable = s.red_bot_inhibitor_turret.isAlive;

    const anyRedInhibitorDown = (!s.red_top_inhibitor.isAlive || !s.red_mid_inhibitor.isAlive || !s.red_bot_inhibitor.isAlive);
    if (s.red_nexus_turret_l) s.red_nexus_turret_l.isInvulnerable = !anyRedInhibitorDown;
    if (s.red_nexus_turret_r) s.red_nexus_turret_r.isInvulnerable = !anyRedInhibitorDown;
    if (s.red_nexus) s.red_nexus.isInvulnerable = (s.red_nexus_turret_l.isAlive || s.red_nexus_turret_r.isAlive);

    // 3. Inhibitor respawn countdown
    const inhibitors = [
      s.blue_top_inhibitor, s.blue_mid_inhibitor, s.blue_bot_inhibitor,
      s.red_top_inhibitor, s.red_mid_inhibitor, s.red_bot_inhibitor
    ];
    for (let i = 0; i < inhibitors.length; i++) {
      const inh = inhibitors[i];
      if (!inh) continue;
      if (!inh.isAlive && inh.respawnTimer > 0) {
        inh.respawnTimer -= DT;
        if (inh.respawnTimer <= 0) {
          inh.isAlive = true;
          inh.hp = inh.maxHp;
          this.eventsQueue.push({
            type: 'announcer',
            event: 'INHIBITOR_RESPAWNED',
            team: inh.team,
            inhibitorName: inh.name
          });
        }
      }
    }
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

        // KDA & Farm
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        gold: 500,

        // Level & Skill Progression
        level: 1,
        exp: 0,
        maxExp: 280,
        skillPoints: 1,
        skillRanks: { Q: 1, W: 0, E: 0, R: 0 },

        // Inventory & Items
        items: [], // Array of item IDs (max 6)

        // Recall & Vision Status
        recalling: false,
        recallTimer: 0,
        inBush: false,
        bushId: null,
        revealedTimer: 0,
        wardCooldown: 0,
        dragonBuffStacks: 0,
        lastKillTime: 0,
        killStreak: 0,

        // Specific Champion Mechanic Trackers
        passiveCount: 0,
        passiveTimer: 0,
        comboStacks: 0,
        stealth: false,
        deathMark: null, // for Shadow Assassin R
        targetEnemyId: null // target for auto attack
      };
      if (this.navigation) {
        const player = this.players[socketId], i = this.navigation.nearest(player.x, player.y, player.radius);
        if (i >= 0) { player.x = player.targetX = this.navigation.centerX(i); player.y = player.targetY = this.navigation.centerY(i); }
      }
      Garen.initialize(this.players[socketId]);
      Yasuo.initialize(this.players[socketId]);
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

    for (const id in this.players) {
      Garen.update(this, this.players[id], DT);
      Yasuo.update(this, this.players[id], DT);
    }
    Yasuo.updateWalls(this, DT);

    // 3. Process Minions & Lane Waves
    this.updateMinions();

    // 4. Process Jungle Monsters & Wards
    this.updateJungleMonsters();
    this.updateWards();

    // 5. Process Turrets & Attacks
    this.updateTurrets();
    this.updateAutoAttacks();

    // 6. Process Projectiles
    this.updateProjectiles();

    // 7. Process AoE Zones
    this.updateAoeZones();

    // 8. Broadcast Tick State
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

      // Fountain healing (15% Max HP/s, 20% Max MP/s) if near base
      const base = this.map.bases[p.team];
      const distToBase = Math.hypot(p.x - base.x, p.y - base.y);
      if (distToBase < 220) {
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.15 * DT);
        p.mp = Math.min(p.maxMp, p.mp + p.maxMp * 0.20 * DT);
      }

      // Recall Channeling (8 seconds)
      if (p.recalling) {
        p.recallTimer -= DT;
        if (p.recallTimer <= 0) {
          p.recalling = false;
          p.recallTimer = 0;
          p.x = base.x;
          p.y = base.y;
          p.navPath = null;
          p.targetX = base.x;
          p.targetY = base.y;
          this.eventsQueue.push({ type: 'recall_complete', playerId: p.id, x: p.x, y: p.y });
        }
      }

      // Cooldowns and Timers
      if (p.wardCooldown > 0) p.wardCooldown = Math.max(0, p.wardCooldown - DT);
      if (p.revealedTimer > 0) p.revealedTimer = Math.max(0, p.revealedTimer - DT);

      for (const key of Object.keys(p.cooldowns)) {
        if (p.cooldowns[key] > 0) {
          p.cooldowns[key] = Math.max(0, p.cooldowns[key] - DT);
        }
      }
      if (p.autoAttackCooldown > 0) {
        p.autoAttackCooldown = Math.max(0, p.autoAttackCooldown - DT);
      }

      // Bush Vision / Stealth Detection
      let inAnyBush = false;
      let curBushId = null;
      for (const b of this.map.bushes) {
        if (Math.hypot(p.x - b.x, p.y - b.y) <= b.radius) {
          inAnyBush = true;
          curBushId = b.id;
          break;
        }
      }
      p.inBush = inAnyBush;
      p.bushId = curBushId;
      if (this.navigation) {
        const cell = this.navigation.index(p.x, p.y);
        p.inBush = this.navigation.bushAt(p.x, p.y);
        p.bushId = p.inBush ? 'source_bush_' + this.navigation.data.bushIds[cell] : null;
      }

      // Update Buffs / Debuffs
      let speedMult = 1.0;
      let adBonus = 0;
      let asBonus = 0;
      let isStealthed = false;
      let isStunned = false;
      let isRooted = false;
      let isImmune = false;
      let isSilenced = false;

      // Berserker Passive: missing health scaling
      if (p.championId === 'berserker') {
        const missingPct = Math.max(0, (p.maxHp - p.hp) / p.maxHp);
        asBonus += missingPct * 0.8;
        adBonus += missingPct * 45;
      }

      for (let i = p.statusEffects.length - 1; i >= 0; i--) {
        const eff = p.statusEffects[i];
        Garen.applyTenacity(p, eff);
        eff.duration -= DT;

        if (eff.type === 'SLOW') speedMult *= (1 - (eff.value || 0.3));
        if (eff.type === 'SPEED') speedMult *= (1 + (eff.value || 0.25));
        if (eff.type === 'STUN' || eff.type === 'AIRBORNE') isStunned = true;
        if (eff.type === 'ROOT') isRooted = true;
        if (eff.type === 'STEALTH') isStealthed = true;
        if (eff.type === 'IMMUNE') isImmune = true;
        if (eff.type === 'SILENCE' && eff.duration > 0) isSilenced = true;
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

      p.stealth = isStealthed || (p.inBush && p.revealedTimer <= 0);
      p.isStunned = isStunned;
      p.isRooted = isRooted;
      p.isImmune = isImmune;
      p.isSilenced = isSilenced;
      p.moveSpeed = p.baseMoveSpeed * speedMult * (p.garen?.qSpeedRemaining > 0 ? 1.35 : 1);
      p.ad = p.baseAd + adBonus;
      p.as = p.baseAs * (1 + asBonus);
    }
  }

  updatePlayerMovements() {
    if (this.navigation) {
      let mask = 0, index = 0;
      for (const key in this.structures) {
        const s = this.structures[key];
        if (s.id !== key) continue;
        if (s.isAlive) mask |= 1 << index;
        index++;
      }
      if (mask !== this.navStructureMask) {
        this.navStructureMask = mask;
        this.navigation.setStructures(Object.values(this.structures).filter((s, i, all) => all.indexOf(s) === i));
      }
    }
    for (const p of Object.values(this.players)) {
      // Animation telemetry describes this tick's resolved motion, including stops/CC.
      p.vx = 0;
      p.vy = 0;
      if (!p.isAlive || p.isStunned || p.isRooted || p.garen?.rRemaining > 0 || p.yasuo?.rRemaining > 0 || p.yasuo?.eRemaining > 0) continue;

      this.selectNavigationWaypoint(p, p.targetX, p.targetY);
      const dx = (this.navigation ? p.navX : p.targetX) - p.x;
      const dy = (this.navigation ? p.navY : p.targetY) - p.y;
      const dist = Math.hypot(dx, dy);

      if (dist > (this.navigation ? 0.25 : 4)) {
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

  selectNavigationWaypoint(entity, targetX, targetY) {
    if (!this.navigation) return;
    this.navigation.team = entity.team;
    if (entity.navRevision !== this.navigation.revision) { entity.navPath = null; entity.navRevision = this.navigation.revision; }
    if (Math.hypot(targetX - entity.x, targetY - entity.y) < 4) { entity.navX = entity.x; entity.navY = entity.y; entity.navPath = null; return; }
    const waypoint = entity.navPath?.[entity.navIndex];
    const changed = !entity.navPath?.length || Math.hypot(targetX - entity.navGoalX, targetY - entity.navGoalY) > 8 ||
      (waypoint && this.gameTime >= (entity.navReplanAt || 0) && !this.navigation.lineClear(entity.x, entity.y, waypoint.x, waypoint.y, entity.radius));
    if (changed && (!entity.navPath || this.gameTime >= (entity.navReplanAt || 0))) {
      entity.navPath = this.navigation.findPath(entity.x, entity.y, targetX, targetY, entity.radius);
      entity.navIndex = 0; entity.navGoalX = targetX; entity.navGoalY = targetY;
      entity.navReplanAt = this.gameTime + 0.2;
    }
    const path = entity.navPath;
    while (entity.navIndex < path.length - 1 && Math.hypot(path[entity.navIndex].x - entity.x, path[entity.navIndex].y - entity.y) < entity.radius + 4 &&
      this.navigation.lineClear(entity.x, entity.y, path[entity.navIndex + 1].x, path[entity.navIndex + 1].y, entity.radius)) entity.navIndex++;
    const next = path[entity.navIndex];
    entity.navX = next ? next.x : entity.x; entity.navY = next ? next.y : entity.y;
  }

  moveMinionOnMap(m, targetX, targetY, step) {
    this.selectNavigationWaypoint(m, targetX, targetY);
    const dx = (m.navX ?? targetX) - m.x, dy = (m.navY ?? targetY) - m.y, dist = Math.hypot(dx, dy);
    if (dist < 0.001) return;
    step = Math.min(step, dist); m.angle = Math.atan2(dy, dx);
    if (this.navigation) {
      this.navigation.move(m.x, m.y, m.x + dx / dist * step, m.y + dy / dist * step, m.radius);
      m.x = this.navigation.resultX; m.y = this.navigation.resultY;
    } else { m.x += dx / dist * step; m.y += dy / dist * step; }
  }

  resolvePlayerMovement(p, nx, ny, blink = false) {
    if (isNaN(nx) || isNaN(ny)) {
      return;
    }

    // 1. Arena Boundaries
    nx = Math.max(p.radius, Math.min(this.map.width - p.radius, nx));
    ny = Math.max(p.radius, Math.min(this.map.height - p.radius, ny));

    if (this.navigation) {
      this.navigation.team = p.team;
      this.navigation.move(p.x, p.y, nx, ny, p.radius, blink);
      nx = this.navigation.resultX; ny = this.navigation.resultY;
    }

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

    if (this.navigation && !this.navigation.isWalkable(nx, ny, p.radius)) { nx = p.x; ny = p.y; }
    if (!isNaN(nx) && !isNaN(ny)) {
      // Measure after collision resolution so a blocked move does not play a run cycle.
      p.vx = (nx - p.x) / DT;
      p.vy = (ny - p.y) / DT;
      p.x = nx;
      p.y = ny;
    }
  }

  // ==========================================================
  // MINION WAVE & COMBAT SYSTEM
  // ==========================================================
  spawnMinionWave() {
    this.minionWaveCount++;
    const isCannonWave = (this.minionWaveCount % 3 === 0);

    if (this.isSummonersRift) {
      const lanes = ['top', 'mid', 'bot'];
      for (let lIdx = 0; lIdx < lanes.length; lIdx++) {
        const lane = lanes[lIdx];
        const blueRoute = MINION_ROUTES['blue_' + lane];
        const redRoute = MINION_ROUTES['red_' + lane];
        const blueStart = blueRoute[0];
        const redStart = redRoute[0];

        const isBlueSuper = !this.structures['red_' + lane + '_inhibitor'] || !this.structures['red_' + lane + '_inhibitor'].isAlive;
        const isRedSuper = !this.structures['blue_' + lane + '_inhibitor'] || !this.structures['blue_' + lane + '_inhibitor'].isAlive;

        // 3 Melee Minions
        for (let i = 0; i < 3; i++) {
          const off = (i - 1) * 16;
          this.createMinion('blue', 'melee', blueStart.x + off, blueStart.y + off, lane, blueRoute);
          this.createMinion('red', 'melee', redStart.x - off, redStart.y - off, lane, redRoute);
        }

        // Cannon / Super Minion
        if (isBlueSuper) {
          this.createMinion('blue', 'super', blueStart.x - 25, blueStart.y - 25, lane, blueRoute);
        } else if (isCannonWave) {
          this.createMinion('blue', 'cannon', blueStart.x - 20, blueStart.y - 20, lane, blueRoute);
        }

        if (isRedSuper) {
          this.createMinion('red', 'super', redStart.x + 25, redStart.y + 25, lane, redRoute);
        } else if (isCannonWave) {
          this.createMinion('red', 'cannon', redStart.x + 20, redStart.y + 20, lane, redRoute);
        }

        // 3 Caster Minions
        for (let i = 0; i < 3; i++) {
          const off = (i - 1) * 16 - 32;
          this.createMinion('blue', 'caster', blueStart.x + off, blueStart.y + off, lane, blueRoute);
          this.createMinion('red', 'caster', redStart.x - off, redStart.y - off, lane, redRoute);
        }
      }
    } else {
      // Legacy 1v1 Single Lane
      for (let i = 0; i < 3; i++) {
        const offX = (i - 1) * 20;
        const offY = (i - 1) * 35;
        this.createMinion('blue', 'melee', 340 + offX, 800 + offY);
        this.createMinion('red', 'melee', 2060 - offX, 800 + offY);
      }

      if (isCannonWave) {
        this.createMinion('blue', 'cannon', 290, 800);
        this.createMinion('red', 'cannon', 2110, 800);
      }

      for (let i = 0; i < 3; i++) {
        const offX = (i - 1) * 20 - 55;
        const offY = (i - 1) * 35;
        this.createMinion('blue', 'caster', 340 + offX, 800 + offY);
        this.createMinion('red', 'caster', 2060 - offX, 800 + offY);
      }
    }
  }

  createMinion(team, type, x, y, lane = 'mid', waypoints = null) {
    const id = `minion_${team}_${type}_${this.nextEntityId++}`;
    let hp = 480;
    let maxHp = 480;
    let damage = 22;
    let range = 55;
    let as = 0.8;
    let speed = 150;
    let goldValue = 21;
    let radius = 16;

    if (type === 'caster') {
      hp = 300;
      maxHp = 300;
      damage = 26;
      range = 220;
      as = 0.67;
      speed = 150;
      goldValue = 14;
      radius = 14;
    } else if (type === 'cannon') {
      hp = 850;
      maxHp = 850;
      damage = 50;
      range = 270;
      as = 0.55;
      speed = 135;
      goldValue = 60;
      radius = 22;
    } else if (type === 'super') {
      hp = 1600;
      maxHp = 1600;
      damage = 110;
      range = 65;
      as = 0.85;
      speed = 140;
      goldValue = 90;
      radius = 26;
    }

    if (this.navigation) this.navigation.team = team;
    if (this.navigation && !this.navigation.isWalkable(x, y, radius)) {
      const cell = this.navigation.nearest(x, y, radius);
      if (cell >= 0) { x = this.navigation.centerX(cell); y = this.navigation.centerY(cell); }
    }
    this.minions[id] = {
      id,
      isMinion: true,
      team,
      type,
      lane,
      waypoints: waypoints ? waypoints.slice() : null,
      waypointIndex: 1,
      x,
      y,
      laneOffset: y - 800,
      vx: 0,
      vy: 0,
      angle: team === 'blue' ? 0 : Math.PI,
      radius,
      hp,
      maxHp,
      damage,
      range,
      as,
      speed,
      goldValue,
      attackCooldown: 0.5,
      attackAnimTimer: 0,
      attackSequence: 0,
      visualX: x,
      visualY: y,
      targetId: null,
      isAlive: true
    };
    return this.minions[id];
  }

  updateMinions() {
    // Wave spawn timer
    this.minionWaveTimer -= DT;
    if (this.minionWaveTimer <= 0) {
      this.minionWaveTimer = this.minionWaveInterval;
      this.spawnMinionWave();
    }

    const minionList = Object.values(this.minions);
    for (let i = 0; i < minionList.length; i++) {
      const m = minionList[i];
      if (!m.isAlive) continue;

      if (m.attackCooldown > 0) m.attackCooldown -= DT;
      if (m.attackAnimTimer > 0) m.attackAnimTimer -= DT;

      // 1. Target Validation
      let target = null;
      if (m.targetId) {
        target = this.minions[m.targetId] || this.structures[m.targetId] || this.players[m.targetId];
        if (!target || !target.isAlive || target.team === m.team) {
          m.targetId = null;
          target = null;
        } else {
          const d = Math.hypot(target.x - m.x, target.y - m.y);
          if (d > 380) {
            m.targetId = null;
            target = null;
          }
        }
      }

      // 2. Target Acquisition (LoL Aggro Priority: Minions > Structures > Champions)
      if (!m.targetId) {
        let bestTarget = null;
        let bestDist = 280;

        // 2-a. Check enemy minions
        for (let j = 0; j < minionList.length; j++) {
          const otherM = minionList[j];
          if (!otherM.isAlive || otherM.team === m.team) continue;
          const d = Math.hypot(otherM.x - m.x, otherM.y - m.y);
          if (d <= bestDist) {
            bestDist = d;
            bestTarget = otherM;
          }
        }

        // 2-b. Check enemy structures in range
        if (!bestTarget) {
          for (const s of Object.values(this.structures)) {
            if (!s.isAlive || s.team === m.team) continue;
            const d = Math.hypot(s.x - m.x, s.y - m.y);
            if (d <= 320) {
              bestTarget = s;
              break;
            }
          }
        }

        // 2-c. Check enemy champions in range
        if (!bestTarget) {
          for (const p of Object.values(this.players)) {
            if (!p.isAlive || p.team === m.team || p.stealth) continue;
            const d = Math.hypot(p.x - m.x, p.y - m.y);
            if (d <= 240) {
              bestTarget = p;
              break;
            }
          }
        }

        if (bestTarget) {
          m.targetId = bestTarget.id;
          target = bestTarget;
        }
      }

      // 3. Movement or Attack Execution
      if (target) {
        const dx = target.x - m.x;
        const dy = target.y - m.y;
        const dist = Math.hypot(dx, dy);
        m.angle = Math.atan2(dy, dx);

        const isStructureTarget = (target.type === 'turret' || target.type === 'nexus');
        const attackRangeThreshold = isStructureTarget
          ? (target.radius + m.radius + (m.type === 'melee' ? 18 : (m.type === 'cannon' ? 220 : 180)))
          : (m.range + (target.radius || 20));

        if (dist <= attackRangeThreshold) {
          // Within attack range: halt & strike!
          if (m.attackCooldown <= 0) {
            m.attackCooldown = 1 / m.as;
            m.attackAnimTimer = 0.3;
            m.attackSequence += 1;
            if (m.type === 'melee') {
              this.applyDamage(m.id, target, m.damage, 'physical', false);
            } else {
              this.spawnProjectile({
                ownerId: m.id,
                team: m.team,
                type: m.type === 'cannon' ? 'cannon_bullet' : 'minion_bolt',
                x: m.x,
                y: m.y,
                targetId: target.id,
                speed: 520,
                radius: m.type === 'cannon' ? 12 : 7,
                damage: m.damage,
                rangeRemaining: 450,
                color: m.team === 'blue' ? '#38ada9' : '#e55039'
              });
            }
          }
        } else {
          // Advance towards target (stopping precisely at attack standoff boundary)
          const step = Math.min(dist - attackRangeThreshold + 2, m.speed * DT);
          this.moveMinionOnMap(m, target.x, target.y, step);
        }
      } else {
        if (m.waypoints && m.waypoints.length > 0) {
          const wpIdx = Math.min(m.waypointIndex || 1, m.waypoints.length - 1);
          let targetWp = m.waypoints[wpIdx];
          const distToWp = Math.hypot(targetWp.x - m.x, targetWp.y - m.y);
          const reachedProjected = m.navPath?.length && m.navIndex === m.navPath.length - 1 && Math.hypot(m.navX - m.x, m.navY - m.y) < 4;
          if ((distToWp < 60 || reachedProjected) && wpIdx < m.waypoints.length - 1) {
            m.waypointIndex = wpIdx + 1;
            m.navPath = null;
            targetWp = m.waypoints[m.waypointIndex];
          }

          let marchX = targetWp.x;
          let marchY = targetWp.y;

          // Check if any alive structure lies directly in the path of march
          for (const s of Object.values(this.structures)) {
            if (this.navigation) break;
            if (!s.isAlive) continue;
            const distToS = Math.hypot(s.x - m.x, s.y - m.y);
            if (distToS < s.radius + 35) {
              const avoidAngle = Math.atan2(m.y - s.y, m.x - s.x);
              marchX = s.x + Math.cos(avoidAngle) * (s.radius + 40);
              marchY = s.y + Math.sin(avoidAngle) * (s.radius + 40);
              break;
            }
          }

          const dx = marchX - m.x;
          const dy = marchY - m.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 10) {
            m.angle = Math.atan2(dy, dx);
            const step = Math.min(dist, m.speed * DT);
            this.moveMinionOnMap(m, marchX, marchY, step);
          }
        } else {
          // Legacy 1v1 march down lane towards enemy nexus with dynamic turret avoidance
          const baseTargetX = m.team === 'blue' ? 2140 : 260;
          let marchX = baseTargetX;
          let marchY = 800 + (m.laneOffset || 0);

          for (const s of Object.values(this.structures)) {
            if (!s.isAlive) continue;
            const isAhead = (m.team === 'blue') ? (s.x > m.x && s.x - m.x < 150) : (s.x < m.x && m.x - s.x < 150);
            if (isAhead && Math.abs(m.y - s.y) < s.radius + 30) {
              const detourSide = (m.y >= s.y || (m.laneOffset || 0) >= 0) ? 1 : -1;
              marchX = s.x + (m.team === 'blue' ? 75 : -75);
              marchY = s.y + detourSide * (s.radius + 32);
              break;
            }
          }

          const dx = marchX - m.x;
          const dy = marchY - m.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 15) {
            m.angle = Math.atan2(dy, dx);
            const step = Math.min(dist, m.speed * DT);
            m.x += (dx / dist) * step;
            m.y += (dy / dist) * step;
          }
        }
      }

      // Hard structure collision resolution (strictly prevents embedding/clipping inside turrets & nexus)
      for (const s of Object.values(this.structures)) {
        if (!s.isAlive) continue;
        const sdx = m.x - s.x;
        const sdy = m.y - s.y;
        const sdist = Math.hypot(sdx, sdy);
        const minDist = s.radius + m.radius + (this.navigation ? 0 : 6);
        if (sdist < minDist) {
          const safeDist = sdist > 0.001 ? sdist : 1;
          const dirX = sdist > 0.001 ? (sdx / safeDist) : 1;
          const dirY = sdist > 0.001 ? (sdy / safeDist) : 0;
          m.x = s.x + dirX * minDist;
          m.y = s.y + dirY * minDist;
        }
      }

      // Minion-minion separation to avoid clustering
      for (let j = i + 1; j < minionList.length; j++) {
        const m2 = minionList[j];
        if (!m2.isAlive) continue;
        const sepDx = m2.x - m.x;
        const sepDy = m2.y - m.y;
        const sepDist = Math.hypot(sepDx, sepDy);
        const minDist = m.radius + m2.radius + 2;
        if (sepDist > 0 && sepDist < minDist) {
          const push = (minDist - sepDist) * 0.5;
          const nx = sepDx / sepDist;
          const ny = sepDy / sepDist;
          if (this.navigation) {
            this.navigation.team = m.team;
            this.navigation.move(m.x, m.y, m.x - nx * push, m.y - ny * push, m.radius);
            m.x = this.navigation.resultX; m.y = this.navigation.resultY;
            this.navigation.team = m2.team;
            this.navigation.move(m2.x, m2.y, m2.x + nx * push, m2.y + ny * push, m2.radius);
            m2.x = this.navigation.resultX; m2.y = this.navigation.resultY;
          } else {
            m.x -= nx * push; m.y -= ny * push;
            m2.x += nx * push; m2.y += ny * push;
          }
        }
      }
    }
    // Presentation telemetry measured after all collision/separation corrections.
    for (let i = 0; i < minionList.length; i++) {
      const m = minionList[i];
      if (this.navigation) this.navigation.team = m.team;
      if (this.navigation && m.isAlive && !this.navigation.isWalkable(m.x, m.y, m.radius)) {
        m.x = m.visualX; m.y = m.visualY;
      }
      m.vx = m.isAlive ? (m.x - (m.visualX ?? m.x)) / DT : 0;
      m.vy = m.isAlive ? (m.y - (m.visualY ?? m.y)) / DT : 0;
      m.visualX = m.x; m.visualY = m.y;
    }
  }

  // ==========================================================
  // JUNGLE MONSTERS & VISION WARDS (SCUTTLE CRAB & DRAGON)
  // ==========================================================
  updateJungleMonsters() {
    for (const key in this.jungleMonsters) {
      const monster = this.jungleMonsters[key];
      if (key === 'dragon' || key === 'scuttle') continue;
      if (!monster.isAlive) {
        monster.respawnTimer = Math.max(0, (monster.respawnTimer || 0) - DT);
        if (!monster.respawnTimer) { monster.isAlive = true; monster.hp = monster.maxHp; monster.targetId = null; }
        continue;
      }
      monster.vx = 0; monster.vy = 0;
      if (monster.type === 'scuttle' && this.navigation) {
        this.navigation.team = null;
        const nextY = monster.y + monster.speed * monster.patrolDir * DT;
        this.navigation.move(monster.x, monster.y, monster.x, nextY, monster.radius);
        monster.vx = (this.navigation.resultX - monster.x) / DT;
        monster.vy = (this.navigation.resultY - monster.y) / DT;
        monster.x = this.navigation.resultX; monster.y = this.navigation.resultY;
        if (monster.y >= monster.patrolMaxY || monster.y <= monster.patrolMinY || !monster.vy) monster.patrolDir *= -1;
        monster.angle = monster.patrolDir > 0 ? Math.PI / 2 : -Math.PI / 2;
        continue;
      }
      monster.attackCooldown = Math.max(0, (monster.attackCooldown || 0) - DT);
      const target = this.players[monster.targetId];
      if (!target?.isAlive || Math.hypot(target.x - monster.x, target.y - monster.y) > monster.range + target.radius) continue;
      if (monster.attackCooldown <= 0) {
        monster.attackCooldown = monster.attackInterval;
        monster.attackSequence = (monster.attackSequence || 0) + 1;
        monster.angle = Math.atan2(target.y - monster.y, target.x - monster.x);
        this.applyDamage(monster.id, target, monster.damage, 'physical', false);
      }
    }
    // 1. Scuttle Crab (River Patrol)
    const scuttle = this.jungleMonsters.scuttle;
    if (scuttle) {
      if (!scuttle.isAlive) {
        if (scuttle.respawnTimer > 0) {
          scuttle.respawnTimer -= DT;
          if (scuttle.respawnTimer <= 0) {
            scuttle.isAlive = true;
            scuttle.hp = scuttle.maxHp;
            scuttle.x = 1200;
            scuttle.y = 800;
          }
        }
      } else {
        // Patrol up and down the river
        scuttle.y += scuttle.speed * scuttle.patrolDir * DT;
        if (scuttle.y >= scuttle.patrolMaxY) {
          scuttle.y = scuttle.patrolMaxY;
          scuttle.patrolDir = -1;
        } else if (scuttle.y <= scuttle.patrolMinY) {
          scuttle.y = scuttle.patrolMinY;
          scuttle.patrolDir = 1;
        }
      }
    }

    // 2. Elemental Dragon (Dragon Pit Boss)
    const dragon = this.jungleMonsters.dragon;
    if (dragon) {
      if (!dragon.isAlive) {
        if (dragon.respawnTimer > 0) {
          dragon.respawnTimer -= DT;
          if (dragon.respawnTimer <= 0) {
            dragon.isAlive = true;
            dragon.hp = dragon.maxHp;
            dragon.targetId = null;
            this.eventsQueue.push({ type: 'announcer', event: 'DRAGON_SPAWNED' });
          }
        }
      } else {
        if (dragon.attackCooldown > 0) {
          dragon.attackCooldown -= DT;
        }

        // Target Acquisition (nearest enemy player in range)
        let dragonTarget = null;
        let minDist = dragon.range;
        for (const p of Object.values(this.players)) {
          if (!p.isAlive) continue;
          const dist = Math.hypot(p.x - dragon.x, p.y - dragon.y);
          if (dist <= minDist) {
            minDist = dist;
            dragonTarget = p;
          }
        }

        if (dragonTarget) {
          dragon.targetId = dragonTarget.id;
          if (dragon.attackCooldown <= 0) {
            dragon.attackCooldown = dragon.attackInterval;
            dragon.attackSequence = (dragon.attackSequence || 0) + 1;
            dragon.angle = Math.atan2(dragonTarget.y - dragon.y, dragonTarget.x - dragon.x);
            // Spawn flame breath projectile
            this.spawnProjectile({
              ownerId: dragon.id,
              team: 'neutral',
              type: 'dragon_fire',
              x: dragon.x,
              y: dragon.y,
              targetId: dragonTarget.id,
              speed: 550,
              radius: 18,
              damage: dragon.damage
            });
          }
        } else {
          dragon.targetId = null;
        }
      }
    }
  }

  updateWards() {
    for (let i = this.wards.length - 1; i >= 0; i--) {
      const w = this.wards[i];
      w.duration -= DT;
      if (w.duration <= 0) {
        this.wards.splice(i, 1);
      }
    }
  }

  // ==========================================================
  // PROGRESSION, SHOP & RECALL MECHANICS
  // ==========================================================
  recalculatePlayerStats(p) {
    const champData = CHAMPIONS[p.championId] || CHAMPIONS.blademaster;
    const lvl = (p.level || 1) - 1;

    // Base with level growth
    const baseHp = champData.stats.maxHp + lvl * 85;
    const baseMp = champData.stats.maxMp + lvl * 40;
    const baseAd = champData.stats.attackDamage + lvl * 3.5;
    const baseArmor = champData.stats.armor + lvl * 3.0;
    const baseMr = champData.stats.magicResist + lvl * 1.5;
    const baseMoveSpeed = champData.stats.moveSpeed;
    const baseAs = champData.stats.attackSpeed;

    let bonusHp = 0;
    let bonusMp = 0;
    let bonusAd = 0;
    let bonusArmor = 0;
    let bonusMoveSpeed = 0;
    let bonusAs = 0;
    let bonusLifesteal = 0;
    let bonusCritChance = 0;

    // Apply items
    if (p.items && p.items.length > 0) {
      for (const itemId of p.items) {
        const item = ITEMS[itemId];
        if (!item || !item.stats) continue;
        if (item.stats.hp) bonusHp += item.stats.hp;
        if (item.stats.mp) bonusMp += item.stats.mp;
        if (item.stats.ad) bonusAd += item.stats.ad;
        if (item.stats.armor) bonusArmor += item.stats.armor;
        if (item.stats.moveSpeed) bonusMoveSpeed += item.stats.moveSpeed;
        if (item.stats.attackSpeed) bonusAs += item.stats.attackSpeed;
        if (item.stats.lifesteal) bonusLifesteal += item.stats.lifesteal;
        if (item.stats.critChance) bonusCritChance += item.stats.critChance;
      }
    }

    // Dragon buff (+12% AD per stack)
    const dragonMult = 1 + (p.dragonBuffStacks || 0) * 0.12;

    p.maxHp = Math.round(baseHp + bonusHp);
    p.maxMp = (p.championId === 'garen' || p.championId === 'yasuo') ? 0 : Math.round(baseMp + bonusMp);
    p.baseAd = Math.round((baseAd + bonusAd) * dragonMult);
    p.ad = p.baseAd;
    p.armor = Math.round(baseArmor + bonusArmor + (p.garen?.wResists || 0));
    p.mr = Math.round(baseMr + (p.garen?.wResists || 0));
    p.baseMoveSpeed = baseMoveSpeed + bonusMoveSpeed;
    p.moveSpeed = p.baseMoveSpeed;
    p.baseAs = Number((baseAs * (1 + bonusAs)).toFixed(2));
    p.as = p.baseAs;
    p.lifesteal = bonusLifesteal;
    p.critChance = p.championId === 'yasuo' ? Math.min(1, bonusCritChance * 2.5) : bonusCritChance;
  }

  addExp(p, amount) {
    if (!p || !p.isAlive || p.level >= 18) return;
    p.exp = (p.exp || 0) + amount;
    let leveledUp = false;
    while (p.level < 18 && p.exp >= p.maxExp) {
      p.exp -= p.maxExp;
      p.level += 1;
      p.skillPoints = (p.skillPoints || 0) + 1;
      p.maxExp = Math.round(280 + p.level * 105);
      leveledUp = true;
    }
    if (leveledUp) {
      this.recalculatePlayerStats(p);
      p.hp = Math.min(p.maxHp, p.hp + 120);
      p.mp = Math.min(p.maxMp, p.mp + 60);
      this.eventsQueue.push({
        type: 'level_up',
        playerId: p.id,
        level: p.level,
        x: p.x,
        y: p.y
      });
      this.eventsQueue.push({
        type: 'announcer',
        event: 'LEVEL_UP',
        level: p.level,
        playerName: p.nickname
      });
    }
  }

  handleUpgradeSkill(socketId, key) {
    const p = this.players[socketId];
    if (!p || !p.isAlive || (p.skillPoints || 0) <= 0) return { success: false, error: '스킬 포인트가 없습니다.' };
    const k = (key || '').toUpperCase();
    if (!['Q', 'W', 'E', 'R'].includes(k)) return { success: false, error: '유효하지 않은 스킬입니다.' };
    p.skillRanks = p.skillRanks || { Q: 1, W: 0, E: 0, R: 0 };
    const curRank = p.skillRanks[k] || 0;
    if (k === 'R') {
      if (curRank >= 3) return { success: false, error: '궁극기는 최대 3레벨입니다.' };
      if (curRank === 0 && p.level < 6) return { success: false, error: '궁극기는 6레벨에 배울 수 있습니다.' };
      if (curRank === 1 && p.level < 11) return { success: false, error: '궁극기 2레벨은 11레벨에 배울 수 있습니다.' };
      if (curRank === 2 && p.level < 16) return { success: false, error: '궁극기 3레벨은 16레벨에 배울 수 있습니다.' };
    } else {
      if (curRank >= 5) return { success: false, error: '스킬은 최대 5레벨입니다.' };
      if ((p.championId === 'garen' || p.championId === 'yasuo') && curRank + 1 > Math.ceil(p.level / 2)) {
        return { success: false, error: '현재 챔피언 레벨에서 스킬 랭크를 더 올릴 수 없습니다.' };
      }
    }
    p.skillRanks[k] = curRank + 1;
    p.skillPoints -= 1;
    this.eventsQueue.push({
      type: 'skill_level_up',
      playerId: p.id,
      key: k,
      rank: p.skillRanks[k],
      skillPoints: p.skillPoints
    });
    return { success: true, skillRanks: p.skillRanks, skillPoints: p.skillPoints };
  }

  handleRecall(socketId) {
    const p = this.players[socketId];
    if (!p || !p.isAlive || p.recalling) return { success: false };
    p.recalling = true;
    p.recallTimer = 8.0;
    p.targetX = p.x;
    p.targetY = p.y;
    this.eventsQueue.push({
      type: 'recall_start',
      playerId: p.id,
      x: p.x,
      y: p.y
    });
    return { success: true };
  }

  cancelRecall(p) {
    if (p && p.recalling) {
      p.recalling = false;
      p.recallTimer = 0;
      this.eventsQueue.push({
        type: 'recall_cancel',
        playerId: p.id
      });
    }
  }

  handleBuyItem(socketId, itemId) {
    const p = this.players[socketId];
    if (!p || !p.isAlive) return { success: false, error: '사망 중에는 구매할 수 없습니다.' };
    const item = ITEMS[itemId];
    if (!item) return { success: false, error: '존재하지 않는 아이템입니다.' };

    const base = this.map.bases[p.team];
    const distToBase = Math.hypot(p.x - base.x, p.y - base.y);
    if (distToBase > 350) {
      return { success: false, error: '본진 제단 근처에서만 아이템을 구매할 수 있습니다.' };
    }

    p.items = p.items || [];
    if (p.items.length >= 6) {
      return { success: false, error: '인벤토리 6칸이 가득 찼습니다.' };
    }

    if ((p.gold || 0) < item.cost) {
      return { success: false, error: '골드가 부족합니다.' };
    }

    p.gold -= item.cost;
    p.items.push(item.id);
    this.recalculatePlayerStats(p);

    this.eventsQueue.push({
      type: 'item_bought',
      playerId: p.id,
      itemId: item.id,
      itemName: item.name
    });
    return { success: true, items: p.items, gold: p.gold };
  }

  handleSellItem(socketId, slotIndex) {
    const p = this.players[socketId];
    if (!p || !p.isAlive) return { success: false, error: '플레이어를 찾을 수 없습니다.' };

    const base = this.map.bases[p.team];
    const distToBase = Math.hypot(p.x - base.x, p.y - base.y);
    if (distToBase > 350) {
      return { success: false, error: '본진 제단 근처에서만 아이템을 판매할 수 있습니다.' };
    }

    p.items = p.items || [];
    if (slotIndex < 0 || slotIndex >= p.items.length) {
      return { success: false, error: '아이템 슬롯이 비어있습니다.' };
    }

    const itemId = p.items[slotIndex];
    const item = ITEMS[itemId];
    const refund = Math.floor(item.cost * 0.7);
    p.gold = (p.gold || 0) + refund;
    p.items.splice(slotIndex, 1);
    this.recalculatePlayerStats(p);

    return { success: true, items: p.items, gold: p.gold };
  }

  handlePlaceWard(socketId, x, y) {
    const p = this.players[socketId];
    if (!p || !p.isAlive) return { success: false };
    if (p.wardCooldown > 0) return { success: false, error: '와드 장신구 쿨다운 중입니다.' };

    p.wardCooldown = 60.0;
    const wardId = `ward_${this.nextEntityId++}`;
    const ward = {
      id: wardId,
      team: p.team,
      ownerId: p.id,
      x: Math.max(60, Math.min(this.map.width - 60, x)),
      y: Math.max(60, Math.min(this.map.height - 60, y)),
      radius: 300,
      duration: 90.0
    };
    this.wards.push(ward);
    this.eventsQueue.push({
      type: 'ward_placed',
      wardId: ward.id,
      team: ward.team,
      x: ward.x,
      y: ward.y
    });
    return { success: true };
  }

  // ==========================================================
  // TURRET AI & TARGETING LASER SYSTEM
  // ==========================================================
  updateTurrets() {
    this.updateStructureInvulnerability();
    const uniqueStructures = Array.from(new Set(Object.values(this.structures)));
    for (const turret of uniqueStructures) {
      if (turret.type !== 'turret' || !turret.isAlive) {
        turret.targetId = null;
        continue;
      }

      if (turret.attackCooldown > 0) {
        turret.attackCooldown -= DT;
      }

      // Check current target validity
      let currentTarget = null;
      if (turret.targetId) {
        currentTarget = this.minions[turret.targetId] || this.players[turret.targetId];
        if (!currentTarget || !currentTarget.isAlive || currentTarget.team === turret.team) {
          turret.targetId = null;
          currentTarget = null;
        } else {
          const dist = Math.hypot(currentTarget.x - turret.x, currentTarget.y - turret.y);
          if (dist > turret.range) {
            turret.targetId = null;
            currentTarget = null;
          }
        }
      }

      // Target selection if no target (Cannon Minion > Melee Minion > Caster Minion > Champion)
      if (!currentTarget) {
        let bestMinion = null;
        let bestMinionDist = turret.range;
        for (const m of Object.values(this.minions)) {
          if (!m.isAlive || m.team === turret.team) continue;
          const dist = Math.hypot(m.x - turret.x, m.y - turret.y);
          if (dist <= turret.range) {
            if (!bestMinion) {
              bestMinion = m;
              bestMinionDist = dist;
            } else if (m.type === 'cannon' && bestMinion.type !== 'cannon') {
              bestMinion = m;
            } else if (m.type === 'melee' && bestMinion.type === 'caster') {
              bestMinion = m;
            } else if (dist < bestMinionDist) {
              bestMinion = m;
              bestMinionDist = dist;
            }
          }
        }

        if (bestMinion) {
          currentTarget = bestMinion;
          turret.targetId = bestMinion.id;
        } else {
          // Closest enemy champion
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
            currentTarget = closestEnemy;
            turret.targetId = closestEnemy.id;
          }
        }
      }

      // Attack execution
      if (currentTarget && turret.attackCooldown <= 0) {
        turret.attackCooldown = turret.attackInterval;
        turret.attackSequence = (turret.attackSequence || 0) + 1;
        // Fire turret missile
        this.spawnProjectile({
          ownerId: turret.id,
          team: turret.team,
          type: 'turret_bullet',
          x: turret.x,
          y: turret.y,
          targetId: currentTarget.id,
          speed: 680,
          radius: 14,
          damage: turret.damage,
          rangeRemaining: 650,
          color: turret.team === 'blue' ? '#38ada9' : '#e55039'
        });
      }
    }
  }

  updateAutoAttacks() {
    for (const p of Object.values(this.players)) {
      if (!p.isAlive || p.isStunned) continue;
      if (p.garen?.eRemaining > 0 || p.garen?.rRemaining > 0 || p.yasuo?.rRemaining > 0 || p.yasuo?.eRemaining > 0) continue;

      // Auto-target acquisition ONLY if idle or in explicit attack-move mode
      if (!p.targetEnemyId && !p.stealth) {
        const isIdle = Math.hypot(p.targetX - p.x, p.targetY - p.y) < 6;
        if (p.isAttackMove) {
          // Explicit Attack-Move ('A' key click): search and chase nearest enemy
          let nearestEnemy = null;
          let nearestDist = p.attackRange + 150;
          for (const ep of Object.values(this.players)) {
            if (!ep.isAlive || ep.team === p.team || ep.stealth) continue;
            const ed = Math.hypot(ep.x - p.x, ep.y - p.y);
            if (ed <= nearestDist) {
              nearestDist = ed;
              nearestEnemy = ep;
            }
          }
          if (!nearestEnemy) {
            for (const m of Object.values(this.minions)) {
              if (!m.isAlive || m.team === p.team) continue;
              const md = Math.hypot(m.x - p.x, m.y - p.y);
              if (md <= nearestDist) {
                nearestDist = md;
                nearestEnemy = m;
              }
            }
          }
          if (nearestEnemy) {
            p.targetEnemyId = nearestEnemy.id;
            p.isAttackMove = false;
            p.isAutoIdleTarget = false;
          }
        } else if (isIdle) {
          // Pure Idle: ONLY attack enemies ALREADY inside attack range (NEVER CHASE!)
          let enemyInRange = null;
          let bestDist = p.attackRange;
          for (const ep of Object.values(this.players)) {
            if (!ep.isAlive || ep.team === p.team || ep.stealth) continue;
            const ed = Math.hypot(ep.x - p.x, ep.y - p.y);
            if (ed <= p.attackRange && ed <= bestDist) {
              bestDist = ed;
              enemyInRange = ep;
            }
          }
          if (!enemyInRange) {
            for (const m of Object.values(this.minions)) {
              if (!m.isAlive || m.team === p.team) continue;
              const md = Math.hypot(m.x - p.x, m.y - p.y);
              if (md <= p.attackRange && md <= bestDist) {
                bestDist = md;
                enemyInRange = m;
              }
            }
          }
          if (enemyInRange) {
            p.targetEnemyId = enemyInRange.id;
            p.isAutoIdleTarget = true; // Mark as standing-attack (no chasing allowed!)
          }
        }
      }

      if (!p.targetEnemyId) continue;

      const target = this.findCombatTarget(p.targetEnemyId);
      if (!target || !target.isAlive || target.team === p.team) {
        p.targetEnemyId = null;
        p.isAutoIdleTarget = false;
        continue;
      }

      const dist = Math.hypot(target.x - p.x, target.y - p.y);
      const attackRangeThreshold = p.attackRange + (target.radius || 20) + (p.garen?.qRemaining > 0 ? 25 : 0);

      if (dist > attackRangeThreshold) {
        if (p.isAutoIdleTarget) {
          // Idle attack target left range: DROP TARGET, DO NOT MOVE!
          p.targetEnemyId = null;
          p.isAutoIdleTarget = false;
          continue;
        }
        // Explicit attack command: chase target
        p.targetX = target.x;
        p.targetY = target.y;
      } else {
        // Within range: halt movement only if explicitly attacking
        if (!p.isAutoIdleTarget) {
          p.targetX = p.x;
          p.targetY = p.y;
          p.vx = 0;
          p.vy = 0;
        }
        p.angle = Math.atan2(target.y - p.y, target.x - p.x);

        if (p.autoAttackCooldown <= 0) {
          p.autoAttackCooldown = 1 / p.as;

          // Broadcast attack event for animations & sounds
          this.eventsQueue.push({
            type: 'attack',
            attackerId: p.id,
            targetId: target.id,
            isRanged: p.attackRange > 150 && p.championId !== 'yasuo',
            x: p.x,
            y: p.y
          });

          if (p.attackRange <= 150 || p.championId === 'yasuo') {
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
    if (attacker.yasuo && Math.random() < (attacker.critChance || 0)) { rawDamage *= 1.8; isCrit = true; }

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

    rawDamage = Garen.empowerAttack(this, attacker, target, rawDamage);

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
      if (proj.type === 'yasuo_tornado') {
        if (Yasuo.projectile(this, proj, DT)) this.projectiles.splice(i, 1);
        continue;
      }
      // Test the full travel segment before any damage, so fast missiles cannot
      // tunnel through Wind Wall between simulation frames.
      let nextX = proj.x + (proj.vx || 0) * proj.speed * DT;
      let nextY = proj.y + (proj.vy || 0) * proj.speed * DT;
      if (proj.targetId) {
        const wallTarget = this.findCombatTarget(proj.targetId);
        if (wallTarget) {
          const dx = wallTarget.x - proj.x, dy = wallTarget.y - proj.y;
          const distance = Math.hypot(dx, dy), step = Math.min(distance, proj.speed * DT);
          nextX = proj.x + dx / (distance || 1) * step; nextY = proj.y + dy / (distance || 1) * step;
        }
      }
      if (Yasuo.blocked(this, proj, nextX, nextY)) { this.projectiles.splice(i, 1); continue; }

      // Homing target (turret missile, ranged auto attack)
      if (proj.targetId) {
        const target = this.findCombatTarget(proj.targetId);
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

        // Minion collision for skillshots
        if (!hit && !proj.piercing) {
          for (const m of Object.values(this.minions)) {
            if (!m.isAlive || m.team === proj.team) continue;
            const dist = Math.hypot(m.x - proj.x, m.y - proj.y);
            if (dist < proj.radius + m.radius) {
              this.applyDamage(proj.ownerId, m, proj.damage, 'magic', false);
              hit = true;
              break;
            }
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
        if (proj.rangeRemaining <= 0 || proj.x < 0 || proj.x > this.map.width || proj.y < 0 || proj.y > this.map.height) {
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
    if (!target || !target.isAlive || target.isImmune || target.isInvulnerable) return;
    if (target.team === 'neutral' && target.type !== 'scuttle' && this.players[attackerId] && rawAmount > 0) target.targetId = attackerId;
    Garen.onDamage(this, target, attackerId, rawAmount);
    Yasuo.onDamage(this, target, attackerId, rawAmount);

    // Berserker Ragnarok Check: Cannot die below 1 HP
    const isUndying = target.statusEffects && target.statusEffects.some(e => e.type === 'IMMUNE' || e.type === 'UNDYING');

    // Recall Cancellation on Damage
    this.cancelRecall(target);
    target.revealedTimer = 1.5;

    // Attacker State Handling
    const attacker = this.players[attackerId];
    if (attacker) {
      this.cancelRecall(attacker);
      attacker.revealedTimer = 1.5;

      // TURRET DIVE DEFENSE (Call for Help)
      // If enemy champion damages an allied champion near an allied turret, turret immediately swaps aggro!
      if (target.championId && attacker.team !== target.team) {
        for (const turret of Object.values(this.structures)) {
          if (turret.type === 'turret' && turret.isAlive && turret.team === target.team) {
            const distTargetToTurret = Math.hypot(target.x - turret.x, target.y - turret.y);
            const distAttackerToTurret = Math.hypot(attacker.x - turret.x, attacker.y - turret.y);
            if (distTargetToTurret <= turret.range && distAttackerToTurret <= turret.range) {
              turret.targetId = attacker.id;
              this.eventsQueue.push({
                type: 'turret_dive_alert',
                turretId: turret.id,
                targetId: attacker.id,
                x: turret.x,
                y: turret.y
              });
              break;
            }
          }
        }
      }
    }

    // Armor / MR Reduction
    let finalAmount = rawAmount;
    if (type === 'physical') {
      const shred = target.statusEffects?.find(e => e.type === 'GAREN_ARMOR_SHRED' && e.duration > 0);
      const arm = Math.max(0, target.armor ?? 25) * (shred ? 1 - shred.value : 1);
      finalAmount = rawAmount * (100 / (100 + arm));
    } else if (type === 'magic') {
      const res = Math.max(0, target.mr ?? 25);
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
    if (target.yasuo?.shield > 0) target.yasuo.shield = Math.max(0, target.yasuo.shield - Math.min(target.shield || 0, finalAmount));
    if (target.garen?.wRemaining > 0 && type !== 'true') finalAmount *= 0.7;
    if (target.garen?.wShield > 0) {
      target.garen.wShield = Math.max(0, target.garen.wShield - Math.min(target.shield || 0, finalAmount));
    }
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
    Garen.reset(this, victim);
    Yasuo.reset(this, victim);

    const killer = this.players[killerId];
    Garen.onKill(this, killer, victim);

    // 1. Nexus Destruction
    if (victim.type === 'nexus') {
      const winningTeam = victim.team === 'blue' ? 'red' : 'blue';
      this.room.endGame(winningTeam, `${winningTeam === 'blue' ? '블루 팀' : '레드 팀'}이 상대 넥서스를 파괴하여 승리했습니다!`);
      return;
    }

    // 1-b. Inhibitor Destruction
    if (victim.type === 'inhibitor') {
      victim.respawnTimer = 180.0;
      if (killer) {
        for (const p of Object.values(this.players)) {
          if (p.team === killer.team) {
            p.gold = (p.gold || 0) + 150;
            this.addExp(p, 100);
          }
        }
      }
      this.eventsQueue.push({
        type: 'announcer',
        event: 'INHIBITOR_DESTROYED',
        team: victim.team,
        inhibitorName: victim.name
      });
      return;
    }

    // 2. Jungle Monsters (Scuttle Crab & Elemental Dragon)
    if (victim.type === 'scuttle') {
      victim.respawnTimer = 120.0;
      if (killer) {
        killer.gold = (killer.gold || 0) + victim.goldValue;
        this.addExp(killer, victim.expValue);
      }
      this.eventsQueue.push({
        type: 'announcer',
        event: 'SCUTTLE_SLAIN',
        killerName: killer ? killer.nickname : '미니언'
      });
      return;
    }

    if (victim.type === 'dragon') {
      victim.respawnTimer = 180.0;
      if (killer) {
        killer.gold = (killer.gold || 0) + victim.goldValue;
        // Grant Dragon Slayer buff to all alive allies
        for (const p of Object.values(this.players)) {
          if (p.team === killer.team) {
            p.gold = (p.gold || 0) + 75;
            p.dragonBuffStacks = (p.dragonBuffStacks || 0) + 1;
            this.recalculatePlayerStats(p);
          }
        }
      }
      this.eventsQueue.push({
        type: 'announcer',
        event: 'DRAGON_SLAIN',
        team: killer ? killer.team : 'neutral',
        killerName: killer ? killer.nickname : '미니언'
      });
      return;
    }

    // Neutral camps never count as champion kills or alter the match score.
    if (victim.team === 'neutral') {
      victim.respawnTimer = victim.type === 'baron' ? 180 : 120;
      victim.targetId = null;
      if (killer) { killer.gold += victim.goldValue || 0; this.addExp(killer, victim.expValue || 0); }
      return;
    }

    // 3. Minion Death (Gold & EXP Area Distribution)
    if (victim.isMinion) {
      if (killer) {
        killer.cs = (killer.cs || 0) + 1;
        const goldGain = victim.goldValue || 21;
        killer.gold = (killer.gold || 0) + goldGain;
        this.eventsQueue.push({
          type: 'gold',
          targetId: killer.id,
          amount: goldGain,
          x: victim.x,
          y: victim.y
        });
      }

      // Distribute EXP to all allied champions in 800px radius
      const enemyTeamOfMinion = victim.team === 'blue' ? 'red' : 'blue';
      const alliesInRange = Object.values(this.players).filter(p => p.isAlive && p.team === enemyTeamOfMinion && Math.hypot(p.x - victim.x, p.y - victim.y) <= 800);
      if (alliesInRange.length > 0) {
        const expShare = Math.round((victim.expValue || 55) / alliesInRange.length);
        for (const ally of alliesInRange) {
          this.addExp(ally, expShare);
        }
      }

      setTimeout(() => {
        delete this.minions[victim.id];
      }, 1500);
      return;
    }

    // 4. Turret Destruction
    if (victim.type === 'turret') {
      if (killer) {
        for (const p of Object.values(this.players)) {
          if (p.team === killer.team) {
            p.gold = (p.gold || 0) + 250;
            this.addExp(p, 150);
          }
        }
      }
      this.eventsQueue.push({
        type: 'kill',
        killerName: killer ? killer.nickname : '미니언',
        victimName: victim.name,
        killerTeam: killer ? killer.team : 'neutral',
        victimTeam: victim.team
      });
      this.eventsQueue.push({
        type: 'announcer',
        event: 'TURRET_DESTROYED',
        team: victim.team,
        turretName: victim.name
      });
      return;
    }

    // 5. Champion Death (KDA, EXP, First Blood & Multi-Kill Streaks)
    victim.deaths++;
    victim.respawnTimer = 7.0; // 7s respawn

    if (killer) {
      killer.kills++;
      this.scores[killer.team]++;
      killer.gold = (killer.gold || 0) + 300;
      this.addExp(killer, 300);

      // First Blood Check
      if (!this.firstBloodClaimed) {
        this.firstBloodClaimed = true;
        killer.gold += 100; // 100 bonus first blood gold
        this.eventsQueue.push({
          type: 'announcer',
          event: 'FIRST_BLOOD',
          killerName: killer.nickname,
          victimName: victim.nickname,
          killerTeam: killer.team
        });
      }

      // Multi-Kill Tracking (within 12 seconds)
      const now = this.gameTime;
      if (killer.lastKillTime && (now - killer.lastKillTime <= 12)) {
        killer.killStreak = (killer.killStreak || 1) + 1;
      } else {
        killer.killStreak = 1;
      }
      killer.lastKillTime = now;

      if (killer.killStreak === 2) {
        this.eventsQueue.push({ type: 'announcer', event: 'DOUBLE_KILL', killerName: killer.nickname, team: killer.team });
      } else if (killer.killStreak === 3) {
        this.eventsQueue.push({ type: 'announcer', event: 'TRIPLE_KILL', killerName: killer.nickname, team: killer.team });
      } else if (killer.killStreak >= 4) {
        this.eventsQueue.push({ type: 'announcer', event: 'PENTAKILL', killerName: killer.nickname, team: killer.team });
      }

      // ACE Check (if all enemy champions are dead)
      const enemyTeam = victim.team;
      const allEnemiesDead = Object.values(this.players).filter(p => p.team === enemyTeam).every(p => !p.isAlive);
      if (allEnemiesDead) {
        this.eventsQueue.push({ type: 'announcer', event: 'ACE', team: killer.team });
      }
    }

    // Demolitionist Passive: Last Laugh
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
    Garen.reset(this, p);
    Yasuo.reset(this, p);
    p.isAlive = true;
    p.hp = p.maxHp;
    p.mp = p.maxMp;
    p.statusEffects = [];
    p.isSilenced = false;
    const base = this.map.bases[p.team];
    p.x = base.spawnX;
    p.y = base.spawnY;
    p.navPath = null;
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
  findCombatTarget(id) {
    const direct = this.players[id] || this.structures[id] || this.minions[id];
    if (direct) return direct;
    for (const key in this.jungleMonsters) if (this.jungleMonsters[key].id === id) return this.jungleMonsters[key];
    return null;
  }

  handleMoveInput(socketId, targetX, targetY) {
    const p = this.players[socketId];
    if (!p || !p.isAlive || p.isStunned || p.isRooted || p.garen?.rRemaining > 0 || p.yasuo?.rRemaining > 0 || p.yasuo?.eRemaining > 0) return;
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return;
    this.cancelRecall(p);
    p.navPath = null;
    p.targetX = Math.max(20, Math.min(this.map.width - 20, targetX));
    p.targetY = Math.max(20, Math.min(this.map.height - 20, targetY));
    p.targetEnemyId = null; // moving clears auto-attack target unless targeted click
    p.isAttackMove = false;
    p.isAutoIdleTarget = false;
  }

  handleAttackTarget(socketId, targetId) {
    const p = this.players[socketId];
    if (!p || !p.isAlive || p.isStunned) return;
    this.cancelRecall(p);
    p.revealedTimer = 1.5;
    p.targetEnemyId = targetId;
    p.isAttackMove = false;

    // If out of range, immediately set target coordinates towards enemy
    const target = this.findCombatTarget(targetId);
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
    this.cancelRecall(p);

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
      p.targetX = Math.max(20, Math.min(this.map.width - 20, targetX));
      p.targetY = Math.max(20, Math.min(this.map.height - 20, targetY));
      p.targetEnemyId = null;
      p.isAttackMove = true;
    }
  }

  handleStop(socketId) {
    const p = this.players[socketId];
    if (!p || !p.isAlive) return;
    this.cancelRecall(p);
    p.targetX = p.x;
    p.targetY = p.y;
    p.vx = 0;
    p.vy = 0;
    p.targetEnemyId = null;
    p.isAttackMove = false;
    p.navPath = null; p.navX = p.x; p.navY = p.y;
  }

  handleCastSkill(socketId, skillKey, targetX, targetY, targetId) {
    const p = this.players[socketId];
    if (!p || !p.isAlive || p.isStunned || p.isSilenced || p.statusEffects.some(e => e.type === 'SILENCE' && e.duration > 0)) return false;
    if (p.championId === 'garen') return Garen.cast(this, p, skillKey, targetX, targetY, targetId);
    if (p.championId === 'yasuo') return Yasuo.cast(this, p, skillKey, targetX, targetY, targetId);
    this.cancelRecall(p);
    p.revealedTimer = 1.5;

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
      this.resolvePlayerMovement(p, nx, ny, true);
      p.navPath = null;
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

    // Garen is validated and executed by GarenMechanics before this dispatcher.
    if (p.championId === 'garen' || p.championId === 'yasuo') return;

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
        this.resolvePlayerMovement(p, p.x + dirX * jumpDist, p.y + dirY * jumpDist, true);
        p.navPath = null;
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
            this.resolvePlayerMovement(ep, ep.x + pushDirX * skill.knockbackDist, ep.y + pushDirY * skill.knockbackDist);
            ep.navPath = null;
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
        this.resolvePlayerMovement(p, p.x + dirX * blinkDist, p.y + dirY * blinkDist, true);
        p.navPath = null;
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
          this.resolvePlayerMovement(p, bestTarget.x - dirX * 50, bestTarget.y - dirY * 50, true);
          p.navPath = null;
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
        this.resolvePlayerMovement(p, p.x + dirX * dashDist, p.y + dirY * dashDist, false);
        p.navPath = null;
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
            this.resolvePlayerMovement(ep, pushX, pushY);
            ep.navPath = null;
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
        this.resolvePlayerMovement(p, p.x + dirX * dashDist, p.y + dirY * dashDist, false);
        p.navPath = null;
        p.targetX = p.x;
        p.targetY = p.y;
        this.createAoeBlast(p.id, p.team, p.x, p.y, 140, skill.damage, 'SLOW', skill.slowDuration);
      } else if (key === 'R') {
        // Rising Dragon Fist
        const jumpDist = Math.min(dist, skill.range);
        this.resolvePlayerMovement(p, p.x + dirX * jumpDist, p.y + dirY * jumpDist, true);
        p.navPath = null;
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
          this.resolvePlayerMovement(p, p.x + sDirX * skill.knockbackDist, p.y + sDirY * skill.knockbackDist);
          p.navPath = null;
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
      isSummonersRift: !!this.map.isSummonersRift,
      obstacles: this.map.obstacles,
      bushes: this.map.bushes,
      bases: this.map.bases,
      navigation: this.navigation ? this.navigation.data : null,
      originalMap: this.navigation ? { url: '/assets/maps/summoners-rift/map.glb', scale: 3200 / 15000, sourceSize: 15000 } : null
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
        vx: p.vx,
        vy: p.vy,
        navX: p.navX,
        navY: p.navY,
        angle: p.angle,
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
        mp: Math.round(p.mp),
        maxMp: p.maxMp,
        shield: Math.round(p.shield || 0),
        isAlive: p.isAlive,
        isSilenced: !!p.isSilenced,
        airborneRemaining: p.statusEffects.reduce((remaining, e) => e.type === 'AIRBORNE' ? Math.max(remaining, e.duration) : remaining, 0),
        yasuo: p.yasuo ? { qStacks: p.yasuo.qStacks, qRemaining: p.yasuo.qRemaining, eRemaining: p.yasuo.eRemaining, rRemaining: p.yasuo.rRemaining, flow: p.yasuo.flow, shieldRemaining: p.yasuo.shieldRemaining } : null,
        garen: p.garen ? {
          qRemaining: p.garen.qRemaining,
          wRemaining: p.garen.wRemaining,
          eRemaining: p.garen.eRemaining,
          rRemaining: p.garen.rRemaining
        } : null,
        respawnTimer: Math.ceil(p.respawnTimer),
        cooldowns: p.cooldowns,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        cs: p.cs || 0,
        gold: p.gold || 500,
        spellD: p.spellD,
        spellF: p.spellF,
        stealth: p.stealth,
        level: p.level || 1,
        exp: Math.round(p.exp || 0),
        maxExp: p.maxExp || 280,
        skillPoints: p.skillPoints || 0,
        skillRanks: p.skillRanks || { Q: 1, W: 0, E: 0, R: 0 },
        items: p.items || [],
        recalling: !!p.recalling,
        recallProgress: p.recallTimer ? Number((1 - p.recallTimer / 8.0).toFixed(2)) : 0,
        inBush: !!p.inBush,
        bushId: p.bushId || null,
        revealed: p.revealedTimer > 0,
        wardCooldown: Math.ceil(p.wardCooldown || 0),
        dragonBuffStacks: p.dragonBuffStacks || 0,
        ad: Math.round(p.ad || p.baseAd),
        armor: Math.round(p.armor || 30),
        as: Number((p.as || p.baseAs).toFixed(2)),
        moveSpeed: Math.round(p.moveSpeed || p.baseMoveSpeed)
      })),
      structures: Array.from(new Set(Object.values(this.structures))).map(s => ({
        id: s.id,
        name: s.name,
        team: s.team,
        type: s.type,
        lane: s.lane || null,
        tier: s.tier || null,
        x: s.x,
        y: s.y,
        height: s.height,
        rotation: s.rotation,
        radius: s.radius,
        range: s.range || 380,
        hp: Math.round(s.hp),
        maxHp: s.maxHp,
        targetId: s.targetId || null,
        attackSequence: s.attackSequence || 0,
        isAlive: s.isAlive,
        isInvulnerable: !!s.isInvulnerable,
        respawnTimer: s.respawnTimer ? Math.ceil(s.respawnTimer) : 0
      })),
      jungleMonsters: Object.values(this.jungleMonsters).map(jm => ({
        id: jm.id,
        name: jm.name,
        type: jm.type,
        attackSequence: jm.attackSequence || 0,
        vx: jm.vx || 0,
        vy: jm.vy || 0,
        speed: jm.speed || 150,
        as: jm.attackInterval ? 1 / jm.attackInterval : 1,
        angle: jm.angle,
        team: jm.team,
        x: Math.round(jm.x),
        y: Math.round(jm.y),
        hp: Math.round(jm.hp),
        maxHp: jm.maxHp,
        radius: jm.radius,
        targetId: jm.targetId || null,
        isAlive: jm.isAlive
      })),
      wards: this.wards.map(w => ({
        id: w.id,
        team: w.team,
        ownerId: w.ownerId,
        x: Math.round(w.x),
        y: Math.round(w.y),
        radius: w.radius,
        duration: Math.ceil(w.duration)
      })),
      minions: Object.values(this.minions).filter(m => m.isAlive).map(m => ({
        id: m.id,
        team: m.team,
        type: m.type,
        lane: m.lane || 'mid',
        x: Math.round(m.x),
        y: Math.round(m.y),
        angle: Number(m.angle.toFixed(2)),
        hp: Math.round(m.hp),
        maxHp: m.maxHp,
        isAttacking: m.attackAnimTimer > 0,
        attackSequence: m.attackSequence || 0,
        vx: m.vx || 0, vy: m.vy || 0, speed: m.speed, as: m.as, targetId: m.targetId || null
      })),
      yasuoWalls: this.yasuoWalls.map(w => ({ ...w })),
      projectiles: this.projectiles.map(pr => ({
        id: pr.id,
        ownerId: pr.ownerId,
        type: pr.type,
        x: Math.round(pr.x),
        y: Math.round(pr.y),
        radius: pr.radius,
        angle: Math.atan2(pr.vy || 0, pr.vx || 0),
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
