// Pooled effects: debris particles, glowing sparks, shockwave rings,
// projectiles, marching columns, impact flashes, and lingering smoke over
// battlefields. Nothing is allocated per event.

import * as THREE from 'three';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpP = new THREE.Vector3();

class ParticlePool {
  constructor(parent, geo, mat, size) {
    this.mesh = new THREE.InstancedMesh(geo, mat, size);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.items = Array.from({ length: size }, () => ({
      alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(),
      spin: new THREE.Vector3(), life: 0, max: 1, size: 1, grav: 1, drag: 0, grow: 0,
    }));
    this.next = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < size; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    parent.add(this.mesh);
  }

  spawn(pos, vel, color, { life = 0.6, size = 0.2, grav = 1, drag = 0, grow = 0, spin = 16 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.items.length;
    const it = this.items[i];
    it.alive = true; it.p.copy(pos); it.v.copy(vel);
    it.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    it.spin.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
    it.life = 0; it.max = life; it.size = size; it.grav = grav; it.drag = drag; it.grow = grow;
    this.mesh.setColorAt(i, color);
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.alive) continue;
      any = true;
      it.life += dt;
      if (it.life >= it.max) {
        it.alive = false;
        tmpM.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, tmpM);
        continue;
      }
      it.v.y -= 22 * it.grav * dt;
      if (it.drag) it.v.multiplyScalar(Math.pow(1 - it.drag, dt * 60));
      it.p.addScaledVector(it.v, dt);
      if (it.p.y < 0.1 && it.grav > 0) { it.p.y = 0.1; it.v.y *= -0.35; it.v.x *= 0.6; it.v.z *= 0.6; }
      it.r.addScaledVector(it.spin, dt);
      // Scale out rather than fade: survives bright backgrounds.
      const k = 1 - it.life / it.max;
      const s = it.size * (k < 0.3 ? k / 0.3 : 1) * (1 + it.grow * (1 - k));
      tmpS.set(s, s, s);
      tmpM.compose(it.p, tmpQ.setFromEuler(tmpE.set(it.r.x, it.r.y, it.r.z)), tmpS);
      this.mesh.setMatrixAt(i, tmpM);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Fx {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world; // group that shakes
    this.debris = new ParticlePool(world, new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 }), 400);
    this.debris.mesh.castShadow = true;
    this.sparks = new ParticlePool(world, new THREE.OctahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ toneMapped: false }), 500);

    // Smoke: soft low-poly puffs that rise, swell and thin out.
    this.smoke = new ParticlePool(world, new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ flatShading: true, transparent: true, opacity: 0.5, depthWrite: false }), 260);
    this.smolders = new Map(); // key -> { pos, heat, acc, ember }
    this.smokeColor = new THREE.Color();
    this.emberColor = new THREE.Color(0xff7a2a).multiplyScalar(2);

    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      }));
      m.visible = false;
      world.add(m);
      this.rings.push({ m, t: 0, dur: 0.5, size: 5 });
    }

    this.shots = [];
    const shotGeo = new THREE.SphereGeometry(0.22, 12, 8);
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(shotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      m.visible = false;
      world.add(m);
      this.shots.push({ m, alive: false });
    }

    this.flashes = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 18, 1.6);
      world.add(l);
      this.flashes.push({ l, t: 1, peak: 0 });
    }

    // Screen feel state.
    this.shake = 0;
    this.shakeAmp = 0;
    this.punch = 0;
    this.freeze = 0;
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  burst(pos, color, { count = 10, speed = 8, up = 6, size = 0.22, life = 0.7, sparks = 8, sparkColor } = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.35 + Math.random() * 0.8);
      tmpV.set(Math.cos(a) * sp, up * (0.5 + Math.random()), Math.sin(a) * sp);
      this.debris.spawn(pos, tmpV, c.clone().multiplyScalar(0.7 + Math.random() * 0.5),
        { life: life * (0.6 + Math.random() * 0.6), size: size * (0.5 + Math.random()) });
    }
    const sc = new THREE.Color(sparkColor ?? 0xffd27a).multiplyScalar(2.2);
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * 1.4 * (0.4 + Math.random());
      tmpV.set(Math.cos(a) * sp, up * 1.2 * Math.random() + 2, Math.sin(a) * sp);
      this.sparks.spawn(pos, tmpV, sc, { life: 0.25 + Math.random() * 0.3, size: 0.12 + Math.random() * 0.1, grav: 0.3, drag: 0.06 });
    }
  }

  // Rising confetti-like fountain for big moments.
  fountain(pos, colors, count = 40) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      tmpV.set(Math.cos(a) * sp, 10 + Math.random() * 9, Math.sin(a) * sp);
      const c = new THREE.Color(colors[i % colors.length]).multiplyScalar(1.8);
      this.sparks.spawn(pos, tmpV, c, { life: 1.1 + Math.random() * 0.6, size: 0.18 + Math.random() * 0.12, grav: 0.55, drag: 0.02 });
    }
  }

  ring(pos, color, { size = 5, dur = 0.5 } = {}) {
    const r = this.rings.find((x) => !x.m.visible) || this.rings[0];
    r.m.visible = true;
    r.m.position.copy(pos);
    r.m.position.y += 0.15;
    r.m.material.color.set(color).multiplyScalar(1.6);
    r.t = 0; r.dur = dur; r.size = size;
  }

  flash(pos, color = 0xffaa55, peak = 30) {
    const f = this.flashes.find((x) => x.t >= 1) || this.flashes[0];
    f.l.position.copy(pos).add(new THREE.Vector3(0, 2, 0));
    f.l.color.set(color);
    f.t = 0; f.peak = peak;
  }

  // Arcing projectile. Resolves when it lands. `hops` > 0 makes it walk
  // (small bounces) instead of fly; `delay` holds it back before it sets off.
  shoot(from, to, color, dur = 0.28, { h, hops = 0, scale = 1, delay = 0, trail = true } = {}) {
    return new Promise((resolve) => {
      const s = this.shots.find((x) => !x.alive) || this.shots[0];
      s.resolve?.(); // a recycled shot still owes its caller a landing
      s.alive = true;
      s.m.visible = false;
      s.m.scale.setScalar(scale);
      s.m.material.color.set(color).multiplyScalar(2.5);
      s.from = from.clone(); s.to = to.clone();
      s.t = -delay; s.dur = dur; s.resolve = resolve;
      s.h = h ?? 1.5 + from.distanceTo(to) * 0.25;
      s.hops = hops; s.trail = trail;
    });
  }

  // A column of troops marching from one territory to another.
  march(from, to, color, n = 5, dur = 0.55) {
    const hops = Math.max(2, Math.round(from.distanceTo(to) / 1.6));
    const landed = [];
    for (let i = 0; i < n; i++) {
      landed.push(this.shoot(from, to, color, dur, { h: 0.6 + from.distanceTo(to) * 0.08, hops, scale: 0.55, delay: i * 0.07, trail: false }));
    }
    return Promise.all(landed);
  }

  // Battlefields keep smouldering: smoke (and embers, when it's hot) rises
  // from `pos` and thins out over ~30 s. Repeated fighting stokes it.
  smolder(key, pos, heat) {
    const s = this.smolders.get(key);
    if (s) { s.heat = Math.min(1, s.heat + heat); s.pos.copy(pos); return; }
    this.smolders.set(key, { pos: pos.clone(), heat: Math.min(1, heat), acc: 0, ember: 0 });
  }
  clearSmolders() { this.smolders.clear(); }

  addShake(amount) {
    const a = this.reduced ? amount * 0.25 : amount;
    this.shake = Math.min(1, Math.max(this.shake, 1));
    this.shakeAmp = Math.min(0.9, Math.max(this.shakeAmp * this.shake, a)); // cap ~2% of field
  }
  addPunch(amount) { if (!this.reduced) this.punch = Math.min(0.06, Math.max(this.punch, amount)); }
  hitStop(ms) { this.freeze = Math.max(this.freeze, Math.min(0.11, ms / 1000)); }

  updateSmolders(dt) {
    if (!dt) return;
    const rate = this.reduced ? 3 : 6; // puffs per second at full heat
    for (const [key, s] of this.smolders) {
      s.heat -= dt / 30;
      if (s.heat <= 0) { this.smolders.delete(key); continue; }
      s.acc += dt * rate * (0.25 + s.heat);
      while (s.acc >= 1) {
        s.acc -= 1;
        const g = 0.22 + Math.random() * 0.1 + (1 - s.heat) * 0.2; // hot smoke is darker
        this.smokeColor.setRGB(g, g * 0.97, g * 0.95);
        tmpP.set(s.pos.x + (Math.random() - 0.5) * 0.8, s.pos.y + 0.3, s.pos.z + (Math.random() - 0.5) * 0.8);
        // A steady breeze leans every column the same way.
        tmpV.set(0.35 + (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 0.8, -0.1 + (Math.random() - 0.5) * 0.4);
        this.smoke.spawn(tmpP, tmpV, this.smokeColor, {
          life: 2.4 + Math.random() * 1.6, size: 0.28 + s.heat * 0.22, grav: -0.004, drag: 0.004, grow: -0.6, spin: 1.2,
        });
      }
      if (s.heat > 0.45 && !this.reduced) {
        s.ember += dt * 5 * s.heat;
        while (s.ember >= 1) {
          s.ember -= 1;
          tmpV.set((Math.random() - 0.5) * 1.4, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.4);
          this.sparks.spawn(s.pos, tmpV, this.emberColor, { life: 0.9 + Math.random() * 0.8, size: 0.06 + Math.random() * 0.05, grav: -0.02, drag: 0.03 });
        }
      }
    }
  }

  // Real dt drives screen feel; sim dt (frozen during hit-stop) drives particles.
  update(realDt) {
    let dt = realDt;
    if (this.freeze > 0) { this.freeze -= realDt; dt = 0; }

    this.debris.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.updateSmolders(dt);

    for (const r of this.rings) {
      if (!r.m.visible) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      r.m.scale.setScalar(0.3 + e * r.size);
      r.m.material.opacity = (1 - k) * 0.9;
    }

    for (const s of this.shots) {
      if (!s.alive) continue;
      s.t += dt;
      if (s.t < 0) continue;
      s.m.visible = true;
      const k = Math.min(1, s.t / s.dur);
      s.m.position.lerpVectors(s.from, s.to, k);
      s.m.position.y += Math.sin(k * Math.PI) * s.h;
      if (s.hops) s.m.position.y += Math.abs(Math.sin(k * Math.PI * s.hops)) * 0.35;
      if (dt > 0 && s.trail) this.sparks.spawn(s.m.position, tmpV.set(0, 0.5, 0), s.m.material.color, { life: 0.18, size: 0.12, grav: 0 });
      if (k >= 1) { s.alive = false; s.m.visible = false; const r = s.resolve; s.resolve = null; r(); }
    }

    for (const f of this.flashes) {
      if (f.t >= 1) { f.l.intensity = 0; continue; }
      f.t += realDt / 0.35;
      f.l.intensity = f.peak * Math.pow(Math.max(0, 1 - f.t), 2);
    }

    // Shake: exponential decay, settles in ~380 ms, with a little roll.
    if (this.shake > 0) {
      this.shake *= Math.pow(0.002, realDt);
      if (this.shake < 0.01) this.shake = 0;
      const a = this.shake * this.shakeAmp;
      this.world.position.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.4, (Math.random() - 0.5) * a);
      this.world.rotation.z = this.reduced ? 0 : (Math.random() - 0.5) * a * 0.012;
    } else {
      this.world.position.set(0, 0, 0);
      this.world.rotation.z = 0;
    }
    this.punch *= Math.pow(0.0005, realDt);
    return dt;
  }
}
