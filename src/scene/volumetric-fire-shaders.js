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

/* ── Embers ────────────────────────────────────────────────────── */

/**
 * Sparks lifting off the fire.
 *
 * These have to project themselves. The volume marches through a pinhole
 * camera written by hand in the fragment shader, and the scene camera is a
 * placeholder the render pass needs but nothing uses — so points added the
 * ordinary way would be projected by a matrix that has nothing to do with
 * what is on screen. Repeating the same projection here is what keeps them
 * sitting in the fire rather than floating somewhere near it.
 */
export const emberVertex = /* glsl */ `
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
  uniform float uDisperse;
  uniform float uSize;
  uniform float uPixelRatio;

  varying float vLife;
  varying float vSeed;

  void main() {
    // Each ember runs its own slow loop, well out of step with its neighbours.
    float rate = 0.14 + hash11(aSeed) * 0.2;
    float life = fract(aSeed * 0.613 + uTime * rate);

    vec3 p = aAnchor;

    // Buoyancy, accelerating — hot air does not lift at a constant rate.
    p.y += life * life * (5.2 + hash11(aSeed + 4.4) * 6.8);

    // Embers wander. Straight lines read as rain going the wrong way.
    p.x += sin(uTime * 1.5 + aSeed * 7.0) * life * 1.6;
    p.z += cos(uTime * 1.2 + aSeed * 5.0) * life * 1.2;

    p.y += uDisperse * uDisperse * 5.0;

    // The volume rotates its sampling frame, which turns the object the other
    // way — so the embers take the inverse to stay with it.
    float cy = uRot.y;
    mat2 inv = mat2(cos(cy), sin(cy), -sin(cy), cos(cy));
    p.xz = inv * p.xz;

    vec3 world = p * uScale;

    float zc = uCamZ - world.z;
    vec2 ndc = vec2(
      world.x / (zc * uAspect * uTanHalfFov),
      world.y / (zc * uTanHalfFov)
    );

    vLife = life;
    vSeed = aSeed;

    gl_PointSize = uSize * aScale * (1.0 - life * 0.55) * uPixelRatio / max(zc, 0.001);
    gl_Position = vec4(ndc, 0.0, 1.0);
  }
`;

export const emberFragment = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uOpacity;

  varying float vLife;
  varying float vSeed;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;

    float core = smoothstep(0.5, 0.0, d);

    // Plain warm yellow, cooling toward orange as it climbs. Nothing clever —
    // the volume behind them is carrying the detail.
    vec3 col = mix(vec3(1.0, 0.86, 0.42), vec3(1.0, 0.42, 0.10), vLife);

    // Embers wink as they tumble.
    float flicker = 0.65 + 0.35 * sin(uTime * 9.0 + vSeed * 12.0);

    float alpha = pow(core, 2.2)
      * smoothstep(0.0, 0.06, vLife)
      * (1.0 - smoothstep(0.45, 1.0, vLife))
      * flicker;

    gl_FragColor = vec4(col, alpha * uOpacity);
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
  uniform float uFuel;
  uniform int uSteps;

  varying vec2 vUv;

  /**
   * Density and the turbulence that produced it, so temperature can reuse it.
   *
   * The important part is that the noise moves the sample rather than eroding
   * the threshold. Subtracting noise from a distance field can only ever make
   * a boundary fuzzy — it stays the boundary of the letter. Displacing the
   * position and then asking the letter where that point falls lets the whole
   * shape flow, which is what a tongue of flame actually is.
   *
   * The noise is also anisotropic. Flame structures are tall and narrow, so it
   * is compressed along y and scrolled upward; sampling it isotropically was
   * why the earlier version read as drifting cloud rather than as fire.
   */
  /**
   * How far above the letterform's cap a sample sits, capped so the plume has
   * an end. Everything above the cap is material that rose to get there.
   */
  float aboveCap(vec3 p) {
    return min(max(p.y - 0.95, 0.0), 3.9);
  }

  /**
   * Surface normal of the fuel, by central differences.
   *
   * Six extra distance evaluations, but only ever once per ray, at the point
   * the march stops — cheap enough that it is not worth approximating.
   */
  vec3 fuelNormal(vec3 p) {
    vec2 e = vec2(0.014, 0.0);
    return normalize(vec3(
      sdMonogram(p + e.xyy) - sdMonogram(p - e.xyy),
      sdMonogram(p + e.yxy) - sdMonogram(p - e.yxy),
      sdMonogram(p + e.yyx) - sdMonogram(p - e.yyx)
    ));
  }

  vec2 fieldAt(vec3 p) {
    vec3 q = p * vec3(1.85, 0.72, 1.85) + vec3(0.0, -uTime * 3.9, uTime * 0.3);

    float n1 = fbm(q);
    float n2 = fbm(q * 2.35 + 19.7);
    float n3 = fbm(q * 0.62 - 7.3);

    float above = aboveCap(p);

    // Displacement is small at the base, where the letterform has to stay
    // readable, and grows with height where the flame is free to break up.
    float grow = 0.10 + smoothstep(-1.05, 1.2, p.y) * 0.5 + above * 0.5;

    // Pulling the sample back down to the cap is what turns a smear into a
    // plume. Material at height h rose from the source to get there, so it is
    // the source that should be sampled — displaced by everything the noise
    // did to it on the way up. Without this the flame could only reach as far
    // above the letters as the displacement itself, which is why it sat on
    // the caps like a lid.
    vec3 warped = p - vec3(0.0, above, 0.0)
      + vec3(
          (n2 - 0.5) * (1.0 + above * 1.7),
          (n1 - 0.34) * 1.5,
          (n3 - 0.5) * (1.0 + above * 0.9)
        ) * grow;

    float d = sdMonogram(warped);

    float turb = n1 * 0.62 + n2 * 0.38;

    // The flame wraps the fuel instead of being made of it. Density lives in
    // a band just outside the surface and is absent inside, because the
    // monogram is the thing that is burning — the log, not the fire.
    //
    // The band alone still coated the faces pointed at the camera, and a ray
    // crossing all of that before reaching the wood turned every letter into
    // a pale wash. Flame climbs off edges; the broad flat side of a burning
    // log stays comparatively clear.
    //
    // Which face a sample sits off is decided by whichever term dominates the
    // extrusion: the lateral distance to the outline, or the distance beyond
    // the flat face. Testing the outline distance alone did not work, because
    // these strokes are 0.46 wide so nothing inside them is ever more than
    // 0.23 from the outline — the threshold could not be reached and the
    // suppression sat at half strength across the whole letter.
    float dxy = sdOutline(warped.xy);
    float dz = abs(warped.z) - 0.22;
    float rim = smoothstep(-0.14, 0.14, dxy - dz);

    // Flame sits on top of what is burning, it does not wrap it. An even band
    // around the whole silhouette is not fire, it is a stroke around the
    // letters — which is exactly what it looked like. Asking whether the fuel
    // is just below the sample keeps it to the upward-facing parts and leaves
    // the undersides and outer flanks clear.
    float onTop = smoothstep(0.28, -0.12, sdMonogram(warped - vec3(0.0, 0.32, 0.0)));

    float shell = smoothstep(0.5, 0.04, d) * smoothstep(-0.1, 0.05, d) * rim * onTop * 0.68;

    // Material that has climbed clear of the fuel is no longer attached to a
    // surface, so the band restriction lifts and the plume fills out.
    float detached = smoothstep(0.06, 0.6, above);
    float body = smoothstep(0.30, -0.08, d);

    // With the fuel drawn, flame only clings to it and the solid carries the
    // shape. With the fuel hidden there is nothing else to read the monogram
    // from, so the letterform interior has to burn too — otherwise all that
    // survives is a few tongues with no word under them.
    float filled = body * (1.0 - uFuel) * 1.7;

    float dens = max(mix(shell, max(shell, body), detached), filled)
      * (0.22 + turb * 0.8);

    // A ceiling that belongs to each column rather than to the frame. Fading
    // on height alone gave every part of the flame the same height and a top
    // edge running parallel to the letters — the tell. Sampling noise that
    // varies across x and z but not y, and drifts in time, means each part of
    // the mark burns to its own height and keeps changing its mind.
    vec3 cp = vec3(p.x * 1.15, uTime * 1.58, p.z * 1.15);
    float column = vnoise(cp) * 0.66 + vnoise(cp * 2.7 + 5.1) * 0.34;
    float top = 0.7 + column * 4.2;
    dens *= 1.0 - smoothstep(top - 1.3, top, p.y);

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
    vec3 lo = vec3(-4.3, -2.0, -1.6) * uScale;
    // Tall enough for the ragged ceiling, which can reach roughly 4.9.
    vec3 hi = vec3( 4.3, (5.2 + lift), 1.6) * uScale;

    float t0, t1;
    if (!boxHit(ro, rd, lo, hi, t0, t1)) discard;
    t0 = max(t0, 0.0);

    // Step length inside the volume, in local units. Sized against the field's
    // detail rather than against the box, so the sampling rate does not change
    // with viewing angle.
    float ds = 0.075;
    float dt = ds * uScale;

    // The furthest a sample can be displaced and still land inside the letter,
    // so anything beyond this is guaranteed empty. It has to cover the warp —
    // up to about a unit vertically — or the skip clips the tongues off.
    float reach = 1.75;

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

      // Marching the whole box at a fixed rate meant evaluating three fbm at
      // every sample, most of them in empty air. The distance field is cheap
      // by comparison, so it is used first to jump the gaps — this is the
      // difference between an unusable frame rate and a workable one.
      //
      // It has to test the same place the field will sample, which is the
      // source the material rose from, not where it ended up. Testing the raw
      // position skipped the entire plume as empty.
      float above = aboveCap(p);
      vec3 src = p - vec3(0.0, above, 0.0);
      float sd = sdMonogram(src);
      if (sd > reach) {
        t += max((sd - reach) * uScale, dt);
        continue;
      }

      // The fuel is off by default. It only ever existed to give the flame a
      // shape to be born from, and drawing it put a solid grey letterform in
      // the middle of the fire — the monogram should be legible from what is
      // burning, not from the object doing the burning. With it off the ray
      // passes straight through and flame from the far side shows through the
      // near side, which is what fire actually does.
      if (uFuel > 0.5 && above <= 0.0 && sd < 0.0) {
        vec3 n = fuelNormal(p);

        float grain = fbm(p * 3.1 + vec3(0.0, -uTime * 0.22, 0.0));

        // Charred, with the noise peaks still alight — hottest low down where
        // the flame is thickest against it.
        float ember = smoothstep(0.50, 0.80, grain) * (1.0 - smoothstep(-1.1, 1.2, p.y));

        vec3 wood = vec3(0.030, 0.025, 0.024) * (0.45 + grain * 0.95);
        wood += fireRamp(clamp(ember * 1.05, 0.0, 1.0)) * ember * 2.1;
        wood += vec3(0.17, 0.15, 0.13) * max(dot(n, normalize(vec3(-0.4, 0.75, 0.85))), 0.0);

        col += trans * wood;
        trans = 0.0;
        break;
      }

      vec2 f = fieldAt(p);
      float dens = f.x;

      // Inside the plume the distance field can no longer skip anything — the
      // whole column counts as near the source. Most of it is still almost
      // empty though, so thin samples buy a longer stride. It contributes
      // nothing to the image and it is where the frames were going.
      if (dens <= 0.008) {
        t += dt * 2.5;
        continue;
      }

      t += dt;

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
