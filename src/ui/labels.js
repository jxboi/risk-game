// DOM overlay pinned to 3D positions: army counts on each territory and
// floating popups ("-2", "CAPTURED"). DOM text stays crisp at any zoom.

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

  update() {
    const { stage, board, pt } = this;
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
      it.el.classList.toggle('hot', v.pulse > 0);
    }
    for (const p of this.popups) {
      stage.project(p.pos, pt);
      p.el.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }
}
