// Realtime multiplayer for the farm: one shared room. Clients send their own position ~10x/second,
// the server relays everybody's position to everybody else.
//
// Protocol (JSON text frames)
//   client -> server   {t:'join', name, avatar}
//                      {t:'state', x, y, z, yaw, sp, e?, g?}     e = emote name, g = gesture name (one-shot events)
//   server -> client   {t:'welcome', id, players:[{id,name,avatar,x,y,z,yaw,sp}], online}
//                      {t:'join', p:{...}}   {t:'leave', id}
//                      {t:'s', p:[[id,x,y,z,yaw,sp],...], ev:[[id,'e'|'g',name],...]}     (10 Hz, only players that changed)
import { WebSocketServer } from 'ws';

const EMOTES = new Set(['Happy', 'Laugh', 'Wink', 'Surprised', 'Sad', 'Angry', 'Relax']);
const GESTURES = new Set(['Wave', 'Cheer', 'Pick']);
const num = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>&"'`\\]/g, '').trim().slice(0, 16);

export function attachMultiplayer(httpServer, { path = '/ws', maxPlayers = 100, avatarCount = 4, log = console.log } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const players = new Map();
  let nextId = 1;

  // only handle our own path: Vite's own HMR websocket upgrades keep working untouched
  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith(path)) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  const broadcast = (obj, exceptId) => {
    const s = JSON.stringify(obj);
    for (const p of players.values()) if (p.joined && p.id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
  };
  const pub = (p) => ({ id: p.id, name: p.name, avatar: p.avatar, x: p.x, y: p.y, z: p.z, yaw: p.yaw, sp: p.sp });
  const online = () => [...players.values()].filter((p) => p.joined).length;

  wss.on('connection', (ws) => {
    if (players.size >= maxPlayers) { ws.close(1013, 'room full'); return; }
    const me = { id: nextId++, ws, joined: false, name: '', avatar: 0, x: 0, y: 0, z: 0, yaw: 0, sp: 0, dirty: false, ev: [], alive: true, msgs: 0 };
    players.set(me.id, me);
    ws.on('pong', () => { me.alive = true; });
    ws.on('message', (data) => {
      if (++me.msgs > 60) return;                      // simple flood guard (counter is reset every second)
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'join' && !me.joined) {
        me.name = cleanName(m.name) || 'Guest' + me.id;
        me.avatar = Math.max(0, Math.min(avatarCount - 1, m.avatar | 0));
        me.joined = true;
        send(ws, { t: 'welcome', id: me.id, players: [...players.values()].filter((p) => p.joined && p.id !== me.id).map(pub), online: online() });
        broadcast({ t: 'join', p: pub(me), online: online() }, me.id);
        log(`[mp] ${me.name} joined (${online()} online)`);
      } else if (m.t === 'state' && me.joined) {
        me.x = num(m.x, -50, 400); me.y = num(m.y, -20, 60); me.z = num(m.z, -400, 50);
        me.yaw = num(m.yaw, -20, 20); me.sp = num(m.sp, 0, 30);
        if (typeof m.e === 'string' && EMOTES.has(m.e)) me.ev.push(['e', m.e]);
        if (typeof m.g === 'string' && GESTURES.has(m.g)) me.ev.push(['g', m.g]);
        if (typeof m.a === 'number') me.avatar = Math.max(0, Math.min(avatarCount - 1, m.a | 0));
        me.dirty = true;
      }
    });
    ws.on('close', () => {
      players.delete(me.id);
      if (me.joined) { broadcast({ t: 'leave', id: me.id, online: online() }); log(`[mp] ${me.name} left (${online()} online)`); }
    });
    ws.on('error', () => {});
  });

  // 10 Hz: send only what changed
  const tick = setInterval(() => {
    const p = [], ev = [];
    for (const q of players.values()) {
      if (!q.joined || !q.dirty) continue;
      p.push([q.id, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), +q.yaw.toFixed(3), +q.sp.toFixed(2)]);
      for (const [k, v] of q.ev) ev.push([q.id, k, v]);
      q.dirty = false; q.ev = [];
    }
    if (p.length) broadcast({ t: 's', p, ev });
  }, 100);

  // every second: reset flood counters, every 25 s: drop dead connections
  let beat = 0;
  const slow = setInterval(() => {
    for (const q of players.values()) q.msgs = 0;
    if (++beat % 25 === 0) {
      for (const q of players.values()) {
        if (!q.alive) { q.ws.terminate(); continue; }
        q.alive = false; try { q.ws.ping(); } catch { /* ignore */ }
      }
    }
  }, 1000);

  httpServer.on('close', () => { clearInterval(tick); clearInterval(slow); wss.close(); });
  return { wss, players, online };
}
