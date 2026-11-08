# Synth Studio

A browser-based instrumental music workstation. Everything (synths, drums, effects, rendering) runs locally on the Web Audio API — no install, no build step.

## Run it

Double-click `index.html`, or serve the folder (recommended, needed for Web MIDI in some browsers):

```
python -m http.server 8765
```

then open http://localhost:8765. Chrome or Edge work best.

## What's in it

- **Beat** – 10-voice drum step sequencer (kick, snare, clap, hats, toms, rim, cowbell, crash), 5 synthesized kits, per-pad level/tune/decay/pan, load your own samples onto any pad, velocity accents, 10 preset beat loops.
- **Piano Roll** – draw, move, resize, box-select, alt-drag duplicate, transpose, quantize. Key/scale highlighting, ghost notes from other tracks, and a loop generator (chords, basslines, arps, riffs) that follows your key and a chosen chord progression.
- **Instruments** – 11 presets (piano, e-piano, organ, bass, sub, pad, strings, lead, pluck, bell, brass) on a 2-oscillator subtractive synth with ADSR, filter + filter envelope, vibrato.
- **Arrange** – build a song from patterns; drag to reorder. Pattern mode loops one pattern, Song mode plays the arrangement.
- **Mixer & FX** – per track: volume, pan, drive, tone filter, reverb and delay sends, mute/solo. Master: 3-band EQ, compressor, reverb (size/return), tempo-synced delay, limiter.
- **Playing & recording** – on-screen keyboard, computer keyboard (A W S E D F T G Y H U J K O L P, Z/X octave), Web MIDI keyboards. Press ● to record into the playing pattern (optional quantize). Metronome and swing.
- **Export** – WAV (16/24/32-bit float), MP3 (128–320 kbps; first use needs internet to load the encoder), per-track stems, Standard MIDI file, project file (.json). **Open** loads projects or imports MIDI files.

## Shortcuts

Space play/stop · Enter stop · R record · M metronome · 1–0 drum pads · Ctrl+Z / Ctrl+Y undo/redo · Ctrl+S save · Del delete selected notes · Ctrl+A select all notes (piano roll)

Work autosaves in the browser; use **Save** for a portable project file (custom samples are only kept in saved project files).
