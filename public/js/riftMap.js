import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './mapNavigation.js';

let mapPromise;
export function loadRiftMap(spec) {
  mapPromise ||= new GLTFLoader().loadAsync(spec.url).then(asset => {
    // Original painted diffuse maps already contain the environment lighting.
    // Preserve that art with unlit materials, avoiding a second PBR light pass.
    asset.scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      const convert = source => {
        const material = new THREE.MeshBasicMaterial({
          name: source.name, map: source.map, color: source.color,
          alphaTest: source.alphaTest, transparent: source.transparent,
          opacity: source.opacity, side: source.side, depthWrite: source.depthWrite,
          vertexColors: source.vertexColors, toneMapped: false
        });
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
      mesh.castShadow = false; mesh.receiveShadow = false;
    });
    return asset;
  });
  return mapPromise.then(asset => {
    const root = asset.scene.clone(true);
    root.name = 'OriginalSummonersRift';
    root.scale.set(spec.scale, spec.scale, -spec.scale);
    root.position.z = spec.sourceSize * spec.scale;
    return root;
  });
}
