// Headless AI-vs-AI simulator: `node scripts/sim.js [games]`.
// Prints the win rate of each level in head-to-head matches.
import { Game } from '../src/game/game.js';
import { nextAction, applyAction, LEVELS } from '../src/game/ai.js';

export function playGame(levels, seed, mode = 'classic', maxActions = 60000) {
  const g = new Game({
    seed, mode,
    players: levels.map((level, i) => ({ name: `${level}${i}`, level, color: 0 })),
  });
  let n = 0;
  while (g.phase !== 'over' && n++ < maxActions) {
    const a = nextAction(g);
    const ok = applyAction(g, a);
    if (ok === false || ok === null) throw new Error(`illegal ${JSON.stringify(a)} in ${g.phase} seed ${seed} owner ${g.owner[a.t]} cur ${g.current} reinf ${g.reinforcements} cards ${g.player.cards.length} resume ${g.resumeAttack}`);
  }
  return { winner: g.winner, turns: g.turn, actions: n, done: g.phase === 'over' };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const games = Number(process.argv[2] || 100);
  const names = Object.keys(LEVELS);
  for (let i = 0; i < names.length - 1; i++) {
    const a = names[i], b = names[i + 1];
    let wa = 0, wb = 0, turns = 0, stalls = 0;
    for (let s = 0; s < games; s++) {
      const swap = s % 2 === 1;
      const r = playGame(swap ? [b, a] : [a, b], 1000 + s);
      if (!r.done) { stalls++; continue; }
      turns += r.turns;
      const winnerLevel = (swap ? [b, a] : [a, b])[r.winner];
      if (winnerLevel === a) wa++; else wb++;
    }
    console.log(`${a} vs ${b}: ${wa}-${wb} (stalls ${stalls}, avg turns ${(turns / Math.max(1, games - stalls)).toFixed(1)})`);
  }
  // 4-player free-for-all
  const wins = {};
  let stalls = 0;
  for (let s = 0; s < games; s++) {
    const order = [...names].sort(() => Math.random() - 0.5);
    const r = playGame(order, 5000 + s);
    if (!r.done) { stalls++; continue; }
    wins[order[r.winner]] = (wins[order[r.winner]] || 0) + 1;
  }
  console.log('4p FFA wins:', wins, 'stalls', stalls);
}
