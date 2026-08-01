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
  varying vec3 vPos;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);

    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    // View-space position. The lighting needs this, not just the normal —
    // see the note in the fragment shader.
    vPos = mv.xyz;

    gl_Position = projectionMatrix * mv;
  }
`;

export const meshFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D uMatcap;
  uniform vec3 uColorB;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;

  void main() {
    vec3 n = normalize(vNormal);

    // The matcap earns its keep on the bevels and the side walls, where the
    // normal actually turns through the lookup.
    vec2 uv = n.xy * 0.5 + 0.5;
    vec3 col = texture2D(uMatcap, uv).rgb;

    // But a matcap cannot light flat extruded type on its own: every point on
    // a letter's face shares the normal (0,0,1), so the entire face samples a
    // single texel and comes out one dead colour. A light with a position
    // varies across the face because the position varies, which is the whole
    // difference between a surface and a silhouette.
    vec3 toLight = vec3(-7.0, 8.5, 14.0) - vPos;
    float dist = length(toLight);
    vec3 l = toLight / dist;

    float lambert = max(dot(n, l), 0.0);
    float falloff = 1.0 / (1.0 + dist * dist * 0.0032);
    col += vec3(1.0, 0.98, 0.95) * lambert * falloff * 1.25;

    // Tight specular, so the rolled bevel reads as an edge catching light.
    vec3 h = normalize(l + normalize(vView));
    col += vec3(1.0) * pow(max(dot(n, h), 0.0), 48.0) * falloff * 0.7;

    // A whisper of warm on the silhouette, tying it to the accent.
    float fres = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 5.0);
    col += uColorB * fres * 0.22;

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
