// Entry point: title/setup menu, and wiring a new match together.

import './style.css';
import { Stage } from './render/stage.js';
import { Board } from './render/board.js';
import { Fx } from './render/fx.js';
import { Hud } from './ui/hud.js';
import { Labels } from './ui/labels.js';
import { Controller } from './controller.js';
import { Game, MODES } from './game/game.js';
import { LEVELS } from './game/ai.js';
import { audio } from './audio.js';

const PALETTE = [
  { name: 'Crimson', color: 0xe8443a },
  { name: 'Azure', color: 0x3b8cff },
  { name: 'Gold', color: 0xf2b632 },
  { name: 'Jade', color: 0x2fcf7f },
];

const DEFAULT_SLOTS = [
  { type: 'human', name: 'You' },
  { type: 'soldier', name: 'Azure' },
  { type: 'soldier', name: 'Gold' },
  { type: 'off', name: 'Jade' },
];

const app = document.getElementById('app');
const stage = new Stage(app);
let board = null, fx = null, hud = null, labels = null, controller = null;
let lastConfig = null;

// Idle attract mode behind the menu: the board slowly breathes.
function mountBoard(colors) {
  if (board) { stage.world.remove(board.root); }
  board = new Board(stage.world, colors);
  if (!fx) fx = new Fx(stage.scene, stage.world);
}

function loop() {
  let last = performance.now();
  const frame = (now) => {
    // Clamp generously so slow devices don't run in slow motion.
    const realDt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const dt = fx.update(realDt);
    board.update(dt);
    labels?.update();
    stage.update(realDt, fx);
    listen();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// The sea gets louder as the camera comes down toward the coasts.
let ambLevel = -1;
function listen() {
  const d = stage.camera.position.distanceTo(stage.controls.target);
  const level = Math.round(Math.min(1, Math.max(0, (150 - d) / 110)) * 20) / 20;
  if (level !== ambLevel) { ambLevel = level; audio.setAmbience(level); }
}

function loadSlots() {
  try { return JSON.parse(localStorage.getItem('conquest.slots')) || DEFAULT_SLOTS; } catch { return DEFAULT_SLOTS; }
}
function saveSlots(slots) { try { localStorage.setItem('conquest.slots', JSON.stringify(slots)); } catch { /* ignore */ } }

// Autosave: written at the start of every turn, cleared when a game ends.
const SAVE_KEY = 'conquest.save';
function loadSave() {
  try {
    const save = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!save) return null;
    Game.fromJSON(save.game); // validate before offering it
    return save;
  } catch { return null; }
}
function writeSave(game, config) {
  try {
    if (game) localStorage.setItem(SAVE_KEY, JSON.stringify({ game: game.toJSON(), ...config, at: Date.now() }));
    else localStorage.removeItem(SAVE_KEY);
  } catch { /* storage full or blocked: play on without saving */ }
}

// Types a commander can be, in the order the ‹ › arrows step through them.
const ROLES = ['human', ...Object.keys(LEVELS)];
const cssHex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Heraldic crest: a hex shield in the commander's colour, with a star for a
// human and rank chevrons (one per level) for an AI.
function crest(type) {
  const rank = type === 'human' ? -1 : LEVELS[type]?.rank ?? 0;
  const mark = rank < 0
    ? '<path class="mark" d="M32 17l4.1 8.6 9.4 1.2-6.9 6.5 1.8 9.3L32 38.1l-8.4 4.5 1.8-9.3-6.9-6.5 9.4-1.2z"/>'
    : Array.from({ length: rank + 1 }, (_, k) => {
      const y = 40 - k * 7 + rank * 3.5;
      return `<path class="mark" d="M20 ${y}l12-7 12 7v-5l-12-7-12 7z"/>`;
    }).join('');
  return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path class="shield" d="M32 3l25 14.5v29L32 61 7 46.5v-29z"/>
    <path class="rim" d="M32 9l20 11.6v22.8L32 55 12 43.4V20.6z"/>${mark}</svg>`;
}

function showMenu() {
  const save = loadSave();
  const slots = loadSlots().map((s) => ({ ...s }));
  const opts = { mode: 'classic', advisor: true, speed: 'normal' };
  try { Object.assign(opts, JSON.parse(localStorage.getItem('conquest.opts')) || {}); } catch { /* ignore */ }

  const el = document.createElement('div');
  el.className = 'overlay menu';
  el.innerHTML = `
    <header class="hero">
      <div class="logo">CONQUEST<span>World Domination in 3D</span></div>
    </header>

    <section class="screen title-screen">
      ${save ? `<button class="btn primary big resume" id="resume">Continue campaign<small>${esc(saveSummary(save.game))}</small></button>` : ''}
      <button class="btn big${save ? ' ghost' : ' primary'}" data-go="council">${save ? 'New campaign' : 'Start campaign'}</button>
      <button class="linkbtn" data-go="briefing">How to play</button>
    </section>

    <section class="screen council hidden" aria-label="New campaign">
      <div class="council-head">
        <button class="back" data-go="title" aria-label="Back">‹</button>
        <h2>Choose your rivals</h2>
      </div>
      <div class="commanders">${slots.map((s, i) => `
        <div class="cmdr" data-i="${i}" style="--c:${cssHex(PALETTE[i].color)}">
          <div class="crest"></div>
          <input class="cname" value="${esc(s.name)}" maxlength="14" spellcheck="false" aria-label="Player ${i + 1} name">
          <div class="role">
            <button class="step" data-d="-1" aria-label="Previous type">‹</button>
            <span class="rlabel"></span>
            <button class="step" data-d="1" aria-label="Next type">›</button>
          </div>
          <p class="blurb"></p>
          ${i >= 2 ? `<button class="dismiss" aria-label="Remove ${esc(s.name)}">×</button>
          <button class="enlist"><b>+</b>Add a rival</button>` : ''}
        </div>`).join('')}</div>

      <div class="modes" role="radiogroup" aria-label="Mode">${Object.entries(MODES).map(([k, m]) => `
        <button class="mode" role="radio" data-mode="${k}">
          <b>${m.name}</b><small>${k === 'quick' ? `First to ${m.goal} territories` : 'Conquer every territory'}</small>
        </button>`).join('')}</div>

      <div class="toggles">
        <button class="toggle" id="speed" aria-pressed="false"><span>AI pace</span><b></b></button>
        <button class="toggle" id="advisor" aria-pressed="false"><span>Advisor</span><b></b></button>
      </div>

      <button class="btn primary big" id="start">To war</button>
    </section>

    <section class="screen briefing hidden" aria-label="How to play">
      <div class="council-head">
        <button class="back" data-go="title" aria-label="Back">‹</button>
        <h2>Field briefing</h2>
      </div>
      <ol class="orders">
        <li><b>Reinforce</b>You get armies each turn (territories ÷ 3, min 3) plus continent bonuses. Tap your territories to place them.</li>
        <li><b>Attack</b>Tap one of your territories, then an adjacent enemy. Blitz fights until one side breaks. Check the win % before you commit.</li>
        <li><b>Fortify</b>Move armies once along your own connected territories, then your turn ends.</li>
        <li><b>Cards</b>Capture a territory to earn a card. Trade three matching or three different for bonus armies.</li>
        <li><b>Continents</b>Hold a whole continent for its bonus every turn. Guard its entry points.</li>
      </ol>
      <p class="fine">Drag to pan, pinch or scroll to zoom, right-drag to tilt. Keys: <kbd>Space</kbd> next step, <kbd>B</kbd> blitz, <kbd>R</kbd> roll once, <kbd>H</kbd> hint, <kbd>T</kbd> threat overlay, <kbd>Esc</kbd> cancel. Campaigns autosave at the start of every turn.</p>
    </section>`;
  document.body.appendChild(el);

  const go = (name) => {
    el.querySelectorAll('.screen').forEach((sc) => sc.classList.toggle('hidden', !sc.classList.contains(name === 'title' ? 'title-screen' : name)));
    el.classList.toggle('deep', name !== 'title');
    el.scrollTop = 0;
    audio.unlock();
    audio.select();
  };
  el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

  const sync = () => {
    slots.forEach((s, i) => {
      const card = el.querySelector(`.cmdr[data-i="${i}"]`);
      const off = s.type === 'off';
      card.classList.toggle('off', off);
      card.classList.toggle('human', s.type === 'human');
      if (off) return;
      card.querySelector('.crest').innerHTML = crest(s.type);
      card.querySelector('.rlabel').innerHTML = s.type === 'human' ? '<small>Human</small>Commander' : `<small>AI</small>${LEVELS[s.type].name}`;
      card.querySelector('.blurb').textContent = s.type === 'human' ? 'Takes turns on this device.' : LEVELS[s.type].blurb;
    });
    el.querySelector('#start').disabled = slots.filter((s) => s.type !== 'off').length < 2;
    el.querySelectorAll('.mode').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === opts.mode)));
    const speed = el.querySelector('#speed'), adv = el.querySelector('#advisor');
    speed.setAttribute('aria-pressed', String(opts.speed === 'fast'));
    speed.querySelector('b').textContent = opts.speed === 'fast' ? 'Fast' : 'Normal';
    adv.setAttribute('aria-pressed', String(opts.advisor));
    adv.querySelector('b').textContent = opts.advisor ? 'On' : 'Off';
  };

  el.querySelectorAll('.cmdr').forEach((card) => {
    const i = +card.dataset.i;
    const set = (type) => {
      audio.unlock(); audio.select();
      slots[i].type = type;
      sync();
      if (!fx?.reduced) { card.classList.remove('pulse'); void card.offsetWidth; card.classList.add('pulse'); }
    };
    card.querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => {
      const n = ROLES.length;
      set(ROLES[(ROLES.indexOf(slots[i].type) + +b.dataset.d + n) % n]);
    }));
    card.querySelector('.dismiss')?.addEventListener('click', () => set('off'));
    card.querySelector('.enlist')?.addEventListener('click', () => set('soldier'));
    const input = card.querySelector('.cname');
    input.addEventListener('input', () => { slots[i].name = input.value.trim() || `Player ${i + 1}`; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  });
  el.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => { opts.mode = b.dataset.mode; sync(); }));
  el.querySelector('#speed').addEventListener('click', () => { opts.speed = opts.speed === 'fast' ? 'normal' : 'fast'; sync(); });
  el.querySelector('#advisor').addEventListener('click', () => { opts.advisor = !opts.advisor; sync(); });
  sync();

  const leave = (then) => {
    audio.unlock();
    el.classList.add('out');
    setTimeout(() => { el.remove(); then(); }, fx?.reduced ? 0 : 220);
  };

  el.querySelector('#resume')?.addEventListener('click', () => leave(() => startGame(save.slots, save.opts, Game.fromJSON(save.game))));

  el.querySelector('#start').addEventListener('click', () => {
    saveSlots(slots);
    try { localStorage.setItem('conquest.opts', JSON.stringify(opts)); } catch { /* ignore */ }
    leave(() => startGame(slots, opts));
  });
}

function saveSummary(g) {
  const human = g.players.find((p) => p.human && p.alive) ?? g.players[g.current];
  const held = g.owner.filter((o) => o === human.id).length;
  return `${MODES[g.mode].name} · round ${Math.max(1, g.round)} · ${human.name}: ${held} territories`;
}

function startGame(slots, opts, resumed = null) {
  lastConfig = { slots, opts };
  const players = slots
    .map((s, i) => ({ ...s, i }))
    .filter((s) => s.type !== 'off')
    .map((s) => ({
      name: s.name, color: PALETTE[s.i].color, human: s.type === 'human', level: s.type === 'human' ? 'soldier' : s.type,
    }));
  const game = resumed || new Game({ players, mode: opts.mode, seed: (Math.random() * 2 ** 31) | 0 });
  const cssColors = game.players.map((p) => `#${p.color.toString(16).padStart(6, '0')}`);
  mountBoard(game.players.map((p) => p.color));
  hud = new Hud(app);
  labels = new Labels(hud.root, stage, board, cssColors);
  stage.intro(fx.reduced);
  controller = new Controller({
    game, stage, board, fx, hud, labels, options: opts, resumed: !!resumed,
    // A new game replaces any older save once its first turn starts.
    onSave: (g) => writeSave(g, { slots, opts }),
    onExit: (why) => {
      controller.destroy();
      hud.destroy();
      labels = null;
      if (why === 'again') startGame(lastConfig.slots, lastConfig.opts);
      else { mountBoard(PALETTE.map((p) => p.color)); showMenu(); }
    },
  });
  // Handy for debugging and for automated tests.
  window.__conquest = { game, controller, board, stage, fx };
}

mountBoard(PALETTE.map((p) => p.color));
// Attract mode: colour the menu board with a random deal.
{
  const demo = new Game({ players: [{}, {}, {}, {}], seed: 42 });
  for (let t = 0; t < 42; t++) board.setTerritory(t, demo.owner[t], 1 + ((t * 7) % 6));
}
loop();
showMenu();
