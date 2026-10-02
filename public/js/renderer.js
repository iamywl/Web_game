/**
 * renderer.js
 * Complete Three.js 3D Isometric/Quarter-View MOBA Engine (League of Legends Fidelity)
 * Features:
 *  - Full 3D WebGL Scene with 45-degree Quarter-View Perspective Camera (LoL Standard)
 *  - Real-Time 3D Lighting & Soft Directional Shadow Mapping (PCFSoftShadowMap)
 *  - 3D Summoner's Rift Map: Real-Time Elevated 3D Stone Walls, Cobblestone Lanes, Translucent River
 *  - 10 Hierarchical 3D Humanoid Champion Models (Legs, Torso, Head, Armor, Capes, Wielded Weapons)
 *  - Procedural 3D Skeletal Biped Gaits, Attack Swings, Rifle Recoils, Staff Raisings
 *  - 3D Projectiles (Laser Beams, Fireballs, Ice Spears, Shurikens, Bouncing Bombs)
 *  - Projected Authentic LoL Overhead Health Bars: Left [Level] Box, 100-HP Ticks, Mana, Nickname
 *  - LoL Red Attack Reticles, Green Move Ping Rings, '+90 💰' Gold Floaters, Spacebar 3D Focus Marker
 */

class GameRenderer {
  constructor(containerId, cameraController) {
    this.container = document.getElementById(containerId);
    this.cameraCtrl = cameraController || new CameraController();
    this.camera = this.cameraCtrl; // Backward compatibility alias
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.faceTextureCache = {};

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

    // Attack Move (A-Click) State
    this.isAttackMoveActive = false;

    // VFX & Feedback Systems
    this.clickRings = []; // { x, y, radius, maxRadius, color, alpha }
    this.floatingTexts = []; // { x, y, text, color, size, isCrit, isGold, alpha, vy }
    this.shockwaves = []; // { x, y, radius, maxRadius, color, alpha }
    this.slashTrails = []; // { x, y, angle, radius, color, alpha }
    this.skillAimIndicator = null;

    // 3D Model Cache & Animation Trackers
    this.threePlayerMeshes = {}; // socketId -> THREE.Group
    this.threeStructureMeshes = {}; // structureId -> THREE.Group
    this.threeProjectileMeshes = {}; // id -> THREE.Mesh
    this.champAnimStates = {};

    this.init3DScene();
    this.init2DOverlayCanvas();

    window.addEventListener('resize', this.onResize.bind(this));
  }

  init3DScene() {
    const THREE = window.THREE;
    if (!THREE) {
      console.error('Three.js library is not loaded!');
      return;
    }

    // 1. Scene & Atmospheric Fog
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060c14);
    this.scene.fog = new THREE.FogExp2(0x060c14, 0.00045);

    // 2. 3D Perspective Quarter-View Camera
    // Field of view: 45 degrees (LoL standard isometric feel)
    this.camera3D = new THREE.PerspectiveCamera(45, this.width / this.height, 10, 5000);
    this.camera3D.position.set(1200, 750, 1500);
    this.camera3D.lookAt(1200, 0, 800);

    // 3. WebGL 3D Renderer with Real-Time Soft Shadows
    try {
      this.renderer3D = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      console.warn('WebGLRenderer high-performance initialization failed, falling back:', e);
      this.renderer3D = new THREE.WebGLRenderer();
    }
    this.renderer3D.setSize(this.width, this.height);
    this.renderer3D.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer3D.shadowMap.enabled = true;
    this.renderer3D.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer3D.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer3D.toneMappingExposure = 1.15;

    this.renderer3D.domElement.style.position = 'absolute';
    this.renderer3D.domElement.style.top = '0';
    this.renderer3D.domElement.style.left = '0';
    this.renderer3D.domElement.style.zIndex = '1';
    this.container.appendChild(this.renderer3D.domElement);

    // 4. 3D Lighting Setup (Sunlight + Ambient)
    this.setup3DLights();

    // 5. 3D Terrain & Obstacles
    this.build3DEnvironment();

    // 6. Raycaster for Exact 3D Ground Intersection
    this.raycaster = new THREE.Raycaster();
    this.mouseVec = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }

  init2DOverlayCanvas() {
    // 2D Canvas for high-contrast HUD overlays (100-HP bars, floating numbers, minimap)
    this.canvas2D = document.createElement('canvas');
    this.canvas2D.width = this.width;
    this.canvas2D.height = this.height;
    this.canvas2D.style.position = 'absolute';
    this.canvas2D.style.top = '0';
    this.canvas2D.style.left = '0';
    this.canvas2D.style.zIndex = '2';
    this.canvas2D.style.pointerEvents = 'none'; // pass clicks through to 3D canvas
    this.ctx = this.canvas2D.getContext('2d');
    this.container.appendChild(this.canvas2D);
  }

  setup3DLights() {
    const THREE = window.THREE;
    // Ambient Sky Fill
    const hemiLight = new THREE.HemisphereLight(0x70a1ff, 0x14211a, 0.75);
    this.scene.add(hemiLight);

    // Key Directional Sunlight (Casts Soft Real-Time Shadows)
    this.sunLight = new THREE.DirectionalLight(0xfff6e0, 1.45);
    this.sunLight.position.set(600, 1200, 700);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 50;
    this.sunLight.shadow.camera.far = 3000;
    const d = 1600;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
  }

  build3DEnvironment() {
    const THREE = window.THREE;
    const mapW = 2400;
    const mapH = 1600;

    // 1. Procedural 3D Summoner's Rift Ground Texture
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 1024;
    groundCanvas.height = 1024;
    const gctx = groundCanvas.getContext('2d');

    // Dark Earthy Turf
    gctx.fillStyle = '#172b21';
    gctx.fillRect(0, 0, 1024, 1024);

    // Stone Cobblestone Lanes (Mid, Top, Bot)
    gctx.strokeStyle = '#323f42';
    gctx.lineWidth = 90;
    gctx.lineCap = 'round';
    gctx.lineJoin = 'round';
    // Mid
    gctx.beginPath();
    gctx.moveTo(100, 100);
    gctx.lineTo(924, 924);
    gctx.stroke();
    // Top
    gctx.beginPath();
    gctx.moveTo(100, 100);
    gctx.lineTo(100, 924);
    gctx.lineTo(924, 924);
    gctx.stroke();
    // Bot
    gctx.beginPath();
    gctx.moveTo(100, 100);
    gctx.lineTo(924, 100);
    gctx.lineTo(924, 924);
    gctx.stroke();

    // Stone Center Pavers
    gctx.strokeStyle = '#48575c';
    gctx.lineWidth = 50;
    gctx.beginPath();
    gctx.moveTo(100, 100);
    gctx.lineTo(924, 924);
    gctx.stroke();

    const groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;

    // Ground Mesh
    const groundGeo = new THREE.PlaneGeometry(mapW, mapH);
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.85,
      metalness: 0.1
    });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.set(mapW / 2, 0, mapH / 2);
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    // 2. 3D Translucent Emerald River Plane
    const riverGeo = new THREE.PlaneGeometry(mapW * 0.9, 180);
    const riverMat = new THREE.MeshStandardMaterial({
      color: 0x16a085,
      roughness: 0.15,
      metalness: 0.45,
      transparent: true,
      opacity: 0.82
    });
    this.riverMesh = new THREE.Mesh(riverGeo, riverMat);
    this.riverMesh.rotation.x = -Math.PI / 2;
    this.riverMesh.rotation.z = Math.PI / 4; // Diagonal river
    this.riverMesh.position.set(mapW / 2, 1.5, mapH / 2);
    this.scene.add(this.riverMesh);

    // 3. 3D Elevated Stone Walls & Obstacles
    this.wallGroup = new THREE.Group();
    this.scene.add(this.wallGroup);

    // 4. Stylized 3D Pine & Oak Trees around perimeter and jungle
    const treeGroup = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.9 });
    const foliageMat1 = new THREE.MeshStandardMaterial({ color: 0x1e5128, roughness: 0.7 });
    const foliageMat2 = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.65 });

    const createTree = (x, z, scale = 1.0) => {
      const tg = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(4 * scale, 6 * scale, 24 * scale, 8), trunkMat);
      trunk.position.y = 12 * scale;
      trunk.castShadow = true;
      tg.add(trunk);

      // 3 Conical foliage tiers
      for (let i = 0; i < 3; i++) {
        const rad = (18 - i * 4) * scale;
        const fol = new THREE.Mesh(new THREE.ConeGeometry(rad, 18 * scale, 8), (i % 2 === 0) ? foliageMat1 : foliageMat2);
        fol.position.y = (20 + i * 11) * scale;
        fol.castShadow = true;
        tg.add(fol);
      }
      tg.position.set(x, 0, z);
      return tg;
    };

    // Border Trees (Outer Perimeter)
    for (let x = 80; x < mapW; x += 160) {
      treeGroup.add(createTree(x + (Math.sin(x) * 15), 45, 1.1));
      treeGroup.add(createTree(x + (Math.cos(x) * 15), mapH - 45, 1.1));
    }
    for (let z = 80; z < mapH; z += 160) {
      treeGroup.add(createTree(45, z + (Math.sin(z) * 15), 1.1));
      treeGroup.add(createTree(mapW - 45, z + (Math.cos(z) * 15), 1.1));
    }

    // Jungle clusters
    const jungleSpots = [
      { x: 550, z: 380 }, { x: 620, z: 440 }, { x: 700, z: 320 },
      { x: 1750, z: 380 }, { x: 1820, z: 440 }, { x: 1900, z: 320 },
      { x: 550, z: 1220 }, { x: 620, z: 1160 }, { x: 700, z: 1280 },
      { x: 1750, z: 1220 }, { x: 1820, z: 1160 }, { x: 1900, z: 1280 }
    ];
    jungleSpots.forEach(s => treeGroup.add(createTree(s.x, s.z, 0.95 + (s.x % 3) * 0.1)));
    this.scene.add(treeGroup);
  }

  update3DWalls(obstacles) {
    const THREE = window.THREE;
    if (!obstacles || !obstacles.length || this.wallGroup.children.length > 0) return;

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x3d494e,
      roughness: 0.8,
      metalness: 0.15
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x5a6970,
      roughness: 0.6,
      metalness: 0.2
    });

    obstacles.forEach(obs => {
      const h = 75; // 3D vertical height
      const r = obs.radius || 42;

      // Vertical Stone Cylinder Pillar
      const wallGeo = new THREE.CylinderGeometry(r * 0.95, r, h, 14);
      const wallMesh = new THREE.Mesh(wallGeo, wallMat);
      wallMesh.position.set(obs.x, h / 2, obs.y);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;

      // Stone Cap on Top
      const capGeo = new THREE.CylinderGeometry(r * 1.05, r * 1.0, 8, 14);
      const capMesh = new THREE.Mesh(capGeo, capMat);
      capMesh.position.set(obs.x, h + 4, obs.y);
      capMesh.castShadow = true;

      this.wallGroup.add(wallMesh);
      this.wallGroup.add(capMesh);
    });
  }

  update3DBushes(bushes) {
    const THREE = window.THREE;
    if (!bushes || !bushes.length || this.bushGroup) return;

    this.bushGroup = new THREE.Group();
    const bushMat = new THREE.MeshStandardMaterial({
      color: 0x27ae60,
      roughness: 0.8,
      metalness: 0.1
    });

    bushes.forEach(b => {
      const bg = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const offX = Math.cos(k * 1.25) * (b.radius * 0.45);
        const offZ = Math.sin(k * 1.25) * (b.radius * 0.45);
        const m = new THREE.Mesh(new THREE.SphereGeometry(b.radius * 0.45, 8, 8), bushMat);
        m.position.set(offX, 10, offZ);
        m.scale.set(1.1, 0.65, 1.1);
        m.castShadow = true;
        bg.add(m);
      }
      bg.position.set(b.x, 0, b.y);
      this.bushGroup.add(bg);
    });
    this.scene.add(this.bushGroup);
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    if (this.camera3D) {
      this.camera3D.aspect = this.width / this.height;
      this.camera3D.updateProjectionMatrix();
    }
    if (this.renderer3D) {
      this.renderer3D.setSize(this.width, this.height);
    }
    if (this.canvas2D) {
      this.canvas2D.width = this.width;
      this.canvas2D.height = this.height;
    }
    this.cameraCtrl.resize(this.width, this.height);
  }

  setMapData(mapData) {
    if (mapData) {
      this.mapData = mapData;
      this.cameraCtrl.setMapSize(mapData.width || 2400, mapData.height || 1600);
      if (mapData.obstacles) {
        this.update3DWalls(mapData.obstacles);
      }
      if (mapData.bushes) {
        this.update3DBushes(mapData.bushes);
      }
    }
  }

  setLocalPlayerId(id) {
    this.localPlayerId = id;
  }

  setAttackMoveActive(active) {
    this.isAttackMoveActive = !!active;
  }

  setSkillAim(aimConfig) {
    this.skillAimIndicator = aimConfig;
  }

  clearSkillAim() {
    this.skillAimIndicator = null;
  }

  // ==========================================================
  // SCREEN TO 3D WORLD COORDINATE RAYCASTING
  // ==========================================================
  screenToWorld(screenX, screenY) {
    const THREE = window.THREE;
    if (!this.camera3D || !THREE) {
      return this.cameraCtrl.screenToWorld(screenX, screenY);
    }

    this.mouseVec.x = (screenX / this.width) * 2 - 1;
    this.mouseVec.y = -(screenY / this.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouseVec, this.camera3D);

    const hitPoint = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, hitPoint);
    if (hit) {
      return { x: hitPoint.x, y: hitPoint.z };
    }
    return this.cameraCtrl.screenToWorld(screenX, screenY);
  }

  worldToScreen(worldX, worldZ) {
    const THREE = window.THREE;
    if (!this.camera3D || !THREE) {
      return this.cameraCtrl.worldToScreen(worldX, worldZ);
    }

    const pos = new THREE.Vector3(worldX, 0, worldZ);
    pos.project(this.camera3D);

    return {
      x: (pos.x * 0.5 + 0.5) * this.width,
      y: (-(pos.y * 0.5) + 0.5) * this.height
    };
  }

  // ==========================================================
  // VFX & EVENT TRIGGERS
  // ==========================================================
  addClickRing(x, y, isAttack = false) {
    this.clickRings.push({
      x,
      y,
      radius: 8,
      maxRadius: 38,
      color: isAttack ? '#ff4757' : '#2ed573',
      isAttack,
      alpha: 1.0
    });
  }

  addFloatingText(x, y, text, color = '#ffffff', size = 18, isCrit = false, isGold = false) {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      size,
      isCrit,
      isGold,
      alpha: 1.0,
      vy: isGold ? -2.2 : (isCrit ? -2.8 : -1.6),
      scale: isGold ? 1.35 : (isCrit ? 1.5 : 1.0)
    });
  }

  addShockwave(x, y, maxRadius = 150, color = '#ff9f43') {
    this.shockwaves.push({
      x,
      y,
      radius: 10,
      maxRadius,
      color,
      alpha: 1.0
    });
  }

  addSlashTrail(x, y, angle, radius = 55, color = '#00ffff') {
    this.slashTrails.push({
      x,
      y,
      angle,
      radius,
      color,
      alpha: 1.0
    });
  }

  triggerSkillVfx(playerId, champId, key, targetX, targetY) {
    const p = this.gameState?.players?.find(pl => pl.id === playerId);
    if (!p) return;

    if (!this.champAnimStates[playerId]) {
      this.champAnimStates[playerId] = { walkCycle: 0, attackSwingTimer: 0, hitFlashTimer: 0 };
    }
    this.champAnimStates[playerId].attackSwingTimer = 0.40;

    const dx = targetX - p.x;
    const dy = targetY - p.y;
    const ang = Math.atan2(dy, dx);

    if (champId === 'blademaster') {
      if (key === 'Q' || key === 'W') {
        this.addSlashTrail(p.x, p.y, ang, 85, '#00ffff');
        this.addShockwave(targetX, targetY, 90, '#00d2d3');
      } else if (key === 'R') {
        this.addShockwave(targetX, targetY, 180, '#00cec9');
        this.cameraCtrl.addScreenShake(8, 0.35);
      }
    } else if (champId === 'sniper') {
      if (key === 'Q' || key === 'R') {
        this.cameraCtrl.addScreenShake(key === 'R' ? 7 : 3, 0.2);
        this.addShockwave(targetX, targetY, 50, '#ff4757');
      }
    } else if (champId === 'pyromancer') {
      if (key === 'W' || key === 'R') {
        this.addShockwave(targetX, targetY, key === 'R' ? 220 : 130, '#ff7675');
        this.cameraCtrl.addScreenShake(key === 'R' ? 8 : 4, 0.3);
      }
    } else if (champId === 'guardian') {
      this.addShockwave(targetX, targetY, key === 'R' ? 190 : 110, '#f1c40f');
    } else if (champId === 'demolitionist') {
      if (key === 'R') {
        this.addShockwave(targetX, targetY, 250, '#ff4757');
        this.cameraCtrl.addScreenShake(10, 0.45);
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
          this.cameraCtrl.addScreenShake(6, 0.22);
          this.addShockwave(ev.x, ev.y, 80, '#f1c40f');
        }
        if (window.soundEngine) window.soundEngine.playHitImpact(ev.isCrit);

        if (ev.targetId && this.champAnimStates[ev.targetId]) {
          this.champAnimStates[ev.targetId].hitFlashTimer = 0.18;
        }
      } else if (ev.type === 'heal') {
        this.addFloatingText(ev.x, ev.y, `+${ev.amount}`, '#2ed573', 19, false);
        if (window.soundEngine) window.soundEngine.playShieldProc();
      } else if (ev.type === 'status') {
        this.addFloatingText(ev.x, ev.y - 18, ev.status, '#f368e0', 20, true);
        if (ev.status === 'FROZEN' && window.soundEngine) window.soundEngine.playIceMagic();
      } else if (ev.type === 'flash') {
        this.addClickRing(ev.x, ev.y, false);
        this.addShockwave(ev.x, ev.y, 110, '#00d2d3');
        if (window.soundEngine) window.soundEngine.playFlash();
      } else if (ev.type === 'attack') {
        if (ev.attackerId && this.champAnimStates[ev.attackerId]) {
          this.champAnimStates[ev.attackerId].attackSwingTimer = 0.35;
        }
        if (window.soundEngine) {
          if (ev.isRanged) window.soundEngine.playGunshot(false);
          else window.soundEngine.playSwordSlash();
        }
        if (!ev.isRanged && ev.x && ev.y) {
          this.addSlashTrail(ev.x, ev.y, Math.random() * Math.PI * 2, 55, '#ffffff');
        }
      } else if (ev.type === 'kill') {
        this.cameraCtrl.addScreenShake(9, 0.38);
        this.addFloatingText(ev.x || 1200, (ev.y || 800) - 40, `💀 ${ev.victimName} 처치!`, '#ff4757', 30, true);
        this.addFloatingText(ev.x || 1200, (ev.y || 800) - 70, `+90 💰`, '#f1c40f', 24, false, true);
        if (window.soundEngine) window.soundEngine.playKillFanfare();
      }
    }
  }

  // ==========================================================
  // 60 FPS 3D & 2D RENDER LOOP
  // ==========================================================
  render(gameState, mouseScreenPos) {
    this.gameState = gameState;
    const THREE = window.THREE;
    if (!THREE || !this.renderer3D || !this.scene) return;

    const dt = 0.0166;
    this.animationTimer += dt;

    // 1. Camera Controller Update
    const localPlayer = gameState.players.find(p => p.id === this.localPlayerId);
    this.cameraCtrl.update(dt, localPlayer, mouseScreenPos);

    // 2. Position 3D Quarter-View Camera (LoL 45~55 Degree Perspective)
    const zoom = this.cameraCtrl.zoom || 1.0;
    const camTargetX = this.cameraCtrl.x + (this.cameraCtrl.width / zoom) / 2;
    const camTargetZ = this.cameraCtrl.y + (this.cameraCtrl.height / zoom) / 2;

    const camDist = 800 / zoom;
    const camHeight = 720 / zoom;
    const camZOffset = 580 / zoom;

    this.camera3D.position.set(
      camTargetX + this.cameraCtrl.shakeOffsetX,
      camHeight,
      camTargetZ + camZOffset + this.cameraCtrl.shakeOffsetY
    );
    this.camera3D.lookAt(camTargetX, 0, camTargetZ);

    // Update sunlight to follow camera for crisp local shadows
    this.sunLight.position.set(camTargetX + 300, 1000, camTargetZ + 400);
    this.sunLight.target.position.set(camTargetX, 0, camTargetZ);
    this.sunLight.target.updateMatrixWorld();

    // 3. Update 3D Champion Hierarchical Models
    this.update3DChampions(gameState.players);

    // 4. Update 3D Structures (Turrets & Nexus)
    this.update3DStructures(gameState.structures);

    // 5. Update 3D Projectiles
    this.update3DProjectiles(gameState.projectiles);

    // 6. Render 3D WebGL Scene
    this.renderer3D.render(this.scene, this.camera3D);

    // 7. Render 2D Overlay Canvas (100-HP Vitals, Minimap, Floaters)
    this.render2DOverlays(gameState, localPlayer, mouseScreenPos);
  }

  // ==========================================================
  // PROCEDURAL FACE TEXTURE GENERATOR (Handsome / Beautiful Anime & LoL Aesthetics)
  // ==========================================================
  getFaceTexture(champId, THREE) {
    if (this.faceTextureCache[champId]) {
      return this.faceTextureCache[champId];
    }

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    let skinTone = '#fce4c8';
    if (champId === 'frost_mage') skinTone = '#f0f5fb'; // Pale porcelain
    if (champId === 'pyromancer') skinTone = '#ffd8b3'; // Warm fair
    if (champId === 'berserker' || champId === 'brawler') skinTone = '#eab98d'; // Tanned warrior
    if (champId === 'shadow_assassin') skinTone = '#d1ccc0';

    ctx.fillStyle = skinTone;
    ctx.fillRect(0, 0, 128, 128);

    // Soft blush & skin depth gradient
    const grad = ctx.createRadialGradient(64, 64, 18, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 125, 125, 0.15)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.08)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const isFemale = champId === 'sniper' || champId === 'frost_mage' || champId === 'shadow_hunter';
    let eyeColor = '#2980b9';
    if (champId === 'blademaster') eyeColor = '#34495e';
    if (champId === 'sniper') eyeColor = '#27ae60'; // Emerald
    if (champId === 'pyromancer') eyeColor = '#e67e22'; // Fiery amber
    if (champId === 'shadow_assassin') eyeColor = '#9b59b6'; // Glowing violet
    if (champId === 'frost_mage') eyeColor = '#00d2d3'; // Glacial cyan
    if (champId === 'berserker') eyeColor = '#2980b9'; // Ice ocean blue
    if (champId === 'shadow_hunter') eyeColor = '#c0392b'; // Crimson
    if (champId === 'brawler') eyeColor = '#d35400';
    if (champId === 'demolitionist') eyeColor = '#f39c12';

    // Draw stylized LoL / Anime eyes
    const drawEye = (x, y, flip) => {
      ctx.save();
      ctx.translate(x, y);
      if (flip) ctx.scale(-1, 1);

      // Upper lash line
      ctx.strokeStyle = '#1e272e';
      ctx.lineWidth = isFemale ? 4.5 : 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, 16, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      // Sclera
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 2, 12, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Iris
      ctx.fillStyle = eyeColor;
      ctx.beginPath();
      ctx.arc(0, 2, 8, 0, Math.PI * 2);
      ctx.fill();

      // Pupil
      ctx.fillStyle = '#0a0e17';
      ctx.beginPath();
      ctx.arc(0, 2, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Dual eye glints
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-2.5, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(2.5, 4, 1.2, 0, Math.PI * 2);
      ctx.fill();

      // Eyebrow
      ctx.strokeStyle = '#2f3542';
      ctx.lineWidth = isFemale ? 2.5 : 4;
      ctx.beginPath();
      ctx.moveTo(-14, -12);
      ctx.quadraticCurveTo(0, -16, 14, -11);
      ctx.stroke();

      ctx.restore();
    };

    drawEye(40, 52, false);
    drawEye(88, 52, true);

    // Subtle nose
    ctx.strokeStyle = 'rgba(140, 80, 50, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(64, 68);
    ctx.lineTo(66, 76);
    ctx.lineTo(61, 78);
    ctx.stroke();

    // Stylized Mouth / Lips
    if (isFemale) {
      ctx.fillStyle = champId === 'frost_mage' ? '#ff9ff3' : '#e74c3c';
      ctx.beginPath();
      ctx.ellipse(64, 92, 9, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#57606f';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(64, 88, 11, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    // Unique Character Details
    if (champId === 'shadow_assassin') {
      ctx.fillStyle = '#1e272e';
      ctx.beginPath();
      ctx.moveTo(22, 70);
      ctx.lineTo(106, 70);
      ctx.lineTo(95, 125);
      ctx.lineTo(33, 125);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#8e44ad';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (champId === 'berserker') {
      ctx.strokeStyle = '#2980b9';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(24, 70);
      ctx.lineTo(46, 78);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(104, 70);
      ctx.lineTo(82, 78);
      ctx.stroke();
    } else if (champId === 'pyromancer') {
      ctx.fillStyle = '#e67e22';
      ctx.beginPath();
      ctx.arc(64, 25, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.arc(64, 25, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    this.faceTextureCache[champId] = tex;
    return tex;
  }

  // ==========================================================
  // LOL GROUND TEAM PEDESTAL & HERO SELECTION RINGS
  // ==========================================================
  createGroundTeamRing(isBlue, isLocal, THREE) {
    const ringGroup = new THREE.Group();
    const teamColor = isBlue ? 0x0984e3 : 0xd63031;

    // Outer soft team aura disc
    const auraGeo = new THREE.RingGeometry(18, 24, 32);
    const auraMat = new THREE.MeshBasicMaterial({
      color: teamColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65
    });
    const auraMesh = new THREE.Mesh(auraGeo, auraMat);
    auraMesh.rotation.x = -Math.PI / 2;
    auraMesh.position.y = 0.5;
    ringGroup.add(auraMesh);

    // If local player, add prominent golden hero ring with rotating runes
    if (isLocal) {
      const heroGeo = new THREE.RingGeometry(24, 27, 32);
      const heroMat = new THREE.MeshBasicMaterial({
        color: 0xf1c40f,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95
      });
      const heroMesh = new THREE.Mesh(heroGeo, heroMat);
      heroMesh.rotation.x = -Math.PI / 2;
      heroMesh.position.y = 0.8;
      ringGroup.add(heroMesh);

      const runeGeo = new THREE.RingGeometry(13, 16, 4);
      const runeMat = new THREE.MeshBasicMaterial({
        color: 0xffeaa7,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75
      });
      const runeMesh = new THREE.Mesh(runeGeo, runeMat);
      runeMesh.rotation.x = -Math.PI / 2;
      runeMesh.position.y = 0.9;
      ringGroup.add(runeMesh);
      ringGroup.userData.runeMesh = runeMesh;
    }

    return ringGroup;
  }

  // ==========================================================
  // 3D CHAMPION HIERARCHICAL MODELS & ANIMATIONS
  // ==========================================================
  update3DChampions(players) {
    const THREE = window.THREE;
    if (!players) return;

    const activeIds = new Set();

    players.forEach(p => {
      activeIds.add(p.id);

      if (!this.champAnimStates[p.id]) {
        this.champAnimStates[p.id] = { walkCycle: 0, attackSwingTimer: 0, hitFlashTimer: 0 };
      }
      const anim = this.champAnimStates[p.id];
      const isMoving = p.vx !== 0 || p.vy !== 0;
      if (isMoving) anim.walkCycle += 0.28;
      if (anim.attackSwingTimer > 0) anim.attackSwingTimer -= 0.0166;

      let group = this.threePlayerMeshes[p.id];
      if (!group) {
        group = this.create3DChampionModel(p);
        this.threePlayerMeshes[p.id] = group;
        this.scene.add(group);
      }

      group.visible = p.isAlive;
      if (!p.isAlive) return;

      // Position & Directional Rotation
      group.position.set(p.x, 0, p.y);
      group.rotation.y = -p.angle + Math.PI / 2;

      // Biped Walking Animation (Legs scissor swing & torso bob)
      const walkBob = isMoving ? Math.sin(anim.walkCycle) * 2.5 : 0;
      group.position.y = walkBob;

      if (group.userData.leftLeg && group.userData.rightLeg) {
        const step = isMoving ? Math.sin(anim.walkCycle) * 0.45 : 0;
        group.userData.leftLeg.rotation.x = step;
        group.userData.rightLeg.rotation.x = -step;
      }

      // Cape / Trenchcoat / Hair Flutter
      if (group.userData.cape) {
        const flutter = isMoving ? 0.35 + Math.sin(anim.walkCycle) * 0.16 : 0.06;
        group.userData.cape.rotation.x = flutter;
      }

      // Orbiting Accessories (Flame orbs / Frost crystals)
      if (group.userData.orbits) {
        group.userData.orbits.forEach((orbGroup, idx) => {
          orbGroup.rotation.y += 0.045 + idx * 0.01;
        });
      }

      // Rotate local hero rune ring
      if (group.userData.groundRing?.userData?.runeMesh) {
        group.userData.groundRing.userData.runeMesh.rotation.z += 0.03;
      }

      // Attack Swing / Recoil Animation
      if (group.userData.weapon && anim.attackSwingTimer > 0) {
        const swing = Math.sin(anim.attackSwingTimer * 16) * 1.35;
        group.userData.weapon.rotation.x = -swing;
        if (group.userData.leftWeapon) {
          group.userData.leftWeapon.rotation.x = swing;
        }
      } else if (group.userData.weapon) {
        group.userData.weapon.rotation.x = 0;
        if (group.userData.leftWeapon) group.userData.leftWeapon.rotation.x = 0;
      }

      // Hit Flash Red / White
      if (anim.hitFlashTimer > 0) {
        anim.hitFlashTimer -= 0.0166;
        if (group.userData.torsoMat) group.userData.torsoMat.emissive.setHex(0xff3333);
      } else {
        if (group.userData.torsoMat) group.userData.torsoMat.emissive.setHex(0x000000);
      }
    });

    // Remove disconnected
    Object.keys(this.threePlayerMeshes).forEach(id => {
      if (!activeIds.has(id)) {
        this.scene.remove(this.threePlayerMeshes[id]);
        delete this.threePlayerMeshes[id];
      }
    });
  }

  create3DChampionModel(p) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const isBlue = p.team === 'blue';
    const isLocal = p.id === this.localPlayerId;
    const teamHex = isBlue ? 0x0984e3 : 0xd63031;

    // Ground LoL Team Pedestal Ring
    const groundRing = this.createGroundTeamRing(isBlue, isLocal, THREE);
    group.add(groundRing);
    group.userData.groundRing = groundRing;

    // Materials
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e272e, roughness: 0.7 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.25, metalness: 0.85 });
    const silverMat = new THREE.MeshStandardMaterial({ color: 0xdcdde1, roughness: 0.2, metalness: 0.9 });
    const armorMat = new THREE.MeshStandardMaterial({ color: teamHex, roughness: 0.35, metalness: 0.65 });
    const skinMat = new THREE.MeshStandardMaterial({
      map: this.getFaceTexture(p.championId, THREE),
      roughness: 0.5
    });

    group.userData.torsoMat = armorMat;

    // 1. Stylized Legs (Biped left & right)
    const legMat = (p.championId === 'sniper' || p.championId === 'frost_mage')
      ? new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.5 })
      : darkMat;
    const legGeo = new THREE.CylinderGeometry(3.5, 3.2, 20, 8);

    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-6, 10, 0);
    leftLeg.castShadow = true;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(6, 10, 0);
    rightLeg.castShadow = true;
    group.add(rightLeg);

    group.userData.leftLeg = leftLeg;
    group.userData.rightLeg = rightLeg;

    // 2. Head with Stylized Face Texture
    const headGeo = new THREE.SphereGeometry(8.5, 16, 16);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 43, 0);
    head.castShadow = true;
    group.add(head);

    // 3. Delegate to Specialized Champion Builder
    const cid = p.championId;
    if (cid === 'blademaster') {
      this.buildBlademasterModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE);
    } else if (cid === 'sniper') {
      this.buildSniperModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE);
    } else if (cid === 'pyromancer') {
      this.buildPyromancerModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE);
    } else if (cid === 'shadow_assassin') {
      this.buildShadowAssassinModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE);
    } else if (cid === 'guardian') {
      this.buildGuardianModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE);
    } else if (cid === 'frost_mage') {
      this.buildFrostMageModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE);
    } else if (cid === 'berserker') {
      this.buildBerserkerModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE);
    } else if (cid === 'shadow_hunter') {
      this.buildShadowHunterModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE);
    } else if (cid === 'brawler') {
      this.buildBrawlerModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE);
    } else { // demolitionist
      this.buildDemolitionistModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE);
    }

    return group;
  }

  // ==========================================================
  // 1. 검객 (Blademaster) - Handsome Wandering Samurai
  // ==========================================================
  buildBlademasterModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x130f40, roughness: 0.6 });
    const cyanGlow = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00d2d3, emissiveIntensity: 0.9 });

    // Torso: Samurai Cuirass & Sash
    const torsoGeo = new THREE.CylinderGeometry(10, 8, 20, 8);
    const torso = new THREE.Mesh(torsoGeo, armorMat);
    torso.position.set(0, 28, 0);
    torso.castShadow = true;
    group.add(torso);

    // Pauldrons (Shoulder guards)
    const pldGeo = new THREE.BoxGeometry(8, 7, 12);
    const leftPld = new THREE.Mesh(pldGeo, goldMat);
    leftPld.position.set(-13, 34, 0);
    leftPld.castShadow = true;
    group.add(leftPld);

    // Haori Kimono Hip Flaps
    const haoriGeo = new THREE.BoxGeometry(18, 12, 10);
    const haori = new THREE.Mesh(haoriGeo, armorMat);
    haori.position.set(0, 20, 0);
    group.add(haori);

    // Headband with Fluttering Tails
    const bandGeo = new THREE.CylinderGeometry(8.8, 8.8, 2.5, 16);
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(0, 46, 0);
    group.add(band);

    const ribbonGeo = new THREE.BoxGeometry(2, 14, 0.5);
    const ribbon = new THREE.Mesh(ribbonGeo, bandMat);
    ribbon.position.set(0, 44, -9);
    ribbon.rotation.x = 0.45;
    group.add(ribbon);
    group.userData.cape = ribbon;

    // High Samurai Ponytail angled backward
    const ponyGeo = new THREE.CylinderGeometry(3.5, 1, 22, 8);
    const pony = new THREE.Mesh(ponyGeo, hairMat);
    pony.position.set(0, 48, -10);
    pony.rotation.x = -0.75;
    group.add(pony);

    // Katana Blade with Glowing Cyan Rune Edge
    const katanaGroup = new THREE.Group();
    const bladeGeo = new THREE.BoxGeometry(1.8, 44, 3.5);
    const blade = new THREE.Mesh(bladeGeo, cyanGlow);
    blade.position.y = 22;
    blade.castShadow = true;
    katanaGroup.add(blade);

    const tsubaGeo = new THREE.CylinderGeometry(4.5, 4.5, 1.5, 12);
    const tsuba = new THREE.Mesh(tsubaGeo, goldMat);
    tsuba.position.y = 1;
    katanaGroup.add(tsuba);

    const hiltGeo = new THREE.CylinderGeometry(1.8, 1.8, 12, 8);
    const hilt = new THREE.Mesh(hiltGeo, darkMat);
    hilt.position.y = -6;
    katanaGroup.add(hilt);

    katanaGroup.position.set(13, 24, 6);
    katanaGroup.rotation.x = 0.25;
    group.add(katanaGroup);
    group.userData.weapon = katanaGroup;
  }

  // ==========================================================
  // 2. 저격수 (Sniper) - Elegant Hextech Marksman
  // ==========================================================
  buildSniperModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x1b1464, roughness: 0.5 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd35400, roughness: 0.35, metalness: 0.8 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x573e27, roughness: 0.65 });
    const hexGlow = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00d2d3, emissiveIntensity: 1.0 });

    // Torso: Victorian Corseted Waistcoat
    const torsoGeo = new THREE.CylinderGeometry(8.5, 7, 19, 8);
    const torso = new THREE.Mesh(torsoGeo, armorMat);
    torso.position.set(0, 28, 0);
    torso.castShadow = true;
    group.add(torso);

    // Long Billowing Trenchcoat Tails
    const coatGeo = new THREE.BoxGeometry(16, 22, 1);
    const coat = new THREE.Mesh(coatGeo, darkMat);
    coat.position.set(0, 16, -7);
    coat.rotation.x = 0.12;
    group.add(coat);
    group.userData.cape = coat;

    // Flowing Sapphire Hair
    const hairLeftGeo = new THREE.CylinderGeometry(2, 1, 24, 6);
    const hairLeft = new THREE.Mesh(hairLeftGeo, hairMat);
    hairLeft.position.set(-6, 36, 2);
    hairLeft.rotation.z = -0.15;
    group.add(hairLeft);

    const hairRight = new THREE.Mesh(hairLeftGeo, hairMat);
    hairRight.position.set(6, 36, 2);
    hairRight.rotation.z = 0.15;
    group.add(hairRight);

    // Hextech Tricorn Hat with Gold Piping & Feather Plume
    const hatGroup = new THREE.Group();
    const crownGeo = new THREE.CylinderGeometry(9, 8.5, 6, 16);
    const crown = new THREE.Mesh(crownGeo, darkMat);
    hatGroup.add(crown);

    const brimGeo = new THREE.CylinderGeometry(15, 15, 1, 16);
    const brim = new THREE.Mesh(brimGeo, goldMat);
    brim.position.y = -2.5;
    hatGroup.add(brim);

    const plumeGeo = new THREE.ConeGeometry(2, 12, 6);
    const plume = new THREE.Mesh(plumeGeo, hexGlow);
    plume.position.set(6, 7, 0);
    plume.rotation.z = -0.35;
    hatGroup.add(plume);

    hatGroup.position.set(0, 50, 0);
    group.add(hatGroup);

    // Ornate Hextech Long Rifle
    const rifleGroup = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(3.5, 7, 18), woodMat);
    stock.position.set(0, 0, -8);
    rifleGroup.add(stock);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 52, 8), brassMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 1, 22);
    rifleGroup.add(barrel);

    const scope = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 18, 8), brassMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 6, 14);
    rifleGroup.add(scope);

    const scopeLens = new THREE.Mesh(new THREE.CircleGeometry(2.2, 8), hexGlow);
    scopeLens.position.set(0, 6, 23.2);
    rifleGroup.add(scopeLens);

    rifleGroup.position.set(11, 27, 8);
    rifleGroup.rotation.x = -0.15;
    rifleGroup.castShadow = true;
    group.add(rifleGroup);
    group.userData.weapon = rifleGroup;
  }

  // ==========================================================
  // 3. 화염술사 (Pyromancer) - Handsome Flame Archmage
  // ==========================================================
  buildPyromancerModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = new THREE.MeshStandardMaterial({ color: 0xd63031, roughness: 0.5 });
    const robeMat = new THREE.MeshStandardMaterial({ color: 0x9b111e, roughness: 0.65 });
    const flameMat = new THREE.MeshStandardMaterial({ color: 0xff4757, emissive: 0xff3838, emissiveIntensity: 1.0 });

    // Torso: Magister Tunic with Gold Trim
    const torsoGeo = new THREE.CylinderGeometry(9, 7.5, 20, 8);
    const torso = new THREE.Mesh(torsoGeo, robeMat);
    torso.position.set(0, 28, 0);
    torso.castShadow = true;
    group.add(torso);

    // High Archmage Mantle Collar
    const collarGeo = new THREE.BoxGeometry(22, 14, 2);
    const collar = new THREE.Mesh(collarGeo, goldMat);
    collar.position.set(0, 38, -6);
    collar.rotation.x = -0.25;
    group.add(collar);

    // Dynamic Spiky Flame Hair
    const hairSpikeGeo = new THREE.ConeGeometry(3, 10, 6);
    for (let k = 0; k < 5; k++) {
      const spk = new THREE.Mesh(hairSpikeGeo, hairMat);
      const ang = (k - 2) * 0.35;
      spk.position.set(Math.sin(ang) * 7, 50, -Math.cos(ang) * 3);
      spk.rotation.z = -ang;
      group.add(spk);
    }

    // 3 Revolving Burning Sun Orbs (Orbiting Torso)
    const orbitGroup = new THREE.Group();
    orbitGroup.position.set(0, 28, 0);
    for (let i = 0; i < 3; i++) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(3.5, 8, 8), flameMat);
      const orbAngle = (i * Math.PI * 2) / 3;
      orb.position.set(Math.cos(orbAngle) * 22, 0, Math.sin(orbAngle) * 22);
      orbitGroup.add(orb);
    }
    group.add(orbitGroup);
    group.userData.orbits = [orbitGroup];

    // Phoenix Flame Staff with Levitating Solar Core
    const staffGroup = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 48, 8), goldMat);
    staffGroup.add(shaft);

    const wings = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 3), goldMat);
    wings.position.y = 23;
    staffGroup.add(wings);

    const coreGem = new THREE.Mesh(new THREE.OctahedronGeometry(5.5), flameMat);
    coreGem.position.y = 28;
    staffGroup.add(coreGem);

    staffGroup.position.set(13, 26, 6);
    staffGroup.castShadow = true;
    group.add(staffGroup);
    group.userData.weapon = staffGroup;
  }

  // ==========================================================
  // 4. 암살자 (Shadow Assassin) - Sleek Deadly Ninja
  // ==========================================================
  buildShadowAssassinModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const violetMat = new THREE.MeshStandardMaterial({ color: 0x8e44ad, emissive: 0x6c5ce7, emissiveIntensity: 0.8 });
    const stealthMat = new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.8 });

    // Torso: Lightweight Obsidian Stealth Vest
    const torsoGeo = new THREE.CylinderGeometry(9.5, 7.5, 20, 8);
    const torso = new THREE.Mesh(torsoGeo, stealthMat);
    torso.position.set(0, 28, 0);
    torso.castShadow = true;
    group.add(torso);

    // Trailing Divided Shadow Scarf
    const scarfGeo = new THREE.BoxGeometry(4.5, 24, 0.8);
    const scarf = new THREE.Mesh(scarfGeo, violetMat);
    scarf.position.set(0, 36, -8);
    scarf.rotation.x = 0.35;
    group.add(scarf);
    group.userData.cape = scarf;

    // Cowl Hood Peak
    const hoodGeo = new THREE.ConeGeometry(9.5, 8, 8);
    const hood = new THREE.Mesh(hoodGeo, stealthMat);
    hood.position.set(0, 50, 0);
    group.add(hood);

    // Dual Arm-Mounted Curved Shadow Blades (Right & Left)
    const bladeGeo = new THREE.BoxGeometry(2, 30, 4);

    const rightBlade = new THREE.Mesh(bladeGeo, violetMat);
    rightBlade.position.set(12, 24, 8);
    rightBlade.rotation.x = 0.45;
    rightBlade.castShadow = true;
    group.add(rightBlade);
    group.userData.weapon = rightBlade;

    const leftBlade = new THREE.Mesh(bladeGeo, violetMat);
    leftBlade.position.set(-12, 24, 8);
    leftBlade.rotation.x = 0.45;
    leftBlade.castShadow = true;
    group.add(leftBlade);
    group.userData.leftWeapon = leftBlade;
  }

  // ==========================================================
  // 5. 수호자 (Guardian) - Radiant Winged Paladin
  // ==========================================================
  buildGuardianModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const whitePlate = new THREE.MeshStandardMaterial({ color: 0xf5f6fa, roughness: 0.25, metalness: 0.7 });
    const holyGlow = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x0984e3, emissiveIntensity: 0.8 });

    // Torso: Polished White & Gold Winged Plate Armor
    const torsoGeo = new THREE.CylinderGeometry(12, 9, 22, 8);
    const torso = new THREE.Mesh(torsoGeo, whitePlate);
    torso.position.set(0, 28, 0);
    torso.castShadow = true;
    group.add(torso);

    // Winged Shoulder Pauldrons
    const pldGeo = new THREE.BoxGeometry(10, 10, 15);
    const leftPld = new THREE.Mesh(pldGeo, goldMat);
    leftPld.position.set(-15, 36, 0);
    leftPld.castShadow = true;
    group.add(leftPld);

    const rightPld = new THREE.Mesh(pldGeo, goldMat);
    rightPld.position.set(15, 36, 0);
    rightPld.castShadow = true;
    group.add(rightPld);

    // Billowing Royal Blue Knight Cape
    const capeGeo = new THREE.BoxGeometry(20, 28, 1);
    const capeMat = new THREE.MeshStandardMaterial({ color: 0x1b1464, roughness: 0.7 });
    const cape = new THREE.Mesh(capeGeo, capeMat);
    cape.position.set(0, 24, -9);
    cape.rotation.x = 0.1;
    group.add(cape);
    group.userData.cape = cape;

    // Winged Golden Paladin Helmet Plume
    const plumeGeo = new THREE.BoxGeometry(3, 10, 14);
    const plume = new THREE.Mesh(plumeGeo, goldMat);
    plume.position.set(0, 52, 0);
    group.add(plume);

    // Left Arm: Giant Golden Lion-Crest Tower Shield with Holy Cross
    const shieldGroup = new THREE.Group();
    const shldGeo = new THREE.BoxGeometry(26, 44, 4.5);
    const shld = new THREE.Mesh(shldGeo, whitePlate);
    shieldGroup.add(shld);

    const crossV = new THREE.Mesh(new THREE.BoxGeometry(5, 34, 1.5), goldMat);
    crossV.position.z = 2.5;
    shieldGroup.add(crossV);

    const crossH = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 1.5), goldMat);
    crossH.position.set(0, 4, 2.5);
    shieldGroup.add(crossH);

    shieldGroup.position.set(-14, 25, 8);
    shieldGroup.castShadow = true;
    group.add(shieldGroup);

    // Right Arm: Radiant Holy Warhammer
    const hammerGroup = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 38, 8), goldMat);
    hammerGroup.add(shaft);

    const head = new THREE.Mesh(new THREE.BoxGeometry(12, 14, 18), silverMat);
    head.position.y = 16;
    hammerGroup.add(head);

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(4), holyGlow);
    core.position.y = 16;
    hammerGroup.add(core);

    hammerGroup.position.set(14, 26, 8);
    hammerGroup.castShadow = true;
    group.add(hammerGroup);
    group.userData.weapon = hammerGroup;
  }

  // ==========================================================
  // 6. 빙결술사 (Frost Mage) - Ethereal Glacial Ice Queen
  // ==========================================================
  buildFrostMageModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = new THREE.MeshStandardMaterial({ color: 0xecf0f1, roughness: 0.35 });
    const iceGlow = new THREE.MeshStandardMaterial({
      color: 0x00d2d3,
      emissive: 0x00ffff,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.88
    });
    const dressMat = new THREE.MeshStandardMaterial({
      color: 0x74b9ff,
      roughness: 0.3,
      transparent: true,
      opacity: 0.90
    });

    // Torso: Shimmering Glacial Gown
    const torsoGeo = new THREE.CylinderGeometry(8, 6.5, 18, 8);
    const torso = new THREE.Mesh(torsoGeo, dressMat);
    torso.position.set(0, 28, 0);
    torso.castShadow = true;
    group.add(torso);

    // Flared Ice Skirt
    const skirtGeo = new THREE.ConeGeometry(14, 22, 12, 1, true);
    const skirt = new THREE.Mesh(skirtGeo, dressMat);
    skirt.position.set(0, 11, 0);
    group.add(skirt);

    // Long Cascading Platinum Hair down past waist
    const hairGeo = new THREE.BoxGeometry(15, 28, 3);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.set(0, 32, -6);
    hair.rotation.x = 0.08;
    group.add(hair);
    group.userData.cape = hair;

    // Levitating Crystal Frost Tiara with Diamond Spikes
    const tiaraGeo = new THREE.TorusGeometry(8.5, 1.2, 8, 16);
    const tiara = new THREE.Mesh(tiaraGeo, iceGlow);
    tiara.rotation.x = Math.PI / 2;
    tiara.position.set(0, 50, 0);
    group.add(tiara);

    // 3 Levitating Diamond Ice Crystals Orbiting Shoulders
    const iceOrbit = new THREE.Group();
    iceOrbit.position.set(0, 36, 0);
    for (let k = 0; k < 3; k++) {
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(4), iceGlow);
      const ang = (k * Math.PI * 2) / 3;
      cr.position.set(Math.cos(ang) * 18, Math.sin(k * 2) * 3, Math.sin(ang) * 18);
      iceOrbit.add(cr);
    }
    group.add(iceOrbit);
    group.userData.orbits = [iceOrbit];

    // Crystalline Frost Sceptre with Snowflake Star
    const sceptreGroup = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 44, 8), silverMat);
    sceptreGroup.add(shaft);

    const star = new THREE.Mesh(new THREE.OctahedronGeometry(6.5), iceGlow);
    star.position.y = 22;
    sceptreGroup.add(star);

    sceptreGroup.position.set(12, 27, 6);
    sceptreGroup.castShadow = true;
    group.add(sceptreGroup);
    group.userData.weapon = sceptreGroup;
  }

  // ==========================================================
  // 7. 광전사 (Berserker) - Muscular Fierce Viking Warrior
  // ==========================================================
  buildBerserkerModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = new THREE.MeshStandardMaterial({ color: 0xd35400, roughness: 0.7 });
    const furMat = new THREE.MeshStandardMaterial({ color: 0x57606f, roughness: 0.9 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x747d8c, roughness: 0.35, metalness: 0.85 });

    // Muscular Bare Torso with Tattoos
    const torsoGeo = new THREE.BoxGeometry(22, 22, 14);
    const torso = new THREE.Mesh(torsoGeo, skinMat);
    torso.position.set(0, 28, 0);
    torso.castShadow = true;
    group.add(torso);

    // Heavy Wolf-Fur Pelt Mantle across Broad Shoulders
    const furGeo = new THREE.BoxGeometry(28, 9, 16);
    const fur = new THREE.Mesh(furGeo, furMat);
    fur.position.set(0, 36, 0);
    group.add(fur);

    // Braided Viking Beard & Hair
    const beardGeo = new THREE.ConeGeometry(4, 12, 6);
    const beard = new THREE.Mesh(beardGeo, hairMat);
    beard.position.set(0, 36, 7);
    beard.rotation.x = -0.3;
    group.add(beard);

    // Dual Bearded Battleaxes (Right & Left)
    const createAxe = () => {
      const g = new THREE.Group();
      const hdl = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 36, 8), darkMat);
      g.add(hdl);

      const bld = new THREE.Mesh(new THREE.BoxGeometry(3.5, 24, 16), steelMat);
      bld.position.set(0, 10, 6);
      g.add(bld);
      return g;
    };

    const rightAxe = createAxe();
    rightAxe.position.set(14, 25, 8);
    rightAxe.rotation.x = 0.25;
    group.add(rightAxe);
    group.userData.weapon = rightAxe;

    const leftAxe = createAxe();
    leftAxe.position.set(-14, 25, 8);
    leftAxe.rotation.x = 0.25;
    group.add(leftAxe);
    group.userData.leftWeapon = leftAxe;
  }

  // ==========================================================
  // 8. 그림자 사냥꾼 (Shadow Hunter) - Stylish Gothic Van Helsing
  // ==========================================================
  buildShadowHunterModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x1e272e, roughness: 0.8 });
    const silverTrim = new THREE.MeshStandardMaterial({ color: 0xdcdde1, roughness: 0.25, metalness: 0.8 });

    // Torso: Long Leather Duster Trenchcoat
    const torsoGeo = new THREE.CylinderGeometry(9, 7.5, 20, 8);
    const torso = new THREE.Mesh(torsoGeo, leatherMat);
    torso.position.set(0, 28, 0);
    torso.castShadow = true;
    group.add(torso);

    // Flared Duster Coat Tails
    const tailsGeo = new THREE.BoxGeometry(16, 24, 1);
    const tails = new THREE.Mesh(tailsGeo, leatherMat);
    tails.position.set(0, 15, -7);
    tails.rotation.x = 0.15;
    group.add(tails);
    group.userData.cape = tails;

    // Wide-Brimmed Gothic Hunter Fedora
    const fedoraGroup = new THREE.Group();
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1, 16), leatherMat);
    fedoraGroup.add(brim);

    const crown = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 8.5, 6, 16), leatherMat);
    crown.position.y = 3;
    fedoraGroup.add(crown);

    const band = new THREE.Mesh(new THREE.CylinderGeometry(8.7, 8.7, 1.5, 16), silverTrim);
    band.position.y = 1.5;
    fedoraGroup.add(band);

    fedoraGroup.position.set(0, 50, 0);
    group.add(fedoraGroup);

    // Wrist-Mounted Repeater Crossbow
    const xbowGroup = new THREE.Group();
    const bowStock = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 22), darkMat);
    xbowGroup.add(bowStock);

    const prod = new THREE.Mesh(new THREE.BoxGeometry(24, 2.5, 3), silverTrim);
    prod.position.set(0, 1, 8);
    xbowGroup.add(prod);

    xbowGroup.position.set(12, 26, 8);
    xbowGroup.castShadow = true;
    group.add(xbowGroup);
    group.userData.weapon = xbowGroup;
  }

  // ==========================================================
  // 9. 격투가 (Brawler) - Striking Tiger Martial Artist
  // ==========================================================
  buildBrawlerModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x2d3436, roughness: 0.6 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xd63031, roughness: 0.6 });
    const tigerGlow = new THREE.MeshStandardMaterial({ color: 0xf39c12, emissive: 0xd35400, emissiveIntensity: 0.9 });

    // Torso: Open Martial Arts Vest showing Muscular Abs
    const torsoGeo = new THREE.BoxGeometry(20, 20, 12);
    const torso = new THREE.Mesh(torsoGeo, skinMat);
    torso.position.set(0, 28, 0);
    torso.castShadow = true;
    group.add(torso);

    const sash = new THREE.Mesh(new THREE.BoxGeometry(21, 5, 13), goldMat);
    sash.position.set(0, 19, 0);
    group.add(sash);

    // Red Fighting Headband
    const hband = new THREE.Mesh(new THREE.CylinderGeometry(8.8, 8.8, 2, 16), redMat);
    hband.position.set(0, 46, 0);
    group.add(hband);

    // Massive Golden Tiger-Head Fist Gauntlets
    const gauntGeo = new THREE.BoxGeometry(8, 8, 12);

    const rightFist = new THREE.Mesh(gauntGeo, tigerGlow);
    rightFist.position.set(13, 26, 8);
    rightFist.castShadow = true;
    group.add(rightFist);
    group.userData.weapon = rightFist;

    const leftFist = new THREE.Mesh(gauntGeo, tigerGlow);
    leftFist.position.set(-13, 26, 8);
    leftFist.castShadow = true;
    group.add(leftFist);
    group.userData.leftWeapon = leftFist;
  }

  // ==========================================================
  // 10. 폭탄광 (Demolitionist) - Eccentric Tech Genius Inventor
  // ==========================================================
  buildDemolitionistModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x0984e3, roughness: 0.5 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd35400, roughness: 0.35, metalness: 0.8 });
    const bombMat = new THREE.MeshStandardMaterial({ color: 0x2d3436, roughness: 0.4 });
    const sparkMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, emissive: 0xff9f43, emissiveIntensity: 1.0 });

    // Torso: Steampunk Leather Harness
    const torsoGeo = new THREE.BoxGeometry(18, 18, 12);
    const torso = new THREE.Mesh(torsoGeo, armorMat);
    torso.position.set(0, 28, 0);
    torso.castShadow = true;
    group.add(torso);

    // Brass Aviator Goggles on Forehead
    const goggleL = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 2, 8), brassMat);
    goggleL.rotation.x = Math.PI / 2;
    goggleL.position.set(-4.5, 48, 7);
    group.add(goggleL);

    const goggleR = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 2, 8), brassMat);
    goggleR.rotation.x = Math.PI / 2;
    goggleR.position.set(4.5, 48, 7);
    group.add(goggleR);

    // Clockwork Rocket Backpack with Twin Exhaust Nozzles
    const packGroup = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.BoxGeometry(12, 16, 8), brassMat);
    packGroup.add(tank);

    const nozzL = new THREE.Mesh(new THREE.ConeGeometry(2.5, 6, 8), brassMat);
    nozzL.position.set(-4, -10, 0);
    nozzL.rotation.x = Math.PI;
    packGroup.add(nozzL);

    const nozzR = new THREE.Mesh(new THREE.ConeGeometry(2.5, 6, 8), brassMat);
    nozzR.position.set(4, -10, 0);
    nozzR.rotation.x = Math.PI;
    packGroup.add(nozzR);

    packGroup.position.set(0, 28, -9);
    group.add(packGroup);

    // Held Round Fuse Bomb with Glowing Spark Wick
    const bombGroup = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 12), bombMat);
    bombGroup.add(ball);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3, 8), brassMat);
    cap.position.y = 7;
    bombGroup.add(cap);

    const spark = new THREE.Mesh(new THREE.SphereGeometry(1.8, 6, 6), sparkMat);
    spark.position.y = 10;
    bombGroup.add(spark);

    bombGroup.position.set(12, 27, 8);
    bombGroup.castShadow = true;
    group.add(bombGroup);
    group.userData.weapon = bombGroup;
  }

  // ==========================================================
  // 3D STRUCTURES (TURRETS & NEXUS)
  // ==========================================================
  update3DStructures(structures) {
    const THREE = window.THREE;
    if (!structures) return;

    structures.forEach(s => {
      let group = this.threeStructureMeshes[s.id];
      if (!group) {
        group = new THREE.Group();
        const isBlue = s.team === 'blue';
        const teamHex = isBlue ? 0x0984e3 : 0xd63031;

        if (s.type === 'nexus') {
          // 3D Arcane Nexus
          const daisGeo = new THREE.CylinderGeometry(s.radius, s.radius * 1.1, 18, 16);
          const daisMat = new THREE.MeshStandardMaterial({ color: 0x2d3436, roughness: 0.7 });
          const dais = new THREE.Mesh(daisGeo, daisMat);
          dais.position.y = 9;
          dais.receiveShadow = true;
          group.add(dais);

          // Giant Floating Core Gem
          const gemGeo = new THREE.OctahedronGeometry(s.radius * 0.55);
          const gemMat = new THREE.MeshStandardMaterial({ color: teamHex, emissive: teamHex, roughness: 0.2 });
          const gem = new THREE.Mesh(gemGeo, gemMat);
          gem.position.y = 48;
          group.add(gem);
          group.userData.gem = gem;
        } else {
          // 3D Stone Turret
          const colGeo = new THREE.CylinderGeometry(s.radius * 0.7, s.radius * 0.9, 70, 8);
          const colMat = new THREE.MeshStandardMaterial({ color: 0x3d494e, roughness: 0.7 });
          const col = new THREE.Mesh(colGeo, colMat);
          col.position.y = 35;
          col.castShadow = true;
          col.receiveShadow = true;
          group.add(col);

          // Levitating Crystal
          const gemGeo = new THREE.OctahedronGeometry(14);
          const gemMat = new THREE.MeshStandardMaterial({ color: teamHex, emissive: teamHex, roughness: 0.2 });
          const gem = new THREE.Mesh(gemGeo, gemMat);
          gem.position.y = 90;
          group.add(gem);
          group.userData.gem = gem;
        }

        group.position.set(s.x, 0, s.y);
        this.threeStructureMeshes[s.id] = group;
        this.scene.add(group);
      }

      group.visible = s.isAlive;
      if (group.userData.gem) {
        group.userData.gem.rotation.y += 0.04;
      }
    });
  }

  // ==========================================================
  // 3D PROJECTILES
  // ==========================================================
  update3DProjectiles(projectiles) {
    const THREE = window.THREE;
    const activeIds = new Set();

    if (projectiles) {
      projectiles.forEach((pr, idx) => {
        const pId = `proj_${idx}`;
        activeIds.add(pId);

        let mesh = this.threeProjectileMeshes[pId];
        if (!mesh) {
          const pGeo = new THREE.SphereGeometry(pr.radius || 10, 8, 8);
          const pMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: pr.color ? new THREE.Color(pr.color) : new THREE.Color(0xff9f43),
            roughness: 0.2
          });
          mesh = new THREE.Mesh(pGeo, pMat);
          this.threeProjectileMeshes[pId] = mesh;
          this.scene.add(mesh);
        }

        mesh.position.set(pr.x, 24, pr.y);
      });
    }

    Object.keys(this.threeProjectileMeshes).forEach(id => {
      if (!activeIds.has(id)) {
        this.scene.remove(this.threeProjectileMeshes[id]);
        delete this.threeProjectileMeshes[id];
      }
    });
  }

  // ==========================================================
  // 2D CANVAS OVERLAYS (LOL AUTHENTIC HEALTH BARS & MINIMAP)
  // ==========================================================
  render2DOverlays(gameState, localPlayer, mouseScreenPos) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Attack Move (A-Click) Range Indicator
    if (this.isAttackMoveActive && localPlayer) {
      this.renderAttackRangeCircle(ctx, localPlayer);
    }

    // 2. Click Move Rings (Green Move / Red Attack Target)
    this.renderClickRings2D(ctx);

    // 3. Shockwaves & Slash Trails
    this.renderShockwaves2D(ctx);
    this.renderSlashTrails2D(ctx);

    // 4. Authentic LoL Overhead Health Bars (Projected 3D to 2D Screen Space)
    if (gameState.players) {
      gameState.players.forEach(p => {
        if (!p.isAlive) return;
        const screenPos = this.worldToScreen(p.x, p.y);
        const isMe = p.id === this.localPlayerId;
        const isAlly = localPlayer ? p.team === localPlayer.team : p.team === 'blue';
        this.renderLolHealthBar(ctx, p, screenPos.x, screenPos.y - 75, isMe, isAlly);
      });
    }

    // 5. Spacebar Yellow Triangle Focus Ping (▼)
    if (this.cameraCtrl.isSpaceHeld && localPlayer) {
      const sp = this.worldToScreen(localPlayer.x, localPlayer.y);
      this.renderSpaceFocusPing2D(ctx, sp.x, sp.y - 95);
    }

    // 6. Floating Combat Texts & '+90 💰'
    this.renderFloatingTexts2D(ctx);

    // 7. Minimap Frustum
    this.renderMinimap(gameState, localPlayer);
  }

  // Render Golden/Red Attack Range Circle when 'A' Key is pressed
  renderAttackRangeCircle(ctx, player) {
    const sp = this.worldToScreen(player.x, player.y);
    const rangePx = (player.attackRange || 500) * (this.cameraCtrl.zoom || 1.0) * 0.85;

    ctx.save();
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.75)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, rangePx, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(231, 76, 60, 0.1)';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, rangePx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  renderLolHealthBar(ctx, p, x, y, isMe, isAlly) {
    const barW = 86;
    const barH = 8;
    const barX = x - barW / 2 + 10;
    const barY = y;

    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const shieldPct = Math.max(0, Math.min(1, (p.shield || 0) / p.maxHp));
    const mpPct = Math.max(0, Math.min(1, p.mp / p.maxMp));

    // Nickname
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(p.nickname || '소환사', x, barY - 6);
    ctx.fillStyle = isMe ? '#f1c40f' : (isAlly ? '#74b9ff' : '#ffffff');
    ctx.fillText(p.nickname || '소환사', x, barY - 6);

    // Left [Level] Box
    const lvlX = barX - 22;
    const lvlY = barY - 2;
    ctx.fillStyle = '#0a0e17';
    ctx.strokeStyle = '#57606f';
    ctx.lineWidth = 1.5;
    ctx.fillRect(lvlX, lvlY, 18, 18);
    ctx.strokeRect(lvlX, lvlY, 18, 18);

    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('14', lvlX + 9, lvlY + 9);

    // HP Bar
    ctx.fillStyle = '#060a10';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = isAlly ? '#2ed573' : '#ff4757';
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    // White Shield Overlay
    if (shieldPct > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillRect(barX + barW * hpPct, barY, barW * shieldPct, barH);
    }

    // 100-HP Ticks & 1000-HP Dividers
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

    ctx.strokeStyle = '#2d3436';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    // Mana Bar
    ctx.fillStyle = '#0984e3';
    ctx.fillRect(barX, barY + barH + 1, barW * mpPct, 2.5);
  }

  renderClickRings2D(ctx) {
    for (let i = this.clickRings.length - 1; i >= 0; i--) {
      const r = this.clickRings[i];
      r.radius += (r.maxRadius - r.radius) * 0.18;
      r.alpha -= 0.045;

      if (r.alpha <= 0) {
        this.clickRings.splice(i, 1);
        continue;
      }

      const sp = this.worldToScreen(r.x, r.y);
      ctx.save();
      ctx.strokeStyle = r.isAttack ? `rgba(255, 71, 87, ${r.alpha})` : `rgba(46, 213, 115, ${r.alpha})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  renderShockwaves2D(ctx) {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.radius += (s.maxRadius - s.radius) * 0.22;
      s.alpha -= 0.055;

      if (s.alpha <= 0) {
        this.shockwaves.splice(i, 1);
        continue;
      }

      const sp = this.worldToScreen(s.x, s.y);
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = s.alpha;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, s.radius * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  renderSlashTrails2D(ctx) {
    for (let i = this.slashTrails.length - 1; i >= 0; i--) {
      const st = this.slashTrails[i];
      st.alpha -= 0.08;

      if (st.alpha <= 0) {
        this.slashTrails.splice(i, 1);
        continue;
      }

      const sp = this.worldToScreen(st.x, st.y);
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(st.angle);
      ctx.strokeStyle = st.color;
      ctx.globalAlpha = st.alpha;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, st.radius, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  renderSpaceFocusPing2D(ctx, x, y) {
    ctx.save();
    const bounce = Math.sin(this.animationTimer * 12) * 5;
    ctx.translate(x, y + bounce);
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

  renderFloatingTexts2D(ctx) {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.alpha -= 0.022;

      if (ft.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }

      const sp = this.worldToScreen(ft.x, ft.y);
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.font = `bold ${Math.round(ft.size * ft.scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3.5;
      ctx.strokeText(ft.text, sp.x, sp.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, sp.x, sp.y);
      ctx.restore();
    }
  }

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

    // Lanes
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

    // Camera Frustum
    const bounds = this.cameraCtrl.getViewportBounds();
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
