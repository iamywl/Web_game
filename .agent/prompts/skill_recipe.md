# LLM Recipe: Designing New Skill Archetypes

Use this template prompt when requesting an LLM to design and implement new skill archetypes (skillshot, targeted dash, channel, ground AoE, shield buff).

## Prompt Template
```markdown
You are designing and implementing a new skill mechanic for Web MOBA.

Follow the archetypal design rules:

1. Skillshot Projectile Archetype:
   - In `GameEngine.js:executeSkill()`:
     ```javascript
     const dx = tx - p.x;
     const dy = ty - p.y;
     const dist = Math.hypot(dx, dy);
     const safeDist = dist > 0.001 ? dist : 1.0;
     const angle = Math.atan2(dy, dx);
     this.projectiles.push({
       id: `proj_${this.nextEntityId++}`,
       ownerId: p.id,
       type: `${p.championId}_${key.toLowerCase()}`,
       team: p.team,
       x: p.x,
       y: p.y,
       vx: (dx / safeDist) * speed,
       vy: (dy / safeDist) * speed,
       radius: 20,
       damage: finalDamage,
       range: skill.range,
       distanceTraveled: 0
     });
     ```
   - In `renderer.js:update3DProjectiles()`:
     - Render distinctive 3D mesh (laser beam, sphere, spinning shuriken) with UnrealBloomPass glow.

2. Targeted Dash Archetype:
   - Immediately cancel any active recall: `this.cancelRecall(p);`
   - Displace champion towards target:
     ```javascript
     const step = Math.min(dist, dashDistance);
     p.x += (dx / safeDist) * step;
     p.y += (dy / safeDist) * step;
     ```
   - Trigger trail particles or shockwave in `renderer.js:addShockwave()`.

3. Ground AoE / Zone Archetype:
   - In `GameEngine.js`:
     ```javascript
     this.aoeZones.push({
       id: `aoe_${this.nextEntityId++}`,
       team: p.team,
       x: targetX,
       y: targetY,
       radius: skill.radius,
       duration: 2.5,
       damagePerSec: finalDamage / 2.5
     });
     ```
   - In `renderer.js`:
     - Render red/blue danger telegraph ground decal and lingering magical particle storm.

4. Defense Shield Archetype:
   - Add temporary absorption: `p.shield = (p.shield || 0) + shieldAmount;`
   - HUD automatically displays gold/silver shield bar overlaying health in `#hud-shield-fill`.

5. Verification:
   - Check Zero-GC compliance (reusing vector scratchpads).
   - Verify cooldown decrement and mana depletion.
   - Run `node test/qa_suite.js` to ensure 100% pass rate.
```
