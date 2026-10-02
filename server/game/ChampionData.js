/**
 * ChampionData.js
 * 10 Distinct Champions and Summoner Spells configuration
 */

const CHAMPIONS = {
  blademaster: {
    id: 'blademaster',
    name: '검객',
    title: 'Blademaster',
    role: '전사 / 암살자 (Fighter / Assassin)',
    color: '#00d2d3',
    accentColor: '#54a0ff',
    avatar: '⚔️',
    stats: {
      maxHp: 640,
      hpRegen: 3.5,
      maxMp: 300,
      mpRegen: 6.0,
      attackRange: 130,
      attackDamage: 68,
      attackSpeed: 0.75, // attacks per sec
      moveSpeed: 310,
      armor: 34,
      magicResist: 32,
      radius: 26
    },
    passive: {
      name: '삼연참 (Triple Strike)',
      desc: '3회 공격마다 대상에게 추가 고정 피해를 입히고 이동 속도가 20% 증가합니다.'
    },
    skills: {
      Q: {
        name: '직선 돌진 베기 (Dash Slash)',
        key: 'Q',
        type: 'dash_line',
        cooldown: 6.0,
        mana: 45,
        range: 360,
        damage: 90,
        damageRatio: 0.8,
        desc: '마우스 방향으로 빠르게 돌진하며 경로 상의 모든 적을 베어 물리 피해를 입힙니다.'
      },
      W: {
        name: '원형 회전 베기 (Whirlwind)',
        key: 'W',
        type: 'aoe_circle',
        cooldown: 8.0,
        mana: 50,
        radius: 220,
        damage: 110,
        damageRatio: 0.9,
        desc: '검을 크게 휘둘러 주변 360도 반경의 모든 적에게 피해를 입힙니다.'
      },
      E: {
        name: '검기의 방패 (Blade Barrier)',
        key: 'E',
        type: 'self_buff',
        cooldown: 11.0,
        mana: 55,
        shieldAmount: 180,
        duration: 3.5,
        speedBonus: 0.25,
        desc: '3.5초간 검기로 만든 방어막을 얻고 이동 속도가 25% 상승합니다.'
      },
      R: {
        name: '연속 난무 (Omnislash)',
        key: 'R',
        type: 'target_aoe',
        cooldown: 45.0,
        mana: 100,
        range: 480,
        radius: 180,
        damage: 280,
        damageRatio: 1.2,
        airborneDuration: 1.2,
        desc: '대상 지점으로 도약하여 폭발적인 난무를 펼쳐 적들을 1.2초간 에어본(공중 띄움)시키고 막대한 피해를 입힙니다.'
      }
    }
  },

  sniper: {
    id: 'sniper',
    name: '저격수',
    title: 'Sniper',
    role: '원거리 딜러 (Marksman)',
    color: '#ff9f43',
    accentColor: '#f368e0',
    avatar: '🎯',
    stats: {
      maxHp: 540,
      hpRegen: 2.2,
      maxMp: 350,
      mpRegen: 7.0,
      attackRange: 500,
      attackDamage: 62,
      attackSpeed: 0.82,
      moveSpeed: 290,
      armor: 26,
      magicResist: 30,
      radius: 24
    },
    passive: {
      name: '원거리 치명타 (Eagle Eye)',
      desc: '300거리 이상 떨어진 적 공격 시 치명타가 발동하여 40% 추가 피해를 입힙니다.'
    },
    skills: {
      Q: {
        name: '고속 관통탄 (Piercing Shot)',
        key: 'Q',
        type: 'skillshot_bullet',
        cooldown: 5.0,
        mana: 40,
        range: 750,
        speed: 850,
        radius: 16,
        damage: 105,
        damageRatio: 0.85,
        desc: '모든 적을 관통하는 고속 탄환을 직선으로 발사하여 피해를 입힙니다.'
      },
      W: {
        name: '포획 덫 (Capture Trap)',
        key: 'W',
        type: 'trap',
        cooldown: 10.0,
        mana: 50,
        range: 450,
        radius: 50,
        rootDuration: 1.5,
        damage: 60,
        desc: '목표 지점에 은신 덫을 설치합니다. 덫을 밟은 적은 1.5초간 속박되며 피해를 입습니다.'
      },
      E: {
        name: '후방 구르기 (Tumble Back)',
        key: 'E',
        type: 'dash_back',
        cooldown: 9.0,
        mana: 45,
        distance: 260,
        empoweredDamage: 50,
        desc: '마우스 반대 방향으로 재빨리 구르며 회피하고, 다음 기본 공격의 사거리가 증가합니다.'
      },
      R: {
        name: '초장거리 저격탄 (Snipe Ultimate)',
        key: 'R',
        type: 'skillshot_bullet',
        cooldown: 50.0,
        mana: 100,
        range: 1200,
        speed: 1100,
        radius: 24,
        damage: 340,
        damageRatio: 1.3,
        desc: '1200 사거리의 초강력 저격 탄환을 발사합니다. 적의 잃은 체력에 비례하여 피해가 증폭됩니다.'
      }
    }
  },

  pyromancer: {
    id: 'pyromancer',
    name: '화염술사',
    title: 'Pyromancer',
    role: '마법사 (Mage)',
    color: '#ee5253',
    accentColor: '#ff793f',
    avatar: '🔥',
    stats: {
      maxHp: 560,
      hpRegen: 2.5,
      maxMp: 420,
      mpRegen: 8.5,
      attackRange: 460,
      attackDamage: 54,
      attackSpeed: 0.70,
      moveSpeed: 295,
      armor: 25,
      magicResist: 30,
      radius: 24
    },
    passive: {
      name: '연소 (Blaze)',
      desc: '스킬에 적중된 적에게 불길이 붙어 3초간 지속 마법 피해(DoT)를 입힙니다.'
    },
    skills: {
      Q: {
        name: '화염구 투사체 (Fireball)',
        key: 'Q',
        type: 'projectile',
        cooldown: 4.5,
        mana: 45,
        range: 620,
        speed: 700,
        radius: 28,
        damage: 95,
        damageRatio: 0.75,
        desc: '폭발하는 화염구를 발사하여 처음 충돌한 적과 그 주변에 폭발 피해를 입힙니다.'
      },
      W: {
        name: '화염 장판 (Pillar of Flame)',
        key: 'W',
        type: 'ground_delay',
        cooldown: 8.5,
        mana: 65,
        range: 580,
        radius: 170,
        delay: 0.6,
        damage: 130,
        damageRatio: 0.9,
        desc: '지정한 위치에 0.6초 후 거대한 화염 기둥을 솟구치게 하여 강력한 마법 피해를 입힙니다.'
      },
      E: {
        name: '폭발 충격파 (Blast Wave)',
        key: 'E',
        type: 'aoe_knockback',
        cooldown: 11.0,
        mana: 60,
        radius: 240,
        damage: 80,
        knockbackDist: 180,
        desc: '자신 주위로 화염 충격파를 방출하여 주변 적들을 밀쳐내고 피해를 입힙니다.'
      },
      R: {
        name: '메테오 폭격 (Meteor Strike)',
        key: 'R',
        type: 'ground_delay',
        cooldown: 48.0,
        mana: 100,
        range: 750,
        radius: 250,
        delay: 0.85,
        damage: 360,
        damageRatio: 1.25,
        stunDuration: 1.0,
        desc: '하늘에서 거대한 운석을 낙하시켜 1초간 적을 기절시키고 궤멸적인 광역 피해를 입힙니다.'
      }
    }
  },

  shadow_assassin: {
    id: 'shadow_assassin',
    name: '암살자',
    title: 'Shadow Assassin',
    role: '암살자 (Assassin)',
    color: '#5f27cd',
    accentColor: '#341f97',
    avatar: '🗡️',
    stats: {
      maxHp: 590,
      hpRegen: 3.0,
      maxMp: 280,
      mpRegen: 6.0,
      attackRange: 135,
      attackDamage: 72,
      attackSpeed: 0.80,
      moveSpeed: 320,
      armor: 28,
      magicResist: 32,
      radius: 25
    },
    passive: {
      name: '체력 비례 일격 (Expose Weakness)',
      desc: '체력 50% 이상인 적에게 현재 체력의 6% 추가 피해, 50% 이하인 적에게 잃은 체력의 10% 추가 피해를 줍니다.'
    },
    skills: {
      Q: {
        name: '수리검 투척 (Shadow Shuriken)',
        key: 'Q',
        type: 'skillshot_bullet',
        cooldown: 5.5,
        mana: 40,
        range: 580,
        speed: 800,
        radius: 18,
        damage: 85,
        damageRatio: 0.85,
        desc: '예리한 암흑 수리검을 날려 적중한 적에게 물리 피해를 입힙니다.'
      },
      W: {
        name: '그림자 은신 (Shadow Cloak)',
        key: 'W',
        type: 'self_buff',
        cooldown: 12.0,
        mana: 50,
        stealthDuration: 2.8,
        speedBonus: 0.35,
        desc: '2.8초간 은신 상태에 돌입하고 이동 속도가 35% 증가합니다. 공격 시 은신이 해제됩니다.'
      },
      E: {
        name: '그림자 도약 (Shadow Step)',
        key: 'E',
        type: 'blink_damage',
        cooldown: 9.0,
        mana: 50,
        range: 420,
        damage: 95,
        damageRatio: 0.7,
        desc: '지정 위치나 적 뒤로 순간 이동하여 기습 베기를 가합니다.'
      },
      R: {
        name: '처형 연속베기 (Death Mark)',
        key: 'R',
        type: 'target_strike',
        cooldown: 42.0,
        mana: 100,
        range: 460,
        initialDamage: 180,
        popDamageRatio: 0.35,
        delay: 2.5,
        desc: '적에게 죽음의 표식을 새겨 돌진 베기를 가하며, 2.5초 후 가한 피해의 35%만큼 추가 폭발 피해를 입힙니다.'
      }
    }
  },

  guardian: {
    id: 'guardian',
    name: '수호자',
    title: 'Guardian',
    role: '탱커 (Tank)',
    color: '#10ac84',
    accentColor: '#1dd1a1',
    avatar: '🛡️',
    stats: {
      maxHp: 780,
      hpRegen: 5.0,
      maxMp: 300,
      mpRegen: 5.5,
      attackRange: 140,
      attackDamage: 58,
      attackSpeed: 0.65,
      moveSpeed: 300,
      armor: 44,
      magicResist: 38,
      radius: 30
    },
    passive: {
      name: '수호의 방패 (Guardian Shield)',
      desc: '체력이 35% 이하로 떨어지면 최대 체력의 25%에 해당하는 거대 방어막을 4초간 획득합니다. (쿨다운 60초)'
    },
    skills: {
      Q: {
        name: '방패 돌진 (Shield Bash)',
        key: 'Q',
        type: 'dash_stun',
        cooldown: 7.5,
        mana: 50,
        range: 350,
        speed: 650,
        damage: 85,
        stunDuration: 1.2,
        desc: '방패를 앞세우고 돌진하여 처음 부딪힌 적을 1.2초간 기절시키고 밀쳐냅니다.'
      },
      W: {
        name: '철벽 방어 (Iron Defense)',
        key: 'W',
        type: 'self_buff',
        cooldown: 12.0,
        mana: 55,
        damageReduction: 0.45,
        duration: 3.5,
        desc: '3.5초간 방어 태세를 취하여 받는 모든 피해를 45% 감소시킵니다.'
      },
      E: {
        name: '광역 도발 (Roar of Challenge)',
        key: 'E',
        type: 'aoe_taunt',
        cooldown: 13.0,
        mana: 60,
        radius: 260,
        slowRate: 0.45,
        duration: 2.0,
        damage: 65,
        desc: '포효하여 주변 적들을 2초간 45% 둔화시키고 강제로 자신을 공격하도록 도발합니다.'
      },
      R: {
        name: '대지 분쇄 (Earthquake Shockwave)',
        key: 'R',
        type: 'aoe_knockup',
        cooldown: 50.0,
        mana: 100,
        range: 520,
        radius: 240,
        damage: 240,
        airborneDuration: 1.4,
        desc: '대지를 강타하여 지진파를 일으킵니다. 반경 내 모든 적을 1.4초간 공중에 띄우고 피해를 줍니다.'
      }
    }
  },

  frost_mage: {
    id: 'frost_mage',
    name: '빙결술사',
    title: 'Frost Mage',
    role: '마법사 / 제어 (Mage / Controller)',
    color: '#0abde3',
    accentColor: '#48dbfb',
    avatar: '❄️',
    stats: {
      maxHp: 550,
      hpRegen: 2.2,
      maxMp: 450,
      mpRegen: 9.0,
      attackRange: 480,
      attackDamage: 52,
      attackSpeed: 0.68,
      moveSpeed: 290,
      armor: 24,
      magicResist: 30,
      radius: 24
    },
    passive: {
      name: '오한 (Chill)',
      desc: '스킬이 적중할 때마다 적에게 오한을 중첩시킵니다. 3중첩 시 적이 1.2초간 완전 빙결(기절)됩니다.'
    },
    skills: {
      Q: {
        name: '얼음 송곳 (Ice Shard)',
        key: 'Q',
        type: 'skillshot_bullet',
        cooldown: 4.5,
        mana: 45,
        range: 650,
        speed: 750,
        radius: 20,
        damage: 85,
        damageRatio: 0.75,
        slowRate: 0.35,
        slowDuration: 2.0,
        desc: '얼음 송곳을 날려 관통 적에게 마법 피해를 입히고 2초간 35% 둔화시킵니다.'
      },
      W: {
        name: '빙판 슬로우 (Glacial Path)',
        key: 'W',
        type: 'ground_zone',
        cooldown: 9.0,
        mana: 60,
        range: 550,
        radius: 190,
        duration: 3.5,
        slowRate: 0.55,
        dps: 30,
        desc: '지정한 구역에 3.5초간 빙판을 생성합니다. 위의 적들은 55% 둔화되고 지속 피해를 받습니다.'
      },
      E: {
        name: '서리 방패 (Frost Barrier)',
        key: 'E',
        type: 'self_buff',
        cooldown: 11.0,
        mana: 50,
        shieldAmount: 160,
        duration: 3.0,
        reflectDamage: 40,
        desc: '3초간 서리 방패를 둘러 피해를 흡수하며, 자신을 공격한 적에게 오한을 부여합니다.'
      },
      R: {
        name: '절대영도 (Absolute Zero)',
        key: 'R',
        type: 'aoe_freeze',
        cooldown: 52.0,
        mana: 100,
        range: 600,
        radius: 280,
        damage: 320,
        damageRatio: 1.1,
        freezeDuration: 1.8,
        desc: '극저온의 눈보라를 폭발시켜 거대한 영역 내 모든 적을 1.8초간 얼어붙게 만들고 큰 피해를 줍니다.'
      }
    }
  },

  berserker: {
    id: 'berserker',
    name: '광전사',
    title: 'Berserker',
    role: '전사 (Fighter)',
    color: '#c0392b',
    accentColor: '#e74c3c',
    avatar: '🪓',
    stats: {
      maxHp: 720,
      hpRegen: 4.0,
      maxMp: 250,
      mpRegen: 5.0,
      attackRange: 135,
      attackDamage: 70,
      attackSpeed: 0.72,
      moveSpeed: 315,
      armor: 36,
      magicResist: 32,
      radius: 28
    },
    passive: {
      name: '분노의 공격력 (Berserk Blood)',
      desc: '잃은 체력 1%마다 공격 속도가 0.8%, 공격력이 0.4 상승합니다.'
    },
    skills: {
      Q: {
        name: '도끼 투척 (Undertow Axe)',
        key: 'Q',
        type: 'skillshot_bullet',
        cooldown: 6.0,
        mana: 35,
        range: 600,
        speed: 720,
        radius: 22,
        damage: 90,
        slowRate: 0.40,
        slowDuration: 2.0,
        desc: '도끼를 던져 경로 상의 적들에게 물리 피해를 주고 2초간 40% 둔화시킵니다.'
      },
      W: {
        name: '광포화 (Frenzy Rage)',
        key: 'W',
        type: 'self_buff',
        cooldown: 11.0,
        mana: 40,
        asBonus: 0.55,
        lifesteal: 0.25,
        duration: 4.5,
        desc: '4.5초간 광포화하여 공격 속도가 55% 증가하고 생명력 흡수 25%를 얻습니다.'
      },
      E: {
        name: '갈망의 일격 (Reckless Swing)',
        key: 'E',
        type: 'target_strike',
        cooldown: 7.0,
        mana: 30,
        range: 160,
        trueDamage: 115,
        selfDamage: 25,
        desc: '자신의 체력을 약간 희생하여 적에게 방어력을 무시하는 고정 피해를 강력하게 내리꽂습니다.'
      },
      R: {
        name: '불사의 분노 (Ragnarok)',
        key: 'R',
        type: 'self_buff',
        cooldown: 48.0,
        mana: 80,
        duration: 4.0,
        speedBonus: 0.35,
        desc: '4초간 체력이 1 이하로 떨어지지 않는 불사 상태가 되며, 군중 제어 효과에 면역이 됩니다.'
      }
    }
  },

  shadow_hunter: {
    id: 'shadow_hunter',
    name: '그림자 사냥꾼',
    title: 'Shadow Hunter',
    role: '원거리 암살자 (Marksman)',
    color: '#8e44ad',
    accentColor: '#9b59b6',
    avatar: '🏹',
    stats: {
      maxHp: 530,
      hpRegen: 2.0,
      maxMp: 340,
      mpRegen: 6.5,
      attackRange: 470,
      attackDamage: 64,
      attackSpeed: 0.84,
      moveSpeed: 305,
      armor: 25,
      magicResist: 30,
      radius: 24
    },
    passive: {
      name: '추격 (Night Hunter)',
      desc: '시야 내 적 챔피언을 향해 이동할 때 이동 속도가 40 추가됩니다.'
    },
    skills: {
      Q: {
        name: '구르기 강화탄 (Tumble Shot)',
        key: 'Q',
        type: 'dash_buff',
        cooldown: 4.0,
        mana: 35,
        distance: 220,
        bonusDamage: 65,
        desc: '마우스 방향으로 짧게 구르며, 다음 기본 공격이 강화되어 추가 물리 피해를 입힙니다.'
      },
      W: {
        name: '은화살 (Silver Bolts)',
        key: 'W',
        type: 'passive_stack',
        cooldown: 0,
        mana: 0,
        stacksNeeded: 3,
        percentTrueDamage: 0.09, // 9% max HP
        desc: '동일 대상 3회 기본 공격 시 대상 최대 체력의 9%에 해당하는 고정 피해를 입힙니다.'
      },
      E: {
        name: '선고 밀쳐내기 (Condemn)',
        key: 'E',
        type: 'target_knockback',
        cooldown: 11.0,
        mana: 50,
        range: 430,
        knockbackDist: 280,
        damage: 85,
        wallStunDuration: 1.5,
        desc: '중화살을 발사해 대상을 밀쳐냅니다. 벽이나 장애물에 충돌하면 1.5초간 기절합니다.'
      },
      R: {
        name: '결전의 시간 (Final Hour)',
        key: 'R',
        type: 'self_buff',
        cooldown: 52.0,
        mana: 80,
        duration: 8.0,
        bonusAd: 35,
        qInvisDuration: 1.0,
        desc: '8초간 결전 상태가 되어 공격력이 대폭 상승하고, Q(구르기) 사용 시 1초간 투명해집니다.'
      }
    }
  },

  brawler: {
    id: 'brawler',
    name: '격투가',
    title: 'Brawler',
    role: '전사 / 결투가 (Fighter)',
    color: '#d35400',
    accentColor: '#e67e22',
    avatar: '🥊',
    stats: {
      maxHp: 670,
      hpRegen: 3.8,
      maxMp: 280,
      mpRegen: 5.5,
      attackRange: 135,
      attackDamage: 69,
      attackSpeed: 0.78,
      moveSpeed: 310,
      armor: 35,
      magicResist: 32,
      radius: 27
    },
    passive: {
      name: '연계 흐름 (Combo Flow)',
      desc: '스킬 적중 시 연계 스택이 쌓이며, 스택당 공격 속도 10%와 이동 속도 4%가 증가합니다 (최대 4스택).'
    },
    skills: {
      Q: {
        name: '정권 찌르기 (Heavy Punch)',
        key: 'Q',
        type: 'skillshot_bullet',
        cooldown: 4.5,
        mana: 35,
        range: 280,
        speed: 900,
        radius: 35,
        damage: 95,
        damageRatio: 0.9,
        desc: '강력한 정권을 일직선으로 내질러 적의 방어력을 일부 무시하고 타격합니다.'
      },
      W: {
        name: '반격 자세 (Counter Guard)',
        key: 'W',
        type: 'counter_stance',
        cooldown: 10.0,
        mana: 45,
        duration: 1.2,
        stunRadius: 200,
        stunDuration: 1.0,
        desc: '1.2초간 반격 자세를 취해 기본 공격을 회피하고, 종료 시 주변 적들을 1초간 기절시킵니다.'
      },
      E: {
        name: '무릎 돌진 (Knee Dash)',
        key: 'E',
        type: 'dash_line',
        cooldown: 8.0,
        mana: 40,
        range: 330,
        damage: 85,
        slowRate: 0.40,
        slowDuration: 1.5,
        desc: '전방으로 돌진 무릎차기를 날려 첫 번째 적을 1.5초간 40% 둔화시킵니다.'
      },
      R: {
        name: '승룡권 제압 (Rising Dragon)',
        key: 'R',
        type: 'target_strike',
        cooldown: 44.0,
        mana: 90,
        range: 300,
        damage: 290,
        damageRatio: 1.15,
        airborneDuration: 1.3,
        desc: '적을 공중으로 올려치는 전설의 승룡권으로 1.3초간 제압하고 충격파로 내려꽂습니다.'
      }
    }
  },

  demolitionist: {
    id: 'demolitionist',
    name: '폭탄광',
    title: 'Demolitionist',
    role: '원거리 포병 / 마법사 (Artillery)',
    color: '#f1c40f',
    accentColor: '#f39c12',
    avatar: '💣',
    stats: {
      maxHp: 550,
      hpRegen: 2.4,
      maxMp: 430,
      mpRegen: 8.0,
      attackRange: 480,
      attackDamage: 55,
      attackSpeed: 0.70,
      moveSpeed: 290,
      armor: 26,
      magicResist: 30,
      radius: 25
    },
    passive: {
      name: '사망 시 자폭 (Last Laugh)',
      desc: '사망 시 1.5초 후 자리에 설치된 대형 폭탄이 폭발하여 주변 적들에게 막대한 고정 피해를 입힙니다.'
    },
    skills: {
      Q: {
        name: '바운스 폭탄 (Bouncing Bomb)',
        key: 'Q',
        type: 'bouncing_bomb',
        cooldown: 4.5,
        mana: 45,
        range: 650,
        speed: 680,
        radius: 35,
        damage: 95,
        damageRatio: 0.8,
        desc: '통통 튀는 폭탄을 던집니다. 적과 충돌하거나 최종 도달 시 폭발하여 광역 피해를 입힙니다.'
      },
      W: {
        name: '점착 폭탄 (Satchel Charge)',
        key: 'W',
        type: 'satchel',
        cooldown: 12.0,
        mana: 60,
        range: 480,
        radius: 180,
        knockbackDist: 250,
        damage: 75,
        desc: '원격 폭탄을 던집니다. 재사용 시 폭발하여 적들을 밀쳐내고 자신도 반동으로 점프합니다.'
      },
      E: {
        name: '지뢰밭 (Minefield)',
        key: 'E',
        type: 'minefield',
        cooldown: 11.0,
        mana: 65,
        range: 520,
        radius: 170,
        damagePerMine: 45,
        slowRate: 0.40,
        desc: '6개의 근접 지뢰를 흩뿌립니다. 지뢰를 밟은 적은 폭발 피해를 입고 둔화됩니다.'
      },
      R: {
        name: '거대 지옥불 폭탄 (Mega Inferno Bomb)',
        key: 'R',
        type: 'ground_delay',
        cooldown: 55.0,
        mana: 100,
        range: 950,
        radius: 270,
        delay: 1.0,
        damage: 380,
        damageRatio: 1.3,
        desc: '초장거리 거대 지옥불 폭탄을 투하하여 중심부에 궤멸적인 광역 피해를 입힙니다.'
      }
    }
  }
};

const SUMMONER_SPELLS = {
  flash: {
    id: 'flash',
    name: '점멸 (Flash)',
    icon: '⚡',
    key: 'D',
    cooldown: 45.0,
    range: 380,
    type: 'teleport',
    desc: '커서 방향으로 즉시 순간이동합니다.'
  },
  ignite: {
    id: 'ignite',
    name: '점화 (Ignite)',
    icon: '🔥',
    key: 'F',
    cooldown: 35.0,
    range: 480,
    type: 'target_dot',
    totalDamage: 140,
    duration: 4.0,
    desc: '대상 적에게 4초간 고정 피해를 입히고 치유량을 50% 감소시킵니다.'
  },
  heal: {
    id: 'heal',
    name: '회복 (Heal)',
    icon: '💚',
    key: 'F',
    cooldown: 40.0,
    type: 'self_heal',
    healAmount: 180,
    speedBonus: 0.30,
    duration: 1.5,
    desc: '자신과 주변 아군의 체력을 180 회복시키고 1.5초간 이동 속도가 30% 증가합니다.'
  }
};

module.exports = {
  CHAMPIONS,
  SUMMONER_SPELLS
};
