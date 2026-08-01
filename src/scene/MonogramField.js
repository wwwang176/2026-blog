import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WireframeGeometry,
} from "three";

import {
  buildMonogramGeometry,
  sampleSurface,
} from "./monogram-geometry.js";

import {
  lineFragment,
  lineVertex,
  meshFragment,
  meshVertex,
  pointFragment,
  pointVertex,
} from "./monogram-shaders.js";

/** Deterministic PRNG so the scene is identical on every load. */
function makeRandom(seed = 20260801) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Normalised, clamped position of `v` inside [a, b]. */
const range = (v, a, b) => Math.min(Math.max((v - a) / (b - a), 0), 1);

/**
 * Cross-fade windows. Each pair overlaps exactly, so one state is arriving at
 * the same rate the previous one leaves and the total never dips.
 *
 *   0 ─── solid ───┐
 *            0.80 ─┴─ 1.30 ─── wireframe ───┐
 *                                    1.80 ──┴── 2.30 ─── particles ──▶ 3
 */
const STAGE = {
  meshOut: [0.8, 1.3],
  lineIn: [0.8, 1.3],
  lineOut: [1.8, 2.3],
  pointIn: [1.8, 2.3],
  morph: [2.35, 3],
};

/**
 * `CW.` in three states — extruded solid, wireframe, particle cloud — driven
 * by one scroll value, exactly like the particle field it is a candidate to
 * replace. Same public surface, so swapping them is a one-line change.
 */
export default class MonogramField {
  constructor(canvas, { quality = "high" } = {}) {
    this.canvas = canvas;
    this.pointer = new Vector2(0, 0);
    this.pointerTarget = new Vector2(0, 0);
    this.time = 0;
    this.spin = 0;
    this.progress = 0;
    this.baseOpacity = 1;
    this.modelScale = 1;
    this.disposed = false;

    this.count = quality === "low" ? 7000 : quality === "medium" ? 14000 : 24000;

    // Where the monogram rests during the hero. Zero it when the monogram is
    // the hero subject rather than a companion to a headline.
    this.heroOffset = new Vector2(1.9, 1.0);

    this._initRenderer();
    this._initScene();
    this._build(quality);
    this.resize();
  }

  _initRenderer() {
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
  }

  _initScene() {
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0, 16);

    this.colorA = new Color("#6f7ae0");
    this.colorB = new Color("#ff6a34");

    // Solid and wireframe share one transform, so they can never drift apart.
    this.solidRoot = new Group();
    // The cloud takes the same rotation and position but never the scale: its
    // start positions are scaled in the shader instead, leaving the lattice it
    // flies out to in plain world units.
    this.cloudRoot = new Group();

    this.scene.add(this.solidRoot, this.cloudRoot);
  }

  _build(quality) {
    const rand = makeRandom();

    // ── Solid ────────────────────────────────────────────
    const geometry = buildMonogramGeometry({ quality });

    this.meshMaterial = new ShaderMaterial({
      vertexShader: meshVertex,
      fragmentShader: meshFragment,
      transparent: true,
      side: DoubleSide,
      uniforms: {
        uOpacity: { value: 1 },
        uColorA: { value: this.colorA },
        uColorB: { value: this.colorB },
      },
    });

    this.mesh = new Mesh(geometry, this.meshMaterial);
    this.mesh.frustumCulled = false;

    // ── Wireframe ────────────────────────────────────────
    const wire = new WireframeGeometry(geometry);

    this.lineMaterial = new ShaderMaterial({
      vertexShader: lineVertex,
      fragmentShader: lineFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uOpacity: { value: 0 },
        uColor: { value: new Color("#cfd2ff") },
      },
    });

    this.lines = new LineSegments(wire, this.lineMaterial);
    this.lines.frustumCulled = false;

    this.solidRoot.add(this.mesh, this.lines);

    // ── Particles ────────────────────────────────────────
    const { count } = this;
    const from = sampleSurface(geometry, count, rand);
    const to = new Float32Array(count * 3);
    const scale = new Float32Array(count);
    const seed = new Float32Array(count);

    // The cloud lands on the same lattice the old field used for its works
    // stage, so whatever follows on the page still reads as a continuation.
    const cols = Math.ceil(Math.sqrt(count));

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const u = (i % cols) / (cols - 1) - 0.5;
      const v = Math.floor(i / cols) / (cols - 1) - 0.5;

      to[i3] = u * 18;
      to[i3 + 1] = -v * 11;
      to[i3 + 2] = (rand() - 0.5) * 1.4;

      scale[i] = 0.35 + Math.pow(rand(), 2) * 0.9;
      seed[i] = rand() * 100;
    }

    const cloud = new BufferGeometry();
    cloud.setAttribute("position", new BufferAttribute(from, 3));
    cloud.setAttribute("aFrom", new BufferAttribute(from, 3));
    cloud.setAttribute("aTo", new BufferAttribute(to, 3));
    cloud.setAttribute("aScale", new BufferAttribute(scale, 1));
    cloud.setAttribute("aSeed", new BufferAttribute(seed, 1));
    cloud.boundingSphere = null;

    this.pointMaterial = new ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: pointFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uMorph: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: 42 },
        uPixelRatio: { value: 1 },
        uModelScale: { value: 1 },
        uOpacity: { value: 0 },
        uColorA: { value: this.colorA },
        uColorB: { value: this.colorB },
      },
    });

    this.points = new Points(cloud, this.pointMaterial);
    this.points.frustumCulled = false;
    this.cloudRoot.add(this.points);

    this.cloudGeometry = cloud;
    this.wireGeometry = wire;
    this.geometry = geometry;
  }

  /** Scroll-driven state, 0 → 3. */
  setProgress(value) {
    this.progress = value;

    const meshFade = 1 - range(value, ...STAGE.meshOut);
    const lineFade = range(value, ...STAGE.lineIn) * (1 - range(value, ...STAGE.lineOut));
    const pointFade = range(value, ...STAGE.pointIn);

    this.meshMaterial.uniforms.uOpacity.value = meshFade * this.baseOpacity;
    this.lineMaterial.uniforms.uOpacity.value = lineFade * this.baseOpacity;
    this.pointMaterial.uniforms.uOpacity.value = pointFade * this.baseOpacity;
    this.pointMaterial.uniforms.uMorph.value = range(value, ...STAGE.morph);

    // Skip the draw call entirely once a state is gone.
    this.mesh.visible = meshFade > 0.001;
    this.lines.visible = lineFade > 0.001;
    this.points.visible = pointFade > 0.001;
  }

  /** Normalised pointer offset, roughly -1 → 1 on each axis. */
  setPointer(x, y) {
    this.pointerTarget.set(x, y);
  }

  /** Multiplier against the scene's resting opacity, not an absolute value. */
  setOpacity(multiplier) {
    this.baseOpacity = multiplier;
    this.setProgress(this.progress);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;

    this.camera.aspect = aspect;
    this.camera.position.z = aspect < 1 ? 16 + (1 - aspect) * 10 : 16;
    this.camera.updateProjectionMatrix();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.pointMaterial.uniforms.uPixelRatio.value = dpr;

    // Narrow viewports get a smaller monogram so it never crowds the caption.
    this.modelScale = aspect < 1 ? 1.9 : 2.6;
    this.solidRoot.scale.setScalar(this.modelScale);
    this.pointMaterial.uniforms.uModelScale.value = this.modelScale;
  }

  tick(dt) {
    if (this.disposed) return;

    this.time += dt;
    this.pointMaterial.uniforms.uTime.value = this.time;

    this.pointer.lerp(this.pointerTarget, 0.045);

    // The monogram has to stay readable in the hero, so it only rocks with the
    // cursor there. Rotation is earned once it starts breaking up — by then it
    // is a shape, not a word, and turning it costs nothing.
    const freed = range(this.progress, 0.7, 1.6);
    this.spin += dt * 0.18 * freed;

    const rotY = this.spin + this.pointer.x * 0.22;
    const rotX = this.pointer.y * -0.16 + freed * 0.1;

    // In the hero it sits up and to the right, clear of the headline — unless
    // the monogram *is* the hero, in which case the caller zeroes the offset.
    const heroBias = 1 - Math.min(this.progress, 1);
    const px = this.heroOffset.x * heroBias;
    const py = this.heroOffset.y * heroBias;

    this.solidRoot.rotation.set(rotX, rotY, 0);
    this.solidRoot.position.set(px, py, 0);

    // The cloud unwinds back to square as it settles: a lattice held at an
    // angle just reads as a skewed grid.
    const settle = 1 - this.pointMaterial.uniforms.uMorph.value;
    this.cloudRoot.rotation.set(rotX * settle, rotY * settle, 0);
    this.cloudRoot.position.set(px * settle, py * settle, 0);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.geometry.dispose();
    this.wireGeometry.dispose();
    this.cloudGeometry.dispose();
    this.meshMaterial.dispose();
    this.lineMaterial.dispose();
    this.pointMaterial.dispose();
    this.renderer.dispose();
  }
}
