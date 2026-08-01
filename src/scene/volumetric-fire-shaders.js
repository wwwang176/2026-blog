/**
 * `CW.` as a raymarched volume.
 *
 * The sprite version had reached the end of what it could do. Every further
 * change was a colour ramp, a speed or a falloff curve — parameter search on
 * one technique, not a change of technique. Billboards cannot self-occlude,
 * so near flame never hides far flame, and the structure is always a sum of
 * discrete blobs rather than something continuous.
 *
 * This marches a ray through a density field instead, accumulating emission
 * and absorption front to back. That single change buys the two things that
 * were missing and could not be tuned in: depth, because material in front
 * genuinely obscures material behind it, and continuity, because the field is
 * evaluated everywhere rather than sampled at a few thousand points.
 *
 * Nothing is loaded. The letterform is an analytic 2D signed distance
 * function — the C is an arc, the W is four capsules, the period is a circle
 * — extruded along z. It happens to describe the same shapes the mesh version
 * built, but nothing is shared: no geometry, no texture, no volume bake.
 */

const NOISE = /* glsl */ `
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
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p *= 2.06;
      a *= 0.5;
    }
    return v;
  }
`;

/**
 * Black-body-ish ramp, weighted low. Real flame is mostly dim — deep red at
 * the fringes, orange through the body, and only the hottest cores near white.
 * Green is held down through the top because a saturated red channel plus
 * tone mapping lets whatever green remains ride up past it.
 */
const RAMP = /* glsl */ `
  vec3 fireRamp(float t) {
    vec3 c = vec3(0.010, 0.001, 0.0);
    c = mix(c, vec3(0.40, 0.022, 0.004), smoothstep(0.00, 0.24, t));
    c = mix(c, vec3(0.92, 0.115, 0.012), smoothstep(0.20, 0.46, t));
    c = mix(c, vec3(1.00, 0.340, 0.035), smoothstep(0.44, 0.68, t));
    c = mix(c, vec3(1.00, 0.560, 0.100), smoothstep(0.68, 0.88, t));
    c = mix(c, vec3(1.00, 0.840, 0.560), smoothstep(0.92, 1.00, t));
    return c;
  }
`;

/** The monogram, as distance fields. Positions are already centred. */
const SHAPE = /* glsl */ `
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
  float sdMonogram(vec3 p) {
    vec2 q = p.xy;
    float d = sdC(q - vec2(-1.775, 0.0));
    d = min(d, sdW(q - vec2(0.875, 0.0)));
    d = min(d, length(q - vec2(2.545, -0.77)) - 0.23);
    return max(d, abs(p.z) - 0.22);
  }
`;

export const volumeVertex = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const volumeFragment = /* glsl */ `
  precision highp float;

  ${NOISE}
  ${RAMP}
  ${SHAPE}

  uniform float uTime;
  uniform float uAspect;
  uniform float uTanHalfFov;
  uniform float uCamZ;
  uniform float uScale;
  uniform vec2 uRot;
  uniform float uDisperse;
  uniform float uOpacity;
  uniform int uSteps;

  varying vec2 vUv;

  /** Density and the turbulence that produced it, so temperature can reuse it. */
  vec2 fieldAt(vec3 p) {
    // Advected downward through a stationary shape, which is what makes the
    // structure appear to rise out of the letterform rather than slide across
    // it. Two octave sets at different rates keeps the motion from looking
    // like a single scrolling texture.
    float n1 = fbm(p * 1.45 + vec3(0.0, -uTime * 1.25, uTime * 0.1));
    float n2 = fbm(p * 3.30 + vec3(0.0, -uTime * 2.05, 0.0));
    float turb = n1 * 0.7 + n2 * 0.3;

    float d = sdMonogram(p);

    // How far the flame may stray from the surface, opening up with height.
    // A constant here coats the letters evenly; the widening is the plume.
    float room = 0.14 + smoothstep(-1.1, 2.1, p.y) * 0.75;
    float shaped = d - (turb - 0.40) * room;

    // Deliberately thin, and modulated by the same turbulence that shaped it.
    // Saturating the interior was what turned the letters into solid slabs of
    // gradient — the noise was there the whole time and nothing could be seen
    // of it because every sample inside the shape was already fully opaque.
    float dens = smoothstep(0.26, 0.0, shaped) * (0.18 + turb * 0.75);

    // Taper, so the column thins out instead of ending on a flat ceiling.
    dens *= 1.0 - smoothstep(0.4, 2.3, p.y);

    return vec2(max(dens, 0.0), turb);
  }

  /** Slab intersection against the bounding box the volume lives in. */
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

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;

    vec3 ro = vec3(0.0, 0.0, uCamZ);
    vec3 rd = normalize(vec3(ndc.x * uAspect * uTanHalfFov, ndc.y * uTanHalfFov, -1.0));

    // The camera stays put and the field is rotated under it — in a raymarcher
    // it is always the cheaper way round.
    float cy = uRot.y;
    mat2 ry = mat2(cos(cy), -sin(cy), sin(cy), cos(cy));

    // The field is authored in local units and sampled at world/uScale, so the
    // bounding box has to be scaled to match or the volume is clipped.
    float lift = uDisperse * uDisperse * 3.4;
    vec3 lo = vec3(-4.3, -2.0, -1.4) * uScale;
    vec3 hi = vec3( 4.3, (2.9 + lift), 1.4) * uScale;

    float t0, t1;
    if (!boxHit(ro, rd, lo, hi, t0, t1)) discard;
    t0 = max(t0, 0.0);

    // Step length inside the volume, in local units. Sized against the field's
    // detail rather than against the box, so the sampling rate does not change
    // with viewing angle.
    float ds = 0.075;
    float dt = ds * uScale;

    // The furthest the noise can push the surface outward. Anything beyond
    // this is guaranteed empty, which is what makes skipping safe.
    float reach = 0.95;

    vec3 col = vec3(0.0);
    float trans = 1.0;

    // Dither the entry point. Without it the fixed step lands on the same
    // surfaces every frame and the volume bands into visible shells.
    float t = t0 + hash13(vec3(gl_FragCoord.xy, uTime)) * dt;

    for (int i = 0; i < 128; i++) {
      if (i >= uSteps) break;
      if (t > t1) break;
      if (trans < 0.02) break;

      vec3 world = ro + rd * t;

      // Into the volume's own space: scaled, rotated, and dragged upward as
      // the whole plume lets go on scroll.
      vec3 p = world / uScale;
      p.y -= uDisperse * uDisperse * 3.4;
      p.xz = ry * p.xz;
      p.x += uRot.x * p.y * 0.06;

      // Marching the whole box at a fixed rate meant evaluating two fbm at
      // every sample, most of them in empty air. The distance field is cheap
      // by comparison, so it is used first to jump the gaps — this is the
      // difference between an unusable frame rate and a workable one.
      float sd = sdMonogram(p);
      if (sd > reach) {
        t += max((sd - reach) * uScale, dt);
        continue;
      }

      vec2 f = fieldAt(p);
      float dens = f.x;

      t += dt;
      if (dens <= 0.003) continue;

      // Cools with height, and the hottest material is also the densest —
      // the vertical gradient is what reads as fire rather than as glow.
      // Held below the top of the ramp: at 0.86 plus the density term the
      // whole base pinned to white and the letters looked dipped in cream.
      float cool = smoothstep(-1.15, 1.7, p.y);
      float temp = clamp((1.0 - cool) * 0.62 + dens * 0.2 + (f.y - 0.42) * 0.3, 0.0, 1.0);

      vec3 emission = fireRamp(temp) * dens * 7.0;

      // Beer-Lambert over the step, in local units. ds is already the local
      // step length, so no conversion is needed here.
      float absorb = 1.0 - exp(-dens * 1.5 * ds);

      col += trans * emission * ds;
      trans *= 1.0 - absorb;
    }

    float alpha = (1.0 - trans) * uOpacity;
    if (alpha < 0.004) discard;

    gl_FragColor = vec4(col * uOpacity, alpha);
  }
`;
