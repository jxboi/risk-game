// Pure rules engine. No DOM, no rendering. The model resolves every action
// immediately and emits events; the view animates them afterwards.

import {
  TERRITORIES, CONTINENTS, NEIGHBORS, T_CONTINENT, CONTINENT_MEMBERS,
} from '../data/map.js';
import { rollDice, resolveRoll, roundOutcomes, battleOdds } from './dice.js';
import { mulberry32, shuffle } from './rng.js';

export const N = TERRITORIES.length;
export const CARD_TYPES = ['Infantry', 'Cavalry', 'Artillery', 'Wild'];
const START_ARMIES = { 2: 40, 3: 35, 4: 30 };
const TRADE_VALUES = [4, 6, 8, 10, 12, 15];

export const MODES = {
  classic: { name: 'World Domination', goal: N },
  quick: { name: 'Quick Conquest', goal: 28 },
};

export class Game {
  constructor({ players, seed = Date.now(), mode = 'classic' }) {
    if (players.length < 2 || players.length > 4) throw new Error('2-4 players');
    this.rng = mulberry32(seed);
    this.mode = mode;
    this.goal = MODES[mode].goal;
    this.players = players.map((p, i) => ({
      id: i,
      name: p.name,
      color: p.color,
      human: !!p.human,
      level: p.level || 'soldier',
      cards: [],
      alive: true,
      pool: 0,
      stats: {
        battles: 0, rollsWon: 0, rollsLost: 0, killed: 0, lost: 0,
        conquered: 0, luck: 0, maxTerritories: 0, cardsTraded: 0,
        eliminatedTurn: null,
      },
    }));
    this.owner = new Array(N).fill(-1);
    this.armies = new Array(N).fill(0);
    this.listeners = new Set();
    this.turn = 0; // player-turns taken
    this.round = 0; // full rotations of the table
    this.current = 0;
    this.phase = 'setup';
    this.reinforcements = 0;
    this.tradeCount = 0;
    this.conqueredThisTurn = false;
    this.pendingOccupy = null;
    this.resumeAttack = false;
    this.winner = null;
    this.history = []; // per turn: territory counts per player
    this.turnLog = []; // human-facing record of decisions for the debrief

    // Territory cards: 42 + 2 wild.
    this.deck = shuffle(
      TERRITORIES.map((_, i) => ({ t: i, type: i % 3 }))
        .concat([{ t: -1, type: 3 }, { t: -1, type: 3 }]),
      this.rng,
    );
    this.discard = [];

    // Deal territories round-robin in random order, one army each.
    const order = shuffle(TERRITORIES.map((_, i) => i), this.rng);
    const start = START_ARMIES[players.length];
    this.players.forEach((p) => { p.pool = start; });
    order.forEach((t, k) => {
      const p = k % players.length;
      this.owner[t] = p;
      this.armies[t] = 1;
      this.players[p].pool--;
    });
    this.current = 0;
  }

  // ---- events ---------------------------------------------------------
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data = {}) { for (const fn of this.listeners) fn(type, data); }

  // ---- queries --------------------------------------------------------
  get player() { return this.players[this.current]; }
  territoriesOf(p) {
    const out = [];
    for (let i = 0; i < N; i++) if (this.owner[i] === p) out.push(i);
    return out;
  }
  countOf(p) { let c = 0; for (let i = 0; i < N; i++) if (this.owner[i] === p) c++; return c; }
  armiesOf(p) { let c = 0; for (let i = 0; i < N; i++) if (this.owner[i] === p) c += this.armies[i]; return c; }
  ownsContinent(p, ci) { return CONTINENT_MEMBERS[ci].every((t) => this.owner[t] === p); }
  continentsOf(p) { return CONTINENTS.map((_, ci) => ci).filter((ci) => this.ownsContinent(p, ci)); }

  reinforcementsFor(p) {
    const base = Math.max(3, Math.floor(this.countOf(p) / 3));
    const bonus = this.continentsOf(p).reduce((s, ci) => s + CONTINENTS[ci].bonus, 0);
    return { base, bonus, total: base + bonus };
  }

  canAttackFrom(t) {
    return this.owner[t] === this.current && this.armies[t] > 1
      && NEIGHBORS[t].some((n) => this.owner[n] !== this.current);
  }
  canAttack(from, to) {
    return this.phase === 'attack' && this.owner[from] === this.current
      && this.owner[to] !== this.current && this.armies[from] > 1
      && NEIGHBORS[from].includes(to);
  }

  // Territories reachable from `from` through a chain of own territories.
  connectedOwned(from) {
    const p = this.owner[from];
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const t = stack.pop();
      for (const n of NEIGHBORS[t]) {
        if (!seen.has(n) && this.owner[n] === p) { seen.add(n); stack.push(n); }
      }
    }
    seen.delete(from);
    return seen;
  }

  nextTradeValue() {
    const k = this.tradeCount;
    return k < TRADE_VALUES.length ? TRADE_VALUES[k] : 15 + 5 * (k - TRADE_VALUES.length + 1);
  }

  static isSet(cards) {
    if (cards.length !== 3) return false;
    const types = cards.map((c) => c.type);
    const wild = types.filter((t) => t === 3).length;
    if (wild > 0) return true;
    const uniq = new Set(types).size;
    return uniq === 1 || uniq === 3;
  }

  // Best set (by bonus armies it would land) from a hand, as card indices.
  bestSet(p) {
    const hand = this.players[p].cards;
    let best = null, bestScore = -Infinity;
    for (let a = 0; a < hand.length; a++)
      for (let b = a + 1; b < hand.length; b++)
        for (let c = b + 1; c < hand.length; c++) {
          const set = [hand[a], hand[b], hand[c]];
          if (!Game.isSet(set)) continue;
          // Prefer sets that grant the +2 territory bonus, and keep wilds.
          const score = (set.some((x) => x.t >= 0 && this.owner[x.t] === p) ? 2 : 0)
            - set.filter((x) => x.type === 3).length;
          if (score > bestScore) { bestScore = score; best = [a, b, c]; }
        }
    return best;
  }

  mustTrade() { return this.player.cards.length >= 5; }

  // ---- setup ----------------------------------------------------------
  // Place armies from the initial pool. Players place in turn order; when a
  // player's pool is empty the next player with armies places.
  placeSetup(t, n = 1) {
    if (this.phase !== 'setup') return false;
    const p = this.player;
    if (this.owner[t] !== p.id || p.pool <= 0) return false;
    n = Math.min(n, p.pool);
    this.armies[t] += n;
    p.pool -= n;
    this.emit('place', { t, n, player: p.id, setup: true });
    if (p.pool === 0) this.advanceSetup();
    return true;
  }

  advanceSetup() {
    const next = this.players.findIndex((pl) => pl.pool > 0);
    if (next === -1) {
      this.current = 0;
      this.turn = 0;
      this.startTurn();
    } else {
      this.current = next;
      this.emit('setupPlayer', { player: next });
    }
  }

  // ---- turn flow ------------------------------------------------------
  startTurn(wrapped = true) {
    this.turn++;
    if (wrapped) this.round++;
    const p = this.player;
    this.conqueredThisTurn = false;
    this.resumeAttack = false;
    this.turnLog = [];
    const r = this.reinforcementsFor(p.id);
    this.reinforcements = r.total;
    this.phase = 'reinforce';
    this.recordHistory();
    this.emit('turn', { player: p.id, turn: this.turn, reinforce: r });
    this.emit('phase', { phase: this.phase });
  }

  recordHistory() {
    const snap = this.players.map((pl) => this.countOf(pl.id));
    this.history.push(snap);
    this.players.forEach((pl) => {
      pl.stats.maxTerritories = Math.max(pl.stats.maxTerritories, snap[pl.id]);
    });
  }

  tradeCards(indices) {
    const p = this.player;
    if (this.phase !== 'reinforce') return false;
    if (!indices || indices.length !== 3) return false;
    const set = indices.map((i) => p.cards[i]);
    if (set.some((c) => !c) || !Game.isSet(set)) return false;
    const value = this.nextTradeValue();
    this.tradeCount++;
    let bonusT = -1;
    for (const c of set) {
      if (c.t >= 0 && this.owner[c.t] === p.id) { bonusT = c.t; break; }
    }
    if (bonusT >= 0) this.armies[bonusT] += 2;
    p.cards = p.cards.filter((_, i) => !indices.includes(i));
    this.discard.push(...set);
    this.reinforcements += value;
    p.stats.cardsTraded++;
    this.emit('trade', { player: p.id, value, bonusT, cards: set });
    return true;
  }

  place(t, n = 1) {
    if (this.phase !== 'reinforce') return false;
    if (this.owner[t] !== this.current) return false;
    if (this.mustTrade()) return false;
    n = Math.min(n, this.reinforcements);
    if (n <= 0) return false;
    this.armies[t] += n;
    this.reinforcements -= n;
    this.emit('place', { t, n, player: this.current });
    if (this.reinforcements === 0) {
      this.phase = 'attack';
      this.emit('phase', { phase: this.phase });
    }
    return true;
  }

  // One roll. `dice` defaults to the maximum allowed.
  attack(from, to, dice = 3, log = true) {
    if (!this.canAttack(from, to)) return null;
    const aDice = Math.max(1, Math.min(dice, 3, this.armies[from] - 1));
    const dDice = Math.min(2, this.armies[to]);
    const odds = battleOdds(this.armies[from] - 1, this.armies[to]);
    const att = rollDice(aDice, this.rng);
    const def = rollDice(dDice, this.rng);
    const { aLoss, dLoss } = resolveRoll(att, def);
    const defender = this.owner[to];

    // Luck: defender losses above what this roll is expected to cost them.
    const expD = roundOutcomes(aDice, dDice).reduce((s, o) => s + o.p * o.dLoss, 0);
    const pa = this.player.stats, pd = this.players[defender].stats;
    pa.luck += dLoss - expD; pd.luck -= dLoss - expD;
    pa.battles++; pd.battles++;
    pa.killed += dLoss; pa.lost += aLoss;
    pd.killed += aLoss; pd.lost += dLoss;
    pa.rollsWon += dLoss; pa.rollsLost += aLoss;

    this.armies[from] -= aLoss;
    this.armies[to] -= dLoss;
    const result = {
      from, to, att, def, aLoss, dLoss, attacker: this.current, defender,
      conquered: this.armies[to] === 0, oddsBefore: odds.win,
    };
    if (log && this.player.human) this.turnLog.push({ kind: 'roll', odds: odds.win, from, to });
    this.emit('battle', result);
    if (result.conquered) this.conquer(from, to, aDice, defender);
    return result;
  }

  // Attack repeatedly until the defender falls or the attacker has 1 left
  // (or drops to `stopAt` armies). Returns all rolls.
  blitz(from, to, stopAt = 1) {
    const rolls = [];
    if (this.player.human && this.canAttack(from, to)) {
      const o = battleOdds(this.armies[from] - 1, this.armies[to]);
      this.turnLog.push({ kind: 'blitz', odds: o.win, from, to, att: this.armies[from], def: this.armies[to] });
    }
    while (this.canAttack(from, to) && this.armies[from] > Math.max(1, stopAt)) {
      const r = this.attack(from, to, 3, false);
      rolls.push(r);
      if (r.conquered) break;
    }
    return rolls;
  }

  conquer(from, to, diceUsed, defender) {
    const p = this.player;
    this.owner[to] = p.id;
    this.conqueredThisTurn = true;
    p.stats.conquered++;
    const min = Math.min(diceUsed, this.armies[from] - 1);
    const max = this.armies[from] - 1;
    // Move the minimum immediately so the territory is never empty.
    this.armies[from] -= min;
    this.armies[to] = min;
    this.pendingOccupy = max > min ? { from, to, min, max } : null;
    const continent = T_CONTINENT[to];
    const tookContinent = this.ownsContinent(p.id, continent);
    const eliminated = this.countOf(defender) === 0;
    this.emit('conquer', { from, to, player: p.id, defender, moved: min });
    if (tookContinent) this.emit('continent', { player: p.id, continent });

    if (eliminated) {
      const dp = this.players[defender];
      dp.alive = false;
      dp.stats.eliminatedTurn = this.turn;
      const taken = dp.cards.length;
      p.cards.push(...dp.cards);
      dp.cards = [];
      this.emit('eliminate', { player: defender, by: p.id, cards: taken });
    }

    if (this.checkWin()) return;

    if (this.pendingOccupy) {
      this.phase = 'occupy';
      this.emit('phase', { phase: this.phase });
    } else {
      this.afterOccupy();
    }
  }

  occupy(extra) {
    if (this.phase !== 'occupy' || !this.pendingOccupy) return false;
    const { from, to, min, max } = this.pendingOccupy;
    const n = Math.max(0, Math.min(extra, max - min));
    this.armies[from] -= n;
    this.armies[to] += n;
    this.pendingOccupy = null;
    if (n > 0) this.emit('move', { from, to, n, player: this.current });
    this.afterOccupy();
    return true;
  }

  afterOccupy() {
    // Eliminating a player can hand you 6+ cards: trade down and place now.
    if (this.player.cards.length >= 6) {
      this.phase = 'reinforce';
      this.resumeAttack = true;
      this.reinforcements = 0;
      this.emit('phase', { phase: this.phase, forced: true });
      return;
    }
    this.phase = 'attack';
    this.emit('phase', { phase: this.phase });
  }

  // Place the armies from a forced mid-turn trade, then resume attacking.
  finishForcedReinforce() {
    if (this.phase === 'reinforce' && this.resumeAttack && this.reinforcements === 0 && !this.mustTrade()) {
      this.resumeAttack = false;
      this.phase = 'attack';
      this.emit('phase', { phase: this.phase });
      return true;
    }
    return false;
  }

  endAttack() {
    if (this.phase !== 'attack') return false;
    this.phase = 'fortify';
    this.emit('phase', { phase: this.phase });
    return true;
  }

  fortify(from, to, n) {
    if (this.phase !== 'fortify') return false;
    if (this.owner[from] !== this.current || this.owner[to] !== this.current) return false;
    if (from === to || !this.connectedOwned(from).has(to)) return false;
    n = Math.min(n, this.armies[from] - 1);
    if (n <= 0) return false;
    this.armies[from] -= n;
    this.armies[to] += n;
    this.emit('move', { from, to, n, player: this.current, fortify: true });
    this.endTurn();
    return true;
  }

  endTurn() {
    if (this.phase === 'over') return false;
    if (this.phase !== 'fortify' && this.phase !== 'attack') return false;
    const p = this.player;
    if (this.conqueredThisTurn) {
      if (this.deck.length === 0) {
        this.deck = shuffle(this.discard, this.rng);
        this.discard = [];
      }
      const card = this.deck.pop();
      if (card) {
        p.cards.push(card);
        this.emit('card', { player: p.id, card });
      }
    }
    this.emit('endTurn', { player: p.id, log: this.turnLog });
    const prev = this.current;
    do {
      this.current = (this.current + 1) % this.players.length;
    } while (!this.players[this.current].alive);
    this.startTurn(this.current <= prev);
    return true;
  }

  checkWin() {
    const p = this.player;
    const alive = this.players.filter((pl) => pl.alive);
    if (this.countOf(p.id) >= this.goal || alive.length === 1) {
      this.phase = 'over';
      this.winner = p.id;
      this.recordHistory();
      this.emit('phase', { phase: this.phase });
      this.emit('gameover', { winner: p.id });
      return true;
    }
    return false;
  }
}
