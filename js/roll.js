/* Piano roll editor (canvas). Steps are 16th notes; notes are {s, l, p, v}. */

const Roll = {
  lo: 24, hi: 108, rowH: 14, cellW: 22, zoom: 22, keyW: 52,
  sel: new Set(),
  drag: null,

  init() {
    this.wrap = $('#rollWrap');
    this.keys = $('#rollKeys');
    this.grid = $('#rollGrid');
    $('#songKey').innerHTML = NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('');
    $('#songScale').innerHTML = Object.entries(SCALES).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
    $('#loopGen').innerHTML = Object.keys(LOOP_GENERATORS).map((k) => `<option>${k}</option>`).join('');
    $('#loopProg').innerHTML = Object.keys(PROGRESSIONS).map((k) => `<option>${k}</option>`).join('');
    $('#rollVel').value = App.vel;

    $('#rollTrack').onchange = (e) => { if (e.target.value) UI.selectTrack(e.target.value); };
    $('#rollSnap').onchange = (e) => (App.snap = +e.target.value);
    $('#rollLen').onchange = (e) => (App.noteLen = +e.target.value);
    $('#rollVel').oninput = (e) => {
      App.vel = +e.target.value;
      if (this.sel.size) { this.sel.forEach((n) => (n.v = App.vel)); this.draw(); App.changed(); }
    };
    $('#rollVel').onpointerdown = () => { if (this.sel.size) App.pushUndo(); };
    $('#songKey').onchange = (e) => { App.pushUndo(); App.song.key = +e.target.value; this.draw(); UI.renderKeyboard(); App.changed(); };
    $('#songScale').onchange = (e) => { App.pushUndo(); App.song.scale = e.target.value; this.draw(); UI.renderKeyboard(); App.changed(); };
    $('#rollGhost').onchange = () => this.draw();
    $('#rollZoom').oninput = (e) => { this.zoom = +e.target.value; this.draw(); };
    $('#recQuant').onchange = (e) => (App.quantize = e.target.checked);
    $('#btnLoopInsert').onclick = () => this.insertLoop();
    $('#btnRollClear').onclick = () => {
      const t = this.track(); if (!t) return;
      App.pushUndo(); App.pattern().notes[t.id] = []; delete App.pattern().origins[t.id]; this.sel.clear(); this.draw(); App.changed();
    };
    this.initThemes();
    $('#btnTransUp').onclick = () => this.transpose(1);
    $('#btnTransDown').onclick = () => this.transpose(-1);
    $('#btnQuant').onclick = () => {
      const ns = this.notes(); if (!ns) return;
      App.pushUndo();
      const q = App.snap;
      ns.forEach((n) => { n.s = Math.round(n.s / q) * q; n.l = Math.max(q, Math.round(n.l / q) * q); });
      this.draw(); App.changed();
    };

    this.grid.addEventListener('contextmenu', (e) => e.preventDefault());
    this.grid.addEventListener('pointerdown', (e) => this.onDown(e));
    this.grid.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    this.keys.addEventListener('pointerdown', (e) => {
      const r = this.keys.getBoundingClientRect();
      const p = this.hi - Math.floor((e.clientY - r.top) / this.rowH);
      this.audition(p);
    });
  },

  /* ---------- themes ---------- */
  themeOpts() { return { oct: +$('#themeOct').value, speed: +$('#themeSpeed').value, fit: $('#themeFit').checked }; },
  origin() { const t = this.track(); const o = t && App.pattern().origins[t.id]; return o && Themes.find(o.theme) ? o : null; },
  initThemes() {
    const go = (mode) => {
      const t = this.track(), th = Themes.find($('#themeSel').value);
      if (!t || !th) return;
      App.pushUndo();
      const n = Themes.insert(th, t, App.pattern(), this.themeOpts(), mode);
      this.sel.clear(); this.scrollToNotes(); App.changed(); UI.renderStyle();
      toast(`${mode === 'add' ? 'Added' : 'Inserted'} “${th.name}” (${n} notes)${this.themeOpts().fit ? ` in ${NOTE_NAMES[App.song.key]} ${SCALES[App.song.scale].name}` : ''}`);
    };
    $('#btnThemeInsert').onclick = () => go('replace');
    $('#btnThemeAdd').onclick = () => go('add');
    $('#btnThemePlay').onclick = () => { const th = Themes.find($('#themeSel').value); if (th) Themes.preview(th); };
    $('#btnThemeSave').onclick = () => {
      const t = this.track(), ns = this.notes();
      if (!t || !ns || !ns.length) return;
      const src = this.sel.size ? [...this.sel] : ns;
      App.pushUndo();
      const th = Themes.capture(`${App.pattern().name} ${t.name}`, src, t);
      if (!this.sel.size) App.pattern().origins[t.id] = { theme: th.id, oct: 0, speed: 1, fit: true };
      this.renderThemeBar(); $('#themeSel').value = th.id; UI.renderStyle(); App.changed();
      toast(`Saved melody “${th.name}” — rename or hear it in the Library tab`, 3500);
    };
    $('#btnThemeReapply').onclick = () => {
      const t = this.track(), o = this.origin();
      if (!o) return;
      App.pushUndo();
      Themes.insert(Themes.find(o.theme), t, App.pattern(), { oct: o.oct, speed: o.speed, fit: o.fit }, 'replace');
      this.sel.clear(); this.draw(); App.changed();
      undoToast('Re-applied the theme to these notes');
    };
    $('#btnThemeUpdate').onclick = () => {
      const t = this.track(), o = this.origin();
      if (!o) return;
      const th = Themes.find(o.theme);
      App.pushUndo();
      Themes.updateFrom(th, this.notes(), o);
      const uses = Themes.usage(th.id) - 1;
      UI.renderStyle(); this.renderThemeBar(); App.changed();
      undoToast(`Updated “${th.name}”` + (uses > 0 ? ` — ${uses} other use${uses > 1 ? 's' : ''} keep their notes until you Re-apply there` : ''));
    };
  },
  /* Show only the theme controls that apply right now. */
  renderThemeBar() {
    const t = this.track(), themes = Library.melodies();
    $('#themeBar').hidden = !t;
    if (!t) return;
    const sel = $('#themeSel'), cur = sel.value;
    sel.innerHTML = themes.map((th) => `<option value="${th.id}">${esc(th.name)} · ${NOTE_NAMES[th.key]} ${SCALES[th.scale].name.toLowerCase()} · ${th.bars} bar${th.bars > 1 ? 's' : ''}</option>`).join('');
    if (themes.some((th) => th.id === cur)) sel.value = cur;
    $('#themeInsert').hidden = !themes.length;
    const ns = this.notes() || [];
    $('#btnThemeSave').hidden = !ns.length;
    const o = this.origin();
    $('#themeLinked').hidden = !o;
    if (o) $('#themeLinkName').textContent = Themes.find(o.theme).name + (o.speed !== 1 || o.oct ? ` (${[o.speed === 2 ? 'half speed' : o.speed === 0.5 ? 'double speed' : '', o.oct ? (o.oct > 0 ? '+' : '') + o.oct + ' oct' : ''].filter(Boolean).join(', ')})` : '');
    if (!themes.length && !ns.length) $('#themeBar').hidden = true; // nothing to do with themes yet
  },

  track() { const t = App.track(); return t && t.type === 'synth' ? t : null; },
  notes() { const t = this.track(); if (!t) return null; const p = App.pattern(); ensurePattern(p); return p.notes[t.id]; },

  audition(p) {
    const t = this.track(); if (!t) return;
    const ctx = Engine.ensure();
    synthVoice(ctx, Engine.g.tracks[t.id].input, snd(t).synth, p, App.vel, ctx.currentTime + 0.005).release(ctx.currentTime + 0.3);
  },

  toCell(e) {
    const r = this.grid.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, step: x / this.cellW, p: this.hi - Math.floor(y / this.rowH) };
  },
  hit(c) {
    const ns = this.notes(); if (!ns) return null;
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = ns[i];
      if (n.p === c.p && c.step >= n.s && c.step <= n.s + n.l) {
        const right = (n.s + n.l) * this.cellW;
        return { n, edge: right - c.x < Math.min(7, (n.l * this.cellW) / 3) };
      }
    }
    return null;
  },

  onDown(e) {
    const ns = this.notes();
    if (!ns) return;
    const c = this.toCell(e);
    const h = this.hit(c);
    const steps = App.pattern().bars * 16;
    if (e.button === 2) {
      if (h) { App.pushUndo(); ns.splice(ns.indexOf(h.n), 1); this.sel.delete(h.n); this.draw(); App.changed(); }
      return;
    }
    this.grid.setPointerCapture(e.pointerId);
    this.snapshot = JSON.stringify(App.project);
    if (!h && e.shiftKey) { this.drag = { mode: 'box', x0: c.x, y0: c.y, x1: c.x, y1: c.y }; return; }
    if (h) {
      if (e.ctrlKey || e.metaKey) { this.sel.has(h.n) ? this.sel.delete(h.n) : this.sel.add(h.n); this.draw(); return; }
      if (!this.sel.has(h.n)) { this.sel.clear(); this.sel.add(h.n); }
      if (e.altKey) { // alt-drag duplicates
        const copies = [...this.sel].map((n) => ({ ...n }));
        ns.push(...copies); this.sel = new Set(copies);
      }
      this.drag = { mode: h.edge ? 'resize' : 'move', c0: c, orig: [...this.sel].map((n) => ({ n, s: n.s, p: n.p, l: n.l })) };
      App.vel = h.n.v; $('#rollVel').value = h.n.v;
      if (!h.edge) this.audition(h.n.p);
    } else {
      const q = App.snap;
      const s = clamp(Math.floor(c.step / q) * q, 0, steps - q);
      const n = { s, l: Math.min(App.noteLen, steps - s), p: clamp(c.p, this.lo, this.hi), v: App.vel };
      ns.push(n);
      this.sel.clear(); this.sel.add(n);
      this.drag = { mode: 'resize', c0: c, orig: [{ n, s: n.s, p: n.p, l: n.l }], created: true };
      this.audition(n.p);
    }
    this.draw();
  },
  onMove(e) {
    const c = this.toCell(e);
    if (!this.drag) {
      const h = this.track() && this.hit(c);
      this.grid.style.cursor = h ? (h.edge ? 'ew-resize' : 'move') : 'crosshair';
      return;
    }
    const d = this.drag, q = App.snap, steps = App.pattern().bars * 16;
    if (d.mode === 'box') { d.x1 = c.x; d.y1 = c.y; this.draw(); return; }
    const ds = Math.round((c.step - d.c0.step) / q) * q;
    if (d.mode === 'move') {
      const dp = c.p - d.c0.p;
      const minS = Math.min(...d.orig.map((o) => o.s)), maxP = Math.max(...d.orig.map((o) => o.p)), minP = Math.min(...d.orig.map((o) => o.p));
      const dsc = Math.max(ds, -minS);
      const dpc = clamp(dp, this.lo - minP, this.hi - maxP);
      let pitchChanged = false;
      d.orig.forEach((o) => {
        const np = o.p + dpc;
        if (np !== o.n.p) pitchChanged = true;
        o.n.s = clamp(o.s + dsc, 0, steps - 0.25); o.n.p = np;
      });
      if (pitchChanged && d.orig.length === 1) this.audition(d.orig[0].n.p);
    } else {
      const dl = d.created ? Math.ceil((c.step - d.c0.step) / q) * q : ds;
      d.orig.forEach((o) => { o.n.l = clamp(o.l + dl, Math.min(q, 0.5), steps - o.n.s); if (d.created && o.n.l < App.noteLen && dl <= 0) o.n.l = App.noteLen; });
    }
    this.draw();
  },
  onUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.mode === 'box') {
      const ns = this.notes() || [];
      const [x0, x1] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)], [y0, y1] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)];
      this.sel.clear();
      ns.forEach((n) => {
        const nx0 = n.s * this.cellW, nx1 = (n.s + n.l) * this.cellW, ny0 = (this.hi - n.p) * this.rowH, ny1 = ny0 + this.rowH;
        if (nx1 > x0 && nx0 < x1 && ny1 > y0 && ny0 < y1) this.sel.add(n);
      });
      this.draw();
      return;
    }
    if (d.mode === 'resize' && d.orig.length === 1) App.noteLen = d.orig[0].n.l;
    if (JSON.stringify(App.project) !== this.snapshot) {
      App.undoStack.push(this.snapshot); App.redoStack = [];
      App.changed();
    }
  },

  selectAll() { const ns = this.notes(); if (!ns) return; this.sel = new Set(ns); this.draw(); },
  deleteSelected() {
    const ns = this.notes(); if (!ns || !this.sel.size) return;
    App.pushUndo();
    const t = this.track();
    App.pattern().notes[t.id] = ns.filter((n) => !this.sel.has(n));
    this.sel.clear(); this.draw(); App.changed();
  },
  transpose(d) {
    const ns = this.notes(); if (!ns) return;
    App.pushUndo();
    (this.sel.size ? [...this.sel] : ns).forEach((n) => (n.p = clamp(n.p + d, this.lo, this.hi)));
    this.draw(); App.changed();
  },
  insertLoop() {
    const t = this.track();
    if (!t) return toast('Select an instrument track first');
    const pat = App.pattern();
    App.pushUndo();
    const gen = LOOP_GENERATORS[$('#loopGen').value];
    pat.notes[t.id] = gen({ root: App.song.key, scale: App.song.scale, bars: pat.bars, prog: $('#loopProg').value });
    delete pat.origins[t.id]; // generated notes are no longer the theme
    this.sel.clear(); this.draw(); App.changed();
    toast(`Inserted “${$('#loopGen').value}” in ${NOTE_NAMES[App.song.key]} ${SCALES[App.song.scale].name}`);
  },

  /* Centre the view vertically on the current track's notes (or middle C). */
  scrollToNotes() {
    if (UI.view !== 'roll') return;
    this.draw();
    const ns = this.notes() || [];
    const mid = ns.length ? ns.reduce((a, n) => a + n.p, 0) / ns.length : 60;
    this.wrap.scrollTop = (this.hi - mid) * this.rowH - this.wrap.clientHeight / 2;
  },

  draw(pos) {
    if (!this.grid || UI.view !== 'roll') return;
    if (!pos) this.renderThemeBar(); // skip during playback frames; nothing there changes
    const t = this.track();
    const pat = App.pattern();
    const steps = pat.bars * 16;
    const rows = this.hi - this.lo + 1;
    this.cellW = Math.max(this.zoom, Math.floor((this.wrap.clientWidth - this.keyW - 16) / steps));
    const W = steps * this.cellW, H = rows * this.rowH;
    const dpr = window.devicePixelRatio || 1;
    const size = (cv, w, h) => {
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        cv.style.width = w + 'px'; cv.style.height = h + 'px';
      }
      const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); return x;
    };
    const scale = SCALES[App.song.scale].steps.map((s) => (s + App.song.key) % 12);

    // keys
    const k = size(this.keys, this.keyW, H);
    for (let i = 0; i < rows; i++) {
      const p = this.hi - i, pc = p % 12, black = [1, 3, 6, 8, 10].includes(pc);
      k.fillStyle = black ? '#22252c' : '#d8dbe2';
      k.fillRect(0, i * this.rowH, this.keyW, this.rowH);
      k.fillStyle = '#00000055'; k.fillRect(0, (i + 1) * this.rowH - 1, this.keyW, 1);
      if (pc === 0 || (this.rowH >= 12 && !black)) {
        k.fillStyle = black ? '#aaa' : pc === 0 ? '#111' : '#777';
        k.font = (pc === 0 ? 'bold ' : '') + '9px system-ui';
        k.fillText(noteName(p), 4, i * this.rowH + this.rowH - 3);
      }
      if (scale.includes(pc)) { k.fillStyle = '#4dabf7'; k.fillRect(this.keyW - 4, i * this.rowH + 2, 3, this.rowH - 4); }
    }

    // grid background
    const g = size(this.grid, W, H);
    for (let i = 0; i < rows; i++) {
      const p = this.hi - i, pc = p % 12;
      g.fillStyle = [1, 3, 6, 8, 10].includes(pc) ? '#16181d' : '#1c1f26';
      if (scale.includes(pc) && t) g.fillStyle = [1, 3, 6, 8, 10].includes(pc) ? '#1b2129' : '#212833';
      g.fillRect(0, i * this.rowH, W, this.rowH);
      g.fillStyle = pc === 0 ? '#3a4050' : '#ffffff08';
      g.fillRect(0, (i + 1) * this.rowH - 1, W, 1);
    }
    for (let s = 0; s <= steps; s++) {
      g.fillStyle = s % 16 === 0 ? '#5b6378' : s % 4 === 0 ? '#353b4a' : '#ffffff0c';
      g.fillRect(s * this.cellW, 0, s % 16 === 0 ? 2 : 1, H);
    }

    if (!t) {
      g.fillStyle = '#8a91a3'; g.font = '14px system-ui';
      g.fillText('Select an instrument track (sidebar or the Track menu above) to write notes.', 20 + this.wrap.scrollLeft, this.wrap.scrollTop + 40);
      return;
    }

    // ghost notes from other synth tracks
    if ($('#rollGhost').checked) {
      App.song.tracks.forEach((o) => {
        if (o.type !== 'synth' || o.id === t.id) return;
        g.fillStyle = o.color + '30';
        (pat.notes[o.id] || []).forEach((n) => { if (n.s < steps) g.fillRect(n.s * this.cellW + 1, (this.hi - n.p) * this.rowH + 2, n.l * this.cellW - 2, this.rowH - 4); });
      });
    }

    // notes
    (pat.notes[t.id] || []).forEach((n) => {
      if (n.s >= steps) return;
      const x = n.s * this.cellW, y = (this.hi - n.p) * this.rowH, w = Math.max(3, Math.min(n.l, steps - n.s) * this.cellW);
      g.globalAlpha = 0.45 + 0.55 * n.v;
      g.fillStyle = t.color;
      g.fillRect(x + 1, y + 1, w - 2, this.rowH - 2);
      g.globalAlpha = 1;
      g.fillStyle = '#0006'; g.fillRect(x + w - 4, y + 2, 2, this.rowH - 4);
      if (this.sel.has(n)) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, this.rowH - 2); }
      if (w > 30) { g.fillStyle = '#111'; g.font = '9px system-ui'; g.fillText(noteName(n.p), x + 4, y + this.rowH - 4); }
    });

    if (this.drag && this.drag.mode === 'box') {
      const d = this.drag;
      g.strokeStyle = '#4dabf7'; g.lineWidth = 1; g.setLineDash([4, 3]);
      g.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.setLineDash([]);
    }

    // playhead
    if (pos && pos.pat === App.sel.pattern) {
      g.fillStyle = '#69db7c';
      g.fillRect(pos.local * this.cellW, 0, 2, H);
    }
  },
};
