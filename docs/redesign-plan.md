# Synth Studio redesign plan

Started 2026-11-11. A living doc: update it as decisions change and as each step ships.

Mock (private design canvas): https://claude.ai/artifact/6KHGEoAF7VkJqNYMtUVKHq. Board **B · Map strip over the editor** is the chosen layout. Its editor areas are placeholders: they do not show everything the real editors keep (see the must-keep list below).

## Why

The current app is organised around tools (Beat, Piano Roll, Arrange, Adaptive, Mixer, Game Style tabs, plus Scores / Tracks / Patterns in the sidebar). Making a game's music means hopping between them, and the same idea (a level, a pattern, a sound) shows up in several places. The aim is a clear workflow that keeps all the flexibility.

## Decisions

1. **Game music only.** No standalone song mode. Rendering a WAV/MP3/stems/MIDI stays, as an export option.
2. **The game decides; a level can override.** Sounds, mix and library patterns default to the whole game. Each shows where it comes from ("From the game style" / "From the library") with one button to customize it for this level, and one to go back.
3. **One level map replaces Arrange and Adaptive.** Segments are nodes. Any segment can go to any other; arrows show only routes with a sting or special timing.
4. **Stings work like film cues.** A sting is either on an arrow (it leads somewhere) or *can play anytime* (a game event fires it over whatever is playing). Each sting chooses how it plays:
   - Over the music (music keeps going, turned down)
   - Instead, then back (music pauses, then carries on)
   - Then go to a segment (shows as an arrow)
   - End the music
   and when it starts: right away, next beat, next bar. A sting can be built from a library melody so a character's theme stays recognisable.
5. **The game decides what plays; Synth previews it.** Game events (RunStarted, ClockLow, RunOver…) are defined in Synth, simulated on the map, and exported for Unity's MusicCues to read. The MusicCues table stays only for overrides.
6. **A library of patterns.** Every segment, sting and melody lives in one game-wide Library. Placing one in a level links it; "Make a version for this level" splits off a level's own copy. Themes merge into the Library as melodies.
7. **Layout B.** The level's map stays on screen as a strip; clicking a segment or sting edits it underneath. Simulate panel on the right of the map.
8. **Several instruments in one piano roll** (step 5): pick which tracks show; you write into one at a time.
9. **Nothing is removed silently.** Every current control is kept or moved, and the move is written down below.

## Hierarchy

```
Game
├─ Game style    instrument roles, flavors (level looks), defaults, master mix
├─ Library       segments, stings, melodies (themes)
└─ Levels
   └─ Level 1 — Meadow
      ├─ Map            segments, arrows, anytime stings, game events (simulate)
      ├─ Segment editor tracks as tabs → piano roll / beat grid + sound panel
      └─ Mix            this level's track levels, sends, optional custom master
```

## Steps

Each step ships on its own, keeps the app working, and is checked against the must-keep list.

1. ✅ **Wording and scope** (done 2026-11-12). Scores → Levels in the app; "From the game style" / "Customized for this level" / "Back to the game style" on every scope badge and button. Song mode and the Arrange tab are gone; their pattern order is now the *playthrough* in the Export dialog (add, reorder, remove, ▶ Play it, Loop, Clear). The data is still `score.arrangement`; `set_arrangement` now describes it as the export playthrough, and `get_score` reports it as `playthrough`. MCP tool and argument names still say *score*: they change with the data model in step 2.
2. ✅ **Library** (done 2026-11-12, as designed below; code in `js/library.js`). Library tab, ⇄ marks and Place in the sidebar, the library bar above the Beat grid and Piano Roll, `place_pattern` and `library_item` for Claude. Things to know:
   - Changing a level's key now moves its linked patterns into the new key (the short way round, so D → E can move notes down rather than up).
   - Every new level starts with an empty "Main" pattern, which also becomes a library item ("Main 2", …). Fine for now; the map in step 3 may start levels empty.
   - The sidebar's Delete is now **Remove** (from this level); deleting from the game happens in the Library tab.
3. ✅ **Level map (layout B)** (done 2026-11-12, as designed below; code in `js/map.js`). The map shows only what the Unity player does today; the new sting behaviours (over the music, then go to, per-sting timing) moved to step 4. Things to know:
   - The map folds away (▾ Map). The first time, windows shorter than 860 px start folded, because the editors' toolbars already take a lot of height; folded, Simulate's Start / Fade stay in the header.
   - The pattern bar above the editors now holds Segment / Sting, Enter through, Duplicate and Remove, plus the library link.
   - Layers are in Mixer & FX; a track's layer shows in its sidebar tooltip.
4. **Game events.** Events defined in Synth, fired from the Simulate panel, exported in the manifest; Unity MusicCues reads them, with its table for overrides only.
   - ✅ **4a, Synth** (done 2026-11-12; code in `js/events.js`, sting behaviours in `Seq.request` / `tick`). Game Style → Game events; Simulate's event buttons and *Edit events…*; sting settings (When fired, Starts, music level) in the pattern bar; manifest version 2 with `cues` and sting `play/then/at/duck`; Claude's `set_events`, `set_cues`, `set_sting`. Until 4b, the Unity player ignores the new manifest fields, so a sting set to *over* / *then go to* still plays *instead* in the game.
   - ✅ **4b, Unity** (done 2026-11-12): `unity/AdaptiveMusicPlayer.cs` (PlaySting follows the sting's play/then/at/duck; over the music turns only the loop down; test panel lists events) and `unity/MusicCues.cs` (table rows override the exported cues). Compile-checked against Unity 6000.6.7f1's DLLs and copied into DeadDerby's `Assets/_Project/Audio/Music/`. Play-tested in ProvingTrench (2026-11-12): compiles in Unity, reads the old version 1 export, all seven events from the scene's table work, and *over the music* (loop turns down, comes back) and *then go to* work when set on the sting; Console clean. DeadDerby's seven events and cues are in the Synth project; the version 2 export is in DeadDerby and every event runs from it (`(export)` in the Console) when the scene's table is empty. The scene's MusicCues table was then emptied (ProvingTrench saved), so the export drives the music; the game's own RunWaiting at scene start runs from the export.
   - Unity work: play a sting *over* the music without stopping the loop (with ducking). "Instead, then back" is PlaySting; "End the music" is EndWithSting.
5. ✅ **Several instruments at once: the layered roll** (done 2026-11-12, as designed below; code in `js/roll.js` — hiddenSet / onChip / drawDrums — and `UI.renderRollBar`). The piano roll shows the tracks you pick in their own colours, with a drum strip on top. Clicking a chip keeps the roll's scroll position (the sidebar still centres on the track's notes). Other tracks' notes can't be clicked.
6. **Instruments, tracks, curves and events** (asked 2026-11-15; designed below, not started). Instruments are authored in the Library; a *track* is a piece of music that combines instruments and is saved in the Library; curves shape a track and each instrument in it over time; tracks are assigned to game events. Four parts, each shipping on its own: 6a instruments, 6b tracks own their instruments, 6c curves, 6d events on tracks.
7. **Later:** maybe weave a theme into whatever is playing instead of a separate sting; maybe a stacked-lanes overview of the whole pattern.

## Step 2 design: the library

### Today
A pattern lives inside one level, and its notes are filed under that level's **track ids** (`pattern.notes[trackId]`, `pattern.drums[trackId]`). Another level has different track ids, so a pattern can't be reused: it has to be rebuilt. Themes are already game-wide (`project.themes`) and linked into patterns through `pattern.origins`.

### New model
```
project.library = [ item ]
item  = { id, name, kind: 'segment' | 'sting' | 'melody', bars, key, scale,
          parts: { [partKey]: notes[] | drums{voice: steps[]} },   // segment / sting
          notes, role }                                            // melody (today's theme)
track.part      = partKey      // which part of a library pattern this track plays
level pattern   = today's pattern + { lib: itemId | null, from: itemId | null }
```
- **Parts are named by instrument role, not by track.** A level's first Bass track plays the `bass` part, so any level with a Bass track can play the pattern. A second track on the same role (e.g. "Keys 2") gets its own part (`keys:2`).
- **Linked**: `lib` is set. The level shows "From the library: Chase riff · also in Ice Caves". Editing it edits the library item, so every level that links it changes.
- **Own version**: "Make a version for this level" sets `lib = null, from = itemId`. The level now has its own copy; "Back to the library version" drops the copy and relinks.
- **Every pattern is in the library.** "+ New pattern" in a level creates a library item and places it. Removing a pattern from a level only removes it from that level; the item stays in the Library until deleted there.
- **Melodies are today's themes**, moved into the library with `kind: 'melody'`. Insert, fit to key, octave, speed, re-apply and update keep working as now.
- **Segment vs sting is the item's**, so it's the same everywhere. **Entry sting is the level's** (it's routing, and becomes an arrow on the map in step 3).

### Key and tempo
- A library item remembers the key it was written in. Placed in a level with another key, its pitched parts are **shifted to the level's key** (A minor → D minor = up 5 semitones). Drums aren't shifted. Tempo and swing are always the level's.
- Shifting is exact both ways, so editing in either level and propagating loses nothing. If the level's scale differs (minor vs major), notes are shifted, not refitted, and the editor says so. Melodies keep today's "Fit to key" refit.

### How it runs
Levels keep a full working copy of each placed pattern in today's shape. Playback, Unity export, audio/MIDI export and the editors don't change. After every edit the copies sync: a linked copy writes its parts back to the library item (shifted into the item's key), and the item rewrites every other level's linked copy. Edits from Claude go through the same path.

### Migration (automatic, on load)
- Every existing pattern becomes a library item, linked from its level. Same-named items from different levels get the level's name added ("Explore (Ice Caves)"), since their notes differ.
- Each track gets a part key from its role (second and later tracks of a role get `:2`, `:3`).
- `project.themes` become melodies; links from `pattern.origins` keep working.
- Undo history and saved files load as before; the first save writes the new shape.

### UI in step 2 (before the map exists)
- A **Library** tab: filter All / Segments / Stings / Melodies; each item's length, key and where it's used (linked or own version); Place in this level, Rename, Duplicate, Delete (asks first if it's used). Themes move here from the Game Style tab.
- **Patterns sidebar**: each pattern shows a link mark; "+ Place from library" next to "+ New".
- **Editors**: a badge above the Beat grid and Piano Roll, "From the library: X · also in …", with "Make a version for this level" / "Back to the library version".

### Claude tools
- `get_project` lists the library; `get_score` marks each pattern linked / own version.
- New: `place_pattern` (put a library item in a level), `library_item` (rename, duplicate, delete, make own version, relink).
- Theme tools keep their names and work on library melodies.
- Edits to a linked pattern report which other levels changed.

## Step 3 design: the level map (layout B)

### What the game can do today (Unity player)
- **Start**: plays the level's first segment (`startSegment` = first segment in the manifest).
- **GoToSegment(X)**: at the next change point (the level's *change on*: beat, bar or segment end), through X's entry sting if it has one.
- **PlaySting(S)**: at the next change point the loop stops, S plays once, then the current segment **restarts**.
- **EndWithSting(S)** / **Stop(fade)**: end on a sting, or fade out.
- **SetIntensity**: fades the upper layers in and out.

The preview must never promise what the game can't do, so step 3 draws and simulates exactly these. The new sting behaviours from the mock (play *over* the music, *then go to* a segment, per-sting timing) need Unity work, so they land in step 4 together with game events — preview and game change together.

### Layout
```
┌ top bar ───────────────────────────────────────────────────────────────┐
│ Levels  │ MAP  ▾                     + Segment  + Sting  Place ▾  Changes land on [next bar] │ SIMULATE           │
│ Tracks  │ [▶ Intro] → [⚡Alert› ▶ Explore] [▶ Action] … [■ End: ⚡Finish / fade]              │ ▶ Start  ■  Fade   │
│         │ Can play anytime: [⚡Alert ▶] [⚡Finish ▶]                                           │ Intensity ━━━○━━   │
│         ├─────────────────────────────────────────────────────────────────────────────────────┤ Base Rhythm Lead   │
│         │ pattern bar: Action · Segment ▾ · Enter through ⚡Alert ▾ · From the library … │ Playing: Explore → │
│         │ Beat | Piano Roll | Mixer & FX | Library | Game Style                                               │
│         │ (editor)                                                                                             │
```
- **The map strip** sits above the editor tabs on every tab, and folds away (▾) to give the editor room.
  - **Segments are nodes, left to right.** The first one is where the level starts (it becomes Unity's start segment). Drag to reorder; double-click to rename; ✕ removes from the level.
  - **An entry sting shows on its segment** ("⚡ Alert ›"), because the game plays it whenever it goes *into* that segment, from anywhere.
  - **End** is the last node: it lists the stings the level can end on, and Fade out.
  - **Can play anytime** lists the level's stings; ▶ plays one the way PlaySting does (the segment restarts after it).
  - **Header**: + Segment, + Sting, Place from library, and *Changes land on* (beat / bar / end of segment).
- **Clicking a node edits it**: the editor below shows that pattern (Beat grid or Piano Roll, following the selected track). Selecting and playing are separate: each node has its own ▶.
- **The pattern bar** above the editors (today's library bar) also holds the node's settings: **Segment / Sting**, and for a segment **Enter through ⚡…**. Plus the library link and *Make a version for this level*.
- **Simulate** (right of the map): ▶ Start (from the first segment), ■ Stop, Fade out, the intensity slider with layer meters, and one line saying what's playing and what's queued. Playing / queued nodes light up on the map.
- **Gone**: the Adaptive tab, the transport's Pattern / Adaptive switch (the transport ▶ loops the selected pattern; the map plays the game), and the sidebar's Patterns list (the map shows the same things).
- **Intensity layers move to Mixer & FX**: the layer list (rename, + Layer, remove) at the top, and a Layer picker on each track strip. The sidebar's track rows show each track's layer.

### Data
No new data: the map is drawn from what levels already have. Node order is the order of the level's patterns (reordering updates the export playthrough so it still plays the same patterns). Entry stings, change-on timing and layers are unchanged, so the Unity export and Claude's tools keep working. `set_pattern` / `set_score` descriptions say "map" where they now affect it.

### Must-keep for the Adaptive tab (moves in this step)
| Now | Goes to |
|---|---|
| Segment buttons, sting buttons | ▶ on map nodes and *Can play anytime* |
| End on ⚡ sting, Fade out | End node, Simulate |
| Intensity slider, layer meters | Simulate |
| Change segment on | Map header |
| Pattern type, Enter through | Pattern bar |
| Layers list, rename, + Layer, remove, track → layer | Mixer & FX |

## Step 4 design: game events and sting behaviours

### Today
- DeadDerby's `RunMusic` fires cue **names** (RunWaiting, RunStarted, SlowMotionOn/Off, Paused, Resumed, RunOver). What each one does lives in the **MusicCues table in the scene** (ProvingTrench): e.g. RunWaiting → Go To Segment Intro + Set Intensity 0.2; RunOver → End With Sting Finish.
- So the music's behaviour is split: segments and stings in Synth, cues in a Unity Inspector table. Synth can't preview a cue, and renaming a segment in Synth silently breaks a cue.

### Goal
Synth holds the whole picture. The game only says *what happened*; Synth says *what the music does*, previews it, and exports it. The scene's table stays, but only for overrides.

### Game events (Synth)
- **The game's events** are a game-wide list (Game Style tab → Game events): names exactly as the game fires them, each with an optional note ("the run clock starts"). DeadDerby's seven get added to the real project with Claude's `set_events` / `set_cues`, copied from the scene's table (the demo project has a similar set built in).
- **What each event does is set per level** (segment names differ per level), as a short list of actions:

  | Action | Unity call |
  |---|---|
  | Go to segment *X* | GoToSegment |
  | Start at segment *X* (right away) | Play |
  | Play sting *S* (the way S is set to play) | PlaySting |
  | Set intensity *n %* | SetIntensity |
  | Turn the music down to *n %* / back up | Duck / Unduck |
  | End on sting *S* / Fade out over *n s* | EndWithSting / Stop |

  A new level copies the events' actions from the level it's duplicated from.
- **Simulate** lists the level's events as buttons. Pressing one does exactly what the game would: the map lights up, intensity moves, and the status line says what happened ("RunStarted → Action through ⚡Alert at the next bar").
- **Editing**: "Edit events…" in Simulate opens a window with one row per event and its actions for this level (add, change, remove, reorder).

### Sting behaviours (Synth + Unity)
Each sting in a level chooses how it plays when an event (or PlaySting) fires it. Shown in the pattern bar when a sting is selected, and as a short label on its map chip:
- **Instead, then the segment restarts** (default; today's PlaySting)
- **Over the music**: the loop keeps playing, turned down to *n %* while the sting plays (default 60%)
- **Then go to *X***: the sting plays, then segment X starts (it shows as an arrow on the map from the sting to X)
- **End the music**: like End on sting
- **Starts**: the level's *Changes land on* (default), or right away / next beat / next bar for this sting

A sting used as a segment's *Enter through* still always leads into that segment.

### Export
The manifest gains `cues` (event → actions, same names as MusicCues) and, per sting, `play`, `then`, `at` and `duck`. Manifest version goes to 2; the Unity scripts read version 1 files as before.

### Unity (Synth repo's `unity/` scripts, then copied into DeadDerby)
- **MusicCues**: `Trigger("RunStarted")` uses the Inspector table's rows for that name if there are any, otherwise the manifest's cues. The table becomes "overrides". The name check warns about events neither knows.
- **AdaptiveMusicPlayer**: PlaySting follows the sting's `play` and `at`. *Over the music* plays the sting on its own sources and turns only the loop down for the sting's length.
- **DeadDerby**: after re-exporting (with your OK, as before), the scene's table keeps working unchanged because it overrides with the same meaning. Clearing it so Synth drives everything is a separate step I'll ask about.

### Claude tools
`set_events` (the game's event list), `set_cues` (a level's actions for an event), `set_sting` (behaviour and timing). `get_score` shows each event's actions and each sting's behaviour; `fire_event` isn't needed (Claude can't hear it).

### Order of work
- **4a, Synth only**: events, cues, sting behaviours, Simulate, export fields, Claude tools. Nothing changes in the game.
- **4b, Unity**: the two scripts, then export into DeadDerby (asking first), and a Play-mode test of each event in ProvingTrench.

## Step 5 design: the layered roll

### Today
The piano roll edits one synth track, picked in the Track menu or the sidebar. *Ghost notes* (on by default) draws every other synth track's notes faintly, all at once, with no way to choose. The drums are only visible in the Beat grid.

### Track chips (replace the Track menu and Ghost notes)
A row of chips at the start of the piano roll's toolbar, one per synth track in the level, in the level's track order and colours:
- **Writing** (✎, full colour): the track new notes go into. Click a chip to write into that track; it's shown automatically.
- **Shown** (filled, dimmer): its notes are drawn in its colour, so you see how the parts fit.
- **Hidden** (dashed outline): not drawn.
- Each chip has an eye button to show or hide it. **All** and **None** at the end show or hide every other track at once (*None* keeps the writing track).
- Muted tracks (sidebar M) show a struck-through name; solo isn't involved — the chips change what you see, never what you hear.
- Which tracks are shown is remembered per level in the browser (not in the project file), so opening a level shows what you last looked at. New levels and new tracks start shown, as Ghost notes did.

### Notes of other tracks
- Drawn at about half strength in their own colour with a thin outline, under the writing track's notes, so overlaps stay readable.
- They can't be clicked: clicks, drags, box select and Del only ever touch the writing track, so nothing on another track changes by accident. To edit another track, click its chip. (Clicking another track's note to switch to it was built, then removed at the user's request, 2026-11-12.)

### Drum strip
- A thin strip pinned above the grid (it scrolls sideways with it): one row per drum track, a tick per hit, stronger for louder hits. It follows Bars and Zoom and shows the playhead.
- A **Drums** chip shows or hides it. Clicking the strip opens the Beat grid on that drum track.
- Read-only: drums are still edited in the Beat grid.

### What stays
Piano keys down the left, Snap, Length, Velocity, Key, Scale, Bars, Zoom, Loop generator, Progression, Insert loop, Clear notes (writing track only), Transpose, Quantize, Quantize recording, the Themes bar, the library bar, and the on-screen / computer / MIDI keyboard (they play and record into the writing track). The sidebar's track list is unchanged: selecting a track there still makes it the writing track.

### Moves (must-keep)
- *Track* menu → the chips (click = write into it).
- *Ghost notes* → the eye buttons with All / None.

### Claude tools
No changes: tools name the track they write to. `get_pattern` is unchanged.

### Not in this step
Editing drums inside the roll, and the stacked-lanes overview (options C and B in the step 5 sketch).

## Step 6 design: instruments, tracks, curves, events

The user's words (2026-11-15): author individual instruments with their own settings in the Library; combine instruments into a track and save tracks in the Library; adjust a track with curves (volume and more) over its length; assign tracks to game events. Their answers: a *track* is **a piece of music** (several instruments playing together); library instruments **replace the Game Style's roles**; curves shape **volume, pan / reverb / delay, filter, and pitch / speed**; curves go on **the whole track and on each instrument in it**.

### Words (app and docs)
| Today | Becomes |
|---|---|
| Instrument role (Game Style) | **Instrument** (Library) |
| Segment / sting (pattern, library item) | **Track**: a *loop track* or a *sting track* (Unity's manifest keeps `segments` / `stings`) |
| A level's track (sidebar lane: role + sound + mix) | An **instrument in the track** (a *part*); the sidebar lists the open track's instruments |
| Track mixer settings per level | The instrument's mix, set in the track (with curves), plus the level's overall mix |

### Today
Roles (Drums, Bass, Keys, Pad, Lead) live in the Game Style: each is a sound. A level has *tracks* (lanes): each plays a role, can customize its sound for the level, and has the level's mix (volume, pan, drive, tone, reverb, delay) and intensity layer. Library segments and stings store their notes per role. Game events point at a level's segment or sting.

### 6a. Instruments in the Library
✅ Done 2026-11-15. Library → Instruments (`UI.instrumentsHTML` / `instrumentsClick`); default mix on each instrument (`role.mix`, `defaultInstMix`, migrated from the first track that plays it; new tracks start with it); Duplicate; Delete disabled while used (tooltip says where); Game Style keeps a pointer; wording: *From the library*, *Back to the library version*, *Make this the library version*. Data and tool names still say `role` (`manage_role` gains duplicate and mix); they change with 6b. A copy remembers its original (`role.from`; older copies are linked by name, "Drums 2" → "Drums"): adding a track for it copies the beats/notes and layer of a track playing the original in that level, in every pattern (`copyPartsFromOriginal`; the copied parts count as edits, so the library keeps them). Asked by the user 2026-11-15.

- The Library gets an **Instruments** section (above Tracks and Melodies). Each instrument: name, colour, kind (synth or drums), all of its sound settings (preset, oscillators, envelope, filter, vibrato, level; or kit, pads, tuning, samples), and its **default mix** (volume, pan, drive, tone, reverb, delay). + Instrument (synth preset or drum kit), Duplicate, Rename, Delete (blocked while a track uses it, with where).
- Any number of instruments; two can share a preset with different settings ("Lead — soft", "Lead — bright").
- The Game Style's *Instrument roles* list moves here (must-keep: list, select to edit, rename, sound, usage, remove, + Role). The sound panel at the bottom edits the selected instrument.
- **A level can still customize an instrument** (decision 2): *Customize for this level* / *Back to the library version*, as now.
- Migration: each role becomes an instrument with the same id, so nothing else changes in 6a. A role's mix defaults come from the tracks that play it.

### 6b. Tracks own their instruments
✅ Done 2026-11-15, as in the build notes below. Checked: every demo track and layer renders the same as before (within the drums' random noise, ≤1.6%); live play, Simulate with transitions and a sting over the music, Unity renders, undo/redo, placing a track into a level without one of its instruments, linked mix edits both ways, and Claude's `add_track` / `set_track` / `remove_track` / `get_score`. New segments get every instrument of the level (with their usual mix). Tool names still say track/role; MCP needs a restart for the new `pattern` arguments.

- A track (loop or sting) lists **its instruments** (parts): each part is an instrument plus its notes or beat, and its mix (volume, pan, drive, tone, reverb, delay, mute, solo). The same instrument can appear twice (e.g. two Lead parts).
- The sidebar's *Tracks* section becomes **Instruments in this track**: select, colour, name, M, S, remove; **+ Instrument** picks one from the Library (or makes a new one). The layered roll's chips are the same list.
- **Save to the Library**: tracks already live in the Library (step 2). A track's instruments and mix now travel with it, so placing it in another level brings its sound with it. *Make a version for this level* still splits one off.
- A level no longer has its own lane list: its instruments are whatever its tracks use. The level keeps: key, scale, BPM, swing, the map, intensity layers, its overall mix, and per-instrument customizations.
- **Intensity layers**: each part in a track picks its layer (default: the layer that instrument used in this level before), shown on the part in the sidebar and in Mixer & FX.
- **Mixer & FX** shows the open track's parts (strips as now) and the level's master; *Customize* / *Back to the game style* stay for the master.
- Migration: each level track becomes a part in every track of that level that has notes for it, with that level track's mix and layer. Library items get their parts' instruments and mix. Old projects open unchanged in sound.

**6b build notes (data model, 2026-11-15).**
- A level keeps a list of *lanes* (`score.tracks`: instrument, name, colour, the level's sound customization, part key). Lanes are the level's instruments; nothing in the UI lists them directly any more.
- Each track (level pattern) lists its **parts**: `p.parts = [{ t: laneId, vol, pan, drive, tone, rev, dly, layer, mute, solo }]`, in order. Notes and beats stay in `p.notes[laneId]` / `p.drums[laneId]`, so editors, themes and the library's key shifting are unchanged. Lanes keep no mix of their own.
- The library item stores, per part key: the notes or beats, plus `mix` (with the layer by *name*); `item.order` keeps the order. Mix edits in a linked track write back and reach every level that links it ("the track's sound travels with it"). Placing a track in a level that lacks one of its instruments adds a lane for it (part key → instrument).
- Audio: the engine keeps one channel per lane; the **playing track's parts** set each channel's mix and layer (switched at the exact time a new track starts, in live play and in offline renders). A sting played *over the music* uses the loop's channel settings for instruments both share. Unity stems: each segment renders with its own parts' layers and mutes.
- Migration: a lane becomes a part of every track where it has notes (a track with no notes at all gets every lane), with that lane's mix and layer. Linked copies whose mixes disagree become own versions (so nothing changes in sound), and the app says how many.
- Lanes that no track uses and that have no level sound customization are removed.
- Claude tools keep their names for now (`add_track` adds an instrument to a track, `set_track` changes a part's mix in a track — the open one unless `pattern` is given, `remove_track` removes it from a track); `get_score` lists each track's parts.

### 6c. Curves (automation)
✅ Done 2026-11-15 (`js/curves.js` for the panel; `CURVE_PARAMS` / `evalCurve` in app.js; `applyCurves`, `resetAuto`, `pitchBend` in audio.js; Claude's `set_curve`). As designed, with these choices:
- Values: Volume / Reverb / Delay are % of the mix setting (100 = as mixed); Pan moves the sound on top of its mix pan; Filter is an extra low-pass (Hz); Pitch in semitones bends held notes (drums: retuned per hit); Speed is % tempo.
- Smooth = monotone cubic (never overshoots); straight per point. Curves are sampled every 16th and ramped in between (preview and offline renders alike).
- **Speed is for stings only** (not loops, as the design first allowed): a loop must stay on the level's tempo for the game's beat/bar switching, and the Unity player has no per-segment timing yet. A sting's speed changes its length, and the Unity export writes the real length. A sting *over the music* keeps the loop's clock in the preview (its rendered audio for Unity has the speed).
- A sting over the music doesn't steer the curves of instruments the loop also plays.
- The panel is folded by default; the piano roll keeps at least 120 px and the editor scrolls in very short windows.
- **Changed 2026-11-15 (user): curves apply to the instrument.** The *Whole track* target is gone; each instrument in a track has its own curves, and the panel follows the instrument selected in the sidebar. Only a sting's **Speed** still covers the whole sting (tempo can't differ per instrument). Older projects fold their whole-track curves into each instrument (Volume / Reverb / Delay multiplied, Pan added, Filter the lower cutoff), in levels and the Library alike, so nothing sounds different.
- Checked: no curves = audio unchanged from before (≤1.3%); a volume swell rises across the loop; a −5 st pitch curve lowers the pitch by the expected ratio; a 200% sting plays (and exports) in half the time; curves travel through the Library both ways; panel add / drag / straight / delete with one undo step each; live play and Simulate without errors.

- Under the Beat grid and Piano Roll, a **Curves** lane (folds away). Pick what it shapes: **Volume, Pan, Reverb, Delay, Filter**, plus **Pitch** (instrument) or **Speed** (whole track).
- **Whole track** (its own row, "Track") or **one instrument** (the selected part). A small marker on a part's chip and sidebar row shows it has curves.
- Click to add a point, drag to move, double-click to delete, right-click for *Smooth* (spline) or *Straight* between points, *Clear curve*. Points snap to the grid's Snap setting. Values show while dragging (dB, %, Hz, semitones, % speed).
- A curve runs over the track's length; a **loop track repeats its curves each time round**. A sting's curves run once.
- **Playback, audio export and Unity export all include the curves**: they are baked into the rendered stems and stings, so the Unity player needs no change.
- **Speed curves** change the track's length in time. Allowed on stings; on loop tracks, the level's change timing for that loop falls back to *end of segment* (the Unity player times beats and bars from one BPM), and the app says so.
- Claude tool: `set_curve` (track, part or whole track, parameter, points, smooth).

### 6d. Tracks on game events
✅ Done 2026-11-15 (`js/events.js`: `project.cues` game-wide with library-track targets, `score.cues` as a level's override; `playsOn` / `setStart`; Edit events… shows the scope with Customize / Back to the game style / Make this the game style; Claude's `set_cues` gains `scope` and `reset`). Choices:
- *Plays on* adds an event as the track's **start**: it replaces what the event started before (other actions such as intensity stay), and says so. It edits the game-wide setting unless this level has its own for that event.
- A level's override can be empty ("does nothing here").
- Upgrade: an event becomes game-wide only if nothing changes anywhere — the same in every level, or only starting tracks that other levels don't have. Everything else stays each level's own setting. In the demo, ClockLow / Paused / Resumed became game-wide; in DeadDerby's project (events set up only in Level 1 — Meadow), events that only start tracks no other level has (e.g. RunStarted → Action) can become game-wide; the ones that also duck or set intensity stay Level 1's own.
- Checked: exports identical before and after the upgrade; a game-wide event reaches a level once its track is placed there; Customize / revert / promote; Simulate fires game-wide events; `set_cues` both scopes and reset.

- In the track bar (above the editors): **Plays on** — the game events that start this track (a loop: *go to* it; a sting: *play* it the way its sting settings say). + Event, × to remove.
- **The game decides; a level can override** (decision 2): an event's assignment is game-wide by default (e.g. RunStarted → *Chase* in every level that has it). A level can override what an event does (Simulate › *Edit events…*, as now: "Customized for this level" / "Back to the game style").
- Game events (Game Style) and Simulate's buttons stay. The export's `cues` are written per level from the game-wide assignments plus the level's overrides, so MusicCues needs no change.
- Claude tools: `set_cues` gains a game-wide scope; `set_events` unchanged.

### Order and risk
6a is mostly a move and a rename (low risk). 6b changes the data model under every editor, the mixer, the audio engine, the Unity export and most Claude tools (the biggest step; done with a migration and a test that every demo level renders the same audio before and after). 6c adds automation to the engine and the offline renderer. 6d is mostly UI over the existing cues.

### Must-keep for step 6
- ✅ Game Style → Instrument roles (list, select to edit, rename, sound, usage, remove, + Role) → Library → Instruments (+ Instrument, Duplicate).
- ✅ Sidebar Tracks list (select, colour, name, rename, ✦ custom mark, M, S, delete, + Track with role picker) → Instruments in this track (same controls, M/S per track, ✕ removes from this track; + Instrument picks from the Library).
- ✅ Mixer & FX per-track strips (Mute, Solo, Volume, Pan, Drive, Tone, Reverb, Delay) → per-part strips in the open track; intensity layer per part.
- Instrument panel's scope bar (Customize for this level, Revert, Make this the game style) → Customize for this level / Back to the library version / Make this the library version.
- Claude tools: `manage_role`, `add_track`, `remove_track`, `set_track`, `set_sound`, `set_mix`, `set_layers` change with 6a/6b (renamed to instruments and parts; the server instructions updated with them).

## Must-keep list

Where every current control ends up. Tick each when its step ships.

### Top bar
| Now | Goes to |
|---|---|
| Project name | Top bar (game name) |
| Play / Stop / Record | Top bar |
| Mode: Pattern | Play button loops the selected segment |
| Mode: Adaptive | The map's Simulate panel |
| Mode: Song, Loop ⟲ | ✅ Export dialog → A playthrough: ▶ Play it, Loop |
| Position display | Top bar |
| BPM, Swing | Level settings (BPM per level, swing per level); defaults in Game style |
| Metronome | Top bar |
| Scope | Top bar (hidden in narrow windows, as now) |
| Claude link, Undo, Redo | Top bar |
| New, Load demo, Open, Save, Export | Top bar (New/Demo/Open may move into a menu) |

### Sidebar
| Now | Goes to |
|---|---|
| Scores list, + New, Duplicate | Levels in the tree, + New level, Duplicate level (✅ renamed Levels; tree comes in step 3) |
| Tracks list (select, colour, name, rename, ✦ custom mark, M, S, delete) | Track tabs in the segment editor |
| + Track with role picker | "+ Track" at the end of the track tabs |
| Patterns list, + New, Duplicate, Delete | Map nodes and Library (+ New pattern, Duplicate, Delete there). ✅ Step 2: Delete → Remove (from level) + Library delete; Duplicate makes a new library item; + Place from library |

### Beat grid (drums)
- Drum track, Kit, scope badge, Bars, Beat loop + Load, ×2, Clear drums
- Click on/off, Shift/right-click velocity, drag to paint, keys 1–0 play pads
- Per-pad level, tuning, decay, pan, custom samples

### Piano roll
- Piano keys down the left of the grid
- Track, Snap, Length, Velocity, Key, Scale, Bars, Ghost notes, Zoom (✅ step 5: Track → track chips; Ghost notes → each chip's eye button, All / None)
- Loop generator, Progression, Insert loop, Clear notes
- Transpose −1/+1, Quantize, Quantize recording
- Add, move, resize, right-click delete, Shift-drag box select, Del
- Themes bar → "Insert from library": pick a melody, Fit to key, Octave, Speed, Insert, Add on top, ▶ hear it, Save as melody (was Save as theme), Linked to…, Re-apply, Update from these notes

### Adaptive tab → map
- Segment buttons to start/switch → click/play on the map, Simulate panel
- Play a sting → anytime stings / Simulate
- End on ⚡ sting, Fade out → End node and its arrows; Simulate RunOver
- Intensity slider and layer meters → Simulate panel
- Change segment on (beat / bar / end of segment) → per-arrow timing, with a level default
- Pattern type (Segment / Sting) → node kind on the map and in the Library
- Enter through sting → sting on the arrow into a segment
- Intensity layers: list, rename, + Layer, remove, track → layer → level settings, and the layer label on each track tab

### Mixer & FX
- Per track: Mute, Solo, Volume, Pan, Drive, Tone, Reverb send, Delay send → level Mix view
- Master: Volume, EQ low/mid/high, Compressor, Reverb size/return, Delay time/feedback → Game style (master mix); level Mix view shows it with Customize / Back to the game style / Make this the game style

### Instrument panel (bottom)
- Preset, Osc 1/2, Osc 2 pitch, Detune, Osc mix, Octave, ADSR, Cutoff, Resonance, Filter env, Filter decay, Vibrato rate/depth, Level → sound panel beside the editor
- Drum kit picker → sound panel
- Scope bar: Customize for this level, Revert, Make this the game style → sound panel

### On-screen keyboard
- Keys, octave ◀ ▶, target label, MIDI status, computer-keyboard playing → stays at the bottom

### Game Style tab → Game style page
- Instrument roles: list, select to edit, rename, sound, usage, remove, + Role (✅ step 6a: → Library → Instruments)
- ✅ Themes → Library (melodies), with play, rename, usage, delete; Game Style keeps a pointer to them
- Flavors: list, rename, summary, Apply to this level, delete, Save this level's flavor
- Defaults for new levels: Key, Scale, BPM
- Master mix (moved here from the Mixer)

### Export dialog
- Unity package: this level / all levels, loudness, sample rate, bit depth, save into a folder
- WAV 16/24/32, MP3 + bitrate, Stems, MIDI, Project file
- What to export: ✅ whole song → A playthrough (order editor in the dialog); selected pattern × repeats; sample rate; reverb tail

### Claude (MCP tools)
- Every tool keeps working through each step; names and arguments change only alongside the data model, and the server's instructions are updated with them.

## Open questions

1. ~~What does a WAV/MP3 export render without Arrange?~~ Done in step 1: the Arrange order editor moved into the Export dialog as *A playthrough*. Later, maybe: default it to the map's main path once the map exists.
2. **Where does the level Mix view live in layout B?** Recommendation: a "Mix" toggle next to the segment editor that swaps the editor area for the mixer strips.
3. **Library edits from inside a level.** Editing a linked segment from a level's map changes it everywhere. Recommendation: say so in the editor ("Editing the library version: also in Ice Caverns"), with "Make a version for this level" right there.
