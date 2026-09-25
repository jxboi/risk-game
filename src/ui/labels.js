// DOM overlay pinned to 3D positions: army counts and place names on each
// territory, continent names on the sea, and floating popups ("-2",
// "CAPTURED"). DOM text stays crisp at any zoom.
import { CONTINENTS, TERRITORIES } from '../data/map.js';
import { toWorld } from '../render/board.js';

// Territory names show once a map unit is at least this many CSS pixels wide;
// zoomed further out they would overlap.
const NAME_MIN_PPU = 9;

export class Labels {
  constructor(root, stage, board, playerColors) {
    this.stage = stage;
    this.board = board;
    this.colors = playerColors;
    this.layer = document.createElement('div');
    this.layer.className = 'labels';
    root.insertBefore(this.layer, root.firstChild); // under the HUD panels
    this.items = board.tv.map(() => {
      const el = document.createElement('div');
      el.className = 'army';
      this.layer.appendChild(el);
      return { el, armies: -1, owner: -2 };
    });
    this.names = TERRITORIES.map((t) => {
      const el = document.createElement('div');
      el.className = 'tname';
      el.textContent = t.short ?? t.name;
      this.layer.appendChild(el);
      return el;
    });
    this.conts = CONTINENTS.map((c) => {
      const el = document.createElement('div');
      el.className = 'cont';
      el.textContent = c.name;
      el.style.setProperty('--t', `#${c.tint.toString(16).padStart(6, '0')}`);
      this.layer.prepend(el); // under the badges and names
      return { el, pos: toWorld(...c.label) };
    });
    this.probe = [toWorld(50, 30), toWorld(51, 30)];
    this.nameSize = null; // measured lazily once fonts have laid out
    this.boxes = [];
    this.popups = [];
    this.pt = { x: 0, y: 0, visible: true };
  }

  bump(ti) {
    const el = this.items[ti].el;
    el.classList.remove('bump');
    void el.offsetWidth; // restart the animation
    el.classList.add('bump');
  }

  popup(worldPos, text, cls = '') {
    const el = document.createElement('div');
    el.className = `popup ${cls}`;
    el.innerHTML = text;
    this.layer.appendChild(el);
    const p = { el, pos: worldPos.clone(), t: 0 };
    this.popups.push(p);
    setTimeout(() => { el.remove(); this.popups.splice(this.popups.indexOf(p), 1); }, 1300);
  }

  // Zoomed far out, a map unit is only a few pixels and names can't fit.
  farCheck() {
    const { stage, pt } = this;
    stage.project(this.probe[0], pt);
    const x0 = pt.x, y0 = pt.y;
    stage.project(this.probe[1], pt);
    return Math.hypot(pt.x - x0, pt.y - y0) < NAME_MIN_PPU;
  }

  update() {
    const { stage, board, pt } = this;
    const far = this.farCheck();
    this.nameSize ??= this.names.map((el) => [el.offsetWidth, el.offsetHeight]);
    const boxes = this.boxes;
    boxes.length = 0;
    for (let ti = 0; ti < this.items.length; ti++) {
      const it = this.items[ti];
      const v = board.tv[ti];
      if (v.armies !== it.armies) { it.el.textContent = v.armies; it.armies = v.armies; }
      if (v.owner !== it.owner) {
        it.el.style.setProperty('--c', this.colors[v.owner] ?? '#888');
        it.owner = v.owner;
      }
      stage.project(board.tokenTop(ti), pt);
      it.el.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${(pt.y - 10).toFixed(1)}px, 0) translate(-50%, -100%)`;
      boxes.push([pt.x - 15, pt.y - 32, pt.x + 15, pt.y - 10]); // the army badge
      it.el.classList.toggle('hot', v.pulse > 0);
    }
    // Names hang under the token base so they don't bob with the stack.
    // Any name that would cover a badge or an earlier name stays hidden.
    for (let ti = 0; ti < this.names.length; ti++) {
      const el = this.names[ti];
      stage.project(board.tokens[ti].group.position, pt);
      const [w, h] = this.nameSize[ti];
      const box = [pt.x - w / 2, pt.y + 8, pt.x + w / 2, pt.y + 8 + h];
      const show = !far && !boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3]);
      if (show) {
        boxes.push(box);
        el.style.transform = `translate3d(${box[0].toFixed(1)}px, ${box[1].toFixed(1)}px, 0)`;
      }
      el.classList.toggle('hide', !show);
    }
    for (const c of this.conts) {
      stage.project(c.pos, pt);
      c.el.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
    for (const p of this.popups) {
      stage.project(p.pos, pt);
      p.el.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }
}
