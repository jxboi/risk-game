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
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function loadSlots() {
  try { return JSON.parse(localStorage.getItem('conquest.slots')) || DEFAULT_SLOTS; } catch { return DEFAULT_SLOTS; }
}
function saveSlots(slots) { try { localStorage.setItem('conquest.slots', JSON.stringify(slots)); } catch { /* ignore */ } }

function showMenu() {
  const slots = loadSlots().map((s) => ({ ...s }));
  const opts = { mode: 'classic', advisor: true, speed: 'normal' };
  try { Object.assign(opts, JSON.parse(localStorage.getItem('conquest.opts')) || {}); } catch { /* ignore */ }

  const el = document.createElement('div');
  el.className = 'overlay menu';
  const levelOpts = Object.entries(LEVELS).map(([k, v]) => `<option value="${k}">AI · ${v.name}</option>`).join('');
  el.innerHTML = `
    <div class="card-panel">
      <div class="logo">CONQUEST<span>World Domination in 3D</span></div>
      <div class="slots">${slots.map((s, i) => `
        <div class="slot" style="--c:#${PALETTE[i].color.toString(16).padStart(6, '0')}">
          <span class="chip"></span>
          <input value="${s.name}" maxlength="14" data-i="${i}" aria-label="Player ${i + 1} name">
          <select data-i="${i}" aria-label="Player ${i + 1} type">
            <option value="human">Human</option>${levelOpts}${i >= 2 ? '<option value="off">No player</option>' : ''}
          </select>
          <span class="blurb" data-b="${i}"></span>
        </div>`).join('')}</div>
      <div class="optrow">
        <label>Mode <select id="mode">${Object.entries(MODES).map(([k, m]) => `<option value="${k}">${m.name}${k === 'quick' ? ` (${m.goal} territories)` : ''}</option>`).join('')}</select></label>
        <label>AI speed <select id="speed"><option value="normal">Normal</option><option value="fast">Fast</option></select></label>
        <label class="check"><input type="checkbox" id="advisor"> Advisor tips</label>
      </div>
      <button class="btn primary big" id="start">Start campaign</button>
      <details class="howto"><summary>How to play</summary>
        <ol>
          <li><b>Reinforce:</b> you get armies each turn (territories ÷ 3, min 3) plus continent bonuses. Click your territories to place them.</li>
          <li><b>Attack:</b> click one of your territories, then an adjacent enemy. <b>Blitz</b> fights until one side breaks. Check the win % before you commit.</li>
          <li><b>Fortify:</b> move armies once along your own connected territories, then your turn ends.</li>
          <li>Capture a territory to earn a <b>card</b>. Trade three matching or three different cards for bonus armies.</li>
          <li>Hold a whole continent for its bonus every turn. Guard its entry points.</li>
        </ol>
        <p>Controls: drag to pan, scroll or pinch to zoom, right-drag to tilt. Keys: <kbd>Space</kbd> next step, <kbd>B</kbd> blitz, <kbd>R</kbd> roll once, <kbd>H</kbd> hint, <kbd>Esc</kbd> cancel.</p>
      </details>
    </div>`;
  document.body.appendChild(el);

  const sync = () => {
    slots.forEach((s, i) => {
      el.querySelector(`[data-b="${i}"]`).textContent = s.type === 'human' ? 'Takes turns on this device' : s.type === 'off' ? '' : LEVELS[s.type].blurb;
      el.querySelectorAll('.slot')[i].classList.toggle('off', s.type === 'off');
    });
    const n = slots.filter((s) => s.type !== 'off').length;
    el.querySelector('#start').disabled = n < 2;
  };
  el.querySelectorAll('select[data-i]').forEach((sel) => {
    const i = +sel.dataset.i;
    sel.value = slots[i].type;
    sel.addEventListener('change', () => { slots[i].type = sel.value; sync(); });
  });
  el.querySelectorAll('input[data-i]').forEach((inp) => {
    inp.addEventListener('input', () => { slots[+inp.dataset.i].name = inp.value || `Player ${+inp.dataset.i + 1}`; });
  });
  const mode = el.querySelector('#mode'), speed = el.querySelector('#speed'), adv = el.querySelector('#advisor');
  mode.value = opts.mode; speed.value = opts.speed; adv.checked = opts.advisor;
  sync();

  el.querySelector('#start').addEventListener('click', () => {
    audio.unlock();
    opts.mode = mode.value; opts.speed = speed.value; opts.advisor = adv.checked;
    saveSlots(slots);
    try { localStorage.setItem('conquest.opts', JSON.stringify(opts)); } catch { /* ignore */ }
    el.remove();
    startGame(slots, opts);
  });
}

function startGame(slots, opts) {
  lastConfig = { slots, opts };
  const players = slots
    .map((s, i) => ({ ...s, i }))
    .filter((s) => s.type !== 'off')
    .map((s) => ({
      name: s.name, color: PALETTE[s.i].color, human: s.type === 'human', level: s.type === 'human' ? 'soldier' : s.type,
    }));
  const game = new Game({ players, mode: opts.mode, seed: (Math.random() * 2 ** 31) | 0 });
  const cssColors = players.map((p) => `#${p.color.toString(16).padStart(6, '0')}`);
  mountBoard(players.map((p) => p.color));
  hud = new Hud(app);
  labels = new Labels(hud.root, stage, board, cssColors);
  stage.fitView();
  controller = new Controller({
    game, stage, board, fx, hud, labels, options: opts,
    onExit: (why) => {
      controller.destroy();
      hud.destroy();
      labels = null;
      if (why === 'again') startGame(lastConfig.slots, lastConfig.opts);
      else { mountBoard(PALETTE.map((p) => p.color)); showMenu(); }
    },
  });
  // Handy for debugging and for automated tests.
  window.__conquest = { game, controller, board, stage };
}

mountBoard(PALETTE.map((p) => p.color));
// Attract mode: colour the menu board with a random deal.
{
  const demo = new Game({ players: [{}, {}, {}, {}], seed: 42 });
  for (let t = 0; t < 42; t++) board.setTerritory(t, demo.owner[t], 1 + ((t * 7) % 6));
}
loop();
showMenu();
