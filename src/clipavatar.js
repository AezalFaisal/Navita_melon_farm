// Rigged avatar driven by REAL animation clips from the GLB (Idle / Walk / Run / Pick / Wave / Cheer),
// with optional facial expressions (morph targets) when the model has them (Melon Explorer).
import * as THREE from 'three';

const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const OPEN_MOUTH = new Set(['Laugh', 'Surprised', 'Happy', 'Talk']);
const NO_BLINK = new Set(['Happy', 'Laugh', 'Wink', 'Relax', 'Blink']);
const CANON = ['Idle', 'Walk', 'Run', 'Pick', 'Wave', 'Cheer'];

export class ClipAvatar {
  // gltf: { scene, animations }   cfg: entry from avatars.js
  constructor(gltf, cfg = {}) {
    this.cfg = cfg;
    this.holder = new THREE.Group();
    this.model = gltf.scene;
    if (cfg.scale && cfg.scale !== 1) this.model.scale.multiplyScalar(cfg.scale);
    this.holder.add(this.model);
    const H = cfg.height || 1.4;
    this.height = H;
    this.camHeight = 0.70 * H;        // follow-camera look-at height
    this.eyeHeight = 0.90 * H;        // first-person eye height
    this.tagHeight = 1.12 * H;        // name tag height (raised above the head below, once the model's real height is known)
    this.previewCam = { y: 0.54 * H, dist: 2.9 * H };
    this.bobY = 0;
    this.t = Math.random() * 10;

    this.bones = {};
    this.faceMeshes = [];
    this.model.traverse((o) => {
      if (o.isBone) { this.bones[o.name] = o; this.bones[o.name.replace(/[.\s]/g, '')] = o; }      // the loader strips dots: 'Thigh.R' -> 'ThighR'
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true; o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (/^(EyeWhite|EyeIris|EyePupil|EyeHighlight|BrowLash|Mouth|Tongue|Blush)/.test(m.name)) {
            m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -4;     // keep face stickers on top at any distance
          }
          if (m.transparent) m.depthWrite = false;
        }
        if (o.morphTargetDictionary && o.morphTargetInfluences) this.faceMeshes.push(o);
      }
    });
    this.supportsFace = this.faceMeshes.length > 0;
    this.keys = this.supportsFace ? Object.keys(this.faceMeshes[0].morphTargetDictionary) : [];
    this.cur = Object.fromEntries(this.keys.map((k) => [k, 0]));
    this.exprName = null; this.exprT = 0; this.blinkT = 1.5; this.blinkPhase = 0; this.talking = false;

    // animation clips: map our names -> the names used in this file
    this.mixer = new THREE.AnimationMixer(this.model);
    const map = cfg.clips || Object.fromEntries(CANON.map((c) => [c, c]));
    this.clips = {};
    for (const [canon, src] of Object.entries(map)) {
      const c = (gltf.animations || []).find((a) => a.name === src);
      if (c) this.clips[canon] = c;
    }
    if (!this.clips.Wave && this.clips.Cheer) this.clips.Wave = this.clips.Cheer;    // avatars without a Wave use their celebration
    if (!this.clips.Cheer && this.clips.Wave) this.clips.Cheer = this.clips.Wave;
    this.act = {};
    for (const n of CANON) {
      if (!this.clips[n]) continue;
      const a = this.mixer.clipAction(this.clips[n]);
      a.enabled = true; a.setEffectiveWeight(n === 'Idle' ? 1 : 0);
      if (n === 'Idle' || n === 'Walk' || n === 'Run') a.play();
      this.act[n] = a;
    }
    this._initLegs();
    this.model.updateMatrixWorld(true);                                   // tag floats clearly above the top of the head / hat
    const top = new THREE.Box3().setFromObject(this.model).max.y;
    if (isFinite(top) && top > 0.5 && top < 4) this.tagHeight = Math.max(this.tagHeight, top + 0.28);
    this.designWalk = cfg.designWalk || 1.2; this.designRun = cfg.designRun || 3.0;
    this.w = { idle: 1, walk: 0, run: 0 };
    this.gest = null;                       // { name, t, dur, w, onPeak, onDone, peaked }
    this.carry = this._makeMelon(); this.carry.visible = false; this.holder.add(this.carry);
    this.mixer.update(0.001);
  }

  _makeMelon() {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.085, 18, 14), new THREE.MeshStandardMaterial({ color: 0xc9d97a, roughness: 0.6 }));
    m.scale.set(1.12, 1, 1); m.castShadow = true; return m;
  }

  /* ---------------- procedural legs ----------------
     Some models (the Tripo characters) are built in a mid-stride pose and their Walk clip only swings the legs a little
     around that pose, so the feet look crossed. For those avatars (cfg.legs) the legs are driven here instead:
     mirrored thigh / knee / foot swing, in phase with the Walk / Run clip, straight legs when standing. */
  _modelQuat(bone) {
    const q = new THREE.Quaternion();
    for (let b = bone; b && b !== this.model; b = b.parent) q.premultiply(b.quaternion);
    return q;
  }
  _initLegs() {
    this.legs = null;
    const L = this.cfg.legs; if (!L) return;
    const names = { L: ['Thigh.L', 'Shin.L', 'Foot.L'], R: ['Thigh.R', 'Shin.R', 'Foot.R'], ...(typeof L === 'object' ? L : {}) };
    const legs = [];
    for (const side of ['R', 'L']) {
      const [t, s, f] = names[side].map((n) => this.bones[n.replace(/[.\s]/g, '')]);
      if (!t || !s || !f) return;
      legs.push({
        side, t, s, f,
        qT: t.quaternion.clone(), qS: s.quaternion.clone(),
        dirT: new THREE.Vector3().copy(s.position).normalize().applyQuaternion(t.quaternion),   // bind direction of the thigh, in the hip's frame
        dirS: new THREE.Vector3().copy(f.position).normalize().applyQuaternion(s.quaternion),
        qFootModel: this._modelQuat(f),
      });
    }
    this.legs = legs;
    this._lq = { P: new THREE.Quaternion(), Q1: new THREE.Quaternion(), Q2: new THREE.Quaternion(), tmp: new THREE.Quaternion(), arc: new THREE.Quaternion(), rx: new THREE.Quaternion() };
    this._lv = new THREE.Vector3(); this._ax = new THREE.Vector3(1, 0, 0);
  }
  _driveLegs() {
    if (!this.legs) return;
    const runF = this.w.run / Math.max(0.001, this.w.walk + this.w.run);
    const mv = Math.min(1, this.w.walk + this.w.run);
    const A = mv * (0.52 + (0.85 - 0.52) * runF), K = mv * (0.75 + (1.35 - 0.75) * runF), FOOT = 0.45;
    const act = runF > 0.5 && this.act.Run ? this.act.Run : this.act.Walk;
    const p = act ? ((act.time / act.getClip().duration) % 1 + 1) % 1 : 0;
    const { P, Q1, Q2, tmp, arc, rx } = this._lq, v = this._lv;
    this.legs.forEach((lg, i) => {
      const ph = 2 * Math.PI * p + (i ? Math.PI : 0);
      const th = A * Math.sin(ph);                              // thigh swing, + = forward
      const knee = K * Math.max(0, Math.cos(ph)) + 0.05;        // knee bends while the leg swings forward
      P.copy(this._modelQuat(lg.t.parent));
      // legs are spread outwards a little (more while walking, extra for the leg that swings forward) so the feet never cross when seen from behind
      const side = lg.side === 'R' ? -1 : 1;
      const ab = 0.10 + 0.14 * mv + 0.12 * mv * Math.max(0, Math.cos(ph));
      // thigh
      v.set(side * Math.sin(ab), -Math.cos(th) * Math.cos(ab), Math.sin(th) * Math.cos(ab)).normalize().applyQuaternion(tmp.copy(P).invert());
      arc.setFromUnitVectors(lg.dirT, v); lg.t.quaternion.copy(arc).multiply(lg.qT);
      // shin
      Q1.copy(P).multiply(lg.t.quaternion);
      const ph2 = th - knee, ab2 = ab * 0.45;
      v.set(side * Math.sin(ab2), -Math.cos(ph2) * Math.cos(ab2), Math.sin(ph2) * Math.cos(ab2)).normalize().applyQuaternion(tmp.copy(Q1).invert());
      arc.setFromUnitVectors(lg.dirS, v); lg.s.quaternion.copy(arc).multiply(lg.qS);
      // foot: keep the sole level, toe up when the leg is forward, toe down when pushing off
      Q2.copy(Q1).multiply(lg.s.quaternion);
      rx.setFromAxisAngle(this._ax, -FOOT * (th / Math.max(0.01, A)) * mv * 0.8 + 0.12 * (ph2 - th) * 0);
      tmp.copy(rx).multiply(lg.qFootModel);
      lg.f.quaternion.copy(Q2.invert()).multiply(tmp);
    });
  }

  /* ---------------- expressions (Melon Explorer only) ---------------- */
  emote(name, seconds = 2.5) {
    if (!this.keys.includes(name)) { this.exprName = null; return false; }
    this.exprName = name; this.exprT = seconds; return true;
  }
  setTalking(v) { this.talking = !!v; }
  _face(dt) {
    if (!this.faceMeshes.length) return;
    if (this.exprT > 0) { this.exprT -= dt; if (this.exprT <= 0) this.exprName = null; }
    const target = {};
    if (this.exprName) target[this.exprName] = 1;
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkPhase = 0.13; this.blinkT = 2 + Math.random() * 3.5; }
    if (this.blinkPhase > 0) { this.blinkPhase -= dt; if (!NO_BLINK.has(this.exprName)) target.Blink = 1; }
    if (this.talking && !OPEN_MOUTH.has(this.exprName)) target.Talk = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.t * 13));
    const k = Math.min(1, dt * 16);
    for (const key of this.keys) this.cur[key] += ((target[key] || 0) - this.cur[key]) * k;
    for (const m of this.faceMeshes) {
      const d = m.morphTargetDictionary, inf = m.morphTargetInfluences;
      for (const key of this.keys) inf[d[key]] = this.cur[key];
    }
  }

  /* ---------------- gestures & actions ---------------- */
  canGesture(name) { return !!this.clips[name]; }
  gesture(name, seconds = 3) {
    if (name === 'Pick') { this.playPick(null, null); return true; }
    const a = this.act[name]; if (!a || this.gest) return false;
    a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; a.play();
    this.gest = { name, t: 0, dur: seconds, w: 0 };
    return true;
  }
  playPick(onPeak, onDone) {
    const a = this.act.Pick; if (!a) { onPeak && onPeak(); onDone && onDone(); return; }
    this.cancelGesture();
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
    this.gest = { name: 'Pick', t: 0, dur: this.clips.Pick.duration, w: 0, onPeak, onDone, peaked: false, peakAt: this.clips.Pick.duration * 0.5 };
  }
  cancelGesture() {
    if (!this.gest) return;
    const a = this.act[this.gest.name]; a.stop(); a.setEffectiveWeight(0); this.gest = null; this.carry.visible = false;
  }
  get busy() { return !!this.gest; }
  get action() { return this.gest; }
  set action(v) { if (!v) this.cancelGesture(); }

  /* ---------------- per-frame ---------------- */
  update(dt, speed, gait) {
    this.t += dt;
    const moving = Math.min(1, speed / 0.5);
    const runB = smooth((speed - 2.4) / 1.2);
    const tw = { idle: 1 - moving, walk: moving * (1 - runB), run: moving * runB };
    const k = Math.min(1, dt * 10);
    for (const key of ['idle', 'walk', 'run']) this.w[key] += (tw[key] - this.w[key]) * k;

    let g = 0;
    if (this.gest) {
      const G = this.gest; G.t += dt;
      const fin = Math.min(1, G.t / 0.18), fout = Math.min(1, (G.dur - G.t) / 0.22);
      g = Math.max(0, Math.min(fin, fout)); G.w = g;
      this.act[G.name].setEffectiveWeight(g);
      if (G.name === 'Pick' && !G.peaked && G.t >= G.peakAt) { G.peaked = true; this.carry.visible = true; G.onPeak && G.onPeak(); }
      if (G.t >= G.dur) {
        const done = G.onDone; this.act[G.name].stop(); this.act[G.name].setEffectiveWeight(0);
        const isPick = G.name === 'Pick'; this.gest = null; done && done();
        if (isPick) setTimeout(() => { if (!this.gest) this.carry.visible = false; }, 1400);
      }
    }
    const base = 1 - g;
    this.act.Idle && this.act.Idle.setEffectiveWeight(this.w.idle * base);
    if (this.act.Walk) { this.act.Walk.setEffectiveWeight(this.w.walk * base); this.act.Walk.timeScale = Math.min(4, Math.max(0.6, speed / this.designWalk)); }
    if (this.act.Run) { this.act.Run.setEffectiveWeight(this.w.run * base); this.act.Run.timeScale = Math.min(3.5, Math.max(0.7, speed / this.designRun)); }
    this.mixer.update(dt);
    this._driveLegs();

    // carried melon follows the right hand (holder space)
    const hb = this.bones[(this.cfg.handBone || 'RightHand').replace(/[.\s]/g, '')];
    if (this.carry.visible && hb) {
      this.holder.updateWorldMatrix(true, false);
      const p = new THREE.Vector3(); hb.getWorldPosition(p);
      this.holder.worldToLocal(p); p.y -= 0.03; this.carry.position.copy(p);
    }
    this._face(dt);
  }
}
