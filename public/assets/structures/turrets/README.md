# Original Summoner's Rift turret models

`blue.glb` is original **OrderBlue skin0**, with 58 bones and5 clips. `red.glb` is original **ChaosRed skin3**, with82 bones and8 clips. Their faction silhouettes differ; red is not a recolored blue model. Source: `Map11.wad.client`, `assets/characters/turret/skins/base/` for blue, `skin02` mesh/animations and `skin03` textures for red. Both include their original Rubble texture overrides. See `manifest.json` for source/output hashes, bounds and clip lengths.

## Source-confirmed visibility and animations

The decoded blue `data/characters/turret/skins/skin0.bin` hides every mesh except **Base** initially. `animations/skin0.bin` establishes:

| State | Visible mesh | Source animation |
|---|---|---|
| Idle1 | Base | idle1 (one-frame pose) |
| State2 | Stage1 | idle1 |
| State3 | Stage2 | idle1 |
| Death | Rubble | idle1, plus a separate Broken3 debris emitter |
| Destroyed | Rubble | respawn (only rubble visible) |
| Respawn | Broken1/2/3 + Rubble, then intact meshes at frame438 | respawn |

The shared source VFX definition confirms `break1` animates **Broken1**, `break2` animates **Broken2**, and `break3` animates **Broken3**, each as a separate SKN particle mesh. Their authored lifetimes are10,10,11 seconds. The original particle renderer is not executed in this web game; it may combine Rubble+Broken3 and shorten the destruction playback. HP thresholds for State2/3 are not established here.

There is **no dedicated attack skeletal animation** in this base animation graph. Keep the game's actual firing projectile/beam and add its existing feedback rather than labelling a made-up recoil as an extracted attack clip. `idle1` is a static pose, not continuous visible motion.

Red `skin3.bin` initially shows **Base, Cloth1, Cloth2**. Its `animations/skin2.bin` defines State2 as Stage1+Cloth1 and State3 as Stage2. Death initially shows Stage2+Stage3, hides Stage2 at frame16, then shows RubbleBase+Rubble at frame57 while a separate Broken3 particle animates. Final Destroyed uses `destroyed.anm` with Rubble+RubbleBase. The exported extra red clips are `cloth_stage1`, `cloth_stage2`, and `destroyed`; red idle1 is1.867s. Original Attack1/Attack2 states both point to idle1, so they have no separate recoil clip.

The blue model spans x±137,z±162,y−307..611 before scaling; red spans x±144,z±154,y−487..634. Their negative-height foundations are intended underground: use ground offset0, with uniform scale≈0.28 to fit this game's radius46 footprint and above-ground heights≈171/178.

## Reproduce

Run `powershell -File test/export_turrets.ps1` from this checkout. It reuses wadtools0.5.7, lol2gltf d36a532 and portable .NET in sibling `garen-viewer/tools`. `test/export_turrets_manifest.js` checks generated metadata and writes hashes. Local decoded source evidence is retained in sibling `unit-work/turrets/{skin0,skin3,animation-graph,animation-graph-red,shared}.json`. Riot installation files are read only; no client executable or server code is copied.

Original resource rights remain with Riot Games. This extraction is prepared for the requested local implementation and has not been uploaded or pushed.
