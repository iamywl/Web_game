param(
  [string]$Wad = 'C:/Riot Games/League of Legends/Game/DATA/FINAL/Maps/Shipping/Map11.wad.client',
  [string]$Tools = (Join-Path $PSScriptRoot '../../garen-viewer/tools'),
  [string]$Work = (Join-Path $PSScriptRoot '../../unit-work/turrets')
)
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot '../public/assets/structures/turrets'
New-Item -ItemType Directory -Force $out,"$Work/animations" | Out-Null
& "$Tools/wadtools/wadtools.exe" --hashtable-dir "$Tools/hashes" extract -i $Wad -o "$Work/raw" -x '^assets/characters/turret/skins/base/(animations/(idle1|respawn|break[123])\.anm|turret_base\.(skn|skl)|turret_base(_rubble)?_tx_cm\.tex)$|^assets/characters/turret/skins/skin02/(turret_skin02\.(skn|skl)|animations/(idle1|respawn|break[123]|cloth_stage[12]|destroyed)\.anm)$|^assets/characters/turret/skins/skin03/turret_skin03(_rubble)?_tx_cm\.tex$|^data/characters/turret/(skins/skin[03]|animations/skin[02])\.bin$' --no-bin-paths
if ($LASTEXITCODE -ne 0) { throw 'Turret extraction failed' }
$env:DOTNET_ROOT = (Resolve-Path "$Tools/dotnet").Path
$base = "$Work/raw/assets/characters/turret/skins/base"
foreach ($clip in @('idle1','respawn','break1','break2','break3')) { Copy-Item -LiteralPath "$base/animations/$clip.anm" -Destination "$Work/animations/" -Force }
foreach ($team in @('blue','red')) {
  if ($team -eq 'blue') {
    $model = "$base/turret_base"; $animations = "$Work/animations"; $texture = "$base/turret_base_tx_cm.tex"
    $materials = @('Base','Stage1','Stage2','Stage3','Rubble','Broken1','Broken2','Broken3')
    $textures = @($texture,$texture,$texture,$texture,"$base/turret_base_rubble_tx_cm.tex",$texture,$texture,$texture)
  } else {
    $redBase = "$Work/raw/assets/characters/turret/skins/skin02"
    $model = "$redBase/turret_skin02"; $animations = "$redBase/animations"
    $texture = "$Work/raw/assets/characters/turret/skins/skin03/turret_skin03_tx_cm.tex"
    $rubble = "$Work/raw/assets/characters/turret/skins/skin03/turret_skin03_rubble_tx_cm.tex"
    $materials = @('Base','Stage1','Stage2','Stage3','Cloth1','Cloth2','RubbleBase','Rubble','Broken1','Broken2','Broken3')
    $textures = @($texture,$texture,$texture,$texture,$texture,$texture,$texture,$rubble,$texture,$texture,$texture)
  }
  & "$Tools/lol2gltf.exe" skn2gltf -m "$model.skn" -s "$model.skl" -a $animations -g "$out/$team.glb" --materials $materials --textures $textures
  if ($LASTEXITCODE -ne 0) { throw "Turret conversion failed: $team" }
}
node "$PSScriptRoot/export_turrets_manifest.js" "$Work/raw" $out
if ($LASTEXITCODE -ne 0) { throw 'Turret manifest verification failed' }
