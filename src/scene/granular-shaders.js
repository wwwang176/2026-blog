import { GLSL_BOX, GLSL_NOISE, MONOGRAM_SDF } from "./monogram-sdf.js";

/**
 * `CW.` carved in sand, in a wind that is taking it away.
 *
 * The third element, and the first heavy one. Fire and water are both bright,
 * both transparent, and both make their own case optically — fire by emitting
 * and water by bending. Sand does neither. It is opaque, it is matte, and
 * everything you can see about it comes from one thing: how light rakes across
 * a rough surface.
 *
 * That was the first version and it was not enough. An opaque body evenly lit
 * and floating in a void reads as a 3D render rather than as a photograph, and
 * no amount of surface detail fixes it — because what was missing was not on
 * the surface. There was no air. A storm is mostly air: the light comes through
 * it in shafts, the object throws a shadow into it, and distance drains the
 * contrast out of everything behind it. All of that is here now, and it costs
 * more than the body does.
 */

/**
 * The mass.
 *
 * Two departures from the letterform the fire burns. The extrusion is rounded,
 * because sand has no sharp edge anywhere and the fire's square-cut slab reads
 * as cut card the moment it is lit rather than glowing. And the field itself is
 * displaced rather than the normal being perturbed after the fact — a smooth
 * silhouette wrapped around a bumpy interior reads as a texture painted onto
 * something else. The edge has to crumble too.
 */
const SAND_SHAPE = /* glsl */ `
  uniform float uGrainFreq;
  uniform float uGrainAmp;
  uniform float uStrata;
  uniform float uFlute;
  uniform float uPocket;
  uniform float uDepth;
  uniform float uErosion;
  uniform float uWind;
  uniform float uTime;

  float sdBody(vec3 p) {
    vec2 w = vec2(sdOutline(p.xy), abs(p.z) - uDepth);
    return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - 0.10;
  }

  /** Where a point sits in the bedding sequence. */
  float strataAt(vec3 p) {
    // Not level, and not one thickness. A single sine of a single frequency
    // gave clean horizontal stripes that read as a paint job — the second term
    // breaks the period so no two beds are the same depth, and the noise warps
    // the plane so none of them is straight.
    float y = p.y * 5.2 + vnoise(p * 0.9) * 3.4 + p.x * 0.35;
    return sin(y) * 0.7 + sin(y * 0.41 + 1.9) * 0.3;
  }

  /**
   * Everything above grain scale.
   *
   * One frequency of noise everywhere is what the first version had, and it
   * gave a letterform evenly coated in crumb with no internal composition at
   * all. Weathered rock is not uniform: it is bedded, so it wears in bands; it
   * is scoured along the wind, so it flutes; and it fails in patches, so it
   * pockets. Three scales, doing three different things to the shape.
   */
  float surfaceForm(vec3 p) {
    // Softer beds stand back from harder ones.
    float bands = smoothstep(-0.3, 0.4, strataAt(p)) * uStrata;

    // Ventifact grooves, from noise stretched hard along the wind. This is the
    // one that most says the shape was cut by moving air rather than carved.
    float flute = (vnoise(vec3(p.x * 0.42, p.y * 6.2, p.z * 5.4)) - 0.5) * uFlute;

    // The parts the wind has got behind and hollowed out. Large, slow, deep.
    float pocket = smoothstep(0.42, 0.86, vnoise(p * 1.05 + 3.7)) * uPocket;

    return bands + flute - pocket;
  }

  float grainAt(vec3 p) {
    // Scrolling downwind. Surface texture visibly travelling across a body that
    // is otherwise still is most of what reads as erosion, before a single
    // loose grain has been drawn.
    //
    // Two octaves rather than fbm's three. At a frequency of forty-four the
    // third octave is finer than a pixel at any resolution this renders at, so
    // it was detail nobody could see costing a full noise evaluation on every
    // sample near the surface.
    vec3 q = p * uGrainFreq + vec3(-uTime * uWind, 0.0, uTime * uWind * 0.2);
    return vnoise(q) * 0.62 + vnoise(q * 2.1 + 7.3) * 0.38;
  }

  /**
   * The shape without its grain.
   *
   * Split out because the grain is only visible within its own amplitude of
   * the surface, and because the ambient occlusion does not want it at all —
   * it is asking about the form, not the texture. Before the split, a single
   * map paid for everything everywhere, and the new surface detail pushed the
   * noise-free skip distance from 0.1 out to 0.21, so a much thicker shell
   * around the letterform was paying full price for detail it could not show.
   */
  float mapCoarse(vec3 p) {
    float d = sdBody(p);

    // Erosion eats from the windward side and from anything standing proud,
    // weighted by a large-scale noise so it arrives in patches rather than
    // evenly — which is what makes it read as weather rather than as a shrink.
    //
    // Guarded, because at rest this whole term is multiplied by zero and the
    // noise inside it was being evaluated at every step of every ray to
    // produce a number that was then thrown away.
    if (uErosion > 0.001) {
      float weather = fbm(p * 0.85 + vec3(-uTime * 0.22, 0.0, 0.0));
      // Only a slight lean into the wind. A stronger one is more faithful, but
      // it ate the C down to a crescent while the W was barely touched, and
      // that reads as one letter being broken rather than the mark weathering.
      float exposure = 0.78 + 0.22 * smoothstep(-0.6, 0.9, -p.x);
      d += uErosion * exposure * (0.35 + weather * 1.3);
    }

    float reach = uStrata + abs(uFlute) * 0.5 + uPocket;
    if (d > reach + 0.06) return d - reach;

    return d - surfaceForm(p);
  }

  float mapSand(vec3 p) {
    float d = mapCoarse(p);
    float amp = uGrainAmp * 0.5;
    if (d > amp + 0.03) return d - amp;
    return d - (grainAt(p) - 0.5) * uGrainAmp;
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
  uniform float uLevel;
  uniform float uShaft;
  uniform float uHaze;
  uniform float uGust;
  uniform vec3 uSand;
  uniform int uSteps;
  uniform int uAirSteps;

  varying vec2 vUv;

  // Almost square to the view, and only just above the horizon. The angle is
  // the whole point and it wants to be extreme: light with any component toward
  // the camera lands evenly on every surface facing the camera, which is most
  // of what you can see, and flattens the displacement into nothing. Taking
  // nearly all the z out of it gives each bump a shadow of its own — and it is
  // also what lets the shafts run across the frame rather than at it.
  const vec3 SUN = vec3(-0.94190, 0.30061, 0.15031);
  const vec3 FILL = vec3(0.44721, 0.44721, 0.77460);

  // A low sun through dust is warm to the point of orange, and what it does not
  // reach goes to the colour of the sky rather than to black. One warm source
  // and one cool one is most of what stops a single-albedo material looking
  // like a single-albedo material.
  const vec3 SUN_COL = vec3(1.00, 0.72, 0.44);
  const vec3 SKY_COL = vec3(0.34, 0.42, 0.62);

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
   * How much of the sun reaches a point, tested against the body only.
   *
   * On sdBody rather than mapSand, so it costs no noise: a shadow at this scale
   * is thrown by the letterform, not by its grain. It is the same function the
   * shafts use, which is what makes the shadow on the mark and the shadow
   * through the air the same shadow.
   */
  float sunReach(vec3 p) {
    float sh = 1.0;
    for (int i = 1; i <= 4; i++) {
      float h = 0.20 + float(i) * 0.62;
      sh = min(sh, smoothstep(-0.06, 0.30, sdBody(p + SUN * h)));
      if (sh < 0.02) break;
    }
    return sh;
  }

  /**
   * How much of the sky a point can see, by walking out along its own normal
   * and asking how much nearer the surface stayed than the distance walked.
   *
   * On a matte opaque body this is doing the work Fresnel and refraction did
   * for the water — without it the concavities of the W fill with flat colour.
   */
  float occlusion(vec3 p, vec3 n) {
    float sum = 0.0;
    float weight = 1.0;
    for (int i = 1; i <= 4; i++) {
      float h = 0.014 + 0.068 * float(i);
      sum += weight * (h - mapCoarse(p + n * h));
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

      // Noise subtracted from a distance field breaks the bound the trace
      // relies on by roughly its amplitude, so the step is held well short.
      t += d * 0.7;
      if (t > t1) break;
    }

    return -1.0;
  }

  /* ── The air ───────────────────────────────────────────────────── */

  float dustDensity(vec3 p) {
    vec3 q = p * vec3(0.42, 1.05, 0.7) + vec3(-uTime * uWind * 1.6, 0.0, uTime * 0.1);
    float n = vnoise(q) * 0.62 + vnoise(q * 2.35 + 4.1) * 0.38;

    // The threshold is what makes shafts possible. Dust that is present
    // everywhere lights up everywhere and the whole frame goes to milk — which
    // is what the first attempt did. Cutting hard and scaling back up leaves
    // clear air between the clumps, and a beam is only visible because of the
    // clear air on either side of it.
    float clump = max(n - 0.54, 0.0) * 2.4;

    // Denser low down, but not a bank sitting on the floor: blowing sand
    // thins upward, it does not stop.
    float h = 0.35 + 0.65 * smoothstep(3.0, -1.4, p.y);
    return clump * h * uGust;
  }

  /**
   * In-scattered light along the ray, and what is left of whatever is behind.
   *
   * This is the expensive half of the frame and it is the half that matters.
   * The shafts happen because the sun is nearly lateral: it crosses the frame
   * rather than facing it, so the letterform's shadow is thrown sideways
   * through the dust and stays in view for its whole length. A sun behind the
   * camera would light the same dust just as brightly and show nothing at all.
   */
  vec4 marchAir(vec3 ro, vec3 rd, float tMax, float dither) {
    vec3 lo = vec3(-9.0, -3.6, -3.4);
    vec3 hi = vec3( 9.0,  3.6,  3.4);

    float t0, t1;
    if (!boxHit(ro, rd, lo, hi, t0, t1)) return vec4(0.0, 0.0, 0.0, 1.0);

    t0 = max(t0, 0.0);
    t1 = min(t1, tMax);
    if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);

    float dt = (t1 - t0) / float(uAirSteps);
    float t = t0 + dither * dt;

    vec3 acc = vec3(0.0);
    float trans = 1.0;

    for (int i = 0; i < 32; i++) {
      if (i >= uAirSteps) break;
      if (trans < 0.02) break;

      vec3 p = ro + rd * t;
      float dens = dustDensity(p);

      if (dens > 0.02) {
        // Only a thin slab of the air can be in shadow at all, and the trace
        // to find that out is the expensive part of this loop — so it only
        // runs where the answer can be anything but lit.
        //
        // The z bound does the most work. The sun sits almost in the xz plane
        // and the mark is barely a third of a unit thick, so its shadow stays
        // within about a unit of z however far it is thrown — while the dust
        // box is nearly seven units deep. Most of the air is nowhere near the
        // shadow and always was.
        bool couldShade = p.x > -3.4 && p.x < 5.5
                       && abs(p.y) < 2.4 && abs(p.z) < 1.1;
        float lit = couldShade ? sunReach(p) : 1.0;

        vec3 light = SUN_COL * lit * uShaft + SKY_COL * 0.10;
        acc += trans * dens * dt * light;
        trans *= exp(-dens * dt * uHaze);
      }

      t += dt;
    }

    return vec4(acc, trans);
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

    float reach = uDepth + uGrainAmp + uStrata + uPocket + 0.3;
    vec3 lo = vec3(-3.2, -1.6, -reach);
    vec3 hi = vec3( 3.2,  1.6,  reach);

    float bt0, bt1;
    bool inBox = boxHit(ro, rd, lo, hi, bt0, bt1);
    bt0 = max(bt0, 0.0);

    float closest = 1e5;
    float t = inBox ? trace(ro, rd, bt0, bt1, closest) : -1.0;

    vec3 body = vec3(0.0);
    float cover = 0.0;

    if (t > 0.0) {
      vec3 p = ro + rd * t;
      vec3 n = sandNormal(p);
      float ao = occlusion(p, n);

      // The mark shadowing itself. The W's strokes are close enough together
      // that under a light this lateral they must throw shadows onto each
      // other, and without it the three of them read as one flat plate.
      float sun = max(dot(n, SUN), 0.0) * sunReach(p + n * 0.03);
      float fill = max(dot(n, FILL), 0.0);
      float sky = 0.5 + 0.5 * n.y;

      // Strata are not only a shape. Beds differ in what they are made of, so
      // they differ in colour, and a band that stands proud and is also a shade
      // warmer reads as rock in a way that either alone does not.
      // Slight. Bands that both stand proud and change colour by a third read
      // as stripes painted on, not as bedding — the shape carries this and the
      // colour only has to agree with it.
      vec3 albedo = uSand * mix(0.93, 1.05, smoothstep(-0.4, 0.5, strataAt(p)));

      body = albedo * SUN_COL * uLevel * sun;

      // The fill carries more than it looks like it should. Under a light this
      // lateral a front-facing surface takes 0.15 of the sun and an upward one
      // takes 0.30, so the tops came out twice the brightness of the faces and
      // the mark read as snow-capped. Raising the fill lifts the faces without
      // touching the raking angle, which is the only thing showing the grain.
      body += albedo * SKY_COL * fill * 0.34 * ao;
      body += albedo * SKY_COL * sky * 0.18 * ao;

      // Floor on the occlusion for the same reason: the new hollows are deep
      // enough that at full strength it crushed them to black.
      body *= mix(0.7, 1.0, ao);

      // Grazing light on a dusty surface scatters forward and lifts the far
      // limb. Faint, and it is what stops the unlit side going to a flat
      // silhouette against a black page.
      body += albedo * SUN_COL * pow(max(dot(rd, SUN), 0.0), 3.0) * 0.10 * ao;

      cover = 1.0;
    } else if (inBox) {
      // A near miss is a pixel the silhouette passes through. The colour is the
      // sand's own at the brightness the terminator leaves it — a matte body
      // has no bright edge to borrow.
      float edge = 1.0 - smoothstep(0.0, uFeather, closest);
      if (edge > 0.001) {
        body = uSand * SUN_COL * uLevel * 0.22;
        cover = edge * 0.75;
        t = bt1;
      }
    }

    // Dithered, or the coarse air march bands into visible shells exactly the
    // way the fire's did. Reseeded every frame so it never settles into a
    // pattern the eye can find.
    float dither = fract(
      sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime) * 43758.5453
    );
    vec4 air = marchAir(ro, rd, t > 0.0 ? t : 1e4, dither);

    // Distance drains contrast: what is behind the dust comes through dimmed by
    // exactly the amount the dust scattered into the eye instead. One multiply,
    // and it is most of what separates a photograph of a storm from an object
    // with particles drawn in front of it.
    vec3 col = body * air.w + air.rgb;
    float alpha = cover * air.w + (1.0 - air.w);

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col * uOpacity, min(alpha, 1.0) * uOpacity);
  }
`;

/**
 * The air, full of sand.
 *
 * These project themselves, for the same reason the fire's embers do: the
 * camera lives in the fragment shader and the scene camera is a placeholder.
 * Everything else about them is the opposite. Embers are hot, they rise, and
 * they accelerate away from what made them. Grains are cold, they travel
 * sideways, and they fall back — sand blown off a dune does not leave, it lands
 * a little further along.
 */
export const grainVertex = /* glsl */ `
  ${MONOGRAM_SDF}

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
  uniform float uGust;
  uniform float uDeflect;
  uniform float uSize;
  uniform float uPixelRatio;

  varying float vLife;
  varying float vSeed;
  varying float vNear;

  void main() {
    float speed = (0.35 + uWind) * uGust;

    float rate = 0.20 + hash11(aSeed) * 0.34;
    float life = fract(aSeed * 0.613 + uTime * rate * (0.5 + uWind));

    vec3 p = aAnchor;

    // Downwind, at a speed of its own. The spread of speeds matters more than
    // the average: a field of grains all travelling together reads as one sheet
    // sliding across, and it is the ones overtaking each other that read as air.
    float carry = 3.0 + hash11(aSeed + 4.4) * 9.5;
    p.x -= life * carry * speed;

    // Lifted, then dropped. Ballistic rather than buoyant, which is the whole
    // difference from an ember.
    float lift = 0.35 + hash11(aSeed + 17.1) * 1.7;
    p.y += life * lift - life * life * lift * 1.7;

    p.z += (hash11(aSeed + 31.7) - 0.5) * 3.2 * life;

    // Saltation: a grain skips rather than flies, so it flutters on the way.
    p.y += sin(uTime * 6.0 + aSeed * 9.0) * life * 0.14;
    p.z += cos(uTime * 4.6 + aSeed * 5.0) * life * 0.10;

    // Wind goes around a solid, not through it. Without this the whole field is
    // one sheet of noise sliding across the mark and the mark may as well not
    // be there — which is most of why it read as television static rather than
    // as moving air.
    float d0 = sdOutline(p.xy);
    vec2 grad = vec2(
      sdOutline(p.xy + vec2(0.07, 0.0)) - d0,
      sdOutline(p.xy + vec2(0.0, 0.07)) - d0
    );
    float near = smoothstep(0.95, -0.15, d0);
    p.xy += normalize(grad + 1e-5) * near * uDeflect;

    // And behind it the air stays disturbed for a while. The wake is sampled
    // offset downwind of the letterform rather than centred on it, because
    // that is where a wake is.
    float wake = smoothstep(1.5, -0.2, sdOutline(p.xy + vec2(1.4, 0.0)));
    p.y += sin(uTime * 3.1 + aSeed * 4.0) * wake * 0.30;
    p.z += cos(uTime * 2.6 + aSeed * 6.0) * wake * 0.24;

    float cy = uRot.y;
    mat2 inv = mat2(cos(cy), sin(cy), -sin(cy), cos(cy));
    p.xz = inv * p.xz;

    vec3 world = p * uScale;
    float zc = uCamZ - world.z;

    vLife = life;
    vSeed = aSeed;
    vNear = smoothstep(1.0, 5.0, zc);

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

    // The sprite is the length of the streak, not the thickness of the grain —
    // the fragment squashes it across the wind, so a ten-pixel sprite draws a
    // ten by two streak. Sized against the camera depth, which is where the
    // fire's embers went wrong too: uSize over a depth of twenty-one is a very
    // different number from uSize.
    gl_PointSize = min(uSize * aScale * uPixelRatio / zc, 48.0 * uPixelRatio);
  }
`;

export const grainFragment = /* glsl */ `
  precision highp float;

  uniform float uOpacity;
  uniform float uErosion;
  uniform float uDust;
  uniform float uGust;
  uniform float uStreak;
  uniform vec3 uSand;

  varying float vLife;
  varying float vSeed;
  varying float vNear;

  void main() {
    // Drawn as a streak rather than a dot, by squashing the sprite across the
    // wind. A grain crossing the frame this fast covers several pixels while
    // the frame is open, so a round point is what it looks like stopped — and a
    // field of round points reads as a starfield however many there are.
    vec2 q = (gl_PointCoord - 0.5) * vec2(1.0, uStreak);
    float d = length(q);
    if (d > 0.5) discard;

    // Additive, at a low level each. A grain in the air is a speck catching the
    // sun against nothing, so it adds rather than covers — and with this many,
    // adding is what lets a gust thicken into haze where they pile up along the
    // line of sight.
    float shade = 0.4 + 0.6 * fract(vSeed * 0.379);

    // Warm, because the light on them is. A grain lit by a low sun through dust
    // is the same colour as the shafts it is flying through.
    vec3 tint = mix(vec3(1.0, 0.74, 0.48), vec3(1.0, 0.92, 0.80), shade);

    float alpha = smoothstep(0.5, 0.12, d)
      * smoothstep(0.0, 0.07, vLife)
      * (1.0 - smoothstep(0.45, 1.0, vLife))
      * vNear
      * (0.55 + uErosion * 1.1)
      * uDust
      * uGust;

    gl_FragColor = vec4(uSand * tint * 1.6 * shade * alpha * uOpacity, alpha * uOpacity);
  }
`;
