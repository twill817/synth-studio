/* Claude link — production commands (MCP step 3): consistency check, loudness/peak analysis,
   and rendering the Unity package (the MCP server writes it into the Unity project). */

const Production = {
  trackEmpty(p, t) {
    return t.type === 'drum' ? !Object.values(p.drums[t.id] || {}).some((r) => r.some((v) => v > 0)) : !(p.notes[t.id] || []).length;
  },
  sameNotes(a, b) {
    const norm = (ns) => ns.map((n) => `${+n.s.toFixed(3)}:${+n.l.toFixed(3)}:${n.p}`).sort().join(',');
    return norm(a) === norm(b);
  },
  db(x) { return x > 0 ? +(20 * Math.log10(x)).toFixed(1) : -Infinity; },
  b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
};

Object.assign(BridgeAPI, {
  /* Drift and mistakes across the game. severity: problem (breaks the export/game), check (probably
     unintended), note (worth knowing). Each issue says where and how to fix it. */
  checkConsistency({ score }) {
    const P = App.project, st = P.style, issues = [];
    const add = (severity, where, message, fix) => issues.push({ severity, where, message, ...(fix ? { fix } : {}) });
    const scores = score ? [Ref.score(score)] : P.scores;

    if (!score) {
      st.roles.forEach((r) => { if (!App.roleUsage(r.id).tracks) add('note', `Game style › ${r.name}`, 'Role isn\'t used by any score.', 'Use it (add_track) or remove it (manage_role).'); });
      P.themes.forEach((t) => {
        const used = P.scores.filter((s) => s.patterns.some((p) => Object.values(p.origins || {}).some((o) => o.theme === t.id)));
        if (!used.length) add('note', `Theme › ${t.name}`, 'Theme isn\'t used in any level.', 'insert_theme it somewhere, or ignore.');
        else if (used.length < P.scores.length) add('note', `Theme › ${t.name}`, `Used in ${used.map((s) => s.name).join(', ')} but not in ${P.scores.filter((s) => !used.includes(s)).map((s) => s.name).join(', ')}.`, 'Hearing the main theme in every level helps them feel like one game.');
      });
    }

    scores.forEach((s) => {
      const W = s.name;
      const segs = s.patterns.filter((p) => p.kind !== 'sting'), stings = s.patterns.filter((p) => p.kind === 'sting');
      const scale = SCALES[s.scale].steps.map((x) => (x + s.key) % 12);
      if (!segs.length) add('problem', W, 'No segments — the Unity export needs at least one looping segment.', 'add_pattern, or set_pattern kind "segment".');
      if (s.key !== st.key || s.scale !== st.scale) add('note', W, `In ${MusicText.key(s)}; the game style default is ${NOTE_NAMES[st.key]} ${SCALES[st.scale].name}.`);
      if (Math.abs(s.bpm - st.bpm) > 30) add('check', W, `${s.bpm} BPM is far from the style's ${st.bpm} BPM.`, 'Intended? Tempo is a big part of a level\'s feel.');
      if (s.layers.length < 2) add('note', W, 'Only one intensity layer — SetIntensity will have no effect in the game.', 'set_layers to split tracks into Base / Rhythm / Intensity.');
      s.layers.forEach((l) => { if (!s.tracks.some((t) => t.layer === l.id)) add('check', `${W} › layer ${l.name}`, 'Layer has no tracks — raising intensity into it adds nothing.', 'set_layers assign, or remove the layer.'); });
      s.tracks.filter((t) => t.mute).forEach((t) => add('check', `${W} › ${t.name}`, 'Track is muted, so it\'s left out of every export.', 'set_track mute false if that isn\'t intended.'));
      const custom = s.tracks.filter((t) => t.sound);
      if (custom.length || s.mix) add('note', W, `Level flavor: ${[...custom.map((t) => `${t.name} → ${soundName(t.sound)}`), ...(s.mix ? ['own mix'] : [])].join(', ')}.`);

      segs.forEach((p) => {
        const where = `${W} › ${p.name}`;
        if (s.tracks.every((t) => Production.trackEmpty(p, t))) { add('problem', where, 'Segment is empty (no notes or drums).', 'Write something, or delete_pattern.'); return; }
        s.layers.forEach((l, i) => {
          const ts = s.tracks.filter((t) => t.layer === l.id && !t.mute);
          if (i > 0 && ts.length && ts.every((t) => Production.trackEmpty(p, t))) add('note', where, `Layer “${l.name}” is silent here — raising intensity won't add anything in this segment.`);
        });
        s.tracks.filter((t) => t.type === 'synth').forEach((t) => {
          const ns = (p.notes[t.id] || []).filter((n) => n.s < p.bars * 16);
          if (ns.length < 4) return;
          const out = ns.filter((n) => !scale.includes(((n.p % 12) + 12) % 12)).length;
          if (out / ns.length > 0.15) add('check', `${where} › ${t.name}`, `${Math.round((out / ns.length) * 100)}% of notes are outside ${MusicText.key(s)}.`, 'Intended colour? Otherwise transform_notes or regenerate.');
        });
      });
      stings.forEach((p) => { if (!s.patterns.some((q) => q.entrySting === p.id)) add('note', `${W} › ⚡${p.name}`, 'Sting isn\'t the way into any segment — the game can still play it with PlaySting.'); });
      s.patterns.forEach((p) => Object.entries(p.origins || {}).forEach(([tid, o]) => {
        const th = Themes.find(o.theme), t = s.tracks.find((x) => x.id === tid);
        if (!th || !t) return;
        const expected = Themes.render(th, { key: s.key, scale: s.scale, bars: p.bars, oct: o.oct, speed: o.speed, fit: o.fit });
        if (!Production.sameNotes(expected, p.notes[tid] || [])) add('note', `${W} › ${p.name} › ${t.name}`, `Linked to theme “${th.name}” but differs from its current version (edited here, or the theme changed).`, 'reapply_theme to sync, or keep it as a deliberate variation.');
      }));
    });

    const n = (sev) => issues.filter((i) => i.severity === sev).length;
    return { checked: score ? scores[0].name : 'whole game', problems: n('problem'), checks: n('check'), notes: n('note'), issues };
  },

  /* Loudness (LUFS, all layers on) and peaks per segment and sting — before export normalization. */
  async analyze({ score }) {
    const scores = score ? [Ref.score(score)] : App.project.scores;
    const sr = 44100, out = [];
    for (const s of scores) {
      const rows = [];
      for (const [i, p] of s.patterns.entries()) {
        let chs;
        if (p.kind === 'sting') chs = (await UnityExport.renderSting(s, i, sr)).chs;
        else chs = (await UnityExport.renderLoop(s, i, (t) => !t.mute, sr)).chs;
        const lufs = await UnityExport.lufs(chs, sr);
        rows.push({ pattern: p.name, type: p.kind === 'sting' ? 'sting' : 'segment', lufs: isFinite(lufs) ? +lufs.toFixed(1) : null, peakDbfs: Production.db(UnityExport.peak(chs)) });
      }
      const segs = rows.filter((r) => r.type === 'segment' && r.lufs !== null);
      const loud = segs.length ? segs.reduce((a, b) => (b.lufs > a.lufs ? b : a)) : null;
      const quiet = segs.length ? segs.reduce((a, b) => (b.lufs < a.lufs ? b : a)) : null;
      out.push({
        score: s.name, patterns: rows,
        loudestSegment: loud && `${loud.pattern} (${loud.lufs} LUFS)`,
        dynamicRange: loud && quiet && loud !== quiet ? `${quiet.pattern} is ${(loud.lufs - quiet.lufs).toFixed(1)} dB quieter than ${loud.pattern}` : null,
        clipping: rows.filter((r) => r.peakDbfs > -0.1).map((r) => r.pattern),
      });
    }
    const louds = out.map((o) => o.patterns.filter((r) => r.type === 'segment' && r.lufs !== null).reduce((a, r) => Math.max(a, r.lufs), -Infinity)).filter(isFinite);
    return {
      scores: out,
      acrossLevels: louds.length > 1 ? `Loudest segments differ by ${(Math.max(...louds) - Math.min(...louds)).toFixed(1)} dB across levels before export; the Unity export matches each level's loudest segment to the target, keeping each level's own quiet/loud contrast.` : undefined,
    };
  },

  /* Render the Unity package and hand the files to the MCP server (which writes them). */
  async renderUnity({ scope = 'score', score, targetLufs = -16, sampleRate = 48000, bits = 16 }) {
    if (scope === 'score' && score) { const s = Ref.score(score); const i = App.project.scores.indexOf(s); if (i !== App.project.current) App.switchScore(i); }
    Seq.stop();
    toast('Claude is exporting for Unity — rendering…', 4000);
    const res = await UnityExport.run({ scope, targetLufs: targetLufs === null ? null : +targetLufs, sampleRate: +sampleRate, bits: +bits }, () => {});
    return {
      root: res.root,
      hasScript: res.hasScript,
      scores: res.scores.map((s) => ({ folder: s.folder, score: s.manifest.score, loudness: s.manifest.loudness, segments: s.manifest.segments.map((x) => x.name), stings: s.manifest.stings.map((x) => x.name) })),
      files: res.entries.map((e) => ({ path: e.path, data: Production.b64(e.data) })),
    };
  },
});
