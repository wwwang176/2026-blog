/**
 * `CW.` as a swarm of fireballs rather than a solid letterform that is alight.
 *
 * There is no mesh here at all, which is the point. Every attempt at a lit
 * solid ran into the same wall — a neutral surface has no material identity
 * without environment reflection and occlusion behind it. A cloud of emissive
 * billboards has nothing to reflect and nothing to occlude: it is light, and
 * the letters are whatever shape the light is arranged into.
 *
 * Four things separate this from the first pass, which read as plastic blobs:
 *
 *   1. Each sprite carries animated fbm inside it, so a ball is turbulent
 *      rather than a smooth radial gradient.
 *   2. Displacement comes from a field keyed off the anchor, not the seed, so
 *      neighbouring balls move together and the mass forms tongues.
 *   3. The ramp reaches much deeper into red and near-black at the edges, so
 *      the fire has dark values instead of being uniformly bright.
 *   4. A separate smoke pass draws over the flame with normal blending —
 *      additive can only ever brighten, and fire without anything dark in it
 *      is the single most artificial part of a naive particle flame.
 */

const HASH = /* glsl */ `
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    return fract(p * (p + p));
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`;

const NOISE2 = /* glsl */ `
  float vnoise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
      f.y);
  }

  float fbm2(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise2(p);
      p *= 2.07;
      a *= 0.5;
    }
    return v;
  }
`;

/**
 * Black-body-ish ramp, weighted toward the bottom.
 *
 * The first version spent almost its whole range in orange and yellow, which
 * is why the swarm read as one flat sheet of brightness. Real flame is mostly
 * dim: deep red at the fringes, orange through the body, and only the hottest
 * cores anywhere near white.
 */
const RAMP = /* glsl */ `
  vec3 fireRamp(float t) {
    vec3 c = vec3(0.008, 0.001, 0.0);
    c = mix(c, vec3(0.35, 0.02, 0.004), smoothstep(0.0, 0.22, t));
    c = mix(c, vec3(0.85, 0.11, 0.012), smoothstep(0.18, 0.44, t));
    c = mix(c, vec3(1.0, 0.34, 0.035), smoothstep(0.42, 0.66, t));
    // Green is held down through the top of the ramp. ACES compresses a
    // saturated red channel hard, and whatever green is left rides up past it
    // — which is how stacked orange sprites end up looking olive.
    c = mix(c, vec3(1.0, 0.56, 0.10), smoothstep(0.66, 0.86, t));
    c = mix(c, vec3(1.0, 0.86, 0.62), smoothstep(0.90, 1.0, t));
    return c;
  }
`;

/**
 * Shared advection. Keyed off the anchor rather than the per-ball seed, so
 * balls that start near each other are pushed the same way and the swarm
 * climbs in coherent tongues. Seeded jitter alone just looks like static.
 */
const FLOW = /* glsl */ `
  vec3 flow(vec3 a, float t) {
    float x = sin(a.y * 2.1 + t * 1.5) * 0.6 + sin(a.x * 1.3 - t * 1.0) * 0.4;
    float z = cos(a.x * 1.9 + t * 1.3) * 0.6 + cos(a.y * 1.1 - t * 0.8) * 0.4;
    float y = sin(a.x * 1.6 + a.y * 1.2 + t * 1.9) * 0.35;
    return vec3(x, y, z);
  }
`;

/* ── Flame ─────────────────────────────────────────────────────── */

export const fireballVertex = /* glsl */ `
  ${HASH}
  ${FLOW}

  attribute vec3 aAnchor;
  attribute float aScale;
  attribute float aSeed;

  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uModelScale;
  uniform float uDisperse;
  uniform float uIntensity;

  varying float vLife;
  varying float vSeed;
  varying float vDepth;

  void main() {
    vec3 p = aAnchor * uModelScale;

    // Every ball runs the same loop out of phase, so the swarm churns instead
    // of pulsing in unison.
    float rate = 0.5 + hash11(aSeed) * 0.7;
    float life = fract(aSeed * 0.317 + uTime * rate);

    vec3 field = flow(aAnchor, uTime);

    // Rise and drift while alive. Kept small on purpose — the anchors carry
    // the letterform, so movement has to stay inside it or the word dissolves.
    p.y += life * (0.7 + hash11(aSeed + 3.1) * 0.85 + field.y * 0.3);
    p.x += field.x * 0.2 * life;
    p.z += field.z * 0.17 * life;

    // Dispersal is the only thing that breaks the letters, and it is scroll
    // driven rather than part of the idle loop.
    float d = uDisperse * uDisperse;
    p.y += d * (9.0 + hash11(aSeed + 7.7) * 8.0);
    p.x += (field.x + sin(aSeed * 2.3)) * d * 4.0;
    p.z += cos(aSeed * 1.7) * d * 4.0;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    vLife = life;
    vSeed = aSeed;

    // Swell fast, fade slow — a flame's silhouette is not symmetric in time.
    float swell = smoothstep(0.0, 0.16, life) * (1.0 - smoothstep(0.42, 1.0, life));

    gl_PointSize = uSize * aScale * swell * uIntensity * uPixelRatio / max(vDepth, 0.001);
    gl_Position = projectionMatrix * mv;
  }
`;

export const fireballFragment = /* glsl */ `
  precision highp float;

  ${HASH}
  ${NOISE2}
  ${RAMP}

  uniform float uTime;
  uniform float uOpacity;

  varying float vLife;
  varying float vSeed;
  varying float vDepth;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    // The interior of a single ball, churning upward. Without this every
    // sprite is a smooth radial gradient, and ten thousand smooth radial
    // gradients read as bokeh no matter what colour they are.
    vec2 q = uv * 3.6 + vec2(vSeed * 7.3, vSeed * 3.1 - uTime * 2.4);
    float n = fbm2(q);

    // Flames narrow as they climb, and the same noise eats the silhouette so
    // the outline is ragged rather than circular.
    float stretch = 1.0 - max(uv.y, 0.0) * 0.5;
    float radius = 0.5 * stretch - n * 0.17;
    if (d > radius) discard;

    float core = smoothstep(radius, radius * 0.12, d);

    // Hot when young, hotter at the centre, and modulated by the churn. The
    // gradient across one ball is most of what makes it read as flame.
    float heat = (1.0 - vLife * 0.88) * 0.5 + core * 0.42 + (n - 0.5) * 0.3;
    vec3 col = fireRamp(clamp(heat, 0.0, 1.0));

    // Kept low deliberately. Additive stacking saturates the red channel
    // first, and once it clips the green keeps climbing — which is why dense
    // cores drifted yellow-green. Fewer balls reaching saturation keeps the
    // hue where the ramp put it.
    float alpha = core * (1.0 - smoothstep(0.45, 1.0, vLife)) * (0.22 + n * 0.42);
    float depthFade = smoothstep(46.0, 6.0, vDepth);

    gl_FragColor = vec4(col, alpha * uOpacity * depthFade);
  }
`;

/* ── Smoke ─────────────────────────────────────────────────────── */

export const smokeVertex = /* glsl */ `
  ${HASH}
  ${FLOW}

  attribute vec3 aAnchor;
  attribute float aScale;
  attribute float aSeed;

  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uModelScale;
  uniform float uDisperse;

  varying float vLife;
  varying float vSeed;
  varying float vDepth;

  void main() {
    vec3 p = aAnchor * uModelScale;

    // Deliberately out of step with the flame: smoke is what a ball leaves
    // behind, so it starts late in the cycle and outlives it.
    float rate = 0.30 + hash11(aSeed + 11.3) * 0.3;
    float life = fract(aSeed * 0.219 + uTime * rate);

    vec3 field = flow(aAnchor, uTime * 0.7);

    // Climbs much further than the flame and keeps accelerating.
    p.y += life * life * (4.2 + hash11(aSeed + 5.5) * 3.4);
    p.x += field.x * 0.75 * life;
    p.z += field.z * 0.6 * life;

    float d = uDisperse * uDisperse;
    p.y += d * (11.0 + hash11(aSeed + 2.2) * 9.0);
    p.x += field.x * d * 5.0;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    vLife = life;
    vSeed = aSeed;

    // Smoke expands as it cools — the one thing that reads as volume.
    gl_PointSize = uSize * aScale * (0.45 + life * 1.5) * uPixelRatio / max(vDepth, 0.001);
    gl_Position = projectionMatrix * mv;
  }
`;

export const smokeFragment = /* glsl */ `
  precision highp float;

  ${HASH}
  ${NOISE2}

  uniform float uTime;
  uniform float uOpacity;

  varying float vLife;
  varying float vSeed;
  varying float vDepth;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    vec2 q = uv * 2.8 + vec2(vSeed * 4.1, vSeed * 9.7 - uTime * 0.55);
    float n = fbm2(q);

    float radius = 0.5 - n * 0.2;
    if (d > radius) discard;

    float body = smoothstep(radius, radius * 0.05, d) * (0.35 + n * 0.8);

    // Warm near the flame where it is still lit from beneath, going cold and
    // grey as it climbs.
    vec3 col = mix(vec3(0.16, 0.09, 0.06), vec3(0.055, 0.055, 0.062), smoothstep(0.1, 0.7, vLife));

    // Faint on purpose. Its whole job is to cut dark holes in the fire — push
    // it any further and the monogram turns to mud.
    float alpha = body
      * smoothstep(0.0, 0.22, vLife)
      * (1.0 - smoothstep(0.45, 1.0, vLife))
      * 0.5;

    float depthFade = smoothstep(50.0, 6.0, vDepth);

    gl_FragColor = vec4(col, alpha * uOpacity * depthFade);
  }
`;
