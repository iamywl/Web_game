# 60 FPS Authoritative Game Engine Rules

## 1. Core Engine Architecture
1. **Loop**: Fixed 60Hz loop (`setInterval` ~16.6ms, `dt = 0.0166s`) in `server/game/GameEngine.js`.
2. **State Broadcast**: Emits `gameTick` to room sockets:
   - `players`: Array of player state objects (id, x, y, vx, vy, hp, maxHp, mp, maxMp, shield, angle, level, exp, maxExp, skillPoints, skillRanks, items, recalling, recallProgress, inBush, wardCooldown, dragonBuffStacks, cd, isAlive).
   - `projectiles`: Array of active skillshots (id, x, y, radius, type, team, angle, life).
   - `minions`: Array of minions (id, team, type, x, y, hp, maxHp, angle, targetId).
   - `structures`: Array of structures (id, team, x, y, hp, maxHp, targetId).
   - `jungleMonsters`: Array of neutral monsters (id, type, x, y, hp, maxHp, isAlive).
   - `wards`: Array of active vision wards (id, team, x, y, radius, duration).
   - `scores`: Blue/Red kill scores.
   - `gameTime`: Match duration in seconds.

## 2. Damage, Defense & Stat Scaling Formulas
- **Damage Formula**:
  $$\text{Effective Damage} = \text{Raw Damage} \times \frac{100}{100 + \text{Armor}}$$
- **Shields**: Absorb incoming damage before health points are reduced.
- **Zero-Division Guard**: Always clamp divisors (`safeDist = dist > 0.001 ? dist : 1.0`) to avoid `NaN` coordinates.
- **Level Scaling (`recalculatePlayerStats`)**:
  $$\text{Stat} = (\text{BaseStat} + \text{GrowthPerLevel} \times (\text{Level} - 1) + \text{ItemBonus}) \times (1 + \text{DragonBuffStack} \times 0.12)$$

## 3. Leveling & Skill Progression Invariants
- Max Champion Level: 18.
- EXP Threshold: $\text{maxExp} = \text{level} \times 100 + 180$.
- Skill Points: $+1$ per level up.
- Rank Caps:
  - Regular skills (Q, W, E): Maximum 5 ranks.
  - Ultimate skill (R): Maximum 3 ranks, unlocked strictly at levels 6, 11, and 16.

## 4. Item Shop & Economy Invariants
- 8 Core Items defined in `server/game/ItemData.js`. Max 6 inventory slots.
- **Fountain Radius Check**: Item purchase and sale are only permitted within the base fountain ($r \le 350\text{px}$).
- **Resell Value**: Selling an item refunds exactly 70% of its base gold cost.
- **Stat Recalculation**: Every buy/sell must immediately trigger `recalculatePlayerStats(player)` to update effective stats.

## 5. Recall (`KeyB`) & Fountain Regeneration
- Recall Duration: 8.0s channeling.
- **Cancel Invariant**: Moving (`playerMove`), casting skills (`castSkill`), or taking damage (`applyDamage`) MUST immediately call `cancelRecall(player)`.
- **Fountain Regeneration**: Players inside base radius recover 15% max HP/s and 20% max MP/s every second.

## 6. Vision, Bush Stealth & Wards
- **Bush Concealment**: A champion inside a brush circle is invisible to enemies outside unless:
  1. The champion attacks (revealed for 1.5s via `revealedTimer`).
  2. An enemy enters the same brush circle.
  3. An allied vision ward is within line of sight ($dist \le 300\text{px}$).
- **Vision Wards**: Placed via `placeWard` socket event. 60s cooldown, 90s lifespan, 300px vision circle.

## 7. Minion Pathing & Turret Call-for-Help
- Lane Center: $y = 800$.
- Turret locations: Blue Tier 1 (700, 800), Red Tier 1 (1700, 800).
- Flank Steering: If $|x - x_{\text{turret}}| < 140$ and $|y - 800| < 100$, displace minion target $y$ by `laneOffset` ($\pm 110\text{px}$) to guide minions smoothly around the structure.
- Hard Collision: If $dist < r_{\text{structure}} + r_{\text{minion}} + 6$, immediately push out along collision normal.
- **Call for Help (Turret Aggro Switch)**: When an enemy champion damages an allied champion within turret firing range, the turret immediately switches its attack target to that enemy champion.

## 8. Neutral Jungle Objectives
- **River Scuttle Crab**: Patrols between $y=560$ and $y=1040$, 1200 HP, non-aggressive, grants 70G and 120 EXP to killer.
- **Elemental Dragon**: Located at $(1200, 1350)$, 4500 HP boss, attacks nearby enemies with flame breath, grants 150G, 350 EXP, and team-wide permanent +12% AD/AP Dragon Slayer buff.
