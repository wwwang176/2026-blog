import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
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
  computeCentroids,
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
 * Scroll windows. Each state hands over before the next is fully present, so
 * there is always an overlap and never a cut.
 *
 *   0 ──── solid ────┐
 *              0.75 ─┴─ opening ──┐
 *                          0.80 ──┴── wireframe ──┐
 *                                          1.75 ──┴── particles ──▶ 3
 */
const STAGE = {
  shrink: [0.75, 1.5],
  meshOut: [0.9, 1.55],
  lineIn: [0.8, 1.5],
  lineOut: [1.7, 2.25],
  pointIn: [1.75, 2.3],
  morph: [2.2, 3],
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
    this.disposed = false;

    this.count = quality === "low" ? 6000 : quality === "medium" ? 12000 : 20000;

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
  }

  _build(quality) {
    const rand = makeRandom();

    // ── Solid ────────────────────────────────────────────
    const geometry = buildMonogramGeometry({ quality });
    geometry.setAttribute("aCentroid", new BufferAttribute(computeCentroids(geometry), 3));

    this.meshMaterial = new ShaderMaterial({
      vertexShader: meshVertex,
      fragmentShader: meshFragment,
      transparent: true,
      // Faces rotate away from the camera as they part, so both sides show.
      side: DoubleSide,
      uniforms: {
        uShrink: { value: 0 },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        uColorA: { value: this.colorA },
        uColorB: { value: this.colorB },
      },
    });

    this.mesh = new Mesh(geometry, this.meshMaterial);
    this.mesh.frustumCulled = false;

    // ── Wireframe ────────────────────────────────────────
    const wire = new WireframeGeometry(geometry);
    const segments = wire.getAttribute("position").count / 2;
    const lineSeed = new Float32Array(segments * 2);

    for (let s = 0; s < segments; s++) {
      // Both ends of a segment share a seed, or it would fade in askew.
      const value = rand();
      lineSeed[s * 2] = value;
      lineSeed[s * 2 + 1] = value;
    }

    wire.setAttribute("aSeed", new BufferAttribute(lineSeed, 1));

    this.lineMaterial = new ShaderMaterial({
      vertexShader: lineVertex,
      fragmentShader: lineFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uReveal: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: new Color("#cfd2ff") },
      },
    });

    this.lines = new LineSegments(wire, this.lineMaterial);
    this.lines.frustumCulled = false;

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

      to[i3] = u * 17;
      to[i3 + 1] = -v * 10;
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
        uSize: { value: 46 },
        uPixelRatio: { value: 1 },
        uOpacity: { value: 0 },
        uPointer: { value: new Vector2(0, 0) },
        uColorA: { value: this.colorA },
        uColorB: { value: this.colorB },
      },
    });

    this.points = new Points(cloud, this.pointMaterial);
    this.points.frustumCulled = false;

    this.cloudGeometry = cloud;
    this.wireGeometry = wire;
    this.geometry = geometry;

    this.group = [this.mesh, this.lines, this.points];
    this.group.forEach((o) => this.scene.add(o));
  }

  /** Scroll-driven state, 0 → 3. */
  setProgress(value) {
    this.progress = value;

    const shrink = range(value, ...STAGE.shrink);
    const meshFade = 1 - range(value, ...STAGE.meshOut);
    const lineFade = range(value, ...STAGE.lineIn) * (1 - range(value, ...STAGE.lineOut));
    const pointFade = range(value, ...STAGE.pointIn);

    this.meshMaterial.uniforms.uShrink.value = shrink;
    this.meshMaterial.uniforms.uOpacity.value = meshFade * this.baseOpacity;

    this.lineMaterial.uniforms.uReveal.value = range(value, ...STAGE.lineIn);
    this.lineMaterial.uniforms.uOpacity.value = lineFade * this.baseOpacity;

    this.pointMaterial.uniforms.uMorph.value = range(value, ...STAGE.morph);
    this.pointMaterial.uniforms.uOpacity.value = pointFade * this.baseOpacity;

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

    // Narrow viewports get a smaller monogram so it never crowds the headline.
    const scale = aspect < 1 ? 1.15 : 1.45;
    this.mesh.scale.setScalar(scale);
    this.lines.scale.setScalar(scale);
  }

  tick(dt) {
    if (this.disposed) return;

    this.time += dt;
    this.meshMaterial.uniforms.uTime.value = this.time;
    this.pointMaterial.uniforms.uTime.value = this.time;

    this.pointer.lerp(this.pointerTarget, 0.045);
    this.pointMaterial.uniforms.uPointer.value.copy(this.pointer);

    // The monogram has to stay readable in the hero, so it only rocks with the
    // cursor there. Rotation is earned once it starts coming apart — by then
    // it is a shape, not a word, and spinning it costs nothing.
    const freed = range(this.progress, 0.7, 1.6);
    this.spin += dt * 0.22 * freed;

    const rotY = this.spin + this.pointer.x * 0.25;
    const rotX = this.pointer.y * -0.18 + freed * 0.12;

    // In the hero it sits up and to the right, clear of the headline — unless
    // the monogram *is* the hero, in which case the caller zeroes the offset.
    const heroBias = 1 - Math.min(this.progress, 1);
    const px = this.heroOffset.x * heroBias;
    const py = this.heroOffset.y * heroBias;

    for (const object of this.group) {
      object.rotation.y = rotY;
      object.rotation.x = rotX;
      object.position.set(px, py, 0);
    }

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
