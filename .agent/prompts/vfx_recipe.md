# LLM Recipe: Adding VFX or Shaders

Use this template when requesting an LLM to build or adjust skill visuals, particles, or shaders.

## Prompt Template
```markdown
You are designing stylized visual effects (VFX) or shaders for Web MOBA.

Rules:
1. NPR Toon Only: Use `MeshToonMaterial` or Canvas2D particle layers. NEVER use bare `MeshStandardMaterial`.
2. Outlines: For 3D meshes, clone and invert backface hull geometry with normal extrusion (`nprMaterial.js`).
3. Particle Pooling: Pre-allocate particles in an array pool; activate via `p.active = true` rather than creating new objects.
4. Screen Shake: Do NOT add screen shake to basic attacks. Only lethal/ultimate events, with `maxShakeRoll = 0.0`.
5. Run `node test/qa_suite.js` to ensure 100% pass rate.
```
