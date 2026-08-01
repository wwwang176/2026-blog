import { ExtrudeGeometry, Shape } from "three";

/**
 * The `CW.` monogram, built from scratch rather than loaded from a typeface.
 *
 * Keeping it procedural is the whole point: no font file, no GLTF, no loader —
 * the scene stays as dependency-free as the particle field it replaces. The
 * letterforms are deliberately coarse (few curve segments, one bevel segment)
 * so the extruded solid reads as low-poly and the wireframe stage has clean,
 * countable edges.
 *
 * Everything below works in a 1-unit em box: y runs -1 (baseline) to 1 (cap
 * height), and the caller recentres the finished geometry.
 */

const CAP = 1;
const BASE = -1;

/**
 * Offsets a polyline to both sides and joins the ends into a closed outline —
 * i.e. strokes it. Joints use a mitre, capped so the W's sharp valleys splay
 * into a short bevel instead of shooting off into a spike.
 */
function strokeOutline(points, halfWidth, mitreCap = 2.4) {
  const n = points.length;

  // Left-hand unit normal of every segment.
  const normals = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.hypot(dx, dy) || 1;
    normals.push({ x: -dy / len, y: dx / len });
  }

  const side = (sign) => {
    const out = [];

    for (let i = 0; i < n; i++) {
      let nx;
      let ny;
      let scale = 1;

      if (i === 0) {
        ({ x: nx, y: ny } = normals[0]);
      } else if (i === n - 1) {
        ({ x: nx, y: ny } = normals[n - 2]);
      } else {
        // Mitre direction is the bisector of the two adjacent normals; its
        // length has to grow as the corner tightens or the offset edges
        // wouldn't meet.
        const a = normals[i - 1];
        const b = normals[i];
        nx = a.x + b.x;
        ny = a.y + b.y;
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        scale = Math.min(1 / Math.max(nx * a.x + ny * a.y, 1e-4), mitreCap);
      }

      out.push({
        x: points[i].x + sign * nx * halfWidth * scale,
        y: points[i].y + sign * ny * halfWidth * scale,
      });
    }

    return out;
  };

  return side(1).concat(side(-1).reverse());
}

/** Sutherland–Hodgman against a single horizontal edge. */
function clipHalfPlane(poly, y, keepBelow) {
  const inside = (p) => (keepBelow ? p.y <= y : p.y >= y);
  const out = [];

  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];

    if (inside(cur) !== inside(prev)) {
      const t = (y - prev.y) / (cur.y - prev.y);
      out.push({ x: prev.x + (cur.x - prev.x) * t, y });
    }
    if (inside(cur)) out.push(cur);
  }

  return out;
}

function shapeFromPoints(points, offsetX) {
  const shape = new Shape();
  shape.moveTo(points[0].x + offsetX, points[0].y);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i].x + offsetX, points[i].y);
  }
  shape.closePath();
  return shape;
}

/**
 * `C` — an open annulus. The gap faces right and the terminals are cut on the
 * radius, which is what gives Space Grotesk's C its geometric, mechanical feel.
 */
function buildC(offsetX, { outer = 1, stroke = 0.32 } = {}) {
  const inner = outer - stroke;
  const from = (52 * Math.PI) / 180;
  const to = (308 * Math.PI) / 180;

  const shape = new Shape();
  shape.absarc(offsetX, 0, outer, from, to, false);
  // absarc draws the connecting line to the next arc's start for us, so the
  // two radial terminals come for free.
  shape.absarc(offsetX, 0, inner, to, from, true);
  shape.closePath();

  return shape;
}

/**
 * `W` — a stroked zigzag. The centreline runs past the cap line and below the
 * baseline so the clip can cut flat terminals and flat valleys, rather than
 * leaving them perpendicular to the diagonals.
 */
function buildW(offsetX, { halfWidth = 0.16 } = {}) {
  const centre = [
    { x: -0.86, y: 1.45 },
    { x: -0.45, y: -1.3 },
    { x: 0, y: 0.52 },
    { x: 0.45, y: -1.3 },
    { x: 0.86, y: 1.45 },
  ];

  let poly = strokeOutline(centre, halfWidth);
  poly = clipHalfPlane(poly, CAP, true);
  poly = clipHalfPlane(poly, BASE, false);

  return shapeFromPoints(poly, offsetX);
}

/** `.` — sits on the baseline, faceted to match the rest. */
function buildDot(offsetX, { radius = 0.17, segments = 12 } = {}) {
  const cy = BASE + radius;
  const points = [];

  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push({ x: Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }

  return shapeFromPoints(points, offsetX);
}

/**
 * Extruded `CW.`, centred on the origin and flat-shaded.
 *
 * `quality` only moves the tessellation of the round parts — the silhouette is
 * identical at every tier, so the monogram never changes shape between devices.
 */
export function buildMonogramGeometry({ quality = "high" } = {}) {
  const curveSegments = quality === "low" ? 6 : quality === "medium" ? 8 : 11;

  const shapes = [
    buildC(-1.95),
    buildW(0.5),
    buildDot(1.95),
  ];

  const geometry = new ExtrudeGeometry(shapes, {
    depth: 0.44,
    curveSegments,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.055,
    bevelOffset: 0,
    bevelSegments: 1,
  });

  geometry.center();

  // Flat shading needs one normal per face, which means no shared vertices.
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.computeVertexNormals();

  return flat;
}

/**
 * Per-triangle centroid, repeated across all three of its vertices.
 *
 * The mesh shader collapses each face toward this point, so the solid opens
 * along its own facet seams and hands over to the wireframe instead of just
 * cross-fading with it.
 */
export function computeCentroids(geometry) {
  const pos = geometry.getAttribute("position").array;
  const out = new Float32Array(pos.length);

  for (let i = 0; i < pos.length; i += 9) {
    const cx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3;
    const cy = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3;
    const cz = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3;

    for (let v = 0; v < 3; v++) {
      out[i + v * 3] = cx;
      out[i + v * 3 + 1] = cy;
      out[i + v * 3 + 2] = cz;
    }
  }

  return out;
}

/**
 * Area-weighted surface sampling.
 *
 * Rolled by hand rather than pulled from `three/examples/jsm` for two reasons:
 * it keeps the examples tree out of the bundle, and it lets the caller pass a
 * seeded PRNG so the particle stage is byte-identical on every load — the same
 * guarantee the existing field makes.
 */
export function sampleSurface(geometry, count, random) {
  const pos = geometry.getAttribute("position").array;
  const triangles = pos.length / 9;

  // Cumulative area, so a uniform draw picks a triangle in proportion to size.
  const cumulative = new Float64Array(triangles);
  let total = 0;

  for (let t = 0; t < triangles; t++) {
    const i = t * 9;
    const ax = pos[i + 3] - pos[i];
    const ay = pos[i + 4] - pos[i + 1];
    const az = pos[i + 5] - pos[i + 2];
    const bx = pos[i + 6] - pos[i];
    const by = pos[i + 7] - pos[i + 1];
    const bz = pos[i + 8] - pos[i + 2];

    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;

    total += Math.hypot(cx, cy, cz) * 0.5;
    cumulative[t] = total;
  }

  const out = new Float32Array(count * 3);

  for (let s = 0; s < count; s++) {
    const target = random() * total;

    let lo = 0;
    let hi = triangles - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }

    // Uniform barycentric point, folded back into the triangle.
    let u = random();
    let v = random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;

    const i = lo * 9;
    const o = s * 3;
    out[o] = pos[i] * w + pos[i + 3] * u + pos[i + 6] * v;
    out[o + 1] = pos[i + 1] * w + pos[i + 4] * u + pos[i + 7] * v;
    out[o + 2] = pos[i + 2] * w + pos[i + 5] * u + pos[i + 8] * v;
  }

  return out;
}
