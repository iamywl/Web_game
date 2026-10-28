# LLM Recipe: Adding a New Champion

Use this template prompt when requesting an LLM to add a new champion to the Web MOBA engine.

## Prompt Template
```markdown
You are adding a new champion to the Web MOBA engine following official LoL mechanics and NPR toon graphics.

Follow the 4-step pipeline:

1. [server/game/ChampionData.js]:
   - Add champion definition to `CHAMPIONS` map.
   - Required fields:
     - `id`: unique snake_case string (e.g. 'storm_caller')
     - `name`: Korean display name (e.g. '폭풍술사')
     - `title`: LoL-style title (e.g. '천둥의 인도자')
     - `role`: '전사' | '마법사' | '암살자' | '원거리 딜러' | '탱커'
     - `color` & `accentColor`: Hex color codes (e.g. '#3498db', '#2980b9')
     - `avatar`: Emoji icon (e.g. '⚡')
     - `stats`: base stats + growth per level:
       - `maxHp`, `hpRegen`, `maxMp`, `mpRegen`, `attackDamage`, `attackSpeed`, `attackRange`, `moveSpeed`, `armor`, `magicResist`, `radius`
     - `passive`: `{ name, desc }`
     - `skills`: `{ Q, W, E, R }`:
       - Each skill must include: `key`, `name`, `type` ('projectile' | 'aoe' | 'dash' | 'target'), `cooldown`, `mana`, `damage`, `range` / `radius`, `desc`.

2. [server/game/GameEngine.js]:
   - Inside `executeSkill(p, key, skill, tx, ty)`, add the handler for the new champion:
     - Skillshot: `this.spawnProjectile(...)`
     - AoE blast: `this.createAoeBlast(...)`
     - Dash: compute vector towards `(tx, ty)` with Zero-Division guard (`safeDist = dist > 0.001 ? dist : 1.0`).
   - Calculate damage scaling by skill rank: `const rank = p.skillRanks[key] || 1; const finalDmg = skill.damage * (1 + (rank - 1) * 0.25);`

3. [public/js/renderer.js]:
   - In `create3DChampionModel(p)`:
     - Add NPR Toon 3D hierarchical biped model (torso, head, hair/armor, arms, legs, signature weapon).
     - Use `createChampionMaterial()` with 3-step toon ramp and rim light.
     - Add inverted hull outline mesh via `createOutlineMesh()`.
   - In `public/js/client.js`:
     - Register skill icons in `CHAMPION_SKILL_ICONS`.

4. Verification:
   - Ensure `node server/server.js` is running.
   - Run `node test/qa_suite.js` to ensure all 19 tests pass 100%.
```
