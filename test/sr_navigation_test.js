'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MapNavigation = require('../public/js/mapNavigation.js').default;
const data = require('../public/assets/maps/summoners-rift/navigation.json');
const placements = require('../public/assets/maps/summoners-rift/placements.json');
const nav = new MapNavigation(data);
const championRadius = 22, minionRadius = 12;
function project(n, point, radius) {
  if (n.isWalkable(point.x, point.y, radius)) return { x:point.x, y:point.y };
  const i=n.nearest(point.x, point.y, radius);assert.ok(i>=0,'No nearby walkable cell');
  return { x:n.centerX(i), y:n.centerY(i) };
}
function assertSegment(n, a, b, radius, label) {
  // Denser than production ray sampling; detects unsafe path smoothing/edges.
  const distance=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(distance/.5));
  for(let s=0;s<=steps;s++){
    const x=a.x+(b.x-a.x)*s/steps,y=a.y+(b.y-a.y)*s/steps;
    assert.ok(n.isWalkable(x,y,radius),`${label}: unsafe segment at ${x.toFixed(3)},${y.toFixed(3)} radius${radius}`);
  }
}
function assertPath(n, start, target, radius, label) {
  const path=n.findPath(start.x,start.y,target.x,target.y,radius);
  assert.ok(path.length,`${label}: no path`);
  let previous=start;
  for(const point of path){assertSegment(n,previous,point,radius,label);previous=point;}
  const expected=project(n,target,radius);
  assert.ok(Math.hypot(previous.x-expected.x,previous.y-expected.y)<.01,`${label}: wrong destination`);
  return path;
}
test('Production CJS server can access the shared browser navigation class',()=>assert.equal(typeof MapNavigation,'function'));
test('Original navigation grid has matching dimensions, flags, heights and world transform',()=>{
  assert.equal(data.cols,295);assert.equal(data.rows,296);
  for(const key of ['walkable','flags','heights','bushes','bushIds'])assert.equal(data[key].length,data.cols*data.rows,key);
  assert.equal(data.cellSize,data.source.cellSize*data.source.scale);
  assert.ok(Math.abs(data.originX-data.source.min[0]*data.source.scale)<1e-8);
  assert.ok(data.heights.every(Number.isFinite));assert.ok(data.walkable.every(v=>v===0||v===1));
  assert.ok(Math.min(...data.heights)<0);assert.ok(Math.max(...data.heights)>35);
  assert.equal(data.source.sha256.length,64);assert.equal(placements.source.sha256.length,64);
});
test('Grid indexing rejects every out-of-range edge and preserves center indices',()=>{
  assert.equal(nav.index(data.originX-.01,data.originY),-1);assert.equal(nav.index(data.originX,data.originY-.01),-1);
  assert.equal(nav.index(data.originX+data.cols*data.cellSize,data.originY),-1);
  assert.equal(nav.index(data.originX,data.originY+data.rows*data.cellSize),-1);
  for(let i=0;i<nav.size;i+=137)assert.equal(nav.index(nav.centerX(i),nav.centerY(i)),i);
  for(const value of [NaN,Infinity,-Infinity])assert.equal(nav.isWalkable(value,100),false);
});
test('Raw wall flags reject movement and brush lookup follows the original cells',()=>{
  let blocked=0,brush=0;
  for(let i=0;i<nav.size;i+=31){const x=nav.centerX(i),y=nav.centerY(i);
    if((data.flags[i]&2)&&!(data.flags[i]&4)&&!(data.flags[i]&(1024|2048))){assert.equal(nav.isWalkable(x,y),false);blocked++;}
    assert.equal(nav.bushAt(x,y),!!data.bushes[i]);if(data.bushes[i])brush++;
    assert.equal(nav.heightAt(x,y),data.heights[i]);
  }
  assert.ok(blocked>100);assert.ok(brush>0);assert.equal(nav.heightAt(-100,-100),0);
});
test('Original spawn locations are traversable with champion clearance and source elevations',()=>{
  for(const [team,p]of Object.entries(placements.spawns)){
    assert.ok(nav.isWalkable(p.x,p.y,championRadius),team);
    assert.ok(Math.abs(nav.heightAt(p.x,p.y)-p.height)<1,team+' height');
  }
});
test('Clearance excludes cells next to walls while preserving open lane centers',()=>{
  const center=nav.nearest(1580,1620,championRadius);assert.ok(center>=0);
  assert.equal(nav.isWalkable(nav.centerX(center),nav.centerY(center),championRadius),true);
  let edge=-1;
  for(let i=0;i<nav.size;i++)if(data.walkable[i]&&!nav.isWalkable(nav.centerX(i),nav.centerY(i),championRadius)){edge=i;break;}
  assert.ok(edge>=0);assert.equal(nav.isWalkable(nav.centerX(edge),nav.centerY(edge),0),true);
  assert.equal(nav.isWalkable(nav.centerX(edge),nav.centerY(edge),championRadius),false);
});
test('A* cannot cross a diagonal corner between two blocked cells',()=>{
  const n=new MapNavigation({cols:2,rows:2,cellSize:10,walkable:[1,0,0,1]});
  assert.deepEqual(n.findPath(5,5,15,15,1),[]);
  n.move(5,5,15,15,1);assert.ok(n.resultX<10&&n.resultY<10);
});
test('Swept movement cannot tunnel through a solid wall in one large step',()=>{
  const n=new MapNavigation({cols:7,rows:5,cellSize:10,walkable:Array.from({length:35},(_,i)=>i%7===3?0:1)});
  n.move(15,25,55,25,2);assert.ok(n.resultX<=28&&n.resultY===25);assert.ok(n.isWalkable(n.resultX,n.resultY,2));
  assert.equal(n.lineClear(15,25,55,25,2),false);
  n.move(15,25,55,25,2,true);assert.equal(n.resultX,55);assert.equal(n.resultY,25);
  n.move(15,25,35,25,2,true);assert.ok(n.isWalkable(n.resultX,n.resultY,2));assert.notEqual(n.resultX,35);
});
const majorPoints=[...Object.entries(placements.spawns).map(([name,p])=>({name:name+' spawn',...p})),...placements.camps];
for(const target of majorPoints){test('Champion route from blue fountain to '+target.name,()=>{
  assertPath(nav,placements.spawns.blue,project(nav,target,championRadius),championRadius,target.name);
});}
for(const [name,route] of Object.entries(placements.routes)){test('All extracted '+name+' waypoints connect with minion clearance',()=>{
  // Source mid waypoint near the inhibitor wall is intentionally projected,
  // matching the runtime requirement for authored path hints inside collision.
  let start=project(nav,route[0],minionRadius);
  for(let i=1;i<route.length;i++){
    const end=project(nav,route[i],minionRadius);
    assertPath(nav,start,end,minionRadius,name+' segment'+i);start=end;
  }
});}
test('Champion paths avoid the original living turret/inhibitor/nexus placements',()=>{
  const n=new MapNavigation(data),structures=placements.structures.map(s=>({...s,radius:s.kind==='turret'?46:s.kind==='nexus'?65:42,isAlive:true}));
  n.setStructures(structures);
  for(const s of structures)assert.equal(n.isWalkable(s.x,s.y,championRadius),false,s.id);
  assertPath(n,placements.spawns.blue,placements.spawns.red,championRadius,'base to base with structures');
  for(const lane of ['top','mid','bot']){
    const r=placements.routes['blue_'+lane];let start=project(n,r[0],minionRadius);
    for(let i=1;i<r.length;i++){const end=project(n,r[i],minionRadius);assertPath(n,start,end,minionRadius,lane+' with structures '+i);start=end;}
  }
});
test('Destroy/respawn updates change cached structure collision layers',()=>{
  const n=new MapNavigation(data),p=placements.routes.blue_mid[8],structure={x:p.x,y:p.y,radius:45,isAlive:true};
  n.setStructures([structure]);assert.equal(n.layer(12)[n.index(p.x,p.y)],0);
  structure.isAlive=false;n.setStructures([structure]);assert.equal(n.isWalkable(p.x,p.y,12),true);assert.equal(n.layer(12)[n.index(p.x,p.y)],1);
  structure.isAlive=true;n.setStructures([structure]);assert.equal(n.isWalkable(p.x,p.y,12),false);assert.equal(n.layer(12)[n.index(p.x,p.y)],0);
});
test('Blink targeting an original jungle wall always lands on a clear cell',()=>{
  let checked=0;
  for(let i=0;i<nav.size&&checked<15;i+=37){
    const x=nav.centerX(i),y=nav.centerY(i);if(x<500||x>2700||y<500||y>2700||data.walkable[i])continue;
    nav.move(placements.spawns.blue.x,placements.spawns.blue.y,x,y,championRadius,true);
    assert.ok(nav.isWalkable(nav.resultX,nav.resultY,championRadius));checked++;
  }
  assert.equal(checked,15);
});
test('Invalid move inputs leave the caller position unchanged',()=>{
  const p=placements.spawns.blue;
  for(const value of [NaN,Infinity,-Infinity]){nav.move(p.x,p.y,value,p.y,championRadius);assert.equal(nav.resultX,p.x);assert.equal(nav.resultY,p.y);assert.deepEqual(nav.findPath(p.x,p.y,value,p.y,championRadius),[]);}
});
test('Source team gates permit the owning team and block the opponent',()=>{
  const n=new MapNavigation(data);
  for(const [team,flag,opponent]of [['blue',1024,'red'],['red',2048,'blue']]){
    const i=data.flags.findIndex(f=>(f&flag)&&!(f&4));assert.ok(i>=0,team+' gate exists');
    const x=n.centerX(i),y=n.centerY(i);n.team=team;assert.equal(n.isWalkable(x,y,0),true,team+' own gate');
    n.team=opponent;assert.equal(n.isWalkable(x,y,0),false,team+' enemy gate');
  }
});
test('Baked source structure footprints use live structure collision and reopen after death',()=>{
  const n=new MapNavigation(data);const i=data.flags.findIndex(f=>(f&4)&&!(f&(1024|2048)));assert.ok(i>=0);
  const x=n.centerX(i),y=n.centerY(i),s={x,y,radius:10,isAlive:true};
  n.setStructures([s]);assert.equal(n.isWalkable(x,y),false);n.layer(0);
  s.isAlive=false;n.setStructures([s]);assert.equal(n.isWalkable(x,y),true);assert.equal(n.layer(0)[i],1);
});
for(const [team,x,y,radius]of [
  ['blue',409.0190099429396,2773.5944619761544,16],
  ['blue',434.17332531614665,2691.18840014064,14],
  ['blue',499.77127059549076,2698.4411814941045,14],
  ['red',2668.1888620168297,475.6972786691097,16]
])test(`Off-center ${team} minion near nexus turret can connect to the navigation grid at${x.toFixed(1)},${y.toFixed(1)}`,()=>{
  const n=new MapNavigation(data);n.team=team;
  n.setStructures(placements.structures.map(s=>({...s,radius:s.kind==='turret'?46:s.kind==='nexus'?65:42,isAlive:true})));
  assert.ok(n.isWalkable(x,y,radius));const goal=placements.routes[team+'_mid'][1];
  assertPath(n,{x,y},project(n,goal,radius),radius,'off-center start');
});
