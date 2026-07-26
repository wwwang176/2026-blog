import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);

/**
 * Wires smooth scrolling, scroll-linked reveals and the particle field's
 * morph progress.
 *
 * @param {object}  opts
 * @param {object=} opts.field    ParticleField instance (optional).
 * @param {boolean} opts.reduced  True when motion should be minimised.
 * @returns {{ playIntro: () => void, lenis: Lenis|null }}
 */
export function initScroll({ field = null, reduced = false } = {}) {
  const lenis = reduced ? null : new Lenis({ lerp: 0.09, wheelMultiplier: 1 });

  if (lenis) {
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  primeIntro(reduced);
  bindAnchors(lenis);
  bindParticleProgress(field);
  bindReveals(reduced);
  bindParallax(reduced);

  return { lenis, playIntro: () => playIntro(reduced) };
}

/* ── In-page navigation ───────────────────────────────────── */

function bindAnchors(lenis) {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      e.preventDefault();

      if (lenis) lenis.scrollTo(target, { offset: 0, duration: 1.4 });
      else target.scrollIntoView({ behavior: "auto", block: "start" });
    });
  });
}

/* ── Particle morph ───────────────────────────────────────── */

/**
 * Each section centre is an integer stage (hero 0 → contact 3); scrubbing
 * between two centres drives the shader's single `uProgress` uniform.
 */
function bindParticleProgress(field) {
  if (!field) return;

  const sections = [...document.querySelectorAll("[data-stage]")].sort(
    (a, b) => Number(a.dataset.stage) - Number(b.dataset.stage)
  );

  sections.forEach((section, i) => {
    const next = sections[i + 1];
    if (!next) return;

    ScrollTrigger.create({
      trigger: section,
      start: "center center",
      endTrigger: next,
      end: "center center",
      scrub: true,
      onUpdate: (self) => field.setProgress(i + self.progress),
    });
  });

  // Fade the field back a touch behind dense text so copy stays readable.
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
}

/* ── Reveals ──────────────────────────────────────────────── */

function bindReveals(reduced) {
  if (reduced) {
    gsap.set("[data-fade], [data-reveal], [data-stagger] > *", {
      clearProps: "all",
      opacity: 1,
      y: 0,
    });
    return;
  }

  // Opacity only — these elements also carry a scrubbed y-parallax, and two
  // tweens on the same property would overwrite one another.
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
}

/** Called after the works grid is populated, since cards are built at runtime. */
export function revealCards(cards, reduced) {
  if (reduced || !cards.length) return;

  gsap.from(cards, {
    opacity: 0,
    y: 60,
    duration: 1.1,
    ease: "power3.out",
    stagger: 0.09,
    scrollTrigger: { trigger: cards[0].parentElement, start: "top 82%", once: true },
  });
}

/* ── Parallax ─────────────────────────────────────────────── */

function bindParallax(reduced) {
  if (reduced) return;

  // Hero headline drifts and dissolves as you leave it.
  //
  // This targets the wrapper, not `.line__inner` — the intro timeline owns the
  // inner element's yPercent, and two tweens on one property fight each other.
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

  // Section labels drift against the scroll direction.
  gsap.utils.toArray(".section__label").forEach((label) => {
    gsap.fromTo(
      label,
      { y: 40 },
      {
        y: -40,
        ease: "none",
        scrollTrigger: {
          trigger: label.closest(".section"),
          start: "top bottom",
          end: "bottom top",
          scrub: 0.8,
        },
      }
    );
  });

  // Big display headings get a slower, heavier drift. The parallax is applied
  // to the heading's wrapper so the heading's own reveal tween stays untouched.
  gsap.utils.toArray(".parallax-slow").forEach((wrap) => {
    gsap.fromTo(
      wrap,
      { y: 60 },
      {
        y: -60,
        ease: "none",
        scrollTrigger: {
          trigger: wrap.closest(".section"),
          start: "top bottom",
          end: "bottom top",
          scrub: 1,
        },
      }
    );
  });
}

/* ── Intro ────────────────────────────────────────────────── */

/**
 * Set the hero's pre-intro state immediately, so nothing flashes into place
 * between the loader wipe and the intro timeline.
 */
function primeIntro(reduced) {
  if (reduced) return;

  gsap.set(".hero__title .line__inner", { yPercent: 115 });
  gsap.set(".hero__meta > *, [data-intro]", { opacity: 0, y: 16 });
  gsap.set(".site-header", { opacity: 0, y: -16 });
}

function playIntro(reduced) {
  if (reduced) return null;

  const tl = gsap.timeline({ defaults: { ease: "expo.out" } });

  tl.to(".hero__title .line__inner", {
    yPercent: 0,
    duration: 1.4,
    stagger: 0.12,
  })
    .to(".hero__meta > *", { opacity: 1, y: 0, duration: 1, stagger: 0.08 }, "-=1.05")
    .to("[data-intro]", { opacity: 1, y: 0, duration: 1, stagger: 0.1 }, "-=0.9")
    .to(".site-header", { opacity: 1, y: 0, duration: 1 }, "-=1.0");

  return tl;
}
