import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createChampionMaterial } from './nprMaterial.js';

export const YASUO_MODEL_URL = '/assets/champions/yasuo/yasuo-base.glb';
const CLIPS = ['yasuo_idle1', 'yasuo_run1', 'yasuo_attack1', 'yasuo_attack2', 'yasuo_attack3', 'yasuo_attack4',
  'yasuo_spell1a', 'yasuo_spell1b', 'yasuo_spell1_wind', 'yasuo_spell1_dash', 'yasuo_spell2', 'yasuo_spell3', 'yasuo_spell4'];
let assetPromise;
export function loadYasuoAsset() {
  if (!assetPromise) assetPromise = new GLTFLoader().loadAsync(YASUO_MODEL_URL);
  return assetPromise;
}

export class YasuoAnimation {
  constructor(asset) {
    this.root = clone(asset.scene);
    this.root.name = 'YasuoBaseVisual';
    this.root.scale.setScalar(0.25);
    this.materials = [];
    this.skeletons = new Set();
    const meshes = [];
    this.root.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    for (const mesh of meshes) {
      this.skeletons.add(mesh.skeleton);
      // skin0.bin hides the flute during combat; it is only used by emotes.
      if (mesh.material.name === 'Yasuo_Instrument_Mat') { mesh.visible = false; continue; }
      const name = mesh.material.name;
      mesh.material = createChampionMaterial(0xffffff, 0x000000, {
        map: mesh.material.map, side: THREE.FrontSide, rimStrength: 0.12, rimColor: 0x9dd8ef, emissiveIntensity: 0.25
      });
      if (name === 'Yasuo_Base_Mat') this.bodyMaterial = mesh.material;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const material = new THREE.MeshBasicMaterial({ color: 0x101722, side: THREE.BackSide });
      material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.9;');
      };
      material.customProgramCacheKey = () => 'yasuo-skinned-outline-v1';
      const outline = new THREE.SkinnedMesh(mesh.geometry, material);
      outline.bindMode = mesh.bindMode; outline.bind(mesh.skeleton, mesh.bindMatrix);
      outline.frustumCulled = false; outline.userData.isOutline = true; mesh.add(outline);
      this.materials.push(mesh.material, material);
    }
    this.bodyMaterial ||= this.materials[0];
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = CLIPS.map(name => {
      const clip = asset.animations.find(c => c.name === name);
      if (!clip) throw new Error(`Missing Yasuo animation: ${name}`);
      return this.mixer.clipAction(clip);
    });
    for (let i = 2; i < this.actions.length; i++) {
      this.actions[i].setLoop(THREE.LoopOnce, 1); this.actions[i].clampWhenFinished = true;
    }
    this.current = -1; this.attackIndex = 0; this.qIndex = 0;
    this.attackRemaining = 0; this.skillRemaining = 0; this.skillIndex = 0;
    this.eRemaining = 0; this.rRemaining = 0; this.dead = false; this.disposed = false;
    this.transition(0); this.mixer.update(0);
  }

  transition(index, restart = false) {
    if (this.current === index && !restart) return;
    const previous = this.actions[this.current], next = this.actions[index];
    if (previous && previous !== next) previous.fadeOut(0.08);
    next.reset().setEffectiveWeight(1).fadeIn(0.08).play(); this.current = index;
  }

  once(index, duration) {
    this.transition(index, true);
    this.actions[index].setEffectiveTimeScale(this.actions[index].getClip().duration / Math.max(0.1, duration));
  }

  attack(attacksPerSecond) {
    if (this.dead || this.disposed || this.skillRemaining > 0 || this.eRemaining > 0 || this.rRemaining > 0) return;
    const index = 2 + this.attackIndex++ % 4;
    this.attackRemaining = Math.max(0.12, Math.min(1.1, 0.9 / Math.max(0.1, attacksPerSecond || 0.697)));
    this.once(index, this.attackRemaining);
  }

  sync(state) {
    if (!state) return;
    this.eRemaining = state.eRemaining || 0; this.rRemaining = state.rRemaining || 0;
  }

  skill(event) {
    if (this.dead || this.disposed || event.key === 'P') return;
    if (event.phase === 'end' || event.phase === 'cancel') {
      if (event.key === 'E') this.eRemaining = 0;
      if (event.key === 'R') this.rRemaining = 0;
      if ((event.key === 'E' && this.skillIndex === 11) || (event.key === 'R' && this.skillIndex === 12)) this.skillRemaining = 0;
      return;
    }
    if (event.phase !== 'cast') return;
    let index, duration;
    if (event.key === 'Q') {
      index = event.variant === 'tornado' ? 8 : event.variant === 'circle' ? 9 : 6 + this.qIndex++ % 2;
      duration = event.duration || 0.35;
    } else if (event.key === 'W') { index = 10; duration = 0.4; }
    else if (event.key === 'E') { index = 11; duration = event.duration || 0.3; this.eRemaining = duration; }
    else if (event.key === 'R') { index = 12; duration = event.duration || 1; this.rRemaining = duration; }
    else return;
    this.attackRemaining = 0; this.skillIndex = index; this.skillRemaining = duration;
    this.once(index, duration);
  }

  update(moving, delta, moveSpeed, alive = true) {
    if (this.disposed) return;
    if (!alive) {
      this.dead = true; this.attackRemaining = this.skillRemaining = this.eRemaining = this.rRemaining = 0;
      this.mixer.stopAllAction(); this.current = -1; return;
    }
    if (this.dead) { this.dead = false; this.transition(0); }
    if (delta <= 0) return;
    this.eRemaining = Math.max(0, this.eRemaining - delta);
    this.rRemaining = Math.max(0, this.rRemaining - delta);
    this.skillRemaining = Math.max(0, this.skillRemaining - delta);
    this.attackRemaining = moving ? 0 : Math.max(0, this.attackRemaining - delta);
    if (this.rRemaining > 0) {
      if (this.current !== 12) this.once(12, this.rRemaining);
    } else if (this.skillRemaining > 0) this.transition(this.skillIndex);
    else if (this.eRemaining > 0) {
      if (this.current !== 11) this.once(11, this.eRemaining);
    } else if (this.attackRemaining === 0) this.transition(moving ? 1 : 0);
    this.actions[1].setEffectiveTimeScale(Math.max(0.25, (moveSpeed || 345) / 345));
    this.mixer.update(delta);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
    for (const material of this.materials) material.dispose();
    for (const skeleton of this.skeletons) skeleton.dispose();
    this.root.removeFromParent();
  }
}

export function attachYasuoModel(group) {
  group.userData.yasuoPending = true;
  return loadYasuoAsset().then(asset => {
    if (group.userData.disposed) return null;
    const rig = new YasuoAnimation(asset), geometries = new Set(), materials = new Set();
    for (const child of group.children.slice()) {
      if (child === group.userData.groundRing) continue;
      child.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
      group.remove(child);
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const key of ['leftLeg','rightLeg','leftArm','rightArm','weapon','leftWeapon','cape','orbits']) delete group.userData[key];
    group.add(rig.root); group.userData.yasuo = rig; group.userData.yasuoPending = false;
    group.userData.torsoMat = rig.bodyMaterial; group.userData.baseEmissiveHex = 0; group.userData.isConcealed = undefined;
    return rig;
  }).catch(error => {
    group.userData.yasuoPending = false; group.userData.yasuoError = error.message;
    console.warn('Yasuo asset unavailable; retaining fallback.', error); return null;
  });
}
