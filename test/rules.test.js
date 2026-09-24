import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERRITORIES, NEIGHBORS, CONTINENT_MEMBERS } from '../src/data/map.js';
import { battleOdds } from '../src/game/dice.js';
import { Game } from '../src/game/game.js';
import { playGame } from '../scripts/sim.js';

test('map is the classic 42 territories with symmetric adjacency', () => {
  assert.equal(TERRITORIES.length, 42);
  assert.equal(CONTINENT_MEMBERS.flat().length, 42);
  NEIGHBORS.forEach((ns, i) => ns.forEach((n) => assert.ok(NEIGHBORS[n].includes(i), `${i}<->${n}`)));
});

test('battle odds match known values', () => {
  assert.ok(Math.abs(battleOdds(3, 2).win - 0.656) < 0.01); // 3v2 classic ~65.6%
  assert.ok(battleOdds(10, 1).win > 0.99);
  assert.ok(battleOdds(1, 5).win < 0.01);
});

test('setup deals every territory and fills pools', () => {
  const g = new Game({ seed: 1, players: [{}, {}, {}] });
  assert.ok(g.owner.every((o) => o >= 0));
  assert.equal(g.players.reduce((s, p) => s + p.pool, 0), 35 * 3 - 42);
});

test('illegal actions are rejected', () => {
  const g = new Game({ seed: 2, players: [{}, {}] });
  const enemy = g.owner.findIndex((o) => o === 1);
  assert.equal(g.placeSetup(enemy, 1), false);
  assert.equal(g.attack(0, 1), null);
});

test('AI games always finish, in 2, 3 and 4 player setups', () => {
  for (let s = 0; s < 30; s++) {
    const n = 2 + (s % 3);
    const r = playGame(['recruit', 'soldier', 'general', 'warlord'].slice(0, n), s);
    assert.ok(r.done, `seed ${s} stalled`);
  }
});

test('difficulty ladder is monotonic', () => {
  const pairs = [['recruit', 'soldier'], ['soldier', 'general'], ['general', 'warlord']];
  for (const [a, b] of pairs) {
    let wb = 0;
    const games = 120;
    for (let s = 0; s < games; s++) {
      const swap = s % 2 === 1;
      const lv = swap ? [b, a] : [a, b];
      const r = playGame(lv, 7000 + s);
      if (lv[r.winner] === b) wb++;
    }
    assert.ok(wb / games > 0.5, `${b} should beat ${a}: ${wb}/${games}`);
  }
});
