# Original Summoner's Rift jungle monsters

Reproduce with `python test/export_sr_jungle.py`. Models, textures and core clips are selected from local Map11 character skin and animation BIN records. Each GLB embeds `extras.originalUnit` with exact state clips, hidden submeshes and source SkinScale. Runtime scale is `3200/15000 * sourceScale`. The manifest lists original file hashes and limitations.

Scuttle has no source attack/death clip; Baron has no locomotion role. Krug uses its explicit base diffuse texture rather than the GoldenKrug material shader. Dragon is the source Infernal skin. Particle graphs/audio, companions, splitting and elemental transformation gameplay are outside this model export.
