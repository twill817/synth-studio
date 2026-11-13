# Synth Studio MCP server

Lets Claude (Claude Code or Claude Desktop) work in your open Synth Studio page: read the project now, and — as more tools are added — compose, restructure, keep levels consistent and export to Unity. Every change appears in the app and can be undone there.

## How it fits together

```
Claude Code / Claude Desktop ──(MCP, stdio)──► mcp/server.js ──(local link, 127.0.0.1:47615)──► Synth Studio page
```

- The server runs on your computer while a Claude app is open. If both Claude apps run it, the first hosts the link and the second relays through it; if the first closes, the second takes over.
- The server also serves Synth Studio itself at **http://127.0.0.1:47615/**. Open that address to work with Claude: it connects automatically, and browsers allow it without asking.
- The public site (`https://twill817.github.io/synth-studio/`) can connect too with **Connect Claude**, but browsers may block a website from reaching your computer or ask permission first.
- Projects saved in the browser are kept per address — use **Save** and **Open** to move work between the public site and the local one.
- Only the real Synth Studio pages may connect: `https://twill817.github.io` or a copy on `localhost`/`127.0.0.1`.

## Setup (once)

1. Install Node.js 18 or newer (nodejs.org).
2. Install the server's packages:
   ```
   cd "D:\Custom Tools\Synth\mcp"
   npm install
   ```
3. Tell Claude about it:
   - **Claude Code** (works in every folder, including your Unity project):
     ```
     claude mcp add --scope user synth-studio -- node "D:\Custom Tools\Synth\mcp\server.js"
     ```
   - **Claude Desktop:** Settings → Developer → Edit Config, and add inside `"mcpServers"`:
     ```json
     "synth-studio": { "command": "node", "args": ["D:\\Custom Tools\\Synth\\mcp\\server.js"] }
     ```
     then restart Claude Desktop.
4. With a Claude app open, go to **http://127.0.0.1:47615/** in Chrome or Edge. The top bar shows **● Claude connected**.

## Tools so far

| Tool | What it does |
|---|---|
| `status` | Is a Synth Studio page connected, and which game/score is open |
| `get_project` | Game style (roles, mix), themes, flavors, every score's segments/stings/layers |
| `get_score` | One level in detail: tracks, layers, patterns, links to themes, export playthrough |
| `get_pattern` | A pattern's notes (`1.1.1 A4 1/4 v100`) and drum lines (`X...x...|…`) |
| **Composing** | |
| `write_notes` | Melody / bass / chords in readable notation (`1.1.1 [A3 C4 E4] 1/2 v90`, dotted `1/4.`, triplet `1/8t`) |
| `write_drums` | Drum lines (`X...x...`) and/or a preset beat |
| `generate_part` | Chords, bass, arps or a riff that follow the key and a progression |
| `transform_notes` | Transpose, octave, quantize, velocity |
| `insert_theme` / `save_theme` / `reapply_theme` | Use the game's themes (library melodies) in any level (fitted to its key), save new ones, refresh every linked use |
| `set_events` | The game's event list (names as the game fires them) |
| `set_cues` | What an event does in a level (go to, sting, intensity, duck, end, fade…) |
| `set_sting` | How a sting plays when fired: instead / over the music / then go to / end; when it starts |
| `place_pattern` | Reuse a library segment or sting in a level, linked (moved into the level's key) |
| `library_item` | Rename / duplicate / delete a library item; split a level's pattern into its own version, or relink it |
| **Structure** | |
| `create_score` / `set_score` | New level (from the style, or a copy) / key, tempo, swing, when segment changes land |
| `add_pattern` / `set_pattern` / `delete_pattern` | New segments and stings (each becomes a library item), length, entry stings; delete removes from the level only |
| `set_arrangement` | Export playthrough (pattern order for plain audio/MIDI export) |
| `set_layers` | Intensity layers and which tracks are on each |
| `add_track` / `set_track` / `remove_track` | Tracks, mixer settings, mute/solo, layer |
| **Sound & consistency** | |
| `set_sound` | Change a sound for one level (`scope: level`) or the whole game (`scope: game_style` — reports every score it reaches) |
| `sound_scope` | Customize / revert / promote a track's sound |
| `manage_role` | Add, rename, remove (unused) game-style roles |
| `set_mix` | A level's own mix, or the shared game mix (reports which levels it reaches) |
| `flavor` | Apply or save a level flavor |
| **Production** | |
| `check_consistency` | Drift and mistakes across the game, by severity, each with a fix: off-style keys/tempos, empty segments, silent or empty layers, muted tracks, out-of-scale notes, unused roles/themes, themes missing from levels, theme uses that drifted |
| `analyze` | Loudness (LUFS) and peaks per segment and sting; quiet/loud contrast per level; clipping |
| `export_unity` | Render and write straight into a Unity project's `Assets`. Reuses the existing export folder and player script, keeps `.meta` files (scene references survive), removes files for deleted segments. `dry_run` previews every change; the project path is remembered |

### Workflow prompts

Ready-made recipes for whole jobs — in Claude Code type `/mcp__synth-studio__…`, in Claude Desktop use the **+** (attach) menu:

| Prompt | What Claude does |
|---|---|
| `compose_segment` (moment, score, bars) | Writes a new adaptive segment for a game moment in the soundtrack's style: drums, shared progression, a game theme, every layer contributing, an entry sting if it's a sudden change; checks consistency; tells you how to listen |
| `ship_to_unity` (scope, unity_project) | Follows the Unity project's rules → consistency check → loudness analysis → export preview → **your OK** → export → reads the Unity console |
| `wire_music_in_unity` (scene, unity_project) | Plans the Unity side — a Music object with AdaptiveMusicPlayer + MusicCues, a cue table mapping the game's events to music, the smallest listener script — and only after **your OK** builds and Play-tests it (with the Unity MCP) |

The full chain uses this server **and** the Unity MCP (`mcp-for-unity`, installed in the Unity project and registered in your Claude app).

Every editing call is **one Undo step** in the app and **all-or-nothing**: if anything in a request is invalid, nothing changes. The app opens what was edited so you can see and hear it.

## Testing

Tests run on their own port (47699) so they never touch a real Claude session. Start a test, then open **http://127.0.0.1:47699/**:

- `npm test` — two server copies (like both Claude apps), every read tool through both.
- `node test-edit.js` — builds a whole new level with the editing tools, checks refused requests change nothing.
- `node test-production.js <scratch folder>` — consistency check, analysis, and exports into a throwaway Unity-like folder (with its own settings file, so the real remembered project is never touched).
