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

    /** name → { field, canvas, stale, warming } */
    this.built = new Map();

    /** name → in-flight build, so nothing is constructed twice. */
    this.building = new Map();

    this.active = null;
    this.activeName = null;

    // Navigation can outrun a build. Anything that resolves against a stale
    // token has been overtaken and must not touch what is on screen.
    this.token = 0;

    // Where the pointer was last seen. Only the visible scene is told about
    // it, so this is what an incoming one has to be caught up with.
    this.pointerX = 0;
    this.pointerY = 0;
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

    // Face the way the mark on screen is facing. All three read the pointer
    // through the same expression, so given the same value they agree — but
    // the incoming one has not been ticked since the pointer last moved, and
    // easing in from where it was left would turn the mark through the fade.
    entry.field.setPointer(this.pointerX, this.pointerY, true);

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

  /**
   * Build and warm a scene without showing it.
   *
   * Worth doing from anywhere that can see a crossing coming: a scene met for
   * the first time costs 360ms to reach and one already built costs 94, of
   * which 200 is the fade itself — so a warm crossing is waiting on nothing.
   */
  async prebuild(name) {
    if (!REGISTRY[name]) return;
    const entry = await this._build(name);
    if (entry) await this._warm(entry);
  }

  _build(name) {
    const existing = this.built.get(name);
    if (existing) return Promise.resolve(existing);

    // A crossing and a prebuild can both want the same scene, and building it
    // twice would leave two contexts where one belongs.
    const inflight = this.building.get(name);
    if (inflight) return inflight;

    const started = (async () => {
      const canvas = document.createElement("canvas");
      canvas.style.display = "none";
      this.container.appendChild(canvas);

      try {
        const { default: Field } = await REGISTRY[name]();
        const entry = {
          field: new Field(canvas, { quality: this.quality }),
          canvas,
          stale: false,
          warming: null,
        };
        this.built.set(name, entry);
        return entry;
      } catch (err) {
        console.warn(`Scene "${name}" unavailable.`, err);
        canvas.remove();
        return null;
      }
    })().finally(() => this.building.delete(name));

    this.building.set(name, started);
    return started;
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
  _warm(entry) {
    // The promise is the guard, not a flag. A flag set on entry would let a
    // second caller through while the compile was still running, and a
    // crossing would fade in on a scene that had never drawn.
    if (!entry.warming) {
      const { field } = entry;
      entry.warming = (async () => {
        try {
          await field.renderer.compileAsync(field.scene, field.camera);
        } catch {
          // Not fatal — the tick below will compile it the slow way instead.
        }
        field.tick(0);
      })();
    }
    return entry.warming;
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
    this.pointerX = x;
    this.pointerY = y;
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
