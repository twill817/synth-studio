/* End-to-end test of the editing tools: builds a third level ("Swamp") the way Claude would,
   checks errors change nothing, and checks consistency reports. Run with Synth Studio open
   at http://127.0.0.1:47699/ on the demo project:  node test-edit.js */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// Tests use their own port so they never touch a real Claude session (open http://127.0.0.1:47699/ to test).
const TEST_PORT = process.env.TEST_PORT || '47699';
const c = new Client({ name: 'test-edit', version: '1.0.0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, 'server.js')], stderr: 'inherit', env: { ...process.env, SYNTH_STUDIO_PORT: TEST_PORT } }));

let failures = 0;
const raw = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  return { error: !!r.isError, text: r.content[0].text };
};
const ok = async (name, args = {}) => {
  const r = await raw(name, args);
  if (r.error) { failures++; console.log(`✗ ${name}: ${r.text}`); return null; }
  let v = r.text; try { v = JSON.parse(r.text); } catch {}
  console.log(`✓ ${name}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return v;
};
const bad = async (name, args, expect) => {
  const r = await raw(name, args);
  if (!r.error || (expect && !r.text.includes(expect))) { failures++; console.log(`✗ ${name} should have failed (${expect}): ${r.text}`); }
  else console.log(`✓ ${name} refused as expected: ${r.text.slice(0, 140)}`);
};

process.stdout.write('waiting for Synth Studio');
for (let i = 0; i < 60; i++) {
  const s = JSON.parse((await raw('status')).text);
  if (s.appConnected) break;
  process.stdout.write('.'); await new Promise((r) => setTimeout(r, 1000));
}
console.log();

const S = 'Swamp';
await ok('create_score', { name: 'Level 3 — Swamp', key: 'E', scale: 'dorian', bpm: 90 });
await ok('set_pattern', { score: S, pattern: 'Main', name: 'Explore' });
await ok('add_pattern', { score: S, name: 'Chase', bars: 2, kind: 'segment' });
await ok('add_pattern', { score: S, name: 'Spotted', bars: 1, kind: 'sting' });
await ok('write_drums', { score: S, pattern: 'Chase', preset: 'Trap' });
await ok('write_drums', { score: S, pattern: 'Explore', drums: { Kick: 'X.......X.......', 'Closed Hat': 'x.x.x.x.x.x.x.x.', rim: '....o.......o...' } });
await ok('generate_part', { score: S, pattern: 'Chase', track: 'Bass', generator: 'Bass: syncopated', progression: 'Prog 1–6–3–7' });
await ok('generate_part', { score: S, pattern: 'Chase', track: 'Pad', generator: 'chords (block)', progression: 'prog 1-6-3-7'.replace(/-/g, '–') });
await ok('insert_theme', { score: S, pattern: 'Explore', track: 'Lead', theme: 'Main Theme', speed: 2 });
await ok('write_notes', { score: S, pattern: 'Spotted', track: 'Keys', notes: '1.1.1 [E4 G4 B4] 1/2 v110\n1.3.1 E5 1/4.\n1.4.3 D5 1/8t' });
await ok('set_pattern', { score: S, pattern: 'Chase', entry_sting: 'Spotted' });
await ok('set_layers', { score: S, layers: ['Base', 'Rhythm', 'Intensity'], assign: { Drums: 'Rhythm', Bass: 'Rhythm', Lead: 'Intensity' } });
await ok('set_sound', { score: S, scope: 'level', track: 'Keys', preset: 'Bell' });
await ok('set_sound', { score: S, scope: 'game_style', role: 'Pad', params: { cutoff: 1100, attack: 0.9 } });
await ok('set_mix', { score: S, scope: 'level', values: { reverb_size: 3.5, eq_high: -3, delay_time: '1/4' } });
await ok('flavor', { score: S, action: 'save', name: 'Swamp' });
await ok('transform_notes', { score: S, pattern: 'Chase', track: 'Bass', transpose: 2, quantize: '1/16' });
await ok('set_track', { score: S, track: 'Lead', settings: { reverb: 0.4, pan: -0.2 } });
await ok('set_arrangement', { score: S, patterns: ['Explore', 'Chase', 'Explore'] });
await ok('add_track', { score: S, role: 'Lead', name: 'Counter', layer: 'Intensity' });
await ok('write_notes', { score: S, pattern: 'Chase', track: 'Counter', notes: '1.1.1 B4 1/8, 1.1.3 D5 1/8, 1.2.1 E5 1/4, 2.1.1 G5 1 bar' });
await ok('set_score', { score: S, swing: 12, change_segment_on: 'beat' });
await ok('reapply_theme', { theme: 'Main Theme' });
await ok('manage_role', { action: 'add', preset: 'Strings', name: 'Strings' });
await ok('manage_role', { action: 'remove', role: 'Strings' });

console.log('\n— errors must change nothing —');
const before = (await raw('get_score', { score: S })).text;
await bad('write_notes', { score: S, pattern: 'Chase', track: 'Lead', notes: '1.1.1 A4 1/4\n9.9.9 H2 1/4' }, 'Nothing was changed');
await bad('set_pattern', { score: S, pattern: 'Explore', entry_sting: 'Chase' }, 'not a sting');
await bad('write_drums', { score: S, pattern: 'Chase', drums: { Cowbell: 'X..y' } }, 'X (accent)');
await bad('set_sound', { score: S, scope: 'level', track: 'Keys', params: { warble: 3 } }, 'Unknown sound setting');
await bad('manage_role', { action: 'remove', role: 'Bass' }, 'used by');
await bad('write_notes', { score: S, pattern: 'Chase', track: 'Drums', notes: '1.1.1 A4 1/4' }, 'drum track');
const after = (await raw('get_score', { score: S })).text;
if (before !== after) { failures++; console.log('✗ a failed call changed the score'); } else console.log('✓ score unchanged after all refused calls');

console.log('\n— result —');
const sc = JSON.parse((await raw('get_score', { score: S })).text);
console.log(JSON.stringify({ key: sc.key, bpm: sc.bpm, mix: sc.mix, layers: sc.intensityLayers, patterns: sc.patterns.map((p) => `${p.name}:${p.type}${p.entrySting ? '←' + p.entrySting : ''}`), playthrough: sc.playthrough }, null, 1));
const sp = JSON.parse((await raw('get_pattern', { score: S, pattern: 'Spotted', track: 'Keys' })).text);
console.log('Spotted/Keys:', sp.tracks[0].notes.join(' · '));
const proj = JSON.parse((await raw('get_project')).text);
console.log('flavors:', proj.flavors.map((f) => f.name).join(', '), '| roles:', proj.gameStyle.roles.map((r) => r.name).join(', '));

await c.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL OK');
process.exit(failures ? 1 : 0);
