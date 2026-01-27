/** Hash-ish pseudo-random in [0,1) from integer n. */
function rand01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** Smoothstep for soft transitions. */
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Return the centerline X offset for distance s along the walk.
 * This is a piecewise "turn" curve: the path holds a direction,
 * then smoothly turns into a new direction. Less regular than a sine.
 */
export function pathOffsetX(s) {
  // Segment size controls how often the corridor changes direction
  const SEG = 28; // smaller = more frequent turns, bigger = longer straights

  // Stronger curves: this scales overall sideways deviation
  const AMP = 6.5; // increase for more dramatic curves (try 9–12)

  // Which segment are we in?
  const k = Math.floor(s / SEG);
  const t = (s - k * SEG) / SEG; // 0..1 inside segment
  const u = smoothstep(t);

  // Random "target" offsets for each segment (centerline control points)
  const a = (rand01(k) - 0.5) * 2;       // -1..1
  const b = (rand01(k + 1) - 0.5) * 2;   // -1..1

  // Interpolate between control points for smooth turns
  const base = a + (b - a) * u;

  // Add a little secondary detail so it doesn't feel too linear
  const detail = Math.sin(s * 0.22) * 0.35 + Math.sin(s * 0.055 + 1.3) * 0.7;

  return base * AMP + detail;
}
