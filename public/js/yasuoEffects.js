import * as THREE from 'three';

// Locally decoded original base textures; particle geometry/timing is a web
// reconstruction. Riot's proprietary particle graphs are not executed here.
const ROOT = '/assets/champions/yasuo/effects/';
const NAMES = ['q_tornado_blade', 'q_second_swirl', 'q_tonado_wind_cas', 'q_wind_hit_flash', 'q_wind_hit_tar',
  'w_windwall_steam', 'w_windwall_indicator', 'w_windwall_block_impact',
  'e_dash_afterimage', 'e_dash_linger', 'e_dash_ring', 'e_tonado', 'eq_fill_circle_cas',
  'r_hit_streak_tar', 'r_hit_flash_tar_2', 'r_wind_blast', 'r_land_exp_ring'];

export class YasuoEffects {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
    this.textures = Object.create(null);
    this.disposed = false;
    this.plane = new THREE.PlaneGeometry(1, 1);
    this.funnel = new THREE.CylinderGeometry(0.5, 0.16, 1, 24, 1, true);
    const loader = new THREE.TextureLoader();
    this.ready = Promise.all(NAMES.map(name => loader.loadAsync(`${ROOT}${name}.png`).then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      if (this.disposed) texture.dispose(); else this.textures[name] = texture;
    })));
    this.ready.catch(error => { this.loadError = error.message; console.warn('Yasuo effect texture load failed', error); });
  }

  make(ownerId, key, phase, variant, x, y, angle, duration, snapshotId = null) {
    const root = new THREE.Group();
    root.name = `Yasuo_${key}_${variant}`;
    root.position.set(x, 3, y);
    root.rotation.y = -angle;
    const effect = { root, ownerId, key, phase, variant, x, y, angle, duration,
      time: 0, layers: [], snapshotId, snapshotKind: null, targetId: null, follow: false };
    this.active.push(effect);
    this.scene.add(root);
    return effect;
  }

  layer(effect, name, width, height, mode = 'ground', opacity = 1, atlas = false) {
    let texture = this.textures[name] || null;
    if (atlas) {
      texture = texture ? texture.clone() : new THREE.Texture();
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.repeat.set(0.5, 0.5);
      texture.offset.set(0, 0.5);
    }
    const options = { map: texture, color: 0xc9f5ff, transparent: true,
      opacity: texture?.image ? opacity : 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending };
    const material = mode === 'sprite' ? new THREE.SpriteMaterial(options) :
      new THREE.MeshBasicMaterial({ ...options, side: THREE.DoubleSide });
    const object = mode === 'sprite' ? new THREE.Sprite(material) :
      new THREE.Mesh(mode === 'funnel' ? this.funnel : this.plane, material);
    object.scale.set(width, height, mode === 'funnel' ? width : 1);
    if (mode === 'ground') object.rotation.x = -Math.PI / 2;
    if (mode === 'wall') object.rotation.y = Math.PI / 2;
    object.frustumCulled = false;
    object.renderOrder = 3;
    effect.root.add(object);
    effect.layers.push({ object, material, name, opacity, width, height, mode, atlas, ownMap: atlas });
    return object;
  }

  tornado(effect) {
    const lower = this.layer(effect, 'e_tonado', 80, 105, 'funnel', 0.85);
    lower.position.y = 53;
    const upper = this.layer(effect, 'q_tonado_wind_cas', 93, 95, 'funnel', 0.8);
    upper.position.y = 70;
    upper.rotation.y = 1.8;
    this.layer(effect, 'r_land_exp_ring', 100, 100, 'ground', 0.35);
  }

  wall(effect, width) {
    const steam = this.layer(effect, 'w_windwall_steam', width, 100, 'wall', 0.72);
    steam.position.y = 48;
    const rim = this.layer(effect, 'w_windwall_indicator', width, 87, 'wall', 0.75);
    rim.position.y = 42;
  }

  trigger(event, player, group) {
    if (this.disposed || !event) return;
    if (event.type === 'yasuoWallBlock') {
      const impact = this.make(event.playerId, 'W', 'hit', 'block', event.x, event.y, 0, 0.25);
      this.layer(impact, 'w_windwall_block_impact', 55, 85, 'sprite', 0.9).position.y = 35;
      return impact;
    }
    if (event.type !== 'yasuoSkill' || !'QWER'.includes(event.key || '!')) return;
    const key = event.key, phase = event.phase || 'cast', variant = event.variant || 'thrust';
    const ownerId = event.playerId || player?.id;
    if (!ownerId) return;
    if (phase === 'end' || phase === 'cancel') {
      // Authoritative walls/projectiles outlive their casting animation.
      for (let i = this.active.length - 1; i >= 0; i--) {
        const effect = this.active[i];
        if (effect.ownerId === ownerId && effect.key === key && effect.phase === 'cast' &&
            !effect.snapshotKind && variant !== 'tornado') this.removeAt(i);
      }
      return;
    }
    if (phase !== 'cast' && phase !== 'hit') return;
    if ((key === 'W' || key === 'E') && phase === 'hit') return;
    // Tornado hit events are small impacts, not additional moving tornadoes.
    const x = event.x ?? player?.x ?? group?.position.x ?? 0;
    const y = event.y ?? player?.y ?? group?.position.z ?? 0;
    const angle = event.angle ?? Math.atan2((event.targetY ?? y) - y, (event.targetX ?? x) - x);
    const effect = this.make(ownerId, key, phase, variant, x, y, angle,
      phase === 'hit' ? 0.3 : key === 'W' ? (event.duration || 4) :
        variant === 'tornado' ? 1 : key === 'R' ? (event.duration || 1) : key === 'E' ? (event.duration || 0.4) : 0.28);
    effect.targetId = event.targetId || null;
    if (phase === 'hit') {
      effect.root.position.set(event.targetX ?? x, 30, event.targetY ?? y);
      this.layer(effect, key === 'R' ? 'r_hit_flash_tar_2' : 'q_wind_hit_flash', 70, 70, 'sprite', 0.85);
      if (key === 'R') this.layer(effect, 'r_land_exp_ring', 145, 145, 'ground', 0.8).position.y = -26;
    } else if (key === 'W') {
      effect.root.position.set(event.targetX ?? x, 3, event.targetY ?? y);
      this.wall(effect, event.width || 350);
    } else if (key === 'Q' && variant === 'tornado') {
      this.tornado(effect);
    } else if (key === 'Q' && variant === 'circle') {
      effect.follow = true;
      this.layer(effect, 'r_land_exp_ring', 150, 150, 'ground', 0.85).position.y = 22;
      this.layer(effect, 'q_tonado_wind_cas', 130, 130, 'ground', 0.8).position.y = 27;
    } else if (key === 'Q') {
      this.layer(effect, 'q_tonado_wind_cas', 145, 35, 'ground', 1).position.set(66, 28, 0);
      this.layer(effect, 'q_wind_hit_flash', 45, 45, 'sprite', 0.85).position.set(110, 28, 0);
    } else if (key === 'E') {
      effect.follow = true;
      this.layer(effect, 'e_tonado', 110, 40, 'ground', 0.75).position.set(-36, 22, 0);
      this.layer(effect, 'e_dash_linger', 90, 55, 'sprite', 0.6).position.set(-23, 25, 0);
    } else if (key === 'R') {
      effect.root.position.set(event.targetX ?? x, 3, event.targetY ?? y);
      this.layer(effect, 'r_wind_blast', 125, 120, 'funnel', 0.65).position.y = 55;
      for (let i = 0; i < 3; i++) {
        const slash = this.layer(effect, 'r_hit_streak_tar', 110, 100, 'sprite', 0.85, true);
        slash.position.y = 50 + i * 12;
        slash.material.rotation = i * 2.1;
      }
    }
    return effect;
  }

  clear(ownerId) {
    for (let i = this.active.length - 1; i >= 0; i--) if (this.active[i].ownerId === ownerId) this.removeAt(i);
  }

  removeAt(index) {
    const effect = this.active[index];
    effect.root.removeFromParent();
    for (let i = 0; i < effect.layers.length; i++) {
      const layer = effect.layers[i];
      if (layer.ownMap) layer.material.map.dispose();
      layer.material.dispose();
    }
    const last = this.active.pop();
    if (index < this.active.length) this.active[index] = last;
  }

  // Objects/materials allocate only when an effect first appears; existing-frame
  // reconciliation and animation reuse records and scalar math without garbage.
  reconcile(snapshots, kind) {
    if (!snapshots) return;
    for (let s = 0; s < snapshots.length; s++) {
      const snapshot = snapshots[s];
      if (kind === 'projectile' && snapshot.type !== 'yasuo_tornado') continue;
      let effect = null;
      for (let i = 0; i < this.active.length; i++) {
        if (this.active[i].snapshotKind === kind && this.active[i].snapshotId === snapshot.id) { effect = this.active[i]; break; }
      }
      if (!effect) {
        effect = this.make(snapshot.playerId || snapshot.ownerId || null, kind === 'wall' ? 'W' : 'Q', 'cast',
          kind === 'wall' ? 'wall' : 'tornado', snapshot.x, snapshot.y, snapshot.angle || 0,
          kind === 'wall' ? snapshot.remaining : 2, snapshot.id);
        effect.snapshotKind = kind;
        if (kind === 'wall') this.wall(effect, snapshot.width); else this.tornado(effect);
      }
      effect.root.position.set(snapshot.x, 3, snapshot.y);
      effect.angle = snapshot.angle || 0;
      effect.root.rotation.y = -effect.angle;
      effect.duration = effect.time + (kind === 'wall' ? Math.max(0, snapshot.remaining) : 0.25);
    }
  }

  update(players, meshesById, dt, walls, projectiles) {
    if (this.disposed) return;
    this.reconcile(walls, 'wall');
    this.reconcile(projectiles, 'projectile');
    for (let i = this.active.length - 1; i >= 0; i--) {
      const effect = this.active[i];
      if (!effect.snapshotKind && effect.phase === 'cast' &&
          ((walls && effect.key === 'W') || (projectiles && effect.variant === 'tornado'))) { this.removeAt(i); continue; }
      const snapshots = effect.snapshotKind === 'wall' ? walls : projectiles;
      if (effect.snapshotKind && snapshots) {
        let found = false;
        for (let s = 0; s < snapshots.length; s++) if (snapshots[s].id === effect.snapshotId) { found = true; break; }
        if (!found) { this.removeAt(i); continue; }
      }
      let player = null;
      for (let p = 0; p < players.length; p++) if (players[p].id === effect.ownerId) { player = players[p]; break; }
      if (!effect.snapshotKind && (!player || !player.isAlive)) { this.removeAt(i); continue; }
      effect.time += dt;
      if (effect.time >= effect.duration) { this.removeAt(i); continue; }
      const group = meshesById[effect.ownerId];
      // World projectiles/walls remain visible independently of caster concealment.
      effect.root.visible = effect.snapshotKind ? true : !!group && group.visible;
      if (effect.follow && group) effect.root.position.copy(group.position);
      else {
        effect.localHeight ??= effect.root.position.y;
        effect.root.position.y = effect.localHeight + (this.navigation?.heightAt(effect.root.position.x, effect.root.position.z) || 0);
      }
      if (!effect.snapshotKind && effect.variant === 'tornado' && effect.phase === 'cast') {
        effect.root.position.x = effect.x + Math.cos(effect.angle) * 1200 * effect.time;
        effect.root.position.z = effect.y + Math.sin(effect.angle) * 1200 * effect.time;
      }
      if (effect.key === 'R' && effect.phase === 'cast' && effect.targetId) {
        for (let p = 0; p < players.length; p++) if (players[p].id === effect.targetId) {
          effect.root.position.x = players[p].x; effect.root.position.z = players[p].y; break;
        }
      }
      const fade = Math.max(0, Math.min(1, effect.time / 0.04, (effect.duration - effect.time) / 0.15));
      for (let l = 0; l < effect.layers.length; l++) {
        const layer = effect.layers[l];
        if (!layer.material.map?.image && this.textures[layer.name]) {
          if (layer.atlas) { layer.material.map.image = this.textures[layer.name].image; layer.material.map.needsUpdate = true; }
          else layer.material.map = this.textures[layer.name];
          layer.material.needsUpdate = true;
        }
        layer.material.opacity = layer.material.map?.image ? layer.opacity * fade : 0;
        if (layer.mode === 'funnel') layer.object.rotation.y = effect.time * (l === 0 ? 10 : -8) + l;
        if (effect.key === 'W' && layer.mode === 'wall') layer.material.opacity *= 0.88 + Math.sin(effect.time * 8 + l) * 0.12;
        if (effect.key === 'R' && layer.mode === 'sprite' && effect.phase === 'cast') {
          layer.material.rotation = effect.time * 9 + l * 2.1;
          layer.material.opacity *= 0.35 + 0.65 * Math.abs(Math.sin(effect.time * 15 + l * 1.5));
        }
        if (effect.variant === 'circle') layer.object.rotation.z = effect.time * 16 + l;
      }
    }
  }

  dispose() {
    this.disposed = true;
    while (this.active.length) this.removeAt(this.active.length - 1);
    for (const name of NAMES) this.textures[name]?.dispose();
    this.plane.dispose(); this.funnel.dispose();
  }
}
