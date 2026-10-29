# Garen base assets

The independent **garen** champion is displayed as **가렌**. The original **blademaster** (검객) retains its original model, mana, stats and abilities. garen-base.glb contains the original base mesh, 512×512 color texture, 68-joint skeleton and eight clips: idle1, run, attack_01, attack_02, run_spell1, spell1, spell4, spell3_0.

Source: installed League of Legends/Game/DATA/FINAL/Champions/Garen.wad.client, WAD 3.4, extracted 2026-10-29 with wadtools 0.5.7 and converted with lol2gltf d36a532. Original game resources belong to their respective rights holder.

- Source WAD SHA-256: bc78c6f50c5f51ce1c179d8850dfd6a805853ab68c8bdaedf1377c05c89a9cb3
- GLB SHA-256: 0443bdcd944fc78d7ad210a9bad28803cd224985da93a934c4c6e7c5301a40b5
- Mesh: 3,932 vertices / 6,336 triangles, scale 0.25, +Z forward.
- Rebuild: sibling garen-viewer/extract-garen-skills.ps1; raw files and tools live in that project.
- effects/manifest.json: 17 decoded original particle textures and source paths/hashes.
- audio/audio-manifest.json: 9 decoded Wwise event mixes, event IDs and media provenance.

Q uses run_spell1 and spell1; E uses spell3_0; R uses spell4. There is no base spell2 skeletal clip: W overlays a barrier on the current pose. Original particle graph/shaders are reconstructed with Three.js layers. Audio preserves a deterministic variation, without full Wwise bus processing. Detailed gameplay magnitudes include documented local approximations.

The runtime uses toon/rim materials and skinned outlines, independent player skeletons, accepted server events, movement/attack transitions, hit-stop, and cleanup on death. Missing model data retains the procedural fallback.

