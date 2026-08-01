/**
 * Centrelines of `CW.`, and droplets placed along them.
 *
 * The distance field the fire is built from is an arc and four capsules, and a
 * capsule is a swept sphere — so the strokes already are chains of spheres,
 * drawn at a spacing of zero. Placing discrete droplets along the same
 * centrelines at a wider spacing gives back the same mark with the beading
 * left visible, which is the whole point of the liquid version.
 *
 * The numbers here are the same ones volumetric-fire-shaders.js authors its
 * distance field from. They are duplicated rather than shared because the two
 * need different things from them: the shader needs an SDF, this needs a
 * parametrised curve, and neither derives cleanly from the other.
 */

const DEG = Math.PI / 180;

const C_ORIGIN = [-1.775, 0];
const C_RADIUS = 0.77;
const C_HALF_ANGLE = 128 * DEG;

const W_ORIGIN = 0.875;
const W_SEGMENTS = [
  [[-1.02, 1.45], [-0.54, -1.30]],
  [[-0.54, -1.30], [0.0, 0.58]],
  [[0.0, 0.58], [0.54, -1.30]],
  [[0.54, -1.30], [1.02, 1.45]],
];

const PERIOD = [2.545, -0.77];

/** Where a segment crosses a given height. */
function xAtY(a, b, y) {
  return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
}

/**
 * The C, tessellated finely enough that even spacing along the polyline is
 * even spacing along the arc.
 */
function arcPolyline(steps = 64) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const th = -C_HALF_ANGLE + 2 * C_HALF_ANGLE * (i / steps);
    pts.push([
      C_ORIGIN[0] - C_RADIUS * Math.cos(th),
      C_ORIGIN[1] + C_RADIUS * Math.sin(th),
    ]);
  }
  return pts;
}

/**
 * The W as one connected run, cut flat at `lim` top and bottom.
 *
 * The distance field does this with max(d, abs(p.y) - 1.0), which trims the
 * terminals and — less obviously — the two bottom valleys, whose vertices sit
 * well below the baseline at y = -1.30. Following the raw centreline into
 * those vertices would hang the mark's bottom a third of a stroke lower than
 * the fire's. Cutting at the same height instead leaves a short flat run
 * across each valley, which is exactly what the fire's silhouette shows.
 *
 * `lim` is inset by the droplet radius so that it is the droplet's *edge*, not
 * its centre, that lands on the cap line.
 */
function wPolyline(lim) {
  const [s0, s1, s2, s3] = W_SEGMENTS;
  return [
    [xAtY(s0[0], s0[1], lim), lim],
    [xAtY(s0[0], s0[1], -lim), -lim],
    [xAtY(s1[0], s1[1], -lim), -lim],
    [s1[1][0], s1[1][1]], // the middle apex, which sits above the baseline
    [xAtY(s2[0], s2[1], -lim), -lim],
    [xAtY(s3[0], s3[1], -lim), -lim],
    [xAtY(s3[0], s3[1], lim), lim],
  ].map(([x, y]) => [x + W_ORIGIN, y]);
}

/**
 * Even spacing along a polyline, with a droplet on both ends.
 *
 * The requested spacing is a target, not a rule — it is adjusted to whatever
 * divides the run evenly. Landing exactly on the ends matters more, because
 * that is what keeps a terminal from stopping short of the cap line and what
 * puts a droplet on each corner of the W.
 */
function placeAlong(points, spacing) {
  const lengths = [];
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1]
    );
    lengths.push(d);
    total += d;
  }

  const n = Math.max(1, Math.round(total / spacing));
  const out = [];

  for (let k = 0; k <= n; k++) {
    let want = (total * k) / n;
    let i = 0;
    while (i < lengths.length - 1 && want > lengths[i]) {
      want -= lengths[i];
      i++;
    }
    const t = lengths[i] > 0 ? want / lengths[i] : 0;
    out.push([
      points[i][0] + (points[i + 1][0] - points[i][0]) * t,
      points[i][1] + (points[i + 1][1] - points[i][1]) * t,
    ]);
  }

  return out;
}

/**
 * Droplet centres and radii, flat and ready for a vec4 uniform array.
 *
 * Spacing against radius is what decides whether this reads as liquid or as a
 * necklace. Below about 1.2x radius the bulges disappear and it is just a
 * stroke; above about 1.8x the droplets separate and the mark comes apart.
 */
export function buildDroplets({ radius = 0.26, spacing = 0.36 } = {}) {
  const centres = [
    ...placeAlong(arcPolyline(), spacing),
    ...placeAlong(wPolyline(1.0 - radius), spacing),
    PERIOD,
  ];

  return {
    count: centres.length,
    centres,
    radius,
  };
}
