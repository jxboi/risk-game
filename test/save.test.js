import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { nextAction, applyAction } from '../src/game/ai.js';
import { pressure } from '../src/game/advisor.js';
import { NEIGHBORS } from '../src/data/map.js';

const players = ['soldier', 'general', 'warlord'].map((level, i) => ({ name: `P${i}`, level, color: i }));
const step = (g, n) => { for (let i = 0; i < n && g.phase !== 'over'; i++) applyAction(g, nextAction(g)); };

test('a saved game resumes with identical state and identical future dice', () => {
  const a = new Game({ seed: 99, players });
  step(a, 400);
  const saved = JSON.stringify(a.toJSON());
  const b = Game.fromJSON(JSON.parse(saved));
  assert.deepEqual(b.toJSON(), a.toJSON());
  step(a, 600);
  step(b, 600);
  assert.deepEqual(b.toJSON(), a.toJSON());
});

test('restored games keep the players\' cards and stats as independent copies', () => {
  const a = new Game({ seed: 5, players });
  step(a, 300);
  const b = Game.fromJSON(a.toJSON());
  b.players[0].stats.killed += 100;
  assert.notEqual(a.players[0].stats.killed, b.players[0].stats.killed);
});

test('incompatible saves are rejected', () => {
  assert.throws(() => Game.fromJSON({ v: 0 }));
  assert.throws(() => Game.fromJSON(null));
});

test('pressure marks outgunned borders as danger and weak neighbours as openings', () => {
  const g = new Game({ seed: 3, players: [{}, {}] });
  g.owner.fill(1); g.armies.fill(1);
  const [a, b] = [0, NEIGHBORS[0][0]];
  g.owner[a] = 0; g.armies[a] = 2; g.armies[b] = 9;
  let pr = pressure(g, 0);
  assert.equal(pr[a].level, 'danger');
  assert.equal(pr[b], null);
  g.armies[a] = 12; g.armies[b] = 1;
  pr = pressure(g, 0);
  assert.equal(pr[a].level, 'safe');
  assert.equal(pr[b].level, 'opening');
  const far = g.owner.findIndex((o, t) => t !== a && !NEIGHBORS[a].includes(t));
  assert.equal(pr[far], null);
});
