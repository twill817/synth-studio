/* Claude link: lets the Synth Studio MCP server (mcp/server.js, run by Claude Code or Claude Desktop)
   work in this page. Off by default — the user switches it on with "Connect Claude" (remembered).
   The server sends {id, method, params}; we answer {id, result} or {id, error}. */

const Bridge = {
  port: 47615,
  ws: null,
  state: 'off',          // 'off' | 'waiting' (looking for the server) | 'connected'
  retryMs: 2000,
  timer: null,

  init() {
    let on = false;
    try { on = localStorage.getItem('synthstudio.claudeLink') === 'on'; } catch (e) {}
    if (location.protocol === 'file:') { UI.setBridge('unavailable'); return; }
    // Opened from the MCP server's own address: link back to that same server (whatever its port)
    // and connect straight away — that's what the page is there for.
    const servedByClaude = location.hostname === '127.0.0.1' && /^\d+$/.test(location.port) && !!document.querySelector('meta[name=build]');
    if (servedByClaude) this.port = +location.port;
    if (on || servedByClaude) this.enable(); else UI.setBridge('off');
  },
  toggle() { this.state === 'off' ? this.enable() : this.disable(); },
  enable() {
    try { localStorage.setItem('synthstudio.claudeLink', 'on'); } catch (e) {}
    this.state = 'waiting'; this.retryMs = 2000;
    UI.setBridge('waiting');
    this.connect();
  },
  disable() {
    try { localStorage.setItem('synthstudio.claudeLink', 'off'); } catch (e) {}
    this.state = 'off';
    clearTimeout(this.timer);
    if (this.ws) { const ws = this.ws; this.ws = null; ws.close(); }
    UI.setBridge('off');
  },
  connect() {
    if (this.state === 'off') return;
    let ws;
    try { ws = new WebSocket(`ws://127.0.0.1:${this.port}`); } catch (e) { return this.retry(); }
    ws.onopen = () => {
      this.ws = ws; this.state = 'connected'; this.retryMs = 2000;
      ws.send(JSON.stringify({ type: 'hello', app: 'SynthStudio', url: location.origin + location.pathname, ...this.info() }));
      UI.setBridge('connected');
    };
    ws.onmessage = async (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg.id) return;
      try {
        const fn = BridgeAPI[msg.method];
        if (!fn) throw new Error(`Synth Studio doesn't know the command “${msg.method}”. The page may be older than the MCP server — reload it.`);
        const result = await fn(msg.params || {});
        ws.send(JSON.stringify({ id: msg.id, result }));
      } catch (err) {
        ws.send(JSON.stringify({ id: msg.id, error: err.message || String(err) }));
      }
    };
    ws.onclose = (e) => {
      const was = this.ws === ws;
      if (was) this.ws = null;
      if (this.state === 'off') return;
      this.state = 'waiting';
      UI.setBridge('waiting', e.code === 4000 ? 'Another tab took over the Claude link' : '');
      this.retry();
    };
    ws.onerror = () => {}; // onclose follows; the browser logs the failed attempt itself
  },
  retry() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 1.5, 15000);
  },
  info() {
    const b = document.querySelector('meta[name=build]');
    return { build: b && b.content, game: App.project.name, score: App.song.name };
  },
  /* Keep the server's status line current (game/score names) without it having to ask. */
  notify() { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'info', ...this.info() })); },
};

/* ---------------------------------------------------------------- name lookups */
const Ref = {
  pick(list, ref, label, nameOf = (x) => x.name) {
    if (ref === undefined || ref === null || ref === '') return null;
    const s = String(ref).trim();
    if (/^\d+$/.test(s) && list[+s - 1]) return list[+s - 1];
    const low = s.toLowerCase();
    const exact = list.filter((x) => nameOf(x).toLowerCase() === low);
    if (exact.length === 1) return exact[0];
    const part = list.filter((x) => nameOf(x).toLowerCase().includes(low));
    if (part.length === 1) return part[0];
    const names = list.map((x, i) => `${i + 1}. ${nameOf(x)}`).join(', ');
    throw new Error(part.length ? `“${s}” matches more than one ${label}: ${part.map(nameOf).join(', ')}.` : `No ${label} called “${s}”. Available: ${names || 'none'}.`);
  },
  score(ref) { return Ref.pick(App.project.scores, ref, 'score') || App.song; },
  pattern(song, ref) {
    if (ref === undefined || ref === '') throw new Error('Which pattern? Give its name or letter.');
    const s = String(ref).trim();
    if (/^[A-Za-z]$/.test(s) && song.patterns[s.toUpperCase().charCodeAt(0) - 65] && !song.patterns.some((p) => p.name.toLowerCase() === s.toLowerCase()))
      return song.patterns[s.toUpperCase().charCodeAt(0) - 65];
    return Ref.pick(song.patterns, s, `pattern in “${song.name}”`);
  },
  track(song, ref) { return Ref.pick(song.tracks, ref, `track in “${song.name}”`); },
};

/* ---------------------------------------------------------------- readable music text */
const MusicText = {
  pos(s) {
    const bar = Math.floor(s / 16) + 1, beat = Math.floor((s % 16) / 4) + 1, six = (s % 4) + 1;
    return `${bar}.${beat}.${+six.toFixed(3)}`;
  },
  /* Durations as fractions of a whole note (1/4 = a beat), or bars. Lengths that aren't a whole
     number of 1/32 notes are written as sixteenths over 16, e.g. 0.9/16. */
  dur(l) {
    if (l % 16 === 0 || (l > 16 && l % 4 === 0)) return `${+(l / 16).toFixed(3)} bar${l === 16 ? '' : 's'}`;
    if (Math.abs(l * 2 - Math.round(l * 2)) > 1e-6) {
      const t = l * 1.5; // triplets: three in the space of two
      if (Math.abs(t * 2 - Math.round(t * 2)) < 1e-3) return this.dur(Math.round(t * 2) / 2) + 't';
      return `${+l.toFixed(3)}/16`;
    }
    let n = Math.round(l * 2), d = 32;
    const g = (a, b) => (b ? g(b, a % b) : a);
    const k = g(n, d);
    return `${n / k}/${d / k}`;
  },
  note(n) { return `${this.pos(n.s)} ${noteName(n.p)} ${this.dur(n.l)} v${Math.round(n.v * 127)}`; },
  drumRow(row, bars) {
    let out = '';
    for (let i = 0; i < bars * 16; i++) {
      if (i && i % 16 === 0) out += '|';
      const v = row[i] || 0;
      out += v >= 0.9 ? 'X' : v >= 0.5 ? 'x' : v > 0 ? 'o' : '.';
    }
    return out;
  },
  key(song) { return `${NOTE_NAMES[song.key]} ${SCALES[song.scale].name}`; },
};

/* ---------------------------------------------------------------- commands (read-only for now) */
const BridgeAPI = {
  getProject() {
    const p = App.project, st = p.style;
    return {
      game: p.name,
      openScore: App.song.name,
      gameStyle: {
        defaultsForNewScores: { key: `${NOTE_NAMES[st.key]} ${SCALES[st.scale].name}`, bpm: st.bpm },
        roles: st.roles.map((r) => {
          const u = App.roleUsage(r.id);
          return { name: r.name, type: r.type, sound: soundName(r), usedBy: `${u.tracks} track(s) in ${u.scores} score(s)`, customizedIn: u.tracks - u.shared };
        }),
        masterMix: st.mix,
      },
      themes: p.themes.map((t) => ({ name: t.name, key: `${NOTE_NAMES[t.key]} ${SCALES[t.scale].name}`, bars: t.bars, notes: t.notes.length, uses: Themes.usage(t.id) })),
      flavors: p.flavors.map((f) => ({ name: f.name, changes: Flavors.summary(f) })),
      scores: p.scores.map((s, i) => ({
        number: i + 1,
        name: s.name,
        open: s === App.song,
        key: MusicText.key(s), bpm: s.bpm,
        segments: s.patterns.filter((x) => x.kind !== 'sting').map((x) => `${x.name} (${x.bars} bar${x.bars > 1 ? 's' : ''})`),
        stings: s.patterns.filter((x) => x.kind === 'sting').map((x) => x.name),
        layers: s.layers.map((l) => l.name),
        levelFlavor: [...s.tracks.filter((t) => t.sound).map((t) => `${t.name} → ${soundName(t.sound)}`), ...(s.mix ? ['custom mix'] : [])],
      })),
    };
  },

  getScore({ score }) {
    const s = Ref.score(score);
    const tname = (id) => (s.tracks.find((t) => t.id === id) || {}).name;
    return {
      name: s.name, key: MusicText.key(s), bpm: s.bpm, swing: s.swing,
      mix: s.mix ? 'custom for this level' : 'game style',
      tracks: s.tracks.map((t) => ({
        name: t.name, role: (roleOf(t) || {}).name, sound: soundName(snd(t)), customForThisLevel: !!t.sound,
        layer: (s.layers.find((l) => l.id === t.layer) || {}).name, muted: t.mute, volume: +t.vol.toFixed(2),
      })),
      intensityLayers: s.layers.map((l, i) => ({ name: l.name, level: i === 0 ? 'always on' : i, tracks: s.tracks.filter((t) => t.layer === l.id).map((t) => t.name) })),
      patterns: s.patterns.map((p, i) => ({
        letter: String.fromCharCode(65 + i), name: p.name, type: p.kind === 'sting' ? 'sting (plays once)' : 'segment (loops)', bars: p.bars,
        entrySting: p.entrySting ? (s.patterns.find((q) => q.id === p.entrySting) || {}).name || null : null,
        notesPerTrack: Object.fromEntries(s.tracks.filter((t) => t.type === 'synth' && (p.notes[t.id] || []).length).map((t) => [t.name, p.notes[t.id].length])),
        drumHits: Object.fromEntries(s.tracks.filter((t) => t.type === 'drum').map((t) => [t.name, Object.values(p.drums[t.id] || {}).reduce((a, r) => a + r.filter((v) => v > 0).length, 0)])),
        linkedThemes: Object.fromEntries(Object.entries(p.origins || {}).map(([tid, o]) => [tname(tid), ((Themes.find(o.theme) || {}).name || '?') + (o.speed !== 1 ? ` (${o.speed === 2 ? 'half' : 'double'} speed)` : '') + (o.oct ? ` (${o.oct > 0 ? '+' : ''}${o.oct} oct)` : '')])),
      })),
      songArrangement: s.arrangement.map((i) => (s.patterns[i] || {}).name).filter(Boolean),
      adaptive: { changeSegmentOn: { beat: 'next beat', bar: 'next bar', end: 'end of segment' }[s.adaptive.quant] },
    };
  },

  getPattern({ score, pattern, track }) {
    const s = Ref.score(score);
    const p = Ref.pattern(s, pattern);
    const only = track ? Ref.track(s, track) : null;
    const tracks = (only ? [only] : s.tracks).map((t) => {
      if (t.type === 'drum') {
        const g = p.drums[t.id] || {};
        const lines = {};
        DRUM_VOICES.forEach((v) => { if ((g[v.id] || []).some((x) => x > 0)) lines[v.name] = MusicText.drumRow(g[v.id], p.bars); });
        return { track: t.name, type: 'drums', drums: lines };
      }
      const notes = (p.notes[t.id] || []).filter((n) => n.s < p.bars * 16).slice().sort((a, b) => a.s - b.s || a.p - b.p);
      const o = p.origins && p.origins[t.id];
      return { track: t.name, type: 'notes', linkedTheme: o ? (Themes.find(o.theme) || {}).name || null : null, notes: notes.map((n) => MusicText.note(n)) };
    });
    return { score: s.name, pattern: p.name, type: p.kind === 'sting' ? 'sting' : 'segment', bars: p.bars, key: MusicText.key(s), bpm: s.bpm, tracks };
  },
};
