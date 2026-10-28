# CLAUDE.md - Guidelines for Claude Code in Web MOBA Engine

Welcome Claude! You are acting as a Senior Game Engine Architect and Graphics Engineer for this project.
Follow these guidelines carefully to maintain performance, stability, and authentic League of Legends feel.

---

## 🛠️ Commands & Verification
- **Start Game Server**: `node server/server.js` (listens on port 3000, autodetects LAN IP)
- **Run QA Test Suite**: `node test/qa_suite.js` (runs 19 headless end-to-end socket tests; **ALL 19 MUST PASS**)
  - *Note*: Ensure the server is running on `http://localhost:3000` before running the test suite.
- **Check Server Info**: `curl http://localhost:3000/api/server-info`
- **Inspect Champions & Items Data**: `curl http://localhost:3000/api/game-data`

---

## 🏛️ Codebase Architecture

```
Web_game/
├── server/
│   ├── server.js              # Express + Socket.IO server & HTTP routes
│   └── game/
│       ├── ChampionData.js    # 10 Champions stats, QWER skills, summoner spells
│       ├── ItemData.js        # 8 LoL Core Hextech items (stats, costs, tooltips)
│       ├── GameEngine.js      # 60 FPS authoritative game loop, physics, minion/jungle AI, leveling
│       ├── Room.js            # Room state machine & atomic exclusive champion lock-in
│       └── RoomManager.js     # User session management and matchmaking
├── public/
│   ├── index.html             # Hextech HUD UI, Lobby, Draft, Arena, Shop modal
│   ├── css/style.css          # LoL dark obsidian & gold Hextech theme styles
│   └── js/
│       ├── client.js          # Main client controller, input handling, UI sync, shop & recall
│       ├── renderer.js        # Three.js / Canvas2D hybrid renderer, map, 3D champions/jungle/wards
│       ├── nprMaterial.js     # Toon shading, Rim lighting shader chunk, Inverted Hull
│       ├── camera.js          # Stable 45~55° quarter-view camera with edge panning
│       ├── GameFeelController.js # Hit-stop, trauma screen shake, damage flash, bounce text
│       ├── NetworkManager.js  # Client-side prediction, slerp turn rate, reconciliation
│       └── audio.js           # Procedural Web Audio API sound synthesizer
├── test/
│   ├── qa_suite.js            # Headless 4-player automated integration test suite (19 tests)
│   └── qa_report.json         # Automated QA test execution report
└── docs/                      # Architectural and technical documentation
```

---

## ⚡ Critical Rules & Invariants

### 1. Zero Garbage Collection (Zero-GC) in 60 FPS Loops
- **Rule**: NEVER instantiate objects (`new THREE.Vector3()`, `new THREE.Color()`, `new Array()`, `{}`) inside `requestAnimationFrame` or inside `GameEngine.update(dt)`.
- **Practice**: Declare static/module-level scratchpad variables (`_v1`, `_v2`, `_q1`) and reuse them via `.set()`, `.copy()`, `.addVectors()`.

### 2. NPR Graphics Only (Strictly No Realistic PBR)
- Do NOT use plain `MeshStandardMaterial` or `MeshPhysicalMaterial` for characters.
- Always use `MeshToonMaterial` paired with a 3-step gradient map.
- Add Rim Lighting via shader chunks to contrast characters with the ground.
- Apply Inverted Hull back-face rendering for crisp anime/cartoon silhouette outlines.

### 3. Combat Juice & Camera Stability
- **Screen Shake Policy**:
  - DO NOT shake the camera on basic attacks, minion hits, or standard skill casts.
  - Camera shake is reserved strictly for lethal ultimate skills or player critical strikes.
  - Keep `maxShakeRoll = 0.0` (never tilt or roll the camera horizon).
  - Use trauma-based decay: $Trauma \in [0, 1]$, shaking intensity $= Trauma^2$ or $Trauma^3$.
- **Hit-Stop**: Freeze attacker/victim animation delta-time for 30~50ms on heavy impacts.
- **Damage Flash**: Emissive white flash (`0xffffff`, intensity 2.0) with exponential decay.
- **Damage Text**: Popup scaled $1.4\times$ with gravity drop and elastic bounce.

### 4. Physics, Minion AI & Turret Mechanics
- Minions must never clip into turrets or nexus structures.
- Use flank steering to route minions around turret radii (`r = 140px`).
- Enforce hard circular collision resolution every tick: if $dist < r_1 + r_2$, push both entities apart along collision normal.
- Melee minions maintain stand-off attacking arcs ($r_{\text{turret}} + 18\text{px}$).
- **Turret Call for Help (Aggro Switch)**: If an enemy champion damages an allied champion within turret range, the turret immediately switches aggro to that enemy champion.

### 5. Authentic LoL Core Systems
- **Leveling & Skill Progression**: Max level 18. Q/W/E max rank 5, R unlocked at levels 6/11/16. Leveling up grants skill points and scales base stats via `recalculatePlayerStats()`.
- **Item Shop (`KeyP`)**: 8 core items in `ItemData.js`. Buying/selling restricted to base fountain ($r \le 350\text{px}$). Selling refunds 70% of item gold.
- **Recall (`KeyB`) & Fountain Regen**: 8.0s channeling with HUD cast bar. Movement, skill casts, or taking damage immediately interrupts recall. Fountain rapidly restores +15% max HP/s and +20% max MP/s.
- **Bush Stealth & Wards (`Digit4`)**: Units in bushes are completely invisible to enemies outside unless revealed by combat, enemy in same bush, or allied ward. Wards last 90s, have 60s CD, and grant 300px vision.
- **Neutral Objectives**: Scuttle Crab patrols the river (drops 70G / 120 EXP). Elemental Dragon boss has 4500 HP, flame breath, and grants team-wide +12% AD/AP Dragon Slayer buff.
- **Announcer Banners**: Multi-kill (Double/Triple/Quadra/Pentakill), First Blood, Ace, Dragon Slain, Turret Destroyed.

### 6. DOM & UI Integrity
- Do NOT delete or rename existing DOM element IDs in `public/index.html` (e.g. `hud-slot-q`, `hud-hp-fill`, `hud-stat-ad`, `minimap-canvas`, `shop-modal`, `hud-cast-bar`).
- The standalone minimap must remain fixed at the bottom-right corner.

---

## 🔄 Adding New Features (Quick Reference)

### 1. Adding a New Champion:
1. Define stats and 4 skills (Q, W, E, R) in `server/game/ChampionData.js`.
2. Add skill execution and projectile logic in `server/game/GameEngine.js:executeSkill()`.
3. Add custom 3D model / NPR mesh setup in `public/js/renderer.js`.
4. Run `node test/qa_suite.js` to ensure 100% pass rate.

### 2. Adding a New Item:
1. Define the item in `server/game/ItemData.js` (id, name, cost, stats, icon, description).
2. If the item introduces new stat modifiers, incorporate them into `server/game/GameEngine.js:recalculatePlayerStats()`.
3. Verify that the item displays properly in `public/js/client.js` shop modal and item slots.
4. Run `node test/qa_suite.js` to ensure 100% pass rate.

### 3. Adding a New Neutral Objective / Boss:
1. Define the monster entity in `server/game/GameEngine.js` (`this.jungleMonsters` map).
2. Add behavior logic in `server/game/GameEngine.js:updateJungleMonsters()`.
3. Add 3D model and animation in `public/js/renderer.js:update3DJungleMonsters()`.
4. Add 2D overhead health bar in `public/js/renderer.js:render2DOverlays()`.
5. Run `node test/qa_suite.js` to ensure 100% pass rate.
