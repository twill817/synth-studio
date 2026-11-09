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
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
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
      'A project is the whole game: a Game Style (instrument roles, themes, flavors, master mix) shared by scores (one per level). ' +
      'Each score has tracks (each plays a role, optionally customized for that level), patterns (segments that loop, or one-shot stings), ' +
      'and intensity layers. Positions use bar.beat.sixteenth (1-based); durations like 1/4, 1/8, 3/16, 1 bar. ' +
      'Start with get_project to see what exists. Changes appear live in the user\'s open app and can be undone there. ' +
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
  description: 'One score (level) in detail: key, tempo, tracks (role, sound, custom-for-this-level, layer), intensity layers, patterns (segment or sting, bars, entry sting, which tracks have notes, linked themes), song arrangement and transition rule.',
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

/* ---------------------------------------------------------------- start */
await link.start();
await server.connect(new StdioServerTransport());
log('ready');
