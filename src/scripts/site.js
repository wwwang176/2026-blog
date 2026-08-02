/**
 * Site-wide client runtime.
 *
 * Under Astro's ClientRouter this module is evaluated exactly once — ES module
 * caching survives view transitions — so anything expensive lives in
 * `startOnce()` and never runs again. Per-page wiring (scroll triggers,
 * reveals, form handlers) is torn down and rebuilt on every navigation.
 *
 * The canvas element carries `transition:persist`, so the WebGL context is
 * never destroyed and the particle field keeps running across pages.
 */

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

import { runLoader } from "../ui/loader.js";

gsap.registerPlugin(ScrollTrigger);

const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let director = null;
let lenis = null;
let started = false;
let firstLoad = true;
let clockTimer = null;
let directorPromise = null;
let bootPromise = null;
let sceneSettled = false;

/* ── Capability checks ────────────────────────────────────── */

function supportsWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function pickQuality() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const coarse = window.matchMedia("(pointer: coarse)").matches;

  if (coarse || cores <= 4 || memory <= 4) return "low";
  if (cores <= 8 || memory <= 8) return "medium";
  return "high";
}

/**
 * ClientRouter swaps the whole <body>, taking any classes we added with it.
 * These are state, not markup, so they get reapplied on every navigation.
 */
function applyBodyState() {
  const cl = document.body.classList;
  const live = Boolean(director?.active);
  cl.toggle("reduced-motion", prefersReduced);
  cl.toggle("webgl-ready", live);
  // Only fall back once a scene has actually settled — the three.js chunk
  // loads asynchronously, so an absent scene early on isn't a failure.
  cl.toggle("webgl-fallback", sceneSettled && !live);
}

/* ── One-time boot ────────────────────────────────────────── */

function startOnce() {
  if (started) return;
  started = true;

  if (!prefersReduced) {
    lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1 });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }
}

/**
 * three.js is by far the heaviest thing on the site, and nothing on the page
 * depends on it to be readable — so it loads as a separate chunk rather than
 * blocking first paint. The container is left in the DOM either way; CSS keeps
 * it at opacity 0 until `webgl-ready` is set.
 *
 * Only the director itself is loaded here. Which scene it builds, and the
 * three.js chunk that comes with it, waits until a page asks for one.
 */
function startDirector() {
  if (directorPromise) return directorPromise;

  const container = document.getElementById("webgl");

  if (!container || prefersReduced || !supportsWebGL()) {
    sceneSettled = true;
    directorPromise = Promise.resolve(null);
    return directorPromise;
  }

  directorPromise = import("../scene/SceneDirector.js")
    .then(({ default: SceneDirector }) => {
      director = new SceneDirector(container, { quality: pickQuality() });
      attachSceneListeners();
      return director;
    })
    .catch((err) => {
      console.warn("Scene director unavailable, falling back to gradient.", err);
      director = null;
      return null;
    });

  return directorPromise;
}

/**
 * Bring up whichever scene this page asked for, building it on first use.
 *
 * Resolves to `{ field, changed }`, or null if there is no scene at all.
 */
function showScene(name) {
  return startDirector()
    .then((d) => (d ? d.show(name) : null))
    .catch((err) => {
      console.warn("Scene unavailable, falling back to gradient.", err);
      return null;
    })
    .finally(() => {
      sceneSettled = true;
      applyBodyState();
    });
}

/**
 * Attached once, for every scene there will ever be. The director holds which
 * one is on screen; nothing here closes over a particular scene, because a
 * navigation can replace it.
 */
function attachSceneListeners() {
  let hidden = false;

  gsap.ticker.add((_time, deltaMS) => {
    if (hidden) return;
    director.tick(Math.min(deltaMS, 50) / 1000);
  });

  document.addEventListener("visibilitychange", () => {
    hidden = document.hidden;
  });

  window.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    director.setPointer(
      (e.clientX / window.innerWidth) * 2 - 1,
      -((e.clientY / window.innerHeight) * 2 - 1)
    );
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    director.resize();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => ScrollTrigger.refresh(), 200);
  });
}

/* ── Particle field ───────────────────────────────────────── */

/**
 * The landing page's three elements, and where they hand over.
 *
 * `from`/`to` are positions in the page's own 0 → 3 scroll, and `arc` is the
 * stretch of that scene's own 0 → 3 the band is played across.
 *
 * The first two arcs stop at 1.9. Running them further looked right written
 * down — a whole life inside each band — and was wrong on the screen: with a
 * third of a page each, every element spent most of its band coming apart and
 * the mark was only briefly legible in any of them. What the sequence is about
 * is the mark changing what it is made of, not being destroyed three times.
 * So each of the first two holds together through its band and is just
 * beginning to let go as it hands over, which is what gives the crossing
 * somewhere to start. The last runs the whole way, because the page ends
 * there and something has to.
 *
 * These numbers are the whole tuning surface for the sequence.
 */
const HOME_BANDS = [
  // Hero and brief. Works. Journal and contact. The boundaries were picked
  // against measured scroll positions rather than by dividing the axis, which
  // is nothing like even: stage 1 lands at a sixth of the page and stage 2 at
  // not quite half, because the sections are nowhere near the same height.
  { name: "fire", from: 0, to: 1.5, arc: [0, 1.9] },
  { name: "liquid", from: 1.5, to: 2.25, arc: [0, 1.9] },
  { name: "granular", from: 2.25, to: 3, arc: [0, 3] },
];

const bandAt = (p) => HOME_BANDS.find((b) => p < b.to) ?? HOME_BANDS[HOME_BANDS.length - 1];

/** Where `p` sits inside `band`, expressed on that scene's own arc. */
function arcAt(band, p) {
  const t = Math.min(Math.max((p - band.from) / (band.to - band.from), 0), 1);
  return band.arc[0] + t * (band.arc[1] - band.arc[0]);
}

/**
 * Drives the sequence from the page's scroll position.
 *
 * Asking for a scene is asynchronous, so the one already on screen keeps
 * taking the progress until its replacement arrives — clamped to the end of
 * its own band, so it holds the last pose of its life rather than freezing
 * wherever the scroll happened to be when the request went out.
 */
function driveHomeBands(field) {
  let asked = HOME_BANDS[0];
  let live = { field, band: asked };

  return {
    setProgress(p) {
      const next = bandAt(p);

      if (next !== asked) {
        asked = next;
        showScene(next.name).then((r) => {
          if (r && asked === next) live = { field: r.field, band: next };
        });
      }

      live.field.setProgress(arcAt(live.band, p));

      // Build the one after this while there is still scrolling to do before
      // it is wanted, so every handover is the two-hundred millisecond fade
      // and nothing else.
      const ahead = HOME_BANDS[HOME_BANDS.indexOf(next) + 1];
      if (ahead && p > next.from + (next.to - next.from) * 0.35) {
        startDirector().then((d) => d?.prebuild(ahead.name));
      }
    },

    setOpacity(v) {
      live.field.setOpacity(v);
    },
  };
}

/**
 * Pages declare what the field should do via `data-scene` on <main>:
 *   scroll  — sections drive uProgress (the landing page)
 *   static  — hold one stage, set by `data-scene-stage`
 */
function bindScene(main, field, changed) {
  if (!field || !main) return;

  if (main.dataset.scene === "scroll") {
    // Detail pages dim the scene and nothing here was putting it back, so
    // arriving from one left the landing page at four fifths until the contact
    // trigger happened to fire.
    field.setOpacity(1);

    // Standing in for a single scene: the landing page runs three of them in
    // sequence, and the triggers below should not have to know that.
    const scene = driveHomeBands(field);

    // `data-stage` is the progress value the field holds at that section's
    // centre, not just a sort key. It used to be the latter and the progress
    // came from the array index, which meant a section could only be inserted
    // at the cost of renumbering every scene's stage constants — so the
    // journal simply had no stage at all, and the works-to-contact ramp ran
    // blind across two sections of scrolling.
    const sections = [...main.querySelectorAll("[data-stage]")]
      .map((el) => ({ el, stage: Number(el.dataset.stage) }))
      .sort((a, b) => a.stage - b.stage);

    // Scroll position of each section's centre, remeasured whenever the
    // layout can have moved.
    let stops = [];

    const measure = () => {
      const max = ScrollTrigger.maxScroll(window);
      const mid = window.innerHeight / 2;
      stops = sections.map(({ el, stage }) => {
        const box = el.getBoundingClientRect();
        const y = box.top + window.scrollY + box.height / 2 - mid;
        return { stage, y: Math.min(Math.max(y, 0), max) };
      });
    };

    /** The page's 0 → 3, piecewise between the section centres. */
    const progressAt = (y) => {
      if (!stops.length) return 0;
      if (y <= stops[0].y) return stops[0].stage;

      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1];
        const b = stops[i];
        if (y > b.y) continue;
        const span = b.y - a.y;
        return span > 0 ? a.stage + ((y - a.y) / span) * (b.stage - a.stage) : b.stage;
      }
      return stops[stops.length - 1].stage;
    };

    // One trigger for the whole page rather than one per pair of sections.
    // Each of those fired its own onUpdate on every scroll event, including
    // the ones already clamped at 0 or 1, so the progress arrived several
    // times a frame carrying different values. With a single scene that was
    // invisible — the right value overwrote the wrong ones in the same frame.
    // With three it made the sequence pick a different element several times a
    // frame, and every pick cancelled the crossing the last one had started,
    // so nothing changed until the scrolling stopped.
    ScrollTrigger.create({
      trigger: main,
      start: "top top",
      end: "max",
      scrub: true,
      onRefresh: measure,
      onUpdate: (self) => scene.setProgress(progressAt(self.scroll())),
    });

    const contact = document.getElementById("contact");
    if (contact) {
      ScrollTrigger.create({
        trigger: contact,
        start: "top 70%",
        end: "top 20%",
        scrub: true,
        onUpdate: (self) => scene.setOpacity(1 - self.progress * 0.45),
      });
    }
    return;
  }

  // Detail and list pages hold a single shape, easing over from whatever the
  // previous page left behind so navigation reads as one continuous scene.
  //
  // `data-scene-stage` is a particle *shape* index — 2 is the grid, and one
  // shape is no more finished than another. The elemental scenes read the same
  // axis as how far through their own destruction they are, so the same number
  // would leave every detail page sitting permanently half-eroded. They
  // declare a resting stage of their own and ignore the page's.
  const stage = field.restStage ?? Number(main.dataset.sceneStage ?? 2);

  field.setOpacity(0.8);

  // Across a change of scene there is nothing to be continuous with, and the
  // cross-fade is already covering the discontinuity. Easing the incoming one
  // from wherever the outgoing one was left would have it arriving out of a
  // state it never occupied — scrolling the landing page down to contact and
  // then opening a work would have started the sand fully blown away and
  // reassembled it.
  if (changed) {
    field.setProgress(stage);
    return;
  }

  const from = { value: field.progress };

  gsap.to(from, {
    value: stage,
    duration: 1.4,
    ease: "power2.inOut",
    onUpdate: () => field.setProgress(from.value),
  });
}

/* ── Reveals and parallax ─────────────────────────────────── */

function bindReveals() {
  if (prefersReduced) {
    gsap.set("[data-fade], [data-reveal], [data-stagger] > *, [data-intro]", {
      opacity: 1,
      y: 0,
    });
    return;
  }

  // Opacity only — these also carry a scrubbed y-parallax, and two tweens on
  // the same property would overwrite one another.
  gsap.utils.toArray("[data-fade]").forEach((el) => {
    gsap.from(el, {
      opacity: 0,
      duration: 1.1,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 92%", once: true },
    });
  });

  gsap.utils.toArray("[data-reveal]").forEach((el) => {
    gsap.from(el, {
      opacity: 0,
      y: 48,
      duration: 1.2,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 85%", once: true },
    });
  });

  gsap.utils.toArray("[data-stagger]").forEach((group) => {
    gsap.from(group.children, {
      opacity: 0,
      y: 20,
      duration: 0.8,
      ease: "power3.out",
      stagger: 0.05,
      scrollTrigger: { trigger: group, start: "top 88%", once: true },
    });
  });

  const cards = gsap.utils.toArray("[data-cards] > *");
  if (cards.length) {
    gsap.from(cards, {
      opacity: 0,
      y: 60,
      duration: 1.1,
      ease: "power3.out",
      stagger: 0.09,
      scrollTrigger: { trigger: cards[0].parentElement, start: "top 85%", once: true },
    });
  }
}

function bindParallax() {
  if (prefersReduced) return;

  // Targets the wrapper, not `.line__inner` — the intro timeline owns the
  // inner element's yPercent.
  const heroTitle = document.querySelector(".hero__title");
  if (heroTitle) {
    gsap.fromTo(
      heroTitle,
      { y: 0, opacity: 1 },
      {
        y: () => -window.innerHeight * 0.18,
        opacity: 0.12,
        ease: "none",
        scrollTrigger: {
          trigger: "#hero",
          start: "top top",
          end: "bottom top",
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      }
    );
  }

  gsap.utils.toArray(".section__label").forEach((label) => {
    const section = label.closest(".section, .work-hero, .article-hero");
    if (!section) return;

    gsap.fromTo(
      label,
      { y: 40 },
      {
        y: -40,
        ease: "none",
        scrollTrigger: { trigger: section, start: "top bottom", end: "bottom top", scrub: 0.8 },
      }
    );
  });

  gsap.utils.toArray(".parallax-slow").forEach((wrap) => {
    const section = wrap.closest(".section");
    if (!section) return;

    gsap.fromTo(
      wrap,
      { y: 60 },
      {
        y: -60,
        ease: "none",
        scrollTrigger: { trigger: section, start: "top bottom", end: "bottom top", scrub: 1 },
      }
    );
  });
}

/* ── Hero intro ───────────────────────────────────────────── */

function primeIntro() {
  if (prefersReduced || !document.querySelector(".hero__title")) return;

  gsap.set(".hero__title .line__inner", { yPercent: 115 });
  gsap.set(".hero__meta > *, [data-intro]", { opacity: 0, y: 16 });
  gsap.set(".site-header", { opacity: 0, y: -16 });
}

function playIntro() {
  if (prefersReduced) return;

  const hasHero = document.querySelector(".hero__title");
  const tl = gsap.timeline({ defaults: { ease: "expo.out" } });

  if (hasHero) {
    tl.to(".hero__title .line__inner", { yPercent: 0, duration: 1.4, stagger: 0.12 })
      .to(".hero__meta > *", { opacity: 1, y: 0, duration: 1, stagger: 0.08 }, "-=1.05")
      .to("[data-intro]", { opacity: 1, y: 0, duration: 1, stagger: 0.1 }, "-=0.9");
  }

  tl.to(".site-header", { opacity: 1, y: 0, duration: 1 }, hasHero ? "-=1.0" : 0);
}

/* ── Interactions ─────────────────────────────────────────── */

/**
 * Cursor-tracked 3D tilt. Attribute-driven rather than class-driven, so any
 * card picks it up by adding `data-tilt` (works and journal both do).
 * Skipped on touch and under reduced motion.
 */
function bindTilt() {
  if (prefersReduced) return;

  document.querySelectorAll("[data-tilt]").forEach((card) => {
    const glow = card.querySelector("[data-tilt-glow]");
    if (!glow) return;

    // `data-tilt="2"` overrides the maximum angle. Wide, short elements need a
    // much smaller one than cards, or the perspective skews them badly.
    const maxTilt = Number(card.dataset.tilt) || 9;

    const setRotX = gsap.quickTo(card, "rotationX", { duration: 0.6, ease: "power3.out" });
    const setRotY = gsap.quickTo(card, "rotationY", { duration: 0.6, ease: "power3.out" });
    const setGlowX = gsap.quickTo(glow, "x", { duration: 0.7, ease: "power3.out" });
    const setGlowY = gsap.quickTo(glow, "y", { duration: 0.7, ease: "power3.out" });

    gsap.set(card, { transformPerspective: 900 });

    card.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = card.getBoundingClientRect();
      setRotY(((e.clientX - r.left) / r.width - 0.5) * maxTilt);
      setRotX((0.5 - (e.clientY - r.top) / r.height) * maxTilt);
      setGlowX(e.clientX - r.left);
      setGlowY(e.clientY - r.top);
    });

    card.addEventListener("pointerleave", () => {
      setRotX(0);
      setRotY(0);
    });
  });
}

/** Category filtering on the works index. Purely visual — all cards ship in the HTML. */
function bindFilters() {
  const bar = document.querySelector("[data-filters]");
  if (!bar) return;

  const buttons = [...bar.querySelectorAll(".filter")];
  // Only work cards carry a category; journal cards are never filtered.
  const cards = [...document.querySelectorAll(".card[data-category]")];

  const grid = cards[0]?.parentElement;

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter");
    if (!btn) return;

    const key = btn.dataset.filter;
    buttons.forEach((b) => b.classList.toggle("is-active", b === btn));

    let shown = 0;
    cards.forEach((card) => {
      const show = key === "all" || card.dataset.category === key;
      card.hidden = !show;
      if (show) shown++;
    });

    // Keep the grid's width cap in step with what's actually visible, or
    // filtering down to one result stretches it across the viewport.
    grid?.style.setProperty("--card-count", String(shown));

    ScrollTrigger.refresh();
  });
}

function startClock() {
  const el = document.getElementById("clock");
  clearInterval(clockTimer);
  if (!el) return;

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
  });

  const paint = () => {
    el.textContent = `${fmt.format(new Date())} TPE`;
  };

  paint();
  clockTimer = setInterval(paint, 30_000);
}

function bindAnchors() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    const href = link.getAttribute("href");

    link.addEventListener("click", (e) => {
      if (href === "#top") {
        e.preventDefault();
        if (lenis) lenis.scrollTo(0, { duration: 1.4 });
        else window.scrollTo({ top: 0 });
        return;
      }

      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();

      if (lenis) lenis.scrollTo(target, { duration: 1.4 });
      else target.scrollIntoView({ block: "start" });
    });
  });
}

/* ── Page lifecycle ───────────────────────────────────────── */

function teardownPage() {
  ScrollTrigger.getAll().forEach((t) => t.kill());
  clearInterval(clockTimer);
}

/** Guards against a late scene load binding triggers to a page we've left. */
let pageToken = 0;

function setupPage() {
  const token = ++pageToken;
  const main = document.getElementById("main");

  bindReveals();
  bindParallax();
  bindAnchors();
  bindTilt();
  bindFilters();
  startClock();

  ScrollTrigger.refresh();

  // Pages name their scene; anything that does not gets the particle field,
  // so a page can be moved over one at a time.
  const shown = showScene(main?.dataset.element ?? "particles");
  if (!bootPromise) bootPromise = shown;

  // The scene loads asynchronously, so its triggers are bound whenever it
  // lands — unless the visitor has already navigated on.
  shown.then((result) => {
    if (token !== pageToken || !result) return;
    bindScene(main, result.field, result.changed);
    ScrollTrigger.refresh();
  });
}

document.addEventListener("astro:page-load", () => {
  const isFirst = firstLoad;
  firstLoad = false;

  if (isFirst) primeIntro();

  startOnce();
  applyBodyState();

  // A new document means a new scroll extent; Lenis has to be told.
  if (lenis && !isFirst) {
    lenis.scrollTo(0, { immediate: true });
    lenis.resize();
  }

  setupPage();

  if (isFirst) {
    runLoader({ reduced: prefersReduced, waitFor: [bootPromise ?? startDirector()] }).then(() => {
      // Marks the session as booted; CSS uses this to keep the loader markup
      // hidden on every subsequent page.
      document.documentElement.dataset.visited = "";
      playIntro();
      ScrollTrigger.refresh();
    });
  }
});

document.addEventListener("astro:before-swap", (event) => {
  teardownPage();

  // The loader is first-visit only. Strip it from the incoming document so it
  // never enters the DOM — ClientRouter replaces <html>'s attributes too, so
  // the CSS guard alone can't be relied on after the first navigation.
  event.newDocument.getElementById("loader")?.remove();
});

// Runs after the swap but before paint, so the CSS guard stays armed.
document.addEventListener("astro:after-swap", () => {
  if (!firstLoad) document.documentElement.dataset.visited = "";
});
