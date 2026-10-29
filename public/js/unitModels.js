import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createChampionMaterial } from './nprMaterial.js';

const assets = new Map();
const loader = new GLTFLoader();
const minionNames = { melee: 'melee', caster: 'ranged', cannon: 'siege', super: 'super' };
const structureFolders = { turret: 'turrets', nexus: 'nexus', inhibitor: 'inhibitors' };
const structureNames = { turret: 'OriginalTurret', nexus: 'OriginalNexus', inhibitor: 'OriginalInhibitor' };
export function unitModelUrl(kind, team, type) {
  const side = team === 'blue' ? 'blue' : 'red';
  if (kind === 'jungle') return `/assets/units/jungle/${type}.glb`;
  return structureFolders[kind] ? `/assets/structures/${structureFolders[kind]}/${side}.glb` :
    `/assets/units/minions/${side}-${minionNames[type] || 'melee'}.glb`;
}
export function loadUnitAsset(kind, team, type) {
  const url = unitModelUrl(kind, team, type);
  if (!assets.has(url)) assets.set(url, loader.loadAsync(url));
  return assets.get(url);
}

// Geometry/textures remain cached; every instance owns its bones and materials.
export class UnitModel {
  constructor(asset, kind, type) {
    this.kind = kind; this.type = type; this.root = clone(asset.scene);
    this.sourceMetadata = kind === 'jungle' ? asset.parser?.json?.extras?.originalUnit : null;
    this.isStructure = !!structureFolders[kind];
    this.root.name = structureNames[kind] || (kind === 'jungle' ? 'OriginalJungle' : 'OriginalMinion');
    this.root.scale.setScalar(kind === 'jungle' ? 3200 / 15000 * (this.sourceMetadata?.sourceScale || 1) : kind === 'nexus' || kind === 'inhibitor' ? 3200 / 15000 : kind === 'turret' ? 0.28 : type === 'super' ? 0.36 : type === 'cannon' ? 0.34 : 0.30);
    this.materials = []; this.meshes = []; this.skeletons = new Set();
    this.root.traverse(mesh => { if (mesh.isMesh) this.meshes.push(mesh); });
    for (const mesh of this.meshes) {
      const source = mesh.material;
      mesh.userData.unitPart = source.name;
      mesh.material = createChampionMaterial(0xffffff, 0x000000, {
        map: source.map, side: source.side, alphaTest: source.alphaTest,
        transparent: source.transparent, opacity: source.opacity, rimStrength: 0.1
      });
      mesh.material.name = source.name;
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.materials.push(mesh.material);
      if (mesh.skeleton) this.skeletons.add(mesh.skeleton);
      const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x172027, side: THREE.BackSide });
      outlineMaterial.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.65;');
      };
      outlineMaterial.customProgramCacheKey = () => 'original-unit-skinned-outline-v1';
      const outline = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, outlineMaterial) : new THREE.Mesh(mesh.geometry, outlineMaterial);
      if (mesh.isSkinnedMesh) { outline.bindMode = mesh.bindMode; outline.bind(mesh.skeleton, mesh.bindMatrix); }
      outline.userData.isOutline = true; outline.frustumCulled = false; mesh.add(outline);
      this.materials.push(outlineMaterial);
    }
    this.bodyMaterial = this.meshes[0]?.material;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = Object.create(null); this.attacks = []; this.deaths = [];
    for (const clip of asset.animations) {
      const action = this.mixer.clipAction(clip); this.actions[clip.name] = action;
      if (/idle/i.test(clip.name)) this.idle ||= clip.name;
      if (/run/i.test(clip.name)) this.run ||= clip.name;
      if (/attack/i.test(clip.name)) this.attacks.push(clip.name);
      if (/death/i.test(clip.name)) this.deaths.push(clip.name);
      if (!/idle|run/i.test(clip.name)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    }
    this.current = null; this.attackIndex = 0; this.attackRemaining = 0;
    this.lastAttackSequence = null; this.dead = false; this.finished = false;
    this.deathRemaining = 0; this.disposed = false; this.deathStarted = false;
    if (kind === 'turret') this.showTurretParts('Base', 'Cloth1', 'Cloth2');
    if (kind === 'nexus' || kind === 'inhibitor') {
      // The shipped graph uses a separate Destroyed mesh. Inhibitor idle_dead
      // is a dead-state loop, so generic first-/idle/ selection is incorrect.
      this.showBaseStructureParts(false);
      this.idle = kind === 'nexus' ? (this.actions.nexus_idle ? 'nexus_idle' : 'sruap_chaosnexus_idle') :
        (this.actions.inhibitor_idle1 ? 'inhibitor_idle1' : 'sruap_chaosinhibitor_idle_normal');
      this.deaths = [kind === 'nexus' ? (this.actions.nexus_death ? 'nexus_death' : 'sruap_chaosnexus_death') :
        (this.actions.inhibitor_death ? 'inhibitor_death' : 'sruap_chaosinhibitor_death')];
      this.bodyMaterial = this.meshes.find(mesh => mesh.visible)?.material;
    }
    if (this.sourceMetadata) {
      this.idle = this.sourceMetadata.idle; this.run = this.sourceMetadata.run;
      this.attacks = this.sourceMetadata.attacks; this.deaths = this.sourceMetadata.deaths;
      this.restoreJungleParts();
      this.bodyMaterial = this.meshes.find(mesh => mesh.visible)?.material;
    }
    this.transition(this.idle); this.mixer.update(0);
  }

  showBaseStructureParts(dead) {
    for (const mesh of this.meshes) mesh.visible = (mesh.userData.unitPart === 'Destroyed') === dead;
  }
  restoreJungleParts() {
    const hidden = this.sourceMetadata?.initialHidden;
    for (const mesh of this.meshes) mesh.visible = !hidden?.includes(mesh.userData.unitPart.toLowerCase());
  }
  showTurretParts(first, second, third) {
    for (const mesh of this.meshes) mesh.visible = mesh.userData.unitPart === first || mesh.userData.unitPart === second || mesh.userData.unitPart === third;
  }
  transition(name, duration = 0, restart = false) {
    if (!name || !this.actions[name] || (this.current === name && !restart)) return;
    const previous = this.actions[this.current], next = this.actions[name];
    if (previous && previous !== next) previous.fadeOut(0.07);
    next.reset().setEffectiveWeight(1).fadeIn(0.07).play();
    next.setEffectiveTimeScale(duration > 0 ? next.getClip().duration / duration : 1);
    this.current = name;
  }
  attack(as = 1) {
    if (this.dead || !this.attacks.length) return;
    this.attackRemaining = Math.max(0.15, Math.min(1.1, 0.85 / Math.max(0.1, as)));
    this.transition(this.attacks[this.attackIndex++ % this.attacks.length], this.attackRemaining, true);
  }
  die() {
    if (this.dead || this.disposed) return;
    this.dead = true; this.deathStarted = true; this.attackRemaining = 0;
    if (this.kind === 'turret') {
      // Source metadata proves intact Base and final Rubble. Break3 animates the
      // final fracture piece; its accelerated web timing does not affect damage.
      this.showTurretParts('Rubble', 'RubbleBase', 'Broken3');
      const name = Object.keys(this.actions).find(n => /break3/i.test(n));
      this.deathRemaining = 2.2; this.transition(name, 2.2, true);
    } else {
      if (this.kind === 'nexus' || this.kind === 'inhibitor') this.showBaseStructureParts(true);
      if (this.kind === 'jungle') {
        for (const event of this.sourceMetadata?.deathVisibility || []) {
          if ((event.mStartFrame || 0) > 0) continue;
          for (const mesh of this.meshes) {
            if (event.mHideSubmeshList?.includes(mesh.userData.unitPart)) mesh.visible = false;
            if (event.mShowSubmeshList?.includes(mesh.userData.unitPart)) mesh.visible = true;
          }
        }
      }
      const name = this.deaths[0];
      this.deathRemaining = name ? this.actions[name].getClip().duration + 0.2 : 0.2;
      this.transition(name, 0, true);
    }
  }
  sync(state, dt) {
    if (this.disposed) return;
    if (state.isAlive === false || state.hp <= 0) this.die();
    else if (this.dead && (this.kind === 'inhibitor' || this.kind === 'jungle')) this.revive();
    if (this.dead) { this.updateDeath(dt); return; }
    const sequence = state.attackSequence || 0;
    if (this.lastAttackSequence === null) {
      this.lastAttackSequence = sequence;
      if (state.isAttacking) this.attack(state.as);
    } else if (sequence !== this.lastAttackSequence) {
      this.lastAttackSequence = sequence; this.attack(state.as);
    }
    this.attackRemaining = Math.max(0, this.attackRemaining - dt);
    if (!this.attackRemaining) {
      const moving = !this.isStructure && !!this.run && (Math.abs(state.vx || 0) > 1 || Math.abs(state.vy || 0) > 1);
      this.transition(moving ? this.run : this.idle);
      if (moving && this.run) this.actions[this.run].setEffectiveTimeScale(Math.max(0.4, (state.speed || 150) / 150));
    }
    this.mixer.update(dt);
  }
  revive() {
    // Authoritative inhibitor respawn restores the original intact mesh. The
    // web game has no separate activation channel; it returns straight to idle.
    if ((this.kind !== 'inhibitor' && this.kind !== 'jungle') || this.disposed) return;
    this.dead = false; this.finished = false; this.deathStarted = false;
    this.deathRemaining = 0; this.attackRemaining = 0; this.lastAttackSequence = null;
    this.mixer.stopAllAction(); this.root.visible = true;
    if (this.kind === 'jungle') this.restoreJungleParts(); else this.showBaseStructureParts(false);
    this.transition(this.idle, 0, true); this.mixer.update(0);
  }
  updateDeath(dt) {
    if (this.finished || this.disposed) return;
    this.deathRemaining = Math.max(0, this.deathRemaining - dt); this.mixer.update(dt);
    if (this.deathRemaining === 0) {
      this.finished = true;
      if (this.kind === 'turret') { this.showTurretParts('Rubble', 'RubbleBase'); this.mixer.stopAllAction(); }
      if (this.kind === 'jungle') this.root.visible = false;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
    for (const mat of this.materials) mat.dispose();
    for (const skeleton of this.skeletons) skeleton.dispose();
    this.root.removeFromParent();
  }
}

function disposeFallback(group, preserveControls) {
  const geometries = new Set(), materials = new Set();
  for (const child of group.children.slice()) {
    if (preserveControls && (child === group.userData.shield || child === group.userData.laser || child === group.userData.rangeMesh)) continue;
    child.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    group.remove(child);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const key of ['gem','gyro','ring','leftLeg','rightLeg','weapon','staff','orb','wheels']) delete group.userData[key];
}
export function attachUnitModel(group, kind, team, type) {
  group.userData.unitPending = true;
  return loadUnitAsset(kind, team, type).then(asset => {
    if (group.userData.disposed || group.userData.dying) return null;
    const rig = new UnitModel(asset, kind, type);
    disposeFallback(group, !!structureFolders[kind]);
    group.add(rig.root); group.userData.unit = rig; group.userData.unitPending = false;
    group.userData.torsoMat = rig.bodyMaterial;
    return rig;
  }).catch(error => {
    group.userData.unitPending = false; group.userData.unitError = error.message;
    console.warn('Original unit asset unavailable; retaining fallback.', error); return null;
  });
}
export function disposeUnitGroup(group) {
  group.userData.disposed = true;
  group.userData.unit?.dispose();
  disposeFallback(group, false); group.removeFromParent();
}
