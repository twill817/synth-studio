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
| `get_score` | One level in detail: tracks, layers, patterns, links to themes, arrangement |
| `get_pattern` | A pattern's notes (`1.1.1 A4 1/4 v100`) and drum lines (`X...x...|…`) |

## Testing

With Synth Studio open and **Connect Claude** on: `npm test` (starts two copies of the server, like both Claude apps, and calls every tool through both).
