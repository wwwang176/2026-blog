/**
 * The monogram as one substance changing state: ember → flame → sparks.
 *
 * This deliberately abandons the approach that kept failing. A neutral solid
 * has no material identity, so no amount of lighting maths stops it reading as
 * clay — it needs environment reflection and occlusion to be anything. Fire is
 * self-luminous, so it sidesteps that whole category: it is *emission*, and
 * emission is something a shader can state outright rather than approximate.
 *
 * One `uHeat` uniform runs the phase change. At 0 the letterform is charred
 * rock with glowing veins; at 1 it is fully alight. `uBurn` then eats it away
 * along a noise contour, leaving the hot rim you get at the edge of burning
 * paper, and the sparks carry on upward from there.
 */

/** Value noise + fbm. Compact and self-contained — no library, no texture. */
const NOISE = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }
`;

/**
 * Black-body-ish ramp. The stops matter more than the maths: real flame spends
 * most of its range in orange and only the very hottest core goes pale, so
 * pushing white too early is what makes shader fire look like orange soup.
 */
const RAMP = /* glsl */ `
  vec3 fireRamp(float t) {
    vec3 c = mix(vec3(0.03, 0.008, 0.002), vec3(0.62, 0.05, 0.01), smoothstep(0.0, 0.32, t));
    c = mix(c, vec3(1.0, 0.30, 0.03), smoothstep(0.28, 0.56, t));
    c = mix(c, vec3(1.0, 0.72, 0.18), smoothstep(0.54, 0.82, t));
    c = mix(c, vec3(1.0, 0.96, 0.86), smoothstep(0.84, 1.0, t));
    return c;
  }
`;

/* ── Core letterform ───────────────────────────────────────────── */

export const coreVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  varying vec3 vObj;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);

    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    vPos = mv.xyz;
    // Object space, so the fire pattern is anchored to the letters and does
    // not swim across them when the monogram turns.
    vObj = position;

    gl_Position = projectionMatrix * mv;
  }
`;

export const coreFragment = /* glsl */ `
  precision highp float;

  ${NOISE}
  ${RAMP}

  uniform float uTime;
  uniform float uHeat;
  uniform float uBurn;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  varying vec3 vObj;

  void main() {
    vec3 n = normalize(vNormal);

    // Convection: the pattern drifts upward, faster as it gets hotter.
    vec3 q = vObj * 1.5 + vec3(0.0, -uTime * (0.28 + uHeat * 0.5), uTime * 0.05);
    float f = fbm(q);

    // Cold, only the noise peaks glow — cracks with something alive in them.
    // Hot, the whole surface is emitting and the noise only shapes it.
    float veins = smoothstep(0.54, 0.80, f);
    // Kept just under the top of the ramp on purpose. Driving it past 1 pinned
    // whole regions to the white end and the letters flared out into paper.
    // White should be the noise peaks only, not the average.
    float heat = mix(veins * 0.8, 0.20 + f * 0.82, smoothstep(0.0, 1.0, uHeat));

    vec3 emissive = fireRamp(clamp(heat * mix(0.8, 1.0, uHeat), 0.0, 1.0));

    // Charred rock underneath, so the cold state is a solid object rather
    // than a black hole with stripes on it. A positioned light gives it form;
    // it fades out as emission takes over, which is also what really happens.
    vec3 toLight = vec3(-6.0, 8.0, 13.0) - vPos;
    float dist = length(toLight);
    float lambert = max(dot(n, toLight / dist), 0.0);
    float falloff = 1.0 / (1.0 + dist * dist * 0.0032);

    vec3 rock = vec3(0.052, 0.047, 0.05) * (0.55 + f * 0.9);
    rock += vec3(0.85, 0.84, 0.88) * lambert * falloff * 0.55;

    vec3 col = mix(rock + emissive * 0.85, emissive, smoothstep(0.15, 0.95, uHeat));

    // Burn-through. Biased by height so it eats upward, and the contour is the
    // same noise the fire is drawn from, so the edge belongs to the flame.
    float contour = f * 0.75 + (vObj.y * 0.22 + 0.5) * 0.55;
    if (contour < uBurn) discard;

    // The bright line at the edge of burning paper.
    float lip = smoothstep(uBurn, uBurn + 0.055, contour);
    col = mix(vec3(1.0, 0.80, 0.40) * 1.7, col, lip);

    gl_FragColor = vec4(col, uOpacity);
  }
`;

/* ── Flame shell ───────────────────────────────────────────────── */

export const shellVertex = /* glsl */ `
  ${NOISE}

  // Averaged across coincident vertices. Displacing along the flat-shaded
  // face normal tore the surface into shards, which is what the diagonal
  // banding on the extruded walls was.
  attribute vec3 aSmooth;

  uniform float uTime;
  uniform float uFlame;

  varying float vBand;
  varying vec3 vObj;

  void main() {
    vec3 q = position * 1.7 + vec3(0.0, -uTime * 0.85, uTime * 0.1);
    float f = fbm(q);

    // Push off the surface and lick upward. The offset is entirely noise, so
    // the shell never reads as a scaled copy of the letter.
    vec3 p = position + aSmooth * (0.02 + f * 0.30) * uFlame;
    p.y += pow(f, 1.6) * 0.85 * uFlame;

    vBand = f;
    vObj = position;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const shellFragment = /* glsl */ `
  precision highp float;

  ${NOISE}
  ${RAMP}

  uniform float uTime;
  uniform float uBurn;
  uniform float uOpacity;

  varying float vBand;
  varying vec3 vObj;

  void main() {
    vec3 q = vObj * 2.3 + vec3(0.0, -uTime * 1.15, uTime * 0.12);
    float f = fbm(q);

    // The shell has to be eaten by the same contour as the letterform beneath
    // it. Without this it outlives the core and leaves a dim ghost of the
    // monogram hanging in the sparks stage.
    float contour = fbm(vObj * 1.5) * 0.75 + (vObj.y * 0.22 + 0.5) * 0.55;
    if (contour < uBurn) discard;

    // Thin the flame out toward the top of the letterform, or it reads as a
    // glowing sleeve rather than something rising off a surface.
    float height = clamp(vObj.y * 0.3 + 0.5, 0.0, 1.0);
    float alpha = smoothstep(0.28, 0.72, f) * (1.0 - height * 0.55);

    if (alpha < 0.01) discard;

    vec3 col = fireRamp(clamp(f * 1.25, 0.0, 1.0));

    gl_FragColor = vec4(col, alpha * uOpacity);
  }
`;

/* ── Sparks ────────────────────────────────────────────────────── */

export const sparkVertex = /* glsl */ `
  attribute vec3 aFrom;
  attribute float aScale;
  attribute float aSeed;

  uniform float uRise;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uModelScale;

  varying float vDepth;
  varying float vLife;

  void main() {
    vec3 p = aFrom * uModelScale;

    // Each spark has its own life, so they do not move as a sheet. Staggering
    // by seed is the whole difference between embers and confetti.
    float life = clamp(uRise * (0.55 + fract(aSeed * 0.017) * 0.9), 0.0, 1.0);

    // Buoyancy, accelerating — hot air does not lift at a constant rate.
    p.y += life * life * (7.0 + fract(aSeed * 0.031) * 6.0);

    // Turbulence widens as they climb and lose the plume.
    p.x += sin(uTime * 0.6 + aSeed) * life * 2.4;
    p.z += cos(uTime * 0.51 + aSeed * 1.4) * life * 1.8;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    vLife = life;

    // Sparks shrink as they cool.
    gl_PointSize = uSize * aScale * (1.0 - life * 0.55) * uPixelRatio / max(vDepth, 0.001);
    gl_Position = projectionMatrix * mv;
  }
`;

export const sparkFragment = /* glsl */ `
  precision highp float;

  ${RAMP}

  uniform float uOpacity;

  varying float vDepth;
  varying float vLife;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;

    // Cooling: white-hot at the base of the plume, deep red by the top, gone
    // shortly after. Sparks that stay bright all the way up read as glitter.
    vec3 col = fireRamp(clamp(1.0 - vLife * 0.85, 0.0, 1.0));

    float alpha = smoothstep(0.5, 0.1, d) * (1.0 - smoothstep(0.55, 1.0, vLife));
    float depthFade = smoothstep(40.0, 8.0, vDepth);

    gl_FragColor = vec4(col, alpha * uOpacity * depthFade);
  }
`;
