const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const raw = path.resolve(process.argv[2] || path.join(__dirname,'../../unit-work/turrets/raw'));
const out = path.resolve(process.argv[3] || path.join(__dirname,'../public/assets/structures/turrets'));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources = ['assets/characters/turret/skins/base/turret_base.skn','assets/characters/turret/skins/base/turret_base.skl',
 'assets/characters/turret/skins/base/turret_base_tx_cm.tex','assets/characters/turret/skins/base/turret_base_rubble_tx_cm.tex',
 'assets/characters/turret/skins/skin02/turret_skin02.skn','assets/characters/turret/skins/skin02/turret_skin02.skl',
 'assets/characters/turret/skins/skin03/turret_skin03_tx_cm.tex','assets/characters/turret/skins/skin03/turret_skin03_rubble_tx_cm.tex',
 'data/characters/turret/skins/skin0.bin','data/characters/turret/skins/skin3.bin','data/characters/turret/animations/skin0.bin','data/characters/turret/animations/skin2.bin',
 ...['idle1','respawn','break1','break2','break3'].map(n=>`assets/characters/turret/skins/base/animations/${n}.anm`),
 ...['idle1','respawn','break1','break2','break3','cloth_stage1','cloth_stage2','destroyed'].map(n=>`assets/characters/turret/skins/skin02/animations/${n}.anm`)];
const models=['blue','red'].map(team=>{
 const file=team+'.glb',bytes=fs.readFileSync(path.join(out,file)),gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
 const joints=gltf.skins[0].joints.length;
 if(joints!==(team==='blue'?58:82))throw new Error('Unexpected skeleton');
 return {team,file,bytes:bytes.length,sha256:digest(path.join(out,file)),joints,
  animations:gltf.animations.map(a=>({name:a.name,duration:Math.max(...a.samplers.map(s=>gltf.accessors[s.input].max[0]))})),
  meshes:gltf.meshes.flatMap(m=>m.primitives.map(p=>({name:gltf.materials[p.material].name,vertices:gltf.accessors[p.attributes.POSITION].count,min:gltf.accessors[p.attributes.POSITION].min,max:gltf.accessors[p.attributes.POSITION].max}))) };
});
const manifest={sourceWad:'C:/Riot Games/League of Legends/Game/DATA/FINAL/Maps/Shipping/Map11.wad.client',tools:{wadtools:'0.5.7',lol2gltf:'d36a532'},
 description:'Original Summoners Rift OrderBlue skin0 and ChaosRed skin3; distinct faction geometry, original team and Rubble textures.',
 metadata:{sourceSkinScale:0.9,initialVisible:['Base'],initialHidden:['Stage1','Stage2','Stage3','Rubble','Broken1','Broken2','Broken3'],states:{Idle1:{clip:'idle1',visible:['Base']},State2:{clip:'idle1',visible:['Stage1']},State3:{clip:'idle1',visible:['Stage2']},Death:{clip:'idle1',visible:['Rubble'],separateDebris:{clip:'break3',visible:['Broken3'],lifetime:11}},Destroyed:{clip:'respawn',visible:['Rubble']},Respawn:{clip:'respawn',visible:['Broken1','Broken2','Broken3','Rubble'],showAtFrame438:['Stage1','Stage2','Stage3','Base']}},debris:{break1:{visible:['Broken1'],lifetime:10},break2:{visible:['Broken2'],lifetime:10},break3:{visible:['Broken3'],lifetime:11}},attackAnimation:null},
 redMetadata:{initialVisible:['Base','Cloth1','Cloth2'],initialHidden:['Stage1','Stage2','Stage3','Rubble','Broken1','Broken2','Broken3','RubbleBase'],states:{Idle1:{clip:'idle1',parallelClothClip:'cloth_stage1',visible:['Base','Cloth1','Cloth2']},State2:{clip:'idle1',visible:['Stage1','Cloth1']},State3:{clip:'idle1',visible:['Stage2']},Death:{clip:'idle1',visible:['Stage2','Stage3'],hideAtFrame16:['Stage2'],showAtFrame57:['RubbleBase','Rubble'],separateDebris:{clip:'break3',visible:['Broken3']}},Destroyed:{clip:'destroyed',visible:['Rubble','RubbleBase']}},attackAnimation:'Attack1 and Attack2 resolve to idle1; no distinct skeletal firing motion'},
 integration:{recommendedUniformScale:0.28,groundOffset:0,notes:['metadata describes blue; redMetadata describes ChaosRed.','Model has authored below-ground foundation; do not lift entire bbox to ground.','Break clips are VFX mesh debris, not a turret aiming animation.','HP stage thresholds are not established by the decoded animation graph.','Web code may shorten destruction duration; document that timing as reconstructed.']},
 sources:sources.map(file=>({path:file,bytes:fs.statSync(path.join(raw,file)).size,sha256:digest(path.join(raw,file))})),models};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({models:models.map(m=>({file:m.file,bytes:m.bytes,joints:m.joints,clips:m.animations.length})),sourceFiles:sources.length}));
