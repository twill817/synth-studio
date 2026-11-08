/* Presets: drum voices, kits, synth instruments, beat loops, melodic loop generators */

const DRUM_VOICES = [
  { id: 'kick',  name: 'Kick',       key: '1', gm: 36 },
  { id: 'snare', name: 'Snare',      key: '2', gm: 38 },
  { id: 'clap',  name: 'Clap',       key: '3', gm: 39 },
  { id: 'chh',   name: 'Closed Hat', key: '4', gm: 42 },
  { id: 'ohh',   name: 'Open Hat',   key: '5', gm: 46 },
  { id: 'ltom',  name: 'Low Tom',    key: '6', gm: 45 },
  { id: 'htom',  name: 'High Tom',   key: '7', gm: 50 },
  { id: 'rim',   name: 'Rimshot',    key: '8', gm: 37 },
  { id: 'cow',   name: 'Cowbell',    key: '9', gm: 56 },
  { id: 'crash', name: 'Crash',      key: '0', gm: 49 },
];

const DRUM_KITS = {
  classic:  { name: 'Classic Analog', kickF0: 150, kickF1: 46, kickDecay: 0.6,  kickClick: 0.25, snareTone: 185, snareDecay: 0.18, snareHP: 1400, hatHP: 7500, metallic: true,  tomMul: 1.0, lpf: 0 },
  punchy:   { name: 'Punchy Electro', kickF0: 220, kickF1: 52, kickDecay: 0.38, kickClick: 0.6,  snareTone: 220, snareDecay: 0.14, snareHP: 2200, hatHP: 9000, metallic: false, tomMul: 1.2, lpf: 0 },
  deep:     { name: 'Deep Boom',      kickF0: 120, kickF1: 38, kickDecay: 1.2,  kickClick: 0.1,  snareTone: 160, snareDecay: 0.25, snareHP: 900,  hatHP: 6500, metallic: true,  tomMul: 0.8, lpf: 0 },
  lofi:     { name: 'Lo-Fi Dusty',    kickF0: 140, kickF1: 50, kickDecay: 0.45, kickClick: 0.15, snareTone: 200, snareDecay: 0.2,  snareHP: 1000, hatHP: 5000, metallic: false, tomMul: 1.0, lpf: 3800 },
  acoustic: { name: 'Room Kit',       kickF0: 110, kickF1: 58, kickDecay: 0.35, kickClick: 0.45, snareTone: 240, snareDecay: 0.3,  snareHP: 700,  hatHP: 8000, metallic: false, tomMul: 1.1, lpf: 9000 },
};

/* Instrument presets. gm = General MIDI program used for MIDI export. */
const SYNTH_PRESETS = {
  piano:   { name: 'Piano',          o1: 'triangle', o2: 'sine',     o2semi: 12,  detune: 3,  mix: 0.35, a: 0.002, d: 1.6, s: 0.0,  r: 0.4,  cut: 2600, res: 0.5, env: 1.6, fdec: 0.7,  oct: 0,  lfoRate: 5, lfoDepth: 0,  gain: 1.0, gm: 0 },
  epiano:  { name: 'Electric Piano', o1: 'sine',     o2: 'sine',     o2semi: 24,  detune: 6,  mix: 0.18, a: 0.002, d: 1.2, s: 0.25, r: 0.5,  cut: 3200, res: 0.3, env: 1.0, fdec: 0.3,  oct: 0,  lfoRate: 4, lfoDepth: 4,  gain: 1.1, gm: 4 },
  organ:   { name: 'Organ',          o1: 'sine',     o2: 'sine',     o2semi: 12,  detune: 2,  mix: 0.45, a: 0.01,  d: 0.1, s: 1.0,  r: 0.08, cut: 6000, res: 0.2, env: 0,   fdec: 0.1,  oct: 0,  lfoRate: 6, lfoDepth: 6,  gain: 0.8, gm: 16 },
  bass:    { name: 'Synth Bass',     o1: 'sawtooth', o2: 'square',   o2semi: -12, detune: 0,  mix: 0.4,  a: 0.003, d: 0.3, s: 0.6,  r: 0.08, cut: 380,  res: 6,   env: 2.5, fdec: 0.18, oct: -1, lfoRate: 5, lfoDepth: 0,  gain: 1.7, gm: 38 },
  subbass: { name: 'Sub Bass',       o1: 'sine',     o2: 'triangle', o2semi: 12,  detune: 0,  mix: 0.15, a: 0.005, d: 0.2, s: 0.9,  r: 0.1,  cut: 900,  res: 0.2, env: 0.3, fdec: 0.1,  oct: -1, lfoRate: 5, lfoDepth: 0,  gain: 1.3, gm: 33 },
  pad:     { name: 'Warm Pad',       o1: 'sawtooth', o2: 'sawtooth', o2semi: 0,   detune: 14, mix: 0.5,  a: 0.7,   d: 1.2, s: 0.8,  r: 1.6,  cut: 1300, res: 1.0, env: 0.6, fdec: 1.5,  oct: 0,  lfoRate: 0.4, lfoDepth: 5, gain: 0.55, gm: 89 },
  strings: { name: 'Strings',        o1: 'sawtooth', o2: 'sawtooth', o2semi: 12,  detune: 9,  mix: 0.3,  a: 0.35,  d: 0.6, s: 0.85, r: 0.7,  cut: 2400, res: 0.4, env: 0.3, fdec: 0.5,  oct: 0,  lfoRate: 5.5, lfoDepth: 8, gain: 0.55, gm: 48 },
  lead:    { name: 'Square Lead',    o1: 'square',   o2: 'sawtooth', o2semi: 0,   detune: 7,  mix: 0.4,  a: 0.01,  d: 0.25, s: 0.7, r: 0.15, cut: 2200, res: 3,   env: 1.5, fdec: 0.25, oct: 0,  lfoRate: 5.5, lfoDepth: 12, gain: 0.6, gm: 80 },
  pluck:   { name: 'Pluck',          o1: 'sawtooth', o2: 'square',   o2semi: 12,  detune: 4,  mix: 0.25, a: 0.001, d: 0.28, s: 0.0, r: 0.25, cut: 500,  res: 2,   env: 4.0, fdec: 0.14, oct: 0,  lfoRate: 5, lfoDepth: 0,  gain: 0.9, gm: 45 },
  bell:    { name: 'Bell',           o1: 'sine',     o2: 'sine',     o2semi: 19,  detune: 8,  mix: 0.4,  a: 0.001, d: 2.2, s: 0.0,  r: 1.5,  cut: 8000, res: 0.2, env: 0,   fdec: 0.1,  oct: 1,  lfoRate: 5, lfoDepth: 0,  gain: 0.8, gm: 14 },
  brass:   { name: 'Synth Brass',    o1: 'sawtooth', o2: 'sawtooth', o2semi: 0,   detune: 10, mix: 0.5,  a: 0.06,  d: 0.4, s: 0.75, r: 0.25, cut: 900,  res: 1.5, env: 2.0, fdec: 0.35, oct: 0,  lfoRate: 5, lfoDepth: 4,  gain: 0.6, gm: 61 },
};

const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];

const SCALES = {
  major:      { name: 'Major',          steps: [0, 2, 4, 5, 7, 9, 11] },
  minor:      { name: 'Natural Minor',  steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian:     { name: 'Dorian',         steps: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { name: 'Mixolydian',     steps: [0, 2, 4, 5, 7, 9, 10] },
  harmminor:  { name: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  pentmaj:    { name: 'Pentatonic Major', steps: [0, 2, 4, 7, 9] },
  pentmin:    { name: 'Pentatonic Minor', steps: [0, 3, 5, 7, 10] },
  blues:      { name: 'Blues',          steps: [0, 3, 5, 6, 7, 10] },
  chromatic:  { name: 'Chromatic',      steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

/* Beat loops: one string per voice. X = accent (1.0), x = normal (0.75), o = ghost (0.4), . = rest.
   Strings may be 16 (1 bar) or 32 (2 bars) long; they are tiled to the pattern length. */
const BEAT_LOOPS = {
  'Four on the Floor': { kick: 'X...X...X...X...', clap: '....x.......x...', chh: '..x...x...x...x.', ohh: '..........o.....' },
  'Boom Bap':          { kick: 'X.....x...x.....X.....x.......x.', snare: '....X.......X.......X.......X..o', chh: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.xo' },
  'Trap':              { kick: 'X......x..x.....X.....x...x.....', snare: '........X...............X.......', chh: 'x.x.x.x.xxxxx.x.x.x.x.x.x.x.xxxx', ohh: '..............o...............o.' },
  'Rock':              { kick: 'X.......X.x.....', snare: '....X.......X...', chh: 'x.x.x.x.x.x.x.x.', crash: 'X...............' },
  'Breakbeat':         { kick: 'X.........X.....X.x.......X.....', snare: '....X..o.o..X..o....X..o.o..X...', chh: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.' },
  'Reggaeton':         { kick: 'X...X...X...X...', snare: '...x..x....x..x.', chh: 'x.x.x.x.x.x.x.x.' },
  'Bossa Nova':        { kick: 'X..x X..x X..x X..x'.replace(/ /g, ''), rim: 'x..x..x...x..x..', chh: 'xxxxxxxxxxxxxxxx' },
  'House Shuffle':     { kick: 'X...X...X...X...', clap: '....x.......x...', chh: 'o.xoo.xoo.xoo.xo', ohh: '..x...x...x...x.', rim: '.......o......o.' },
  'Funk':              { kick: 'X..x..x...x..x..', snare: '....X..o.o..X..o', chh: 'xoxoxoxoxoxoxoxo', cow: 'x.....x.........' },
  'Half-Time':         { kick: 'X.......x.....x.X.........x.....', snare: '........X...............X.......', chh: 'x...x...x...x...x...x...x...x...' },
  'Clear':             {},
};

/* ---------- Melodic loop generators ---------- */
function scaleNote(root, steps, degree, baseOct) {
  const n = steps.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return 12 * (baseOct + 1) + root + steps[idx] + 12 * oct;
}
function harmonyScale(scaleId) {
  // Chords need a 7-note scale; pentatonic/blues/chromatic fall back to major/minor.
  const s = SCALES[scaleId].steps;
  if (s.length === 7) return s;
  return s.includes(4) && !s.includes(3) ? SCALES.major.steps : SCALES.minor.steps;
}

const PROGRESSIONS = {
  'Prog 1–5–6–4':  [0, 4, 5, 3],
  'Prog 1–6–3–7':  [0, 5, 2, 6],
  'Prog 6–4–1–5':  [5, 3, 0, 4],
  'Prog 1–4–5–4':  [0, 3, 4, 3],
  'Prog 2–5–1–1':  [1, 4, 0, 0],
  'Prog 1–7–6–7':  [0, 6, 5, 6],
};

/* Each generator returns notes: [{s, l, p, v}] in 16th-step units.
   ctx = { root, scale, bars, prog } */
const LOOP_GENERATORS = {
  'Chords (block)': (c) => chordLoop(c, false, false),
  'Chords (7ths)': (c) => chordLoop(c, true, false),
  'Chords (stabs)': (c) => chordLoop(c, false, true),
  'Bass: roots': (c) => bassLoop(c, 'roots'),
  'Bass: eighths': (c) => bassLoop(c, 'eighths'),
  'Bass: octave bounce': (c) => bassLoop(c, 'octave'),
  'Bass: syncopated': (c) => bassLoop(c, 'sync'),
  'Arp: up': (c) => arpLoop(c, 'up'),
  'Arp: up-down': (c) => arpLoop(c, 'updown'),
  'Arp: broken': (c) => arpLoop(c, 'broken'),
  'Melody: random riff': (c) => melodyLoop(c),
};

function progSlots(c) {
  const prog = PROGRESSIONS[c.prog] || PROGRESSIONS['Prog 1–5–6–4'];
  const total = c.bars * 16;
  const per = total / prog.length;
  return prog.map((deg, i) => ({ deg, s: i * per, len: per }));
}
function chordTones(c, deg, seventh, oct) {
  const st = harmonyScale(c.scale);
  const idx = seventh ? [0, 2, 4, 6] : [0, 2, 4];
  return idx.map((k) => scaleNote(c.root, st, deg + k, oct));
}
function chordLoop(c, seventh, stabs) {
  const out = [];
  for (const slot of progSlots(c)) {
    const tones = chordTones(c, slot.deg, seventh, 3);
    if (!stabs) {
      tones.forEach((p) => out.push({ s: slot.s, l: slot.len - 0.25, p, v: 0.7 }));
    } else {
      for (let s = 0; s < slot.len; s += 4) {
        const off = s + (s % 8 === 0 ? 0 : 2);
        if (off < slot.len) tones.forEach((p) => out.push({ s: slot.s + off, l: 1.5, p, v: s % 8 === 0 ? 0.8 : 0.6 }));
      }
    }
  }
  return out;
}
function bassLoop(c, style) {
  const st = harmonyScale(c.scale);
  const out = [];
  for (const slot of progSlots(c)) {
    const root = scaleNote(c.root, st, slot.deg, 2);
    if (style === 'roots') {
      out.push({ s: slot.s, l: slot.len - 0.5, p: root, v: 0.85 });
    } else if (style === 'eighths') {
      for (let s = 0; s < slot.len; s += 2) out.push({ s: slot.s + s, l: 1.5, p: root, v: s % 4 === 0 ? 0.9 : 0.65 });
    } else if (style === 'octave') {
      for (let s = 0; s < slot.len; s += 2) out.push({ s: slot.s + s, l: 1.5, p: root + ((s / 2) % 2 ? 12 : 0), v: 0.8 });
    } else {
      const fifth = scaleNote(c.root, st, slot.deg + 4, 2);
      const pat = [[0, 3, root], [3, 1, root], [6, 2, fifth], [10, 2, root], [14, 1, root + 12]];
      for (let b = 0; b < slot.len; b += 16)
        pat.forEach(([s, l, p]) => { if (b + s < slot.len) out.push({ s: slot.s + b + s, l, p, v: s === 0 ? 0.95 : 0.7 }); });
    }
  }
  return out;
}
function arpLoop(c, style) {
  const out = [];
  for (const slot of progSlots(c)) {
    const t = chordTones(c, slot.deg, false, 4);
    let seq;
    if (style === 'up') seq = [t[0], t[1], t[2], t[0] + 12];
    else if (style === 'updown') seq = [t[0], t[1], t[2], t[0] + 12, t[2], t[1]];
    else seq = [t[0], t[2], t[1], t[0] + 12, t[1], t[2]];
    for (let s = 0, i = 0; s < slot.len; s += 1, i++) out.push({ s: slot.s + s, l: 0.9, p: seq[i % seq.length], v: i % 4 === 0 ? 0.8 : 0.55 });
  }
  return out;
}
function melodyLoop(c) {
  // Seeded-ish random walk on the chosen scale, emphasising chord tones on strong beats.
  const steps = SCALES[c.scale].steps;
  const out = [];
  let deg = steps.length; // start one octave up
  const rhythm = [[0, 2], [2, 1], [3, 1], [4, 3], [8, 2], [10, 2], [12, 1], [14, 2]];
  for (let bar = 0; bar < c.bars; bar++) {
    for (const [s, l] of rhythm) {
      if (Math.random() < 0.2 && s !== 0) continue;
      deg += [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
      deg = Math.max(0, Math.min(steps.length * 2, deg));
      out.push({ s: bar * 16 + s, l, p: scaleNote(c.root, steps, deg, 4), v: s % 4 === 0 ? 0.85 : 0.65 });
    }
  }
  return out;
}

function parseBeatString(str, steps) {
  const arr = new Array(steps).fill(0);
  if (!str) return arr;
  for (let i = 0; i < steps; i++) {
    const ch = str[i % str.length];
    arr[i] = ch === 'X' ? 1 : ch === 'x' ? 0.75 : ch === 'o' ? 0.4 : 0;
  }
  return arr;
}
