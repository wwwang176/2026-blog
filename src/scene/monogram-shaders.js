/**
 * Shaders for the three states the monogram passes through.
 *
 * All three are driven from one scroll value. The handover points matter more
 * than the states themselves: the solid opens along its own facets, the
 * wireframe is the seam that opening reveals, and the particles begin life on
 * the solid's surface — so nothing ever cross-fades into something that was
 * not already there.
 */

/* ── Solid ─────────────────────────────────────────────────────── */

export const meshVertex = /* glsl */ `
  attribute vec3 aCentroid;

  uniform float uShrink;
  uniform float uTime;

  varying vec3 vNormal;
  varying vec3 vView;
  varying float vShrink;

  void main() {
    // Each face retreats toward its own centroid and drifts out along its
    // normal, so the solid comes apart into the facets it was built from.
    vec3 p = mix(position, aCentroid, uShrink * 0.85);
    p += normal * uShrink * 0.18;

    // A breath of movement while the hero is still.
    p += normal * sin(uTime * 0.5 + aCentroid.x * 2.0) * 0.012;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);

    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    vShrink = uShrink;

    gl_Position = projectionMatrix * mv;
  }
`;

export const meshFragment = /* glsl */ `
  precision highp float;

  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vView;
  varying float vShrink;

  void main() {
    vec3 n = normalize(vNormal);

    // Two hard-coded lights rather than real ones: the look is fully art
    // directed and the scene stays free of lighting setup.
    float key  = max(dot(n, normalize(vec3(0.55, 0.85, 0.5))), 0.0);
    float fill = max(dot(n, normalize(vec3(-0.75, -0.25, 0.45))), 0.0);
    float fres = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 2.4);

    // The key stays near-neutral. Tinting it as well as the rim was what made
    // the solid read as bruised purple instead of dark metal.
    vec3 col = vec3(0.035)
      + vec3(0.62, 0.63, 0.70) * key * 0.55
      + uColorA * fill * 0.16
      + uColorB * fres * 0.5;

    // Faces brighten as they part, so the break-up reads as light getting in.
    col += uColorB * vShrink * 0.28;

    gl_FragColor = vec4(col, uOpacity);
  }
`;

/* ── Wireframe ─────────────────────────────────────────────────── */

export const lineVertex = /* glsl */ `
  attribute float aSeed;

  uniform float uReveal;

  varying float vFade;

  void main() {
    // Staggering by seed means the cage assembles edge by edge instead of
    // arriving all at once.
    vFade = smoothstep(aSeed * 0.55, aSeed * 0.55 + 0.45, uReveal);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const lineFragment = /* glsl */ `
  precision highp float;

  uniform vec3 uColor;
  uniform float uOpacity;

  varying float vFade;

  void main() {
    gl_FragColor = vec4(uColor, uOpacity * vFade);
  }
`;

/* ── Particles ─────────────────────────────────────────────────── */

export const pointVertex = /* glsl */ `
  attribute vec3 aFrom;
  attribute vec3 aTo;
  attribute float aScale;
  attribute float aSeed;

  uniform float uMorph;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform vec2 uPointer;

  varying float vDepth;
  varying float vSeed;

  void main() {
    // Eased so points leave the surface reluctantly and settle gently.
    float t = smoothstep(0.0, 1.0, uMorph);
    vec3 p = mix(aFrom, aTo, t);

    // Points bow outward mid-flight rather than sliding along a straight line.
    float arc = sin(t * 3.14159);
    p += normalize(aFrom + vec3(0.001)) * arc * (1.2 + aSeed * 0.02);

    // Idle drift, strongest once the points have scattered.
    float drift = 0.14 + t * 0.4;
    p.x += sin(uTime * 0.32 + aSeed) * drift;
    p.y += cos(uTime * 0.27 + aSeed * 1.7) * drift;

    p.xy += uPointer * 0.35;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    vSeed = aSeed;

    gl_PointSize = uSize * aScale * uPixelRatio / max(vDepth, 0.001);
    gl_Position = projectionMatrix * mv;
  }
`;

export const pointFragment = /* glsl */ `
  precision highp float;

  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;

  varying float vDepth;
  varying float vSeed;

  void main() {
    // Round out the point sprite and let it fall off softly at the rim.
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;

    float alpha = smoothstep(0.5, 0.12, d);
    vec3 col = mix(uColorA, uColorB, fract(vSeed * 0.37));

    // Fade with distance so the cloud keeps depth instead of reading flat.
    float depthFade = smoothstep(30.0, 8.0, vDepth);

    gl_FragColor = vec4(col, alpha * uOpacity * depthFade);
  }
`;
