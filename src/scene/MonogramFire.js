import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";

import {
  buildMonogramGeometry,
  computeSmoothNormals,
  sampleSurface,
} from "./monogram-geometry.js";

import {
  coreFragment,
  coreVertex,
  shellFragment,
  shellVertex,
  sparkFragment,
  sparkVertex,
} from "./fire-shaders.js";

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
 * One substance, three states — not three unrelated things cross-faded.
 *
 *   0 ─ ember ─┬─ 1.65 ignition ─┬─ 2.6 burnt through ──▶ 3 sparks
 *              │                  │
 *              └ flame shell ─────┘
 */
const STAGE = {
  heat: [0.85, 1.65],
  shellIn: [1.0, 1.6],
  shellOut: [2.15, 2.75],
  burn: [1.75, 2.6],
  sparkIn: [1.7, 2.1],
  rise: [1.9, 3],
};

/** Past this the burn contour has consumed every fragment. */
const BURN_MAX = 1.35;

export default class MonogramFire {
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

    this.count = quality === "low" ? 8000 : quality === "medium" ? 16000 : 28000;
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

    // Fire is written in values well above 1 — the burn lip alone peaks at
    // 2.6. Without tone mapping every hot region clips to flat white and the
    // whole effect turns to paper. This is the single setting that separates
    // "emissive shader" from "something that looks lit".
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
  }

  _initScene() {
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(32, 1, 0.1, 120);
    this.camera.position.set(0, 0, 23);

    this.solidRoot = new Group();
    this.cloudRoot = new Group();
    this.scene.add(this.solidRoot, this.cloudRoot);
  }

  _build(quality) {
    const rand = makeRandom();
    const geometry = buildMonogramGeometry({ quality });
    geometry.setAttribute(
      "aSmooth",
      new BufferAttribute(computeSmoothNormals(geometry), 3)
    );

    // ── Charred letterform ───────────────────────────────
    this.coreMaterial = new ShaderMaterial({
      vertexShader: coreVertex,
      fragmentShader: coreFragment,
      transparent: true,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uHeat: { value: 0 },
        uBurn: { value: 0 },
        uOpacity: { value: 1 },
      },
    });

    this.core = new Mesh(geometry, this.coreMaterial);
    this.core.frustumCulled = false;

    // ── Flame rising off it ──────────────────────────────
    this.shellMaterial = new ShaderMaterial({
      vertexShader: shellVertex,
      fragmentShader: shellFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uFlame: { value: 0 },
        uBurn: { value: 0 },
        uOpacity: { value: 0 },
      },
    });

    this.shell = new Mesh(geometry, this.shellMaterial);
    this.shell.frustumCulled = false;

    this.solidRoot.add(this.core, this.shell);

    // ── Sparks ───────────────────────────────────────────
    const { count } = this;
    const from = sampleSurface(geometry, count, rand);
    const scale = new Float32Array(count);
    const seed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      scale[i] = 0.3 + Math.pow(rand(), 2) * 1.1;
      seed[i] = rand() * 1000;
    }

    const cloud = new BufferGeometry();
    cloud.setAttribute("position", new BufferAttribute(from, 3));
    cloud.setAttribute("aFrom", new BufferAttribute(from, 3));
    cloud.setAttribute("aScale", new BufferAttribute(scale, 1));
    cloud.setAttribute("aSeed", new BufferAttribute(seed, 1));
    cloud.boundingSphere = null;

    this.sparkMaterial = new ShaderMaterial({
      vertexShader: sparkVertex,
      fragmentShader: sparkFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uRise: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: 44 },
        uPixelRatio: { value: 1 },
        uModelScale: { value: 1 },
        uOpacity: { value: 0 },
      },
    });

    this.sparks = new Points(cloud, this.sparkMaterial);
    this.sparks.frustumCulled = false;
    this.cloudRoot.add(this.sparks);

    this.cloudGeometry = cloud;
    this.geometry = geometry;
  }

  /** Scroll-driven state, 0 → 3. */
  setProgress(value) {
    this.progress = value;

    // A trace of heat from the start, so the cold state still has veins in it.
    const heat = 0.06 + range(value, ...STAGE.heat) * 0.94;
    const burn = range(value, ...STAGE.burn) * BURN_MAX;
    const flame = range(value, ...STAGE.shellIn) * (1 - range(value, ...STAGE.shellOut));
    const sparkFade = range(value, ...STAGE.sparkIn);

    this.coreMaterial.uniforms.uHeat.value = heat;
    this.coreMaterial.uniforms.uBurn.value = burn;
    this.coreMaterial.uniforms.uOpacity.value = this.baseOpacity;

    this.shellMaterial.uniforms.uFlame.value = flame;
    this.shellMaterial.uniforms.uBurn.value = burn;
    this.shellMaterial.uniforms.uOpacity.value = flame * this.baseOpacity;

    this.sparkMaterial.uniforms.uRise.value = range(value, ...STAGE.rise);
    this.sparkMaterial.uniforms.uOpacity.value = sparkFade * this.baseOpacity;

    this.core.visible = burn < BURN_MAX;
    this.shell.visible = flame > 0.001;
    this.sparks.visible = sparkFade > 0.001;
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
    this.camera.position.z = aspect < 1 ? 23 + (1 - aspect) * 14 : 23;
    this.camera.updateProjectionMatrix();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.sparkMaterial.uniforms.uPixelRatio.value = dpr;

    this.modelScale = aspect < 1 ? 1.9 : 2.6;
    this.solidRoot.scale.setScalar(this.modelScale);
    this.sparkMaterial.uniforms.uModelScale.value = this.modelScale;
  }

  tick(dt) {
    if (this.disposed) return;

    this.time += dt;
    this.coreMaterial.uniforms.uTime.value = this.time;
    this.shellMaterial.uniforms.uTime.value = this.time;
    this.sparkMaterial.uniforms.uTime.value = this.time;

    this.pointer.lerp(this.pointerTarget, 0.045);

    // Barely turns while it is still a word. Once it is burning it can move.
    const freed = range(this.progress, 0.9, 1.9);
    this.spin += dt * 0.12 * freed;

    const rotY = this.spin + this.pointer.x * 0.2;
    const rotX = this.pointer.y * -0.14;

    const heroBias = 1 - Math.min(this.progress, 1);
    const px = this.heroOffset.x * heroBias;
    const py = this.heroOffset.y * heroBias;

    this.solidRoot.rotation.set(rotX, rotY, 0);
    this.solidRoot.position.set(px, py, 0);

    // The plume keeps the letterform's orientation — sparks leave the surface
    // they were sampled from, so they must not be transformed differently.
    this.cloudRoot.rotation.set(rotX, rotY, 0);
    this.cloudRoot.position.set(px, py, 0);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.geometry.dispose();
    this.cloudGeometry.dispose();
    this.coreMaterial.dispose();
    this.shellMaterial.dispose();
    this.sparkMaterial.dispose();
    this.renderer.dispose();
  }
}
