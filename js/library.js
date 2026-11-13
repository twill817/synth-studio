/* The game's library: every segment, sting and melody, shared by all levels.

   item = { id, name, kind: 'segment' | 'sting', bars, key, scale,      // written in key/scale
            parts:   { [partKey]: { notes: [{s,l,p,v}] } | { drums: { voiceId: steps[] } } },
            origins: { [partKey]: { theme, oct, speed, fit } } }         // melody links, per part
        | { id, name, kind: 'melody', key, scale, bars, notes, role }      // a game theme

   track.part  — which part of a library pattern a track plays: its role id, or role:2, role:3 …
                 for a second or third track on the same role.
   level pattern (score.patterns[i]) keeps today's shape (notes/drums by track id, so playback,
   editors and export are unchanged), plus:
     lib     — library item id it is linked to, or null for a level's own version
     from    — for an own version: the item it was split from (so it can go back)
     libSig  — fingerprints of the copy when last synced ({ m: bars+kind, parts: {partKey: …} });
               a part whose fingerprint changed was edited here. 'pull' = take the library's version.

   Library.sync() runs after every edit:
     1. a pattern that isn't in the library yet (lib undefined) becomes a new library item;
     2. a linked copy that was edited writes its parts back to the item (shifted into the item's key);
     3. every linked copy that differs from its item is rewritten (shifted into its level's key).
   Pitched parts move to each level's key by whole semitones (exact in both directions); drums don't. */

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

  /* Give every track a part key: its role, or role:2, role:3 … for later tracks on that role. */
  ensureParts(song) {
    const used = new Set();
    song.tracks.forEach((t) => { if (t.part) { if (used.has(t.part)) t.part = null; else used.add(t.part); } });
    song.tracks.forEach((t) => {
      if (t.part) return;
      let k = t.role, n = 2;
      while (used.has(k)) k = `${t.role}:${n++}`;
      t.part = k; used.add(k);
    });
  },

  /* Semitones from an item's key to a level's key, the short way round. */
  offset(song, item) { let d = (((song.key - item.key) % 12) + 12) % 12; return d > 6 ? d - 12 : d; },
  shiftNotes(ns, d) { return ns.map((n) => ({ ...n, p: clamp(n.p + d, 0, 127) })); },

  /* A level pattern's content by part, in the level's key. */
  capture(p, song) {
    const steps = p.bars * 16, parts = {}, origins = {};
    song.tracks.forEach((t) => {
      if (t.type === 'drum') {
        const g = p.drums[t.id] || {}, d = {};
        DRUM_VOICES.forEach((v) => { d[v.id] = (g[v.id] || []).slice(0, steps); while (d[v.id].length < steps) d[v.id].push(0); });
        parts[t.part] = { drums: d };
      } else parts[t.part] = { notes: (p.notes[t.id] || []).map((n) => ({ s: n.s, l: n.l, p: n.p, v: n.v })) };
      const o = p.origins && p.origins[t.id];
      if (o) origins[t.part] = { ...o };
    });
    return { bars: p.bars, kind: this.kindOf(p), parts, origins };
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
    Object.keys(c.parts).forEach((k) => (parts[k] = this.hash([c.parts[k], c.origins[k] || null])));
    return { m: this.hash([c.bars, c.kind]), parts };
  },
  same(a, b) { return JSON.stringify(a) === JSON.stringify(b); },

  /* What a level's copy of an item should be, by part, in the level's key. */
  materialize(item, song) {
    const d = this.offset(song, item), steps = item.bars * 16, parts = {}, origins = {};
    song.tracks.forEach((t) => {
      const src = item.parts[t.part];
      if (t.type === 'drum') {
        const g = (src && src.drums) || {}, out = {};
        DRUM_VOICES.forEach((v) => { out[v.id] = (g[v.id] || []).slice(0, steps); while (out[v.id].length < steps) out[v.id].push(0); });
        parts[t.part] = { drums: out };
      } else parts[t.part] = { notes: this.shiftNotes((src && src.notes) || [], d) };
      if (item.origins && item.origins[t.part]) origins[t.part] = { ...item.origins[t.part] };
    });
    return { bars: item.bars, kind: item.kind, parts, origins };
  },

  /* Write captured level content into a level pattern. */
  apply(p, song, c) {
    p.bars = c.bars;
    p.kind = c.kind === 'sting' ? 'sting' : 'loop';
    p.drums = {}; p.notes = {}; p.origins = {};
    song.tracks.forEach((t) => {
      const part = c.parts[t.part];
      if (t.type === 'drum') p.drums[t.id] = clone((part && part.drums) || {});
      else p.notes[t.id] = clone((part && part.notes) || []);
      if (c.origins[t.part]) p.origins[t.id] = { ...c.origins[t.part] };
    });
    ensurePattern(p, song);
  },

  /* Write the edited parts of a level copy back into its item. Other parts stay as they are. */
  store(item, c, song, partKeys, meta) {
    const d = -this.offset(song, item);
    if (meta) { item.bars = c.bars; item.kind = c.kind; }
    item.origins = item.origins || {};
    partKeys.forEach((k) => {
      const part = c.parts[k];
      item.parts[k] = part.drums ? { drums: clone(part.drums) } : { notes: this.shiftNotes(part.notes, d) };
      if (c.origins[k]) item.origins[k] = { ...c.origins[k] }; else delete item.origins[k];
    });
  },

  /* A new library item from a level pattern (written in the level's key). */
  create(p, song, name) {
    const c = this.capture(p, song);
    const item = { id: uid(), name: this.uniqueName(name || p.name), kind: c.kind, bars: c.bars, key: song.key, scale: song.scale, parts: {}, origins: {} };
    Object.entries(c.parts).forEach(([k, part]) => (item.parts[k] = clone(part)));
    item.origins = clone(c.origins);
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
    P.scores.forEach((s) => this.ensureParts(s));
    // 1. new patterns join the library; links to deleted items become own versions
    P.scores.forEach((s) => s.patterns.forEach((p) => {
      if (p.lib === undefined) {
        const item = this.create(p, s);
        p.lib = item.id; p.from = null; p.libSig = this.sig(this.capture(p, s));
      } else if (p.lib && !this.find(p.lib)) { p.lib = null; p.from = null; delete p.libSig; }
      if (p.lib === null && p.from && !this.find(p.from)) p.from = null;
    }));
    // 2. edited parts of linked copies write back to their item. A part with no fingerprint yet
    //    (a track added since the last sync) isn't an edit: it takes the library's version below.
    P.scores.forEach((s) => s.patterns.forEach((p) => {
      if (!p.lib || !p.libSig || p.libSig === 'pull') return;
      const c = this.capture(p, s), sg = this.sig(c), old = p.libSig;
      const edited = Object.keys(sg.parts).filter((k) => old.parts[k] !== undefined && old.parts[k] !== sg.parts[k]);
      const meta = sg.m !== old.m;
      if (edited.length || meta) this.store(this.of(p), c, s, edited, meta);
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
    ensurePattern(p, song);
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
      if (item.kind === 'melody') Object.keys(p.origins || {}).forEach((k) => { if (p.origins[k].theme === item.id) delete p.origins[k]; });
    }));
    this.items().splice(this.items().indexOf(item), 1);
  },

  /* ----- loading older projects ----- */
  migrate(p) {
    if (!p.library) p.library = [];
    if (p.themes) { p.themes.forEach((th) => { if (!p.library.some((x) => x.id === th.id)) p.library.push({ ...th, kind: 'melody' }); }); delete p.themes; }
    // Patterns from before the library: same-named ones in different levels get the level's name added.
    const names = {};
    p.scores.forEach((s) => s.patterns.forEach((pt) => { if (pt.lib === undefined) names[pt.name.toLowerCase()] = (names[pt.name.toLowerCase()] || 0) + 1; }));
    p.scores.forEach((s) => s.patterns.forEach((pt) => {
      if (pt.lib !== undefined) return;
      Library.ensureParts(s);
      const clash = names[pt.name.toLowerCase()] > 1 || p.library.some((x) => x.name.toLowerCase() === pt.name.toLowerCase());
      const name = clash ? `${pt.name} (${s.name.replace(/^Level \d+\s*[—-]\s*/, '')})` : pt.name;
      const prev = App.project; App.project = p;   // create() works on App.project
      try { const item = Library.create(pt, s, name); pt.lib = item.id; pt.from = null; pt.libSig = Library.sig(Library.capture(pt, s)); }
      finally { App.project = prev; }
    }));
  },
};
