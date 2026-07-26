import "./styles/main.css";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import ParticleField from "./scene/ParticleField.js";
import { initScroll, revealCards } from "./anim/scroll.js";
import { runLoader } from "./ui/loader.js";
import { renderWorks } from "./ui/works.js";
import { initContact } from "./ui/contact.js";

/* ── Capability checks ────────────────────────────────────── */

const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function supportsWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Particle count tier, chosen from what the device tells us about itself. */
function pickQuality() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const coarse = window.matchMedia("(pointer: coarse)").matches;

  if (coarse || cores <= 4 || memory <= 4) return "low";
  if (cores <= 8 || memory <= 8) return "medium";
  return "high";
}

/* ── Bits of chrome ───────────────────────────────────────── */

function startClock() {
  const el = document.getElementById("clock");
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
  setInterval(paint, 30_000);
}

/* ── Boot ─────────────────────────────────────────────────── */

function boot() {
  document.body.classList.toggle("reduced-motion", prefersReduced);

  startClock();

  // Cards must exist before ScrollTrigger measures the page.
  const cards = renderWorks({ interactive: !prefersReduced });
  initContact();

  let field = null;
  const useWebGL = supportsWebGL() && !prefersReduced;

  if (useWebGL) {
    try {
      field = new ParticleField(document.getElementById("webgl"), {
        quality: pickQuality(),
      });
      document.body.classList.add("webgl-ready");
    } catch (err) {
      console.warn("WebGL init failed, falling back to gradient.", err);
      field = null;
    }
  }

  if (!field) {
    document.body.classList.add("webgl-fallback");
    document.getElementById("webgl")?.remove();
  }

  const { playIntro } = initScroll({ field, reduced: prefersReduced });
  revealCards(cards, prefersReduced);

  if (field) {
    let hidden = false;

    gsap.ticker.add((_time, deltaMS) => {
      if (hidden) return;
      // Clamp so a backgrounded tab doesn't jump the animation on return.
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

  ScrollTrigger.refresh();

  runLoader({ reduced: prefersReduced }).then(() => {
    playIntro();
    ScrollTrigger.refresh();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
