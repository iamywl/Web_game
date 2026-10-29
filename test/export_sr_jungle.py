"""Export original Map11 primary jungle monsters and referenced animation clips.

The existing engine represents one main monster per camp. This exporter preserves
that scope; it does not introduce camp companions or new combat systems.
"""
from pathlib import Path
import argparse, hashlib, json, os, re, shutil, struct, subprocess
REPO=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--wad',default='C:/Riot Games/League of Legends/Game/DATA/FINAL/Maps/Shipping/Map11.wad.client')
parser.add_argument('--tools',type=Path,default=REPO.parent/'garen-viewer/tools')
parser.add_argument('--work',type=Path,default=REPO.parent/'map-work/jungle')
parser.add_argument('--output',type=Path,default=REPO/'public/assets/units/jungle')
args=parser.parse_args();raw=args.work/'raw';args.work.mkdir(parents=True,exist_ok=True);args.output.mkdir(parents=True,exist_ok=True)
wadtools=[str(args.tools/'wadtools/wadtools.exe'),'-L','error','--hashtable-dir',str(args.tools/'hashes')]
selections={
 'baron':('sru_baron','sru_baron_idle1',None,['sru_baron_attack1','sru_baron_attack2'],['sru_baron_death']),
 'dragon':('sru_dragon_fire','sru_dragon_idle_normal','sru_dragon_flying_run',['sru_dragon_flying_attack1'],['sru_dragon_death']),
 'buff_blue':('sru_blue','sru_blue_idle_normal','sru_blue_run',['sru_blue_attack1','sru_blue_attack2','sru_blue_attack3'],['sru_blue_death']),
 'buff_red':('sru_red','sru_red_idle1','sru_red_run',['sru_red_attack1','sru_red_attack2','sru_red_attack3'],['sru_red_death']),
 'scuttle':('sru_crab','sru_crab_idle1','sru_crab_run2',[],[]),
 'gromp':('sru_gromp','sru_gromp_idle1','sru_gromp_run',['sru_gromp_attack1','sru_gromp_attack1b'],['sru_gromp_death']),
 'wolves':('sru_murkwolf','sru_murkwolf_idle1','sru_murkwolf_run',['sru_murkwolf_attack1','sru_murkwolf_attack4'],['sru_murkwolf_death']),
 'raptors':('sru_razorbeak','sru_razorbeak_idle_normal1','sru_razorbeak_run',['sru_razorbeak_ranged_attack1','sru_razorbeak_ranged_attack2'],['sru_razorbeak_death']),
 'krugs':('sru_krug','krug_idle_normal','krug_run2',['krug_attack1','krug_attack4','krug_attack5'],['krug_death2'])
}
characters='|'.join(v[0] for v in selections.values())
subprocess.run(wadtools+['extract','-i',args.wad,'-o',str(raw),'-x',rf'^data/characters/({characters})/(skins/skin0|animations/skin0)\.bin$','--no-bin-paths'],check=True)
files=sorted(raw.glob('data/characters/*/*/skin0.bin'))
decoded=json.loads(subprocess.check_output(['node',str(REPO/'test/export_sr_jungle_bins.js'),*[str(p.resolve()) for p in files]]))
(args.work/'bins.json').write_text(json.dumps(decoded),encoding='utf8')
decoded={str(Path(k).relative_to(raw.resolve())).replace('\\','/'):v for k,v in decoded.items()}
jobs=[];resources=set()
for kind,(character,idle,run,attacks,deaths) in selections.items():
 skin_bin=f'data/characters/{character}/skins/skin0.bin';graph_bin=f'data/characters/{character}/animations/skin0.bin'
 skin_entries=decoded[skin_bin]['entries'];skin=next(e for e in skin_entries if e.get('skinMeshProperties'))
 assert not skin.get('error'),(character,skin)
 graph=next(e for e in decoded[graph_bin]['entries'] if e.get('mClipDataMap'))
 assert not graph.get('error'),(character,graph)
 props=skin['skinMeshProperties'];overrides={o['Submesh'].lower():o['texture'].lower() for o in props.get('materialOverride',[])}
 paths={Path(c['mAnimationResourceData']['mAnimationFilePath']).stem:c['mAnimationResourceData']['mAnimationFilePath'].lower() for c in graph['mClipDataMap'].values() if c.get('mAnimationResourceData',{}).get('mAnimationFilePath')}
 roles={'idle':idle,'run':run,'attacks':attacks,'deaths':deaths};selected=[idle,*([run] if run else []),*attacks,*deaths]
 assert all(name in paths for name in selected),(kind,selected,paths)
 anims=[paths[name] for name in selected]
 resources.update([props['simpleSkin'].lower(),props['skeleton'].lower(),props['texture'].lower(),*overrides.values(),*anims])
 hidden=[v.lower() for v in re.split(r'[,\s]+',props.get('initialSubmeshToHide','')) if v]
 death_visibility=[]
 for clip in graph['mClipDataMap'].values():
  if Path(clip.get('mAnimationResourceData',{}).get('mAnimationFilePath','')).stem in deaths:
   death_visibility += [ev for ev in clip.get('mEventDataMap',{}).values() if ev.get('_type')=='SubmeshVisibilityEventData']
 notes=[]
 if kind=='scuttle':notes.append('Source animation graph contains no attack/death clip. Peaceful crab uses original idle/run; death is a short web removal hold.')
 if kind=='baron':notes.append('Stationary Baron has no run role in the base graph.')
 if kind=='krugs':notes.append('GoldenKrug StaticMaterialDef entry could not be decoded; base SkinMeshDataProperties and graph decoded fully. Uses explicit original base diffuse texture, without the golden dynamic shader.')
 jobs.append((kind,props,overrides,anims,skin_bin,graph_bin,roles,hidden,death_visibility,notes))
pattern='^('+'|'.join(re.escape(p) for p in sorted(resources))+')$'
subprocess.run(wadtools+['extract','-i',args.wad,'-o',str(raw),'-x',pattern,'--no-bin-paths'],check=True)
env=os.environ.copy();env['DOTNET_ROOT']=str((args.tools/'dotnet').resolve())
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
records=[]
for kind,props,overrides,anims,skin_bin,graph_bin,roles,hidden,death_visibility,notes in jobs:
 mesh=raw/props['simpleSkin'].lower();skeleton=raw/props['skeleton'].lower();header=mesh.read_bytes();count=struct.unpack_from('<I',header,8)[0]
 materials=[header[12+i*80:76+i*80].split(b'\0')[0].decode() for i in range(count)]
 textures=[overrides.get(m.lower(),props['texture'].lower()) for m in materials]
 selection=args.work/'selected-animations'/kind;selection.mkdir(parents=True,exist_ok=True)
 for file in anims:shutil.copyfile(raw/file,selection/Path(file).name)
 destination=args.output/f'{kind}.glb'
 command=[str(args.tools/'lol2gltf.exe'),'skn2gltf','-m',str(mesh),'-s',str(skeleton),'-a',str(selection),'-g',str(destination),'--materials',*materials,'--textures',*[str(raw/t) for t in textures]]
 result=subprocess.run(command,env=env,capture_output=True,text=True,encoding='utf8',errors='replace')
 assert result.returncode==0 and destination.exists(),(kind,result.stdout,result.stderr)
 content=destination.read_bytes();length=struct.unpack_from('<I',content,12)[0];gltf=json.loads(content[20:20+length]);binary_chunks=content[20+length:]
 metadata={'kind':'jungle','type':kind,'sourceScale':props.get('SkinScale',1),'initialHidden':hidden,**roles,'deathVisibility':death_visibility}
 gltf.setdefault('extras',{})['originalUnit']=metadata
 payload=json.dumps(gltf,separators=(',',':')).encode('utf8');payload+=b' '*((-len(payload))%4)
 content=struct.pack('<4sII',b'glTF',2,20+len(payload)+len(binary_chunks))+struct.pack('<II',len(payload),0x4e4f534a)+payload+binary_chunks
 destination.write_bytes(content)
 primitives=[p for m in gltf['meshes'] for p in m['primitives']]
 source_files=sorted(set([str(mesh.relative_to(raw)),str(skeleton.relative_to(raw)),skin_bin,graph_bin,*textures,*anims]))
 record={'id':kind,'file':destination.name,'bytes':len(content),'sha256':digest(destination),'metadata':metadata,'joints':len(gltf['skins'][0]['joints']),
  'meshes':[{'name':gltf['materials'][p['material']]['name'],'vertices':gltf['accessors'][p['attributes']['POSITION']]['count'],'min':gltf['accessors'][p['attributes']['POSITION']]['min'],'max':gltf['accessors'][p['attributes']['POSITION']]['max']} for p in primitives],
  'animations':[{'name':a['name'],'duration':max(gltf['accessors'][s['input']]['max'][0] for s in a['samplers'])} for a in gltf['animations']],
  'notes':notes,'sourceFiles':[{'path':Path(p).as_posix(),'sha256':digest(raw/p)} for p in source_files]}
 records.append(record);print(kind,len(content),'bytes',record['joints'],'bones',len(gltf['animations']),'clips','scale',metadata['sourceScale'],'meshes',materials,flush=True)
manifest={'sourceWad':args.wad,'tools':{'wadtools':'0.5.7','lol2gltf':'1.0.0+d36a532'},'description':'Nine original primary jungle camp models selected by complete SkinMeshDataProperties and AnimationGraphData records. Dragon is original Infernal skin using the shared Air mesh, as the source skin specifies.','integration':{'mapScale':3200/15000,'multiplyBySourceSkinScale':True,'groundOffset':0,'notes':['Original skeletons, diffuse textures and referenced core clips. Original particle/sound graphs not included.','One primary monster per existing engine entity; no extra companions or camp splitting.']},'models':records}
(args.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
(args.output/'README.md').write_text("# Original Summoner's Rift jungle monsters\n\nReproduce with `python test/export_sr_jungle.py`. Models, textures and core clips are selected from local Map11 character skin and animation BIN records. Each GLB embeds `extras.originalUnit` with exact state clips, hidden submeshes and source SkinScale. Runtime scale is `3200/15000 * sourceScale`. The manifest lists original file hashes and limitations.\n\nScuttle has no source attack/death clip; Baron has no locomotion role. Krug uses its explicit base diffuse texture rather than the GoldenKrug material shader. Dragon is the source Infernal skin. Particle graphs/audio, companions, splitting and elemental transformation gameplay are outside this model export.\n",encoding='utf8')
