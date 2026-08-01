/**
 * `CW.` as a swarm of fireballs rather than a solid letterform that is alight.
 *
 * There is no mesh here at all, which is the point. Every attempt at a lit
 * solid ran into the same wall — a neutral surface has no material identity
 * without environment reflection and occlusion behind it. A cloud of emissive
 * billboards has nothing to reflect and nothing to occlude: it is light, and
 * the letters are whatever shape the light is arranged into.
 *
 * Each ball owns its own loop. It is born at an anchor sampled inside the
 * letterform, swells, lifts, cools through the ramp and dies, then restarts
 * out of phase with its neighbours. The monogram therefore never holds still,
 * yet never stops being legible, because the anchors do not move.
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

/**
 * Black-body-ish ramp. Real flame spends most of its range in orange and only
 * the hottest core goes pale — reaching white early is what turns shader fire
 * into orange soup.
 */
const RAMP = /* glsl */ `
  vec3 fireRamp(float t) {
    vec3 c = mix(vec3(0.05, 0.006, 0.001), vec3(0.65, 0.055, 0.008), smoothstep(0.0, 0.30, t));
    c = mix(c, vec3(1.0, 0.28, 0.02), smoothstep(0.26, 0.54, t));
    c = mix(c, vec3(1.0, 0.68, 0.14), smoothstep(0.52, 0.80, t));
    c = mix(c, vec3(1.0, 0.94, 0.80), smoothstep(0.86, 1.0, t));
    return c;
  }
`;

export const fireballVertex = /* glsl */ `
  ${HASH}

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
    float rate = 0.45 + hash11(aSeed) * 0.55;
    float life = fract(aSeed * 0.317 + uTime * rate);

    // Rise and wander while alive. Small on purpose — the anchors carry the
    // letterform, so the movement has to stay inside it or the word dissolves.
    p.y += life * (0.55 + hash11(aSeed + 3.1) * 0.7);
    p.x += sin(uTime * 1.1 + aSeed * 6.0) * 0.13 * life;
    p.z += cos(uTime * 0.9 + aSeed * 4.0) * 0.13 * life;

    // Dispersal is the only thing that breaks the letters, and it is scroll
    // driven rather than part of the idle loop.
    float d = uDisperse * uDisperse;
    p.y += d * (9.0 + hash11(aSeed + 7.7) * 8.0);
    p.x += sin(aSeed * 2.3) * d * 5.0;
    p.z += cos(aSeed * 1.7) * d * 4.0;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    vLife = life;
    vSeed = aSeed;

    // Swell fast, fade slow — a flame's silhouette is not symmetric in time.
    float swell = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.45, 1.0, life));

    gl_PointSize = uSize * aScale * swell * uIntensity * uPixelRatio / max(vDepth, 0.001);
    gl_Position = projectionMatrix * mv;
  }
`;

export const fireballFragment = /* glsl */ `
  precision highp float;

  ${HASH}
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

    // Break the circle up, or ten thousand perfect discs read as bokeh.
    float angle = atan(uv.y, uv.x);
    float wobble = hash12(vec2(floor(angle * 3.5), floor(vSeed))) * 0.13;
    // Flames are taller than they are wide, and they narrow as they rise.
    float stretch = 1.0 - max(uv.y, 0.0) * 0.45;
    float radius = (0.5 - wobble) * stretch;

    float core = smoothstep(radius, 0.0, d);
    float body = pow(core, 1.9);

    // Hot when young, and hotter at the centre than at the edge — that
    // gradient across a single ball is most of what makes it read as flame.
    float heat = (1.0 - vLife * 0.9) * 0.62 + body * 0.5;
    vec3 col = fireRamp(clamp(heat, 0.0, 1.0));

    float alpha = body * (1.0 - smoothstep(0.55, 1.0, vLife));
    float depthFade = smoothstep(46.0, 6.0, vDepth);

    gl_FragColor = vec4(col, alpha * uOpacity * depthFade);
  }
`;
