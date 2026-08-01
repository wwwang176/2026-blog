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

  float sdW(vec2 p) {
    float d = sdCapsule(p, vec2(-1.02, 1.45), vec2(-0.54, -1.30), 0.23);
    d = min(d, sdCapsule(p, vec2(-0.54, -1.30), vec2(0.0, 0.58), 0.23));
    d = min(d, sdCapsule(p, vec2(0.0, 0.58), vec2(0.54, -1.30), 0.23));
    d = min(d, sdCapsule(p, vec2(0.54, -1.30), vec2(1.02, 1.45), 0.23));
    // The centreline runs past the cap line and below the baseline so the
    // terminals and valleys cut flat instead of square to the diagonals.
    return max(d, abs(p.y) - 1.0);
  }

  // Authored at C -2.3 / W 0.35 / period 2.02, spanning -3.3 to 2.25, so the
  // centring offset is +0.525. Subtracting it instead threw the whole mark a
  // letter-width to the left.
  /** The outline only, with no depth — negative anywhere inside the letters. */
  float sdOutline(vec2 q) {
    float d = sdC(q - vec2(-1.775, 0.0));
    d = min(d, sdW(q - vec2(0.875, 0.0)));
    d = min(d, length(q - vec2(2.545, -0.77)) - 0.23);
    return d;
  }

  float sdMonogram(vec3 p) {
    return max(sdOutline(p.xy), abs(p.z) - 0.22);
  }
`;

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
