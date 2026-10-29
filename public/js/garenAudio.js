const FILES = ['q-cast', 'q-attack', 'w-cast', 'e-cast', 'e-loop', 'e-hit', 'e-end', 'r-cast', 'r-hit'];

// Use the game's existing context and master gain, including its mute button.
export class GarenAudio {
  constructor(engine = window.soundEngine) {
    this.engine = engine;
    this.buffers = Object.create(null);
    this.active = new Set();
    this.lastSpinHit = Object.create(null);
    this.disposed = false;
    this.ready = engine?.ctx ? Promise.all(FILES.map(async name => {
      const response = await fetch(`/assets/champions/garen/audio/${name}.wav`);
      if (!response.ok) throw new Error(`Garen audio ${name}: ${response.status}`);
      this.buffers[name] = await engine.ctx.decodeAudioData(await response.arrayBuffer());
    })) : Promise.resolve();
    this.ready.catch(error => { this.loadError = error.message; console.warn(error); });
  }

  play(name, ownerId, key, volume = 1) {
    const buffer = this.buffers[name], engine = this.engine;
    // Never replay a stale cast after an asynchronous load or autoplay unlock.
    if (!buffer || !engine?.ctx || this.disposed || engine.isMuted) return;
    engine.ensureContext();
    const source = engine.ctx.createBufferSource(), gain = engine.ctx.createGain();
    source.buffer = buffer; gain.gain.value = volume;
    source.connect(gain); gain.connect(engine.masterGain);
    const record = { source, gain, ownerId, key, name };
    this.active.add(record);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.active.delete(record); };
    source.start();
  }

  stop(ownerId, key) {
    for (const sound of this.active) {
      if (sound.ownerId !== ownerId || (key && sound.key !== key)) continue;
      const now = this.engine.ctx.currentTime;
      sound.gain.gain.cancelScheduledValues(now);
      sound.gain.gain.setTargetAtTime(0, now, 0.02);
      try { sound.source.stop(now + 0.08); } catch { /* already ended */ }
    }
  }

  trigger(event) {
    const { playerId, key, phase } = event;
    if (phase === 'end' || phase === 'cancel') {
      this.stop(playerId, key);
      if (key === 'E') this.play('e-end', playerId, 'tail');
      return;
    }
    if (phase === 'cast') {
      this.stop(playerId, key);
      this.play(`${key.toLowerCase()}-cast`, playerId, key);
      // The authored E buff sound is a 3.49s one-shot, not an infinite loop.
      if (key === 'E') this.play('e-loop', playerId, key);
    } else if (phase === 'hit') {
      if (key === 'Q') this.play('q-attack', playerId, key);
      else if (key === 'R') this.play('r-hit', playerId, 'tail');
      else if (key === 'E') {
        const now = this.engine?.ctx?.currentTime || 0;
        if (now - (this.lastSpinHit[playerId] ?? -Infinity) >= 0.12) {
          this.lastSpinHit[playerId] = now;
          this.play('e-hit', playerId, key, 0.45);
        }
      }
    }
  }

  update(players) {
    for (const sound of this.active) {
      let owner;
      for (let i = 0; i < players.length; i++) if (players[i].id === sound.ownerId) { owner = players[i]; break; }
      if (!owner || !owner.isAlive || (sound.key === 'E' && owner.garen?.eRemaining === 0)) {
        try { sound.source.stop(); } catch { /* already ended */ }
      }
    }
  }

  dispose() {
    this.disposed = true;
    for (const sound of this.active) { try { sound.source.stop(); } catch { /* already ended */ } }
    this.active.clear();
  }
}
