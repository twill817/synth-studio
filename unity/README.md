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
    void OnSecretFound()   => music.PlaySting("Alert");
    void OnLevelEnd()      => music.Stop(2f);
}
```

- Segment and sting names are the pattern names from Synth Studio.
- `music.SetDucked(true, 0.3f)` turns the music down (pause menu, slow motion, dialogue) and `SetDucked(false)` back up; it keeps playing in time, and fades use real time so they work while the game is paused.

### No-code cues: MusicCues

Add **Music Cues** next to the player and fill its table in the Inspector — each row is a cue name and what the music does:

| Name | Action | Target / Value |
|---|---|---|
| RunStarted | Go To Segment | Explore |
| EnemySpotted | Go To Segment | Action (plays its entry sting first) |
| ClockLow | Set Intensity | 1 |
| Paused / Resumed | Duck 0.3 / Unduck | |
| RunOver | Play Sting | Finish |

Fire a cue from code — `cues.Trigger("RunStarted")` — or with no code from any UnityEvent (buttons, triggers, timelines): pick **MusicCues → Trigger** and type the name. The game decides *when*; the table decides *what the music does*, so it can be re-tuned without code. Typos are flagged in the Console (cue targets are checked against the manifest).
- If a segment has an entry sting, `GoToSegment` plays it first, then the segment.
- `intensity` and `volume` are also on the component, so you can test in Play mode from the Inspector.
- Everything is scheduled on the audio clock, so changes stay on the beat regardless of frame rate.
