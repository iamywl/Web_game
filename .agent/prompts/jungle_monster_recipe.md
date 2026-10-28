# LLM Recipe: Adding a New Neutral Jungle Monster / Objective

Use this template prompt when requesting an LLM to add a new neutral objective or jungle camp (e.g., Baron Nashor, Blue Sentinel, Red Brambleback).

## Prompt Template
```markdown
You are adding a new neutral monster/objective to the Web MOBA engine.

Follow the 4-step pipeline:

1. [server/game/GameEngine.js]:
   - Add monster configuration in `this.jungleMonsters`:
     ```javascript
     baron: {
       id: 'baron_nashor',
       name: '내셔 남작 (Baron Nashor)',
       type: 'baron',
       team: 'neutral',
       x: 1200,
       y: 250,
       radius: 65,
       hp: 9000,
       maxHp: 9000,
       armor: 50,
       damage: 140,
       range: 350,
       attackCooldown: 0,
       attackInterval: 1.2,
       goldValue: 300,
       expValue: 600,
       targetId: null,
       isAlive: true,
       respawnTimer: 0
     }
     ```
   - In `updateJungleMonsters()`:
     - Add AI targeting and attack loop (detect nearest champion within leash range).
     - On defeat: award team gold, EXP, and team buff stack.
     - Push announcer event: `{ type: 'dragon_slain' | 'baron_slain', killerTeam, killerName }`.

2. [public/js/renderer.js]:
   - Create 3D Model: `create3DBaronModel()` using NPR Toon materials (`createChampionMaterial`).
   - In `update3DJungleMonsters()`:
     - Instantiate and update mesh position and idle/attack animation.
   - In `render2DOverlays()`:
     - Render overhead Epic Boss Health Bar (`renderBaronBossBar()`).
   - In `renderMinimap()`:
     - Render purple epic monster icon or circle in the pit on the minimap canvas.

3. [public/js/client.js]:
   - Add announcer banner title/subtitle for the new objective in `showAnnouncerBanner()`.

4. Verification:
   - Ensure `node server/server.js` is running.
   - Run `node test/qa_suite.js` to ensure 100% pass rate.
   - Check Zero-GC compliance (no `new` inside tick/render loops).
```
