/* The level map (layout B): the level's segments as nodes, its stings, the ending, and a
   Simulate panel that plays the level the way the Unity player does. Replaces the Adaptive tab
   and the sidebar's pattern list. Draws only what the game can do today:
     start on the first segment · GoToSegment (through the target's entry sting) ·
     PlaySting (the segment restarts after it) · EndWithSting / fade out · SetIntensity.
   Node order is the level's pattern order (the first segment is Unity's start segment). */

Object.assign(UI, {
  /* ---------- helpers ---------- */
  firstSegment() { const i = App.song.patterns.findIndex((p) => p.kind !== 'sting'); return i < 0 ? 0 : i; },
  simPlaying() { return Seq.playing && App.mode === 'adaptive' && !!Seq.adapt; },
  /* Open the selected pattern's editor (drums → Beat, instruments → Piano Roll). */
  openEditor() {
    if (this.view === 'beat' || this.view === 'roll') return;
    const t = App.track();
    this.showView(t && t.type === 'drum' ? 'beat' : 'roll');
  },
  /* Play the level from a segment, like the game: Unity's Play / GoToSegment. */
  simGo(i) {
    if (!this.simPlaying()) { this.setMode('adaptive', false); Seq.start(0, i); }
    else Seq.request(i);
  },
  /* Play a sting like PlaySting: at the next change point, then the segment restarts. */
  simSting(i) {
    if (!this.simPlaying()) { this.setMode('adaptive', false); Seq.start(0, this.firstSegment()); }
    Seq.request(i, true);
  },
  /* Move pattern `from` to sit before index `to` (to = patterns.length → last). Keeps the
     playthrough, the selection and a running simulation pointing at the same patterns. */
  movePattern(from, to) {
    const s = App.song, n = s.patterns.length;
    if (from === to || from + 1 === to) return;
    const order = [...Array(n).keys()];
    order.splice(from, 1);
    order.splice(to > from ? to - 1 : to, 0, from);
    const where = {}; order.forEach((old, k) => (where[old] = k));
    App.pushUndo();
    s.patterns = order.map((k) => s.patterns[k]);
    s.arrangement = s.arrangement.map((i) => where[i]);
    App.sel.pattern = where[App.sel.pattern];
    const A = Seq.adapt;
    if (A) {
      ['cur', 'after'].forEach((k) => { if (A[k] !== null && A[k] !== undefined) A[k] = where[A[k]]; });
      if (A.next) ['target', 'sting'].forEach((k) => { if (A.next[k] !== null && A.next[k] !== undefined) A.next[k] = where[A.next[k]]; });
    }
    App.changed();
    this.renderPatterns(); this.renderBeat(); this.renderRollBar(); Roll.draw();
  },
  newPattern(kind) {
    const s = App.song, isSting = kind === 'sting';
    const base = isSting ? 'Sting' : 'Segment';
    let k = s.patterns.filter((p) => (p.kind === 'sting') === isSting).length + 1, name = `${base} ${k}`;
    while (s.patterns.some((p) => p.name === name)) name = `${base} ${++k}`;
    App.pushUndo();
    const p = makePattern(name, isSting ? 1 : (App.pattern() ? App.pattern().bars : 2), isSting ? 'sting' : 'loop');
    // New segments go after the last segment, new stings at the end.
    const lastSeg = s.patterns.map((q) => q.kind !== 'sting').lastIndexOf(true);
    const at = isSting ? s.patterns.length : lastSeg + 1;
    s.patterns.splice(at, 0, p);
    s.arrangement = s.arrangement.map((i) => (i >= at ? i + 1 : i));
    ensurePattern(p);
    App.changed();
    this.selectPattern(at);
    this.openEditor();
  },

  /* ---------- init ---------- */
  initMap() {
    const area = $('#mapArea');
    // Folded or not is remembered per browser; the first time, short windows start folded so the editor has room.
    let folded = window.innerHeight < 860;
    try { const v = localStorage.getItem('synthstudio.mapFolded'); if (v !== null) folded = v === '1'; } catch (e) { /* storage blocked */ }
    const fold = (on) => {
      area.classList.toggle('folded', on);
      $('#btnMapFold').setAttribute('aria-expanded', String(!on));
      $('#btnMapFold').textContent = (on ? '▸' : '▾') + ' Map';
      try { localStorage.setItem('synthstudio.mapFolded', on ? '1' : '0'); } catch (e) { /* storage blocked */ }
      Roll.draw();
    };
    fold(folded);
    $('#btnMapFold').onclick = () => fold(!area.classList.contains('folded'));
    $('#btnAddSeg').onclick = () => this.newPattern('loop');
    $('#btnAddSting').onclick = () => this.newPattern('sting');
    $('#btnPlace').onclick = () => {
      const it = Library.find($('#placeSel').value);
      if (!it) return;
      App.pushUndo();
      const p = Library.place(it, App.song);
      // A placed segment goes after the last segment, so stings stay at the end of the row.
      const s = App.song, i = s.patterns.indexOf(p);
      App.changed();
      const lastSeg = s.patterns.map((q, k) => q.kind !== 'sting' && k !== i).lastIndexOf(true);
      this.selectPattern(i);
      if (p.kind !== 'sting' && lastSeg + 1 < i) this.movePattern(i, lastSeg + 1);
      const d = Library.offset(App.song, it);
      toast(`Placed “${it.name}” — linked, so edits change it everywhere it's used${d ? ` (shifted ${d > 0 ? '+' : ''}${d} to ${NOTE_NAMES[App.song.key]})` : ''}`, 3500);
    };
    $('#mapQuant').onchange = (e) => { App.pushUndo(); App.song.adaptive.quant = e.target.value; App.changed(); this.renderSim(); };

    const body = $('#mapBody');
    body.addEventListener('click', (e) => {
      const node = e.target.closest('[data-i]');
      const b = e.target.closest('button');
      if (b && b.dataset.end !== undefined) return Seq.end(+b.dataset.end);
      if (b && b.dataset.act === 'fade') return Seq.fadeOut(2);
      if (!node) return;
      const i = +node.dataset.i;
      if (b && b.dataset.act === 'go') return this.simGo(i);
      if (b && b.dataset.act === 'sting') return this.simSting(i);
      if (b && b.dataset.act === 'del') return this.deletePattern(i);
      if (b && b.dataset.act === 'rename') { this.selectPattern(i); return this.renamePattern(i, 'map'); }
      if (i !== App.sel.pattern) this.selectPattern(i);
      this.openEditor();
    });
    body.addEventListener('dblclick', (e) => {
      const node = e.target.closest('[data-i]');
      if (node && !e.target.closest('button')) this.renamePattern(+node.dataset.i, 'map');
    });
    // Drag segments to reorder them (the first one is where the level starts).
    let dragI = null;
    body.addEventListener('dragstart', (e) => {
      const n = e.target.closest('.map-node.seg');
      if (!n) return;
      dragI = +n.dataset.i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragI));
    });
    body.addEventListener('dragover', (e) => {
      if (dragI === null) return;
      const n = e.target.closest('.map-node.seg, .map-node.end');
      if (!n) return;
      e.preventDefault();
      $$('.map-node', body).forEach((x) => x.classList.toggle('dragover', x === n));
    });
    body.addEventListener('dragend', () => { dragI = null; $$('.map-node.dragover', body).forEach((x) => x.classList.remove('dragover')); });
    body.addEventListener('drop', (e) => {
      if (dragI === null) return;
      e.preventDefault();
      const n = e.target.closest('.map-node.seg, .map-node.end');
      const from = dragI; dragI = null;
      $$('.map-node.dragover', body).forEach((x) => x.classList.remove('dragover'));
      if (!n) return;
      const s = App.song;
      const to = n.classList.contains('end') ? s.patterns.map((q) => q.kind !== 'sting').lastIndexOf(true) + 1 : +n.dataset.i;
      this.movePattern(from, to);
    });

    // Simulate panel
    const sim = $('#simPanel');
    sim.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sim]');
      if (!b) return;
      if (b.dataset.sim === 'start') { if (this.simPlaying()) Seq.stop(); else this.simGo(this.firstSegment()); }
      else if (b.dataset.sim === 'fade') Seq.fadeOut(2);
    });
    sim.addEventListener('input', (e) => {
      if (e.target.id !== 'intensity') return;
      App.intensity = +e.target.value;
      Engine.layers();
      this.showLayerLevels();
    });

    // Pattern bar (above the Beat grid and Piano Roll): kind, entry sting, duplicate.
    $('#workspace').addEventListener('pointerdown', (e) => { if (e.target.matches('.lib-bar select')) App.pushUndo(); });
    $('#workspace').addEventListener('change', (e) => {
      const el = e.target, s = App.song, p = App.pattern();
      if (!el.closest('.lib-bar') || !el.dataset.pb) return;
      if (el.dataset.pb === 'kind') {
        p.kind = el.value;
        if (p.kind === 'sting') p.entrySting = null;
        else s.patterns.forEach((q) => { if (q.entrySting === p.id) q.entrySting = null; });
        const others = Library.alsoIn(p, s);
        if (others.length) toast(`“${p.name}” is linked, so it's now a ${p.kind === 'sting' ? 'sting' : 'segment'} in ${others.join(', ')} too`, 3500);
      } else if (el.dataset.pb === 'entry') p.entrySting = el.value || null;
      else if (el.dataset.pb === 'play') {
        p.play = el.value;
        if (p.play === 'goto' && !s.patterns.some((q) => q.id === p.then && q.kind !== 'sting')) p.then = (s.patterns.find((q) => q.kind !== 'sting') || {}).id || null;
      } else if (el.dataset.pb === 'then') p.then = el.value || null;
      else if (el.dataset.pb === 'at') p.at = el.value || null;
      else if (el.dataset.pb === 'duck') p.duck = clamp((+el.value || 0) / 100, 0, 1);
      App.changed();
      this.renderPatterns();
    });
    $('#workspace').addEventListener('click', (e) => {
      const b = e.target.closest('.lib-bar [data-pbact]');
      if (!b) return;
      if (b.dataset.pbact === 'dup') {
        App.pushUndo();
        Library.duplicatePattern(App.pattern(), App.song, App.sel.pattern + 1);
        App.song.arrangement = App.song.arrangement.map((i) => (i > App.sel.pattern ? i + 1 : i));
        App.changed();
        this.selectPattern(App.sel.pattern + 1);
      } else if (b.dataset.pbact === 'remove') this.deletePattern(App.sel.pattern);
    });
  },

  /* ---------- rendering ---------- */
  /* The map, the place picker and the pattern bar all follow the level's patterns. */
  renderPatterns() {
    this.renderMap();
    this.renderPlace();
    this.renderLibBar();
    $$('.barsSel').forEach((s) => (s.value = App.pattern().bars));
  },
  renderAdaptive() { this.renderMap(); this.renderSim(); },

  renderMap() {
    const s = App.song, body = $('#mapBody');
    if (!body) return;
    const segs = [], stings = [];
    s.patterns.forEach((p, i) => (p.kind === 'sting' ? stings : segs).push({ p, i }));
    const first = segs.length ? segs[0].i : -1;
    const bars = (p) => `${p.bars} bar${p.bars > 1 ? 's' : ''}`;
    const nodes = segs.map(({ p, i }) => {
      const entry = p.entrySting && s.patterns.find((q) => q.id === p.entrySting);
      return `<div class="map-node seg ${i === App.sel.pattern ? 'sel' : ''}" data-i="${i}" draggable="true" style="--c:${patColor(i)}" title="Click to edit · double-click to rename · drag to reorder">
        ${entry ? `<span class="entry" title="The game plays ⚡${esc(entry.name)} on the way into ${esc(p.name)}, from any segment">⚡ ${esc(entry.name)} ›</span>` : ''}
        <div class="nm"><span class="letter">${patLetter(i)}</span><span class="name">${esc(p.name)}</span>${this.libMark(p)}</div>
        <div class="meta"><span>${bars(p)}${i === first ? ' · <b class="start">start</b>' : ''}<span class="state"></span></span>
          <span class="node-btns"><button class="x" data-act="del" title="Remove from this level (it stays in the library)">✕</button><button class="play" data-act="go" title="Go here, like GoToSegment in the game">▶</button></span></div>
      </div>`;
    }).join('<span class="map-gap" aria-hidden="true"></span>');
    const end = `<div class="map-node end" title="How the level's music ends: EndWithSting or Stop (fade) in the game">
      <b>End</b>
      <div class="end-btns">${stings.map(({ p, i }) => `<button data-end="${i}" title="At the next change point the loop stops and ⚡${esc(p.name)} plays once, then silence (EndWithSting)">⚡ ${esc(p.name)}</button>`).join('')}
        <button data-act="fade" title="Fade everything out over 2 seconds (Stop)">Fade out</button></div>
    </div>`;
    const anytime = stings.length
      ? `<span class="cap">Can play anytime</span>${stings.map(({ p, i }) => `<div class="map-sting ${i === App.sel.pattern ? 'sel' : ''}" data-i="${i}" title="Click to edit · double-click to rename">
          <span class="name">⚡ ${esc(p.name)}</span>${this.libMark(p)}<small class="muted">${bars(p)} · ${esc(GameEvents.stingLabel(s, p))}</small><span class="state"></span>
          <button class="play" data-act="sting" title="Play it like PlaySting does in the game: ${esc(GameEvents.PLAY[GameEvents.stingPlay(p)].label.toLowerCase())}">▶</button><button class="x" data-act="del" title="Remove from this level (it stays in the library)">✕</button>
        </div>`).join('')}`
      : '<span class="muted" title="A sting is a short one-shot: a moment, a way into a segment, or the ending">No stings yet (+ Sting)</span>';
    body.innerHTML = `<div class="map-nodes">${nodes || '<span class="muted">No segments yet — + Segment adds one.</span>'}<span class="map-gap" aria-hidden="true"></span>${end}
      <div class="map-anytime">${anytime}</div></div>`;
    $('#mapQuant').value = s.adaptive.quant;
    this._mapKey = null;
    this.markMap();
  },

  renderSim() {
    const s = App.song, sim = $('#simPanel');
    if (!sim) return;
    const on = this.simPlaying();
    sim.innerHTML = `<div class="cap">Simulate the game</div>
      <div class="row gap"><button data-sim="start" class="${on ? 'on' : ''}" title="${on ? 'Stop' : 'Play the level from its first segment, like the game'}">${on ? '■ Stop' : '▶ Start'}</button>
        <button data-sim="fade" ${on ? '' : 'disabled'} title="Fade out over 2 seconds, like Stop in the game">Fade out</button></div>
      <div class="sim-events">${GameEvents.list().map((ev) => `<button data-ev="${ev.id}" class="${this.lastEvent === ev.id ? 'last' : ''}" title="${esc(GameEvents.summary(s, ev))}">${esc(ev.name)}</button>`).join('')}
        <button data-sim="editEvents" class="ghost" title="What each game event does in this level">${GameEvents.list().length ? 'Edit events…' : '+ Game events…'}</button></div>
      ${this.simLog ? `<div class="sim-log">${esc(this.simLog)}</div>` : ''}
      <div id="simStatus" class="sim-status"></div>
      ${s.layers.length > 1 ? `<div class="intensity">
          <label>Intensity <input id="intensity" type="range" min="0" max="1" step="0.01" value="${App.intensity}"><b id="intensityVal"></b></label>
          <div class="lvls">${s.layers.map((l, i) => `<div class="lvl"><span class="lvl-meter" data-i="${i}"></span><span>${esc(l.name)}</span></div>`).join('')}</div>
        </div>` : '<p class="muted small">One intensity layer: add layers in Mixer &amp; FX to preview intensity.</p>'}`;
    this.showLayerLevels();
    this._mapKey = null;
    this.markMap();
  },
  showLayerLevels() {
    const s = App.song;
    $$('.lvl-meter').forEach((el) => {
      const i = +el.dataset.i;
      const g = i === 0 ? 1 : clamp(App.intensity * (s.layers.length - 1) - (i - 1), 0, 1);
      el.style.setProperty('--lvl', g);
      el.title = `${s.layers[i].name}: ${Math.round(g * 100)}%`;
    });
    const v = $('#intensityVal');
    if (v) v.textContent = Math.round(App.intensity * 100) + '%';
  },

  /* Light up what's playing and queued (called every frame; touches the DOM only on change). */
  markMap(pos) {
    const s = App.song, A = this.simPlaying() ? Seq.adapt : null;
    const loopPat = !A && Seq.playing && App.mode === 'pattern' ? (pos ? pos.pat : App.sel.pattern) : null;
    const quant = { beat: 'next beat', bar: 'next bar', end: 'end of the segment' }[s.adaptive.quant];
    const playing = A ? A.cur : loopPat;
    const queuedSeg = A ? (A.next && A.next.target !== null && A.next.target !== undefined && !A.next.end ? A.next.target : A.after) : null;
    const queuedSting = A && A.next ? A.next.sting : null;
    const over = A && A.over ? A.over : null;
    const key = [playing, queuedSeg, queuedSting, A && A.ending, A && A.next && A.next.end, !!A, Seq.playing, over && over.pat, over && over.local !== null].join('|');
    if (key === this._mapKey) return;
    this._mapKey = key;
    $$('#mapBody [data-i]').forEach((n) => {
      const i = +n.dataset.i;
      const isPlaying = (i === playing && !(A && A.ending)) || (over && over.pat === i && over.local !== null);
      const isQueued = A && !isPlaying && (i === queuedSeg || i === queuedSting || (over && over.pat === i));
      n.classList.toggle('playing', !!isPlaying);
      n.classList.toggle('queued', !!isQueued);
      const st = $('.state', n);
      if (st) st.textContent = isPlaying ? (A ? ' · ● playing' : ' · ● looping') : isQueued ? ' · next' : '';
    });
    $$('#mapBody [data-end]').forEach((b) => {
      const i = +b.dataset.end;
      b.classList.toggle('playing', !!(A && A.ending && A.cur === i));
      b.classList.toggle('queued', !!(A && A.next && A.next.end && A.next.sting === i));
    });
    const btn = $('#simPanel [data-sim="start"]');
    if (btn && btn.classList.contains('on') !== !!A) this.renderSim();
    const status = $('#simStatus');
    if (!status) return;
    const nm = (i) => (s.patterns[i] ? s.patterns[i].name : '?');
    let text;
    if (!A) text = Seq.playing && App.mode === 'pattern' ? `Looping ${nm(loopPat)} (the transport). ▶ Start plays the level like the game.` : `Not playing. ▶ Start plays from ${s.patterns.some((p) => p.kind !== 'sting') ? nm(this.firstSegment()) : 'the first segment'}.`;
    else if (A.ending) text = `Ending on ⚡${nm(A.cur)}, then silence.`;
    else {
      const cur = s.patterns[A.cur] && s.patterns[A.cur].kind === 'sting' ? `⚡${nm(A.cur)}, then ${nm(A.after)}` : nm(A.cur);
      text = `Playing ${cur}.`;
      if (over) text += over.local !== null ? ` ⚡${nm(over.pat)} over the music.` : ` ⚡${nm(over.pat)} over the music at the ${over.at === 'now' ? 'next step' : { beat: 'next beat', bar: 'next bar' }[over.at] || quant}.`;
      if (A.next && A.next.end) text += ` Ending on ⚡${nm(A.next.sting)} at the ${quant}.`;
      else if (A.next && A.next.sting !== null && A.next.sting !== undefined) text += ` ⚡${nm(A.next.sting)} at the ${quant}, then ${nm(A.next.target)} restarts.`;
      else if (A.next) {
        const t = s.patterns[A.next.target], via = t && t.entrySting && s.patterns.find((q) => q.id === t.entrySting);
        text += ` Next: ${nm(A.next.target)}${via ? ` through ⚡${via.name}` : ''} at the ${quant}.`;
      }
    }
    status.textContent = text;
  },
});
