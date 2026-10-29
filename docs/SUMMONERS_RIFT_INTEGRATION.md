# Original Summoner's Rift integration

## Play locally

Run `npm start` with Node.js 22.13 or newer and open `http://127.0.0.1:3000/`.
Create a **2v2, 5v5, or custom** room for the original Rift. A single human can start a practice match through the existing bot flow. The 1v1 mode retains its previous single-lane map. Existing ten champions, separate Garen and Yasuo, HUD controls, items, level progression, structure invulnerability, minion rewards, and match victory remain available.

## Extracted assets and coordinates

The installed `Map11.wad.client` supplies the current Default `Base_SRX` geometry and the matching `AIPath_SRX_3` navigation grid. Older `Base` geometry and the deprecated SRX_2 navigation reference are not mixed into the game.

- Full default terrain: 198 meshes, 645,491 original triangles, 137 textures, approximately 88.8 MB GLB. Ground, riverbed, cliffs, trees, grass, base platforms and surrounding scenery retain their original placement. Grass uses the source world-position tint texture.
- Original minimap, with its native 14850-unit extent mapped to game bounds `(0,32)–(3168,3200)`.
- 22 turrets, six inhibitors and two nexuses use original model/animation assets and all 30 original placements. Inhibitor revival restores its original intact model.
- Nine jungle model types replace the existing 16 camp entities: Baron, infernal dragon, blue/red buffs, scuttle, gromp, wolves, raptors and krugs. Their 43 available source clips drive idle, movement, attacks and death. A camp still contains the existing single main entity; companion monsters and split/spawn mechanics were not added.
- Six original minion routes and barracks positions; 18 camp locators and both fountain spawn points.

Source X maps to `gameX = X * 3200/15000`. Source Z maps to `gameY = (15000-Z) * 3200/15000`. Vertical height uses the same scale. Terrain, unit placement, input projection, health bars and local prediction use this common coordinate system.

Source/output hashes, conversion tools and shader adaptations are recorded in `public/assets/maps/summoners-rift/terrain-manifest.json`, the asset README, structure/jungle manifests, and [navigation evidence](SR_NAVIGATION_EVIDENCE.md). Extraction intermediates and the compatible mapgeo-v18 converter remain in the sibling `map-work/` directory; installed Riot files were not modified.

## Movement and gameplay integration

`public/js/mapNavigation.js` is shared by the authoritative server and immediate client prediction. The extracted 295×296 grid provides terrain walls, height, 39 connected brush areas, and team gates. A* searches respect the unit radius and live structures; exact swept capsule collision prevents crossing narrow wall corners or tunneling during movement. Clicking blocked terrain selects a nearby reachable grid position. Movement, knockbacks and ground dashes sweep against walls; explicit blinks/jumps select a clear landing point.

Minions follow source lane waypoints and replan when crowd separation makes the next segment obstructed. Separation itself is collision checked. Destroying structures and respawning inhibitors invalidate collision caches and routes. Stop, recall, death and respawn discard previous movement paths. Fountain camera limits allow the player to remain visible at the map edges.

Turret/nexus/inhibitor collision radii follow source pathfinding radii. The web game's champion combat distances and skill logic remain its own implementation. Rift turret attack range is **300 game units**, leaving a safe gap at the original lane positions while still covering the existing ranged-minion standoff distance. This is a deliberate web balance value, not the source attack range of 750 (160 after map scaling). ARAM turret range remains 380.

Right-click picking now tests raised entity meshes as well as their ground positions, including neutral monsters. Neutral IDs resolve consistently for attacks and homing projectiles, including Yasuo Wind Wall. Camps retaliate using their existing stats, grant their existing gold/experience without being counted as champion kills, and respawn. Scuttles remain peaceful and patrol within walkable river terrain. These are web gameplay behaviors, not extracted server code.

## Verification

- `node test/qa_suite.js`: 25 production Socket.IO integration checks.
- `node --test test/unit_snapshot_test.js test/garen_skills_test.js test/garen_snapshot_test.js test/yasuo_skills_test.js test/sr_engine_test.js test/sr_navigation_test.js test/sr_jungle_test.js`: 130 tests covering existing champions/units, source placements, wall clearance, six-lane progress, crowd detours, gates, structure lifecycles, ARAM stop/resume and neutral combat.
- `test/sr_browser_test.js`: actual lobby/draft and a normal unmodified production match, using mouse/keyboard input. Checks original map/30 structures/16 camp entities, all 12 champion choices, minimap travel, jungle wall detour, neutral basic attacks/retaliation, Garen skills and river height. Observers read state only; no test cheats are injected into the match.
- Browser model checks: existing units 53, nexus/inhibitors 51, jungle models 133. These include source clips, hidden mesh states, disposal and revival.
- Reports and actual game captures: `test/sr-results/`; production integration report: `test/qa_report.json`.

Path search buffers are reused. Paths and clearance layers allocate on commands, replanning or structure changes; regular swept movement allocates no vectors, colors or arrays. Loaded terrain geometry/textures are cached across matches; per-match map instances and unit rigs are removed safely, including late asynchronous loads.

## Scope

This is the complete **default static Rift layout**, not all elemental-map variants at once. Dynamic terrain transformations, Riot's procedural Faelights overlays, animated grass/water shaders and the original renderer/particle runtime are not implemented. Twelve textureless shader-only overlay planes were excluded because generic rendering obscured the actual terrain. Original textures are WebP compressed; grass tint and unsupported diffuse materials are rendered statically. Source clips that do not exist (for example scuttle attack/death and Baron run) are not synthesized or presented as extracted animations. Character mechanics, monster AI and effects remain Web_game implementations.
