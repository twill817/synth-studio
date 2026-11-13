/* Game events: the game says what happened; each level says what its music does.

   project.events = [{ id, name, note }]           // game-wide, named exactly as the game fires them
   score.cues     = { [eventId]: [action] }         // per level
   action         = { do, target, value }           // target: a pattern id in this level
   Sting settings live on the level's sting pattern (see Seq.request):
     play: 'instead' | 'over' | 'goto' | 'end',  then: segment id,  at: null | 'now' | 'beat' | 'bar',  duck: 0–1

   Each action maps to one AdaptiveMusicPlayer call; the export writes them into the manifest so
   MusicCues can play them (its Inspector table then only overrides). */

const GameEvents = {
  ACTIONS: {
    goto:      { label: 'Go to segment', target: 'segment', unity: 'GoToSegment' },
    play:      { label: 'Start at segment (right away)', target: 'segment', unity: 'Play' },
    sting:     { label: 'Play sting', target: 'sting', unity: 'PlaySting' },
    intensity: { label: 'Set intensity to', value: 'pct', def: 1, unity: 'SetIntensity' },
    duck:      { label: 'Turn the music down to', value: 'pct', def: 0.35, unity: 'Duck' },
    unduck:    { label: 'Turn the music back up', unity: 'Unduck' },
    end:       { label: 'End on sting', target: 'sting', unity: 'EndWithSting' },
    fade:      { label: 'Fade out over', value: 'sec', def: 2, unity: 'Stop' },
  },
  PLAY: {
    instead: { label: 'Instead, then the segment restarts', short: 'instead' },
    over: { label: 'Over the music', short: 'over' },
    goto: { label: 'Then go to a segment', short: '→' },
    end: { label: 'End the music', short: 'ends' },
  },

  list() { return App.project.events; },
  find(id) { return this.list().find((e) => e.id === id); },
  byName(name) { return this.list().find((e) => e.name.toLowerCase() === String(name).toLowerCase()); },
  actions(song, ev) { return (song.cues && song.cues[ev.id]) || []; },
  usedIn(ev) { return App.project.scores.filter((s) => this.actions(s, ev).length).length; },
  add(name, note = '') {
    const n = String(name).trim();
    if (!n) throw new Error('Give the event a name.');
    if (this.byName(n)) throw new Error(`There's already an event called “${n}”.`);
    const ev = { id: uid(), name: n, note };
    this.list().push(ev);
    return ev;
  },
  remove(ev) {
    App.project.events.splice(App.project.events.indexOf(ev), 1);
    App.project.scores.forEach((s) => { if (s.cues) delete s.cues[ev.id]; });
  },
  newAction(kind, song) {
    const A = this.ACTIONS[kind], a = { do: kind, target: null, value: A.def ?? null };
    if (A.target) {
      const p = song.patterns.find((q) => (A.target === 'sting') === (q.kind === 'sting'));
      a.target = p ? p.id : null;
    }
    return a;
  },

  /* ----- words ----- */
  pct(v) { return Math.round((v ?? 0) * 100) + '%'; },
  targetName(song, a) { const p = song.patterns.find((q) => q.id === a.target); return p ? p.name : null; },
  describe(song, a) {
    const A = this.ACTIONS[a.do];
    if (!A) return '?';
    const t = this.targetName(song, a);
    if (A.target) return `${A.label} ${A.target === 'sting' ? '⚡' : ''}${t || '(missing)'}`;
    if (A.value === 'pct') return `${A.label} ${this.pct(a.value)}`;
    if (A.value === 'sec') return `${A.label} ${a.value ?? 2} s`;
    return A.label;
  },
  summary(song, ev) { const xs = this.actions(song, ev); return xs.length ? xs.map((a) => this.describe(song, a)).join(' + ') : 'does nothing in this level'; },
  stingPlay(p) { return this.PLAY[p.play] ? p.play : 'instead'; },
  stingLabel(song, p) {
    const k = this.stingPlay(p);
    if (k === 'goto') { const t = song.patterns.find((q) => q.id === p.then); return '→ ' + (t ? t.name : '?'); }
    if (k === 'over') return `over · music ${this.pct(p.duck ?? 0.6)}`;
    return this.PLAY[k].short;
  },

  /* ----- preview: do what the game would ----- */
  fire(song, ev) {
    const xs = this.actions(song, ev);
    const idx = (a) => song.patterns.findIndex((q) => q.id === a.target);
    xs.forEach((a) => {
      const i = idx(a);
      switch (a.do) {
        case 'goto': if (i >= 0) UI.simGo(i); break;
        case 'play': if (i >= 0) { UI.setMode('adaptive', false); Seq.stop(); Seq.start(0, i); } break;
        case 'sting': if (i >= 0) UI.simSting(i); break;
        case 'intensity': App.intensity = clamp(a.value ?? 1, 0, 1); Engine.layers(); UI.renderSim(); break;
        case 'duck': Seq.duck(true, a.value ?? 0.35); break;
        case 'unduck': Seq.duck(false); break;
        case 'end': if (i >= 0) { if (!UI.simPlaying()) UI.setMode('adaptive', false); Seq.end(i); } break;
        case 'fade': Seq.fadeOut(a.value || 2); break;
      }
    });
    return `${ev.name} → ${this.summary(song, ev)}`;
  },

  /* ----- export: MusicCues rows ----- */
  exportCues(song) {
    const out = [];
    this.list().forEach((ev) => this.actions(song, ev).forEach((a) => {
      const A = this.ACTIONS[a.do];
      if (!A) return;
      const target = A.target ? this.targetName(song, a) : '';
      if (A.target && !target) return;
      out.push({ name: ev.name, action: A.unity, target, value: A.value ? +(a.value ?? A.def) : 1 });
    }));
    return out;
  },

  migrate(p) {
    p.events = p.events || [];
    p.scores.forEach((s) => {
      s.cues = s.cues || {};
      Object.keys(s.cues).forEach((k) => { if (!p.events.some((e) => e.id === k)) delete s.cues[k]; });
    });
  },
};

/* ---------- UI: Simulate's event buttons, the Edit events window, Game Style's list ---------- */
Object.assign(UI, {
  initEvents() {
    $('#simPanel').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.ev) {
        const ev = GameEvents.find(b.dataset.ev);
        if (!ev) return;
        this.simLog = GameEvents.fire(App.song, ev);
        this.lastEvent = ev.id;
        return this.renderSim();
      }
      if (b.dataset.sim === 'editEvents') this.openEvents();
    });
    const dlg = $('#eventsDlg');
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const s = App.song, row = b.closest('[data-ev]'), ev = row && GameEvents.find(row.dataset.ev);
      if (b.dataset.ea === 'addEvent') {
        const inp = $('#newEventName');
        try { App.pushUndo(); GameEvents.add(inp.value); inp.value = ''; } catch (err) { App.undoStack.pop(); return toast(err.message, 3000); }
      } else if (b.dataset.ea === 'addAction' && ev) {
        App.pushUndo();
        (s.cues[ev.id] = s.cues[ev.id] || []).push(GameEvents.newAction($('select[data-ea="newKind"]', row).value, s));
      } else if (b.dataset.ea === 'delAction' && ev) {
        App.pushUndo();
        s.cues[ev.id].splice(+b.dataset.k, 1);
        if (!s.cues[ev.id].length) delete s.cues[ev.id];
      } else if (b.dataset.ea === 'fire' && ev) {
        this.simLog = GameEvents.fire(s, ev); this.lastEvent = ev.id; this.renderSim(); return;
      } else return;
      App.changed();
      this.renderEvents(); this.renderSim(); this.renderStyle();
    });
    // Enter in a name box adds the event (instead of submitting, which would close the window).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('#newEventName, #styleEventName')) return;
      e.preventDefault();
      (e.target.id === 'newEventName' ? $('[data-ea="addEvent"]', dlg) : $('#stylePanel [data-act="addEvent"]')).click();
    });
    dlg.addEventListener('pointerdown', (e) => { if (e.target.matches('select[data-ef], input[data-ef]')) App.pushUndo(); });
    dlg.addEventListener('change', (e) => {
      const el = e.target, row = el.closest('[data-ev]');
      if (!el.dataset.ef || !row) return;
      const s = App.song, a = s.cues[row.dataset.ev][+el.dataset.k];
      if (el.dataset.ef === 'do') Object.assign(a, GameEvents.newAction(el.value, s));
      else if (el.dataset.ef === 'target') a.target = el.value || null;
      else if (el.dataset.ef === 'value') {
        const A = GameEvents.ACTIONS[a.do];
        a.value = A.value === 'pct' ? clamp((+el.value || 0) / 100, 0, 1) : clamp(+el.value || 0, 0.1, 30);
      }
      App.changed();
      this.renderEvents(); this.renderSim();
    });
  },
  openEvents() { this.renderEvents(); $('#eventsDlg').showModal(); },
  renderEvents() {
    const s = App.song, box = $('#eventsBody');
    if (!box) return;
    const opts = (kind, cur) => s.patterns.filter((p) => (kind === 'sting') === (p.kind === 'sting'))
      .map((p) => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${kind === 'sting' ? '⚡ ' : ''}${esc(p.name)}</option>`).join('');
    const kinds = (cur) => Object.entries(GameEvents.ACTIONS).map(([k, A]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${A.label}</option>`).join('');
    const actRow = (a, k) => {
      const A = GameEvents.ACTIONS[a.do] || {};
      const val = A.value === 'pct' ? `<input type="number" data-ef="value" data-k="${k}" min="0" max="100" step="5" value="${Math.round((a.value ?? A.def) * 100)}"> %`
        : A.value === 'sec' ? `<input type="number" data-ef="value" data-k="${k}" min="0.1" max="30" step="0.5" value="${a.value ?? A.def}"> s` : '';
      const tgt = A.target ? `<select data-ef="target" data-k="${k}">${opts(A.target, a.target) || `<option value="">no ${A.target}s in this level</option>`}</select>` : '';
      return `<div class="ev-act"><select data-ef="do" data-k="${k}">${kinds(a.do)}</select>${tgt}${val}<button class="x" data-ea="delAction" data-k="${k}" title="Remove this action">✕</button></div>`;
    };
    const evs = GameEvents.list();
    box.innerHTML = evs.length ? evs.map((ev) => `<div class="ev-row" data-ev="${ev.id}">
        <div class="ev-head"><button data-ea="fire" title="Try it (Simulate)">▶</button><b>${esc(ev.name)}</b>${ev.note ? `<span class="muted">${esc(ev.note)}</span>` : ''}</div>
        <div class="ev-acts">${GameEvents.actions(s, ev).map(actRow).join('') || '<span class="muted">Does nothing in this level.</span>'}</div>
        <div class="ev-add"><select data-ea="newKind">${kinds('goto')}</select><button data-ea="addAction">+ Action</button></div>
      </div>`).join('')
      : '<p class="muted">No game events yet. Add the names your game fires (e.g. RunStarted), exactly as its code spells them.</p>';
    $('#eventsLevel').textContent = s.name;
  },

  /* Game Style → Game events (the game-wide list). */
  styleEventsHTML() {
    const evs = GameEvents.list();
    return `<section class="style-sec">
      <h4 class="subhead">Game events</h4>
      <p class="muted">What the game tells the music, named exactly as the game fires them (MusicCues.Trigger). What each one does is set per level: Simulate › Edit events… on the map.</p>
      <div class="role-list">${evs.map((ev) => `<div class="event-row" data-eid="${ev.id}">
          <span class="name">${esc(ev.name)}</span><button class="edit" data-act="renameEvent" title="Rename event (change the game's code to match)">✎</button>
          <span class="muted note" title="Double-click to edit the note">${esc(ev.note || 'no note')}</span>
          <span class="muted use">${GameEvents.usedIn(ev)} level${GameEvents.usedIn(ev) === 1 ? '' : 's'}</span>
          <button class="x" data-act="delEvent" title="Delete event (and what it does in every level)">✕</button>
        </div>`).join('') || '<p class="muted">No game events yet.</p>'}</div>
      <div class="row gap add-role"><input id="styleEventName" placeholder="Event name, e.g. RunStarted" spellcheck="false"><button data-act="addEvent">+ Event</button></div>
    </section>`;
  },
  styleEventsClick(e) {
    const act = e.target.dataset.act;
    if (act === 'addEvent') {
      const inp = $('#styleEventName');
      App.pushUndo();
      try { GameEvents.add(inp.value); } catch (err) { App.undoStack.pop(); toast(err.message, 3000); return true; }
      App.changed(); this.renderStyle(); this.renderSim();
      return true;
    }
    const row = e.target.closest('.event-row');
    if (!row) return false;
    const ev = GameEvents.find(row.dataset.eid);
    if (act === 'delEvent') {
      App.pushUndo(); GameEvents.remove(ev); App.changed();
      this.renderStyle(); this.renderSim();
      undoToast(`Deleted event “${ev.name}”`);
    } else if (act === 'renameEvent') {
      inlineRename($('.name', row), ev.name, (v) => {
        if (v && v !== ev.name && !GameEvents.byName(v)) { App.pushUndo(); ev.name = v; App.changed(); }
        this.renderStyle(); this.renderSim();
      });
    }
    return true;
  },
  styleEventsDblclick(e) {
    const row = e.target.closest('.event-row');
    if (!row || !e.target.closest('.note')) return false;
    const ev = GameEvents.find(row.dataset.eid);
    inlineRename($('.note', row), ev.note || '', (v) => {
      if (v !== null && v !== undefined && v !== ev.note) { App.pushUndo(); ev.note = v; App.changed(); }
      this.renderStyle();
    });
    return true;
  },
});
