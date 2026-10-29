"""Extract/convert original Map11 base minions; only writes output/work directories.

Animation and texture selection follows WAD path hashes embedded in skin0.bin.
This preserves deliberate cross-character references (red melee locomotion, etc.).
Requires existing wadtools/lol2gltf + portable .NET in sibling garen-viewer/tools.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, struct, subprocess

REPO = Path(__file__).resolve().parents[1]
WORKSPACE = REPO.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--wad', default='C:/Riot Games/League of Legends/Game/DATA/FINAL/Maps/Shipping/Map11.wad.client')
parser.add_argument('--tools', type=Path, default=WORKSPACE/'garen-viewer/tools')
parser.add_argument('--work', type=Path, default=WORKSPACE/'unit-work/minions')
parser.add_argument('--output', type=Path, default=REPO/'public/assets/units/minions')
args = parser.parse_args()
raw = args.work/'raw'
args.work.mkdir(parents=True, exist_ok=True)
args.output.mkdir(parents=True, exist_ok=True)
wadtools = [str(args.tools/'wadtools/wadtools.exe'), '-L', 'error', '--hashtable-dir', str(args.tools/'hashes')]
pattern = r'^assets/characters/sru_(order|chaos)minion[^/]*/skins/base/(animations/.*\.anm|[^/]+\.(skn|skl|tex))$|^data/characters/sru_(order|chaos)minion[^/]*/(skins/(skin0|root)|animations/skin0)\.bin$'
subprocess.run(wadtools+['extract', '-i', args.wad, '-o', str(raw), '-x', pattern, '--no-bin-paths'], check=True)
inventory = json.loads(subprocess.check_output(wadtools+['list', '-i', args.wad, '-x', pattern, '-F', 'json'], text=True, encoding='utf8'))
(args.work/'inventory.json').write_text(json.dumps(inventory, indent=2), encoding='utf8')
chunks = inventory['chunks']
env = os.environ.copy(); env['DOTNET_ROOT'] = str((args.tools/'dotnet').resolve())
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()

def referenced(bin_path, suffix):
    content = bin_path.read_bytes()
    return [c['path'] for c in chunks if c['path'].endswith(suffix) and int(c['hash'],16).to_bytes(8,'little') in content]

def glb_json(path):
    content=path.read_bytes(); assert content[:4]==b'glTF'
    length=struct.unpack_from('<I',content,12)[0]
    return json.loads(content[20:20+length])

records=[]
for team,faction in [('blue','order'),('red','chaos')]:
    for kind in ['melee','ranged','siege','super']:
        key=f'{team}-{kind}'
        character=f'sru_{faction}minion{kind}'
        base=raw/f'assets/characters/{character}/skins/base'
        skin_bin=raw/f'data/characters/{character}/skins/skin0.bin'
        animation_bin=raw/f'data/characters/{character}/animations/skin0.bin'
        mesh=next(base.glob('*.skn')); skeleton=next(base.glob('*.skl'))
        textures=referenced(skin_bin,'.tex'); assert len(textures)==1,(character,textures)
        anims=[p for p in referenced(animation_bin,'.anm') if any(k in Path(p).stem for k in ['idle','run','attack','death'])]
        assert all(any(role in p for p in anims) for role in ['idle','run','attack','death']),character
        anim_dir=args.work/'selected-animations'/key; anim_dir.mkdir(parents=True, exist_ok=True)
        for p in anims: shutil.copyfile(raw/p,anim_dir/Path(p).name)
        header=mesh.read_bytes(); count=struct.unpack_from('<I',header,8)[0]
        materials=[header[12+i*80:76+i*80].split(b'\0')[0].decode() for i in range(count)]
        destination=args.output/f'{key}.glb'
        cmd=[str(args.tools/'lol2gltf.exe'),'skn2gltf','-m',str(mesh),'-s',str(skeleton),'-g',str(destination),'-a',str(anim_dir),'--materials',*materials,'--textures',*[str(raw/textures[0])]*len(materials)]
        result=subprocess.run(cmd,env=env,capture_output=True,text=True,encoding='utf8',errors='replace')
        assert result.returncode==0 and destination.exists(),(key,result.stdout,result.stderr)
        gltf=glb_json(destination)
        clips=[]
        for a in gltf['animations']:
            duration=max(gltf['accessors'][s['input']]['max'][0] for s in a['samplers'])
            clips.append({'name':a['name'],'duration':duration})
        primitives=[p for m in gltf['meshes'] for p in m['primitives']]
        accessors=[gltf['accessors'][p['attributes']['POSITION']] for p in primitives]
        bounds={'min':[min(a['min'][i] for a in accessors) for i in range(3)],'max':[max(a['max'][i] for a in accessors) for i in range(3)]}
        source_paths=[mesh,skeleton,skin_bin,animation_bin,*[raw/p for p in textures+anims]]
        roles={role:[c['name'] for c in clips if role in c['name']] for role in ['idle','run','attack','death']}
        record={'id':key,'team':team,'type':kind,'file':destination.name,'sourceCharacter':character,'bytes':destination.stat().st_size,'sha256':digest(destination),'joints':len(gltf['skins'][0]['joints']),'vertices':sum(a['count'] for a in accessors),'materials':materials,'bounds':bounds,'clips':clips,'roles':roles,'sourceFiles':[{'path':p.relative_to(raw).as_posix(),'sha256':digest(p)} for p in source_paths]}
        records.append(record)
        print(key,record['bytes'],'bytes,',record['joints'],'joints,',len(clips),'clips, bounds:',bounds)
manifest={'sourceWad':args.wad,'tools':{'wadtools':'0.5.7','lol2gltf':'1.0.0+d36a532'},'selectionEvidence':'Texture and animation paths matched by little-endian 64-bit WAD path hashes embedded in each character skin0.bin and animations/skin0.bin. Material labels read from SKN submeshes.','scope':'Original base model, skin texture and referenced idle/run/attack/death animations. No gameplay code or audio.','models':records}
(args.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
