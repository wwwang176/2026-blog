import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";

import { particleFragment, particleVertex } from "./shaders.js";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPHERE_R = 5;

/** Deterministic PRNG so the field looks identical on every load. */
function makeRandom(seed = 20260726) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Full-screen particle field that morphs through four shapes as the page
 * scrolls: sphere → nebula → grid → wave plane.
 */
export default class ParticleField {
  constructor(canvas, { quality = "high" } = {}) {
    this.canvas = canvas;
    this.pointer = new Vector2(0, 0);
    this.pointerTarget = new Vector2(0, 0);
    this.time = 0;
    this.spin = 0;
    this.progress = 0;
    this.baseOpacity = 0.62;
    this.disposed = false;

    // A perfect square keeps the grid stage tidy.
    const cols = quality === "low" ? 72 : quality === "medium" ? 108 : 156;
    this.cols = cols;
    this.count = cols * cols;

    this._initRenderer();
    this._initScene();
    this._buildGeometry();
    this.resize();
  }

  _initRenderer() {
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
  }

  _initScene() {
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0, 13);

    this.material = new ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: 58 },
        uPixelRatio: { value: 1 },
        uPointer: { value: new Vector2(0, 0) },
        uColorA: { value: new Color("#6f7ae0") },
        uColorB: { value: new Color("#ff6a34") },
        uOpacity: { value: 0.62 },
      },
    });
  }

  _buildGeometry() {
    const { count, cols } = this;
    const rand = makeRandom();

    const pos0 = new Float32Array(count * 3); // sphere      — hero
    const pos1 = new Float32Array(count * 3); // nebula      — brief
    const pos2 = new Float32Array(count * 3); // grid        — works
    const pos3 = new Float32Array(count * 3); // wave plane  — contact
    const scale = new Float32Array(count);
    const seed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // ── Fibonacci sphere ──────────────────────────────
      const y = 1 - (i / (count - 1)) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN_ANGLE * i;
      const dx = Math.cos(theta) * ring;
      const dy = y;
      const dz = Math.sin(theta) * ring;

      const shell = SPHERE_R * (0.94 + rand() * 0.08);
      pos0[i3] = dx * shell;
      pos0[i3 + 1] = dy * shell;
      pos0[i3 + 2] = dz * shell;

      // ── Nebula: same directions, wildly varied radius ──
      const cloud = SPHERE_R * (0.35 + Math.pow(rand(), 0.6) * 1.7);
      pos1[i3] = dx * cloud + (rand() - 0.5) * 1.6;
      pos1[i3 + 1] = dy * cloud * 0.8 + (rand() - 0.5) * 1.6;
      pos1[i3 + 2] = dz * cloud + (rand() - 0.5) * 1.6;

      // ── Grid: even lattice, slight depth jitter ────────
      const col = i % cols;
      const row = Math.floor(i / cols);
      const u = col / (cols - 1) - 0.5;
      const v = row / (cols - 1) - 0.5;

      pos2[i3] = u * 15;
      pos2[i3 + 1] = -v * 9;
      pos2[i3 + 2] = (rand() - 0.5) * 1.2;

      // ── Wave plane: wide, receding, tilted toward camera ─
      pos3[i3] = u * 20;
      pos3[i3 + 1] = -v * 7 - 1.2;
      pos3[i3 + 2] = v * 13;

      scale[i] = 0.35 + Math.pow(rand(), 2) * 0.9;
      seed[i] = rand() * 100;
    }

    const geometry = new BufferGeometry();
    // `position` is unused by the shader but three needs it for bounds.
    geometry.setAttribute("position", new BufferAttribute(pos0, 3));
    geometry.setAttribute("aPos0", new BufferAttribute(pos0, 3));
    geometry.setAttribute("aPos1", new BufferAttribute(pos1, 3));
    geometry.setAttribute("aPos2", new BufferAttribute(pos2, 3));
    geometry.setAttribute("aPos3", new BufferAttribute(pos3, 3));
    geometry.setAttribute("aScale", new BufferAttribute(scale, 1));
    geometry.setAttribute("aSeed", new BufferAttribute(seed, 1));
    // Points never leave view; skip per-frame frustum math.
    geometry.boundingSphere = null;

    this.geometry = geometry;
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  /** Scroll-driven morph position, 0 → 3. */
  setProgress(value) {
    this.progress = value;
    this.material.uniforms.uProgress.value = value;
  }

  /**
   * Normalised pointer offset, roughly -1 → 1 on each axis.
   *
   * `immediate` snaps the eased value to it as well, which is what a scene
   * arriving at a crossing needs. Only the visible scene is ticked, so an
   * incoming one has not eased since the pointer last moved and would come in
   * from wherever it was left — the mark swinging into place over the second
   * after the fade rather than being handed over already facing the right way.
   */
  setPointer(x, y, immediate = false) {
    this.pointerTarget.set(x, y);
    if (immediate) this.pointer.copy(this.pointerTarget);
  }

  /** Multiplier against the field's resting opacity, not an absolute value. */
  setOpacity(multiplier) {
    this.material.uniforms.uOpacity.value = this.baseOpacity * multiplier;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;

    this.camera.aspect = aspect;
    // Pull back on narrow viewports so the whole field stays framed.
    this.camera.position.z = aspect < 1 ? 16 + (1 - aspect) * 10 : 16;
    this.camera.updateProjectionMatrix();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.material.uniforms.uPixelRatio.value = dpr;
  }

  tick(dt) {
    if (this.disposed) return;

    this.time += dt;
    this.material.uniforms.uTime.value = this.time;

    // Ease the pointer so parallax never snaps.
    this.pointer.lerp(this.pointerTarget, 0.045);
    this.material.uniforms.uPointer.value.copy(this.pointer);

    // Slow drift keeps the field alive while the page is still, but it eases
    // to a stop by the grid stage — a spinning lattice just reads as skewed.
    // Accumulating the angle (rather than deriving it from time) means the
    // damping slows the rotation instead of snapping it back.
    const spinDamp = 1 - Math.min(Math.max(this.progress - 1, 0), 1);
    this.spin += dt * 0.035 * spinDamp;

    this.points.rotation.y = this.spin + this.pointer.x * 0.12;
    this.points.rotation.x = this.pointer.y * -0.1;

    // In the hero the sphere sits up and to the right, clear of the headline;
    // it recentres as soon as the page starts scrolling.
    const heroBias = 1 - Math.min(this.progress, 1);
    this.points.position.x = 2.4 * heroBias;
    this.points.position.y = 1.1 * heroBias;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
