// Reproducible extraction of installed Map11 nav cells and map placements.
// NGRID v7 layout/flag names: FrankTheBoxMonster/LoL-NGRID-converter
// (NGridFileReader.cs and NavGridCell.cs). All exported coordinates are game units.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../..');
const work = path.join(root, 'map-work/navigation');
const out = path.resolve(__dirname, '../public/assets/maps/summoners-rift');
const wad = process.env.LEAGUE_MAP_WAD || 'C:/Riot Games/League of Legends/Game/DATA/FINAL/Maps/Shipping/Map11.wad.client';
const scale = 3200 / 15000;
const navPath = 'assets/maps/navgrid/map11/aipath_srx_3.aimesh_ngrid';
const matPath = 'data/maps/mapgeometry/map11/base_srx.materials.bin';
const mapPath = 'data/maps/shipping/map11/map11.bin';
fs.mkdirSync(work, {recursive:true}); fs.mkdirSync(out, {recursive:true});
execFileSync(path.join(root,'garen-viewer/tools/wadtools/wadtools.exe'), ['--hashtable-dir',path.join(root,'garen-viewer/tools/hashes'),'extract','-i',wad,'-o',work,'-x',`^(${navPath}|${matPath}|${mapPath})$`,'--no-bin-paths'], {stdio:'inherit'});
function decode(file) { return JSON.parse(execFileSync(process.execPath, [path.join(__dirname,'export_sr_navigation_bin.js'),path.join(work,file)], {encoding:'utf8',maxBuffer:64*1024*1024})); }
const materials = decode(matPath), map = decode(mapPath);
const container = materials.entries.find(e=>e.type==='MapContainer' && e.id==='Maps/MapGeometry/Map11/Base_SRX');
if(container?.components.find(c=>c?._type==='MapNavGrid')?.NavGridPath.toLowerCase()!==navPath) throw Error('MapContainer nav reference changed');
const b=fs.readFileSync(path.join(work,navPath));
if(b[0]!==7||b.readUInt16LE(1)!==1) throw Error('Unsupported NGRID version');
const min=Array.from({length:3},(_,i)=>b.readFloatLE(3+i*4));
const max=Array.from({length:3},(_,i)=>b.readFloatLE(15+i*4));
const size=b.readFloatLE(27),cols=b.readUInt32LE(31),rows=b.readUInt32LE(35),n=cols*rows;
const flagOffset=39+n*48, heightOffset=39+n*54+1056;
const hCols=b.readUInt32LE(heightOffset),hRows=b.readUInt32LE(heightOffset+4);
const hx=b.readFloatLE(heightOffset+8),hz=b.readFloatLE(heightOffset+12),hd=heightOffset+16;
if(hd+hCols*hRows*4+900*900*4+900*4!==b.length) throw Error('NGRID section lengths changed');
const flags=new Array(n),walkable=new Array(n),heights=new Array(n),bushes=new Array(n),bushIds=new Array(n).fill(-1);
function heightAt(x,z){
 const fx=Math.max(0,Math.min(hCols-1,(x-min[0])/hx)),fz=Math.max(0,Math.min(hRows-1,(z-min[2])/hz));
 const cx=Math.min(hCols-2,Math.floor(fx)),cz=Math.min(hRows-2,Math.floor(fz)),tx=fx-cx,tz=fz-cz;
 const read=(x,z)=>b.readFloatLE(hd+4*(z*hCols+x));
 return ((read(cx,cz)*(1-tx)+read(cx+1,cz)*tx)*(1-tz)+(read(cx,cz+1)*(1-tx)+read(cx+1,cz+1)*tx)*tz)*scale;
}
for(let z=0;z<rows;z++)for(let x=0;x<cols;x++){
 const src=z*cols+x,dst=(rows-1-z)*cols+x;
 if(b.readInt16LE(39+src*48+20)!==x||b.readInt16LE(39+src*48+22)!==z)throw Error('Cell indexing changed');
 const f=b.readUInt16LE(flagOffset+src*2); flags[dst]=f;
 // Team gates remain traversable here; flags retain 1024/2048 for team rules.
 // StructureWall cells remain blocked in raw source data; runtime may delegate
 // these to live structures so destroyed structures do not leave ghost walls.
 walkable[dst]=(f&2)?0:1; bushes[dst]=(f&1)?1:0;
 heights[dst]=Math.round(heightAt(min[0]+(x+.5)*size,min[2]+(z+.5)*size)*1000)/1000;
}
let bushCount=0; const queue=new Int32Array(n);
for(let start=0;start<n;start++){
 if(!bushes[start]||bushIds[start]!==-1)continue;
 let front=0,back=0;queue[back++]=start;bushIds[start]=bushCount;
 while(front<back){const at=queue[front++],x=at%cols,y=Math.floor(at/cols);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!dx&&!dy||x+dx<0||y+dy<0||x+dx>=cols||y+dy>=rows)continue;
   const next=at+dy*cols+dx;
   if(bushes[next]&&bushIds[next]===-1){bushIds[next]=bushCount;queue[back++]=next;}
  }
 }bushCount++;
}
const source={wad,entry:navPath,sha256:crypto.createHash('sha256').update(b).digest('hex'),version:'7.1',min,max,cellSize:size,scale,zReflection:15000,flagReference:'https://github.com/FrankTheBoxMonster/LoL-NGRID-converter/blob/master/LoLNGRIDConverter/LoLNGRIDConverter/NavGridCell.cs',flags:{brush:1,wall:2,structureWall:4,transparentWall:64,blueOnly:1024,redOnly:2048},heightGrid:{cols:hCols,rows:hRows,spacingX:hx,spacingZ:hz},bushCount};
const navigation={version:1,width:3200,height:3200,cols,rows,cellSize:size*scale,originX:min[0]*scale,originY:(15000-min[2]-rows*size)*scale,source,walkable,flags,heights,bushes,bushIds};
fs.writeFileSync(path.join(out,'navigation.json'),JSON.stringify(navigation));
const round=n=>Math.round(n*1000)/1000;
const position=v=>({x:round(v[0]*scale),y:round((15000-v[2])*scale),height:round(v[1]*scale),sourcePosition:v});
const lane=i=>['bot','mid','top'][i];
const all=[];for(const c of materials.entries.filter(e=>e.type==='MapPlaceableContainer')){
 if(c.error)throw Error('Placement container failed: '+c.id);
 for(const [id,item]of Object.entries(c.items||{}))if(item?.Transform)all.push({id,chunk:c.id,...item});
}
const structures=[],barracks={},paths={},spawns={},camps=[],locators=[];
for(const a of all){
 const p=position(a.Transform.slice(12,15)),team=a.Team?.Team===200?'red':'blue',record=a.Character?.CharacterRecord||'',ld=a.AttackableUnit?.LaneDefinition;
 if(/SRS_Structures$/.test(a.chunk)&&/^Characters\/(Turret|Nexus|Inhibitor)\//.test(record)){
  const kind=record.split('/')[1].toLowerCase(),role=record.split('/').pop().replace('SR_','').toLowerCase();
  const key=kind==='nexus'?team+'_nexus':kind==='inhibitor'?team+'_'+lane(ld.lane)+'_inhib':role==='nexus'?team+'_nexus_turret'+(ld.Position===5?1:2):team+'_'+lane(ld.lane)+'_'+(role==='inhibitor'?'inhib_turret':role);
  structures.push({id:key,kind,team,lane:lane(ld.lane),role,sourceId:a.id,character:record,skin:a.Character.Skin,...p,rotation:round(Math.atan2(a.Transform[8],a.Transform[10]))});
 }
 if(a.Barracks)barracks[team+'_'+lane(a.Barracks.lane)]={...p,sourceId:a.id};
 if(/^MinionPath_(Top|Mid|Bot)$/.test(a.name)){
  paths[a.name.split('_')[1].toLowerCase()]=a.Segments.map(v=>position([a.Transform[0]*v[0]+a.Transform[4]*v[1]+a.Transform[8]*v[2]+a.Transform[12],a.Transform[1]*v[0]+a.Transform[5]*v[1]+a.Transform[9]*v[2]+a.Transform[13],a.Transform[2]*v[0]+a.Transform[6]*v[1]+a.Transform[10]*v[2]+a.Transform[14]]));
 }
 if(a.name==='OrderSpawnGate')spawns.blue={...p,sourceId:a.id};
 if(a.name==='ChaosSpawnGate')spawns.red={...p,sourceId:a.id};
 if(a.NeutralCamp){const identifier=[...materials.entries,...map.entries].find(e=>e.id===a.NeutralCamp.CampIdentifier);camps.push({name:identifier?.CampName||a.name,sourceId:a.id,identifier:a.NeutralCamp.CampIdentifier,...p});}
 if(a._type==='MapLocator')locators.push({name:a.name,...p});
}
if(structures.length!==30||Object.keys(barracks).length!==6||Object.keys(paths).length!==3||!spawns.blue||!spawns.red)throw Error('Unexpected placement inventory');
const routes={};for(const l of ['top','mid','bot']){
 routes['blue_'+l]=[barracks['blue_'+l],...paths[l],barracks['red_'+l]];
 routes['red_'+l]=[...routes['blue_'+l]].reverse();
}
const placements={version:1,source:{entry:matPath,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(work,matPath))).digest('hex'),mapContainer:container.id,scale,zReflection:15000,note:'Structures, barracks, routes, camps and spawn gate locators decoded directly from MapPlaceableContainer. Non-gameplay materials may be skipped by BIN decoder; all placement containers must decode completely.'},structures,barracks,routes,spawns,camps,locators};
fs.writeFileSync(path.join(out,'placements.json'),JSON.stringify(placements,null,2));
console.log(JSON.stringify({cols,rows,walkable:walkable.reduce((a,b)=>a+b,0),bushCount,structures:structures.length,camps:camps.length,barracks:Object.keys(barracks),routes:Object.keys(routes),origin:[navigation.originX,navigation.originY]},null,2));
