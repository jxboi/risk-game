// In-world confirm dialog: replaces the browser's confirm() so leaving a
// game feels like part of the game, not a system alert.

export function ask({ title, body = '', ok = 'OK', cancel = 'Cancel', color = '#ffd27a', danger = false }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'dialog-scrim';
    el.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" style="--c:${color}">
        <div class="dialog-crest" aria-hidden="true"></div>
        <h2 id="dlg-t">${title}</h2>
        ${body ? `<p>${body}</p>` : ''}
        <div class="dialog-row">
          <button class="btn" data-v="0">${cancel}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${ok}</button>
        </div>
      </div>`;
    const close = (v) => {
      window.removeEventListener('keydown', onKey, true);
      el.classList.add('out');
      setTimeout(() => el.remove(), 160);
      resolve(v);
    };
    // Capture phase: while the dialog is up, no key reaches the game.
    const onKey = (e) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (b) close(b.dataset.v === '1');
      else if (e.target === el) close(false);
    });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(el);
    el.querySelector('button[data-v="0"]').focus();
  });
}
