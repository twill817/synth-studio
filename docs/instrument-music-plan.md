# Instruments own their music

Agreed 2026-11-16. A library instrument (role) owns its notes or beats and its curves. A segment or
sting only lists which instruments play in it (by id), each with its own mix (volume, pan, layer, mute,
solo…). Nothing is copied between segments: editing Bass's notes anywhere changes them everywhere Bass
plays. A different bass line is a different instrument ("Duplicate" in the Library, or the sidebar).

## Model

```
role.music = { bars, key, notes: [{s,l,p,v}], theme? }    synth: pitches written in `key`
           | { bars, drums: { voiceId: steps[] } }         drums: bars×16 steps per voice
role.curves, role.curveBars                                its curves, repeating every curveBars bars
pattern.parts = [{ t: laneId, vol, pan, drive, tone, rev, dly, layer, mute, solo }]
pattern.curves                                             a sting's Speed only
track (lane) = one per instrument per level: { id, name, role, type, color, sound }
library segment/sting = { id, name, kind, bars, order: [roleId], mix: { roleId: mix }, curves? }
```

- An instrument plays from the start of the track: it repeats when the track is longer, and is cut when
  the track is shorter. Its length is its own (bars), set by a "Part length" control.
- In a level whose key differs from `music.key`, pitched notes move by whole semitones (the short way),
  like linked library segments did. Drums don't move. The editors show and edit in the level's key.
- A segment can't play the same instrument twice; duplicate the instrument instead.
- New segments start with no instruments.

## Steps

1. **Model + helpers** (app.js): `musicOf`, `playNotes`, `drumAt`/`setDrumAt`, `keyShift`; parts no
   longer hold curves; `copyPartsFromOriginal` goes.
2. **Migration** (version 3): every (instrument, distinct notes/beats/curves) found in level segments and
   old library items becomes an instrument. The first keeps the instrument; others become duplicates
   named "Bass (Action)". Silent parts are dropped (no sound change). Linked library items convert too.
3. **Library** (library.js): items list instruments + mix only; linking/own versions keep working.
4. **Playback + export** (audio.js, export.js).
5. **Editors**: Beat grid, Piano Roll (repeats shown, all live), recording, MIDI import, Double, bar
   length, Part length control, Curves panel (edits the instrument's curves), themes.
6. **Claude tools** (bridge*.js, mcp/server.js) and tips.
7. **Test** in the browser: migration of the demo, editing in one segment shows in another, keys, export.
