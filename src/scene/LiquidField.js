import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";

import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { buildDroplets } from "./monogram-centreline.js";
import { GROUP_SIZE, buildLiquidFragment, liquidVertex } from "./liquid-shaders.js";

/** Deterministic PRNG so the droplets ring identically on every load. */
function makeRandom(seed = 20260801) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Normalised, clamped position of `v` inside [a, b]. */
const range = (v, a, b) => Math.min(Math.max((v - a) / (b - a), 0), 1);

/** A third of a cycle, which is how far apart the three radius phases sit. */
const THIRD = (Math.PI * 2) / 3;

const STAGE = {
  disperse: [1.4, 2.9],
  fadeOut: [2.4, 3],
};

/**
 * `CW.` as weightless liquid.
 *
 * Same public surface as the other scenes, so it is still a one-line swap.
 * Internally it has almost nothing in common with VolumetricFire: that one
 * integrates through a volume, this one traces to a surface.
 */
export default class LiquidField {
  constructor(canvas, { quality = "high" } = {}) {
    this.canvas = canvas;
    this.pointer = new Vector2(0, 0);
    this.pointerTarget = new Vector2(0, 0);
    this.time = 0;
    this.spin = 0;
    this.progress = 0;
    this.spread = 0;
    this.baseOpacity = 1;
    this.disposed = false;

    // Sphere tracing converges, so unlike the fire's stride this cap is a real
    // limit rather than a formality — a ray that has not arrived by here is
    // grazing the surface, and stopping it early costs an edge pixel.
    this.steps = quality === "low" ? 48 : quality === "medium" ? 72 : 96;

    // Deliberately higher than the fire's 0.45. A volume is soft everywhere so
    // resolution was the cheapest thing to give up; a surface has a silhouette
    // and gives it up very badly. Measured at 1440x900: 0.7 runs at 111fps and
    // 0.9 at 82, and the silhouette at 0.7 is clean because the near-miss
    // feather is carrying it.
    this.renderScale = quality === "low" ? 0.4 : quality === "medium" ? 0.55 : 0.7;

    // Cohesion at rest, and the one number that decides whether this reads as
    // droplets or as a poured letterform. It is not free: a wider blend makes
    // the distance estimate more conservative, so the trace takes more steps
    // to converge.
    this.blend = 0.195;

    // How far each radius swings either side of rest. Too little and the
    // droplets look solid; past about 0.25 neighbours pull apart at the
    // troughs and the strokes break — which the wide blend above now covers
    // for, so this sits higher than it could otherwise.
    this.wobble = 0.18;
    this.drift = 0.07;
    this.radiusScale = 1.07;
    this.cull = true;

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
    this.renderer.toneMappingExposure = 1.0;
  }

  _initScene() {
    this.scene = new Scene();
    // Unused by the shader, which writes clip space directly, but the render
    // pass needs a camera.
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

    const { count, centres, radius } = buildDroplets();

    // The shader culls by whole groups, so the array is padded out to a round
    // number of them. Padding sits far away with a negligible radius, which
    // keeps it out of every min without needing a count test in the loop.
    this.groupCount = Math.ceil(count / GROUP_SIZE);
    this.dropletCount = this.groupCount * GROUP_SIZE;

    this.rest = centres.slice();
    while (this.rest.length < this.dropletCount) this.rest.push([1e3, 0]);

    this.restRadius = radius;

    const rand = makeRandom();

    /**
     * Everything about a droplet that never changes.
     *
     * A weightless droplet is a sphere because surface tension has nothing to
     * fight, and a disturbed one does not settle back into one — it rings,
     * passing through prolate and oblate and back. That ringing is the only
     * thing on screen that says liquid rather than bead.
     *
     * Every droplet gets its own rate and phase, because in step they read as
     * one pulsing object rather than as thirty separate ones. `escape` is the
     * heading it leaves along when scroll takes the cohesion away — outward
     * from the centre of the mark, with some depth mixed in so they do not all
     * separate within one plane.
     */
    this.seeds = this.rest.map(([x, y], i) => {
      const f1 = rand();
      const f2 = rand();
      const f3 = rand();
      const z = (rand() - 0.5) * 1.6;
      const len = Math.hypot(x, y, z) || 1;

      // Padding is parked far off with a radius that rounds to nothing.
      if (i >= count) {
        return { rate: 0, phase: 0, driftRate: [0, 0, 0], driftPhase: [0, 0, 0],
                 escape: [0, 0, 0], radius: 1e-4 };
      }

      // Both rates run at twice what the shape was tuned at. Slower read as
      // something suspended in gel; this is closer to how a droplet of that
      // size actually rings, and it costs nothing since none of it is on the
      // GPU any more.
      return {
        rate: 2.2 + f1 * 3.0,
        phase: f2 * Math.PI * 2,
        driftRate: [1.06 + f1 * 1.2, 0.94 + f2 * 1.4, 1.22 + f3 * 1.0],
        driftPhase: [f3, f1, f2].map((v) => v * Math.PI * 2),
        escape: [x / len, y / len, z / len],
        radius,
      };
    });

    const drops = this.rest.map(([x, y]) => new Vector4(x, y, 0, radius));
    const invRads = this.rest.map(() => new Vector3(1 / radius, 1 / radius, 1 / radius));
    const groups = Array.from({ length: this.groupCount }, () => new Vector4());

    this.material = new ShaderMaterial({
      vertexShader: liquidVertex,
      fragmentShader: buildLiquidFragment(count),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uAspect: { value: 1 },
        uTanHalfFov: { value: Math.tan((32 * Math.PI) / 180 / 2) },
        uCamZ: { value: 23 },
        uScale: { value: 2.4 },
        uRot: { value: new Vector2(0, 0) },
        uOpacity: { value: 1 },
        uBlend: { value: this.blend },
        uTint: { value: 0.5 },
        // Set from the backing-store height in resize(), because it is an
        // angle and one pixel is what it has to match.
        uFeather: { value: 0.001 },
        // How far the smin result may be clamped back toward the plain min,
        // as a fraction of the blend. Zero disables the clamp entirely, which
        // is how it gets measured against.
        uClamp: { value: 0.75 },
        uInvAniso: { value: 1 },
        uSteps: { value: this.steps },
        uBoxLo: { value: new Vector3() },
        uBoxHi: { value: new Vector3() },
        uDrops: { value: drops },
        uInvRads: { value: invRads },
        uGroups: { value: groups },
      },
    });

    this._updateDroplets();

    this.quad = new Mesh(geometry, this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.quadGeometry = geometry;
  }

  _initComposer(quality) {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomScale = 0.5;

    // The threshold stays high, so this still only catches the specular hits
    // and the Fresnel edge rather than lifting the whole body. Within that,
    // it is turned up hard: on a subject this dark the bloom around a
    // highlight is most of what reads as light passing through water.
    this.bloom = new UnrealBloomPass(
      new Vector2(window.innerWidth * this.bloomScale, window.innerHeight * this.bloomScale),
      quality === "low" ? 0.42 : 0.6,
      0.5,
      0.9
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /**
   * Where every droplet is this frame, and the box that contains them.
   *
   * All of this is a function of time alone — none of it depends on where a
   * ray is — so it belongs here rather than in the shader, which would
   * recompute the same thirty answers at every step of every ray. Thirty
   * droplets of trigonometry per frame does not register; the same work inside
   * the march was most of the frame.
   */
  _updateDroplets() {
    const t = this.time;
    const u = this.material.uniforms;
    const drops = u.uDrops.value;
    const invRads = u.uInvRads.value;

    const loose = this.spread;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < this.dropletCount; i++) {
      const s = this.seeds[i];
      const rest = this.rest[i];
      const r0 = s.radius * this.radiusScale;

      // Three sines a third of a cycle apart sum to zero, so the shape changes
      // while the volume very nearly does not.
      const a = t * s.rate + s.phase;
      const rx = r0 * (1 + this.wobble * Math.sin(a));
      const ry = r0 * (1 + this.wobble * Math.sin(a + THIRD));
      const rz = r0 * (1 + this.wobble * Math.sin(a + THIRD * 2));

      // Nothing falls, so the only translation is a slow drift around where
      // the droplet rests. Its real job is the necks: as neighbours breathe
      // apart and back the bridge between them thins and thickens, which is
      // what makes them read as one body of liquid rather than as touching
      // spheres.
      const x =
        rest[0] +
        this.drift * Math.sin(t * s.driftRate[0] + s.driftPhase[0]) +
        s.escape[0] * loose;
      const y =
        rest[1] +
        this.drift * Math.sin(t * s.driftRate[1] + s.driftPhase[1]) +
        s.escape[1] * loose;
      const z =
        this.drift * Math.sin(t * s.driftRate[2] + s.driftPhase[2]) +
        s.escape[2] * loose;

      drops[i].set(x, y, z, Math.min(rx, Math.min(ry, rz)));
      invRads[i].set(1 / rx, 1 / ry, 1 / rz);

      if (x - rx < minX) minX = x - rx;
      if (y - ry < minY) minY = y - ry;
      if (z - rz < minZ) minZ = z - rz;
      if (x + rx > maxX) maxX = x + rx;
      if (y + ry > maxY) maxY = y + ry;
      if (z + rz > maxZ) maxZ = z + rz;
    }

    // The blend rounds corners outward by up to k, so the box has to allow for
    // it or the smoothed surface gets clipped at the silhouette.
    const pad = this.material.uniforms.uBlend.value + 0.02;
    u.uBoxLo.value.set(minX - pad, minY - pad, minZ - pad);
    u.uBoxHi.value.set(maxX + pad, maxY + pad, maxZ + pad);

    // A bounding sphere over each run of consecutive droplets, which the
    // shader uses to skip whole runs. Consecutive along the array is
    // consecutive along the centreline, so a run is a short piece of one
    // stroke and its sphere is tight.
    const bounds = u.uGroups.value;

    for (let g = 0; g < this.groupCount; g++) {
      const from = g * GROUP_SIZE;
      let cx = 0, cy = 0, cz = 0;

      for (let i = from; i < from + GROUP_SIZE; i++) {
        cx += drops[i].x;
        cy += drops[i].y;
        cz += drops[i].z;
      }
      cx /= GROUP_SIZE;
      cy /= GROUP_SIZE;
      cz /= GROUP_SIZE;

      let r = 0;
      for (let i = from; i < from + GROUP_SIZE; i++) {
        const inv = invRads[i];
        // Largest semi-axis, which is the reciprocal of the smallest inverse.
        const widest = 1 / Math.min(inv.x, Math.min(inv.y, inv.z));
        const reach =
          Math.hypot(drops[i].x - cx, drops[i].y - cy, drops[i].z - cz) + widest;
        if (reach > r) r = reach;
      }

      // A radius large enough that no group is ever skipped turns the culling
      // off without a rebuild, which is the only way to A/B it inside one page
      // session — and comparing across reloads is how every misleading
      // measurement in this project has happened.
      bounds[g].set(cx, cy, cz, this.cull ? r : 1e5);
    }

    // The ellipsoid estimate scales with the ratio of smallest semi-axis to
    // largest, so a bound built from plain distances has to be widened by it
    // or the shader will skip a group it should have evaluated.
    u.uInvAniso.value = (1 + this.wobble) / Math.max(1 - this.wobble, 0.05);
  }

  /** Scroll-driven state, 0 → 3. */
  setProgress(value) {
    this.progress = value;

    const loose = range(value, ...STAGE.disperse);
    this.spread = loose * loose * 3.2;
    // Surface tension goes with it. Holding the blend constant while the
    // droplets separate makes them let go all at once; letting it fall first
    // stretches the necks thin and then snaps them, which is what the eye is
    // looking for.
    this.material.uniforms.uBlend.value = this.blend * (1 - loose * 0.92);

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
    // Larger than the fire's, because there is no plume here — the mark is the
    // whole footprint, so it can be sized to the frame rather than to the
    // headroom something rising off it needs.
    this.material.uniforms.uScale.value = aspect < 1 ? 1.7 : 2.4;

    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);

    // The silhouette feather is an angle, and the angle it has to match is the
    // one a single pixel of the backing store subtends. A little over one, so
    // the edge has somewhere to fall off across.
    this.material.uniforms.uFeather.value =
      (2 * this.material.uniforms.uTanHalfFov.value * 1.4) / Math.max(h * dpr, 1);

    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    // After the composer, which would otherwise reset it to full size.
    this.bloom.setSize(w * this.bloomScale, h * this.bloomScale);
  }

  tick(dt) {
    if (this.disposed) return;

    this.time += dt;
    this._updateDroplets();

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
