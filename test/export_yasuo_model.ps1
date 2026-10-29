param(
  [string]$Wad = 'C:/Riot Games/League of Legends/Game/DATA/FINAL/Champions/Yasuo.wad.client',
  [string]$Tools = (Join-Path $PSScriptRoot '../../garen-viewer/tools'),
  [string]$Work = (Join-Path $PSScriptRoot '../../yasuo-work/extracted')
)
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot '../public/assets/champions/yasuo/yasuo-base.glb'
& "$Tools/wadtools/wadtools.exe" --hashtable-dir "$Tools/hashes" extract -i $Wad -o $Work -x 'assets/characters/yasuo/skins/base/(yasuo\.(skn|skl)|yasuo_base_tx_cm\.tex|animations/yasuo_(idle1|run1|attack[1234]|spell1a|spell1b|spell1_wind|spell1_dash|spell2|spell3|spell4)\.anm)$|data/characters/yasuo/skins/skin0.bin' --no-bin-paths
if ($LASTEXITCODE -ne 0) { throw 'Yasuo extraction failed' }
$env:DOTNET_ROOT = (Resolve-Path "$Tools/dotnet").Path
$base = "$Work/assets/characters/yasuo/skins/base"
& "$Tools/lol2gltf.exe" skn2gltf -m "$base/yasuo.skn" -s "$base/yasuo.skl" -g $out -a "$base/animations" --materials Yasuo_Instrument_Mat Yasuo_Base_Weapon_Mat Yasuo_Base_Mat --textures "$base/yasuo_base_tx_cm.tex" "$base/yasuo_base_tx_cm.tex" "$base/yasuo_base_tx_cm.tex"
if ($LASTEXITCODE -ne 0) { throw 'Yasuo GLB conversion failed' }
Get-FileHash -LiteralPath $out -Algorithm SHA256
