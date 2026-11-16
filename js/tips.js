/* Tooltips for every setting and control, in plain words for someone new to music software.
   Each rule is [CSS selector, text]. Tips.apply() gives a matching element that tooltip when it has
   none of its own (a control's own, more specific tooltip wins). A rule starting with "!" replaces a
   too-short tooltip. A watcher re-applies them whenever the page re-draws part of itself, so
   controls the app builds later get theirs too. To change a tip, edit it here. */

const TIPS = [
  // ---------- top bar ----------
  ['#songName', 'The name of your game project. It is saved with the project.'],
  ['#bpm', 'Tempo in beats per minute: how fast this level\'s music plays. 60 = one beat a second; 120 = two.'],
  ['#btnExport', 'Make files from your music: the Unity package for the game, WAV/MP3 audio, stems, MIDI or the project file.'],
  ['#scope', 'A live picture of the sound coming out, so you can see when something is playing.'],

  // ---------- tabs ----------
  ['#tabs [data-view="beat"]', 'Beat grid: switch drum hits on and off in a grid of steps (16 steps = one bar).'],
  ['#tabs [data-view="roll"]', 'Piano roll: draw notes for melodies, chords and bass. Higher rows are higher notes; left to right is time.'],
  ['#tabs [data-view="mixer"]', 'Mixer & FX: how loud each instrument is, where it sits left/right, its effects, and the intensity layers.'],
  ['#tabs [data-view="library"]', 'Library: every instrument, segment, sting and melody in the game, shared by all levels.'],
  ['#tabs [data-view="style"]', 'Game style: settings every level shares — game events, flavors, defaults for new levels and the master sound.'],

  // ---------- level settings ----------
  ['#songKey', 'The key: the note the music feels "at home" on. The piano roll highlights the notes that fit it.'],
  ['#songScale', 'The scale: which notes belong to the key. Major sounds bright and happy, minor darker or sad; the others are in between.'],

  // ---------- editor header ----------
  ['[data-po-add]', 'Choose a game event that should start this track (for example RunStarted). The game fires events; the music answers.'],
  ['.barsSel', 'How long this track is, in bars (one bar = 4 beats). A segment repeats after this many bars. Its instruments repeat inside it if their parts are shorter.'],
  ['.partLen', 'How long this instrument\'s part is before it starts again. In a longer track it repeats; a shorter track plays only its start. Changes it everywhere the instrument plays.'],

  // ---------- piano roll ----------
  ['#rollSnap', 'Snap: the grid that notes line up to when you draw or move them. 1/16 = a quarter of a beat; 1 bar = four beats.'],
  ['#rollLen', 'Length of a new note when you click to add one. 1/4 = one beat.'],
  ['#rollVel', 'Velocity: how hard new notes are played — louder and brighter to the right.'],
  ['#rollZoom', 'Zoom: makes the rows taller or shorter.'],
  ['#rollGrid', 'Click an empty spot to add a note · drag a note to move it · drag its right edge to make it longer · right-click to delete · Shift-drag to select several. The notes belong to the instrument, so they\'re the same everywhere it plays. A yellow line is where its part starts again.'],
  ['#rollKeys', 'The piano keys for each row. Highlighted rows are notes in the level\'s key.'],
  ['#rollDrumKeys, #rollDrums', 'The drums in this track (edit them in the Beat tab).'],
  ['#loopGen', 'A ready-made pattern to start from: chords, a bassline, an arpeggio (notes of a chord one after another) or a riff.'],
  ['#loopProg', 'Chord progression: the order of chords the generated pattern follows. Numbers are chords of the key (1 = home chord).'],
  ['#recQuant', 'When you record from the keyboard, move each note onto the snap grid so it\'s perfectly in time.'],
  ['#btnRollClear', 'Delete every note of this instrument — everywhere it plays, since the notes belong to the instrument (Undo brings them back).'],
  ['#themeSel', 'A melody or progression saved in the library, to reuse in this track.'],
  ['#themeOct', 'Play the melody higher or lower by whole octaves (an octave = 12 notes; the same note, higher or lower).'],
  ['#themeSpeed', 'Play the melody twice as fast, normal, or half as fast.'],

  // ---------- beat grid ----------
  ['#beatTrack', 'Which drum instrument the grid shows, when the track has more than one.'],
  ['#beatKit', 'The drum kit: the set of drum sounds (analog, electronic, acoustic…).'],
  ['#beatLoop', 'A ready-made drum pattern. Press Load to put it in the grid (it replaces what\'s there).'],
  ['#btnBeatApply', 'Replace this drum instrument\'s beat with the chosen beat loop (everywhere it plays).'],
  ['#btnBeatClear', 'Switch every hit of this drum instrument off, everywhere it plays (Undo brings them back).'],
  ['#beatGrid', 'The drum instrument\'s beat. It belongs to the instrument, so it\'s the same in every track that plays it. Dimmed steps are the beat repeating; editing any repeat changes them all.'],
  ['!#beatGrid .knob:has([data-k="level"])', 'Level: how loud this drum is.'],
  ['!#beatGrid .knob:has([data-k="tune"])', 'Tune: makes this drum higher or lower in pitch.'],
  ['!#beatGrid .knob:has([data-k="decay"])', 'Decay: how long this drum rings after it\'s hit.'],
  ['!#beatGrid .knob:has([data-k="pan"])', 'Pan: where this drum sits between the left and right speaker.'],

  // ---------- curves ----------
  ['#cvTarget', 'Which instrument the curve changes (or, on a sting, the whole sting\'s speed).'],
  ['.cv-canvas', 'Click to add a point · drag to move it (hold Shift: up and down only) · double-click to delete · right-click: smooth or straight to the next point.'],
  ['[data-param="vol"], [data-ic="param"][data-v="vol"]', 'Volume curve: louder or quieter over time (100% = as mixed).'],
  ['[data-param="pan"], [data-ic="param"][data-v="pan"]', 'Pan curve: move the sound between left and right over time.'],
  ['[data-param="rev"], [data-ic="param"][data-v="rev"]', 'Reverb curve: more or less room echo over time (100% = as mixed).'],
  ['[data-param="dly"], [data-ic="param"][data-v="dly"]', 'Delay curve: more or less repeating echo over time (100% = as mixed).'],
  ['[data-param="cut"], [data-ic="param"][data-v="cut"]', 'Filter curve: lower = darker and muffled, higher = brighter.'],
  ['[data-param="pitch"], [data-ic="param"][data-v="pitch"]', 'Pitch curve: bend the notes up or down, in semitones (12 = an octave).'],
  ['[data-param="speed"]', 'Speed curve: play the sting faster or slower over time.'],
  ['[data-ic="bars"], [data-cv="bars"]', 'How long the instrument\'s curves are before they start again.'],

  // ---------- sound (synth) ----------
  ['[data-k="preset"]', 'A starting sound. Choosing one replaces the settings below (the per-note shape stays).'],
  ['[data-k="kit"]', 'The drum kit: the set of drum sounds this instrument uses.'],
  ['[data-k="o1"]', 'Oscillator 1 wave shape — the raw tone. Sine is pure and soft, triangle mellow, sawtooth bright and buzzy, square hollow.'],
  ['[data-k="o2"]', 'Oscillator 2 wave shape — a second tone mixed with the first for a richer sound.'],
  ['[data-k="o2semi"]', 'How far oscillator 2 is tuned from oscillator 1, in semitones (12 = an octave up, −12 = down).'],
  ['[data-k="detune"]', 'Detune: puts oscillator 2 slightly out of tune with 1, for a thicker, wobbly sound.'],
  ['[data-k="mix"]', 'Osc mix: how much of oscillator 2 you hear compared with oscillator 1.'],
  ['[data-k="oct"]', 'Octave: plays everything higher or lower by whole octaves.'],
  ['[data-k="a"]', 'Attack: how quickly a note fades in. Short = sudden like a pluck; long = a slow swell like strings.'],
  ['[data-k="d"]', 'Decay: how quickly the note drops from its first peak down to the sustain level.'],
  ['[data-k="s"]', 'Sustain: how loud the note stays while it\'s held, after the decay.'],
  ['[data-k="r"]', 'Release: how long the sound fades after the note ends.'],
  ['#instPanel [data-k="cut"]', 'Cutoff (filter): lower = darker, muffled sound; higher = brighter.'],
  ['[data-k="res"]', 'Resonance: boosts the sound right at the cutoff, for a sharper, "squelchy" tone.'],
  ['[data-k="env"]', 'Filter envelope: how much brighter each note starts before it settles to the cutoff.'],
  ['[data-k="fdec"]', 'Filter decay: how fast that bright start fades back to the cutoff.'],
  ['[data-k="lfoRate"]', 'Vibrato rate: how fast the pitch wobbles.'],
  ['[data-k="lfoDepth"]', 'Vibrato depth: how much the pitch wobbles (0 = none).'],
  ['[data-k="gain"]', 'Level: the instrument\'s own loudness, before the mixer.'],
  ['[data-ic="mode"][data-v="repeat"]', 'The instrument\'s curves: they repeat every few bars in every track that uses this instrument.'],
  ['[data-ic="mode"][data-v="note"]', 'A shape drawn over every note, stretched to each note\'s length.'],
  ['#newRolePreset', 'The kind of sound a new instrument starts with.'],
  ['[data-act="addRole"]', 'Make a new instrument in the library. Then add it to a track with the sidebar\'s + Instrument.'],

  // ---------- mixer ----------
  ['.strip.master [data-k="vol"]', 'Master volume: how loud the whole mix is.'],
  ['.mixer [data-k="vol"], .inst-grid[data-scope="mix"] [data-k="vol"]', 'Volume: how loud this instrument is in the mix.'],
  ['.mixer [data-k="pan"], .inst-grid[data-scope="mix"] [data-k="pan"]', 'Pan: where it sits between the left and right speaker (C = centre).'],
  ['.mixer [data-k="drive"], .inst-grid[data-scope="mix"] [data-k="drive"]', 'Drive: adds grit and distortion.'],
  ['.mixer [data-k="tone"], .inst-grid[data-scope="mix"] [data-k="tone"]', 'Tone: turn down to make it darker and softer (cuts the high frequencies).'],
  ['.mixer [data-k="rev"], .inst-grid[data-scope="mix"] [data-k="rev"]', 'Reverb: how much room echo it gets, as if played in a bigger space.'],
  ['.mixer [data-k="dly"], .inst-grid[data-scope="mix"] [data-k="dly"]', 'Delay: how much repeating echo it gets.'],
  ['[data-act="mute"]', 'Mute: silence this instrument.'],
  ['[data-act="solo"]', 'Solo: hear only this instrument (and others on solo).'],
  ['[data-k="low"]', 'Bass EQ: more or less low end (boom) for the whole mix.'],
  ['[data-k="mid"]', 'Middle EQ: more or less of the middle frequencies (body) for the whole mix.'],
  ['[data-k="high"]', 'Treble EQ: more or less high end (sparkle) for the whole mix.'],
  ['[data-k="comp"]', 'Compressor threshold: lower evens out loud and quiet parts more, for a punchier, steadier sound.'],
  ['[data-k="revSize"]', 'Reverb size: how big the room sounds (seconds the echo lasts).'],
  ['[data-k="revLevel"]', 'Reverb return: how loud the reverb is overall.'],
  ['[data-k="dlyDiv"]', 'Delay time, in note lengths, so the echoes land in time with the beat.'],
  ['[data-k="dlyFb"]', 'Delay feedback: how many times the echo repeats.'],
  ['[data-act="addLayer"]', 'Add an intensity layer: instruments on it fade in as the game\'s intensity rises.'],

  // ---------- library ----------
  ['[data-filter="all"]', 'Show everything in the library.'],
  ['[data-filter="segment"]', 'Show only segments (music that loops while the game stays in a state).'],
  ['[data-filter="sting"]', 'Show only stings (short pieces that play once, e.g. for a pickup or an alarm).'],
  ['[data-filter="melody"]', 'Show only melodies (themes you can reuse in any track).'],

  // ---------- game style ----------
  ['#styleEventName', 'The name of a new game event, exactly as the game\'s code fires it (e.g. BossAppears).'],
  ['[data-act="addEvent"], [data-ea="addEvent"]', 'Add a game event: something the game tells the music, like "the boss appeared".'],
  ['[data-act="openInstruments"], [data-act="openLibrary"]', 'Go to the Library tab.'],
  ['[data-def="key"]', 'The key new levels start in.'],
  ['[data-def="scale"]', 'The scale new levels start in.'],
  ['[data-def="bpm"]', 'The tempo new levels start at (beats per minute).'],

  // ---------- simulate ----------
  ['#intensity', 'Intensity: how intense the game is right now. Higher fades in more intensity layers — the game sets this while you play.'],

  // ---------- events window ----------
  ['[data-ef="do"]', 'What the music does when the event fires.'],
  ['[data-ef="target"]', 'Which segment or sting it plays.'],
  ['[data-ef="value"]', 'The amount (a percentage or a number of seconds).'],
  ['[data-ea="newKind"]', 'The kind of action to add.'],
  ['[data-ea="addAction"]', 'Add another thing the music does for this event (they happen in order).'],
  ['[data-ea="revert"]', 'Drop this level\'s own setting and use the game-wide one again.'],
  ['#newEventName', 'The name of a new game event, exactly as the game\'s code fires it.'],

  // ---------- export window ----------
  ['input[name="fmt"][value="unity"]', 'Everything the game needs: each segment\'s audio, the stings, and a file that tells the Unity music player how they fit together.'],
  ['input[name="fmt"][value="wav16"]', 'A WAV audio file (CD quality). Plays anywhere; large.'],
  ['input[name="fmt"][value="wav24"]', 'A WAV audio file with more detail, for further editing.'],
  ['input[name="fmt"][value="wav32"]', 'A WAV audio file with the most detail (32-bit float), for audio editors.'],
  ['input[name="fmt"][value="mp3"]', 'An MP3 audio file: small, good for sharing.'],
  ['#mp3Rate', 'MP3 quality: higher kbps sounds better and makes a bigger file.'],
  ['input[name="fmt"][value="stems"]', 'One WAV file per instrument, to mix elsewhere.'],
  ['input[name="fmt"][value="midi"]', 'The notes only (no sound), to open in other music software.'],
  ['input[name="fmt"][value="project"]', 'The whole project as a file, to back it up or open it later.'],
  ['input[name="uscope"][value="score"]', 'Export only the level that\'s open.'],
  ['input[name="uscope"][value="all"]', 'Export every level in the game.'],
  ['#uFolder', 'Write the files straight into a folder you pick (e.g. your Unity project’s Assets folder) instead of downloading a .zip.'],
  ['#uLufs', 'Loudness target, so every level plays at the same volume in the game. −16 suits most games.'],
  ['#uRate', 'Sample rate: 48000 is standard for games and video; 44100 for music.'],
  ['#uBits', 'Bit depth: 16-bit is plenty for a game; 24-bit keeps more detail.'],
  ['input[name="src"][value="song"]', 'Export the patterns in the order you set below, one after another.'],
  ['input[name="src"][value="pattern"]', 'Export only the selected pattern, repeated this many times.'],
  ['#expRepeats', 'How many times to repeat the pattern.'],
  ['#arrLoop', 'Play the order again from the start when it ends.'],
  ['#btnArrClear', 'Empty the order.'],
  ['#expRate', 'Sample rate: 44100 for music, 48000 for video and games.'],
  ['#expTail', 'Seconds of silence kept at the end so the last echoes can fade out.'],
  ['#exportDlg button[value="cancel"], #eventsDlg button[value="close"]', 'Close this window.'],
  ['#btnDoExport', 'Make the file(s) with these settings.'],
];

const Tips = {
  init() {
    this.apply();
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; this.apply(); });
    }).observe(document.body, { childList: true, subtree: true });
  },
  apply(root = document) {
    for (const [sel0, text] of TIPS) {
      const force = sel0[0] === '!', sel = force ? sel0.slice(1) : sel0;
      let els;
      try { els = root.querySelectorAll(sel); } catch (e) { continue; }   // a selector this browser can't read
      els.forEach((el) => {
        const lab = el.closest('label');
        if (force) { if (el.title !== text) el.title = text; return; }
        if (el.title || (lab && lab.title)) return;
        el.title = text;
      });
    }
  },
};
