import * as THREE from 'three';

export const WALK_SPEED = 1.6;  // m/s
export const RUN_SPEED = 4.2;   // m/s

const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class Player {
  constructor(nav) {
    this.nav = nav;
    this.x = 0; this.z = 0; this.y = 0; this.yaw = 0;
    this.speed = 0; this.gait = 'idle';
    this.boost = 1;                // speed multiplier chosen by the visitor: 1x, 2x, 3x
    this.pref = 'walk';            // gait used for commands / forward-walk
    this.input = { x: 0, y: 0, run: false };
    this.path = null; this.pi = 0; this.pathGait = 'walk'; this.pathMul = 1; this.onPathDone = null;
    this.forward = false;          // "keep walking forward" voice mode
    this.turnTarget = null;
    this.frozen = false;           // during actions
    this.stuck = 0;
  }

  place(x, z, yaw = 0) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.y = this.nav.heightAt(x, z);
  }

  followPath(pts, { gait = 'walk', mul = 1, onDone = null } = {}) {
    if (!pts || pts.length === 0) { onDone && onDone(); return; }
    this.path = pts.slice(); this.pi = pts.length > 1 && Math.hypot(pts[0].x - this.x, pts[0].z - this.z) < 0.6 ? 1 : 0;
    this.pathGait = gait; this.pathMul = mul; this.onPathDone = onDone; this.forward = false; this.stuck = 0;
  }
  cancelPath() { this.path = null; this.onPathDone = null; this.forward = false; this.turnTarget = null; }
  get hasPath() { return !!this.path; }
  turnBy(rad) { this.turnTarget = this.yaw + rad; }
  faceDir(dx, dz) { this.turnTarget = Math.atan2(dx, dz); }

  _ok(x, z) {
    if (!this.nav.walkable(x, z)) return false;
    return Math.abs(this.nav.heightAt(x, z) - this.y) < 0.6;
  }
  _tryMove(dx, dz) {
    const nx = this.x + dx, nz = this.z + dz;
    if (this._ok(nx, nz)) { this.x = nx; this.z = nz; return true; }
    if (dx !== 0 && this._ok(nx, this.z)) { this.x = nx; return true; }
    if (dz !== 0 && this._ok(this.x, nz)) { this.z = nz; return true; }
    return false;
  }

  // camYaw: orbit-camera yaw used to make WASD camera-relative
  update(dt, camYaw) {
    let dirx = 0, dirz = 0, gait = 'idle', mul = 1, analog = 1;

    if (this.frozen) {
      // standing still while an action plays
    } else if (this.path) {
      const t = this.path[this.pi];
      const dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz);
      if (d < 0.45) {
        this.pi++;
        if (this.pi >= this.path.length) {
          const cb = this.onPathDone; this.path = null; this.onPathDone = null;
          cb && cb();
        }
      } else {
        dirx = dx / d; dirz = dz / d; gait = this.pathGait; mul = this.pathMul;
      }
    } else {
      const ix = this.input.x, iy = this.input.y;
      const mag = Math.min(1, Math.hypot(ix, iy));
      if (mag > 0.08) {
        const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);   // camera forward on the ground
        const rx = -fz, rz = fx;                                // camera right
        let mx = fx * iy + rx * ix, mz = fz * iy + rz * ix;
        const l = Math.hypot(mx, mz); mx /= l; mz /= l;
        dirx = mx; dirz = mz; analog = mag;
        gait = (this.input.run || mag > 0.92 && this.input.run) ? 'run' : 'walk';
        this.forward = false; this.turnTarget = null;
      } else if (this.forward) {
        dirx = Math.sin(this.yaw); dirz = Math.cos(this.yaw); gait = this.pref;
      }
    }

    const base = gait === 'run' ? RUN_SPEED : gait === 'walk' ? WALK_SPEED : 0;
    const target = base * mul * this.boost * (gait === 'walk' ? Math.max(0.5, analog) : 1);
    this.speed += (target - this.speed) * Math.min(1, dt * 7);
    if (target === 0 && this.speed < 0.05) this.speed = 0;

    if (this.speed > 0 && (dirx || dirz)) {
      // move in small steps (<= 0.35 m) so a 2x/3x boost can never jump over a wall or a tree
      const dist = this.speed * dt, n = Math.max(1, Math.ceil(dist / 0.35));
      let moved = false;
      for (let s = 0; s < n; s++) { if (!this._tryMove(dirx * dist / n, dirz * dist / n)) break; moved = true; }
      if (!moved) {
        this.stuck += dt;
        if (this.path && this.stuck > 0.5) { this.pi++; this.stuck = 0; if (this.pi >= this.path.length) { const cb = this.onPathDone; this.path = null; this.onPathDone = null; cb && cb(); } }
        else if (this.forward && this.stuck > 0.3) { this.forward = false; }
        this.speed *= 0.5;
      } else this.stuck = 0;
      const want = Math.atan2(dirx, dirz);
      this.yaw += angDiff(this.yaw, want) * Math.min(1, dt * 11);
    } else if (this.turnTarget !== null) {
      const d = angDiff(this.yaw, this.turnTarget);
      this.yaw += d * Math.min(1, dt * 7);
      if (Math.abs(d) < 0.03) this.turnTarget = null;
    }
    this.gait = this.speed > 0.15 ? (this.speed > (WALK_SPEED + RUN_SPEED) / 2 + 0.3 ? 'run' : 'walk') : 'idle';
    const ty = this.nav.heightAt(this.x, this.z);
    this.y += (ty - this.y) * Math.min(1, dt * 14);
  }
}
