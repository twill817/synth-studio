# Using Synth Studio music in Unity

## 1. Export

In Synth Studio: **Export → Unity adaptive package**. Choose this score or all scores, a loudness target, and either download a `.zip` or (Chrome/Edge) save straight into a folder such as your Unity project's `Assets/Music`.

You get:

```
<Game>_Music/
  AdaptiveMusicPlayer.cs
  <Score>/
    manifest.json
    <Segment>_<Layer>.wav    one stem per intensity layer, seamless loop
    <Sting>.wav              one-shot stings
```

## 2. Import

1. Put the folder anywhere under `Assets/` (keep `AdaptiveMusicPlayer.cs` once; it serves every score).
2. Select the WAVs and set, in the Inspector:
   - **Load Type:** *Decompress On Load* for short loops, *Compressed In Memory* for long ones
   - **Compression Format:** *Vorbis* (or *PCM*) — **not MP3**, which adds gaps at loop points
   - **Preload Audio Data:** on
3. Add **Adaptive Music Player** to a GameObject in the level and drag the score's `manifest.json` into **Manifest**. **Clips** fills itself with the WAVs in that folder (and keeps up when a re-export adds or removes segments). To force it: the component's ⋮ menu → *Refresh Clips from manifest folder*.

> With the Synth Studio MCP server, Claude can export straight into the project (`export_unity`) — no zip or dragging; re-exports update files in place so scene references stay connected.

## 3. Drive it from gameplay

```csharp
using SynthStudio;

public class LevelMusic : MonoBehaviour
{
    public AdaptiveMusicPlayer music;

    void OnEnemySpotted()  => music.GoToSegment("Action");  // lands on the next bar (or beat / segment end)
    void OnAllClear()      => music.GoToSegment("Explore");
    void OnHealthChanged(float danger) => music.SetIntensity(danger); // 0..1, layers fade in
    void OnSecretFound()   => music.PlaySting("Alert");      // plays the way Synth Studio sets the sting
    void OnLevelEnd()      => music.EndWithSting("Finish"); // loop stops on the next bar, the sting rings out
    void OnQuit()          => music.Stop(2f);
}
```

- Segment and sting names are the pattern names from Synth Studio.
- `PlaySting` follows the sting's *When fired* setting in Synth Studio: **instead** (the loop stops at the next change point, the sting plays, the segment restarts — the default), **over the music** (the loop keeps going, turned down while the sting plays), **then go to** a segment, or **end the music** (like `EndWithSting`). Its *Starts* setting (right away / next beat / next bar) overrides the level's timing.
- `music.SetDucked(true, 0.3f)` turns the music down (pause menu, slow motion, dialogue) and `SetDucked(false)` back up; it keeps playing in time, and fades use real time so they work while the game is paused.

### Game events: MusicCues

Add **Music Cues** next to the player and fire the game's events by name: `cues.Trigger("RunStarted")`, or with no code from any UnityEvent (buttons, triggers, timelines): pick **MusicCues → Trigger** and type the name. The game decides *when*; what the music does is set in Synth Studio (Game Style → Game events, then Simulate › *Edit events…* per level) and comes with the export (`cues` in manifest.json). The test panel in Play mode lists the events as buttons.

**Overrides.** Rows in the MusicCues table replace the export for that event name, e.g. to tune one level without re-exporting. Leave the table empty to use Synth Studio's events. Each row is a cue name and what the music does:

| Name | Action | Target / Value |
|---|---|---|
| RunStarted | Go To Segment | Explore |
| EnemySpotted | Go To Segment | Action (plays its entry sting first) |
| ClockLow | Set Intensity | 1 |
| Paused / Resumed | Duck 0.3 / Unduck | |
| RunOver | End With Sting | Finish (the loop stops; nothing starts after) |

Typos in table rows are flagged in the Console (cue targets are checked against the manifest). An event that neither the table nor the export knows logs a warning when it fires.
- If a segment has an entry sting, `GoToSegment` plays it first, then the segment.
- `intensity` and `volume` are also on the component, so you can test in Play mode from the Inspector.
- Everything is scheduled on the audio clock, so changes stay on the beat regardless of frame rate.
