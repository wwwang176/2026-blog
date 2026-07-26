/**
 * GLSL for the particle field.
 *
 * All four target shapes live in the geometry as separate attributes; the
 * vertex shader interpolates between them from a single `uProgress` uniform
 * (0 → 3). GSAP only ever animates that one float, so morphing costs the CPU
 * nothing.
 */

/* Ashima / Stefan Gustavson simplex noise — public domain. */
const SIMPLEX_3D = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const particleVertex = /* glsl */ `
uniform float uProgress;
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
uniform vec2  uPointer;

attribute vec3  aPos0;
attribute vec3  aPos1;
attribute vec3  aPos2;
attribute vec3  aPos3;
attribute float aScale;
attribute float aSeed;

varying float vMix;
varying float vAlpha;

${SIMPLEX_3D}

vec3 morph(float p) {
  if (p < 1.0) return mix(aPos0, aPos1, smoothstep(0.0, 1.0, p));
  if (p < 2.0) return mix(aPos1, aPos2, smoothstep(0.0, 1.0, p - 1.0));
  return mix(aPos2, aPos3, smoothstep(0.0, 1.0, p - 2.0));
}

void main() {
  float p = clamp(uProgress, 0.0, 3.0);
  vec3 pos = morph(p);

  // Organic drift — strongest at the loose "cloud" stage, never fully off.
  float cloudAmt = 1.0 - clamp(abs(p - 1.0), 0.0, 1.0);
  float n = snoise(pos * 0.28 + vec3(0.0, 0.0, uTime * 0.12) + aSeed);
  vec3 dir = normalize(pos + vec3(0.0001));
  pos += dir * n * (0.16 + cloudAmt * 0.85);

  // Travelling wave, faded in only on the final plane.
  float waveAmt = smoothstep(2.0, 3.0, p);
  pos.y += sin(pos.x * 0.55 + uTime * 0.9) * cos(pos.z * 0.4 - uTime * 0.6) * waveAmt * 0.6;

  // Cursor parallax — nearer/larger points move more.
  pos.xy += uPointer * (0.3 + aScale * 0.45);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * aScale * uPixelRatio * (1.0 / max(-mv.z, 0.1));

  vMix   = clamp(p / 3.0 + n * 0.2, 0.0, 1.0);
  vAlpha = 0.3 + aScale * 0.55;
}
`;

export const particleFragment = /* glsl */ `
precision mediump float;

uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uOpacity;

varying float vMix;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;

  float a = smoothstep(0.5, 0.05, d) * vAlpha * uOpacity;
  vec3  c = mix(uColorA, uColorB, vMix);

  gl_FragColor = vec4(c, a);
}
`;
