import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { NavGrid } from './nav.js';
import { ClipAvatar } from './clipavatar.js';
import { AVATARS } from './avatars.js';
import { Player } from './player.js';
import { parseCommand } from './commands.js';
import { Voice } from './voice.js';
import { Minimap } from './minimap.js';
import { Net } from './net.js';
import { PLACE_INFO, HELP, TOUR_ORDER } from './data.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const nowSec = () => performance.now() / 1000;
// Multiplayer socket: same host by default; override with ?server=wss://... or at build time with VITE_WS_URL
const WS_URL = params.get('server') || import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

/* ------------------------------------------------------------------ renderer / scene */
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9cdee);
scene.fog = new THREE.Fog(0xbfd8ee, 220, 900);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2500);
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x7a8a5a, 1.0));
const sun = new THREE.DirectionalLight(0xfff0d4, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 320;
sc.updateProjectionMatrix();
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(70, 110, 50);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x7c9459, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(132, -0.5, -120); ground.receiveShadow = true;
scene.add(ground);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

/* ------------------------------------------------------------------ asset loading */
const loader = new GLTFLoader();
const progress = {};
const PROGRESS_TOTAL = AVATARS.length + 2;          // farm + avatars + "done"
function setProgress(name, frac) {
  progress[name] = frac;
  const avg = Object.values(progress).reduce((a, b) => a + b, 0) / PROGRESS_TOTAL;
  $('#loadfill').style.width = `${Math.round(avg * 100)}%`;
  $('#loadtext').textContent = avg < 1 ? `Loading farm… ${Math.round(avg * 100)}%` : 'Ready';
}
function loadGLB(url, name) {
  return new Promise((res, rej) => loader.load(url, res, (e) => e.total && setProgress(name, e.loaded / e.total), rej));
}
const fetchJSON = (u) => fetch(u).then((r) => r.json());

let nav, tourData, places = [], placeMap = {}, farmGLTF, templates = [];
let player, rig, minimap, voice, net;

Promise.all([
  fetchJSON('./models/tour.json'), fetchJSON('./models/navgrid.json'),
  loadGLB('./models/melon_farm.glb', 'farm'),
  ...AVATARS.map((a) => loadGLB(a.url, a.id)),
]).then(([tour, grid, farm, ...avs]) => {
  tourData = tour; nav = new NavGrid(grid); farmGLTF = farm; templates = avs;
  setProgress('farm', 1); AVATARS.forEach((a) => setProgress(a.id, 1)); setProgress('done', 1);
  setup();
}).catch((e) => { console.error(e); $('#loadtext').textContent = 'Failed to load: ' + e.message; });

// every avatar on screen (yours, previews, other visitors) is its own clone of the pristine loaded model
function makeRig(i) {
  const t = templates[i];
  return new ClipAvatar({ scene: cloneSkinned(t.scene), animations: t.animations }, AVATARS[i]);
}

// Ground surfaces in the Blender model can have flipped (downward) normals, which makes shadows speckle.
const GROUND_MATS = new Set(['Lawn_Grass', 'Soil_Bed', 'Road_Asphalt', 'Blacktop_Old_01', 'Paver_Gray', 'Tough_Tiles', 'EXP_Plaza_Marble',
  'Pool_Deck', 'Pool_Coping', 'Cinder_Block', 'EXP_GH_Mud', 'Parking_Line', 'Road_Paint', 'Sante_20Fe_20Travertine']);
function fixDownFacingGround(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const g = mesh.geometry;
  if (!g.index || !mats.some((m) => m && GROUND_MATS.has(m.name))) return;
  const idx = g.index.array, pos = g.attributes.position, nor = g.attributes.normal;
  const groups = g.groups.length ? g.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const grp of groups) {
    const m = mats[grp.materialIndex || 0];
    if (!m || !GROUND_MATS.has(m.name)) continue;
    for (let i = grp.start; i < grp.start + grp.count; i += 3) {
      a.fromBufferAttribute(pos, idx[i]); b.fromBufferAttribute(pos, idx[i + 1]); c.fromBufferAttribute(pos, idx[i + 2]);
      const lowY = (a.y + b.y + c.y) / 3;
      b.sub(a); c.sub(a); b.cross(c);
      if (b.y < 0 && lowY < 0.9) {
        const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t;
        for (let k = 0; k < 3; k++) if (nor) nor.setY(idx[i + k], Math.abs(nor.getY(idx[i + k])));
      }
    }
  }
  g.index.needsUpdate = true; if (nor) nor.needsUpdate = true;
}

/* ------------------------------------------------------------------ setup after load */
let selectedAvatar = 0, stops = [];
function setup() {
  scene.add(farmGLTF.scene);
  farmGLTF.scene.traverse((o) => {
    if (!o.isMesh) return;
    fixDownFacingGround(o);
    const m = o.material;
    const transparent = m && (m.transparent || m.opacity < 1);
    o.castShadow = !transparent; o.receiveShadow = true;
    let isTree = false;
    for (let p = o; p && p !== farmGLTF.scene; p = p.parent) if (/^EXP_(TallShadeTree|RainTree|MangoTree|HedgeShrub)/.test(p.name)) isTree = true;
    if (isTree || transparent) o.layers.set(1);
    else o.geometry.computeBoundsTree();
  });
  camera.layers.enable(1); sun.shadow.camera.layers.enable(1);

  places = tourData.places.map((p) => ({
    ...p,
    stand: { x: p.stand_three[0], z: p.stand_three[2] },
    labelPos: new THREE.Vector3(p.label_three[0], 9, p.label_three[2]),
  }));
  places.forEach((p) => (placeMap[p.id] = p));
  stops = TOUR_ORDER.map((id) => placeMap[id]).filter(Boolean);                  // guided tour = EVERY place
  places.forEach((p) => { const k = TOUR_ORDER.indexOf(p.id); p.tour_index = k >= 0 ? k + 1 : null; });

  if (params.get('avatar')) selectedAvatar = Math.min(AVATARS.length - 1, Number(params.get('avatar')) || 0);
  try { $('#playerName').value = localStorage.getItem('farmName') || ''; } catch (e) { /* storage blocked */ }
  if (params.get('name')) $('#playerName').value = params.get('name');

  buildAvatarCards();
  buildLabels(); buildPlaceList(); buildChips(); buildTourList();
  minimap = new Minimap($('#minimap'), nav, places, {
    onPlace: (p) => run([{ type: 'goto', place: p.id, gait: player.pref }], true),
    onPoint: (x, z) => goPoint(x, z),
  });
  voice = new Voice({ onFinal: onVoiceFinal, onInterim: (t) => ($('#transcript').textContent = '“' + t + '”'), onState: onVoiceState });
  if (!voice.supported) $('#mic').title = 'Voice input needs Chrome or Edge';

  $('#btnFree').disabled = false; $('#btnTour').disabled = false;
  $('#btnFree').onclick = () => startGame('free');
  $('#btnTour').onclick = () => startGame('tour');
  if (TEST) startGame(params.get('mode') || 'free');
}

/* ------------------------------------------------------------------ avatar picker */
function renderPreview(r) {
  const R = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  R.setSize(400, 500); R.setPixelRatio(1);
  R.outputColorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0x889977, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 3, 4); s.add(d);
  s.add(r.holder);
  r.holder.position.set(0, 0, 0); r.holder.rotation.y = 0.3;
  const cam = new THREE.PerspectiveCamera(28, 400 / 500, 0.1, 50);
  const pc = r.previewCam;
  cam.position.set(0, pc.y + 0.08, pc.dist); cam.lookAt(0, pc.y - 0.02, 0);
  r.update(0.016, 0, 'idle');
  R.render(s, cam);
  const url = R.domElement.toDataURL('image/png');
  s.remove(r.holder);
  R.dispose(); R.forceContextLoss();
  return url;
}
function buildAvatarCards() {
  const box = $('#avatars'); box.innerHTML = '';
  AVATARS.forEach((a, i) => {
    const d = document.createElement('div'); d.className = 'av' + (i === selectedAvatar ? ' sel' : '');
    let url = ''; try { url = renderPreview(makeRig(i)); } catch (e) { console.warn(e); }
    d.innerHTML = (url ? `<img alt="${a.name}" src="${url}">` : '<div class="ph">preview</div>') + `<div>${a.name}</div>`;
    d.onclick = () => { selectedAvatar = i; box.querySelectorAll('.av').forEach((x, k) => x.classList.toggle('sel', k === i)); };
    box.appendChild(d);
  });
}
function refreshEmoteBar() {
  let any = false;
  document.querySelectorAll('#emotes button').forEach((b) => {
    const ok = b.dataset.e ? rig.supportsFace : rig.canGesture(b.dataset.g);
    b.hidden = !ok; any = any || ok;
  });
  $('#emotes').hidden = !any;
}

/* ------------------------------------------------------------------ labels (hidden when you are near the place) */
const LABEL_NEAR = 20, LABEL_FADE = 10;
let labelsOn = true;
function buildLabels() {
  const box = $('#labels'); box.innerHTML = '';
  for (const p of places) {
    const el = document.createElement('div'); el.className = 'lbl'; el.textContent = p.name; box.appendChild(el); p.el = el;
    el.onclick = () => { run([{ type: 'goto', place: p.id, gait: player.pref }], true); if (view.mode === 'aerial') setView('follow'); };
  }
}
const _v = new THREE.Vector3();
function updateLabels() {
  const w = window.innerWidth, h = window.innerHeight, aerial = view.mode === 'aerial';
  for (const p of places) {
    const dPlayer = Math.hypot(player.x - p.stand.x, player.z - p.stand.z);
    // walking view: fade out as the visitor gets close ("you are here"); aerial view: show every label
    let a = labelsOn ? (aerial ? 1 : Math.min(1, Math.max(0, (dPlayer - LABEL_NEAR) / LABEL_FADE))) : 0;
    _v.copy(p.labelPos).project(camera);
    const dc = camera.position.distanceTo(p.labelPos);
    if (_v.z > 1 || _v.z < -1 || dc > (aerial ? 800 : 230)) a = 0;
    if (a <= 0.01) { p.el.style.opacity = 0; p.el.style.visibility = 'hidden'; continue; }
    p.el.style.visibility = 'visible'; p.el.style.opacity = a.toFixed(2);
    p.el.style.transform = `translate(${((_v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-_v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%)`;
  }
}

/* ------------------------------------------------------------------ HUD helpers */
function toast(text, ms = 2800) {
  const t = document.createElement('div'); t.textContent = text; $('#toast').appendChild(t);
  setTimeout(() => t.remove(), ms);
  while ($('#toast').children.length > 3) $('#toast').firstChild.remove();
}
function say(text, { speak = true, onEnd } = {}) {
  toast(text);
  if (speak && voice) voice.say(text, onEnd); else onEnd && setTimeout(onEnd, 0);
}
function showCaption(title, text) { $('#capTitle').textContent = title; $('#capText').textContent = text || ''; $('#caption').hidden = false; }
function hideCaption() { $('#caption').hidden = true; }

function buildPlaceList() {
  const box = $('#placeList'); box.innerHTML = '';
  const order = [...places].sort((a, b) => (a.tour_index || 99) - (b.tour_index || 99));
  for (const p of order) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="n ${p.tour_index ? '' : 'none'}">${p.tour_index || '·'}</span><span>${p.name}</span>`;
    b.onclick = () => { run([{ type: 'goto', place: p.id, gait: player.pref }], true); $('#panelPlaces').hidden = true; };
    box.appendChild(b);
  }
}
function buildChips() {
  const box = $('#chips'); box.innerHTML = '';
  for (const h of HELP) {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = h;
    b.onclick = () => { $('#cmd').value = h; submitCommand(h); }; box.appendChild(b);
  }
}
function buildTourList() {
  const box = $('#tourList'); box.innerHTML = '';
  stops.forEach((p, k) => {
    const b = document.createElement('button'); b.dataset.k = k;
    b.innerHTML = `<span class="n">${k + 1}</span><span>${p.name}</span>`;
    b.onclick = () => startTour(k);
    box.appendChild(b);
  });
}
const tourIndexOf = (id) => (placeMap[id] && placeMap[id].tour_index) || 0;

/* ------------------------------------------------------------------ camera views: aerial / follow / first person */
const cam = { yaw: Math.PI, pitch: 0.36, dist: 6.5, lastDrag: -99, target: new THREE.Vector3(), cur: undefined };
const aer = { yaw: 0.55, pitch: 0.95, dist: 235, target: new THREE.Vector3(132, 0, -118), lastDrag: -99 };
const fp = { yaw: 0, pitch: 0 };
const view = { mode: 'aerial', at: -99, intro: false, introT: 0 };
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const camRay = new THREE.Raycaster(); camRay.firstHitOnly = true; camRay.layers.set(0);
const _dir = new THREE.Vector3(), _des = new THREE.Vector3(), _look = new THREE.Vector3();

function setView(mode, silent = false) {
  if (!started) return;
  if (mode !== 'aerial') view.intro = false;
  if (mode === 'first' && view.mode !== 'first') { fp.yaw = player.yaw; fp.pitch = 0; }
  if (mode === 'follow' && view.mode !== 'follow') { cam.yaw = player.yaw + Math.PI; cam.cur = undefined; cam.target.set(player.x, player.y + rig.camHeight, player.z); }
  view.mode = mode; view.at = nowSec();
  rig.holder.visible = mode !== 'first';
  for (const [id, m] of [['#vAerial', 'aerial'], ['#vFollow', 'follow'], ['#vFirst', 'first']]) $(id).classList.toggle('on', m === mode);
  if (!silent) toast(mode === 'aerial' ? 'Aerial view – click a label to walk there' : mode === 'first' ? 'First-person view' : 'Follow view', 2000);
}
function moveYaw() { return view.mode === 'aerial' ? aer.yaw : view.mode === 'first' ? fp.yaw + Math.PI : cam.yaw; }

function updateCamera(dt, now) {
  if (view.mode === 'aerial') {
    if (now - aer.lastDrag > 3 && (view.intro || !TEST)) aer.yaw += 0.045 * dt;           // slow orbit
    _dir.set(Math.sin(aer.yaw) * Math.cos(aer.pitch), Math.sin(aer.pitch), Math.cos(aer.yaw) * Math.cos(aer.pitch));
    _des.copy(aer.target).addScaledVector(_dir, aer.dist); _look.copy(aer.target);
  } else if (view.mode === 'first') {
    _des.set(player.x + Math.sin(player.yaw) * 0.12, player.y + rig.eyeHeight, player.z + Math.cos(player.yaw) * 0.12);
    _look.set(_des.x + Math.sin(fp.yaw) * Math.cos(fp.pitch), _des.y + Math.sin(fp.pitch), _des.z + Math.cos(fp.yaw) * Math.cos(fp.pitch));
  } else {
    if ((player.hasPath || player.forward) && now - cam.lastDrag > 2.5 && !player.frozen) cam.yaw += angDiff(cam.yaw, player.yaw + Math.PI) * Math.min(1, dt * 1.6);
    const ty = player.y + rig.camHeight;
    if (!cam.lock) {
      const f = Math.min(1, dt * (10 + 4 * player.boost));          // follow tighter at higher speed
      cam.target.x += (player.x - cam.target.x) * f;
      cam.target.z += (player.z - cam.target.z) * f;
      cam.target.y += (ty - cam.target.y) * Math.min(1, dt * 6);
    }
    const cp = Math.cos(cam.pitch);
    _dir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    camRay.set(cam.target, _dir); camRay.near = 0.2; camRay.far = cam.dist;
    const hit = camRay.intersectObject(farmGLTF.scene, true);
    const want = hit.length ? Math.max(1.0, hit[0].distance - 0.35) : cam.dist;
    if (cam.cur === undefined) cam.cur = want;
    cam.cur += (want - cam.cur) * Math.min(1, dt * (want < cam.cur ? 20 : 2.5));
    _des.copy(cam.target).addScaledVector(_dir, cam.cur);
    const floor = (nav.walkable(_des.x, _des.z) ? nav.heightAt(_des.x, _des.z) : player.y) + 0.5;
    if (_des.y < floor) _des.y = floor;
    _look.copy(cam.target);
  }
  // smooth fly between views, then lock on
  const k = now - view.at < 2.6 ? 1 - Math.exp(-dt * 2.4) : 1;
  camPos.lerp(_des, k); camLook.lerp(_look, k);
  camera.position.copy(camPos); camera.lookAt(camLook);
  camera.fov += ((view.mode === 'aerial' ? 45 : view.mode === 'first' ? 70 : 55) - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
  sun.target.position.set(view.mode === 'aerial' ? aer.target.x : player.x, 0, view.mode === 'aerial' ? aer.target.z : player.z);
  sun.position.copy(sun.target.position).add(SUN_OFFSET);
  const aerialNow = view.mode === 'aerial';
  scene.fog.near += ((aerialNow ? 700 : 220) - scene.fog.near) * Math.min(1, dt * 2); scene.fog.far += ((aerialNow ? 1800 : 900) - scene.fog.far) * Math.min(1, dt * 2);
  const half = view.mode === 'aerial' ? 150 : 55;
  if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.far = view.mode === 'aerial' ? 600 : 320; sc.updateProjectionMatrix(); }
}

/* ------------------------------------------------------------------ speed boost (1x / 2x / 3x) */
const BOOSTS = [1, 2, 3];
let boost = 1;
function setBoost(v, quiet = false) {
  boost = BOOSTS.includes(v) ? v : 1;
  if (player) player.boost = boost;
  $('#speedChip').textContent = boost + '×'; $('#speedVal').textContent = boost + '×';
  $('#btnSpeed').classList.toggle('boosted', boost > 1);
  if (!quiet) toast(`Speed ${boost}×${boost > 1 ? ' ⚡' : ''}`, 1400);
}
function stepBoost(d) { setBoost(BOOSTS[Math.min(BOOSTS.length - 1, Math.max(0, BOOSTS.indexOf(boost) + d))]); }
function cycleBoost() { setBoost(BOOSTS[(BOOSTS.indexOf(boost) + 1) % BOOSTS.length]); }

/* ------------------------------------------------------------------ start game */
let started = false, melons = 0;

function startGame(mode) {
  let nm = ($('#playerName').value || '').trim().slice(0, 16);
  if (!nm) nm = 'Visitor' + Math.floor(100 + Math.random() * 900);
  try { localStorage.setItem('farmName', nm); } catch (e) { /* storage blocked */ }
  myName = nm;
  myTag = document.createElement('div'); myTag.className = 'ntag me'; myTag.textContent = nm; $('#tags').appendChild(myTag);

  rig = makeRig(selectedAvatar);
  scene.add(rig.holder);
  player = new Player(nav);
  player.boost = boost;
  const ent = placeMap.entrance;
  const w0 = tourData.tour_waypoints[0].three;
  // everybody starts at the road in front of the entrance, with a small random offset so visitors don't stack up
  const jx = (Math.random() - 0.5) * 6;
  player.place(w0[0] + jx, w0[2], Math.atan2(ent.stand.x - w0[0], ent.stand.z - w0[2]));
  if (params.get('pos')) { const [x, z] = params.get('pos').split(',').map(Number); player.place(x, z, Number(params.get('yaw') || 0)); }
  cam.yaw = player.yaw + Math.PI; cam.target.set(player.x, player.y + rig.camHeight, player.z);
  refreshEmoteBar();
  $('#start').hidden = true; $('#hud').hidden = false;
  started = true;
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) { $('#joy').hidden = false; $('#btnRun').hidden = false; }
  initInput();
  setBoost(boost, true);
  if (!TEST || params.get('mp')) startNet();
  // opening shot: the whole farm from the air, then glide down to the avatar
  camPos.copy(_des.set(aer.target.x + 200, 260, aer.target.z + 260)); camLook.copy(aer.target);
  view.mode = 'aerial'; view.at = -99; view.intro = !params.get('view') && mode !== 'tour'; view.introT = 7;
  setView('aerial', true);
  view.intro = !params.get('view') && mode !== 'tour';
  if (mode === 'tour') setTimeout(() => { setView('follow', true); startTour(0); }, 6500);
  if (params.get('view')) {
    view.intro = false; setView(params.get('view'), true); view.at = -99;
    if (params.get('cam')) { const [y, p, d] = params.get('cam').split(',').map(Number); cam.yaw = y; cam.pitch = p; cam.dist = d; fp.yaw = y; cam.lastDrag = nowSec() + 9999; }
    const fo = params.get('focus');
    if (fo) { const [fx, fz] = fo.split(',').map(Number); cam.target.set(fx, 1.0, fz); cam.lock = true; }
  }
  say(mode === 'tour' ? 'Welcome! First, a look at the whole farm, then the guided tour begins.' : `Welcome to Navita Melon Farm, ${nm}! This is the whole farm from above. Use W A S D to walk, or say where to go.`, { speak: !TEST });
  if (TEST) runTestScript();
}
let myName = '', myTag = null;

/* ------------------------------------------------------------------ other visitors (multiplayer) */
const remotes = new Map();                 // id -> { id, name, avatar, rig, tag, x,y,z,yaw,speed, tx,ty,tz,tyaw,tsp, lastT }
const MAX_REMOTE_SHOWN = 24;
function updateOnline(n) { $('#onlineCount').textContent = n; }
function startNet() {
  if (params.get('solo')) { $('#online').hidden = true; return; }
  net = new Net({
    url: WS_URL,
    onWelcome: (m) => { for (const r of [...remotes.keys()]) removeRemote(r); m.players.forEach(addRemote); updateOnline(m.online); },
    onJoin: (p, n) => { addRemote(p); updateOnline(n); toast(`${p.name} joined the farm 👋`, 2200); },
    onLeave: (id, n) => { const r = remotes.get(id); if (r) toast(`${r.name} left`, 1800); removeRemote(id); updateOnline(n); },
    onStates: (list, events) => {
      const t = nowSec();
      for (const [id, x, y, z, yaw, sp] of list) {
        const r = remotes.get(id); if (!r) continue;
        r.tx = x; r.ty = y; r.tz = z; r.tyaw = yaw; r.tsp = sp; r.lastT = t;
      }
      for (const [id, kind, name] of events) {
        const r = remotes.get(id); if (!r) continue;
        if (kind === 'e') r.rig.emote(name, 3.5); else if (kind === 'g') r.rig.gesture(name, name === 'Pick' ? 0 : 3);
      }
    },
    onStatus: (s) => {
      if (s === 'offline') { $('#online').innerHTML = '👥 offline (solo)'; }
      else if (s === 'online') { $('#online').innerHTML = '👥 <b id="onlineCount">1</b> online'; updateOnline(net.online); }
    },
  });
  net.start(myName, selectedAvatar);
  window.addEventListener('beforeunload', () => net.stop());
}
function addRemote(p) {
  if (remotes.has(p.id) || remotes.size >= 80) return;
  const r = makeRig(Math.max(0, Math.min(AVATARS.length - 1, p.avatar | 0)));
  r.holder.position.set(p.x, p.y, p.z); r.holder.rotation.y = p.yaw; scene.add(r.holder);
  const tag = document.createElement('div'); tag.className = 'ntag'; tag.textContent = p.name; $('#tags').appendChild(tag);
  remotes.set(p.id, { id: p.id, name: p.name, avatar: p.avatar, rig: r, tag, x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: 0, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, tsp: 0, lastT: nowSec(), shown: true });
}
function removeRemote(id) {
  const r = remotes.get(id); if (!r) return;
  scene.remove(r.rig.holder); r.tag.remove(); remotes.delete(id);
}
let rankT = 0;
function updateRemotes(dt) {
  const t = nowSec(), aerial = view.mode === 'aerial';
  const fx = aerial ? aer.target.x : camera.position.x, fz = aerial ? aer.target.z : camera.position.z;
  const cull = aerial ? 400 : 140;
  rankT -= dt;
  if (rankT <= 0) {            // only the nearest visitors are drawn (keeps big crowds smooth)
    rankT = 0.5;
    const list = [...remotes.values()].map((r) => ({ r, d: Math.hypot(r.x - fx, r.z - fz) })).sort((a, b) => a.d - b.d);
    list.forEach((e, i) => { e.r.shown = e.d < cull && i < MAX_REMOTE_SHOWN; });
  }
  const k = 1 - Math.exp(-dt * 12);
  for (const r of remotes.values()) {
    if (Math.hypot(r.tx - r.x, r.tz - r.z) > 30) { r.x = r.tx; r.y = r.ty; r.z = r.tz; }      // teleport / far jump: snap
    else { r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k; }
    r.yaw += angDiff(r.yaw, r.tyaw) * k;
    if (t - r.lastT > 1.6) r.tsp = 0;                                                         // stopped sending = standing still
    r.speed += (r.tsp - r.speed) * k;
    r.rig.holder.visible = r.shown;
    if (!r.shown) continue;
    r.rig.update(dt, r.speed, r.speed > 3.2 ? 'run' : r.speed > 0.15 ? 'walk' : 'idle');
    r.rig.holder.position.set(r.x, r.y, r.z); r.rig.holder.rotation.set(0, r.yaw, 0);
  }
}
const _tv = new THREE.Vector3();
function updateTags() {
  const w = window.innerWidth, h = window.innerHeight, aerial = view.mode === 'aerial';
  if (myTag) {                                  // our own name above our own avatar (hidden in first person)
    _tv.set(player.x, player.y + rig.tagHeight, player.z).project(camera);
    const ok = view.mode !== 'first' && _tv.z > -1 && _tv.z < 1;
    myTag.style.visibility = ok ? 'visible' : 'hidden';
    if (ok) myTag.style.transform = `translate(${((_tv.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-_tv.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%)`;
  }
  for (const r of remotes.values()) {
    _tv.set(r.x, r.y + r.rig.tagHeight, r.z).project(camera);
    const dc = camera.position.distanceTo(r.rig.holder.position);
    const ok = _tv.z > -1 && _tv.z < 1 && dc < (aerial ? 800 : 70);
    r.tag.style.visibility = ok ? 'visible' : 'hidden';
    if (ok) r.tag.style.transform = `translate(${((_tv.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-_tv.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%)`;
  }
}

// our own expressions / gestures are also sent to the other visitors
function doEmote(name, secs = 3.5) { if (rig.emote(name, secs) && net) net.event('e', name); return true; }
function doGesture(name, secs = 3) { const ok = rig.gesture(name, secs); if (ok && net) net.event('g', name); return ok; }

/* ------------------------------------------------------------------ input */
const keys = {};
let joy = { x: 0, y: 0 }, runToggle = false, inputReady = false;
function initInput() {
  if (inputReady) return; inputReady = true;
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') e.target.blur(); return; }
    keys[e.code] = true;
    if (e.code === 'KeyV') voice && voice.toggle();
    if (e.code === 'KeyL') toggleLabels();
    if (e.code === 'KeyT') (tour.active ? stopTour(true) : startTour(0));
    if (e.code === 'KeyM') $('#panelPlaces').hidden = !$('#panelPlaces').hidden;
    if (e.code === 'Equal' || e.code === 'NumpadAdd') stepBoost(+1);
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') stepBoost(-1);
    if (e.code === 'Digit1') setView('aerial');
    if (e.code === 'Digit2') setView('follow');
    if (e.code === 'Digit3') setView('first');
    if (e.code === 'Escape') { cancelAll(); say('Stopped.', { speak: false }); }
    if (e.code === 'KeyE') run([{ type: 'pick', count: 1 }], true);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (view.mode === 'aerial') { aer.yaw -= dx * 0.005; aer.pitch = Math.min(1.45, Math.max(0.12, aer.pitch + dy * 0.004)); aer.lastDrag = nowSec(); view.intro = false; }
    else if (view.mode === 'first') { fp.yaw -= dx * 0.0042; fp.pitch = Math.min(1.2, Math.max(-1.2, fp.pitch - dy * 0.0036)); }
    else { cam.yaw -= dx * 0.0055; cam.pitch = Math.min(1.35, Math.max(0.05, cam.pitch + dy * 0.004)); cam.lastDrag = nowSec(); }
  });
  const up = () => { drag = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    const f = 1 + Math.sign(e.deltaY) * 0.08;
    if (view.mode === 'aerial') { aer.dist = Math.min(560, Math.max(40, aer.dist * f)); view.intro = false; }
    else if (view.mode === 'follow') cam.dist = Math.min(40, Math.max(2.5, cam.dist * f));
    e.preventDefault();
  }, { passive: false });
  // touch joystick
  const joyEl = $('#joy'), knob = $('#knob'); let jid = null;
  const setJoy = (e) => {
    const r = joyEl.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    joy.x = dx; joy.y = -dy; knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
  };
  joyEl.addEventListener('pointerdown', (e) => { jid = e.pointerId; joyEl.setPointerCapture(jid); setJoy(e); e.stopPropagation(); });
  joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === jid) setJoy(e); });
  const jend = (e) => { if (e.pointerId === jid) { jid = null; joy.x = joy.y = 0; knob.style.transform = ''; } };
  joyEl.addEventListener('pointerup', jend); joyEl.addEventListener('pointercancel', jend);
  $('#btnRun').onclick = () => { runToggle = !runToggle; $('#btnRun').classList.toggle('on', runToggle); };

  $('#vAerial').onclick = () => setView('aerial'); $('#vFollow').onclick = () => setView('follow'); $('#vFirst').onclick = () => setView('first');
  document.querySelectorAll('#emotes button').forEach((b) => {
    b.onclick = () => { if (b.dataset.e) doEmote(b.dataset.e, 3.5); else if (b.dataset.g) doGesture(b.dataset.g, b.dataset.g === 'Wave' ? 3.4 : 3.0); };
  });
  $('#btnSpeed').onclick = cycleBoost;
  $('#btnPlaces').onclick = () => { $('#panelPlaces').hidden = !$('#panelPlaces').hidden; $('#panelTour').hidden = true; };
  $('#btnTourPanel').onclick = () => { $('#panelTour').hidden = !$('#panelTour').hidden; $('#panelPlaces').hidden = true; };
  $('#btnLabels').onclick = toggleLabels;
  $('#btnGuide').onclick = () => { voice.speakOn = !voice.speakOn; if (!voice.speakOn) voice.cancelSpeech(); $('#btnGuide').classList.toggle('on', voice.speakOn); };
  $('#btnFull').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  $('#mic').onclick = () => { if (!voice.supported) return toast('Voice input needs Chrome or Edge. You can type commands instead.', 4000); voice.toggle(); };
  $('#send').onclick = () => submitCommand($('#cmd').value);
  $('#cmd').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCommand($('#cmd').value); });
  $('#tStart').onclick = () => startTour(0);
  $('#tStop').onclick = () => stopTour(true);
  $('#tPause').onclick = () => pauseTour();
  $('#tNext').onclick = () => tourStep(+1);
  $('#tPrev').onclick = () => tourStep(-1);
  $('#sUp').onclick = () => stepBoost(+1); $('#sDown').onclick = () => stepBoost(-1);
}
function toggleLabels(force) {
  labelsOn = typeof force === 'boolean' ? force : !labelsOn;
  $('#btnLabels').classList.toggle('on', labelsOn);
}
function onVoiceState(s) {
  $('#mic').classList.toggle('on', s === 'on');
  if (s === 'on') { toast('Listening… say a command'); $('#transcript').textContent = ''; }
  if (s === 'denied') toast('Microphone permission denied. Allow it in the browser, or type commands.', 4500);
}
function onVoiceFinal(t) { $('#transcript').textContent = '“' + t + '”'; submitCommand(t); setTimeout(() => { if ($('#transcript').textContent.includes(t)) $('#transcript').textContent = ''; }, 2500); }

/* ------------------------------------------------------------------ command execution (queue of tasks) */
const queue = []; let current = null;
function cancelAll() {
  if (current && current.cancel) current.cancel();
  current = null; queue.length = 0;
  if (player) { player.cancelPath(); player.forward = false; player.frozen = false; }
  if (tour.active) stopTour(false);
}
function run(cmds, replace = true) {
  if (replace) cancelAll();
  for (const c of cmds) queue.push(c);
}
function submitCommand(text) {
  text = (text || '').trim(); if (!text) return;
  $('#cmd').value = ''; $('#cmd').blur();
  const cmds = parseCommand(text, places);
  if (!cmds.length) return;
  const unknown = cmds.find((c) => c.type === 'unknown');
  if (unknown && cmds.length === 1) { toast(`Sorry, I didn't understand “${text}”. Try: “go to the cafe”.`, 4000); return; }
  const real = cmds.filter((c) => c.type !== 'unknown');
  if (real[0].type === 'stop') { cancelAll(); say('Okay, stopping.'); return; }
  if (view.mode === 'aerial' && real.some((c) => ['goto', 'move', 'pick', 'gait'].includes(c.type))) setView('follow');
  run(real, true);
}
function goPoint(x, z) {
  const path = nav.findPath(player.x, player.z, x, z);
  if (!path) return toast('I cannot walk there.');
  cancelAll();
  player.followPath(path, { gait: player.pref });
}

const farmZone = (x, z) => x > 80 && x < 202 && z < -141 && z > -216;
const DIRV = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

function pathTask(path, gait, msg, after) {
  let done = false;
  return {
    start() { if (msg) say(msg); player.followPath(path, { gait, onDone: () => { done = true; after && after(); } }); },
    update() { return done; },
    cancel() { player.cancelPath(); },
  };
}
function instant(fn) { return { start() { fn(); }, update() { return true; } }; }

function makeTasks(cmd) {
  switch (cmd.type) {
    case '_task': return [cmd.task];
    case 'goto': {
      const p = placeMap[cmd.place];
      player.pref = cmd.gait || 'walk';
      const path = nav.findPath(player.x, player.z, p.stand.x, p.stand.z);
      if (!path) return [instant(() => say(`I can't find a way to ${p.name}.`))];
      if (Math.hypot(player.x - p.stand.x, player.z - p.stand.z) < 2) return [instant(() => say(`You are already at ${p.name}.`))];
      return [pathTask(path, player.pref, `${player.pref === 'run' ? 'Running' : 'Going'} to ${p.name}`, () => arrived(p))];
    }
    case 'move': {
      let v;
      if (DIRV[cmd.dir]) v = DIRV[cmd.dir];
      else {
        const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
        v = { forward: [fx, fz], forwards: [fx, fz], ahead: [fx, fz], straight: [fx, fz], back: [-fx, -fz], backward: [-fx, -fz], backwards: [-fx, -fz], left: [fz, -fx], right: [-fz, fx] }[cmd.dir];
      }
      const d = nav.rayDistance(player.x, player.z, v[0], v[1], cmd.meters);
      if (d < 1) return [instant(() => say("Something is in the way, I can't go that direction."))];
      player.pref = cmd.gait;
      const target = { x: player.x + v[0] * d, z: player.z + v[1] * d };
      return [pathTask([target], cmd.gait, `${cmd.gait === 'run' ? 'Running' : 'Walking'} ${cmd.dir} ${Math.round(d)} meters`)];
    }
    case 'turn': return [{ t: 0, start() { player.turnBy(-cmd.deg * Math.PI / 180); }, update(dt) { this.t += dt; return player.turnTarget === null || this.t > 1.5; } }];
    case 'face': return [{ t: 0, start() { player.faceDir(...DIRV[cmd.dir]); }, update(dt) { this.t += dt; return player.turnTarget === null || this.t > 1.5; } }];
    case 'gait': return [{
      t: 0,
      start() { player.pref = cmd.gait; player.cancelPath(); player.forward = true; toast(cmd.gait === 'run' ? 'Running… say “stop” to stop' : 'Walking… say “stop” to stop', 2200); },
      update(dt) { this.t += dt; return (queue.length > 0 && this.t > 5) || !player.forward; },
      cancel() { player.forward = false; },
    }];
    case 'pick': {
      const tasks = [];
      if (!farmZone(player.x, player.z)) tasks.push(...makeTasks({ type: 'goto', place: 'melon_farm', gait: player.pref }));
      for (let i = 0; i < (cmd.count || 1); i++) tasks.push(pickTask());
      return tasks;
    }
    case 'tour': return [instant(() => ({ start: () => startTour(0), stop: () => stopTour(true), pause: pauseTour, resume: resumeTour, next: () => tourStep(+1), prev: () => tourStep(-1) })[cmd.action]())];
    case 'emote': return [instant(() => { if (doEmote(cmd.name, 4)) { if (rig.supportsFace) toast(`Expression: ${cmd.name}`, 1500); else toast('This avatar has no facial expressions. Pick the Melon Explorer!', 3200); } })];
    case 'gesture': return [{
      t: 0,
      start() { player.cancelPath(); this.ok = doGesture(cmd.name, cmd.name === 'Wave' ? 3.4 : 3.0); if (!this.ok) toast('This avatar cannot do that gesture.', 2500); },
      update(dt) { this.t += dt; return !this.ok || !rig.busy || this.t > 6; },
      cancel() { rig.cancelGesture && rig.cancelGesture(); },
    }];
    case 'labels': return [instant(() => { toggleLabels(cmd.show); toast(cmd.show ? 'Labels on' : 'Labels off'); })];
    case 'speed': return [instant(() => stepBoost(cmd.delta))];
    case 'speedSet': return [instant(() => setBoost(cmd.value))];
    case 'where': return [instant(() => { const n = nearestPlace(); say(n ? `You are near ${n.name}.` : 'You are on the farm.'); })];
    case 'help': return [instant(() => say('You can say: go to the cafe, run to the pool, walk north twenty meters, turn left, pick up a melon, start the tour, double speed, or stop.'))];
    default: return [];
  }
}
function pickTask() {
  let done = false;
  return {
    start() {
      player.frozen = true; player.cancelPath();
      if (net) net.event('g', 'Pick');
      rig.playPick(() => { melons++; $('#melonCount').textContent = melons; toast('🍈 Picked a melon!'); rig.emote('Laugh', 2.4); }, () => { player.frozen = false; done = true; });
    },
    update() { return done; },
    cancel() { player.frozen = false; rig.action = null; rig.carry.visible = false; },
  };
}
function arrived(p) {
  rig.emote('Happy', 3);
  if (tour.active) return;
  showCaption(p.name, PLACE_INFO[p.id] || '');
  if (PLACE_INFO[p.id] && voice) voice.say(PLACE_INFO[p.id]);
  setTimeout(hideCaption, 8000);
}
function nearestPlace(maxD = 18) {
  let best = null, bd = maxD;
  for (const p of places) { const d = Math.hypot(player.x - p.stand.x, player.z - p.stand.z); if (d < bd) { bd = d; best = p; } }
  return best;
}
function updateDirector(dt) {
  if (current) { if (current.update(dt)) current = null; }
  while (!current && queue.length) {
    const cmd = queue.shift();
    const tasks = makeTasks(cmd);
    if (tasks.length) { const [first, ...rest] = tasks; current = first; for (let i = rest.length - 1; i >= 0; i--) queue.unshift({ type: '_task', task: rest[i] }); first.start(); }
  }
}

/* ------------------------------------------------------------------ guided tour (every place, in order) */
const tour = { active: false, paused: false, i: -1, state: 'idle', dwell: 0, speechDone: false, visited: [] };
function updateTourUI() {
  const s = tour.active ? stops[tour.i] : null;
  $('#tourStatus').textContent = !tour.active ? `Not started – ${stops.length} stops` :
    `${tour.paused ? 'Paused – ' : tour.state === 'walk' ? 'Walking to ' : 'At '}${s ? s.name : '…'}  (${tour.i + 1} of ${stops.length})`;
  $('#tStart').textContent = tour.active ? '↺ Restart' : '▶ Start';
  $('#tourList').querySelectorAll('button').forEach((b) => {
    const k = Number(b.dataset.k);
    b.classList.toggle('cur', tour.active && k === tour.i);
    b.classList.toggle('done', tour.visited.includes(k));
  });
  const cur = $('#tourList .cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
}
function startTour(from = 0) {
  cancelAll(); tour.active = true; tour.paused = false; tour.visited = []; player.frozen = false;
  if (view.mode === 'aerial') setView('follow', true);
  updateTourUI(); $('#panelTour').hidden = true;
  toast(`Guided tour: ${stops.length} stops (use ⚡ for 2× / 3× speed)`, 3000);
  goStop(from);
}
function stopTour(announce) {
  if (!tour.active) return;
  tour.active = false; tour.paused = false; tour.state = 'idle'; player.cancelPath(); player.frozen = false; voice && voice.cancelSpeech(); hideCaption(); updateTourUI();
  if (announce) toast('Tour stopped. You are free to explore.');
}
function pauseTour() { if (!tour.active) return; tour.paused = !tour.paused; player.frozen = tour.paused; updateTourUI(); toast(tour.paused ? 'Tour paused' : 'Tour resumed'); }
function resumeTour() { if (tour.active && tour.paused) pauseTour(); }
function tourStep(d) { if (!tour.active) return startTour(0); player.frozen = false; tour.paused = false; voice && voice.cancelSpeech(); goStop(Math.min(stops.length, Math.max(0, tour.i + d))); }
function goStop(k) {
  if (k >= stops.length) return finishTour();
  tour.i = k; tour.state = 'walk'; hideCaption(); updateTourUI();
  const p = stops[k];
  const path = nav.findPath(player.x, player.z, p.stand.x, p.stand.z);
  if (!path) { toast(`Could not find a route to ${p.name}, skipping`); return goStop(k + 1); }
  player.followPath(path, { gait: 'walk', onDone: () => arriveStop(k) });
}
function arriveStop(k) {
  if (!tour.active || tour.i !== k) return;
  const p = stops[k];
  rig.emote('Happy', 4); if (k % 3 === 0) doGesture(rig.canGesture('Wave') ? 'Wave' : 'Cheer', 2.6);
  tour.state = 'talk'; tour.dwell = 0; tour.speechDone = false; tour.visited.push(k); updateTourUI();
  (window.__stopLog = window.__stopLog || []).push(p.id);
  const txt = PLACE_INFO[p.id] || p.name;
  showCaption(`${k + 1}/${stops.length}  ${p.name}`, txt);
  if (voice.speakOn) voice.say(txt, () => { if (tour.active && tour.i === k) tour.speechDone = true; }); else tour.speechDone = true;
}
function finishTour() {
  tour.active = false; tour.state = 'idle'; updateTourUI(); hideCaption();
  say('That was the whole tour. Thank you for visiting Navita Melon Farm! You are free to explore now.');
}

/* ------------------------------------------------------------------ loop */
let last = nowSec(), hudTimer = 0;
function step(dt) {
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let iy = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  ix += joy.x; iy += joy.y;
  const userMoving = Math.hypot(ix, iy) > 0.1;
  if (userMoving && (player.hasPath || player.forward || current || tour.active) && !player.frozen) cancelAll();
  player.input.x = ix; player.input.y = iy; player.input.run = !!(keys.ShiftLeft || keys.ShiftRight) || runToggle;
  if (userMoving) { player.pref = player.input.run ? 'run' : 'walk'; if (view.intro) view.intro = false; }

  updateDirector(dt);
  if (tour.active && tour.state === 'talk' && !tour.paused) {
    tour.dwell += dt;
    if (tour.dwell >= 4 && (tour.speechDone || tour.dwell >= 18)) goStop(tour.i + 1);
  }
  player.update(dt, moveYaw());
  rig.setTalking(!!(voice && voice.speaking));
  rig.update(dt, player.speed, player.gait);
  rig.holder.position.set(player.x, player.y + rig.bobY, player.z);
  rig.holder.rotation.set(0, player.yaw, 0);
  if (net) net.sendState({ x: player.x, y: player.y, z: player.z, yaw: player.yaw, sp: player.speed }, nowSec());
  updateRemotes(dt);
}
function loop() {
  requestAnimationFrame(loop);
  const now = nowSec(), dt = Math.min(0.05, now - last); last = now;
  if (started) {
    step(dt);
    if (view.intro) { view.introT -= dt; if (view.introT <= 0) { view.intro = false; setView('follow'); } }
    updateCamera(dt, now);
    updateLabels(); updateTags();
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.1;
      const n = nearestPlace(14);
      $('#where').textContent = n ? n.name : (nav.walkable(player.x, player.z) ? 'On the farm' : '—');
      minimap.draw(player, moveYaw(), tourIndexOf, tour.active && stops[tour.i] ? stops[tour.i].id : null, [...remotes.values()]);
    }
  }
  if (started) renderer.render(scene, camera);
}
loop();

/* ------------------------------------------------------------------ test / debug hooks (?test=1) */
function runTestScript() {
  window.__app = { player, rig, nav, cam, aer, places, remotes, tour, startTour, setView, setBoost, run: (t) => submitCommand(t), get net() { return net; } };
  if (params.get('boost')) setBoost(Number(params.get('boost')), true);
  const walk = params.get('walk');
  if (walk) { const [g, secs] = walk.split(':'); player.pref = g; player.forward = true; for (let i = 0; i < Number(secs) * 30; i++) step(1 / 30); cam.target.set(player.x, player.y + rig.camHeight, player.z); }
  if (params.get('nohud')) for (const s of ['#bottom', '#topleft', '#topright', '#minimap', '#emotes', '#views', '#caption', '#toast', '#online']) { const e = document.querySelector(s); if (e) e.style.display = 'none'; }
  if (params.get('emote')) rig.emote(params.get('emote'), 999);
  if (params.get('gesture')) { rig.gesture(params.get('gesture'), 999); const secs = Number(params.get('gt') || 0.6); for (let i = 0; i < secs * 30; i++) rig.update(1 / 30, 0, 'idle'); }
  if (params.get('say')) setTimeout(() => submitCommand(params.get('say')), 500);
  if (params.get('tour')) startTour(Number(params.get('tour')) - 1 || 0);
  if (params.get('panel')) { $('#panel' + params.get('panel')).hidden = false; }
  if (params.get('sim')) { const secs = Number(params.get('sim')); setTimeout(() => { for (let i = 0; i < secs * 30; i++) step(1 / 30); camPos.copy(_des); }, 800); }
  $('#start').hidden = true;
  const dbg = document.createElement('pre'); dbg.id = 'dbg';
  dbg.style.cssText = 'position:fixed;left:6px;bottom:6px;max-width:92vw;white-space:pre-wrap;font:12px monospace;color:#0f0;background:rgba(0,0,0,.8);padding:6px;z-index:99;pointer-events:none';
  if (params.get('dbg')) document.body.appendChild(dbg);
  setInterval(() => {
    dbg.textContent = JSON.stringify({
      me: { name: myName, speed: +player.speed.toFixed(2), boost: player.boost, pos: [+player.x.toFixed(1), +player.z.toFixed(1)], clips: Object.keys(rig.clips), face: rig.supportsFace, legs: !!rig.legs, w: rig.w },
      anim: { w: Object.fromEntries(Object.entries(rig.w).map(([k, v]) => [k, +v.toFixed(2)])), t: Object.fromEntries(Object.entries(rig.act).map(([k, a]) => [k, +a.time.toFixed(2)])), eff: Object.fromEntries(Object.entries(rig.act).map(([k, a]) => [k, +a.getEffectiveWeight().toFixed(2)])), runScale: rig.act.Run ? +rig.act.Run.timeScale.toFixed(2) : null },
      net: net ? { connected: net.connected, id: net.id, online: net.online } : null,
      remotes: [...remotes.values()].map((r) => ({ name: r.name, av: r.avatar, pos: [+r.x.toFixed(1), +r.z.toFixed(1)], sp: +r.speed.toFixed(2), shown: r.shown })),
      tourVisited: window.__stopLog || [],
    });
  }, 300);
}
