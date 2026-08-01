/**
 * `CW.` as liquid in free fall.
 *
 * The fire and this share a subject and nothing else. Fire is a volume: no
 * surface anywhere, a fixed stride through a density field, emission summed
 * front to back. Water has a surface and no light of its own, so the whole
 * shading model inverts — sphere trace to the boundary, then read what the
 * boundary reflects and refracts. That inversion is deliberate. A blue plume
 * would have been the fire with the ramp swapped, and it would have looked it.
 *
 * There is no gravity term anywhere in here, which is the other half of the
 * separation. Fire is entirely directional: everything about it is the upward
 * flow. Weightless liquid has no preferred direction at all — droplets hold
 * their arrangement and oscillate in place, because with nothing to fall
 * toward, surface tension is the only force left.
 */

/**
 * The environment, written as a function of direction rather than loaded as
 * an image.
 *
 * Water on a black page is close to invisible. It emits nothing, and against
 * a background with nothing in it there is nothing to refract, so the only
 * cues left are what it reflects. Two sources are enough: a broad soft key
 * high and slightly toward the camera, which gives the sliding highlight, and
 * a cool rim from behind, which lights the Fresnel edge. Everything else sits
 * at the page's own background so the liquid never floats on a field of grey.
 *
 * The directions are pre-normalised because a const initialiser cannot call
 * normalize.
 */
const ENVIRONMENT = /* glsl */ `
  // The key sits behind the liquid, not in front of it, which is how glass and
  // water are lit in a studio and for the same reason: front light lands on
  // the surface and stops, and a transparent body lit only on its surface
  // reads as a moulded one. Light from behind goes through, and what it picks
  // up on the way is the only interior structure there is to see.
  //
  // Found by accident. Scroll leaves the mark spinning, and a measurement run
  // came back with it turned most of the way around — the far side looked far
  // better than the side that had been tuned.
  const vec3 KEY_DIR = vec3(-0.14827, 0.84371, -0.51578);

  // Two fills in front, near enough symmetric. A single one sat behind and to
  // the right, which put its whole cone on the W and none of it on the C — the
  // two letters read as different materials, and no amount of tinting touched
  // it because it was never absorption doing it.
  const vec3 RIM_A = vec3( 0.62025, -0.08003,  0.78031);
  const vec3 RIM_B = vec3(-0.58116,  0.14028,  0.80160);

  vec3 envColour(vec3 d) {
    // Everything here has a defined edge, and that is the whole point. Two
    // smooth lobes reflected in a curved surface can only produce a smooth
    // gradient, and a smooth gradient reads as matte plastic however blue it
    // is — the first attempt was exactly that and looked like putty. What
    // makes a surface look wet is a hard edge sliding across it.
    float up = smoothstep(-0.18, 0.10, d.y);

    float key = smoothstep(0.55, 0.88, dot(d, KEY_DIR));
    float core = smoothstep(0.93, 0.985, dot(d, KEY_DIR));
    float rim = smoothstep(0.68, 0.96, dot(d, RIM_A)) * 1.35
              + smoothstep(0.68, 0.96, dot(d, RIM_B)) * 1.00;

    // The room itself is barely lighter than the page, so nothing lifts off a
    // field of grey — but the horizon between floor and sky is abrupt, which
    // gives every droplet a dark bottom and a light top.
    // Kept dim on purpose. Water against a dark backdrop is mostly dark: a
    // transparent body, a thin blazing rim, and a few points where the light
    // happens to land. Lighting the body evenly is what turns it back into
    // something moulded.
    vec3 c = mix(vec3(0.004, 0.004, 0.006), vec3(0.018, 0.021, 0.032), up);
    c += vec3(1.00, 0.97, 0.92) * key * 0.40;
    c += vec3(1.00, 0.99, 0.96) * core * 3.2;
    c += vec3(0.42, 0.50, 1.00) * rim * 0.62;
    return c;
  }
`;

const COMMON = /* glsl */ `
  /** Polynomial smooth minimum. The k term is the whole liquid effect. */
  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

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

export const liquidVertex = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * The droplet count decides the loop bound, and GLSL wants that fixed at
 * compile time — so the source is built once the placement is known rather
 * than being a constant in this file.
 */
export function buildLiquidFragment(count) {
  return /* glsl */ `
  precision highp float;

  ${COMMON}
  ${ENVIRONMENT}

  uniform float uAspect;
  uniform float uTanHalfFov;
  uniform float uCamZ;
  uniform float uScale;
  uniform vec2 uRot;
  uniform float uOpacity;

  uniform float uBlend;
  uniform float uTint;
  uniform float uFeather;
  uniform int uSteps;

  uniform vec3 uBoxLo;
  uniform vec3 uBoxHi;

  // xyz is the droplet's centre right now, w the smallest of its three
  // semi-axes. Both already animated.
  uniform vec4 uDrops[${count}];
  // Reciprocal semi-axes, so the ellipsoid test multiplies instead of divides.
  uniform vec3 uInvRads[${count}];

  varying vec2 vUv;

  /**
   * The union of every droplet, smoothed.
   *
   * This runs tens of thousands of times per pixel, so nothing that can be
   * computed once per frame is computed here. The oscillation and drift are
   * functions of time alone — they do not depend on where the ray is — so they
   * are evaluated on the CPU for thirty droplets and arrive as uniforms. The
   * first version did them inline and spent nine transcendentals per droplet
   * per step, which is two hundred and seventy sines for every step of every
   * ray, all of them recomputing the same thirty answers.
   *
   * What is left is a subtract, a multiply, a length and a smin. The radii
   * arrive inverted for the same reason.
   */
  float mapLiquid(vec3 p) {
    float d = 1e5;
    for (int i = 0; i < ${count}; i++) {
      vec4 drop = uDrops[i];
      // Ellipsoid by the usual scaled-sphere approximation, brought back to
      // world scale by the smallest semi-axis. It underestimates the true
      // distance, which is why the trace steps at less than full length.
      vec3 q = (p - drop.xyz) * uInvRads[i];
      d = smin(d, (length(q) - 1.0) * drop.w, uBlend);
    }
    return d;
  }

  /** Tetrahedral central differences: four evaluations rather than six. */
  vec3 liquidNormal(vec3 p) {
    const vec2 k = vec2(1.0, -1.0);
    float e = 0.0018;
    return normalize(
      k.xyy * mapLiquid(p + k.xyy * e) +
      k.yyx * mapLiquid(p + k.yyx * e) +
      k.yxy * mapLiquid(p + k.yxy * e) +
      k.xxx * mapLiquid(p + k.xxx * e)
    );
  }

  /**
   * Sphere trace to the surface.
   *
   * Unlike the fire this converges rather than accumulating, so it stops as
   * soon as it arrives and most of the frame is spent on the few pixels that
   * actually contain liquid. It also tracks how near it came on a miss, which
   * costs nothing and gives the silhouette an antialiased edge — the one place
   * a hard surface is unforgiving where a volume was not.
   */
  float trace(vec3 ro, vec3 rd, float t0, float t1, out float closest) {
    float t = t0;
    closest = 1e5;

    for (int i = 0; i < 128; i++) {
      if (i >= uSteps) break;

      float d = mapLiquid(ro + rd * t);
      closest = min(closest, d / max(t, 0.05));

      if (d < 0.0012) return t;

      // smin breaks the Lipschitz bound the trace relies on, and so does the
      // ellipsoid approximation. Stepping short of the reported distance is
      // cheaper than either fixing.
      t += d * 0.85;
      if (t > t1) break;
    }

    return -1.0;
  }

  /** From just inside the surface out to the far side of the same body. */
  float traceInside(vec3 ro, vec3 rd) {
    float t = 0.02;
    for (int i = 0; i < 32; i++) {
      float d = mapLiquid(ro + rd * t);
      if (d > -0.0012) break;
      t += max(-d * 0.85, 0.012);
      if (t > 2.5) break;
    }
    return t;
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;

    vec3 ro = vec3(0.0, 0.0, uCamZ);
    vec3 rd = normalize(vec3(ndc.x * uAspect * uTanHalfFov, ndc.y * uTanHalfFov, -1.0));

    // Straight into the field's own space, so every distance from here on is
    // in the units the droplets are authored in and nothing has to be scaled
    // back and forth inside the loop.
    float cy = uRot.y;
    mat2 ry = mat2(cos(cy), -sin(cy), sin(cy), cos(cy));

    ro /= uScale;
    ro.xz = ry * ro.xz;
    rd.xz = ry * rd.xz;

    // The box is fitted to where the droplets actually are this frame, which
    // the CPU already knows exactly. Guessing it wide enough to cover the
    // wobble and the scroll spread meant every ray entering near the corners
    // marched through a lot of certain emptiness first.
    float t0, t1;
    if (!boxHit(ro, rd, uBoxLo, uBoxHi, t0, t1)) discard;
    t0 = max(t0, 0.0);

    float closest;
    float t = trace(ro, rd, t0, t1, closest);

    if (t < 0.0) {
      // A near miss is a pixel the silhouette passes through. closest is the
      // angle the ray came within, so the threshold has to be the angle one
      // pixel subtends — a fixed number here is a fixed number of radians, and
      // the first attempt used one about ten times too large, which put a fat
      // white halo around the whole mark instead of an antialiased edge.
      float edge = 1.0 - smoothstep(0.0, uFeather, closest);
      if (edge <= 0.001) discard;

      // At grazing incidence water is almost entirely reflective, so the
      // silhouette is the brightest part of it — this is a pixel's worth of
      // that edge, not a glow.
      vec3 rim = envColour(RIM_A) * 0.28 + envColour(RIM_B) * 0.22
               + envColour(KEY_DIR) * 0.08;
      gl_FragColor = vec4(rim * edge, edge * uOpacity);
      return;
    }

    vec3 p = ro + rd * t;
    vec3 n = liquidNormal(p);
    vec3 v = -rd;

    // Schlick, with water's F0. Near head-on it reflects two percent and the
    // rest goes through; at the silhouette it reflects nearly everything. That
    // contrast across a single droplet is the signature — no other common
    // material swings that far.
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);

    vec3 reflected = envColour(reflect(rd, n));

    // Refract in, cross the body, refract out. One interior crossing is enough
    // to bend the environment convincingly; the second and third bounces are
    // buried under the reflection at every angle where they would be visible.
    vec3 rIn = refract(rd, n, 1.0 / 1.33);
    float thickness = traceInside(p + rIn * 0.012, rIn);
    vec3 pOut = p + rIn * (thickness + 0.012);
    vec3 nOut = -liquidNormal(pOut);

    vec3 rOut = refract(rIn, nOut, 1.33);
    vec3 transmitted = dot(rOut, rOut) < 1e-4
      ? envColour(reflect(rIn, nOut))   // total internal reflection
      : envColour(rOut);

    // Beer-Lambert across the crossing, weighted to leave blue standing. Real
    // water does this over metres rather than centimetres; at this size it is
    // an exaggeration, kept because it is the only thing giving thick parts of
    // the mark a different colour from thin ones.
    transmitted *= exp(-thickness * uTint * vec3(1.30, 0.85, 0.42));

    vec3 col = mix(transmitted, reflected, fres);

    // The highlight is what actually says wet. Tight and bright, and it slides
    // across the surface as each droplet turns.
    vec3 h = normalize(KEY_DIR + v);
    col += vec3(1.00, 0.98, 0.94) * pow(max(dot(n, h), 0.0), 220.0) * 2.4;

    gl_FragColor = vec4(col * uOpacity, uOpacity);
  }
`;
}
