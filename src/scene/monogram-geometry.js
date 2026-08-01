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
function buildC(offsetX, { outer = 1, stroke = 0.46 } = {}) {
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
function buildW(offsetX, { halfWidth = 0.23 } = {}) {
  // Widened along with the stroke: at the old spacing a 0.46 stem left the
  // two inner diagonals almost touching, and the counters closed up.
  const centre = [
    { x: -1.02, y: 1.45 },
    { x: -0.54, y: -1.3 },
    { x: 0, y: 0.58 },
    { x: 0.54, y: -1.3 },
    { x: 1.02, y: 1.45 },
  ];

  let poly = strokeOutline(centre, halfWidth);
  poly = clipHalfPlane(poly, CAP, true);
  poly = clipHalfPlane(poly, BASE, false);

  return shapeFromPoints(poly, offsetX);
}

/** `.` — sits on the baseline, faceted to match the rest. */
function buildDot(offsetX, { radius = 0.23, segments = 12 } = {}) {
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

  // Tracking is tight on purpose. Heavier letters need less air between them,
  // and the period sits closer to the W than the letters sit to each other.
  const shapes = [
    buildC(-2.3),
    buildW(0.35),
    buildDot(2.02),
  ];

  const geometry = new ExtrudeGeometry(shapes, {
    // Depth stays under the stroke width. Extruding deeper than the stem is
    // wide is what made the letters read as ribbons stood on edge — you saw
    // more side wall than face.
    depth: 0.34,
    curveSegments,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.042,
    bevelOffset: 0,
    // Three segments, not one. A single-segment bevel is a hard chamfer with
    // nowhere for a specular to travel; rolling the edge over a few faces is
    // most of what separates a rendered object from a flat cut-out.
    bevelSegments: 3,
  });

  geometry.center();

  // Flat shading needs one normal per face, which means no shared vertices.
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.computeVertexNormals();

  return flat;
}

/**
 * Averaged normals for coincident vertices.
 *
 * The geometry is flat-shaded and non-indexed, so every triangle owns its own
 * copies of its corners with its own face normal. Displacing along those
 * normals pulls neighbouring faces in different directions and the surface
 * tears into shards. Anything that inflates the mesh — the flame shell — has
 * to push along a normal the neighbours agree on.
 */
export function computeSmoothNormals(geometry) {
  const pos = geometry.getAttribute("position").array;
  const nor = geometry.getAttribute("normal").array;

  const key = (i) =>
    `${pos[i].toFixed(4)},${pos[i + 1].toFixed(4)},${pos[i + 2].toFixed(4)}`;

  const sums = new Map();

  for (let i = 0; i < pos.length; i += 3) {
    const k = key(i);
    let entry = sums.get(k);
    if (!entry) {
      entry = [0, 0, 0];
      sums.set(k, entry);
    }
    entry[0] += nor[i];
    entry[1] += nor[i + 1];
    entry[2] += nor[i + 2];
  }

  const out = new Float32Array(pos.length);

  for (let i = 0; i < pos.length; i += 3) {
    const [x, y, z] = sums.get(key(i));
    const len = Math.hypot(x, y, z) || 1;
    out[i] = x / len;
    out[i + 1] = y / len;
    out[i + 2] = z / len;
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
