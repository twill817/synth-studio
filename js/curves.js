/* Curves (step 6c): shapes drawn over time. Data: see CURVE_PARAMS in app.js.
   - In a track: each instrument's curves over the track's length (a sting also has Speed). An
     instrument's own repeating curve plays wherever the track has none of its own for that setting.
   - On a library instrument: a curve that repeats every few bars in every track, and a shape over
     each note (synths).
   CurveCanvas is the editor; Curves is the panel under the Beat grid / Piano Roll; InstCurves is the
   section in the instrument panel. */

/* A curve editor on a canvas. src:
     steps()      length of the x axis (16ths; 100 for "% of a note")
     param()      the setting it shapes
     pts(make)    the points edited (make: create them) or null
     ghost()      { pts, len } drawn dimmed when there are no own points (a curve it inherits), or null
     axis         'bars' (default) or 'note'
     color()      line colour
     empty()      text when there's nothing to show
     editable()   false: clicks do nothing
     tidy()       drop empty curves after a delete
     done()       after an edit (the undo step is already made) */
class CurveCanvas {
  constructor(src) {
    this.src = src;
    this.H = 72; this.padL = 52; this.padR = 12; this.padT = 8; this.padB = 14;
    this.drag = null; this.hover = -1;
    const cv = document.createElement('canvas');
    cv.className = 'cv-canvas';
    cv.setAttribute('aria-label', 'Curve editor');
    this.cv = cv;
    cv.addEventListener('pointerdown', (e) => this.onDown(e));
    cv.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', () => this.onUp());
    cv.addEventListener('dblclick', (e) => this.onDbl(e));
    cv.addEventListener('contextmenu', (e) => this.onContext(e));
  }
  get param() { return this.src.param(); }
  steps() { return this.src.steps() || 16; }
  points() { return this.src.pts(false) || []; }
  W() { return this.cv.clientWidth || 600; }
  xOf(s) { return this.padL + (s / this.steps()) * (this.W() - this.padL - this.padR); }
  sOf(x) { return clamp(((x - this.padL) / (this.W() - this.padL - this.padR)) * this.steps(), 0, this.steps()); }
  yOf(v) {
    const P = CURVE_PARAMS[this.param], h = this.H - this.padT - this.padB;
    const u = P.log ? Math.log(v / P.min) / Math.log(P.max / P.min) : (v - P.min) / (P.max - P.min);
    return this.padT + (1 - clamp(u, 0, 1)) * h;
  }
  vOf(y) {
    const P = CURVE_PARAMS[this.param], h = this.H - this.padT - this.padB;
    const u = clamp(1 - (y - this.padT) / h, 0, 1);
    let v = P.log ? P.min * Math.pow(P.max / P.min, u) : P.min + u * (P.max - P.min);
    if (P.unit === 'st') v = Math.round(v * 2) / 2;            // half-semitone steps
    else v = Math.round(v);
    if (P.unit === 'pan' && Math.abs(v) < 4) v = 0;             // snap to centre
    if (P.unit === '%' && Math.abs(v - P.def) < 3) v = P.def;   // snap to "as mixed"
    return v;
  }
  snapS(x) { const q = this.src.axis === 'note' ? 5 : App.snap || 1; return clamp(Math.round(this.sOf(x) / q) * q, 0, this.steps()); }
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  hitPoint(c) {
    const pts = this.points();
    for (let i = pts.length - 1; i >= 0; i--) if (Math.hypot(this.xOf(pts[i].s) - c.x, this.yOf(pts[i].v) - c.y) < 8) return i;
    return -1;
  }
  edited() { this.src.done(); }

  onDown(e) {
    if (e.button !== 0 || (this.src.editable && !this.src.editable())) return;
    const c = this.local(e);
    App.pushUndo();
    this.snapshot = App.undoStack[App.undoStack.length - 1];
    let i = this.hitPoint(c);
    if (i < 0) {
      const pts = this.src.pts(true);
      if (!pts) { App.undoStack.pop(); return; }
      const s = this.snapS(c.x);
      const at = pts.findIndex((p) => p.s === s);
      if (at >= 0) pts.splice(at, 1);
      pts.push({ s, v: this.vOf(c.y) });
      pts.sort((a, b) => a.s - b.s);
      i = pts.findIndex((p) => p.s === s);
    }
    this.drag = { pt: this.points()[i] };
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    this.draw();
  }
  onMove(e) {
    const c = this.local(e);
    if (!this.drag) {
      const h = this.hitPoint(c);
      this.cv.style.cursor = h >= 0 ? 'grab' : 'crosshair';
      if (h !== this.hover) { this.hover = h; this.draw(); }
      return;
    }
    const pt = this.drag.pt;
    if (!e.shiftKey) pt.s = this.snapS(c.x);   // Shift: up and down only
    pt.v = this.vOf(c.y);
    this.points().sort((a, b) => a.s - b.s);
    this.draw();
  }
  onUp() {
    if (!this.drag) return;
    this.drag = null;
    if (JSON.stringify(App.project) === this.snapshot) App.undoStack.pop();   // nothing changed
    else { App.redoStack = []; this.edited(); }
  }
  onDbl(e) {
    const i = this.hitPoint(this.local(e));
    if (i < 0) return;
    App.pushUndo();
    this.points().splice(i, 1); this.src.tidy(); this.edited();
  }
  onContext(e) {
    e.preventDefault();
    const i = this.hitPoint(this.local(e));
    if (i < 0) return;
    const pt = this.points()[i];
    App.pushUndo();
    if (pt.k === 'line') delete pt.k; else pt.k = 'line';
    this.edited();
    toast(pt.k === 'line' ? 'Straight to the next point' : 'Smooth to the next point', 1500);
  }

  draw(playS) {
    const cv = this.cv;
    if (!cv.isConnected || cv.hidden || !cv.offsetParent) return;
    const W = this.W(), H = this.H, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#121419'; g.fillRect(0, 0, W, H);
    const steps = this.steps(), P = CURVE_PARAMS[this.param], note = this.src.axis === 'note';
    // grid: bars and beats, or quarters of a note
    g.font = '9px system-ui';
    if (note) {
      for (let s = 0; s <= 100; s += 25) { g.fillStyle = '#2c313c'; g.fillRect(Math.round(this.xOf(s)), this.padT, 1, H - this.padT - this.padB); }
      g.fillStyle = '#8a91a3';
      [['start of the note', 0], ['middle', 50], ['end', 100]].forEach(([t, s]) => { const w = g.measureText(t).width; g.fillText(t, clamp(this.xOf(s) - w / 2, this.padL + 2, W - this.padR - w), H - 3); });
    } else {
      for (let s = 0; s <= steps; s += 4) { g.fillStyle = s % 16 === 0 ? '#3a4050' : '#22262f'; g.fillRect(Math.round(this.xOf(s)), this.padT, 1, H - this.padT - this.padB); }
      g.fillStyle = '#8a91a3';
      for (let b = 0; b < steps / 16; b++) g.fillText(String(b + 1), this.xOf(b * 16) + 3, H - 3);
    }
    // the "as mixed" line, and the scale on the left
    const yd = this.yOf(P.def);
    g.strokeStyle = '#4a5160'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(this.padL, yd); g.lineTo(W - this.padR, yd); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#1a1d23'; g.fillRect(0, 0, this.padL - 4, H);
    g.fillStyle = '#8a91a3';
    g.fillText(curveText(this.param, P.max), 4, this.padT + 8);
    g.fillText(curveText(this.param, P.def), 4, Math.min(H - this.padB, Math.max(this.padT + 18, yd + 3)));
    g.fillText(curveText(this.param, P.min), 4, H - this.padB);
    const own = this.src.pts(false), pts = own || [], color = this.src.color();
    const line = (f) => { g.beginPath(); for (let x = this.padL; x <= W - this.padR; x += 2) { const y = this.yOf(f(this.sOf(x))); x === this.padL ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); };
    const ghost = !own && this.src.ghost ? this.src.ghost() : null;
    if (pts.length) {
      g.strokeStyle = color; g.lineWidth = 2;
      line((s) => evalCurve(pts, s, this.param));
      pts.forEach((pt, i) => {
        const x = this.xOf(pt.s), y = this.yOf(pt.v);
        g.fillStyle = (this.drag && this.drag.pt === pt) || i === this.hover ? '#fff' : color;
        if (pt.k === 'line') g.fillRect(x - 4, y - 4, 8, 8); else { g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); }
      });
      const show = this.drag ? this.drag.pt : this.hover >= 0 ? pts[this.hover] : null;
      if (show) {
        const t = curveText(this.param, show.v), x = this.xOf(show.s), y = this.yOf(show.v);
        g.font = '11px system-ui'; const w = g.measureText(t).width + 8;
        const bx = clamp(x - w / 2, this.padL, W - this.padR - w), by = y > 26 ? y - 22 : y + 8;
        g.fillStyle = '#000c'; g.fillRect(bx, by, w, 16); g.fillStyle = '#fff'; g.fillText(t, bx + 4, by + 12);
      }
    } else if (ghost && ghost.pts.length) {
      g.strokeStyle = color; g.globalAlpha = 0.45; g.lineWidth = 2; g.setLineDash([5, 4]);
      line((s) => evalCurve(ghost.pts, ghost.len ? s % ghost.len : s, this.param));
      g.setLineDash([]); g.globalAlpha = 1;
    }
    const msg = this.src.empty && this.src.empty();
    if (msg) {
      g.font = '12px system-ui';
      if (pts.length || (ghost && ghost.pts.length)) { const w = g.measureText(msg).width + 12; g.fillStyle = '#121419cc'; g.fillRect(this.padL + 6, 2, w, 17); g.fillStyle = '#c3c8d4'; g.fillText(msg, this.padL + 12, 14); }
      else { g.fillStyle = '#8a91a3'; g.fillText(msg, this.padL + 10, H / 2 + 4); }
    }
    if (playS !== undefined && playS !== null) { g.fillStyle = '#69db7c'; g.fillRect(this.xOf(playS), 0, 2, H); }
  }
}

/* Spread an instrument's repeating curve (len 16ths) over a track's length (to change it for that track). */
function unrollCurve(pts, len, steps, k) {
  const out = [];
  for (let r = 0; r * len < steps; r++) pts.forEach((p) => { const s = p.s + r * len; if (s <= steps) out.push({ ...p, s }); });
  const last = out[out.length - 1];
  if (!last || last.s < steps) out.push({ s: steps, v: evalCurve(pts, steps % len || len, k) });
  return out.filter((p, i) => i === out.length - 1 || out[i + 1].s !== p.s);   // where two meet, the later one starts the next round
}

/* ---------- the panel under the Beat grid / Piano Roll ---------- */
const Curves = {
  target: null,         // a lane id (an instrument in the open track), or 'track' (a sting's Speed)
  param: 'vol',

  init() {
    const el = document.createElement('div');
    el.id = 'curvesPanel';
    el.className = 'curves';
    el.innerHTML = `<div class="curves-head">
        <button class="cv-fold" data-cv="fold" title="Show or hide the curves"></button>
        <span class="cv-body"><select id="cvTarget" aria-label="What the curve shapes"></select>
        <span class="cv-params" role="group" aria-label="Curve"></span>
        <span class="cv-scope"></span>
        <span class="hint cv-help" title="Click to add a point · drag to move (hold Shift: up and down only) · double-click to delete · right-click: smooth / straight to the next point. A loop repeats its curves each time round. A dashed line is the instrument's own repeating curve: draw on it to change it for this track only.">ⓘ how</span></span>
      </div>`;
    this.el = el;
    this.ed = new CurveCanvas({
      steps: () => { const p = App.pattern(); return p ? p.bars * 16 : 32; },
      param: () => this.param,
      pts: (make) => this.pts(make),
      ghost: () => this.instCurve(),
      color: () => (this.target === 'track' ? '#ffd43b' : ((App.track(this.target) || {}).color || '#4dabf7')),
      empty: () => this.emptyText(),
      editable: () => !!this.owner(),
      tidy: () => this.tidy(),
      done: () => { App.changed(); UI.renderTracks(); this.render(); },
    });
    this.cv = this.ed.cv; this.cv.id = 'cvCanvas';
    el.appendChild(this.cv);
    try { this.folded = localStorage.getItem('synthstudio.curvesFolded') !== '0'; } catch (e) { this.folded = true; }
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const act = b.dataset.cv;
      if (act === 'fold') {
        this.folded = !this.folded;
        try { localStorage.setItem('synthstudio.curvesFolded', this.folded ? '1' : '0'); } catch (err) { /* storage blocked */ }
        this.render(); if (UI.view === 'roll') Roll.draw();
        return;
      }
      if (act === 'clear' || act === 'revert' || act === 'off') {
        const o = this.owner();
        if (!o) return;
        App.pushUndo();
        if (act === 'off') { o.curves = o.curves || {}; o.curves[this.param] = []; toast(`No ${CURVE_PARAMS[this.param].name.toLowerCase()} curve on this instrument in this track`, 2500); }
        else { if (o.curves) delete o.curves[this.param]; this.tidy(); if (act === 'revert') toast('Back to the instrument’s curve', 2000); }
        App.changed(); UI.renderTracks(); this.render();
        return;
      }
      if (b.dataset.param) { this.param = b.dataset.param; this.render(); }
    });
    $('#cvTarget', el).onchange = (e) => { this.target = e.target.value; this.fixParam(); this.render(); };   // (the sidebar selection stays)
    window.addEventListener('resize', () => this.render());
  },

  /* ---------- data ---------- */
  owner() {
    const p = App.pattern();
    if (!p) return null;
    if (this.target === 'track') return p.kind === 'sting' ? p : null;
    return this.target ? partOf(p, this.target) : null;
  },
  /* The instrument's repeating curve for the target's lane ({ pts, len }), or null. */
  instCurve(k = this.param) {
    if (this.target === 'track' || !this.target) return null;
    const t = App.track(this.target);
    return t ? roleCurve(roleOf(t), k) : null;
  },
  /* This track's own points (an empty list = "off here"); make: start them, from the instrument's curve if it has one. */
  pts(make) {
    const o = this.owner();
    if (!o) return null;
    const own = o.curves && o.curves[this.param];
    if (own || !make) return own || null;
    const ic = this.instCurve(), p = App.pattern();
    o.curves = o.curves || {};
    o.curves[this.param] = ic ? unrollCurve(ic.pts, ic.len, p.bars * 16, this.param) : [];
    if (ic) toast('This instrument now has its own curve in this track (Back to the instrument’s curve undoes it)', 3500);
    return o.curves[this.param];
  },
  tidy() {
    const o = this.owner();
    if (!o || !o.curves) return;
    Object.keys(o.curves).forEach((k) => { if (o.curves[k] && !o.curves[k].length && !this.instCurve(k)) delete o.curves[k]; });
    if (!Object.keys(o.curves).length) delete o.curves;
  },
  params() { return this.target === 'track' ? TRACK_CURVES : PART_CURVES; },
  fixParam() { if (!this.params().includes(this.param)) this.param = this.params()[0]; },
  /* Keep the target valid: an instrument in the open track (the selected one first), or a sting's Speed. */
  fixTarget(p) {
    if (App.sel.track !== this.lastSel) { this.lastSel = App.sel.track; if (partOf(p, App.sel.track)) this.target = App.sel.track; }   // follow the sidebar
    if (this.target === 'track' ? p.kind === 'sting' : this.target && partOf(p, this.target)) return;
    const lanes = partLanes(App.song, p);
    this.target = partOf(p, App.sel.track) ? App.sel.track : lanes.length ? lanes[0].id : p.kind === 'sting' ? 'track' : null;
  },
  emptyText() {
    if (!this.target) return 'Add an instrument to this track to give it curves';
    const P = CURVE_PARAMS[this.param], own = this.pts(false), ic = this.instCurve();
    const what = this.target === 'track' ? 'the whole sting' : (App.track(this.target) || {}).name || 'this instrument';
    if (own && !own.length && ic) return `${P.name}: off in this track (the instrument has a repeating curve)`;
    if (!own && ic) return `The instrument’s ${P.name.toLowerCase()} curve, every ${ic.len / 16} bar${ic.len > 16 ? 's' : ''} — click to change it for this track`;
    if (!own || !own.length) return `No ${P.name.toLowerCase()} curve on ${what} — click to add a point`;
    return '';
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
    this.fixTarget(p);
    this.fixParam();
    const lanes = partLanes(App.song, p);
    const count = (o) => (o && o.curves ? Object.values(o.curves).filter((x) => x && x.length).length : 0);
    const total = count(p) + lanes.reduce((a, t) => a + count(partOf(p, t)), 0);
    $('.cv-fold', this.el).textContent = `${this.folded ? '▸' : '▾'} Curves${total ? ` (${total})` : ''}`;
    $('.cv-body', this.el).hidden = this.folded;
    this.cv.hidden = this.folded;
    if (this.folded) return;
    const inherits = (t) => PART_CURVES.some((k) => roleCurve(roleOf(t), k));
    $('#cvTarget', this.el).innerHTML = lanes.map((t) => `<option value="${t.id}">${esc(t.name)}${count(partOf(p, t)) ? ' ●' : inherits(t) ? ' ○' : ''}</option>`).join('') +
      (p.kind === 'sting' ? `<option value="track">Whole sting (Speed)${count(p) ? ' ●' : ''}</option>` : '');
    $('#cvTarget', this.el).hidden = !this.target;
    if (this.target) $('#cvTarget', this.el).value = this.target;
    const o = this.owner(), cs = (o && o.curves) || {};
    const mark = (k) => (cs[k] ? (cs[k].length ? ' ●' : ' ⦸') : this.instCurve(k) ? ' ○' : '');
    $('.cv-params', this.el).innerHTML = this.params().map((k) => `<button class="chip-btn ${k === this.param ? 'on' : ''}" data-param="${k}" title="${k === 'speed' ? 'Tempo of this sting (the game plays it exactly so)' : k === 'pitch' ? 'Bend the pitch, in semitones' : k === 'cut' ? 'Low-pass filter cutoff' : k === 'pan' ? 'Move the sound left or right' : '% of the mix setting'}${this.instCurve(k) ? ' · ○ the instrument has a repeating curve' : ''}">${CURVE_PARAMS[k].name}${mark(k)}</button>`).join('');
    // what the buttons can do depends on whether the instrument has a repeating curve for this setting
    const own = cs[this.param], ic = this.instCurve();
    let sc = '';
    if (ic) {
      if (own) sc = `<span class="scope level">This track’s own</span><button data-cv="revert" title="Use the instrument's repeating curve again">Back to the instrument’s curve</button>${own.length ? '<button data-cv="off" title="No curve for this setting in this track">Off in this track</button>' : ''}`;
      else sc = `<span class="scope style">From the instrument</span><button data-cv="off" title="No curve for this setting in this track">Off in this track</button>`;
    } else if (own && own.length) sc = '<button data-cv="clear" class="danger" title="Remove every point of this curve">Clear curve</button>';
    $('.cv-scope', this.el).innerHTML = sc;
    this.draw();
  },
  draw(pos) {
    if (!this.el || this.folded || this.el.hidden || !this.el.isConnected || !App.pattern()) return;
    this.ed.draw(pos && pos.pat === App.sel.pattern ? pos.local : null);
  },
};

/* ---------- on an instrument: a repeating curve, and a shape over each note ---------- */
const InstCurves = {
  mode: 'repeat',       // 'repeat' or 'note'
  param: 'vol',
  role: null, sound: null, track: null,

  init() {
    this.ed = new CurveCanvas({
      steps: () => (this.mode === 'note' ? 100 : ((this.role && this.role.curveBars) || 1) * 16),
      param: () => this.param,
      pts: (make) => this.pts(make),
      color: () => (this.track ? this.track.color : this.role && this.role.color) || '#4dabf7',
      get axis() { return InstCurves.mode === 'note' ? 'note' : 'bars'; },
      empty: () => {
        const pts = this.pts(false), name = CURVE_PARAMS[this.param].name.toLowerCase();
        if (pts && pts.length) return '';
        return this.mode === 'note' ? `No ${name} shape — click to add a point; it stretches over every note` : `No repeating ${name} curve — click to add a point`;
      },
      editable: () => !!this.role,
      tidy: () => this.tidy(),
      done: () => { App.changed(); this.render(); UI.renderTracks(); if (UI.view === 'roll' || UI.view === 'beat') Curves.render(); },
    });
  },
  store(make) {
    if (!this.role) return null;
    if (this.mode === 'note') {
      const syn = this.sound && this.sound.synth;
      if (!syn) return null;
      if (!syn.shape && make) syn.shape = {};
      return syn.shape || null;
    }
    if (!this.role.curves && make) this.role.curves = {};
    return this.role.curves || null;
  },
  pts(make) {
    const c = this.store(make);
    if (!c) return null;
    if (!c[this.param] && make) c[this.param] = [];
    return c[this.param] || null;
  },
  tidy() {
    const c = this.store(false);
    if (!c) return;
    Object.keys(c).forEach((k) => { if (!c[k] || !c[k].length) delete c[k]; });
    if (!Object.keys(c).length) { if (this.mode === 'note') delete this.sound.synth.shape; else delete this.role.curves; }
  },
  params() { return this.mode === 'note' ? NOTE_CURVES : PART_CURVES; },

  /* The section's HTML for the instrument panel (tg: UI.instTarget()). Repeating curves belong to the
     library instrument; the note shape is part of the sound (so a level's customized sound has its own). */
  html(tg) {
    this.role = tg.role; this.sound = tg.sound; this.track = tg.track;
    const synth = tg.role.type !== 'drum';
    const modes = [...(tg.track ? [] : ['repeat']), ...(synth ? ['note'] : [])];
    if (!modes.length) return '';
    if (!modes.includes(this.mode)) this.mode = modes[0];
    if (!this.params().includes(this.param)) this.param = this.params()[0];
    const c = this.store(false) || {}, rc = tg.role.curves || {}, sc = (tg.sound.synth && tg.sound.synth.shape) || {};
    const n = (o) => Object.values(o).filter((x) => x && x.length).length;
    const label = { repeat: `Repeating${n(rc) ? ' ●' : ''}`, note: `Each note${n(sc) ? ' ●' : ''}` };
    const tip = { repeat: 'A curve that repeats every few bars in every track that plays this instrument (a track can change it or turn it off)', note: 'A shape over each note, stretched to the note’s length' };
    const say = this.mode === 'note' ? 'a shape over every note it plays, stretched to the note’s length' : 'repeats in every track that plays it, unless a track has its own';
    return `<div class="section inst-curves-head">Curves <span class="muted">— ${say}</span></div>
      <div class="inst-curves curves-head">
        ${modes.length > 1 ? `<span class="cv-params">${modes.map((m) => `<button class="chip-btn ${m === this.mode ? 'on' : ''}" data-ic="mode" data-v="${m}" title="${tip[m]}">${label[m]}</button>`).join('')}</span><span class="cv-sep"></span>` : `<b title="${tip[modes[0]]}">${label[modes[0]]}</b>`}
        ${this.mode === 'repeat' ? `<label title="How long the curve is before it repeats">every <select data-ic="bars">${[1, 2, 4, 8].map((b) => `<option value="${b}" ${b === (tg.role.curveBars || 1) ? 'selected' : ''}>${b} bar${b > 1 ? 's' : ''}</option>`).join('')}</select></label>` : ''}
        <span class="cv-params">${this.params().map((k) => `<button class="chip-btn ${k === this.param ? 'on' : ''}" data-ic="param" data-v="${k}">${CURVE_PARAMS[k].name}${c[k] && c[k].length ? ' ●' : ''}</button>`).join('')}</span>
        ${c[this.param] && c[this.param].length ? '<button data-ic="clear" class="danger">Clear curve</button>' : ''}
        <span class="hint cv-help" title="Click to add a point · drag to move (hold Shift: up and down only) · double-click to delete · right-click: smooth / straight to the next point.">ⓘ how</span>
      </div><div class="inst-curves-canvas"></div>`;
  },
  /* After the panel's HTML is in place: put the canvas in and wire the controls. */
  mount(ip) {
    const host = $('.inst-curves-canvas', ip);
    if (!host) return;
    host.appendChild(this.ed.cv);
    $('.inst-curves', ip).onclick = (e) => {
      const b = e.target.closest('button[data-ic]');
      if (!b) return;
      if (b.dataset.ic === 'mode') { this.mode = b.dataset.v; return this.render(); }
      if (b.dataset.ic === 'param') { this.param = b.dataset.v; return this.render(); }
      if (b.dataset.ic === 'clear') { App.pushUndo(); const c = this.store(false); if (c) delete c[this.param]; this.tidy(); this.ed.edited(); }
    };
    const bars = $('[data-ic="bars"]', ip);
    if (bars) bars.onchange = () => {
      App.pushUndo();
      const nb = +bars.value;
      // the shape stays where it was; points past the new end go
      if (this.role.curves) Object.values(this.role.curves).forEach((pts) => { for (let i = pts.length - 1; i >= 0; i--) if (pts[i].s > nb * 16) pts.splice(i, 1); });
      this.role.curveBars = nb; this.tidy();
      this.ed.edited();
    };
    requestAnimationFrame(() => this.ed.draw());
  },
  render() { UI.renderInst(); },
};
