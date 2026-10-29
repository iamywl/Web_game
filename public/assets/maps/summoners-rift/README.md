# Original Summoner's Rift environment

## Git LFS checkout

Map GLB files under `public/assets/maps/` are stored with Git LFS. Install Git LFS, then run `git lfs install` and `git lfs pull` after cloning or updating the repository. The working copy must contain the actual GLB, not the small LFS pointer, before starting the game. Existing pre-LFS commits retain their original Git blobs; this conversion does not rewrite shared history.

Extracted from this computer's `C:/Riot Games/League of Legends/Game/DATA/FINAL/Maps/Shipping/Map11.wad.client` on 2026-10-29. The installed `map11.bin` Default map skin references `Maps/MapGeometry/Map11/Base_SRX`. This package uses that current map, rather than the older `Base` geometry.

`map.glb` contains the original default terrain, riverbed, walls, rock formations, vegetation, base platforms, and peripheral scenery. The source file contains 586 meshes across mutually exclusive elemental variants. The installed map metadata sets `InitialVisibilityMask=1`; the delivered file retains that default layer plus shared geometry: 198 meshes, 645,491 triangles, 137 embedded original textures. Textures retain alpha and are encoded as WebP quality 92, capped at 2048 pixels per side. Geometry coordinates and triangles are retained without simplification.

The original 512×512 `assets/maps/info/map11/2dlevelminimap_base_baron1.tex` is decoded into `minimap.png`. Its source MapSkin `mSize` is 14850×14850, corresponding to web-map X 0–3168 and Y 32–3200; it should not be stretched across the full 3200×3200 playable coordinate square.

## Coordinates

The GLB keeps original X/Y/Z and does not apply the common converter X-axis flip. In the 3200×3200 web map, apply scale `(3200/15000, 3200/15000, -3200/15000)` and translate Z by 3200. Thus original world X becomes game X, and original world Z becomes `gameY = 3200 - sourceZ * 3200/15000`. Decorative background meshes extend well beyond the playable square and below the ground; they are not navigation boundaries.

## Conversion details

The bundled older converter could not read mapgeo version 18 or current material metadata. The local extraction work is in sibling `map-work/terrain/`:

- `compat_materials.py`: resolves current 64-bit XXH3 material names against strings embedded in the original mapgeo.
- `transcode-bin.js`: rewrites only extracted compatibility copies, resolving current file-hash fields to original paths with the installed LHDB tables.
- `converter/`: small converter built against LeagueToolkit commit `76bf57bf4fd195343dec610bf0f912a06b910914` using a portable .NET 10 SDK.
- `package_map.py`: selects the initial visibility layer, packages used geometry and textures, and writes the manifest.
- `tint_grass.py`: bakes static grass tint sampled from the Default MapSkin's original world-space tint texture.
- `check-preview.js`: loads the actual GLB through the project's Three.js GLTFLoader, reports mesh/texture counts, and captures overview and mid-lane views.

Two original shaders, `VertexDeform` and `SRX_DynamicEffect`, are not implemented by the converter. Their original `DiffuseTexture` references are restored as static unlit materials. The Default MapSkin also explicitly references `assets/maps/info/map11/grasstint_srx.tex`; its decoded original image is included as `grass-tint.png`. The 59 grass clusters sample this original world-space map at their source-world centers and retain that RGB multiplier in their GLB materials. This restores the source's local olive/teal coloration rather than inventing a uniform green. Original brush vertex colors are wind-control data (grayscale RGB with alpha 1/255), so they are not treated as ordinary diffuse vertex colors. Static center sampling approximates the original spatial shader; grass wind, per-pixel tint variation, dynamic ground effects, and original shader animation are not executed. Twelve textureless `FaeLights_Prototype_Mat` procedural indicator planes are omitted; rendering them as ordinary opaque meshes incorrectly covered terrain with large polygons. These are shader overlays, not collision walls or ground geometry. Elemental terrain changes are not enabled in this static default-map package.

Gameplay collision, heights, object placement, and pathfinding are provided separately by `navigation.json`, `placements.json`, and the game integration. Dynamic turrets, inhibitors, nexus, minions, champions, and monsters are separate game entities.

`terrain-manifest.json` records source/output SHA-256 hashes, mesh counts, image dimensions, coordinate transform, and compatibility adjustments. `preview.html` is an isolated visual inspection page; it is not a gameplay test.

## Verification

The packaged GLB loaded in Chromium with 198/198 textured unlit meshes, 645,491 triangles, and no page errors or missing resources. Overview and mid-lane captures verified the blue base at bottom-left, red base at top-right, all three lanes, jungle walls, and river without the former opaque shader-overlay defects. Actual movement and combat are verified by the separate game integration tests.
