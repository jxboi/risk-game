// Dice resolution and exact battle odds.

export function rollDice(n, rng) {
  const d = [];
  for (let i = 0; i < n; i++) d.push(1 + Math.floor(rng() * 6));
  return d.sort((a, b) => b - a);
}

// Compare sorted dice; defender wins ties.
export function resolveRoll(att, def) {
  let aLoss = 0, dLoss = 0;
  const n = Math.min(att.length, def.length);
  for (let i = 0; i < n; i++) {
    if (att[i] > def[i]) dLoss++; else aLoss++;
  }
  return { aLoss, dLoss };
}

// Single-round outcome distributions, precomputed by enumeration.
// key `${a}v${d}` -> array of { aLoss, dLoss, p }
const ROUND = {};
(function build() {
  for (let a = 1; a <= 3; a++) {
    for (let d = 1; d <= 2; d++) {
      const counts = new Map();
      const total = 6 ** (a + d);
      for (let k = 0; k < total; k++) {
        let x = k;
        const av = [], dv = [];
        for (let i = 0; i < a; i++) { av.push(1 + (x % 6)); x = Math.floor(x / 6); }
        for (let i = 0; i < d; i++) { dv.push(1 + (x % 6)); x = Math.floor(x / 6); }
        av.sort((p, q) => q - p); dv.sort((p, q) => q - p);
        const r = resolveRoll(av, dv);
        const key = r.aLoss * 10 + r.dLoss;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      ROUND[`${a}v${d}`] = [...counts].map(([key, c]) => ({
        aLoss: Math.floor(key / 10), dLoss: key % 10, p: c / total,
      }));
    }
  }
})();

export function roundOutcomes(aDice, dDice) {
  return ROUND[`${aDice}v${dDice}`];
}

const memo = new Map();
// Probability the attacker (with `a` armies that can fight, i.e. territory
// armies - 1) eliminates `d` defenders when attacking to the end with max dice.
// Also returns expected attacker losses and expected defenders remaining.
export function battleOdds(a, d) {
  if (a <= 0) return { win: 0, expAttLoss: 0, expDefLeft: d };
  if (d <= 0) return { win: 1, expAttLoss: 0, expDefLeft: 0 };
  a = Math.min(a, 150); d = Math.min(d, 150);
  const key = a * 1000 + d;
  const hit = memo.get(key);
  if (hit) return hit;
  const outs = roundOutcomes(Math.min(3, a), Math.min(2, d));
  let win = 0, expAttLoss = 0, expDefLeft = 0;
  for (const o of outs) {
    const na = a - o.aLoss, nd = d - o.dLoss;
    const sub = na <= 0 ? { win: 0, expAttLoss: 0, expDefLeft: nd }
      : nd <= 0 ? { win: 1, expAttLoss: 0, expDefLeft: 0 }
      : battleOdds(na, nd);
    win += o.p * sub.win;
    expAttLoss += o.p * (o.aLoss + sub.expAttLoss);
    expDefLeft += o.p * sub.expDefLeft;
  }
  const res = { win, expAttLoss, expDefLeft };
  memo.set(key, res);
  return res;
}

// Probability of winning a chain of battles, carrying armies forward
// (leaving one behind in each conquered territory). Approximate: uses the
// expected survivors at each step.
export function chainOdds(a, defenders) {
  let p = 1, left = a;
  for (const d of defenders) {
    const o = battleOdds(left, d);
    p *= o.win;
    left = left - o.expAttLoss - 1;
    if (left <= 0) return 0;
  }
  return p;
}
