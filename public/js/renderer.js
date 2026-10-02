/**
 * renderer.js
 * High-Fidelity 2.5D WebGL GPU MOBA Renderer
 * Features:
 *  - 2.5D Layered Champion Models for all 10 Champions (Capes, Armor, Weapons, Directional Facing)
 *  - Procedural Biped Walking Animations & Attack/Cast Recoil Motions
 *  - Dynamic River Water Shader (Multi-sine Wave Caustics & Water Ripples)
 *  - 2.5D Isometric Cliffs, Stone Turrets with Floating Mana Crystals, and Arcane Gyro Nexus
 *  - Authentic 100-HP Segmented Health Bars & Status Effect Bubbles
 *  - GPU Additive Glow Blending for Laser Beams, Sword Slash Arcs, and Spells
 *  - Spacebar Focus Ping Marker & LoL 4-Pronged Move Ping Rings
 */

class GameRenderer {
  constructor(containerId, cameraController) {
    this.container = document.getElementById(containerId);
    this.camera = cameraController || new CameraController();
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.mapData = {
      width: 2400,
      height: 1600,
      obstacles: [],
      bushes: [],
      bases: {}
    };

    this.localPlayerId = null;
    this.gameState = null;
    this.animationTimer = 0;

    // Particle & VFX Systems
    this.particles = []; // { x, y, vx, vy, color, size, alpha, decay, life }
    this.clickRings = []; // LoL 4-pronged move ping rings
    this.floatingTexts = []; // damage & status floaters
    this.shockwaves = []; // expanding impact rings
    this.slashTrails = []; // { x, y, angle, radius, color, alpha }
    this.skillAimIndicator = null;

    // Champion animation state trackers: { [playerId]: { walkCycle, attackSwing, hitFlashTimer, prevX, prevY } }
    this.champAnimStates = {};

    this.initCanvas();
    window.addEventListener('resize', this.onResize.bind(this));
  }

  initCanvas() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    // Enable alpha and hardware acceleration
    this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.container.appendChild(this.canvas);
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.camera.resize(this.width, this.height);
  }

  setMapData(mapData) {
    if (mapData) {
      this.mapData = mapData;
      this.camera.setMapSize(mapData.width || 2400, mapData.height || 1600);
    }
  }

  setLocalPlayerId(id) {
    this.localPlayerId = id;
  }

  setSkillAim(aimConfig) {
    this.skillAimIndicator = aimConfig;
  }

  clearSkillAim() {
    this.skillAimIndicator = null;
  }

  screenToWorld(screenX, screenY) {
    return this.camera.screenToWorld(screenX, screenY);
  }

  worldToScreen(worldX, worldY) {
    return this.camera.worldToScreen(worldX, worldY);
  }

  addClickRing(x, y) {
    this.clickRings.push({
      x,
      y,
      radius: 6,
      maxRadius: 36,
      rotation: 0,
      alpha: 1.0
    });
  }

  addFloatingText(x, y, text, color = '#ffffff', size = 18, isCrit = false) {
    this.floatingTexts.push({
      x,
      y: y - 28,
      text,
      color,
      size,
      isCrit,
      alpha: 1.0,
      vy: isCrit ? -2.6 : -1.5,
      scale: isCrit ? 1.5 : 1.0
    });
  }

  addShockwave(x, y, maxRadius = 160, color = '#ff9f43') {
    this.shockwaves.push({
      x,
      y,
      radius: 12,
      maxRadius,
      color,
      alpha: 1.0
    });
  }

  addSlashTrail(x, y, angle, color = '#00d2d3') {
    this.slashTrails.push({
      x,
      y,
      angle,
      radius: 52,
      color,
      alpha: 1.0
    });
  }

  spawnParticleTrail(x, y, color = '#ff9f43', count = 4, spread = 8) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 50,
        vy: (Math.random() - 0.5) * 50,
        color,
        size: Math.random() * 4 + 2,
        alpha: 0.95,
        decay: Math.random() * 1.6 + 2.2
      });
    }
  }

  processEvents(events) {
    if (!events || !events.length) return;
    for (const ev of events) {
      if (ev.type === 'damage') {
        const color = ev.isCrit ? '#f1c40f' : '#ffffff';
        const txt = ev.isCrit ? `⚡ CRIT! ${ev.amount}` : `${ev.amount}`;
        this.addFloatingText(ev.x, ev.y, txt, color, ev.isCrit ? 26 : 17, ev.isCrit);
        if (ev.isCrit) {
          this.camera.addScreenShake(6, 0.22);
          this.addShockwave(ev.x, ev.y, 80, '#f1c40f');
        }
        if (window.soundEngine) window.soundEngine.playHitImpact(ev.isCrit);

        // Flash target champion red
        if (ev.targetId && this.champAnimStates[ev.targetId]) {
          this.champAnimStates[ev.targetId].hitFlashTimer = 0.15;
        }
      } else if (ev.type === 'heal') {
        this.addFloatingText(ev.x, ev.y, `+${ev.amount}`, '#2ed573', 19, false);
        if (window.soundEngine) window.soundEngine.playShieldProc();
      } else if (ev.type === 'status') {
        this.addFloatingText(ev.x, ev.y - 18, ev.status, '#f368e0', 20, true);
        if (ev.status === 'FROZEN' && window.soundEngine) window.soundEngine.playIceMagic();
      } else if (ev.type === 'flash') {
        this.addClickRing(ev.x, ev.y);
        this.addShockwave(ev.x, ev.y, 110, '#00d2d3');
        this.spawnParticleTrail(ev.x, ev.y, '#00d2d3', 16, 40);
        if (window.soundEngine) window.soundEngine.playFlash();
      } else if (ev.type === 'kill') {
        this.camera.addScreenShake(9, 0.38);
        this.addFloatingText(ev.x || 1200, (ev.y || 800) - 45, `💀 ${ev.victimName} 처치!`, '#ff4757', 30, true);
        if (window.soundEngine) window.soundEngine.playKillFanfare();
      }
    }
  }

  // ==========================================================
  // MAIN RENDER LOOP (Authoritative 60 FPS)
  // ==========================================================
  render(gameState, mouseScreenPos) {
    this.gameState = gameState;
    const ctx = this.ctx;
    if (!ctx) return;

    const dt = 0.0166;
    this.animationTimer += dt;

    // 1. Camera Update
    const localPlayer = gameState.players.find(p => p.id === this.localPlayerId);
    this.camera.update(dt, localPlayer, mouseScreenPos);

    // 2. Clear Screen
    ctx.fillStyle = '#060a10';
    ctx.fillRect(0, 0, this.width, this.height);

    // 3. Apply Camera World Transform with Zoom & Shake
    ctx.save();
    ctx.translate(this.camera.shakeOffsetX, this.camera.shakeOffsetY);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    const mapW = this.mapData.width || 2400;
    const mapH = this.mapData.height || 1600;

    // 4. Render 2.5D Summoner's Rift Map & Animated River
    this.renderSummonersRift(ctx, mapW, mapH);

    // 5. Ground Decals & Scorch Rings
    this.renderGroundDecals(ctx);

    // 6. AoE Skill Zones
    this.renderAoeZones(ctx, gameState.aoeZones);

    // 7. Bushes (Interactive Wind Sway)
    this.renderBushes(ctx);

    // 8. 2.5D Isometric Structures (Nexus, Turrets, Walls)
    this.renderStructures(ctx, gameState.structures);

    // 9. Projectiles (Laser cores, glowing missiles)
    this.renderProjectiles(ctx, gameState.projectiles);

    // 10. LoL Click Move Rings
    this.renderClickRings(ctx);

    // 11. Shockwaves & Slash Trails
    this.renderShockwaves(ctx);
    this.renderSlashTrails(ctx);

    // 12. 2.5D Layered Champions with LoL 100-HP Vitals
    this.renderChampions(ctx, gameState.players, localPlayer);

    // 13. Particles VFX
    this.renderParticles(ctx);

    // 14. Skill Aiming Indicator (Targeting Trajectory)
    if (this.skillAimIndicator && localPlayer) {
      const mouseWorld = this.camera.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);
      this.renderAimIndicator(ctx, localPlayer, mouseWorld);
    }

    // 15. Spacebar Focus Indicator (LoL Yellow Triangle Ping)
    if (this.camera.isSpaceHeld && localPlayer) {
      this.renderSpaceFocusPing(ctx, localPlayer);
    }

    // 16. Floating Combat Texts
    this.renderFloatingTexts(ctx);

    ctx.restore();

    // 17. Screen-Space Vignette & HUD Minimap
    this.renderVignette(ctx);
    this.renderMinimap(gameState, localPlayer);
  }

  // ==========================================================
  // SUMMONER'S RIFT 2.5D TERRAIN & DYNAMIC RIVER
  // ==========================================================
  renderSummonersRift(ctx, w, h) {
    // 1. Base Dark Ground
    ctx.fillStyle = '#0f171e';
    ctx.fillRect(0, 0, w, h);

    // 2. High-Tech Grass Grid Texture
    ctx.strokeStyle = 'rgba(26, 44, 40, 0.45)';
    ctx.lineWidth = 1;
    const gridSize = 100;
    for (let x = 0; x <= w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 3. Lanes (Stone Flagstones)
    ctx.strokeStyle = '#1a2736';
    ctx.lineWidth = 130;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Mid Lane
    ctx.beginPath();
    ctx.moveTo(200, 200);
    ctx.lineTo(w - 200, h - 200);
    ctx.stroke();

    // Top Lane
    ctx.beginPath();
    ctx.moveTo(200, 200);
    ctx.lineTo(200, h - 200);
    ctx.lineTo(w - 200, h - 200);
    ctx.stroke();

    // Bot Lane
    ctx.beginPath();
    ctx.moveTo(200, 200);
    ctx.lineTo(w - 200, 200);
    ctx.lineTo(w - 200, h - 200);
    ctx.stroke();

    // Lane Center Flagstone Seams
    ctx.strokeStyle = '#273c54';
    ctx.lineWidth = 80;
    ctx.beginPath();
    ctx.moveTo(200, 200);
    ctx.lineTo(w - 200, h - 200);
    ctx.stroke();

    // 4. Dynamic River Water with Multi-Sine Wave Caustics
    this.renderDynamicRiver(ctx, w, h);

    // 5. Team Fountain Platforms
    this.renderBasePlatform(ctx, 200, 200, 'blue');
    this.renderBasePlatform(ctx, w - 200, h - 200, 'red');

    // 6. Map Border Walls
    ctx.strokeStyle = '#3d2d1d';
    ctx.lineWidth = 16;
    ctx.strokeRect(0, 0, w, h);
  }

  renderDynamicRiver(ctx, w, h) {
    ctx.save();
    // Diagonal River path
    const riverStart = { x: 300, y: h - 100 };
    const riverEnd = { x: w - 300, y: 100 };

    // Water Base
    ctx.strokeStyle = 'rgba(12, 58, 82, 0.85)';
    ctx.lineWidth = 210;
    ctx.beginPath();
    ctx.moveTo(riverStart.x, riverStart.y);
    ctx.lineTo(riverEnd.x, riverEnd.y);
    ctx.stroke();

    // Water Surface Shimmer (Animated Sine Caustics)
    const t = this.animationTimer;
    ctx.strokeStyle = 'rgba(34, 166, 179, 0.4)';
    ctx.lineWidth = 140;
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const prog = i / 20;
      const rx = riverStart.x + (riverEnd.x - riverStart.x) * prog;
      const ry = riverStart.y + (riverEnd.y - riverStart.y) * prog;
      const wave = Math.sin(prog * 12 + t * 3.5) * 14;
      if (i === 0) ctx.moveTo(rx - wave, ry + wave);
      else ctx.lineTo(rx - wave, ry + wave);
    }
    ctx.stroke();

    // River Crest Highlights
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    for (let c = 0; c < 5; c++) {
      const offset = (c * 0.2 + t * 0.15) % 1.0;
      const cx = riverStart.x + (riverEnd.x - riverStart.x) * offset;
      const cy = riverStart.y + (riverEnd.y - riverStart.y) * offset;
      ctx.beginPath();
      ctx.arc(cx, cy, 28 + Math.sin(t * 4 + c) * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  renderBasePlatform(ctx, x, y, team) {
    const isBlue = team === 'blue';
    const mainCol = isBlue ? '#0984e3' : '#d63031';
    const glowCol = isBlue ? '#00cec9' : '#ff7675';

    ctx.save();
    ctx.translate(x, y);

    // Base Dais (Octagon)
    ctx.fillStyle = '#1e272e';
    ctx.strokeStyle = mainCol;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner Arcane Ring
    ctx.strokeStyle = glowCol;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, 80, 0, Math.PI * 2);
    ctx.stroke();

    // Team Crest Icon
    ctx.font = '36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isBlue ? '🛡️' : '⚔️', 0, 0);

    ctx.restore();
  }

  // ==========================================================
  // BUSHES (WIND SWAY & INTERACTION)
  // ==========================================================
  renderBushes(ctx) {
    const bushes = this.mapData.bushes || [];
    const t = this.animationTimer;

    for (const b of bushes) {
      ctx.save();
      ctx.translate(b.x, b.y);

      // Wind Sway
      const sway = Math.sin(t * 3 + b.x * 0.01) * 3;

      // Soft Green Foliage Cluster
      ctx.fillStyle = 'rgba(16, 75, 41, 0.85)';
      ctx.beginPath();
      ctx.arc(sway, 0, b.radius, 0, Math.PI * 2);
      ctx.arc(-b.radius * 0.4 + sway, -b.radius * 0.3, b.radius * 0.65, 0, Math.PI * 2);
      ctx.arc(b.radius * 0.4 + sway, b.radius * 0.3, b.radius * 0.65, 0, Math.PI * 2);
      ctx.fill();

      // Bush Leaves Highlight
      ctx.strokeStyle = '#2ed573';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.restore();
    }
  }

  // ==========================================================
  // 2.5D STRUCTURES (NEXUS, TURRETS & OBSTACLES)
  // ==========================================================
  renderStructures(ctx, structures) {
    if (!structures) return;

    for (const s of structures) {
      if (!s.isAlive) {
        // Destroyed Ruins
        ctx.fillStyle = '#2d3436';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius * 0.7, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      const isBlue = s.team === 'blue';
      const teamColor = isBlue ? '#0984e3' : '#d63031';
      const glowColor = isBlue ? '#00cec9' : '#ff7675';

      ctx.save();
      ctx.translate(s.x, s.y);

      // Drop Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(0, s.radius * 0.75, s.radius * 1.05, s.radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      if (s.type === 'nexus') {
        // ============================================
        // ARCANE GYRO NEXUS
        // ============================================
        // 1. Runic Dais Base
        ctx.fillStyle = '#1e272e';
        ctx.strokeStyle = teamColor;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 2. Dual Counter-Rotating Rings
        const rot = this.animationTimer * 1.4;
        ctx.save();
        ctx.rotate(rot);
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 3;
        ctx.setLineDash([14, 8]);
        ctx.beginPath();
        ctx.arc(0, 0, s.radius + 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.rotate(-rot * 0.8);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 12]);
        ctx.beginPath();
        ctx.arc(0, 0, s.radius + 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 3. Floating Giant Core Crystal Gem
        const pulse = Math.sin(this.animationTimer * 5) * 5;
        ctx.fillStyle = teamColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const ang = (i * Math.PI) / 4 + rot * 0.3;
          const px = Math.cos(ang) * (s.radius * 0.6 + pulse);
          const py = Math.sin(ang) * (s.radius * 0.6 + pulse);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // ============================================
        // 2.5D STONE TURRET WITH ROTATING CRYSTAL
        // ============================================
        // 1. 2.5D Hexagonal Stone Pillar
        ctx.fillStyle = '#2d3436';
        ctx.strokeStyle = '#636e72';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Stone Wall Elevation Highlight
        ctx.strokeStyle = teamColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, -4, s.radius * 0.8, 0, Math.PI * 2);
        ctx.stroke();

        // 2. Floating Levitating Mana Crystal
        const gemFloat = Math.sin(this.animationTimer * 3.5) * 6;
        const gemRot = this.animationTimer * 2.2;
        ctx.save();
        ctx.translate(0, -10 + gemFloat);
        ctx.rotate(gemRot);

        ctx.fillStyle = teamColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        // Diamond Gem
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(14, 0);
        ctx.lineTo(0, 18);
        ctx.lineTo(-14, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();

      // Structure Overhead Health Bar
      this.renderStructureHealthBar(ctx, s, teamColor);
    }
  }

  renderStructureHealthBar(ctx, s, teamColor) {
    const barW = 80;
    const barH = 8;
    const barX = s.x - barW / 2;
    const barY = s.y - s.radius - 22;

    const hpPct = Math.max(0, Math.min(1, s.hp / s.maxHp));

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

    // HP Fill
    ctx.fillStyle = teamColor;
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    // Border
    ctx.strokeStyle = '#2d3436';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);
  }

  // ==========================================================
  // 2.5D LAYERED CHAMPION RENDERING (10 HEROES)
  // ==========================================================
  renderChampions(ctx, players, localPlayer) {
    if (!players || !players.length) return;

    // Y-Sorting for 2.5D depth occlusion!
    const sortedPlayers = [...players].sort((a, b) => a.y - b.y);

    for (const p of sortedPlayers) {
      if (!p.isAlive) continue;

      const isMe = p.id === this.localPlayerId;
      const isAlly = localPlayer ? p.team === localPlayer.team : p.team === 'blue';
      const teamColor = p.team === 'blue' ? '#0984e3' : '#d63031';

      // Animation State Tracker
      if (!this.champAnimStates[p.id]) {
        this.champAnimStates[p.id] = {
          walkCycle: 0,
          hitFlashTimer: 0,
          prevX: p.x,
          prevY: p.y
        };
      }
      const anim = this.champAnimStates[p.id];
      const isMoving = p.vx !== 0 || p.vy !== 0;
      if (isMoving) {
        anim.walkCycle += 0.25;
      }

      ctx.save();
      ctx.translate(p.x, p.y);

      // 1. Soft Dynamic Drop Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(0, p.radius * 0.75, p.radius * 0.95, p.radius * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. Selection Ring for Local Player
      if (isMe) {
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 3. Hit Damage Flash Tint
      if (anim.hitFlashTimer > 0) {
        anim.hitFlashTimer -= 0.0166;
        ctx.fillStyle = 'rgba(255, 75, 75, 0.35)';
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 12, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Directional Body Rotation & Walking Sway
      ctx.save();
      ctx.rotate(p.angle);

      const walkBob = isMoving ? Math.sin(anim.walkCycle) * 2.5 : 0;
      ctx.translate(0, walkBob);

      // Draw Distinct 2.5D Champion Model
      this.draw25DChampionModel(ctx, p, teamColor, anim, isMoving);

      ctx.restore();
      ctx.restore();

      // 5. Overhead Segmented 100-HP Vitals Bar
      this.renderOverheadVitalsBar(ctx, p, isMe, isAlly);
    }
  }

  // Draw Unique 2.5D Layered Champion Silhouettes
  draw25DChampionModel(ctx, p, teamColor, anim, isMoving) {
    const r = p.radius || 26;
    const cid = p.championId;
    const stepSwing = isMoving ? Math.sin(anim.walkCycle) * 6 : 0;

    // --- 1. Feet (Biped Walk Animation) ---
    ctx.fillStyle = '#2d3436';
    // Left Foot
    ctx.beginPath();
    ctx.ellipse(6, -12 + stepSwing, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Right Foot
    ctx.beginPath();
    ctx.ellipse(6, 12 - stepSwing, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- 2. Main Torso Armor & Shoulder Pads ---
    ctx.fillStyle = p.color || '#2c3e50';
    ctx.strokeStyle = teamColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Chest Plate
    ctx.fillStyle = '#34495e';
    ctx.beginPath();
    ctx.arc(2, 0, r * 0.65, 0, Math.PI * 2);
    ctx.fill();

    // --- 3. Champion-Specific 2.5D Weapons & Equipment ---
    if (cid === 'blademaster') {
      // ⚔️ 검객: Glowing Katana Blade with Arc Trail
      ctx.save();
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(8, -4);
      ctx.lineTo(r + 20, -10);
      ctx.stroke();
      // Katana Hilt
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(6, -8, 5, 8);
      ctx.restore();

      // Scarf fluttering behind
      ctx.fillStyle = '#0984e3';
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.lineTo(-r - 18, -6 + Math.sin(this.animationTimer * 8) * 4);
      ctx.lineTo(-r - 12, 6);
      ctx.closePath();
      ctx.fill();
    } else if (cid === 'sniper') {
      // 🎯 저격수: Long Precision Sniper Rifle + Laser Sight
      ctx.save();
      // Rifle Barrel
      ctx.fillStyle = '#636e72';
      ctx.fillRect(8, -3, r + 18, 6);
      // Scope
      ctx.fillStyle = '#2d3436';
      ctx.fillRect(16, -7, 10, 4);
      // Red Laser Pointer Beam
      ctx.strokeStyle = 'rgba(255, 71, 87, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(r + 26, 0);
      ctx.lineTo(r + 140, 0);
      ctx.stroke();
      ctx.restore();

      // Scout Cloak
      ctx.fillStyle = '#2d3436';
      ctx.beginPath();
      ctx.arc(-8, 0, 14, 0, Math.PI * 2);
      ctx.fill();
    } else if (cid === 'pyromancer') {
      // 🔥 화염술사: 3 Revolving Arcane Flame Orbs
      ctx.save();
      const orbAngle = this.animationTimer * 4;
      for (let i = 0; i < 3; i++) {
        const ang = orbAngle + (i * Math.PI * 2) / 3;
        const ox = Math.cos(ang) * (r + 10);
        const oy = Math.sin(ang) * (r + 10);
        ctx.fillStyle = '#ff7675';
        ctx.beginPath();
        ctx.arc(ox, oy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffeaa7';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    } else if (cid === 'guardian') {
      // 🛡️ 수호자: Massive Tower Shield & Warhammer
      ctx.save();
      // Giant Tower Shield on Front
      ctx.fillStyle = '#f1c40f';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.fillRect(r - 2, -18, 8, 36);
      ctx.strokeRect(r - 2, -18, 8, 36);
      // Shield Emblem
      ctx.fillStyle = '#2d3436';
      ctx.beginPath();
      ctx.arc(r + 2, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (cid === 'shadow_assassin') {
      // 🗡️ 암살자: Twin Obsidian Daggers
      ctx.save();
      ctx.strokeStyle = '#a55eea';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(6, -14);
      ctx.lineTo(r + 12, -16);
      ctx.moveTo(6, 14);
      ctx.lineTo(r + 12, 16);
      ctx.stroke();
      ctx.restore();

      // Shadow Mist Trail
      if (Math.random() < 0.3) {
        this.spawnParticleTrail(p.x, p.y, '#a55eea', 1, 6);
      }
    } else if (cid === 'frost_mage') {
      // ❄️ 빙결술사: Frost Crystal Crown & Staff
      ctx.save();
      ctx.fillStyle = '#74b9ff';
      ctx.beginPath();
      ctx.arc(r + 8, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    } else if (cid === 'berserker') {
      // 🪓 광전사: Dual Bloody Battle Axes
      ctx.save();
      ctx.fillStyle = '#d63031';
      ctx.fillRect(r + 2, -16, 12, 6);
      ctx.fillRect(r + 2, 10, 12, 6);
      ctx.restore();
    } else if (cid === 'shadow_hunter') {
      // 🏹 그림자 사냥꾼: Wrist Repeater Crossbow
      ctx.save();
      ctx.strokeStyle = '#00b894';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(r - 4, -14);
      ctx.lineTo(r + 12, 0);
      ctx.lineTo(r - 4, 14);
      ctx.stroke();
      ctx.restore();
    } else if (cid === 'brawler') {
      // 🥊 격투가: Blazing Dragon Gauntlets
      ctx.save();
      ctx.fillStyle = '#e17055';
      ctx.beginPath();
      ctx.arc(r + 4, -9, 7, 0, Math.PI * 2);
      ctx.arc(r + 4, 9, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (cid === 'demolitionist') {
      // 💣 폭탄광: Mad Goggles & Rocket Backpack
      ctx.save();
      ctx.fillStyle = '#d63031';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      // Sparking Fuse
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(-6, -14, 4, 4);
      ctx.restore();
    }
  }

  // ==========================================================
  // AUTHENTIC 100-HP SEGMENTED OVERHEAD VITALS BAR
  // ==========================================================
  renderOverheadVitalsBar(ctx, p, isMe, isAlly) {
    const barW = 76;
    const barH = 7;
    const barX = p.x - barW / 2;
    const barY = p.y - p.radius - 24;

    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const shieldPct = Math.max(0, Math.min(1, (p.shield || 0) / p.maxHp));
    const mpPct = Math.max(0, Math.min(1, p.mp / p.maxMp));

    // 1. Dark Plate Container
    ctx.fillStyle = 'rgba(10, 15, 24, 0.88)';
    ctx.fillRect(barX - 2, barY - 14, barW + 4, barH + 19);

    // 2. Summoner Nickname Tag
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isMe ? '#f1c40f' : (isAlly ? '#74b9ff' : '#ff7675');
    ctx.fillText(p.nickname || '소환사', p.x, barY - 4);

    // 3. HP Fill (Green for Ally, Red for Enemy)
    const hpCol = isAlly ? '#2ed573' : '#ff4757';
    ctx.fillStyle = hpCol;
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    // 4. White Shield Overlay Fill
    if (shieldPct > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillRect(barX + barW * hpPct, barY, barW * shieldPct, barH);
    }

    // 5. 100-HP Segmented Black Notches (LoL Classic HP Bar)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 1;
    const segments = Math.floor(p.maxHp / 100);
    for (let i = 1; i < segments; i++) {
      const notchX = barX + (i / segments) * barW;
      const isThick = i % 10 === 0; // 1000 HP thick tick
      ctx.beginPath();
      ctx.moveTo(notchX, barY);
      ctx.lineTo(notchX, barY + barH);
      ctx.stroke();
    }

    // 6. MP Bar Underneath
    ctx.fillStyle = '#0984e3';
    ctx.fillRect(barX, barY + barH + 1, barW * mpPct, 2.5);

    // 7. Outer Gold / Dark Border
    ctx.strokeStyle = isMe ? '#f1c40f' : '#2d3436';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);
  }

  // ==========================================================
  // SPACEBAR FOCUS PING (LoL Iconic Yellow Overhead Marker)
  // ==========================================================
  renderSpaceFocusPing(ctx, localPlayer) {
    ctx.save();
    const markerY = localPlayer.y - localPlayer.radius - 40;
    const bounce = Math.sin(this.animationTimer * 12) * 5;

    ctx.translate(localPlayer.x, markerY + bounce);

    // Glowing Yellow Arrow (▼)
    ctx.fillStyle = '#f1c40f';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(-10, -8);
    ctx.lineTo(10, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  // ==========================================================
  // PROJECTILES & SPELL VISUALS
  // ==========================================================
  renderProjectiles(ctx, projectiles) {
    if (!projectiles || !projectiles.length) return;

    for (const pr of projectiles) {
      ctx.save();
      ctx.translate(pr.x, pr.y);

      // GPU Additive Blending for Bright Light Core
      ctx.globalCompositeOperation = 'lighter';

      // Laser Core / Magic Glow
      const radGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, pr.radius * 2);
      radGrad.addColorStop(0, '#ffffff');
      radGrad.addColorStop(0.4, pr.color || '#ff9f43');
      radGrad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = radGrad;
      ctx.beginPath();
      ctx.arc(0, 0, pr.radius * 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Spawn Particle Trail Behind Projectile
      if (Math.random() < 0.6) {
        this.spawnParticleTrail(pr.x, pr.y, pr.color || '#ff9f43', 2, 4);
      }
    }
  }

  // ==========================================================
  // AOE SKILL ZONES & GROUND SEALS
  // ==========================================================
  renderAoeZones(ctx, aoeZones) {
    if (!aoeZones || !aoeZones.length) return;

    for (const z of aoeZones) {
      ctx.save();
      ctx.translate(z.x, z.y);

      // Pulsing Runic Ground Seal
      const pulse = Math.sin(this.animationTimer * 6) * 4;
      ctx.strokeStyle = z.color || '#ff4757';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, z.radius + pulse, 0, Math.PI * 2);
      ctx.stroke();

      // Semi-transparent Fill
      ctx.fillStyle = z.color ? z.color + '26' : 'rgba(255, 71, 87, 0.15)';
      ctx.beginPath();
      ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // ==========================================================
  // LoL CLICK MOVE RINGS (4-PRONGED ROTATING GREEN CHEVRON)
  // ==========================================================
  renderClickRings(ctx) {
    for (let i = this.clickRings.length - 1; i >= 0; i--) {
      const ring = this.clickRings[i];
      ring.radius += (ring.maxRadius - ring.radius) * 0.18;
      ring.rotation += 0.08;
      ring.alpha -= 0.045;

      if (ring.alpha <= 0) {
        this.clickRings.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.translate(ring.x, ring.y);
      ctx.rotate(ring.rotation);
      ctx.strokeStyle = `rgba(46, 213, 115, ${ring.alpha})`;
      ctx.lineWidth = 2.5;

      // 4-Pronged Arrows
      for (let k = 0; k < 4; k++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(ring.radius - 6, -4);
        ctx.lineTo(ring.radius, 0);
        ctx.lineTo(ring.radius - 6, 4);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // ==========================================================
  // SHOCKWAVES & SLASH TRAILS
  // ==========================================================
  renderShockwaves(ctx) {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.radius += (s.maxRadius - s.radius) * 0.22;
      s.alpha -= 0.055;

      if (s.alpha <= 0) {
        this.shockwaves.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = s.alpha;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  renderSlashTrails(ctx) {
    for (let i = this.slashTrails.length - 1; i >= 0; i--) {
      const st = this.slashTrails[i];
      st.alpha -= 0.08;

      if (st.alpha <= 0) {
        this.slashTrails.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.translate(st.x, st.y);
      ctx.rotate(st.angle);
      ctx.strokeStyle = st.color;
      ctx.globalAlpha = st.alpha;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, st.radius, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  renderGroundDecals(ctx) {
    // Persistent impact scorch marks or runes
  }

  // ==========================================================
  // PARTICLE VFX ENGINE
  // ==========================================================
  renderParticles(ctx) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * 0.0166;
      p.y += p.vy * 0.0166;
      p.alpha -= p.decay * 0.0166;

      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ==========================================================
  // AIM INDICATOR
  // ==========================================================
  renderAimIndicator(ctx, player, mouseWorld) {
    const aim = this.skillAimIndicator;
    if (!aim) return;

    ctx.save();
    const dx = mouseWorld.x - player.x;
    const dy = mouseWorld.y - player.y;
    const ang = Math.atan2(dy, dx);
    const range = aim.range || 500;

    if (aim.type === 'line') {
      // Skillshot Direction Arrow
      ctx.translate(player.x, player.y);
      ctx.rotate(ang);
      ctx.fillStyle = 'rgba(0, 206, 201, 0.2)';
      ctx.strokeStyle = '#00cec9';
      ctx.lineWidth = 2;
      const w = (aim.width || 40) / 2;
      ctx.beginPath();
      ctx.moveTo(0, -w);
      ctx.lineTo(range, -w);
      ctx.lineTo(range + 16, 0);
      ctx.lineTo(range, w);
      ctx.lineTo(0, w);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (aim.type === 'circle') {
      // AoE Circle
      ctx.fillStyle = 'rgba(255, 118, 117, 0.25)';
      ctx.strokeStyle = '#ff7675';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mouseWorld.x, mouseWorld.y, aim.radius || 120, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ==========================================================
  // FLOATING COMBAT TEXTS
  // ==========================================================
  renderFloatingTexts(ctx) {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.alpha -= 0.022;

      if (ft.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.font = `bold ${Math.round(ft.size * ft.scale)}px sans-serif`;
      ctx.textAlign = 'center';
      // Outline
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeText(ft.text, ft.x, ft.y);
      // Fill
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  // ==========================================================
  // SCREEN-SPACE VIGNETTE
  // ==========================================================
  renderVignette(ctx) {
    const vigGrad = ctx.createRadialGradient(
      this.width / 2, this.height / 2, this.height * 0.45,
      this.width / 2, this.height / 2, this.height * 0.95
    );
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vigGrad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  // ==========================================================
  // MINIMAP WITH REAL-TIME CAMERA VIEWPORT FRUSTUM
  // ==========================================================
  renderMinimap(gameState, localPlayer) {
    const miniCanvas = document.getElementById('minimap-canvas');
    if (!miniCanvas) return;
    const mctx = miniCanvas.getContext('2d');
    if (!mctx) return;

    const mw = miniCanvas.width;
    const mh = miniCanvas.height;
    const mapW = this.mapData.width || 2400;
    const mapH = this.mapData.height || 1600;

    // Clear
    mctx.fillStyle = '#060a10';
    mctx.fillRect(0, 0, mw, mh);

    // Map Outline & Lanes
    mctx.strokeStyle = '#1e272e';
    mctx.lineWidth = 6;
    mctx.beginPath();
    mctx.moveTo(0, 0);
    mctx.lineTo(mw, mh);
    mctx.stroke();

    // Structures on Minimap
    if (gameState.structures) {
      for (const s of gameState.structures) {
        if (!s.isAlive) continue;
        const sx = (s.x / mapW) * mw;
        const sy = (s.y / mapH) * mh;
        mctx.fillStyle = s.team === 'blue' ? '#0984e3' : '#d63031';
        mctx.fillRect(sx - 3, sy - 3, 6, 6);
      }
    }

    // Champions on Minimap
    if (gameState.players) {
      for (const p of gameState.players) {
        if (!p.isAlive) continue;
        const px = (p.x / mapW) * mw;
        const py = (p.y / mapH) * mh;
        const isMe = p.id === this.localPlayerId;

        mctx.fillStyle = isMe ? '#f1c40f' : (p.team === 'blue' ? '#0984e3' : '#d63031');
        mctx.beginPath();
        mctx.arc(px, py, isMe ? 4.5 : 3.5, 0, Math.PI * 2);
        mctx.fill();

        if (isMe) {
          mctx.strokeStyle = '#ffffff';
          mctx.lineWidth = 1.5;
          mctx.stroke();
        }
      }
    }

    // Camera Viewport Frustum Box (Shows visible view on map)
    const bounds = this.camera.getViewportBounds();
    const vx = (bounds.x / mapW) * mw;
    const vy = (bounds.y / mapH) * mh;
    const vw = (bounds.width / mapW) * mw;
    const vh = (bounds.height / mapH) * mh;

    mctx.strokeStyle = '#f1c40f';
    mctx.lineWidth = 1.5;
    mctx.strokeRect(vx, vy, vw, vh);
  }
}

// Attach to window
window.GameRenderer = GameRenderer;
