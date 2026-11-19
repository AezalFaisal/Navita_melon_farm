// Multiplayer client: connects to the farm server (/ws), sends our position ~10x/second and receives everybody else's.
// If the server cannot be reached the app simply keeps working in single-player mode and retries in the background.
export class Net {
  constructor({ url, onWelcome, onJoin, onLeave, onStates, onStatus }) {
    this.url = url; this.cb = { onWelcome, onJoin, onLeave, onStates, onStatus };
    this.ws = null; this.id = null; this.online = 1; this.connected = false;
    this.name = ''; this.avatar = 0; this.wanted = false; this.retry = 1000; this.timer = null;
    this.lastSent = 0; this.pending = { e: null, g: null };
  }

  start(name, avatar) {
    this.name = name; this.avatar = avatar; this.wanted = true;
    this._open();
  }
  stop() { this.wanted = false; clearTimeout(this.timer); if (this.ws) this.ws.close(); }

  _status(s) { this.cb.onStatus && this.cb.onStatus(s, this); }

  _open() {
    if (!this.wanted) return;
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this._status('offline'); return this._reconnect(); }
    this.ws = ws; this._status('connecting');
    ws.onopen = () => {
      this.connected = true; this.retry = 1000;
      ws.send(JSON.stringify({ t: 'join', name: this.name, avatar: this.avatar }));
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') { this.id = m.id; this.online = m.online; this._status('online'); this.cb.onWelcome && this.cb.onWelcome(m); }
      else if (m.t === 'join') { this.online = m.online; this.cb.onJoin && this.cb.onJoin(m.p, m.online); }
      else if (m.t === 'leave') { this.online = m.online; this.cb.onLeave && this.cb.onLeave(m.id, m.online); }
      else if (m.t === 's') { this.cb.onStates && this.cb.onStates(m.p, m.ev || []); }
    };
    ws.onclose = () => { this.connected = false; this.id = null; this._status('offline'); this._reconnect(); };
    ws.onerror = () => { /* onclose follows */ };
  }
  _reconnect() {
    if (!this.wanted) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._open(), this.retry);
    this.retry = Math.min(10000, this.retry * 1.7);
  }

  // one-shot events (emote / gesture) ride along with the next position update
  event(kind, name) { this.pending[kind] = name; }

  sendState(s, now) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return;
    if (now - this.lastSent < 0.1) return;
    const moved = !this.last || Math.abs(s.x - this.last.x) > 0.02 || Math.abs(s.z - this.last.z) > 0.02 || Math.abs(s.yaw - this.last.yaw) > 0.03 || Math.abs(s.sp - this.last.sp) > 0.05;
    const hasEvent = this.pending.e || this.pending.g;
    if (!moved && !hasEvent && now - this.lastSent < 2) return;       // idle: only a 2-second keep-alive
    const msg = { t: 'state', x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), yaw: +s.yaw.toFixed(3), sp: +s.sp.toFixed(2) };
    if (this.pending.e) msg.e = this.pending.e;
    if (this.pending.g) msg.g = this.pending.g;
    this.pending = { e: null, g: null };
    this.ws.send(JSON.stringify(msg));
    this.last = { x: s.x, z: s.z, yaw: s.yaw, sp: s.sp }; this.lastSent = now;
  }
}
