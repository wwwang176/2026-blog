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

let field = null;
let lenis = null;
let started = false;
let firstLoad = true;
let clockTimer = null;
let scenePromise = null;
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
  cl.toggle("reduced-motion", prefersReduced);
  cl.toggle("webgl-ready", Boolean(field));
  // Only fall back once the scene has actually settled — the three.js chunk
  // loads asynchronously, so an absent field early on isn't a failure.
  cl.toggle("webgl-fallback", sceneSettled && !field);
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
 * blocking first paint. The canvas is left in the DOM either way; CSS keeps it
 * at opacity 0 until `webgl-ready` is set.
 */
function startScene() {
  if (scenePromise) return scenePromise;

  const canvas = document.getElementById("webgl");

  if (!canvas || prefersReduced || !supportsWebGL()) {
    sceneSettled = true;
    scenePromise = Promise.resolve(null);
    return scenePromise;
  }

  scenePromise = import("../scene/ParticleField.js")
    .then(({ default: ParticleField }) => {
      field = new ParticleField(canvas, { quality: pickQuality() });
      attachSceneListeners();
      return field;
    })
    .catch((err) => {
      console.warn("Particle field unavailable, falling back to gradient.", err);
      field = null;
      return null;
    })
    .finally(() => {
      sceneSettled = true;
      applyBodyState();
    });

  return scenePromise;
}

function attachSceneListeners() {
  let hidden = false;

  gsap.ticker.add((_time, deltaMS) => {
    if (hidden) return;
    field.tick(Math.min(deltaMS, 50) / 1000);
  });

  document.addEventListener("visibilitychange", () => {
    hidden = document.hidden;
  });

  window.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    field.setPointer(
      (e.clientX / window.innerWidth) * 2 - 1,
      -((e.clientY / window.innerHeight) * 2 - 1)
    );
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    field.resize();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => ScrollTrigger.refresh(), 200);
  });
}

/* ── Particle field ───────────────────────────────────────── */

/**
 * Pages declare what the field should do via `data-scene` on <main>:
 *   scroll  — sections drive uProgress (the landing page)
 *   static  — hold one stage, set by `data-scene-stage`
 */
function bindScene(main) {
  if (!field || !main) return;

  if (main.dataset.scene === "scroll") {
    // `data-stage` is the progress value the field holds at that section's
    // centre, not just a sort key. It used to be the latter and the progress
    // came from the array index, which meant a section could only be inserted
    // at the cost of renumbering every scene's stage constants — so the
    // journal simply had no stage at all, and the works-to-contact ramp ran
    // blind across two sections of scrolling.
    const sections = [...main.querySelectorAll("[data-stage]")]
      .map((el) => ({ el, stage: Number(el.dataset.stage) }))
      .sort((a, b) => a.stage - b.stage);

    sections.forEach(({ el, stage }, i) => {
      const next = sections[i + 1];
      if (!next) return;

      const span = next.stage - stage;

      ScrollTrigger.create({
        trigger: el,
        start: "center center",
        endTrigger: next.el,
        end: "center center",
        scrub: true,
        onUpdate: (self) => field.setProgress(stage + self.progress * span),
      });
    });

    const contact = document.getElementById("contact");
    if (contact) {
      ScrollTrigger.create({
        trigger: contact,
        start: "top 70%",
        end: "top 20%",
        scrub: true,
        onUpdate: (self) => field.setOpacity(1 - self.progress * 0.45),
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
  const from = { value: field.progress };

  field.setOpacity(0.8);
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

  // The field loads asynchronously, so its triggers are bound whenever it
  // lands — unless the visitor has already navigated on.
  startScene().then(() => {
    if (token !== pageToken) return;
    bindScene(main);
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
    runLoader({ reduced: prefersReduced, waitFor: [startScene()] }).then(() => {
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
