/* Claude link — editing commands (MCP step 2).

   Every command runs inside edit(): one Undo step, all-or-nothing (if anything in the request is
   invalid, the project is restored and nothing changes), and the app then shows what changed —
   it opens the score, pattern and track that were edited. Style-level changes report their impact. */

/* ---------------------------------------------------------------- parsing readable music */
const MusicParse = {
  note(str) {
    const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(String(str).trim());
    if (!m) throw new Error(`“${str}” isn't a note name (use e.g. A4, C#5, Bb3).`);
    const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0);
    const midi = 12 * (+m[3] + 1) + pc;
    if (midi < 12 || midi > 120) throw new Error(`${str} is outside the playable range (C0–C9).`);
    return midi;
  },
  /* "bar.beat.16th" (1-based); the 16th may have a fraction: 1.1.1.5 = half a 16th later. */
  pos(str) {
    const parts = String(str).trim().split('.');
    if (parts.length < 3 || parts.length > 4 || parts.some((x) => x === '' || isNaN(+x))) throw new Error(`“${str}” isn't a position (use bar.beat.16th, e.g. 2.3.1).`);
    const bar = +parts[0], beat = +parts[1], six = +(parts.length === 4 ? `${parts[2]}.${parts[3]}` : parts[2]);
    if (bar < 1 || beat < 1 || beat > 4 || six < 1 || six >= 5) throw new Error(`“${str}”: bar ≥ 1, beat 1–4, sixteenth 1–4.`);
    return (bar - 1) * 16 + (beat - 1) * 4 + (six - 1);
  },
  /* "1/4", "3/16", "0.9/16", "1 bar", "2 bars", "1.5 bars"; a trailing "." dots it, "t" makes a triplet. */
  dur(str) {
    let s = String(str).trim().toLowerCase(), k = 1;
    if (s.endsWith('.')) { k = 1.5; s = s.slice(0, -1); } else if (s.endsWith('t')) { k = 2 / 3; s = s.slice(0, -1); }
    let m = /^(\d+(?:\.\d+)?)\s*bars?$/.exec(s);
    if (m) return +m[1] * 16 * k;
    m = /^(\d+(?:\.\d+)?)\/(\d+)$/.exec(s);
    if (m && +m[2] > 0) return (+m[1] / +m[2]) * 16 * k;
    throw new Error(`“${str}” isn't a duration (use 1/4, 1/8, 3/16, 1/4., 1/8t, 1 bar…).`);
  },
  /* One note per line (or separated by commas/semicolons):
       "1.1.1 A4 1/4 v100"   or a chord   "1.1.1 [A3 C4 E4] 1/2 v90"   — velocity optional (default 100). */
  notes(text) {
    const out = [], errors = [];
    String(text).split(/[\n;,]+/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
      try {
        const m = /^(\S+)\s+(\[[^\]]+\]|\S+)\s+(\S+(?:\s+bars?)?)(?:\s+v(\d{1,3}))?$/i.exec(line);
        if (!m) throw new Error('expected “bar.beat.16th NOTE duration [vVELOCITY]”');
        const s = this.pos(m[1]), l = this.dur(m[3]);
        const v = m[4] !== undefined ? clamp(+m[4], 1, 127) / 127 : 100 / 127;
        const pitches = m[2].startsWith('[') ? m[2].slice(1, -1).trim().split(/\s+/) : [m[2]];
        pitches.forEach((p) => out.push({ s, l, p: this.note(p), v }));
      } catch (e) { errors.push(`line ${i + 1} “${line}”: ${e.message}`); }
    });
    if (errors.length) throw new Error('Nothing was changed. ' + errors.join(' | '));
    return out;
  },
  drumVoice(name) {
    const n = String(name).trim().toLowerCase().replace(/[-_]/g, ' ');
    const alias = { hh: 'chh', hat: 'chh', hihat: 'chh', 'hi hat': 'chh', 'closed hihat': 'chh', 'open hihat': 'ohh', tom: 'ltom', rim: 'rim', cymbal: 'crash' };
    const v = DRUM_VOICES.find((d) => d.id === n || d.name.toLowerCase() === n || d.id === alias[n]);
    if (!v) throw new Error(`No drum called “${name}”. Drums: ${DRUM_VOICES.map((d) => d.name).join(', ')}.`);
    return v.id;
  },
  /* "X...x...|..o." → per-step velocities, tiled to `steps`. X accent, x hit, o ghost, . rest. */
  drumLine(str, steps) {
    const s = String(str).replace(/[|\s]/g, '');
    if (!s.length || /[^Xxo.\-]/.test(s)) throw new Error(`“${str}” — use X (accent), x (hit), o (ghost), . (rest).`);
    return parseBeatString(s.replace(/-/g, '.'), steps);
  },
};

/* Friendly synth parameter names → internal keys, with ranges. */
const SYNTH_PARAMS = {
  wave1: ['o1', WAVES], wave2: ['o2', WAVES], osc2_pitch: ['o2semi', -24, 24], detune: ['detune', 0, 50], osc_mix: ['mix', 0, 1],
  octave: ['oct', -2, 2], attack: ['a', 0.001, 3], decay: ['d', 0.01, 4], sustain: ['s', 0, 1], release: ['r', 0.01, 4],
  cutoff: ['cut', 40, 18000], resonance: ['res', 0, 20], filter_env: ['env', 0, 6], filter_decay: ['fdec', 0.01, 2],
  vibrato_rate: ['lfoRate', 0.1, 12], vibrato_depth: ['lfoDepth', 0, 50], level: ['gain', 0, 1.6],
};
const MIX_PARAMS = {
  volume: ['vol', 0, 1.5], eq_low: ['low', -12, 12], eq_mid: ['mid', -12, 12], eq_high: ['high', -12, 12], compressor: ['comp', -40, 0],
  reverb_size: ['revSize', 0.3, 6], reverb_return: ['revLevel', 0, 1.5], delay_time: ['dlyDiv', Object.keys(DELAY_DIVS)], delay_feedback: ['dlyFb', 0, 0.9],
};
const TRACK_PARAMS = { volume: ['vol', 0, 1.2], pan: ['pan', -1, 1], drive: ['drive', 0, 1], tone: ['tone', 200, 20000], reverb: ['rev', 0, 1], delay: ['dly', 0, 1] };
function applyParams(target, values, table, label) {
  const changed = [];
  Object.entries(values || {}).forEach(([k, v]) => {
    const spec = table[k];
    if (!spec) throw new Error(`Unknown ${label} setting “${k}”. Available: ${Object.keys(table).join(', ')}.`);
    const [key, a, b] = spec;
    if (Array.isArray(a)) {
      if (!a.includes(v)) throw new Error(`${k} must be one of: ${a.join(', ')}.`);
      target[key] = v;
    } else {
      if (typeof v !== 'number' || isNaN(v)) throw new Error(`${k} must be a number (${a}–${b}).`);
      target[key] = clamp(v, a, b);
    }
    changed.push(`${k}=${target[key]}`);
  });
  return changed;
}

/* ---------------------------------------------------------------- the edit wrapper */
const Edit = {
  /* Run fn(score) as one undoable, all-or-nothing change, then show it in the app. */
  run(scoreRef, fn, show = {}) {
    const s = Ref.score(scoreRef);
    App.pushUndo();
    let result;
    try { result = fn(s); }
    catch (err) {
      App.replaceProject(JSON.parse(App.undoStack.pop()), true); // restore exactly; nothing changed
      throw err;
    }
    const i = App.project.scores.indexOf(s);
    if (i >= 0 && i !== App.project.current) App.switchScore(i);
    if (show.pattern) { const k = s.patterns.indexOf(show.pattern); if (k >= 0) App.sel.pattern = k; }
    if (show.track && s.tracks.includes(show.track)) { App.sel.track = show.track.id; App.sel.role = null; if (show.track.type === 'drum') UI.beatTrackId = show.track.id; }
    ensureAll(s);
    // Linked library patterns: an edit here also changes every other level that links the pattern.
    const rewrote = Library.sync();
    if (rewrote.length) {
      const note = `Library: this pattern is linked, so it also changed in ${rewrote.join(', ')}.`;
      if (typeof result === 'string') result += ' ' + note;
      else if (result && typeof result === 'object') result.alsoChangedInOtherLevels = rewrote;
    }
    Engine.sync(); Engine.master();
    UI.renderAll();
    if (show.view) UI.showView(show.view);
    App.changed();
    return result;
  },
  synthTrack(s, ref) {
    const t = Ref.track(s, ref);
    if (!t) throw new Error('Which track? Give its name.');
    if (t.type !== 'synth') throw new Error(`“${t.name}” is a drum track — use write_drums.`);
    return t;
  },
  drumTrack(s, ref) {
    const t = ref ? Ref.track(s, ref) : s.tracks.find((x) => x.type === 'drum');
    if (!t) throw new Error(`“${s.name}” has no drum track. Add one with add_track (a drum role).`);
    if (t.type !== 'drum') throw new Error(`“${t.name}” isn't a drum track.`);
    return t;
  },
  /* Which tracks, in which scores, a role change reaches — and which keep their own sound. */
  roleImpact(role) {
    const reached = [], kept = [];
    App.project.scores.forEach((s) => s.tracks.forEach((t) => {
      if (t.role !== role.id) return;
      (t.sound ? kept : reached).push(`${s.name} › ${t.name}`);
    }));
    return { changesGameStyleRole: role.name, nowPlayedBy: reached, notAffectedCustomizedForTheirLevel: kept };
  },
  shortest(delta) { let d = ((delta % 12) + 12) % 12; return d > 6 ? d - 12 : d; },
  /* "A", "C#", "Bb", "f#" → pitch class 0–11 */
  key(k) {
    const s = String(k).trim();
    const i = NOTE_NAMES.findIndex((n) => n.toLowerCase() === s.toLowerCase());
    return i >= 0 ? i : MusicParse.note(s.charAt(0).toUpperCase() + s.slice(1) + '4') % 12;
  },
};

/* ---------------------------------------------------------------- commands */
Object.assign(BridgeAPI, {
  /* ===== composing ===== */
  writeNotes({ score, pattern, track, notes, mode = 'replace' }) {
    return Edit.run(score, (s) => {
      const p = Ref.pattern(s, pattern), t = Edit.synthTrack(s, track);
      const parsed = MusicParse.notes(notes);
      const len = p.bars * 16;
      const kept = parsed.filter((n) => n.s < len).map((n) => ({ ...n, l: Math.min(n.l, len - n.s) }));
      const dropped = parsed.length - kept.length;
      ensurePattern(p, s);
      if (mode === 'add') p.notes[t.id].push(...kept);
      else { p.notes[t.id] = kept; delete p.origins[t.id]; }
      Edit._show = { pattern: p, track: t };
      return `${mode === 'add' ? 'Added' : 'Wrote'} ${kept.length} note(s) to ${s.name} › ${p.name} › ${t.name}` +
        (dropped ? `; ${dropped} note(s) past the pattern's ${p.bars} bar(s) were left out` : '') +
        (mode !== 'add' ? '. (Any link to a theme on this track was removed.)' : '.');
    }, Edit.consumeShow('roll'));
  },

  writeDrums({ score, pattern, track, drums, preset, mode = 'replace' }) {
    return Edit.run(score, (s) => {
      const p = Ref.pattern(s, pattern), t = Edit.drumTrack(s, track);
      const steps = p.bars * 16;
      ensurePattern(p, s);
      const lines = [];
      if (preset) {
        const name = Object.keys(BEAT_LOOPS).find((k) => k.toLowerCase() === String(preset).toLowerCase());
        if (!name) throw new Error(`No preset beat “${preset}”. Presets: ${Object.keys(BEAT_LOOPS).join(', ')}.`);
        applyBeat(p, t.id, name);
        lines.push(`preset “${name}”`);
      }
      if (drums && Object.keys(drums).length) {
        const parsed = Object.entries(drums).map(([v, line]) => [MusicParse.drumVoice(v), MusicParse.drumLine(line, steps)]);
        if (mode === 'replace' && !preset) DRUM_VOICES.forEach((v) => (p.drums[t.id][v.id] = new Array(steps).fill(0)));
        parsed.forEach(([v, row]) => { p.drums[t.id][v] = row; lines.push(DRUM_VOICES.find((d) => d.id === v).name); });
      }
      if (!lines.length) throw new Error('Give drum lines (e.g. {"Kick": "X...x..."}) or a preset beat name.');
      Edit._show = { pattern: p, track: t };
      return `Set ${lines.join(', ')} in ${s.name} › ${p.name} › ${t.name} (${p.bars} bar${p.bars > 1 ? 's' : ''}).`;
    }, Edit.consumeShow('beat'));
  },

  generatePart({ score, pattern, track, generator, progression }) {
    return Edit.run(score, (s) => {
      const p = Ref.pattern(s, pattern), t = Edit.synthTrack(s, track);
      const g = Object.keys(LOOP_GENERATORS).find((k) => k.toLowerCase() === String(generator).toLowerCase());
      if (!g) throw new Error(`No generator “${generator}”. Generators: ${Object.keys(LOOP_GENERATORS).join(', ')}.`);
      const prog = progression ? Object.keys(PROGRESSIONS).find((k) => k.toLowerCase().replace(/\s/g, '') === String(progression).toLowerCase().replace(/\s/g, '')) : 'Prog 1–5–6–4';
      if (!prog) throw new Error(`No progression “${progression}”. Progressions: ${Object.keys(PROGRESSIONS).join(', ')}.`);
      ensurePattern(p, s);
      p.notes[t.id] = LOOP_GENERATORS[g]({ root: s.key, scale: s.scale, bars: p.bars, prog });
      delete p.origins[t.id];
      Edit._show = { pattern: p, track: t };
      return `Generated “${g}” (${prog}) in ${MusicText.key(s)}: ${p.notes[t.id].length} notes in ${s.name} › ${p.name} › ${t.name}.`;
    }, Edit.consumeShow('roll'));
  },

  transformNotes({ score, pattern, track, transpose = 0, octave = 0, quantize, velocity }) {
    return Edit.run(score, (s) => {
      const p = Ref.pattern(s, pattern), t = Edit.synthTrack(s, track);
      const ns = p.notes[t.id] || [];
      if (!ns.length) throw new Error(`${p.name} › ${t.name} has no notes.`);
      const q = quantize ? MusicParse.dur(quantize) : 0;
      ns.forEach((n) => {
        n.p = clamp(n.p + transpose + 12 * octave, 12, 120);
        if (q) { n.s = Math.round(n.s / q) * q; n.l = Math.max(q, Math.round(n.l / q) * q); }
        if (velocity) n.v = clamp(n.v * velocity, 1 / 127, 1);
      });
      Edit._show = { pattern: p, track: t };
      const did = [transpose && `transposed ${transpose > 0 ? '+' : ''}${transpose} st`, octave && `${octave > 0 ? '+' : ''}${octave} oct`, q && `quantized to ${quantize}`, velocity && `velocity ×${velocity}`].filter(Boolean);
      if (!did.length) throw new Error('Nothing to do: give transpose, octave, quantize and/or velocity.');
      return `${did.join(', ')} — ${ns.length} notes in ${s.name} › ${p.name} › ${t.name}.`;
    }, Edit.consumeShow('roll'));
  },

  insertTheme({ score, pattern, track, theme, fit = true, octave = 0, speed = 1, mode = 'replace' }) {
    return Edit.run(score, (s) => {
      const p = Ref.pattern(s, pattern), t = Edit.synthTrack(s, track);
      const th = Ref.pick(Library.melodies(), theme, 'theme (library melody)');
      if (!th) throw new Error('Which theme?');
      if (![0.5, 1, 2].includes(speed)) throw new Error('speed must be 0.5 (double speed), 1, or 2 (half speed).');
      ensurePattern(p, s);
      const n = Themes.insert(th, t, p, { oct: clamp(Math.round(octave), -2, 2), speed, fit }, mode);
      Edit._show = { pattern: p, track: t };
      return `${mode === 'add' ? 'Added' : 'Inserted'} theme “${th.name}” (${n} notes)${fit ? ` fitted to ${MusicText.key(s)}` : ''} in ${s.name} › ${p.name} › ${t.name}` +
        (mode === 'add' ? '.' : ' — linked, so reapply_theme can refresh it later.');
    }, Edit.consumeShow('roll'));
  },

  saveTheme({ score, pattern, track, name }) {
    return Edit.run(score, (s) => {
      const p = Ref.pattern(s, pattern), t = Edit.synthTrack(s, track);
      const ns = p.notes[t.id] || [];
      if (!ns.length) throw new Error(`${p.name} › ${t.name} has no notes to save.`);
      if (Library.items().some((x) => x.name.toLowerCase() === String(name).toLowerCase())) throw new Error(`The library already has an item called “${name}”.`);
      const th = Themes.capture(name, ns, t);
      p.origins[t.id] = { theme: th.id, oct: 0, speed: 1, fit: true };
      return `Saved theme “${th.name}” in ${MusicText.key(s)} (${th.bars} bar${th.bars > 1 ? 's' : ''}, ${th.notes.length} notes). This track is now linked to it.`;
    });
  },

  /* Refresh every linked use of a theme (after it changed) — keeps all levels consistent. */
  reapplyTheme({ theme, score }) {
    const th = Ref.pick(Library.melodies(), theme, 'theme (library melody)');
    if (!th) throw new Error('Which theme?');
    const only = score ? Ref.score(score) : null;
    return Edit.run(only ? only.name : undefined, () => {
      const done = [];
      App.project.scores.forEach((s) => {
        if (only && s !== only) return;
        s.patterns.forEach((p) => Object.entries(p.origins || {}).forEach(([tid, o]) => {
          if (o.theme !== th.id) return;
          const t = s.tracks.find((x) => x.id === tid);
          if (!t) return;
          p.notes[tid] = Themes.render(th, { key: s.key, scale: s.scale, bars: p.bars, oct: o.oct, speed: o.speed, fit: o.fit });
          done.push(`${s.name} › ${p.name} › ${t.name}`);
        }));
      });
      if (!done.length) throw new Error(`Theme “${th.name}” isn't linked anywhere${only ? ` in ${only.name}` : ''}.`);
      return { reappliedTheme: th.name, places: done };
    });
  },

  /* ===== structure ===== */
  createScore({ name, copyFrom, key, scale, bpm, flavor }) {
    if (App.project.scores.some((x) => x.name.toLowerCase() === String(name).toLowerCase())) throw new Error(`A score called “${name}” already exists.`);
    const src = copyFrom ? Ref.score(copyFrom) : null;
    App.pushUndo();
    try {
      const s = src ? duplicateScore(src, name) : makeScore(name);
      if (!src) { App.style.roles.forEach((r) => s.tracks.push(makeTrack(r))); s.patterns.push(makePattern('Main', 2)); s.arrangement = [0]; }
      if (key !== undefined) s.key = Edit.key(key);
      if (scale) { if (!SCALES[scale]) throw new Error(`Unknown scale “${scale}”. Scales: ${Object.keys(SCALES).join(', ')}.`); s.scale = scale; }
      if (bpm) s.bpm = clamp(Math.round(bpm), 40, 260);
      ensureAll(s);
      App.project.scores.push(s);
      if (flavor) { const f = Ref.pick(App.project.flavors, flavor, 'flavor'); Flavors.apply(f, s); }
      App.switchScore(App.project.scores.length - 1);
      App.changed();
      return `Created score “${s.name}” (${MusicText.key(s)}, ${s.bpm} BPM${src ? `, copied from ${src.name}` : `, ${s.tracks.length} tracks from the game style`}${flavor ? `, flavor ${flavor}` : ''}). It's open in the app.`;
    } catch (e) { App.replaceProject(JSON.parse(App.undoStack.pop()), true); throw e; }
  },

  setScore({ score, name, key, scale, bpm, swing, changeSegmentOn, transposeNotes = false }) {
    return Edit.run(score, (s) => {
      const did = [];
      if (name) { if (App.project.scores.some((x) => x !== s && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`“${name}” is taken.`); s.name = name; did.push(`renamed to ${name}`); }
      if (key !== undefined) {
        const k = Edit.key(key);
        const d = Edit.shortest(k - s.key);
        if (transposeNotes && d) s.patterns.forEach((p) => s.tracks.forEach((t) => { if (t.type === 'synth') (p.notes[t.id] || []).forEach((n) => (n.p = clamp(n.p + d, 12, 120))); }));
        s.key = k; did.push(`key ${NOTE_NAMES[k]}${transposeNotes && d ? ` (notes moved ${d > 0 ? '+' : ''}${d} st)` : ''}`);
      }
      if (scale) { if (!SCALES[scale]) throw new Error(`Unknown scale “${scale}”. Scales: ${Object.keys(SCALES).join(', ')}.`); s.scale = scale; did.push(`scale ${SCALES[scale].name}`); }
      if (bpm) { s.bpm = clamp(Math.round(bpm), 40, 260); did.push(`${s.bpm} BPM`); }
      if (swing !== undefined) { s.swing = clamp(swing, 0, 75); did.push(`swing ${s.swing}`); }
      if (changeSegmentOn) { if (!['beat', 'bar', 'end'].includes(changeSegmentOn)) throw new Error('changeSegmentOn: beat, bar or end.'); s.adaptive.quant = changeSegmentOn; did.push(`segment changes on ${changeSegmentOn}`); }
      if (!did.length) throw new Error('Nothing to change.');
      const st = App.style, drift = [];
      if (s.key !== st.key || s.scale !== st.scale) drift.push(`key differs from the game style (${NOTE_NAMES[st.key]} ${SCALES[st.scale].name})`);
      if (Math.abs(s.bpm - st.bpm) > 30) drift.push(`tempo is ${s.bpm - st.bpm > 0 ? '+' : ''}${s.bpm - st.bpm} BPM from the style default`);
      return `${s.name}: ${did.join(', ')}.` + (drift.length ? ` Note: ${drift.join('; ')} — fine for a level's own mood.` : '');
    });
  },

  addPattern({ score, name, bars = 2, kind, copyFrom }) {
    return Edit.run(score, (s) => {
      if (s.patterns.some((p) => p.name.toLowerCase() === String(name).toLowerCase())) throw new Error(`“${s.name}” already has a pattern called “${name}”.`);
      if (![1, 2, 4, 8].includes(bars)) throw new Error('bars must be 1, 2, 4 or 8.');
      let p;
      if (copyFrom) { const src = Ref.pattern(s, copyFrom); p = clone(src); p.id = uid(); p.name = name; p.lib = undefined; p.from = null; delete p.libSig; p.entrySting = null; }
      else p = makePattern(name, bars, kind === 'sting' ? 'sting' : 'loop');
      if (kind) p.kind = kind === 'sting' ? 'sting' : 'loop';
      if (p.kind === 'sting') p.entrySting = null;
      s.patterns.push(p);
      ensurePattern(p, s);
      Edit._show = { pattern: p };
      return `Added ${p.kind === 'sting' ? 'sting' : 'segment'} “${p.name}” (${p.bars} bar${p.bars > 1 ? 's' : ''}) to ${s.name}${copyFrom ? `, copied from ${copyFrom}` : ''}. It’s a new library item; place it in other levels with place_pattern.`;
    }, Edit.consumeShow());
  },

  setPattern({ score, pattern, name, bars, kind, entrySting }) {
    return Edit.run(score, (s) => {
      const p = Ref.pattern(s, pattern), did = [];
      if (name) { if (s.patterns.some((x) => x !== p && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`“${name}” is taken.`); p.name = name; did.push(`renamed to ${name}`); }
      if (bars) { if (![1, 2, 4, 8].includes(bars)) throw new Error('bars must be 1, 2, 4 or 8.'); p.bars = bars; did.push(`${bars} bar${bars > 1 ? 's' : ''}`); }
      if (kind) {
        p.kind = kind === 'sting' ? 'sting' : 'loop';
        if (p.kind === 'sting') p.entrySting = null; else s.patterns.forEach((q) => { if (q.entrySting === p.id) q.entrySting = null; });
        did.push(p.kind === 'sting' ? 'now a sting' : 'now a segment');
      }
      if (entrySting !== undefined) {
        if (!entrySting) { p.entrySting = null; did.push('no entry sting'); }
        else {
          const st = Ref.pattern(s, entrySting);
          if (st.kind !== 'sting') throw new Error(`“${st.name}” is a segment, not a sting — set its kind to sting first.`);
          if (p.kind === 'sting') throw new Error('A sting can\'t have an entry sting.');
          p.entrySting = st.id; did.push(`entered through ⚡${st.name}`);
        }
      }
      if (!did.length) throw new Error('Nothing to change.');
      Edit._show = { pattern: p };
      return `${s.name} › ${p.name}: ${did.join(', ')}.`;
    }, Edit.consumeShow());
  },

  deletePattern({ score, pattern }) {
    return Edit.run(score, (s) => {
      if (s.patterns.length <= 1) throw new Error('A score needs at least one pattern.');
      const p = Ref.pattern(s, pattern), k = s.patterns.indexOf(p);
      const uses = s.arrangement.filter((i) => i === k).length;
      s.patterns.splice(k, 1);
      s.arrangement = s.arrangement.filter((i) => i !== k).map((i) => (i > k ? i - 1 : i));
      s.patterns.forEach((q) => { if (q.entrySting === p.id) q.entrySting = null; });
      if (App.sel.pattern >= s.patterns.length) App.sel.pattern = s.patterns.length - 1;
      const item = Library.find(p.lib || p.from);
      return `Removed “${p.name}” from ${s.name}${uses ? ` (and ${uses} block(s) from the export playthrough)` : ''}.` + (item ? ` “${item.name}” is still in the library.` : '');
    });
  },

  /* ===== library ===== */
  placePattern({ score, item, name, entrySting }) {
    return Edit.run(score, (s) => {
      const it = Ref.pick(Library.patterns(), item, 'library pattern');
      if (!it) throw new Error('Which library item?');
      if (Library.placedIn(it, s)) throw new Error(`“${it.name}” is already in ${s.name}.`);
      const p = Library.place(it, s, name);
      if (entrySting) {
        const st = Ref.pattern(s, entrySting);
        if (st.kind !== 'sting' || p.kind === 'sting') throw new Error('entry_sting must be a sting, and only a segment can have one.');
        p.entrySting = st.id;
      }
      Edit._show = { pattern: p };
      const d = Library.offset(s, it);
      return `Placed “${it.name}” in ${s.name} as “${p.name}” (${it.kind}, ${it.bars} bar${it.bars > 1 ? 's' : ''}, linked)` +
        (d ? `, shifted ${d > 0 ? '+' : ''}${d} semitones from ${NOTE_NAMES[it.key]} ${SCALES[it.scale].name} to ${MusicText.key(s)}` : '') +
        (it.scale !== s.scale ? `. Note: it was written in ${SCALES[it.scale].name}; this level is ${SCALES[s.scale].name}, so notes are shifted, not refitted` : '') + '.';
    }, Edit.consumeShow());
  },

  libraryItem({ action, item, score, pattern, name }) {
    if (action === 'own_version' || action === 'relink') {
      return Edit.run(score, (s) => {
        const p = Ref.pattern(s, pattern);
        Edit._show = { pattern: p };
        if (action === 'own_version') {
          if (!p.lib) throw new Error(`${s.name} › ${p.name} isn’t linked to the library.`);
          const it = Library.of(p); Library.ownVersion(p);
          return `${s.name} › ${p.name} is now this level’s own version of “${it.name}”: edits stay in ${s.name}.`;
        }
        if (!p.from || !Library.find(p.from)) throw new Error(`${s.name} › ${p.name} isn’t an own version of a library item.`);
        const it = Library.find(p.from); Library.relink(p);
        return `${s.name} › ${p.name} uses the library’s “${it.name}” again (this level’s own changes were dropped).`;
      }, Edit.consumeShow());
    }
    const it = Ref.pick(Library.items(), item, 'library item');
    if (!it) throw new Error('Which library item?');
    return Edit.run(undefined, () => {
      if (action === 'rename') {
        if (!name) throw new Error('Give the new name.');
        if (Library.items().some((x) => x !== it && x.name.toLowerCase() === String(name).toLowerCase())) throw new Error(`The library already has “${name}”.`);
        const old = it.name; it.name = name;
        return `Renamed library item “${old}” to “${it.name}” (level pattern names don’t change).`;
      }
      if (action === 'duplicate') { const c = Library.duplicateItem(it); if (name) c.name = Library.uniqueName(name, c); return `Duplicated “${it.name}” as “${c.name}” (not placed anywhere yet).`; }
      if (action === 'delete') {
        const u = it.kind === 'melody' ? [] : Library.uses(it).filter((x) => x.linked).map((x) => `${x.song.name} › ${x.pattern.name}`);
        Library.remove(it);
        return `Deleted “${it.name}” from the library.` + (u.length ? ` These keep their notes as their own version: ${u.join(', ')}.` : '');
      }
      throw new Error('action must be rename, duplicate, delete, own_version or relink.');
    });
  },

  setArrangement({ score, patterns }) {
    return Edit.run(score, (s) => {
      const idx = patterns.map((r) => s.patterns.indexOf(Ref.pattern(s, r)));
      s.arrangement = idx;
      const bars = idx.reduce((a, i) => a + s.patterns[i].bars, 0);
      return `${s.name} playthrough (for plain audio/MIDI export, Export › A playthrough): ${idx.map((i) => s.patterns[i].name).join(' → ')} (${bars} bars, ${Math.round((bars * 4 * 60) / s.bpm)} s).`;
    });
  },

  setLayers({ score, layers, assign }) {
    return Edit.run(score, (s) => {
      const did = [];
      if (layers) {
        if (!layers.length) throw new Error('Give at least one layer (the first is the always-on base).');
        const old = s.layers;
        s.layers = layers.map((n, i) => {
          const keep = old.find((l) => l.name.toLowerCase() === String(n).toLowerCase()) || (i === 0 ? old[0] : null);
          return { id: keep ? keep.id : uid(), name: n };
        });
        s.tracks.forEach((t) => { if (!s.layers.some((l) => l.id === t.layer)) t.layer = s.layers[0].id; });
        did.push(`layers (bottom → top): ${s.layers.map((l) => l.name).join(' → ')}`);
      }
      if (assign) Object.entries(assign).forEach(([tr, ln]) => {
        const t = Ref.track(s, tr), L = Ref.pick(s.layers, ln, 'layer');
        t.layer = L.id; did.push(`${t.name} → ${L.name}`);
      });
      if (!did.length) throw new Error('Give layers and/or assign.');
      Engine.layers();
      return `${s.name}: ${did.join('; ')}. Layer contents: ${s.layers.map((l) => `${l.name} [${s.tracks.filter((t) => t.layer === l.id).map((t) => t.name).join(', ') || 'empty'}]`).join(', ')}.`;
    }, { view: 'mixer' });
  },

  addTrack({ score, role, name, layer }) {
    return Edit.run(score, (s) => {
      const r = Ref.pick(App.style.roles, role, 'role in the game style');
      if (!r) throw new Error('Which role?');
      const n = s.tracks.filter((x) => x.role === r.id).length;
      const t = makeTrack(r, name || (n ? `${r.name} ${n + 1}` : r.name));
      if (layer) t.layer = Ref.pick(s.layers, layer, 'layer').id;
      s.tracks.push(t);
      Edit._show = { track: t };
      return `Added track “${t.name}” (role ${r.name}, ${soundName(r)}) to ${s.name}.`;
    }, Edit.consumeShow());
  },

  setTrack({ score, track, name, mute, solo, layer, settings }) {
    return Edit.run(score, (s) => {
      const t = Ref.track(s, track), did = [];
      if (name) { t.name = name; did.push(`renamed to ${name}`); }
      if (mute !== undefined) { t.mute = !!mute; did.push(mute ? 'muted' : 'unmuted'); }
      if (solo !== undefined) { t.solo = !!solo; did.push(solo ? 'soloed' : 'unsoloed'); }
      if (layer) { t.layer = Ref.pick(s.layers, layer, 'layer').id; did.push(`layer ${layer}`); }
      if (settings) did.push(...applyParams(t, settings, TRACK_PARAMS, 'track'));
      if (!did.length) throw new Error('Nothing to change.');
      Engine.tracksAll();
      return `${s.name} › ${t.name}: ${did.join(', ')}.`;
    }, { view: 'mixer' });
  },

  removeTrack({ score, track }) {
    return Edit.run(score, (s) => {
      if (s.tracks.length <= 1) throw new Error('A score needs at least one track.');
      const t = Ref.track(s, track);
      s.tracks = s.tracks.filter((x) => x !== t);
      s.patterns.forEach((p) => { delete p.drums[t.id]; delete p.notes[t.id]; delete p.origins[t.id]; });
      if (App.sel.track === t.id) App.sel.track = s.tracks[0].id;
      return `Removed track “${t.name}” and its notes from ${s.name}.`;
    });
  },

  /* ===== sound, style, flavors ===== */
  setSound({ score, track, role, scope, preset, kit, params }) {
    if (!['level', 'game_style'].includes(scope)) throw new Error('scope must be "level" (only this score) or "game_style" (every score sharing the role).');
    return Edit.run(score, (s) => {
      let target, where, impact = null;
      if (scope === 'level') {
        const t = Ref.track(s, track);
        if (!t) throw new Error('Which track?');
        if (!t.sound) t.sound = soundFields(roleOf(t));
        target = t.sound; where = `${s.name} › ${t.name} (custom for this level)`;
        Edit._show = { track: t };
      } else {
        const r = role ? Ref.pick(App.style.roles, role, 'role') : roleOf(Ref.track(s, track));
        if (!r) throw new Error('Which role (or a track that plays it)?');
        target = r; where = `game style role “${r.name}”`;
        impact = Edit.roleImpact(r);
      }
      const did = [];
      if (preset) {
        if (target.kit) throw new Error('That\'s a drum sound — use kit.');
        const k = Object.keys(SYNTH_PRESETS).find((x) => x === preset || SYNTH_PRESETS[x].name.toLowerCase() === String(preset).toLowerCase());
        if (!k) throw new Error(`No preset “${preset}”. Presets: ${Object.values(SYNTH_PRESETS).map((x) => x.name).join(', ')}.`);
        target.preset = k; target.synth = { ...SYNTH_PRESETS[k] }; did.push(`preset ${SYNTH_PRESETS[k].name}`);
      }
      if (kit) {
        if (!target.kit) throw new Error('That\'s an instrument — use preset.');
        const k = Object.keys(DRUM_KITS).find((x) => x === kit || DRUM_KITS[x].name.toLowerCase() === String(kit).toLowerCase());
        if (!k) throw new Error(`No kit “${kit}”. Kits: ${Object.values(DRUM_KITS).map((x) => x.name).join(', ')}.`);
        target.kit = k; did.push(`kit ${DRUM_KITS[k].name}`);
      }
      if (params) { if (target.kit) throw new Error('Drum kits have no synth parameters.'); did.push(...applyParams(target.synth, params, SYNTH_PARAMS, 'sound')); }
      if (!did.length) throw new Error('Give a preset, kit and/or params.');
      return { changed: where, settings: did, ...(impact ? { impact } : {}) };
    }, Edit.consumeShow());
  },

  soundScope({ score, track, action }) {
    return Edit.run(score, (s) => {
      const t = Ref.track(s, track), r = roleOf(t);
      Edit._show = { track: t };
      if (action === 'customize') { if (t.sound) throw new Error(`${t.name} already has its own sound here.`); t.sound = soundFields(r); return `${s.name} › ${t.name} now has its own copy of “${r.name}” — changes with scope "level" stay in this score.`; }
      if (action === 'revert') { if (!t.sound) throw new Error(`${t.name} already uses the game style.`); t.sound = null; return `${s.name} › ${t.name} is back on the game style (${r.name}: ${soundName(r)}).`; }
      if (action === 'promote') {
        if (!t.sound) throw new Error(`${t.name} has no custom sound to promote.`);
        Object.assign(r, soundFields(t.sound)); t.sound = null;
        return { promoted: `${s.name} › ${t.name}'s sound is now the game style for “${r.name}”`, impact: Edit.roleImpact(r) };
      }
      throw new Error('action must be customize, revert or promote.');
    }, Edit.consumeShow());
  },

  manageRole({ action, role, name, preset }) {
    return Edit.run(undefined, () => {
      if (action === 'add') {
        const k = preset === 'drum' ? 'drum' : Object.keys(SYNTH_PRESETS).find((x) => x === preset || SYNTH_PRESETS[x].name.toLowerCase() === String(preset || '').toLowerCase());
        if (!k) throw new Error(`Give preset: an instrument preset (${Object.values(SYNTH_PRESETS).map((x) => x.name).join(', ')}) or "drum".`);
        const r = makeRole(k, name);
        App.style.roles.push(r);
        return `Added role “${r.name}” (${soundName(r)}) to the game style. Add it to a score with add_track.`;
      }
      const r = Ref.pick(App.style.roles, role, 'role');
      if (!r) throw new Error('Which role?');
      if (action === 'rename') { if (!name) throw new Error('Give the new name.'); const old = r.name; r.name = uniqueRoleName(name); return `Renamed role “${old}” to “${r.name}”.`; }
      if (action === 'remove') {
        const u = App.roleUsage(r.id);
        if (u.tracks) throw new Error(`“${r.name}” is used by ${u.tracks} track(s) in ${u.scores} score(s); remove those tracks first.`);
        App.style.roles = App.style.roles.filter((x) => x !== r);
        return `Removed unused role “${r.name}”.`;
      }
      throw new Error('action must be add, rename or remove.');
    }, { view: 'style' });
  },

  setMix({ score, scope, values, action }) {
    return Edit.run(score, (s) => {
      if (action === 'revert') { if (!s.mix) throw new Error(`${s.name} already uses the game style mix.`); s.mix = null; return `${s.name} is back on the game style's mix.`; }
      if (action === 'promote') { if (!s.mix) throw new Error(`${s.name} has no custom mix.`); App.style.mix = clone(s.mix); s.mix = null; return { promoted: `${s.name}'s mix is now the game style mix`, affects: App.project.scores.filter((x) => !x.mix).map((x) => x.name) }; }
      if (!['level', 'game_style'].includes(scope)) throw new Error('scope must be "level" or "game_style" (or use action revert/promote).');
      let target;
      if (scope === 'level') { if (!s.mix) s.mix = clone(App.style.mix); target = s.mix; }
      else target = App.style.mix;
      const did = applyParams(target, values, MIX_PARAMS, 'mix');
      if (!did.length) throw new Error('Give values to change.');
      return scope === 'level' ? `${s.name}'s own mix: ${did.join(', ')}.`
        : { changed: `game style mix: ${did.join(', ')}`, affects: App.project.scores.filter((x) => !x.mix).map((x) => x.name), notAffectedCustomMix: App.project.scores.filter((x) => x.mix).map((x) => x.name) };
    }, { view: 'mixer' });
  },

  flavor({ score, action, flavor, name }) {
    return Edit.run(score, (s) => {
      if (action === 'apply') {
        const f = Ref.pick(App.project.flavors, flavor, 'flavor');
        if (!f) throw new Error('Which flavor?');
        Flavors.apply(f, s);
        return `${s.name} now uses the “${f.name}” flavor: ${Flavors.summary(f)}.`;
      }
      if (action === 'save') {
        if (!Flavors.hasCustom(s)) throw new Error(`${s.name} has no customizations to save.`);
        if (!name) throw new Error('Give the flavor a name.');
        const f = { id: uid(), name, ...Flavors.ofScore(s) };
        App.project.flavors.push(f);
        return `Saved flavor “${f.name}”: ${Flavors.summary(f)}.`;
      }
      throw new Error('action must be apply or save.');
    }, { view: 'style' });
  },
});

/* Commands set Edit._show inside their change; this hands it to Edit.run's "show" step afterwards. */
Edit.consumeShow = function (view) {
  const show = { view };
  Object.defineProperty(show, 'pattern', { get: () => Edit._show && Edit._show.pattern });
  Object.defineProperty(show, 'track', { get: () => Edit._show && Edit._show.track });
  Edit._show = null;
  return show;
};
