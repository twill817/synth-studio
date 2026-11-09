/* UI: top bar, sidebar, beat grid, arrangement, mixer, instrument panel, keyboard, export dialog, shortcuts. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const patLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : 'P' + (i + 1));
const patColor = (i) => `hsl(${(i * 67 + 200) % 360} 65% 66%)`;

/* Short on-screen notice. With an action ({label, fn}) it gets a button, e.g. Undo.
   (Native confirm/alert are avoided: some embedded browsers suppress them silently.) */
function toast(msg, ms = 2200, action) {
  if (action) $$('.toast.has-action').forEach((x) => x.remove());
  const t = document.createElement('div');
  t.className = 'toast' + (action ? ' has-action' : '');
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { t.remove(); action.fn(); };
    t.appendChild(b);
  }
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.remove(), 400); }, ms);
}
const undoToast = (msg) => toast(msg, 6000, { label: 'Undo', fn: () => App.undo() });

/* ---------- value formatting + generic slider binding ---------- */
function fmtv(v, f) {
  switch (f) {
    case 'hz': return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + '';
    case 'pct': return Math.round(v * 100) + '%';
    case 'db': return (v > 0 ? '+' : '') + (+v).toFixed(1) + 'dB';
    case 's': return v < 1 ? Math.round(v * 1000) + 'ms' : (+v).toFixed(2) + 's';
    case 'st': return (v > 0 ? '+' : '') + v + 'st';
    case 'ct': return Math.round(v) + 'c';
    case 'pan': return Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100);
    case 'int': return (v > 0 ? '+' : '') + Math.round(v);
    case 'oct': return (+v).toFixed(1) + 'oct';
    default: return (+v).toFixed(2);
  }
}
function ctl(label, k, val, min, max, step, fmt = '', cls = '') {
  const log = fmt === 'hz' && min > 0;
  const sv = log ? Math.round((1000 * Math.log(val / min)) / Math.log(max / min)) : val;
  const range = log ? `data-min="${min}" data-max="${max}" min="0" max="1000" step="1"` : `min="${min}" max="${max}" step="${step}"`;
  return `<label><span><i>${label}</i><b>${fmtv(val, fmt)}</b></span><input type="range" class="${cls}" data-k="${k}" data-fmt="${fmt}" ${range} value="${sv}"></label>`;
}
function readVal(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.dataset.min) { const mn = +el.dataset.min, mx = +el.dataset.max; return mn * Math.pow(mx / mn, +el.value / 1000); }
  if (el.type === 'range' || el.type === 'number' || el.dataset.num !== undefined) return parseFloat(el.value);
  return el.value;
}
/* Wires every [data-k] control inside root. resolve(el) -> { obj, after(el, v) } */
function wire(root, resolve) {
  root.addEventListener('pointerdown', (e) => { if (e.target.matches('[data-k]')) App.pushUndo(); });
  const handler = (e) => {
    const el = e.target;
    if (!el.matches('[data-k]')) return;
    const r = resolve(el);
    if (!r || !r.obj) return;
    const v = readVal(el);
    r.obj[el.dataset.k] = v;
    const b = el.closest('label') && el.closest('label').querySelector('b');
    if (b) b.textContent = fmtv(v, el.dataset.fmt);
    if (r.after) r.after(el, v);
    App.changed();
  };
  root.addEventListener('input', handler);
}

/* Turn a text element into an inline text box. commit(newName) gets the trimmed new
   name, or null when cancelled / empty / unchanged (caller re-renders either way). */
function inlineRename(el, current, commit) {
  if (!el || el.querySelector('input')) return;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'inline-edit'; inp.value = current; inp.maxLength = 40;
  inp.setAttribute('aria-label', 'Name');
  const drag = el.closest('[draggable="true"]');
  if (drag) drag.setAttribute('draggable', 'false');
  el.textContent = '';
  el.appendChild(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    commit(save && v && v !== current ? v : null);
  };
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('keyup', (e) => e.stopPropagation());
  inp.addEventListener('blur', () => finish(true));
  ['click', 'dblclick', 'pointerdown', 'contextmenu'].forEach((t) => inp.addEventListener(t, (e) => e.stopPropagation()));
}

const UI = {
  view: 'beat',
  beatTrackId: null,

  init() {
    this.initTopbar();
    this.initSidebar();
    this.initBeat();
    this.initArrange();
    this.initMixer();
    this.initStyle();
    this.initAdaptive();
    $('#btnLoop').hidden = App.mode !== 'song';
    this.initInst();
    this.initKeyboard();
    this.initExport();
    this.initShortcuts();
    Roll.init();
    this.renderAll();
    requestAnimationFrame(() => this.frame());
    window.addEventListener('resize', () => { this.renderKeyboard(); Roll.draw(); });
    document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });
  },

  renderAll() {
    const s = App.song;
    $('#songName').value = App.project.name;
    $('#bpm').value = s.bpm;
    $('#swing').value = s.swing;
    $('#songKey').value = s.key;
    $('#songScale').value = s.scale;
    this.renderScores();
    this.renderAddTrack();
    this.renderStyle();
    this.renderAdaptive();
    this.renderTracks();
    this.renderPatterns();
    this.renderBeat();
    this.renderRollBar();
    this.renderArrange();
    this.renderMixer();
    this.renderInst();
    this.renderKeyboard();
    Roll.sel.clear();
    Roll.draw();
  },

  /* ---------- top bar ---------- */
  initTopbar() {
    $('#songName').addEventListener('change', (e) => { App.pushUndo(); App.project.name = e.target.value.trim() || 'My Game'; e.target.value = App.project.name; App.changed(); });
    $('#bpm').addEventListener('change', (e) => {
      App.pushUndo();
      App.song.bpm = clamp(Math.round(+e.target.value || 120), 40, 260);
      e.target.value = App.song.bpm;
      Engine.master(); App.changed();
    });
    $('#swing').addEventListener('input', (e) => { App.song.swing = +e.target.value; App.changed(); });
    $('#btnPlay').onclick = () => (Seq.playing ? Seq.stop() : Seq.start());
    $('#btnStop').onclick = () => { Seq.stop(); Live.allOff(); };
    $('#btnRec').onclick = () => this.toggleRec();
    $$('#modeSeg button').forEach((b) => (b.onclick = () => this.setMode(b.dataset.mode)));
    $('#btnLoop').onclick = (e) => { App.loopSong = !App.loopSong; e.target.classList.toggle('on', App.loopSong); };
    $('#btnMetro').onclick = (e) => { App.metro = !App.metro; e.target.classList.toggle('on', App.metro); };
    $('#btnUndo').onclick = () => App.undo();
    $('#btnRedo').onclick = () => App.redo();
    $('#btnNew').onclick = () => this.newProject();
    $('#btnSave').onclick = () => this.saveProject();
    $('#btnOpen').onclick = () => $('#fileOpen').click();
    $('#fileOpen').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        if (/\.midi?$/i.test(f.name)) { this.importMIDI(await f.arrayBuffer(), f.name); }
        else { await App.loadProject(await f.text()); toast('Opened ' + f.name); }
      } catch (err) { toast('Could not open file: ' + err.message, 5000); }
    };
  },
  setMode(m, restart = true) {
    const wasPlaying = Seq.playing;
    if (wasPlaying) Seq.stop();
    App.mode = m;
    $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('#btnLoop').hidden = m !== 'song'; // looping the song only means something in Song mode
    Engine.layers();                     // layer fades apply only in Adaptive mode
    this.renderAdaptive();
    if (wasPlaying && restart) Seq.start();
  },
  toggleRec() {
    App.recording = !App.recording;
    $('#btnRec').classList.toggle('on', App.recording);
    if (App.recording && !Seq.playing) Seq.start();
    if (!App.recording) Live.finishRecording();
  },
  onTransport() {
    $('#btnPlay').classList.toggle('on', Seq.playing);
    $('#btnPlay').textContent = Seq.playing ? '❚❚' : '▶';
    if (!Seq.playing) {
      $('#posDisplay').textContent = '1.1.1';
      this.markBeatStep(-1);
      $$('.pattern-item.playing, .arr-block.playing').forEach((e) => e.classList.remove('playing'));
      Roll.draw();
    }
  },
  newProject() {
    Seq.stop();
    App.pushUndo();
    App.replaceProject(blankProject(), true);
    App.resetSelection();
    this.renderAll();
    undoToast('Started a new game project');
  },
  saveProject() { download(App.projectBlob(), safeName(App.project.name) + '.synth.json'); toast('Project saved to your downloads'); },
  importMIDI(ab, fname) {
    const { notes, tps } = parseMIDI(ab);
    if (!notes.length) { toast('No notes found in that MIDI file.', 4000); return; }
    App.pushUndo();
    const song = App.song;
    const maxStep = Math.max(...notes.map((n) => (n.start + n.len) / tps));
    const bars = Math.max(1, Math.ceil(maxStep / 16));
    const nPat = Math.ceil(bars / 4);
    const base = song.patterns.length;
    const pats = [];
    for (let i = 0; i < nPat; i++) { const p = makePattern('MIDI ' + (i + 1), 4); song.patterns.push(p); pats.push(p); }
    const chans = [...new Set(notes.map((n) => n.ch))];
    const trackFor = {};
    const roleFor = (kind, name) => {
      let r = App.style.roles.find((x) => (kind === 'drum' ? x.type === 'drum' : x.name === name));
      if (!r) { r = makeRole(kind, name); App.style.roles.push(r); }
      return r;
    };
    chans.forEach((ch) => {
      if (ch === 9) {
        let d = song.tracks.find((t) => t.type === 'drum');
        if (!d) { d = makeTrack(roleFor('drum', 'Drums')); song.tracks.push(d); }
        trackFor[ch] = d;
      } else { const t = makeTrack(roleFor('piano', 'Piano'), 'MIDI ch ' + (ch + 1)); song.tracks.push(t); trackFor[ch] = t; }
    });
    ensureAll();
    const gmMap = { 35: 'kick', 36: 'kick', 37: 'rim', 38: 'snare', 40: 'snare', 39: 'clap', 42: 'chh', 44: 'chh', 46: 'ohh', 41: 'ltom', 43: 'ltom', 45: 'ltom', 47: 'htom', 48: 'htom', 50: 'htom', 49: 'crash', 57: 'crash', 51: 'chh', 56: 'cow' };
    notes.forEach((n) => {
      const step = n.start / tps, pi = Math.floor(step / 64), local = step - pi * 64;
      const pat = pats[pi], t = trackFor[n.ch];
      if (!pat) return;
      if (t.type === 'drum') {
        const v = gmMap[n.p];
        const s = Math.round(local);
        if (v && s < 64) pat.drums[t.id][v][s] = Math.max(pat.drums[t.id][v][s], n.v);
      } else pat.notes[t.id].push({ s: Math.round(local * 2) / 2, l: Math.max(0.5, Math.round((n.len / tps) * 2) / 2), p: n.p, v: n.v });
    });
    song.arrangement.push(...pats.map((_, i) => base + i));
    App.sel.pattern = base;
    Engine.sync(); this.renderAll(); App.changed();
    toast(`Imported ${notes.length} notes from ${fname} into ${nPat} pattern(s)`);
  },

  /* ---------- sidebar ---------- */
  initSidebar() {
    $('#btnAddTrack').onclick = () => {
      const [kind, val] = $('#addTrackPreset').value.split(':');
      App.pushUndo();
      let role = App.role(val);
      if (kind === 'new') { role = makeRole(val); App.style.roles.push(role); }
      const n = App.song.tracks.filter((x) => x.role === role.id).length;
      const t = makeTrack(role, n ? `${role.name} ${n + 1}` : role.name);
      App.song.tracks.push(t); ensureAll(); App.sel.track = t.id; App.sel.role = null;
      if (t.type === 'drum') this.beatTrackId = t.id;
      Engine.sync(); this.renderAll(); App.changed();
      if (kind === 'new') toast(`Added “${role.name}” to the game style`);
    };
    this.initScores();
    const tl = $('#trackList');
    tl.addEventListener('click', (e) => {
      const it = e.target.closest('.track-item');
      if (!it) return;
      const t = App.track(it.dataset.id);
      const act = e.target.dataset.act;
      if (act === 'rename') { this.selectTrack(t.id); this.renameTrack(t.id); return; }
      if (act === 'm' || act === 's') {
        App.pushUndo();
        t[act === 'm' ? 'mute' : 'solo'] = !t[act === 'm' ? 'mute' : 'solo'];
        Engine.tracksAll(); this.renderTracks(); this.renderMixer(); App.changed();
        return;
      }
      if (act === 'del') {
        if (App.song.tracks.length <= 1) return toast('A song needs at least one track');
        App.pushUndo();
        App.song.tracks = App.song.tracks.filter((x) => x !== t);
        App.song.patterns.forEach((p) => { delete p.drums[t.id]; delete p.notes[t.id]; });
        if (App.sel.track === t.id) App.sel.track = App.song.tracks[0].id;
        Engine.sync(); this.renderAll(); App.changed();
        undoToast(`Deleted track "${t.name}"`);
        return;
      }
      this.selectTrack(t.id);
    });
    tl.addEventListener('dblclick', (e) => {
      const it = e.target.closest('.track-item');
      if (!it || e.target.closest('button')) return;
      this.renameTrack(it.dataset.id);
    });

    const pl = $('#patternList');
    pl.addEventListener('click', (e) => {
      const it = e.target.closest('.pattern-item');
      if (!it) return;
      if (e.target.dataset.act === 'del') return this.deletePattern(+it.dataset.i);
      this.pickPattern(+it.dataset.i);
      if (e.target.dataset.act === 'rename') this.renamePattern(+it.dataset.i, 'side');
    });
    pl.addEventListener('dblclick', (e) => {
      const it = e.target.closest('.pattern-item');
      if (!it || e.target.closest('button')) return;
      this.renamePattern(+it.dataset.i, 'side');
    });
    $('#btnAddPattern').onclick = () => {
      App.pushUndo();
      const p = makePattern('Pattern ' + (App.song.patterns.length + 1), App.pattern() ? App.pattern().bars : 2);
      App.song.patterns.push(p); ensurePattern(p);
      this.selectPattern(App.song.patterns.length - 1); App.changed();
    };
    $('#btnDupPattern').onclick = () => {
      App.pushUndo();
      const p = JSON.parse(JSON.stringify(App.pattern()));
      p.id = uid(); p.name += ' copy';
      App.song.patterns.splice(App.sel.pattern + 1, 0, p);
      App.song.arrangement = App.song.arrangement.map((i) => (i > App.sel.pattern ? i + 1 : i));
      this.selectPattern(App.sel.pattern + 1); App.changed();
    };
    $('#btnDelPattern').onclick = () => this.deletePattern(App.sel.pattern);
  },
  /* Delete pattern k, drop it from the song, and keep the selection on a sensible neighbour. */
  deletePattern(k) {
    const s = App.song;
    if (s.patterns.length <= 1) return toast('A song needs at least one pattern');
    const name = s.patterns[k].name;
    const uses = s.arrangement.filter((i) => i === k).length;
    App.pushUndo();
    s.patterns.splice(k, 1);
    s.arrangement = s.arrangement.filter((i) => i !== k).map((i) => (i > k ? i - 1 : i));
    if (App.sel.pattern > k) App.sel.pattern--;
    App.sel.pattern = Math.min(App.sel.pattern, s.patterns.length - 1);
    this.renderAll(); App.changed();
    undoToast(`Deleted pattern "${name}"` + (uses ? ` (and ${uses} block${uses > 1 ? 's' : ''} from the song)` : ''));
  },
  /* Inline rename. Elements are looked up fresh because clicks re-render the lists. */
  renamePattern(i, where, k) {
    const p = App.song.patterns[i];
    const el = where === 'side' ? $(`.pattern-item[data-i="${i}"] .name`)
      : where === 'palette' ? $(`.arr-pat[data-i="${i}"] .name`)
      : $(`.arr-block[data-k="${k}"] small`);
    inlineRename(el, p.name, (v) => {
      if (v) { App.pushUndo(); p.name = v; App.changed(); }
      this.renderPatterns(); this.renderArrange(); this.renderAdaptive();
    });
  },
  renameTrack(id) {
    const t = App.track(id);
    inlineRename($(`.track-item[data-id="${id}"] .name`), t.name, (v) => {
      if (v) { App.pushUndo(); t.name = v; App.changed(); }
      this.renderTracks(); this.renderMixer(); this.renderRollBar(); this.renderInst(); this.renderKeyboard(); this.renderAdaptive();
      $$('#beatTrack option').forEach((o) => { if (o.value === id) o.textContent = t.name; });
    });
  },
  selectTrack(id) {
    App.sel.track = id;
    if (App.sel.role) { App.sel.role = null; this.renderStyle(); }
    const t = App.track(id);
    if (t.type === 'drum') { this.beatTrackId = id; this.renderBeat(); }
    Roll.sel.clear();
    $$('.track-item').forEach((e) => e.classList.toggle('sel', e.dataset.id === id));
    this.renderRollBar(); this.renderInst(); this.renderKeyboard(); Roll.scrollToNotes();
  },
  /* Selection from a click: move the highlight without rebuilding the list, so the
     elements survive for a double-click rename. */
  pickPattern(i) {
    if (i === App.sel.pattern) return;
    App.sel.pattern = i;
    Roll.sel.clear();
    $$('.pattern-item').forEach((e) => e.classList.toggle('sel', +e.dataset.i === i));
    $$('.barsSel').forEach((s) => (s.value = App.pattern().bars));
    this.renderBeat(); this.renderRollBar(); Roll.draw();
  },
  selectPattern(i) {
    App.sel.pattern = i;
    Roll.sel.clear();
    this.renderPatterns(); this.renderBeat(); this.renderRollBar(); this.renderArrange(); this.renderAdaptive(); Roll.draw();
  },
  /* ---------- scores (one per level / cue) ---------- */
  initScores() {
    const sl = $('#scoreList');
    sl.addEventListener('click', (e) => {
      const it = e.target.closest('.score-item');
      if (!it) return;
      const i = +it.dataset.i, act = e.target.dataset.act;
      if (act === 'del') return this.deleteScore(i);
      App.switchScore(i);
      if (act === 'rename') this.renameScore(i);
    });
    sl.addEventListener('dblclick', (e) => {
      const it = e.target.closest('.score-item');
      if (it && !e.target.closest('button')) this.renameScore(+it.dataset.i);
    });
    $('#btnAddScore').onclick = () => {
      App.pushUndo();
      const s = makeScore('Level ' + (App.project.scores.length + 1));
      App.style.roles.forEach((r) => s.tracks.push(makeTrack(r)));
      s.patterns.push(makePattern('Main', 2));
      s.arrangement = [0];
      ensureAll(s);
      App.project.scores.push(s);
      App.switchScore(App.project.scores.length - 1);
      toast(`New score uses the game style: ${App.style.roles.length} roles, ${NOTE_NAMES[s.key]} ${SCALES[s.scale].name}, ${s.bpm} BPM`);
    };
    $('#btnDupScore').onclick = () => {
      App.pushUndo();
      App.project.scores.splice(App.project.current + 1, 0, duplicateScore(App.song, App.song.name + ' copy'));
      App.switchScore(App.project.current + 1);
    };
  },
  renderScores() {
    const many = App.project.scores.length > 1;
    $('#scoreList').innerHTML = App.project.scores.map((s, i) => {
      const custom = s.tracks.filter((t) => t.sound).length + (s.mix ? 1 : 0);
      const what = [s.tracks.filter((t) => t.sound).length ? `${s.tracks.filter((t) => t.sound).length} custom sound(s)` : '', s.mix ? 'custom mix' : ''].filter(Boolean).join(' + ');
      return `<div class="score-item ${i === App.project.current ? 'sel' : ''}" data-i="${i}" title="Double-click name to rename">
        <span class="name">${esc(s.name)}</span><button class="edit" data-act="rename" title="Rename score">✎</button>
        ${custom ? `<span class="flavor" title="Level flavor: ${what}">✦${custom}</span>` : ''}
        ${many ? '<button class="x" data-act="del" title="Delete score">✕</button>' : ''}
      </div>`;
    }).join('');
  },
  renameScore(i) {
    const s = App.project.scores[i];
    inlineRename($(`.score-item[data-i="${i}"] .name`), s.name, (v) => {
      if (v) { App.pushUndo(); s.name = v; App.changed(); }
      this.renderScores();
    });
  },
  deleteScore(i) {
    const p = App.project;
    if (p.scores.length <= 1) return;
    const name = p.scores[i].name;
    App.pushUndo();
    const wasCurrent = i === p.current;
    p.scores.splice(i, 1);
    if (p.current > i || p.current >= p.scores.length) p.current = Math.max(0, p.current - 1);
    if (wasCurrent) { Seq.stop(); App.resetSelection(); Engine.sync(); }
    this.renderAll(); App.changed();
    undoToast(`Deleted score "${name}"`);
  },
  renderAddTrack() {
    const roles = App.style.roles;
    $('#addTrackPreset').innerHTML =
      `<optgroup label="Game roles">${roles.map((r) => `<option value="role:${r.id}">${esc(r.name)}</option>`).join('')}</optgroup>` +
      `<optgroup label="New role from…">${Object.entries(SYNTH_PRESETS).map(([k, p]) => `<option value="new:${k}">${p.name}</option>`).join('')}<option value="new:drum">Drum kit</option></optgroup>`;
  },

  renderTracks() {
    $('#trackList').innerHTML = App.song.tracks.map((t) => `
      <div class="track-item ${t.id === App.sel.track && !App.sel.role ? 'sel' : ''}" data-id="${t.id}" title="${esc(t.name)} — role: ${esc((roleOf(t) || {}).name || '?')}, sound: ${esc(soundName(snd(t)))}${t.sound ? ' (custom for this level)' : ''} · double-click name to rename">
        <span class="dot" style="background:${t.color}"></span>
        <span class="name">${esc(t.name)}</span>
        ${t.sound ? '<span class="flavor" title="Custom sound for this level">✦</span>' : ''}
        <button class="edit" data-act="rename" title="Rename track">✎</button>
        <button class="ms m ${t.mute ? 'on' : ''}" data-act="m" title="Mute">M</button>
        <button class="ms s ${t.solo ? 'on' : ''}" data-act="s" title="Solo">S</button>
        <button class="x" data-act="del" title="Delete track">✕</button>
      </div>`).join('');
  },
  renderPatterns() {
    $('#patternList').innerHTML = App.song.patterns.map((p, i) => `
      <div class="pattern-item ${i === App.sel.pattern ? 'sel' : ''}" data-i="${i}" title="Double-click name to rename">
        <span class="letter" style="border-left:3px solid ${patColor(i)}">${patLetter(i)}</span>
        <span class="name">${esc(p.name)}</span>${p.kind === 'sting' ? '<span class="sting-tag" title="Sting — plays once, for transitions">⚡</span>' : ''}<button class="edit" data-act="rename" title="Rename pattern">✎</button><span class="bars">${p.bars} bar${p.bars > 1 ? 's' : ''}</span>
        ${App.song.patterns.length > 1 ? '<button class="x" data-act="del" title="Delete pattern">✕</button>' : ''}
      </div>`).join('');
    $$('.barsSel').forEach((s) => (s.value = App.pattern().bars));
    $('#btnDelPattern').hidden = App.song.patterns.length <= 1;
  },

  /* ---------- beat grid ---------- */
  drumTrack() {
    const s = App.song;
    let t = s.tracks.find((x) => x.id === this.beatTrackId && x.type === 'drum');
    if (!t) t = s.tracks.find((x) => x.type === 'drum');
    this.beatTrackId = t && t.id;
    return t;
  },
  initBeat() {
    $('#beatKit').innerHTML = Object.entries(DRUM_KITS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    $('#beatLoop').innerHTML = Object.keys(BEAT_LOOPS).map((k) => `<option>${k}</option>`).join('');
    $('#beatTrack').onchange = (e) => { this.beatTrackId = e.target.value; this.renderBeat(); };
    $('#beatKit').onchange = (e) => { const t = this.drumTrack(); if (!t) return; App.pushUndo(); snd(t).kit = e.target.value; this.renderInst(); this.renderStyle(); App.changed(); };
    $('#btnBeatApply').onclick = () => {
      const t = this.drumTrack(); if (!t) return;
      App.pushUndo(); applyBeat(App.pattern(), t.id, $('#beatLoop').value); this.renderBeat(); App.changed();
    };
    $('#btnBeatClear').onclick = () => {
      const t = this.drumTrack(); if (!t) return;
      App.pushUndo(); applyBeat(App.pattern(), t.id, 'Clear'); this.renderBeat(); App.changed();
    };
    $('#btnBeatDouble').onclick = () => this.doublePattern();
    $$('.barsSel').forEach((sel) => (sel.onchange = (e) => {
      App.pushUndo();
      App.pattern().bars = +e.target.value;
      ensurePattern(App.pattern());
      this.renderPatterns(); this.renderBeat(); this.renderArrange(); this.renderAdaptive(); Roll.draw(); App.changed();
    }));

    const grid = $('#beatGrid');
    let paint = null;
    grid.addEventListener('contextmenu', (e) => { if (e.target.closest('.step')) e.preventDefault(); });
    grid.addEventListener('pointerdown', (e) => {
      const st = e.target.closest('.step[data-v]');
      if (st) {
        e.preventDefault();
        const t = this.drumTrack();
        const row = App.pattern().drums[t.id][st.dataset.v];
        const s = +st.dataset.s;
        App.pushUndo();
        if (e.shiftKey || e.button === 2) {
          const cur = row[s];
          row[s] = cur >= 0.9 ? 0.6 : cur >= 0.5 ? 0.35 : cur > 0 ? 0 : 1;
          paint = null;
        } else {
          paint = row[s] > 0 ? 0 : 0.8;
          row[s] = paint;
          if (paint) Live.drumHit(t, st.dataset.v, 0.8 * 0.7);
        }
        this.styleStep(st, row[s]);
        App.changed();
        return;
      }
      const pad = e.target.closest('.pad');
      if (pad) { const t = this.drumTrack(); Live.drumHit(t, pad.dataset.v, 1); }
      const smp = e.target.closest('.smp');
      if (smp) {
        const t = this.drumTrack();
        const vs = snd(t).voices[smp.dataset.v];
        if (vs.sample) { App.pushUndo(); vs.sample = null; this.renderBeat(); App.changed(); return; }
        this._sampleVoice = smp.dataset.v;
        $('#fileSample').click();
      }
    });
    grid.addEventListener('pointerover', (e) => {
      if (paint === null || !e.buttons) return;
      const st = e.target.closest('.step[data-v]');
      if (!st) return;
      const row = App.pattern().drums[this.drumTrack().id][st.dataset.v];
      row[+st.dataset.s] = paint;
      this.styleStep(st, paint);
    });
    window.addEventListener('pointerup', () => { if (paint !== null) App.changed(); paint = null; });
    wire(grid, (el) => {
      const t = this.drumTrack();
      return { obj: snd(t).voices[el.closest('.beat-row').dataset.v] };
    });
    $('#fileSample').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const id = await App.addSample(f);
        App.pushUndo();
        snd(this.drumTrack()).voices[this._sampleVoice].sample = id;
        this.renderBeat(); App.changed();
        toast(`Loaded "${f.name}" — note: samples are saved in project files, not autosave`);
      } catch (err) { toast('Could not decode that audio file: ' + err.message, 5000); }
    };
  },
  styleStep(el, v) {
    el.classList.toggle('on', v > 0);
    el.classList.toggle('v2', v > 0 && v < 0.75 && v >= 0.5);
    el.classList.toggle('v1', v > 0 && v < 0.5);
  },
  doublePattern() {
    const p = App.pattern();
    if (p.bars >= 8) return toast('Patterns can be at most 8 bars');
    App.pushUndo();
    const steps = p.bars * 16;
    Object.values(p.drums).forEach((g) => Object.keys(g).forEach((v) => { const r = g[v].slice(0, steps); g[v] = r.concat(r); }));
    Object.keys(p.notes).forEach((id) => {
      const ns = p.notes[id].filter((n) => n.s < steps);
      p.notes[id] = ns.concat(ns.map((n) => ({ ...n, s: n.s + steps })));
    });
    p.bars *= 2;
    this.renderPatterns(); this.renderBeat(); this.renderArrange(); Roll.draw(); App.changed();
  },
  renderBeat() {
    const t = this.drumTrack();
    const drums = App.song.tracks.filter((x) => x.type === 'drum');
    $('#beatTrack').innerHTML = drums.map((d) => `<option value="${d.id}" ${t && d.id === t.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    const grid = $('#beatGrid');
    this.beatCols = [];
    $('#beatTrack').closest('label').hidden = drums.length < 2;
    $('#beatScope').hidden = !t;
    if (!t) { grid.innerHTML = '<p class="muted">This score has no drum track. Add one from the sidebar (Track ▸ a drum role).</p>'; return; }
    const ds = snd(t);
    $('#beatKit').value = ds.kit;
    $('#beatScope').textContent = t.sound ? 'custom for this level' : `game style · ${roleOf(t).name}`;
    $('#beatScope').className = 'scope ' + (t.sound ? 'level' : 'style');
    const pat = App.pattern();
    ensurePattern(pat);
    const steps = pat.bars * 16;
    const stepsHtml = (fn) => {
      let h = '';
      for (let b = 0; b < pat.bars; b++) {
        if (b) h += '<span class="bar-gap"></span>';
        for (let i = 0; i < 16; i++) h += fn(b * 16 + i);
      }
      return `<div class="steps">${h}</div>`;
    };
    let html = `<div class="beat-ruler"><div class="beat-head"></div>${stepsHtml((s) => `<div class="step">${s % 4 === 0 ? (s % 16 === 0 ? s / 16 + 1 : '·') : ''}</div>`)}</div>`;
    for (const v of DRUM_VOICES) {
      const vs = ds.voices[v.id];
      const row = pat.drums[t.id][v.id];
      const smpName = vs.sample && App.samples[vs.sample] ? App.samples[vs.sample].name : '';
      html += `<div class="beat-row" data-v="${v.id}" style="--c:${t.color}">
        <div class="beat-head">
          <button class="pad" data-v="${v.id}" title="Click to hear (key ${v.key})"><span class="k">${v.key}</span>${v.name}</button>
          <div class="knob" title="Level"><input type="range" data-k="level" min="0" max="1.5" step="0.01" value="${vs.level}">lvl</div>
          <div class="knob" title="Tune (semitones)"><input type="range" data-k="tune" min="-12" max="12" step="1" value="${vs.tune}">tune</div>
          <div class="knob" title="Decay"><input type="range" data-k="decay" min="0.2" max="3" step="0.05" value="${vs.decay}">decay</div>
          <div class="knob" title="Pan"><input type="range" data-k="pan" min="-1" max="1" step="0.05" value="${vs.pan || 0}">pan</div>
          <button class="smp ${vs.sample ? 'has' : ''}" data-v="${v.id}" title="${vs.sample ? 'Using sample “' + esc(smpName) + '” — click to remove' : 'Load your own audio sample for this pad'}">${vs.sample ? esc(smpName) : 'sample'}</button>
        </div>
        ${stepsHtml((s) => {
          const val = row[s] || 0;
          const cls = ['step', s % 4 === 0 ? 'beat' : '', val > 0 ? 'on' : '', val > 0 && val < 0.5 ? 'v1' : val > 0 && val < 0.75 ? 'v2' : ''].join(' ');
          return `<div class="${cls}" data-v="${v.id}" data-s="${s}"></div>`;
        })}
      </div>`;
    }
    grid.innerHTML = html;
    this.beatCols = new Array(steps).fill(0).map(() => []);
    $$('.step[data-s]', grid).forEach((el) => this.beatCols[+el.dataset.s].push(el));
    this._beatNow = -1;
  },
  markBeatStep(s) {
    if (s === this._beatNow) return;
    (this.beatCols[this._beatNow] || []).forEach((e) => e.classList.remove('now'));
    (this.beatCols[s] || []).forEach((e) => e.classList.add('now'));
    this._beatNow = s;
  },

  /* ---------- piano roll toolbar ---------- */
  renderRollBar() {
    const synths = App.song.tracks.filter((t) => t.type === 'synth');
    const cur = App.track();
    $('#rollTrack').innerHTML = (cur && cur.type === 'drum' ? '<option value="">— select an instrument —</option>' : '') +
      synths.map((t) => `<option value="${t.id}" ${cur && t.id === cur.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  },

  /* ---------- arrangement ---------- */
  initArrange() {
    $('#arrPalette').addEventListener('click', (e) => {
      const it = e.target.closest('.arr-pat');
      if (!it) return;
      if (e.target.dataset.act === 'rename') return this.renamePattern(+it.dataset.i, 'palette');
      App.pushUndo(); App.song.arrangement.push(+it.dataset.i); this.renderArrange(); App.changed();
    });
    const strip = $('#arrStrip');
    const removeAt = (k) => { App.pushUndo(); App.song.arrangement.splice(k, 1); this.renderArrange(); App.changed(); };
    strip.addEventListener('click', (e) => {
      const b = e.target.closest('.arr-block');
      if (!b) return;
      if (e.target.classList.contains('x')) return removeAt(+b.dataset.k);
      this.pickPattern(+b.dataset.i);
    });
    strip.addEventListener('dblclick', (e) => {
      const b = e.target.closest('.arr-block');
      if (b && !e.target.closest('button')) this.renamePattern(+b.dataset.i, 'block', +b.dataset.k);
    });
    strip.addEventListener('contextmenu', (e) => { const b = e.target.closest('.arr-block'); if (b) { e.preventDefault(); removeAt(+b.dataset.k); } });
    let dragK = null;
    strip.addEventListener('dragstart', (e) => { const b = e.target.closest('.arr-block'); dragK = +b.dataset.k; e.dataTransfer.effectAllowed = 'move'; });
    strip.addEventListener('dragover', (e) => { e.preventDefault(); $$('.arr-block', strip).forEach((x) => x.classList.toggle('dragover', x === e.target.closest('.arr-block'))); });
    strip.addEventListener('drop', (e) => {
      e.preventDefault();
      const b = e.target.closest('.arr-block');
      if (dragK === null) return;
      const arr = App.song.arrangement;
      const to = b ? +b.dataset.k : arr.length - 1;
      if (to !== dragK) { App.pushUndo(); const [x] = arr.splice(dragK, 1); arr.splice(to, 0, x); App.changed(); }
      dragK = null;
      this.renderArrange();
    });
    $('#btnArrClear').onclick = () => {
      if (!App.song.arrangement.length) return;
      App.pushUndo(); App.song.arrangement = []; this.renderArrange(); App.changed();
      undoToast('Cleared the song arrangement');
    };
  },
  renderArrange() {
    const s = App.song;
    $('#arrPalette').innerHTML = s.patterns.map((p, i) => `<div class="arr-pat" data-i="${i}" style="border-left:5px solid ${patColor(i)}"><b>${patLetter(i)}</b><span class="name">${esc(p.name)}</span> <span class="muted">${p.bars}b</span><button class="edit" data-act="rename" title="Rename pattern">✎</button></div>`).join('');
    const arr = s.arrangement.filter((i) => s.patterns[i]);
    $('#arrStrip').innerHTML = arr.length ? s.arrangement.map((i, k) => {
      const p = s.patterns[i];
      if (!p) return '';
      return `<div class="arr-block" draggable="true" data-k="${k}" data-i="${i}" style="width:${Math.max(56, p.bars * 40)}px;background:${patColor(i)}" title="Click to edit · double-click to rename · drag to reorder">
        <span>${patLetter(i)}</span><small>${esc(p.name)}</small><button class="x" title="Remove">✕</button></div>`;
    }).join('') : '<div class="arr-empty">The song is empty — click patterns above to build it. (Song mode plays the selected pattern until then.)</div>';
    const bars = arr.reduce((a, i) => a + s.patterns[i].bars, 0);
    const secs = (bars * 4 * 60) / s.bpm;
    $('#arrLen').textContent = `— ${bars} bars · ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
  },

  /* ---------- mixer ---------- */
  initMixer() {
    const mx = $('#mixer');
    wire(mx, (el) => {
      const strip = el.closest('.strip');
      if (strip.dataset.id === 'master') return { obj: App.song.mix || App.style.mix, after: () => Engine.master() };
      const t = App.track(strip.dataset.id);
      return { obj: t, after: () => Engine.track(t) };
    });
    mx.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act, s = App.song;
      App.pushUndo();
      if (act === 'mixCustom') { s.mix = clone(App.style.mix); toast(`${s.name} now has its own mix. The game style's mix is unchanged.`, 3000); }
      else if (act === 'mixRevert') { s.mix = null; undoToast(`${s.name} is back on the game style's mix`); }
      else if (act === 'mixPromote') { App.style.mix = clone(s.mix); s.mix = null; undoToast(`The game style's mix now matches ${s.name}`); }
      else {
        const t = App.track(b.closest('.strip').dataset.id);
        t[act] = !t[act];
        Engine.tracksAll(); this.renderMixer(); this.renderTracks(); App.changed();
        return;
      }
      Engine.master(); this.renderMixer(); this.renderScores(); this.renderStyle(); App.changed();
    });
  },
  renderMixer() {
    const s = App.song, m = s.mix || App.style.mix;
    $('#mixer').innerHTML = s.tracks.map((t) => `
      <div class="strip" data-id="${t.id}" style="--c:${t.color}">
        <h4 title="${esc(t.name)}">${esc(t.name)}</h4>
        <div class="ms-row"><button class="ms m ${t.mute ? 'on' : ''}" data-act="mute">M</button><button class="ms s ${t.solo ? 'on' : ''}" data-act="solo">S</button></div>
        ${ctl('Volume', 'vol', t.vol, 0, 1.2, 0.01, 'pct')}
        ${ctl('Pan', 'pan', t.pan, -1, 1, 0.01, 'pan')}
        <div class="section">Insert FX</div>
        ${ctl('Drive', 'drive', t.drive, 0, 1, 0.01, 'pct')}
        ${ctl('Tone (LPF)', 'tone', t.tone, 200, 20000, 1, 'hz')}
        <div class="section">Sends</div>
        ${ctl('Reverb', 'rev', t.rev, 0, 1, 0.01, 'pct')}
        ${ctl('Delay', 'dly', t.dly, 0, 1, 0.01, 'pct')}
      </div>`).join('') + `
      <div class="strip master" data-id="master" style="--c:var(--accent)">
        <h4>Master</h4>
        ${s.mix
          ? `<div class="scope level" title="Only ${esc(s.name)} uses this mix">custom for this level</div>
             <button data-act="mixRevert" class="small-btn">Revert to game style</button>
             <button data-act="mixPromote" class="small-btn" title="Use this mix for every score that shares the game style">Make this the game style</button>`
          : `<div class="scope style" title="The master chain is part of the game style: every score shares it, so all levels sit at the same loudness and character.">game style · all scores</div>
             <button data-act="mixCustom" class="small-btn" title="Give ${esc(s.name)} its own master mix — e.g. bigger reverb for a cave">Customize for this level</button>`}
        ${ctl('Volume', 'vol', m.vol, 0, 1.5, 0.01, 'pct')}
        <div class="section">EQ</div>
        ${ctl('Low', 'low', m.low, -12, 12, 0.5, 'db')}
        ${ctl('Mid', 'mid', m.mid, -12, 12, 0.5, 'db')}
        ${ctl('High', 'high', m.high, -12, 12, 0.5, 'db')}
        <div class="section">Compressor</div>
        ${ctl('Threshold', 'comp', m.comp, -40, 0, 0.5, 'db')}
        <div class="section">Reverb</div>
        ${ctl('Size', 'revSize', m.revSize, 0.3, 6, 0.1, 's')}
        ${ctl('Return', 'revLevel', m.revLevel, 0, 1.5, 0.01, 'pct')}
        <div class="section">Delay</div>
        <label><span><i>Time</i></span><select data-k="dlyDiv">${Object.keys(DELAY_DIVS).map((d) => `<option ${d === m.dlyDiv ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        ${ctl('Feedback', 'dlyFb', m.dlyFb, 0, 0.9, 0.01, 'pct')}
      </div>`;
  },

  /* ---------- instrument panel ---------- */
  /* What the instrument panel edits: a role (from the Game Style tab) or the selected track.
     For a track, `sound` is its level override if it has one, otherwise its role — so edits
     either stay in this level or change the game style for every score. */
  instTarget() {
    if (App.sel.role) { const r = App.role(App.sel.role); return r && { role: r, track: null, sound: r }; }
    const t = App.track();
    return t && { role: roleOf(t), track: t, sound: snd(t) };
  },
  initInst() {
    const ip = $('#instPanel');
    wire(ip, (el) => {
      const tg = this.instTarget();
      if (!tg) return null;
      const S = tg.sound;
      if (el.dataset.k === 'preset') return { obj: S, after: (el2, v) => { S.synth = { ...SYNTH_PRESETS[v] }; this.renderInst(); this.renderStyle(); this.renderTracks(); } };
      if (el.dataset.k === 'kit') return { obj: S, after: () => { this.renderBeat(); this.renderStyle(); } };
      return { obj: S.synth };
    });
    ip.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      const tg = this.instTarget();
      if (!act || !tg || !tg.track) return;
      const t = tg.track, r = tg.role;
      App.pushUndo();
      if (act === 'customize') { t.sound = soundFields(r); toast(`“${t.name}” now has its own sound in ${App.song.name}. The game style is unchanged.`, 3500); }
      else if (act === 'revert') { t.sound = null; undoToast(`“${t.name}” is back on the game style (${r.name})`); }
      else if (act === 'promote') {
        Object.assign(r, soundFields(t.sound));
        t.sound = null;
        const u = App.roleUsage(r.id);
        undoToast(`“${r.name}” in the game style now uses this sound (${u.shared} track${u.shared === 1 ? '' : 's'} share it)`);
      }
      App.changed();
      this.renderInst(); this.renderTracks(); this.renderScores(); this.renderStyle(); this.renderBeat();
    });
  },
  /* One line explaining where edits go, with the actions that make sense in that state. */
  scopeBar(tg) {
    const u = App.roleUsage(tg.role.id);
    const shareText = u.shared
      ? `played by ${u.shared} track${u.shared === 1 ? '' : 's'} in ${u.sharedScores} score${u.sharedScores === 1 ? '' : 's'}`
      : 'no tracks use it yet';
    if (!tg.track) return `<div class="scope-bar"><span class="scope style">game style</span><span class="muted">Role “${esc(tg.role.name)}” — edits change every score that uses it (${shareText}).</span></div>`;
    if (!tg.track.sound) return `<div class="scope-bar"><span class="scope style">game style · ${esc(tg.role.name)}</span><span class="muted">Edits apply to all levels (${shareText}).</span>
      <button data-act="customize" title="Give this track its own copy of the sound, for this score only">Customize for this level</button></div>`;
    return `<div class="scope-bar"><span class="scope level">custom for this level</span><span class="muted">Based on “${esc(tg.role.name)}”. Edits stay in ${esc(App.song.name)}.</span>
      <button data-act="revert">Revert to game style</button><button data-act="promote" title="Make this sound the game style for “${esc(tg.role.name)}”, used by every score">Make this the game style</button></div>`;
  },
  renderInst() {
    const tg = this.instTarget();
    const ip = $('#instPanel');
    if (!tg || !tg.role) { ip.innerHTML = ''; return; }
    const S = tg.sound;
    const color = tg.track ? tg.track.color : tg.role.color;
    const title = tg.track ? esc(tg.track.name) : 'Role: ' + esc(tg.role.name);
    const dot = `<span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color}"></span>`;
    if (tg.role.type === 'drum') {
      ip.innerHTML = `<h4>${dot}${title}
        <label>Kit <select data-k="kit">${Object.entries(DRUM_KITS).map(([k, v]) => `<option value="${k}" ${k === S.kit ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label></h4>
        ${this.scopeBar(tg)}
        <p class="muted">Per-pad level, tuning, decay, pan and custom samples are in the <b>Beat</b> tab. The keyboard plays pads chromatically from C (C = kick, C# = snare, D = clap …) — or use number keys 1–0.</p>`;
      return;
    }
    const p = S.synth;
    const wsel = (k) => `<label><span><i>${k === 'o1' ? 'Osc 1' : 'Osc 2'}</i></span><select data-k="${k}">${WAVES.map((w) => `<option ${w === p[k] ? 'selected' : ''}>${w}</option>`).join('')}</select></label>`;
    ip.innerHTML = `<h4>${dot}${title}
      <label>Preset <select data-k="preset">${Object.entries(SYNTH_PRESETS).map(([k, v]) => `<option value="${k}" ${k === S.preset ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label></h4>
      ${this.scopeBar(tg)}
      <div class="inst-grid">
        ${wsel('o1')}${wsel('o2')}
        ${ctl('Osc 2 pitch', 'o2semi', p.o2semi, -24, 24, 1, 'st')}
        ${ctl('Detune', 'detune', p.detune, 0, 50, 1, 'ct')}
        ${ctl('Osc mix', 'mix', p.mix, 0, 1, 0.01, 'pct')}
        ${ctl('Octave', 'oct', p.oct, -2, 2, 1, 'int')}
        ${ctl('Attack', 'a', p.a, 0.001, 3, 0.001, 's')}
        ${ctl('Decay', 'd', p.d, 0.01, 4, 0.01, 's')}
        ${ctl('Sustain', 's', p.s, 0, 1, 0.01, 'pct')}
        ${ctl('Release', 'r', p.r, 0.01, 4, 0.01, 's')}
        ${ctl('Cutoff', 'cut', p.cut, 40, 18000, 1, 'hz')}
        ${ctl('Resonance', 'res', p.res, 0, 20, 0.1)}
        ${ctl('Filter env', 'env', p.env, 0, 6, 0.1, 'oct')}
        ${ctl('Filter decay', 'fdec', p.fdec, 0.01, 2, 0.01, 's')}
        ${ctl('Vibrato rate', 'lfoRate', p.lfoRate, 0.1, 12, 0.1, 'hz')}
        ${ctl('Vibrato depth', 'lfoDepth', p.lfoDepth, 0, 50, 1, 'ct')}
        ${ctl('Level', 'gain', p.gain, 0, 1.6, 0.01, 'pct')}
      </div>`;
  },

  /* ---------- Adaptive tab: segments, stings, layers, live preview ---------- */
  initAdaptive() {
    const ap = $('#adaptivePanel');
    ap.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const s = App.song;
      if (b.dataset.seg !== undefined) return Seq.request(+b.dataset.seg);
      if (b.dataset.sting !== undefined) return Seq.request(+b.dataset.sting, true);
      const act = b.dataset.act;
      if (act === 'addLayer') {
        App.pushUndo();
        s.layers.push({ id: uid(), name: 'Layer ' + (s.layers.length + 1) });
        this.renderAdaptive(); Engine.layers(); App.changed();
      } else if (act === 'delLayer') {
        const L = s.layers.find((l) => l.id === b.dataset.id);
        App.pushUndo();
        s.layers = s.layers.filter((l) => l !== L);
        s.tracks.forEach((t) => { if (t.layer === L.id) t.layer = s.layers[0].id; });
        this.renderAdaptive(); Engine.layers(); App.changed();
        undoToast(`Removed layer “${L.name}” — its tracks moved to ${s.layers[0].name}`);
      } else if (act === 'renameLayer') {
        const L = s.layers.find((l) => l.id === b.dataset.id);
        inlineRename($(`.layer-row[data-id="${L.id}"] .name`), L.name, (v) => {
          if (v) { App.pushUndo(); L.name = v; App.changed(); }
          this.renderAdaptive();
        });
      }
    });
    ap.addEventListener('pointerdown', (e) => { if (e.target.matches('select[data-kind], select[data-entry], select[data-tlayer], select[data-adp]')) App.pushUndo(); });
    ap.addEventListener('change', (e) => {
      const el = e.target, s = App.song;
      if (el.dataset.kind !== undefined) {
        const p = s.patterns[+el.dataset.kind];
        p.kind = el.value;
        if (p.kind === 'sting') p.entrySting = null;
        else s.patterns.forEach((q) => { if (q.entrySting === p.id) q.entrySting = null; });
        this.renderPatterns();
      } else if (el.dataset.entry !== undefined) s.patterns[+el.dataset.entry].entrySting = el.value || null;
      else if (el.dataset.tlayer !== undefined) { App.track(el.dataset.tlayer).layer = el.value; Engine.layers(); }
      else if (el.dataset.adp === 'quant') s.adaptive.quant = el.value;
      else return;
      App.changed();
      this.renderAdaptive();
    });
    ap.addEventListener('input', (e) => {
      if (e.target.id !== 'intensity') return;
      App.intensity = +e.target.value;
      Engine.layers();
      this.showLayerLevels();
    });
  },
  showLayerLevels() {
    const s = App.song;
    $$('.lvl-meter').forEach((el) => {
      const i = +el.dataset.i;
      const g = i === 0 ? 1 : clamp(App.intensity * (s.layers.length - 1) - (i - 1), 0, 1);
      el.style.setProperty('--lvl', g);
      el.title = `${s.layers[i].name}: ${Math.round(g * 100)}%`;
    });
    const v = $('#intensityVal');
    if (v) v.textContent = Math.round(App.intensity * 100) + '%';
  },
  renderAdaptive() {
    const ap = $('#adaptivePanel');
    if (!ap) return;
    const s = App.song;
    const loops = s.patterns.map((p, i) => ({ p, i })).filter((x) => x.p.kind !== 'sting');
    const stings = s.patterns.map((p, i) => ({ p, i })).filter((x) => x.p.kind === 'sting');
    const quantName = { beat: 'next beat', bar: 'next bar', end: 'end of the segment' }[s.adaptive.quant];
    const layerOpts = (cur) => s.layers.map((l) => `<option value="${l.id}" ${l.id === cur ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    ap.innerHTML = `
      <section class="adp-sec">
        <h4 class="subhead">Preview — play it the way the game will</h4>
        <p class="muted">Pick a segment to start. While it plays, pick another: the change lands on the ${quantName}${stings.length ? ', through its entry sting if it has one' : ''}. Raise intensity to fade in the upper layers.</p>
        <div class="seg-buttons">${loops.length ? loops.map(({ p, i }) => `<button class="seg-btn" data-seg="${i}" style="--c:${patColor(i)}">${esc(p.name)}<small>${p.bars} bar${p.bars > 1 ? 's' : ''}${p.entrySting && Seq.stingIndex(p.entrySting) !== null ? ' · ⚡' : ''}</small></button>`).join('')
          : '<span class="muted">No segments yet — set a pattern’s type to Segment below.</span>'}</div>
        ${stings.length ? `<div class="sting-buttons"><span class="muted">Play a sting:</span>${stings.map(({ p, i }) => `<button class="seg-btn sting" data-sting="${i}">⚡ ${esc(p.name)}</button>`).join('')}</div>` : ''}
        ${s.layers.length > 1 ? `
          <div class="intensity">
            <label>Intensity <input id="intensity" type="range" min="0" max="1" step="0.01" value="${App.intensity}"><b id="intensityVal"></b></label>
            <div class="lvls">${s.layers.map((l, i) => `<div class="lvl"><span class="lvl-meter" data-i="${i}"></span><span>${esc(l.name)}</span></div>`).join('')}</div>
          </div>` : '<p class="muted">Add a second layer below to preview intensity.</p>'}
        <label>Change segment on <select data-adp="quant">
          <option value="beat" ${s.adaptive.quant === 'beat' ? 'selected' : ''}>Next beat</option>
          <option value="bar" ${s.adaptive.quant === 'bar' ? 'selected' : ''}>Next bar</option>
          <option value="end" ${s.adaptive.quant === 'end' ? 'selected' : ''}>End of segment</option></select></label>
      </section>

      <section class="adp-sec">
        <h4 class="subhead">Segments &amp; stings</h4>
        <p class="muted">A <b>segment</b> loops while the game stays in that state (explore, combat, boss…). A <b>sting</b> plays once — use it as the way into a segment.</p>
        <div class="adp-table">${s.patterns.map((p, i) => `
          <div class="adp-row">
            <span class="letter" style="border-left:3px solid ${patColor(i)}">${patLetter(i)}</span>
            <span class="name">${esc(p.name)}</span><span class="muted">${p.bars} bar${p.bars > 1 ? 's' : ''}</span>
            <select data-kind="${i}" aria-label="Type"><option value="loop" ${p.kind !== 'sting' ? 'selected' : ''}>Segment (loops)</option><option value="sting" ${p.kind === 'sting' ? 'selected' : ''}>Sting (once)</option></select>
            ${p.kind !== 'sting' && stings.length ? `<label>Enter through <select data-entry="${i}"><option value="">no sting</option>${stings.map((x) => `<option value="${x.p.id}" ${p.entrySting === x.p.id ? 'selected' : ''}>⚡ ${esc(x.p.name)}</option>`).join('')}</select></label>` : '<span></span>'}
          </div>`).join('')}</div>
      </section>

      <section class="adp-sec">
        <h4 class="subhead">Intensity layers</h4>
        <p class="muted">Layers stack from the bottom: the first is always playing, each one above fades in as intensity rises. Each layer becomes its own stem for Unity.</p>
        <div class="layer-list">${s.layers.map((l, i) => {
          const ts = s.tracks.filter((t) => t.layer === l.id);
          return `<div class="layer-row" data-id="${l.id}">
            <span class="lvl-idx">${i === 0 ? 'always on' : 'level ' + i}</span>
            <span class="name">${esc(l.name)}</span><button class="edit" data-act="renameLayer" data-id="${l.id}" title="Rename layer">✎</button>
            <span class="chips">${ts.map((t) => `<span class="chip" style="--c:${t.color}">${esc(t.name)}</span>`).join('') || '<span class="muted">no tracks</span>'}</span>
            ${i > 0 ? `<button class="x" data-act="delLayer" data-id="${l.id}" title="Remove layer">✕</button>` : '<span></span>'}
          </div>`;
        }).join('')}</div>
        <button data-act="addLayer">+ Layer</button>
        <div class="track-layers">${s.tracks.map((t) => `
          <label><span class="dot" style="background:${t.color}"></span>${esc(t.name)} <select data-tlayer="${t.id}">${layerOpts(t.layer)}</select></label>`).join('')}</div>
      </section>`;
    this.showLayerLevels();
  },
  /* Called every frame while playing in Adaptive mode: light up the playing / queued segment. */
  markAdaptive() {
    const A = Seq.adapt;
    $$('#adaptivePanel .seg-btn').forEach((b) => {
      const i = +(b.dataset.seg ?? b.dataset.sting);
      const playing = A && A.cur === i;
      const queued = A && ((A.next && (A.next.target === i && b.dataset.seg !== undefined || A.next.sting === i)) || (A.after === i && b.dataset.seg !== undefined));
      b.classList.toggle('playing', !!playing);
      b.classList.toggle('queued', !!queued && !playing);
    });
  },

  /* ---------- Game Style tab ---------- */
  initStyle() {
    const sp = $('#stylePanel');
    sp.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      if (act === 'addRole') {
        const k = $('#newRolePreset').value;
        App.pushUndo();
        const r = makeRole(k);
        App.style.roles.push(r);
        App.sel.role = r.id;
        this.renderStyle(); this.renderAddTrack(); this.renderInst(); this.renderKeyboard(); App.changed();
        return toast(`Added role “${r.name}”. Add it to a score from the sidebar's Track menu.`);
      }
      if (act === 'saveFlavor') {
        App.pushUndo();
        const f = { id: uid(), name: App.song.name.replace(/^Level \d+\s*[—-]\s*/, '') || 'Flavor', ...Flavors.ofScore() };
        App.project.flavors.push(f);
        this.renderStyle(); App.changed();
        return toast(`Saved flavor “${f.name}”: ${Flavors.summary(f)}`, 3500);
      }
      const thRow = e.target.closest('.theme-row');
      if (thRow) {
        const th = Themes.find(thRow.dataset.tid);
        if (act === 'playTheme') Themes.preview(th);
        else if (act === 'renameTheme') this.renameItem(thRow, th, () => Roll.renderThemeBar());
        else if (act === 'delTheme') {
          App.pushUndo();
          App.project.themes = App.project.themes.filter((x) => x !== th);
          this.renderStyle(); Roll.renderThemeBar(); App.changed();
          undoToast(`Deleted theme “${th.name}” (notes already in scores stay)`);
        }
        return;
      }
      const fRow = e.target.closest('.flavor-row');
      if (fRow) {
        const f = App.project.flavors.find((x) => x.id === fRow.dataset.fid);
        if (act === 'renameFlavor') this.renameItem(fRow, f);
        else if (act === 'applyFlavor') {
          App.pushUndo();
          Flavors.apply(f);
          Engine.master();
          this.renderAll(); App.changed();
          undoToast(`${App.song.name} now uses the “${f.name}” flavor`);
        } else if (act === 'delFlavor') {
          App.pushUndo();
          App.project.flavors = App.project.flavors.filter((x) => x !== f);
          this.renderStyle(); App.changed();
          undoToast(`Deleted flavor “${f.name}” (levels using it keep their sounds)`);
        }
        return;
      }
      const row = e.target.closest('.role-row');
      if (!row) return;
      const r = App.role(row.dataset.id);
      if (act === 'del') {
        App.pushUndo();
        App.style.roles = App.style.roles.filter((x) => x !== r);
        if (App.sel.role === r.id) App.sel.role = null;
        this.renderStyle(); this.renderAddTrack(); this.renderInst(); App.changed();
        return undoToast(`Removed role “${r.name}” from the game style`);
      }
      App.sel.role = r.id;
      $$('.track-item.sel').forEach((x) => x.classList.remove('sel'));
      $$('.role-row').forEach((x) => x.classList.toggle('sel', x === row));
      this.renderInst(); this.renderKeyboard();
      if (act === 'rename') this.renameRole(r.id);
    });
    sp.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.role-row');
      if (row && !e.target.closest('button')) this.renameRole(row.dataset.id);
    });
    sp.addEventListener('change', (e) => {
      const k = e.target.dataset.def;
      if (!k) return;
      App.pushUndo();
      App.style[k] = k === 'scale' ? e.target.value : k === 'bpm' ? clamp(Math.round(+e.target.value || 120), 40, 260) : +e.target.value;
      App.changed(); this.renderStyle();
    });
  },
  /* Inline-rename anything with a .name element and a `name` field (themes, flavors). */
  renameItem(row, obj, after) {
    inlineRename($('.name', row), obj.name, (v) => {
      if (v) { App.pushUndo(); obj.name = v; App.changed(); }
      this.renderStyle();
      if (after) after();
    });
  },
  renameRole(id) {
    const r = App.role(id);
    inlineRename($(`.role-row[data-id="${id}"] .name`), r.name, (v) => {
      if (v) { App.pushUndo(); r.name = uniqueRoleName(v); App.changed(); }
      this.renderStyle(); this.renderAddTrack(); this.renderInst(); this.renderTracks(); this.renderBeat();
    });
  },
  renderStyle() {
    const st = App.style;
    const opt = (list, cur) => list.map(([v, n]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${n}</option>`).join('');
    $('#stylePanel').innerHTML = `
      <section class="style-sec">
        <h4 class="subhead">Instrument roles</h4>
        <p class="muted">The game's instrument roster. Every score's tracks play these sounds, so changing a role here changes it in every level — except tracks a level has customized (✦). Click a role to edit its sound below and play it on the keyboard.</p>
        <div class="role-list">${st.roles.map((r) => {
          const u = App.roleUsage(r.id);
          const custom = u.tracks - u.shared;
          return `<div class="role-row ${App.sel.role === r.id ? 'sel' : ''}" data-id="${r.id}" title="Click to edit · double-click name to rename">
            <span class="dot" style="background:${r.color}"></span>
            <span class="name">${esc(r.name)}</span><button class="edit" data-act="rename" title="Rename role">✎</button>
            <span class="snd">${esc(soundName(r))}</span>
            <span class="muted use">${u.tracks ? `${u.tracks} track${u.tracks > 1 ? 's' : ''} · ${u.scores} score${u.scores > 1 ? 's' : ''}${custom ? ` · <span class="flavor">✦${custom} customized</span>` : ''}` : 'not used yet'}</span>
            ${u.tracks ? '' : '<button class="x" data-act="del" title="Remove role (not used by any score)">✕</button>'}
          </div>`;
        }).join('')}</div>
        <div class="row gap add-role">
          <select id="newRolePreset">${Object.entries(SYNTH_PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('')}<option value="drum">Drum kit</option></select>
          <button data-act="addRole">+ Role</button>
        </div>
      </section>
      <section class="style-sec">
        <h4 class="subhead">Themes</h4>
        <p class="muted">The game's recurring melodies and progressions. Save one from the Piano Roll (“Save as theme”), then insert it into any level — it's moved into that level's key, and can be slowed down, sped up or shifted an octave.</p>
        <div class="role-list">${App.project.themes.map((th) => {
          const n = Themes.usage(th.id);
          return `<div class="theme-row" data-tid="${th.id}">
            <button class="play-mini" data-act="playTheme" title="Hear it">▶</button>
            <span class="name">${esc(th.name)}</span><button class="edit" data-act="renameTheme" title="Rename theme">✎</button>
            <span class="snd">${NOTE_NAMES[th.key]} ${esc(SCALES[th.scale].name.toLowerCase())} · ${th.bars} bar${th.bars > 1 ? 's' : ''} · ${th.notes.length} notes</span>
            <span class="muted use">${n ? `used ${n} time${n > 1 ? 's' : ''}` : 'not used yet'}</span>
            <button class="x" data-act="delTheme" title="Delete theme (notes already in scores stay)">✕</button>
          </div>`;
        }).join('') || '<p class="muted">No themes yet.</p>'}</div>
      </section>
      <section class="style-sec">
        <h4 class="subhead">Flavors</h4>
        <p class="muted">A flavor is a level's set of customizations — its custom instrument sounds (✦) and mix — saved so another level can use the same feel.</p>
        <div class="role-list">${App.project.flavors.map((f) => `
          <div class="flavor-row" data-fid="${f.id}">
            <span class="name">${esc(f.name)}</span><button class="edit" data-act="renameFlavor" title="Rename flavor">✎</button>
            <span class="muted use">${esc(Flavors.summary(f))}</span>
            ${Flavors.matches(f) ? '<span class="scope level">in use here</span>'
              : `<button data-act="applyFlavor" title="Use this flavor in ${esc(App.song.name)} (replaces its current customizations)">Apply to this level</button>`}
            <button class="x" data-act="delFlavor" title="Delete flavor">✕</button>
          </div>`).join('') || '<p class="muted">No flavors yet.</p>'}</div>
        ${Flavors.hasCustom() && App.project.flavors.some((f) => Flavors.matches(f)) ? ''
          : Flavors.hasCustom() ? `<button data-act="saveFlavor" title="Save ${esc(App.song.name)}'s custom sounds and mix as a reusable flavor">Save this level's flavor</button>` : `<p class="muted">${esc(App.song.name)} uses the plain game style. Customize a track's sound or the mix for this level, then save it here as a flavor.</p>`}
      </section>
      <section class="style-sec">
        <h4 class="subhead">Defaults for new scores</h4>
        <div class="row gap wrap">
          <label>Key <select data-def="key">${opt(NOTE_NAMES.map((n, i) => [i, n]), st.key)}</select></label>
          <label>Scale <select data-def="scale">${opt(Object.entries(SCALES).map(([k, s]) => [k, s.name]), st.scale)}</select></label>
          <label>BPM <input data-def="bpm" type="number" min="40" max="260" value="${st.bpm}" style="width:5em"></label>
        </div>
        <p class="muted">A score can still choose its own key and tempo — useful when a level needs a different mood.</p>
      </section>
      <section class="style-sec">
        <h4 class="subhead">Mix</h4>
        <p class="muted">The master EQ, compressor, reverb and delay (Mixer &amp; FX tab) belong to the game style, so every score shares them — unless a level customizes its mix there. Track levels, panning and sends stay per score.</p>
      </section>`;
  },

  /* ---------- keyboard ---------- */
  keyMap: { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17 },
  initKeyboard() {
    $('#octDown').onclick = () => this.shiftOct(-1);
    $('#octUp').onclick = () => this.shiftOct(1);
    const kb = $('#keyboard');
    let down = null;
    const on = (el) => { if (!el) return; down = +el.dataset.m; Live.noteOn(down, App.vel); };
    kb.addEventListener('pointerdown', (e) => { const k = e.target.closest('[data-m]'); if (k) { e.preventDefault(); on(k); } });
    kb.addEventListener('pointerover', (e) => {
      if (down === null || !e.buttons) return;
      const k = e.target.closest('[data-m]');
      if (k && +k.dataset.m !== down) { Live.noteOff(down); on(k); }
    });
    const up = () => { if (down !== null) { Live.noteOff(down); down = null; } };
    window.addEventListener('pointerup', up);
    kb.addEventListener('pointerleave', (e) => { if (!e.buttons) up(); });
  },
  shiftOct(d) {
    Live.allOff();
    App.octave = clamp(App.octave + d, 1, 7);
    this.renderKeyboard();
  },
  renderKeyboard() {
    const kb = $('#keyboard');
    const W = kb.clientWidth || 600;
    const nWhite = clamp(Math.floor(W / 30), 10, 36);
    const ww = W / nWhite;
    const start = 12 * (App.octave + 1);
    const tg = this.instTarget();
    const t = tg && { type: tg.role.type, name: tg.track ? tg.track.name : 'Role: ' + tg.role.name };
    const scale = SCALES[App.song.scale].steps.map((x) => (x + App.song.key) % 12);
    const inv = {};
    Object.entries(this.keyMap).forEach(([k, v]) => (inv[start + v] = k.toUpperCase()));
    let html = '', wi = 0, m = start;
    while (wi < nWhite) {
      const pc = m % 12;
      const black = [1, 3, 6, 8, 10].includes(pc);
      const lbl = inv[m] || (pc === 0 ? noteName(m) : '');
      if (black) html += `<div class="bkey" data-m="${m}" style="left:${wi * ww - ww * 0.32}px;width:${ww * 0.64}px">${inv[m] || ''}</div>`;
      else { html += `<div class="wkey ${scale.includes(pc) && t && t.type === 'synth' ? 'inscale' : ''}" data-m="${m}" style="left:${wi * ww}px;width:${ww}px">${lbl}${pc === 0 && inv[m] ? '<br>' + noteName(m) : ''}</div>`; wi++; }
      m++;
    }
    kb.innerHTML = html;
    $('#octLabel').textContent = 'C' + App.octave;
    $('#kbdTarget').textContent = t ? '→ ' + t.name : '';
  },
  keyDown(m, on) { const el = $(`#keyboard [data-m="${m}"]`); if (el) el.classList.toggle('down', on); },
  setMidiStatus(n) { $('#midiStatus').textContent = n ? `· ${n} MIDI input${n > 1 ? 's' : ''} connected` : ''; },

  /* ---------- export ---------- */
  initExport() {
    const dlg = $('#exportDlg');
    // Only show the options that apply to the chosen format.
    const syncDlg = () => {
      const fmt = $('input[name=fmt]:checked', dlg).value;
      const audio = ['wav16', 'wav24', 'wav32', 'mp3', 'stems'].includes(fmt);
      $('#expUnity').hidden = fmt !== 'unity';
      $('#expSource').hidden = !(audio || fmt === 'midi');
      $$('.exp-audio', dlg).forEach((el) => (el.hidden = !audio));
      $('#mp3Opt').hidden = fmt !== 'mp3';
      $('#uFolderRow').hidden = !window.showDirectoryPicker;
      $('#btnDoExport').textContent = fmt === 'unity' && $('#uFolder').checked ? 'Choose folder & export' : 'Export';
    };
    dlg.addEventListener('change', syncDlg);
    $('#btnExport').onclick = () => { $('#expStatus').textContent = ''; syncDlg(); dlg.showModal(); };
    $('#btnDoExport').onclick = async (e) => {
      e.preventDefault();
      const fmt = $('input[name=fmt]:checked', dlg).value;
      if (fmt === 'unity') return this.exportUnity();
      const src = $('input[name=src]:checked', dlg).value;
      const repeats = clamp(+$('#expRepeats').value || 1, 1, 64);
      const sampleRate = +$('#expRate').value;
      const tail = clamp(+$('#expTail').value || 0, 0, 10);
      const name = safeName(App.project.name) + '_' + safeName(App.song.name);
      const status = $('#expStatus');
      const btn = $('#btnDoExport');
      btn.disabled = true;
      try {
        if (src === 'song' && !App.song.arrangement.length && fmt !== 'project') toast('Song arrangement is empty — exporting the selected pattern');
        if (fmt === 'project') { download(App.projectBlob(), name + '.synth.json'); status.textContent = 'Saved project file.'; }
        else if (fmt === 'midi') { download(exportMIDI(src, repeats), name + '.mid'); status.textContent = 'Saved MIDI file.'; }
        else if (fmt === 'stems') {
          const tracks = App.song.tracks.filter((t) => !t.mute);
          for (let i = 0; i < tracks.length; i++) {
            status.textContent = `Rendering stem ${i + 1}/${tracks.length}: ${tracks[i].name}…`;
            const buf = await renderAudio({ source: src, repeats, tail, sampleRate, only: tracks[i].id });
            download(encodeWAV(buf, 24, false), `${name}_${String(i + 1).padStart(2, '0')}_${safeName(tracks[i].name)}.wav`);
            await new Promise((r) => setTimeout(r, 400));
          }
          status.textContent = `Saved ${tracks.length} stems (24-bit WAV). Your browser may ask to allow multiple downloads.`;
        } else {
          status.textContent = 'Rendering audio…';
          const t0 = performance.now();
          const buf = await renderAudio({ source: src, repeats, tail, sampleRate });
          if (fmt === 'mp3') {
            status.textContent = 'Encoding MP3…';
            const blob = await encodeMP3(buf, +$('#mp3Rate').value, (p) => (status.textContent = `Encoding MP3… ${Math.round(p * 100)}%`));
            download(blob, name + '.mp3');
          } else {
            download(encodeWAV(buf, fmt === 'wav24' ? 24 : fmt === 'wav32' ? 32 : 16), name + '.wav');
          }
          status.textContent = `Done — ${buf.duration.toFixed(1)}s of audio rendered in ${((performance.now() - t0) / 1000).toFixed(1)}s.`;
        }
      } catch (err) {
        console.error(err);
        status.textContent = 'Export failed: ' + err.message + (fmt === 'mp3' ? ' (MP3 needs an internet connection the first time to load the encoder.)' : '');
      }
      btn.disabled = false;
    };
  },

  async exportUnity() {
    const dlg = $('#exportDlg'), status = $('#expStatus'), btn = $('#btnDoExport');
    const lufs = $('#uLufs').value;
    const opts = {
      scope: $('input[name=uscope]:checked', dlg).value,
      targetLufs: lufs === 'off' ? null : +lufs,
      sampleRate: +$('#uRate').value,
      bits: +$('#uBits').value,
    };
    const toFolder = $('#uFolder').checked && window.showDirectoryPicker;
    let dir = null;
    if (toFolder) {
      try { dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'synthstudio-unity' }); }
      catch (err) { status.textContent = 'No folder chosen.'; return; }
    }
    Seq.stop();
    btn.disabled = true;
    const t0 = performance.now();
    try {
      const res = await UnityExport.run(opts, (msg) => (status.textContent = 'Rendering ' + msg + '…'));
      status.textContent = 'Packaging…';
      if (dir) await UnityExport.saveToFolder(dir, res.entries);
      else download(makeZip(res.entries), res.root + '.zip');
      const files = res.entries.length;
      const gains = res.scores.map((s) => `${s.manifest.score}: ${s.manifest.loudness.gainDb >= 0 ? '+' : ''}${s.manifest.loudness.gainDb} dB`).join(' · ');
      status.textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)}s — ${res.scores.length} score${res.scores.length > 1 ? 's' : ''}, ${files} files${dir ? ` saved into “${dir.name}/${res.root}”` : ''}. Loudness gain: ${gains}.` +
        (res.hasScript ? '' : ' (AdaptiveMusicPlayer.cs wasn’t included — open the app from the website or local server, not as a file.)');
    } catch (err) {
      console.error(err);
      status.textContent = 'Unity export failed: ' + err.message;
    }
    btn.disabled = false;
  },

  /* ---------- shortcuts ---------- */
  initShortcuts() {
    const typing = (e) => { const el = e.target; return (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio'].includes(el.type)) || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || $('#exportDlg').open; };
    const held = new Set();
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); App.undo(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); App.redo(); }
        else if (k === 's') { e.preventDefault(); this.saveProject(); }
        else if (k === 'a' && this.view === 'roll') { e.preventDefault(); Roll.selectAll(); }
        return;
      }
      if (e.repeat) { if (k === ' ') e.preventDefault(); return; }
      if (k === ' ') { e.preventDefault(); Seq.playing ? Seq.stop() : Seq.start(); return; }
      if (k === 'enter') { Seq.stop(); Live.allOff(); return; }
      if (k === 'delete' || k === 'backspace') { if (this.view === 'roll') { e.preventDefault(); Roll.deleteSelected(); } return; }
      if (k === 'z') return this.shiftOct(-1);
      if (k === 'x') return this.shiftOct(1);
      if (k === 'r') return this.toggleRec();
      if (k === 'm') { $('#btnMetro').click(); return; }
      if (/^[0-9]$/.test(k)) {
        const v = DRUM_VOICES.find((d) => d.key === k), t = this.drumTrack();
        if (v && t) {
          Live.drumHit(t, v.id, 1);
          const pad = $(`.pad[data-v="${v.id}"]`);
          if (pad) { pad.classList.add('hit'); setTimeout(() => pad.classList.remove('hit'), 120); }
        }
        return;
      }
      if (k in this.keyMap) {
        const m = 12 * (App.octave + 1) + this.keyMap[k];
        held.add(k + ':' + m);
        Live.noteOn(m, App.vel);
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      for (const h of [...held]) {
        const [hk, m] = h.split(':');
        if (hk === k) { held.delete(h); Live.noteOff(+m); }
      }
    });
    window.addEventListener('blur', () => { held.clear(); Live.allOff(); });
    $$('#tabs button').forEach((b) => (b.onclick = () => {
      this.view = b.dataset.view;
      $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
      $$('.view').forEach((v) => v.classList.toggle('on', v.id === 'view-' + this.view));
      if (this.view !== 'style' && App.sel.role) {
        // Role editing belongs to the Game Style tab; elsewhere the panel follows the selected track.
        App.sel.role = null;
        this.renderTracks(); this.renderStyle(); this.renderInst(); this.renderKeyboard();
      }
      if (this.view === 'style') this.renderStyle();
      if (this.view === 'roll') Roll.scrollToNotes();
    }));
  },

  /* ---------- animation loop: playhead, position, scope ---------- */
  frame() {
    requestAnimationFrame(() => this.frame());
    const pos = Seq.playing && Engine.ctx ? Seq.posAt(Engine.ctx.currentTime) : null;
    if (pos) {
      const st = App.mode === 'song' ? pos.step : Math.floor(pos.local);
      $('#posDisplay').textContent = `${Math.floor(st / 16) + 1}.${Math.floor((st % 16) / 4) + 1}.${(st % 4) + 1}`;
      this.markBeatStep(pos.pat === App.sel.pattern ? Math.floor(pos.local) : -1);
      if (pos.pat !== this._playPat || pos.block !== this._playBlock) {
        this._playPat = pos.pat; this._playBlock = pos.block;
        $$('.pattern-item').forEach((e) => e.classList.toggle('playing', +e.dataset.i === pos.pat));
        $$('.arr-block').forEach((e) => e.classList.toggle('playing', App.mode === 'song' && +e.dataset.k === pos.block));
      }
      if (this.view === 'roll') Roll.draw(pos);
    } else this._playPat = this._playBlock = null;
    if (this.view === 'adaptive') this.markAdaptive();
    this.drawScope();
  },
  drawScope() {
    const c = $('#scope'), x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    const an = Engine.g && Engine.g.analyser;
    x.strokeStyle = '#4dabf7'; x.lineWidth = 1.5; x.beginPath();
    if (!an) { x.moveTo(0, c.height / 2); x.lineTo(c.width, c.height / 2); x.stroke(); return; }
    const d = this._scopeBuf || (this._scopeBuf = new Float32Array(an.fftSize));
    an.getFloatTimeDomainData(d);
    for (let i = 0; i < c.width; i++) {
      const v = d[Math.floor((i / c.width) * d.length)];
      const y = c.height / 2 - v * c.height * 0.45;
      i ? x.lineTo(i, y) : x.moveTo(i, y);
    }
    x.stroke();
  },
};
