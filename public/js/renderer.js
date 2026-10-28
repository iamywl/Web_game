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

import * as THREE from 'three';
import { createChampionMaterial, createOutlineMesh, toonRamp } from './nprMaterial.js';
import { GameFeelController } from './GameFeelController.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Zero-GC Module-Level Math Cache Variables
const Three = (typeof THREE !== 'undefined' && THREE) ? THREE : window.THREE;
const _v1 = new Three.Vector3();
const _v2 = new Three.Vector3();
const _q1 = new Three.Quaternion();

class GameRenderer {
  constructor(containerId, cameraController) {
    this.container = document.getElementById(containerId);
    this.cameraCtrl = cameraController || new CameraController();
    this.camera = this.cameraCtrl; // Backward compatibility alias
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    // Game Feel & Combat Juice Controllers
    this.gameFeelController = null;
    this.hitFreezeTimer = 0; // Hitstop frame freeze timer

    this.faceTextureCache = {};
    this.badgeCache = {}; // OffscreenCanvas cache for player name/level badges (removes per-frame 2D text overhead)
    this.minimapLastDrawTime = 0; // Throttle minimap updates (every 50ms)
    this.sharedProjGeo = null;
    this.sharedProjMat = {};
    this.sharedProjPool = [];
    this._dummyObj = null;

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
    this.threeMinionMeshes = {}; // minionId -> THREE.Group
    this.threeProjectileMeshes = {}; // id -> THREE.Mesh
    this.threeJungleMeshes = {}; // id -> THREE.Group
    this.threeWardMeshes = {}; // id -> THREE.Group
    this.champAnimStates = {};
    this.minionAnimStates = {}; // minionId -> { walkPhase, lastX, lastY }

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

    this._dummyObj = new THREE.Object3D();

    // 1. Scene & Atmospheric Fog
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060c14);
    this.scene.fog = new THREE.FogExp2(0x060c14, 0.00045);

    // 2. 3D Perspective Quarter-View Camera
    this.camera3D = new THREE.PerspectiveCamera(45, this.width / this.height, 10, 5000);
    this.camera3D.position.set(1200, 750, 1500);
    this.camera3D.lookAt(1200, 0, 800);

    // 3. WebGL 3D Renderer with Real-Time Soft Shadows (Cinematic Fidelity)
    try {
      this.renderer3D = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      console.warn('WebGLRenderer high-performance initialization failed, falling back:', e);
      this.renderer3D = new THREE.WebGLRenderer();
    }
    this.renderer3D.setSize(this.width, this.height);
    // Dynamic DPR: support up to 2.0 for sharp, crisp visuals on Retina/QHD/4K displays
    this.renderer3D.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
    this.renderer3D.shadowMap.enabled = true;
    this.renderer3D.shadowMap.type = THREE.PCFSoftShadowMap; // Beautiful penumbra soft shadows
    this.renderer3D.toneMapping = THREE.ACESFilmicToneMapping; // Industry standard cinematic tone curve
    this.renderer3D.toneMappingExposure = 1.15;

    this.renderer3D.domElement.style.position = 'absolute';
    this.renderer3D.domElement.style.top = '0';
    this.renderer3D.domElement.style.left = '0';
    this.renderer3D.domElement.style.zIndex = '1';
    this.container.appendChild(this.renderer3D.domElement);

    // 3.5 Stylized NPR Post-Processing Pipeline (Selective UnrealBloomPass for magical skillshots & glowing runes)
    try {
      this.composer = new EffectComposer(this.renderer3D);
      const renderPass = new RenderPass(this.scene, this.camera3D);
      this.composer.addPass(renderPass);

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(this.width, this.height),
        0.55, // Strength: glowing magical skillshots without washing out the scene
        0.35, // Radius
        0.82  // Threshold: selective bloom for high-emissive magic only
      );
      this.composer.addPass(this.bloomPass);

      const outputPass = new OutputPass();
      this.composer.addPass(outputPass);
    } catch (err) {
      console.warn('EffectComposer / UnrealBloomPass initialization failed, falling back to direct render:', err);
      this.composer = null;
    }

    // 4. 3D Lighting Setup (Sunlight + Ambient)
    this.setup3DLights();

    // 5. 3D Terrain & Obstacles
    this.build3DEnvironment();

    // 6. Raycaster for Exact 3D Ground Intersection
    this.raycaster = new THREE.Raycaster();
    this.mouseVec = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._cachedHitPoint = new THREE.Vector3();
    this._cachedWorldPos = new THREE.Vector3();
    this._cachedTargetVec = new THREE.Vector3();
  }

  init2DOverlayCanvas() {
    this.canvas2D = document.createElement('canvas');
    this.canvas2D.width = this.width;
    this.canvas2D.height = this.height;
    this.canvas2D.style.position = 'absolute';
    this.canvas2D.style.top = '0';
    this.canvas2D.style.left = '0';
    this.canvas2D.style.zIndex = '2';
    this.canvas2D.style.pointerEvents = 'none';
    this.ctx = this.canvas2D.getContext('2d');
    this.container.appendChild(this.canvas2D);
  }

  setup3DLights() {
    const THREE = window.THREE;
    // Ambient Sky Fill
    const hemiLight = new THREE.HemisphereLight(0x70a1ff, 0x14211a, 0.9);
    this.scene.add(hemiLight);

    // Key Directional Sunlight with optimized Frustum for sharp 2048x2048 shadows
    this.sunLight = new THREE.DirectionalLight(0xfff5e4, 1.45);
    this.sunLight.position.set(1200, 1100, 1300);
    this.sunLight.target.position.set(1200, 0, 800);
    this.scene.add(this.sunLight.target);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 100;
    this.sunLight.shadow.camera.far = 2800;
    const d = 950; // Focused shadow frustum for 2x crisp shadow texel density
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.02; // Prevents shadow acne & peter-panning
    this.scene.add(this.sunLight);
  }

  build3DEnvironment() {
    const THREE = window.THREE;
    const mapW = 2400;
    const mapH = 1600;

    // 1. Procedural 3D Summoner's Rift Ground Texture with Authentic Mid Lane & Bases
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 1024;
    groundCanvas.height = 1024;
    const gctx = groundCanvas.getContext('2d');

    // Rich Dark Turf with Stylized NPR Grass & Moss
    gctx.fillStyle = '#15291e';
    gctx.fillRect(0, 0, 1024, 1024);

    // Organic Turf Texture Flecks
    for (let i = 0; i < 3500; i++) {
      const nx = Math.random() * 1024;
      const ny = Math.random() * 1024;
      gctx.fillStyle = Math.random() > 0.5 ? 'rgba(28, 64, 42, 0.45)' : 'rgba(12, 28, 20, 0.35)';
      gctx.fillRect(nx, ny, 3, 3);
    }

    // Vertical River Crossing Bed (at texX = 512, maps to world X = 1200)
    gctx.fillStyle = '#1a3a30';
    gctx.fillRect(440, 60, 144, 904);

    // River Water Gradient (Subtle depth)
    const riverGrad = gctx.createLinearGradient(440, 0, 584, 0);
    riverGrad.addColorStop(0, '#13352c');
    riverGrad.addColorStop(0.5, '#0e413a');
    riverGrad.addColorStop(1, '#13352c');
    gctx.fillStyle = riverGrad;
    gctx.fillRect(455, 60, 114, 904);

    // Horizontal Mid Lane (from Blue Base X:111 to Red Base X:913 along Y:512)
    const laneY = 512;
    const laneH = 136;
    const laneTop = laneY - laneH / 2;

    // Outer Stone Curb Border
    gctx.fillStyle = '#1e282c';
    gctx.fillRect(60, laneTop - 8, 904, laneH + 16);

    // Dark Cobblestone Base
    gctx.fillStyle = '#263439';
    gctx.fillRect(60, laneTop, 904, laneH);

    // Interlocking Cobblestone Tiles
    gctx.fillStyle = '#37474d';
    for (let lx = 70; lx < 950; lx += 24) {
      for (let ly = laneTop + 6; ly < laneTop + laneH - 6; ly += 20) {
        const offset = ((Math.floor(ly / 20) % 2) * 12);
        gctx.fillRect(lx + offset, ly, 20, 16);
      }
    }

    // Center Paver Accent Stones (Lighter Highway Path)
    gctx.fillStyle = '#495d65';
    gctx.fillRect(80, laneY - 24, 864, 48);

    // Gold Runic Highway Seams
    gctx.strokeStyle = 'rgba(200, 155, 60, 0.45)';
    gctx.lineWidth = 2.5;
    gctx.beginPath();
    gctx.moveTo(80, laneY - 24);
    gctx.lineTo(944, laneY - 24);
    gctx.moveTo(80, laneY + 24);
    gctx.lineTo(944, laneY + 24);
    gctx.stroke();

    // Turret Stone Foundation Pads (Octagons along Lane)
    const turretXs = [265, 405, 619, 759];
    turretXs.forEach(tx => {
      gctx.fillStyle = '#1c2529';
      gctx.beginPath();
      gctx.arc(tx, laneY, 38, 0, Math.PI * 2);
      gctx.fill();
      gctx.fillStyle = '#3d4f56';
      gctx.beginPath();
      gctx.arc(tx, laneY, 32, 0, Math.PI * 2);
      gctx.fill();
      gctx.strokeStyle = '#c89b3c';
      gctx.lineWidth = 2;
      gctx.stroke();
    });

    // Blue Base Platform Dais (Left X: 111, Y: 512)
    gctx.fillStyle = '#102538';
    gctx.beginPath();
    gctx.arc(111, laneY, 72, 0, Math.PI * 2);
    gctx.fill();
    gctx.fillStyle = '#1c4268';
    gctx.beginPath();
    gctx.arc(111, laneY, 62, 0, Math.PI * 2);
    gctx.fill();
    gctx.strokeStyle = '#00a8ff';
    gctx.lineWidth = 4;
    gctx.stroke();

    // Red Base Platform Dais (Right X: 913, Y: 512)
    gctx.fillStyle = '#381616';
    gctx.beginPath();
    gctx.arc(913, laneY, 72, 0, Math.PI * 2);
    gctx.fill();
    gctx.fillStyle = '#632121';
    gctx.beginPath();
    gctx.arc(913, laneY, 62, 0, Math.PI * 2);
    gctx.fill();
    gctx.strokeStyle = '#e84118';
    gctx.lineWidth = 4;
    gctx.stroke();

    // Mid Center Hextech Arcane Dais (Center X: 512, Y: 512)
    gctx.strokeStyle = '#f1c40f';
    gctx.lineWidth = 3.5;
    gctx.beginPath();
    gctx.arc(512, laneY, 48, 0, Math.PI * 2);
    gctx.stroke();
    gctx.beginPath();
    gctx.arc(512, laneY, 24, 0, Math.PI * 2);
    gctx.stroke();

    const groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;

    // Ground Mesh (NPR Stylized Hand-Painted Toon Shading)
    const groundGeo = new THREE.PlaneGeometry(mapW, mapH);
    const groundMat = new THREE.MeshToonMaterial({
      map: groundTex,
      gradientMap: toonRamp,
      wireframe: false
    });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.set(mapW / 2, 0, mapH / 2);
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    // 2. 3D Translucent Emerald River Plane (NPR Stylized River)
    const riverGeo = new THREE.PlaneGeometry(240, mapH * 0.95);
    const riverMat = new THREE.MeshToonMaterial({
      color: 0x16a085,
      gradientMap: toonRamp,
      transparent: true,
      opacity: 0.84
    });
    this.riverMesh = new THREE.Mesh(riverGeo, riverMat);
    this.riverMesh.rotation.x = -Math.PI / 2;
    this.riverMesh.rotation.z = 0; // Vertical River aligned with world X=1200
    this.riverMesh.position.set(mapW / 2, 1.2, mapH / 2);
    this.scene.add(this.riverMesh);

    // 3. 3D Elevated Stone Walls & Obstacles (Will be populated via InstancedMesh)
    this.wallGroup = new THREE.Group();
    this.scene.add(this.wallGroup);

    // 4. Instanced 3D Pine Trees (Reduces 200+ Draw Calls down to only 2 Draw Calls!)
    const treePositions = [];
    // Border Trees (Outer Perimeter)
    for (let x = 80; x < mapW; x += 160) {
      treePositions.push({ x: x + (Math.sin(x) * 15), z: 45, scale: 1.1 });
      treePositions.push({ x: x + (Math.cos(x) * 15), z: mapH - 45, scale: 1.1 });
    }
    for (let z = 80; z < mapH; z += 160) {
      treePositions.push({ x: 45, z: z + (Math.sin(z) * 15), scale: 1.1 });
      treePositions.push({ x: mapW - 45, z: z + (Math.cos(z) * 15), scale: 1.1 });
    }
    // Jungle clusters
    const jungleSpots = [
      { x: 550, z: 380 }, { x: 620, z: 440 }, { x: 700, z: 320 },
      { x: 1750, z: 380 }, { x: 1820, z: 440 }, { x: 1900, z: 320 },
      { x: 550, z: 1220 }, { x: 620, z: 1160 }, { x: 700, z: 1280 },
      { x: 1750, z: 1220 }, { x: 1820, z: 1160 }, { x: 1900, z: 1280 }
    ];
    jungleSpots.forEach(s => treePositions.push({ x: s.x, z: s.z, scale: 0.95 + (s.x % 3) * 0.1 }));

    const totalTrees = treePositions.length;
    const trunkGeo = new THREE.CylinderGeometry(4, 6, 24, 8);
    const trunkMat = createChampionMaterial(0x4a3728, 0x000000, { rimStrength: 0.25 });
    const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, totalTrees);
    trunkInstanced.castShadow = true;
    trunkInstanced.receiveShadow = true;

    // Foliage (ConeGeometry unit size scaled via instance matrix, 3 tiers per tree)
    const folGeo = new THREE.ConeGeometry(1, 18, 8);
    const folMat = createChampionMaterial(0x225e34, 0x000000, { rimStrength: 0.4, rimColor: 0x88d49e });
    const foliageInstanced = new THREE.InstancedMesh(folGeo, folMat, totalTrees * 3);
    foliageInstanced.castShadow = true;
    foliageInstanced.receiveShadow = true;

    const dummy = this._dummyObj;
    treePositions.forEach((tp, i) => {
      // Trunk
      dummy.position.set(tp.x, 12 * tp.scale, tp.z);
      dummy.scale.set(tp.scale, tp.scale, tp.scale);
      dummy.rotation.set(0, (i * 0.45) % Math.PI, 0);
      dummy.updateMatrix();
      trunkInstanced.setMatrixAt(i, dummy.matrix);

      // 3 Foliage Tiers
      for (let tier = 0; tier < 3; tier++) {
        const rad = (18 - tier * 4) * tp.scale;
        dummy.position.set(tp.x, (20 + tier * 11) * tp.scale, tp.z);
        dummy.scale.set(rad, tp.scale, rad);
        dummy.rotation.set(0, (i * 0.7 + tier * 0.5) % Math.PI, 0);
        dummy.updateMatrix();
        foliageInstanced.setMatrixAt(i * 3 + tier, dummy.matrix);
      }
    });

    trunkInstanced.instanceMatrix.needsUpdate = true;
    foliageInstanced.instanceMatrix.needsUpdate = true;

    this.scene.add(trunkInstanced);
    this.scene.add(foliageInstanced);
  }

  update3DWalls(obstacles) {
    const THREE = window.THREE;
    if (!obstacles || !obstacles.length) return;
    if (this.wallsInitialized && this.lastObstaclesLength === obstacles.length) return;
    this.wallsInitialized = true;
    this.lastObstaclesLength = obstacles.length;

    // Clear previous walls if re-initializing
    if (this.wallGroup) {
      while (this.wallGroup.children.length > 0) {
        const obj = this.wallGroup.children[0];
        if (obj.geometry) obj.geometry.dispose();
        this.wallGroup.remove(obj);
      }
    }

    const wallMat = createChampionMaterial(0x3d494e, 0x000000, { rimStrength: 0.35, rimColor: 0x95a5a6 });
    const capMat = createChampionMaterial(0x5a6970, 0x000000, { rimStrength: 0.45, rimColor: 0xbdc3c7 });

    const h = 75;

    obstacles.forEach((obs) => {
      if (obs.type === 'box') {
        const bw = obs.width || 100;
        const bh = obs.height || 160;
        const boxGeo = new THREE.BoxGeometry(bw, h, bh);
        const boxMesh = new THREE.Mesh(boxGeo, wallMat);
        boxMesh.position.set(obs.x + bw / 2, h / 2, obs.y + bh / 2);
        boxMesh.castShadow = true;
        boxMesh.receiveShadow = true;
        this.wallGroup.add(boxMesh);

        const capGeo = new THREE.BoxGeometry(bw + 6, 8, bh + 6);
        const capMesh = new THREE.Mesh(capGeo, capMat);
        capMesh.position.set(obs.x + bw / 2, h + 4, obs.y + bh / 2);
        capMesh.castShadow = true;
        this.wallGroup.add(capMesh);
      } else {
        const r = obs.radius || 42;
        const pillarGeo = new THREE.CylinderGeometry(r * 0.95, r, h, 14);
        const pillar = new THREE.Mesh(pillarGeo, wallMat);
        pillar.position.set(obs.x, h / 2, obs.y);
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        this.wallGroup.add(pillar);

        const capGeo = new THREE.CylinderGeometry(r * 1.05, r, 8, 14);
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.set(obs.x, h + 4, obs.y);
        cap.castShadow = true;
        this.wallGroup.add(cap);
      }
    });
  }

  update3DBushes(bushes) {
    const THREE = window.THREE;
    if (!bushes || !bushes.length) return;
    if (this.bushesInitialized && this.lastBushesLength === bushes.length) return;
    this.bushesInitialized = true;
    this.lastBushesLength = bushes.length;

    if (this.bushInstanced) {
      this.scene.remove(this.bushInstanced);
      if (this.bushInstanced.geometry) this.bushInstanced.geometry.dispose();
      this.bushInstanced = null;
    }

    const bushMat = createChampionMaterial(0x27ae60, 0x000000, { rimStrength: 0.5, rimColor: 0x2ecc71 });

    const sphereGeo = new THREE.SphereGeometry(1, 8, 8);
    const totalSpheres = bushes.length * 5;
    const bushInstanced = new THREE.InstancedMesh(sphereGeo, bushMat, totalSpheres);

    const dummy = this._dummyObj;
    let sIdx = 0;
    bushes.forEach(b => {
      const baseR = b.radius * 0.45;
      for (let k = 0; k < 5; k++) {
        const offX = Math.cos(k * 1.25) * baseR;
        const offZ = Math.sin(k * 1.25) * baseR;
        dummy.position.set(b.x + offX, 10, b.y + offZ);
        dummy.scale.set(baseR * 1.1, baseR * 0.65, baseR * 1.1);
        dummy.rotation.set(0, k * 0.6, 0);
        dummy.updateMatrix();
        bushInstanced.setMatrixAt(sIdx++, dummy.matrix);
      }
    });

    bushInstanced.instanceMatrix.needsUpdate = true;
    this.bushInstanced = bushInstanced;
    this.scene.add(bushInstanced);
  }

  setupSummonersRiftTerrain(mapData) {
    const THREE = window.THREE;
    if (!THREE || !this.groundMesh) return;
    if (this.srTerrainInitialized) return;
    this.srTerrainInitialized = true;

    const mapW = mapData.width || 3200;
    const mapH = mapData.height || 3200;

    // 1. Resize Ground Mesh Geometry to 3200x3200
    if (this.groundMesh.geometry) this.groundMesh.geometry.dispose();
    this.groundMesh.geometry = new THREE.PlaneGeometry(mapW, mapH);
    this.groundMesh.position.set(mapW / 2, 0, mapH / 2);

    // 2. High-Resolution NPR Procedural Summoner's Rift Texture (2048x2048)
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 2048;
    groundCanvas.height = 2048;
    const gctx = groundCanvas.getContext('2d');

    // Rich Dark Turf Base
    gctx.fillStyle = '#14271c';
    gctx.fillRect(0, 0, 2048, 2048);

    // Stylized NPR Turf & Moss Flecks
    for (let i = 0; i < 7000; i++) {
      const nx = Math.random() * 2048;
      const ny = Math.random() * 2048;
      gctx.fillStyle = Math.random() > 0.5 ? 'rgba(28, 64, 42, 0.45)' : 'rgba(12, 28, 20, 0.35)';
      gctx.fillRect(nx, ny, 4, 4);
    }

    const toTexX = (wx) => (wx / mapW) * 2048;
    const toTexY = (wy) => (wy / mapH) * 2048;

    // Diagonal River Bed (Top-Left to Bottom-Right)
    gctx.save();
    gctx.strokeStyle = '#183c31';
    gctx.lineWidth = toTexX(280);
    gctx.lineCap = 'round';
    gctx.beginPath();
    gctx.moveTo(toTexX(500), toTexY(500));
    gctx.lineTo(toTexX(2700), toTexY(2700));
    gctx.stroke();

    // Inner River Water Bed
    gctx.strokeStyle = '#0e413a';
    gctx.lineWidth = toTexX(210);
    gctx.beginPath();
    gctx.moveTo(toTexX(550), toTexY(550));
    gctx.lineTo(toTexX(2650), toTexY(2650));
    gctx.stroke();
    gctx.restore();

    // Baron Pit Alcove at (950, 950)
    gctx.fillStyle = '#221433';
    gctx.beginPath();
    gctx.arc(toTexX(950), toTexY(950), toTexX(160), 0, Math.PI * 2);
    gctx.fill();

    // Dragon Pit Alcove at (2250, 2250)
    gctx.fillStyle = '#381710';
    gctx.beginPath();
    gctx.arc(toTexX(2250), toTexY(2250), toTexX(160), 0, Math.PI * 2);
    gctx.fill();

    // Lanes Path Drawer
    const drawLanePath = (points, outerW, innerW) => {
      // Outer Stone Curb
      gctx.strokeStyle = '#1e282c';
      gctx.lineWidth = outerW;
      gctx.lineCap = 'round';
      gctx.lineJoin = 'round';
      gctx.beginPath();
      points.forEach((pt, idx) => {
        const tx = toTexX(pt.x);
        const ty = toTexY(pt.y);
        if (idx === 0) gctx.moveTo(tx, ty);
        else gctx.lineTo(tx, ty);
      });
      gctx.stroke();

      // Cobblestone Highway
      gctx.strokeStyle = '#2d3b41';
      gctx.lineWidth = innerW;
      gctx.stroke();

      // Center Runic Highway Seam
      gctx.strokeStyle = 'rgba(200, 155, 60, 0.45)';
      gctx.lineWidth = 3.0;
      gctx.stroke();
    };

    const midRoute = [
      { x: 350, y: 2850 },
      { x: 850, y: 2350 },
      { x: 1350, y: 1850 },
      { x: 1600, y: 1600 },
      { x: 1850, y: 1350 },
      { x: 2350, y: 850 },
      { x: 2850, y: 350 }
    ];

    const topRoute = [
      { x: 350, y: 2850 },
      { x: 400, y: 2400 },
      { x: 500, y: 1200 },
      { x: 650, y: 650 },
      { x: 1200, y: 500 },
      { x: 2400, y: 400 },
      { x: 2850, y: 350 }
    ];

    const botRoute = [
      { x: 350, y: 2850 },
      { x: 800, y: 2800 },
      { x: 2000, y: 2700 },
      { x: 2550, y: 2550 },
      { x: 2700, y: 2000 },
      { x: 2800, y: 800 },
      { x: 2850, y: 350 }
    ];

    const laneOuterW = toTexX(160);
    const laneInnerW = toTexX(120);
    drawLanePath(topRoute, laneOuterW, laneInnerW);
    drawLanePath(botRoute, laneOuterW, laneInnerW);
    drawLanePath(midRoute, laneOuterW, laneInnerW);

    // Mid Hextech Arcane Center Dais at (1600, 1600)
    gctx.strokeStyle = '#f1c40f';
    gctx.lineWidth = 4;
    gctx.beginPath();
    gctx.arc(toTexX(1600), toTexY(1600), toTexX(60), 0, Math.PI * 2);
    gctx.stroke();
    gctx.beginPath();
    gctx.arc(toTexX(1600), toTexY(1600), toTexX(30), 0, Math.PI * 2);
    gctx.stroke();

    // Blue Base Platform Dais at (450, 2750)
    gctx.fillStyle = '#102538';
    gctx.beginPath();
    gctx.arc(toTexX(450), toTexY(2750), toTexX(280), 0, Math.PI * 2);
    gctx.fill();
    gctx.strokeStyle = '#00a8ff';
    gctx.lineWidth = 6;
    gctx.stroke();

    // Red Base Platform Dais at (2750, 450)
    gctx.fillStyle = '#381616';
    gctx.beginPath();
    gctx.arc(toTexX(2750), toTexY(450), toTexX(280), 0, Math.PI * 2);
    gctx.fill();
    gctx.strokeStyle = '#e84118';
    gctx.lineWidth = 6;
    gctx.stroke();

    // Turret Stone Foundation Pads
    const turretCoords = [
      { x: 500, y: 1200, team: 'blue' }, { x: 400, y: 1850, team: 'blue' }, { x: 400, y: 2350, team: 'blue' },
      { x: 1350, y: 1850, team: 'blue' }, { x: 1100, y: 2100, team: 'blue' }, { x: 850, y: 2350, team: 'blue' },
      { x: 1850, y: 2700, team: 'blue' }, { x: 1350, y: 2800, team: 'blue' }, { x: 850, y: 2800, team: 'blue' },
      { x: 580, y: 2660, team: 'blue' }, { x: 620, y: 2620, team: 'blue' },
      { x: 1200, y: 500, team: 'red' }, { x: 1850, y: 400, team: 'red' }, { x: 2350, y: 400, team: 'red' },
      { x: 1850, y: 1350, team: 'red' }, { x: 2100, y: 1100, team: 'red' }, { x: 2350, y: 850, team: 'red' },
      { x: 2700, y: 2000, team: 'red' }, { x: 2800, y: 1350, team: 'red' }, { x: 2800, y: 850, team: 'red' },
      { x: 2580, y: 580, team: 'red' }, { x: 2620, y: 540, team: 'red' }
    ];
    turretCoords.forEach(tc => {
      gctx.fillStyle = '#1c2529';
      gctx.beginPath();
      gctx.arc(toTexX(tc.x), toTexY(tc.y), toTexX(48), 0, Math.PI * 2);
      gctx.fill();
      gctx.strokeStyle = tc.team === 'blue' ? '#0984e3' : '#d63031';
      gctx.lineWidth = 3;
      gctx.stroke();
    });

    const groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    if (this.groundMesh.material.map) this.groundMesh.material.map.dispose();
    this.groundMesh.material.map = groundTex;
    this.groundMesh.material.needsUpdate = true;

    // 3. Update 3D Translucent River Mesh to Diagonal
    if (this.riverMesh) {
      if (this.riverMesh.geometry) this.riverMesh.geometry.dispose();
      this.riverMesh.geometry = new THREE.PlaneGeometry(320, 3100);
      this.riverMesh.position.set(mapW / 2, 1.2, mapH / 2);
      this.riverMesh.rotation.x = -Math.PI / 2;
      this.riverMesh.rotation.z = Math.PI / 4; // Diagonal River crossing
    }
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
    if (this.composer) {
      this.composer.setSize(this.width, this.height);
    }
    if (this.bloomPass && this.bloomPass.resolution) {
      this.bloomPass.resolution.set(this.width, this.height);
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
      if (mapData.isSummonersRift) {
        this.setupSummonersRiftTerrain(mapData);
      }
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

    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this._cachedHitPoint);
    if (hit) {
      return { x: hit.x, y: hit.z };
    }
    return this.cameraCtrl.screenToWorld(screenX, screenY);
  }

  worldToScreen(worldX, worldZ) {
    const THREE = window.THREE;
    if (!this.camera3D || !THREE) {
      return this.cameraCtrl.worldToScreen(worldX, worldZ);
    }

    this._cachedWorldPos.set(worldX, 0, worldZ);
    this._cachedWorldPos.project(this.camera3D);

    return {
      x: (this._cachedWorldPos.x * 0.5 + 0.5) * this.width,
      y: (-(this._cachedWorldPos.y * 0.5) + 0.5) * this.height
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
      scale: isGold ? 1.6 : (isCrit ? 1.85 : 1.4), // 1.4x scale pop (Crit 1.85x)
      vx: (Math.random() - 0.5) * 2.4, // Lateral random scatter
      vy: isGold ? -3.8 : (isCrit ? -4.5 : -3.2), // Initial upward impulse
      gravity: 0.18 // Gravity acceleration for authentic arc bounce
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
      } else if (key === 'E') {
        this.addSlashTrail(p.x, p.y, ang, 120, '#00ffff');
      } else if (key === 'R') {
        this.addShockwave(targetX, targetY, 180, '#00cec9');
        if (p.id === this.localPlayerId) this.cameraCtrl.addScreenShake(2.0, 0.15);
      }
    } else if (champId === 'sniper') {
      if (key === 'Q' || key === 'R') {
        if (key === 'R' && p.id === this.localPlayerId) this.cameraCtrl.addScreenShake(2.0, 0.15);
        this.addShockwave(targetX, targetY, key === 'R' ? 90 : 50, '#ff4757');
      } else if (key === 'W') {
        this.addShockwave(targetX, targetY, 60, '#00d2d3');
      }
    } else if (champId === 'pyromancer') {
      if (key === 'Q') {
        this.addShockwave(p.x, p.y, 45, '#ff7675');
      } else if (key === 'W' || key === 'R') {
        this.addShockwave(targetX, targetY, key === 'R' ? 240 : 140, '#ff7675');
        if (key === 'R' && p.id === this.localPlayerId) this.cameraCtrl.addScreenShake(2.0, 0.15);
      }
    } else if (champId === 'shadow_assassin') {
      if (key === 'Q' || key === 'E') {
        this.addSlashTrail(p.x, p.y, ang, 90, '#8e44ad');
        this.addShockwave(targetX, targetY, 70, '#9b59b6');
      } else if (key === 'R') {
        this.addShockwave(targetX, targetY, 130, '#8e44ad');
        if (p.id === this.localPlayerId) this.cameraCtrl.addScreenShake(2.0, 0.15);
      }
    } else if (champId === 'guardian') {
      if (key === 'Q' || key === 'E') {
        this.addShockwave(p.x, p.y, 110, '#f1c40f');
      } else if (key === 'R') {
        this.addShockwave(targetX, targetY, 210, '#f39c12');
        if (p.id === this.localPlayerId) this.cameraCtrl.addScreenShake(2.0, 0.15);
      }
    } else if (champId === 'frost_mage') {
      if (key === 'Q') {
        this.addShockwave(p.x, p.y, 45, '#00d2d3');
      } else if (key === 'W' || key === 'R') {
        this.addShockwave(targetX, targetY, key === 'R' ? 200 : 120, '#70a1ff');
        if (key === 'R' && p.id === this.localPlayerId) this.cameraCtrl.addScreenShake(2.0, 0.15);
      }
    } else if (champId === 'berserker') {
      if (key === 'Q' || key === 'E') {
        this.addSlashTrail(p.x, p.y, ang, 100, '#e74c3c');
        this.addShockwave(targetX, targetY, 80, '#c0392b');
      } else if (key === 'R') {
        this.addShockwave(p.x, p.y, 160, '#e74c3c');
        if (p.id === this.localPlayerId) this.cameraCtrl.addScreenShake(2.0, 0.15);
      }
    } else if (champId === 'shadow_hunter') {
      if (key === 'Q' || key === 'E') {
        this.addShockwave(targetX, targetY, 55, '#bdc3c7');
      } else if (key === 'R') {
        this.addShockwave(p.x, p.y, 140, '#2c3e50');
      }
    } else if (champId === 'brawler') {
      if (key === 'Q' || key === 'W') {
        this.addShockwave(targetX, targetY, 95, '#f39c12');
      } else if (key === 'R') {
        this.addShockwave(targetX, targetY, 190, '#d35400');
        if (p.id === this.localPlayerId) this.cameraCtrl.addScreenShake(2.0, 0.15);
      }
    } else if (champId === 'demolitionist') {
      if (key === 'Q' || key === 'W' || key === 'E') {
        this.addShockwave(targetX, targetY, 85, '#ff4757');
      } else if (key === 'R') {
        this.addShockwave(targetX, targetY, 260, '#ff4757');
        if (p.id === this.localPlayerId) this.cameraCtrl.addScreenShake(2.5, 0.2);
      }
    }
  }

  processEvents(events) {
    if (!events || !events.length) return;
    for (const ev of events) {
      if (ev.type === 'damage') {
        const color = ev.isCrit ? '#f1c40f' : '#ffffff';
        const txt = ev.isCrit ? `⚡ CRIT! ${ev.amount}` : `${ev.amount}`;

        // 4. Floating Damage Text (1.4x / 1.85x Damage Bounce)
        this.addFloatingText(ev.x, ev.y, txt, color, ev.isCrit ? 26 : 17, ev.isCrit);

        // 1. Hit-Stop / Frame Freeze (30~50ms, 80ms on Crit)
        const hitStopDuration = ev.isCrit ? 0.08 : 0.045;
        this.hitFreezeTimer = Math.max(this.hitFreezeTimer, hitStopDuration);
        if (this.gameFeelController) {
          this.gameFeelController.triggerHitStop(hitStopDuration);
        }

        // 2. Damage Flash (Pure White 0xffffff, Intensity 2.5, 0.08s Exponential Decay)
        const targetMesh = this.threePlayerMeshes[ev.targetId] || (this.threeMinionMeshes ? this.threeMinionMeshes[ev.targetId] : null) || (this.threeStructureMeshes ? this.threeStructureMeshes[ev.targetId] : null);
        if (targetMesh && this.gameFeelController) {
          this.gameFeelController.triggerDamageFlash(targetMesh, 0.08);
        }

        // 3. Trauma-Based Screen Shake (LoL Competitive Standard)
        // Basic attacks, minion hits, and normal skillshots NEVER shake the screen!
        const isLocalPlayerInvolved = (ev.sourceId === this.localPlayerId || ev.targetId === this.localPlayerId);
        if (ev.isCrit && isLocalPlayerInvolved) {
          if (this.gameFeelController) {
            this.gameFeelController.addTrauma(0.12);
          } else {
            this.cameraCtrl.addScreenShake(1.5, 0.12);
          }
        }

        if (ev.isCrit) {
          this.addShockwave(ev.x, ev.y, 80, '#f1c40f');
        }
        if (window.soundEngine) window.soundEngine.playHitImpact(ev.isCrit);

        if (ev.targetId && this.champAnimStates[ev.targetId]) {
          this.champAnimStates[ev.targetId].hitFlashTimer = 0.18;
        }
      } else if (ev.type === 'gold') {
        this.addFloatingText(ev.x, ev.y, `+${ev.amount} 💰`, '#f1c40f', 19, false);
        if (window.soundEngine && ev.targetId === this.localPlayerId) {
          window.soundEngine.playGoldChime();
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
        // High Impact Kill Freeze & Screen Trauma (Subtle feedback for involved player)
        const isLocalKill = (ev.killerId === this.localPlayerId || ev.victimId === this.localPlayerId);
        this.hitFreezeTimer = Math.max(this.hitFreezeTimer, isLocalKill ? 0.045 : 0.02);
        if (isLocalKill) {
          if (this.gameFeelController) {
            this.gameFeelController.triggerHitStop(0.045);
            this.gameFeelController.addTrauma(0.18);
          } else {
            this.cameraCtrl.addScreenShake(2.0, 0.15);
          }
        }
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
    if (this.hitFreezeTimer > 0) {
      this.hitFreezeTimer -= dt;
      // Hit-Stop freezes animation timer for tangible impact weight
    } else {
      this.animationTimer += dt;
    }

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

    const baseX = camTargetX;
    const baseY = camHeight;
    const baseZ = camTargetZ + camZOffset;

    if (this.gameFeelController) {
      this.gameFeelController.setBaseCameraPos(baseX, baseY, baseZ);
      this.camera3D.position.set(baseX, baseY, baseZ);
      this.gameFeelController.update(dt);
    } else {
      this.camera3D.position.set(
        baseX + this.cameraCtrl.shakeOffsetX,
        baseY,
        baseZ + this.cameraCtrl.shakeOffsetY
      );
    }
    this.camera3D.lookAt(camTargetX, 0, camTargetZ);

    // Throttle sunlight position updates to avoid re-rendering entire shadow map every single frame
    if (!this.lastSunCamX || Math.hypot(camTargetX - this.lastSunCamX, camTargetZ - this.lastSunCamZ) > 180) {
      this.lastSunCamX = camTargetX;
      this.lastSunCamZ = camTargetZ;
      this.sunLight.position.set(camTargetX + 300, 1000, camTargetZ + 400);
      this.sunLight.target.position.set(camTargetX, 0, camTargetZ);
      this.sunLight.target.updateMatrixWorld();
    }

    // 3. Update 3D Champion Hierarchical Models
    this.update3DChampions(gameState.players);

    // 4. Update 3D Structures (Turrets & Nexus)
    this.update3DStructures(gameState.structures, gameState);

    // 5. Update 3D Minions (Melee, Caster, Cannon Waves)
    this.update3DMinions(gameState.minions);

    // 6. Update 3D Projectiles
    this.update3DProjectiles(gameState.projectiles);

    // 7. Update 3D AoE Zones
    this.update3DAoeZones(gameState.aoeZones);

    // 7.5 Update 3D Jungle Monsters (Scuttle Crab, Elemental Dragon)
    this.update3DJungleMonsters(gameState.jungleMonsters);

    // 7.6 Update 3D Vision Wards
    this.update3DWards(gameState.wards);

    // 8. Render 3D WebGL Scene (with Stylized Post-Processing)
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer3D.render(this.scene, this.camera3D);
    }

    // 7. Render 2D Overlay Canvas (100-HP Vitals, Minimap, Floaters)
    this.render2DOverlays(gameState, localPlayer, mouseScreenPos);
  }

  // ==========================================================
  // PROCEDURAL FACE TEXTURE GENERATOR (256x256 High-Resolution LoL Aesthetics)
  // ==========================================================
  getFaceTexture(champId, THREE) {
    if (this.faceTextureCache[champId]) {
      return this.faceTextureCache[champId];
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    let skinTone = '#fce4c8';
    if (champId === 'frost_mage') skinTone = '#f1f6fd';
    if (champId === 'pyromancer') skinTone = '#ffd8b3';
    if (champId === 'berserker' || champId === 'brawler') skinTone = '#eab98d';
    if (champId === 'shadow_assassin') skinTone = '#d1ccc0';

    ctx.fillStyle = skinTone;
    ctx.fillRect(0, 0, 256, 256);

    // Smooth volumetric skin gradient & cheek blush
    const grad = ctx.createRadialGradient(128, 128, 36, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255, 120, 120, 0.18)');
    grad.addColorStop(0.7, 'rgba(200, 100, 80, 0.08)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.12)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    const isFemale = champId === 'sniper' || champId === 'frost_mage' || champId === 'shadow_hunter';
    let eyeColor = '#2980b9';
    if (champId === 'blademaster') eyeColor = '#34495e';
    if (champId === 'sniper') eyeColor = '#27ae60';
    if (champId === 'pyromancer') eyeColor = '#e67e22';
    if (champId === 'shadow_assassin') eyeColor = '#9b59b6';
    if (champId === 'frost_mage') eyeColor = '#00d2d3';
    if (champId === 'berserker') eyeColor = '#2980b9';
    if (champId === 'shadow_hunter') eyeColor = '#c0392b';
    if (champId === 'brawler') eyeColor = '#d35400';
    if (champId === 'demolitionist') eyeColor = '#f39c12';

    // Stylized Anime / LoL Sharp Eyes
    const drawEye = (x, y, flip) => {
      ctx.save();
      ctx.translate(x, y);
      if (flip) ctx.scale(-1, 1);

      // Upper lash line
      ctx.strokeStyle = '#1e272e';
      ctx.lineWidth = isFemale ? 8 : 6;
      ctx.beginPath();
      ctx.arc(0, 0, 32, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      // Sclera
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 4, 24, 20, 0, 0, Math.PI * 2);
      ctx.fill();

      // Iris gradient
      const irisGrad = ctx.createRadialGradient(0, 4, 2, 0, 4, 16);
      irisGrad.addColorStop(0, '#ffffff');
      irisGrad.addColorStop(0.4, eyeColor);
      irisGrad.addColorStop(1, '#0c2461');
      ctx.fillStyle = irisGrad;
      ctx.beginPath();
      ctx.arc(0, 4, 16, 0, Math.PI * 2);
      ctx.fill();

      // Pupil
      ctx.fillStyle = '#0a0e17';
      ctx.beginPath();
      ctx.arc(0, 4, 9, 0, Math.PI * 2);
      ctx.fill();

      // Dual anime specular glints
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-5, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(5, 8, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Eyebrow
      ctx.strokeStyle = '#2f3542';
      ctx.lineWidth = isFemale ? 5 : 7;
      ctx.beginPath();
      ctx.moveTo(-26, -24);
      ctx.quadraticCurveTo(0, -32, 26, -22);
      ctx.stroke();

      ctx.restore();
    };

    drawEye(80, 104, false);
    drawEye(176, 104, true);

    // Subtle nose shadow
    ctx.strokeStyle = 'rgba(140, 80, 50, 0.45)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(128, 136);
    ctx.lineTo(132, 152);
    ctx.lineTo(122, 156);
    ctx.stroke();

    // Stylized Mouth / Lips
    if (isFemale) {
      ctx.fillStyle = champId === 'frost_mage' ? '#ff9ff3' : '#e74c3c';
      ctx.beginPath();
      ctx.ellipse(128, 184, 18, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#57606f';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(128, 176, 22, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    // Unique Character Details
    if (champId === 'shadow_assassin') {
      ctx.fillStyle = '#1e272e';
      ctx.beginPath();
      ctx.moveTo(44, 140);
      ctx.lineTo(212, 140);
      ctx.lineTo(190, 250);
      ctx.lineTo(66, 250);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#8e44ad';
      ctx.lineWidth = 4;
      ctx.stroke();
    } else if (champId === 'berserker') {
      ctx.strokeStyle = '#2980b9';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(48, 140);
      ctx.lineTo(92, 156);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(208, 140);
      ctx.lineTo(164, 156);
      ctx.stroke();
    } else if (champId === 'pyromancer') {
      ctx.fillStyle = '#e67e22';
      ctx.beginPath();
      ctx.arc(128, 50, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.arc(128, 50, 6, 0, Math.PI * 2);
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

    // Prominent golden hero ring with rotating runes for local player
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
      const isHitFrozen = this.hitFreezeTimer > 0;
      if (isMoving && !isHitFrozen) anim.walkCycle += 0.28;
      if (anim.attackSwingTimer > 0 && !isHitFrozen) anim.attackSwingTimer -= 0.0166;

      let group = this.threePlayerMeshes[p.id];
      if (!group) {
        group = this.create3DChampionModel(p);
        this.threePlayerMeshes[p.id] = group;
        this.scene.add(group);

        // Bind GameFeelController to Local Player Mesh
        if (p.id === this.localPlayerId && !this.gameFeelController) {
          group.position.set(p.x, 0, p.y);
          const Controller = window.GameFeelController || GameFeelController;
          if (Controller) {
            this.gameFeelController = new Controller(this.camera3D, group, {
              moveSpeed: p.moveSpeed || 340.0,
              turnRate: Math.PI * 4.0,
              maxShakeOffset: 14.0
            });
            this.gameFeelController.initPosition(p.x, p.y);
          }
        }
      }

      // Brush Stealth & Vision Culling
      const localPlayer = players.find(lp => lp.id === this.localPlayerId);
      const isAlly = localPlayer ? (p.team === localPlayer.team) : (p.id === this.localPlayerId);

      let isStealthedEnemy = false;
      if (!isAlly && p.inBush && !p.revealed) {
        let canSeeInBush = false;
        if (localPlayer && this.mapData.bushes) {
          for (let bIdx = 0; bIdx < this.mapData.bushes.length; bIdx++) {
            const b = this.mapData.bushes[bIdx];
            if (Math.hypot(localPlayer.x - b.x, localPlayer.y - b.y) <= b.radius &&
                Math.hypot(p.x - b.x, p.y - b.y) <= b.radius) {
              canSeeInBush = true;
              break;
            }
          }
        }
        if (!canSeeInBush && this.gameState?.wards) {
          for (let wIdx = 0; wIdx < this.gameState.wards.length; wIdx++) {
            const w = this.gameState.wards[wIdx];
            if (w.team === (localPlayer?.team || 'blue')) {
              if (Math.hypot(p.x - w.x, p.y - w.y) <= (w.radius || 300)) {
                canSeeInBush = true;
                break;
              }
            }
          }
        }
        if (!canSeeInBush) {
          isStealthedEnemy = true;
        }
      }

      if (isStealthedEnemy) {
        group.visible = false;
        return;
      }

      group.visible = p.isAlive;
      if (!p.isAlive) return;

      // Subtle camouflage transparency for ally or local player concealed in bush
      const isConcealed = p.inBush && !p.revealed;
      if (group.userData.isConcealed !== isConcealed) {
        group.userData.isConcealed = isConcealed;
        group.traverse(child => {
          if (child.isMesh && child.material) {
            child.material.transparent = isConcealed;
            child.material.opacity = isConcealed ? 0.6 : 1.0;
          }
        });
      }

      const isPlayerMoving = (p.id === this.localPlayerId && this.gameFeelController) ? this.gameFeelController.isMoving : isMoving;

      if (p.id === this.localPlayerId && this.gameFeelController) {
        // Local champion position and slerp turn rate are handled directly by GameFeelController
        anim.walkCycle = this.gameFeelController.walkCycle;
      } else {
        // Smooth Lerp Interpolation for 60~144 FPS fluid movement (Remote champions)
        const walkBob = isMoving ? Math.sin(anim.walkCycle) * 2.5 : 0;
        this._cachedTargetVec.set(p.x, walkBob, p.y);
        if (group.position.lengthSq() === 0) {
          group.position.copy(this._cachedTargetVec);
        } else {
          group.position.lerp(this._cachedTargetVec, 0.65);
        }

        // Smooth Quaternion Rotation with Turn Rate Slerp (720 deg/s / No snap)
        const targetRotY = -p.angle + Math.PI / 2;
        _v1.set(0, 1, 0);
        _q1.setFromAxisAngle(_v1, targetRotY);
        const turnStep = (Math.PI * 4.0) * 0.0166; // 720 deg/sec
        group.quaternion.rotateTowards(_q1, turnStep);
      }

      // Biped Gaits: Legs & Arms Swing
      if (group.userData.leftLeg && group.userData.rightLeg) {
        const step = isPlayerMoving ? Math.sin(anim.walkCycle) * 0.45 : 0;
        group.userData.leftLeg.rotation.x = step;
        group.userData.rightLeg.rotation.x = -step;
      }
      if (group.userData.leftArm && group.userData.rightArm) {
        const armSwing = isPlayerMoving ? Math.sin(anim.walkCycle) * 0.45 : 0;
        group.userData.leftArm.rotation.x = -armSwing;
        group.userData.rightArm.rotation.x = armSwing;
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

      // Attack Swing / Recoil Animation on Weapon & Arm
      if (anim.attackSwingTimer > 0) {
        const swing = Math.sin(anim.attackSwingTimer * 16) * 1.35;
        if (group.userData.rightArm) group.userData.rightArm.rotation.x = -swing;
        if (group.userData.weapon) group.userData.weapon.rotation.x = -swing;
        if (group.userData.leftArm && group.userData.leftWeapon) {
          group.userData.leftArm.rotation.x = swing;
          group.userData.leftWeapon.rotation.x = swing;
        }
      } else {
        if (group.userData.weapon) group.userData.weapon.rotation.x = 0;
        if (group.userData.leftWeapon) group.userData.leftWeapon.rotation.x = 0;
      }

      // Hit Flash Red / White
      if (anim.hitFlashTimer > 0) {
        anim.hitFlashTimer -= 0.0166;
        if (group.userData.torsoMat) group.userData.torsoMat.emissive.setHex(0xff3333);
      } else {
        if (group.userData.torsoMat) group.userData.torsoMat.emissive.setHex(group.userData.baseEmissiveHex || 0x000000);
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
    const teamEmissiveHex = isBlue ? 0x073b64 : 0x640707;
    const cid = p.championId;

    // Ground LoL Team Pedestal Ring
    const groundRing = this.createGroundTeamRing(isBlue, isLocal, THREE);
    group.add(groundRing);
    group.userData.groundRing = groundRing;

    // NPR 3-Step Toon Materials with Rim Light (MeshToonMaterial)
    const getToonMat = (colorHex, emissiveHex = 0x000000, opts = {}) => {
      const fn = (typeof createChampionMaterial === 'function' ? createChampionMaterial : null) || window.createChampionMaterial;
      if (fn) {
        return fn(colorHex, emissiveHex, opts);
      }
      return new THREE.MeshToonMaterial({ color: colorHex, emissive: emissiveHex, ...opts });
    };

    const darkMat = getToonMat(0x181e24);
    const goldMat = getToonMat(0xf1c40f, 0x3d2c00);
    const silverMat = getToonMat(0xdcdde1, 0x111116);
    const leatherMat = getToonMat(0x3d271d);
    const armorMat = getToonMat(teamHex, teamEmissiveHex, { emissiveIntensity: 0.35 });
    const skinMat = getToonMat(0xfce4c8, 0x000000, { map: this.getFaceTexture(p.championId, THREE) });

    group.userData.torsoMat = armorMat;
    group.userData.baseEmissiveHex = teamEmissiveHex;

    // 1. Pelvis / Hips & War Belt Foundation
    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 7.5, 7, 8), darkMat);
    pelvis.position.set(0, 19, 0);
    group.add(pelvis);

    const warBelt = new THREE.Mesh(new THREE.CylinderGeometry(8.9, 8.9, 3, 12), leatherMat);
    warBelt.position.set(0, 20.5, 0);
    group.add(warBelt);

    const buckle = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3.8, 1.5), goldMat);
    buckle.position.set(0, 20.5, 8.8);
    group.add(buckle);

    // 2. Anatomical Legs (Thighs + Articulated Knee Guards + Greaves + Layered Boots)
    const legClothMat = (cid === 'sniper' || cid === 'frost_mage')
      ? getToonMat(0x1f2c39, 0x000000, { rimStrength: 0.35 })
      : darkMat;

    const createAnatomicalLeg = (isLeft) => {
      const legGroup = new THREE.Group();
      const posX = isLeft ? -5.8 : 5.8;

      // Thigh
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 2.9, 12, 8), legClothMat);
      thigh.position.y = 13.5;
      thigh.castShadow = true;
      legGroup.add(thigh);

      // Knee Guard (Poleyn)
      const knee = new THREE.Mesh(new THREE.BoxGeometry(4.8, 4.2, 4.8), (cid === 'guardian' || cid === 'blademaster') ? goldMat : armorMat);
      knee.position.set(0, 7.5, 1.2);
      knee.rotation.x = 0.2;
      knee.castShadow = true;
      legGroup.add(knee);

      // Calf & Armored Greave
      const calf = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.4, 11, 8), legClothMat);
      calf.position.y = 3;
      calf.castShadow = true;
      legGroup.add(calf);

      // Greave Front Shin Plate
      const shinPlate = new THREE.Mesh(new THREE.BoxGeometry(3.2, 8, 1.2), armorMat);
      shinPlate.position.set(0, 3.5, 2.2);
      legGroup.add(shinPlate);

      // Combat Boot: Sole + Instep + Ankle Cuff
      const bootSole = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.2, 8), darkMat);
      bootSole.position.set(0, -2.5, 1.8);
      bootSole.castShadow = true;
      legGroup.add(bootSole);

      const bootToe = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3.4, 5.5), armorMat);
      bootToe.position.set(0, -1.2, 2.8);
      bootToe.castShadow = true;
      legGroup.add(bootToe);

      legGroup.position.set(posX, 3.5, 0);
      return legGroup;
    };

    const leftLeg = createAnatomicalLeg(true);
    const rightLeg = createAnatomicalLeg(false);
    group.add(leftLeg);
    group.add(rightLeg);
    group.userData.leftLeg = leftLeg;
    group.userData.rightLeg = rightLeg;

    // 3. Anatomical Torso & Ribcage Base
    const torsoBase = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 8.2, 16, 8), darkMat);
    torsoBase.position.set(0, 28, 0);
    torsoBase.castShadow = true;
    group.add(torsoBase);

    // Sculpted Breastplate / Cuirass Front Shield
    const breastPlate = new THREE.Mesh(new THREE.BoxGeometry(15, 12, 5), armorMat);
    breastPlate.position.set(0, 30, 4);
    breastPlate.castShadow = true;
    group.add(breastPlate);

    const chestEmblem = new THREE.Mesh(new THREE.OctahedronGeometry(2.2), goldMat);
    chestEmblem.position.set(0, 32, 6.8);
    group.add(chestEmblem);

    // 4. Neck Joint
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 4.5, 8), skinMat);
    neck.position.set(0, 37.5, 0.5);
    group.add(neck);

    // 5. Head, Jawline & High-Res Face
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 42.5, 0.5);

    // Cranium
    const skull = new THREE.Mesh(new THREE.SphereGeometry(7.8, 16, 16), skinMat);
    skull.position.y = 1.5;
    skull.castShadow = true;
    headGroup.add(skull);

    // Jaw & Chin
    const jaw = new THREE.Mesh(new THREE.ConeGeometry(4.5, 5, 5), skinMat);
    jaw.position.set(0, -3.2, 2.5);
    jaw.rotation.x = -Math.PI;
    headGroup.add(jaw);

    // Precision Curved Face Plane (Removes sphere distortion, shows 256x256 facial expression)
    const facePlaneGeo = new THREE.PlaneGeometry(10.5, 10.5);
    const facePlaneMat = new THREE.MeshBasicMaterial({
      map: this.getFaceTexture(p.championId, THREE),
      transparent: true,
      side: THREE.DoubleSide
    });
    const facePlane = new THREE.Mesh(facePlaneGeo, facePlaneMat);
    facePlane.position.set(0, 1.2, 7.2);
    headGroup.add(facePlane);

    group.add(headGroup);
    group.userData.headGroup = headGroup;

    // 6. Articulated Biped Arms with Upper-Arm, Forearm Bracers & 3D Hands
    const armMat = (cid === 'berserker' || cid === 'brawler') ? skinMat : armorMat;

    const createArticulatedArm = (isLeft) => {
      const armGroup = new THREE.Group();
      const posX = isLeft ? -11.5 : 11.5;

      // Shoulder Joint Sphere
      const shoulderBall = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 8), goldMat);
      armGroup.add(shoulderBall);

      // Upper Arm (Bicep)
      const bicep = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.3, 10, 8), armMat);
      bicep.position.y = -6;
      bicep.castShadow = true;
      armGroup.add(bicep);

      // Elbow Couter Guard
      const elbow = new THREE.Mesh(new THREE.BoxGeometry(3.8, 3.2, 3.8), goldMat);
      elbow.position.set(0, -11, -0.6);
      armGroup.add(elbow);

      // Forearm Bracer / Vambrace
      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.1, 9, 8), armorMat);
      forearm.position.y = -15;
      forearm.castShadow = true;
      armGroup.add(forearm);

      // Articulated 3D Hand with Knuckles & Thumb
      const handGroup = new THREE.Group();
      handGroup.position.set(0, -20.5, 0);

      const palm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.5, 2.2), skinMat);
      handGroup.add(palm);

      const knuckles = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 2.4), (cid === 'brawler') ? goldMat : skinMat);
      knuckles.position.set(0, -1.8, 0.2);
      handGroup.add(knuckles);

      const thumb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 1.4), skinMat);
      thumb.position.set(isLeft ? 1.6 : -1.6, 0.4, 0.8);
      handGroup.add(thumb);

      armGroup.add(handGroup);
      armGroup.position.set(posX, 34, 0);
      return armGroup;
    };

    const leftArm = createArticulatedArm(true);
    const rightArm = createArticulatedArm(false);
    group.add(leftArm);
    group.add(rightArm);
    group.userData.leftArm = leftArm;
    group.userData.rightArm = rightArm;

    // 7. Delegate to Champion Specialists
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
    } else {
      this.buildDemolitionistModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE);
    }

    // Apply Inverted Hull Stylized NPR Cartoon Outlines
    this.applyInvertedHullOutline(group, THREE);

    return group;
  }

  applyInvertedHullOutline(group, THREE) {
    if (!group) return;
    const createOutline = (typeof createOutlineMesh === 'function' ? createOutlineMesh : null) || window.createOutlineMesh;
    if (!createOutline) return;

    const meshesToOutline = [];
    group.traverse((child) => {
      // Outline character silhouette parts (avoid ground ring, lights, and existing outlines)
      if (
        child.isMesh &&
        child.geometry &&
        !child.userData.isOutline &&
        child.parent !== group.userData.groundRing &&
        child !== group.userData.groundRing &&
        child !== group.userData.laser &&
        child !== group.userData.rangeMesh &&
        child.geometry.type !== 'RingGeometry'
      ) {
        meshesToOutline.push(child);
      }
    });

    meshesToOutline.forEach((mesh) => {
      const outline = createOutline(mesh, 0x111116, 0.042);
      if (outline) {
        outline.userData.isOutline = true;
        mesh.add(outline);
      }
    });
  }

  // ==========================================================
  // 1. 검객 (Blademaster) - Master of Wind & Blades (Yasuo-class Fidelity)
  // ==========================================================
  buildBlademasterModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = createChampionMaterial(0x111625, 0x000000, { rimStrength: 0.4, rimColor: 0x4a69bd });
    const cyanGlow = createChampionMaterial(0x00ffff, 0x00d2d3, {
      emissiveIntensity: 1.5,
      rimStrength: 0.85,
      rimColor: 0x00ffff
    });
    const whiteMat = createChampionMaterial(0xffffff, 0x000000, { rimStrength: 0.4 });

    // 1. Volumetric 3D Samurai Hair & Forehead Bangs
    const headG = group.userData.headGroup;
    if (headG) {
      // Wind-swept Front Bangs
      for (let i = -2; i <= 2; i++) {
        const bang = new THREE.Mesh(new THREE.ConeGeometry(1.6, 7.5, 4), hairMat);
        bang.position.set(i * 2.2, 5.2, 5.8 - Math.abs(i) * 0.5);
        bang.rotation.set(-0.6, 0, i * 0.25);
        headG.add(bang);
      }
      // Top Volume
      const topHair = new THREE.Mesh(new THREE.SphereGeometry(7.2, 8, 8), hairMat);
      topHair.position.set(0, 4.5, -1.2);
      headG.add(topHair);

      // High Samurai Ponytail (2-Tier Angled Backwards)
      const ponyBase = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.0, 16, 8), hairMat);
      ponyBase.position.set(0, 8, -8);
      ponyBase.rotation.x = -0.85;
      headG.add(ponyBase);

      const ponyTip = new THREE.Mesh(new THREE.ConeGeometry(2.4, 18, 6), hairMat);
      ponyTip.position.set(0, 14, -18);
      ponyTip.rotation.x = -1.1;
      headG.add(ponyTip);

      // White Headband & Flowing Ribbon Tails
      const band = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.2, 2.2, 16), whiteMat);
      band.position.set(0, 4.5, 0);
      headG.add(band);

      const ribbon = new THREE.Mesh(new THREE.BoxGeometry(2.4, 16, 0.6), whiteMat);
      ribbon.position.set(0, 3, -9.5);
      ribbon.rotation.x = 0.52;
      headG.add(ribbon);
      group.userData.cape = ribbon;
    }

    // 2. 3-Tier Layered Left Sode Pauldron (Samurai Shoulder Shield)
    const pldGroup = new THREE.Group();
    for (let t = 0; t < 3; t++) {
      const pldPlate = new THREE.Mesh(new THREE.BoxGeometry(9 + t * 1.5, 3.5, 13 + t * 1.2), (t === 0) ? goldMat : armorMat);
      pldPlate.position.set(0, -t * 3.2, 0);
      pldPlate.rotation.z = -0.15;
      pldPlate.castShadow = true;
      pldGroup.add(pldPlate);
    }
    pldGroup.position.set(-13.5, 37, 0);
    group.add(pldGroup);

    // 3. Hakama Robe Pleats & Hip Armor Flaps (Front, Back, Sides)
    const hakamaMat = armorMat;
    const createFlap = (w, h, x, y, z, rx, rz) => {
      const fl = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.2), hakamaMat);
      fl.position.set(x, y, z);
      fl.rotation.set(rx, 0, rz);
      fl.castShadow = true;
      group.add(fl);
    };
    createFlap(14, 14, 0, 15, 6.8, 0.22, 0); // Front apron
    createFlap(14, 15, 0, 14.5, -6.8, -0.22, 0); // Back coat
    createFlap(1.2, 13, 8.5, 15, 0, 0, -0.25); // Right hip
    createFlap(1.2, 13, -8.5, 15, 0, 0, 0.25); // Left hip

    // 4. Curved Katana Blade with Fuller & Arcane Cyan Hamon Edge
    const katanaGroup = new THREE.Group();
    // Curved Blade (3 Segmented Bevels for Authentic Curvature)
    for (let seg = 0; seg < 3; seg++) {
      const bladeSeg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 16, 3.2), cyanGlow);
      bladeSeg.position.set(0, 10 + seg * 15, seg * 1.2);
      bladeSeg.rotation.x = seg * 0.08;
      bladeSeg.castShadow = true;
      katanaGroup.add(bladeSeg);
    }
    // Katana Tip Kissaki
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1.5, 8, 4), cyanGlow);
    tip.position.set(0, 56, 3.8);
    tip.rotation.y = Math.PI / 4;
    katanaGroup.add(tip);

    // Golden 4-Lobe Tsuba Handguard
    const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 1.6, 12), goldMat);
    tsuba.position.y = 1.5;
    katanaGroup.add(tsuba);

    // Silk Braided Tsuka Handle
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 14, 8), darkMat);
    hilt.position.y = -6;
    katanaGroup.add(hilt);

    // Gold Kashira Pommel
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), goldMat);
    pommel.position.y = -13.5;
    katanaGroup.add(pommel);

    katanaGroup.position.set(13.5, 22, 5);
    katanaGroup.rotation.x = 0.25;
    group.add(katanaGroup);
    group.userData.weapon = katanaGroup;

    // 5. Lacquered Saya Scabbard on Left Hip with Sageo Cord
    const saya = new THREE.Mesh(new THREE.BoxGeometry(2.4, 46, 3.4), darkMat);
    saya.position.set(-11.5, 19, 2);
    saya.rotation.set(0.35, 0, 0.22);
    saya.castShadow = true;
    group.add(saya);

    const sayaTrim = new THREE.Mesh(new THREE.BoxGeometry(2.6, 4, 3.6), goldMat);
    sayaTrim.position.set(-11.5, 29, -1.8);
    sayaTrim.rotation.set(0.35, 0, 0.22);
    group.add(sayaTrim);
  }

  // ==========================================================
  // 2. 저격수 (Sniper) - Hextech Victorian Marksman (Caitlyn-class Fidelity)
  // ==========================================================
  buildSniperModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = createChampionMaterial(0x14214d, 0x000000, { rimStrength: 0.4, rimColor: 0x4b7bec });
    const brassMat = createChampionMaterial(0xd35400, 0x4a1c00, { rimStrength: 0.45, rimColor: 0xf39c12 });
    const woodMat = createChampionMaterial(0x4a2e18, 0x000000, { rimStrength: 0.25 });
    const hexGlow = createChampionMaterial(0x00ffff, 0x00d2d3, {
      emissiveIntensity: 1.6,
      rimStrength: 0.85,
      rimColor: 0x00ffff
    });

    const headG = group.userData.headGroup;
    if (headG) {
      // Flowing Sapphire Wave Curls cascading past shoulders
      const hairLeft = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 1.4, 26, 6), hairMat);
      hairLeft.position.set(-6.5, -4, 2.5);
      hairLeft.rotation.z = -0.18;
      headG.add(hairLeft);

      const hairRight = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 1.4, 26, 6), hairMat);
      hairRight.position.set(6.5, -4, 2.5);
      hairRight.rotation.z = 0.18;
      headG.add(hairRight);

      // Ornate Victorian Tricorn / Silk Top Hat
      const hatGroup = new THREE.Group();
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 8.8, 8, 16), darkMat);
      hatGroup.add(crown);

      const brim = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 1.4, 16), goldMat);
      brim.position.y = -3.5;
      hatGroup.add(brim);

      const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(9.6, 9.6, 2.2, 16), armorMat);
      hatBand.position.y = -2;
      hatGroup.add(hatBand);

      // Steampunk Goggles strapped to Hat Crown
      const goggleL = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 2, 8), brassMat);
      goggleL.rotation.x = Math.PI / 2;
      goggleL.position.set(-4.5, -0.5, 9);
      hatGroup.add(goggleL);

      const goggleR = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 2, 8), brassMat);
      goggleR.rotation.x = Math.PI / 2;
      goggleR.position.set(4.5, -0.5, 9);
      hatGroup.add(goggleR);

      // Glowing Arcane Plume
      const plume = new THREE.Mesh(new THREE.ConeGeometry(2.5, 14, 6), hexGlow);
      plume.position.set(7.5, 8.5, 0);
      plume.rotation.z = -0.42;
      hatGroup.add(plume);

      hatGroup.position.set(0, 8.5, 0);
      headG.add(hatGroup);
    }

    // Epaulettes on Shoulders
    const epauletteL = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.2, 8), goldMat);
    epauletteL.position.set(-12, 36.5, 0);
    group.add(epauletteL);
    const epauletteR = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.2, 8), goldMat);
    epauletteR.position.set(12, 36.5, 0);
    group.add(epauletteR);

    // Split Victorian Coat Tails
    const coatTailL = new THREE.Mesh(new THREE.BoxGeometry(8, 25, 1.2), darkMat);
    coatTailL.position.set(-4.5, 13, -8);
    coatTailL.rotation.set(0.18, 0, -0.1);
    group.add(coatTailL);

    const coatTailR = new THREE.Mesh(new THREE.BoxGeometry(8, 25, 1.2), darkMat);
    coatTailR.position.set(4.5, 13, -8);
    coatTailR.rotation.set(0.18, 0, 0.1);
    group.add(coatTailR);
    group.userData.cape = coatTailL;

    // Leather Ammo Bandolier across Chest with Brass Bullet Shells
    const bandolier = new THREE.Mesh(new THREE.BoxGeometry(3.6, 24, 1.4), woodMat);
    bandolier.position.set(0, 29.5, 4.2);
    bandolier.rotation.z = -0.52;
    group.add(bandolier);

    for (let b = -2; b <= 2; b++) {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 3.2, 6), brassMat);
      shell.position.set(-b * 2.8, 29.5 + b * 2.8, 5.2);
      shell.rotation.z = 0.95;
      group.add(shell);
    }

    // Heavy Ornate Hextech Long Rifle
    const rifle = new THREE.Group();
    // Carved Walnut Stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(3.8, 8, 22), woodMat);
    stock.position.set(0, -2, -10);
    rifle.add(stock);

    // Brass Receiver & Mechanism Chamber
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(4.2, 7.5, 16), brassMat);
    receiver.position.set(0, 0, 4);
    rifle.add(receiver);

    // Hextech Energy Capacitor Core (Glowing Cyan)
    const core = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 8, 8), hexGlow);
    core.rotation.x = Math.PI / 2;
    core.position.set(0, 1.5, 5);
    rifle.add(core);

    // Long Octagonal Brass Barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 62, 8), brassMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 1, 35);
    rifle.add(barrel);

    // Muzzle Brake Compensator
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 1.8, 6, 8), goldMat);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 1, 66);
    rifle.add(muzzle);

    // 3-Tier Crystal Sniper Scope
    const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 24, 8), brassMat);
    scopeTube.rotation.x = Math.PI / 2;
    scopeTube.position.set(0, 6.8, 12);
    rifle.add(scopeTube);

    const frontLens = new THREE.Mesh(new THREE.CircleGeometry(2.5, 8), hexGlow);
    frontLens.position.set(0, 6.8, 24.1);
    rifle.add(frontLens);

    const rearLens = new THREE.Mesh(new THREE.CircleGeometry(2.5, 8), hexGlow);
    rearLens.rotation.y = Math.PI;
    rearLens.position.set(0, 6.8, -0.1);
    rifle.add(rearLens);

    rifle.position.set(12.5, 27, 8);
    rifle.rotation.x = -0.15;
    rifle.castShadow = true;
    group.add(rifle);
    group.userData.weapon = rifle;
  }

  // ==========================================================
  // 3. 화염술사 (Pyromancer) - Radiant Solar Archmage (Brand/Annie Fidelity)
  // ==========================================================
  buildPyromancerModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const robeMat = createChampionMaterial(0x8a131b, 0x220507, { rimStrength: 0.45, rimColor: 0xff6b81 });
    const flameMat = createChampionMaterial(0xff3838, 0xff4757, {
      emissiveIntensity: 1.6,
      rimStrength: 0.9,
      rimColor: 0xffa502
    });
    const solarGold = createChampionMaterial(0xf39c12, 0x4a2c00, { rimStrength: 0.5, rimColor: 0xffda79 });

    const headG = group.userData.headGroup;
    if (headG) {
      // 3-Tier Sculpted Fire Hair Spikes
      for (let k = 0; k < 7; k++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(2.8, 13, 5), flameMat);
        const ang = (k - 3) * 0.32;
        spike.position.set(Math.sin(ang) * 7.5, 7.5 + Math.cos(ang) * 4, -Math.cos(ang) * 4);
        spike.rotation.set(-0.35, 0, -ang * 0.9);
        headG.add(spike);
      }
      // Solar Circlet Crown
      const circlet = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.2, 2.4, 16), goldMat);
      circlet.position.set(0, 4.5, 0);
      headG.add(circlet);

      const rubyGem = new THREE.Mesh(new THREE.OctahedronGeometry(2.6), flameMat);
      rubyGem.position.set(0, 5.5, 8.4);
      headG.add(rubyGem);
    }

    // High Archmage Mantle Collar with Gold Lining
    const collar = new THREE.Mesh(new THREE.BoxGeometry(24, 15, 2.4), goldMat);
    collar.position.set(0, 39, -6.5);
    collar.rotation.x = -0.28;
    group.add(collar);

    // Flared Magister Robe Battle Skirt
    const robeSkirt = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 16, 20, 10, 1, true), robeMat);
    robeSkirt.position.set(0, 11, 0);
    group.add(robeSkirt);

    // Giant Solar Crest Brooch on Chest
    const solarCrest = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 1.2, 8), solarGold);
    solarCrest.rotation.x = Math.PI / 2;
    solarCrest.position.set(0, 31, 6.8);
    group.add(solarCrest);

    // 3 Revolving Burning Sun Orbs (Orbiting Torso with Golden Rings)
    const orbitGroup = new THREE.Group();
    orbitGroup.position.set(0, 28, 0);
    for (let i = 0; i < 3; i++) {
      const orbAnchor = new THREE.Group();
      const orbAngle = (i * Math.PI * 2) / 3;

      const orb = new THREE.Mesh(new THREE.SphereGeometry(3.6, 8, 8), flameMat);
      orb.position.set(Math.cos(orbAngle) * 23, Math.sin(i * 2) * 2, Math.sin(orbAngle) * 23);
      orbAnchor.add(orb);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.6, 6, 16), solarGold);
      ring.position.copy(orb.position);
      ring.rotation.x = Math.PI / 3;
      orbAnchor.add(ring);

      orbitGroup.add(orbAnchor);
    }
    group.add(orbitGroup);
    group.userData.orbits = [orbitGroup];

    // Phoenix Flame Staff with Levitating Spinning Solar Core
    const staffGroup = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 52, 8), goldMat);
    staffGroup.add(shaft);

    // Phoenix Wing Filigree
    const wingL = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 2.2), goldMat);
    wingL.position.set(-6, 26, 0);
    wingL.rotation.z = 0.35;
    staffGroup.add(wingL);

    const wingR = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 2.2), goldMat);
    wingR.position.set(6, 26, 0);
    wingR.rotation.z = -0.35;
    staffGroup.add(wingR);

    // Floating Solar Core Crystal
    const coreGem = new THREE.Mesh(new THREE.OctahedronGeometry(6.2), flameMat);
    coreGem.position.y = 31;
    staffGroup.add(coreGem);

    staffGroup.position.set(13.5, 25, 7);
    staffGroup.castShadow = true;
    group.add(staffGroup);
    group.userData.weapon = staffGroup;
  }

  // ==========================================================
  // 4. 암살자 (Shadow Assassin) - Void Obsidian Ninja (Zed-class Fidelity)
  // ==========================================================
  buildShadowAssassinModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const violetMat = createChampionMaterial(0x8e44ad, 0x9b59b6, {
      emissiveIntensity: 1.5,
      rimStrength: 0.85,
      rimColor: 0xe056fd
    });
    const stealthMat = createChampionMaterial(0x101216, 0x000000, { rimStrength: 0.45, rimColor: 0x5758bb });
    const silverEdge = createChampionMaterial(0xdcdde1, 0x333333, { rimStrength: 0.6, rimColor: 0xffffff });

    const headG = group.userData.headGroup;
    if (headG) {
      // Pointed Ninja Cowl Peak
      const cowl = new THREE.Mesh(new THREE.ConeGeometry(8.5, 9, 6), stealthMat);
      cowl.position.set(0, 7.5, -0.5);
      headG.add(cowl);

      // Demonic Metallic Jaw Visor
      const jawVisor = new THREE.Mesh(new THREE.BoxGeometry(8.8, 6.5, 5), stealthMat);
      jawVisor.position.set(0, -1.8, 6.2);
      headG.add(jawVisor);

      // Glowing Purple Void Visor Slits
      const eyeSlitL = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.8), violetMat);
      eyeSlitL.position.set(-2.5, 1.8, 7.8);
      headG.add(eyeSlitL);
      const eyeSlitR = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.8), violetMat);
      eyeSlitR.position.set(2.5, 1.8, 7.8);
      headG.add(eyeSlitR);

      // Trailing Divided Void Scarf
      const scarfL = new THREE.Mesh(new THREE.BoxGeometry(3.5, 26, 0.8), violetMat);
      scarfL.position.set(-2.2, -4, -8.5);
      scarfL.rotation.set(0.42, 0, -0.12);
      headG.add(scarfL);

      const scarfR = new THREE.Mesh(new THREE.BoxGeometry(3.5, 26, 0.8), violetMat);
      scarfR.position.set(2.2, -4, -8.5);
      scarfR.rotation.set(0.42, 0, 0.12);
      headG.add(scarfR);
      group.userData.cape = scarfL;
    }

    // Segmented Ribplate Armor
    for (let r = 0; r < 3; r++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(16 - r * 1.5, 3.2, 5.5), stealthMat);
      rib.position.set(0, 27 + r * 3.4, 4);
      rib.castShadow = true;
      group.add(rib);
    }

    // Spiked Triangular Shadow Pauldrons on Shoulders
    const pldL = new THREE.Mesh(new THREE.ConeGeometry(5.2, 10, 4), stealthMat);
    pldL.position.set(-14, 38, 0);
    pldL.rotation.z = 0.55;
    group.add(pldL);

    const pldR = new THREE.Mesh(new THREE.ConeGeometry(5.2, 10, 4), stealthMat);
    pldR.position.set(14, 38, 0);
    pldR.rotation.z = -0.55;
    group.add(pldR);

    // Giant 4-Pointed Throwing Shuriken Mounted on Lower Back
    const shurikenGroup = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(3, 14, 3), silverEdge);
      blade.position.set(Math.cos(k * Math.PI / 2) * 8, Math.sin(k * Math.PI / 2) * 8, 0);
      blade.rotation.z = k * Math.PI / 2 - Math.PI / 2;
      shurikenGroup.add(blade);
    }
    const shurCore = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 2, 8), violetMat);
    shurCore.rotation.x = Math.PI / 2;
    shurikenGroup.add(shurCore);
    shurikenGroup.position.set(0, 25, -7.5);
    group.add(shurikenGroup);

    // Dual Forearm-Mounted Crescent Katar Blades (Right & Left)
    const createKatar = () => {
      const kg = new THREE.Group();
      // Arm Bracer Clamps
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(5.5, 12, 5.5), stealthMat);
      kg.add(clamp);

      // Dual Curved Scythe Blades
      const outerBlade = new THREE.Mesh(new THREE.BoxGeometry(1.8, 32, 4.2), violetMat);
      outerBlade.position.set(2.2, 14, 2);
      outerBlade.rotation.x = 0.35;
      outerBlade.castShadow = true;
      kg.add(outerBlade);

      const innerBlade = new THREE.Mesh(new THREE.BoxGeometry(1.8, 26, 3.5), silverEdge);
      innerBlade.position.set(-2.2, 12, 1.8);
      innerBlade.rotation.x = 0.35;
      innerBlade.castShadow = true;
      kg.add(innerBlade);
      return kg;
    };

    const rightKatar = createKatar();
    rightKatar.position.set(13, 20, 4);
    group.add(rightKatar);
    group.userData.weapon = rightKatar;

    const leftKatar = createKatar();
    leftKatar.position.set(-13, 20, 4);
    group.add(leftKatar);
    group.userData.leftWeapon = leftKatar;
  }

  // ==========================================================
  // 5. 수호자 (Guardian) - Winged Radiant Paladin (Garen/Kayle Fidelity)
  // ==========================================================
  buildGuardianModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const whitePlate = createChampionMaterial(0xf5f6fa, 0x111122, { rimStrength: 0.65, rimColor: 0xfff9e6 });
    const holyGlow = createChampionMaterial(0x00ffff, 0x0984e3, {
      emissiveIntensity: 1.6,
      rimStrength: 0.85,
      rimColor: 0x70a1ff
    });
    const royalBlue = createChampionMaterial(0x192a56, 0x050c1e, { rimStrength: 0.45, rimColor: 0x3867d6 });

    const headG = group.userData.headGroup;
    if (headG) {
      // Full Close Knight Helmet
      const helmet = new THREE.Mesh(new THREE.BoxGeometry(11, 12, 11), whitePlate);
      helmet.position.set(0, 1.5, 0);
      helmet.castShadow = true;
      headG.add(helmet);

      // Cross-Shaped Visor Slit (Holy Glowing Eyes)
      const visorH = new THREE.Mesh(new THREE.BoxGeometry(8.5, 1.4, 1.2), holyGlow);
      visorH.position.set(0, 1.8, 5.8);
      headG.add(visorH);

      const visorV = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7, 1.2), holyGlow);
      visorV.position.set(0, 0, 5.8);
      headG.add(visorV);

      // Winged Helmet Crest
      const crestL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 8, 12), goldMat);
      crestL.position.set(-5.5, 6, -2);
      crestL.rotation.z = -0.25;
      headG.add(crestL);

      const crestR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 8, 12), goldMat);
      crestR.position.set(5.5, 6, -2);
      crestR.rotation.z = 0.25;
      headG.add(crestR);
    }

    // Giant Winged Multi-Tier Pauldrons
    const createWingedPauldron = (isLeft) => {
      const pg = new THREE.Group();
      const pldBase = new THREE.Mesh(new THREE.BoxGeometry(12, 10, 16), whitePlate);
      pg.add(pldBase);

      const goldTrim = new THREE.Mesh(new THREE.BoxGeometry(13, 3, 17), goldMat);
      goldTrim.position.y = 4.2;
      pg.add(goldTrim);

      // 3 Upward Wing Blades
      for (let w = 0; w < 3; w++) {
        const feather = new THREE.Mesh(new THREE.ConeGeometry(2.5, 10 + w * 3, 4), goldMat);
        feather.position.set(isLeft ? -4 - w * 1.5 : 4 + w * 1.5, 8 + w * 2.5, -2 + w * 2);
        feather.rotation.z = isLeft ? 0.35 : -0.35;
        pg.add(feather);
      }
      return pg;
    };

    const leftPld = createWingedPauldron(true);
    leftPld.position.set(-15, 37, 0);
    group.add(leftPld);

    const rightPld = createWingedPauldron(false);
    rightPld.position.set(15, 37, 0);
    group.add(rightPld);

    // Billowing Royal Blue Knight Cape with Gold Border
    const cape = new THREE.Mesh(new THREE.BoxGeometry(24, 32, 1.4), royalBlue);
    cape.position.set(0, 22, -8.5);
    cape.rotation.x = 0.14;
    group.add(cape);
    group.userData.cape = cape;

    // Heavy Plated Tassets (Hip Plate Skirts)
    const tassetL = new THREE.Mesh(new THREE.BoxGeometry(7, 14, 1.6), whitePlate);
    tassetL.position.set(-8.5, 15, 5);
    tassetL.rotation.set(0.2, 0, -0.2);
    group.add(tassetL);

    const tassetR = new THREE.Mesh(new THREE.BoxGeometry(7, 14, 1.6), whitePlate);
    tassetR.position.set(8.5, 15, 5);
    tassetR.rotation.set(0.2, 0, 0.2);
    group.add(tassetR);

    // Left Arm: Giant Golden Lion-Crest Tower Shield with Holy Cross
    const shieldGroup = new THREE.Group();
    // Heavy Curved Shield Body
    const shldBody = new THREE.Mesh(new THREE.BoxGeometry(28, 48, 4.8), whitePlate);
    shieldGroup.add(shldBody);

    const goldBorder = new THREE.Mesh(new THREE.BoxGeometry(30, 50, 2), goldMat);
    goldBorder.position.z = -1.2;
    shieldGroup.add(goldBorder);

    // Golden Cross Relic
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(6, 38, 2.2), goldMat);
    crossV.position.z = 2.6;
    shieldGroup.add(crossV);

    const crossH = new THREE.Mesh(new THREE.BoxGeometry(22, 6, 2.2), goldMat);
    crossH.position.set(0, 6, 2.6);
    shieldGroup.add(crossH);

    // Central Radiant Lion Gem Core
    const lionGem = new THREE.Mesh(new THREE.OctahedronGeometry(5.2), holyGlow);
    lionGem.position.set(0, 6, 4.2);
    shieldGroup.add(lionGem);

    shieldGroup.position.set(-15, 23, 7);
    shieldGroup.castShadow = true;
    group.add(shieldGroup);

    // Right Arm: Massive Radiant Holy Warhammer
    const hammer = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 46, 8), goldMat);
    hammer.add(shaft);

    // 8-Sided Heavy Hammer Head
    const headBlock = new THREE.Mesh(new THREE.BoxGeometry(14, 16, 20), silverMat);
    headBlock.position.y = 19;
    hammer.add(headBlock);

    // Holy Arcane Core in Hammer Center
    const hammerCore = new THREE.Mesh(new THREE.OctahedronGeometry(5.2), holyGlow);
    hammerCore.position.y = 19;
    hammer.add(hammerCore);

    hammer.position.set(15, 24, 7);
    hammer.castShadow = true;
    group.add(hammer);
    group.userData.weapon = hammer;
  }

  // ==========================================================
  // 6. 빙결술사 (Frost Mage) - Glacial Sovereign (Lissandra/Anivia Fidelity)
  // ==========================================================
  buildFrostMageModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = createChampionMaterial(0xecf0f1, 0x000000, { rimStrength: 0.5, rimColor: 0x74b9ff });
    const iceMat = createChampionMaterial(0x00d2d3, 0x00ffff, {
      emissiveIntensity: 1.6,
      rimStrength: 0.85,
      rimColor: 0xdff9fb,
      transparent: true,
      opacity: 0.88
    });
    const gownMat = createChampionMaterial(0x74b9ff, 0x0984e3, {
      emissiveIntensity: 0.35,
      rimStrength: 0.6,
      rimColor: 0xffffff,
      transparent: true,
      opacity: 0.92
    });

    const headG = group.userData.headGroup;
    if (headG) {
      // 5-Spike Diamond Glacial Tiara Crown
      const crownBase = new THREE.Mesh(new THREE.TorusGeometry(8.6, 1.2, 8, 16), iceMat);
      crownBase.rotation.x = Math.PI / 2;
      crownBase.position.set(0, 5.5, 0);
      headG.add(crownBase);

      for (let s = -2; s <= 2; s++) {
        const spike = new THREE.Mesh(new THREE.OctahedronGeometry(2.2 + (2 - Math.abs(s)) * 1.2), iceMat);
        spike.position.set(s * 3.2, 8 + (2 - Math.abs(s)) * 2.5, 7.5 - Math.abs(s) * 1.5);
        spike.scale.set(0.6, 1.8, 0.6);
        headG.add(spike);
      }

      // Cascading Platinum Twin Tails
      const tailL = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 0.8, 32, 6), hairMat);
      tailL.position.set(-6.5, -6, -2);
      tailL.rotation.set(0.12, 0, -0.2);
      headG.add(tailL);

      const tailR = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 0.8, 32, 6), hairMat);
      tailR.position.set(6.5, -6, -2);
      tailR.rotation.set(0.12, 0, 0.2);
      headG.add(tailR);
    }

    // Ice Shard Shoulder Mantle Wings
    const wingL = new THREE.Mesh(new THREE.ConeGeometry(4, 14, 4), iceMat);
    wingL.position.set(-13, 38, -1);
    wingL.rotation.set(-0.25, 0, 0.55);
    group.add(wingL);

    const wingR = new THREE.Mesh(new THREE.ConeGeometry(4, 14, 4), iceMat);
    wingR.position.set(13, 38, -1);
    wingR.rotation.set(-0.25, 0, -0.55);
    group.add(wingR);

    // Crystalline Slit Glacial Gown (Flared Layered Ice Skirt)
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(8, 18, 22, 10, 1, true), gownMat);
    skirt.position.set(0, 11, 0);
    group.add(skirt);

    // 3 Levitating Diamond Ice Crystals Orbiting Shoulders
    const iceOrbit = new THREE.Group();
    iceOrbit.position.set(0, 36, 0);
    for (let k = 0; k < 3; k++) {
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(4.2), iceMat);
      const ang = (k * Math.PI * 2) / 3;
      cr.position.set(Math.cos(ang) * 20, Math.sin(k * 2) * 3, Math.sin(ang) * 20);
      iceOrbit.add(cr);
    }
    group.add(iceOrbit);
    group.userData.orbits = [iceOrbit];

    // Snowflake Ice Sceptre with Levitating Spire Gem
    const sceptre = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 48, 8), silverMat);
    sceptre.add(shaft);

    // 6-Pointed Snowflake Star Filigree
    for (let f = 0; f < 3; f++) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(1.2, 14, 1.2), iceMat);
      cross.position.y = 24;
      cross.rotation.z = (f * Math.PI) / 3;
      sceptre.add(cross);
    }

    const starGem = new THREE.Mesh(new THREE.OctahedronGeometry(6.5), iceMat);
    starGem.position.y = 24;
    sceptre.add(starGem);

    sceptre.position.set(13, 25, 6);
    sceptre.castShadow = true;
    group.add(sceptre);
    group.userData.weapon = sceptre;
  }

  // ==========================================================
  // 7. 광전사 (Berserker) - Fierce Viking Warlord (Olaf/Darius Fidelity)
  // ==========================================================
  buildBerserkerModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = createChampionMaterial(0xd35400, 0x000000, { rimStrength: 0.4, rimColor: 0xe67e22 });
    const furMat = createChampionMaterial(0x47535e, 0x000000, { rimStrength: 0.35, rimColor: 0x7f8c8d });
    const steelMat = createChampionMaterial(0x718093, 0x1b2229, { rimStrength: 0.6, rimColor: 0xdcdde1 });
    const bloodRed = createChampionMaterial(0x990000, 0x330000, { rimStrength: 0.5, rimColor: 0xe74c3c });

    const headG = group.userData.headGroup;
    if (headG) {
      // Iron Viking Helmet with Horn Mounts
      const helmDome = new THREE.Mesh(new THREE.SphereGeometry(8.2, 12, 12), steelMat);
      helmDome.position.set(0, 3.5, 0);
      headG.add(helmDome);

      const noseGuard = new THREE.Mesh(new THREE.BoxGeometry(2, 6.5, 1.8), steelMat);
      noseGuard.position.set(0, 1.2, 7.8);
      headG.add(noseGuard);

      // Curved Ivory Viking Horns (Left & Right)
      const createHorn = (isLeft) => {
        const hornGroup = new THREE.Group();
        for (let seg = 0; seg < 4; seg++) {
          const r = 2.4 - seg * 0.45;
          const piece = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 5, 8), silverMat);
          piece.position.set(0, seg * 4, 0);
          piece.rotation.z = (isLeft ? -1 : 1) * 0.25;
          hornGroup.add(piece);
        }
        hornGroup.position.set(isLeft ? -7.8 : 7.8, 5, 0);
        hornGroup.rotation.z = isLeft ? -0.45 : 0.45;
        hornGroup.rotation.x = -0.2;
        return hornGroup;
      };
      headG.add(createHorn(true));
      headG.add(createHorn(false));

      // Thick Braided Red Beard with Gold Rings
      const beard = new THREE.Mesh(new THREE.ConeGeometry(4.8, 16, 6), hairMat);
      beard.position.set(0, -6, 5.5);
      beard.rotation.x = -0.25;
      headG.add(beard);

      const beardRing = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.6, 6, 12), goldMat);
      beardRing.position.set(0, -10, 5.2);
      beardRing.rotation.x = Math.PI / 2;
      headG.add(beardRing);
    }

    // Heavy Wolf-Fur Pelt Mantle across Broad Shoulders
    const furMantle = new THREE.Mesh(new THREE.BoxGeometry(30, 9, 18), furMat);
    furMantle.position.set(0, 36.5, 0);
    furMantle.castShadow = true;
    group.add(furMantle);

    // Diagonal Leather Chest Harness Belt with Skull Buckle
    const harness = new THREE.Mesh(new THREE.BoxGeometry(4.2, 26, 1.4), darkMat);
    harness.position.set(0, 29.5, 4.4);
    harness.rotation.z = -0.58;
    group.add(harness);

    // Dual Heavy Bearded Battleaxes (Right & Left)
    const createBattleaxe = () => {
      const ag = new THREE.Group();
      // Tough Ashwood Handle
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 42, 8), darkMat);
      ag.add(handle);

      // Steel Blade Socket Cap
      const socket = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 8, 8), steelMat);
      socket.position.y = 13;
      ag.add(socket);

      // Notched Half-Moon Crescent Blade
      const blade = new THREE.Mesh(new THREE.BoxGeometry(3.6, 28, 18), steelMat);
      blade.position.set(0, 13, 8);
      blade.castShadow = true;
      ag.add(blade);

      // Back Spike
      const spike = new THREE.Mesh(new THREE.ConeGeometry(2.2, 8, 4), steelMat);
      spike.position.set(0, 13, -6.5);
      spike.rotation.x = -Math.PI / 2;
      ag.add(spike);

      // Blood Rune Inscription Groove
      const bloodLine = new THREE.Mesh(new THREE.BoxGeometry(3.8, 16, 1.2), bloodRed);
      bloodLine.position.set(0, 13, 11);
      ag.add(bloodLine);
      return ag;
    };

    const rightAxe = createBattleaxe();
    rightAxe.position.set(14.5, 22, 6);
    rightAxe.rotation.x = 0.25;
    group.add(rightAxe);
    group.userData.weapon = rightAxe;

    const leftAxe = createBattleaxe();
    leftAxe.position.set(-14.5, 22, 6);
    leftAxe.rotation.x = 0.25;
    group.add(leftAxe);
    group.userData.leftWeapon = leftAxe;
  }

  // ==========================================================
  // 8. 그림자 사냥꾼 (Shadow Hunter) - Gothic Van Helsing (Vayne Fidelity)
  // ==========================================================
  buildShadowHunterModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const leatherMat = createChampionMaterial(0x14181c, 0x000000, { rimStrength: 0.45, rimColor: 0x576574 });
    const silverTrim = createChampionMaterial(0xdcdde1, 0x222222, { rimStrength: 0.6, rimColor: 0xffffff });
    const redLens = createChampionMaterial(0xff0033, 0xff3838, {
      emissiveIntensity: 1.6,
      rimStrength: 0.85,
      rimColor: 0xff6b6b
    });

    const headG = group.userData.headGroup;
    if (headG) {
      // Wide-Brimmed Gothic Hunter Fedora Hat
      const fedora = new THREE.Group();
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(8.8, 8.8, 7.5, 16), leatherMat);
      crown.position.y = 4.2;
      fedora.add(crown);

      const brim = new THREE.Mesh(new THREE.CylinderGeometry(17, 17, 1.2, 16), leatherMat);
      brim.position.y = 0.5;
      fedora.add(brim);

      const silverBand = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 1.8, 16), silverTrim);
      silverBand.position.y = 2.2;
      fedora.add(silverBand);

      fedora.position.set(0, 6, 0);
      headG.add(fedora);

      // Crimson Tint Night-Hunting Goggles
      const goggleBar = new THREE.Mesh(new THREE.BoxGeometry(10, 1.8, 2), darkMat);
      goggleBar.position.set(0, 2, 7.6);
      headG.add(goggleBar);

      const lensL = new THREE.Mesh(new THREE.CircleGeometry(2.2, 8), redLens);
      lensL.position.set(-3, 2, 8.7);
      headG.add(lensL);

      const lensR = new THREE.Mesh(new THREE.CircleGeometry(2.2, 8), redLens);
      lensR.position.set(3, 2, 8.7);
      headG.add(lensR);

      // Sleek High Ponytail
      const pony = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.2, 24, 6), darkMat);
      pony.position.set(0, 0, -8.5);
      pony.rotation.x = -0.55;
      headG.add(pony);
    }

    // High Popped Duster Coat Collar
    const dusterCollar = new THREE.Mesh(new THREE.BoxGeometry(22, 12, 1.8), leatherMat);
    dusterCollar.position.set(0, 38, -5.5);
    dusterCollar.rotation.x = -0.22;
    group.add(dusterCollar);

    // Billowing Gothic Coat Tails
    const tails = new THREE.Mesh(new THREE.BoxGeometry(18, 28, 1.4), leatherMat);
    tails.position.set(0, 14, -7.5);
    tails.rotation.x = 0.18;
    group.add(tails);
    group.userData.cape = tails;

    // Right Arm: Mechanical 3-Shot Wrist-Mounted Repeater Crossbow
    const xbow = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(4.5, 5.5, 24), darkMat);
    xbow.add(stock);

    // Silver Curved Bow Prod (Limb)
    const prod = new THREE.Mesh(new THREE.BoxGeometry(28, 3, 3.2), silverTrim);
    prod.position.set(0, 1.5, 9);
    xbow.add(prod);

    const bowString = new THREE.Mesh(new THREE.BoxGeometry(27, 0.8, 0.8), silverTrim);
    bowString.position.set(0, 1.5, -2);
    xbow.add(bowString);

    // Silver Bolt Magazine
    const mag = new THREE.Mesh(new THREE.BoxGeometry(2.8, 4.2, 14), silverTrim);
    mag.position.set(0, 4.5, 2);
    xbow.add(mag);

    xbow.position.set(13, 23, 7);
    xbow.castShadow = true;
    group.add(xbow);
    group.userData.weapon = xbow;

    // Giant Heavy Silver Crossbow Mounted across Back
    const backBow = new THREE.Group();
    const giantProd = new THREE.Mesh(new THREE.BoxGeometry(36, 4, 4), silverTrim);
    backBow.add(giantProd);

    const giantStock = new THREE.Mesh(new THREE.BoxGeometry(5.2, 5.2, 38), darkMat);
    giantStock.position.y = -6;
    backBow.add(giantStock);

    backBow.position.set(0, 27, -8.5);
    backBow.rotation.z = 0.55;
    group.add(backBow);
  }

  // ==========================================================
  // 9. 격투가 (Brawler) - Striking Tiger Martial Artist (Lee Sin/Sett Fidelity)
  // ==========================================================
  buildBrawlerModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const hairMat = createChampionMaterial(0x181e24, 0x000000, { rimStrength: 0.35, rimColor: 0x576574 });
    const redMat = createChampionMaterial(0xd63031, 0x330000, { rimStrength: 0.5, rimColor: 0xff7675 });
    const tigerGlow = createChampionMaterial(0xf39c12, 0xd35400, {
      emissiveIntensity: 1.6,
      rimStrength: 0.85,
      rimColor: 0xfdcb6e
    });

    const headG = group.userData.headGroup;
    if (headG) {
      // Short Sharp Spike Hair
      for (let s = 0; s < 5; s++) {
        const spk = new THREE.Mesh(new THREE.ConeGeometry(2.4, 7, 4), hairMat);
        spk.position.set((s - 2) * 2.4, 7, -1);
        spk.rotation.set(-0.25, 0, (s - 2) * 0.2);
        headG.add(spk);
      }

      // Red Martial Headband with Long Fluttering Tails
      const headband = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.2, 2.2, 16), redMat);
      headband.position.set(0, 4.5, 0);
      headG.add(headband);

      const ribbon = new THREE.Mesh(new THREE.BoxGeometry(2.5, 20, 0.6), redMat);
      ribbon.position.set(0, 2, -9.5);
      ribbon.rotation.x = 0.48;
      headG.add(ribbon);
      group.userData.cape = ribbon;
    }

    // Muscular Sculpted Pectorals & 6-Pack Abs (Skin Surface Relief)
    const abs = new THREE.Mesh(new THREE.BoxGeometry(13, 14, 2.5), skinMat);
    abs.position.set(0, 27.5, 4.2);
    group.add(abs);

    // Open Martial Arts Vest (Flaps on Sides)
    const vestL = new THREE.Mesh(new THREE.BoxGeometry(4.5, 16, 8), darkMat);
    vestL.position.set(-8.5, 29, 1);
    group.add(vestL);

    const vestR = new THREE.Mesh(new THREE.BoxGeometry(4.5, 16, 8), darkMat);
    vestR.position.set(8.5, 29, 1);
    group.add(vestR);

    // Gold Dragon Obi Sash
    const sash = new THREE.Mesh(new THREE.BoxGeometry(19, 4.5, 12), goldMat);
    sash.position.set(0, 19.5, 0);
    group.add(sash);

    // Massive Golden Tiger-Head Fist Gauntlets (Dual Cestus)
    const createTigerGauntlet = () => {
      const gg = new THREE.Group();
      // Heavy Tiger Snout Box
      const snout = new THREE.Mesh(new THREE.BoxGeometry(9.5, 9.5, 14), tigerGlow);
      gg.add(snout);

      // Tiger Ears (Left & Right)
      const earL = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4.5, 4), goldMat);
      earL.position.set(-3.5, 5.5, -1);
      earL.rotation.z = -0.35;
      gg.add(earL);

      const earR = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4.5, 4), goldMat);
      earR.position.set(3.5, 5.5, -1);
      earR.rotation.z = 0.35;
      gg.add(earR);

      // Glowing Eyes
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(1.2, 6, 6), new THREE.MeshBasicMaterial({ color: 0x00ffff }));
      eyeL.position.set(-2.6, 2.2, 7.2);
      gg.add(eyeL);

      const eyeR = new THREE.Mesh(new THREE.SphereGeometry(1.2, 6, 6), new THREE.MeshBasicMaterial({ color: 0x00ffff }));
      eyeR.position.set(2.6, 2.2, 7.2);
      gg.add(eyeR);

      // Flaming Ki Aura Ring
      const auraRing = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.8, 6, 16), tigerGlow);
      auraRing.rotation.x = Math.PI / 2;
      gg.add(auraRing);
      return gg;
    };

    const rightFist = createTigerGauntlet();
    rightFist.position.set(13.5, 21, 6);
    rightFist.castShadow = true;
    group.add(rightFist);
    group.userData.weapon = rightFist;

    const leftFist = createTigerGauntlet();
    leftFist.position.set(-13.5, 21, 6);
    leftFist.castShadow = true;
    group.add(leftFist);
    group.userData.leftWeapon = leftFist;
  }

  // ==========================================================
  // 10. 폭탄광 (Demolitionist) - Eccentric Tech Genius (Ziggs Fidelity)
  // ==========================================================
  buildDemolitionistModel(group, teamHex, skinMat, darkMat, goldMat, silverMat, armorMat, THREE) {
    const brassMat = createChampionMaterial(0xd35400, 0x331100, { rimStrength: 0.45, rimColor: 0xf39c12 });
    const bombMat = createChampionMaterial(0x1c2128, 0x000000, { rimStrength: 0.4, rimColor: 0x576574 });
    const sparkMat = createChampionMaterial(0xf1c40f, 0xff9f43, {
      emissiveIntensity: 1.8,
      rimStrength: 0.85,
      rimColor: 0xffea00
    });
    const leatherMat = createChampionMaterial(0x4a3728, 0x000000, { rimStrength: 0.35 });

    const headG = group.userData.headGroup;
    if (headG) {
      // Steampunk Pilot Cap with Fur Earflaps
      const capDome = new THREE.Mesh(new THREE.SphereGeometry(8.5, 12, 12), leatherMat);
      capDome.position.set(0, 3, 0);
      headG.add(capDome);

      const flapL = new THREE.Mesh(new THREE.BoxGeometry(2, 9, 7), leatherMat);
      flapL.position.set(-8, -1.5, 1);
      headG.add(flapL);

      const flapR = new THREE.Mesh(new THREE.BoxGeometry(2, 9, 7), leatherMat);
      flapR.position.set(8, -1.5, 1);
      headG.add(flapR);

      // Dual Brass Aviator Goggles with Glowing Green Lenses
      const goggleL = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 3, 12), brassMat);
      goggleL.rotation.x = Math.PI / 2;
      goggleL.position.set(-4.5, 3.8, 8.2);
      headG.add(goggleL);

      const lensL = new THREE.Mesh(new THREE.CircleGeometry(3.2, 8), new THREE.MeshBasicMaterial({ color: 0x2ed573 }));
      lensL.position.set(-4.5, 3.8, 9.8);
      headG.add(lensL);

      const goggleR = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 3, 12), brassMat);
      goggleR.rotation.x = Math.PI / 2;
      goggleR.position.set(4.5, 3.8, 8.2);
      headG.add(goggleR);

      const lensR = new THREE.Mesh(new THREE.CircleGeometry(3.2, 8), new THREE.MeshBasicMaterial({ color: 0x2ed573 }));
      lensR.position.set(4.5, 3.8, 9.8);
      headG.add(lensR);
    }

    // Heavy Clockwork Rocket Bomb Backpack
    const pack = new THREE.Group();
    // Fuel Boiler Tank
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 18, 12), brassMat);
    pack.add(boiler);

    // Pressure Gauge Dial on Back
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1.5, 12), goldMat);
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(0, 3, -7.2);
    pack.add(gauge);

    // Dual Rocket Exhaust Thruster Cones
    const thrusterL = new THREE.Mesh(new THREE.ConeGeometry(3.2, 8, 8), darkMat);
    thrusterL.position.set(-4.2, -12, 0);
    thrusterL.rotation.x = Math.PI;
    pack.add(thrusterL);

    const thrusterR = new THREE.Mesh(new THREE.ConeGeometry(3.2, 8, 8), darkMat);
    thrusterR.position.set(4.2, -12, 0);
    thrusterR.rotation.x = Math.PI;
    pack.add(thrusterR);

    pack.position.set(0, 27, -9.5);
    group.add(pack);

    // Giant Spherical Black Powder Bomb with Sparking Fuse
    const bombGroup = new THREE.Group();
    // Giant Iron Ball
    const sphereBomb = new THREE.Mesh(new THREE.SphereGeometry(9.2, 16, 16), bombMat);
    bombGroup.add(sphereBomb);

    // Reinforced Iron Seam Bands
    const bandH = new THREE.Mesh(new THREE.TorusGeometry(9.3, 0.8, 6, 16), brassMat);
    bombGroup.add(bandH);

    // Brass Neck & Fuse Wick
    const fuseNeck = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 4, 8), brassMat);
    fuseNeck.position.y = 9.5;
    bombGroup.add(fuseNeck);

    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 6, 6), darkMat);
    wick.position.set(0, 13, 1.5);
    wick.rotation.x = 0.35;
    bombGroup.add(wick);

    // Burning Spark Core on Wick Tip
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(3), sparkMat);
    spark.position.set(0, 16.5, 2.8);
    bombGroup.add(spark);

    bombGroup.position.set(13, 22, 7);
    bombGroup.castShadow = true;
    group.add(bombGroup);
    group.userData.weapon = bombGroup;
  }

  // ==========================================================
  // 3D STRUCTURES (HIGH-DETAIL LOL NPR TURRETS & ARCANE NEXUS)
  // ==========================================================
  update3DStructures(structures, gameState) {
    const THREE = window.THREE;
    if (!structures) return;

    // Entity lookup map for dynamic targeting laser line
    const entityMap = {};
    if (gameState) {
      if (gameState.players) gameState.players.forEach(p => { entityMap[p.id] = p; });
      if (gameState.minions) gameState.minions.forEach(m => { entityMap[m.id] = m; });
    }

    structures.forEach(s => {
      let group = this.threeStructureMeshes[s.id];
      if (!group) {
        group = new THREE.Group();
        const isBlue = s.team === 'blue';
        const teamHex = isBlue ? 0x0984e3 : 0xd63031;
        const glowHex = isBlue ? 0x00d2d3 : 0xff4757;
        const stoneColor = isBlue ? 0x243342 : 0x3a2525;

        if (s.type === 'nexus') {
          // 3D Arcane Nexus Core
          const daisGeo = new THREE.CylinderGeometry(s.radius, s.radius * 1.15, 20, 16);
          const daisMat = createChampionMaterial(stoneColor, 0x000000, { rimStrength: 0.45 });
          const dais = new THREE.Mesh(daisGeo, daisMat);
          dais.position.y = 10;
          dais.receiveShadow = true;
          group.add(dais);

          // Giant Floating Core Gem (Crystal)
          const gemGeo = new THREE.OctahedronGeometry(s.radius * 0.6);
          const gemMat = createChampionMaterial(teamHex, glowHex, { emissiveIntensity: 0.85, rimStrength: 0.85 });
          const gem = new THREE.Mesh(gemGeo, gemMat);
          gem.position.y = 52;
          group.add(gem);
          group.userData.gem = gem;

          // Orbiting Arcane Ring
          const ringGeo = new THREE.TorusGeometry(s.radius * 0.75, 2.5, 8, 32);
          const ringMat = createChampionMaterial(0xc89b3c, 0xc89b3c, { emissiveIntensity: 0.6 });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.position.y = 52;
          ring.rotation.x = Math.PI / 4;
          group.add(ring);
          group.userData.ring = ring;

          // Invulnerability Shield Dome
          const shieldGeo = new THREE.SphereGeometry(s.radius * 1.05, 16, 12);
          const shieldMat = new THREE.MeshBasicMaterial({ color: 0xf1c40f, transparent: true, opacity: 0.25, wireframe: true });
          const shield = new THREE.Mesh(shieldGeo, shieldMat);
          shield.position.y = 52;
          shield.visible = !!s.isInvulnerable;
          group.add(shield);
          group.userData.shield = shield;
        } else if (s.type === 'inhibitor') {
          // === HIGH-DETAIL 3D LEAGUE OF LEGENDS INHIBITOR ===
          // 1. Octagonal Carved Stone Dais
          const daisGeo = new THREE.CylinderGeometry(s.radius * 0.85, s.radius * 1.05, 12, 8);
          const daisMat = createChampionMaterial(stoneColor, 0x000000, { rimStrength: 0.45 });
          const dais = new THREE.Mesh(daisGeo, daisMat);
          dais.position.y = 6;
          dais.receiveShadow = true;
          group.add(dais);

          // 2. Four Surrounding Crystal Energy Focus Pylons
          for (let pIdx = 0; pIdx < 4; pIdx++) {
            const pAngle = (pIdx * Math.PI) / 2;
            const pylonGeo = new THREE.BoxGeometry(6, 22, 6);
            const pylonMat = createChampionMaterial(stoneColor, glowHex, { emissiveIntensity: 0.4 });
            const pylon = new THREE.Mesh(pylonGeo, pylonMat);
            pylon.position.set(Math.cos(pAngle) * (s.radius * 0.72), 11, Math.sin(pAngle) * (s.radius * 0.72));
            pylon.castShadow = true;
            group.add(pylon);
          }

          // 3. Floating Ruby/Sapphire Crystal Core
          const gemGeo = new THREE.OctahedronGeometry(s.radius * 0.45, 0);
          const gemMat = createChampionMaterial(teamHex, glowHex, { emissiveIntensity: 0.95, rimStrength: 0.85 });
          const gem = new THREE.Mesh(gemGeo, gemMat);
          gem.position.y = 32;
          gem.castShadow = true;
          group.add(gem);
          group.userData.gem = gem;

          // 4. Orbiting Arcane Ring
          const ringGeo = new THREE.TorusGeometry(s.radius * 0.55, 2, 8, 24);
          const ringMat = createChampionMaterial(glowHex, glowHex, { emissiveIntensity: 0.7 });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.position.y = 32;
          ring.rotation.x = Math.PI / 4;
          group.add(ring);
          group.userData.ring = ring;

          // 5. Invulnerability Energy Shield
          const shieldGeo = new THREE.SphereGeometry(s.radius * 0.95, 16, 12);
          const shieldMat = new THREE.MeshBasicMaterial({ color: 0xf1c40f, transparent: true, opacity: 0.25, wireframe: true });
          const shield = new THREE.Mesh(shieldGeo, shieldMat);
          shield.position.y = 30;
          shield.visible = !!s.isInvulnerable;
          group.add(shield);
          group.userData.shield = shield;
        } else {
          // === HIGH-DETAIL 3D LEAGUE OF LEGENDS STONE TURRET ===
          // 1. Stepped Octagonal Stone Pedestal with Carved Base
          const baseStepGeo = new THREE.CylinderGeometry(s.radius * 1.05, s.radius * 1.25, 14, 8);
          const stoneMat = createChampionMaterial(stoneColor, 0x000000, { rimStrength: 0.45 });
          const baseStep = new THREE.Mesh(baseStepGeo, stoneMat);
          baseStep.position.y = 7;
          baseStep.receiveShadow = true;
          group.add(baseStep);

          // 2. Central Fluted Stone Pillar Body
          const pillarGeo = new THREE.CylinderGeometry(s.radius * 0.68, s.radius * 0.92, 72, 8);
          const pillar = new THREE.Mesh(pillarGeo, stoneMat);
          pillar.position.y = 48;
          pillar.castShadow = true;
          pillar.receiveShadow = true;
          group.add(pillar);

          // 3. Three Monolithic Curved Buttresses surrounding Core
          for (let b = 0; b < 3; b++) {
            const angle = (b * Math.PI * 2) / 3;
            const archGeo = new THREE.BoxGeometry(7, 42, 16);
            const arch = new THREE.Mesh(archGeo, stoneMat);
            arch.position.set(Math.cos(angle) * (s.radius * 0.62), 80, Math.sin(angle) * (s.radius * 0.62));
            arch.rotation.y = -angle;
            arch.rotation.z = 0.14;
            group.add(arch);
          }

          // 4. Levitating Floating Arcane Crystal (Octahedron)
          const gemGeo = new THREE.OctahedronGeometry(18, 0);
          const gemMat = createChampionMaterial(teamHex, glowHex, { emissiveIntensity: 1.15, rimStrength: 0.95 });
          const gem = new THREE.Mesh(gemGeo, gemMat);
          gem.position.y = 96;
          gem.castShadow = true;
          group.add(gem);
          group.userData.gem = gem;

          // 5. Orbiting Energy Gyroscope Ring
          const gyroGeo = new THREE.TorusGeometry(24, 2, 8, 24);
          const gyroMat = createChampionMaterial(glowHex, glowHex, { emissiveIntensity: 0.85 });
          const gyro = new THREE.Mesh(gyroGeo, gyroMat);
          gyro.position.y = 96;
          gyro.rotation.x = Math.PI / 3;
          group.add(gyro);
          group.userData.gyro = gyro;

          // 5.5 Invulnerability Energy Barrier Dome
          const shieldGeo = new THREE.SphereGeometry(28, 16, 12);
          const shieldMat = new THREE.MeshBasicMaterial({ color: 0xf1c40f, transparent: true, opacity: 0.25, wireframe: true });
          const shield = new THREE.Mesh(shieldGeo, shieldMat);
          shield.position.y = 96;
          shield.visible = !!s.isInvulnerable;
          group.add(shield);
          group.userData.shield = shield;

          // 6. Ground Aggro Danger Ring (Subtle glowing circle at radius 380)
          const rangeGeo = new THREE.RingGeometry(376, 380, 48);
          const rangeMat = new THREE.MeshBasicMaterial({
            color: isBlue ? 0x00a8ff : 0xff4757,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.28
          });
          const rangeMesh = new THREE.Mesh(rangeGeo, rangeMat);
          rangeMesh.rotation.x = -Math.PI / 2;
          rangeMesh.position.y = 1.5;
          group.add(rangeMesh);
          group.userData.rangeMesh = rangeMesh;

          // 7. Dynamic 3D Targeting Laser Beam
          const laserGeo = new THREE.CylinderGeometry(1.6, 1.6, 1, 8);
          const laserMat = new THREE.MeshBasicMaterial({
            color: 0xff3838,
            transparent: true,
            opacity: 0.85
          });
          const laserMesh = new THREE.Mesh(laserGeo, laserMat);
          laserMesh.visible = false;
          group.add(laserMesh);
          group.userData.laser = laserMesh;
        }

        // Apply Inverted Hull Stylized Cartoon Outlines to Structure
        this.applyInvertedHullOutline(group, THREE);

        group.position.set(s.x, 0, s.y);
        this.threeStructureMeshes[s.id] = group;
        this.scene.add(group);
      }

      group.visible = s.isAlive;
      if (!s.isAlive) {
        if (group.userData.laser) group.userData.laser.visible = false;
        return;
      }

      // Crystal Rotation & Pulsing
      if (group.userData.gem) {
        group.userData.gem.rotation.y += 0.035;
        group.userData.gem.position.y = (s.type === 'nexus' ? 52 : (s.type === 'inhibitor' ? 32 : 96)) + Math.sin(this.animationTimer * 4) * 3;
      }
      if (group.userData.gyro) {
        group.userData.gyro.rotation.y -= 0.045;
        group.userData.gyro.rotation.z += 0.02;
      }
      if (group.userData.ring) {
        group.userData.ring.rotation.z += 0.03;
      }
      if (group.userData.shield) {
        group.userData.shield.visible = !!s.isInvulnerable;
        if (s.isInvulnerable) {
          group.userData.shield.rotation.y += 0.025;
        }
      }

      // Aggro ring visibility (show when local champion is near the turret)
      if (group.userData.rangeMesh && this.localPlayerId && entityMap[this.localPlayerId]) {
        const lp = entityMap[this.localPlayerId];
        const distToPlayer = Math.hypot(lp.x - s.x, lp.y - s.y);
        group.userData.rangeMesh.visible = (distToPlayer <= 680);
      }

      // Targeting Laser Beam
      if (group.userData.laser) {
        if (s.targetId && entityMap[s.targetId] && entityMap[s.targetId].hp > 0) {
          const targetObj = entityMap[s.targetId];
          const laser = group.userData.laser;
          laser.visible = true;

          const tx = targetObj.x - s.x;
          const ty = 22; // Target chest height
          const tz = targetObj.y - s.y;
          const startY = 96;

          _v1.set(tx, ty - startY, tz);
          const len = _v1.length();

          laser.scale.set(1, len, 1);
          laser.position.set(tx * 0.5, startY + (ty - startY) * 0.5, tz * 0.5);

          laser.quaternion.setFromUnitVectors(_v2.set(0, 1, 0), _v1.normalize());
          laser.material.opacity = 0.65 + Math.sin(this.animationTimer * 20) * 0.25;
        } else {
          group.userData.laser.visible = false;
        }
      }
    });
  }

  // ==========================================================
  // 3D MINION HIERARCHICAL MODELS & ANIMATIONS
  // ==========================================================
  update3DMinions(minions) {
    const THREE = window.THREE;
    if (!this.threeMinionMeshes) this.threeMinionMeshes = {};
    if (!this.minionAnimStates) this.minionAnimStates = {};

    const activeMinionIds = new Set();

    if (minions) {
      minions.forEach(m => {
        activeMinionIds.add(m.id);
        let group = this.threeMinionMeshes[m.id];
        let animState = this.minionAnimStates[m.id];

        if (!animState) {
          animState = { walkPhase: Math.random() * Math.PI * 2, lastX: m.x, lastY: m.y };
          this.minionAnimStates[m.id] = animState;
        }

        if (!group) {
          group = this.create3DMinionModel(m);
          this.threeMinionMeshes[m.id] = group;
          this.scene.add(group);
        }

        group.visible = (m.hp > 0);

        // Position & Zero-GC rotation update
        group.position.set(m.x, 0, m.y);
        group.rotation.y = -m.angle + Math.PI / 2;

        // Animate movement gait
        const isMoving = Math.hypot(m.x - animState.lastX, m.y - animState.lastY) > 0.05;
        animState.lastX = m.x;
        animState.lastY = m.y;

        if (isMoving) {
          animState.walkPhase += 0.25;
        }

        if (m.type === 'melee') {
          // Biped leg gait
          if (group.userData.leftLeg && group.userData.rightLeg) {
            const legAngle = isMoving ? Math.sin(animState.walkPhase) * 0.55 : 0;
            group.userData.leftLeg.rotation.x = legAngle;
            group.userData.rightLeg.rotation.x = -legAngle;
          }
          // Sword chop attack
          if (group.userData.weapon) {
            if (m.isAttacking) {
              group.userData.weapon.rotation.x = -Math.PI / 3 + Math.sin(this.animationTimer * 25) * 0.8;
            } else {
              group.userData.weapon.rotation.x = 0;
            }
          }
        } else if (m.type === 'caster') {
          // Hovering bob
          group.position.y = 4 + Math.sin(this.animationTimer * 6 + animState.walkPhase) * 2.5;
          // Staff raise on attack
          if (group.userData.staff) {
            if (m.isAttacking) {
              group.userData.staff.rotation.x = -Math.PI / 2.5;
              if (group.userData.orb) group.userData.orb.material.emissiveIntensity = 2.0;
            } else {
              group.userData.staff.rotation.x = 0;
              if (group.userData.orb) group.userData.orb.material.emissiveIntensity = 0.8;
            }
          }
        } else if (m.type === 'cannon') {
          // Roll wheels
          if (group.userData.wheels) {
            const wheelSpin = animState.walkPhase;
            group.userData.wheels.forEach(w => { w.rotation.x = wheelSpin; });
          }
        }
      });
    }

    // Clean up dead/removed minion meshes
    for (const id in this.threeMinionMeshes) {
      if (!activeMinionIds.has(id)) {
        const mesh = this.threeMinionMeshes[id];
        this.scene.remove(mesh);
        delete this.threeMinionMeshes[id];
        delete this.minionAnimStates[id];
      }
    }
  }

  create3DMinionModel(m) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const isBlue = m.team === 'blue';
    const tunicColor = isBlue ? 0x2980b9 : 0xc0392b;
    const armorColor = 0x576574;
    const goldTrim = 0xf1c40f;

    if (m.type === 'melee') {
      // 1. Torso / Tunic
      const torsoGeo = new THREE.CylinderGeometry(8, 9, 14, 8);
      const torsoMat = createChampionMaterial(tunicColor, 0x000000, { rimStrength: 0.5 });
      const torso = new THREE.Mesh(torsoGeo, torsoMat);
      torso.position.y = 15;
      torso.castShadow = true;
      group.add(torso);

      // 2. Helmet Head with Horns
      const headGeo = new THREE.SphereGeometry(6.5, 8, 8);
      const headMat = createChampionMaterial(armorColor, 0x000000, { rimStrength: 0.4 });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 25;
      torso.add(head);

      // Horns
      const hornGeo = new THREE.ConeGeometry(2, 6, 4);
      const hornMat = createChampionMaterial(goldTrim, 0x000000);
      const leftHorn = new THREE.Mesh(hornGeo, hornMat);
      leftHorn.position.set(-6, 28, 0);
      leftHorn.rotation.z = Math.PI / 4;
      torso.add(leftHorn);
      const rightHorn = new THREE.Mesh(hornGeo, hornMat);
      rightHorn.position.set(6, 28, 0);
      rightHorn.rotation.z = -Math.PI / 4;
      torso.add(rightHorn);

      // 3. Legs
      const legGeo = new THREE.CylinderGeometry(2.5, 2.5, 9, 6);
      const legMat = createChampionMaterial(0x2d3436, 0x000000);
      const leftLeg = new THREE.Mesh(legGeo, legMat);
      leftLeg.position.set(-4.5, 5, 0);
      group.add(leftLeg);
      group.userData.leftLeg = leftLeg;

      const rightLeg = new THREE.Mesh(legGeo, legMat);
      rightLeg.position.set(4.5, 5, 0);
      group.add(rightLeg);
      group.userData.rightLeg = rightLeg;

      // 4. Shield (Left Arm)
      const shieldGeo = new THREE.CylinderGeometry(7, 7, 2, 8);
      const shieldMat = createChampionMaterial(armorColor, tunicColor, { emissiveIntensity: 0.2 });
      const shield = new THREE.Mesh(shieldGeo, shieldMat);
      shield.rotation.z = Math.PI / 2;
      shield.position.set(-11, 15, 2);
      group.add(shield);

      // 5. Short Sword (Right Arm)
      const swordGeo = new THREE.BoxGeometry(2, 16, 3);
      const swordMat = createChampionMaterial(0xdcdde1, 0x000000);
      const sword = new THREE.Mesh(swordGeo, swordMat);
      sword.position.set(11, 16, 4);
      group.add(sword);
      group.userData.weapon = sword;

    } else if (m.type === 'caster') {
      // 1. Conical Flowing Wizard Robe
      const robeGeo = new THREE.ConeGeometry(9, 22, 8);
      const robeMat = createChampionMaterial(tunicColor, 0x000000, { rimStrength: 0.6 });
      const robe = new THREE.Mesh(robeGeo, robeMat);
      robe.position.y = 12;
      robe.castShadow = true;
      group.add(robe);

      // 2. Pointed Wizard Hat
      const hatGeo = new THREE.ConeGeometry(7, 14, 8);
      const hatMat = createChampionMaterial(tunicColor, 0x000000, { rimStrength: 0.5 });
      const hat = new THREE.Mesh(hatGeo, hatMat);
      hat.position.y = 26;
      hat.rotation.x = -0.15;
      group.add(hat);

      // Glowing Eyes
      const eyeGeo = new THREE.SphereGeometry(1.5, 4, 4);
      const eyeMat = new THREE.MeshBasicMaterial({ color: isBlue ? 0x00d2d3 : 0xfffa65 });
      const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
      leftEye.position.set(-2.5, 20, 5.5);
      group.add(leftEye);
      const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
      rightEye.position.set(2.5, 20, 5.5);
      group.add(rightEye);

      // 3. Wizard Staff with Glowing Orb
      const staffGroup = new THREE.Group();
      staffGroup.position.set(9, 14, 3);

      const shaftGeo = new THREE.CylinderGeometry(1.5, 1.5, 24, 6);
      const shaftMat = createChampionMaterial(0x574b90, 0x000000);
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.y = 0;
      staffGroup.add(shaft);

      const orbGeo = new THREE.SphereGeometry(4, 8, 8);
      const orbMat = createChampionMaterial(isBlue ? 0x00d2d3 : 0xff4757, isBlue ? 0x00d2d3 : 0xff4757, { emissiveIntensity: 1.0 });
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.y = 13;
      staffGroup.add(orb);
      group.userData.orb = orb;

      group.add(staffGroup);
      group.userData.staff = staffGroup;

    } else if (m.type === 'cannon') {
      // 1. Armored Wagon Chassis
      const wagonGeo = new THREE.BoxGeometry(22, 12, 28);
      const wagonMat = createChampionMaterial(armorColor, 0x000000, { rimStrength: 0.5 });
      const wagon = new THREE.Mesh(wagonGeo, wagonMat);
      wagon.position.y = 10;
      wagon.castShadow = true;
      group.add(wagon);

      // Team banner
      const bannerGeo = new THREE.BoxGeometry(18, 3, 22);
      const bannerMat = createChampionMaterial(tunicColor, 0x000000);
      const banner = new THREE.Mesh(bannerGeo, bannerMat);
      banner.position.y = 16.5;
      group.add(banner);

      // 2. Cannon Barrel
      const barrelGeo = new THREE.CylinderGeometry(5, 6, 26, 8);
      const barrelMat = createChampionMaterial(0x2f3542, 0x000000);
      const barrel = new THREE.Mesh(barrelGeo, barrelMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 18, 8);
      group.add(barrel);

      // 3. 4 Wheels
      group.userData.wheels = [];
      const wheelGeo = new THREE.CylinderGeometry(5.5, 5.5, 3.5, 12);
      const wheelMat = createChampionMaterial(0x1e272e, 0x000000);
      const wheelPos = [
        [-12, 5.5, -9],
        [12, 5.5, -9],
        [-12, 5.5, 9],
        [12, 5.5, 9]
      ];
      wheelPos.forEach(([wx, wy, wz]) => {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, wy, wz);
        group.add(wheel);
        group.userData.wheels.push(wheel);
      });
    }

    // Apply Inverted Hull Stylized NPR Cartoon Outlines to All Minions
    this.applyInvertedHullOutline(group, THREE);

    return group;
  }

  // ==========================================================
  // 3D PROJECTILES & SKILL VFX (DISTINCTIVE LOL SKILLSHOT MODELS)
  // ==========================================================
  create3DProjectileModel(pr) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const type = pr.type || 'basic_attack';
    const colKey = pr.color || '#ff9f43';

    if (type.includes('pyro') || type.includes('fire')) {
      // Fireball Meteor Core & Tail
      const coreGeo = new THREE.SphereGeometry(12, 8, 8);
      const coreMat = createChampionMaterial(0xff3838, 0xff793f, { emissiveIntensity: 1.8 });
      const core = new THREE.Mesh(coreGeo, coreMat);
      group.add(core);

      const tailGeo = new THREE.ConeGeometry(10, 26, 8);
      const tailMat = createChampionMaterial(0xff793f, 0xffb142, { emissiveIntensity: 1.2 });
      const tail = new THREE.Mesh(tailGeo, tailMat);
      tail.rotation.x = Math.PI / 2;
      tail.position.z = -14;
      group.add(tail);
    } else if (type.includes('frost') || type.includes('ice')) {
      // Diamond-cut Frost Lance Spear
      const lanceGeo = new THREE.OctahedronGeometry(8, 0);
      const lanceMat = createChampionMaterial(0x70a1ff, 0x00d2d3, { emissiveIntensity: 1.6 });
      const lance = new THREE.Mesh(lanceGeo, lanceMat);
      lance.scale.set(0.8, 0.8, 3.5);
      group.add(lance);
      group.userData.spin = true;
    } else if (type.includes('sniper') || type.includes('laser')) {
      // Supersonic Railgun Tracer Beam
      const boltGeo = new THREE.CylinderGeometry(3, 3, 50, 8);
      const boltMat = createChampionMaterial(0x00a8ff, 0x00d2d3, { emissiveIntensity: 2.2 });
      const bolt = new THREE.Mesh(boltGeo, boltMat);
      bolt.rotation.x = Math.PI / 2;
      group.add(bolt);

      const ringGeo = new THREE.TorusGeometry(8, 1.8, 8, 16);
      const ringMat = createChampionMaterial(0x00d2d3, 0xffffff, { emissiveIntensity: 1.5 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      group.add(ring);
    } else if (type.includes('shadow') || type.includes('shuriken')) {
      // 4-Pointed Ninja Star
      const bladeMat = createChampionMaterial(0x574b90, 0x9b59b6, { emissiveIntensity: 1.2 });
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(22, 1.5, 5), bladeMat);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(5, 1.5, 22), bladeMat);
      group.add(b1);
      group.add(b2);
      group.userData.spinY = true;
    } else if (type.includes('bomb')) {
      // Cast Iron Powder Bomb
      const bombGeo = new THREE.SphereGeometry(13, 8, 8);
      const bombMat = createChampionMaterial(0x2d3436, 0x000000, { rimStrength: 0.3 });
      const bomb = new THREE.Mesh(bombGeo, bombMat);
      group.add(bomb);

      const fuseGeo = new THREE.ConeGeometry(3, 7, 6);
      const fuseMat = createChampionMaterial(0xf1c40f, 0xff4757, { emissiveIntensity: 2.0 });
      const fuse = new THREE.Mesh(fuseGeo, fuseMat);
      fuse.position.y = 14;
      group.add(fuse);
    } else if (type.includes('turret')) {
      // Heavy Arcane Tower Missile
      const plasmaGeo = new THREE.SphereGeometry(14, 10, 10);
      const plasmaMat = createChampionMaterial(new THREE.Color(colKey), new THREE.Color(colKey), { emissiveIntensity: 1.8 });
      const plasma = new THREE.Mesh(plasmaGeo, plasmaMat);
      group.add(plasma);

      const orbitGeo = new THREE.TorusGeometry(18, 2, 8, 16);
      const orbitMat = createChampionMaterial(0xffffff, new THREE.Color(colKey), { emissiveIntensity: 1.4 });
      const orbit = new THREE.Mesh(orbitGeo, orbitMat);
      group.add(orbit);
      group.userData.orbitRing = orbit;
    } else if (type.includes('cannon')) {
      // Heavy Iron Cannon Mortar Shell
      const shellGeo = new THREE.CylinderGeometry(7, 8, 18, 8);
      const shellMat = createChampionMaterial(0x3d3d3d, 0x1e272e, { rimStrength: 0.4 });
      const shell = new THREE.Mesh(shellGeo, shellMat);
      shell.rotation.x = Math.PI / 2;
      group.add(shell);
    } else {
      // Basic Attack / Minion Bolt: Sleek Energy Dart
      const dartGeo = new THREE.ConeGeometry(5, 18, 8);
      const dartMat = createChampionMaterial(new THREE.Color(colKey), new THREE.Color(colKey), { emissiveIntensity: 1.5 });
      const dart = new THREE.Mesh(dartGeo, dartMat);
      dart.rotation.x = Math.PI / 2;
      group.add(dart);
    }

    return group;
  }

  // ==========================================================
  // 3D JUNGLE MONSTERS & VISION WARDS MODELS
  // ==========================================================
  create3DScuttleCrabModel() {
    const THREE = window.THREE;
    const group = new THREE.Group();

    // 1. Carapace Shell (Teal/Emerald Toon with green rim light)
    const shellGeo = new THREE.SphereGeometry(20, 12, 10);
    const shellMat = createChampionMaterial(0x16a085, 0x000000, { rimStrength: 0.65, rimColor: 0x1abc9c });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.scale.set(1.15, 0.55, 0.95);
    shell.position.y = 11;
    shell.castShadow = true;
    group.add(shell);

    // Glowing shell crest
    const crestGeo = new THREE.CylinderGeometry(7, 10, 4, 8);
    const crestMat = createChampionMaterial(0x2ecc71, 0x1abc9c, { rimStrength: 0.8 });
    const crest = new THREE.Mesh(crestGeo, crestMat);
    crest.position.y = 17;
    group.add(crest);

    // 2. Bead Eyes
    const eyeGeo = new THREE.SphereGeometry(3.5, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xf1c40f });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-8, 14, 18);
    group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(8, 14, 18);
    group.add(rightEye);

    // 3. Crab Legs
    const legGeo = new THREE.CylinderGeometry(1.8, 1.2, 12, 6);
    const legMat = createChampionMaterial(0x117a65, 0x000000);
    const legs = [];
    [-10, 0, 10].forEach(zOffset => {
      const leftLeg = new THREE.Mesh(legGeo, legMat);
      leftLeg.position.set(-18, 5, zOffset);
      leftLeg.rotation.z = Math.PI / 3;
      group.add(leftLeg);
      legs.push(leftLeg);

      const rightLeg = new THREE.Mesh(legGeo, legMat);
      rightLeg.position.set(18, 5, zOffset);
      rightLeg.rotation.z = -Math.PI / 3;
      group.add(rightLeg);
      legs.push(rightLeg);
    });

    group.userData = { shell, legs };
    return group;
  }

  create3DElementalDragonModel() {
    const THREE = window.THREE;
    const group = new THREE.Group();

    // 1. Dragon Muscular Body / Torso
    const torsoGeo = new THREE.CylinderGeometry(16, 24, 40, 10);
    const torsoMat = createChampionMaterial(0xc0392b, 0x962d22, { rimStrength: 0.75, rimColor: 0xe74c3c });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 35;
    torso.rotation.x = Math.PI / 6;
    torso.castShadow = true;
    group.add(torso);

    // 2. Dragon Head & Horns
    const headGeo = new THREE.ConeGeometry(13, 26, 8);
    const headMat = createChampionMaterial(0x962d22, 0x78281f, { rimStrength: 0.7 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, 48, 18);
    head.rotation.x = -Math.PI / 2.8;
    group.add(head);

    // Horns
    const hornGeo = new THREE.ConeGeometry(3.5, 18, 5);
    const hornMat = createChampionMaterial(0xf39c12, 0xd35400, { rimStrength: 0.6 });
    const leftHorn = new THREE.Mesh(hornGeo, hornMat);
    leftHorn.position.set(-9, 58, 12);
    leftHorn.rotation.set(-0.4, 0, -0.5);
    group.add(leftHorn);

    const rightHorn = new THREE.Mesh(hornGeo, hornMat);
    rightHorn.position.set(9, 58, 12);
    rightHorn.rotation.set(-0.4, 0, 0.5);
    group.add(rightHorn);

    // Fiery Eyes
    const eyeGeo = new THREE.SphereGeometry(3, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffeaa7 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-6, 50, 24);
    group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(6, 50, 24);
    group.add(rightEye);

    // 3. Massive Dragon Wings
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(45, 30);
    wingShape.lineTo(40, -10);
    wingShape.lineTo(25, -5);
    wingShape.lineTo(0, 0);
    const wingGeo = new THREE.ShapeGeometry(wingShape);
    const wingMat = createChampionMaterial(0xe74c3c, 0x000000, { rimStrength: 0.8, rimColor: 0xf39c12 });

    const leftWing = new THREE.Mesh(wingGeo, wingMat);
    leftWing.position.set(-14, 42, -5);
    leftWing.rotation.set(0.3, Math.PI, 0);
    group.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeo, wingMat);
    rightWing.position.set(14, 42, -5);
    rightWing.rotation.set(0.3, 0, 0);
    group.add(rightWing);

    // 4. Tail
    const tailGeo = new THREE.CylinderGeometry(5, 1, 35, 6);
    const tail = new THREE.Mesh(tailGeo, torsoMat);
    tail.position.set(0, 20, -25);
    tail.rotation.x = -Math.PI / 3;
    group.add(tail);

    // 5. Fiery Elemental Ground Runes
    const runeGeo = new THREE.RingGeometry(48, 54, 24);
    const runeMat = new THREE.MeshBasicMaterial({ color: 0xe67e22, side: THREE.DoubleSide, transparent: true, opacity: 0.65 });
    const runeRing = new THREE.Mesh(runeGeo, runeMat);
    runeRing.rotation.x = -Math.PI / 2;
    runeRing.position.y = 1;
    group.add(runeRing);

    group.userData = { torso, leftWing, rightWing, tail, runeRing };
    return group;
  }

  create3DBaronNashorModel() {
    const THREE = window.THREE;
    const group = new THREE.Group();

    // 1. Serpentine Void Worm Torso (Segmented Deep Purple)
    const torsoGeo = new THREE.CylinderGeometry(28, 38, 70, 10);
    const torsoMat = createChampionMaterial(0x4a148c, 0x6a1b9a, { rimStrength: 0.85, rimColor: 0xba68c8 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 35;
    torso.castShadow = true;
    group.add(torso);

    // 2. Void Horned Maw / Head
    const headGeo = new THREE.ConeGeometry(24, 46, 8);
    const headMat = createChampionMaterial(0x311b92, 0x4a148c, { rimStrength: 0.9, rimColor: 0xe1bee7 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, 75, 12);
    head.rotation.x = -Math.PI / 3;
    group.add(head);

    // 3. Multi-Eyes (Glowing Neon Purple)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xe056fd });
    const eyeGeo = new THREE.SphereGeometry(3.5, 6, 6);
    for (let eIdx = -1; eIdx <= 1; eIdx += 2) {
      const eye1 = new THREE.Mesh(eyeGeo, eyeMat);
      eye1.position.set(eIdx * 9, 78, 24);
      group.add(eye1);
      const eye2 = new THREE.Mesh(eyeGeo, eyeMat);
      eye2.position.set(eIdx * 14, 82, 18);
      group.add(eye2);
    }

    // 4. Void Spines / Back Tentacles
    const spines = [];
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      const spineGeo = new THREE.ConeGeometry(3.5, 24, 5);
      const spineMat = createChampionMaterial(0x9c27b0, 0x7b1fa2, { rimStrength: 0.8 });
      const spine = new THREE.Mesh(spineGeo, spineMat);
      spine.position.set((sIdx % 2 === 0 ? -1 : 1) * 18, 40 + sIdx * 10, -14);
      spine.rotation.set(-0.5, 0, (sIdx % 2 === 0 ? -1 : 1) * 0.6);
      group.add(spine);
      spines.push(spine);
    }

    // 5. Void Ground Corruption Rune Ring
    const runeGeo = new THREE.RingGeometry(52, 60, 32);
    const runeMat = new THREE.MeshBasicMaterial({ color: 0x9b59b6, side: THREE.DoubleSide, transparent: true, opacity: 0.65 });
    const runeRing = new THREE.Mesh(runeGeo, runeMat);
    runeRing.rotation.x = -Math.PI / 2;
    runeRing.position.y = 1;
    group.add(runeRing);

    group.userData = { torso, head, spines, runeRing };
    return group;
  }

  create3DBlueBuffModel() {
    const THREE = window.THREE;
    const group = new THREE.Group();

    // Stone Golem Torso
    const torsoGeo = new THREE.BoxGeometry(28, 30, 24);
    const torsoMat = createChampionMaterial(0x2c3e50, 0x0984e3, { rimStrength: 0.7, rimColor: 0x00d2d3 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 26;
    torso.castShadow = true;
    group.add(torso);

    // Glowing Mana Rune Core
    const coreGeo = new THREE.OctahedronGeometry(8);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x00d2d3 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(0, 26, 12);
    group.add(core);

    // Stone Head
    const headGeo = new THREE.BoxGeometry(16, 14, 16);
    const head = new THREE.Mesh(headGeo, torsoMat);
    head.position.set(0, 46, 0);
    group.add(head);

    // Glowing Blue Eyes
    const eyeGeo = new THREE.SphereGeometry(2, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x70a1ff });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-4, 47, 8);
    group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(4, 47, 8);
    group.add(eyeR);

    // Stone Arms
    const armGeo = new THREE.BoxGeometry(9, 22, 10);
    const armL = new THREE.Mesh(armGeo, torsoMat);
    armL.position.set(-18, 22, 0);
    group.add(armL);
    const armR = new THREE.Mesh(armGeo, torsoMat);
    armR.position.set(18, 22, 0);
    group.add(armR);

    // Blue Ground Crest
    const crestGeo = new THREE.RingGeometry(34, 38, 24);
    const crestMat = new THREE.MeshBasicMaterial({ color: 0x0984e3, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
    const crest = new THREE.Mesh(crestGeo, crestMat);
    crest.rotation.x = -Math.PI / 2;
    crest.position.y = 1;
    group.add(crest);

    group.userData = { torso, head, core, armL, armR, crest };
    return group;
  }

  create3DRedBuffModel() {
    const THREE = window.THREE;
    const group = new THREE.Group();

    // Red Brambleback Bark Torso
    const torsoGeo = new THREE.CylinderGeometry(14, 18, 30, 8);
    const torsoMat = createChampionMaterial(0x3e1d17, 0xd63031, { rimStrength: 0.75, rimColor: 0xe17055 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 24;
    torso.castShadow = true;
    group.add(torso);

    // Burning Ember Core
    const emberGeo = new THREE.DodecahedronGeometry(7);
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff7675 });
    const ember = new THREE.Mesh(emberGeo, emberMat);
    ember.position.set(0, 24, 9);
    group.add(ember);

    // Bramble Horns / Branches
    const hornGeo = new THREE.ConeGeometry(3, 18, 5);
    const hornMat = createChampionMaterial(0x50281e, 0x000000, { rimStrength: 0.5 });
    const hornL = new THREE.Mesh(hornGeo, hornMat);
    hornL.position.set(-8, 44, 0);
    hornL.rotation.z = -0.4;
    group.add(hornL);
    const hornR = new THREE.Mesh(hornGeo, hornMat);
    hornR.position.set(8, 44, 0);
    hornR.rotation.z = 0.4;
    group.add(hornR);

    // Burning Red Crest
    const crestGeo = new THREE.RingGeometry(34, 38, 24);
    const crestMat = new THREE.MeshBasicMaterial({ color: 0xd63031, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
    const crest = new THREE.Mesh(crestGeo, crestMat);
    crest.rotation.x = -Math.PI / 2;
    crest.position.y = 1;
    group.add(crest);

    group.userData = { torso, ember, hornL, hornR, crest };
    return group;
  }

  create3DCampMonsterModel(type) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    let bodyColor = 0x27ae60;
    let rimC = 0x2ecc71;
    if (type === 'wolves') {
      bodyColor = 0x57606f;
      rimC = 0xa4b0be;
    } else if (type === 'raptors') {
      bodyColor = 0xc0392b;
      rimC = 0xe74c3c;
    } else if (type === 'krugs') {
      bodyColor = 0x7f8c8d;
      rimC = 0xbdc3c7;
    }
    const mat = createChampionMaterial(bodyColor, 0x000000, { rimStrength: 0.6, rimColor: rimC });
    const bodyGeo = (type === 'krugs') ? new THREE.DodecahedronGeometry(18) : new THREE.SphereGeometry(15, 8, 8);
    const body = new THREE.Mesh(bodyGeo, mat);
    body.position.y = 16;
    body.castShadow = true;
    group.add(body);

    const eyeGeo = new THREE.SphereGeometry(2, 5, 5);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xf1c40f });
    const eye1 = new THREE.Mesh(eyeGeo, eyeMat);
    eye1.position.set(-4, 20, 12);
    group.add(eye1);
    const eye2 = new THREE.Mesh(eyeGeo, eyeMat);
    eye2.position.set(4, 20, 12);
    group.add(eye2);

    group.userData = { body };
    return group;
  }

  create3DWardModel(ward) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const isBlue = ward.team === 'blue';
    const accent = isBlue ? 0x0984e3 : 0x2ecc71;

    // Hextech Pedestal
    const baseGeo = new THREE.CylinderGeometry(7, 10, 14, 8);
    const baseMat = createChampionMaterial(0x2f3640, 0x1e272e, { rimStrength: 0.5 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 7;
    base.castShadow = true;
    group.add(base);

    // Floating Crystal Eye
    const crystalGeo = new THREE.OctahedronGeometry(8);
    const crystalMat = createChampionMaterial(accent, accent, { rimStrength: 0.9, rimColor: 0x00d2d3 });
    const crystal = new THREE.Mesh(crystalGeo, crystalMat);
    crystal.position.y = 22;
    group.add(crystal);

    // Vision range indicator ring on ground
    const ringGeo = new THREE.RingGeometry((ward.radius || 300) - 4, (ward.radius || 300), 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: accent,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1;
    group.add(ring);

    group.userData = { crystal, ring };
    return group;
  }

  update3DJungleMonsters(jungleMonsters) {
    const THREE = window.THREE;
    if (!this.threeJungleMeshes) this.threeJungleMeshes = {};
    if (!jungleMonsters) return;

    const activeIds = new Set();
    jungleMonsters.forEach(jm => {
      activeIds.add(jm.id);
      let group = this.threeJungleMeshes[jm.id];

      if (!group) {
        if (jm.type === 'dragon') {
          group = this.create3DElementalDragonModel();
        } else if (jm.type === 'baron') {
          group = this.create3DBaronNashorModel();
        } else if (jm.type === 'buff_blue') {
          group = this.create3DBlueBuffModel();
        } else if (jm.type === 'buff_red') {
          group = this.create3DRedBuffModel();
        } else if (jm.type === 'scuttle') {
          group = this.create3DScuttleCrabModel();
        } else {
          group = this.create3DCampMonsterModel(jm.type);
        }
        this.threeJungleMeshes[jm.id] = group;
        this.scene.add(group);
      }

      group.visible = jm.isAlive;
      if (!jm.isAlive) return;

      group.position.set(jm.x, 0, jm.y);

      if (jm.type === 'dragon') {
        const flap = Math.sin(this.animationTimer * 4.5) * 0.35;
        if (group.userData.leftWing) group.userData.leftWing.rotation.z = flap;
        if (group.userData.rightWing) group.userData.rightWing.rotation.z = -flap;
        if (group.userData.tail) group.userData.tail.rotation.y = Math.sin(this.animationTimer * 2) * 0.25;
        if (group.userData.runeRing) group.userData.runeRing.rotation.z += 0.01;
      } else if (jm.type === 'baron') {
        group.position.y = Math.abs(Math.sin(this.animationTimer * 3.5)) * 4;
        if (group.userData.head) group.userData.head.rotation.y = Math.sin(this.animationTimer * 2) * 0.2;
        if (group.userData.runeRing) group.userData.runeRing.rotation.z += 0.015;
        if (group.userData.spines) {
          group.userData.spines.forEach((sp, sIdx) => {
            sp.rotation.z = (sIdx % 2 === 0 ? -1 : 1) * (0.6 + Math.sin(this.animationTimer * 4 + sIdx) * 0.15);
          });
        }
      } else if (jm.type === 'buff_blue') {
        if (group.userData.core) {
          group.userData.core.rotation.y += 0.02;
          group.userData.core.position.y = 26 + Math.sin(this.animationTimer * 4) * 2;
        }
        if (group.userData.crest) group.userData.crest.rotation.z += 0.008;
      } else if (jm.type === 'buff_red') {
        if (group.userData.ember) {
          group.userData.ember.rotation.y -= 0.03;
          group.userData.ember.position.y = 24 + Math.sin(this.animationTimer * 4) * 2;
        }
        if (group.userData.crest) group.userData.crest.rotation.z -= 0.008;
      } else if (jm.type === 'scuttle') {
        group.position.y = Math.abs(Math.sin(this.animationTimer * 8)) * 2;
        if (group.userData.legs) {
          group.userData.legs.forEach((leg, idx) => {
            leg.rotation.x = Math.sin(this.animationTimer * 12 + idx) * 0.4;
          });
        }
      } else {
        group.position.y = Math.abs(Math.sin(this.animationTimer * 5)) * 1.5;
      }
    });

    for (const id in this.threeJungleMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(this.threeJungleMeshes[id]);
        delete this.threeJungleMeshes[id];
      }
    }
  }

  update3DWards(wards) {
    const THREE = window.THREE;
    if (!this.threeWardMeshes) this.threeWardMeshes = {};

    const activeIds = new Set();
    if (wards) {
      wards.forEach(w => {
        activeIds.add(w.id);
        let group = this.threeWardMeshes[w.id];
        if (!group) {
          group = this.create3DWardModel(w);
          this.threeWardMeshes[w.id] = group;
          this.scene.add(group);
        }
        group.position.set(w.x, 0, w.y);
        if (group.userData.crystal) {
          group.userData.crystal.rotation.y += 0.03;
          group.userData.crystal.position.y = 22 + Math.sin(this.animationTimer * 3) * 2;
        }
      });
    }

    for (const id in this.threeWardMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(this.threeWardMeshes[id]);
        delete this.threeWardMeshes[id];
      }
    }
  }

  update3DProjectiles(projectiles) {
    const THREE = window.THREE;
    const activeIds = new Set();

    if (projectiles) {
      projectiles.forEach((pr, idx) => {
        const pId = `proj_${idx}`;
        activeIds.add(pId);

        let mesh = this.threeProjectileMeshes[pId];
        if (!mesh) {
          mesh = this.create3DProjectileModel(pr);
          this.threeProjectileMeshes[pId] = mesh;
          this.scene.add(mesh);
        }

        mesh.position.set(pr.x, 24, pr.y);

        // Heading rotation
        if (mesh.userData.lastX !== undefined) {
          const dx = pr.x - mesh.userData.lastX;
          const dy = pr.y - mesh.userData.lastY;
          if (Math.hypot(dx, dy) > 0.05) {
            mesh.rotation.y = -Math.atan2(dy, dx) + Math.PI / 2;
          }
        }
        mesh.userData.lastX = pr.x;
        mesh.userData.lastY = pr.y;

        if (mesh.userData.spin) mesh.rotation.z += 0.35;
        if (mesh.userData.spinY) mesh.rotation.y += 0.45;
        if (mesh.userData.orbitRing) mesh.userData.orbitRing.rotation.x += 0.15;
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
  // 3D AOE SKILL ZONES (PYRO METEOR/PILLAR, FROST GLACIAL, GUARDIAN EARTHQUAKE, DEMO MINES)
  // ==========================================================
  create3DAoeZoneMesh(z) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const radius = z.radius || 150;
    const isBlue = z.team === 'blue';
    const zoneCol = isBlue ? 0x0984e3 : 0xd63031;

    // Ground Danger Decal Ring
    const ringGeo = new THREE.RingGeometry(radius - 6, radius, 36);
    const ringMat = new THREE.MeshBasicMaterial({
      color: (z.type && (z.type.includes('meteor') || z.type.includes('flame'))) ? 0xff4757 : ((z.type && z.type.includes('glacial')) ? 0x00d2d3 : zoneCol),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.2;
    group.add(ring);
    group.userData.ring = ring;

    // Inner Translucent Fill
    const fillGeo = new THREE.CircleGeometry(radius - 6, 36);
    const fillMat = new THREE.MeshBasicMaterial({
      color: ringMat.color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.22
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 1.1;
    group.add(fill);
    group.userData.fill = fill;

    if (z.type && z.type.includes('glacial')) {
      // Ice Spikes jutting out of ground
      const spikeGeo = new THREE.ConeGeometry(8, 28, 5);
      const spikeMat = createChampionMaterial(0x70a1ff, 0x00d2d3, { emissiveIntensity: 1.5 });
      for (let s = 0; s < 7; s++) {
        const sp = new THREE.Mesh(spikeGeo, spikeMat);
        const ang = (s / 7) * Math.PI * 2;
        const dist = radius * 0.55;
        sp.position.set(Math.cos(ang) * dist, 12, Math.sin(ang) * dist);
        sp.rotation.y = ang;
        sp.castShadow = true;
        group.add(sp);
      }
    } else if (z.type && z.type.includes('minefield')) {
      // Landmine spikes
      const mineGeo = new THREE.SphereGeometry(6, 6, 6);
      const mineMat = createChampionMaterial(0x2d3436, 0xff4757, { emissiveIntensity: 1.8 });
      for (let m = 0; m < 5; m++) {
        const mm = new THREE.Mesh(mineGeo, mineMat);
        const ang = (m / 5) * Math.PI * 2;
        mm.position.set(Math.cos(ang) * (radius * 0.5), 5, Math.sin(ang) * (radius * 0.5));
        group.add(mm);
      }
    } else if (z.type && (z.type.includes('meteor') || z.type.includes('inferno'))) {
      // Falling Meteor Core in Sky
      const meteorGeo = new THREE.SphereGeometry(18, 10, 10);
      const meteorMat = createChampionMaterial(0xff4757, 0xff793f, { emissiveIntensity: 2.2 });
      const meteor = new THREE.Mesh(meteorGeo, meteorMat);
      meteor.position.y = 280;
      group.add(meteor);
      group.userData.meteor = meteor;
    }

    return group;
  }

  update3DAoeZones(aoeZones) {
    const THREE = window.THREE;
    if (!this.threeAoeMeshes) this.threeAoeMeshes = {};
    const activeIds = new Set();

    if (aoeZones) {
      aoeZones.forEach(z => {
        activeIds.add(z.id);
        let mesh = this.threeAoeMeshes[z.id];
        if (!mesh) {
          mesh = this.create3DAoeZoneMesh(z);
          this.threeAoeMeshes[z.id] = mesh;
          this.scene.add(mesh);
        }

        mesh.position.set(z.x, 0, z.y);

        // Meteor falling animation
        if (mesh.userData.meteor) {
          if (z.delayRemaining > 0) {
            mesh.userData.meteor.visible = true;
            mesh.userData.meteor.position.y = Math.max(12, z.delayRemaining * 350);
            mesh.userData.meteor.rotation.x += 0.08;
            mesh.userData.meteor.rotation.y += 0.12;
          } else {
            mesh.userData.meteor.visible = false;
          }
        }

        // Pulse warning ground ring
        if (mesh.userData.ring) {
          mesh.userData.ring.material.opacity = 0.55 + Math.sin(this.animationTimer * 12) * 0.35;
        }
      });
    }

    Object.keys(this.threeAoeMeshes).forEach(id => {
      if (!activeIds.has(id)) {
        this.scene.remove(this.threeAoeMeshes[id]);
        delete this.threeAoeMeshes[id];
      }
    });
  }

  // ==========================================================
  // 2D CANVAS OVERLAYS (HIGH-SPEED OFFSCREEN CACHED)
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

    // 4. Authentic LoL Overhead Health Bars (Screen Space Frustum Culled)
    if (gameState.players) {
      const sw = this.width;
      const sh = this.height;
      for (let i = 0; i < gameState.players.length; i++) {
        const p = gameState.players[i];
        if (!p.isAlive) continue;

        const isMe = p.id === this.localPlayerId;
        const isAlly = localPlayer ? p.team === localPlayer.team : p.team === 'blue';

        // Stealth culling for enemy health bars
        if (!isAlly && p.inBush && !p.revealed) {
          let canSeeInBush = false;
          if (localPlayer && this.mapData.bushes) {
            for (let bIdx = 0; bIdx < this.mapData.bushes.length; bIdx++) {
              const b = this.mapData.bushes[bIdx];
              if (Math.hypot(localPlayer.x - b.x, localPlayer.y - b.y) <= b.radius &&
                  Math.hypot(p.x - b.x, p.y - b.y) <= b.radius) {
                canSeeInBush = true;
                break;
              }
            }
          }
          if (!canSeeInBush && gameState.wards) {
            for (let wIdx = 0; wIdx < gameState.wards.length; wIdx++) {
              const w = gameState.wards[wIdx];
              if (w.team === (localPlayer?.team || 'blue')) {
                if (Math.hypot(p.x - w.x, p.y - w.y) <= (w.radius || 300)) {
                  canSeeInBush = true;
                  break;
                }
              }
            }
          }
          if (!canSeeInBush) continue; // Concealed in brush!
        }

        const screenPos = this.worldToScreen(p.x, p.y);
        // Frustum Culling: Skip HUD calculations for champions outside the camera view
        if (screenPos.x < -120 || screenPos.x > sw + 120 || screenPos.y < -120 || screenPos.y > sh + 120) {
          continue;
        }
        this.renderLolHealthBar(ctx, p, screenPos.x, screenPos.y - 75, isMe, isAlly);
      }
    }

    // 4-B. Authentic LoL Structures Overhead Health Bars & Plating
    if (gameState.structures) {
      const sw = this.width;
      const sh = this.height;
      for (let i = 0; i < gameState.structures.length; i++) {
        const s = gameState.structures[i];
        if (!s.isAlive) continue;
        const sp = this.worldToScreen(s.x, s.y);
        if (sp.x < -160 || sp.x > sw + 160 || sp.y < -160 || sp.y > sh + 160) continue;
        const isAlly = localPlayer ? s.team === localPlayer.team : s.team === 'blue';
        if (s.type === 'turret') {
          this.renderTurretHealthBar(ctx, s, sp.x, sp.y - 100, isAlly);
        } else if (s.type === 'inhibitor') {
          this.renderInhibitorHealthBar(ctx, s, sp.x, sp.y - 55, isAlly);
        } else if (s.type === 'nexus') {
          this.renderNexusHealthBar(ctx, s, sp.x, sp.y - 105, isAlly);
        }
      }
    }

    // 4-C. Authentic LoL Minion Overhead Health Bars (100-HP Ticks for Last-Hit Timing)
    if (gameState.minions) {
      const sw = this.width;
      const sh = this.height;
      for (let i = 0; i < gameState.minions.length; i++) {
        const m = gameState.minions[i];
        if (m.hp <= 0) continue;
        const sp = this.worldToScreen(m.x, m.y);
        if (sp.x < -60 || sp.x > sw + 60 || sp.y < -60 || sp.y > sh + 60) continue;
        const isAlly = localPlayer ? m.team === localPlayer.team : m.team === 'blue';
        this.renderMinionHealthBar(ctx, m, sp.x, sp.y - (m.type === 'cannon' ? 36 : 28), isAlly);
      }
    }

    // 4-D. Authentic Neutral Jungle Monster Health Bars (Baron, Dragon, Buffs, Scuttles, Camps)
    if (gameState.jungleMonsters) {
      const sw = this.width;
      const sh = this.height;
      for (let i = 0; i < gameState.jungleMonsters.length; i++) {
        const jm = gameState.jungleMonsters[i];
        if (!jm.isAlive) continue;
        const sp = this.worldToScreen(jm.x, jm.y);
        if (sp.x < -180 || sp.x > sw + 180 || sp.y < -180 || sp.y > sh + 180) continue;
        if (jm.type === 'dragon') {
          this.renderDragonBossBar(ctx, jm, sp.x, sp.y - 110);
        } else if (jm.type === 'baron') {
          this.renderBaronBossBar(ctx, jm, sp.x, sp.y - 120);
        } else if (jm.type === 'buff_blue' || jm.type === 'buff_red') {
          this.renderBuffMonsterBar(ctx, jm, sp.x, sp.y - 65);
        } else if (jm.type === 'scuttle') {
          this.renderScuttleHealthBar(ctx, jm, sp.x, sp.y - 38);
        } else {
          this.renderCampMonsterBar(ctx, jm, sp.x, sp.y - 45);
        }
      }
    }

    // 5. Spacebar Yellow Triangle Focus Ping (▼)
    if (this.cameraCtrl.isSpaceHeld && localPlayer) {
      const sp = this.worldToScreen(localPlayer.x, localPlayer.y);
      this.renderSpaceFocusPing2D(ctx, sp.x, sp.y - 95);
    }

    // 5-B. Skill Aim Indicator & AoE Danger Telegraphs
    this.renderSkillAimIndicator2D(ctx, localPlayer, mouseScreenPos);
    this.renderAoeTelegraphs2D(ctx, gameState.aoeZones);

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

  renderAoeTelegraphs2D(ctx, aoeZones) {
    if (!aoeZones || !aoeZones.length) return;
    for (let i = 0; i < aoeZones.length; i++) {
      const z = aoeZones[i];
      if (z.delayRemaining <= 0) continue;
      const sp = this.worldToScreen(z.x, z.y);
      const zoom = this.cameraCtrl.zoom || 1.0;
      const radPx = (z.radius || 150) * zoom * 0.85;

      ctx.save();
      // Outer red warning outline
      ctx.strokeStyle = 'rgba(235, 77, 75, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, radPx, 0, Math.PI * 2);
      ctx.stroke();

      // Clockwise warning sweep / fill
      const maxDelay = 0.8;
      const progress = Math.max(0, Math.min(1, 1 - (z.delayRemaining / maxDelay)));
      ctx.fillStyle = 'rgba(235, 77, 75, 0.28)';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, radPx * progress, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  renderSkillAimIndicator2D(ctx, localPlayer, mouseScreenPos) {
    if (!this.skillAimIndicator || !localPlayer) return;
    const aim = this.skillAimIndicator;
    const heroSp = this.worldToScreen(localPlayer.x, localPlayer.y);
    const mouseWorld = this.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);

    const dx = mouseWorld.x - localPlayer.x;
    const dy = mouseWorld.y - localPlayer.y;
    const ang = Math.atan2(dy, dx);
    const zoom = this.cameraCtrl.zoom || 1.0;
    const rangePx = (aim.range || 600) * zoom * 0.85;

    ctx.save();
    if (aim.type === 'circle') {
      const aimSp = this.worldToScreen(mouseWorld.x, mouseWorld.y);
      const radPx = (aim.radius || 140) * zoom * 0.85;

      // Max Range Perimeter
      ctx.strokeStyle = 'rgba(52, 152, 219, 0.45)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(heroSp.x, heroSp.y, rangePx, 0, Math.PI * 2);
      ctx.stroke();

      // Target Circle
      ctx.setLineDash([]);
      ctx.strokeStyle = '#00d2d3';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(aimSp.x, aimSp.y, radPx, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(0, 210, 211, 0.15)';
      ctx.beginPath();
      ctx.arc(aimSp.x, aimSp.y, radPx, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Linear Arrow Indicator
      const tipX = heroSp.x + Math.cos(ang) * rangePx;
      const tipY = heroSp.y + Math.sin(ang) * rangePx;

      ctx.strokeStyle = '#00d2d3';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(heroSp.x, heroSp.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      ctx.fillStyle = '#00d2d3';
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(ang - 0.4) * 22, tipY - Math.sin(ang - 0.4) * 22);
      ctx.lineTo(tipX - Math.cos(ang + 0.4) * 22, tipY - Math.sin(ang + 0.4) * 22);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Offscreen Canvas Cache for Nickname & Level Badge (Removes per-frame strokeText/fillText CPU latency)
  getPlayerBadge(p, isMe, isAlly) {
    const level = p.level || 1;
    const cacheKey = `${p.id}_${p.nickname}_${level}_${isMe}_${isAlly}`;
    if (this.badgeCache[cacheKey]) {
      return this.badgeCache[cacheKey];
    }

    const badgeCanvas = document.createElement('canvas');
    badgeCanvas.width = 160;
    badgeCanvas.height = 36;
    const bctx = badgeCanvas.getContext('2d');

    // Nickname
    bctx.font = 'bold 11px sans-serif';
    bctx.textAlign = 'center';
    bctx.strokeStyle = '#000000';
    bctx.lineWidth = 3;
    bctx.strokeText(p.nickname || '소환사', 80, 14);
    bctx.fillStyle = isMe ? '#f1c40f' : (isAlly ? '#74b9ff' : '#ffffff');
    bctx.fillText(p.nickname || '소환사', 80, 14);

    // Left [Level] Box
    const lvlX = 14;
    const lvlY = 17;
    bctx.fillStyle = '#0a0e17';
    bctx.strokeStyle = '#57606f';
    bctx.lineWidth = 1.5;
    bctx.fillRect(lvlX, lvlY, 18, 18);
    bctx.strokeRect(lvlX, lvlY, 18, 18);

    bctx.font = 'bold 10px sans-serif';
    bctx.fillStyle = '#ffffff';
    bctx.textAlign = 'center';
    bctx.textBaseline = 'middle';
    bctx.fillText(String(level), lvlX + 9, lvlY + 9);

    this.badgeCache[cacheKey] = badgeCanvas;
    return badgeCanvas;
  }

  renderLolHealthBar(ctx, p, x, y, isMe, isAlly) {
    const barW = 86;
    const barH = 8;
    const barX = x - barW / 2 + 10;
    const barY = y;

    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const shieldPct = Math.max(0, Math.min(1, (p.shield || 0) / p.maxHp));
    const mpPct = Math.max(0, Math.min(1, p.mp / p.maxMp));

    // Blit Pre-rendered Nickname & Level Badge via single drawImage (0ms CPU cost!)
    const badge = this.getPlayerBadge(p, isMe, isAlly);
    ctx.drawImage(badge, x - 80, barY - 20);

    // HP Bar Background & Fill
    ctx.fillStyle = '#060a10';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = isAlly ? '#2ed573' : '#ff4757';
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    // White Shield Overlay
    if (shieldPct > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillRect(barX + barW * hpPct, barY, barW * shieldPct, barH);
    }

    // Batched 100-HP & 1000-HP Dividers (Reduced from 50+ path strokes down to 2 strokes!)
    const segments = Math.floor(p.maxHp / 100);
    if (segments > 1) {
      // 100-HP Sub-ticks
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      for (let i = 1; i < segments; i++) {
        if (i % 10 === 0) continue;
        const notchX = barX + (i / segments) * barW;
        ctx.moveTo(notchX, barY);
        ctx.lineTo(notchX, barY + barH);
      }
      ctx.stroke();

      // 1000-HP Major Dividers
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 10; i < segments; i += 10) {
        const notchX = barX + (i / segments) * barW;
        ctx.moveTo(notchX, barY);
        ctx.lineTo(notchX, barY + barH);
      }
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
      // 4. Damage Bounce Physics: Lateral Scatter + Gravity Deceleration
      ft.x += (ft.vx || 0);
      ft.y += ft.vy;
      ft.vy += (ft.gravity || 0.18);

      // Elastic Scale Pop: 1.4x (Crit 1.85x) smoothly snaps to 1.0x
      if (ft.scale > 1.0) {
        ft.scale = Math.max(1.0, ft.scale - 0.045);
      }

      ft.alpha -= ft.vy > 0 ? 0.024 : 0.012;

      if (ft.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }

      const sp = this.worldToScreen(ft.x, ft.y);
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      const fontSize = Math.round(ft.size * ft.scale);
      ctx.font = `900 ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';

      if (ft.isCrit) {
        // Critical Hit Juice: Intense Red Drop Glow & Golden Text
        ctx.shadowColor = '#e74c3c';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#2c0404';
        ctx.lineWidth = 4.5;
        ctx.strokeText(ft.text, sp.x, sp.y);
        ctx.fillStyle = '#f1c40f';
        ctx.fillText(ft.text, sp.x, sp.y);
      } else {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3.5;
        ctx.strokeText(ft.text, sp.x, sp.y);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, sp.x, sp.y);
      }
      ctx.restore();
    }
  }

  renderMinimap(gameState, localPlayer) {
    const miniCanvas = document.getElementById('minimap-canvas');
    if (!miniCanvas) return;
    const mctx = miniCanvas.getContext('2d');
    if (!mctx) return;

    // Throttle minimap canvas repainting to ~22 FPS (45ms interval) to save CPU rasterization
    const now = performance.now();
    if (now - this.minimapLastDrawTime < 45) return;
    this.minimapLastDrawTime = now;

    const mw = miniCanvas.width;
    const mh = miniCanvas.height;
    const mapW = this.mapData.width || 2400;
    const mapH = this.mapData.height || 1600;

    if (this.mapData.isSummonersRift) {
      // 1. Summoner's Rift Dark Terrain
      mctx.fillStyle = '#08120b';
      mctx.fillRect(0, 0, mw, mh);

      const toMx = (wx) => (wx / mapW) * mw;
      const toMy = (wy) => (wy / mapH) * mh;

      // 2. Diagonal River (runs from upper-left to lower-right)
      mctx.save();
      mctx.strokeStyle = '#0e413a';
      mctx.lineWidth = 14;
      mctx.lineCap = 'round';
      mctx.beginPath();
      mctx.moveTo(toMx(500), toMy(500));
      mctx.lineTo(toMx(2700), toMy(2700));
      mctx.stroke();

      mctx.strokeStyle = '#16a085';
      mctx.lineWidth = 8;
      mctx.beginPath();
      mctx.moveTo(toMx(520), toMy(520));
      mctx.lineTo(toMx(2680), toMy(2680));
      mctx.stroke();

      // Baron Pit Alcove (Upper-Left River at 950, 950)
      mctx.fillStyle = '#1c102b';
      mctx.beginPath();
      mctx.arc(toMx(950), toMy(950), 9, 0, Math.PI * 2);
      mctx.fill();
      mctx.strokeStyle = '#8e44ad';
      mctx.lineWidth = 1;
      mctx.stroke();

      // Dragon Pit Alcove (Lower-Right River at 2250, 2250)
      mctx.fillStyle = '#2b140c';
      mctx.beginPath();
      mctx.arc(toMx(2250), toMy(2250), 9, 0, Math.PI * 2);
      mctx.fill();
      mctx.strokeStyle = '#d35400';
      mctx.lineWidth = 1;
      mctx.stroke();
      mctx.restore();

      // 3. Three Lanes (Outer stone curb + inner road)
      const drawMiniLane = (pts) => {
        mctx.save();
        mctx.strokeStyle = '#1e282c';
        mctx.lineWidth = 8;
        mctx.lineCap = 'round';
        mctx.lineJoin = 'round';
        mctx.beginPath();
        pts.forEach((pt, idx) => {
          const mx = toMx(pt.x);
          const my = toMy(pt.y);
          if (idx === 0) mctx.moveTo(mx, my);
          else mctx.lineTo(mx, my);
        });
        mctx.stroke();

        mctx.strokeStyle = '#37474d';
        mctx.lineWidth = 4.5;
        mctx.stroke();
        mctx.restore();
      };

      const topPts = [
        { x: 480, y: 2720 },
        { x: 400, y: 2400 },
        { x: 500, y: 1200 },
        { x: 650, y: 650 },
        { x: 1200, y: 500 },
        { x: 2400, y: 400 },
        { x: 2720, y: 480 }
      ];
      const botPts = [
        { x: 480, y: 2720 },
        { x: 800, y: 2800 },
        { x: 2000, y: 2700 },
        { x: 2550, y: 2550 },
        { x: 2700, y: 2000 },
        { x: 2800, y: 800 },
        { x: 2720, y: 480 }
      ];
      const midPts = [
        { x: 480, y: 2720 },
        { x: 1600, y: 1600 },
        { x: 2720, y: 480 }
      ];

      drawMiniLane(topPts);
      drawMiniLane(botPts);
      drawMiniLane(midPts);

      // Bushes
      if (this.mapData.bushes) {
        mctx.fillStyle = 'rgba(46, 204, 113, 0.45)';
        for (let bIdx = 0; bIdx < this.mapData.bushes.length; bIdx++) {
          const b = this.mapData.bushes[bIdx];
          const bx = toMx(b.x);
          const by = toMy(b.y);
          const br = Math.max(2, (b.radius / mapW) * mw);
          mctx.beginPath();
          mctx.arc(bx, by, br, 0, Math.PI * 2);
          mctx.fill();
        }
      }

      // Bases (Blue Bottom-Left, Red Top-Right)
      const blueBaseX = toMx(450);
      const blueBaseY = toMy(2750);
      const redBaseX = toMx(2750);
      const redBaseY = toMy(450);

      mctx.fillStyle = 'rgba(9, 132, 227, 0.45)';
      mctx.beginPath();
      mctx.arc(blueBaseX, blueBaseY, 13, 0, Math.PI * 2);
      mctx.fill();
      mctx.strokeStyle = '#0984e3';
      mctx.lineWidth = 1.5;
      mctx.stroke();

      mctx.fillStyle = 'rgba(214, 48, 49, 0.45)';
      mctx.beginPath();
      mctx.arc(redBaseX, redBaseY, 13, 0, Math.PI * 2);
      mctx.fill();
      mctx.strokeStyle = '#d63031';
      mctx.lineWidth = 1.5;
      mctx.stroke();
    } else {
      // Linear ARAM Map Base
      mctx.fillStyle = '#0a150e';
      mctx.fillRect(0, 0, mw, mh);

      // River (Vertical center at X=1200)
      const riverX = (1200 / mapW) * mw;
      mctx.fillStyle = '#0e413a';
      mctx.fillRect(riverX - 8, 0, 16, mh);
      mctx.fillStyle = '#16a085';
      mctx.fillRect(riverX - 4, 0, 8, mh);

      // Mid Lane (Horizontal center at Y=800)
      const laneY = (800 / mapH) * mh;
      mctx.fillStyle = '#1e282c';
      mctx.fillRect(0, laneY - 8, mw, 16);
      mctx.fillStyle = '#37474d';
      mctx.fillRect(0, laneY - 5, mw, 10);

      // Bases (Blue Left X:260, Red Right X:2140)
      const blueBaseX = (260 / mapW) * mw;
      const redBaseX = (2140 / mapW) * mw;

      mctx.fillStyle = 'rgba(9, 132, 227, 0.45)';
      mctx.beginPath();
      mctx.arc(blueBaseX, laneY, 14, 0, Math.PI * 2);
      mctx.fill();
      mctx.strokeStyle = '#0984e3';
      mctx.lineWidth = 1.5;
      mctx.stroke();

      mctx.fillStyle = 'rgba(214, 48, 49, 0.45)';
      mctx.beginPath();
      mctx.arc(redBaseX, laneY, 14, 0, Math.PI * 2);
      mctx.fill();
      mctx.strokeStyle = '#d63031';
      mctx.lineWidth = 1.5;
      mctx.stroke();
    }

    // 30 Structures Matrix on Minimap
    if (gameState.structures) {
      for (let sIdx = 0; sIdx < gameState.structures.length; sIdx++) {
        const s = gameState.structures[sIdx];
        if (!s.isAlive) continue;
        const sx = (s.x / mapW) * mw;
        const sy = (s.y / mapH) * mh;
        const isBlue = s.team === 'blue';
        const teamColor = isBlue ? '#0984e3' : '#d63031';
        const invulnColor = isBlue ? '#4a6984' : '#854a4a';

        if (s.type === 'nexus') {
          // Nexus: Diamond with Gold Border
          mctx.fillStyle = s.isInvulnerable ? invulnColor : teamColor;
          mctx.beginPath();
          mctx.moveTo(sx, sy - 5.5);
          mctx.lineTo(sx + 5.5, sy);
          mctx.lineTo(sx, sy + 5.5);
          mctx.lineTo(sx - 5.5, sy);
          mctx.closePath();
          mctx.fill();
          mctx.strokeStyle = '#f1c40f';
          mctx.lineWidth = 1.2;
          mctx.stroke();
        } else if (s.type === 'inhibitor') {
          // Inhibitor: Small Diamond
          mctx.fillStyle = s.isInvulnerable ? invulnColor : (isBlue ? '#00d2d3' : '#ff4757');
          mctx.beginPath();
          mctx.moveTo(sx, sy - 3.5);
          mctx.lineTo(sx + 3.5, sy);
          mctx.lineTo(sx, sy + 3.5);
          mctx.lineTo(sx - 3.5, sy);
          mctx.closePath();
          mctx.fill();
          mctx.strokeStyle = s.isInvulnerable ? '#f1c40f' : (isBlue ? '#70a1ff' : '#ff6b81');
          mctx.lineWidth = 1;
          mctx.stroke();
        } else {
          // Turret: Square
          mctx.fillStyle = s.isInvulnerable ? invulnColor : teamColor;
          mctx.fillRect(sx - 2.5, sy - 2.5, 5, 5);
          mctx.strokeStyle = s.isInvulnerable ? '#f1c40f' : '#ffffff';
          mctx.lineWidth = 1;
          mctx.strokeRect(sx - 2.5, sy - 2.5, 5, 5);
        }
      }
    }

    // Minions (Marching waves on minimap)
    if (gameState.minions) {
      for (let i = 0; i < gameState.minions.length; i++) {
        const m = gameState.minions[i];
        if (m.hp <= 0) continue;
        const mx = (m.x / mapW) * mw;
        const my = (m.y / mapH) * mh;
        const isSuper = m.type === 'super';
        mctx.fillStyle = m.team === 'blue' ? '#70a1ff' : '#ff6b81';
        if (isSuper) {
          mctx.fillRect(mx - 2.5, my - 2.5, 5, 5);
          mctx.strokeStyle = '#f1c40f';
          mctx.lineWidth = 1;
          mctx.strokeRect(mx - 2.5, my - 2.5, 5, 5);
        } else {
          mctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
        }
      }
    }

    // Champions
    if (gameState.players) {
      for (const p of gameState.players) {
        if (!p.isAlive) continue;
        const isMe = p.id === this.localPlayerId;
        const isAlly = localPlayer ? p.team === localPlayer.team : p.team === 'blue';

        // Minimap stealth culling
        if (!isAlly && p.inBush && !p.revealed) {
          let canSeeInBush = false;
          if (localPlayer && this.mapData.bushes) {
            for (let bIdx = 0; bIdx < this.mapData.bushes.length; bIdx++) {
              const b = this.mapData.bushes[bIdx];
              if (Math.hypot(localPlayer.x - b.x, localPlayer.y - b.y) <= b.radius &&
                  Math.hypot(p.x - b.x, p.y - b.y) <= b.radius) {
                canSeeInBush = true;
                break;
              }
            }
          }
          if (!canSeeInBush && gameState.wards) {
            for (let wIdx = 0; wIdx < gameState.wards.length; wIdx++) {
              const w = gameState.wards[wIdx];
              if (w.team === (localPlayer?.team || 'blue')) {
                if (Math.hypot(p.x - w.x, p.y - w.y) <= (w.radius || 300)) {
                  canSeeInBush = true;
                  break;
                }
              }
            }
          }
          if (!canSeeInBush) continue; // Hidden in brush!
        }

        const px = (p.x / mapW) * mw;
        const py = (p.y / mapH) * mh;

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

    // Jungle Monsters on minimap
    if (gameState.jungleMonsters) {
      for (let jIdx = 0; jIdx < gameState.jungleMonsters.length; jIdx++) {
        const jm = gameState.jungleMonsters[jIdx];
        if (!jm.isAlive) continue;
        const jx = (jm.x / mapW) * mw;
        const jy = (jm.y / mapH) * mh;
        if (jm.type === 'baron') {
          mctx.fillStyle = '#9b59b6';
          mctx.beginPath();
          mctx.arc(jx, jy, 5, 0, Math.PI * 2);
          mctx.fill();
          mctx.strokeStyle = '#e056fd';
          mctx.lineWidth = 1.5;
          mctx.stroke();
        } else if (jm.type === 'dragon') {
          mctx.fillStyle = '#e67e22';
          mctx.beginPath();
          mctx.arc(jx, jy, 4.5, 0, Math.PI * 2);
          mctx.fill();
          mctx.strokeStyle = '#f39c12';
          mctx.lineWidth = 1.2;
          mctx.stroke();
        } else if (jm.type === 'buff_blue') {
          mctx.fillStyle = '#0984e3';
          mctx.beginPath();
          mctx.arc(jx, jy, 3.5, 0, Math.PI * 2);
          mctx.fill();
          mctx.strokeStyle = '#00d2d3';
          mctx.lineWidth = 1;
          mctx.stroke();
        } else if (jm.type === 'buff_red') {
          mctx.fillStyle = '#d63031';
          mctx.beginPath();
          mctx.arc(jx, jy, 3.5, 0, Math.PI * 2);
          mctx.fill();
          mctx.strokeStyle = '#e17055';
          mctx.lineWidth = 1;
          mctx.stroke();
        } else if (jm.type === 'scuttle') {
          mctx.fillStyle = '#1abc9c';
          mctx.beginPath();
          mctx.arc(jx, jy, 2.8, 0, Math.PI * 2);
          mctx.fill();
        } else {
          mctx.fillStyle = '#bdc3c7';
          mctx.beginPath();
          mctx.arc(jx, jy, 2.2, 0, Math.PI * 2);
          mctx.fill();
        }
      }
    }

    // Friendly Vision Wards on minimap
    if (gameState.wards) {
      for (const w of gameState.wards) {
        if (w.team === (localPlayer?.team || 'blue')) {
          const wx = (w.x / mapW) * mw;
          const wy = (w.y / mapH) * mh;
          mctx.fillStyle = '#2ecc71';
          mctx.beginPath();
          mctx.arc(wx, wy, 2.5, 0, Math.PI * 2);
          mctx.fill();
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

  // ==========================================================
  // AUTHENTIC LOL TURRET & MINION OVERHEAD HEALTH BARS
  // ==========================================================
  renderTurretHealthBar(ctx, s, x, y, isAlly) {
    const barW = 120;
    const barH = 10;
    const barX = x - barW / 2;
    const barY = y;
    const hpPct = Math.max(0, Math.min(1, s.hp / s.maxHp));

    // Outer Dark Bevel Frame
    ctx.fillStyle = '#060a10';
    ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

    // HP Fill (dimmed grey if invulnerable)
    ctx.fillStyle = isAlly ? '#2ed573' : (s.isInvulnerable ? '#718093' : '#ff4757');
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    // 5 Turret Plating Dividers
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      const notchX = barX + (i / 5) * barW;
      ctx.moveTo(notchX, barY);
      ctx.lineTo(notchX, barY + barH);
    }
    ctx.stroke();

    // Golden Border
    ctx.strokeStyle = s.isInvulnerable ? '#f1c40f' : '#c89b3c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(barX, barY, barW, barH);

    // Name & HP Text with Invulnerability Lock
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = s.isInvulnerable ? '#f1c40f' : '#f0e6d2';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    const lockTxt = s.isInvulnerable ? ' 🔒 [무적]' : '';
    const txt = `${s.name} (${s.hp}/${s.maxHp})${lockTxt}`;
    ctx.strokeText(txt, x, barY - 4);
    ctx.fillText(txt, x, barY - 4);
  }

  renderInhibitorHealthBar(ctx, s, x, y, isAlly) {
    const barW = 100;
    const barH = 9;
    const barX = x - barW / 2;
    const barY = y;
    const hpPct = Math.max(0, Math.min(1, s.hp / s.maxHp));

    ctx.fillStyle = '#060a10';
    ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

    ctx.fillStyle = isAlly ? '#2ed573' : (s.isInvulnerable ? '#718093' : '#ff4757');
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    ctx.strokeStyle = s.isInvulnerable ? '#f1c40f' : '#c89b3c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = s.isInvulnerable ? '#f1c40f' : '#f0e6d2';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    const lockTxt = s.isInvulnerable ? ' 🔒 [무적]' : '';
    const txt = `💎 ${s.name} (${s.hp}/${s.maxHp})${lockTxt}`;
    ctx.strokeText(txt, x, barY - 4);
    ctx.fillText(txt, x, barY - 4);
  }

  renderNexusHealthBar(ctx, s, x, y, isAlly) {
    const barW = 160;
    const barH = 12;
    const barX = x - barW / 2;
    const barY = y;
    const hpPct = Math.max(0, Math.min(1, s.hp / s.maxHp));

    ctx.fillStyle = '#060a10';
    ctx.fillRect(barX - 3, barY - 3, barW + 6, barH + 6);

    ctx.fillStyle = isAlly ? '#2ed573' : (s.isInvulnerable ? '#718093' : '#ff4757');
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#f1c40f';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    const lockTxt = s.isInvulnerable ? ' 🔒 [무적]' : '';
    const txt = `👑 ${s.name} (${s.hp}/${s.maxHp})${lockTxt}`;
    ctx.strokeText(txt, x, barY - 5);
    ctx.fillText(txt, x, barY - 5);
  }

  renderMinionHealthBar(ctx, m, x, y, isAlly) {
    const barW = 34;
    const barH = 4.5;
    const barX = x - barW / 2;
    const barY = y;
    const hpPct = Math.max(0, Math.min(1, m.hp / m.maxHp));

    // Outer Border
    ctx.fillStyle = '#04070c';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

    // HP Fill
    ctx.fillStyle = isAlly ? '#2ed573' : '#ff4757';
    ctx.fillRect(barX, barY, barW * hpPct, barH);

    // 100-HP Ticks for Last-Hit Judgment
    const segments = Math.floor(m.maxHp / 100);
    if (segments > 1) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      for (let i = 1; i < segments; i++) {
        const notchX = barX + (i / segments) * barW;
        ctx.moveTo(notchX, barY);
        ctx.lineTo(notchX, barY + barH);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(barX, barY, barW, barH);
  }

  // ==========================================================
  // NEUTRAL JUNGLE MONSTERS OVERHEAD HEALTH BARS
  // ==========================================================
  renderBaronBossBar(ctx, baron, cx, cy) {
    const barW = 200;
    const barH = 15;
    const hpRatio = Math.max(0, Math.min(1, baron.hp / baron.maxHp));

    ctx.save();
    ctx.fillStyle = 'rgba(10, 8, 20, 0.92)';
    ctx.fillRect(cx - barW / 2 - 4, cy - 15, barW + 8, barH + 20);
    ctx.strokeStyle = '#9b59b6';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - barW / 2 - 4, cy - 15, barW + 8, barH + 20);

    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#e056fd';
    ctx.textAlign = 'center';
    ctx.fillText(`👑 ${baron.name} (Baron Nashor)`, cx, cy - 3);

    ctx.fillStyle = '#2c1e38';
    ctx.fillRect(cx - barW / 2, cy, barW, barH);

    const fillGrad = ctx.createLinearGradient(cx - barW / 2, cy, cx + barW / 2, cy);
    fillGrad.addColorStop(0, '#8e44ad');
    fillGrad.addColorStop(1, '#e056fd');
    ctx.fillStyle = fillGrad;
    ctx.fillRect(cx - barW / 2, cy, barW * hpRatio, barH);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.lineWidth = 1;
    const step = barW / 9;
    for (let t = 1; t < 9; t++) {
      ctx.beginPath();
      ctx.moveTo(cx - barW / 2 + t * step, cy);
      ctx.lineTo(cx - barW / 2 + t * step, cy + barH);
      ctx.stroke();
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`${baron.hp} / ${baron.maxHp}`, cx, cy + barH - 3);
    ctx.restore();
  }

  renderDragonBossBar(ctx, dragon, cx, cy) {
    const barW = 180;
    const barH = 14;
    const hpRatio = Math.max(0, Math.min(1, dragon.hp / dragon.maxHp));

    ctx.save();
    // Backdrop frame
    ctx.fillStyle = 'rgba(10, 15, 25, 0.9)';
    ctx.fillRect(cx - barW / 2 - 4, cy - 14, barW + 8, barH + 18);
    ctx.strokeStyle = '#f39c12';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - barW / 2 - 4, cy - 14, barW + 8, barH + 18);

    // Title with Dragon Crest
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#f1c40f';
    ctx.textAlign = 'center';
    ctx.fillText(`🐉 ${dragon.name}`, cx, cy - 3);

    // HP Bar Frame
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(cx - barW / 2, cy, barW, barH);

    // HP Bar Fill (Fiery Gradient)
    const fillGrad = ctx.createLinearGradient(cx - barW / 2, cy, cx + barW / 2, cy);
    fillGrad.addColorStop(0, '#e74c3c');
    fillGrad.addColorStop(1, '#f39c12');
    ctx.fillStyle = fillGrad;
    ctx.fillRect(cx - barW / 2, cy, barW * hpRatio, barH);

    // 100-HP Ticks
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1;
    const step = barW / 10;
    for (let t = 1; t < 10; t++) {
      ctx.beginPath();
      ctx.moveTo(cx - barW / 2 + t * step, cy);
      ctx.lineTo(cx - barW / 2 + t * step, cy + barH);
      ctx.stroke();
    }

    // Text: Current HP / Max HP
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`${dragon.hp} / ${dragon.maxHp}`, cx, cy + barH - 3);
    ctx.restore();
  }

  renderBuffMonsterBar(ctx, monster, cx, cy) {
    const barW = 100;
    const barH = 8;
    const hpRatio = Math.max(0, Math.min(1, monster.hp / monster.maxHp));
    const isBlue = monster.type === 'buff_blue';

    ctx.save();
    ctx.fillStyle = 'rgba(10, 15, 25, 0.88)';
    ctx.fillRect(cx - barW / 2 - 2, cy - 12, barW + 4, barH + 15);

    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = isBlue ? '#70a1ff' : '#ff6b81';
    ctx.textAlign = 'center';
    ctx.fillText(monster.name, cx, cy - 3);

    ctx.fillStyle = '#222f3e';
    ctx.fillRect(cx - barW / 2, cy, barW, barH);

    ctx.fillStyle = isBlue ? '#0984e3' : '#d63031';
    ctx.fillRect(cx - barW / 2, cy, barW * hpRatio, barH);

    ctx.strokeStyle = isBlue ? '#00d2d3' : '#ff4757';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - barW / 2, cy, barW, barH);
    ctx.restore();
  }

  renderCampMonsterBar(ctx, monster, cx, cy) {
    const barW = 60;
    const barH = 5.5;
    const hpRatio = Math.max(0, Math.min(1, monster.hp / monster.maxHp));

    ctx.save();
    ctx.fillStyle = 'rgba(10, 15, 25, 0.8)';
    ctx.fillRect(cx - barW / 2 - 2, cy - 10, barW + 4, barH + 12);

    ctx.font = 'bold 8px sans-serif';
    ctx.fillStyle = '#bdc3c7';
    ctx.textAlign = 'center';
    ctx.fillText(monster.name, cx, cy - 3);

    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(cx - barW / 2, cy, barW, barH);

    ctx.fillStyle = '#1abc9c';
    ctx.fillRect(cx - barW / 2, cy, barW * hpRatio, barH);

    ctx.strokeStyle = '#34495e';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(cx - barW / 2, cy, barW, barH);
    ctx.restore();
  }

  renderScuttleHealthBar(ctx, scuttle, cx, cy) {
    const barW = 76;
    const barH = 7;
    const hpRatio = Math.max(0, Math.min(1, scuttle.hp / scuttle.maxHp));

    ctx.save();
    ctx.fillStyle = 'rgba(10, 15, 25, 0.85)';
    ctx.fillRect(cx - barW / 2 - 2, cy - 11, barW + 4, barH + 13);

    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = '#1abc9c';
    ctx.textAlign = 'center';
    ctx.fillText(scuttle.name, cx, cy - 2);

    ctx.fillStyle = '#34495e';
    ctx.fillRect(cx - barW / 2, cy, barW, barH);

    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(cx - barW / 2, cy, barW * hpRatio, barH);
    ctx.restore();
  }
}

// Attach to window and globalThis for zero-failure accessibility
window.GameRenderer = GameRenderer;
window.MobaRenderer = GameRenderer;
globalThis.GameRenderer = GameRenderer;
export { GameRenderer };
