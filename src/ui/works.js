import gsap from "gsap";

import { works } from "../data/works.js";

const pad = (n) => String(n + 1).padStart(2, "0");

function buildCard(item, index) {
  const linked = Boolean(item.href);
  const el = document.createElement(linked ? "a" : "article");

  el.className = "work-card";
  if (linked) {
    el.href = item.href;
    el.rel = "noopener noreferrer";
    if (/^https?:/i.test(item.href)) el.target = "_blank";
  }
  if (item.placeholder) el.dataset.placeholder = "true";

  const thumb = item.image
    ? `<img class="work-card__thumb" src="${item.image}" alt="" loading="lazy" decoding="async" />`
    : "";

  el.innerHTML = `
    <span class="work-card__glow" aria-hidden="true"></span>
    <span class="work-card__index mono">(${pad(index)}) — ${item.category}</span>
    ${thumb}
    <div class="work-card__body">
      <h3 class="work-card__title">${item.title}</h3>
      <p class="work-card__desc">${item.description}</p>
      <span class="work-card__cta mono">
        ${linked ? "View project" : item.year || "Coming soon"}
        ${linked ? '<span class="arrow" aria-hidden="true">↗</span>' : ""}
      </span>
    </div>
  `;

  return el;
}

/** Cursor-tracked 3D tilt. Skipped on touch and under reduced motion. */
function attachTilt(card, enabled) {
  if (!enabled) return;

  const glow = card.querySelector(".work-card__glow");
  const setRotX = gsap.quickTo(card, "rotationX", { duration: 0.6, ease: "power3.out" });
  const setRotY = gsap.quickTo(card, "rotationY", { duration: 0.6, ease: "power3.out" });
  const setGlowX = gsap.quickTo(glow, "x", { duration: 0.7, ease: "power3.out" });
  const setGlowY = gsap.quickTo(glow, "y", { duration: 0.7, ease: "power3.out" });

  gsap.set(card, { transformPerspective: 900 });

  card.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;

    setRotY((px - 0.5) * 9);
    setRotX((0.5 - py) * 9);
    setGlowX(e.clientX - r.left);
    setGlowY(e.clientY - r.top);
  });

  card.addEventListener("pointerleave", () => {
    setRotX(0);
    setRotY(0);
  });
}

export function renderWorks({ interactive = true } = {}) {
  const grid = document.getElementById("works-grid");
  if (!grid) return [];

  const frag = document.createDocumentFragment();
  const cards = works.map((item, i) => {
    const card = buildCard(item, i);
    frag.appendChild(card);
    return card;
  });

  grid.appendChild(frag);
  cards.forEach((card) => attachTilt(card, interactive));

  return cards;
}
