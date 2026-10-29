"""Extract original base Summoner's Rift nexus/inhibitors from the local Map11 WAD.

Only writes the output and extraction work directories. Skin/animation selection
comes from the shipped BIN records; original meshes, textures and clips are kept.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, struct, subprocess

REPO = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--wad', default='C:/Riot Games/League of Legends/Game/DATA/FINAL/Maps/Shipping/Map11.wad.client')
parser.add_argument('--tools', type=Path, default=REPO.parent/'garen-viewer/tools')
parser.add_argument('--work', type=Path, default=REPO.parent/'map-work/objects')
parser.add_argument('--output', type=Path, default=REPO/'public/assets/structures')
args = parser.parse_args()
raw = args.work/'raw'
args.work.mkdir(parents=True, exist_ok=True)
wadtools = [str(args.tools/'wadtools/wadtools.exe'), '-L', 'error', '--hashtable-dir', str(args.tools/'hashes')]
pattern = r'^assets/characters/(nexus/skins/(base|skin03)|inhibitor/skins/(base|skin02))/(animations/[^/]+\.anm|[^/]+\.(skn|skl|tex))$|^data/characters/(nexus|inhibitor)/(skins/skin[03]|animations/skin[023])\.bin$'
subprocess.run(wadtools+['extract', '-i', args.wad, '-o', str(raw), '-x', pattern, '--no-bin-paths'], check=True)
env = os.environ.copy()
env['DOTNET_ROOT'] = str((args.tools/'dotnet').resolve())
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()

def decode(source):
    result = subprocess.check_output(['node',str(REPO.parent/'unit-work/turrets/inspect-bin.js'),str(source)])
    data = json.loads(result.decode('utf8'))
    destination = args.work/(source.parent.parent.name+'-'+source.parent.name+'-'+source.stem+'.json')
    destination.write_text(json.dumps(data,indent=2)+'\n',encoding='utf8')
    return data

for kind in ['nexus','inhibitor']:
    out = args.output/('inhibitors' if kind=='inhibitor' else kind)
    out.mkdir(parents=True,exist_ok=True)
    records = []
    for team, skin in [('blue',0),('red',3)]:
        skin_bin = raw/f'data/characters/{kind}/skins/skin{skin}.bin'
        skin_data = decode(skin_bin)['entries'][0]
        properties = skin_data['skinMeshProperties']
        graph_id = skin_data['SkinAnimationProperties']['AnimationGraphData'].lower()
        animation_bin = raw/('data/'+graph_id+'.bin')
        graph = decode(animation_bin)['entries'][0]
        clips = graph['mClipDataMap']
        animations = sorted(set(c['mAnimationResourceData']['mAnimationFilePath'] for c in clips.values() if c.get('mAnimationResourceData',{}).get('mAnimationFilePath')))
        selection = args.work/'selected-animations'/f'{kind}-{team}'
        selection.mkdir(parents=True,exist_ok=True)
        for file in animations:
            shutil.copyfile(raw/file, selection/Path(file).name)
        mesh = raw/properties['simpleSkin'].lower()
        skeleton = raw/properties['skeleton'].lower()
        header = mesh.read_bytes()
        count = struct.unpack_from('<I',header,8)[0]
        materials = [header[12+i*80:76+i*80].split(b'\0')[0].decode() for i in range(count)]
        overrides = {m['Submesh']:m['texture'].lower() for m in properties.get('materialOverride',[])}
        textures = [overrides.get(m,properties['texture'].lower()) for m in materials]
        destination = out/f'{team}.glb'
        command = [str(args.tools/'lol2gltf.exe'),'skn2gltf','-m',str(mesh),'-s',str(skeleton),'-a',str(selection),'-g',str(destination),'--materials',*materials,'--textures',*[str(raw/t) for t in textures]]
        converted = subprocess.run(command,env=env,capture_output=True,text=True,encoding='utf8',errors='replace')
        assert converted.returncode==0 and destination.exists(),(converted.stdout,converted.stderr)
        content = destination.read_bytes()
        length = struct.unpack_from('<I',content,12)[0]
        gltf = json.loads(content[20:20+length])
        primitives = [p for m in gltf['meshes'] for p in m['primitives']]
        source_files = sorted(set([str(mesh.relative_to(raw)),str(skeleton.relative_to(raw)),str(skin_bin.relative_to(raw)),str(animation_bin.relative_to(raw)),*textures,*animations]))
        record = {'team':team,'file':destination.name,'sourceSkin':skin_data['championSkinName'],'bytes':len(content),'sha256':digest(destination),
            'joints':len(gltf['skins'][0]['joints']), 'initialHidden':properties['initialSubmeshToHide'].split(),
            'initialVisible':[m for m in materials if m not in properties['initialSubmeshToHide'].split()],
            'animations':[{'name':a['name'],'duration':max(gltf['accessors'][s['input']]['max'][0] for s in a['samplers'])} for a in gltf['animations']],
            'meshes':[{'name':gltf['materials'][p['material']]['name'],'vertices':gltf['accessors'][p['attributes']['POSITION']]['count'],'min':gltf['accessors'][p['attributes']['POSITION']]['min'],'max':gltf['accessors'][p['attributes']['POSITION']]['max']} for p in primitives],
            'sourceAnimationStates':{name:{'clip':Path(c['mAnimationResourceData']['mAnimationFilePath']).stem,'visibilityEvents':[event for event in c.get('mEventDataMap',{}).values() if event.get('_type')=='SubmeshVisibilityEventData']} for name,c in clips.items() if c.get('mAnimationResourceData',{}).get('mAnimationFilePath')},
            'sourceFiles':[{'path':Path(p).as_posix(),'sha256':digest(raw/p)} for p in source_files]}
        records.append(record)
        print(kind,team,record['bytes'], 'bytes',record['joints'],'joints',len(record['animations']),'clips',materials,flush=True)
    manifest = {'sourceWad':args.wad,'tools':{'wadtools':'0.5.7','lol2gltf':'1.0.0+d36a532'},'description':'Original Summoners Rift Order Blue skin0 and Chaos Red skin3, distinct faction geometry and original textures. Skin BIN defines mesh/textures; animation BIN defines included clips and mesh visibility.',
        'integration':{'uniformScale':3200/15000,'groundOffset':0,'notes':['Apply source map ground elevation to the model origin; below-ground foundations are authored.','Only initialVisible meshes should render while alive. Death graph swaps to Destroyed immediately.','Mesh motion is original. Particle graphs/audio are not included in these GLBs.','Source coordinates remain model-local and unscaled; terrain uses the shared source-to-game transform.']},'models':records}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
    (out/'README.md').write_text(f"# Original Summoner's Rift {kind}\n\nExtracted from the local League of Legends Map11.wad.client using `test/export_sr_objects.py`.\n\nBlue is Order skin0; red is Chaos skin3. The manifest records original model, skin, skeleton, animation graph and texture SHA-256 hashes, clips and initial/transition submesh visibility. GLBs embed textures, skeletons and original clips. Coordinates remain unscaled. The runtime must hide `Destroyed` while alive and swap visibility on death as recorded in the source graph.\n\nParticle effects and sound are not embedded in these skeletal assets.\n",encoding='utf8')
