/* Themes and flavors — the game's shared musical identity.

   theme  = { id, name, key, scale, bars, notes[{s,l,p,v}], role }   (project.themes)
            A recurring melody / progression / riff, stored in its own key.
   origin = pattern.origins[trackId] = { theme, oct, speed, fit }
            Remembers which theme (and how) a track's notes in a pattern came from,
            so the theme can be re-applied after it changes, or updated from the pattern.
   flavor = { id, name, sounds: { roleId: soundFields }, mix | null } (project.flavors)
            A reusable set of level customizations (e.g. "Ice": bell keys, dark pad, big reverb). */

const Themes = {
  /* Move a pitch from one key/scale to another by scale degree, so the melody keeps its shape
     and stays in the new scale. Notes outside the source scale keep their offset from the degree below. */
  fitPitch(p, fromKey, fromScale, toKey, toScale) {
    const fs = SCALES[fromScale].steps, ts = SCALES[toScale].steps;
    let delta = ((toKey - fromKey) % 12 + 12) % 12;
    if (delta > 6) delta -= 12;                       // move the shorter way (A→G is down 2, not up 10)
    const rel = p - fromKey;                          // semitones above the source tonic (any octave)
    const oct = Math.floor(rel / 12), pc = ((rel % 12) + 12) % 12;
    let d = fs.length - 1;
    while (d > 0 && fs[d] > pc) d--;                  // degree at or below this pitch class
    const chroma = pc - fs[d];
    const td = Math.round((d * ts.length) / fs.length);
    const tStep = td >= ts.length ? ts[td - ts.length] + 12 : ts[td];
    return fromKey + delta + oct * 12 + tStep + chroma;
  },

  /* Turn a theme into notes for `bars` of a score: fit key, shift octave, change speed, tile to fill. */
  render(theme, { key, scale, bars, oct = 0, speed = 1, fit = true }) {
    const out = [];
    const len = theme.bars * 16 * speed, total = bars * 16;
    for (let off = 0; off < total; off += len) {
      theme.notes.forEach((n) => {
        const s = off + n.s * speed;
        if (s >= total) return;
        let p = fit ? this.fitPitch(n.p, theme.key, theme.scale, key, scale) : n.p;
        p = clamp(p + 12 * oct, 0, 127);
        out.push({ s, l: Math.max(0.25, Math.min(n.l * speed, total - s)), p, v: n.v });
      });
    }
    return out;
  },

  find(id) { return App.project.themes.find((t) => t.id === id); },
  usage(id) {
    let n = 0;
    App.project.scores.forEach((s) => s.patterns.forEach((p) => Object.values(p.origins || {}).forEach((o) => { if (o.theme === id) n++; })));
    return n;
  },

  /* Insert into the current pattern/track. mode: 'replace' (and remember the origin) or 'add'. */
  insert(theme, track, pat, opts, mode = 'replace') {
    const song = App.song;
    const notes = this.render(theme, { key: song.key, scale: song.scale, bars: pat.bars, ...opts });
    pat.origins = pat.origins || {};
    if (mode === 'replace') { pat.notes[track.id] = notes; pat.origins[track.id] = { theme: theme.id, ...opts }; }
    else pat.notes[track.id].push(...notes);
    return notes.length;
  },

  /* Save notes as a new theme in the score's key. Starts are shifted to the first bar used. */
  capture(name, notes, track) {
    const song = App.song;
    const minS = Math.min(...notes.map((n) => n.s));
    const off = Math.floor(minS / 16) * 16;
    const end = Math.max(...notes.map((n) => n.s + n.l)) - off;
    const theme = { id: uid(), name, key: song.key, scale: song.scale, bars: Math.max(1, Math.ceil(end / 16)),
      notes: notes.map((n) => ({ s: n.s - off, l: n.l, p: n.p, v: n.v })).sort((a, b) => a.s - b.s || a.p - b.p), role: track.role };
    App.project.themes.push(theme);
    return theme;
  },

  /* Write a pattern's (possibly transformed) notes back into its theme: undo octave and speed,
     keep one theme-length, and adopt this score's key. */
  updateFrom(theme, notes, origin) {
    const len = theme.bars * 16 * origin.speed;
    theme.notes = notes.filter((n) => n.s < len)
      .map((n) => ({ s: n.s / origin.speed, l: n.l / origin.speed, p: clamp(n.p - 12 * origin.oct, 0, 127), v: n.v }))
      .sort((a, b) => a.s - b.s || a.p - b.p);
    if (origin.fit) { theme.key = App.song.key; theme.scale = App.song.scale; }
  },

  /* Play a theme once on its role's sound (or the first instrument role). */
  preview(theme) {
    const ctx = Engine.ensure();
    const role = App.role(theme.role) || App.style.roles.find((r) => r.type === 'synth');
    if (!role) return;
    const t = App.song.tracks.find((x) => x.role === role.id && !x.sound);
    const dest = t ? Engine.g.tracks[t.id].input : Engine.g.bus;
    const step = 60 / App.song.bpm / 4, t0 = ctx.currentTime + 0.05;
    theme.notes.forEach((n) => synthVoice(ctx, dest, role.synth, n.p, n.v, t0 + n.s * step, n.l * step).release(t0 + (n.s + n.l) * step));
    return theme.bars * 16 * step;
  },
};

const Flavors = {
  /* What the current score customizes: track sounds (by role) and the mix. */
  ofScore(song = App.song) {
    const sounds = {};
    song.tracks.forEach((t) => { if (t.sound) sounds[t.role] = clone(t.sound); });
    return { sounds, mix: song.mix ? clone(song.mix) : null };
  },
  /* Does the score already sound exactly like this flavor? */
  matches(f, song = App.song) {
    const mine = this.ofScore(song);
    const roles = new Set(song.tracks.map((t) => t.role));
    const theirs = Object.fromEntries(Object.entries(f.sounds).filter(([r]) => roles.has(r)));
    return JSON.stringify(mine.sounds) === JSON.stringify(theirs) && JSON.stringify(mine.mix) === JSON.stringify(f.mix);
  },
  hasCustom(song = App.song) { return song.tracks.some((t) => t.sound) || !!song.mix; },
  summary(f) {
    const parts = Object.entries(f.sounds).map(([rid, s]) => `${(App.role(rid) || { name: '?' }).name} → ${soundName(s)}`);
    if (f.mix) parts.push('custom mix');
    return parts.join(' · ') || 'no changes (plain game style)';
  },
  /* Make the current score use this flavor: listed roles get its sounds, everything else
     goes back to the game style; the mix is the flavor's (or the style's). */
  apply(f, song = App.song) {
    song.tracks.forEach((t) => { t.sound = f.sounds[t.role] ? clone(f.sounds[t.role]) : null; });
    song.mix = f.mix ? clone(f.mix) : null;
  },
};
