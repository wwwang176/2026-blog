/**
 * `CW.` as a signed distance function, in GLSL.
 *
 * Held here because more than one renderer needs the same letterform and they
 * must not be allowed to drift apart. Nothing is loaded: the C is an arc, the
 * W is four capsules, the period is a circle.
 *
 * The liquid does not use this. It needs the centrelines rather than the
 * distance, which is a different derivation of the same numbers — see
 * monogram-centreline.js.
 */
export const MONOGRAM_SDF = /* glsl */ `
  // Distance to a circular arc of radius ra and half-thickness rb, where sc
  // is (sin, cos) of the arc's half-angle measured from +y.
  float sdArc(vec2 p, vec2 sc, float ra, float rb) {
    p.x = abs(p.x);
    return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra)) - rb;
  }

  float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }

  float sdC(vec2 p) {
    // The gap faces +x; the arc formula is symmetric about +y, so rotate the
    // sample instead of the shape.
    vec2 q = vec2(p.y, -p.x);
    // 256 degrees of arc, so a half-angle of 128.
    return sdArc(q, vec2(0.78801, -0.61566), 0.77, 0.23);
  }

  /**
   * Smooth min and max, for renderers that want the letterform's joins
   * rounded rather than mitred.
   *
   * Offsetting a distance field outward — the "- r" every rounded extrusion
   * ends with — rounds convex corners and does nothing at all to concave
   * ones. The W is mostly concave: the two valleys and the middle apex are
   * where its strokes meet from the inside, and no amount of offset touches
   * them. Rounding those needs the union itself to be smooth.
   */
  float sminK(float a, float b, float k) {
    k = max(k, 1e-4);
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  float smaxK(float a, float b, float k) {
    return -sminK(-a, -b, k);
  }

  /**
   * The W, with k of rounding at every join and at the cut.
   *
   * A k of zero is the mitred original to within a ten-thousandth, so this is
   * the only W and the sharp one is a call with nothing asked for. Two
   * renderers disagreeing about where the strokes run is the thing this file
   * exists to prevent, and a second copy of the coordinates would be exactly
   * that.
   */
  float sdWK(vec2 p, float k) {
    float d = sdCapsule(p, vec2(-1.02, 1.45), vec2(-0.54, -1.30), 0.23);
    d = sminK(d, sdCapsule(p, vec2(-0.54, -1.30), vec2(0.0, 0.58), 0.23), k);
    d = sminK(d, sdCapsule(p, vec2(0.0, 0.58), vec2(0.54, -1.30), 0.23), k);
    d = sminK(d, sdCapsule(p, vec2(0.54, -1.30), vec2(1.02, 1.45), 0.23), k);
    // The centreline runs past the cap line and below the baseline so the
    // terminals and valleys cut flat instead of square to the diagonals. The
    // cut is smoothed by the same k, which is what takes the chisel off the
    // four terminals.
    return smaxK(d, abs(p.y) - 1.0, k);
  }

  float sdW(vec2 p) {
    return sdWK(p, 0.0);
  }

  // Authored at C -2.3 / W 0.35 / period 2.02, spanning -3.3 to 2.25, so the
  // centring offset is +0.525. Subtracting it instead threw the whole mark a
  // letter-width to the left.
  /**
   * The outline only, with no depth — negative anywhere inside the letters.
   *
   * The letters are combined with a plain min whatever k is. They stand well
   * over a stroke apart, so a smooth union between them would never fire; the
   * rounding is a fact about how one letter's own strokes meet, not about how
   * the three sit together.
   */
  float sdOutlineK(vec2 q, float k) {
    float d = sdC(q - vec2(-1.775, 0.0));
    d = min(d, sdWK(q - vec2(0.875, 0.0), k));
    d = min(d, length(q - vec2(2.545, -0.77)) - 0.23);
    return d;
  }

  float sdOutline(vec2 q) {
    return sdOutlineK(q, 0.0);
  }

  float sdMonogram(vec3 p) {
    return max(sdOutline(p.xy), abs(p.z) - 0.22);
  }
`;

/**
 * How much of the frame the mark actually occupies, in local units.
 *
 * The outline itself is 5.55 by 2.0 — the C sits at -1.775 with an outer
 * radius of 1.0 and the period at 2.545 with a radius of 0.23, and the W is
 * cut flat at ±1.0. What each scene draws is wider than that: the sand's
 * strata, fluting and pockets move its surface by up to 0.23 and its body is
 * rounded by another 0.13, and the liquid's blend swells the union outward by
 * most of its own width. Sizing against the outline put the period off the
 * right edge on a 16:9 frame, so the number here is the drawn extent with
 * that relief in it.
 *
 * The sand's rounding has since gone from 0.10 to 0.13, which puts its widest
 * possible relief three hundredths past what this allows for. Left alone
 * rather than moved to 6.27: fitScale already holds the mark to 97% of the
 * frame, so there is a good deal more margin than that in hand, and the
 * number is shared — moving it to suit the sand would shrink the fire and the
 * water by a percent for a reason that has nothing to do with either.
 *
 * Here rather than in each scene for the reason the distance field is here —
 * three renderers sizing the same letterform must not disagree about how big
 * it is.
 */
export const MARK_EXTENT = { width: 6.2, height: 2.6 };

/**
 * Local units per world unit, so that the mark fills `fill` of the frame's
 * width without passing `cap` of its height.
 *
 * Derived rather than written down. The numbers it replaced were a pair of
 * constants with an `aspect < 1` branch, which held only at the shape of
 * window they were chosen at: on a tall phone they put the mark half a
 * letter wider than the frame, and the C lost its left edge.
 */
export function fitScale(aspect, camZ, tanHalfFov, { fill = 0.97, cap = 0.72 } = {}) {
  const height = camZ * tanHalfFov * 2;
  return Math.min(
    (height * aspect * fill) / MARK_EXTENT.width,
    (height * cap) / MARK_EXTENT.height
  );
}

/**
 * Value noise and fbm.
 *
 * Shared for the same reason: two renderers wanting the same grain want the
 * same generator, and a second copy is a second thing to keep in step.
 */
export const GLSL_NOISE = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(mix(hash13(i + vec3(0.0, 0.0, 0.0)), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * vnoise(p);
      p *= 2.06;
      a *= 0.5;
    }
    return v;
  }
`;

/** Slab intersection against an axis-aligned box. */
export const GLSL_BOX = /* glsl */ `
  bool boxHit(vec3 ro, vec3 rd, vec3 lo, vec3 hi, out float t0, out float t1) {
    vec3 inv = 1.0 / rd;
    vec3 a = (lo - ro) * inv;
    vec3 b = (hi - ro) * inv;
    vec3 mn = min(a, b);
    vec3 mx = max(a, b);
    t0 = max(max(mn.x, mn.y), mn.z);
    t1 = min(min(mx.x, mx.y), mx.z);
    return t1 > max(t0, 0.0);
  }
`;
