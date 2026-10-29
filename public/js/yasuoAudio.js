const FILES = ['attack-1','attack-2','attack-3','q-cast','q2-cast','q-hit','q3-cast','q3-wind','q3-hit',
  'w-cast','w-wall','w-hit','e-cast','e-hit','r-cast','r-active','r-hit'];

export class YasuoAudio {
  constructor(engine = window.soundEngine) {
    this.engine = engine; this.buffers = Object.create(null); this.active = new Set();
    this.attackCounts = Object.create(null); this.lastHits = Object.create(null); this.disposed = false;
    this.ready = engine?.ctx ? Promise.all(FILES.map(async name => {
      const response = await fetch(`/assets/champions/yasuo/audio/${name}.wav`);
      if (!response.ok) throw new Error(`Yasuo audio ${name}: ${response.status}`);
      this.buffers[name] = await engine.ctx.decodeAudioData(await response.arrayBuffer());
    })) : Promise.resolve();
    this.ready.catch(error => { this.loadError = error.message; console.warn(error); });
  }

  play(name, ownerId, key, volume = 0.8) {
    const buffer = this.buffers[name], engine = this.engine;
    if (!buffer || !engine?.ctx || engine.isMuted || this.disposed) return;
    engine.ensureContext();
    const source = engine.ctx.createBufferSource(), gain = engine.ctx.createGain();
    source.buffer = buffer; gain.gain.value = volume;
    source.connect(gain); gain.connect(engine.masterGain);
    const sound = { source, gain, ownerId, key, name, stopped: false };
    this.active.add(sound);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.active.delete(sound); };
    source.start();
  }

  stop(ownerId, key) {
    for (const sound of this.active) {
      if (sound.ownerId !== ownerId || (key && sound.key !== key) || sound.stopped) continue;
      sound.stopped = true;
      const now = this.engine.ctx.currentTime;
      sound.gain.gain.setTargetAtTime(0, now, 0.02);
      try { sound.source.stop(now + 0.08); } catch { /* ended */ }
    }
  }

  attack(ownerId) {
    const count = this.attackCounts[ownerId] || 0;
    this.attackCounts[ownerId] = count + 1;
    this.play(`attack-${count % 3 + 1}`, ownerId, 'attack', 0.65);
  }

  trigger(event) {
    const { playerId, key, phase, variant } = event;
    if (event.type === 'yasuoWallBlock') { this.hit('w-hit', playerId, 'wall-hit'); return; }
    if (phase === 'end' || phase === 'cancel') { this.stop(playerId, key); return; }
    if (phase === 'cast') {
      if (key === 'Q') {
        this.play(variant === 'tornado' ? 'q3-cast' : 'q-cast', playerId, 'Q');
        if (variant === 'tornado') this.play('q3-wind', playerId, 'Q', 0.65);
      } else if (key === 'W') {
        this.stop(playerId, 'W'); this.play('w-cast', playerId, 'W'); this.play('w-wall', playerId, 'W', 0.5);
      } else if (key === 'E') this.play('e-cast', playerId, 'E');
      else if (key === 'R') {
        this.play('r-cast', playerId, 'R'); this.play('r-active', playerId, 'R', 0.6);
      }
    } else if (phase === 'hit') {
      if (key === 'Q') this.hit(variant === 'tornado' ? 'q3-hit' : 'q-hit', playerId, 'hit');
      else if (key === 'E') this.hit('e-hit', playerId, 'hit');
      else if (key === 'R') this.hit('r-hit', playerId, 'tail');
    }
  }

  hit(name, ownerId, key) {
    const id = `${ownerId}:${name}`, now = this.engine?.ctx?.currentTime || 0;
    if (now - (this.lastHits[id] ?? -Infinity) < 0.12) return;
    this.lastHits[id] = now; this.play(name, ownerId, key);
  }

  update(players, walls) {
    for (const sound of this.active) {
      if (sound.stopped) continue;
      let owner;
      for (let i = 0; i < players.length; i++) if (players[i].id === sound.ownerId) { owner = players[i]; break; }
      let hasWall = !walls;
      if (sound.key === 'W' && walls) {
        for (let i = 0; i < walls.length; i++) if (walls[i].playerId === sound.ownerId && walls[i].remaining > 0) { hasWall = true; break; }
      }
      if (!owner || !owner.isAlive || (sound.key === 'W' && !hasWall)) this.stop(sound.ownerId, sound.key);
    }
  }

  dispose() {
    this.disposed = true;
    for (const sound of this.active) { try { sound.source.stop(); } catch { /* ended */ } }
    this.active.clear();
  }
}
