# Synth Studio

A browser-based instrumental music workstation. Everything (synths, drums, effects, rendering) runs locally on the Web Audio API — no install, no build step.

## Run it

Double-click `index.html`, or serve the folder (recommended, needed for Web MIDI in some browsers):

```
python -m http.server 8775
```

then open http://localhost:8775. Chrome or Edge work best. (Avoid 8765 if you also run Dead Derby: its web tuning panel uses it.)

## Game projects

Synth Studio is built for making a game's soundtrack. A project is the whole game:

- **Levels** (sidebar) — one per level or cue. Each has its own patterns, key and tempo.
- **Game Style** tab — the game's instrument **roles** (Drums, Bass, Keys, Pad, Lead, …) and defaults for new levels. Every level's tracks play their role's sound, so changing a role changes it in every level.
- **The game decides; a level can override** — a track's sound shows *From the game style* until you press *Customize for this level*, which gives it its own sound in that level only (marked ✦). *Back to the game style* undoes it; *Make this the game style* promotes it to every level.
- The **master mix** (Mixer & FX) is part of the style and shared by every level, so levels stay consistent in loudness and character. A level can *Customize* its own mix (e.g. a bigger reverb for a cave).
- **Library** tab — every segment, sting and melody in the game. A level's patterns are *placed* from the library and stay **linked**: edit one in any level and it changes in every level that links it, moved into each level's key (drums aren't moved). Each track plays the part for its instrument role, so a pattern works in any level with those roles. *Make a version for this level* (above the Beat grid and Piano Roll) splits one off; *Back to the library version* relinks it. **Place** in the sidebar's Patterns section reuses a library pattern in the open level.
- **Themes** — the game's recurring melodies, kept in the Library as *melodies*. *Save as theme* in the Piano Roll, then insert it into any level: it's fitted to that level's key and scale, optionally at half/double speed or another octave. Inserted notes stay linked: *Re-apply theme* after the theme changes, or *Update theme from these notes* to push an edit back.
- **Flavors** — save a level's customizations (custom sounds + mix) as a named flavor and apply it to another level. Listed in Game Style → Flavors.

## Adaptive music

The **map** above the editor tabs shows a level's music the way the game moves through it (fold it away with ▾ Map):

- **Segments** are nodes, left to right; the first is where the level starts. A segment loops while the game stays in a state (explore, combat, boss…). Click one to edit it, double-click to rename, drag to reorder, ▶ to go there like the game does.
- **Stings** play once. One can be a segment's way in (*Enter through* in the bar above the editor; it shows as "⚡ Alert ›" on the segment). *Can play anytime* plays one like the game's PlaySting (the segment restarts after it). **End** ends the music on a sting, or fades out.
- **Changes land on** the next beat, bar, or end of the segment.
- **Simulate** (right of the map) plays the level like the game: ▶ Start from the first segment, Fade out, and the **intensity** slider. The transport's ▶ just loops the selected pattern.
- **Game events** — the names the game fires (RunStarted, ClockLow, …) are listed in Game Style → Game events. What each one does is set per level in Simulate › *Edit events…*: go to a segment, play a sting, set intensity, turn the music down or back up, end on a sting, fade out. Simulate's event buttons do exactly what the game would. The export carries them to Unity's MusicCues.
- **Sting settings** (the bar above the editor, with a sting selected): *When fired* — instead (the segment restarts after it), over the music (turned down while it plays), then go to a segment, or end the music — and when it *Starts*.
- **Intensity layers** (Mixer & FX) group tracks into stacked layers (e.g. Base → Rhythm → Intensity). The base always plays; each layer above fades in as intensity rises.

## Unity export

**Export → Unity adaptive package** renders one level or the whole game into a `.zip` (or straight into a folder in Chrome/Edge):

- one WAV stem per segment × intensity layer — seamless loops, exactly the segment's length, effect tails wrapped into the start
- one WAV per sting, with its natural tail
- `manifest.json` per level (tempo, layers, segments, stings, transition rule, loudness)
- loudness matched across levels to a LUFS target (default −16), peaks kept under −1 dBFS
- `AdaptiveMusicPlayer.cs`, the Unity component that plays it all: `GoToSegment("Action")`, `SetIntensity(0.7f)`, `PlaySting("Alert")`, `EndWithSting("Finish")`, `Stop(2f)`

Setup and import settings: [unity/README.md](unity/README.md).

## What's in it

- **Beat** – 10-voice drum step sequencer (kick, snare, clap, hats, toms, rim, cowbell, crash), 5 synthesized kits, per-pad level/tune/decay/pan, load your own samples onto any pad, velocity accents, 10 preset beat loops.
- **Piano Roll** – draw, move, resize, box-select, alt-drag duplicate, transpose, quantize. Key/scale highlighting, ghost notes from other tracks, and a loop generator (chords, basslines, arps, riffs) that follows your key and a chosen chord progression.
- **Instruments** – 11 presets (piano, e-piano, organ, bass, sub, pad, strings, lead, pluck, bell, brass) on a 2-oscillator subtractive synth with ADSR, filter + filter envelope, vibrato.
- **Mixer & FX** – per track: volume, pan, drive, tone filter, reverb and delay sends, mute/solo. Master: 3-band EQ, compressor, reverb (size/return), tempo-synced delay, limiter.
- **Playing & recording** – on-screen keyboard, computer keyboard (A W S E D F T G Y H U J K O L P, Z/X octave), Web MIDI keyboards. Press ● to record into the playing pattern (optional quantize). Metronome and swing.
- **Export** – WAV (16/24/32-bit float), MP3 (128–320 kbps; first use needs internet to load the encoder), per-track stems, Standard MIDI file, project file (.json). Audio and MIDI render either the selected pattern or a *playthrough*: a level's patterns in an order you set in the Export window (▶ Play it to hear it), for a trailer or soundtrack file. **Open** loads projects or imports MIDI files.

## Working with Claude (MCP)

`mcp/` holds an MCP server that lets Claude Code or Claude Desktop work in your open Synth Studio page — click **Connect Claude** in the top bar. Setup: [mcp/README.md](mcp/README.md).

## Publishing updates

The live site is served by GitHub Pages from `main`. Before committing a change that will be pushed, run:

```
sh tools/stamp-build.sh
```

It stamps a new build number into `index.html`'s file links and `version.txt`. Browsers then always load matching files after an update, and a page that's older than the published build reloads itself once. If the app ever fails to start, it shows a **Reload** message instead of a blank screen.

## Shortcuts

Space play/stop · Enter stop · R record · M metronome · 1–0 drum pads · Ctrl+Z / Ctrl+Y undo/redo · Ctrl+S save · Del delete selected notes · Ctrl+A select all notes (piano roll)

Work autosaves in the browser; use **Save** for a portable project file (custom samples are only kept in saved project files).
