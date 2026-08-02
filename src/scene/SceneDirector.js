/**
 * Owns every scene's lifetime, and the crossing from one to the next.
 *
 * One canvas per scene rather than one canvas shared between them. three
 * separates `dispose()` from `forceContextLoss()`, so disposing a renderer
 * does not release the GL context — building a second renderer on the same
 * canvas hands it back the same context with half its state already torn
 * down. Two canvases is what a cross-fade needs anyway.
 *
 * Scenes are built the first time they are asked for and then kept. The sand
 * scatters a hundred and ten thousand grains at construction and the liquid
 * lays out its droplets; paying that again on every navigation would be worse
 * than holding three contexts, which is far inside what a browser allows.
 */

const REGISTRY = {
  particles: () => import("./ParticleField.js"),
  fire: () => import("./VolumetricFire.js"),
  liquid: () => import("./LiquidField.js"),
  granular: () => import("./GranularField.js"),
};

export const SCENE_NAMES = Object.keys(REGISTRY);

export const DEFAULT_SCENE = "particles";

/** Must match the transition on `.webgl canvas` in main.css. */
const FADE_MS = 200;

export default class SceneDirector {
  constructor(container, { quality = "high" } = {}) {
    this.container = container;
    this.quality = quality;

    /** name → { field, canvas, stale, warmed } */
    this.built = new Map();

    this.active = null;
    this.activeName = null;

    // Navigation can outrun a build. Anything that resolves against a stale
    // token has been overtaken and must not touch what is on screen.
    this.token = 0;
  }

  /**
   * Bring `name` to the front, building it the first time it is asked for.
   *
   * Resolves to `{ field, changed }` once that scene is the one being ticked,
   * where `changed` says whether it replaced a different scene — which is the
   * difference between a page that can ease on from where the last one left
   * off and one that cannot.
   */
  async show(name) {
    if (!REGISTRY[name]) name = DEFAULT_SCENE;

    if (this.activeName === name) {
      this._refresh(name);
      return { field: this.active, changed: false };
    }

    const token = ++this.token;

    const entry = await this._build(name);
    if (!entry || token !== this.token) return this._current();

    this._refresh(name);

    await this._warm(entry);
    if (token !== this.token) return this._current();

    const outgoing = this.built.get(this.activeName);
    const changed = this.activeName !== null;

    entry.canvas.style.display = "block";
    // Force a layout so the browser has a frame at opacity 0 to leave from.
    // Without it the class lands in the same style recalculation as the
    // unhide and there is nothing to transition.
    void entry.canvas.offsetWidth;
    entry.canvas.classList.add("is-visible");

    this.active = entry.field;
    this.activeName = name;

    if (outgoing) this._retire(outgoing);

    return { field: entry.field, changed };
  }

  /** The visible scene, for callers overtaken mid-swap. */
  _current() {
    return { field: this.active, changed: false };
  }

  async _build(name) {
    const existing = this.built.get(name);
    if (existing) return existing;

    const canvas = document.createElement("canvas");
    canvas.style.display = "none";
    this.container.appendChild(canvas);

    try {
      const { default: Field } = await REGISTRY[name]();
      const entry = {
        field: new Field(canvas, { quality: this.quality }),
        canvas,
        stale: false,
        warmed: false,
      };
      this.built.set(name, entry);
      return entry;
    } catch (err) {
      console.warn(`Scene "${name}" unavailable.`, err);
      canvas.remove();
      return null;
    }
  }

  /**
   * Draw one frame while the outgoing scene is still the one on screen.
   *
   * A raymarcher's first draw compiles a very large shader, and compilation is
   * synchronous — doing it as the first *visible* frame stalls the page at
   * exactly the moment it is navigating. `compileAsync` hands it to the driver
   * on anything supporting KHR_parallel_shader_compile, and costs the same as
   * before where it is not supported. The composer's own passes still compile
   * on the tick below, but a bloom kernel is nothing beside a volume march.
   */
  async _warm(entry) {
    if (entry.warmed) return;
    entry.warmed = true;

    const { field } = entry;

    try {
      await field.renderer.compileAsync(field.scene, field.camera);
    } catch {
      // Not fatal — the tick below will compile it the slow way instead.
    }

    field.tick(0);
  }

  /**
   * Fade it out, then stop compositing it. The scene itself is kept; only its
   * canvas goes away, and only once the fade that needed it has finished.
   */
  _retire(entry) {
    entry.canvas.classList.remove("is-visible");

    setTimeout(() => {
      // Unless something has brought it back in the meantime.
      if (!entry.canvas.classList.contains("is-visible")) {
        entry.canvas.style.display = "none";
      }
    }, FADE_MS);
  }

  /**
   * Every built scene needs the new size eventually, but only the visible one
   * needs it now — a resize reallocates render targets, and doing that for
   * three scenes on every event of a window drag is three times the cost for
   * two invisible results.
   */
  resize() {
    for (const [name, entry] of this.built) {
      if (name === this.activeName) entry.field.resize();
      else entry.stale = true;
    }
  }

  _refresh(name) {
    const entry = this.built.get(name);
    if (!entry || !entry.stale) return;
    entry.field.resize();
    entry.stale = false;
  }

  /** Only the scene on screen. The one fading out is held on its last frame,
   * which at two hundred milliseconds of falling opacity nobody reads as a
   * freeze — and ticking two raymarchers at once would drop the frame rate at
   * precisely the moment the transition is being watched. */
  tick(dt) {
    if (this.active) this.active.tick(dt);
  }

  setPointer(x, y) {
    if (this.active) this.active.setPointer(x, y);
  }

  dispose() {
    for (const entry of this.built.values()) {
      entry.field.dispose();
      entry.canvas.remove();
    }
    this.built.clear();
    this.active = null;
    this.activeName = null;
  }
}
