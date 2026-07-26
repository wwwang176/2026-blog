import gsap from "gsap";

const MIN_VISIBLE_MS = 900;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Counts up while fonts settle, then wipes away.
 * Resolves once the page is ready for the intro animation.
 *
 * @param {object}   opts
 * @param {boolean}  opts.reduced  Skip the loader entirely.
 * @param {Promise[]} opts.waitFor Extra work to finish before the wipe —
 *                                 the deferred three.js chunk, typically.
 */
export function runLoader({ reduced = false, waitFor = [] } = {}) {
  const loader = document.getElementById("loader");
  const fill = document.getElementById("loader-fill");
  const pct = document.getElementById("loader-pct");
  if (!loader) return Promise.resolve();

  const paint = (v) => {
    const n = Math.round(v);
    if (fill) fill.style.width = `${v}%`;
    if (pct) pct.textContent = String(n);
  };

  if (reduced) {
    loader.remove();
    return Promise.resolve();
  }

  const state = { v: 0 };

  // Creep toward 92% while we wait — the last 8% lands when assets are ready.
  gsap.to(state, {
    v: 92,
    duration: 1.2,
    ease: "power2.out",
    onUpdate: () => paint(state.v),
  });

  const ready = Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    wait(MIN_VISIBLE_MS),
    ...waitFor,
  ]);

  return ready.then(
    () =>
      new Promise((resolve) => {
        const tl = gsap.timeline({ onComplete: () => loader.remove() });

        tl.to(state, {
          v: 100,
          duration: 0.45,
          ease: "power2.inOut",
          onUpdate: () => paint(state.v),
        })
          .add(() => loader.classList.add("is-done"))
          .to(
            loader,
            {
              yPercent: -100,
              duration: 1.1,
              ease: "expo.inOut",
              // Hand off early so the hero animates in behind the wipe.
              onStart: () => gsap.delayedCall(0.35, resolve),
            },
            "+=0.15"
          );
      })
  );
}
