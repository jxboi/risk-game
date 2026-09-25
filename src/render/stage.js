// Renderer, camera, lights, post-processing and the frame loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Last pass: a lens vignette that tightens on big moments, plus fine film
// grain so flat colours feel photographed rather than drawn.
const LensShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uGrain: { value: 0.035 }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain; uniform float uAspect;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.35, 1.05, length(d) * 1.25);
      c.rgb *= 1.0 - v * uVignette;
      c.rgb += (h(vUv * 911.0 + fract(uTime) * 37.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};

export class Stage {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030a16);
    scene.fog = new THREE.Fog(0x030a16, 90, 190);
    this.scene = scene;
    this.world = new THREE.Group(); // everything that shakes
    scene.add(this.world);

    this.camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.5, 500);
    this.baseFov = 38;
    this.camera.position.set(0, 72, 52);

    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.target.set(0, 0, 1);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.minDistance = 22;
    controls.maxDistance = 190;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.1;
    controls.minAzimuthAngle = -0.7;
    controls.maxAzimuthAngle = 0.7;
    controls.screenSpacePanning = false;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 1.1;
    // Left drag pans (the map is a table), right drag orbits.
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls = controls;
    this.fitView();

    // Lighting: cool sky, warm key light with soft shadows.
    scene.add(new THREE.HemisphereLight(0x9cc7ff, 0x1a1208, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(-30, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 40; sc.bottom = -40; sc.near = 10; sc.far = 150;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x4f8cff, 0.7);
    rim.position.set(40, 20, -40);
    scene.add(rim);

    // Post: bloom only catches the brightest things (sparks, glows).
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.55, 0.5, 0.82);
    this.baseBloom = 0.55;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.lens = new ShaderPass(LensShader);
    this.lens.uniforms.uAspect.value = container.clientWidth / container.clientHeight;
    this.composer.addPass(this.lens);
    this.time = 0;

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.focus = null;

    window.addEventListener('resize', () => this.resize());
  }

  // Frame the whole map for the current aspect ratio.
  fitView() {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    // Fit the 100 x 60 map (plus a margin for the HUD) in both directions.
    const vHalf = THREE.MathUtils.degToRad(this.baseFov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    // Portrait screens show ~2/3 of the width; the player pans for the rest.
    const halfW = aspect < 1 ? 36 : 56;
    const dist = Math.min(this.controls.maxDistance, Math.max(halfW / Math.tan(hHalf), 40 / Math.tan(vHalf)));
    // Keep fog behind the board at any framing distance.
    this.scene.fog.near = dist + 25;
    this.scene.fog.far = dist + 140;
    const dir = new THREE.Vector3(0, 0.82, 0.57).normalize();
    this.controls.target.set(0, 0, 2);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.update();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.lens.uniforms.uAspect.value = w / h;
  }

  rayFromClient(x, y) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster;
  }

  // World position -> CSS pixels (for DOM labels).
  project(v, out) {
    const p = v.clone().project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * this.container.clientWidth;
    out.y = (-p.y * 0.5 + 0.5) * this.container.clientHeight;
    out.visible = p.z < 1;
    return out;
  }

  // Glide the camera target toward a point (AI turns), without changing
  // zoom or angle. Only when it's meaningfully off-centre.
  glideTo(point, minDist = 14) {
    const t = this.controls.target;
    const d = Math.hypot(point.x - t.x, point.z - t.z);
    if (d < minDist) return;
    this.focus = { from: t.clone(), to: new THREE.Vector3(point.x * 0.7, 0, point.z * 0.7 + 1), t: 0 };
  }

  // Opening shot: sweep down from high orbit onto the board. Any touch or
  // drag hands the camera straight back to the player.
  intro(reduced = false) {
    this.fitView();
    if (reduced) return;
    const endPos = this.camera.position.clone(), endTarget = this.controls.target.clone();
    const off = endPos.clone().sub(endTarget);
    const startPos = endTarget.clone().add(off.clone().multiplyScalar(1.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.55));
    startPos.y += 30;
    this.fly = { t: 0, dur: 2.6, startPos, endPos, target: endTarget };
    this.camera.position.copy(startPos);
    const stop = () => { this.fly = null; this.controls.removeEventListener('start', stop); };
    this.controls.addEventListener('start', stop);
  }

  // Ease back to the framing the player left (used when their turn starts).
  glideHome() {
    const home = new THREE.Vector3(0, 0, 2);
    if (this.controls.target.distanceTo(home) < 1) return;
    this.focus = { from: this.controls.target.clone(), to: home, t: 0 };
  }

  update(dt, fx) {
    this.time += dt;
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = 1 - Math.pow(1 - f.t, 3);
      // Curve in: height settles faster than the swing, like a crane shot.
      this.camera.position.lerpVectors(f.startPos, f.endPos, e);
      this.camera.position.y = THREE.MathUtils.lerp(f.startPos.y, f.endPos.y, 1 - Math.pow(1 - f.t, 4));
      this.controls.target.copy(f.target);
      if (f.t >= 1) this.fly = null;
    }
    if (this.focus) {
      const f = this.focus;
      f.t = Math.min(1, f.t + dt / 0.5);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
      const next = f.from.clone().lerp(f.to, e);
      const delta = next.clone().sub(this.controls.target);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      if (f.t >= 1) this.focus = null;
    }
    this.controls.update();
    // Camera punch = brief FOV squeeze; bloom pulses with it.
    const fov = this.baseFov * (1 - fx.punch);
    if (Math.abs(this.camera.fov - fov) > 0.001) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.bloom.strength = this.baseBloom + fx.punch * 18;
    this.lens.uniforms.uTime.value = this.time;
    this.lens.uniforms.uVignette.value = 0.32 + fx.punch * 6;
    this.composer.render();
  }
}
