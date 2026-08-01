import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";

import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { volumeFragment, volumeVertex } from "./volumetric-fire-shaders.js";

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
    this.steps = quality === "low" ? 30 : quality === "medium" ? 42 : 56;

    // Raymarching pays per pixel, and the result is soft — resolution is the
    // cheapest thing to spend here and the hardest to miss.
    this.renderScale = quality === "low" ? 0.5 : quality === "medium" ? 0.62 : 0.72;

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
        uSteps: { value: this.steps },
      },
    });

    this.quad = new Mesh(geometry, this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.quadGeometry = geometry;
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
    this.material.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
