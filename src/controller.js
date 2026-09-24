// Glue between the rules engine, the 3D view and the HUD.
//
// Flow:  input/AI -> Game method (resolves instantly, emits events)
//        -> events are queued with a snapshot of the board at that moment
//        -> the queue plays them back as animations, updating the board view
// The model never waits on an animation. Human input is accepted while
// animations play; the view simply catches up.

import { TERRITORIES, CONTINENTS, CONTINENT_MEMBERS, NEIGHBORS } from './data/map.js';
import { nextAction, applyAction } from './game/ai.js';
import { forecast, tips, suggest, snapshot, debrief, lessons } from './game/advisor.js';
import { audio } from './audio.js';
import { toWorld } from './render/board.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const tname = (t) => TERRITORIES[t].name;

export class Controller {
  constructor({ game, stage, board, fx, hud, labels, options, onExit }) {
    Object.assign(this, { game, stage, board, fx, hud, labels, options, onExit });
    this.colors = game.players.map((p) => hex(p.color));
    this.queue = [];
    this.playing = false;
    this.sel = null; // selected source territory
    this.target = null; // selected attack/fortify target
    this.hover = -1;
    this.placeAmount = 1;
    this.moveAmount = 0;
    this.streak = 0; // conquests this turn -> pitch ladder
    this.placeStep = 0;
    // On phones the advisor starts collapsed so it doesn't cover the board.
    this.advisorOn = options.advisor && window.innerWidth > 760;
    this.suggestion = null;
    this.turnStart = null;
    this.aiRunning = false;
    this.destroyed = false;

    for (let t = 0; t < TERRITORIES.length; t++) board.setTerritory(t, game.owner[t], game.armies[t]);

    this.unsub = game.on((type, data) => this.onEvent(type, data));
    this.bindInput();
    this.refresh();
    this.hud.showBanner('Deploy your forces', 'Place your starting armies', '#ffd27a', true, 1800);
    this.kick();
  }

  destroy() {
    this.destroyed = true;
    this.unsub();
    this.unbindInput();
  }

  get humanTurn() { return this.game.player.human && this.game.phase !== 'over'; }
  // In hot-seat games the "viewer" is whoever is playing; otherwise the first human.
  get viewer() {
    const g = this.game;
    if (g.player.human) return g.current;
    const h = g.players.find((p) => p.human && p.alive);
    return h ? h.id : g.current;
  }
  get speed() { return this.options.speed === 'fast' ? 0.55 : 1; }

  // ---- event capture: snapshot now, animate later ------------------------
  onEvent(type, data) {
    const g = this.game;
    if (type === 'turn') {
      this.streak = 0;
      this.placeStep = 0;
      if (g.player.human) this.turnStart = snapshot(g, g.current);
    }
    if (type === 'endTurn' && g.player.human && this.turnStart) {
      data.debrief = debrief(g, g.current, this.turnStart, data.log);
    }
    this.queue.push({ type, data, owner: g.owner.slice(), armies: g.armies.slice(), human: g.player.human });
    if (!this.playing) this.play();
  }

  async play() {
    this.playing = true;
    while (this.queue.length && !this.destroyed) {
      const ev = this.queue.shift();
      try { await this.animate(ev); } catch (e) { console.error(e); }
      this.syncTerritories(ev);
      if (!this.queue.length) this.refresh();
    }
    this.playing = false;
    this.refresh();
  }

  drain() {
    return new Promise((resolve) => {
      const check = () => (!this.playing && !this.queue.length ? resolve() : setTimeout(check, 30));
      check();
    });
  }

  syncTerritories(ev, only) {
    const list = only || TERRITORIES.map((_, i) => i);
    for (const t of list) this.board.setTerritory(t, ev.owner[t], ev.armies[t]);
  }

  // ---- the juice -----------------------------------------------------------
  async animate(ev) {
    const { type, data } = ev;
    const { board, fx, hud, labels } = this;
    const sp = this.speed;
    const g = this.game;
    // Queue pressure: compress animations when a lot is pending (blitz).
    const rush = this.queue.length > 6 ? 0.45 : this.queue.length > 2 ? 0.7 : 1;

    switch (type) {
      case 'place': {
        this.syncTerritories(ev, [data.t]);
        const big = data.n >= 5;
        board.punchToken(data.t, big ? 0.5 : 0.3);
        board.bumpTerritory(data.t, big ? 0.4 : 0.18);
        labels.bump(data.t);
        fx.burst(board.tokenTop(data.t), this.game.players[data.player].color, { count: big ? 12 : 5, speed: 4, up: 5, size: 0.16, sparks: big ? 10 : 4 });
        if (big) fx.ring(board.tokenPos(data.t), this.colors[data.player], { size: 3.5, dur: 0.4 });
        audio.place(this.placeStep++, big);
        if (!ev.human) await sleep((data.setup ? 60 : 200) * sp);
        break;
      }
      case 'trade': {
        audio.cards();
        hud.showBanner(`+${data.value} armies`, `${g.players[data.player].name} traded cards${data.bonusT >= 0 ? ` · +2 on ${tname(data.bonusT)}` : ''}`, this.colors[data.player]);
        if (data.bonusT >= 0) { this.syncTerritories(ev, [data.bonusT]); board.punchToken(data.bonusT, 0.5); }
        await sleep(ev.human ? 0 : 600 * sp);
        break;
      }
      case 'battle': {
        const from = board.tokenTop(data.from), to = board.tokenTop(data.to);
        if (!ev.human) this.stage.glideTo(to);
        hud.showDice(data, this.colors);
        audio.diceRattle();
        const shots = Math.min(3, data.att.length);
        const flight = 260 * rush * sp;
        audio.cannon(0.6);
        const landing = [];
        for (let i = 0; i < shots; i++) {
          landing.push(fx.shoot(from, to.clone().add(toWorld(50 + (Math.random() - 0.5) * 1.2, 30 + (Math.random() - 0.5) * 1.2)), this.colors[data.attacker], flight / 1000));
          await sleep(40 * rush);
        }
        await landing[0];
        // A captured territory flips in the 'conquer' event; skip the 0.
        this.syncTerritories(ev, data.conquered ? [data.from] : [data.from, data.to]);
        if (data.dLoss) {
          fx.burst(to, g.players[data.defender].color, { count: 6 + data.dLoss * 4, speed: 7, up: 7 });
          fx.flash(to, 0xffaa55, 25 + data.dLoss * 15);
          board.punchToken(data.to, 0.3 + data.dLoss * 0.12);
          labels.popup(to, `-${data.dLoss}`, 'loss');
          if (data.dLoss >= 2) fx.addShake(0.25);
        }
        if (data.aLoss) {
          fx.burst(from, g.players[data.attacker].color, { count: 4 + data.aLoss * 3, speed: 5, up: 5, sparks: 3 });
          board.punchToken(data.from, 0.25);
          labels.popup(from, `-${data.aLoss}`, 'loss');
        }
        audio.rollResult(data.aLoss, data.dLoss, ev.human);
        await sleep(Math.max(70, 240 * rush * sp));
        break;
      }
      case 'conquer': {
        this.streak++;
        const pos = board.tokenPos(data.to);
        const origin = board.tokenPos(data.from);
        board.flip(data.to, data.defender, origin, 0.5);
        this.syncTerritories(ev, [data.from, data.to]);
        fx.hitStop(this.streak >= 3 ? 80 : 45);
        fx.burst(board.tokenTop(data.to), g.players[data.player].color, { count: 22, speed: 10, up: 9, size: 0.26, sparks: 18 });
        fx.ring(pos, this.colors[data.player], { size: 7, dur: 0.55 });
        fx.flash(pos, g.players[data.player].color, 60);
        fx.addShake(this.streak >= 3 ? 0.7 : 0.45);
        board.punchToken(data.to, 0.6);
        labels.bump(data.to);
        labels.popup(board.tokenTop(data.to), this.streak >= 2 ? `CAPTURED ×${this.streak}` : 'CAPTURED', 'capture');
        audio.conquer(this.streak - 1);
        await sleep(420 * rush * sp);
        break;
      }
      case 'continent': {
        const c = CONTINENTS[data.continent];
        const mine = ev.human;
        hud.showBanner(`${c.name} secured`, `${g.players[data.player].name} · +${c.bonus} armies every turn`, this.colors[data.player], true, 2000);
        fx.addPunch(0.05);
        fx.hitStop(100);
        fx.addShake(0.8);
        const members = CONTINENT_MEMBERS[data.continent];
        members.forEach((t, i) => setTimeout(() => {
          board.bumpTerritory(t, 0.6);
          fx.fountain(board.tokenTop(t), [g.players[data.player].color, 0xffffff, 0xffd27a], 14);
        }, i * 70));
        mine || !this.anyHuman() ? audio.continent() : audio.lostContinent();
        await sleep(900 * sp);
        break;
      }
      case 'eliminate': {
        hud.showBanner(`${g.players[data.player].name} eliminated`, `${g.players[data.by].name} seizes ${data.cards} card${data.cards === 1 ? '' : 's'}`, this.colors[data.player], true, 2200);
        fx.addShake(0.9);
        fx.addPunch(0.06);
        audio.eliminate();
        await sleep(1000 * sp);
        break;
      }
      case 'move': {
        const a = board.tokenTop(data.from), b = board.tokenTop(data.to);
        audio.march();
        fx.shoot(a, b, this.colors[data.player], 0.3);
        await sleep(data.fortify ? 300 : 120);
        this.syncTerritories(ev, [data.from, data.to]);
        board.punchToken(data.to, 0.35);
        labels.bump(data.to);
        await sleep(ev.human ? 0 : 250 * sp);
        break;
      }
      case 'card': {
        if (ev.human) hud.toast(`New card: ${hud.cardsHtml([data.card], TERRITORIES.map((t) => t.name))}`, 2500, 'cardtoast');
        break;
      }
      case 'endTurn': {
        if (data.debrief) this.showDebrief(data.debrief);
        break;
      }
      case 'turn': {
        const p = g.players[data.player];
        const r = data.reinforce;
        const sub = `+${r.total} armies${r.bonus ? ` (${r.base} + ${r.bonus} continent bonus)` : ''}`;
        if (ev.human) {
          hud.showBanner(this.humanCount() > 1 ? `${p.name}'s turn` : 'Your turn', sub, this.colors[p.id], true, 1500);
          audio.turn(true);
          this.stage.glideHome();
        } else {
          hud.showBanner(`${p.name}`, sub, this.colors[p.id], false, 900 * sp);
          audio.turn(false);
          await sleep(500 * sp);
        }
        break;
      }
      case 'phase': {
        if (ev.human && data.phase !== 'over') audio.phase();
        break;
      }
      case 'gameover': {
        await sleep(600);
        this.showGameOver(data.winner);
        break;
      }
      default: break;
    }
  }

  anyHuman() { return this.game.players.some((p) => p.human); }
  humanCount() { return this.game.players.filter((p) => p.human).length; }

  showDebrief(d) {
    const lines = d.lines.map((l) => `<li class="${l.good ? 'good' : 'bad'}">${l.text}</li>`).join('');
    this.hud.toast(`<div class="grade g${d.grade}">${d.grade}</div><div><b>Turn debrief</b><ul>${lines}</ul></div>`, 6000, 'debrief');
  }

  showGameOver(winner) {
    const g = this.game;
    const w = g.players[winner];
    const humanWon = w.human;
    audio.victory(humanWon || !this.anyHuman());
    const viewer = g.players.find((p) => p.human) ?? w;
    const rows = g.players.map((p) => `<tr style="--c:${this.colors[p.id]}"><td><span class="chip"></span>${p.name}</td>
      <td>${p.stats.maxTerritories}</td><td>${p.stats.killed}</td><td>${p.stats.lost}</td>
      <td>${p.stats.luck >= 0 ? '+' : ''}${p.stats.luck.toFixed(1)}</td>
      <td>${p.stats.eliminatedTurn ? `Out T${p.stats.eliminatedTurn}` : p.id === winner ? '👑' : ''}</td></tr>`).join('');
    const tips = lessons(g, viewer.id).map((l) => `<li>${l}</li>`).join('');
    const el = document.createElement('div');
    el.className = 'overlay gameover';
    el.innerHTML = `<div class="card-panel">
      <div class="gtitle" style="color:${this.colors[winner]}">${humanWon ? (this.humanCount() > 1 ? `${w.name} conquers the world` : 'Victory') : `${w.name} wins`}</div>
      <div class="gsub">${g.round} rounds</div>
      <table class="stats"><tr><th>Player</th><th>Peak land</th><th>Destroyed</th><th>Lost</th><th>Dice luck</th><th></th></tr>${rows}</table>
      <div class="lessons"><b>Lessons for ${viewer.name}</b><ul>${tips}</ul></div>
      <div class="row"><button class="btn primary" data-a="again">Play again</button><button class="btn" data-a="menu">Main menu</button></div></div>`;
    el.querySelector('[data-a=again]').onclick = () => { el.remove(); this.onExit('again'); };
    el.querySelector('[data-a=menu]').onclick = () => { el.remove(); this.onExit('menu'); };
    document.body.appendChild(el);
    if (humanWon) {
      for (let i = 0; i < 6; i++) setTimeout(() => this.fx.fountain(this.board.tokenTop(Math.floor(Math.random() * 42)), [w.color, 0xffffff, 0xffd27a], 40), i * 300);
    }
  }

  // ---- AI turns ---------------------------------------------------------------
  async kick() {
    if (this.aiRunning) return;
    this.aiRunning = true;
    const g = this.game;
    while (!this.destroyed && g.phase !== 'over' && !g.player.human) {
      const a = nextAction(g);
      if (!a) break;
      const ok = applyAction(g, a);
      if (ok === false || ok === null) { console.warn('AI illegal action', a); g.endTurn(); }
      // Setup placements are batched quickly; other moves wait for the view.
      if (g.phase === 'setup') { await sleep(20); continue; }
      await this.drain();
      await sleep((a.type === 'blitz' ? 220 : 120) * this.speed);
    }
    this.aiRunning = false;
    this.refresh();
  }

  // ---- human input ----------------------------------------------------------------
  bindInput() {
    const el = this.stage.renderer.domElement;
    let down = null;
    this.h = {
      down: (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; audio.unlock(); },
      up: (e) => {
        if (!down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        down = null;
        if (moved > 8) return; // that was a pan
        const t = this.board.pick(this.stage.rayFromClient(e.clientX, e.clientY));
        this.click(t);
      },
      move: (e) => {
        if (e.pointerType === 'touch') return;
        const t = this.board.pick(this.stage.rayFromClient(e.clientX, e.clientY));
        if (t !== this.hover) { this.hover = t; this.onHover(); }
      },
      context: (e) => e.preventDefault(),
      key: (e) => this.key(e),
    };
    el.addEventListener('pointerdown', this.h.down);
    el.addEventListener('pointerup', this.h.up);
    el.addEventListener('pointermove', this.h.move);
    el.addEventListener('contextmenu', this.h.context);
    window.addEventListener('keydown', this.h.key);
  }
  unbindInput() {
    const el = this.stage.renderer.domElement;
    el.removeEventListener('pointerdown', this.h.down);
    el.removeEventListener('pointerup', this.h.up);
    el.removeEventListener('pointermove', this.h.move);
    el.removeEventListener('contextmenu', this.h.context);
    window.removeEventListener('keydown', this.h.key);
  }

  key(e) {
    // Never steal keys from focused interface elements.
    if (e.target.closest?.('input, textarea, select, button')) return;
    if (!this.humanTurn) return;
    const k = e.key.toLowerCase();
    const map = {
      escape: () => this.deselect(),
      h: () => this.doSuggest(),
      b: () => this.blitz(),
      r: () => this.roll(),
      enter: () => this.primary?.(),
      ' ': () => this.primary?.(),
      1: () => this.setPlace(1), 5: () => this.setPlace(5), a: () => this.setPlace(Infinity),
    };
    if (map[k]) { e.preventDefault(); map[k](); }
  }

  onHover() {
    const g = this.game;
    const t = this.hover;
    this.stage.renderer.domElement.style.cursor = t >= 0 ? 'pointer' : '';
    if (t >= 0) audio.hover();
    // Forecast when hovering a valid attack target.
    if (this.humanTurn && g.phase === 'attack' && this.sel !== null && t >= 0 && g.canAttack(this.sel, t)) {
      this.showForecastFor(this.sel, t);
    } else if (this.target === null) {
      this.hud.hideForecast();
    }
    this.applyHighlights();
  }

  showForecastFor(from, to) {
    const pt = this.stage.project(this.board.tokenTop(to), { x: 0, y: 0 });
    this.hud.showForecast(pt, forecast(this.game, from, to), from, to);
  }

  click(t) {
    const g = this.game;
    if (!this.humanTurn) return;
    if (t < 0) { this.deselect(); return; }
    const me = g.current;
    switch (g.phase) {
      case 'setup': {
        if (g.owner[t] !== me) return audio.deny();
        g.placeSetup(t, this.placeAmount === Infinity ? g.player.pool : this.placeAmount);
        break;
      }
      case 'reinforce': {
        if (g.mustTrade()) { audio.deny(); this.hud.toast('Trade a card set first.', 1800); return; }
        if (g.owner[t] !== me) return audio.deny();
        g.place(t, this.placeAmount === Infinity ? g.reinforcements : this.placeAmount);
        if (g.phase === 'reinforce' && g.resumeAttack && g.reinforcements === 0) g.finishForcedReinforce();
        break;
      }
      case 'attack': {
        if (g.owner[t] === me) {
          if (!g.canAttackFrom(t)) { audio.deny(); this.sel = null; this.target = null; break; }
          this.sel = t; this.target = null; audio.select();
        } else if (this.sel !== null && g.canAttack(this.sel, t)) {
          if (this.target === t) { this.roll(); return; }
          this.target = t; audio.select();
          this.showForecastFor(this.sel, t);
        } else audio.deny();
        break;
      }
      case 'fortify': {
        if (g.owner[t] !== me) return audio.deny();
        if (this.sel === null || t === this.sel) {
          if (g.armies[t] < 2) return audio.deny();
          this.sel = t; this.target = null; audio.select();
        } else if (g.connectedOwned(this.sel).has(t)) {
          this.target = t; this.moveAmount = g.armies[this.sel] - 1; audio.select();
        } else if (g.armies[t] >= 2) {
          this.sel = t; this.target = null; audio.select();
        } else audio.deny();
        break;
      }
      default: break;
    }
    this.suggestion = null;
    this.refresh();
  }

  deselect() {
    this.sel = null; this.target = null; this.hud.hideForecast();
    this.refresh();
  }

  setPlace(n) { this.placeAmount = n; this.refresh(); }

  roll() {
    const g = this.game;
    if (g.phase !== 'attack' || this.sel === null || this.target === null) return;
    const r = g.attack(this.sel, this.target);
    this.afterAttack(r ? [r] : []);
  }

  blitz() {
    const g = this.game;
    if (g.phase !== 'attack' || this.sel === null || this.target === null) return;
    this.afterAttack(g.blitz(this.sel, this.target));
  }

  afterAttack(rolls) {
    const g = this.game;
    const last = rolls[rolls.length - 1];
    if (last?.conquered) {
      this.moveAmount = g.pendingOccupy ? g.pendingOccupy.max - g.pendingOccupy.min : 0;
      this.sel = g.phase === 'attack' && g.canAttackFrom(last.to) ? last.to : null;
      this.target = null;
      this.hud.hideForecast();
    } else if (this.sel !== null && !g.canAttackFrom(this.sel)) {
      this.sel = null; this.target = null; this.hud.hideForecast();
    } else if (this.target !== null) {
      this.showForecastFor(this.sel, this.target);
    }
    this.refresh();
  }

  doSuggest() {
    const g = this.game;
    if (!this.humanTurn) return;
    const s = suggest(g);
    this.suggestion = s;
    if (s?.from !== undefined && g.phase === 'attack') { this.sel = s.from; this.target = s.t; this.showForecastFor(s.from, s.t); }
    if (s?.from !== undefined && g.phase === 'fortify') { this.sel = s.from; this.target = s.t; this.moveAmount = s.action.n; }
    if (s?.t !== undefined) this.stage.glideTo(this.board.tokenPos(s.t), 20);
    this.refresh();
  }

  // ---- highlights + HUD ------------------------------------------------------------
  applyHighlights() {
    const g = this.game, b = this.board;
    b.clearHighlights();
    if (!this.humanTurn) return;
    const me = g.current;
    const hov = this.hover;
    if (g.phase === 'attack' && this.sel !== null) {
      for (let t = 0; t < TERRITORIES.length; t++) b.highlight(t, { dim: 0.6 });
      b.highlight(this.sel, { glow: 0.8, color: 0xffffff, lift: 0.35, pulse: 1 });
      for (const n of NEIGHBORS[this.sel]) {
        if (g.owner[n] !== me) {
          const sel = n === this.target;
          b.highlight(n, { glow: sel ? 0.9 : 0.45, color: 0xff4b3a, lift: sel ? 0.35 : 0.12, pulse: 2 });
        }
      }
    } else if (g.phase === 'fortify' && this.sel !== null) {
      const reach = g.connectedOwned(this.sel);
      for (let t = 0; t < TERRITORIES.length; t++) b.highlight(t, { dim: reach.has(t) || t === this.sel ? 0 : 0.6 });
      b.highlight(this.sel, { glow: 0.8, color: 0xffffff, lift: 0.35, pulse: 1 });
      for (const t of reach) b.highlight(t, { glow: t === this.target ? 0.9 : 0.35, color: 0x5dff9a, lift: t === this.target ? 0.35 : 0.08, pulse: t === this.target ? 2 : 0 });
    } else if (g.phase === 'occupy' && g.pendingOccupy) {
      b.highlight(g.pendingOccupy.from, { glow: 0.6, color: 0xffffff, lift: 0.2 });
      b.highlight(g.pendingOccupy.to, { glow: 0.8, color: 0x5dff9a, lift: 0.3, pulse: 2 });
    } else if (g.phase === 'attack') {
      // Show which of my territories can attack.
      for (let t = 0; t < TERRITORIES.length; t++) if (g.canAttackFrom(t)) b.highlight(t, { glow: 0.12, color: 0xffffff });
    }
    if (hov >= 0 && (g.owner[hov] === me || this.sel !== null)) {
      const v = b.tv[hov];
      b.highlight(hov, { glow: Math.max(v.glowTarget, 0.35), color: v.glowTarget ? v.glowColor.getHex() : 0xffffff, lift: Math.max(v.liftTarget, 0.25), dim: 0, pulse: v.pulse });
    }
    if (this.suggestion?.t !== undefined && this.sel === null) {
      b.highlight(this.suggestion.t, { glow: 0.8, color: 0xffd27a, lift: 0.3, pulse: 2 });
    }
  }

  refresh() {
    if (this.destroyed) return;
    const g = this.game, hud = this.hud;
    const viewer = this.viewer;
    hud.renderPlayers(g);
    hud.renderContinents(g, viewer);
    this.applyHighlights();
    this.primary = null;
    this.renderTools();

    if (g.phase === 'over') { hud.setActions([]); hud.setPhase(g, 'Game over'); hud.setAdvisor(false); return; }

    if (!g.player.human) {
      hud.setPhase(g, `${g.player.name} is thinking…`);
      hud.setActions([{ html: `<span class="spinner"></span> ${g.player.name}'s move` }]);
      hud.hideForecast();
      hud.setAdvisor(this.advisorOn, [], null);
      if (!this.aiRunning) this.kick();
      return;
    }

    const actions = [];
    const amountBtns = (max) => [1, 5, Infinity].map((n) => ({
      label: n === Infinity ? `All (${max})` : `+${n}`, active: this.placeAmount === n, onClick: () => this.setPlace(n),
      key: n === Infinity ? 'A' : String(n),
    }));
    let instr = '';

    switch (g.phase) {
      case 'setup': {
        instr = `Deploy <b>${g.player.pool}</b> armies on your territories`;
        actions.push(...amountBtns(g.player.pool));
        actions.push({ label: 'Auto-deploy', onClick: () => this.autoDeploy() });
        break;
      }
      case 'reinforce': {
        const p = g.player;
        if (g.mustTrade()) instr = `You have ${p.cards.length} cards: <b>trade a set</b> first`;
        else instr = `Place <b>${g.reinforcements}</b> armies${g.resumeAttack ? ' (bonus from captured cards)' : ''}`;
        if (p.cards.length) actions.push({ html: `<div class="hand">${hud.cardsHtml(p.cards, TERRITORIES.map((t) => t.name))}</div>` });
        const set = g.bestSet(p.id);
        if (set) actions.push({ label: `Trade set +${g.nextTradeValue()}`, primary: g.mustTrade(), onClick: () => { g.tradeCards(set); this.refresh(); } });
        if (!g.mustTrade() && g.reinforcements > 0) actions.push(...amountBtns(g.reinforcements));
        if (g.resumeAttack && g.reinforcements === 0 && !g.mustTrade()) {
          actions.push({ label: 'Resume attack', primary: true, onClick: () => { g.finishForcedReinforce(); this.refresh(); } });
        }
        break;
      }
      case 'attack': {
        if (this.sel === null) instr = 'Select one of your territories to attack <b>from</b>';
        else if (this.target === null) instr = `Attacking from <b>${tname(this.sel)}</b>: choose a red target`;
        else instr = `<b>${tname(this.sel)}</b> ⚔ <b>${tname(this.target)}</b>`;
        if (this.sel !== null && this.target !== null) {
          actions.push({ label: 'Roll', key: 'R', onClick: () => this.roll() });
          actions.push({ label: 'Blitz', key: 'B', primary: true, onClick: () => this.blitz() });
        }
        actions.push({ label: 'End attack', key: '␣', onClick: () => this.endAttack() });
        this.primary = this.sel !== null && this.target !== null ? () => this.blitz() : () => this.endAttack();
        break;
      }
      case 'occupy': {
        const o = g.pendingOccupy;
        instr = `Captured <b>${tname(o.to)}</b>! Move extra armies in`;
        this.moveAmount = Math.min(this.moveAmount, o.max - o.min);
        actions.push({ slider: { label: 'Extra', min: 0, max: o.max - o.min, value: this.moveAmount, onChange: (v) => { this.moveAmount = v; } } });
        actions.push({ label: 'Move', key: '␣', primary: true, onClick: () => this.confirmOccupy() });
        this.primary = () => this.confirmOccupy();
        break;
      }
      case 'fortify': {
        if (this.sel === null) instr = 'Fortify: choose a territory to move armies <b>from</b> (optional)';
        else if (this.target === null) instr = `Move from <b>${tname(this.sel)}</b>: choose a green destination`;
        else instr = `Move armies <b>${tname(this.sel)}</b> → <b>${tname(this.target)}</b>`;
        if (this.sel !== null && this.target !== null) {
          const max = g.armies[this.sel] - 1;
          this.moveAmount = Math.max(1, Math.min(this.moveAmount || max, max));
          actions.push({ slider: { label: 'Armies', min: 1, max, value: this.moveAmount, onChange: (v) => { this.moveAmount = v; } } });
          actions.push({ label: 'Move & end turn', key: '␣', primary: true, onClick: () => this.confirmFortify() });
          this.primary = () => this.confirmFortify();
        } else {
          actions.push({ label: 'End turn', key: '␣', primary: true, onClick: () => this.endTurn() });
          this.primary = () => this.endTurn();
        }
        break;
      }
      default: break;
    }
    hud.setPhase(g, instr);
    hud.setActions(actions);
    hud.setAdvisor(this.advisorOn, tips(g), this.suggestion?.text, () => this.doSuggest());
  }

  renderTools() {
    this.hud.setTools([
      { icon: '💡', title: 'Advisor', on: this.advisorOn, onClick: () => { this.advisorOn = !this.advisorOn; this.refresh(); } },
      { icon: audio.muted ? '🔇' : '🔊', title: 'Sound', on: !audio.muted, onClick: () => { audio.setMuted(!audio.muted); this.refresh(); } },
      { icon: '♫', title: 'Music', on: audio.musicOn, onClick: () => { audio.setMusic(!audio.musicOn); this.refresh(); } },
      { icon: '⌖', title: 'Reset view', onClick: () => this.stage.fitView() },
      { icon: '☰', title: 'Menu', onClick: () => { if (confirm('Leave this game?')) this.onExit('menu'); } },
    ]);
  }

  autoDeploy() {
    const g = this.game;
    while (g.phase === 'setup' && g.player.human) {
      const a = nextAction(g, 'general');
      applyAction(g, a);
    }
    this.refresh();
  }

  endAttack() {
    this.sel = null; this.target = null; this.hud.hideForecast();
    this.game.endAttack();
    this.refresh();
  }

  confirmOccupy() {
    this.game.occupy(this.moveAmount);
    this.refresh();
  }

  confirmFortify() {
    const g = this.game;
    const from = this.sel, to = this.target, n = this.moveAmount;
    this.sel = null; this.target = null;
    g.fortify(from, to, n);
    this.refresh();
  }

  endTurn() {
    this.sel = null; this.target = null;
    this.game.endTurn();
    this.refresh();
  }
}
