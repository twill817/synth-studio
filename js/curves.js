/* Curves panel (step 6c): shape the open track — or one instrument in it — over its length.
   Lives under the Beat grid or the Piano Roll (whichever is open). Data: see CURVE_PARAMS in app.js. */

const Curves = {
  target: 'track',      // 'track' or a lane id (an instrument in the open track)
  param: 'vol',
  drag: null,
  hover: null,
  H: 72, padL: 52, padR: 12, padT: 8, padB: 14,

  init() {
    const el = document.createElement('div');
    el.id = 'curvesPanel';
    el.className = 'curves';
    el.innerHTML = `<div class="curves-head">
        <button class="cv-fold" data-cv="fold" title="Show or hide the curves"></button>
        <span class="cv-body"><select id="cvTarget" aria-label="What the curve shapes"></select>
        <span class="cv-params" role="group" aria-label="Curve"></span>
        <button data-cv="clear" class="danger" title="Remove every point of this curve">Clear curve</button>
        <span class="hint cv-help" title="Click to add a point · drag to move · double-click to delete · right-click: smooth / straight to the next point. A loop repeats its curves each time round.">ⓘ how</span></span>
      </div>
      <canvas id="cvCanvas" aria-label="Curve editor"></canvas>`;
    this.el = el;
    this.cv = $('#cvCanvas', el);
    try { this.folded = localStorage.getItem('synthstudio.curvesFolded') !== '0'; } catch (e) { this.folded = true; }
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.cv === 'fold') {
        this.folded = !this.folded;
        try { localStorage.setItem('synthstudio.curvesFolded', this.folded ? '1' : '0'); } catch (err) { /* storage blocked */ }
        this.render(); if (UI.view === 'roll') Roll.draw();
        return;
      }
      if (b.dataset.cv === 'clear') {
        const c = this.curves(false);
        if (!c || !c[this.param]) return;
        App.pushUndo(); delete c[this.param]; this.tidy(); App.changed(); UI.renderTracks(); this.render();
        return;
      }
      if (b.dataset.param) { this.param = b.dataset.param; this.render(); }
    });
    $('#cvTarget', el).onchange = (e) => { this.target = e.target.value; this.fixParam(); this.render(); };
    this.cv.addEventListener('pointerdown', (e) => this.onDown(e));
    this.cv.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', () => this.onUp());
    this.cv.addEventListener('dblclick', (e) => this.onDbl(e));
    this.cv.addEventListener('contextmenu', (e) => this.onContext(e));
    window.addEventListener('resize', () => this.render());
  },

  /* ---------- data ---------- */
  owner(make) {
    const p = App.pattern();
    if (!p) return null;
    if (this.target === 'track') return p;
    return partOf(p, this.target);
  },
  curves(make) {
    const o = this.owner();
    if (!o) return null;
    if (!o.curves && make) o.curves = {};
    return o.curves || null;
  },
  points() { const c = this.curves(false); return (c && c[this.param]) || []; },
  tidy() {
    const o = this.owner();
    if (!o || !o.curves) return;
    Object.keys(o.curves).forEach((k) => { if (!o.curves[k] || !o.curves[k].length) delete o.curves[k]; });
    if (!Object.keys(o.curves).length) delete o.curves;
  },
  params() {
    const p = App.pattern();
    if (this.target === 'track') return TRACK_CURVES.filter((k) => k !== 'speed' || (p && p.kind === 'sting'));
    return PART_CURVES;
  },
  fixParam() { if (!this.params().includes(this.param)) this.param = 'vol'; },

  /* ---------- geometry ---------- */
  steps() { const p = App.pattern(); return p ? p.bars * 16 : 32; },
  W() { return this.cv.clientWidth || 600; },
  xOf(s) { return this.padL + (s / this.steps()) * (this.W() - this.padL - this.padR); },
  sOf(x) { return clamp(((x - this.padL) / (this.W() - this.padL - this.padR)) * this.steps(), 0, this.steps()); },
  yOf(v) {
    const P = CURVE_PARAMS[this.param], h = this.H - this.padT - this.padB;
    const u = P.log ? Math.log(v / P.min) / Math.log(P.max / P.min) : (v - P.min) / (P.max - P.min);
    return this.padT + (1 - clamp(u, 0, 1)) * h;
  },
  vOf(y) {
    const P = CURVE_PARAMS[this.param], h = this.H - this.padT - this.padB;
    const u = clamp(1 - (y - this.padT) / h, 0, 1);
    let v = P.log ? P.min * Math.pow(P.max / P.min, u) : P.min + u * (P.max - P.min);
    if (P.unit === 'st') v = Math.round(v * 2) / 2;            // half-semitone steps
    else if (P.unit === 'Hz') v = Math.round(v);
    else v = Math.round(v);
    if (P.unit === 'pan' && Math.abs(v) < 4) v = 0;             // snap to centre
    if (P.unit === '%' && Math.abs(v - P.def) < 3) v = P.def;   // snap to "as mixed"
    return v;
  },
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
  hitPoint(c) {
    const pts = this.points();
    for (let i = pts.length - 1; i >= 0; i--) if (Math.hypot(this.xOf(pts[i].s) - c.x, this.yOf(pts[i].v) - c.y) < 8) return i;
    return -1;
  },

  /* ---------- editing ---------- */
  onDown(e) {
    if (e.button !== 0 || !App.pattern()) return;
    if (this.target !== 'track' && !this.owner()) return;
    const c = this.local(e);
    App.pushUndo();
    this.snapshot = App.undoStack[App.undoStack.length - 1];
    let i = this.hitPoint(c);
    if (i < 0) {
      const cs = this.curves(true);
      const pts = cs[this.param] || (cs[this.param] = []);
      const q = App.snap || 1, s = clamp(Math.round(this.sOf(c.x) / q) * q, 0, this.steps());
      pts.push({ s, v: this.vOf(c.y) });
      pts.sort((a, b) => a.s - b.s);
      i = pts.findIndex((p) => p.s === s);
    }
    this.drag = { i, pt: this.points()[i] };
    this.cv.setPointerCapture(e.pointerId);
    this.draw();
  },
  onMove(e) {
    const c = this.local(e);
    if (!this.drag) {
      const h = this.hitPoint(c);
      this.cv.style.cursor = h >= 0 ? 'grab' : 'crosshair';
      if (h !== this.hover) { this.hover = h; this.draw(); }
      return;
    }
    const q = App.snap || 1, pt = this.drag.pt;
    pt.s = clamp(Math.round(this.sOf(c.x) / q) * q, 0, this.steps());
    pt.v = this.vOf(c.y);
    this.points().sort((a, b) => a.s - b.s);
    this.draw();
  },
  onUp() {
    if (!this.drag) return;
    this.drag = null;
    if (JSON.stringify(App.project) === this.snapshot) App.undoStack.pop();   // nothing changed
    else { App.redoStack = []; App.changed(); UI.renderTracks(); }
    this.render();
  },
  onDbl(e) {
    const i = this.hitPoint(this.local(e));
    if (i < 0) return;
    App.pushUndo();
    this.points().splice(i, 1); this.tidy(); App.changed(); UI.renderTracks(); this.render();
  },
  onContext(e) {
    e.preventDefault();
    const i = this.hitPoint(this.local(e));
    if (i < 0) return;
    const pt = this.points()[i];
    App.pushUndo();
    if (pt.k === 'line') delete pt.k; else pt.k = 'line';
    App.changed(); UI.renderTracks(); this.render();
    toast(pt.k === 'line' ? 'Straight to the next point' : 'Smooth to the next point', 1500);
  },

  /* ---------- drawing ---------- */
  /* Move the panel under the open editor and refresh its controls. */
  render() {
    if (!this.el) return;
    const host = UI.view === 'roll' ? $('#view-roll') : UI.view === 'beat' ? $('#view-beat') : null;
    if (!host) return;
    if (this.el.parentNode !== host) host.appendChild(this.el);
    const p = App.pattern();
    this.el.hidden = !p;
    if (!p) return;
    if (this.target !== 'track' && !partOf(p, this.target)) this.target = 'track';
    this.fixParam();
    const lanes = partLanes(App.song, p);
    const count = (o) => (o && o.curves ? Object.values(o.curves).filter((x) => x && x.length).length : 0);
    const total = count(p) + lanes.reduce((a, t) => a + count(partOf(p, t)), 0);
    $('.cv-fold', this.el).textContent = `${this.folded ? '▸' : '▾'} Curves${total ? ` (${total})` : ''}`;
    $('.cv-body', this.el).hidden = this.folded;
    this.cv.hidden = this.folded;
    if (this.folded) return;
    $('#cvTarget', this.el).innerHTML = `<option value="track">Whole track${count(p) ? ' ●' : ''}</option>` +
      lanes.map((t) => `<option value="${t.id}" ${t.id === this.target ? 'selected' : ''}>${esc(t.name)}${count(partOf(p, t)) ? ' ●' : ''}</option>`).join('');
    $('#cvTarget', this.el).value = this.target;
    const cs = this.curves(false) || {};
    $('.cv-params', this.el).innerHTML = this.params().map((k) => `<button class="chip-btn ${k === this.param ? 'on' : ''}" data-param="${k}" title="${k === 'speed' ? 'Tempo of this sting (the game plays it exactly so)' : k === 'pitch' ? 'Bend the pitch, in semitones' : k === 'cut' ? 'Low-pass filter cutoff' : k === 'pan' ? 'Move the sound left or right' : '% of the mix setting'}">${CURVE_PARAMS[k].name}${cs[k] && cs[k].length ? ' ●' : ''}</button>`).join('') +
      (this.target === 'track' && p.kind !== 'sting' ? '<span class="muted cv-note" title="A loop keeps the level\'s tempo so the game can switch on the beat">Speed: stings only</span>' : '');
    $('[data-cv="clear"]', this.el).hidden = !(cs[this.param] && cs[this.param].length);
    this.draw();
  },
  draw(pos) {
    if (!this.el || this.folded || this.el.hidden || !this.el.isConnected) return;
    const p = App.pattern();
    if (!p) return;
    const W = this.W(), H = this.H, dpr = window.devicePixelRatio || 1, cv = this.cv;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#121419'; g.fillRect(0, 0, W, H);
    const steps = this.steps(), P = CURVE_PARAMS[this.param];
    // bars and beats
    for (let s = 0; s <= steps; s += 4) { g.fillStyle = s % 16 === 0 ? '#3a4050' : '#22262f'; g.fillRect(Math.round(this.xOf(s)), this.padT, 1, H - this.padT - this.padB); }
    g.fillStyle = '#8a91a3'; g.font = '9px system-ui';
    for (let b = 0; b < steps / 16; b++) g.fillText(String(b + 1), this.xOf(b * 16) + 3, H - 3);
    // the "as mixed" line, and the scale on the left
    const yd = this.yOf(P.def);
    g.strokeStyle = '#4a5160'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(this.padL, yd); g.lineTo(W - this.padR, yd); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#1a1d23'; g.fillRect(0, 0, this.padL - 4, H);
    g.fillStyle = '#8a91a3';
    g.fillText(curveText(this.param, P.max), 4, this.padT + 8);
    g.fillText(curveText(this.param, P.def), 4, Math.min(H - this.padB, Math.max(this.padT + 18, yd + 3)));
    g.fillText(curveText(this.param, P.min), 4, H - this.padB);
    // the curve
    const pts = this.points();
    const color = this.target === 'track' ? '#ffd43b' : ((App.track(this.target) || {}).color || '#4dabf7');
    if (pts.length) {
      g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
      for (let x = this.padL; x <= W - this.padR; x += 2) { const y = this.yOf(evalCurve(pts, this.sOf(x), this.param)); x === this.padL ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
      pts.forEach((pt, i) => {
        const x = this.xOf(pt.s), y = this.yOf(pt.v);
        g.fillStyle = i === this.hover || (this.drag && this.drag.pt === pt) ? '#fff' : color;
        if (pt.k === 'line') g.fillRect(x - 4, y - 4, 8, 8); else { g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); }
      });
      const show = this.drag ? this.drag.pt : this.hover >= 0 ? pts[this.hover] : null;
      if (show) {
        const t = curveText(this.param, show.v), x = this.xOf(show.s), y = this.yOf(show.v);
        g.font = '11px system-ui'; const w = g.measureText(t).width + 8;
        const bx = clamp(x - w / 2, this.padL, W - this.padR - w), by = y > 26 ? y - 22 : y + 8;
        g.fillStyle = '#000c'; g.fillRect(bx, by, w, 16); g.fillStyle = '#fff'; g.fillText(t, bx + 4, by + 12);
      }
    } else {
      g.fillStyle = '#8a91a3'; g.font = '12px system-ui';
      const what = this.target === 'track' ? 'the whole track' : (App.track(this.target) || {}).name || 'this instrument';
      g.fillText(`No ${P.name.toLowerCase()} curve on ${what} — click to add a point`, this.padL + 10, H / 2 + 4);
    }
    if (pos && pos.pat === App.sel.pattern) { g.fillStyle = '#69db7c'; g.fillRect(this.xOf(pos.local), 0, 2, H); }
  },
};
