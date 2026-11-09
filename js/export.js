/* Export: WAV (16/24/32f), MP3 (lamejs, loaded on demand), MIDI (SMF type 1), stems, project JSON. */

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function safeName(s) { return (s || 'song').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'song'; }

/* Normalise peak to -0.3 dBFS if it clips; returns channel arrays. */
function getChannels(buf, normalize) {
  const chs = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  if (normalize) {
    let peak = 0;
    chs.forEach((d) => { for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } });
    const target = Math.pow(10, -0.3 / 20);
    if (peak > 0) {
      const k = target / peak;
      return chs.map((d) => { const o = new Float32Array(d.length); for (let i = 0; i < d.length; i++) o[i] = d[i] * k; return o; });
    }
  }
  return chs;
}

function encodeWAV(buf, bits = 16, normalize = true) {
  return encodeWAVChannels(getChannels(buf, normalize), buf.sampleRate, bits);
}
function encodeWAVChannels(chs, sr, bits = 16) {
  const nch = chs.length, len = chs[0].length;
  const float = bits === 32;
  const bps = bits / 8;
  const dataSize = len * nch * bps;
  const ab = new ArrayBuffer(44 + dataSize);
  const v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nch * bps, true); v.setUint16(32, nch * bps, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nch; c++) {
      const x = clamp(chs[c][i], -1, 1);
      if (bits === 16) { v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
      else if (bits === 24) {
        const s = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff);
        v.setUint8(o, s & 0xff); v.setUint8(o + 1, (s >> 8) & 0xff); v.setUint8(o + 2, (s >> 16) & 0xff); o += 3;
      } else { v.setFloat32(o, x, true); o += 4; }
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

async function encodeMP3(buf, kbps = 192, onProgress) {
  if (!window.lamejs) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js');
  const chs = getChannels(buf, true);
  const toI16 = (d) => { const o = new Int16Array(d.length); for (let i = 0; i < d.length; i++) { const x = clamp(d[i], -1, 1); o[i] = x < 0 ? x * 0x8000 : x * 0x7fff; } return o; };
  const L = toI16(chs[0]), R = toI16(chs[1] || chs[0]);
  const enc = new lamejs.Mp3Encoder(2, buf.sampleRate, kbps);
  const parts = [];
  const block = 1152;
  for (let i = 0; i < L.length; i += block) {
    const mp3 = enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block));
    if (mp3.length) parts.push(new Uint8Array(mp3));
    if (onProgress && i % (block * 400) === 0) { onProgress(i / L.length); await new Promise((r) => setTimeout(r, 0)); }
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: 'audio/mpeg' });
}

/* ---------- MIDI ---------- */
function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
function midiTrackChunk(events) {
  // events: [{tick, data:[...]}] (absolute ticks); sorted, note-offs before note-ons at same tick
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const bytes = [];
  let last = 0;
  for (const e of events) { bytes.push(...vlq(e.tick - last), ...e.data); last = e.tick; }
  bytes.push(0, 0xff, 0x2f, 0);
  const len = bytes.length;
  return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...bytes];
}
function textMeta(type, s) {
  const b = Array.from(new TextEncoder().encode(s));
  return [0xff, type, ...vlq(b.length), ...b];
}

function exportMIDI(source, repeats) {
  const song = App.song;
  const PPQ = 480, TPS = PPQ / 4; // ticks per 16th
  let blocks = source === 'song' ? song.arrangement.filter((i) => song.patterns[i]) : [];
  if (!blocks.length) blocks = new Array(repeats).fill(App.sel.pattern);

  const tracks = [];
  const tempo = Math.round(60000000 / song.bpm);
  tracks.push(midiTrackChunk([
    { tick: 0, order: 0, data: textMeta(0x03, song.name) },
    { tick: 0, order: 0, data: [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
    { tick: 0, order: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  ]));

  let ch = 0;
  for (const t of song.tracks) {
    const events = [{ tick: 0, order: 0, data: textMeta(0x03, t.name) }];
    let channel;
    if (t.type === 'drum') channel = 9;
    else { if (ch === 9) ch++; channel = ch++ % 16; events.push({ tick: 0, order: 0, data: [0xc0 | channel, (snd(t).synth.gm ?? 0) & 127] }); }
    events.push({ tick: 0, order: 0, data: [0xb0 | channel, 7, Math.round(clamp(t.vol, 0, 1) * 127)] });
    events.push({ tick: 0, order: 0, data: [0xb0 | channel, 10, Math.round((t.pan + 1) * 63.5)] });
    let offset = 0;
    for (const pi of blocks) {
      const pat = song.patterns[pi];
      if (t.type === 'drum') {
        const grid = pat.drums[t.id] || {};
        for (const v of DRUM_VOICES) {
          const row = grid[v.id] || [];
          row.forEach((vel, s) => {
            if (!(vel > 0) || s >= pat.bars * 16) return;
            const tk = offset + s * TPS, vv = clamp(Math.round(vel * 127), 1, 127);
            events.push({ tick: tk, order: 2, data: [0x90 | 9, v.gm, vv] });
            events.push({ tick: tk + TPS / 2, order: 1, data: [0x80 | 9, v.gm, 0] });
          });
        }
      } else {
        for (const n of pat.notes[t.id] || []) {
          const p = clamp(n.p + 12 * (snd(t).synth.oct || 0), 0, 127);
          const tk = Math.round(offset + n.s * TPS), len = Math.max(1, Math.round(n.l * TPS));
          events.push({ tick: tk, order: 2, data: [0x90 | channel, p, clamp(Math.round(n.v * 127), 1, 127)] });
          events.push({ tick: tk + len, order: 1, data: [0x80 | channel, p, 0] });
        }
      }
      offset += pat.bars * 16 * TPS;
    }
    tracks.push(midiTrackChunk(events));
  }
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255];
  const all = new Uint8Array(header.length + tracks.reduce((a, t) => a + t.length, 0));
  all.set(header, 0);
  let o = header.length;
  tracks.forEach((t) => { all.set(t, o); o += t.length; });
  return new Blob([all], { type: 'audio/midi' });
}

/* ---------- MIDI import (notes into current pattern / new patterns) ---------- */
function parseMIDI(ab) {
  const d = new DataView(ab);
  let p = 0;
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const rdVlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  if (u32() !== 0x4d546864) throw new Error('Not a MIDI file');
  u32(); u16(); const ntr = u16(); const div = u16();
  const out = []; // {ch, p, v, start, len} in ticks
  for (let tr = 0; tr < ntr; tr++) {
    if (u32() !== 0x4d54726b) throw new Error('Bad track chunk');
    const len = u32(), end = p + len;
    let tick = 0, status = 0;
    const open = {};
    while (p < end) {
      tick += rdVlq();
      let b = d.getUint8(p);
      if (b & 0x80) { status = b; p++; }
      const type = status & 0xf0, ch = status & 0x0f;
      if (status === 0xff) { p++; const l = rdVlq(); p += l; }
      else if (status === 0xf0 || status === 0xf7) { const l = rdVlq(); p += l; }
      else if (type === 0x90 || type === 0x80) {
        const note = d.getUint8(p++), vel = d.getUint8(p++);
        const key = ch + ':' + note;
        if (type === 0x90 && vel > 0) open[key] = { ch, p: note, v: vel / 127, start: tick };
        else if (open[key]) { const o = open[key]; o.len = tick - o.start; out.push(o); delete open[key]; }
      } else if (type === 0xc0 || type === 0xd0) p += 1;
      else p += 2;
    }
    p = end;
  }
  return { notes: out, tps: div / 4 };
}
