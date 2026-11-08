/* App state, song model, undo/redo, persistence, samples, live playing & recording. */

const uid = () => Math.random().toString(36).slice(2, 9);
const TRACK_COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#a9e34b'];

function makeDrumTrack(name = 'Drums') {
  const voices = {};
  DRUM_VOICES.forEach((v) => (voices[v.id] = { level: 1, tune: 0, decay: 1, pan: 0, sample: null }));
  voices.chh.level = 0.7; voices.ohh.level = 0.6; voices.crash.level = 0.6; voices.cow.level = 0.6;
  return { id: uid(), name, type: 'drum', color: '#ff6b6b', kit: 'classic', voices, vol: 0.85, pan: 0, mute: false, solo: false, drive: 0, tone: 20000, rev: 0.08, dly: 0 };
}
function makeSynthTrack(preset = 'piano', name) {
  const p = SYNTH_PRESETS[preset];
  const n = App.song ? App.song.tracks.length : 0;
  return { id: uid(), name: name || p.name, type: 'synth', color: TRACK_COLORS[(n + 3) % TRACK_COLORS.length], preset, synth: { ...p },
    vol: 0.75, pan: 0, mute: false, solo: false, drive: 0, tone: 20000, rev: preset === 'pad' || preset === 'strings' ? 0.35 : 0.18, dly: preset === 'pluck' || preset === 'lead' ? 0.2 : 0.05 };
}
function makePattern(name, bars = 2) { return { id: uid(), name, bars, drums: {}, notes: {} }; }

function ensurePattern(pat, song = App.song) {
  const steps = pat.bars * 16;
  song.tracks.forEach((t) => {
    if (t.type === 'drum') {
      pat.drums[t.id] = pat.drums[t.id] || {};
      DRUM_VOICES.forEach((v) => {
        const row = pat.drums[t.id][v.id] || [];
        if (row.length < steps) for (let i = row.length; i < steps; i++) row.push(0);
        pat.drums[t.id][v.id] = row;
      });
    } else pat.notes[t.id] = pat.notes[t.id] || [];
  });
}
function ensureAll(song = App.song) { song.patterns.forEach((p) => ensurePattern(p, song)); }

function applyBeat(pat, trackId, beatName) {
  const b = BEAT_LOOPS[beatName] || {};
  const steps = pat.bars * 16;
  pat.drums[trackId] = {};
  DRUM_VOICES.forEach((v) => (pat.drums[trackId][v.id] = parseBeatString(b[v.id], steps)));
}

function demoSong() {
  const song = { version: 1, name: 'Untitled Song', bpm: 96, swing: 10, key: 9, scale: 'minor',
    tracks: [], patterns: [], arrangement: [],
    master: { vol: 0.9, low: 0, mid: 0, high: 0, comp: -14, revSize: 2.4, revLevel: 0.9, dlyDiv: '1/8 dotted', dlyFb: 0.35 } };
  App.song = song;
  const drums = makeDrumTrack(); song.tracks.push(drums);
  const bass = makeSynthTrack('bass'); song.tracks.push(bass);
  const keys = makeSynthTrack('epiano', 'Keys'); song.tracks.push(keys);
  const pad = makeSynthTrack('pad'); pad.vol = 0.5; song.tracks.push(pad);
  const lead = makeSynthTrack('pluck', 'Pluck'); lead.vol = 0.55; song.tracks.push(lead);

  const gen = (name, bars, prog) => LOOP_GENERATORS[name]({ root: song.key, scale: song.scale, bars, prog });
  const A = makePattern('Verse', 2), B = makePattern('Chorus', 2), C = makePattern('Intro', 2);
  [A, B, C].forEach((p) => { song.patterns.push(p); ensurePattern(p, song); });
  applyBeat(A, drums.id, 'Boom Bap');
  applyBeat(B, drums.id, 'Half-Time');
  B.drums[drums.id].crash[0] = 0.8;
  applyBeat(C, drums.id, 'Clear');
  C.drums[drums.id].chh = parseBeatString('x.x.x.x.x.x.x.x.', 32);
  A.notes[bass.id] = gen('Bass: syncopated', 2, 'Prog 1–6–3–7');
  A.notes[keys.id] = gen('Chords (7ths)', 2, 'Prog 1–6–3–7');
  B.notes[bass.id] = gen('Bass: octave bounce', 2, 'Prog 6–4–1–5');
  B.notes[pad.id] = gen('Chords (block)', 2, 'Prog 6–4–1–5');
  B.notes[lead.id] = gen('Arp: up-down', 2, 'Prog 6–4–1–5');
  C.notes[pad.id] = gen('Chords (block)', 2, 'Prog 1–6–3–7');
  song.arrangement = [2, 0, 0, 1, 1, 0, 1];
  return song;
}

const App = {
  song: null,
  samples: {}, // id -> {name, dataURL, buffer}
  sel: { track: null, pattern: 0 },
  mode: 'pattern',
  loopSong: true,
  metro: false,
  recording: false,
  quantize: true,
  octave: 4,
  snap: 1,
  noteLen: 2,
  vel: 0.8,
  undoStack: [],
  redoStack: [],

  init() {
    let loaded = false;
    try {
      const saved = localStorage.getItem('synthstudio.autosave');
      if (saved) { this.song = JSON.parse(saved); this.migrate(this.song); loaded = true; }
    } catch (e) { console.warn(e); }
    if (!loaded) demoSong();
    ensureAll();
    this.sel.track = (this.song.tracks.find((t) => t.type === 'synth') || this.song.tracks[0] || {}).id;
    this.sel.pattern = 0;
  },
  migrate(s) {
    s.master = Object.assign({ vol: 0.9, low: 0, mid: 0, high: 0, comp: -14, revSize: 2.4, revLevel: 0.9, dlyDiv: '1/8 dotted', dlyFb: 0.35 }, s.master || {});
    s.key = s.key ?? 0; s.scale = s.scale || 'minor'; s.swing = s.swing ?? 0;
    s.arrangement = s.arrangement || [];
    s.tracks.forEach((t) => { if (t.type === 'synth') t.synth = Object.assign({}, SYNTH_PRESETS[t.preset] || SYNTH_PRESETS.piano, t.synth); });
  },
  track(id = this.sel.track) { return this.song.tracks.find((t) => t.id === id); },
  pattern() { return this.song.patterns[this.sel.pattern]; },

  /* --- undo --- */
  pushUndo() {
    this.undoStack.push(JSON.stringify(this.song));
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
  },
  undo() { if (!this.undoStack.length) return; this.redoStack.push(JSON.stringify(this.song)); this.replaceSong(JSON.parse(this.undoStack.pop()), true); },
  redo() { if (!this.redoStack.length) return; this.undoStack.push(JSON.stringify(this.song)); this.replaceSong(JSON.parse(this.redoStack.pop()), true); },
  replaceSong(song, keepHistory) {
    this.song = song;
    this.migrate(song);
    ensureAll();
    if (!keepHistory) { this.undoStack = []; this.redoStack = []; }
    if (!this.track()) this.sel.track = (song.tracks[0] || {}).id;
    if (this.sel.pattern >= song.patterns.length) this.sel.pattern = 0;
    Engine.sync();
    UI.renderAll();
    this.changed();
  },

  /* --- persistence --- */
  _saveTimer: null,
  changed() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { localStorage.setItem('synthstudio.autosave', JSON.stringify(this.song)); } catch (e) { console.warn('Autosave failed', e); }
    }, 400);
  },
  projectBlob() {
    const used = new Set();
    this.song.tracks.forEach((t) => t.type === 'drum' && Object.values(t.voices).forEach((v) => v.sample && used.add(v.sample)));
    const samples = {};
    used.forEach((id) => { if (this.samples[id]) samples[id] = { name: this.samples[id].name, dataURL: this.samples[id].dataURL }; });
    return new Blob([JSON.stringify({ app: 'SynthStudio', version: 1, song: this.song, samples }, null, 1)], { type: 'application/json' });
  },
  async loadProject(text) {
    const data = JSON.parse(text);
    const song = data.song || data;
    if (!song.tracks || !song.patterns) throw new Error('Not a Synth Studio project');
    if (data.samples) {
      const ctx = Engine.ensure();
      for (const [id, s] of Object.entries(data.samples)) {
        const buf = await (await fetch(s.dataURL)).arrayBuffer();
        this.samples[id] = { name: s.name, dataURL: s.dataURL, buffer: await ctx.decodeAudioData(buf) };
      }
    }
    Seq.stop();
    this.sel.pattern = 0;
    this.replaceSong(song, false);
  },
  async addSample(file) {
    const ctx = Engine.ensure();
    const ab = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(ab.slice(0));
    const dataURL = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    const id = uid();
    this.samples[id] = { name: file.name, dataURL, buffer };
    return id;
  },
  sampleBuffer(id) { return this.samples[id] && this.samples[id].buffer; },
};

/* ---------- Live playing (on-screen keys, computer keys, Web MIDI) + recording ---------- */
const Live = {
  voices: {},   // midi -> voice
  rec: {},      // midi -> {pat, start}
  noteOn(midi, vel = App.vel, trackId = App.sel.track) {
    const ctx = Engine.ensure();
    const t = App.track(trackId);
    if (!t) return;
    const nodes = Engine.g.tracks[t.id];
    UI.keyDown(midi, true);
    if (t.type === 'drum') {
      const v = DRUM_VOICES[((midi % 12) + 12) % 12];
      if (v) this.drumHit(t, v.id, vel);
      return;
    }
    if (this.voices[midi]) this.voices[midi].release(ctx.currentTime);
    this.voices[midi] = synthVoice(ctx, nodes.input, t.synth, midi, vel, ctx.currentTime + 0.005);
    if (App.recording && Seq.playing) {
      const pos = Seq.posAt(ctx.currentTime);
      if (pos) this.rec[midi] = { pat: pos.pat, start: pos.local, step: pos.step, vel, track: t.id };
    }
  },
  noteOff(midi) {
    UI.keyDown(midi, false);
    const v = this.voices[midi];
    if (v) { v.release(Engine.ctx.currentTime + 0.005); delete this.voices[midi]; }
    const r = this.rec[midi];
    if (r) { delete this.rec[midi]; this.commitNote(midi, r, Seq.posAt(Engine.ctx.currentTime)); }
  },
  drumHit(t, voiceId, vel = 1) {
    const ctx = Engine.ensure();
    const nodes = Engine.g.tracks[t.id];
    nodes.input.__id = t.id;
    const vs = t.voices[voiceId];
    playDrum(Engine.g, nodes.input, voiceId, ctx.currentTime + 0.003, vel, t.kit, vs, vs.sample ? App.sampleBuffer(vs.sample) : null);
    if (App.recording && Seq.playing) {
      const pos = Seq.posAt(ctx.currentTime);
      if (!pos) return;
      const pat = App.song.patterns[pos.pat];
      const steps = pat.bars * 16;
      const s = Math.round(pos.local) % steps;
      App.pushUndo();
      ensurePattern(pat);
      pat.drums[t.id][voiceId][s] = Math.max(0.4, vel);
      App.changed();
      UI.renderBeat();
    }
  },
  commitNote(midi, r, endPos) {
    const pat = App.song.patterns[r.pat];
    if (!pat) return;
    const steps = pat.bars * 16;
    let start = r.start, len;
    if (endPos) {
      len = endPos.step - r.step + (endPos.local - Math.floor(endPos.local)) - (r.start - Math.floor(r.start));
      if (len <= 0) len += steps;
    } else len = App.snap;
    if (App.quantize) {
      const q = App.snap;
      start = Math.round(start / q) * q;
      len = Math.max(q, Math.round(len / q) * q);
    }
    start = start % steps;
    len = Math.max(0.25, Math.min(len, steps));
    App.pushUndo();
    ensurePattern(pat);
    pat.notes[r.track].push({ s: start, l: len, p: midi, v: r.vel });
    App.changed();
    Roll.draw();
  },
  finishRecording() {
    Object.keys(this.rec).forEach((m) => { const r = this.rec[m]; delete this.rec[m]; this.commitNote(+m, r, null); });
  },
  allOff() { Object.keys(this.voices).forEach((m) => this.noteOff(+m)); },
};

/* Web MIDI input */
function initMIDI() {
  if (!navigator.requestMIDIAccess) return;
  navigator.requestMIDIAccess().then((acc) => {
    const bind = () => {
      let n = 0;
      acc.inputs.forEach((inp) => {
        n++;
        inp.onmidimessage = (e) => {
          const [st, d1, d2] = e.data;
          const type = st & 0xf0;
          if (type === 0x90 && d2 > 0) Live.noteOn(d1, d2 / 127);
          else if (type === 0x80 || (type === 0x90 && d2 === 0)) Live.noteOff(d1);
        };
      });
      UI.setMidiStatus(n);
    };
    bind();
    acc.onstatechange = bind;
  }).catch(() => {});
}
