// Grid-based navigation: walkability, ground height and A* path-finding.
// Data comes from public/models/navgrid.json (generated from the Blender walkable mesh).
// Blender coords (x, y) -> three.js world (X = x, Z = -y).

function b64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topV = v[0];
    const lastK = k.pop(), lastV = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return topV;
  }
}

export class NavGrid {
  constructor(d) {
    this.x0 = d.x0; this.y0 = d.y0; this.nx = d.nx; this.ny = d.ny; this.cell = d.cell;
    this.flags = b64(d.flags);
    const zb = b64(d.zcm);
    this.zc = new Int16Array(zb.buffer, zb.byteOffset, zb.length >> 1);
    const n = this.nx * this.ny;
    this.edge = new Uint8Array(n);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        if (!this.flags[j * this.nx + i]) continue;
        let e = 0;
        for (let dj = -1; dj <= 1 && !e; dj++)
          for (let di = -1; di <= 1; di++)
            if ((di || dj) && !this.isWalkableCell(i + di, j + dj)) { e = 1; break; }
        this.edge[j * this.nx + i] = e;
      }
    }
  }

  cellOf(x, z) { return [Math.floor((x - this.x0) / this.cell), Math.floor(((-z) - this.y0) / this.cell)]; }
  centerOf(i, j) { return { x: this.x0 + (i + 0.5) * this.cell, z: -(this.y0 + (j + 0.5) * this.cell) }; }
  isWalkableCell(i, j) {
    return i >= 0 && j >= 0 && i < this.nx && j < this.ny && this.flags[j * this.nx + i] === 1;
  }
  walkable(x, z) { const [i, j] = this.cellOf(x, z); return this.isWalkableCell(i, j); }
  zCell(i, j) { return this.zc[j * this.nx + i] / 100; }

  heightAt(x, z) {
    const fx = (x - this.x0) / this.cell - 0.5;
    const fy = ((-z) - this.y0) / this.cell - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fy);
    const tx = fx - i0, ty = fy - j0;
    let sum = 0, ws = 0;
    const add = (i, j, w) => { if (w > 0 && this.isWalkableCell(i, j)) { sum += this.zCell(i, j) * w; ws += w; } };
    add(i0, j0, (1 - tx) * (1 - ty)); add(i0 + 1, j0, tx * (1 - ty));
    add(i0, j0 + 1, (1 - tx) * ty); add(i0 + 1, j0 + 1, tx * ty);
    if (ws > 0) return sum / ws;
    const [ci, cj] = this.cellOf(x, z);
    return this.isWalkableCell(ci, cj) ? this.zCell(ci, cj) : 0;
  }

  // nearest walkable cell centre to (x, z); optionally avoiding cells touching obstacles
  nearest(x, z, avoidEdge = true, maxR = 25) {
    const [ci, cj] = this.cellOf(x, z);
    let best = null, bd = Infinity;
    for (let r = 0; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (!this.isWalkableCell(i, j)) continue;
          if (avoidEdge && this.edge[j * this.nx + i]) continue;
          const d = di * di + dj * dj;
          if (d < bd) { bd = d; best = [i, j]; }
        }
      }
      if (best && r >= Math.sqrt(bd)) break;
    }
    if (!best && avoidEdge) return this.nearest(x, z, false, maxR);
    return best ? this.centerOf(best[0], best[1]) : null;
  }

  // line of sight: every 0.25 m sample must be walkable (and not touching obstacles when strict)
  los(ax, az, bx, bz, strict = true) {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L * 4));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const [i, j] = this.cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
      if (!this.isWalkableCell(i, j)) return false;
      if (strict && this.edge[j * this.nx + i]) return false;
    }
    return true;
  }

  // A* over the grid. Prefers paved ground (low cells = lawn cost more) and avoids obstacle edges.
  findPath(sx, sz, gx, gz) {
    const s = this.nearest(sx, sz, false), g = this.nearest(gx, gz, true);
    if (!s || !g) return null;
    const [si, sj] = this.cellOf(s.x, s.z), [gi, gj] = this.cellOf(g.x, g.z);
    const nx = this.nx, N = nx * this.ny;
    const gs = new Float32Array(N).fill(Infinity);
    const par = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const start = sj * nx + si, goal = gj * nx + gi;
    const heap = new MinHeap();
    gs[start] = 0;
    heap.push(0, start);
    const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    while (heap.size) {
      const c = heap.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (c === goal) break;
      const ci = c % nx, cj = (c / nx) | 0, cz = this.zc[c] / 100;
      for (let k = 0; k < 8; k++) {
        const i = ci + DI[k], j = cj + DJ[k];
        if (!this.isWalkableCell(i, j)) continue;
        const n = j * nx + i;
        if (closed[n]) continue;
        if (DI[k] && DJ[k] && (!this.isWalkableCell(ci + DI[k], cj) || !this.isWalkableCell(ci, cj + DJ[k]))) continue;
        const nz = this.zc[n] / 100;
        if (Math.abs(nz - cz) > 0.5) continue;
        const step = (DI[k] && DJ[k] ? 1.4142 : 1) * (nz < 0.02 ? 1.8 : 1) + (this.edge[n] ? 1.5 : 0);
        const ng = gs[c] + step;
        if (ng < gs[n]) {
          gs[n] = ng; par[n] = c;
          heap.push(ng + Math.hypot(i - gi, j - gj), n);
        }
      }
    }
    if (start !== goal && par[goal] < 0) return null;
    const cells = [];
    for (let c = goal; c !== -1; c = par[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => this.centerOf(c % nx, (c / nx) | 0));
    // string-pulling / smoothing
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.los(pts[i].x, pts[i].z, pts[j].x, pts[j].z, true)) j--;
      out.push(pts[j]); i = j;
    }
    if (this.walkable(gx, gz)) out[out.length - 1] = { x: gx, z: gz };
    return out;
  }

  // is the straight move from (x,z) along dir (unit vector) possible for `dist` metres? returns reachable distance
  rayDistance(x, z, dx, dz, dist) {
    let d = 0;
    for (; d < dist; d += 0.25) {
      if (!this.walkable(x + dx * (d + 0.25), z + dz * (d + 0.25))) break;
    }
    return Math.min(d, dist);
  }
}
