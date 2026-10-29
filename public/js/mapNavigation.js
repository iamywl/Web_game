/* Shared by Node and the browser: the extracted Map11 grid is the only terrain
 * authority. Search buffers and collision results are reused, paths are created
 * only on commands/replanning, never on each movement step. */
(function (root) {
  'use strict';
  class MapNavigation {
    constructor(data) {
      this.data = data;
      this.cols = data.cols; this.rows = data.rows; this.cell = data.cellSize;
      this.ox = data.originX || 0; this.oy = data.originY || 0;
      this.walkable = Uint8Array.from(data.walkable); this.heights = data.heights;
      // Baked structure footprints are replaced by the current live structures.
      // Keep data.flags/data.walkable intact as extraction evidence.
      for (let i = 0; i < this.walkable.length; i++) if (data.flags?.[i] & 4) this.walkable[i] = 1;
      this.size = this.cols * this.rows;
      this.layers = new Map(); this.structures = []; this.team = null; this.revision = 0;
      this.g = new Float64Array(this.size); this.f = new Float64Array(this.size);
      this.parent = new Int32Array(this.size); this.seen = new Uint32Array(this.size);
      this.closed = new Uint32Array(this.size); this.heap = new Int32Array(this.size);
      this.heapAt = new Int32Array(this.size); this.stamp = 0; this.heapSize = 0;
      this.resultX = 0; this.resultY = 0;
    }
    setStructures(structures) {
      this.structures = structures.filter(s => s.isAlive !== false);
      this.layers.clear(); this.revision++;
    }
    index(x, y) {
      const col = Math.floor((x - this.ox) / this.cell), row = Math.floor((y - this.oy) / this.cell);
      return col < 0 || row < 0 || col >= this.cols || row >= this.rows ? -1 : row * this.cols + col;
    }
    centerX(i) { return this.ox + (i % this.cols + 0.5) * this.cell; }
    centerY(i) { return this.oy + (Math.floor(i / this.cols) + 0.5) * this.cell; }
    heightAt(x, y) {
      const i = this.index(x, y);
      return i < 0 || !this.heights ? 0 : this.heights[i] || 0;
    }
    bushAt(x, y) { const i = this.index(x, y); return i >= 0 && !!this.data.bushes?.[i]; }
    blocked(i) {
      const enemyGate = this.team === 'blue' ? 2048 : this.team === 'red' ? 1024 : 0;
      return !this.walkable[i] || !!((this.data.flags?.[i] || 0) & enemyGate);
    }
    terrainClear(x, y, radius) {
      const loX = Math.floor((x - radius - this.ox) / this.cell), hiX = Math.floor((x + radius - this.ox) / this.cell);
      const loY = Math.floor((y - radius - this.oy) / this.cell), hiY = Math.floor((y + radius - this.oy) / this.cell);
      if (loX < 0 || loY < 0 || hiX >= this.cols || hiY >= this.rows) return false;
      for (let row = loY; row <= hiY; row++) for (let col = loX; col <= hiX; col++) {
        if (!this.blocked(row * this.cols + col)) continue;
        const cx = this.ox + col * this.cell, cy = this.oy + row * this.cell;
        const dx = x - Math.max(cx, Math.min(x, cx + this.cell));
        const dy = y - Math.max(cy, Math.min(y, cy + this.cell));
        if (dx * dx + dy * dy <= radius * radius) return false;
      }
      return true;
    }
    isWalkable(x, y, radius = 0) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !this.terrainClear(x, y, radius)) return false;
      for (let i = 0; i < this.structures.length; i++) {
        const s = this.structures[i]; if (s.isAlive === false) continue;
        const dx = x - s.x, dy = y - s.y, r = (s.radius || 0) + radius;
        if (dx * dx + dy * dy < r * r) return false;
      }
      return true;
    }
    layer(radius) {
      radius = Math.ceil(radius);
      const key = radius * 3 + (this.team === 'blue' ? 1 : this.team === 'red' ? 2 : 0);
      let layer = this.layers.get(key);
      if (!layer) {
        layer = new Uint8Array(this.size);
        for (let i = 0; i < this.size; i++) layer[i] = this.isWalkable(this.centerX(i), this.centerY(i), radius) ? 1 : 0;
        this.layers.set(key, layer);
      }
      return layer;
    }
    nearest(x, y, radius = 0) {
      const layer = this.layer(radius);
      let index = this.index(x, y);
      if (index >= 0 && layer[index]) return index;
      let best = -1, dist = Infinity;
      for (let i = 0; i < this.size; i++) if (layer[i]) {
        const dx = this.centerX(i) - x, dy = this.centerY(i) - y, d = dx * dx + dy * dy;
        if (d < dist) { dist = d; best = i; }
      }
      return best;
    }
    lineClear(x, y, tx, ty, radius = 0) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(tx) || !Number.isFinite(ty)) return false;
      const loX = Math.floor((Math.min(x, tx) - radius - this.ox) / this.cell), hiX = Math.floor((Math.max(x, tx) + radius - this.ox) / this.cell);
      const loY = Math.floor((Math.min(y, ty) - radius - this.oy) / this.cell), hiY = Math.floor((Math.max(y, ty) + radius - this.oy) / this.cell);
      if (loX < 0 || loY < 0 || hiX >= this.cols || hiY >= this.rows) return false;
      const dx = tx - x, dy = ty - y, length2 = dx * dx + dy * dy, radius2 = radius * radius;
      // Exact capsule/rectangle test. Endpoint sampling alone can miss a wall
      // corner between samples, even when both endpoints are collision-free.
      for (let row = loY; row <= hiY; row++) for (let col = loX; col <= hiX; col++) {
        if (!this.blocked(row * this.cols + col)) continue;
        const left = this.ox + col * this.cell, top = this.oy + row * this.cell;
        const right = left + this.cell, bottom = top + this.cell;
        let near = 0, far = 1, intersects = true;
        if (Math.abs(dx) < 1e-12) { if (x < left || x > right) intersects = false; }
        else {
          const a = (left - x) / dx, b = (right - x) / dx;
          near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
        }
        if (Math.abs(dy) < 1e-12) { if (y < top || y > bottom) intersects = false; }
        else {
          const a = (top - y) / dy, b = (bottom - y) / dy;
          near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
        }
        if (intersects && near <= far) return false;
        let ex = x - Math.max(left, Math.min(x, right)), ey = y - Math.max(top, Math.min(y, bottom));
        if (ex * ex + ey * ey <= radius2) return false;
        ex = tx - Math.max(left, Math.min(tx, right)); ey = ty - Math.max(top, Math.min(ty, bottom));
        if (ex * ex + ey * ey <= radius2) return false;
        for (let corner = 0; corner < 4; corner++) {
          const cx = corner & 1 ? right : left, cy = corner & 2 ? bottom : top;
          const t = length2 ? Math.max(0, Math.min(1, ((cx - x) * dx + (cy - y) * dy) / length2)) : 0;
          ex = cx - x - dx * t; ey = cy - y - dy * t;
          if (ex * ex + ey * ey <= radius2) return false;
        }
      }
      for (let i = 0; i < this.structures.length; i++) {
        const s = this.structures[i]; if (s.isAlive === false) continue;
        const t = length2 ? Math.max(0, Math.min(1, ((s.x - x) * dx + (s.y - y) * dy) / length2)) : 0;
        const sx = s.x - x - dx * t, sy = s.y - y - dy * t, r = radius + (s.radius || 0);
        if (sx * sx + sy * sy < r * r) return false;
      }
      return true;
    }
    move(x, y, tx, ty, radius = 0, blink = false) {
      this.resultX = x; this.resultY = y;
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
      if (blink) {
        const cell = this.nearest(tx, ty, radius);
        if (cell >= 0) {
          this.resultX = this.isWalkable(tx, ty, radius) ? tx : this.centerX(cell);
          this.resultY = this.isWalkable(tx, ty, radius) ? ty : this.centerY(cell);
        }
        return;
      }
      const dx = tx - x, dy = ty - y, steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (this.cell * 0.35)));
      for (let i = 0; i < steps; i++) {
        const nx = this.resultX + dx / steps, ny = this.resultY + dy / steps;
        if (this.lineClear(this.resultX, this.resultY, nx, ny, radius)) { this.resultX = nx; this.resultY = ny; }
        else if (this.lineClear(this.resultX, this.resultY, nx, this.resultY, radius)) this.resultX = nx;
        else if (this.lineClear(this.resultX, this.resultY, this.resultX, ny, radius)) this.resultY = ny;
        else break;
      }
    }
    push(i) {
      let at = this.heapSize++; this.heap[at] = i; this.heapAt[i] = at;
      this.up(at);
    }
    up(at) {
      const item = this.heap[at];
      while (at > 0) {
        const parent = (at - 1) >> 1, other = this.heap[parent];
        if (this.f[other] <= this.f[item]) break;
        this.heap[at] = other; this.heapAt[other] = at; at = parent;
      }
      this.heap[at] = item; this.heapAt[item] = at;
    }
    pop() {
      const result = this.heap[0], item = this.heap[--this.heapSize];
      if (this.heapSize) {
        let at = 0;
        while (at * 2 + 1 < this.heapSize) {
          let child = at * 2 + 1;
          if (child + 1 < this.heapSize && this.f[this.heap[child + 1]] < this.f[this.heap[child]]) child++;
          if (this.f[item] <= this.f[this.heap[child]]) break;
          this.heap[at] = this.heap[child]; this.heapAt[this.heap[at]] = at; at = child;
        }
        this.heap[at] = item; this.heapAt[item] = at;
      }
      return result;
    }
    findPath(x, y, tx, ty, radius = 0) {
      if (![x, y, tx, ty].every(Number.isFinite)) return [];
      const start = this.nearest(x, y, radius), end = this.nearest(tx, ty, radius);
      if (start < 0 || end < 0) return [];
      if (!this.isWalkable(tx, ty, radius)) { tx = this.centerX(end); ty = this.centerY(end); }
      if (this.lineClear(x, y, tx, ty, radius)) return [{ x: tx, y: ty }];
      const layer = this.layer(radius), stamp = ++this.stamp;
      this.heapSize = 0; this.g[start] = 0; this.f[start] = 0; this.parent[start] = -1;
      this.seen[start] = stamp; this.push(start);
      const endCol = end % this.cols, endRow = Math.floor(end / this.cols);
      let found = false;
      while (this.heapSize) {
        const current = this.pop();
        if (current === end) { found = true; break; }
        this.closed[current] = stamp;
        const col = current % this.cols, row = Math.floor(current / this.cols);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || col + dx < 0 || row + dy < 0 || col + dx >= this.cols || row + dy >= this.rows) continue;
          const next = current + dy * this.cols + dx;
          if (!layer[next] || this.closed[next] === stamp) continue;
          if (dx && dy && (!layer[current + dx] || !layer[current + dy * this.cols])) continue;
          if (!this.lineClear(this.centerX(current), this.centerY(current), this.centerX(next), this.centerY(next), radius)) continue;
          const cost = this.g[current] + (dx && dy ? Math.SQRT2 : 1);
          const fresh = this.seen[next] !== stamp;
          if (!fresh && cost >= this.g[next]) continue;
          this.parent[next] = current; this.g[next] = cost;
          const hx = Math.abs(endCol - col - dx), hy = Math.abs(endRow - row - dy);
          this.f[next] = cost + Math.max(hx, hy) + (Math.SQRT2 - 1) * Math.min(hx, hy);
          if (fresh) { this.seen[next] = stamp; this.push(next); } else this.up(this.heapAt[next]);
        }
      }
      if (!found) return [];
      const reversed = [];
      for (let i = end; i !== start && i >= 0; i = this.parent[i]) reversed.push({ x: this.centerX(i), y: this.centerY(i) });
      reversed.push({ x: this.centerX(start), y: this.centerY(start) });
      reversed.reverse(); reversed.push({ x: tx, y: ty });
      const path = []; let px = x, py = y, index = 0;
      while (index < reversed.length) {
        let last = index;
        if (!this.lineClear(px, py, reversed[index].x, reversed[index].y, radius)) return [];
        for (let j = index + 1; j < reversed.length; j++) {
          if (!this.lineClear(px, py, reversed[j].x, reversed[j].y, radius)) break;
          last = j;
        }
        const point = reversed[last]; path.push(point); px = point.x; py = point.y; index = last + 1;
      }
      return path;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = MapNavigation;
  root.MapNavigation = MapNavigation;
})(typeof globalThis !== 'undefined' ? globalThis : this);
export default globalThis.MapNavigation;
