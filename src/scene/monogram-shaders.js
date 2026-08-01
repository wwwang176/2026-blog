/**
 * Shaders for the three states the monogram passes through.
 *
 * The states hand over by plain cross-fade. An earlier version had the solid
 * burst apart into its own facets on the way out; it was busy and it fought
 * the wireframe underneath, so the geometry now holds still and only opacity
 * moves. The particles still begin life on the solid's surface, so the
 * cross-fade lands on something already in the right place.
 */

/* ── Solid ─────────────────────────────────────────────────────── */

export const meshVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);

    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);

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

  void main() {
    vec3 n = normalize(vNormal);

    // Two hard-coded lights rather than real ones: the look is fully art
    // directed and the scene stays free of lighting setup. The key is kept
    // near-neutral — tinting key and rim both read as bruised purple.
    // The key has to be close to frontal. Angled at 45° it landed on the front
    // faces and the extruded side walls at almost the same intensity, which is
    // what flattened the whole monogram into a silhouette. Frontal gives the
    // faces roughly 4x the side walls, so the extrusion actually reads.
    float key  = max(dot(n, normalize(vec3(0.28, 0.5, 0.92))), 0.0);
    float fill = max(dot(n, normalize(vec3(-0.85, -0.15, 0.25))), 0.0);
    // Tight exponent on purpose: at 2.4 the whole extruded side wall sat
    // inside the falloff and the letters went muddy red. This keeps the warm
    // accent as an edge, which is all it was ever meant to be.
    float fres = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 4.0);

    vec3 col = vec3(0.035)
      + vec3(0.80, 0.81, 0.87) * key * 0.85
      + uColorA * fill * 0.22
      + uColorB * fres * 0.30;

    gl_FragColor = vec4(col, uOpacity);
  }
`;

/* ── Wireframe ─────────────────────────────────────────────────── */

export const lineVertex = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const lineFragment = /* glsl */ `
  precision highp float;

  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
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
  uniform float uModelScale;

  varying float vDepth;
  varying float vSeed;

  void main() {
    // aFrom is a sample taken on the unscaled solid, so it has to pick up the
    // same scale the solid is drawn at or the cloud lands the wrong size —
    // the lattice it flies to is already in world units and must not scale.
    vec3 from = aFrom * uModelScale;

    float t = smoothstep(0.0, 1.0, uMorph);
    vec3 p = mix(from, aTo, t);

    // Drift has to start at exactly zero, otherwise the cloud is already
    // jittering off the surface at the moment it is meant to match it.
    float drift = t * 0.45;
    p.x += sin(uTime * 0.32 + aSeed) * drift;
    p.y += cos(uTime * 0.27 + aSeed * 1.7) * drift;

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
    float depthFade = smoothstep(34.0, 8.0, vDepth);

    gl_FragColor = vec4(col, alpha * uOpacity * depthFade);
  }
`;
