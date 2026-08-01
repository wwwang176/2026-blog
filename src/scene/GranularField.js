import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";

import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { buildMonogramGeometry, sampleSurface } from "./monogram-geometry.js";
import {
  grainFragment,
  grainVertex,
  granularFragment,
  granularVertex,
} from "./granular-shaders.js";

/** Deterministic PRNG so the grains are identical on every load. */
function makeRandom(seed = 20260803) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Normalised, clamped position of `v` inside [a, b]. */
const range = (v, a, b) => Math.min(Math.max((v - a) / (b - a), 0), 1);

const STAGE = {
  scour: [1.2, 2.9],
  fadeOut: [2.5, 3],
};

/**
 * `CW.` carved in sand.
 *
 * Same public surface as the other scenes. The third of the elements and the
 * first opaque one — no bloom pass here at all, because nothing in it is ever
 * bright enough to be worth blooming and adding one would only wash a matte
 * surface into a glow.
 */
export default class GranularField {
  constructor(canvas, { quality = "high" } = {}) {
    this.canvas = canvas;
    this.pointer = new Vector2(0, 0);
    this.pointerTarget = new Vector2(0, 0);
    this.time = 0;
    this.spin = 0;
    this.progress = 0;
    this.baseOpacity = 1;
    this.disposed = false;

    this.steps = quality === "low" ? 56 : quality === "medium" ? 80 : 110;

    // The same policy as the other two: a count rather than a fraction, so the
    // frame rate does not depend on the size of the display.
    this.pixelBudget = quality === "low" ? 280e3 : quality === "medium" ? 420e3 : 560e3;
    this.renderScale = 0.7;

    this._initRenderer();
    this._initScene();
    this._initComposer();
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
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
  }

  _initScene() {
    this.scene = new Scene();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
    );
    geometry.setAttribute(
      "uv",
      new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2)
    );

    this.material = new ShaderMaterial({
      vertexShader: granularVertex,
      fragmentShader: granularFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uAspect: { value: 1 },
        uTanHalfFov: { value: Math.tan((32 * Math.PI) / 180 / 2) },
        uCamZ: { value: 23 },
        uScale: { value: 2.4 },
        uRot: { value: new Vector2(0, 0) },
        uOpacity: { value: 1 },
        uFeather: { value: 0.001 },
        // Thicker than the fire's 0.22. A lit opaque body needs enough depth
        // for the light to fall off across it; at the fire's thickness the
        // strokes read as ribbon.
        uDepth: { value: 0.34 },
        // Frequency against amplitude is the whole texture. High and shallow
        // is dry fine sand; low and deep is gravel.
        uGrainFreq: { value: 44 },
        uGrainAmp: { value: 0.032 },
        uErosion: { value: 0 },
        uWind: { value: 0.6 },
        uAO: { value: 2.2 },
        // How bright the mass is allowed to get. Low, so the airborne grains
        // have something dark to read against.
        uLevel: { value: 0.42 },
        // Gusting, written once per frame and shared with the grains.
        uGust: { value: 1 },
        // Warm neutral, and deliberately the least saturated of the three —
        // fire took the accent and water took the cool one, so this is the
        // element with no colour of its own.
        uSand: { value: new Color(0.72, 0.56, 0.38) },
        uSteps: { value: this.steps },
      },
    });

    this.quad = new Mesh(geometry, this.material);
    this.quad.frustumCulled = false;
    this.quad.renderOrder = 0;
    this.scene.add(this.quad);
    this.quadGeometry = geometry;

    this._initGrains();
  }

  _initGrains() {
    const rand = makeRandom();

    // Point sprites this small are nearly free — the whole cloud is under a
    // tenth of the raymarch — and the count is the effect. A few hundred read
    // as specks coming off an object; this many read as air you cannot see
    // through.
    const count = 110000;

    // A third of them start on the letterform, which is what gives the sense
    // that the mark is the source. The rest start scattered through the frame
    // and well upwind of it, so the air is already full before it arrives —
    // sand only coming off the letters made the mark look like it was
    // smoking, which is an emission, not a wind.
    const fromBody = Math.floor(count * 0.30);

    const source = buildMonogramGeometry({ quality: "low" });
    const surface = sampleSurface(source, fromBody, rand);
    source.dispose();

    const anchors = new Float32Array(count * 3);
    anchors.set(surface, 0);

    for (let i = fromBody; i < count; i++) {
      anchors[i * 3 + 0] = -3.6 + rand() * 9.6;
      anchors[i * 3 + 1] = -1.8 + Math.pow(rand(), 0.8) * 3.6;
      anchors[i * 3 + 2] = (rand() - 0.5) * 4.4;
    }

    const scale = new Float32Array(count);
    const seed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Weighted hard toward the small. A handful of larger grains near the
      // camera give the field a depth that a uniform size cannot.
      scale[i] = 0.3 + Math.pow(rand(), 3.2) * 1.5;
      seed[i] = rand() * 1000;
    }

    const cloud = new BufferGeometry();
    cloud.setAttribute("position", new BufferAttribute(anchors, 3));
    cloud.setAttribute("aAnchor", new BufferAttribute(anchors, 3));
    cloud.setAttribute("aScale", new BufferAttribute(scale, 1));
    cloud.setAttribute("aSeed", new BufferAttribute(seed, 1));
    cloud.boundingSphere = null;

    const u = this.material.uniforms;

    this.grainMaterial = new ShaderMaterial({
      vertexShader: grainVertex,
      fragmentShader: grainFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: {
        // Shared by reference, so the two can never disagree about where the
        // camera is, how hard the wind blows, or what colour sand is.
        uTime: u.uTime,
        uCamZ: u.uCamZ,
        uAspect: u.uAspect,
        uTanHalfFov: u.uTanHalfFov,
        uScale: u.uScale,
        uRot: u.uRot,
        uOpacity: u.uOpacity,
        uErosion: u.uErosion,
        uWind: u.uWind,
        uGust: u.uGust,
        uSand: u.uSand,
        // Additive, so this is the level *after* overlap. At one the field piled
        // up into a whiteout that buried the mark entirely — a hundred and ten
        // thousand streaks average several deep over any given pixel, and each
        // one adds.
        uDust: { value: 0.3 },
        uStreak: { value: 4.2 },
        uSize: { value: 500 },
        uPixelRatio: { value: 1 },
      },
    });

    this.grains = new Points(cloud, this.grainMaterial);
    this.grains.frustumCulled = false;
    this.grains.renderOrder = 1;
    this.scene.add(this.grains);
    this.grainGeometry = cloud;
  }

  _initComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new OutputPass());
  }

  /** Scroll-driven state, 0 → 3. */
  setProgress(value) {
    this.progress = value;

    // The wind gets up and takes it. Fire rose and let go, water lost its
    // cohesion and drifted apart; this one is simply worn away, which is the
    // only one of the three that does not happen all at once.
    const scour = range(value, ...STAGE.scour);
    this.material.uniforms.uErosion.value = scour * scour * 1.15;
    this.material.uniforms.uWind.value = 0.6 + scour * 2.6;

    this.material.uniforms.uOpacity.value =
      this.baseOpacity * (1 - range(value, ...STAGE.fadeOut));
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

    this.material.uniforms.uAspect.value = aspect;
    this.material.uniforms.uCamZ.value = aspect < 1 ? 23 + (1 - aspect) * 14 : 23;
    this.material.uniforms.uScale.value = aspect < 1 ? 1.7 : 2.4;

    const base = Math.min(window.devicePixelRatio || 1, 2);
    this.renderScale = Math.min(
      0.85,
      Math.max(0.28, Math.sqrt(this.pixelBudget / (w * h * base * base)))
    );

    const dpr = base * this.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);

    this.grainMaterial.uniforms.uPixelRatio.value = dpr;

    this.material.uniforms.uFeather.value =
      (2 * this.material.uniforms.uTanHalfFov.value * 1.4) / Math.max(h * dpr, 1);

    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
  }

  tick(dt) {
    if (this.disposed) return;

    this.time += dt;
    this.material.uniforms.uTime.value = this.time;

    // Two slow sines of unrelated period, so the wind thickens and thins
    // without ever settling into a beat you can follow. A constant stream of
    // grains reads as a screen effect; a gusting one reads as weather.
    this.material.uniforms.uGust.value =
      0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 0.37))
                  * (0.55 + 0.45 * Math.sin(this.time * 0.83 + 1.7));

    this.pointer.lerp(this.pointerTarget, 0.045);

    const freed = range(this.progress, 1.2, 2.2);
    this.spin += dt * 0.09 * freed;

    this.material.uniforms.uRot.value.set(
      this.pointer.y * -0.35,
      this.spin + this.pointer.x * 0.14
    );

    this.composer.render();
  }

  dispose() {
    this.disposed = true;
    this.quadGeometry.dispose();
    this.grainGeometry.dispose();
    this.material.dispose();
    this.grainMaterial.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
