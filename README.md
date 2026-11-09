# Synth Studio

A browser-based instrumental music workstation. Everything (synths, drums, effects, rendering) runs locally on the Web Audio API — no install, no build step.

## Run it

Double-click `index.html`, or serve the folder (recommended, needed for Web MIDI in some browsers):

```
python -m http.server 8765
```

then open http://localhost:8765. Chrome or Edge work best.

## Game projects

Synth Studio is built for making a game's soundtrack. A project is the whole game:

- **Scores** (sidebar) — one per level or cue. Each has its own patterns, arrangement, key and tempo.
- **Game Style** tab — the game's instrument **roles** (Drums, Bass, Keys, Pad, Lead, …) and defaults for new scores. Every score's tracks play their role's sound, so changing a role changes it in every level.
- **Level flavors** — on any track, *Customize for this level* gives it its own sound in that score only (marked ✦). *Revert to game style* undoes it; *Make this the game style* promotes it to every level.
- The **master mix** (Mixer & FX) is part of the style and shared by every score, so levels stay consistent in loudness and character.

## Adaptive music

The **Adaptive** tab sets up how a score responds to gameplay and lets you hear it the way the game will play it:

- **Segments & stings** — each pattern is either a *segment* (loops while the game stays in a state: explore, combat, boss…) or a *sting* (plays once). A segment can be entered *through* a sting.
- **Intensity layers** — tracks are grouped into stacked layers (e.g. Base → Rhythm → Intensity). The base always plays; each layer above fades in as intensity rises.
- **Preview** — pick a segment, switch to another while it plays (the change lands on the next beat, bar, or segment end), and drag the intensity slider. The transport's **Adaptive** mode is this preview.

## Unity export

**Export → Unity adaptive package** renders one score or the whole game into a `.zip` (or straight into a folder in Chrome/Edge):

- one WAV stem per segment × intensity layer — seamless loops, exactly the segment's length, effect tails wrapped into the start
- one WAV per sting, with its natural tail
- `manifest.json` per score (tempo, layers, segments, stings, transition rule, loudness)
- loudness matched across scores to a LUFS target (default −16), peaks kept under −1 dBFS
- `AdaptiveMusicPlayer.cs`, the Unity component that plays it all: `GoToSegment("Action")`, `SetIntensity(0.7f)`, `PlaySting("Alert")`, `Stop(2f)`

Setup and import settings: [unity/README.md](unity/README.md).

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
