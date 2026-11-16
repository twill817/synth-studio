/* App state: game project (Style + scores), undo/redo, persistence, samples, live playing & recording.

   Project model
   -------------
   project = { name, style, scores[], current, library[], flavors[] }   (library: js/library.js)
   style   = { key, scale, bpm,           // defaults for new scores
               roles[],                   // the game's instrument roster, shared by every score
               mix }                      // master chain, shared by every score
   role    = { id, name, color, type:'synth', preset, synth } | { id, name, color, type:'drum', kit, voices }
   score   = { id, name, bpm, swing, key, scale, tracks[], patterns[], arrangement[],
               layers[],                  // adaptive intensity layers, base first: [{id, name}]
               adaptive: { quant } }      // when a segment change happens: 'beat' | 'bar' | 'end'
   track   = { id, name, role, type, color, vol, pan, mute, solo, drive, tone, rev, dly,
               layer,                     // id of the intensity layer this track belongs to
               sound,                     // null = use the role's sound; otherwise a per-level override
                                          // ({preset, synth} or {kit, voices}) — the level's "flavor"
               part }                     // which part of a library pattern it plays (role id, role:2 …)
   pattern = { id, name, bars, drums, notes,
               kind,                      // 'loop' = a segment the game can sit in; 'sting' = plays once
               entrySting,                // id of a sting to play when the game switches to this segment
               lib, from, libSig }        // library link: see js/library.js
*/

const uid = () => Math.random().toString(36).slice(2, 9);
const ROLE_COLORS = ['#ff6b6b', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#ffa94d', '#ffd43b', '#69db7c', '#f783ac', '#a9e34b'];
const DEFAULT_MIX = { vol: 0.9, low: 0, mid: 0, high: 0, comp: -14, revSize: 2.4, revLevel: 0.9, dlyDiv: '1/8 dotted', dlyFb: 0.35 };
const clone = (o) => JSON.parse(JSON.stringify(o));

function defaultVoices() {
  const voices = {};
  DRUM_VOICES.forEach((v) => (voices[v.id] = { level: 1, tune: 0, decay: 1, pan: 0, sample: null }));
  voices.chh.level = 0.7; voices.ohh.level = 0.6; voices.crash.level = 0.6; voices.cow.level = 0.6;
  return voices;
}

/* ---------- roles & sounds ---------- */
function uniqueRoleName(name, style = App.project.style) {
  let n = name, k = 2;
  while (style.roles.some((r) => r.name === n)) n = `${name} ${k++}`;
  return n;
}
function makeRole(kind, name, style = App.project.style) {
  const color = ROLE_COLORS[style.roles.length % ROLE_COLORS.length];
  let r;
  if (kind === 'drum') r = { id: uid(), name: uniqueRoleName(name || 'Drums', style), color, type: 'drum', kit: 'classic', voices: defaultVoices() };
  else {
    const p = SYNTH_PRESETS[kind] || SYNTH_PRESETS.piano;
    r = { id: uid(), name: uniqueRoleName(name || p.name, style), color, type: 'synth', preset: kind, synth: { ...p } };
  }
  r.mix = defaultInstMix(r);
  return r;
}
/* An instrument's (role's) default mix: what a new track playing it starts with. */
const INST_MIX_KEYS = ['vol', 'pan', 'drive', 'tone', 'rev', 'dly'];
function defaultInstMix(role) {
  const pre = role.preset || '';
  return { vol: role.type === 'drum' ? 0.85 : 0.75, pan: 0, drive: 0, tone: 20000,
    rev: role.type === 'drum' ? 0.08 : pre === 'pad' || pre === 'strings' ? 0.35 : 0.18,
    dly: pre === 'pluck' || pre === 'lead' ? 0.2 : role.type === 'drum' ? 0 : 0.05 };
}
function roleOf(t) { return App.project.style.roles.find((r) => r.id === t.role); }
/* The sound a track actually plays: its per-score override, else its role. Edits go to this object. */
function snd(t) { return t.sound || roleOf(t); }
function soundFields(src) {
  return src.type === 'drum' || src.kit ? { kit: src.kit, voices: clone(src.voices) } : { preset: src.preset, synth: clone(src.synth) };
}
function soundName(s) {
  if (!s) return '';
  return s.kit ? (DRUM_KITS[s.kit] || {}).name || 'Drum kit' : (SYNTH_PRESETS[s.preset] || {}).name || 'Synth';
}

/* A lane: one of a level's instruments (its sound customization lives here). Its mix, layer, mute
   and solo are per track (pattern): see p.parts. */
function makeTrack(role, name) {
  return { id: uid(), name: name || role.name, role: role.id, type: role.type, color: role.color, sound: null };
}

/* ---------- parts: the instruments in a track (level pattern), each with its own mix ----------
   p.parts = [{ t: laneId, vol, pan, drive, tone, rev, dly, layer, mute, solo }] in order. */
const LEGACY_LANE_KEYS = ['vol', 'pan', 'drive', 'tone', 'rev', 'dly', 'layer', 'mute', 'solo'];
function partOf(p, t) { const id = t && (t.id || t); return p && p.parts ? p.parts.find((x) => x.t === id) || null : null; }
function partLanes(song, p) { return (p && p.parts ? p.parts : []).map((x) => song.tracks.find((t) => t.id === x.t)).filter(Boolean); }
/* The first part a lane has in any of the level's tracks (its usual mix), or null. */
function laneMix(song, t, except) {
  for (const p of song.patterns) { if (p === except) continue; const m = partOf(p, t); if (m) return m; }
  return null;
}
/* A new part for lane t: the lane's usual mix in this level, else its instrument's default mix. */
function newPart(song, t, except) {
  const m = laneMix(song, t, except);
  if (m) { const x = { ...clone(m), t: t.id }; delete x.curves; return x; }   // curves belong to their own track
  const role = App.project.style.roles.find((r) => r.id === t.role);
  const mix = { ...defaultInstMix(role || t), ...((role && role.mix) || {}) };
  const part = { t: t.id, layer: song.layers[0].id, mute: false, solo: false };
  INST_MIX_KEYS.forEach((k) => (part[k] = mix[k]));
  return part;
}
function normalizePart(song, x) {
  if (!song.layers.some((l) => l.id === x.layer)) x.layer = song.layers[0].id;
  x.mute = !!x.mute; x.solo = !!x.solo;
}
/* Add an instrument to a track: reuse a lane of that instrument the track doesn't have yet, else add one. */
function addInstrumentToPattern(song, p, role, name) {
  let t = name ? null : song.tracks.find((x) => x.role === role.id && !partOf(p, x));
  if (!t) {
    const n = song.tracks.filter((x) => x.role === role.id).length;
    t = makeTrack(role, name || (n ? `${role.name} ${n + 1}` : role.name));
    song.tracks.push(t);
  }
  p.parts.push(newPart(song, t, p));
  ensurePattern(p, song);
  return t;
}
/* Take an instrument out of a track (its notes there go too). */
function removeInstrumentFromPattern(song, p, t) {
  p.parts = p.parts.filter((x) => x.t !== t.id);
  if (t.type === 'drum') p.drums[t.id] = {}; else p.notes[t.id] = [];
  if (p.origins) delete p.origins[t.id];
  ensurePattern(p, song);
  return pruneLanes(song);
}
/* Drop lanes no track uses (unless the level customized their sound). Returns the removed lanes. */
function pruneLanes(song) {
  const used = new Set();
  song.patterns.forEach((p) => (p.parts || []).forEach((x) => used.add(x.t)));
  const gone = song.tracks.filter((t) => !used.has(t.id) && !t.sound);
  if (!gone.length) return [];
  song.tracks = song.tracks.filter((t) => !gone.includes(t));
  song.patterns.forEach((p) => gone.forEach((t) => { delete p.notes[t.id]; delete p.drums[t.id]; if (p.origins) delete p.origins[t.id]; }));
  return gone;
}
/* ---------- curves (step 6c): shape each instrument in a track over the track's length ----------
   part.curves = { [param]: [{ s, v, k? }] } (one instrument in a track); p.curves only holds a sting's Speed.
   s = position in 16ths (0 … bars×16), v = value in the param's own units, k: 'line' = straight to
   the next point (default: smooth). Volume / Reverb / Delay are % of the mix setting; Pan −100…100
   (moves the sound on top of its mix pan); Filter = low-pass cutoff in Hz; Pitch in semitones
   (instruments); Speed = % tempo (stings only, so loops stay on the level's beat for the game). */
const CURVE_PARAMS = {
  vol: { name: 'Volume', min: 0, max: 150, def: 100, unit: '%' },
  pan: { name: 'Pan', min: -100, max: 100, def: 0, unit: 'pan' },
  rev: { name: 'Reverb', min: 0, max: 200, def: 100, unit: '%' },
  dly: { name: 'Delay', min: 0, max: 200, def: 100, unit: '%' },
  cut: { name: 'Filter', min: 100, max: 20000, def: 20000, unit: 'Hz', log: true },
  pitch: { name: 'Pitch', min: -12, max: 12, def: 0, unit: 'st', part: true },
  speed: { name: 'Speed', min: 50, max: 200, def: 100, unit: '%', track: true, sting: true },
};
const TRACK_CURVES = ['speed'];   // curves shape instruments; only a sting's Speed covers the whole track
/* Older projects had whole-track curves for Volume / Pan / Reverb / Delay / Filter: fold them into each
   instrument's curve (multiplied for %, added for pan, the lower cutoff for the filter), so nothing
   sounds different. owner: a pattern or library item with .curves; parts: their curve owners. */
function foldTrackCurves(owner, parts) {
  const c = owner && owner.curves;
  if (!c) return false;
  const keys = ['vol', 'pan', 'rev', 'dly', 'cut'].filter((k) => c[k] && c[k].length);
  if (!keys.length) { Object.keys(c).forEach((k) => { if (!c[k] || !c[k].length) delete c[k]; }); if (!Object.keys(c).length) delete owner.curves; return false; }
  const both = (k, a, b) => (k === 'pan' ? clamp(a + b, -100, 100) : k === 'cut' ? Math.min(a, b) : Math.round((a * b / 100) * 10) / 10);
  parts.forEach((x) => keys.forEach((k) => {
    x.curves = x.curves || {};
    const mine = x.curves[k];
    if (!mine || !mine.length) { x.curves[k] = clone(c[k]); return; }
    const at = [...new Set([...mine, ...c[k]].map((q) => q.s))].sort((a, b) => a - b);
    const line = mine.every((q) => q.k === 'line') && c[k].every((q) => q.k === 'line');
    x.curves[k] = at.map((s) => ({ s, v: both(k, evalCurve(mine, s, k), evalCurve(c[k], s, k)), ...(line ? { k: 'line' } : {}) }));
  }));
  keys.forEach((k) => delete c[k]);
  if (!Object.keys(c).length) delete owner.curves;
  return true;
}
const PART_CURVES = ['vol', 'pan', 'rev', 'dly', 'cut', 'pitch'];
function curveText(param, v) {
  const P = CURVE_PARAMS[param];
  if (P.unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + ' kHz' : Math.round(v) + ' Hz';
  if (P.unit === 'pan') return Math.abs(v) < 1 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v));
  if (P.unit === 'st') return (v > 0 ? '+' : '') + (Math.round(v * 10) / 10) + ' st';
  return Math.round(v) + '%';
}
/* A curve's value at position s (16ths): smooth = monotone cubic (no overshoot), or straight. */
function evalCurve(pts, s, param) {
  const P = CURVE_PARAMS[param];
  if (!pts || !pts.length) return P.def;
  const f = P.log ? Math.log : (x) => x, fi = P.log ? Math.exp : (x) => x;
  const n = pts.length;
  if (s <= pts[0].s) return pts[0].v;
  if (s >= pts[n - 1].s) return pts[n - 1].v;
  let i = 0;
  while (i < n - 2 && s >= pts[i + 1].s) i++;
  const a = pts[i], b = pts[i + 1], h = b.s - a.s;
  if (h <= 0) return b.v;
  const u = (s - a.s) / h, ya = f(a.v), yb = f(b.v);
  if (a.k === 'line') return fi(ya + (yb - ya) * u);
  const slope = (j) => (f(pts[j + 1].v) - f(pts[j].v)) / Math.max(1e-9, pts[j + 1].s - pts[j].s);
  const tan = (j) => {
    if (j === 0) return slope(0);
    if (j === n - 1) return slope(n - 2);
    const d0 = slope(j - 1), d1 = slope(j);
    return d0 * d1 <= 0 ? 0 : 2 / (1 / d0 + 1 / d1);
  };
  const m0 = tan(i) * h, m1 = tan(i + 1) * h, u2 = u * u, u3 = u2 * u;
  return fi((2 * u3 - 3 * u2 + 1) * ya + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * yb + (u3 - u2) * m1);
}
function hasCurves(c) { return !!c && Object.values(c).some((pts) => pts && pts.length); }
/* Speed (stings): how fast step s plays (1 = the level's tempo). */
function speedAt(p, s) { return p && p.kind === 'sting' && p.curves && p.curves.speed ? clamp(evalCurve(p.curves.speed, s + 0.5, 'speed'), 50, 200) / 100 : 1; }
function stepDurAt(song, p, s) { return 60 / song.bpm / 4 / speedAt(p, s); }
/* How long one pass of a track lasts, in seconds (speed curves included). */
function patternSeconds(song, p) {
  let t = 0;
  for (let s = 0; s < p.bars * 16; s++) t += stepDurAt(song, p, s);
  return t;
}

/* Projects from before step 6b kept mix, layer, mute and solo on the level's lanes. Each lane becomes a
   part of every track where it has notes (a track with no notes at all gets every lane), with that mix. */
function migrateLanesToParts(s, roles) {
  if (!s.tracks.some((t) => LEGACY_LANE_KEYS.some((k) => k in t))) return false;
  const has = (p, t) => (t.type === 'drum' ? Object.values(p.drums[t.id] || {}).some((r) => r.some((v) => v > 0)) : (p.notes[t.id] || []).length > 0);
  s.patterns.forEach((p) => {
    let lanes = s.tracks.filter((t) => has(p, t));
    if (!lanes.length) lanes = s.tracks.slice();
    p.parts = lanes.map((t) => {
      const role = roles.find((r) => r.id === t.role);
      const base = { ...defaultInstMix(role || t), ...((role && role.mix) || {}) };
      const part = { t: t.id };
      INST_MIX_KEYS.forEach((k) => (part[k] = typeof t[k] === 'number' ? t[k] : base[k]));
      part.layer = s.layers.some((l) => l.id === t.layer) ? t.layer : s.layers[0].id;
      part.mute = !!t.mute; part.solo = !!t.solo;
      return part;
    });
  });
  s.tracks.forEach((t) => LEGACY_LANE_KEYS.forEach((k) => delete t[k]));
  return true;
}
function makePattern(name, bars = 2, kind = 'loop') { return { id: uid(), name, bars, drums: {}, notes: {}, kind, entrySting: null, origins: {} }; }
function makeScore(name, style = App.project.style) {
  return { id: uid(), name, bpm: style.bpm, swing: 0, key: style.key, scale: style.scale, tracks: [], patterns: [], arrangement: [], mix: null,
    layers: [{ id: 'base', name: 'Base' }], adaptive: { quant: 'bar' } };
}
/* Intensity layers: base is always on; layer i (i ≥ 1) fades in as intensity rises.
   With n layers, intensity 0 = base only, 1 = everything. Crossfades are continuous. */
function layerIndex(song, t) { return Math.max(0, song.layers.findIndex((l) => l.id === t.layer)); }
function layerGainAt(song, t, intensity) {
  const n = song.layers.length, i = layerIndex(song, t);
  if (i === 0 || n < 2) return 1;
  return clamp(intensity * (n - 1) - (i - 1), 0, 1);
}

function ensurePattern(pat, song = App.song) {
  const steps = pat.bars * 16;
  pat.origins = pat.origins || {};
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
  // A new track gets every instrument of the level; parts of removed lanes go.
  if (!pat.parts && !song.tracks.some((t) => LEGACY_LANE_KEYS.some((k) => k in t))) pat.parts = song.tracks.map((t) => newPart(song, t, pat));
  if (pat.parts) {
    pat.parts = pat.parts.filter((x) => song.tracks.some((t) => t.id === x.t));
    pat.parts.forEach((x) => normalizePart(song, x));
  }
}
function ensureAll(song = App.song) { song.patterns.forEach((p) => ensurePattern(p, song)); }

/* An instrument added to a track that was duplicated from another one: copy the beats (or notes) and
   layer of the instrument in this track that plays the original (or the original's original).
   Returns that source lane, or null when the track has none. */
function copyPartsFromOriginal(song, p, t) {
  let fromId = (App.role(t.role) || {}).from, src = null;
  const seen = new Set();
  while (fromId && !seen.has(fromId) && !src) {
    seen.add(fromId);
    src = partLanes(song, p).find((x) => x.role === fromId && x !== t && x.type === t.type) || null;
    fromId = (App.role(fromId) || {}).from;
  }
  if (!src) return null;
  if (t.type === 'drum') p.drums[t.id] = clone(p.drums[src.id] || {});
  else p.notes[t.id] = clone(p.notes[src.id] || []);
  partOf(p, t).layer = partOf(p, src).layer;
  ensurePattern(p, song);
  return src;
}

function applyBeat(pat, trackId, beatName) {
  const b = BEAT_LOOPS[beatName] || {};
  const steps = pat.bars * 16;
  pat.drums[trackId] = {};
  DRUM_VOICES.forEach((v) => (pat.drums[trackId][v.id] = parseBeatString(b[v.id], steps)));
}

/* Copy a score with fresh ids (tracks, patterns) so it stands on its own. */
function duplicateScore(src, name) {
  const s = clone(src);
  s.id = uid(); s.name = name;
  const map = {}, pmap = {};
  s.tracks.forEach((t) => { const n = uid(); map[t.id] = n; t.id = n; });
  s.patterns.forEach((p) => { pmap[p.id] = uid(); });
  s.patterns.forEach((p) => {
    p.id = pmap[p.id];
    if (p.entrySting) p.entrySting = pmap[p.entrySting] || null;
    if (p.then) p.then = pmap[p.then] || null;
    const d = {}, n = {};
    Object.keys(p.drums).forEach((k) => { if (map[k]) d[map[k]] = p.drums[k]; });
    Object.keys(p.notes).forEach((k) => { if (map[k]) n[map[k]] = p.notes[k]; });
    p.drums = d; p.notes = n;
    const o = {};
    Object.keys(p.origins || {}).forEach((k) => { if (map[k]) o[map[k]] = p.origins[k]; });
    p.origins = o;
  });
  Object.values(s.cues || {}).forEach((xs) => xs.forEach((a) => { if (a.target) a.target = pmap[a.target] || null; }));
  return s;
}

/* ---------- demo / blank projects ---------- */
function baseStyle(key = 9, scale = 'minor', bpm = 96) {
  const style = { key, scale, bpm, roles: [], mix: { ...DEFAULT_MIX } };
  [['drum', 'Drums'], ['bass', 'Bass'], ['epiano', 'Keys'], ['pad', 'Pad'], ['pluck', 'Lead']].forEach(([k, n]) => style.roles.push(makeRole(k, n, style)));
  return style;
}
function blankProject() {
  const style = baseStyle(0, 'minor', 110);
  const score = makeScore('Level 1', style);
  style.roles.forEach((r) => score.tracks.push(makeTrack(r)));
  score.patterns.push(makePattern('Main', 2));
  score.arrangement = [0];
  ensureAll(score);
  return { app: 'SynthStudio', version: 2, name: 'My Game', style, scores: [score], current: 0, library: [] };
}
function demoProject() {
  const style = baseStyle(9, 'minor', 96);
  const R = Object.fromEntries(style.roles.map((r) => [r.name, r]));
  const gen = (s, name, bars, prog) => LOOP_GENERATORS[name]({ root: s.key, scale: s.scale, bars, prog });

  // Level 1 — the game's home sound, straight from the Style.
  const L1 = makeScore('Level 1 — Meadow', style);
  L1.swing = 10;
  const [d1, b1, k1, p1, l1] = ['Drums', 'Bass', 'Keys', 'Pad', 'Lead'].map((n) => makeTrack(R[n]));
  p1.vol = 0.5; l1.vol = 0.55;
  L1.tracks.push(d1, b1, k1, p1, l1);
  const A = makePattern('Verse', 2), B = makePattern('Chorus', 2), C = makePattern('Intro', 2);
  [A, B, C].forEach((p) => { L1.patterns.push(p); ensurePattern(p, L1); });
  applyBeat(A, d1.id, 'Boom Bap');
  applyBeat(B, d1.id, 'Half-Time');
  B.drums[d1.id].crash[0] = 0.8;
  applyBeat(C, d1.id, 'Clear');
  C.drums[d1.id].chh = parseBeatString('x.x.x.x.x.x.x.x.', 32);
  A.notes[b1.id] = gen(L1, 'Bass: syncopated', 2, 'Prog 1–6–3–7');
  A.notes[k1.id] = gen(L1, 'Chords (7ths)', 2, 'Prog 1–6–3–7');
  B.notes[b1.id] = gen(L1, 'Bass: octave bounce', 2, 'Prog 6–4–1–5');
  B.notes[p1.id] = gen(L1, 'Chords (block)', 2, 'Prog 6–4–1–5');
  B.notes[l1.id] = gen(L1, 'Arp: up-down', 2, 'Prog 6–4–1–5');
  C.notes[p1.id] = gen(L1, 'Chords (block)', 2, 'Prog 1–6–3–7');
  L1.arrangement = [2, 0, 0, 1, 1, 0, 1];
  A.name = 'Explore'; B.name = 'Action';
  // Adaptive setup: Base (harmony) → Rhythm (drums) → Intensity (lead), and a sting into Action.
  L1.layers = [{ id: 'base', name: 'Base' }, { id: 'rhythm', name: 'Rhythm' }, { id: 'intense', name: 'Intensity' }];
  d1.layer = 'rhythm'; l1.layer = 'intense';
  const S1 = makePattern('Alert', 1, 'sting');
  L1.patterns.push(S1); ensurePattern(S1, L1);
  S1.drums[d1.id].kick[0] = 1; S1.drums[d1.id].crash[0] = 1; S1.drums[d1.id].snare = parseBeatString('........x.x.xXXX', 16);
  S1.notes[p1.id] = chordTones({ root: L1.key, scale: L1.scale }, 5, false, 3).map((p) => ({ s: 0, l: 12, p, v: 0.8 }));
  S1.notes[l1.id] = [0, 2, 4, 7].map((d, i) => ({ s: 8 + i * 2, l: 2, p: scaleNote(L1.key, SCALES[L1.scale].steps, d + 7, 4), v: 0.8 }));
  B.entrySting = S1.id;

  // Level 2 — same roles, different flavor: colder keys (Bell override), darker pad, slower, D minor.
  const L2 = makeScore('Level 2 — Ice Caves', style);
  L2.bpm = 84; L2.key = 2;
  const [d2, b2, k2, p2, l2] = ['Drums', 'Bass', 'Keys', 'Pad', 'Lead'].map((n) => makeTrack(R[n]));
  k2.sound = { preset: 'bell', synth: { ...SYNTH_PRESETS.bell } }; k2.vol = 0.5; k2.rev = 0.45;
  p2.sound = soundFields(R.Pad); p2.sound.synth.cut = 700; p2.vol = 0.55; p2.rev = 0.5;
  l2.vol = 0.45; l2.dly = 0.35;
  L2.tracks.push(d2, b2, k2, p2, l2);
  const E = makePattern('Explore', 4), D = makePattern('Danger', 2);
  [E, D].forEach((p) => { L2.patterns.push(p); ensurePattern(p, L2); });
  E.drums[d2.id].chh = parseBeatString('x...x...x...x...', 64);
  E.drums[d2.id].rim = parseBeatString('......o.......o.', 64);
  E.notes[p2.id] = gen(L2, 'Chords (block)', 4, 'Prog 1–7–6–7');
  E.notes[k2.id] = gen(L2, 'Arp: broken', 4, 'Prog 1–7–6–7').filter((n, i) => i % 2 === 0);
  applyBeat(D, d2.id, 'Half-Time');
  D.notes[b2.id] = gen(L2, 'Bass: eighths', 2, 'Prog 1–6–3–7');
  D.notes[p2.id] = gen(L2, 'Chords (block)', 2, 'Prog 1–6–3–7');
  D.notes[l2.id] = gen(L2, 'Arp: up', 2, 'Prog 1–6–3–7');
  L2.arrangement = [0, 0, 1, 1, 0];
  L2.layers = [{ id: 'base', name: 'Base' }, { id: 'rhythm', name: 'Rhythm' }, { id: 'intense', name: 'Intensity' }];
  d2.layer = 'rhythm'; b2.layer = 'rhythm'; l2.layer = 'intense';
  const S2 = makePattern('Discovered', 1, 'sting');
  L2.patterns.push(S2); ensurePattern(S2, L2);
  S2.drums[d2.id].crash[0] = 1; S2.drums[d2.id].ltom = parseBeatString('x...x...x.x.xxxx', 16);
  S2.notes[k2.id] = [0, 1, 2, 3, 4, 5, 6, 7].map((d, i) => ({ s: i * 2, l: 2, p: scaleNote(L2.key, SCALES[L2.scale].steps, 14 - d, 4), v: 0.7 }));
  S2.notes[b2.id] = [{ s: 0, l: 16, p: scaleNote(L2.key, SCALES[L2.scale].steps, 0, 1), v: 0.9 }];
  D.entrySting = S2.id;

  // A game-wide theme, used in both levels — fitted to each level's key.
  const main = { id: uid(), name: 'Main Theme', key: 9, scale: 'minor', bars: 2, role: R.Lead.id, notes: [
    [0, 4, 69], [4, 2, 72], [6, 2, 76], [8, 4, 74], [12, 2, 72], [14, 2, 71],
    [16, 6, 69], [22, 2, 64], [24, 4, 67], [28, 4, 69]].map(([s, l, p]) => ({ s, l, p, v: 0.8 })) };
  const use = (song, pat, track, opts) => {
    pat.notes[track.id] = Themes.render(main, { key: song.key, scale: song.scale, bars: pat.bars, ...opts });
    pat.origins = { ...(pat.origins || {}), [track.id]: { theme: main.id, ...opts } };
  };
  use(L1, A, l1, { oct: 0, speed: 1, fit: true });          // Meadow Explore: theme on the lead (Intensity layer)
  use(L2, D, l2, { oct: 0, speed: 1, fit: true });          // Ice Caves Danger: same theme, now in D minor
  use(L2, E, k2, { oct: 0, speed: 2, fit: true });          // Ice Caves Explore: theme at half speed on the bells

  // Ice Caves' look-and-feel as a reusable flavor: bell keys, dark pad, bigger darker reverb.
  L2.mix = { ...DEFAULT_MIX, revSize: 4.5, revLevel: 1.2, high: -4 };
  const ice = { id: uid(), name: 'Ice', sounds: {}, mix: clone(L2.mix) };
  L2.tracks.forEach((t) => { if (t.sound) ice.sounds[t.role] = clone(t.sound); });

  // What the game tells the music (named as the game fires them), and what each level does about it.
  const ev = (name, note) => ({ id: uid(), name, note });
  const events = [ev('RunWaiting', 'waiting at the start line'), ev('RunStarted', 'the run clock starts'), ev('ClockLow', 'time is nearly up'),
    ev('Paused', 'pause menu open'), ev('Resumed', 'pause menu closed'), ev('RunOver', 'the run has ended')];
  const [eW, eS, eC, eP, eR, eO] = events;
  const act = (d, target, value) => ({ do: d, target: target ? target.id : null, value: value ?? null });
  L1.cues = { [eW.id]: [act('goto', C), act('intensity', null, 0.2)], [eS.id]: [act('goto', B), act('intensity', null, 0.5)], [eC.id]: [act('intensity', null, 1)],
    [eP.id]: [act('duck', null, 0.3)], [eR.id]: [act('unduck')], [eO.id]: [act('end', S1)] };
  L2.cues = { [eW.id]: [act('goto', E), act('intensity', null, 0.2)], [eS.id]: [act('goto', D)], [eC.id]: [act('intensity', null, 1)],
    [eP.id]: [act('duck', null, 0.3)], [eR.id]: [act('unduck')], [eO.id]: [act('fade', null, 2)] };
  return { app: 'SynthStudio', version: 2, name: 'My Game', style, scores: [L1, L2], current: 0, themes: [main], flavors: [ice], events };
}

/* Older saves were a single song with sounds on each track: wrap them in a project,
   turning each track's sound into a role. */
function migrateSongToProject(song) {
  const style = { key: song.key ?? 0, scale: song.scale || 'minor', bpm: song.bpm || 120, roles: [], mix: Object.assign({ ...DEFAULT_MIX }, song.master || {}) };
  song.tracks.forEach((t) => {
    const role = t.type === 'drum'
      ? { id: uid(), name: uniqueRoleName(t.name, style), color: t.color, type: 'drum', kit: t.kit || 'classic', voices: t.voices || defaultVoices() }
      : { id: uid(), name: uniqueRoleName(t.name, style), color: t.color, type: 'synth', preset: t.preset || 'piano', synth: Object.assign({}, SYNTH_PRESETS[t.preset] || SYNTH_PRESETS.piano, t.synth) };
    style.roles.push(role);
    t.role = role.id; t.sound = null;
    delete t.kit; delete t.voices; delete t.preset; delete t.synth;
  });
  delete song.master; delete song.version;
  song.id = song.id || uid();
  return { app: 'SynthStudio', version: 2, name: song.name || 'My Game', style, scores: [song], current: 0 };
}

const App = {
  project: null,
  get song() { return this.project.scores[this.project.current]; },
  get style() { return this.project.style; },
  samples: {}, // id -> {name, dataURL, buffer}
  sel: { track: null, pattern: 0, role: null },
  mode: 'pattern',      // 'pattern' | 'song' | 'adaptive'
  intensity: 1,         // adaptive preview: 0 = base layer only … 1 = all layers
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
    let p = null;
    try {
      const saved = localStorage.getItem('synthstudio.project');
      const old = localStorage.getItem('synthstudio.autosave');
      if (saved) p = JSON.parse(saved);
      else if (old) p = migrateSongToProject(JSON.parse(old));
    } catch (e) { console.warn(e); }
    this.project = p || demoProject();
    this.migrate(this.project);
    this.resetSelection();
    this.migrationNote();
  },
  /* Say once what the step-6b upgrade changed in a saved project (nothing in sound). */
  migrationNote() {
    const p = this.project, n = p._partsSplit;
    delete p._partsSplit; delete p._partsMigrated;
    if (n) setTimeout(() => toast(`Each track now lists its own instruments and mix. ${n} linked track${n > 1 ? 's' : ''} had a different mix in another level, so ${n > 1 ? 'those copies are' : 'that copy is'} now that level's own version (sounds the same; “Back to the library version” relinks).`, 9000), 800);
  },
  migrate(p) {
    p.style.mix = Object.assign({ ...DEFAULT_MIX }, p.style.mix || {});
    p.flavors = p.flavors || [];
    p.style.roles.forEach((r) => { if (r.type === 'synth') r.synth = Object.assign({}, SYNTH_PRESETS[r.preset] || SYNTH_PRESETS.piano, r.synth); });
    p.current = clamp(p.current || 0, 0, p.scores.length - 1);
    p.scores.forEach((s) => {
      s.key = s.key ?? p.style.key; s.scale = s.scale || p.style.scale; s.swing = s.swing ?? 0;
      s.arrangement = s.arrangement || [];
      s.layers = s.layers && s.layers.length ? s.layers : [{ id: 'base', name: 'Base' }];
      s.adaptive = Object.assign({ quant: 'bar' }, s.adaptive || {});
      s.mix = s.mix ? Object.assign({ ...DEFAULT_MIX }, s.mix) : null;
      s.patterns.forEach((p) => {
        p.kind = p.kind || 'loop'; if (p.entrySting === undefined) p.entrySting = null;
        p.origins = p.origins || {};
        Object.keys(p.origins).forEach((k) => { if (!p.origins[k] || !p.origins[k].theme) delete p.origins[k]; });
      });
      s.tracks.forEach((t) => { if (t.sound && t.sound.synth) t.sound.synth = Object.assign({}, SYNTH_PRESETS[t.sound.preset] || SYNTH_PRESETS.piano, t.sound.synth); });
    });
    // Instruments (roles) get a default mix: taken from the first track that plays them, else the defaults.
    p.style.roles.forEach((r) => {
      if (r.mix) { r.mix = Object.assign(defaultInstMix(r), r.mix); return; }
      let t = null;
      p.scores.some((s) => (t = s.tracks.find((x) => x.role === r.id)));
      r.mix = defaultInstMix(r);
      if (t) INST_MIX_KEYS.forEach((k) => { if (typeof t[k] === 'number') r.mix[k] = t[k]; });
    });
    // Step 6b: each track lists its instruments (parts) with their own mix; lanes keep none.
    let migrated = 0;
    p.scores.forEach((s) => { if (migrateLanesToParts(s, p.style.roles)) migrated++; ensureAll(s); });
    if (migrated) p._partsMigrated = true;
    // Copies made before instruments remembered their original ("Drums 2" from "Drums"): link them by name.
    p.style.roles.forEach((r) => {
      if (r.from) return;
      const m = /^(.*\S)\s+\d+$/.exec(r.name);
      const o = m && p.style.roles.find((x) => x !== r && x.name === m[1] && x.type === r.type);
      if (o) r.from = o.id;
    });
    Library.migrate(p);
    // Curves shape instruments only (whole-track curves fold into each instrument; a sting's Speed stays).
    p.library.forEach((it) => { if (it.order) foldTrackCurves(it, it.order.map((k) => it.parts[k] && it.parts[k].mix).filter(Boolean)); });
    p.scores.forEach((s) => s.patterns.forEach((pt) => {
      if (foldTrackCurves(pt, pt.parts || []) && pt.lib && pt.libSig && typeof pt.libSig === 'object') pt.libSig = Library.sig(Library.capture(pt, s));
    }));
    p.scores.forEach((s) => pruneLanes(s));
    GameEvents.migrate(p);
  },
  resetSelection() {
    this.sel.track = (this.song.tracks.find((t) => t.type === 'synth') || this.song.tracks[0] || {}).id;
    this.sel.pattern = 0;
    this.sel.role = null;
  },
  /* A lane by id; with no id, the selected instrument of the open track (kept to one the track has). */
  track(id) {
    if (id !== undefined) return this.song.tracks.find((t) => t.id === id);
    let t = this.song.tracks.find((x) => x.id === this.sel.track);
    const p = this.pattern();
    if (p && p.parts && !(t && partOf(p, t))) {
      const lanes = partLanes(this.song, p);
      const nt = (t && lanes.find((x) => x.type === t.type)) || lanes.find((x) => x.type === 'synth') || lanes[0];
      if (nt) { this.sel.track = nt.id; t = nt; }
    }
    return t;
  },
  role(id) { return this.style.roles.find((r) => r.id === id); },
  pattern() { return this.song.patterns[this.sel.pattern]; },
  /* How many tracks (and in how many scores) play a role's shared sound. */
  roleUsage(roleId) {
    let tracks = 0, scores = 0, shared = 0, sharedScores = 0;
    this.project.scores.forEach((s) => {
      const ts = s.tracks.filter((t) => t.role === roleId);
      const sh = ts.filter((t) => !t.sound).length;
      if (ts.length) scores++;
      if (sh) sharedScores++;
      tracks += ts.length;
      shared += sh;
    });
    return { tracks, scores, shared, sharedScores };
  },

  switchScore(i) {
    if (i === this.project.current) return;
    Seq.stop(); Live.allOff();
    this.project.current = i;
    ensureAll();
    this.resetSelection();
    Engine.sync();
    UI.renderAll();
    this.changed();
  },

  /* --- undo (snapshots the whole project, so Style edits are undoable too) --- */
  pushUndo() {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
  },
  undo() { if (!this.undoStack.length) return; this.redoStack.push(JSON.stringify(this.project)); this.replaceProject(JSON.parse(this.undoStack.pop()), true); },
  redo() { if (!this.redoStack.length) return; this.undoStack.push(JSON.stringify(this.project)); this.replaceProject(JSON.parse(this.redoStack.pop()), true); },
  replaceProject(p, keepHistory) {
    const prevScore = this.project && this.song && this.song.id;
    this.project = p;
    this.migrate(p);
    this.migrationNote();
    if (!keepHistory) { this.undoStack = []; this.redoStack = []; }
    if (this.song.id !== prevScore) { Seq.stop(); this.resetSelection(); }
    if (!this.track()) this.sel.track = (this.song.tracks[0] || {}).id;
    if (this.sel.role && !this.role(this.sel.role)) this.sel.role = null;
    if (this.sel.pattern >= this.song.patterns.length) this.sel.pattern = 0;
    Engine.sync();
    UI.renderAll();
    this.changed();
  },

  /* --- persistence --- */
  _saveTimer: null,
  /* After every edit: bring linked library patterns in line (see Library.sync), then autosave.
     Returns the linked copies that changed in other levels. */
  changed() {
    const rewrote = Library.sync();
    if (rewrote.length && typeof UI !== 'undefined' && UI.afterSync) UI.afterSync(rewrote);
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { localStorage.setItem('synthstudio.project', JSON.stringify(this.project)); } catch (e) { console.warn('Autosave failed', e); }
    }, 400);
    return rewrote;
  },
  usedSampleIds() {
    const used = new Set();
    const add = (s) => s && s.voices && Object.values(s.voices).forEach((v) => v.sample && used.add(v.sample));
    this.style.roles.forEach(add);
    this.project.scores.forEach((s) => s.tracks.forEach((t) => add(t.sound)));
    return used;
  },
  projectBlob() {
    const samples = {};
    this.usedSampleIds().forEach((id) => { if (this.samples[id]) samples[id] = { name: this.samples[id].name, dataURL: this.samples[id].dataURL }; });
    return new Blob([JSON.stringify({ ...this.project, samples }, null, 1)], { type: 'application/json' });
  },
  async loadProject(text) {
    const data = JSON.parse(text);
    let p;
    if (data.scores && data.style) p = data;
    else {
      const song = data.song || data;
      if (!song.tracks || !song.patterns) throw new Error('Not a Synth Studio project');
      p = migrateSongToProject(song);
    }
    if (data.samples) {
      const ctx = Engine.ensure();
      for (const [id, s] of Object.entries(data.samples)) {
        const buf = await (await fetch(s.dataURL)).arrayBuffer();
        this.samples[id] = { name: s.name, dataURL: s.dataURL, buffer: await ctx.decodeAudioData(buf) };
      }
    }
    delete p.samples;
    Seq.stop();
    this.pushUndo();
    this.project = null;
    this.replaceProject(p, true);
    this.resetSelection();
    UI.renderAll();
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
  /* What the keyboard plays: a role being edited on the Game Style tab, else the selected track. */
  target() {
    if (App.sel.role) {
      const r = App.role(App.sel.role);
      if (!r) return null;
      const t = App.song.tracks.find((x) => x.role === r.id && !x.sound);
      return { sound: r, type: r.type, dest: t ? Engine.g.tracks[t.id].input : Engine.g.bus, track: null };
    }
    const t = App.track();
    return t ? { sound: snd(t), type: t.type, dest: Engine.g.tracks[t.id].input, track: t } : null;
  },
  noteOn(midi, vel = App.vel) {
    const ctx = Engine.ensure();
    const tg = this.target();
    if (!tg) return;
    UI.keyDown(midi, true);
    if (tg.type === 'drum') {
      const v = DRUM_VOICES[((midi % 12) + 12) % 12];
      if (v) this.hit(tg, v.id, vel);
      return;
    }
    if (this.voices[midi]) this.voices[midi].release(ctx.currentTime);
    this.voices[midi] = synthVoice(ctx, tg.dest, tg.sound.synth, midi, vel, ctx.currentTime + 0.005);
    if (tg.track && App.recording && Seq.playing) {
      const pos = Seq.posAt(ctx.currentTime);
      if (pos) this.rec[midi] = { pat: pos.pat, start: pos.local, step: pos.step, vel, track: tg.track.id };
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
    Engine.ensure();
    this.hit({ sound: snd(t), type: 'drum', dest: Engine.g.tracks[t.id].input, track: t }, voiceId, vel);
  },
  hit(tg, voiceId, vel) {
    const ctx = Engine.ctx;
    const vs = tg.sound.voices[voiceId];
    playDrum(Engine.g, tg.dest, voiceId, ctx.currentTime + 0.003, vel, tg.sound.kit, vs, vs.sample ? App.sampleBuffer(vs.sample) : null);
    if (tg.track && App.recording && Seq.playing) {
      const pos = Seq.posAt(ctx.currentTime);
      if (!pos) return;
      const pat = App.song.patterns[pos.pat];
      const steps = pat.bars * 16;
      const s = Math.round(pos.local) % steps;
      App.pushUndo();
      ensurePattern(pat);
      pat.drums[tg.track.id][voiceId][s] = Math.max(0.4, vel);
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
