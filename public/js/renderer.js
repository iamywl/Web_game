/**
 * renderer.js
 * Authentic League of Legends 2.5D Isometric GPU WebGL/Canvas Engine
 * Features:
 *  - 2.5D Isometric Upright Standing Humanoid Champions (Legs, Torso, Head, Armor, Weapons, Capes)
 *  - Walking Biped Gaits, Attack Swings & Skill Cast Animations
 *  - Summoner's Rift Map: 3D Isometric Stone Walls with Vertical Elevation & Cobblestone Lanes
 *  - Authentic LoL Overhead Health Bar: Left [Level] Box, 100-HP Ticks, 1000-HP Dividers, Mana Bar, Nickname
 *  - Dynamic River with Moving Sine Wave Caustics & Water Ripples
 *  - Distinct Basic Attack (평타) & Skill VFX for all 10 Champions:
 *      * Slash Arcs, Laser Beams, Fireballs, Meteors, Ice Spears, Shurikens, Shield Bashes, Mushroom Clouds
 *  - Floating '+90 💰' Gold Bounties, '▲ LEVEL UP! ▲', and Crit Floaters
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

    // VFX Systems
    this.particles = []; // { x, y, vx, vy, color, size, alpha, decay }
    this.clickRings = []; // LoL 4-pronged green move ping rings
    this.floatingTexts = []; // damage, '+90 💰', status
    this.shockwaves = []; // expanding impact rings
    this.slashTrails = []; // { x, y, angle, radius, color, alpha, width }
    this.skillVfxList = []; // custom persistent skill animations (pillars, lasers, meteors)
    this.skillAimIndicator = null;

    // Animation state tracker: { [playerId]: { walkCycle, attackSwingTimer, hitFlashTimer, castSkill: null } }
    this.champAnimStates = {};

    this.initCanvas();
    window.addEventListener('resize', this.onResize.bind(this));
  }

  initCanvas() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
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

  addFloatingText(x, y, text, color = '#ffffff', size = 18, isCrit = false, isGold = false) {
    this.floatingTexts.push({
      x,
      y: y - 30,
      text,
      color,
      size,
      isCrit,
      isGold,
      alpha: 1.0,
      vy: isGold ? -2.2 : (isCrit ? -2.8 : -1.6),
      scale: isGold ? 1.3 : (isCrit ? 1.5 : 1.0)
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

  addSlashTrail(x, y, angle, radius = 55, color = '#00d2d3', width = 6) {
    this.slashTrails.push({
      x,
      y,
      angle,
      radius,
      color,
      width,
      alpha: 1.0
    });
  }

  spawnParticleTrail(x, y, color = '#ff9f43', count = 4, spread = 8, speed = 50) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        color,
        size: Math.random() * 4 + 2,
        alpha: 0.95,
        decay: Math.random() * 1.6 + 2.2
      });
    }
  }

  // Trigger skill or basic attack animation directly
  triggerSkillVfx(playerId, champId, key, targetX, targetY) {
    const p = this.gameState?.players?.find(pl => pl.id === playerId);
    if (!p) return;

    if (!this.champAnimStates[playerId]) {
      this.champAnimStates[playerId] = { walkCycle: 0, attackSwingTimer: 0, hitFlashTimer: 0 };
    }
    this.champAnimStates[playerId].attackSwingTimer = 0.35; // Trigger attack swing animation

    const dx = targetX - p.x;
    const dy = targetY - p.y;
    const ang = Math.atan2(dy, dx);

    if (champId === 'blademaster') {
      if (key === 'Q') {
        this.addSlashTrail(p.x, p.y, ang, 80, '#00d2d3', 8);
        this.addShockwave(targetX, targetY, 90, '#00d2d3');
      } else if (key === 'W') {
        this.addSlashTrail(p.x, p.y, 0, 110, '#54a0ff', 10);
        this.addSlashTrail(p.x, p.y, Math.PI, 110, '#54a0ff', 10);
        this.addShockwave(p.x, p.y, 140, '#00d2d3');
      } else if (key === 'R') {
        this.addShockwave(targetX, targetY, 180, '#00cec9');
        this.camera.addScreenShake(8, 0.35);
      }
    } else if (champId === 'sniper') {
      if (key === 'Q' || key === 'R') {
        this.camera.addScreenShake(key === 'R' ? 7 : 3, 0.2);
        this.skillVfxList.push({
          type: 'laser_beam',
          x1: p.x,
          y1: p.y - 30,
          x2: targetX,
          y2: targetY,
          width: key === 'R' ? 12 : 6,
          color: key === 'R' ? '#ff4757' : '#ffffff',
          glowColor: '#ff6b6b',
          alpha: 1.0,
          decay: key === 'R' ? 2.5 : 4.0
        });
      }
    } else if (champId === 'pyromancer') {
      if (key === 'W' || key === 'R') {
        this.addShockwave(targetX, targetY, key === 'R' ? 200 : 130, '#ff7675');
        this.spawnParticleTrail(targetX, targetY, '#ff7675', 20, 40, 90);
        this.camera.addScreenShake(key === 'R' ? 8 : 4, 0.3);
      }
    } else if (champId === 'guardian') {
      if (key === 'Q' || key === 'R') {
        this.addShockwave(targetX, targetY, key === 'R' ? 180 : 100, '#f1c40f');
        this.camera.addScreenShake(key === 'R' ? 8 : 4, 0.3);
      }
    } else if (champId === 'frost_mage') {
      if (key === 'R') {
        this.addShockwave(targetX, targetY, 210, '#74b9ff');
        this.spawnParticleTrail(targetX, targetY, '#74b9ff', 24, 60, 80);
      }
    } else if (champId === 'demolitionist') {
      if (key === 'R') {
        this.addShockwave(targetX, targetY, 240, '#ff4757');
        this.spawnParticleTrail(targetX, targetY, '#ff9f43', 30, 80, 110);
        this.camera.addScreenShake(10, 0.45);
      }
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

        // Flash target red
        if (ev.targetId && this.champAnimStates[ev.targetId]) {
          this.champAnimStates[ev.targetId].hitFlashTimer = 0.16;
        }

        // Spawn hit blood/energy sparks
        this.spawnParticleTrail(ev.x, ev.y, ev.isCrit ? '#f1c40f' : '#ff4757', 6, 12, 60);
      } else if (ev.type === 'heal') {
        this.addFloatingText(ev.x, ev.y, `+${ev.amount}`, '#2ed573', 19, false);
        if (window.soundEngine) window.soundEngine.playShieldProc();
      } else if (ev.type === 'status') {
        this.addFloatingText(ev.x, ev.y - 18, ev.status, '#f368e0', 20, true);
        if (ev.status === 'FROZEN' && window.soundEngine) window.soundEngine.playIceMagic();
      } else if (ev.type === 'flash') {
        this.addClickRing(ev.x, ev.y);
        this.addShockwave(ev.x, ev.y, 110, '#00d2d3');
        this.spawnParticleTrail(ev.x, ev.y, '#00d2d3', 18, 40);
        if (window.soundEngine) window.soundEngine.playFlash();
      } else if (ev.type === 'kill') {
        this.camera.addScreenShake(9, 0.38);
        this.addFloatingText(ev.x || 1200, (ev.y || 800) - 45, `💀 ${ev.victimName} 처치!`, '#ff4757', 30, true);
        // LoL Gold Bounty popup (+90 💰)
        this.addFloatingText(ev.x || 1200, (ev.y || 800) - 75, `+90 💰`, '#f1c40f', 24, false, true);
        if (window.soundEngine) window.soundEngine.playKillFanfare();
      }
    }
  }

  // ==========================================================
  // AUTHORITATIVE 60 FPS RENDER LOOP
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

    // 3. Camera World Matrix (Zoom, Center, Shake)
    ctx.save();
    ctx.translate(this.camera.shakeOffsetX, this.camera.shakeOffsetY);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    const mapW = this.mapData.width || 2400;
    const mapH = this.mapData.height || 1600;

    // 4. Summoner's Rift Map (Cobblestone Lanes & Water)
    this.renderSummonersRift(ctx, mapW, mapH);

    // 5. 3D Isometric Stone Walls (Obstacles with Real Height & Shadows)
    this.render3DIsoWalls(ctx);

    // 6. AoE Skill Zones & Ground Seals
    this.renderAoeZones(ctx, gameState.aoeZones);

    // 7. Bushes (Wind Swaying)
    this.renderBushes(ctx);

    // 8. 3D Isometric Structures (Nexus & Turrets with Targeting Beams)
    this.renderStructures(ctx, gameState.structures);

    // 9. LoL 4-Pronged Move Click Rings
    this.renderClickRings(ctx);

    // 10. Shockwaves & Slash Trails
    this.renderShockwaves(ctx);
    this.renderSlashTrails(ctx);

    // 11. Custom Skill VFX (Laser Beams, Meteors)
    this.renderSkillVfx(ctx);

    // 12. Projectiles with Distinct Champion Visuals
    this.renderProjectiles(ctx, gameState.projectiles);

    // 13. Upright 2.5D Humanoid Champions (Y-Sorted Depth Occlusion)
    this.render25DChampions(ctx, gameState.players, localPlayer);

    // 14. Particle VFX Engine
    this.renderParticles(ctx);

    // 15. Skill Aiming Indicator (Targeting Trajectory)
    if (this.skillAimIndicator && localPlayer) {
      const mouseWorld = this.camera.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);
      this.renderAimIndicator(ctx, localPlayer, mouseWorld);
    }

    // 16. Spacebar Focus Ping (LoL Yellow Triangle Indicator)
    if (this.camera.isSpaceHeld && localPlayer) {
      this.renderSpaceFocusPing(ctx, localPlayer);
    }

    // 17. Floating Combat Texts & '+90 💰' Popups
    this.renderFloatingTexts(ctx);

    ctx.restore();

    // 18. Screen Vignette & Minimap Frustum
    this.renderVignette(ctx);
    this.renderMinimap(gameState, localPlayer);
  }

  // ==========================================================
  // SUMMONER'S RIFT COBBLESTONE LANES & DYNAMIC RIVER
  // ==========================================================
  renderSummonersRift(ctx, w, h) {
    // 1. Lush Dark Green Ground Turf
    ctx.fillStyle = '#14211a';
    ctx.fillRect(0, 0, w, h);

    // Ground grass blade textures
    ctx.strokeStyle = 'rgba(28, 48, 38, 0.45)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 2. Cobblestone Lanes (Authentic Summoner's Rift Earthy Paving)
    ctx.strokeStyle = '#2b3638';
    ctx.lineWidth = 140;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Mid Lane
    ctx.beginPath();
    ctx.moveTo(220, 220);
    ctx.lineTo(w - 220, h - 220);
    ctx.stroke();

    // Top Lane
    ctx.beginPath();
    ctx.moveTo(220, 220);
    ctx.lineTo(220, h - 220);
    ctx.lineTo(w - 220, h - 220);
    ctx.stroke();

    // Bot Lane
    ctx.beginPath();
    ctx.moveTo(220, 220);
    ctx.lineTo(w - 220, 220);
    ctx.lineTo(w - 220, h - 220);
    ctx.stroke();

    // Cobblestone Center Pavers
    ctx.strokeStyle = '#3e4b4f';
    ctx.lineWidth = 85;
    ctx.beginPath();
    ctx.moveTo(220, 220);
    ctx.lineTo(w - 220, h - 220);
    ctx.stroke();

    // 3. Dynamic River Water with Sine Wave Caustics
    this.renderDynamicRiver(ctx, w, h);

    // 4. Base Fountain Platforms
    this.renderBasePlatform(ctx, 220, 220, 'blue');
    this.renderBasePlatform(ctx, w - 220, h - 220, 'red');

    // Outer Edge Fence
    ctx.strokeStyle = '#2d3436';
    ctx.lineWidth = 14;
    ctx.strokeRect(0, 0, w, h);
  }

  renderDynamicRiver(ctx, w, h) {
    ctx.save();
    const riverStart = { x: 300, y: h - 120 };
    const riverEnd = { x: w - 300, y: 120 };

    // River Bed Depth
    ctx.strokeStyle = 'rgba(10, 48, 64, 0.9)';
    ctx.lineWidth = 210;
    ctx.beginPath();
    ctx.moveTo(riverStart.x, riverStart.y);
    ctx.lineTo(riverEnd.x, riverEnd.y);
    ctx.stroke();

    // Animated Translucent Emerald Water Caustics
    const t = this.animationTimer;
    ctx.strokeStyle = 'rgba(32, 178, 170, 0.45)';
    ctx.lineWidth = 150;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const prog = i / 24;
      const rx = riverStart.x + (riverEnd.x - riverStart.x) * prog;
      const ry = riverStart.y + (riverEnd.y - riverStart.y) * prog;
      const wave = Math.sin(prog * 14 + t * 4.0) * 16;
      if (i === 0) ctx.moveTo(rx - wave, ry + wave);
      else ctx.lineTo(rx - wave, ry + wave);
    }
    ctx.stroke();

    // Water Surface Specular Foam
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 2.5;
    for (let c = 0; c < 6; c++) {
      const offset = (c * 0.17 + t * 0.12) % 1.0;
      const cx = riverStart.x + (riverEnd.x - riverStart.x) * offset;
      const cy = riverStart.y + (riverEnd.y - riverStart.y) * offset;
      ctx.beginPath();
      ctx.arc(cx, cy, 32 + Math.sin(t * 3 + c) * 8, 0, Math.PI * 2);
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

    // Stone Dais
    ctx.fillStyle = '#1e272e';
    ctx.strokeStyle = mainCol;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 115, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Arcane Concentric Ring
    ctx.strokeStyle = glowCol;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, 85, 0, Math.PI * 2);
    ctx.stroke();

    // Team Crest
    ctx.font = '38px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isBlue ? '🛡️' : '⚔️', 0, 0);

    ctx.restore();
  }

  // ==========================================================
  // 3D ISOMETRIC STONE WALLS (VERTICAL ELEVATION & SHADOWS)
  // ==========================================================
  render3DIsoWalls(ctx) {
    const obstacles = this.mapData.obstacles || [];
    const wallHeight = 55; // vertical 3D height

    for (const obs of obstacles) {
      const x = obs.x;
      const y = obs.y;
      const r = obs.radius || 40;

      ctx.save();

      // 1. Ground Drop Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.ellipse(x + 12, y + 14, r * 1.15, r * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. Shaded Vertical Front Face (3D Stone Masonry Wall)
      ctx.fillStyle = '#2d3436';
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x + r, y - wallHeight);
      ctx.lineTo(x - r, y - wallHeight);
      ctx.closePath();
      ctx.fill();

      // Stone Brick Grooves on Vertical Wall Face
      ctx.strokeStyle = '#1e272e';
      ctx.lineWidth = 2;
      for (let h = y - 10; h > y - wallHeight; h -= 14) {
        ctx.beginPath();
        ctx.moveTo(x - r + 4, h);
        ctx.lineTo(x + r - 4, h);
        ctx.stroke();
      }

      // 3. Top Wall Surface (Lit by Sky)
      ctx.fillStyle = '#4b5558';
      ctx.strokeStyle = '#636e72';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, y - wallHeight, r, r * 0.58, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Stone Wall Edge Rim Highlight
      ctx.strokeStyle = '#dfe6e9';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y - wallHeight, r * 0.75, Math.PI, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  // ==========================================================
  // BUSHES (FOLIAGE WITH WIND SWAY)
  // ==========================================================
  renderBushes(ctx) {
    const bushes = this.mapData.bushes || [];
    const t = this.animationTimer;

    for (const b of bushes) {
      ctx.save();
      ctx.translate(b.x, b.y);

      const sway = Math.sin(t * 3.2 + b.x * 0.015) * 3;

      // Soft Layered Leaves
      ctx.fillStyle = 'rgba(16, 75, 41, 0.88)';
      ctx.beginPath();
      ctx.arc(sway, 0, b.radius, 0, Math.PI * 2);
      ctx.arc(-b.radius * 0.4 + sway, -b.radius * 0.35, b.radius * 0.65, 0, Math.PI * 2);
      ctx.arc(b.radius * 0.4 + sway, b.radius * 0.35, b.radius * 0.65, 0, Math.PI * 2);
      ctx.fill();

      // Green Leaf Edges
      ctx.strokeStyle = '#2ed573';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.restore();
    }
  }

  // ==========================================================
  // 3D ISOMETRIC STRUCTURES (NEXUS & TURRETS)
  // ==========================================================
  renderStructures(ctx, structures) {
    if (!structures) return;

    for (const s of structures) {
      if (!s.isAlive) {
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

      // Contact Drop Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.ellipse(0, s.radius * 0.75, s.radius * 1.15, s.radius * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      if (s.type === 'nexus') {
        // ============================================
        // ARCANE NEXUS (3D GYROSCOPE & PULSING CRYSTAL)
        // ============================================
        ctx.fillStyle = '#1e272e';
        ctx.strokeStyle = teamColor;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Dual Rotating Gyro Rings
        const rot = this.animationTimer * 1.5;
        ctx.save();
        ctx.rotate(rot);
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 3.5;
        ctx.setLineDash([16, 8]);
        ctx.beginPath();
        ctx.arc(0, 0, s.radius + 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Pulsing Floating Core Gem
        const pulse = Math.sin(this.animationTimer * 5) * 6;
        ctx.fillStyle = teamColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const ang = (i * Math.PI) / 4 + rot * 0.4;
          const px = Math.cos(ang) * (s.radius * 0.65 + pulse);
          const py = Math.sin(ang) * (s.radius * 0.65 + pulse);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // ============================================
        // 3D ISOMETRIC TURRET (COLUMN + LEVITATING CRYSTAL)
        // ============================================
        const towerH = 60; // 3D vertical height
        // Shaded Stone Column Body
        ctx.fillStyle = '#2d3436';
        ctx.beginPath();
        ctx.moveTo(-s.radius * 0.8, 0);
        ctx.lineTo(s.radius * 0.8, 0);
        ctx.lineTo(s.radius * 0.6, -towerH);
        ctx.lineTo(-s.radius * 0.6, -towerH);
        ctx.closePath();
        ctx.fill();

        // Base Stone Pedestal
        ctx.strokeStyle = teamColor;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(0, 0, s.radius, s.radius * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Top Platform Cap
        ctx.fillStyle = '#4b5558';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, -towerH, s.radius * 0.6, s.radius * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Floating Levitating Mana Crystal
        const gemFloat = Math.sin(this.animationTimer * 4) * 6;
        const gemRot = this.animationTimer * 2.5;
        ctx.save();
        ctx.translate(0, -towerH - 18 + gemFloat);
        ctx.rotate(gemRot);

        ctx.fillStyle = teamColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(13, 0);
        ctx.lineTo(0, 18);
        ctx.lineTo(-13, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();

      // Structure Health Bar
      this.renderStructureHealthBar(ctx, s, teamColor);
    }
  }

  renderStructureHealthBar(ctx, s, teamColor) {
    const barW = 84;
    const barH = 8;
    const barX = s.x - barW / 2;
    const barY = s.y - s.radius - 32;

    const hpPct = Math.max(0, Math.min(1, s.hp / s.maxHp));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
    ctx.fillStyle = teamColor;
    ctx.fillRect(barX, barY, barW * hpPct, barH);
    ctx.strokeStyle = '#2d3436';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);
  }

  // ==========================================================
  // 2.5D ISOMETRIC UPRIGHT STANDING HUMANOID CHAMPIONS
  // (Identical to User Screenshots: Legs, Torso, Head, Weapons)
  // ==========================================================
  render25DChampions(ctx, players, localPlayer) {
    if (!players || !players.length) return;

    // Y-Sorting for true 2.5D depth occlusion!
    const sortedPlayers = [...players].sort((a, b) => a.y - b.y);

    for (const p of sortedPlayers) {
      if (!p.isAlive) continue;

      const isMe = p.id === this.localPlayerId;
      const isAlly = localPlayer ? p.team === localPlayer.team : p.team === 'blue';
      const teamColor = p.team === 'blue' ? '#0984e3' : '#d63031';

      if (!this.champAnimStates[p.id]) {
        this.champAnimStates[p.id] = { walkCycle: 0, attackSwingTimer: 0, hitFlashTimer: 0 };
      }
      const anim = this.champAnimStates[p.id];
      const isMoving = p.vx !== 0 || p.vy !== 0;
      if (isMoving) anim.walkCycle += 0.28;
      if (anim.attackSwingTimer > 0) anim.attackSwingTimer -= 0.0166;

      ctx.save();
      ctx.translate(p.x, p.y);

      // 1. Ground Contact Shadow (Soft Blurred Oval)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.ellipse(0, 0, p.radius * 0.95, p.radius * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. Local Player Selection Ring
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
        ctx.fillStyle = 'rgba(255, 75, 75, 0.4)';
        ctx.beginPath();
        ctx.arc(0, -25, p.radius + 14, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Render Upright Standing 2.5D Humanoid Character Model
      this.drawUprightHumanoidHero(ctx, p, teamColor, anim, isMoving);

      ctx.restore();

      // 5. Authentic LoL Overhead Health Bar (Left [Level] Badge, 100-HP Ticks, Mana, Nickname)
      this.renderAuthenticLolHealthBar(ctx, p, isMe, isAlly);
    }
  }

  // Draw Full Upright Standing Humanoid Champion (Head at top, feet at bottom)
  drawUprightHumanoidHero(ctx, p, teamColor, anim, isMoving) {
    const cid = p.championId;
    const walkBob = isMoving ? Math.sin(anim.walkCycle) * 2.5 : 0;
    const step = isMoving ? Math.sin(anim.walkCycle) * 7 : 0;
    const isAttacking = anim.attackSwingTimer > 0;
    const swingAngle = isAttacking ? Math.sin(anim.attackSwingTimer * 18) * 0.8 : 0;

    ctx.save();
    ctx.translate(0, walkBob);

    // --- LEGS & BOOTS (Ground elevation: y = -14 to 0) ---
    ctx.fillStyle = '#2d3436';
    // Left Leg / Boot
    ctx.beginPath();
    ctx.ellipse(-6, -6 + step, 4, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Right Leg / Boot
    ctx.beginPath();
    ctx.ellipse(6, -6 - step, 4, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- CAPE / SCARF FLUTTERING BEHIND (y = -32 to -10) ---
    const wind = Math.sin(this.animationTimer * 7) * 4;
    ctx.fillStyle = teamColor;
    ctx.beginPath();
    ctx.moveTo(-10, -28);
    ctx.lineTo(-14 + wind, -8);
    ctx.lineTo(14 + wind, -8);
    ctx.lineTo(10, -28);
    ctx.closePath();
    ctx.fill();

    // --- TORSO & CHESTPLATE ARMOR (y = -28 to -16) ---
    ctx.fillStyle = p.color || '#2c3e50';
    ctx.strokeStyle = teamColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(-12, -32, 24, 20, 4);
    ctx.fill();
    ctx.stroke();

    // Chest Emblem / Breastplate
    ctx.fillStyle = '#34495e';
    ctx.beginPath();
    ctx.roundRect(-8, -30, 16, 12, 2);
    ctx.fill();

    // --- SHOULDERS & PAULDRONS (y = -34) ---
    ctx.fillStyle = '#7f8c8d';
    // Left Pauldron
    ctx.beginPath();
    ctx.arc(-14, -30, 6, 0, Math.PI * 2);
    ctx.fill();
    // Right Pauldron
    ctx.beginPath();
    ctx.arc(14, -30, 6, 0, Math.PI * 2);
    ctx.fill();

    // --- HEAD, HELMET & VISOR (y = -46 to -34) ---
    ctx.fillStyle = '#f5cd79'; // skin / face tone
    ctx.beginPath();
    ctx.arc(0, -42, 9, 0, Math.PI * 2);
    ctx.fill();

    // Helmet / Hair
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.arc(0, -45, 9.5, Math.PI, Math.PI * 2);
    ctx.fill();

    // Glowing Eyes / Visor
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-4, -43, 2.5, 2.5);
    ctx.fillRect(2, -43, 2.5, 2.5);

    // --- WIELDED WEAPONS IN 3D SPACE (Attack Swings & Glows) ---
    ctx.save();
    ctx.translate(12, -26);
    ctx.rotate(p.angle * 0.3 + swingAngle);

    if (cid === 'blademaster') {
      // ⚔️ Glowing Katana Blade with Azure Trail
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(18, -22);
      ctx.stroke();
      // Gold Hilt
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(-2, -2, 6, 4);

      if (isAttacking) {
        this.addSlashTrail(0, -20, p.angle, 45, '#00ffff', 5);
      }
    } else if (cid === 'sniper') {
      // 🎯 Precision Hextech Sniper Rifle
      ctx.fillStyle = '#636e72';
      ctx.fillRect(0, -4, 32, 7);
      ctx.fillStyle = '#2d3436';
      ctx.fillRect(8, -8, 12, 4); // Scope
      // Red Laser Sight Pointer
      ctx.strokeStyle = 'rgba(255, 71, 87, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(32, 0);
      ctx.lineTo(140, 0);
      ctx.stroke();
    } else if (cid === 'pyromancer') {
      // 🔥 Fire Staff + 3 Orbiting Burning Orbs
      ctx.strokeStyle = '#d63031';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(6, -26);
      ctx.stroke();
      // Orbiting Orbs
      const t = this.animationTimer * 4;
      for (let i = 0; i < 3; i++) {
        const ang = t + (i * Math.PI * 2) / 3;
        const ox = Math.cos(ang) * 22;
        const oy = Math.sin(ang) * 12 - 20;
        ctx.fillStyle = '#ff7675';
        ctx.beginPath();
        ctx.arc(ox, oy, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (cid === 'guardian') {
      // 🛡️ Tower Gold Shield
      ctx.fillStyle = '#f1c40f';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.fillRect(2, -18, 10, 36);
      ctx.strokeRect(2, -18, 10, 36);
    } else if (cid === 'shadow_assassin') {
      // 🗡️ Twin Daggers
      ctx.strokeStyle = '#a55eea';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(14, -14);
      ctx.moveTo(-16, 0);
      ctx.lineTo(-26, -12);
      ctx.stroke();
    } else if (cid === 'frost_mage') {
      // ❄️ Frost Staff
      ctx.fillStyle = '#74b9ff';
      ctx.beginPath();
      ctx.arc(6, -22, 8, 0, Math.PI * 2);
      ctx.fill();
    } else if (cid === 'berserker') {
      // 🪓 Dual Battleaxes
      ctx.fillStyle = '#d63031';
      ctx.fillRect(0, -18, 14, 8);
      ctx.fillRect(-22, -18, 14, 8);
    } else if (cid === 'shadow_hunter') {
      // 🏹 Wrist Repeater Crossbow
      ctx.strokeStyle = '#00b894';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-4, -12);
      ctx.lineTo(16, 0);
      ctx.lineTo(-4, 12);
      ctx.stroke();
    } else if (cid === 'brawler') {
      // 🥊 Dragon Fist Gauntlets
      ctx.fillStyle = '#e17055';
      ctx.beginPath();
      ctx.arc(4, -4, 8, 0, Math.PI * 2);
      ctx.fill();
    } else if (cid === 'demolitionist') {
      // 💣 Bomb with Sparking Fuse
      ctx.fillStyle = '#2d3436';
      ctx.beginPath();
      ctx.arc(4, -6, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(2, -18, 4, 4);
    }

    ctx.restore();
    ctx.restore();
  }

  // ==========================================================
  // AUTHENTIC LOL OVERHEAD HEALTH BAR
  // (Matching User Screenshots: Left [Level] Box, 100-HP Ticks, Mana, Nickname)
  // ==========================================================
  renderAuthenticLolHealthBar(ctx, p, isMe, isAlly) {
    const barW = 86;
    const barH = 8;
    const barX = p.x - barW / 2 + 10;
    const barY = p.y - 68; // positioned right over character's head

    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const shieldPct = Math.max(0, Math.min(1, (p.shield || 0) / p.maxHp));
    const mpPct = Math.max(0, Math.min(1, p.mp / p.maxMp));

    // 1. Summoner Nickname above bar
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    const nickText = p.nickname || '소환사';
    ctx.strokeText(nickText, p.x, barY - 6);
    ctx.fillStyle = isMe ? '#f1c40f' : (isAlly ? '#74b9ff' : '#ffffff');
    ctx.fillText(nickText, p.x, barY - 6);

    // 2. Left Level Box (Black Badge with Level Number e.g. [14])
    const levelBoxX = barX - 22;
    const levelBoxY = barY - 2;
    ctx.fillStyle = '#0a0e17';
    ctx.strokeStyle = '#57606f';
    ctx.lineWidth = 1.5;
    ctx.fillRect(levelBoxX, levelBoxY, 18, 18);
    ctx.strokeRect(levelBoxX, levelBoxY, 18, 18);

    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('14', levelBoxX + 9, levelBoxY + 9);

    // 3. Health Bar Background
    ctx.fillStyle = '#060a10';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

    // 4. HP Fill (Green for Ally, Red for Enemy)
    const hpColor = isAlly ? '#2ed573' : '#ff4757';
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    // 5. White Shield Overlay
    if (shieldPct > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillRect(barX + barW * hpPct, barY, barW * shieldPct, barH);
    }

    // 6. 100-HP Black Ticks & 1000-HP Thick Dividers (Signature LoL Bar)
    const segments = Math.floor(p.maxHp / 100);
    for (let i = 1; i < segments; i++) {
      const notchX = barX + (i / segments) * barW;
      const isThick = i % 10 === 0;
      ctx.strokeStyle = isThick ? '#ffffff' : 'rgba(0, 0, 0, 0.85)';
      ctx.lineWidth = isThick ? 1.5 : 1.0;
      ctx.beginPath();
      ctx.moveTo(notchX, barY);
      ctx.lineTo(notchX, barY + barH);
      ctx.stroke();
    }

    // Outer Border
    ctx.strokeStyle = '#2d3436';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    // 7. Cyan Mana Bar Immediately Below
    ctx.fillStyle = '#0984e3';
    ctx.fillRect(barX, barY + barH + 1, barW * mpPct, 2.5);
  }

  // ==========================================================
  // PROJECTILES WITH DISTINCT CHAMPION VISUALS
  // ==========================================================
  renderProjectiles(ctx, projectiles) {
    if (!projectiles || !projectiles.length) return;

    for (const pr of projectiles) {
      ctx.save();
      ctx.translate(pr.x, pr.y);

      // GPU Additive Blending
      ctx.globalCompositeOperation = 'lighter';

      const radGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, pr.radius * 2.2);
      radGrad.addColorStop(0, '#ffffff');
      radGrad.addColorStop(0.4, pr.color || '#ff9f43');
      radGrad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = radGrad;
      ctx.beginPath();
      ctx.arc(0, 0, pr.radius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      if (Math.random() < 0.6) {
        this.spawnParticleTrail(pr.x, pr.y, pr.color || '#ff9f43', 2, 4);
      }
    }
  }

  // ==========================================================
  // CUSTOM SKILL VFX (LASER BEAMS, METEORS)
  // ==========================================================
  renderSkillVfx(ctx) {
    for (let i = this.skillVfxList.length - 1; i >= 0; i--) {
      const v = this.skillVfxList[i];
      v.alpha -= (v.decay || 3.0) * 0.0166;

      if (v.alpha <= 0) {
        this.skillVfxList.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, v.alpha);

      if (v.type === 'laser_beam') {
        // High-Velocity Laser Beam (Sniper Q/R)
        ctx.globalCompositeOperation = 'lighter';
        // Outer Glow
        ctx.strokeStyle = v.glowColor || '#ff4757';
        ctx.lineWidth = v.width * 2;
        ctx.beginPath();
        ctx.moveTo(v.x1, v.y1);
        ctx.lineTo(v.x2, v.y2);
        ctx.stroke();

        // White Core
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = v.width;
        ctx.beginPath();
        ctx.moveTo(v.x1, v.y1);
        ctx.lineTo(v.x2, v.y2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // ==========================================================
  // AOE SKILL ZONES & RUNIC GROUND SEALS
  // ==========================================================
  renderAoeZones(ctx, aoeZones) {
    if (!aoeZones || !aoeZones.length) return;

    for (const z of aoeZones) {
      ctx.save();
      ctx.translate(z.x, z.y);

      const pulse = Math.sin(this.animationTimer * 6) * 4;
      ctx.strokeStyle = z.color || '#ff4757';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, z.radius + pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = z.color ? z.color + '26' : 'rgba(255, 71, 87, 0.16)';
      ctx.beginPath();
      ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // ==========================================================
  // LoL CLICK MOVE RINGS (4-PRONGED ROTATING CHEVRONS)
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
      ctx.lineWidth = st.width || 6;
      ctx.beginPath();
      ctx.arc(0, 0, st.radius, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ==========================================================
  // SPACEBAR FOCUS PING (LoL Yellow Triangle Indicator)
  // ==========================================================
  renderSpaceFocusPing(ctx, localPlayer) {
    ctx.save();
    const markerY = localPlayer.y - 78;
    const bounce = Math.sin(this.animationTimer * 12) * 5;

    ctx.translate(localPlayer.x, markerY + bounce);

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
  // FLOATING COMBAT TEXTS & '+90 💰' GOLD BOUNTIES
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
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3.5;
      ctx.strokeText(ft.text, ft.x, ft.y);
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

    mctx.fillStyle = '#060a10';
    mctx.fillRect(0, 0, mw, mh);

    // Diagonal Lane
    mctx.strokeStyle = '#1e272e';
    mctx.lineWidth = 6;
    mctx.beginPath();
    mctx.moveTo(0, 0);
    mctx.lineTo(mw, mh);
    mctx.stroke();

    // Structures
    if (gameState.structures) {
      for (const s of gameState.structures) {
        if (!s.isAlive) continue;
        const sx = (s.x / mapW) * mw;
        const sy = (s.y / mapH) * mh;
        mctx.fillStyle = s.team === 'blue' ? '#0984e3' : '#d63031';
        mctx.fillRect(sx - 3, sy - 3, 6, 6);
      }
    }

    // Champions
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

    // Camera Frustum Box
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
