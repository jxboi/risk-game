// Computer opponents. Each call to `nextAction` returns ONE legal action for
// the current player, so the controller can animate between steps.
//
// Levels, from weakest to strongest:
//   recruit  - reactive, attacks only sure things, scatters armies
//   soldier  - stacks armies, attacks at good odds, fortifies the front
//   general  - picks a target continent, uses exact odds, defends chokepoints
//   warlord  - general + breaks rival continents, hunts weak players for
//              their cards, and holds card sets for bigger trades

import {
  CONTINENTS, NEIGHBORS, T_CONTINENT, CONTINENT_MEMBERS, CONTINENT_BORDERS,
} from '../data/map.js';
import { battleOdds } from './dice.js';
import { N } from './game.js';

export const LEVELS = {
  recruit: { name: 'Recruit', rank: 0, blurb: 'Learning the ropes. Cautious and unfocused.' },
  soldier: { name: 'Soldier', rank: 1, blurb: 'Solid fundamentals. Stacks armies and presses advantages.' },
  general: { name: 'General', rank: 2, blurb: 'Plays for continents, calculates odds, guards chokepoints.' },
  warlord: { name: 'Warlord', rank: 3, blurb: 'Ruthless. Breaks your bonuses and hunts for cards.' },
};

const rankOf = (level) => LEVELS[level]?.rank ?? 1;

function enemyNeighbors(g, t) {
  return NEIGHBORS[t].filter((n) => g.owner[n] !== g.owner[t]);
}
function isBorder(g, t) { return enemyNeighbors(g, t).length > 0; }

// Largest enemy stack that can hit t.
function threatTo(g, t) {
  let m = 0;
  for (const n of NEIGHBORS[t]) if (g.owner[n] !== g.owner[t]) m = Math.max(m, g.armies[n] - 1);
  return m;
}

// How attractive a continent is to `p` right now (higher is better).
function continentScore(g, p, ci) {
  const members = CONTINENT_MEMBERS[ci];
  let own = 0, ownArmies = 0, enemyArmies = 0;
  for (const t of members) {
    if (g.owner[t] === p) { own++; ownArmies += g.armies[t]; } else enemyArmies += g.armies[t];
  }
  const frac = own / members.length;
  const borders = CONTINENT_BORDERS[ci].length;
  // Bonus per chokepoint to hold, weighted by how much we already hold and
  // how cheap the rest is to take.
  const holdable = CONTINENTS[ci].bonus / borders;
  const cost = enemyArmies / Math.max(1, ownArmies + g.reinforcements);
  return holdable * (0.4 + frac * frac * 2) - cost * 0.8 + (frac === 1 ? 1.5 : 0);
}

function targetContinent(g, p) {
  let best = 0, bestS = -Infinity;
  for (let ci = 0; ci < CONTINENTS.length; ci++) {
    const s = continentScore(g, p, ci);
    if (s > bestS && CONTINENT_MEMBERS[ci].some((t) => g.owner[t] !== p || isBorder(g, t))) {
      bestS = s; best = ci;
    }
  }
  return best;
}

// Value of taking territory `to` for player p.
function captureValue(g, p, to, level) {
  const r = rankOf(level);
  const ci = T_CONTINENT[to];
  const defender = g.owner[to];
  const members = CONTINENT_MEMBERS[ci];
  const missing = members.filter((t) => g.owner[t] !== p).length;
  let v = 1;
  if (r >= 1 && !g.conqueredThisTurn) v += 1.5; // earn the card
  if (r >= 2) {
    const tgt = targetContinent(g, p);
    if (ci === tgt) v += 1.5;
    if (missing === 1) v += CONTINENTS[ci].bonus * 0.9; // completes a continent
  }
  if (r >= 3) {
    if (g.ownsContinent(defender, ci)) v += CONTINENTS[ci].bonus * 1.1; // break it
    const dCount = g.countOf(defender);
    if (dCount <= 3) v += (4 - dCount) * (1 + g.players[defender].cards.length);
    // Punish leaders.
    const lead = g.countOf(defender) - g.countOf(p);
    if (lead > 4) v += 1;
  }
  return v;
}

function attackCandidates(g, level) {
  const p = g.current;
  const out = [];
  for (let from = 0; from < N; from++) {
    if (g.owner[from] !== p || g.armies[from] < 2) continue;
    for (const to of NEIGHBORS[from]) {
      if (g.owner[to] === p) continue;
      const o = battleOdds(g.armies[from] - 1, g.armies[to]);
      out.push({ from, to, odds: o.win, loss: o.expAttLoss, value: captureValue(g, p, to, level) });
    }
  }
  return out;
}

// ---- reinforcement ------------------------------------------------------

function chooseReinforce(g, level, pool) {
  const p = g.current;
  const own = g.territoriesOf(p);
  const borders = own.filter((t) => isBorder(g, t));
  const r = rankOf(level);
  const rng = g.rng;

  if (r === 0) {
    const pick = borders.length ? borders[Math.floor(rng() * borders.length)] : own[0];
    return { t: pick, n: Math.min(pool, 1 + Math.floor(rng() * 3)) };
  }

  if (r === 1) {
    // Stack on the border territory with the best attack prospects.
    let best = borders[0] ?? own[0], bestS = -Infinity;
    for (const t of borders) {
      const weakest = Math.min(...enemyNeighbors(g, t).map((n) => g.armies[n]));
      const s = g.armies[t] - weakest + rng() * 0.5;
      if (s > bestS) { bestS = s; best = t; }
    }
    return { t: best, n: pool };
  }

  // General / Warlord.
  // 1) Shore up owned continents whose chokepoints are outgunned.
  for (const ci of g.continentsOf(p)) {
    for (const t of CONTINENT_BORDERS[ci]) {
      if (g.owner[t] !== p) continue;
      const need = Math.ceil(threatTo(g, t) * 0.9) - g.armies[t];
      if (need > 0 && threatTo(g, t) >= 3) return { t, n: Math.min(pool, need) };
    }
  }
  // 2) Build a strike stack toward the target continent.
  const tgt = targetContinent(g, p);
  let best = null, bestS = -Infinity;
  for (const t of borders) {
    let s = 0;
    for (const n of enemyNeighbors(g, t)) {
      const inTarget = T_CONTINENT[n] === tgt ? 3 : 0;
      s = Math.max(s, inTarget + captureValue(g, p, n, level) - g.armies[n] * 0.35);
    }
    s += g.armies[t] * 0.08; // prefer an existing stack
    if (T_CONTINENT[t] === tgt) s += 1;
    if (s > bestS) { bestS = s; best = t; }
  }
  return { t: best ?? own[0], n: pool };
}

// Initial deployment: spread armies over the front, favouring the target
// continent, instead of piling everything on one territory.
function chooseSetup(g, level) {
  const p = g.current;
  const r = rankOf(level);
  const own = g.territoriesOf(p);
  const borders = own.filter((t) => isBorder(g, t));
  const pool = borders.length ? borders : own;
  if (r === 0) return { type: 'setup', t: pool[Math.floor(g.rng() * pool.length)], n: 1 };
  const tgt = targetContinent(g, p);
  let best = pool[0], bestS = -Infinity;
  for (const t of pool) {
    const s = (T_CONTINENT[t] === tgt ? 3 : 0) + enemyNeighbors(g, t).length * 0.4
      + threatTo(g, t) * 0.15 - g.armies[t] * 0.45 + g.rng() * 0.3;
    if (s > bestS) { bestS = s; best = t; }
  }
  return { type: 'setup', t: best, n: Math.min(g.player.pool, r >= 2 ? 2 : 1) };
}

// ---- fortify ------------------------------------------------------------

function chooseFortify(g, level) {
  const p = g.current;
  const r = rankOf(level);
  if (r === 0 && g.rng() < 0.6) return null;
  const own = g.territoriesOf(p);
  // Source: interior territory (no enemy neighbours) with most spare armies,
  // or for weaker AIs any territory with a big spare stack.
  let src = null, srcN = 1;
  for (const t of own) {
    if (g.armies[t] <= 1) continue;
    const interior = !isBorder(g, t);
    const spare = interior ? g.armies[t] - 1 : 0;
    if (spare > srcN) { srcN = spare; src = t; }
  }
  if (src === null) return null;
  const reach = [...g.connectedOwned(src)].filter((t) => isBorder(g, t));
  if (!reach.length) return null;
  // Destination: most threatened border, weighted by continent importance.
  let dst = reach[0], dstS = -Infinity;
  for (const t of reach) {
    let s = threatTo(g, t) - g.armies[t];
    if (r >= 2 && CONTINENT_BORDERS[T_CONTINENT[t]].includes(t) && g.ownsContinent(p, T_CONTINENT[t])) s += 4;
    if (r >= 2) s += Math.max(...enemyNeighbors(g, t).map((n) => captureValue(g, p, n, level))) * 0.5;
    if (s > dstS) { dstS = s; dst = t; }
  }
  return { from: src, to: dst, n: g.armies[src] - 1 };
}

// ---- occupy -------------------------------------------------------------

function chooseOccupy(g, level) {
  const { from, to, min, max } = g.pendingOccupy;
  const r = rankOf(level);
  const fromBorder = NEIGHBORS[from].some((n) => g.owner[n] !== g.current);
  const toBorder = NEIGHBORS[to].some((n) => g.owner[n] !== g.current);
  if (!fromBorder) return max - min; // push everything forward
  if (!toBorder) return 0;
  if (r === 0) return Math.floor((max - min) / 2);
  // Keep enough behind to match the threat at `from`.
  const keep = Math.min(max - min, Math.ceil(threatTo(g, from) * (r >= 2 ? 0.8 : 0.5)));
  return Math.max(0, max - min - keep);
}

// ---- main entry point ----------------------------------------------------

export function nextAction(g, level = g.player.level) {
  const p = g.player;
  const r = rankOf(level);

  if (g.phase === 'setup') return chooseSetup(g, level);

  if (g.phase === 'reinforce') {
    const set = g.bestSet(p.id);
    if (set) {
      const forced = g.mustTrade();
      const holdForValue = r >= 3 && !forced && g.nextTradeValue() < 8 && p.cards.length < 4;
      if (forced || (r >= 1 && !holdForValue)) return { type: 'trade', cards: set };
    }
    if (g.reinforcements === 0 && g.resumeAttack) return { type: 'resume' };
    const c = chooseReinforce(g, level, g.reinforcements);
    return { type: 'place', t: c.t, n: Math.max(1, Math.min(c.n, g.reinforcements)) };
  }

  if (g.phase === 'occupy') return { type: 'occupy', n: chooseOccupy(g, level) };

  if (g.phase === 'attack') {
    const cands = attackCandidates(g, level);
    let best = null, bestS = -Infinity;
    for (const c of cands) {
      let threshold, score;
      if (r === 0) { threshold = 0.8; score = c.odds; }
      else if (r === 1) { threshold = 0.62; score = c.odds + c.value * 0.05; }
      else {
        threshold = 0.5 - Math.min(0.2, c.value * 0.03);
        score = c.odds * c.value - (1 - c.odds) * 1.2;
      }
      if (c.odds < threshold) continue;
      if (score > bestS) { bestS = score; best = c; }
    }
    if (r === 0 && best && g.rng() < 0.25) best = null;
    if (best && (r >= 2 ? bestS > 0 : true)) return { type: 'blitz', from: best.from, to: best.to };
    return { type: 'endAttack' };
  }

  if (g.phase === 'fortify') {
    const f = chooseFortify(g, level);
    if (f && f.n > 0) return { type: 'fortify', ...f };
    return { type: 'endTurn' };
  }

  return null;
}

// Apply an action from `nextAction` to the game. Returns whatever the game
// method returned (battle rolls for blitz, true/false otherwise).
export function applyAction(g, a) {
  switch (a.type) {
    case 'setup': return g.placeSetup(a.t, a.n);
    case 'trade': return g.tradeCards(a.cards);
    case 'place': return g.place(a.t, a.n);
    case 'resume': return g.finishForcedReinforce();
    case 'blitz': return g.blitz(a.from, a.to);
    case 'attack': return g.attack(a.from, a.to);
    case 'occupy': return g.occupy(a.n);
    case 'endAttack': return g.endAttack();
    case 'fortify': return g.fortify(a.from, a.to, a.n);
    case 'endTurn': return g.endTurn();
    default: return false;
  }
}
