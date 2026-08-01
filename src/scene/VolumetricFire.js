import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
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
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { buildMonogramGeometry, sampleSurface } from "./monogram-geometry.js";
import {
  emberFragment,
  emberVertex,
  volumeFragment,
  volumeVertex,
} from "./volumetric-fire-shaders.js";

/** Deterministic PRNG so the embers are identical on every load. */
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
  disperse: [1.4, 2.9],
  fadeOut: [2.4, 3],
};

/**
 * `CW.` as a raymarched volume.
 *
 * There is no geometry describing the monogram anywhere in this class. The
 * scene contains one triangle covering the screen; everything visible is
 * computed per pixel by marching through a density field. Same public surface
 * as the other scenes, so it is still a one-line swap.
 */
export default class VolumetricFire {
  constructor(canvas, { quality = "high" } = {}) {
    this.canvas = canvas;
    this.pointer = new Vector2(0, 0);
    this.pointerTarget = new Vector2(0, 0);
    this.time = 0;
    this.spin = 0;
    this.progress = 0;
    this.baseOpacity = 1;
    this.disposed = false;

    // The dominant cost by far. Every step is two fbm evaluations and an SDF,
    // so this is the first thing to give on a weak device.
    // Warping the sample rather than eroding the threshold gives a crisper
    // boundary, so fewer samples are needed to resolve it than the earlier
    // approach wanted.
    this.steps = quality === "low" ? 26 : quality === "medium" ? 36 : 48;

    // Raymarching pays per pixel, and the result is soft — resolution is the
    // cheapest thing to spend here and the hardest to miss.
    this.renderScale = quality === "low" ? 0.45 : quality === "medium" ? 0.55 : 0.65;

    this.heroOffset = new Vector2(0, 0);

    this._initRenderer();
    this._initScene();
    this._initComposer(quality);
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
    this.renderer.toneMappingExposure = 0.95;
  }

  _initScene() {
    this.scene = new Scene();
    // Unused by the shader, which writes clip space directly, but the render
    // pass needs a camera.
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // One oversized triangle rather than a quad: no diagonal seam, and the
    // GPU rasterises it in a single pass.
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
      vertexShader: volumeVertex,
      fragmentShader: volumeFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uAspect: { value: 1 },
        uTanHalfFov: { value: Math.tan((32 * Math.PI) / 180 / 2) },
        uCamZ: { value: 23 },
        uScale: { value: 2.6 },
        uRot: { value: new Vector2(0, 0) },
        uDisperse: { value: 0 },
        uOpacity: { value: 1 },
        // Off by default: the letterform is where the flame comes from, not
        // something to look at. Set to 1 to see the solid it is shaped by.
        uFuel: { value: 0 },
        uSteps: { value: this.steps },
      },
    });

    this.quad = new Mesh(geometry, this.material);
    this.quad.frustumCulled = false;
    this.quad.renderOrder = 0;
    this.scene.add(this.quad);

    this.quadGeometry = geometry;

    this._initEmbers();
  }

  _initEmbers() {
    const rand = makeRandom();
    const count = 225;

    // The mesh builder is used once, purely to scatter anchors over the same
    // letterform the distance field describes, then discarded. It is the only
    // place in this scene geometry appears at all.
    const source = buildMonogramGeometry({ quality: "low" });
    const anchors = sampleSurface(source, count, rand);
    source.dispose();

    const scale = new Float32Array(count);
    const seed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      scale[i] = 0.35 + Math.pow(rand(), 2.2) * 1.1;
      seed[i] = rand() * 1000;
    }

    const cloud = new BufferGeometry();
    cloud.setAttribute("position", new BufferAttribute(anchors, 3));
    cloud.setAttribute("aAnchor", new BufferAttribute(anchors, 3));
    cloud.setAttribute("aScale", new BufferAttribute(scale, 1));
    cloud.setAttribute("aSeed", new BufferAttribute(seed, 1));
    cloud.boundingSphere = null;

    const u = this.material.uniforms;

    this.emberMaterial = new ShaderMaterial({
      vertexShader: emberVertex,
      fragmentShader: emberFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: {
        // Shared by reference with the volume, so the two can never disagree
        // about where the camera is or how big the monogram is.
        uTime: u.uTime,
        uCamZ: u.uCamZ,
        uAspect: u.uAspect,
        uTanHalfFov: u.uTanHalfFov,
        uScale: u.uScale,
        uRot: u.uRot,
        uDisperse: u.uDisperse,
        uOpacity: u.uOpacity,
        uSize: { value: 90 },
        uPixelRatio: { value: 1 },
      },
    });

    this.embers = new Points(cloud, this.emberMaterial);
    this.embers.frustumCulled = false;
    this.embers.renderOrder = 1;
    this.scene.add(this.embers);

    this.emberGeometry = cloud;
  }

  _initComposer(quality) {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Only the hottest cores catch it. Bloom should be the thing you notice
    // last, not the thing doing the work.
    this.bloom = new UnrealBloomPass(
      new Vector2(window.innerWidth, window.innerHeight),
      quality === "low" ? 0.22 : 0.3,
      0.45,
      0.8
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Scroll-driven state, 0 → 3. */
  setProgress(value) {
    this.progress = value;

    this.material.uniforms.uDisperse.value = range(value, ...STAGE.disperse);
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
    // Lower than the mesh scenes used, because the density field grows well
    // beyond the letterform it is shaped from — the plume is part of the
    // footprint and has to be inside the frame too.
    this.material.uniforms.uScale.value = aspect < 1 ? 1.25 : 1.75;

    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);

    // Embers are small and sharp, so they get the real ratio rather than the
    // reduced one the raymarch renders at.
    this.emberMaterial.uniforms.uPixelRatio.value = dpr;

    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  tick(dt) {
    if (this.disposed) return;

    this.time += dt;
    this.material.uniforms.uTime.value = this.time;

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
    this.emberGeometry.dispose();
    this.material.dispose();
    this.emberMaterial.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
