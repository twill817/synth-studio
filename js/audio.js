/* Audio engine: graph building (realtime + offline), synth voices, drum synthesis, effects, scheduler. */

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const DELAY_DIVS = { '1/16': 0.25, '1/8': 0.5, '1/8 dotted': 0.75, '1/4': 1, '1/4 dotted': 1.5, '1/2': 2 };

const driveCurves = {};
function driveCurve(amount) {
  const key = Math.round(amount * 100);
  if (driveCurves[key]) return driveCurves[key];
  const n = 2048, c = new Float32Array(n), k = amount * 60;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)) / (1 + amount * 0.6);
  }
  return (driveCurves[key] = c);
}

function makeNoise(ctx) {
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/* Seeded so every render (live, each exported stem) gets the same reverb — stems stay consistent. */
function seededRandom(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function makeIR(ctx, seconds) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    const rnd = seededRandom(1234 + ch * 7919);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (rnd() * 2 - 1) * Math.pow(1 - t, 2.5) * (i < 200 ? i / 200 : 1);
    }
  }
  return b;
}

/* ---------- Graph ---------- */
function buildGraph(ctx, song, opts = {}) {
  const g = { ctx, tracks: {}, noise: makeNoise(ctx), only: opts.only || null, openHats: {}, realtime: !!opts.realtime };
  const mk = (type, props = {}) => {
    const n = type === 'gain' ? ctx.createGain() : ctx.createBiquadFilter();
    if (type !== 'gain') n.type = type;
    for (const k in props) n[k].value = props[k];
    return n;
  };
  g.bus = mk('gain');
  g.low = mk('lowshelf', { frequency: 200 });
  g.mid = mk('peaking', { frequency: 1200, Q: 0.8 });
  g.high = mk('highshelf', { frequency: 5000 });
  g.comp = ctx.createDynamicsCompressor();
  g.comp.ratio.value = 3; g.comp.attack.value = 0.01; g.comp.release.value = 0.2; g.comp.knee.value = 8;
  g.out = mk('gain');
  g.lim = ctx.createDynamicsCompressor();
  g.lim.threshold.value = -1; g.lim.ratio.value = 20; g.lim.attack.value = 0.002; g.lim.release.value = 0.08; g.lim.knee.value = 0;
  g.bus.connect(g.low); g.low.connect(g.mid); g.mid.connect(g.high); g.high.connect(g.comp);
  g.comp.connect(g.out); g.out.connect(g.lim); g.lim.connect(ctx.destination);
  if (opts.realtime) {
    g.analyser = ctx.createAnalyser();
    g.analyser.fftSize = 1024;
    g.lim.connect(g.analyser);
  }
  // Reverb send
  g.revIn = mk('gain');
  g.conv = ctx.createConvolver();
  g.revOut = mk('gain');
  g.revIn.connect(g.conv); g.conv.connect(g.revOut); g.revOut.connect(g.bus);
  g.revSize = null;
  // Delay send
  g.dlyIn = mk('gain');
  g.dly = ctx.createDelay(5);
  g.dlyFb = mk('gain');
  g.dlyLp = mk('lowpass', { frequency: 3500 });
  g.dlyIn.connect(g.dly); g.dly.connect(g.dlyLp); g.dlyLp.connect(g.dlyFb); g.dlyFb.connect(g.dly);
  g.dlyLp.connect(g.bus);

  applyMaster(g, song, true);
  song.tracks.forEach((t) => addTrackNodes(g, t, song));
  return g;
}

function setParam(g, param, value, instant) {
  if (instant || !g.ctx.currentTime) param.value = value;
  else param.setTargetAtTime(value, g.ctx.currentTime, 0.015);
}

function applyMaster(g, song, instant) {
  const m = App.project.style.mix; // the master chain is shared by every score in the game
  setParam(g, g.low.gain, m.low, instant);
  setParam(g, g.mid.gain, m.mid, instant);
  setParam(g, g.high.gain, m.high, instant);
  setParam(g, g.comp.threshold, m.comp, instant);
  setParam(g, g.out.gain, m.vol, instant);
  setParam(g, g.revOut.gain, m.revLevel, instant);
  setParam(g, g.dlyFb.gain, m.dlyFb, instant);
  setParam(g, g.dly.delayTime, (DELAY_DIVS[m.dlyDiv] || 0.75) * 60 / song.bpm, instant);
  if (g.revSize !== m.revSize) { g.conv.buffer = makeIR(g.ctx, m.revSize); g.revSize = m.revSize; }
}

function addTrackNodes(g, t, song) {
  const ctx = g.ctx;
  const n = {
    input: ctx.createGain(),
    drive: ctx.createWaveShaper(),
    tone: ctx.createBiquadFilter(),
    gain: ctx.createGain(),
    pan: ctx.createStereoPanner(),
    rev: ctx.createGain(),
    dly: ctx.createGain(),
  };
  n.drive.oversample = '2x';
  n.tone.type = 'lowpass'; n.tone.Q.value = 0.7;
  n.input.connect(n.drive); n.drive.connect(n.tone); n.tone.connect(n.gain); n.gain.connect(n.pan);
  n.pan.connect(g.bus); n.pan.connect(n.rev); n.rev.connect(g.revIn); n.pan.connect(n.dly); n.dly.connect(g.dlyIn);
  n.input.__id = t.id; // used for open-hat choke grouping
  g.tracks[t.id] = n;
  applyTrack(g, t, song, true);
}

function removeTrackNodes(g, id) {
  const n = g.tracks[id];
  if (!n) return;
  Object.values(n).forEach((x) => { try { x.disconnect(); } catch (e) {} });
  delete g.tracks[id];
}

/* `only` restricts an offline render: a track id (one stem) or a predicate (e.g. one intensity layer). */
function trackAudible(song, t, only) {
  if (only) return typeof only === 'function' ? only(t) : t.id === only;
  if (t.mute) return false;
  const anySolo = song.tracks.some((x) => x.solo);
  return !anySolo || t.solo;
}

/* Track fader × (in the live adaptive preview) its intensity layer's level. */
function trackGain(g, song, t) {
  if (!trackAudible(song, t, g.only)) return 0;
  const layer = g.realtime && App.mode === 'adaptive' ? layerGainAt(song, t, App.intensity) : 1;
  return t.vol * layer;
}
/* Fade every track to its current layer level — slower than a fader move, like a game crossfade. */
function applyLayerFades(g, song) {
  song.tracks.forEach((t) => { const n = g.tracks[t.id]; if (n) n.gain.gain.setTargetAtTime(trackGain(g, song, t), g.ctx.currentTime, 0.35); });
}
function applyTrack(g, t, song, instant) {
  const n = g.tracks[t.id];
  if (!n) return;
  n.drive.curve = t.drive > 0.001 ? driveCurve(t.drive) : null;
  setParam(g, n.tone.frequency, t.tone, instant);
  setParam(g, n.gain.gain, trackGain(g, song, t), instant);
  setParam(g, n.pan.pan, t.pan, instant);
  setParam(g, n.rev.gain, t.rev, instant);
  setParam(g, n.dly.gain, t.dly, instant);
}

function syncGraphTracks(g, song) {
  const ids = new Set(song.tracks.map((t) => t.id));
  Object.keys(g.tracks).forEach((id) => { if (!ids.has(id)) removeTrackNodes(g, id); });
  song.tracks.forEach((t) => { if (!g.tracks[t.id]) addTrackNodes(g, t, song); else applyTrack(g, t, song); });
  applyMaster(g, song);
}

/* ---------- Synth voice ---------- */
function synthVoice(ctx, dest, p, midi, vel, t, dur) {
  const f = mtof(midi + 12 * (p.oct || 0));
  const peak = 0.2 * vel * (p.gain ?? 1);
  const a = Math.max(0.001, dur ? Math.min(p.a, dur * 0.9) : p.a);
  const d = Math.max(0.005, p.d);
  const s = clamp(p.s, 0, 1);
  const r = Math.max(0.01, p.r);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + a);
  env.gain.setTargetAtTime(peak * s, t + a, d / 3);

  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.Q.value = p.res;
  const kt = Math.pow(f / 261.63, 0.5);
  const cut = clamp(p.cut * kt, 30, 18000);
  filt.frequency.setValueAtTime(clamp(cut * Math.pow(2, p.env), 30, 18000), t);
  filt.frequency.setTargetAtTime(cut, t + 0.002, Math.max(0.005, p.fdec / 3));

  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
  const g1 = ctx.createGain(), g2 = ctx.createGain();
  o1.type = p.o1; o2.type = p.o2;
  o1.frequency.value = f;
  o2.frequency.value = f * Math.pow(2, (p.o2semi || 0) / 12);
  o2.detune.value = p.detune || 0;
  g1.gain.value = 1 - p.mix; g2.gain.value = p.mix;
  o1.connect(g1); o2.connect(g2); g1.connect(filt); g2.connect(filt); filt.connect(env); env.connect(dest);

  const nodes = [o1, o2];
  if (p.lfoDepth > 0) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = p.lfoRate;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(p.lfoDepth, t + 0.3);
    lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune);
    lfo.start(t);
    nodes.push(lfo);
  }
  o1.start(t); o2.start(t);
  o1.onended = () => { [o1, o2, g1, g2, filt, env].forEach((x) => x.disconnect()); };

  return {
    release(tr) {
      tr = Math.max(tr, t + 0.005);
      const el = tr - t;
      const v = el < a ? (peak * el) / a : peak * s + (peak - peak * s) * Math.exp(-(el - a) / (d / 3));
      env.gain.cancelScheduledValues(tr);
      env.gain.setValueAtTime(v, tr);
      env.gain.setTargetAtTime(0, tr, r / 4);
      const end = tr + r * 1.6 + 0.05;
      nodes.forEach((o) => o.stop(end));
    },
  };
}

/* ---------- Drum synthesis ---------- */
function drumEnv(ctx, t, peak, decay) {
  const e = ctx.createGain();
  e.gain.setValueAtTime(peak, t);
  e.gain.exponentialRampToValueAtTime(0.0008, t + Math.max(0.01, decay));
  return e;
}
function noiseSrc(g, t, dur) {
  const s = g.ctx.createBufferSource();
  s.buffer = g.noise;
  s.loop = true;
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur + 0.05);
  return s;
}
function metallic(g, t, dur, base) {
  const ctx = g.ctx, sum = ctx.createGain();
  sum.gain.value = 0.25;
  [2, 3, 4.16, 5.43, 6.79, 8.21].forEach((r) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = base * r;
    o.connect(sum);
    o.start(t); o.stop(t + dur + 0.05);
  });
  return sum;
}
function filt(ctx, type, freq, q) {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  if (q) f.Q.value = q;
  return f;
}

function playDrum(g, dest, id, t, vel, kitId, vs, sampleBuf) {
  const ctx = g.ctx;
  const kit = DRUM_KITS[kitId] || DRUM_KITS.classic;
  vs = vs || {};
  const tune = Math.pow(2, (vs.tune || 0) / 12);
  const dec = vs.decay ?? 1;
  const out = ctx.createGain();
  out.gain.value = vel * (vs.level ?? 1);
  const pan = ctx.createStereoPanner();
  pan.pan.value = vs.pan || 0;
  out.connect(pan);
  if (kit.lpf && !sampleBuf) { const lp = filt(ctx, 'lowpass', kit.lpf, 0.7); pan.connect(lp); lp.connect(dest); }
  else pan.connect(dest);

  if (sampleBuf) {
    const src = ctx.createBufferSource();
    src.buffer = sampleBuf;
    src.playbackRate.value = tune;
    const e = ctx.createGain();
    const len = sampleBuf.duration / tune;
    e.gain.setValueAtTime(1, t);
    if (dec < 1) e.gain.setTargetAtTime(0, t + len * dec * 0.6, len * dec * 0.15 + 0.005);
    src.connect(e); e.connect(out);
    src.start(t);
    src.stop(t + len + 0.05);
    if (id === 'ohh') g.openHats[dest.__id || 'x'] = e;
    if (id === 'chh') chokeOpenHat(g, dest, t);
    return;
  }

  switch (id) {
    case 'kick': {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(kit.kickF0 * tune, t);
      o.frequency.exponentialRampToValueAtTime(kit.kickF1 * tune, t + 0.09);
      const e = drumEnv(ctx, t, 1.0, kit.kickDecay * dec);
      o.connect(e); e.connect(out);
      o.start(t); o.stop(t + kit.kickDecay * dec + 0.05);
      const n = noiseSrc(g, t, 0.02), hp = filt(ctx, 'highpass', 2500), ce = drumEnv(ctx, t, kit.kickClick, 0.015);
      n.connect(hp); hp.connect(ce); ce.connect(out);
      break;
    }
    case 'snare': {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(kit.snareTone * tune * 1.4, t);
      o.frequency.exponentialRampToValueAtTime(kit.snareTone * tune, t + 0.03);
      const oe = drumEnv(ctx, t, 0.55, 0.12 * dec);
      o.connect(oe); oe.connect(out);
      o.start(t); o.stop(t + 0.2 * dec);
      const n = noiseSrc(g, t, kit.snareDecay * dec), hp = filt(ctx, 'highpass', kit.snareHP), ne = drumEnv(ctx, t, 0.7, kit.snareDecay * dec);
      n.connect(hp); hp.connect(ne); ne.connect(out);
      break;
    }
    case 'clap': {
      const n = noiseSrc(g, t, 0.35 * dec), bp = filt(ctx, 'bandpass', 1300 * tune, 1.1), e = ctx.createGain();
      e.gain.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) {
        e.gain.setValueAtTime(1, t + i * 0.011);
        e.gain.exponentialRampToValueAtTime(0.1, t + i * 0.011 + 0.0095);
      }
      e.gain.setValueAtTime(0.9, t + 0.034);
      e.gain.exponentialRampToValueAtTime(0.001, t + 0.034 + 0.22 * dec);
      n.connect(bp); bp.connect(e); e.connect(out);
      break;
    }
    case 'chh':
    case 'ohh': {
      const len = (id === 'chh' ? 0.05 : 0.4) * dec;
      const src = kit.metallic ? metallic(g, t, len, 40 * tune) : noiseSrc(g, t, len);
      const bp = filt(ctx, 'bandpass', 10000 * tune, 0.8), hp = filt(ctx, 'highpass', kit.hatHP * tune);
      const e = drumEnv(ctx, t, id === 'chh' ? 0.6 : 0.5, len);
      src.connect(bp); bp.connect(hp); hp.connect(e); e.connect(out);
      if (id === 'ohh') g.openHats[dest.__id || 'x'] = e;
      else chokeOpenHat(g, dest, t);
      break;
    }
    case 'ltom':
    case 'htom': {
      const base = (id === 'ltom' ? 95 : 150) * kit.tomMul * tune;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(base * 1.6, t);
      o.frequency.exponentialRampToValueAtTime(base, t + 0.12);
      const e = drumEnv(ctx, t, 0.9, 0.4 * dec);
      o.connect(e); e.connect(out);
      o.start(t); o.stop(t + 0.45 * dec);
      break;
    }
    case 'rim': {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = 1700 * tune;
      const e = drumEnv(ctx, t, 0.6, 0.03 * dec);
      o.connect(e); e.connect(out);
      o.start(t); o.stop(t + 0.06);
      const n = noiseSrc(g, t, 0.02), bp = filt(ctx, 'bandpass', 3000, 2), ne = drumEnv(ctx, t, 0.5, 0.015);
      n.connect(bp); bp.connect(ne); ne.connect(out);
      break;
    }
    case 'cow': {
      const sum = ctx.createGain();
      [540, 800].forEach((fq) => {
        const o = ctx.createOscillator();
        o.type = 'square'; o.frequency.value = fq * tune;
        o.connect(sum); o.start(t); o.stop(t + 0.4 * dec);
      });
      const bp = filt(ctx, 'bandpass', 800 * tune, 1.5), e = drumEnv(ctx, t, 0.35, 0.3 * dec);
      sum.connect(bp); bp.connect(e); e.connect(out);
      break;
    }
    case 'crash': {
      const len = 1.8 * dec;
      const m = metallic(g, t, len, 60 * tune), n = noiseSrc(g, t, len), hp = filt(ctx, 'highpass', 5000 * tune), e = drumEnv(ctx, t, 0.45, len);
      const ng = ctx.createGain(); ng.gain.value = 0.6;
      m.connect(hp); n.connect(ng); ng.connect(hp); hp.connect(e); e.connect(out);
      break;
    }
  }
}
function chokeOpenHat(g, dest, t) {
  const e = g.openHats[dest.__id || 'x'];
  if (e) {
    e.gain.cancelScheduledValues(t);
    e.gain.setTargetAtTime(0, t, 0.01);
    g.openHats[dest.__id || 'x'] = null;
  }
}

function metronomeClick(ctx, t, accent) {
  const o = ctx.createOscillator(), e = ctx.createGain();
  o.frequency.value = accent ? 1600 : 1000;
  e.gain.setValueAtTime(0.25, t);
  e.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  o.connect(e); e.connect(ctx.destination);
  o.start(t); o.stop(t + 0.06);
}

/* ---------- Step scheduling (shared by realtime + offline) ---------- */
function scheduleStep(g, song, pat, local, time, stepDur) {
  const swingOff = (song.swing / 100) * stepDur * 0.5;
  for (const t of song.tracks) {
    if (!trackAudible(song, t, g.only)) continue;
    const n = g.tracks[t.id];
    if (!n) continue;
    if (t.type === 'drum') {
      n.input.__id = t.id;
      const grid = pat.drums[t.id];
      const s = snd(t);
      if (!grid || !s) continue;
      const st = time + (local % 2 === 1 ? swingOff : 0);
      for (const v of DRUM_VOICES) {
        const vel = grid[v.id] && grid[v.id][local];
        if (vel > 0) {
          const vs = s.voices[v.id];
          playDrum(g, n.input, v.id, st, vel, s.kit, vs, vs && vs.sample ? App.sampleBuffer(vs.sample) : null);
        }
      }
    } else {
      const notes = pat.notes[t.id];
      const s = snd(t);
      if (!notes || !s) continue;
      for (const nt of notes) {
        if (Math.floor(nt.s + 1e-6) !== local) continue;
        const isOdd = Math.abs(nt.s - Math.round(nt.s)) < 1e-6 && Math.round(nt.s) % 2 === 1;
        const st = time + (nt.s - local) * stepDur + (isOdd ? swingOff : 0);
        const dur = nt.l * stepDur;
        synthVoice(g.ctx, n.input, s.synth, nt.p, nt.v, st, dur).release(st + dur);
      }
    }
  }
}

/* ---------- Realtime engine ---------- */
const Engine = {
  ctx: null,
  g: null,
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.g = buildGraph(this.ctx, App.song, { realtime: true });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  sync() { if (this.g) syncGraphTracks(this.g, App.song); },
  track(t) { if (this.g) applyTrack(this.g, t, App.song); },
  tracksAll() { if (this.g) App.song.tracks.forEach((t) => applyTrack(this.g, t, App.song)); },
  master() { if (this.g) applyMaster(this.g, App.song); },
  layers() { if (this.g) applyLayerFades(this.g, App.song); },
  rebuild() {
    if (!this.g) return;
    Object.keys(this.g.tracks).forEach((id) => removeTrackNodes(this.g, id));
    syncGraphTracks(this.g, App.song);
  },
};

const Seq = {
  playing: false,
  stepPos: 0,
  nextTime: 0,
  timer: null,
  queue: [],
  blocks() {
    const s = App.song;
    if (App.mode === 'pattern') return [App.sel.pattern];
    const list = s.arrangement.filter((i) => s.patterns[i]);
    return list.length ? list : [App.sel.pattern];
  },
  totalSteps() { return this.blocks().reduce((a, i) => a + App.song.patterns[i].bars * 16, 0); },
  locate(step) {
    const b = this.blocks();
    let acc = 0;
    for (let k = 0; k < b.length; k++) {
      const len = App.song.patterns[b[k]].bars * 16;
      if (step < acc + len) return { block: k, pat: b[k], local: step - acc };
      acc += len;
    }
    return { block: 0, pat: b[0], local: 0 };
  },
  /* ---- Adaptive mode: the game sits in a looping segment and asks to change segments.
     The change lands on the next beat / bar / segment end (score.adaptive.quant), optionally
     through a one-shot sting. This mirrors what the Unity player will do. ---- */
  adapt: null, // { cur, local, after, next: {target, sting} | null }
  loops() { return App.song.patterns.map((p, i) => (p.kind === 'sting' ? -1 : i)).filter((i) => i >= 0); },
  stingIndex(id) { const i = App.song.patterns.findIndex((p) => p.id === id && p.kind === 'sting'); return i < 0 ? null : i; },
  /* Ask for a segment (or a sting, which then returns to the current segment). */
  request(i, asSting = false) {
    if (App.mode !== 'adaptive') UI.setMode('adaptive', false);
    if (!this.playing) {
      if (asSting) return;
      this.start(0, i);
      return;
    }
    const A = this.adapt;
    if (asSting) A.next = { target: A.after ?? A.cur, sting: i };
    else if (i === A.cur && !A.after) A.next = null;
    else A.next = { target: i, sting: null };
  },
  atBoundary(local) {
    const q = App.song.adaptive.quant;
    return q === 'beat' ? local % 4 === 0 : q === 'bar' ? local % 16 === 0 : local === 0;
  },
  /* Advance the adaptive state by one step; returns the pattern + step to schedule. */
  adaptiveStep() {
    const A = this.adapt, pats = App.song.patterns;
    if (!pats[A.cur]) A.cur = this.loops()[0] ?? 0;
    if (A.local >= pats[A.cur].bars * 16) {
      A.local = 0;
      if (A.after !== null) {                       // a sting finished
        A.cur = A.next && A.next.sting === null ? A.next.target : A.after;
        if (A.next && A.next.sting === null) A.next = null;
        A.after = null;
      }
    }
    if (A.next && A.after === null && this.atBoundary(A.local)) {
      const target = A.next.target;
      const sting = A.next.sting ?? this.stingIndex(pats[target] && pats[target].entrySting);
      if (sting !== null && pats[sting]) { A.cur = sting; A.after = target; }
      else A.cur = target;
      A.local = 0;
      A.next = null;
    }
    return { pat: A.cur, local: A.local++ };
  },
  start(fromStep = 0, segment) {
    const ctx = Engine.ensure();
    if (App.mode === 'adaptive') {
      const loops = this.loops();
      const first = segment ?? (loops.includes(App.sel.pattern) ? App.sel.pattern : loops[0] ?? App.sel.pattern);
      this.adapt = { cur: first, local: 0, after: null, next: null };
      Engine.layers();
    }
    this.stepPos = fromStep;
    this.nextTime = ctx.currentTime + 0.06;
    this.playing = true;
    this.queue = [];
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
    UI.onTransport();
  },
  stop() {
    clearInterval(this.timer);
    this.playing = false;
    this.queue = [];
    this.adapt = null;
    Live.finishRecording();
    UI.onTransport();
  },
  tick() {
    const ctx = Engine.ctx, song = App.song;
    const stepDur = 60 / song.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      if (App.mode === 'adaptive' && this.adapt) {
        const { pat: pi, local } = this.adaptiveStep();
        scheduleStep(Engine.g, song, song.patterns[pi], local, this.nextTime, stepDur);
        if (App.metro && local % 4 === 0) metronomeClick(ctx, this.nextTime, local % 16 === 0);
        this.queue.push({ time: this.nextTime, step: local, pat: pi, local, block: -1, dur: stepDur });
        this.nextTime += stepDur;
        continue;
      }
      const total = this.totalSteps();
      if (this.stepPos >= total) {
        if (App.mode === 'song' && !App.loopSong) {
          const endAt = this.nextTime;
          clearInterval(this.timer);
          setTimeout(() => this.stop(), Math.max(0, (endAt - ctx.currentTime) * 1000));
          return;
        }
        this.stepPos = 0;
      }
      const loc = this.locate(this.stepPos);
      const pat = song.patterns[loc.pat];
      scheduleStep(Engine.g, song, pat, loc.local, this.nextTime, stepDur);
      if (App.metro && loc.local % 4 === 0) metronomeClick(ctx, this.nextTime, loc.local % 16 === 0);
      this.queue.push({ time: this.nextTime, step: this.stepPos, pat: loc.pat, local: loc.local, block: loc.block, dur: stepDur });
      this.nextTime += stepDur;
      this.stepPos++;
    }
    const cutoff = ctx.currentTime - 2;
    while (this.queue.length > 2 && this.queue[0].time < cutoff) this.queue.shift();
  },
  /* Where is the playhead right now (or at time t)? Returns {pat, local(float), block} */
  posAt(t) {
    if (!this.playing || !this.queue.length) return null;
    let e = null;
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].time <= t) { e = this.queue[i]; break; }
    if (!e) return null;
    return { pat: e.pat, block: e.block, step: e.step, local: e.local + clamp((t - e.time) / e.dur, 0, 0.999) };
  },
};

/* ---------- Offline rendering ---------- */
async function renderAudio({ source = 'song', repeats = 1, tail = 2, sampleRate = 44100, only = null }) {
  const song = App.song;
  let blocks;
  if (source === 'song') blocks = song.arrangement.filter((i) => song.patterns[i]);
  if (!blocks || !blocks.length) blocks = [];
  if (source !== 'song' || !blocks.length) blocks = new Array(repeats).fill(App.sel.pattern);
  return renderBlocks(song, blocks, { tail, sampleRate, only, start: 0.02 });
}
/* Render any score's patterns back to back. `start` offsets the first step (seconds). */
async function renderBlocks(song, blocks, { tail = 2, sampleRate = 44100, only = null, start = 0 } = {}) {
  const stepDur = 60 / song.bpm / 4;
  const totalSteps = blocks.reduce((a, i) => a + song.patterns[i].bars * 16, 0);
  const dur = start + totalSteps * stepDur + tail;
  const off = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);
  const g = buildGraph(off, song, { only });
  let time = start;
  for (const pi of blocks) {
    const pat = song.patterns[pi];
    for (let s = 0; s < pat.bars * 16; s++) {
      scheduleStep(g, song, pat, s, time, stepDur);
      time += stepDur;
    }
  }
  return off.startRendering();
}
