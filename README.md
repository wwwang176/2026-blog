# Cheng Wei, Wang — Landing Page

Single-page personal site. Dark palette, a scroll-driven three.js particle field,
GSAP parallax and Lenis smooth scrolling.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/
npm run preview  # serve the production build
```

## How the 3D works

One full-screen WebGL canvas sits behind the page. The particle field holds four
target shapes as separate geometry attributes:

| Section | Shape |
|---|---|
| Hero | Fibonacci sphere |
| Brief | loose nebula |
| Works | even lattice |
| Contact | tilted wave plane |

`src/anim/scroll.js` maps each section's centre to an integer stage and scrubs a
single `uProgress` uniform (0 → 3) between them. The vertex shader does all the
interpolation, so morphing costs the CPU nothing regardless of particle count.

Particle count adapts to the device (`pickQuality()` in `src/main.js`):
72² on low-end, 108² mid, 156² on desktop.

## Editing content

**Works** — `src/data/works.js` is the only file to touch. Add one object per
project; the grid adapts to any number of entries. Drop thumbnails in `public/`
and reference them as `/filename.jpg`. Remove `placeholder: true` once a slot has
real content (it only drives the small accent dot).

**Copy** — all prose lives in `index.html`.

**Colours / type** — the custom properties at the top of `src/styles/main.css`.
The particle colours are separate, in the `uColorA` / `uColorB` uniforms in
`src/scene/ParticleField.js`.

**Contact form** — submission currently opens the visitor's mail client.
Everything outward-facing is inside `deliver()` in `src/ui/contact.js`; to move
to Formspree, Web3Forms or your own API, replace that one function.

## Graceful degradation

- No WebGL, or `prefers-reduced-motion: reduce` → the canvas is removed and a
  static CSS gradient takes over.
- Reduced motion also disables Lenis, all scrub animations and the card tilt;
  everything renders in its final state.
- Rendering pauses when the tab is hidden.

## Structure

```
index.html              markup and copy
src/
  main.js               boot, capability checks, render loop
  scene/
    ParticleField.js    three.js setup, the four shapes
    shaders.js          GLSL (simplex noise + morph)
  anim/scroll.js        Lenis, ScrollTrigger, reveals, parallax
  ui/
    loader.js           intro loader
    works.js            builds the works grid, cursor tilt
    contact.js          validation and submission
  data/works.js         ← project content
  styles/main.css
```
