/**
 * ItemData.js
 * League of Legends Classic Hextech Items Definition
 */

const ITEMS = {
  dorans_blade: {
    id: 'dorans_blade',
    name: "도란의 검 (Doran's Blade)",
    cost: 450,
    icon: '🗡️',
    stats: {
      ad: 10,
      hp: 80,
      lifesteal: 0.03
    },
    desc: '기본 공격력 +10, 체력 +80. 입힌 물리 피해의 3%를 체력으로 흡혈합니다.'
  },
  dorans_ring: {
    id: 'dorans_ring',
    name: "도란의 반지 (Doran's Ring)",
    cost: 400,
    icon: '💍',
    stats: {
      ad: 8,
      mp: 100,
      hp: 70,
      mpRegen: 2.5
    },
    desc: '공격력/주문력 +8, 마나 +100, 체력 +70, 마나 재생 +2.5.'
  },
  berserkers_greaves: {
    id: 'berserkers_greaves',
    name: "광전사의 군화 (Berserker's Greaves)",
    cost: 1100,
    icon: '👟',
    stats: {
      moveSpeed: 45,
      attackSpeed: 0.35
    },
    desc: '이동 속도 +45, 공격 속도 +35%.'
  },
  serrated_dirk: {
    id: 'serrated_dirk',
    name: '톱날 단검 (Serrated Dirk)',
    cost: 1000,
    icon: '🔪',
    stats: {
      ad: 30,
      armorPen: 10
    },
    desc: '공격력 +30, 물리 관통력 +10.'
  },
  bork: {
    id: 'bork',
    name: '몰락한 왕의 검 (Blade of the Ruined King)',
    cost: 3200,
    icon: '⚔️',
    stats: {
      ad: 40,
      attackSpeed: 0.25,
      currentHpDmg: 0.06
    },
    desc: '공격력 +40, 공격 속도 +25%. 기본 공격 시 대상 현재 체력의 6% 추가 물리 피해.'
  },
  infinity_edge: {
    id: 'infinity_edge',
    name: '무한의 대검 (Infinity Edge)',
    cost: 3400,
    icon: '👑',
    stats: {
      ad: 70,
      critChance: 0.25,
      critDamageBonus: 0.35
    },
    desc: '공격력 +70, 치명타 확률 +25%, 치명타 적중 시 피해량 +35% 증폭.'
  },
  zhonyas: {
    id: 'zhonyas',
    name: "존야의 모래시계 (Zhonya's Hourglass)",
    cost: 3000,
    icon: '⏳',
    stats: {
      ad: 30,
      armor: 45,
      maxMp: 150
    },
    desc: '공격력 +30, 방어력 +45, 최대 마나 +150.'
  },
  warmogs: {
    id: 'warmogs',
    name: "워모그의 갑옷 (Warmog's Armor)",
    cost: 3000,
    icon: '🛡️',
    stats: {
      hp: 800,
      hpRegen: 15
    },
    desc: '체력 +800, 초당 체력 재생 +15.'
  }
};

module.exports = { ITEMS };
