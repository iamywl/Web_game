# Summoner's Rift navigation and placement evidence

The imported data was extracted from the installed `Map11.wad.client`, without modifying the League installation. Run `node test/export_sr_navigation.js` to reproduce `public/assets/maps/summoners-rift/navigation.json` and `placements.json`. The script uses the existing wadtools/hash tables and validates every navigation cell's stored X/Z indices and the complete binary section lengths.

## Selecting the matching version

The installed `data/maps/shipping/map11/map11.bin` Default MapSkin points to `Maps/MapGeometry/Map11/Base_SRX`. The older skin navigation property still names `AIPath_SRX_2`; the actual Base_SRX MapContainer's MapNavGrid component points to `ASSETS/Maps/NavGrid/Map11/AIPath_SRX_3.aimesh_ngrid`, which is the navigation file used here. SRX_2 and SRX_3 differ in 4,210 cell flags. The original `Base` geometry is not the current Default container.

Placement data comes from `data/maps/mapgeometry/map11/base_srx.materials.bin`, particularly the SRS_Structures, SRS_Jungle, and SRS_Dragon MapPlaceableContainers. It includes 22 turrets, six inhibitors, two nexuses, six barracks spawn positions, three native MinionPath polylines (used in both directions), 18 neutral camp locators, and the two spawn-gate locators. MapLocatorArray in map11.bin is older than some current container placements, so the container takes precedence. Native character records, source object IDs, source coordinates and input SHA-256 digests are retained in the output.

## Coordinates and grid

- Source navigation version: 7.1, 295 columns × 296 rows, 50 source units per cell.
- Source min X/Y/Z: approximately `(-1.104897, -71.240601, 32.755798)`; max `(14718.400391, 184.520096, 14792.210938)`.
- Game transform: `x = sourceX * (3200 / 15000)`, `y = (15000 - sourceZ) * (3200 / 15000)`; height uses the same positive scale.
- Grid origin in game coordinates: `(-0.235711, 35.678763)`; cell size `10.666667`. Array rows run downward in game Y after reflecting source Z.
- 54,825 source-walkable cells; 39 connected brush patches. `bushIds` is `-1` outside brush and a nonnegative patch ID within brush.
- Ground height comes from the separate 591 × 593 original height sample grid, bilinearly sampled at navigation-cell centers. This avoids the native path cell's zero center-height placeholder on walls/gates. Output heights are game units, rounded to 0.001.

The v7 section layout and flag interpretation were cross-checked against the original parser [NGridFileReader.cs](https://github.com/FrankTheBoxMonster/LoL-NGRID-converter/blob/master/LoLNGRIDConverter/LoLNGRIDConverter/NGridFileReader.cs) and [NavGridCell.cs](https://github.com/FrankTheBoxMonster/LoL-NGRID-converter/blob/master/LoLNGRIDConverter/LoLNGRIDConverter/NavGridCell.cs). This is a file-format interpretation, not recovered live-server pathfinding code.

| Bit | Meaning | Export behavior |
| --- | --- | --- |
| 1 | Brush | Preserved in `bushes`, `bushIds`, `flags` |
| 2 | Wall | Blocks raw `walkable` |
| 4 | Structure wall | Preserved, also usually has wall bit; runtime should delegate these cells to live structure collision so destroyed structures can be crossed |
| 64 | Transparent wall / gate qualifier | Preserved; vision transparency does not by itself imply walkability |
| 1024 | Blue team only | Preserved in `flags`; requires team-aware runtime gate handling |
| 2048 | Red team only | Preserved in `flags`; requires team-aware runtime gate handling |

The raw exported `walkable` is team-neutral and only tests wall bit 2. `MapNavigation` copies that array and opens the 1,093 baked structure-footprint cells, then tests live structure circles. It also checks enemy gate bits using its `team` property; `null` permits both gates for generic inspection. Radius-clearance layers include the team in their cache key, and `setStructures` clears layers and increments `revision` for movement-path invalidation.

Path smoothing, adjacent A* edges and swept movement test the complete unit-radius capsule against each blocked cell rectangle and live structure circle. This avoids a corner-grazing failure that sparse point sampling can miss. Movement steps reuse scalar results and do not allocate vectors/arrays. Search buffers are created once; path arrays are created on commands/replanning.

## Validation evidence and useful match checks

Both original spawn-gate centers are walkable. Their independently sampled navigation heights agree with placement height within 0.21 game units. All six source lane routes were sampled every three game units; none of those sample points fell in a raw blocked cell. Dynamic structure radius and unit radius still need runtime clearance checks.

| Scenario | Start `(x,y)` | Destination `(x,y)` | Expected behavior |
| --- | --- | --- | --- |
| Blue jungle wall | `(830,1521)` | `(813,1820)` | Direct line blocked; route bends west around the wall |
| Blue base exit | `(500,2690)` | `(890,2380)` | Route bends near `(741,2558)` |
| River to Baron pit | `(938,1152)` | `(1068,966)` | Walkable river/pit, height about -15 |
| River to Dragon pit | `(2240,2097)` | `(2099,2262)` | Walkable river/pit, height about -15 |
| Jungle to river slope | `(830,1521)` | `(938,1152)` | Ground height changes from about +11 to -15 |

A diagnostic image is saved outside the repository at `../map-work/navigation/navigation-preview.png`; yellow lines are original lane paths, green cells are brush, and blue/red points are original structures.

## Additional scale evidence

The installed `data/characters/turret/turret.bin` records referenced by the map (`SR_Outer`, `SR_Inner`, `SR_Inhibitor`, and `SR_Nexus`) all contain `attackRangeModifiable.BaseValue = 750`. At this map scale that is 160 game units. The separate `SR_NexusTurret` record has 550, but Base_SRX's nexus tower placements reference `SR_Nexus`, not that record. All four referenced records declare `pathfindingCollisionRadius = 125` and `overrideGameplayCollisionRadius = [88.4000015]`. These are distinct fields; copying attack range alone does not reproduce the original target-radius distance convention or the game's full combat balance. The decoded evidence is `../map-work/navigation/turret-records.json`.

**Runtime choice:** Web_game uses **300 game units** for Summoner's Rift turret attack range, while retaining existing champion skill/basic-attack distances and minion standoff distances. Applying the scaled source value of 160 alone would let existing ranged minions attack beyond turret retaliation range. The 300 value is an explicit web-game combat adaptation, not an extracted original range. Source placement and pathfinding collision radii are applied at the common map scale. The legacy 1v1/ARAM turret range remains 380.

| Original character record | Source attack range | Source pathfinding radius | Scaled range / pathfinding radius |
| --- | --- | --- | --- |
| Turret/SR_Outer | 750 | 125 | 160 / 26.666667 |
| Turret/SR_Inner | 750 | 125 | 160 / 26.666667 |
| Turret/SR_Inhibitor | 750 | 125 | 160 / 26.666667 |
| Turret/SR_Nexus | 750 | 125 | 160 / 26.666667 |
| Nexus/Root | No attack range field | 304 | — / 64.853333 |
| Inhibitor/SR_Order | No attack range field | 213.75 | — / 45.6 |
| Inhibitor/SR_Chaos | No attack range field | 213.75 | — / 45.6 |

Nexus and inhibitor values were decoded from the current Map11 WAD's `data/characters/nexus/nexus.bin` and `data/characters/inhibitor/inhibitor.bin`; decoded evidence is `../map-work/navigation/nexus-records.json` and `inhibitor-records.json`. The deprecated objectcfg has different older inhibitor/nexus radii and is not used to override these current character records. Turret selection radius is 130; Nexus selection radius is 397.221985. Selection size is not the pathfinding radius.

The Default MapSkin's custom minimap backgrounds declare `mSize = [14850,14850]`, including `2dlevelminimap_base_baron1.tex`, and contain no explicit offset. With the current source-to-game transform and a zero source origin, that image spans game `(0,32)` to `(3168,3200)`. Stretching it across `(0,0)` to `(3200,3200)` introduces a one-percent spatial mismatch. The 15000 source extent remains a deliberate common transform for geometry/game bounds; it is not the native minimap image's declared extent.

## Scope

Original static navigation, heights and placements are imported. Web_game remains responsible for A* search, collision clearance, movement prediction, skill displacement, fog/brush behavior, minion decisions and combat. The export does not recover Riot server logic, dynamic elemental overlays, every seasonal terrain transition, or neutral monster AI. Particle and audio behavior is outside this navigation extraction.
