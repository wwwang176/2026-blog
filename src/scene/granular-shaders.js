import { GLSL_BOX, GLSL_NOISE, MONOGRAM_SDF } from "./monogram-sdf.js";

/**
 * `CW.` carved in sand, and coming apart in the wind.
 *
 * The third element, and the first heavy one. Fire and water are both bright,
 * both transparent, and both make their own case optically — fire by emitting
 * and water by bending. Sand does neither. It is opaque, it is matte, and
 * everything you can see about it comes from one thing: how a light rakes
 * across a rough surface. That makes the lighting decision here what the
 * environment decision was for the water, only more so, because there is no
 * highlight and no rim to fall back on.
 *
 * The other separation is motion. Fire is all flow and water is all wobble;
 * this barely moves. The body is still, and the only thing happening is at the
 * edges, where the wind is taking it away a grain at a time.
 */

/**
 * The mass.
 *
 * Two departures from the letterform the fire burns. The extrusion is rounded,
 * because sand has no sharp edge anywhere and the fire's square-cut slab reads
 * as cut card the moment it is lit rather than glowing. And the field itself
 * is displaced by grain noise rather than the normal being perturbed after the
 * fact — a smooth silhouette wrapped around a bumpy interior reads as a
 * texture painted onto something else. The edge has to crumble too.
 */
const SAND_SHAPE = /* glsl */ `
  uniform float uGrainFreq;
  uniform float uGrainAmp;
  uniform float uDepth;
  uniform float uErosion;
  uniform float uWind;
  uniform float uTime;

  float grainAt(vec3 p) {
    // Scrolling downwind. The surface texture visibly travelling across a body
    // that is otherwise still is most of what reads as erosion — before a
    // single loose grain has been drawn.
    return fbm(p * uGrainFreq + vec3(-uTime * uWind, 0.0, uTime * uWind * 0.2));
  }

  float sdBody(vec3 p) {
    vec2 w = vec2(sdOutline(p.xy), abs(p.z) - uDepth);
    return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - 0.10;
  }

  float mapSand(vec3 p) {
    float d = sdBody(p);

    // Erosion eats from the windward side and from anything standing proud,
    // weighted by a large-scale noise so it arrives in patches rather than
    // evenly — which is what makes it read as weather rather than as a shrink.
    //
    // Guarded, because at rest this whole term is multiplied by zero and the
    // fbm inside it was being evaluated at every step of every ray to produce
    // a number that was then thrown away. It was half the cost of the map.
    if (uErosion > 0.001) {
      float weather = fbm(p * 0.85 + vec3(-uTime * 0.22, 0.0, 0.0));
      // Only a slight lean into the wind. A stronger one is more faithful, but
      // it ate the C down to a crescent while the W was barely touched, and
      // that reads as one letter being broken rather than as the whole mark
      // weathering. The patchiness above carries the irregularity instead.
      float exposure = 0.78 + 0.22 * smoothstep(-0.6, 0.9, -p.x);
      d += uErosion * exposure * (0.35 + weather * 1.3);
    }

    // The grain can move the surface by half its amplitude either way, so
    // anywhere further out than that it cannot decide anything — and most of
    // a ray's life is spent out there, crossing empty space in long steps.
    // Returning the conservative bound instead skips the noise entirely for
    // all of it, which is the same trick the fire uses on its distance field.
    float amp = uGrainAmp * 0.5;
    if (d > amp + 0.08) return d - amp;

    d -= (grainAt(p) - 0.5) * uGrainAmp;
    return d;
  }
`;

export const granularVertex = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const granularFragment = /* glsl */ `
  precision highp float;

  ${GLSL_NOISE}
  ${MONOGRAM_SDF}
  ${GLSL_BOX}
  ${SAND_SHAPE}

  uniform float uAspect;
  uniform float uTanHalfFov;
  uniform float uCamZ;
  uniform float uScale;
  uniform vec2 uRot;
  uniform float uOpacity;
  uniform float uFeather;
  uniform float uAO;
  uniform vec3 uSand;
  uniform int uSteps;

  varying vec2 vUv;

  // Almost square to the view, and only just above the horizon. The angle is
  // the whole point and it wants to be extreme: light with any component
  // toward the camera lands evenly on every surface facing the camera, which
  // is most of what you can see, and flattens the displacement into nothing.
  // Nearly all of the z taken out of it is what gives each bump a shadow of
  // its own and a terminator to sit against.
  const vec3 SUN = vec3(-0.94190, 0.30061, 0.15031);
  const vec3 FILL = vec3(0.44721, 0.44721, 0.77460);

  vec3 sandNormal(vec3 p) {
    const vec2 k = vec2(1.0, -1.0);
    float e = 0.0022;
    return normalize(
      k.xyy * mapSand(p + k.xyy * e) +
      k.yyx * mapSand(p + k.yyx * e) +
      k.yxy * mapSand(p + k.yxy * e) +
      k.xxx * mapSand(p + k.xxx * e)
    );
  }

  /**
   * How much of the sky a point can see, by walking out along its own normal
   * and asking how much nearer the surface stayed than the distance walked.
   *
   * Cheap, and on a matte opaque body it is doing the work that Fresnel and
   * refraction did for the water — without it the concavities of the W fill
   * with flat colour and the letter loses its depth entirely.
   */
  float occlusion(vec3 p, vec3 n) {
    float sum = 0.0;
    float weight = 1.0;
    for (int i = 1; i <= 5; i++) {
      float h = 0.012 + 0.055 * float(i);
      sum += weight * (h - mapSand(p + n * h));
      weight *= 0.72;
    }
    return clamp(1.0 - uAO * sum, 0.0, 1.0);
  }

  float trace(vec3 ro, vec3 rd, float t0, float t1, out float closest) {
    float t = t0;
    closest = 1e5;

    for (int i = 0; i < 128; i++) {
      if (i >= uSteps) break;

      float d = mapSand(ro + rd * t);
      closest = min(closest, d / max(t, 0.05));

      if (d < 0.0016) return t;

      // Noise subtracted from a distance field breaks the bound it relies on
      // by roughly the amplitude, so the step is held well short.
      t += d * 0.7;
      if (t > t1) break;
    }

    return -1.0;
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;

    vec3 ro = vec3(0.0, 0.0, uCamZ);
    vec3 rd = normalize(vec3(ndc.x * uAspect * uTanHalfFov, ndc.y * uTanHalfFov, -1.0));

    float cy = uRot.y;
    mat2 ry = mat2(cos(cy), -sin(cy), sin(cy), cos(cy));

    ro /= uScale;
    ro.xz = ry * ro.xz;
    rd.xz = ry * rd.xz;

    float reach = uDepth + uGrainAmp + 0.2;
    vec3 lo = vec3(-3.0, -1.35, -reach);
    vec3 hi = vec3( 3.0,  1.35,  reach);

    float t0, t1;
    if (!boxHit(ro, rd, lo, hi, t0, t1)) discard;
    t0 = max(t0, 0.0);

    float closest;
    float t = trace(ro, rd, t0, t1, closest);

    if (t < 0.0) {
      // The silhouette of a matte body has no bright edge to borrow, so unlike
      // the water this feather is alpha only — the colour is the sand's own,
      // at the brightness the terminator leaves it.
      float edge = 1.0 - smoothstep(0.0, uFeather, closest);
      if (edge <= 0.001) discard;
      gl_FragColor = vec4(uSand * 0.20 * edge, edge * 0.7 * uOpacity);
      return;
    }

    vec3 p = ro + rd * t;
    vec3 n = sandNormal(p);
    float ao = occlusion(p, n);

    float sun = max(dot(n, SUN), 0.0);
    float fill = max(dot(n, FILL), 0.0);
    // Sky above, ground below. On a page with no ground this is the only thing
    // separating the underside of a stroke from its top.
    float sky = 0.5 + 0.5 * n.y;

    // Held under one on purpose. Sand is a dark material — its albedo is
    // around 0.3 — and pushing it up past the tone curve's shoulder is what
    // turned the first attempt into polystyrene: everything above one
    // compresses toward white and takes the colour with it.
    vec3 col = uSand * 0.95 * sun;
    col += uSand * vec3(0.62, 0.68, 1.0) * fill * 0.16 * ao;
    col += uSand * vec3(0.55, 0.60, 0.85) * sky * 0.10 * ao;
    col *= mix(0.55, 1.0, ao);

    // Grazing light on a dusty surface scatters forward and lifts the far
    // limb. It is faint, and it is what stops the unlit side going to a flat
    // silhouette against a black page.
    col += uSand * vec3(1.0, 0.86, 0.66)
         * pow(max(dot(rd, SUN), 0.0), 3.0) * 0.09 * ao;

    gl_FragColor = vec4(col * uOpacity, uOpacity);
  }
`;

/**
 * Grains taken off the surface by the wind.
 *
 * These project themselves, for the same reason the fire's embers do: the
 * camera lives in the fragment shader and the scene camera is a placeholder.
 * Everything else about them is the opposite. Embers are hot, they rise, and
 * they accelerate away from what made them. Grains are cold, they travel
 * sideways, and they fall back — sand blown off a dune does not leave, it
 * lands a little further along.
 */
export const grainVertex = /* glsl */ `
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    return fract(p * (p + p));
  }

  attribute vec3 aAnchor;
  attribute float aScale;
  attribute float aSeed;

  uniform float uTime;
  uniform float uCamZ;
  uniform float uAspect;
  uniform float uTanHalfFov;
  uniform float uScale;
  uniform vec2 uRot;
  uniform float uErosion;
  uniform float uWind;
  uniform float uSize;
  uniform float uPixelRatio;

  varying float vLife;
  varying float vSeed;

  void main() {
    float rate = 0.28 + hash11(aSeed) * 0.5;
    float life = fract(aSeed * 0.613 + uTime * rate * (0.6 + uWind));

    vec3 p = aAnchor;

    // Downwind, at a speed of its own, and quickly — a grain is small enough
    // that the air moves it almost at the air's own speed.
    float carry = 2.2 + hash11(aSeed + 4.4) * 5.4;
    p.x -= life * carry * (0.35 + uWind);

    // Lifted off the surface, then dropped. Ballistic rather than buoyant,
    // which is the whole difference from an ember.
    float lift = 0.5 + hash11(aSeed + 17.1) * 1.5;
    p.y += life * lift - life * life * lift * 1.7;

    p.z += (hash11(aSeed + 31.7) - 0.5) * 2.4 * life;

    // Saltation: a grain skips rather than flying, so it flutters on the way.
    p.y += sin(uTime * 7.0 + aSeed * 9.0) * life * 0.10;

    float cy = uRot.y;
    mat2 inv = mat2(cos(cy), sin(cy), -sin(cy), cos(cy));
    p.xz = inv * p.xz;

    vec3 world = p * uScale;
    float zc = uCamZ - world.z;

    vLife = life;
    vSeed = aSeed;

    if (zc < 0.6) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    gl_Position = vec4(
      world.x / (zc * uAspect * uTanHalfFov),
      world.y / (zc * uTanHalfFov),
      0.0, 1.0
    );
    gl_PointSize = min(uSize * aScale * uPixelRatio / zc, 10.0 * uPixelRatio);
  }
`;

export const grainFragment = /* glsl */ `
  precision highp float;

  uniform float uOpacity;
  uniform float uErosion;
  uniform vec3 uSand;

  varying float vLife;
  varying float vSeed;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;

    // Lit as dimly as the body it came off. Embers glow and are drawn with
    // additive blending; a grain of sand is just a speck catching the sun, so
    // these blend normally and stay under the body's own brightness.
    float shade = 0.55 + 0.45 * fract(vSeed * 0.379);

    float alpha = smoothstep(0.5, 0.15, d)
      * smoothstep(0.0, 0.08, vLife)
      * (1.0 - smoothstep(0.45, 1.0, vLife))
      * (0.25 + uErosion * 2.2);

    gl_FragColor = vec4(uSand * 1.9 * shade, min(alpha, 1.0) * uOpacity);
  }
`;
