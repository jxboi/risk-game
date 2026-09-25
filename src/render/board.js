// The 3D world: ocean, hex-tile territories, sea lanes and army tokens.
// The board draws a *view* of the game (displayed owners and armies) that
// the controller advances as animations play, so the numbers never jump
// ahead of the action.

import * as THREE from 'three';
import { buildHexMap, HEX } from './hexmap.js';
import { TERRITORIES, CONTINENTS, T_CONTINENT } from '../data/map.js';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

export const toWorld = (x, y) => new THREE.Vector3(x - 50, 0, y - 30);

const ASH = new THREE.Color(0x1a1512);

// Drifting cloud shadows, shared by the land and the sea so they agree.
// The wind blows toward +x, the same way battlefield smoke leans.
const CLOUD_GLSL = `
  float cloudH(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 17853.3); }
  float cloudN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(cloudH(i), cloudH(i+vec2(1,0)), f.x), mix(cloudH(i+vec2(0,1)), cloudH(i+vec2(1,1)), f.x), f.y); }
  float cloudShade(vec2 xz, float t){
    vec2 p = xz * 0.022 + vec2(t * 0.008, t * 0.003);
    float c = cloudN(p) * 0.7 + cloudN(p * 2.3 + 7.1) * 0.24 + cloudN(p * 5.1 - 3.3) * 0.06;
    return 1.0 - smoothstep(0.5, 0.8, c) * 0.36;
  }`;

export class Board {
  constructor(scene, playerColors) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.map = buildHexMap();
    this.playerColors = playerColors.map((c) => new THREE.Color(c));
    this.neutral = new THREE.Color(0x6b7280);
    this.time = 0;
    this.contColors = CONTINENTS.map((c) => new THREE.Color(c.tint));
    this.clouds = { value: 0 }; // shared time uniform for cloud shadows

    // Per-territory animated view state.
    this.tv = TERRITORIES.map((_, ti) => ({
      owner: -1,
      armies: 0,
      lift: 0, liftTarget: 0,
      glow: 0, glowTarget: 0,
      glowColor: new THREE.Color(1, 1, 1),
      dim: 0, dimTarget: 0,
      pulse: 0, // 0 none, 1 source, 2 target
      flip: null, // conquest ripple {t, dur, from: Color, origin: Vector3}
      bump: 0, // quick vertical kick on hits
      tintK: 0, tintTarget: 0, tintColor: new THREE.Color(), // threat overlay
      scorch: 0, // battle damage: darkens the ground, fades over ~40 s
    }));

    this.buildOcean();
    this.buildShelf();
    this.buildTiles();
    this.buildSeaLanes();
    this.buildTokens();
  }

  // ---- construction ----------------------------------------------------
  buildOcean() {
    const geo = new THREE.PlaneGeometry(420, 320, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.oceanMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x06162b) },
        uShallow: { value: new THREE.Color(0x0f3d63) },
        uGlint: { value: new THREE.Color(0x5fb6ff) },
        uLand: { value: this.buildLandMask() },
        uClouds: this.clouds,
        fogColor: { value: new THREE.Color() }, fogNear: { value: 0 }, fogFar: { value: 0 },
      },
      vertexShader: `
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uGlint;
        uniform sampler2D uLand; uniform float uClouds;
        varying vec3 vW;
        ${CLOUD_GLSL}
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec2 p = vW.xz * 0.12;
          float w = n(p + uTime*0.05) * 0.6 + n(p*2.3 - uTime*0.07) * 0.4;
          float c = smoothstep(0.62, 0.9, n(p*3.1 + vec2(uTime*0.09, -uTime*0.06)) * w * 1.6);
          float r = length(vW.xz * vec2(0.012, 0.018));
          vec3 col = mix(uShallow, uDeep, clamp(r, 0.0, 1.0));
          col = mix(col, uDeep*0.8, w*0.35);
          col += uGlint * c * 0.12;
          // subtle lat/long grid for a war-room feel
          vec2 g = abs(fract(vW.xz / 10.0) - 0.5);
          float grid = smoothstep(0.485, 0.5, max(g.x, g.y));
          col += vec3(0.25,0.55,0.9) * grid * 0.05 * (1.0 - clamp(r,0.0,1.0));
          // Surf: bands of foam roll in toward every coast.
          vec2 luv = vec2((vW.x + 50.0) / 100.0, (vW.z + 30.0) / 60.0);
          // Off the map there is no land; don't let the edge texels smear outward.
          float inside = step(0.0, luv.x) * step(luv.x, 1.0) * step(0.0, luv.y) * step(luv.y, 1.0);
          float m = texture2D(uLand, luv).r * inside;
          float near = smoothstep(0.03, 0.3, m) * (1.0 - smoothstep(0.42, 0.5, m));
          float bands = smoothstep(0.7, 1.0, sin(m * 30.0 - uTime * 1.1 + n(p * 4.0) * 3.0));
          col += vec3(0.6, 0.8, 1.0) * near * bands * 0.07;
          col *= mix(1.0, cloudShade(vW.xz, uClouds), 0.6);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const ocean = new THREE.Mesh(geo, this.oceanMat);
    ocean.receiveShadow = false;
    this.root.add(ocean);
  }

  // Blurred land/sea mask of the board (2 px per map unit). The ocean uses it
  // to find its coasts.
  buildLandMask() {
    const S = 2, W = 100 * S, H = 60 * S;
    let a = new Float32Array(W * H);
    for (const c of this.map.land) {
      const cx = c.x * S, cy = c.y * S, r = HEX * S * 1.05;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (x >= 0 && y >= 0 && x < W && y < H && Math.hypot(x - cx, y - cy) <= r) a[y * W + x] = 1;
        }
      }
    }
    // Three box-blur passes each way approximate a soft gaussian falloff.
    const R = 3;
    for (let pass = 0; pass < 3; pass++) {
      for (const horiz of [true, false]) {
        const b = new Float32Array(W * H);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            let sum = 0, n = 0;
            for (let k = -R; k <= R; k++) {
              const xx = horiz ? x + k : x, yy = horiz ? y : y + k;
              if (xx >= 0 && yy >= 0 && xx < W && yy < H) { sum += a[yy * W + xx]; n++; }
            }
            b[y * W + x] = sum / n;
          }
        }
        a = b;
      }
    }
    const data = new Uint8Array(W * H);
    for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.min(1, a[i]) * 255);
    const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  // A pale underwater shelf around every coast.
  buildShelf() {
    const land = this.map.land;
    const geo = new THREE.CylinderGeometry(HEX * 1.9, HEX * 1.9, 0.05, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x2a7fb0, transparent: true, opacity: 0.16, depthWrite: false });
    const coast = land.filter((c) => c.coast);
    const mesh = new THREE.InstancedMesh(geo, mat, coast.length);
    coast.forEach((c, i) => {
      const p = toWorld(c.x, c.y);
      tmpM.makeTranslation(p.x, 0.02, p.z);
      mesh.setMatrixAt(i, tmpM);
    });
    this.root.add(mesh);
  }

  buildTiles() {
    const land = this.map.land;
    const geo = new THREE.CylinderGeometry(HEX, HEX, 1, 6, 1);
    geo.translate(0, 0.5, 0);
    // Vertex shading: bright tops, darker sides fading toward the base.
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const top = nor.getY(i) > 0.5;
      const v = top ? 1 : 0.3 + pos.getY(i) * 0.4;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.08 });
    // Cloud shadows dim the sunlight only; sky light still fills them.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uClouds = this.clouds;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCloud;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 cloudW = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cloudW = instanceMatrix * cloudW;
          #endif
          vCloud = (modelMatrix * cloudW).xz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vCloud;\nuniform float uClouds;\n${CLOUD_GLSL}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          float cs = cloudShade(vCloud, uClouds);
          reflectedLight.directDiffuse *= cs;
          reflectedLight.directSpecular *= cs;`);
    };
    this.tiles = new THREE.InstancedMesh(geo, mat, land.length);
    this.tiles.castShadow = true;
    this.tiles.receiveShadow = true;
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cellT = new Int16Array(land.length);
    this.cellBase = land.map((c, i) => {
      this.cellT[i] = c.t;
      const p = toWorld(c.x, c.y);
      // Per-tile colour variation, mixed with a little continent tint.
      const jitter = 0.86 + ((c.c * 73 + c.r * 151) % 29) / 29 * 0.22;
      return { cell: c, pos: p, h: c.h, scaleXZ: c.edge ? 0.9 : 0.975, jitter };
    });
    this.byTerritory = TERRITORIES.map(() => []);
    this.cellBase.forEach((b, i) => this.byTerritory[b.cell.t].push(i));
    for (let i = 0; i < land.length; i++) this.writeCell(i, 0, WHITE);
    this.root.add(this.tiles);
  }

  buildSeaLanes() {
    this.laneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){ float d = step(0.5, fract(vUv.x * 14.0 - uTime * 0.6));
          float fade = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
          gl_FragColor = vec4(vec3(0.75,0.88,1.0), d * 0.55 * fade); }`,
    });
    const terr = this.map.territories;
    const top = (ti) => terr[ti].anchor.h + 0.2;
    for (const [a, b] of this.map.seaLanes) {
      const pa = toWorld(terr[a].anchor.x, terr[a].anchor.y);
      const pb = toWorld(terr[b].anchor.x, terr[b].anchor.y);
      pa.y = top(a); pb.y = top(b);
      // Alaska <-> Kamchatka wraps around the edge of the world.
      if (Math.abs(pa.x - pb.x) > 60) {
        const [w, e] = pa.x < pb.x ? [pa, pb] : [pb, pa];
        this.addLane(w, new THREE.Vector3(-58, 0.3, w.z - 1));
        this.addLane(e, new THREE.Vector3(58, 0.3, e.z - 1));
      } else {
        this.addLane(pa, pb);
      }
    }
  }

  addLane(a, b) {
    const mid = a.clone().lerp(b, 0.5);
    mid.y += Math.min(4, a.distanceTo(b) * 0.25);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const geo = new THREE.TubeGeometry(curve, 32, 0.07, 5, false);
    this.root.add(new THREE.Mesh(geo, this.laneMat));
  }

  buildTokens() {
    this.tokens = [];
    const baseGeo = new THREE.CylinderGeometry(0.95, 1.1, 0.35, 24);
    baseGeo.translate(0, 0.175, 0);
    const discGeo = new THREE.CylinderGeometry(0.72, 0.72, 0.16, 20);
    const ringGeo = new THREE.TorusGeometry(1.35, 0.07, 8, 40);
    ringGeo.rotateX(Math.PI / 2);
    const terr = this.map.territories;
    for (let ti = 0; ti < TERRITORIES.length; ti++) {
      const a = terr[ti].anchor;
      const g = new THREE.Group();
      const p = toWorld(a.x, a.y);
      g.position.set(p.x, a.h, p.z);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.3, emissive: 0x000000 });
      const base = new THREE.Mesh(baseGeo, mat);
      base.castShadow = true;
      g.add(base);
      const stack = new THREE.Group();
      g.add(stack);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.08;
      g.add(ring);
      this.root.add(g);
      this.tokens.push({ group: g, base, mat, stack, ring, ringMat, discGeo, discs: 0, scale: 1, punch: 0, baseY: a.h });
    }
  }

  // ---- view state --------------------------------------------------------
  colorOf(owner) { return owner < 0 ? this.neutral : this.playerColors[owner]; }

  setTerritory(ti, owner, armies) {
    const v = this.tv[ti];
    const ownerChanged = v.owner !== owner;
    v.owner = owner; v.armies = armies;
    const tok = this.tokens[ti];
    if (ownerChanged) tok.mat.color.copy(this.colorOf(owner));
    // Stack of discs: grows logarithmically so big armies read as big.
    const want = Math.min(8, Math.max(0, Math.round(Math.log2(Math.max(1, armies)) * 1.6)));
    if (want !== tok.discs) {
      while (tok.stack.children.length < want) {
        const m = new THREE.Mesh(tok.discGeo, tok.mat);
        m.castShadow = true;
        tok.stack.add(m);
      }
      while (tok.stack.children.length > want) tok.stack.remove(tok.stack.children[tok.stack.children.length - 1]);
      tok.stack.children.forEach((m, i) => { m.position.y = 0.43 + i * 0.19; m.scale.setScalar(1 - i * 0.035); });
      tok.discs = want;
    }
  }

  // Conquest: tiles flip to the new colour in a ripple from `origin`.
  flip(ti, fromOwner, origin, dur = 0.55) {
    this.tv[ti].flip = { t: 0, dur, from: this.colorOf(fromOwner).clone(), origin };
  }

  tokenTop(ti) {
    const tok = this.tokens[ti];
    return tok.group.position.clone().add(new THREE.Vector3(0, 0.55 + tok.discs * 0.19, 0));
  }
  tokenPos(ti) { return this.tokens[ti].group.getWorldPosition(new THREE.Vector3()); }

  punchToken(ti, amount = 0.35) { this.tokens[ti].punch = Math.max(this.tokens[ti].punch, amount); }
  bumpTerritory(ti, amount = 0.35) { this.tv[ti].bump = Math.max(this.tv[ti].bump, amount); }
  // Battle damage: the ground chars, then recovers over the next ~40 s.
  scorch(ti, amount = 0.3) { this.tv[ti].scorch = Math.min(1, this.tv[ti].scorch + amount); }

  // Highlight modes are set by the controller each time the selection changes.
  clearHighlights() {
    for (const v of this.tv) { v.glowTarget = 0; v.dimTarget = 0; v.pulse = 0; v.liftTarget = 0; }
  }
  highlight(ti, { glow = 0, color, dim = 0, lift = 0, pulse = 0 } = {}) {
    const v = this.tv[ti];
    v.glowTarget = glow; v.dimTarget = dim; v.liftTarget = lift; v.pulse = pulse;
    if (color !== undefined) v.glowColor.set(color);
  }
  // Overlay tint; fades in and out rather than snapping.
  setTint(ti, color, strength = 0.55) {
    const v = this.tv[ti];
    if (color == null) { v.tintTarget = 0; return; }
    v.tintColor.set(color);
    v.tintTarget = strength;
  }

  // ---- per-frame -----------------------------------------------------------
  writeCell(i, yOff, color) {
    const b = this.cellBase[i];
    tmpP.set(b.pos.x, yOff, b.pos.z);
    tmpS.set(b.scaleXZ, b.h, b.scaleXZ);
    tmpM.compose(tmpP, tmpQ.identity(), tmpS);
    this.tiles.setMatrixAt(i, tmpM);
    this.tiles.setColorAt(i, color);
  }

  update(dt) {
    this.time += dt;
    this.oceanMat.uniforms.uTime.value = this.time;
    this.laneMat.uniforms.uTime.value = this.time;
    this.clouds.value = this.time;
    const k = 1 - Math.pow(0.0001, dt); // fast approach
    const pulseWave = 0.5 + 0.5 * Math.sin(this.time * 6);

    for (let ti = 0; ti < this.tv.length; ti++) {
      const v = this.tv[ti];
      v.lift += (v.liftTarget - v.lift) * k;
      v.glow += (v.glowTarget - v.glow) * k;
      v.dim += (v.dimTarget - v.dim) * k;
      v.tintK += (v.tintTarget - v.tintK) * k;
      v.bump *= Math.pow(0.0005, dt);
      if (v.scorch > 0) v.scorch = Math.max(0, v.scorch - dt / 40);
      const tok = this.tokens[ti];

      const base = this.colorOf(v.owner);
      const cont = this.contColors[T_CONTINENT[ti]];
      const pulse = v.pulse ? (v.pulse === 1 ? 0.35 + pulseWave * 0.25 : 0.15 + pulseWave * 0.35) : 0;
      const glow = Math.min(1, v.glow + pulse * v.glow);
      const flip = v.flip;
      if (flip) { flip.t += dt; if (flip.t >= flip.dur + 0.35) v.flip = null; }

      for (const i of this.byTerritory[ti]) {
        const b = this.cellBase[i];
        let y = (v.lift + v.bump) * (0.55 + 0.45 * Math.sin(b.pos.x * 1.3 + b.pos.z)); // slight unevenness
        tmpC.copy(base);
        if (flip) {
          // Each tile flips when the wave (from the attacker's side) reaches it.
          const d = b.pos.distanceTo(flip.origin);
          const delay = Math.min(0.35, d * 0.045);
          const lt = (flip.t - delay) / flip.dur;
          if (lt < 0.5) tmpC.copy(flip.from);
          if (lt > 0 && lt < 1) y += Math.sin(lt * Math.PI) * 0.9;
        }
        tmpC.lerp(cont, 0.12).multiplyScalar(b.jitter);
        // Char unevenly, so it reads as burnt ground, not a colour change.
        if (v.scorch > 0.002) tmpC.lerp(ASH, v.scorch * (0.12 + 0.2 * b.jitter * Math.abs(Math.sin(b.pos.x * 2.1 + b.pos.z * 1.7))));
        if (v.tintK > 0.002) tmpC.lerp(v.tintColor, v.tintK);
        if (glow > 0.001) tmpC.lerp(v.glowColor, glow * 0.45).multiplyScalar(1 + glow * 0.5);
        if (v.dim > 0.001) tmpC.multiplyScalar(1 - v.dim * 0.55);
        this.writeCell(i, y, tmpC);
      }

      // Token follows lift, springs back from punches.
      tok.punch *= Math.pow(0.002, dt);
      const s = 1 + tok.punch * Math.sin(this.time * 40) * 0.5 + tok.punch * 0.4;
      tok.group.scale.setScalar(s);
      tok.group.position.y = tok.baseY + v.lift + v.bump * 0.8;
      tok.ringMat.opacity = v.pulse ? 0.35 + pulseWave * 0.5 : v.glow * 0.4;
      tok.ringMat.color.copy(v.glowColor);
      tok.ring.scale.setScalar(v.pulse === 2 ? 0.9 + pulseWave * 0.2 : 1);
      tok.mat.emissive.copy(this.colorOf(v.owner)).multiplyScalar(0.15 + glow * 0.5);
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    this.tiles.instanceColor.needsUpdate = true;
  }

  // Raycast helper: territory index under a ray, or -1.
  pick(raycaster) {
    const hits = raycaster.intersectObjects([this.tiles, ...this.tokens.map((t) => t.group)], true);
    for (const h of hits) {
      if (h.object === this.tiles) return this.cellT[h.instanceId];
      const ti = this.tokens.findIndex((t) => t.group === h.object.parent || t.group === h.object.parent?.parent);
      if (ti >= 0) return ti;
    }
    return -1;
  }
}
