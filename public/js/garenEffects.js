import * as THREE from 'three';

// These are decoded base-skin textures. The particle composition/timing below is
// a web reconstruction, not Riot's particle graph or proprietary shader runtime.
const ASSET_ROOT = '/assets/champions/garen/effects/';
const TEXTURES = ['q_cas_flare', 'q_tar_slash', 'q_wpn_trail', 'q_hit_flash',
  'w_shield_txt', 'w_ground_glow', 'w_wings', 'w_glow_hoop', 'w_glow_glint', 'e_spin_topdown', 'e_spin_edge',
  'e_sword_trail', 'r_sword_plane', 'r_ground_decal', 'r_impact_dome',
  'r_explosion_scroll', 'r_lightbar'];
const _anchor = new THREE.Vector3();

export class GarenEffects {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
    this.textures = Object.create(null);
    this.disposed = false;
    this.plane = new THREE.PlaneGeometry(1, 1);
    this.shell = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.75);
    const loader = new THREE.TextureLoader();
    this.ready = Promise.all(TEXTURES.map(name => loader.loadAsync(`${ASSET_ROOT}${name}.png`)
      .then(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        if (this.disposed) { texture.dispose(); return; }
        this.textures[name] = texture;
      })));
    // Effects remain optional if a texture failed; surface the failure to callers/tests.
    this.ready.catch(error => { this.loadError = error.message; console.warn('Garen effect texture load failed', error); });
  }

  layer(effect, textureName, width, height, mode = 'ground', opacity = 1, color = 0xffffff) {
    const options = {
      map: this.textures[textureName] || null, color, transparent: true,
      opacity: this.textures[textureName] ? opacity : 0,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    };
    const material = mode === 'sprite' ? new THREE.SpriteMaterial(options) :
      new THREE.MeshBasicMaterial({ ...options, side: THREE.DoubleSide });
    const object = mode === 'sprite' ? new THREE.Sprite(material) :
      new THREE.Mesh(mode === 'shell' ? this.shell : this.plane, material);
    object.name = `GarenVfx_${textureName}`;
    object.scale.set(width, height, mode === 'shell' ? width : 1);
    if (mode === 'ground') object.rotation.x = -Math.PI / 2;
    object.frustumCulled = false;
    object.renderOrder = 3;
    effect.root.add(object);
    const layer = { object, material, textureName, opacity, width, height, mode };
    effect.layers.push(layer);
    return object;
  }

  trigger(event, player, group) {
    if (this.disposed || !event || event.type !== 'garenSkill') return;
    const key = event.key || event.skill;
    if (key !== 'Q' && key !== 'W' && key !== 'E' && key !== 'R') return;
    const ownerId = event.playerId || event.casterId || event.attackerId || player?.id;
    if (!ownerId) return;
    const phase = event.phase || 'cast';
    // The server can emit R hit and end in the same tick. End only stops the
    // cast/channel; finite impact bursts must retain their independent fade-out.
    if (phase === 'end' || phase === 'cancel') { this.clear(ownerId, key, 'cast'); return; }
    if (phase !== 'cast' && phase !== 'hit') return;
    if ((key === 'W' || key === 'E') && phase === 'hit') return;
    this.clear(ownerId, key);
    const root = new THREE.Group();
    root.name = `Garen_${key}_${phase}`;
    const castDuration = Math.max(0.1, event.duration || event.castTime || 0.5);
    const effect = {
      root, ownerId, targetId: event.targetId || null, key, phase, layers: [], time: 0, duration: 0,
      follow: phase === 'cast' && key !== 'R', anchor: null, spinAngle: 0,
      radius: event.radius || 325, castDuration,
      x: event.targetX ?? event.x ?? player?.x ?? group?.position.x ?? 0,
      y: event.targetY ?? event.y ?? player?.y ?? group?.position.z ?? 0
    };
    root.position.set(effect.x, 3, effect.y);
    if (key === 'Q' && phase === 'cast') {
      effect.duration = event.duration || 4.5;
      effect.anchor = group?.userData.garen?.root.getObjectByName('Buffbone_Glb_Weapon_1') || null;
      this.layer(effect, 'q_cas_flare', 37, 37, 'sprite', 0.9);
      const trail = this.layer(effect, 'q_wpn_trail', 22, 65, 'sprite', 0.8);
      trail.position.y = 10;
    } else if (key === 'Q') {
      effect.duration = 0.38;
      const slash = this.layer(effect, 'q_tar_slash', 115, 90, 'sprite');
      slash.position.y = 35;
      slash.material.rotation = 0.4;
      const flash = this.layer(effect, 'q_hit_flash', 90, 90, 'sprite', 0.8);
      flash.position.y = 27;
    } else if (key === 'W') {
      effect.duration = event.duration || 2;
      this.layer(effect, 'w_ground_glow', 150, 150, 'ground', 0.9);
      const shield = this.layer(effect, 'w_wings', 34, 39, 'shell', 0.22, 0xffd56b);
      shield.position.y = 24;
      const hoop = this.layer(effect, 'w_glow_hoop', 145, 145, 'sprite', 0.9);
      hoop.position.y = 34;
      const glint = this.layer(effect, 'w_glow_glint', 54, 54, 'sprite', 0.7);
      glint.position.y = 57;
    } else if (key === 'E') {
      effect.duration = event.duration || 3;
      const diameter = effect.radius * 2;
      // The server's 325-unit damage radius is a faint boundary. Keep the bright
      // sword motion around the .25-scale model rather than stretching the blade.
      this.layer(effect, 'e_sword_trail', diameter, diameter, 'ground', 0.08, 0xffedb2);
      const blade = this.layer(effect, 'e_sword_trail', 150, 150, 'ground', 0.95, 0xffedb2);
      blade.position.y = 25;
      const edge = this.layer(effect, 'e_sword_trail', 136, 136, 'ground', 0.7, 0xffb749);
      edge.position.y = 30;
      const body = this.layer(effect, 'e_spin_topdown', 108, 108, 'ground', 0.28);
      body.position.y = 27;
      effect.anchor = group?.userData.garen?.root.getObjectByName('Weapon') || null;
    } else if (phase === 'cast') {
      effect.duration = castDuration + 0.6;
      this.layer(effect, 'r_ground_decal', 155, 155, 'ground', 0.8);
      const sword = this.layer(effect, 'r_sword_plane', 92, 235, 'sprite', 1);
      sword.position.y = 300;
      const halo = this.layer(effect, 'r_lightbar', 115, 265, 'sprite', 0.6);
      halo.position.y = 160;
    } else {
      effect.duration = 0.75;
      this.layer(effect, 'r_ground_decal', 160, 160, 'ground', 0.95);
      const impact = this.layer(effect, 'r_impact_dome', 125, 125, 'sprite', 1);
      impact.position.y = 25;
      const flare = this.layer(effect, 'r_lightbar', 125, 270, 'sprite', 0.9);
      flare.position.y = 90;
    }
    if (effect.follow && group) root.position.copy(group.position);
    this.active.push(effect);
    this.scene.add(root);
    return effect;
  }

  removeAt(index) {
    const effect = this.active[index];
    this.scene.remove(effect.root);
    for (let i = 0; i < effect.layers.length; i++) effect.layers[i].material.dispose();
    const last = this.active.pop();
    if (index < this.active.length) this.active[index] = last;
  }

  clear(ownerId, key, phase = null) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const effect = this.active[i];
      if (effect.ownerId === ownerId && (!key || effect.key === key) && (!phase || effect.phase === phase)) this.removeAt(i);
    }
  }

  update(players, meshesById, dt) {
    if (this.disposed) return;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const effect = this.active[i];
      let player = null;
      for (let p = 0; p < players.length; p++) {
        if (players[p].id === effect.ownerId) { player = players[p]; break; }
      }
      if (!player || !player.isAlive) { this.removeAt(i); continue; }
      effect.time += dt;
      if (effect.follow && player.garen && effect.time > 0.08) {
        const remaining = effect.key === 'Q' ? player.garen.qRemaining :
          effect.key === 'W' ? player.garen.wRemaining : player.garen.eRemaining;
        if (Number.isFinite(remaining)) {
          if (remaining <= 0) { this.removeAt(i); continue; }
          effect.duration = Math.min(effect.duration, effect.time + remaining + 0.08);
        }
      }
      if (effect.time >= effect.duration) { this.removeAt(i); continue; }
      const group = meshesById[effect.ownerId];
      if (!effect.follow) effect.root.position.y = 3 + (this.navigation?.heightAt(effect.root.position.x, effect.root.position.z) || 0);
      effect.root.visible = group ? group.visible : false;
      if (effect.key === 'R' && effect.phase === 'cast' && effect.targetId) {
        for (let p = 0; p < players.length; p++) {
          if (players[p].id === effect.targetId) {
            effect.root.position.x = players[p].x;
            effect.root.position.z = players[p].y;
            break;
          }
        }
      }
      if (effect.follow && group) {
        effect.root.position.copy(group.position);
        effect.root.position.y = group.position.y + 3;
        if (effect.key === 'Q') {
          if (!effect.anchor && group.userData.garen) effect.anchor = group.userData.garen.root.getObjectByName('Buffbone_Glb_Weapon_1');
          if (effect.anchor) {
            effect.anchor.getWorldPosition(_anchor);
            effect.root.position.copy(_anchor);
          } else effect.root.position.y = group.position.y + 35;
        } else if (effect.key === 'E') {
          if (!effect.anchor && group.userData.garen) effect.anchor = group.userData.garen.root.getObjectByName('Weapon');
          if (effect.anchor) {
            effect.anchor.getWorldPosition(_anchor);
            effect.spinAngle = -Math.atan2(_anchor.z - effect.root.position.z, _anchor.x - effect.root.position.x);
          } else effect.spinAngle = effect.time * 12;
        }
      }
      const fade = Math.min(1, effect.time / 0.06, (effect.duration - effect.time) / 0.2);
      for (let l = 0; l < effect.layers.length; l++) {
        const layer = effect.layers[l];
        if (!layer.material.map && this.textures[layer.textureName]) {
          layer.material.map = this.textures[layer.textureName];
          layer.material.needsUpdate = true;
        }
        layer.material.opacity = layer.material.map ? layer.opacity * fade : 0;
        if (effect.key === 'E') {
          layer.object.rotation.z = l === 0 ? effect.time * 0.3 : effect.spinAngle + (l - 1) * 1.6;
        } else if (effect.key === 'Q' && effect.phase === 'cast') {
          const pulse = 0.92 + Math.sin(effect.time * 12) * 0.08;
          layer.object.scale.set(layer.width * pulse, layer.height * pulse, 1);
        } else if (effect.key === 'Q') {
          const expand = 0.8 + effect.time * 1.2;
          layer.object.scale.set(layer.width * expand, layer.height * expand, 1);
        } else if (effect.key === 'W' && layer.mode === 'shell') {
          layer.object.rotation.y = effect.time * 0.6;
        } else if (effect.key === 'R' && effect.phase === 'cast' && l === 1) {
          const progress = Math.min(1, effect.time / effect.castDuration);
          layer.object.position.y = 300 - 182.5 * progress * progress;
        } else if (effect.key === 'R' && effect.phase === 'hit') {
          const expand = 0.75 + effect.time * (l === 0 ? 1.2 : 2);
          layer.object.scale.set(layer.width * expand, layer.height * expand, 1);
        }
      }
    }
  }

  dispose() {
    this.disposed = true;
    while (this.active.length) this.removeAt(this.active.length - 1);
    for (const name of TEXTURES) this.textures[name]?.dispose();
    this.plane.dispose();
    this.shell.dispose();
  }
}
