// The learning layer. Everything here explains the game back to the player:
// odds before they commit, the reason behind a suggested move, and a short
// debrief after each turn so they can see what worked.

import {
  TERRITORIES, CONTINENTS, NEIGHBORS, T_CONTINENT, CONTINENT_MEMBERS, CONTINENT_BORDERS,
} from '../data/map.js';
import { battleOdds } from './dice.js';
import { nextAction } from './ai.js';
import { N } from './game.js';

const name = (t) => TERRITORIES[t].name;
const pct = (p) => `${Math.round(p * 100)}%`;

export function forecast(g, from, to) {
  const a = g.armies[from] - 1, d = g.armies[to];
  const o = battleOdds(a, d);
  let verdict, tone;
  if (o.win >= 0.8) { verdict = 'Strong odds'; tone = 'good'; }
  else if (o.win >= 0.6) { verdict = 'Favourable'; tone = 'good'; }
  else if (o.win >= 0.4) { verdict = 'Coin flip'; tone = 'warn'; }
  else { verdict = 'Risky'; tone = 'bad'; }
  return {
    win: o.win, expLoss: o.expAttLoss, survivors: Math.max(0, a - o.expAttLoss),
    verdict, tone, attackers: a, defenders: d,
  };
}

function threatTo(g, t) {
  let m = 0;
  for (const n of NEIGHBORS[t]) if (g.owner[n] !== g.owner[t]) m = Math.max(m, g.armies[n] - 1);
  return m;
}

export function snapshot(g, p) {
  return {
    territories: g.countOf(p),
    continents: g.continentsOf(p),
    armies: g.armiesOf(p),
    cards: g.players[p].cards.length,
  };
}

// 1-3 short, situation-aware tips for the current player.
export function tips(g) {
  const p = g.current;
  const out = [];
  const own = g.territoriesOf(p);

  // Continent progress: closest to completion first.
  const near = CONTINENTS.map((c, ci) => {
    const missing = CONTINENT_MEMBERS[ci].filter((t) => g.owner[t] !== p);
    return { c, ci, missing };
  }).filter((x) => x.missing.length > 0 && x.missing.length <= 2)
    .sort((a, b) => a.missing.length - b.missing.length || b.c.bonus - a.c.bonus);

  if (g.phase === 'setup' || g.phase === 'reinforce') {
    if (g.mustTrade()) out.push({ text: `You hold ${g.player.cards.length} cards: you must trade a set before placing. Next set is worth <b>${g.nextTradeValue()}</b> armies.` });
    else if (g.bestSet(p) && g.phase === 'reinforce') out.push({ text: `You have a card set worth <b>${g.nextTradeValue()}</b> armies. Set values rise every time anyone trades, so trading later can pay more.` });
    for (const ci of g.continentsOf(p)) {
      const weak = CONTINENT_BORDERS[ci].filter((t) => g.owner[t] === p && threatTo(g, t) >= g.armies[t]);
      if (weak.length) {
        out.push({ text: `Guard <b>${CONTINENTS[ci].name}</b> (+${CONTINENTS[ci].bonus}/turn): <b>${name(weak[0])}</b> is outgunned (${g.armies[weak[0]]} vs ${threatTo(g, weak[0])}). Chokepoints are what keep a bonus alive.`, t: weak[0] });
        break;
      }
    }
    if (near.length) {
      const x = near[0];
      out.push({ text: `You're ${x.missing.length} territor${x.missing.length > 1 ? 'ies' : 'y'} from holding <b>${x.c.name}</b> (+${x.c.bonus} per turn). Stack armies next to ${x.missing.map(name).join(' and ')}.`, t: x.missing[0] });
    }
    if (out.length < 2) out.push({ text: 'Concentrate: one big stack wins battles, many small ones just lose them. Armies can only attack from where you place them.' });
  } else if (g.phase === 'attack') {
    if (!g.conqueredThisTurn) out.push({ text: 'Capture at least one territory this turn to earn a <b>card</b>. Three cards trade for bonus armies.' });
    if (near.length) {
      const x = near[0];
      out.push({ text: `Finish <b>${x.c.name}</b>: take ${x.missing.map(name).join(', ')} for +${x.c.bonus} every turn.`, t: x.missing[0] });
    }
    // Enemy continents worth breaking.
    for (let ci = 0; ci < CONTINENTS.length; ci++) {
      const o = g.owner[CONTINENT_MEMBERS[ci][0]];
      if (o !== p && g.ownsContinent(o, ci)) {
        const entry = CONTINENT_MEMBERS[ci].find((t) => NEIGHBORS[t].some((n) => g.owner[n] === p));
        if (entry !== undefined) {
          out.push({ text: `<b>${g.players[o].name}</b> holds ${CONTINENTS[ci].name} (+${CONTINENTS[ci].bonus}). Taking any one territory there, like ${name(entry)}, cancels that bonus.`, t: entry });
          break;
        }
      }
    }
    out.push({ text: 'Attackers roll up to 3 dice, defenders up to 2, and ties go to the defender. You need more armies to win on average.' });
  } else if (g.phase === 'fortify') {
    const idle = own.filter((t) => g.armies[t] > 2 && !NEIGHBORS[t].some((n) => g.owner[n] !== p));
    if (idle.length) out.push({ text: `<b>${name(idle[0])}</b> has ${g.armies[idle[0]] - 1} armies with no enemy nearby. Interior armies can't attack or defend, so move them to the front.`, t: idle[0] });
    out.push({ text: 'You get one fortify move per turn, along a chain of your own territories. It ends your turn.' });
  } else if (g.phase === 'occupy') {
    out.push({ text: 'Move more armies forward if the new territory borders enemies. Leave them behind if the old one is still on the front line.' });
  }
  return out.slice(0, 3);
}

// What a Warlord would do here, with a human reason.
export function suggest(g) {
  const a = nextAction(g, 'warlord');
  if (!a) return null;
  const p = g.current;
  switch (a.type) {
    case 'trade': return { action: a, text: `Trade your card set for <b>${g.nextTradeValue()}</b> armies.` };
    case 'setup':
    case 'place': {
      const enemies = NEIGHBORS[a.t].filter((n) => g.owner[n] !== p);
      const ci = T_CONTINENT[a.t];
      const why = g.ownsContinent(p, ci) && CONTINENT_BORDERS[ci].includes(a.t)
        ? `it guards the entrance to your ${CONTINENTS[ci].name}`
        : enemies.length ? `it can strike ${enemies.slice(0, 2).map(name).join(' or ')}` : 'it is your strongest position';
      return { action: a, t: a.t, text: `Place on <b>${name(a.t)}</b>: ${why}.` };
    }
    case 'blitz': {
      const f = forecast(g, a.from, a.to);
      const ci = T_CONTINENT[a.to];
      const missing = CONTINENT_MEMBERS[ci].filter((t) => g.owner[t] !== p).length;
      let why = `${pct(f.win)} to win`;
      if (missing === 1) why += `, and it completes ${CONTINENTS[ci].name}`;
      else if (g.ownsContinent(g.owner[a.to], ci)) why += `, and it breaks ${g.players[g.owner[a.to]].name}'s ${CONTINENTS[ci].name} bonus`;
      else if (!g.conqueredThisTurn) why += ', and it earns you a card';
      return { action: a, from: a.from, t: a.to, text: `Attack <b>${name(a.to)}</b> from ${name(a.from)}: ${why}.` };
    }
    case 'endAttack': return { action: a, text: 'No attack has good enough odds. <b>End the attack phase</b> and keep your strength.' };
    case 'fortify': return { action: a, from: a.from, t: a.to, text: `Move ${a.n} armies from <b>${name(a.from)}</b> to <b>${name(a.to)}</b>, from the interior up to the front line.` };
    case 'endTurn': return { action: a, text: 'Nothing worth fortifying. <b>End your turn</b>.' };
    case 'occupy': return { action: a, text: `Move ${a.n} extra armies into the conquered territory.` };
    default: return null;
  }
}

// Short grade + lessons for a finished human turn.
export function debrief(g, p, before, log) {
  const after = snapshot(g, p);
  const lines = [];
  let score = 0;
  const dT = after.territories - before.territories;
  if (dT > 0) { score += Math.min(3, dT); lines.push({ good: true, text: `+${dT} territor${dT > 1 ? 'ies' : 'y'}` }); }
  else if (dT < 0) lines.push({ good: false, text: `${dT} territories` });
  const gained = after.continents.filter((c) => !before.continents.includes(c));
  const lost = before.continents.filter((c) => !after.continents.includes(c));
  for (const ci of gained) { score += 3; lines.push({ good: true, text: `Took ${CONTINENTS[ci].name} (+${CONTINENTS[ci].bonus}/turn)` }); }
  for (const ci of lost) lines.push({ good: false, text: `Lost ${CONTINENTS[ci].name}` });
  if (g.conqueredThisTurn) { score += 1; lines.push({ good: true, text: 'Earned a card' }); }
  else lines.push({ good: false, text: 'No card earned: capture 1 territory per turn to earn one' });

  const risky = log.filter((e) => (e.kind === 'blitz' || e.kind === 'roll') && e.odds < 0.4);
  if (risky.length) { score -= risky.length; lines.push({ good: false, text: `${risky.length} attack${risky.length > 1 ? 's' : ''} under 40% odds. Wait until you outnumber them.` }); }
  const good = log.filter((e) => e.kind === 'blitz' && e.odds >= 0.7).length;
  if (good) { score += 1; lines.push({ good: true, text: `${good} well-timed attack${good > 1 ? 's' : ''} (70%+ odds)` }); }

  // Idle interior armies at end of turn.
  let idle = 0;
  for (let t = 0; t < N; t++) {
    if (g.owner[t] === p && !NEIGHBORS[t].some((n) => g.owner[n] !== p)) idle += g.armies[t] - 1;
  }
  if (idle >= 4) { score -= 1; lines.push({ good: false, text: `${idle} armies idle in the interior. Fortify them toward the front.` }); }

  const grade = score >= 5 ? 'S' : score >= 3 ? 'A' : score >= 1 ? 'B' : score >= 0 ? 'C' : 'D';
  return { grade, lines: lines.slice(0, 4) };
}

// End-of-game takeaways from the stats.
export function lessons(g, p) {
  const s = g.players[p].stats;
  const out = [];
  if (s.luck > 2) out.push(`The dice favoured you (+${s.luck.toFixed(1)} armies over the average). Don't count on that next time.`);
  else if (s.luck < -2) out.push(`The dice were cruel (${s.luck.toFixed(1)} armies below average). Better odds per attack reduce that swing.`);
  else out.push('Your dice luck was about average, so the result came down to strategy.');
  const ratio = s.lost ? s.killed / s.lost : s.killed;
  if (ratio < 0.9) out.push(`You lost ${s.lost} armies and destroyed ${s.killed}. Attack with larger stacks: 3 dice vs 2 is the only matchup that favours the attacker.`);
  else out.push(`Efficient fighting: ${s.killed} destroyed for ${s.lost} lost.`);
  if (s.cardsTraded === 0) out.push('You never traded cards. Earning one card per turn adds up to big army bonuses.');
  return out;
}

// Threat overlay data for player p. Each of p's border territories gets a
// pressure level from the strongest enemy stack next to it; enemy territories
// p can take at 70%+ odds are marked as openings.
export function pressure(g, p) {
  const out = new Array(N).fill(null);
  for (let t = 0; t < N; t++) {
    if (g.owner[t] === p) {
      const threat = threatTo(g, t);
      if (!NEIGHBORS[t].some((n) => g.owner[n] !== p)) continue;
      const ratio = threat / g.armies[t];
      out[t] = { level: ratio >= 1.3 ? 'danger' : ratio >= 0.7 ? 'tense' : 'safe', ratio, threat };
    } else {
      let best = 0;
      for (const n of NEIGHBORS[t]) {
        if (g.owner[n] === p && g.armies[n] > 1) best = Math.max(best, battleOdds(g.armies[n] - 1, g.armies[t]).win);
      }
      if (best >= 0.7) out[t] = { level: 'opening', odds: best };
    }
  }
  return out;
}
