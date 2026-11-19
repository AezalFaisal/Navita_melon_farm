// North-up minimap drawn from the navigation grid. Click a place marker (or any walkable spot) to walk there.
export class Minimap {
  constructor(canvas, nav, places, { onPlace, onPoint }) {
    this.c = canvas; this.nav = nav; this.places = places;
    this.S = 2;                                  // internal pixels per metre
    canvas.width = nav.nx * this.S; canvas.height = nav.ny * this.S;
    this.ctx = canvas.getContext('2d');
    this._buildBase();
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * canvas.width, py = ((e.clientY - r.top) / r.height) * canvas.height;
      let best = null, bd = 14 * 14;
      for (const p of this.places) {
        const m = this.toPx(p.stand.x, p.stand.z); const d = (m.x - px) ** 2 + (m.y - py) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      if (best) onPlace(best);
      else onPoint(this.nav.x0 + px / this.S, -(this.nav.y0 + (canvas.height - py) / this.S));
      e.preventDefault();
    });
  }
  toPx(x, z) { return { x: (x - this.nav.x0) * this.S, y: this.c.height + (z + this.nav.y0) * this.S }; }
  _buildBase() {
    const { nx, ny } = this.nav, S = this.S;
    const off = document.createElement('canvas'); off.width = this.c.width; off.height = this.c.height;
    const g = off.getContext('2d');
    g.fillStyle = 'rgba(10,25,15,0.55)'; g.fillRect(0, 0, off.width, off.height);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!this.nav.isWalkableCell(i, j)) continue;
        const z = this.nav.zCell(i, j);
        g.fillStyle = z < 0.02 ? '#7fae5c' : '#d9d6c8';
        g.fillRect(i * S, (ny - 1 - j) * S, S, S);
      }
    }
    this.base = off;
  }
  draw(player, camYaw, tourIndexOf, activeId, others = []) {
    const g = this.ctx, S = this.S;
    g.clearRect(0, 0, this.c.width, this.c.height);
    g.drawImage(this.base, 0, 0);
    for (const p of this.places) {
      const m = this.toPx(p.stand.x, p.stand.z);
      const n = tourIndexOf(p.id);
      g.beginPath(); g.arc(m.x, m.y, n ? 8 : 5, 0, Math.PI * 2);
      g.fillStyle = p.id === activeId ? '#ffb020' : n ? '#ffffff' : 'rgba(255,255,255,0.75)'; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = '#15381f'; g.stroke();
      if (n) { g.fillStyle = '#15381f'; g.font = 'bold 10px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), m.x, m.y + 0.5); }
    }
    for (const o of others) {                      // other visitors currently on the farm
      const q = this.toPx(o.x, o.z);
      g.beginPath(); g.arc(q.x, q.y, 6, 0, Math.PI * 2); g.fillStyle = '#3aa0ff'; g.fill();
      g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
    }
    const pp = this.toPx(player.x, player.z);
    g.save(); g.translate(pp.x, pp.y); g.rotate(Math.PI - player.yaw);
    g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath();
    g.fillStyle = '#ff3b30'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
    g.restore();
  }
}
