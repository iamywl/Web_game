# NPR Graphics, 3D Rendering & Game Feel Rules

## 1. NPR (Non-Photorealistic Rendering) Pipeline
- **No PBR Material**: Character, minion, and monster meshes must NOT use bare `MeshStandardMaterial` or `MeshPhysicalMaterial`.
- **Toon Gradient**:
  - `MeshToonMaterial` paired with a 3-step discrete gradient texture (highlight, midtone, shadow) created via `toonRamp`.
- **Custom Rim Lighting**:
  - Inject rim light chunk into `onBeforeCompile` of material:
    ```glsl
    float rim = 1.0 - max(dot(vNormal, normalize(-vViewPosition)), 0.0);
    rim = smoothstep(0.65, 0.95, rim);
    gl_FragColor.rgb += rimColor * rim * rimIntensity;
    ```
- **Inverted Hull Outlines**:
  - Cloned geometry with flipped faces (`THREE.BackSide`) and vertex extrusion along normals:
    ```glsl
    vec3 transformed = position + normal * outlineThickness;
    ```

## 2. Bush Stealth & Vision Rendering
- **Enemy Culling**:
  - If enemy is in bush (`p.inBush`) and not revealed (`!p.revealed`), and local player has no vision (different bush, no ward in range):
    - 3D Model: `group.visible = false;`
    - 2D Canvas Overhead Bar: Frustum culling skip (no health bar or nickname drawn).
    - Minimap: Skip drawing on minimap canvas.
- **Allied Brush Camouflage**:
  - For allies or local player inside brush:
    - Set mesh material `transparent = true` and `opacity = 0.55` to give distinct tactical stealth feedback.

## 3. Neutral Monsters & Ward 3D Models
- **River Scuttle Crab (`create3DScuttleCrabModel`)**:
  - Squashed emerald carapace with glowing shell crest, bead eyes, and 6 animated walking legs.
  - Overhead 76px teal health bar with '바위게' tag.
- **Elemental Dragon (`create3DElementalDragonModel`)**:
  - Muscular scaled crimson body, horned head with fiery eyes, animated flapping wings, segmented tail, and rotating ground rune ring.
  - Overhead 180px Epic Boss Bar with gold frame, 100-HP ticks, dragon crest, and current HP/max HP text.
- **Vision Ward Totem (`create3DWardModel`)**:
  - Hextech stone base with floating, rotating octahedron crystal eye and translucent 300px vision radius ground ring.

## 4. Combat Juice Pipeline (4-Stage Sync)
- **Hit-Stop (Frame Freeze)**:
  - Freeze delta-time for 30~50ms on major impact hits (`GameFeelController.triggerHitStop()`).
- **Damage Flash**:
  - Target mesh emissive set to `0xffffff` (intensity 2.0), exponential decay to 0 over 0.05s.
- **Trauma-based Camera Shake**:
  - Formula: $\text{Offset} = \text{maxOffset} \times Trauma^2 \times \text{Noise}(t)$
  - `maxShakeRoll = 0.0` (zero camera tilt or horizon rolling).
  - Normal attacks/minions: ZERO trauma. Screen shake is forbidden for basic hits.
  - Crits/lethals: Trauma $+0.08 \sim 0.12$.
- **Floating Damage Numbers**:
  - Spawned at world coordinate, projected to screen 2D canvas.
  - Scale pop to $1.4\times$, gravity acceleration $g = 350\text{px/s}^2$, elastic bounce on ground level.

## 5. Zero-GC Memory Rule
- NEVER use `new THREE.Vector3()`, `new THREE.Color()`, or `new Array()` in `requestAnimationFrame` or inside 60Hz tick loops.
- Use preallocated module-level variables: `_v1`, `_v2`, `_v3`, `_q1`.
