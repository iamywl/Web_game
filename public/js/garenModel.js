import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createChampionMaterial } from './nprMaterial.js';

export const GAREN_MODEL_URL = '/assets/champions/garen/garen-base.glb';
const CLIPS = ['garen_2013_idle1', 'garen_2013_run', 'garen_2013_attack_01', 'garen_2013_attack_02',
  'garen_2013_run_spell1', 'garen_2013_spell1', 'garen_base_spell3_0', 'garen_2013_spell4'];
let assetPromise;

// Cache immutable geometry/textures; each player gets independent bones and materials.
export function loadGarenAsset() {
  if (!assetPromise) assetPromise = new GLTFLoader().loadAsync(GAREN_MODEL_URL);
  return assetPromise;
}

function skinnedOutline(mesh) {
  const material = new THREE.MeshBasicMaterial({ color: 0x111116, side: THREE.BackSide });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normal * 1.1;');
  };
  material.customProgramCacheKey = () => 'garen-skinned-outline-v1';
  const outline = new THREE.SkinnedMesh(mesh.geometry, material);
  outline.bindMode = mesh.bindMode;
  outline.bind(mesh.skeleton, mesh.bindMatrix);
  outline.frustumCulled = false;
  outline.userData.isOutline = true;
  mesh.add(outline);
  return material;
}

export class GarenAnimation {
  constructor(asset) {
    this.root = clone(asset.scene);
    this.root.name = 'GarenBaseVisual';
    this.root.scale.setScalar(0.25);
    this.materials = [];
    this.skeletons = new Set();
    const meshes = [];
    this.root.traverse(child => { if (child.isSkinnedMesh) meshes.push(child); });
    for (const mesh of meshes) {
      const map = mesh.material.map;
      mesh.material = createChampionMaterial(0xffffff, 0x000000, {
        map, side: THREE.FrontSide, rimStrength: 0.12, rimColor: 0xb6c7e0,
        emissiveIntensity: 0.25
      });
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.materials.push(mesh.material, skinnedOutline(mesh));
      this.skeletons.add(mesh.skeleton);
    }
    this.bodyMaterial = meshes[0].material;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = CLIPS.map(name => {
      const clip = asset.animations.find(c => c.name === name);
      if (!clip) throw new Error(`Missing Garen clip: ${name}`);
      return this.mixer.clipAction(clip);
    });
    for (let i = 2; i < 4; i++) {
      this.actions[i].setLoop(THREE.LoopOnce, 1);
      this.actions[i].clampWhenFinished = true;
    }
    for (const i of [5, 7]) {
      this.actions[i].setLoop(THREE.LoopOnce, 1);
      this.actions[i].clampWhenFinished = true;
    }
    this.qRemaining = 0;
    this.eRemaining = 0;
    this.rRemaining = 0;
    this.qHitRemaining = 0;
    this.current = -1;
    this.attackRemaining = 0;
    this.attackIndex = 0;
    this.dead = false;
    this.disposed = false;
    this.transition(0);
    this.mixer.update(0);
  }

  transition(index, restart = false) {
    if (index === this.current && !restart) return;
    const previous = this.actions[this.current];
    const next = this.actions[index];
    if (previous && previous !== next) previous.fadeOut(0.1);
    next.reset().setEffectiveWeight(1).fadeIn(0.1).play();
    this.current = index;
  }

  attack(attacksPerSecond) {
    if (this.dead || this.disposed || this.eRemaining > 0 || this.rRemaining > 0 || this.qHitRemaining > 0) return;
    const index = 2 + (this.attackIndex++ % 2);
    // Finish recovery before the next authoritative attack, including AS buffs.
    const duration = Math.max(0.12, Math.min(1.2, 0.9 / Math.max(0.1, attacksPerSecond || 0.75)));
    this.actions[index].setEffectiveTimeScale(this.actions[index].getClip().duration / duration);
    this.attackRemaining = duration;
    this.transition(index, true);
  }

  sync(state) {
    if (!state) return;
    this.qRemaining = state.qRemaining || 0;
    this.eRemaining = state.eRemaining || 0;
    this.rRemaining = state.rRemaining || 0;
  }

  skill(event) {
    if (this.dead || this.disposed) return;
    if (event.key === 'Q') {
      if (event.phase === 'cast') this.qRemaining = event.duration || 8;
      else {
        this.qRemaining = 0;
        if (event.phase === 'hit') {
          this.qHitRemaining = 0.5;
          this.actions[5].setEffectiveTimeScale(this.actions[5].getClip().duration / 0.5);
          if (!this.eRemaining && !this.rRemaining) this.transition(5, true);
        }
      }
    } else if (event.key === 'E' && event.phase !== 'hit') {
      this.eRemaining = event.phase === 'cast' ? (event.duration || 3) : 0;
      this.attackRemaining = 0;
      if (this.eRemaining) this.transition(6, true);
    } else if (event.key === 'R' && event.phase === 'cast') {
      this.rRemaining = event.duration || 0.5;
      this.attackRemaining = 0;
      this.actions[7].setEffectiveTimeScale(this.actions[7].getClip().duration / this.rRemaining);
      this.transition(7, true);
    } else if (event.key === 'R' && (event.phase === 'end' || event.phase === 'cancel')) {
      this.rRemaining = 0;
    }
    // W is an overlay effect; the base skin has no spell2 skeletal clip.
  }

  update(moving, delta, moveSpeed, alive = true) {
    if (this.disposed) return;
    if (!alive) {
      this.dead = true;
      this.attackRemaining = 0;
      this.qRemaining = this.eRemaining = this.rRemaining = this.qHitRemaining = 0;
      this.mixer.stopAllAction();
      this.current = -1;
      return;
    }
    if (this.dead) { this.dead = false; this.transition(0); }
    if (delta <= 0) return;
    this.qRemaining = Math.max(0, this.qRemaining - delta);
    this.eRemaining = Math.max(0, this.eRemaining - delta);
    this.rRemaining = Math.max(0, this.rRemaining - delta);
    this.qHitRemaining = Math.max(0, this.qHitRemaining - delta);
    if (moving) this.attackRemaining = 0; // movement cancels only the visual recovery
    else this.attackRemaining = Math.max(0, this.attackRemaining - delta);
    if (this.rRemaining > 0) this.transition(7);
    else if (this.eRemaining > 0) this.transition(6);
    else if (this.qHitRemaining > 0) this.transition(5);
    else if (this.attackRemaining === 0) this.transition(moving ? (this.qRemaining > 0 ? 4 : 1) : 0);
    this.actions[1].setEffectiveTimeScale(Math.max(0.25, (moveSpeed || 310) / 310));
    this.actions[4].setEffectiveTimeScale(Math.max(0.25, (moveSpeed || 310) / 418.5));
    this.mixer.update(delta);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const material of this.materials) material.dispose();
    for (const skeleton of this.skeletons) skeleton.dispose();
    this.root.removeFromParent();
  }
}

export function attachGarenModel(group) {
  group.userData.garenPending = true;
  return loadGarenAsset().then(asset => {
    if (group.userData.disposed) return null;
    const rig = new GarenAnimation(asset);
    // Keep selection/team rings and the outer group used by prediction/health bars.
    const oldChildren = group.children.slice();
    const geometries = new Set(), materials = new Set();
    for (const child of oldChildren) {
      if (child === group.userData.groundRing) continue;
      child.traverse(part => {
        if (part.geometry) geometries.add(part.geometry);
        if (part.material) materials.add(part.material);
      });
      group.remove(child);
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const key of ['leftLeg','rightLeg','leftArm','rightArm','weapon','leftWeapon','cape','orbits']) delete group.userData[key];
    group.add(rig.root);
    group.userData.garen = rig;
    group.userData.garenPending = false;
    group.userData.torsoMat = rig.bodyMaterial;
    group.userData.baseEmissiveHex = 0;
    group.userData.isConcealed = undefined; // apply current bush state to new materials
    return rig;
  }).catch(error => {
    group.userData.garenPending = false;
    group.userData.garenError = error.message;
    console.warn('Garen model unavailable; keeping procedural Blademaster.', error);
    return null;
  });
}
