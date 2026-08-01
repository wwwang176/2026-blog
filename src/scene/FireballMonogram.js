import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";

import { buildMonogramGeometry, sampleSurface } from "./monogram-geometry.js";
import {
  fireballFragment,
  fireballVertex,
  smokeFragment,
  smokeVertex,
} from "./fireball-shaders.js";

/** Deterministic PRNG so the swarm is identical on every load. */
function makeRandom(seed = 20260801) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Normalised, clamped position of `v` inside [a, b]. */
const range = (v, a, b) => Math.min(Math.max((v - a) / (b - a), 0), 1);

const STAGE = {
  /** Burns harder before it lets go. */
  flareUp: [0.6, 1.5],
  /** The only thing that breaks the letterform. */
  disperse: [1.5, 2.9],
  fadeOut: [2.5, 3],
};

/**
 * `CW.` built out of fireballs.
 *
 * The extruded letterform is used once, at construction, purely as a volume to
 * scatter anchors through — it is never rendered. What ships to the GPU is a
 * single point cloud.
 */
export default class FireballMonogram {
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

    // Fewer and larger than a particle field. The balls have to be big enough
    // to read individually and to overlap into a mass — thousands of small
    // ones would just be the old particle cloud tinted orange.
    this.count = quality === "low" ? 1800 : quality === "medium" ? 3200 : 5200;
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
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);

    // Additive blending stacks these well past 1 wherever balls overlap, which
    // is exactly where the letterform is densest. Without tone mapping every
    // one of those cores clips to flat white and the word turns to paper.
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
  }

  _initScene() {
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(32, 1, 0.1, 120);
    this.camera.position.set(0, 0, 23);

    this.root = new Group();
    this.scene.add(this.root);
  }

  _build(quality) {
    const rand = makeRandom();
    const { count } = this;

    // The letterform is scaffolding. Anchors are sampled off it and it is
    // discarded — nothing about it reaches the renderer.
    const geometry = buildMonogramGeometry({ quality });
    const anchors = sampleSurface(geometry, count, rand);

    const scale = new Float32Array(count);
    const seed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Surface sampling leaves the interior hollow, which reads as an
      // outline rather than a body. Collapsing z toward the mid-plane fills
      // the extrusion, and a little lateral jitter lets the flame spill past
      // the letter's edge instead of stopping dead on it.
      anchors[i3 + 2] *= rand() * 0.9;
      anchors[i3] += (rand() - 0.5) * 0.07;
      anchors[i3 + 1] += (rand() - 0.5) * 0.07;

      // Heavily skewed: mostly small balls with a few large ones carrying the
      // silhouette. A uniform distribution looks like foam.
      scale[i] = 0.3 + Math.pow(rand(), 2.4) * 1.5;
      seed[i] = rand() * 1000;
    }

    const cloud = new BufferGeometry();
    cloud.setAttribute("position", new BufferAttribute(anchors, 3));
    cloud.setAttribute("aAnchor", new BufferAttribute(anchors, 3));
    cloud.setAttribute("aScale", new BufferAttribute(scale, 1));
    cloud.setAttribute("aSeed", new BufferAttribute(seed, 1));
    cloud.boundingSphere = null;

    this.material = new ShaderMaterial({
      vertexShader: fireballVertex,
      fragmentShader: fireballFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        // Divided by view depth in the shader, and the camera sits at 23 — so
        // this is roughly a 45px ball at rest. Anything an order of magnitude
        // lower is dust, which is the old particle field with a warm tint, not
        // a letterform built out of flames.
        uSize: { value: 1020 },
        uPixelRatio: { value: 1 },
        uModelScale: { value: 1 },
        uDisperse: { value: 0 },
        uIntensity: { value: 1 },
        uOpacity: { value: 1 },
      },
    });

    this.points = new Points(cloud, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 0;
    this.root.add(this.points);

    // Smoke shares the anchors but runs its own cycle. Normal blending, drawn
    // after the flame, because its entire job is to take brightness away —
    // additive can only add, and fire with no dark in it never looks real.
    this.smokeMaterial = new ShaderMaterial({
      vertexShader: smokeVertex,
      fragmentShader: smokeFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 780 },
        uPixelRatio: { value: 1 },
        uModelScale: { value: 1 },
        uDisperse: { value: 0 },
        uOpacity: { value: 1 },
      },
    });

    this.smoke = new Points(cloud, this.smokeMaterial);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 1;
    this.root.add(this.smoke);

    this.cloudGeometry = cloud;
    geometry.dispose();
  }

  /** Scroll-driven state, 0 → 3. */
  setProgress(value) {
    this.progress = value;

    const disperse = range(value, ...STAGE.disperse);
    const fade = this.baseOpacity * (1 - range(value, ...STAGE.fadeOut) * 0.75);

    // Restrained on purpose. At 0.45 the balls merged into one white-yellow
    // mass and stopped reading individually, which is the thing that makes
    // this work in the first place.
    this.material.uniforms.uIntensity.value = 1 + range(value, ...STAGE.flareUp) * 0.18;
    this.material.uniforms.uDisperse.value = disperse;
    this.material.uniforms.uOpacity.value = fade;

    this.smokeMaterial.uniforms.uDisperse.value = disperse;
    this.smokeMaterial.uniforms.uOpacity.value = fade;
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
    this.material.uniforms.uPixelRatio.value = dpr;
    this.smokeMaterial.uniforms.uPixelRatio.value = dpr;

    this.modelScale = aspect < 1 ? 1.9 : 2.6;
    this.material.uniforms.uModelScale.value = this.modelScale;
    this.smokeMaterial.uniforms.uModelScale.value = this.modelScale;
  }

  tick(dt) {
    if (this.disposed) return;

    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.smokeMaterial.uniforms.uTime.value = this.time;

    this.pointer.lerp(this.pointerTarget, 0.045);

    // Barely turns while it is still a word.
    const freed = range(this.progress, 1.3, 2.2);
    this.spin += dt * 0.1 * freed;

    const heroBias = 1 - Math.min(this.progress, 1);

    this.root.rotation.set(this.pointer.y * -0.1, this.spin + this.pointer.x * 0.16, 0);
    this.root.position.set(this.heroOffset.x * heroBias, this.heroOffset.y * heroBias, 0);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.cloudGeometry.dispose();
    this.material.dispose();
    this.smokeMaterial.dispose();
    this.renderer.dispose();
  }
}
