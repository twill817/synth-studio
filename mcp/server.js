#!/usr/bin/env node
/* Synth Studio MCP server.
 *
 * Claude (Claude Code or Claude Desktop) talks to this process over stdio (standard MCP).
 * This process hosts a small local link (WebSocket on 127.0.0.1) that an open Synth Studio
 * page connects to when "Connect Claude" is switched on. Every tool call is forwarded to that
 * page, which makes the change in the app you can see — with normal Undo.
 *
 * If two copies run at once (Claude Code and Claude Desktop), the first hosts the link and the
 * second relays its calls through the first. If the first goes away, the second takes over.
 *
 * Nothing here writes to stdout except the MCP protocol itself; logs go to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Synth Studio app files (the repo root, one level up). The server also serves them at
// http://127.0.0.1:PORT/ — page and link on the same local address, so browsers never block the link.
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_URL = `http://127.0.0.1:${Number(process.env.SYNTH_STUDIO_PORT || 47615)}/`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.cs': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveApp(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(APP_ROOT, '.' + rel);
  const inside = file.startsWith(APP_ROOT + path.sep);
  const hidden = path.relative(APP_ROOT, file).split(path.sep).some((p) => p.startsWith('.') || p === 'node_modules');
  if (req.method !== 'GET' || !inside || hidden || !MIME[path.extname(file)] || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const PORT = Number(process.env.SYNTH_STUDIO_PORT || 47615);
const APP_URL = 'https://twill817.github.io/synth-studio/';
// Only the real Synth Studio pages may connect as "the app": the published site or a local copy.
const ALLOWED_ORIGINS = [/^https:\/\/twill817\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const log = (...a) => console.error('[synth-studio-mcp]', ...a);

/* ---------------------------------------------------------------- the local link */
class Link {
  constructor() {
    this.mode = 'starting';     // 'primary' (hosts the link) | 'relay' (forwards to the primary)
    this.page = null;           // the connected Synth Studio page (primary only)
    this.pageInfo = null;
    this.upstream = null;       // relay → primary socket
    this.pending = new Map();
    this.seq = 0;
  }

  async start() {
    try { await this.host(); this.mode = 'primary'; log(`hosting the app link on 127.0.0.1:${PORT}`); }
    catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      await this.relay();
      this.mode = 'relay';
      log('another Synth Studio MCP server hosts the app link; relaying through it');
    }
  }

  host() {
    return new Promise((resolve, reject) => {
      const web = http.createServer(serveApp);
      const wss = new WebSocketServer({
        server: web,
        maxPayload: 1024 * 1024 * 1024, // Unity exports carry whole WAV files
        // Browsers always send an Origin; local tools (a relaying server) send none.
        verifyClient: ({ origin }) => !origin || ALLOWED_ORIGINS.some((r) => r.test(origin)),
      });
      // The WebSocket layer re-emits the HTTP server's errors (e.g. "port in use"); handle both,
      // or Node treats it as an unhandled error and the process exits instead of relaying.
      let settled = false;
      const onStartError = (e) => { if (!settled) { settled = true; wss.close(); reject(e); } };
      web.once('error', onStartError);
      wss.on('error', (e) => (settled ? log('link error', e.message) : onStartError(e)));
      web.listen(PORT, '127.0.0.1', () => {
        settled = true;
        web.on('error', (e) => log('link error', e.message));
        resolve();
      });
      wss.on('connection', (ws, req) => this.accept(ws, req));
    });
  }

  accept(ws, req) {
    const fromBrowser = !!req.headers.origin;
    let role = null;
    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf); } catch { return; }
      if (!role) {
        if (fromBrowser && msg.type === 'hello' && msg.app === 'SynthStudio') {
          role = 'page';
          if (this.page && this.page !== ws) this.page.close(4000, 'Another Synth Studio tab connected to Claude');
          this.page = ws;
          this.pageInfo = { ...msg, origin: req.headers.origin, connectedAt: new Date().toISOString() };
          log('Synth Studio connected:', msg.url);
        } else if (!fromBrowser && msg.type === 'hello' && msg.role === 'relay') {
          role = 'relay';
        } else ws.close(4001, 'Unexpected client');
        return;
      }
      if (role === 'page') {
        if (msg.type === 'info') { this.pageInfo = { ...this.pageInfo, ...msg }; return; }
        const done = msg.id && this.pending.get(msg.id);
        if (done) { this.pending.delete(msg.id); done(msg); }
      } else if (role === 'relay' && msg.id) {
        this.call(msg.method, msg.params).then(
          (result) => ws.send(JSON.stringify({ id: msg.id, result })),
          (err) => ws.send(JSON.stringify({ id: msg.id, error: err.message })));
      }
    });
    ws.on('close', () => {
      if (this.page === ws) { this.page = null; log('Synth Studio disconnected'); }
    });
  }

  relay() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { maxPayload: 1024 * 1024 * 1024 });
      ws.once('open', () => { ws.send(JSON.stringify({ type: 'hello', role: 'relay' })); this.upstream = ws; resolve(); });
      ws.once('error', reject);
      ws.on('message', (buf) => {
        let msg; try { msg = JSON.parse(buf); } catch { return; }
        const done = msg.id && this.pending.get(msg.id);
        if (done) { this.pending.delete(msg.id); done(msg); }
      });
      ws.on('close', () => {
        this.upstream = null;
        // The hosting server went away (its Claude app closed): take over hosting.
        setTimeout(() => this.start().catch((e) => log('could not restart link', e.message)), 500 + Math.random() * 500);
      });
    });
  }

  status() {
    return {
      appAddress: LOCAL_URL,
      linkHostedHere: this.mode === 'primary',
      appConnected: !!this.page,
      page: this.pageInfo && this.page ? { url: this.pageInfo.url, build: this.pageInfo.build, game: this.pageInfo.game, score: this.pageInfo.score } : null,
    };
  }

  /* Send a command to the app (directly, or through the hosting server) and wait for its answer. */
  call(method, params = {}, timeoutMs = 30000) {
    if (method === '__status' && this.mode === 'primary') return Promise.resolve(this.status());
    const target = this.mode === 'relay' ? this.upstream : this.page;
    if (!target || target.readyState !== WebSocket.OPEN) {
      if (method === '__status') return Promise.resolve({ ...this.status(), appConnected: false });
      return Promise.reject(new Error(NOT_CONNECTED));
    }
    const id = `${process.pid}-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Synth Studio didn't answer “${method}” within ${timeoutMs / 1000}s.`)); }, timeoutMs);
      this.pending.set(id, (msg) => { clearTimeout(timer); msg.error ? reject(new Error(msg.error)) : resolve(msg.result); });
      target.send(JSON.stringify({ id, method, params }));
    });
  }
}

const NOT_CONNECTED =
  `Synth Studio isn't connected. Ask the user to open ${LOCAL_URL} in Chrome or Edge (this server hosts the app there) ` +
  `and click “Connect Claude” in the top bar so it shows “● Claude connected”. ` +
  `(The public site ${APP_URL} can also connect, but some browsers block or ask permission for a website to reach this computer.) ` +
  `Projects saved in the browser are kept per address — to move work between the two, use Save and Open.`;

/* ---------------------------------------------------------------- MCP tools */
const link = new Link();
const server = new McpServer(
  { name: 'synth-studio', version: '0.1.0' },
  { instructions:
      'Synth Studio is a browser music workstation for making a game\'s adaptive soundtrack (Unity game "DeadDerby"). ' +
      'A project is the whole game: a Game Style (instrument roles, flavors, master mix) and a Library (every segment, sting and melody/theme), shared by scores (one per level). ' +
      'Each score has tracks (each plays a role, optionally customized for that level), patterns placed from the library (segments that loop, or one-shot stings), ' +
      'and intensity layers. Placed patterns are linked: editing one changes it in every level that links it (tools report where); ' +
      'use library_item own_version for a level-only change, and place_pattern to reuse a pattern in another level instead of rewriting it. Positions use bar.beat.sixteenth (1-based); durations like 1/4, 1/8, 3/16, 1 bar. ' +
      'Start with get_project to see what exists. Every edit is one Undo step in the app, all-or-nothing, and the app opens what changed. ' +
      'Keep the game consistent: give a level its own colour with scope "level" (custom sounds, level mix, flavors); change the game style only for ' +
      'game-wide decisions, and read the impact the tool reports. Reuse themes across levels (insert_theme) and keep a shared progression within a pattern. ' +
      'Claude cannot hear the audio: describe what you did musically and ask the user to listen.' },
);

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: err.message || String(err) }] });
const forward = (method) => async (params) => { try { return text(await link.call(method, params)); } catch (e) { return fail(e); } };

const scoreRef = z.string().optional().describe('Score (level) name, or its number starting at 1. Omit for the score open in the app.');

server.registerTool('status', {
  title: 'Connection status',
  description: 'Is a Synth Studio page connected? Shows which page, game and score. Call this first if other tools say the app is not connected.',
  inputSchema: {},
}, async () => {
  try {
    const s = await link.call('__status');
    if (!s.appConnected) return text({ ...s, howToConnect: NOT_CONNECTED });
    return text(s);
  } catch (e) { return fail(e); }
});

server.registerTool('get_project', {
  title: 'Describe the game project',
  description: 'Overview of the whole game: Game Style (key, scale, tempo, instrument roles and where they are used, master mix), themes, flavors, and every score with its segments, stings and layers.',
  inputSchema: {},
}, forward('getProject'));

server.registerTool('get_score', {
  title: 'Describe a score',
  description: 'One score (level) in detail: key, tempo, tracks (role, sound, custom-for-this-level, layer), intensity layers, patterns (segment or sting, bars, entry sting, which tracks have notes, linked themes), playthrough (pattern order for plain audio export) and transition rule.',
  inputSchema: { score: scoreRef },
}, forward('getScore'));

server.registerTool('get_pattern', {
  title: 'Read a pattern\'s notes',
  description: 'The notes and drum hits in one pattern, in readable form. Notes: "bar.beat.16th NOTE duration vVELOCITY" (e.g. "1.1.1 A4 1/4 v100"). Drums: one line per drum with X (accent), x (hit), o (ghost), . (rest), bars separated by |.',
  inputSchema: {
    score: scoreRef,
    pattern: z.string().describe('Pattern name (e.g. "Action") or its letter (A, B, …).'),
    track: z.string().optional().describe('Only this track (name). Omit for all tracks.'),
  },
}, forward('getPattern'));

/* ---------------------------------------------------------------- editing tools (step 2)
   Each call is one Undo step in the app, all-or-nothing, and the app opens what was changed.
   Tool arguments are snake_case; the page's commands use camelCase (top-level keys only —
   settings/params/drum names inside stay as given). */
const camel = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));
const forwardEdit = (method) => async (params) => { try { return text(await link.call(method, camel(params))); } catch (e) { return fail(e); } };
const patternRef = z.string().describe('Pattern name (e.g. "Action") or letter (A, B, …).');
const trackRef = z.string().describe('Track name in that score (e.g. "Lead", "Bass", "Drums").');
const NOTATION = 'One note per line: "bar.beat.16th NOTE duration vVELOCITY", e.g. "1.1.1 A4 1/4 v100". ' +
  'Chords: "1.1.1 [A3 C4 E4] 1/2 v90". Positions are 1-based (bar.beat.sixteenth; 2.3.1 = bar 2, beat 3). ' +
  'Durations: 1/16, 1/8, 1/4, 1/2, 3/16, 1 bar, 2 bars; add "." to dot (1/4.) or "t" for a triplet (1/8t). Velocity 1–127, default 100.';
const edit = (name, title, description, inputSchema, method) =>
  server.registerTool(name, { title, description, inputSchema, annotations: { readOnlyHint: false } }, forwardEdit(method));

// ----- composing
edit('write_notes', 'Write notes', `Write a melody, bassline or chords into one instrument track of a pattern. ${NOTATION} Notes past the pattern's length are left out. mode "replace" (default) replaces that track's notes in the pattern (and unlinks any theme); "add" layers on top.`,
  { score: scoreRef, pattern: patternRef, track: trackRef, notes: z.string().describe('Notes, one per line, in the notation above.'), mode: z.enum(['replace', 'add']).optional() }, 'writeNotes');

edit('write_drums', 'Write drums', 'Write drum lines for a pattern. Each line uses X (accent), x (hit), o (ghost), . (rest), one character per 16th; "|" between bars is optional; a 1-bar line repeats to fill longer patterns. Drums: Kick, Snare, Clap, Closed Hat, Open Hat, Low Tom, High Tom, Rimshot, Cowbell, Crash. Or start from a preset beat (Four on the Floor, Boom Bap, Trap, Rock, Breakbeat, Reggaeton, Bossa Nova, House Shuffle, Funk, Half-Time, Clear) and then override lines. mode "replace" (default) clears drums not given; "merge" keeps them.',
  { score: scoreRef, pattern: patternRef, track: z.string().optional().describe('Drum track name; omit for the score\'s drum track.'),
    drums: z.record(z.string(), z.string()).optional().describe('e.g. {"Kick": "X...x...X...x...", "Snare": "....X.......X..."}'),
    preset: z.string().optional(), mode: z.enum(['replace', 'merge']).optional() }, 'writeDrums');

edit('generate_part', 'Generate a part', 'Fill a track with a generated part that follows the score\'s key and a chord progression. Generators: Chords (block), Chords (7ths), Chords (stabs), Bass: roots, Bass: eighths, Bass: octave bounce, Bass: syncopated, Arp: up, Arp: up-down, Arp: broken, Melody: random riff. Progressions (scale degrees): Prog 1–5–6–4, Prog 1–6–3–7, Prog 6–4–1–5, Prog 1–4–5–4, Prog 2–5–1–1, Prog 1–7–6–7. Use the same progression across tracks of a pattern so they fit together.',
  { score: scoreRef, pattern: patternRef, track: trackRef, generator: z.string(), progression: z.string().optional() }, 'generatePart');

edit('transform_notes', 'Transform notes', 'Change a track\'s notes in a pattern: transpose (semitones), octave shift, quantize to a grid (e.g. "1/16"), and/or scale velocity (e.g. 0.8 softer, 1.2 harder).',
  { score: scoreRef, pattern: patternRef, track: trackRef, transpose: z.number().int().optional(), octave: z.number().int().optional(), quantize: z.string().optional(), velocity: z.number().positive().optional() }, 'transformNotes');

edit('insert_theme', 'Insert a theme', 'Put one of the game\'s themes into a track. fit (default true) moves it into the score\'s key and scale by scale degree, keeping its shape. speed: 2 = half speed (calmer), 0.5 = double speed; octave −2…2. Short themes repeat to fill the pattern. With mode "replace" the notes stay linked to the theme so reapply_theme can refresh them. Using themes across levels is the main way to keep the soundtrack recognisably one game.',
  { score: scoreRef, pattern: patternRef, track: trackRef, theme: z.string(), fit: z.boolean().optional(), octave: z.number().int().optional(), speed: z.number().optional(), mode: z.enum(['replace', 'add']).optional() }, 'insertTheme');

edit('save_theme', 'Save as theme', 'Save a track\'s notes in a pattern as a new game theme (stored in the score\'s key), linking that track to it.',
  { score: scoreRef, pattern: patternRef, track: trackRef, name: z.string() }, 'saveTheme');

edit('reapply_theme', 'Re-apply a theme everywhere', 'After a theme changed, rewrite every linked use of it (in all scores, or one) from its current version, each with its own key fit, speed and octave. Keeps all levels consistent.',
  { theme: z.string(), score: z.string().optional().describe('Only this score; omit for every score.') }, 'reapplyTheme');

// ----- structure
edit('create_score', 'Create a score', 'Add a new score (level or cue). By default it gets one track per game-style role, one 2-bar pattern "Main", and the style\'s default key/scale/tempo; or copy_from an existing score. Optionally set key ("D", "F#", "Bb"), scale (major, minor, dorian, mixolydian, harmminor, pentmaj, pentmin, blues, chromatic), bpm, and a flavor to apply.',
  { name: z.string(), copy_from: z.string().optional(), key: z.string().optional(), scale: z.string().optional(), bpm: z.number().optional(), flavor: z.string().optional() }, 'createScore');

edit('set_score', 'Change score settings', 'Rename a score or change its key, scale, tempo, swing (0–75) or when adaptive segment changes happen (beat, bar, end). transpose_notes moves existing instrument notes with a key change (the shorter way). Reports drift from the game style.',
  { score: scoreRef, name: z.string().optional(), key: z.string().optional(), scale: z.string().optional(), bpm: z.number().optional(), swing: z.number().optional(),
    change_segment_on: z.enum(['beat', 'bar', 'end']).optional(), transpose_notes: z.boolean().optional() }, 'setScore');

edit('add_pattern', 'Add a pattern', 'Add a pattern to a score: kind "segment" (loops while the game is in a state — explore, combat, boss) or "sting" (one-shot, e.g. an alert). bars: 1, 2, 4 or 8. copy_from duplicates an existing pattern\'s notes.',
  { score: scoreRef, name: z.string(), bars: z.number().int().optional(), kind: z.enum(['segment', 'sting']).optional(), copy_from: z.string().optional() }, 'addPattern');

edit('set_pattern', 'Change a pattern', 'Rename a pattern, change its length (1/2/4/8 bars) or kind (segment/sting), or set the sting the game plays when switching into this segment (entry_sting; "" removes it).',
  { score: scoreRef, pattern: patternRef, name: z.string().optional(), bars: z.number().int().optional(), kind: z.enum(['segment', 'sting']).optional(), entry_sting: z.string().optional() }, 'setPattern');

edit('delete_pattern', 'Delete a pattern', 'Delete a pattern (and its blocks in the export playthrough).', { score: scoreRef, pattern: patternRef }, 'deletePattern');

edit('set_events', 'Set the game’s events', 'The game-wide list of events the game fires (MusicCues.Trigger names, e.g. RunStarted), spelled exactly as the game’s code does. add: names or {name, note}; remove: names; rename: {old: new}; notes: {name: note}. What each event does is set per level with set_cues.',
  { add: z.array(z.union([z.string(), z.object({ name: z.string(), note: z.string().optional() })])).optional(), remove: z.array(z.string()).optional(), rename: z.record(z.string(), z.string()).optional(), notes: z.record(z.string(), z.string()).optional() }, 'setEvents');

edit('set_cues', 'Set what an event does in a level', 'Replace what the music does in one level when the game fires an event, as a list of actions (in order): goto (segment), play (start at a segment right away), sting (play a sting the way it is set to play), intensity (value 0–1), duck (value 0–1: how loud while turned down), unduck, end (end on a sting), fade (value: seconds). Empty list = the event does nothing here. Exported to Unity’s MusicCues; its Inspector table only overrides.',
  { score: scoreRef, event: z.string(), actions: z.array(z.object({ do: z.enum(['goto', 'play', 'sting', 'intensity', 'duck', 'unduck', 'end', 'fade']), target: z.string().optional(), value: z.number().optional() })) }, 'setCues');

edit('set_sting', 'Set how a sting plays', 'How a sting plays in a level when an event (PlaySting) fires it: play = instead (default: the segment restarts after it) | over (the loop keeps going, turned down to duck 0–1) | goto (then segment `then`) | end (end the music). at = "now" | "beat" | "bar" | "" (the level’s rule). A sting used as a segment’s entry sting still leads into that segment.',
  { score: scoreRef, sting: z.string(), play: z.enum(['instead', 'over', 'goto', 'end']).optional(), then: z.string().optional(), at: z.string().optional(), duck: z.number().optional() }, 'setSting');

edit('place_pattern', 'Place a library pattern in a level', 'Put a segment or sting from the game library into a level, linked: editing it in any level changes it everywhere it is linked. Pitched parts shift to the level’s key; drums don’t. Each track plays the part for its instrument role. Optional name (the level’s name for it, also its Unity cue name) and entry_sting.',
  { score: scoreRef, item: z.string(), name: z.string().optional(), entry_sting: z.string().optional() }, 'placePattern');

edit('library_item', 'Manage a library item', 'rename / duplicate / delete a library item (give item; deleting keeps each level’s notes as its own version). For one level’s pattern (give score and pattern): own_version splits it off so edits stay in that level; relink drops the level’s version and uses the library’s again.',
  { action: z.enum(['rename', 'duplicate', 'delete', 'own_version', 'relink']), item: z.string().optional(), score: scoreRef, pattern: z.string().optional(), name: z.string().optional() }, 'libraryItem');

edit('set_arrangement', 'Set the export playthrough', 'Set a level\'s playthrough: a fixed pattern order used only for plain audio/MIDI export (Export › A playthrough), e.g. for a trailer or soundtrack file. The game itself never plays it — in-game music is segments, stings and intensity. Give a list of pattern names.',
  { score: scoreRef, patterns: z.array(z.string()).min(1) }, 'setArrangement');

edit('set_layers', 'Set intensity layers', 'Define a score\'s intensity layers, bottom (always on) to top (fades in last), and/or assign tracks to layers. Each layer becomes its own stem in Unity; the game raises intensity to fade upper layers in. Typical: Base (harmony) → Rhythm (drums, bass) → Intensity (lead, extra percussion).',
  { score: scoreRef, layers: z.array(z.string()).optional().describe('Layer names, bottom to top. Existing layers are kept by name; tracks in removed layers move to the base.'),
    assign: z.record(z.string(), z.string()).optional().describe('{"Track name": "Layer name"}') }, 'setLayers');

edit('add_track', 'Add a track', 'Add a track that plays one of the game style\'s roles (see get_project), optionally on a given layer.',
  { score: scoreRef, role: z.string(), name: z.string().optional(), layer: z.string().optional() }, 'addTrack');

edit('set_track', 'Change a track', 'Rename, mute/solo, move to a layer, or change mixer settings: volume (0–1.2), pan (−1…1), drive (0–1), tone (low-pass Hz, 200–20000), reverb (send 0–1), delay (send 0–1).',
  { score: scoreRef, track: trackRef, name: z.string().optional(), mute: z.boolean().optional(), solo: z.boolean().optional(), layer: z.string().optional(),
    settings: z.record(z.string(), z.number()).optional() }, 'setTrack');

edit('remove_track', 'Remove a track', 'Remove a track and its notes from a score.', { score: scoreRef, track: trackRef }, 'removeTrack');

// ----- sound, game style, flavors
edit('set_sound', 'Change a sound', 'Change an instrument or drum sound. scope "level" changes it for one track in this score only (its flavor — the default way to give a level its own colour); scope "game_style" changes the role for every score that shares it (use for game-wide decisions; the result lists exactly what it reaches). Give a preset (Piano, Electric Piano, Organ, Synth Bass, Sub Bass, Warm Pad, Strings, Square Lead, Pluck, Bell, Synth Brass), a kit for drums (Classic Analog, Punchy Electro, Deep Boom, Lo-Fi Dusty, Room Kit), and/or params: wave1/wave2 (sine, triangle, sawtooth, square), osc2_pitch (−24…24 st), detune (0–50 cents), osc_mix (0–1), octave (−2…2), attack/decay/release (s), sustain (0–1), cutoff (40–18000 Hz), resonance (0–20), filter_env (0–6 oct), filter_decay (s), vibrato_rate (Hz), vibrato_depth (cents), level (0–1.6).',
  { score: scoreRef, scope: z.enum(['level', 'game_style']), track: z.string().optional(), role: z.string().optional().describe('For game_style: role name (or give a track that plays it).'),
    preset: z.string().optional(), kit: z.string().optional(), params: z.record(z.string(), z.union([z.number(), z.string()])).optional() }, 'setSound');

edit('sound_scope', 'Level sound vs game style', 'For one track: "customize" gives it its own copy of its role\'s sound in this score; "revert" returns it to the game style; "promote" makes its custom sound the game style for that role (reaches every score sharing it — result lists them).',
  { score: scoreRef, track: trackRef, action: z.enum(['customize', 'revert', 'promote']) }, 'soundScope');

edit('manage_role', 'Manage game-style roles', 'Add a role to the game style (preset name, or "drum"), rename one, or remove one that no score uses.',
  { action: z.enum(['add', 'rename', 'remove']), role: z.string().optional(), name: z.string().optional(), preset: z.string().optional() }, 'manageRole');

edit('set_mix', 'Change the master mix', 'Change the master mix: scope "level" gives this score its own mix (e.g. a cave with a bigger reverb); scope "game_style" changes the shared mix for every score without its own. values: volume, eq_low/eq_mid/eq_high (dB ±12), compressor (threshold dB, −40…0), reverb_size (s, 0.3–6), reverb_return (0–1.5), delay_time (1/16, 1/8, 1/8 dotted, 1/4, 1/4 dotted, 1/2), delay_feedback (0–0.9). Or action "revert" (back to the style mix) / "promote" (make this level\'s mix the style).',
  { score: scoreRef, scope: z.enum(['level', 'game_style']).optional(), values: z.record(z.string(), z.union([z.number(), z.string()])).optional(), action: z.enum(['revert', 'promote']).optional() }, 'setMix');

edit('flavor', 'Apply or save a flavor', 'A flavor is a reusable set of level customizations (custom sounds + mix). "apply" makes the score use that flavor (other tracks return to the game style); "save" stores the score\'s current customizations as a named flavor.',
  { score: scoreRef, action: z.enum(['apply', 'save']), flavor: z.string().optional(), name: z.string().optional() }, 'flavor');

/* ---------------------------------------------------------------- production tools (step 3) */
// Remembers the last Unity project exported to (kept next to this file, not committed).
// Tests point SYNTH_STUDIO_CONFIG elsewhere so they never change the real setting.
const CONFIG_FILE = process.env.SYNTH_STUDIO_CONFIG || path.join(path.dirname(fileURLToPath(import.meta.url)), '.local-config.json');
const loadConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } };
const saveConfig = (c) => { try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); } catch (e) { log('could not save config', e.message); } };
function findUnder(dir, test, depth = 0, out = []) {
  if (depth > 10) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (test(e)) out.push(p);
    if (e.isDirectory() && !e.name.startsWith('.')) findUnder(p, test, depth + 1, out);
  }
  return out;
}

/* Render in the app, then write into <Unity project>/Assets. Reuses an existing export folder and an
   existing AdaptiveMusicPlayer.cs (a second copy would stop Unity compiling). Overwrites in place so
   Unity's .meta files — and the references in scenes — survive. Removes WAVs/manifests a score no
   longer has (with their .meta). dry_run reports all of that without writing. */
async function exportUnity(p) {
  const proj = p.unity_project || loadConfig().unityProject;
  if (!proj) throw new Error('Which Unity project? Give unity_project: the folder that contains Assets and ProjectSettings. It\'s remembered for next time.');
  const projAbs = path.resolve(proj), assets = path.join(projAbs, 'Assets');
  if (!fs.existsSync(assets) || !fs.existsSync(path.join(projAbs, 'ProjectSettings'))) throw new Error(`“${projAbs}” doesn't look like a Unity project (it needs Assets and ProjectSettings folders).`);

  const res = await link.call('renderUnity', {
    scope: p.scope || 'score', score: p.score,
    targetLufs: p.loudness_lufs === undefined ? -16 : p.loudness_lufs, sampleRate: p.sample_rate || 48000, bits: p.bits || 16,
  }, 600000);

  const existingRoot = findUnder(assets, (e) => e.isDirectory() && e.name === res.root)[0];
  const destRoot = p.folder ? path.resolve(assets, p.folder, res.root)
    : existingRoot || path.join(assets, ...(fs.existsSync(path.join(assets, '_Project')) ? ['_Project', 'Audio', 'Music'] : ['Music']), res.root);
  if (!destRoot.startsWith(assets + path.sep)) throw new Error('folder must be inside the Unity project\'s Assets.');
  const scripts = findUnder(assets, (e) => e.isFile() && e.name === 'AdaptiveMusicPlayer.cs');
  // A C# script must exist once in a Unity project: update an existing copy wherever it is;
  // otherwise put new scripts next to the existing player script, or in the export folder.
  const scriptHome = scripts.length ? path.dirname(scripts[0]) : destRoot;
  const scriptDest = (name) => findUnder(assets, (e) => e.isFile() && e.name === name)[0] || path.join(scriptHome, name);

  const added = [], updated = [], removed = [], writes = [];
  let unchanged = 0;
  for (const f of res.files) {
    const rel = f.path.split('/').slice(1);
    const dest = rel.length === 1 && rel[0].endsWith('.cs') ? scriptDest(rel[0]) : path.join(destRoot, ...rel);
    const data = Buffer.from(f.data, 'base64');
    if (fs.existsSync(dest)) {
      if (fs.readFileSync(dest).equals(data)) { unchanged++; continue; }
      updated.push(dest);
    } else added.push(dest);
    writes.push([dest, data]);
  }
  for (const sc of res.scores) {
    const dir = path.join(destRoot, sc.folder);
    if (!fs.existsSync(dir)) continue;
    const keep = new Set(res.files.filter((f) => f.path.split('/')[1] === sc.folder).map((f) => f.path.split('/').slice(2).join('/')));
    for (const name of fs.readdirSync(dir)) if ((name.endsWith('.wav') || name === 'manifest.json') && !keep.has(name)) removed.push(path.join(dir, name));
  }

  const rel = (x) => path.relative(projAbs, x).split(path.sep).join('/');
  const summary = {
    unityProject: projAbs,
    folder: rel(destRoot),
    scores: res.scores.map((s) => ({ score: s.score, segments: s.segments, stings: s.stings, loudness: s.loudness })),
    added: added.map(rel), updated: updated.map(rel), unchangedFiles: unchanged, removed: removed.map(rel),
    scripts: res.hasScript
      ? ['AdaptiveMusicPlayer.cs', 'MusicCues.cs'].map((n) => {
          const all = findUnder(assets, (e) => e.isFile() && e.name === n);
          return rel(scriptDest(n)) + (all.length > 1 ? ` — WARNING: ${all.length} copies (${all.map(rel).join(', ')}); Unity needs exactly one` : '');
        })
      : 'not included (the app was opened as a file)',
  };
  saveConfig({ ...loadConfig(), unityProject: projAbs }); // a confirmed Unity project: remember it (preview or not)
  if (p.dry_run) return { preview: true, nothingWritten: true, ...summary };

  for (const [dest, data] of writes) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, data); }
  for (const x of removed) { fs.rmSync(x, { force: true }); fs.rmSync(x + '.meta', { force: true }); }
  return { ...summary, next: 'Switch to Unity: it reimports the changes. Updated files keep their .meta, so scene references stay connected, and the player refreshes its Clips list from the manifest\'s folder by itself.' };
}

server.registerTool('check_consistency', {
  title: 'Check the game for drift and mistakes',
  description: 'Reviews the whole game (or one score) and lists issues by severity — problem (breaks the export or the game), check (probably unintended), note (worth knowing) — each with where it is and how to fix it. Covers: levels far from the style\'s key/tempo, empty segments, layers with no tracks or silent in a segment, muted tracks (left out of exports), notes outside the level\'s scale, unused roles/themes, themes missing from some levels, linked theme uses that drifted from the theme, stings nothing leads into, and each level\'s flavor. Run it after a batch of changes and before exporting.',
  inputSchema: { score: z.string().optional().describe('Only this score; omit for the whole game.') },
  annotations: { readOnlyHint: true },
}, forward('checkConsistency'));

server.registerTool('analyze', {
  title: 'Analyze loudness and peaks',
  description: 'Renders each segment (all layers on) and sting and reports loudness (LUFS) and peak level, before export normalization: the loudest segment per level, the quiet/loud contrast within a level, clipping, and how levels compare. Takes a few seconds per level.',
  inputSchema: { score: z.string().optional().describe('Only this score; omit for every level.') },
  annotations: { readOnlyHint: true },
}, async (params) => { try { return text(await link.call('analyze', camel(params), 300000)); } catch (e) { return fail(e); } });

server.registerTool('export_unity', {
  title: 'Export to the Unity project',
  description: 'Renders the adaptive music (one seamless-loop stem per segment × layer, stings, manifest.json, AdaptiveMusicPlayer.cs) and writes it straight into a Unity project\'s Assets — updating an existing export folder and player script in place (keeping .meta files so scene references survive), and removing files for segments that no longer exist. Use dry_run first to show the user exactly what would be added, updated and removed. This writes into another project: follow that project\'s own rules (for example, get the user\'s OK before writing).',
  inputSchema: {
    scope: z.enum(['score', 'all']).optional().describe('One score (default) or every score in the game.'),
    score: z.string().optional().describe('For scope "score": which one (default: the open score).'),
    unity_project: z.string().optional().describe('Unity project folder (contains Assets and ProjectSettings). Remembered after the first export.'),
    folder: z.string().optional().describe('Folder inside Assets for the export (default: reuse the existing export folder; otherwise _Project/Audio/Music or Music).'),
    loudness_lufs: z.number().nullable().optional().describe('Loudness target for each level\'s loudest segment (default −16; null = don\'t match).'),
    sample_rate: z.number().optional(), bits: z.number().optional(),
    dry_run: z.boolean().optional().describe('Report what would change without writing anything.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: true },
}, async (params) => { try { return text(await exportUnity(params)); } catch (e) { return fail(e); } });

/* ---------------------------------------------------------------- workflow prompts (step 4)
   Ready-made recipes for whole jobs. Claude Code shows them as /mcp__synth-studio__<name>;
   Claude Desktop lists them in the attach (+) menu. */
const prompt = (name, title, description, argsSchema, build) =>
  server.registerPrompt(name, { title, description, argsSchema }, (args) => ({ messages: [{ role: 'user', content: { type: 'text', text: build(args) } }] }));
const PROJECT_RULES = 'Before touching a Unity project, read its CLAUDE.md (and any contributor rules it points to) and follow them — ' +
  'e.g. tell the user the plan and get their OK first, remind them to commit, and use the branch/worktree setup it asks for. Never change a game\'s ' +
  'existing interfaces or events without the user\'s OK; only listen to them.';

prompt('compose_segment', 'Compose a segment for a game moment',
  'Write a new adaptive segment (with layers and, if useful, an entry sting) for a moment in the game, in the style of the rest of the soundtrack.',
  { score: z.string().optional().describe('Which level (default: the open one)'), moment: z.string().describe('The game moment, e.g. "boss fight", "chase", "calm exploration"'), bars: z.string().optional().describe('1, 2, 4 or 8 (default 4)') },
  ({ score, moment, bars }) => `Compose a new segment in Synth Studio for this game moment: “${moment}”${score ? ` in the score “${score}”` : ' in the open score'}.

1. get_project and get_score to learn the game style (roles, themes, flavors), this level's key/tempo/layers and its existing segments. Read one or two existing patterns (get_pattern) so the new one fits.
2. add_pattern (kind segment, ${bars || 4} bars) named after the moment.
3. Write it: drums (write_drums), bass and harmony (generate_part with ONE progression shared by every part, or write_notes), and a lead. Prefer insert_theme with a game theme (half speed for calm moments, normal or double for intense ones) so the level stays recognisably part of the game. Match the moment's energy with tempo-appropriate rhythm, register and velocity.
4. Make sure every intensity layer has something to add in this segment (set_layers if needed), so SetIntensity works here too.
5. If the moment is a sudden change (danger, discovery), add a 1-bar sting (add_pattern kind sting) and set it as the entry_sting.
6. check_consistency for this score and fix any problems or checks you caused.
7. Tell the user, in plain words, what you wrote (instruments, theme use, layers, sting) and ask them to listen: on the level map, ▶ the segment (or Simulate › Start), and try the intensity slider. Remind them every step can be undone in the app.`);

prompt('ship_to_unity', 'Check, export and ship to Unity',
  'Get the soundtrack ready and write it into the Unity project: consistency check, loudness analysis, a previewed export, then the export itself — following the Unity project\'s own rules.',
  { scope: z.string().optional().describe('"score" (the open one) or "all" (default all)'), unity_project: z.string().optional().describe('Unity project folder (remembered after the first export)') },
  ({ scope, unity_project }) => `Ship the Synth Studio soundtrack to Unity${unity_project ? ` (project: ${unity_project})` : ''}.

1. ${PROJECT_RULES}
2. check_consistency (whole game). Fix every "problem" (ask the user about anything musical). List the "checks" and ask which to fix; notes are just for information.
3. analyze. Report each level's loudest segment, the quiet/loud contrast, and any clipping, in plain words.
4. export_unity with dry_run: true and scope "${scope || 'all'}"${unity_project ? ` and unity_project "${unity_project}"` : ''}. Show the user exactly which files would be added, updated and removed, and where. Point out removals.
5. Only after the user says OK: export_unity again without dry_run.
6. Tell them what to do next: switch to Unity (it reimports; scene references survive; the player's Clips refresh themselves). If a Unity MCP is connected, read the Unity console for errors after the import and report them.`);

prompt('wire_music_in_unity', 'Put the music in a Unity scene and wire it to gameplay',
  'Plan (and, with the user\'s OK, do) the Unity side: a music object with AdaptiveMusicPlayer and MusicCues in a scene, cues fired from the game\'s existing events, then a Play-mode test.',
  { scene: z.string().optional().describe('Scene to add the music to'), unity_project: z.string().optional() },
  ({ scene, unity_project }) => `Plan how to put the exported Synth Studio music into the Unity game${unity_project ? ` at ${unity_project}` : ''}${scene ? `, in the scene ${scene}` : ''}, and wire it to gameplay.

1. ${PROJECT_RULES}
2. Find the export (manifest.json files, AdaptiveMusicPlayer.cs, MusicCues.cs) and the game's events (its interfaces/events docs and code). Use get_project to list each level's segments and stings.
3. Propose, in plain words, a cue table: which game event fires which cue, and what each cue does (Go To Segment / Play Sting / Set Intensity / Duck / Unduck / Stop / End With Sting). Typical: start screen → calm segment; run/level start → main segment; danger or low time → higher intensity or an intense segment; pause → Duck 0.3, resume → Unduck; run over → End With Sting (the loop stops, the sting rings out; Play Sting would resume the loop after it). Continuous values (danger, speed, time left) can drive SetIntensity every frame.
4. Propose the smallest code change: one small listener script that subscribes to the existing events and calls MusicCues.Trigger(...) / SetIntensity — no changes to the game's interfaces. Say which files you'd create and where they go per the project's folder rules, and how it would be tested (the project's test conventions; keep any mapping rules pure and testable).
5. Wait for the user's OK. Then, following the project's rules: add a "Music" GameObject with AdaptiveMusicPlayer (assign the level's manifest.json — Clips fill themselves) and MusicCues with the agreed cues; add the listener; save the scene.
6. Test in Play mode (with a Unity MCP: enter Play mode, fire cues / simulate the events, read the console). Report what played and any warnings, and tell the user exactly how to try it themselves.`);

/* ---------------------------------------------------------------- start */
await link.start();
await server.connect(new StdioServerTransport());
log('ready');
