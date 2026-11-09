/* Unity export: renders each score's adaptive setup into game-ready files.

   Per score folder:
     manifest.json            — tempo, layers, segments, stings, transition rule (read by AdaptiveMusicPlayer.cs)
     <Segment>_<Layer>.wav    — one stem per intensity layer, all exactly the segment's length,
                                rendered as a seamless loop (reverb/delay tails wrap into the start)
     <Sting>.wav              — one-shot stings, full mix, with their natural tail
   Package root:
     AdaptiveMusicPlayer.cs   — the Unity runtime script

   Loudness: each score gets one gain so its loudest segment (all layers) hits the target
   LUFS, capped so peaks stay under -1 dBFS. Relative levels inside a score are kept. */

const UnityExport = {
  /* ---------- rendering ---------- */
  stepSeconds(song) { return 60 / song.bpm / 4; },
  /* How long effects ring after a note stops — used to warm a loop up to its steady state. */
  tailSeconds(song) {
    const m = (song && song.mix) || App.style.mix;
    const echo = m.dlyFb > 0.05 ? Math.log(0.001) / Math.log(m.dlyFb) * (DELAY_DIVS[m.dlyDiv] || 0.75) * 0.6 : 0;
    return Math.min(12, Math.max(m.revSize, echo) + 1.5);
  },
  /* Render one loop of `pi` for the tracks matching `only`, as heard on its Nth repeat
     (so tails from the previous pass are already in the start). Returns Float32Array channels. */
  async renderLoop(song, pi, only, sr) {
    const pat = song.patterns[pi];
    const loopSec = pat.bars * 16 * this.stepSeconds(song);
    const warm = Math.max(1, Math.ceil(this.tailSeconds(song) / loopSec));
    const buf = await renderBlocks(song, new Array(warm + 1).fill(pi), { tail: 0, sampleRate: sr, only, start: 0 });
    const L = Math.round(loopSec * sr), from = warm * L;
    const chs = [0, 1].map((c) => buf.getChannelData(c).slice(from, from + L));
    return { chs, length: L };
  },
  async renderSting(song, pi, sr) {
    const pat = song.patterns[pi];
    const musical = Math.round(pat.bars * 16 * this.stepSeconds(song) * sr);
    const buf = await renderBlocks(song, [pi], { tail: this.tailSeconds(song), sampleRate: sr, only: (t) => !t.mute, start: 0 });
    // Trim trailing silence after the musical end.
    const chs = [0, 1].map((c) => buf.getChannelData(c));
    let end = chs[0].length;
    while (end > musical && Math.abs(chs[0][end - 1]) < 1e-4 && Math.abs(chs[1][end - 1]) < 1e-4) end--;
    return { chs: chs.map((d) => d.slice(0, Math.max(end, musical))), musical };
  },

  /* ---------- loudness (ITU-R BS.1770 / EBU R128 style, gated) ---------- */
  async lufs(chs, sr) {
    const len = chs[0].length;
    if (!len) return -Infinity;
    const off = new OfflineAudioContext(2, len, sr);
    const b = off.createBuffer(2, len, sr);
    chs.forEach((d, i) => b.copyToChannel(d, i));
    const src = off.createBufferSource(); src.buffer = b;
    const shelf = off.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1681.97; shelf.gain.value = 4;
    const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38.13; hp.Q.value = 0.5;
    src.connect(shelf); shelf.connect(hp); hp.connect(off.destination); src.start();
    const k = await off.startRendering();
    const L = k.getChannelData(0), R = k.getChannelData(1);
    const block = Math.min(len, Math.round(0.4 * sr)), hop = Math.max(1, Math.round(0.1 * sr));
    const z = [];
    for (let s = 0; s + block <= len; s += hop) {
      let sum = 0;
      for (let i = s; i < s + block; i++) sum += L[i] * L[i] + R[i] * R[i];
      z.push(sum / block);
    }
    const loud = (ms) => -0.691 + 10 * Math.log10(ms);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const abs = z.filter((ms) => ms > 0 && loud(ms) > -70);
    if (!abs.length) return -Infinity;
    const rel = loud(mean(abs)) - 10;
    const gated = abs.filter((ms) => loud(ms) > rel);
    return loud(mean(gated.length ? gated : abs));
  },
  peak(chs) { let p = 0; chs.forEach((d) => { for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; } }); return p; },
  scale(chs, k) { chs.forEach((d) => { for (let i = 0; i < d.length; i++) d[i] *= k; }); },

  /* ---------- one score ---------- */
  async buildScore(song, opts, progress) {
    const sr = opts.sampleRate;
    const segs = song.patterns.map((p, i) => ({ p, i })).filter((x) => x.p.kind !== 'sting');
    const stings = song.patterns.map((p, i) => ({ p, i })).filter((x) => x.p.kind === 'sting');
    if (!segs.length) throw new Error(`“${song.name}” has no segments (Adaptive tab)`);
    const used = new Set();
    const fileName = (base) => { let n = safeName(base), k = 2; while (used.has(n)) n = `${safeName(base)}_${k++}`; used.add(n); return n + '.wav'; };

    const segOut = [], audio = [];
    let loudest = -Infinity, mixPeak = 0;
    for (const { p, i } of segs) {
      const stems = [];
      let mix = null;
      for (const L of song.layers) {
        progress(`${song.name}: ${p.name} · ${L.name}`);
        const r = await this.renderLoop(song, i, (t) => t.layer === L.id && !t.mute, sr);
        if (!mix) mix = r.chs.map((d) => new Float32Array(d.length));
        r.chs.forEach((d, c) => { for (let n = 0; n < d.length; n++) mix[c][n] += d[n]; });
        const silent = this.peak(r.chs) < 1e-5;
        const file = silent ? '' : fileName(`${p.name}_${L.name}`);
        stems.push(file);
        if (!silent) audio.push({ file, chs: r.chs });
      }
      const lengthSamples = Math.round(p.bars * 16 * this.stepSeconds(song) * sr);
      if (opts.targetLufs !== null) loudest = Math.max(loudest, await this.lufs(mix, sr));
      mixPeak = Math.max(mixPeak, this.peak(mix));
      const sting = p.entrySting && stings.find((x) => x.p.id === p.entrySting);
      segOut.push({ name: p.name, bars: p.bars, lengthSamples, entrySting: sting ? sting.p.name : '', stems });
    }
    const stingOut = [];
    for (const { p, i } of stings) {
      progress(`${song.name}: sting ${p.name}`);
      const r = await this.renderSting(song, i, sr);
      const file = fileName(p.name);
      audio.push({ file, chs: r.chs, sting: true });
      mixPeak = Math.max(mixPeak, this.peak(r.chs));
      stingOut.push({ name: p.name, bars: p.bars, musicalLengthSamples: r.musical, lengthSamples: r.chs[0].length, file });
    }

    // One gain for the whole score: loudest segment → target, peaks kept under -1 dBFS.
    let gainDb = 0;
    if (opts.targetLufs !== null && isFinite(loudest)) gainDb = opts.targetLufs - loudest;
    const ceiling = Math.pow(10, -1 / 20);
    if (mixPeak * Math.pow(10, gainDb / 20) > ceiling) gainDb = 20 * Math.log10(ceiling / mixPeak);
    const k = Math.pow(10, gainDb / 20);
    audio.forEach((a) => this.scale(a.chs, k));

    const manifest = {
      format: 'SynthStudio.AdaptiveMusic', version: 1,
      game: App.project.name, score: song.name,
      bpm: song.bpm, beatsPerBar: 4, sampleRate: sr,
      quantize: song.adaptive.quant,
      startSegment: segOut[0].name,
      layers: song.layers.map((l) => ({ name: l.name })),
      segments: segOut,
      stings: stingOut,
      loudness: { targetLufs: opts.targetLufs, measuredLufs: isFinite(loudest) ? +loudest.toFixed(1) : null, gainDb: +gainDb.toFixed(2) },
    };
    const files = [{ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }];
    for (const a of audio) files.push({ name: a.file, data: new Uint8Array(await encodeWAVChannels(a.chs, sr, opts.bits).arrayBuffer()) });
    return { folder: safeName(song.name), files, manifest };
  },

  /* ---------- whole export ---------- */
  async run(opts, progress) {
    const scores = opts.scope === 'all' ? App.project.scores : [App.song];
    const out = [];
    for (const s of scores) out.push(await this.buildScore(s, opts, progress));
    const scripts = [];
    for (const name of ['AdaptiveMusicPlayer.cs', 'MusicCues.cs']) {
      try { const r = await fetch('unity/' + name, { cache: 'no-cache' }); if (r.ok) scripts.push({ name, data: new Uint8Array(await r.arrayBuffer()) }); } catch (e) { /* file:// — skip */ }
    }
    const root = safeName(App.project.name) + '_Music';
    const entries = [];
    out.forEach((sc) => sc.files.forEach((f) => entries.push({ path: `${root}/${sc.folder}/${f.name}`, data: f.data })));
    scripts.forEach((s) => entries.push({ path: `${root}/${s.name}`, data: s.data }));
    return { root, entries, scores: out, hasScript: scripts.length > 0 };
  },

  /* Write into a folder the user picks (Chrome/Edge), e.g. the Unity project's Assets folder. */
  async saveToFolder(dir, entries) {
    for (const e of entries) {
      const parts = e.path.split('/');
      let d = dir;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await fh.createWritable();
      await w.write(e.data);
      await w.close();
    }
  },
};

/* ---------- Minimal ZIP writer (store, no compression — WAV barely compresses anyway) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(d) { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function makeZip(entries) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.path), crc = crc32(e.data), size = e.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, e.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
