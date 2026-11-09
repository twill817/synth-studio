/* End-to-end check: starts two copies of the server the way Claude Code and Claude Desktop would
   (the second relays through the first), waits for a Synth Studio page to connect, then calls
   every tool through both.  Run:  npm test   (with Synth Studio open at http://127.0.0.1:47699/). */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// Tests use their own port so they never touch a real Claude session (open http://127.0.0.1:47699/ to test).
const TEST_PORT = process.env.TEST_PORT || '47699';
const open = async (name) => {
  const c = new Client({ name, version: '1.0.0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, 'server.js')], stderr: 'inherit', env: { ...process.env, SYNTH_STUDIO_PORT: TEST_PORT } }));
  return c;
};
const call = async (c, name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  const t = r.content[0].text;
  if (r.isError) throw new Error(`${name}: ${t}`);
  try { return JSON.parse(t); } catch { return t; }
};

const a = await open('test-primary');
const b = await open('test-relay');
const tools = (await a.listTools()).tools.map((t) => t.name);
console.log('tools:', tools.join(', '));

process.stdout.write('waiting for Synth Studio to connect');
let s;
for (let i = 0; i < 60; i++) {
  s = await call(a, 'status');
  if (s.appConnected) break;
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('\nstatus (primary):', JSON.stringify(s));
if (!s.appConnected) { console.log('No page connected — stopping.'); process.exit(1); }
console.log('status (relay):', JSON.stringify(await call(b, 'status')));

const proj = await call(a, 'get_project');
console.log('game:', proj.game, '| scores:', proj.scores.map((x) => x.name).join(' / '), '| roles:', proj.gameStyle.roles.map((r) => r.name).join(', '));
const score = await call(b, 'get_score', { score: '2' });
console.log('score 2 via relay:', score.name, score.key, score.bpm + ' BPM', '| patterns:', score.patterns.map((p) => `${p.letter}:${p.name}`).join(' '));
const pat = await call(a, 'get_pattern', { score: 'meadow', pattern: 'Action', track: 'Lead' });
console.log('Meadow / Action / Lead:', pat.tracks[0].notes.slice(0, 4).join(' · '));
const drums = await call(a, 'get_pattern', { score: 'meadow', pattern: 'A', track: 'drums' });
console.log('Meadow / A / Drums:', JSON.stringify(drums.tracks[0].drums));
try { await call(a, 'get_pattern', { pattern: 'Nope' }); } catch (e) { console.log('helpful error:', e.message); }

await a.close(); await b.close();
console.log('OK');
