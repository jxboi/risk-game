import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHexMap } from '../src/render/hexmap.js';
import { NEIGHBORS } from '../src/data/map.js';

test('every territory has a sizeable land shape', () => {
  const m = buildHexMap();
  m.territories.forEach((t, i) => assert.ok(t.cells.length >= 8, `territory ${i} has ${t.cells.length} tiles`));
});

test('land borders only exist between rule-adjacent territories', () => {
  const m = buildHexMap();
  for (const key of m.touching) {
    const a = Math.floor(key / 100), b = key % 100;
    assert.ok(NEIGHBORS[a].includes(b), `${a} touches ${b} but they are not adjacent`);
  }
});

test('every adjacency is drawn as a border or a sea lane', () => {
  const m = buildHexMap();
  const lanes = new Set(m.seaLanes.map(([a, b]) => a * 100 + b));
  NEIGHBORS.forEach((ns, a) => ns.forEach((b) => {
    if (a < b) assert.ok(m.touching.has(a * 100 + b) || lanes.has(a * 100 + b));
  }));
});
