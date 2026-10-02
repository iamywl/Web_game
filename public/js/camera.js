/**
 * camera.js
 * League of Legends Authoritative Camera Controller
 * Features:
 *  - Free Camera vs Locked Camera (toggled with 'Y' key)
 *  - Spacebar hold to focus local player + overhead indicator
 *  - Mouse Edge Panning (scrolls when cursor hits screen borders)
 *  - Smart Semi-Locked Cursor Bias (offsets view ~22% towards cursor for skillshots)
 *  - Minimap Click & Drag Camera Navigation
 *  - Mouse Wheel Zooming (0.7x ~ 1.35x) with smooth spring interpolation
 *  - Middle-Mouse Button Drag Panning
 *  - Screen Shake Trauma Damping
 */

class CameraController {
  constructor(config = {}) {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    // World map bounds
    this.mapWidth = config.mapWidth || 2400;
    this.mapHeight = config.mapHeight || 1600;

    // Position (top-left of viewport in world coordinates)
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;

    // Zoom level (1.0 = standard, 0.75 = tactical wide, 1.3 = close combat)
    this.zoom = 1.0;
    this.targetZoom = 1.0;
    this.minZoom = 0.70;
    this.maxZoom = 1.35;

    // Camera Mode: 'LOCKED' or 'FREE'
    this.mode = 'LOCKED'; // Default like League of Legends new player / toggleable

    // States
    this.isSpaceHeld = false;
    this.isMiddleDragging = false;
    this.lastMiddleMouse = { x: 0, y: 0 };

    // Edge panning settings
    this.edgePanMargin = 32; // px from screen edge
    this.edgePanSpeed = 1250; // px/sec
    this.isMouseInWindow = true;

    // Semi-lock cursor bias (when in LOCKED mode, bias view toward mouse)
    this.cursorBiasFactor = 0.22; // 22% of vector from center to mouse
    this.maxCursorBiasX = 260;
    this.maxCursorBiasY = 190;

    // Screen Shake
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;

    // Event listeners
    this.bindEvents();
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
  }

  setMapSize(w, h) {
    this.mapWidth = w;
    this.mapHeight = h;
  }

  toggleLock() {
    this.mode = this.mode === 'LOCKED' ? 'FREE' : 'LOCKED';
    return this.mode;
  }

  setMode(mode) {
    if (mode === 'LOCKED' || mode === 'FREE') {
      this.mode = mode;
    }
  }

  addScreenShake(intensity = 6, duration = 0.25) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
  }

  // Snap immediately to position (e.g. game start or death)
  snapTo(worldX, worldY) {
    const halfViewW = (this.width / this.zoom) / 2;
    const halfViewH = (this.height / this.zoom) / 2;
    this.x = worldX - halfViewW;
    this.y = worldY - halfViewH;
    this.targetX = this.x;
    this.targetY = this.y;
    this.clampToBounds();
  }

  // Smoothly set target to world coordinates (e.g. minimap click)
  panTo(worldX, worldY) {
    const halfViewW = (this.width / this.zoom) / 2;
    const halfViewH = (this.height / this.zoom) / 2;
    this.targetX = worldX - halfViewW;
    this.targetY = worldY - halfViewH;
  }

  onWheel(deltaY) {
    const zoomStep = 0.08;
    if (deltaY > 0) {
      this.targetZoom = Math.max(this.minZoom, this.targetZoom - zoomStep);
    } else {
      this.targetZoom = Math.min(this.maxZoom, this.targetZoom + zoomStep);
    }
  }

  onMiddleMouseDown(screenX, screenY) {
    this.isMiddleDragging = true;
    this.lastMiddleMouse = { x: screenX, y: screenY };
  }

  onMiddleMouseMove(screenX, screenY) {
    if (!this.isMiddleDragging) return;
    const dx = (screenX - this.lastMiddleMouse.x) / this.zoom;
    const dy = (screenY - this.lastMiddleMouse.y) / this.zoom;
    this.targetX -= dx;
    this.targetY -= dy;
    this.lastMiddleMouse = { x: screenX, y: screenY };
  }

  onMiddleMouseUp() {
    this.isMiddleDragging = false;
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.resize(window.innerWidth, window.innerHeight);
    });

    document.addEventListener('mouseleave', () => {
      this.isMouseInWindow = false;
    });

    document.addEventListener('mouseenter', () => {
      this.isMouseInWindow = true;
    });

    // Middle-mouse drag handling
    window.addEventListener('mousedown', (e) => {
      if (e.button === 1) { // Middle click
        e.preventDefault();
        this.onMiddleMouseDown(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isMiddleDragging) {
        this.onMiddleMouseMove(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) {
        this.onMiddleMouseUp();
      }
    });

    // Mouse wheel zoom
    window.addEventListener('wheel', (e) => {
      // Only zoom if over the game viewport, not inside menus
      if (e.target.closest('#screen-game') || e.target.tagName === 'CANVAS') {
        e.preventDefault();
        this.onWheel(e.deltaY);
      }
    }, { passive: false });
  }

  // ==========================================================
  // FRAME UPDATE (Called each 60 FPS frame)
  // ==========================================================
  update(dt, localPlayer, mouseScreenPos) {
    dt = Math.min(dt || 0.0166, 0.05);

    // 1. Zoom Spring Smoothing
    this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-14 * dt));

    const viewW = this.width / this.zoom;
    const viewH = this.height / this.zoom;
    const halfViewW = viewW / 2;
    const halfViewH = viewH / 2;

    // 2. Camera Positioning Mode
    if (this.isSpaceHeld && localPlayer) {
      // Spacebar is actively held down: snap to local player with smooth spring
      this.targetX = localPlayer.x - halfViewW;
      this.targetY = localPlayer.y - halfViewH;
    } else if (this.mode === 'LOCKED' && localPlayer) {
      // Locked Mode with Smart Semi-Locked Cursor Bias
      let biasX = 0;
      let biasY = 0;
      if (mouseScreenPos) {
        const centerScreenX = this.width / 2;
        const centerScreenY = this.height / 2;
        const dx = mouseScreenPos.x - centerScreenX;
        const dy = mouseScreenPos.y - centerScreenY;
        biasX = Math.max(-this.maxCursorBiasX, Math.min(this.maxCursorBiasX, dx * this.cursorBiasFactor));
        biasY = Math.max(-this.maxCursorBiasY, Math.min(this.maxCursorBiasY, dy * this.cursorBiasFactor));
      }

      this.targetX = localPlayer.x + biasX - halfViewW;
      this.targetY = localPlayer.y + biasY - halfViewH;
    } else if (this.mode === 'FREE') {
      // Free Mode: Mouse Edge Panning
      if (this.isMouseInWindow && mouseScreenPos && !this.isMiddleDragging) {
        let panVx = 0;
        let panVy = 0;

        if (mouseScreenPos.x <= this.edgePanMargin) {
          panVx -= 1;
        } else if (mouseScreenPos.x >= this.width - this.edgePanMargin) {
          panVx += 1;
        }

        if (mouseScreenPos.y <= this.edgePanMargin) {
          panVy -= 1;
        } else if (mouseScreenPos.y >= this.height - this.edgePanMargin) {
          panVy += 1;
        }

        if (panVx !== 0 || panVy !== 0) {
          // Normalize diagonal panning
          const len = Math.hypot(panVx, panVy);
          panVx /= len;
          panVy /= len;

          const panAmount = (this.edgePanSpeed / this.zoom) * dt;
          this.targetX += panVx * panAmount;
          this.targetY += panVy * panAmount;
        }
      }
    }

    // 3. Clamp target to world boundaries (with soft edge margin)
    this.clampToBounds();

    // 4. Smooth Spring Lerp Position
    const lerpRate = this.isSpaceHeld ? 16 : 10;
    this.x += (this.targetX - this.x) * (1 - Math.exp(-lerpRate * dt));
    this.y += (this.targetY - this.y) * (1 - Math.exp(-lerpRate * dt));

    // 5. Screen Shake Trauma Damping
    if (this.shakeDuration > 0) {
      this.shakeDuration -= dt;
      this.shakeOffsetX = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeOffsetY = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 20);
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }
  }

  clampToBounds() {
    const viewW = this.width / this.zoom;
    const viewH = this.height / this.zoom;
    const margin = 120; // Allow slight padding around map perimeter
    const minX = -margin;
    const maxX = Math.max(0, this.mapWidth - viewW + margin);
    const minY = -margin;
    const maxY = Math.max(0, this.mapHeight - viewH + margin);

    this.targetX = Math.max(minX, Math.min(maxX, this.targetX));
    this.targetY = Math.max(minY, Math.min(maxY, this.targetY));
  }

  // ==========================================================
  // COORDINATE CONVERSIONS
  // ==========================================================
  screenToWorld(screenX, screenY) {
    return {
      x: this.x + screenX / this.zoom,
      y: this.y + screenY / this.zoom
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: (worldX - this.x) * this.zoom + this.shakeOffsetX,
      y: (worldY - this.y) * this.zoom + this.shakeOffsetY
    };
  }

  // Current visible world bounding box for frustum culling & minimap box
  getViewportBounds() {
    const viewW = this.width / this.zoom;
    const viewH = this.height / this.zoom;
    return {
      x: this.x,
      y: this.y,
      width: viewW,
      height: viewH,
      right: this.x + viewW,
      bottom: this.y + viewH
    };
  }
}

// Attach to window
window.CameraController = CameraController;
