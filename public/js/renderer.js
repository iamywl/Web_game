/**
 * renderer.js
 * League of Legends Fidelity 60 FPS WebGL / Canvas Renderer
 * High-definition Summoner's Rift terrain, procedural champion models,
 * dynamic particle VFX engine, segmented 100-HP health bars, screen shake, and animated river.
 */

class GameRenderer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.camera = {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      shakeIntensity: 0,
      shakeDuration: 0
    };

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

    // Visual FX & Particle Systems
    this.particles = []; // { x, y, vx, vy, color, size, alpha, decay, life }
    this.clickRings = []; // right-click move rings
    this.floatingTexts = []; // damage & status floaters
    this.shockwaves = []; // explosion impact rings: { x, y, radius, maxRadius, color, width, alpha }
    this.skillAimIndicator = null;

    this.initCanvas();
    window.addEventListener('resize', this.onResize.bind(this));
  }

  initCanvas() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  setMapData(mapData) {
    if (mapData) this.mapData = mapData;
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
    return {
      x: screenX + this.camera.x,
      y: screenY + this.camera.y
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: worldX - this.camera.x,
      y: worldY - this.camera.y
    };
  }

  addScreenShake(intensity = 6, duration = 0.25) {
    this.camera.shakeIntensity = intensity;
    this.camera.shakeDuration = duration;
  }

  addClickRing(x, y) {
    this.clickRings.push({
      x,
      y,
      radius: 4,
      maxRadius: 32,
      alpha: 1.0
    });
  }

  addFloatingText(x, y, text, color = '#fff', size = 18, isCrit = false) {
    this.floatingTexts.push({
      x,
      y: y - 24,
      text,
      color,
      size,
      isCrit,
      alpha: 1.0,
      vy: isCrit ? -2.4 : -1.4,
      scale: isCrit ? 1.4 : 1.0
    });
  }

  addShockwave(x, y, maxRadius = 180, color = '#ff9f43') {
    this.shockwaves.push({
      x,
      y,
      radius: 10,
      maxRadius,
      color,
      alpha: 1.0
    });
  }

  spawnParticleTrail(x, y, color = '#ff9f43', count = 3, spread = 6) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 40,
        vy: (Math.random() - 0.5) * 40,
        color,
        size: Math.random() * 4 + 2,
        alpha: 0.9,
        decay: Math.random() * 1.5 + 2.0
      });
    }
  }

  processEvents(events) {
    if (!events || !events.length) return;
    for (const ev of events) {
      if (ev.type === 'damage') {
        const color = ev.isCrit ? '#f1c40f' : '#ffffff';
        const txt = ev.isCrit ? `⚡ CRIT! ${ev.amount}` : `${ev.amount}`;
        this.addFloatingText(ev.x, ev.y, txt, color, ev.isCrit ? 24 : 16, ev.isCrit);
        if (ev.isCrit) {
          this.addScreenShake(5, 0.2);
          this.addShockwave(ev.x, ev.y, 70, '#f1c40f');
        }
        if (window.soundEngine) window.soundEngine.playHitImpact(ev.isCrit);
      } else if (ev.type === 'heal') {
        this.addFloatingText(ev.x, ev.y, `+${ev.amount}`, '#2ed573', 18, false);
        if (window.soundEngine) window.soundEngine.playShieldProc();
      } else if (ev.type === 'status') {
        this.addFloatingText(ev.x, ev.y - 15, ev.status, '#f368e0', 18, true);
        if (ev.status === 'FROZEN' && window.soundEngine) window.soundEngine.playIceMagic();
      } else if (ev.type === 'flash') {
        this.addClickRing(ev.x, ev.y);
        this.addShockwave(ev.x, ev.y, 90, '#70a1ff');
        this.spawnParticleTrail(ev.x, ev.y, '#70a1ff', 12, 30);
        if (window.soundEngine) window.soundEngine.playFlash();
      } else if (ev.type === 'kill') {
        this.addScreenShake(8, 0.35);
        this.addFloatingText(ev.x || 1200, (ev.y || 800) - 40, `💀 ${ev.victimName} 처치!`, '#ff4757', 28, true);
        if (window.soundEngine) window.soundEngine.playKillFanfare();
      }
    }
  }

  // ==========================================================
  // MAIN 60 FPS RENDER LOOP
  // ==========================================================
  render(gameState, mouseWorldPos) {
    this.gameState = gameState;
    const ctx = this.ctx;
    if (!ctx) return;

    this.animationTimer += 0.0166; // ~60fps time delta

    // 1. Camera Smoothing & Screen Shake
    const localPlayer = gameState.players.find(p => p.id === this.localPlayerId);
    if (localPlayer) {
      this.camera.targetX = localPlayer.x - this.width / 2;
      this.camera.targetY = localPlayer.y - this.height / 2;
    }

    this.camera.x += (this.camera.targetX - this.camera.x) * 0.12;
    this.camera.y += (this.camera.targetY - this.camera.y) * 0.12;

    const mapW = this.mapData.width || 2400;
    const mapH = this.mapData.height || 1600;
    this.camera.x = Math.max(0, Math.min(mapW - this.width, this.camera.x));
    this.camera.y = Math.max(0, Math.min(mapH - this.height, this.camera.y));

    // Screen Shake Offset
    let shakeOffsetX = 0;
    let shakeOffsetY = 0;
    if (this.camera.shakeDuration > 0) {
      this.camera.shakeDuration -= 0.0166;
      shakeOffsetX = (Math.random() - 0.5) * this.camera.shakeIntensity;
      shakeOffsetY = (Math.random() - 0.5) * this.camera.shakeIntensity;
    }

    // Clear Canvas
    ctx.fillStyle = '#060a10';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(-this.camera.x + shakeOffsetX, -this.camera.y + shakeOffsetY);

    // 2. High-Definition Summoner's Rift Terrain
    this.renderSummonersRift(ctx, mapW, mapH);

    // 3. Bushes with Wind Sway
    this.renderBushes(ctx);

    // 4. Epic Nexus & Turrets
    this.renderStructures(ctx, gameState.structures);

    // 5. AoE Skill Zones & Rune Ground Seals
    this.renderAoeZones(ctx, gameState.aoeZones);

    // 6. Projectiles with Dynamic Particle Trails
    this.renderProjectiles(ctx, gameState.projectiles);

    // 7. Click Move Rings
    this.renderClickRings(ctx);

    // 8. Shockwave Impacts
    this.renderShockwaves(ctx);

    // 9. Particle VFX Engine
    this.renderParticles(ctx);

    // 10. Distinct Champion Models with 100-HP Segmented Bars
    this.renderChampions(ctx, gameState.players, localPlayer);

    // 11. Skillshot Aim Trajectory / AoE Indicator
    if (this.skillAimIndicator && localPlayer && mouseWorldPos) {
      this.renderAimIndicator(ctx, localPlayer, mouseWorldPos);
    }

    // 12. Floating Combat Texts
    this.renderFloatingTexts(ctx);

    ctx.restore();

    // 13. Screen-Space Fog Vignette (LOL Cinematic Shadow)
    this.renderVignette(ctx);

    // 14. Minimap Radar with Icons
    this.renderMinimap(gameState, localPlayer);
  }

  // ==========================================================
  // SUMMONER'S RIFT TERRAIN ENGINE
  // ==========================================================
  renderSummonersRift(ctx, mapW, mapH) {
    // 1. Lush Jungle Grass Base
    const grad = ctx.createLinearGradient(0, 0, mapW, mapH);
    grad.addColorStop(0, '#152e1c');
    grad.addColorStop(0.5, '#1e3c25');
    grad.addColorStop(1, '#152e1c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, mapW, mapH);

    // Fine Stone Grid Tiles
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    const tileSize = 80;
    for (let x = 0; x < mapW; x += tileSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, mapH);
      ctx.stroke();
    }
    for (let y = 0; y < mapH; y += tileSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(mapW, y);
      ctx.stroke();
    }

    // 2. Cobblestone Lanes (Top, Mid, Bot lanes)
    ctx.fillStyle = 'rgba(74, 85, 76, 0.45)';
    // Mid Lane
    ctx.beginPath();
    ctx.moveTo(260, 740);
    ctx.lineTo(2140, 740);
    ctx.lineTo(2140, 860);
    ctx.lineTo(260, 860);
    ctx.closePath();
    ctx.fill();

    // Lane border stones
    ctx.strokeStyle = 'rgba(120, 140, 125, 0.35)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // 3. Central River with Dynamic Flow Wave Shader
    const riverCenterX = 1200;
    const waveOffset = Math.sin(this.animationTimer * 2) * 8;
    const riverGrad = ctx.createLinearGradient(riverCenterX - 140, 0, riverCenterX + 140, 0);
    riverGrad.addColorStop(0, 'rgba(8, 60, 95, 0.85)');
    riverGrad.addColorStop(0.5, 'rgba(18, 110, 160, 0.9)');
    riverGrad.addColorStop(1, 'rgba(8, 60, 95, 0.85)');

    ctx.fillStyle = riverGrad;
    ctx.beginPath();
    ctx.ellipse(riverCenterX + waveOffset, 800, 160, 700, 0, 0, Math.PI * 2);
    ctx.fill();

    // River Shore Water Highlights
    ctx.strokeStyle = 'rgba(72, 219, 251, 0.4)';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Animated Water Ripples
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    for (let i = 200; i < 1400; i += 220) {
      const ripY = i + Math.sin(this.animationTimer * 3 + i) * 15;
      ctx.beginPath();
      ctx.arc(riverCenterX, ripY, 45, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Base Platforms (Blue & Red Nexus Steps)
    // Blue Base Platform
    ctx.fillStyle = '#0f2744';
    ctx.strokeStyle = '#2980b9';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(260, 800, 160, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Red Base Platform
    ctx.fillStyle = '#441414';
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(2140, 800, 160, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // ==========================================================
  // BUSHES (TALL GRASS WITH SWAY)
  // ==========================================================
  renderBushes(ctx) {
    const bushes = this.mapData.bushes || [];
    for (const b of bushes) {
      const sway = Math.sin(this.animationTimer * 2.5 + b.x) * 4;

      ctx.save();
      ctx.translate(b.x, b.y);

      // Deep shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(0, 10, b.radius, b.radius * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();

      // Dense Bush Clump
      const bGrad = ctx.createRadialGradient(sway, -5, 10, 0, 0, b.radius);
      bGrad.addColorStop(0, '#2ecc71');
      bGrad.addColorStop(0.7, '#1b5e20');
      bGrad.addColorStop(1, '#0a2e0e');

      ctx.fillStyle = bGrad;
      ctx.beginPath();
      ctx.arc(sway, 0, b.radius, 0, Math.PI * 2);
      ctx.fill();

      // Bush Leaves Border
      ctx.strokeStyle = '#4cd137';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.restore();
    }
  }

  // ==========================================================
  // STRUCTURES (EPIC NEXUS & CRYSTAL TURRETS)
  // ==========================================================
  renderStructures(ctx, structures) {
    if (!structures) return;

    for (const s of structures) {
      if (!s.isAlive) {
        // Destroyed Ruins
        ctx.fillStyle = '#2c3e50';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius * 0.7, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      const isBlue = s.team === 'blue';
      const mainColor = isBlue ? '#3498db' : '#e74c3c';
      const glowColor = isBlue ? '#00d2d3' : '#ff6b6b';

      if (s.type === 'nexus') {
        // --- 넥서스 코어 (NEXUS CORE) ---
        ctx.save();
        ctx.translate(s.x, s.y);

        // Rotating Arcane Ring
        const rot = this.animationTimer * 1.5;
        ctx.save();
        ctx.rotate(rot);
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 10]);
        ctx.beginPath();
        ctx.arc(0, 0, s.radius + 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Pulsing Energy Shield
        const pulse = Math.sin(this.animationTimer * 4) * 6;
        const radGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, s.radius + pulse);
        radGrad.addColorStop(0, '#ffffff');
        radGrad.addColorStop(0.4, mainColor);
        radGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = radGrad;
        ctx.beginPath();
        ctx.arc(0, 0, s.radius + pulse, 0, Math.PI * 2);
        ctx.fill();

        // Faceted Giant Crystal Gem (Octagon)
        ctx.fillStyle = mainColor;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const ang = (i * Math.PI) / 4 + (isBlue ? rot * 0.5 : -rot * 0.5);
          const px = Math.cos(ang) * (s.radius * 0.65);
          const py = Math.sin(ang) * (s.radius * 0.65);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
      } else {
        // --- 방어 포탑 (DEFENSIVE TURRET) ---
        ctx.save();
        ctx.translate(s.x, s.y);

        // Stone Base
        ctx.fillStyle = '#2f3542';
        ctx.beginPath();
        ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#57606f';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Floating Rotating Crystal
        const gemFloat = Math.sin(this.animationTimer * 3) * 5;
        const gemRot = this.animationTimer * 2;
        ctx.save();
        ctx.translate(0, gemFloat);
        ctx.rotate(gemRot);

        ctx.fillStyle = mainColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(15, 0);
        ctx.lineTo(0, 20);
        ctx.lineTo(-15, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.restore();
      }

      // Structure 100-HP Segmented Health Bar Overhead
      this.renderSegmentedHealthBar(ctx, s.x, s.y - s.radius - 24, 110, 10, s.hp, s.maxHp, mainColor, s.name);
    }
  }

  // ==========================================================
  // CHAMPIONS GRAPHICAL OVERHAUL
  // ==========================================================
  renderChampions(ctx, players, localPlayer) {
    if (!players) return;

    for (const p of players) {
      if (!p.isAlive) continue;

      const isAlly = localPlayer && localPlayer.team === p.team;
      if (p.stealth && !isAlly) {
        const d = Math.hypot(p.x - localPlayer.x, p.y - localPlayer.y);
        if (d > 160) continue; // Hidden in stealth
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.stealth) ctx.globalAlpha = 0.5;

      const isBlue = p.team === 'blue';
      const teamColor = isBlue ? '#00d2d3' : '#ff4757';
      const isMe = p.id === this.localPlayerId;

      // 1. Hero Cast Shadow with Movement Bobbing
      const isMoving = p.vx !== 0 || p.vy !== 0;
      const bob = isMoving ? Math.sin(this.animationTimer * 14) * 2.5 : 0;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(0, p.radius * 0.8, p.radius, p.radius * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. Selection Ring for Local Player
      if (isMe) {
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 3. Direction Pointer
      ctx.save();
      ctx.rotate(p.angle);
      ctx.fillStyle = teamColor;
      ctx.beginPath();
      ctx.moveTo(p.radius + 12, 0);
      ctx.lineTo(p.radius + 2, -6);
      ctx.lineTo(p.radius + 2, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 4. Procedural Champion Body Rendering
      ctx.save();
      ctx.translate(0, bob);
      this.drawChampionAvatar(ctx, p, teamColor);
      ctx.restore();

      ctx.restore();

      // 5. Overhead Segmented 100-HP Bar
      this.renderChampionVitalsBar(ctx, p, isMe, teamColor);
    }
  }

  // Draw Unique Procedural Character Models
  drawChampionAvatar(ctx, p, teamColor) {
    const r = p.radius || 26;
    const cid = p.championId;

    // Outer Aura Ring
    ctx.fillStyle = p.color || '#2c3e50';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = teamColor;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Champion Specialty Drawings
    ctx.save();
    ctx.rotate(p.angle);

    if (cid === 'blademaster') {
      // Katana Blade
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(r + 14, -8);
      ctx.stroke();
    } else if (cid === 'sniper') {
      // Long Rifle Barrel & Laser Sight
      ctx.strokeStyle = '#dcdde1';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(r + 20, 0);
      ctx.stroke();
      // Laser Dot
      ctx.strokeStyle = 'rgba(255, 71, 87, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(r + 20, 0);
      ctx.lineTo(r + 80, 0);
      ctx.stroke();
    } else if (cid === 'pyromancer') {
      // Flame Aura
      ctx.fillStyle = '#ff793f';
      ctx.beginPath();
      ctx.arc(6, -6, 8, 0, Math.PI * 2);
      ctx.arc(6, 6, 8, 0, Math.PI * 2);
      ctx.fill();
    } else if (cid === 'guardian') {
      // Giant Tower Shield
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(r - 2, -14, 8, 28);
    } else if (cid === 'shadow_assassin') {
      // Dual Daggers
      ctx.strokeStyle = '#a55eea';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(4, -10);
      ctx.lineTo(r + 10, -12);
      ctx.moveTo(4, 10);
      ctx.lineTo(r + 10, 12);
      ctx.stroke();
    } else if (cid === 'frost_mage') {
      // Frost Crystal Staff
      ctx.fillStyle = '#70a1ff';
      ctx.beginPath();
      ctx.arc(r + 8, 0, 7, 0, Math.PI * 2);
      ctx.fill();
    } else if (cid === 'berserker') {
      // Dual Axes
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(r + 2, -12, 10, 5);
      ctx.fillRect(r + 2, 8, 10, 5);
    } else if (cid === 'shadow_hunter') {
      // Crossbow
      ctx.strokeStyle = '#2ed573';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(r - 4, -12);
      ctx.lineTo(r + 10, 0);
      ctx.lineTo(r - 4, 12);
      ctx.stroke();
    } else if (cid === 'brawler') {
      // Fiery Iron Gauntlets
      ctx.fillStyle = '#ff9f43';
      ctx.beginPath();
      ctx.arc(r + 4, -8, 6, 0, Math.PI * 2);
      ctx.arc(r + 4, 8, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (cid === 'demolitionist') {
      // Dynamite Bomb
      ctx.fillStyle = '#2f3542';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff4757';
      ctx.fillRect(2, -2, 6, 4);
    }

    ctx.restore();

    // Avatar Center Emblem
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.avatar || '⚔️', 0, 0);
  }

  // ==========================================================
  // LEAGUE 100-HP SEGMENTED HEALTH BAR SYSTEM
  // ==========================================================
  renderChampionVitalsBar(ctx, p, isMe, teamColor) {
    const barW = 86;
    const barH = 8;
    const barX = p.x - barW / 2;
    const barY = p.y - p.radius - 22;

    // Dark Backing
    ctx.fillStyle = 'rgba(6, 11, 20, 0.9)';
    ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

    // HP Fill (LOL Green for ally, Orange-Red for enemy)
    const hpPct = Math.max(0, p.hp / p.maxHp);
    const hpColor = isMe ? '#2ecc71' : (p.team === 'blue' ? '#2ed573' : '#e74c3c');
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    // Shield (White bar overlay)
    if (p.shield && p.shield > 0) {
      const shieldPct = Math.min(1.0, p.shield / p.maxHp);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillRect(barX, barY, barW * shieldPct, barH);
    }

    // 100-HP Tick Segments
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 1;
    const segments = Math.floor(p.maxHp / 100);
    const segWidth = barW / (p.maxHp / 100);
    for (let i = 1; i <= segments; i++) {
      const tickX = barX + i * segWidth;
      if (tickX < barX + barW) {
        ctx.lineWidth = i % 10 === 0 ? 2 : 1; // thicker mark every 1000 HP
        ctx.beginPath();
        ctx.moveTo(tickX, barY);
        ctx.lineTo(tickX, barY + barH);
        ctx.stroke();
      }
    }

    // Mana Bar (Slim Blue Line)
    const mpY = barY + barH + 2;
    const mpH = 3;
    ctx.fillStyle = '#060b14';
    ctx.fillRect(barX - 1, mpY - 1, barW + 2, mpH + 2);
    const mpPct = Math.max(0, p.mp / (p.maxMp || 300));
    ctx.fillStyle = '#3498db';
    ctx.fillRect(barX, mpY, barW * mpPct, mpH);

    // Summoner Nickname & Champion Name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${p.nickname}`, p.x, barY - 6);
  }

  renderSegmentedHealthBar(ctx, cx, cy, barW, barH, hp, maxHp, fillColor, title) {
    const barX = cx - barW / 2;
    const barY = cy;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

    const pct = Math.max(0, hp / maxHp);
    ctx.fillStyle = fillColor;
    ctx.fillRect(barX, barY, barW * pct, barH);

    // Segments
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 1;
    const segments = Math.floor(maxHp / 500);
    const segWidth = barW / (maxHp / 500);
    for (let i = 1; i <= segments; i++) {
      const tx = barX + i * segWidth;
      if (tx < barX + barW) {
        ctx.beginPath();
        ctx.moveTo(tx, barY);
        ctx.lineTo(tx, barY + barH);
        ctx.stroke();
      }
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, cx, barY - 6);
  }

  // ==========================================================
  // PROJECTILES & PARTICLES ENGINE
  // ==========================================================
  renderProjectiles(ctx, projectiles) {
    if (!projectiles) return;

    for (const pr of projectiles) {
      // Spawn particle trails in flight
      this.spawnParticleTrail(pr.x, pr.y, pr.color || '#fff', 2, 4);

      ctx.save();
      ctx.translate(pr.x, pr.y);

      // Glowing Missile Core
      const pGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, pr.radius + 6);
      pGrad.addColorStop(0, '#ffffff');
      pGrad.addColorStop(0.5, pr.color || '#f1c40f');
      pGrad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = pGrad;
      ctx.beginPath();
      ctx.arc(0, 0, pr.radius + 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, pr.radius * 0.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

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

      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  }

  renderShockwaves(ctx) {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.radius += (s.maxRadius - s.radius) * 0.22;
      s.alpha -= 0.04;

      if (s.alpha <= 0 || s.radius >= s.maxRadius * 0.95) {
        this.shockwaves.splice(i, 1);
        continue;
      }

      ctx.strokeStyle = s.color;
      ctx.lineWidth = 4 * s.alpha;
      ctx.globalAlpha = Math.max(0, s.alpha);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }
  }

  renderAoeZones(ctx, aoeZones) {
    if (!aoeZones) return;

    for (const z of aoeZones) {
      ctx.save();
      ctx.translate(z.x, z.y);

      const isWarning = z.delayRemaining > 0;
      const zoneColor = isWarning ? 'rgba(231, 76, 60, 0.35)' : 'rgba(52, 152, 219, 0.3)';

      // Outer Rune Seal
      ctx.strokeStyle = isWarning ? '#e74c3c' : '#3498db';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = zoneColor;
      ctx.beginPath();
      ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
      ctx.fill();

      // Countdown Fill Arc
      if (isWarning) {
        ctx.fillStyle = 'rgba(231, 76, 60, 0.25)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, z.radius, 0, Math.PI * 2 * (1 - z.delayRemaining / 1.0));
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }
  }

  renderClickRings(ctx) {
    for (let i = this.clickRings.length - 1; i >= 0; i--) {
      const ring = this.clickRings[i];
      ring.radius += 1.8;
      ring.alpha -= 0.055;

      if (ring.alpha <= 0) {
        this.clickRings.splice(i, 1);
        continue;
      }

      ctx.strokeStyle = `rgba(46, 204, 113, ${ring.alpha})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  renderFloatingTexts(ctx) {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const fl = this.floatingTexts[i];
      fl.y += fl.vy;
      fl.alpha -= 0.022;

      if (fl.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, fl.alpha);
      ctx.font = `${fl.isCrit ? '900' : 'bold'} ${fl.size}px sans-serif`;
      ctx.textAlign = 'center';

      // Outline
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 4;
      ctx.strokeText(fl.text, fl.x, fl.y);

      // Text
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, fl.x, fl.y);
      ctx.restore();
    }
  }

  renderAimIndicator(ctx, localPlayer, mouseWorldPos) {
    const aim = this.skillAimIndicator;
    const px = localPlayer.x;
    const py = localPlayer.y;

    if (aim.type === 'line') {
      const dx = mouseWorldPos.x - px;
      const dy = mouseWorldPos.y - py;
      const dist = Math.hypot(dx, dy) || 1;
      const lineLen = Math.min(dist, aim.range || 500);

      ctx.save();
      ctx.strokeStyle = 'rgba(72, 219, 251, 0.75)';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + (dx / dist) * lineLen, py + (dy / dist) * lineLen);
      ctx.stroke();

      // Arrow tip
      ctx.fillStyle = '#00d2d3';
      ctx.beginPath();
      ctx.arc(px + (dx / dist) * lineLen, py + (dy / dist) * lineLen, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (aim.type === 'circle') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 159, 67, 0.8)';
      ctx.lineWidth = 3;
      ctx.fillStyle = 'rgba(255, 159, 67, 0.18)';
      ctx.beginPath();
      ctx.arc(mouseWorldPos.x, mouseWorldPos.y, aim.radius || 150, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  renderVignette(ctx) {
    const vGrad = ctx.createRadialGradient(
      this.width / 2, this.height / 2, this.height * 0.45,
      this.width / 2, this.height / 2, this.width * 0.75
    );
    vGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vGrad.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    ctx.fillStyle = vGrad;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  renderMinimap(gameState, localPlayer) {
    const size = 180;
    const padding = 16;
    const mx = this.width - size - padding;
    const my = this.height - size - padding;
    const ctx = this.ctx;

    // Minimap Frame
    ctx.fillStyle = 'rgba(6, 11, 20, 0.9)';
    ctx.fillRect(mx, my, size, size);
    ctx.strokeStyle = '#c89b3c';
    ctx.lineWidth = 2;
    ctx.strokeRect(mx, my, size, size);

    const scaleX = size / (this.mapData.width || 2400);
    const scaleY = size / (this.mapData.height || 1600);

    // River
    ctx.fillStyle = 'rgba(15, 76, 129, 0.7)';
    ctx.fillRect(mx + (1200 - 90) * scaleX, my, 180 * scaleX, size);

    // Structures
    if (gameState.structures) {
      for (const s of gameState.structures) {
        if (!s.isAlive) continue;
        ctx.fillStyle = s.team === 'blue' ? '#3498db' : '#e74c3c';
        const sx = mx + s.x * scaleX;
        const sy = my + s.y * scaleY;
        ctx.fillRect(sx - 3, sy - 3, 6, 6);
      }
    }

    // Players Radar Dots
    if (gameState.players) {
      for (const p of gameState.players) {
        if (!p.isAlive) continue;
        const px = mx + p.x * scaleX;
        const py = my + p.y * scaleY;
        ctx.fillStyle = p.id === this.localPlayerId ? '#f1c40f' : (p.team === 'blue' ? '#2ecc71' : '#ff4757');
        ctx.beginPath();
        ctx.arc(px, py, p.id === this.localPlayerId ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Camera Frustum Box on Minimap
    const camX = mx + this.camera.x * scaleX;
    const camY = my + this.camera.y * scaleY;
    const camW = this.width * scaleX;
    const camH = this.height * scaleY;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(camX, camY, camW, camH);
  }
}
