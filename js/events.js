/* Game events: the game says what happened; the music decides what to do — game-wide, and a level
   can override (step 6d: "the game decides; a level can override").

   project.events = [{ id, name, note }]           // game-wide, named exactly as the game fires them
   project.cues   = { [eventId]: [action] }         // game-wide: target = a LIBRARY item id (a track)
   score.cues     = { [eventId]: [action] }         // a level's override: target = a pattern id there
   action         = { do, target, value }
   In a level, a game-wide action plays the level's placement of that library track; an action whose
   track isn't in the level is skipped there. An override (even an empty one) replaces the game's.
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

  START: ['goto', 'play', 'sting', 'end'],   // actions that start a track
  list() { return App.project.events; },
  find(id) { return this.list().find((e) => e.id === id); },
  byName(name) { return this.list().find((e) => e.name.toLowerCase() === String(name).toLowerCase()); },
  /* ----- game-wide vs a level's override ----- */
  isCustom(song, ev) { return !!(song.cues && song.cues[ev.id]); },
  gameActions(ev) { return (App.project.cues && App.project.cues[ev.id]) || []; },
  /* The level's placement of a library track (linked, or its own version). */
  placement(song, itemId) { return song.patterns.find((p) => p.lib === itemId) || song.patterns.find((p) => p.from === itemId) || null; },
  itemOf(p) { return p ? p.lib || p.from || null : null; },
  resolve(song, a) {
    if (!this.ACTIONS[a.do] || !this.ACTIONS[a.do].target) return { ...a };
    const p = this.placement(song, a.target);
    return p ? { ...a, target: p.id } : null;
  },
  toGame(song, a) {
    if (!this.ACTIONS[a.do] || !this.ACTIONS[a.do].target) return { ...a };
    const it = this.itemOf(song.patterns.find((p) => p.id === a.target));
    return it ? { ...a, target: it } : null;
  },
  /* What the event does in this level (targets are this level's pattern ids). */
  actions(song, ev) { return this.isCustom(song, ev) ? song.cues[ev.id] : this.gameActions(ev).map((a) => this.resolve(song, a)).filter(Boolean); },
  /* Game-wide actions that skip this level (their track isn't placed here). */
  skipped(song, ev) { return this.isCustom(song, ev) ? [] : this.gameActions(ev).filter((a) => !this.resolve(song, a)); },
  usedIn(ev) { return App.project.scores.filter((s) => this.actions(s, ev).length).length; },
  customizedIn(ev) { return App.project.scores.filter((s) => this.isCustom(s, ev)).map((s) => s.name); },
  /* The list an edit in this level changes: its override, else the game's (game: true → library targets). */
  editList(song, ev, make) {
    if (this.isCustom(song, ev)) return { xs: song.cues[ev.id], game: false };
    if (!App.project.cues[ev.id] && make) App.project.cues[ev.id] = [];
    return { xs: App.project.cues[ev.id] || [], game: true };
  },
  customize(song, ev) { song.cues[ev.id] = clone(this.actions(song, ev)); },
  revert(song, ev) { delete song.cues[ev.id]; },
  /* Make this level's override the game's. Returns the actions that couldn't go (track not in the library). */
  promote(song, ev) {
    const xs = song.cues[ev.id] || [], out = [], lost = [];
    xs.forEach((a) => { const g = this.toGame(song, a); if (g) out.push(g); else lost.push(a); });
    if (out.length) App.project.cues[ev.id] = out; else delete App.project.cues[ev.id];
    delete song.cues[ev.id];
    return lost;
  },
  /* ----- "Plays on": the events that start a track ----- */
  playsOn(song, p) { return this.list().filter((ev) => this.actions(song, ev).some((a) => this.START.includes(a.do) && a.target === p.id)); },
  /* Make ev start p (replacing what it started before), or stop it starting p. Edits the game's
     assignment unless this level overrides the event (or p isn't in the library). */
  setStart(song, p, ev, on) {
    const it = this.itemOf(p);
    if (!this.isCustom(song, ev) && !it) this.customize(song, ev);
    const L = this.editList(song, ev, true), target = L.game ? it : p.id;
    let replaced = null;
    if (on) {
      const old = L.xs.find((a) => this.START.includes(a.do));
      if (old) replaced = L.game ? (Library.find(old.target) || {}).name : this.targetName(song, old);
      const keep = L.xs.filter((a) => !this.START.includes(a.do));
      L.xs.length = 0;
      L.xs.push({ do: p.kind === 'sting' ? 'sting' : 'goto', target, value: null }, ...keep);
    } else {
      const keep = L.xs.filter((a) => !(this.START.includes(a.do) && a.target === target));
      L.xs.length = 0; L.xs.push(...keep);
    }
    if (L.game && !L.xs.length) delete App.project.cues[ev.id];
    return { game: L.game, replaced: replaced && replaced !== p.name ? replaced : null };
  },
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
    delete App.project.cues[ev.id];
    App.project.scores.forEach((s) => { if (s.cues) delete s.cues[ev.id]; });
  },
  /* A new action; game: target a library track (one placed in this level if there is one). */
  newAction(kind, song, game) {
    const A = this.ACTIONS[kind], a = { do: kind, target: null, value: A.def ?? null };
    if (A.target) {
      const p = song.patterns.find((q) => (A.target === 'sting') === (q.kind === 'sting') && (!game || this.itemOf(q)));
      if (game) a.target = p ? this.itemOf(p) : ((Library.patterns().find((it) => (A.target === 'sting') === (it.kind === 'sting')) || {}).id || null);
      else a.target = p ? p.id : null;
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
  /* Words for a game-wide action (library targets). */
  describeGame(song, a) {
    const A = this.ACTIONS[a.do];
    if (!A || !A.target) return this.describe(song, a);
    const it = Library.find(a.target);
    return `${A.label} ${A.target === 'sting' ? '⚡' : ''}${it ? it.name : '(missing)'}${it && !this.placement(song, it.id) ? ' (not in this level)' : ''}`;
  },
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
    if (!p.cues) { p.cues = {}; this.lift(p); }
    Object.keys(p.cues).forEach((k) => { if (!p.events.some((e) => e.id === k)) delete p.cues[k]; });
  },
  /* Step 6d: an event that does the same thing in every level (same library tracks) becomes game-wide.
     Only when nothing would change anywhere: a level without the event's cues must have none of
     its tracks, and the event must start a track (else it would newly act there). */
  lift(p) {
    const prev = App.project; App.project = p;
    try {
      p.events.forEach((ev) => {
        let cand = null, ok = true;
        const key = (xs) => JSON.stringify(xs);
        p.scores.forEach((s) => {
          if (!ok || !s.cues[ev.id]) return;
          const g = s.cues[ev.id].map((a) => this.toGame(s, a));
          if (g.some((a) => !a)) { ok = false; return; }
          if (!cand) cand = g; else if (key(cand) !== key(g)) ok = false;
        });
        if (!ok || !cand) return;
        // the same in every level: lift. Otherwise a level without it must have none of its tracks
        // (and the event must only start tracks), or lifting would make it act there.
        p.scores.forEach((s) => {
          if (!ok || s.cues[ev.id]) return;
          if (cand.some((a) => !this.ACTIONS[a.do].target || this.placement(s, a.target))) ok = false;
        });
        if (!ok) return;
        p.cues[ev.id] = cand;
        p.scores.forEach((s) => delete s.cues[ev.id]);
      });
    } finally { App.project = prev; }
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
    // "Plays on" in the bar above the editors: the game events that start the open track.
    $('#workspace').addEventListener('click', (e) => {
      const b = e.target.closest('[data-po-del]');
      if (!b) return;
      const ev = GameEvents.find(b.dataset.poDel), p = App.pattern();
      if (!ev || !p) return;
      App.pushUndo();
      const r = GameEvents.setStart(App.song, p, ev, false);
      App.changed(); this.afterPlaysOn();
      undoToast(`${ev.name} no longer plays “${p.name}”${r.game ? ' (game-wide)' : ` in ${App.song.name}`}`);
    });
    $('#workspace').addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-po-add]');
      if (!sel || !sel.value) return;
      const ev = GameEvents.find(sel.value), p = App.pattern();
      if (!ev || !p) return;
      App.pushUndo();
      const r = GameEvents.setStart(App.song, p, ev, true);
      App.changed(); this.afterPlaysOn();
      const others = App.project.scores.filter((s) => s !== App.song && GameEvents.playsOn(s, s.patterns.find((q) => GameEvents.itemOf(q) && GameEvents.itemOf(q) === GameEvents.itemOf(p)) || {}).includes(ev));
      toast(`${ev.name} now plays “${p.name}”` + (r.game ? ` — game-wide${others.length ? `, also in ${others.map((s) => s.name).join(', ')}` : ''}` : ` in ${App.song.name} (this level's own setting)`) + (r.replaced ? ` instead of “${r.replaced}”` : ''), 4000);
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
        const L = GameEvents.editList(s, ev, true);
        L.xs.push(GameEvents.newAction($('select[data-ea="newKind"]', row).value, s, L.game));
      } else if (b.dataset.ea === 'delAction' && ev) {
        App.pushUndo();
        const L = GameEvents.editList(s, ev);
        L.xs.splice(+b.dataset.k, 1);
        if (L.game && !L.xs.length) delete App.project.cues[ev.id];   // a level's empty override stays: "nothing here"
      } else if (b.dataset.ea === 'customize' && ev) {
        App.pushUndo(); GameEvents.customize(s, ev);
        toast(`${ev.name} now has its own setting in ${s.name}. The game's is unchanged.`, 3000);
      } else if (b.dataset.ea === 'revert' && ev) {
        App.pushUndo(); GameEvents.revert(s, ev);
        undoToast(`${ev.name} in ${s.name} is back on the game style`);
      } else if (b.dataset.ea === 'promote' && ev) {
        App.pushUndo();
        const lost = GameEvents.promote(s, ev);
        undoToast(`${ev.name} now does this game-wide` + (lost.length ? ` — ${lost.length} action${lost.length > 1 ? 's' : ''} left out (track not in the library)` : ''));
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
      const s = App.song, L = GameEvents.editList(s, GameEvents.find(row.dataset.ev)), a = L.xs[+el.dataset.k];
      if (!a) return;
      if (el.dataset.ef === 'do') Object.assign(a, GameEvents.newAction(el.value, s, L.game));
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
  afterPlaysOn() { this.renderLibBar(); this.renderSim(); this.renderStyle(); if ($('#eventsDlg').open) this.renderEvents(); },
  /* The "Plays on" row: events that start the open track, and + Event. */
  playsOnHTML(p, s) {
    const on = GameEvents.playsOn(s, p), rest = GameEvents.list().filter((ev) => !on.includes(ev));
    if (!GameEvents.list().length) return '';
    const chip = (ev) => {
      const own = GameEvents.isCustom(s, ev);
      return `<span class="po-chip ${own ? 'own' : ''}" title="${esc(ev.name)}: ${esc(GameEvents.summary(s, ev))}${own ? ` — ${esc(s.name)}'s own setting` : ' — game-wide'}">${esc(ev.name)}${own ? ' ✦' : ''}<button data-po-del="${ev.id}" aria-label="Stop ${esc(ev.name)} playing this">×</button></span>`;
    };
    return `<span class="pb-plays"><span class="tb-label" title="Game events that start this ${p.kind === 'sting' ? 'sting' : 'segment'}. Game-wide unless a level has its own setting (✦).">Plays on</span>${on.map(chip).join('') || '<span class="muted">no event</span>'}
      ${rest.length ? `<select data-po-add aria-label="Add a game event"><option value="">+ Event</option>${rest.map((ev) => `<option value="${ev.id}">${esc(ev.name)}${GameEvents.actions(s, ev).some((a) => GameEvents.START.includes(a.do)) ? ' (moves here)' : ''}</option>`).join('')}</select>` : ''}</span>`;
  },
  renderEvents() {
    const s = App.song, box = $('#eventsBody');
    if (!box) return;
    let game = false;   // set per event row: game-wide rows target library tracks
    const opts = (kind, cur) => game
      ? Library.patterns().filter((it) => (kind === 'sting') === (it.kind === 'sting'))
        .map((it) => `<option value="${it.id}" ${it.id === cur ? 'selected' : ''}>${kind === 'sting' ? '⚡ ' : ''}${esc(it.name)}${GameEvents.placement(s, it.id) ? '' : ' (not in this level)'}</option>`).join('')
      : s.patterns.filter((p) => (kind === 'sting') === (p.kind === 'sting'))
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
    box.innerHTML = evs.length ? evs.map((ev) => {
      const L = GameEvents.editList(s, ev);
      game = L.game;
      const skipped = GameEvents.skipped(s, ev).length;
      const scope = L.game
        ? `<span class="scope style" title="Every level does this, unless it has its own setting">From the game style</span>${GameEvents.customizedIn(ev).length ? `<span class="muted">· own setting in ${esc(GameEvents.customizedIn(ev).join(', '))}</span>` : ''}<button data-ea="customize" title="Give ${esc(s.name)} its own setting for this event">Customize for this level</button>`
        : `<span class="scope level">Customized for this level</span><button data-ea="revert">Back to the game style</button><button data-ea="promote" title="Make every level do this (levels with their own setting keep it)">Make this the game style</button>`;
      return `<div class="ev-row" data-ev="${ev.id}">
        <div class="ev-head"><button data-ea="fire" title="Try it (Simulate)">▶</button><b>${esc(ev.name)}</b>${ev.note ? `<span class="muted">${esc(ev.note)}</span>` : ''}<span class="ev-scope">${scope}</span></div>
        <div class="ev-acts">${L.xs.map(actRow).join('') || `<span class="muted">${L.game ? 'Does nothing yet.' : 'Does nothing in this level.'}</span>`}${skipped ? `<div class="muted ev-skip">${skipped} action${skipped > 1 ? 's' : ''} skipped here: ${skipped > 1 ? 'their tracks aren\'t' : 'its track isn\'t'} in ${esc(s.name)}.</div>` : ''}</div>
        <div class="ev-add"><select data-ea="newKind">${kinds('goto')}</select><button data-ea="addAction">+ Action</button></div>
      </div>`;
    }).join('')
      : '<p class="muted">No game events yet. Add the names your game fires (e.g. RunStarted), exactly as its code spells them.</p>';
    $('#eventsLevel').textContent = s.name;
  },

  /* Game Style → Game events (the game-wide list). */
  styleEventsHTML() {
    const evs = GameEvents.list();
    return `<section class="style-sec">
      <h4 class="subhead">Game events</h4>
      <p class="muted">What the game tells the music, named exactly as the game fires them (MusicCues.Trigger). What each one does is game-wide (a track's <b>Plays on</b>, above the editors, or Simulate › Edit events…); a level can override it.</p>
      <div class="role-list">${evs.map((ev) => `<div class="event-row" data-eid="${ev.id}">
          <span class="name">${esc(ev.name)}</span><button class="edit" data-act="renameEvent" title="Rename event (change the game's code to match)">✎</button>
          <span class="muted note" title="Double-click to edit the note">${esc(ev.note || 'no note')}</span>
          <span class="muted use" title="${esc(GameEvents.gameActions(ev).map((a) => GameEvents.describeGame(App.song, a)).join(' + ') || 'nothing game-wide')}">${GameEvents.gameActions(ev).length ? 'game-wide · ' : ''}acts in ${GameEvents.usedIn(ev)} level${GameEvents.usedIn(ev) === 1 ? '' : 's'}${GameEvents.customizedIn(ev).length ? ` · ${GameEvents.customizedIn(ev).length} customized` : ''}</span>
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
