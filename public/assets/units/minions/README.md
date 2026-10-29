# Original Summoner's Rift base minions

Eight independent GLB models were extracted from the installed `Map11.wad.client`: blue/order and red/chaos melee, ranged caster, siege cannon and super minions. Each contains the original mesh, skeleton, native texture atlas and idle/run/attack/death skeletal animations. Gameplay logic and audio are not included in this asset pack.

| Files | Joints (blue/red) | Clips (blue/red) |
|---|---:|---:|
| blue-melee.glb / red-melee.glb | 43 / 43 | 10 / 8 |
| blue-ranged.glb / red-ranged.glb | 43 / 46 | 7 / 6 |
| blue-siege.glb / red-siege.glb | 40 / 40 | 6 / 6 |
| blue-super.glb / red-super.glb | 58 / 62 | 6 / 6 |

There are 55 animation clips in total. `manifest.json` lists action-role mappings, durations, model bounds, material labels, source paths and SHA-256 hashes. Material labels come from each SKN submesh rather than guessed names. Each texture and animation was selected by matching its little-endian 64-bit WAD path hash against the corresponding `skins/skin0.bin` or `animations/skin0.bin` metadata.

The red melee skin intentionally references blue/order idle, run and death animations. The red super skin intentionally references the blue super idle animation. These are original cross-character asset references, verified in the local metadata. They are not missing-file substitutes.

## Reproduce

From `Web_game`, run `python test/export_minions.py`. The script accepts `--wad`, `--tools`, `--work` and `--output` overrides, and defaults to the existing sibling `garen-viewer/tools` and `unit-work/minions` folders. It reuses wadtools 0.5.7, lol2gltf d36a532, and the portable .NET runtime already installed for champion conversion. It never writes to the Riot installation.

`test/minion_asset_preview.html`, served by the local test server, shows all eight original models and checks original skinned vertex motion for every clip. The game integration chooses independent animation mixers for each unit while sharing static geometry and textures.

Riot Games retains rights to the original resources. These files were prepared locally for this requested integration; no upload or push was performed.
