/* Step 7 (UI pass): what's used less often lives in popovers, the Simulate overlay and the bottom
   drawer, so the editor gets the screen.
   - Pop: a button with data-pop="<id>" opens the element with that id (class "pop") below it; a click
     outside, Escape or opening another one closes it. The controls stay in the page, so their
     handlers work as before.
   - Drawer: the bottom bar names the selected instrument; ▴ Sound and ⌨ Keyboard open above it.
   - Sim: ▶ Simulate opens the Simulate panel as an overlay on the right. */

const Pop = {
  init() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pop]');
      if (b) {
        const p = document.getElementById(b.dataset.pop);
        if (!p) return;
        const open = p.hidden;
        this.closeAll();
        if (open) this.open(p, b);
        return;
      }
      if (!e.target.isConnected) return;                 // the popover re-rendered under the click
      if (!e.target.closest('.pop')) this.closeAll();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeAll(); });
    window.addEventListener('resize', () => this.closeAll());
  },
  open(p, b) {
    p.hidden = false;
    b.classList.add('on');
    b.setAttribute('aria-expanded', 'true');
    this.place(p, b);
  },
  /* Below the button (above it if there's no room), kept inside the window. */
  place(p, b) {
    const r = b.getBoundingClientRect();
    p.style.left = '0px'; p.style.top = '0px';
    const w = p.offsetWidth, h = p.offsetHeight;
    const left = clamp(r.left, 8, Math.max(8, innerWidth - w - 8));
    const top = r.bottom + 4 + h > innerHeight - 8 && r.top - 4 - h > 8 ? r.top - 4 - h : r.bottom + 4;
    p.style.left = left + 'px';
    p.style.top = top + 'px';
    p.style.maxHeight = Math.max(160, innerHeight - top - 8) + 'px';
  },
  closeAll() {
    $$('.pop').forEach((p) => { p.hidden = true; });
    $$('[data-pop].on').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); });
  },
};

const Drawer = {
  sound: false,
  kbd: false,
  init() {
    try { this.sound = localStorage.getItem('synthstudio.drawerSound') === '1'; this.kbd = localStorage.getItem('synthstudio.drawerKbd') === '1'; } catch (e) { /* storage blocked */ }
    $('#btnSound').onclick = () => this.set('sound', !this.sound);
    $('#btnKbd').onclick = () => this.set('kbd', !this.kbd);
    // Double-click an instrument in the sidebar: open its sound.
    $('#trackList').addEventListener('dblclick', (e) => { if (e.target.closest('.track-item') && !e.target.closest('.name, input, button')) this.set('sound', true); });
    this.apply();
  },
  set(which, on) {
    this[which] = on;
    try { localStorage.setItem(which === 'sound' ? 'synthstudio.drawerSound' : 'synthstudio.drawerKbd', on ? '1' : '0'); } catch (e) { /* storage blocked */ }
    this.apply();
  },
  apply() {
    const f = $('#bottom');
    f.classList.toggle('snd-open', this.sound);
    f.classList.toggle('kbd-open', this.kbd);
    $('#btnSound').classList.toggle('on', this.sound);
    $('#btnKbd').classList.toggle('on', this.kbd);
    $('#btnSound').textContent = (this.sound ? '▾' : '▴') + ' Sound';
    if (this.kbd) UI.renderKeyboard();
    if (this.sound) requestAnimationFrame(() => InstCurves.ed && InstCurves.ed.draw());
  },
  /* The bar's label: the instrument the sound panel edits. */
  who(tg) {
    const el = $('#drawerWho');
    if (!el) return;
    if (!tg || !tg.role) { el.innerHTML = '<span class="muted">No instrument selected</span>'; return; }
    const color = tg.track ? tg.track.color : tg.role.color;
    el.innerHTML = `<span class="dot" style="background:${color}"></span><b>${esc(tg.track ? tg.track.name : tg.role.name)}</b> <span class="muted">· ${esc(soundName(tg.sound))}${tg.track && tg.track.sound ? ' · customized for this level' : ''}</span>`;
  },
};

const Sim = {
  init() {
    let open = false;
    try { open = localStorage.getItem('synthstudio.simOpen') === '1'; } catch (e) { /* storage blocked */ }
    $('#btnSim').onclick = () => this.set($('#simOverlay').hidden);
    $('#btnSimClose').onclick = () => this.set(false);
    window.addEventListener('resize', () => this.place());
    this.set(open);
  },
  /* Just under the map, so the map's own buttons stay in reach. */
  place() {
    const o = $('#simOverlay');
    if (o.hidden) return;
    const top = Math.round($('#mapArea').getBoundingClientRect().bottom + 6);
    o.style.top = top + 'px';
    o.style.maxHeight = Math.max(200, innerHeight - top - 46) + 'px';
  },
  set(on) {
    $('#simOverlay').hidden = !on;
    this.place();
    $('#btnSim').classList.toggle('on', on);
    try { localStorage.setItem('synthstudio.simOpen', on ? '1' : '0'); } catch (e) { /* storage blocked */ }
    if (on) UI.renderSim();
  },
};
