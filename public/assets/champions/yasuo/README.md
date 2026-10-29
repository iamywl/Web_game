# Yasuo base skin, local extraction

`yasuo-base.glb` was converted from the installed `Yasuo.wad.client`, using wadtools 0.5.7 and lol2gltf d36a532. It contains the original SKN mesh, SKL skeleton (114 joints), 512×512 base texture and 13 ANM clips. No game executable or server code is included.

| Action | Source clip |
|---|---|
| Idle / movement | yasuo_idle1 / yasuo_run1 |
| Basic attack | yasuo_attack1, 2, 3, 4 |
| Q thrusts / tornado / E-Q | yasuo_spell1a, spell1b, spell1_wind, spell1_dash |
| W / E / R | yasuo_spell2 / spell3 / spell4 |

The source skin metadata hides `Yasuo_Instrument_Mat` in combat; the web rig hides that primitive too. The body and weapon share the original texture atlas. Web scale is 0.25, with independent cloned skeletons/materials and skinned toon outlines.

Reproduce the model with `powershell -File test/export_yasuo_model.ps1` from the checkout. The script reuses tools in sibling `garen-viewer/tools`; it does not modify the Riot installation. `manifest.json` records source and output hashes.

`effects/manifest.json` records 17 decoded original particle images. Three.js reconstructs their geometry and timing; it does not execute Riot's particle graphs. The local decode scripts and raw intermediate files are in sibling `yasuo-work/effects` (`extract-effects.ps1`, `convert_effects.py`).

`audio/README.md` and `audio/manifest.json` document the 17 decoded Wwise sound selections and reproduction steps. These are one deterministic authored variation, with web playback and no original Wwise bus simulation.

These original resources remain Riot Games assets. This task prepared a local implementation and did not publish or push them.
