/**
 * Deterministic Reticulum-node identicon (F7a mesh map).
 *
 * A VERBATIM port of crosstalk's `NetworkVisualiser.vue::identiconDataUri`
 * (the same algorithm as its `Identicon.vue`): a 5×5 mirrored bitmap whose
 * cells + palette are chosen by a `mulberry32` PRNG seeded from the Reticulum
 * destination hash, rendered as an inline `data:image/svg+xml` URI. Because
 * the seed is the hash and the PRNG is deterministic, the SAME hash always
 * yields the SAME SVG — so a peer keeps a stable "face" across refreshes and
 * across machines.
 *
 * CSP-safe: the output is a self-contained `data:` URI (no network fetch, no
 * external asset), exactly what Concord's strict CSP requires — keep it that
 * way (never swap this for a remote image or a blob URL).
 *
 * The result is cached per-hash so a re-render doesn't re-encode the SVG.
 */

/** Fixed palettes `[primary, accent, background]`, verbatim from crosstalk. */
const PALETTES: readonly (readonly [string, string, string])[] = [
  ["#0061fd", "#7db0ff", "#0c1220"],
  ["#2ee781", "#9ff5c6", "#0b1a13"],
  ["#ff9900", "#ffc266", "#1d1408"],
  ["#b779ff", "#dcbcff", "#160f22"],
  ["#22d3ee", "#a5f3fc", "#082026"],
  ["#ff5c8a", "#ffadc4", "#220d14"],
  ["#8da2fb", "#c7d2fe", "#10142a"],
  ["#f4e04d", "#faf0a0", "#1e1b08"],
];

/** Per-hash cache so vis-network-style repeated reads don't re-encode. */
const cache = new Map<string, string>();

/**
 * Deterministic identicon SVG data-URI for a Reticulum destination hash.
 * Same algorithm as crosstalk's `identiconDataUri` — do not "improve" it, the
 * point is byte-stable output for a given hash.
 */
export function identiconDataUri(hash: string): string {
  const cached = cache.get(hash);
  if (cached) return cached;

  // mulberry32 prng seeded from the hash string.
  let seed = 0;
  const value = String(hash ?? "");
  for (let i = 0; i < value.length; i++) {
    seed = Math.imul(seed ^ value.charCodeAt(i), 2654435761);
  }
  seed = seed >>> 0;
  const random = function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const size = 5;
  const [primary, accent, background] =
    PALETTES[Math.floor(random() * PALETTES.length)];
  let rects = "";
  const half = Math.ceil(size / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < half; x++) {
      const roll = random();
      let colour: string | null = null;
      if (roll < 0.44) colour = primary;
      else if (roll < 0.58) colour = accent;
      if (colour) {
        rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${colour}"/>`;
        const mirrorX = size - 1 - x;
        if (mirrorX !== x) {
          rects += `<rect x="${mirrorX}" y="${y}" width="1" height="1" fill="${colour}"/>`;
        }
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${background}"/>${rects}</svg>`;
  const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(hash, dataUri);
  return dataUri;
}
