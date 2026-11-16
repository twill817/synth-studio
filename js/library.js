/* The game's library: every segment, sting and melody, shared by all levels. (The instruments, which
   own their notes, beats and curves, are in the Game Style: project.style.roles.)

   item = { id, name, kind: 'segment' | 'sting', bars,
            order: [roleId],                 // the instruments that play in it, in order
            mix:   { [roleId]: mix },        // each one's mix in it
            curves? }                        // a sting's Speed
   mix = { vol, pan, drive, tone, rev, dly, layer (by name), mute, solo }
        | { id, name, kind: 'melody', key, scale, bars, notes, role }      // a game theme

   level pattern (score.patterns[i]) lists its instruments in p.parts (see app.js), plus:
     lib     — library item id it is linked to, or null for a level's own version
     from    — for an own version: the item it was split from (so it can go back)
     libSig  — fingerprints of the copy when last synced ({ m: bars+kind+order, parts: {roleId: …} });
               a part whose fingerprint changed was edited here. 'pull' = take the library's version.

   Library.sync() runs after every edit:
     1. a pattern that isn't in the library yet (lib undefined) becomes a new library item;
     2. a linked copy that was edited writes its changes back to the item;
     3. every linked copy that differs from its item is rewritten.
   Notes never need syncing: each instrument plays its own music wherever it is. */

const Library = {
  items() { return App.project.library; },
  find(id) { return id ? this.items().find((x) => x.id === id) : null; },
  patterns() { return this.items().filter((x) => x.kind !== 'melody'); },
  melodies() { return this.items().filter((x) => x.kind === 'melody'); },
  of(p) { return this.find(p.lib); },
  kindOf(p) { return p.kind === 'sting' ? 'sting' : 'segment'; },

  /* A name nobody else in the library uses. */
  uniqueName(name, except) {
    let n = name, k = 2;
    while (this.items().some((x) => x !== except && x.name.toLowerCase() === n.toLowerCase())) n = `${name} ${k++}`;
    return n;
  },

  /* A part's mix as the library keeps it: the layer by name, so it means the same in every level. */
  mixOut(song, x) {
    const m = {};
    INST_MIX_KEYS.forEach((k) => (m[k] = x[k]));
    m.layer = (song.layers.find((l) => l.id === x.layer) || song.layers[0]).name;
    m.mute = !!x.mute; m.solo = !!x.solo;
    return m;
  },
  mixIn(song, m, t) {
    const x = newPart(song, t);
    if (m) {
      INST_MIX_KEYS.forEach((k) => { if (typeof m[k] === 'number') x[k] = m[k]; });
      const L = song.layers.find((l) => l.name.toLowerCase() === String(m.layer || '').toLowerCase());
      x.layer = L ? L.id : song.layers[0].id;
      x.mute = !!m.mute; x.solo = !!m.solo;
    }
    x.t = t.id;
    return x;
  },
  /* A level pattern's instruments (by instrument id) and their mix. */
  capture(p, song) {
    const order = [], mix = {};
    (p.parts || []).forEach((x) => {
      const t = song.tracks.find((y) => y.id === x.t);
      if (!t || order.includes(t.role)) return;
      order.push(t.role);
      mix[t.role] = this.mixOut(song, x);
    });
    return { bars: p.bars, kind: this.kindOf(p), order, mix, curves: hasCurves(p.curves) ? clone(p.curves) : null };
  },
  /* Short fingerprint of anything JSON-able (FNV-1a), so undo snapshots stay small. */
  hash(o) {
    const str = JSON.stringify(o);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  },
  sig(c) {
    const parts = {};
    c.order.forEach((k) => (parts[k] = this.hash(c.mix[k] || null)));
    return { m: this.hash([c.bars, c.kind, c.order, c.curves || null]), parts };
  },
  same(a, b) { return JSON.stringify(a) === JSON.stringify(b); },

  /* The item's instruments, in order (ones no longer in the game are skipped). */
  orderOf(item) { return (item.order || []).filter((id) => App.role(id)); },
  /* What a level's copy of an item should be. */
  materialize(item, song) {
    const order = this.orderOf(item), mix = {};
    order.forEach((k) => {
      const t = song.tracks.find((x) => x.role === k);
      mix[k] = t ? this.mixOut(song, this.mixIn(song, (item.mix || {})[k], t)) : clone((item.mix || {})[k] || null);
    });
    return { bars: item.bars, kind: item.kind, order, mix, curves: hasCurves(item.curves) ? clone(item.curves) : null };
  },

  /* Write captured content into a level pattern. */
  apply(p, song, c) {
    p.bars = c.bars;
    p.kind = c.kind === 'sting' ? 'sting' : 'loop';
    if (c.curves) p.curves = clone(c.curves); else delete p.curves;
    p.parts = c.order.map((k) => {
      const role = App.role(k);
      return role ? this.mixIn(song, c.mix[k], laneForRole(song, role)) : null;
    }).filter(Boolean);
    ensurePattern(p, song);
  },

  /* Write the edited parts of a level copy back into its item. Other parts stay as they are. */
  store(item, c, partKeys, meta) {
    item.mix = item.mix || {};
    if (meta) {
      item.bars = c.bars; item.kind = c.kind; item.order = c.order.slice();
      if (c.curves) item.curves = clone(c.curves); else delete item.curves;
      Object.keys(item.mix).forEach((k) => { if (!c.order.includes(k)) delete item.mix[k]; });
    }
    partKeys.forEach((k) => (item.mix[k] = clone(c.mix[k])));
  },

  /* A new library item from a level pattern. */
  create(p, song, name) {
    const c = this.capture(p, song);
    const item = { id: uid(), name: this.uniqueName(name || p.name), kind: c.kind, bars: c.bars, order: c.order.slice(), mix: clone(c.mix), ...(c.curves ? { curves: clone(c.curves) } : {}) };
    this.items().push(item);
    return item;
  },

  /* Every level placement of an item: [{ song, pattern, linked }]. */
  uses(item) {
    const out = [];
    App.project.scores.forEach((s) => s.patterns.forEach((p) => {
      if (p.lib === item.id) out.push({ song: s, pattern: p, linked: true });
      else if (p.from === item.id) out.push({ song: s, pattern: p, linked: false });
    }));
    return out;
  },
  /* Other levels a linked pattern also plays in. */
  alsoIn(p, song) {
    const item = this.of(p);
    if (!item) return [];
    return this.uses(item).filter((u) => u.linked && u.song !== song).map((u) => u.song.name);
  },
  placedIn(item, song) { return song.patterns.some((p) => p.lib === item.id || p.from === item.id); },

  /* Bring everything in line after an edit. Returns the linked copies it rewrote in other levels. */
  sync() {
    const P = App.project;
    if (!P || !P.library) return [];
    // 1. new patterns join the library; links to deleted items become own versions
    P.scores.forEach((s) => s.patterns.forEach((p) => {
      if (p.lib === undefined) {
        const item = this.create(p, s);
        p.lib = item.id; p.from = null; p.libSig = this.sig(this.capture(p, s));
      } else if (p.lib && !this.find(p.lib)) { p.lib = null; p.from = null; delete p.libSig; }
      if (p.lib === null && p.from && !this.find(p.from)) p.from = null;
    }));
    // 2. edited parts of linked copies write back to their item. A part with no fingerprint yet
    //    isn't an edit unless the instruments changed (then new ones are edits too).
    P.scores.forEach((s) => s.patterns.forEach((p) => {
      if (!p.lib || !p.libSig || p.libSig === 'pull' || !p.libSig.parts) return;
      const c = this.capture(p, s), sg = this.sig(c), old = p.libSig;
      const meta = sg.m !== old.m;
      const edited = Object.keys(sg.parts).filter((k) => (old.parts[k] !== undefined || meta) && old.parts[k] !== sg.parts[k]);
      if (edited.length || meta) this.store(this.of(p), c, edited, meta);
    }));
    // 3. linked copies that differ from their item are rewritten
    const rewrote = [];
    P.scores.forEach((s) => s.patterns.forEach((p) => {
      if (!p.lib) return;
      const want = this.materialize(this.of(p), s);
      if (!this.same(this.sig(this.capture(p, s)), this.sig(want))) {
        this.apply(p, s, want);
        if (s !== App.song || p.libSig !== 'pull') rewrote.push(`${s.name} › ${p.name}`);
      }
      p.libSig = this.sig(this.capture(p, s));
    }));
    // instruments a linked change took out of every track of a level leave that level
    P.scores.forEach((s) => pruneLanes(s));
    // a sting can't be entered through, and can't have an entry sting
    P.scores.forEach((s) => s.patterns.forEach((p) => {
      if (p.kind === 'sting') p.entrySting = null;
      else if (p.entrySting) { const st = s.patterns.find((q) => q.id === p.entrySting); if (!st || st.kind !== 'sting') p.entrySting = null; }
    }));
    return rewrote;
  },

  /* ----- actions (callers push undo and re-render) ----- */
  /* Place an item in a level, linked. Returns the new level pattern. */
  place(item, song, name) {
    let n = name || item.name, k = 2;
    while (song.patterns.some((p) => p.name.toLowerCase() === n.toLowerCase())) n = `${name || item.name} ${k++}`;
    const p = makePattern(n, item.bars, item.kind === 'sting' ? 'sting' : 'loop');
    p.lib = item.id; p.from = null; p.libSig = 'pull';
    song.patterns.push(p);
    this.apply(p, song, this.materialize(item, song));
    return p;
  },
  /* Split a linked pattern off as this level's own version. */
  ownVersion(p) { if (!p.lib) return; p.from = p.lib; p.lib = null; delete p.libSig; },
  /* Drop the level's own version and use the library's again. */
  relink(p) { if (!p.from || !this.find(p.from)) return; p.lib = p.from; p.from = null; p.libSig = 'pull'; },
  /* A copy of a level pattern as a new, separate library item, placed in the same level. */
  duplicatePattern(p, song, at) {
    const q = clone(p);
    q.id = uid();
    let n = p.name + ' copy', k = 2;
    while (song.patterns.some((x) => x.name === n)) n = `${p.name} copy ${k++}`;
    q.name = n; q.lib = undefined; q.from = null; delete q.libSig; q.entrySting = null;
    song.patterns.splice(at, 0, q);
    return q;
  },
  duplicateItem(item) {
    const c = clone(item);
    c.id = uid(); c.name = this.uniqueName(item.name + ' copy');
    this.items().push(c);
    return c;
  },
  /* Delete an item. Levels that use it keep their copy as their own version. */
  remove(item) {
    App.project.scores.forEach((s) => s.patterns.forEach((p) => {
      if (p.lib === item.id) { p.lib = null; p.from = null; delete p.libSig; }
      if (p.from === item.id) p.from = null;
    }));
    if (item.kind === 'melody') App.style.roles.forEach((r) => { if (r.music && r.music.theme && r.music.theme.theme === item.id) delete r.music.theme; });
    this.items().splice(this.items().indexOf(item), 1);
  },
  /* An instrument is gone: library items stop listing it. */
  forgetRole(id) {
    this.patterns().forEach((it) => { it.order = (it.order || []).filter((k) => k !== id); if (it.mix) delete it.mix[id]; });
  },

  /* ----- loading older projects: melodies kept apart become library melodies ----- */
  migrate(p) {
    if (!p.library) p.library = [];
    if (p.themes) { p.themes.forEach((th) => { if (!p.library.some((x) => x.id === th.id)) p.library.push({ ...th, kind: 'melody' }); }); delete p.themes; }
  },
};
