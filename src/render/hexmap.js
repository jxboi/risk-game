// Procedural hex-tile world. Pure data (no three.js) so it can be tested.
//
// Land grows from each territory's seed points. Wherever two territories
// would touch without being adjacent in the rules, the touching tiles are
// flooded, so the board never lies about what can attack what.

import { TERRITORIES, NEIGHBORS } from '../data/map.js';
import { mulberry32 } from '../game/rng.js';

export const HEX = 0.92; // hex radius in map units
const W = 100, H = 60;
const SQ3 = Math.sqrt(3);

function makeNoise(seed) {
  const rng = mulberry32(seed);
  const P = 64;
  const grid = Array.from({ length: P * P }, () => rng());
  const at = (x, y) => grid[((y % P + P) % P) * P + ((x % P + P) % P)];
  const smooth = (t) => t * t * (3 - 2 * t);
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x, y) => n2(x, y) * 0.6 + n2(x * 2.1, y * 2.1) * 0.3 + n2(x * 4.3, y * 4.3) * 0.1;
}

// Axial neighbours for "odd-r" offset rows.
function neighborsOf(col, row) {
  const odd = row & 1;
  const d = odd
    ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
    : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  return d.map(([dc, dr]) => [col + dc, row + dr]);
}

export function buildHexMap(seed = 7) {
  const noise = makeNoise(seed);
  const dx = SQ3 * HEX, dy = 1.5 * HEX;
  const cols = Math.ceil(W / dx) + 1, rows = Math.ceil(H / dy) + 1;
  const cells = [];
  const index = new Map();
  const key = (c, r) => c * 1000 + r;

  const seeds = [];
  TERRITORIES.forEach((t, ti) => t.seeds.forEach(([x, y]) => seeds.push({ x, y, ti })));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * dx + (r & 1 ? dx / 2 : 0);
      const y = r * dy;
      // Domain-warp the distance so coasts and borders are organic.
      const wx = x + (noise(x * 0.12, y * 0.12) - 0.5) * 3.2;
      const wy = y + (noise(x * 0.12 + 40, y * 0.12 + 40) - 0.5) * 3.2;
      let best = Infinity, bestT = -1;
      for (const s of seeds) {
        const d = Math.hypot(wx - s.x, wy - s.y);
        if (d < best) { best = d; bestT = s.ti; }
      }
      const coast = 2.7 + noise(x * 0.25 + 9, y * 0.25) * 1.9;
      const t = best < coast ? bestT : -1;
      const cell = { c, r, x, y, t, h: 0 };
      index.set(key(c, r), cells.length);
      cells.push(cell);
    }
  }

  const nb = (cell) => neighborsOf(cell.c, cell.r)
    .map(([c, r]) => index.get(key(c, r)))
    .filter((i) => i !== undefined)
    .map((i) => cells[i]);

  // Flood tiles where non-adjacent territories touch.
  let changed = true;
  while (changed) {
    changed = false;
    for (const cell of cells) {
      if (cell.t < 0) continue;
      for (const n of nb(cell)) {
        if (n.t >= 0 && n.t !== cell.t && !NEIGHBORS[cell.t].includes(n.t)) {
          // Flood whichever of the two is further from its own seed.
          const dc = seedDist(cell), dn = seedDist(n);
          (dc > dn ? cell : n).t = -1;
          changed = true;
          break;
        }
      }
    }
  }
  function seedDist(cell) {
    return Math.min(...TERRITORIES[cell.t].seeds.map(([x, y]) => Math.hypot(cell.x - x, cell.y - y)));
  }

  // Keep only each territory's largest connected piece.
  for (let ti = 0; ti < TERRITORIES.length; ti++) {
    const mine = cells.filter((c) => c.t === ti);
    const seen = new Set();
    let biggest = [];
    for (const start of mine) {
      if (seen.has(start)) continue;
      const comp = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        for (const n of nb(cur)) if (n.t === ti && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
      if (comp.length > biggest.length) biggest = comp;
    }
    const keep = new Set(biggest);
    for (const c of mine) if (!keep.has(c)) c.t = -1;
  }

  // Heights, border flags, and per-territory info.
  const land = cells.filter((c) => c.t >= 0);
  for (const cell of land) {
    const n = noise(cell.x * 0.18 + 100, cell.y * 0.18);
    cell.h = 0.35 + n * 0.55 + (n > 0.72 ? (n - 0.72) * 3 : 0); // occasional highlands
    const ns = nb(cell);
    cell.edge = ns.some((o) => o.t !== cell.t);
    cell.coast = ns.some((o) => o.t < 0) || ns.length < 6;
  }

  const territories = TERRITORIES.map((t, ti) => {
    const mine = land.filter((c) => c.t === ti);
    const [sx, sy] = t.seeds[0];
    // Token sits on the tile closest to the first seed.
    let anchor = mine[0], bd = Infinity;
    for (const c of mine) {
      const d = Math.hypot(c.x - sx, c.y - sy) + (c.edge ? 1.5 : 0);
      if (d < bd) { bd = d; anchor = c; }
    }
    const cx = mine.reduce((s, c) => s + c.x, 0) / mine.length;
    const cy = mine.reduce((s, c) => s + c.y, 0) / mine.length;
    return { ti, cells: mine, anchor, cx, cy };
  });

  // Which rule-adjacencies share a land border, and which cross water.
  const touching = new Set();
  for (const cell of land) {
    for (const n of nb(cell)) if (n.t >= 0 && n.t !== cell.t) touching.add(Math.min(cell.t, n.t) * 100 + Math.max(cell.t, n.t));
  }
  const seaLanes = [];
  NEIGHBORS.forEach((ns, a) => ns.forEach((b) => {
    if (a < b && !touching.has(a * 100 + b)) seaLanes.push([a, b]);
  }));

  return { cells, land, territories, seaLanes, touching, width: W, height: H };
}
