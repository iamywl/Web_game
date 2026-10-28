# GitHub Copilot Instructions for Web MOBA (LoL Engine)

## Architecture Overview
- High-performance Pure Vanilla JS + Three.js + Node.js MOBA.
- Authoritative 60 FPS server (`server/game/GameEngine.js`).
- Client predicts movement and reconciles via exponential decay lerp (<0.5 threshold).
- 8 Hextech items defined in `server/game/ItemData.js`, level progression (1~18), bush stealth, and neutral jungle objectives (Scuttle Crab, Elemental Dragon).

## Coding Standards
1. **Zero-GC in Loops**: Never allocate objects inside `requestAnimationFrame` or the 60Hz server tick loop. Always reuse scratchpad variables `_v1`, `_v2`, `_q1`.
2. **NPR Material Only**: Use `MeshToonMaterial` with 3-step gradient map, Rim Lighting chunks, and Inverted Hull outline meshes (`nprMaterial.js`). Do not use bare `MeshStandardMaterial`.
3. **Camera Shake**: Never shake camera on basic attacks or minions. Only lethals/crits with `Trauma^2` non-linear decay. Camera roll is strictly `0.0`.
4. **Collision & Turret Mechanics**: Enforce structure collision resolution for all entities; minions flank around turrets. Damaging allied champions under turret swaps turret aggro to the attacker.
5. **Recall & Shop Invariants**: Recall channels for 8.0s and is strictly cancelled on move, damage, or skill cast. Shop purchases are only permitted inside the base fountain ($r \le 350\text{px}$).
6. **Testing**: Always run `node test/qa_suite.js` (with server running) to verify zero regressions across all 19 tests.
