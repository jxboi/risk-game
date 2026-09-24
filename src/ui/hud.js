// In-game DOM chrome. The HUD only renders what the controller hands it;
// it holds no game logic.

import { CONTINENTS, CONTINENT_MEMBERS } from '../data/map.js';
import { CARD_TYPES } from '../game/game.js';
import { LEVELS } from '../game/ai.js';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

export class Hud {
  constructor(root) {
    this.root = h('div', 'hud');
    root.appendChild(this.root);
    this.players = h('div', 'panel players');
    this.phase = h('div', 'panel phasebar');
    this.actions = h('div', 'actions');
    this.side = h('div', 'panel advisor');
    this.continents = h('div', 'panel continents');
    this.dice = h('div', 'dicebox hidden');
    this.banner = h('div', 'banner');
    this.toasts = h('div', 'toasts');
    this.tooltip = h('div', 'forecast hidden');
    this.tools = h('div', 'tools');
    this.legend = h('div', 'panel legend hidden');
    for (const el of [this.players, this.phase, this.continents, this.legend, this.side, this.dice, this.actions, this.banner, this.toasts, this.tooltip, this.tools]) {
      this.root.appendChild(el);
    }
    this.bannerTimer = 0;
  }

  // ---- top-left: players -------------------------------------------------
  renderPlayers(g) {
    this.players.innerHTML = '';
    g.players.forEach((p) => {
      const row = h('div', `prow${p.id === g.current ? ' active' : ''}${p.alive ? '' : ' dead'}`);
      row.style.setProperty('--c', hex(p.color));
      const tag = p.human ? 'Human' : LEVELS[p.level].name;
      const conts = g.continentsOf(p.id).map((ci) => CONTINENTS[ci].name.split(' ').map((w) => w[0]).join('')).join(' ');
      row.innerHTML = `<span class="chip"></span>
        <span class="pname">${p.name}<small>${tag}</small></span>
        <span class="pstat" title="Territories">⬢ ${g.countOf(p.id)}</span>
        <span class="pstat" title="Armies">♜ ${g.armiesOf(p.id)}</span>
        <span class="pstat" title="Cards">🂠 ${p.cards.length}</span>
        ${conts ? `<span class="conts">${conts}</span>` : ''}`;
      this.players.appendChild(row);
    });
  }

  // ---- continent tracker (for the viewing human) --------------------------
  renderContinents(g, p) {
    this.continents.innerHTML = '<div class="title">Continents</div>';
    CONTINENTS.forEach((c, ci) => {
      const members = CONTINENT_MEMBERS[ci];
      const own = members.filter((t) => g.owner[t] === p).length;
      const holder = g.players.find((pl) => g.ownsContinent(pl.id, ci));
      const row = h('div', 'crow');
      row.innerHTML = `<span class="cname">${c.name}</span>
        <span class="cbar"><i style="width:${(own / members.length) * 100}%"></i></span>
        <span class="cnum">${own}/${members.length}</span>
        <span class="cbonus" ${holder ? `style="background:${hex(holder.color)}"` : ''}>+${c.bonus}</span>`;
      this.continents.appendChild(row);
    });
  }

  // ---- top-centre: phase + instruction ------------------------------------
  setPhase(g, instruction) {
    const steps = ['reinforce', 'attack', 'fortify'];
    const cur = g.phase === 'occupy' ? 'attack' : g.phase;
    const p = g.player;
    const stepHtml = g.phase === 'setup'
      ? '<span class="step on">Deploy</span>'
      : steps.map((s) => `<span class="step${s === cur ? ' on' : ''}">${s[0].toUpperCase() + s.slice(1)}</span>`).join('<span class="sep">›</span>');
    this.phase.style.setProperty('--c', hex(p.color));
    this.phase.innerHTML = `<div class="who"><span class="chip"></span>${p.name}<small>Round ${Math.max(1, g.round)}</small></div>
      <div class="steps">${stepHtml}</div><div class="instr">${instruction}</div>`;
  }

  // ---- bottom: contextual actions -----------------------------------------
  // items: { label, onClick, primary, disabled, key, active } | { slider: {...} } | { html }
  setActions(items) {
    this.actions.innerHTML = '';
    for (const it of items) {
      if (it.slider) {
        const s = it.slider;
        const wrap = h('label', 'slider');
        wrap.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" value="${s.value}"><b>${s.value}</b>`;
        const input = wrap.querySelector('input');
        const out = wrap.querySelector('b');
        input.addEventListener('input', () => { out.textContent = input.value; s.onChange(+input.value); });
        this.actions.appendChild(wrap);
      } else if (it.html) {
        this.actions.appendChild(h('div', 'note', it.html));
      } else {
        const b = h('button', `btn${it.primary ? ' primary' : ''}${it.active ? ' active' : ''}`,
          `${it.label}${it.key ? `<kbd>${it.key}</kbd>` : ''}`);
        b.disabled = !!it.disabled;
        b.addEventListener('click', (e) => { e.stopPropagation(); it.onClick(); });
        this.actions.appendChild(b);
      }
    }
  }

  // ---- advisor ------------------------------------------------------------
  setAdvisor(visible, tips, suggestion, onSuggest) {
    this.side.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.side.innerHTML = '<div class="title">Advisor</div>';
    for (const t of tips) this.side.appendChild(h('div', 'tip', t.text));
    if (suggestion) this.side.appendChild(h('div', 'tip suggest', `💡 ${suggestion}`));
    if (onSuggest) {
      const b = h('button', 'btn small', 'Suggest a move<kbd>H</kbd>');
      b.addEventListener('click', onSuggest);
      this.side.appendChild(b);
    }
  }

  // ---- battle forecast tooltip (sits above the target, never under a finger)
  showForecast(pt, f, from, to) {
    this.tooltip.classList.remove('hidden');
    this.tooltip.className = `forecast ${f.tone}`;
    this.tooltip.innerHTML = `<div class="odds">${Math.round(f.win * 100)}%</div>
      <div class="ftitle">${f.verdict}</div>
      <div class="fline">${f.attackers} ⚔ ${f.defenders} · expect to lose ~${f.expLoss.toFixed(1)}</div>`;
    this.tooltip.style.transform = `translate(${pt.x}px, ${pt.y - 70}px) translate(-50%, -100%)`;
  }
  hideForecast() { this.tooltip.classList.add('hidden'); }

  // ---- dice -----------------------------------------------------------------
  showDice(r, colors) {
    const die = (v, cls, i, lost) => `<div class="die ${cls}${lost ? ' lost' : ''}" style="--i:${i}">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<span class="${PIPS[v].includes(k) ? 'pip' : ''}"></span>`).join('')}</div>`;
    const n = Math.min(r.att.length, r.def.length);
    const aLost = r.att.map((v, i) => i < n && v <= r.def[i]);
    const dLost = r.def.map((v, i) => i < n && r.att[i] > v);
    this.dice.classList.remove('hidden');
    this.dice.style.setProperty('--a', colors[r.attacker]);
    this.dice.style.setProperty('--d', colors[r.defender]);
    this.dice.innerHTML = `<div class="drow">${r.att.map((v, i) => die(v, 'att', i, aLost[i])).join('')}</div>
      <div class="vs">${r.dLoss ? `<b class="good">-${r.dLoss}</b>` : ''}${r.aLoss ? `<b class="bad">-${r.aLoss}</b>` : ''}</div>
      <div class="drow">${r.def.map((v, i) => die(v, 'def', i, dLost[i])).join('')}</div>`;
    clearTimeout(this.diceTimer);
    this.diceTimer = setTimeout(() => this.dice.classList.add('hidden'), 1600);
  }

  // ---- banner + toasts ------------------------------------------------------
  showBanner(title, sub = '', color = '#fff', big = false, ms = 1400) {
    this.banner.className = `banner show${big ? ' big' : ''}`;
    this.banner.style.setProperty('--c', color);
    this.banner.innerHTML = `<div class="btitle">${title}</div>${sub ? `<div class="bsub">${sub}</div>` : ''}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { this.banner.className = 'banner'; }, ms);
  }

  toast(html, ms = 3500, cls = '') {
    const t = h('div', `toast ${cls}`, html);
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  // ---- cards dialog --------------------------------------------------------
  cardsHtml(cards, names) {
    const icon = ['🪖', '🐎', '💣', '★'];
    return cards.map((c) => `<span class="card t${c.type}"><b>${icon[c.type]}</b>${c.t >= 0 ? names[c.t] : 'Wild'}<small>${CARD_TYPES[c.type]}</small></span>`).join('');
  }

  // ---- tools (top-right) ----------------------------------------------------
  setTools(items) {
    this.tools.innerHTML = '';
    for (const it of items) {
      const b = h('button', `tool${it.on ? ' on' : ''}`, it.icon);
      b.title = it.title;
      b.addEventListener('click', (e) => { e.stopPropagation(); it.onClick(); });
      this.tools.appendChild(b);
    }
  }

  // ---- threat overlay legend (replaces the continent tracker while on) -------
  setLegend(items) {
    const on = !!items;
    this.legend.classList.toggle('hidden', !on);
    this.continents.classList.toggle('hidden', on);
    if (!on || this.legendItems === items) return;
    this.legendItems = items;
    this.legend.innerHTML = `<div class="title">Threat overlay<kbd>T</kbd></div>${items.map((it) => `
      <div class="lrow" style="--c:${it.color}"><span class="chip"></span><b>${it.label}</b><small>${it.tip}</small></div>`).join('')}`;
  }

  destroy() { this.root.remove(); }
}

// Territories held per player over the game, as an inline SVG line chart.
// history: one array of counts per turn; colors: CSS colour per player.
export function territoryChart(history, colors, names, goal) {
  const W = 480, H = 150, pad = 4;
  if (history.length < 2) return '';
  const maxY = Math.max(goal, ...history.flat());
  const x = (i) => pad + (i / (history.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - (v / maxY) * (H - pad * 2);
  const lines = colors.map((c, p) => {
    const pts = history.map((row, i) => `${x(i).toFixed(1)},${y(row[p]).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"><title>${names[p]}</title></polyline>`;
  }).join('');
  const goalLine = `<line x1="${pad}" x2="${W - pad}" y1="${y(goal)}" y2="${y(goal)}" class="goal" vector-effect="non-scaling-stroke"/>`;
  return `<figure class="chart"><figcaption>Territories held, turn by turn <span>(dashed line: goal)</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Territories held over time">${goalLine}${lines}</svg></figure>`;
}
