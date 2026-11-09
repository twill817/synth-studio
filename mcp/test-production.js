/* End-to-end test of check_consistency, analyze and export_unity. Exports into a throwaway Unity-like
   folder (never a real project) that mimics an earlier manual import: an existing My_Game_Music folder
   with an older player script, a stale WAV, and .meta files. Run with Synth Studio open at
   http://127.0.0.1:47699/ on the demo project:  node test-production.js <scratch-folder> */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = process.env.TEST_PORT || '47699';
const scratch = path.resolve(process.argv[2] || path.join(here, '.test-unity'));
const proj = path.join(scratch, 'FakeUnityProject');
fs.rmSync(proj, { recursive: true, force: true });
fs.rmSync(path.join(scratch, 'test-config.json'), { force: true });
const music = path.join(proj, 'Assets', 'My_Game_Music');
fs.mkdirSync(path.join(proj, 'ProjectSettings'), { recursive: true });
fs.mkdirSync(path.join(music, 'Level_1_Meadow'), { recursive: true });
fs.writeFileSync(path.join(music, 'AdaptiveMusicPlayer.cs'), '// older version\n');
fs.writeFileSync(path.join(music, 'AdaptiveMusicPlayer.cs.meta'), 'guid: aaaa\n');
fs.writeFileSync(path.join(music, 'Level_1_Meadow', 'Explore_Base.wav'), 'old');
fs.writeFileSync(path.join(music, 'Level_1_Meadow', 'Explore_Base.wav.meta'), 'guid: keep-me\n');
fs.writeFileSync(path.join(music, 'Level_1_Meadow', 'Verse_Base.wav'), 'stale');
fs.writeFileSync(path.join(music, 'Level_1_Meadow', 'Verse_Base.wav.meta'), 'guid: stale\n');

const c = new Client({ name: 'test-production', version: '1.0.0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, 'server.js')], stderr: 'inherit', env: { ...process.env, SYNTH_STUDIO_PORT: TEST_PORT, SYNTH_STUDIO_CONFIG: path.join(scratch, 'test-config.json') } }));
let failures = 0;
const call = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  if (r.isError) { failures++; console.log(`✗ ${name}: ${r.content[0].text}`); return null; }
  try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; }
};
const check = (cond, msg) => { if (!cond) failures++; console.log(`${cond ? '✓' : '✗'} ${msg}`); };

process.stdout.write('waiting for Synth Studio');
for (let i = 0; i < 60; i++) { const s = await call('status'); if (s && s.appConnected) break; process.stdout.write('.'); await new Promise((r) => setTimeout(r, 1000)); }
console.log();

const cc = await call('check_consistency');
console.log(`consistency: ${cc.problems} problem(s), ${cc.checks} check(s), ${cc.notes} note(s)`);
cc.issues.slice(0, 8).forEach((i) => console.log(`   [${i.severity}] ${i.where}: ${i.message}${i.fix ? ' → ' + i.fix : ''}`));

const t0 = Date.now();
const an = await call('analyze');
console.log(`analyze (${((Date.now() - t0) / 1000).toFixed(1)}s):`);
an.scores.forEach((s) => console.log(`   ${s.score}: ${s.patterns.map((p) => `${p.pattern} ${p.lufs} LUFS / ${p.peakDbfs} dBFS`).join(' · ')} | ${s.dynamicRange || ''}`));
console.log('  ', an.acrossLevels);

const dry = await call('export_unity', { scope: 'all', unity_project: proj, dry_run: true });
check(dry && dry.preview && !fs.readFileSync(path.join(music, 'AdaptiveMusicPlayer.cs'), 'utf8').includes('namespace SynthStudio'), 'dry run wrote nothing');
check(dry.folder === 'Assets/My_Game_Music', `reuses the existing export folder (${dry.folder})`);
check(dry.removed.includes('Assets/My_Game_Music/Level_1_Meadow/Verse_Base.wav'), 'dry run lists the stale WAV for removal');
console.log(`   would add ${dry.added.length}, update ${dry.updated.length}, remove ${dry.removed.length}; scripts: ${dry.scripts}`);

const ex = await call('export_unity', { scope: 'all', dry_run: false }); // project path remembered from the first call
check(!!ex && !ex.preview, 'export ran (project path remembered)');
const script = fs.readFileSync(path.join(music, 'AdaptiveMusicPlayer.cs'), 'utf8');
check(script.includes('namespace SynthStudio') && script.includes('RefreshClipsFromManifestFolder'), 'player script updated in place');
const copies = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'AdaptiveMusicPlayer.cs') copies.push(p); } })(path.join(proj, 'Assets'));
check(copies.length === 1, `exactly one player script in the project (${copies.length})`);
check(fs.existsSync(path.join(music, 'MusicCues.cs')), 'MusicCues.cs placed next to the existing player script');
check(fs.readFileSync(path.join(music, 'Level_1_Meadow', 'Explore_Base.wav.meta'), 'utf8') === 'guid: keep-me\n', '.meta of an updated WAV kept (scene references survive)');
check(fs.readFileSync(path.join(music, 'Level_1_Meadow', 'Explore_Base.wav')).subarray(0, 4).toString() === 'RIFF', 'WAV content replaced with real audio');
check(!fs.existsSync(path.join(music, 'Level_1_Meadow', 'Verse_Base.wav')) && !fs.existsSync(path.join(music, 'Level_1_Meadow', 'Verse_Base.wav.meta')), 'stale WAV and its .meta removed');
check(fs.existsSync(path.join(music, 'Level_2_Ice_Caves', 'manifest.json')), 'Level 2 exported too');
const m1 = JSON.parse(fs.readFileSync(path.join(music, 'Level_1_Meadow', 'manifest.json'), 'utf8'));
console.log(`   Level 1 manifest: ${m1.segments.map((s) => s.name).join(', ')} | stings ${m1.stings.map((s) => s.name).join(', ')} | gain ${m1.loudness.gainDb} dB`);
const bad = await c.callTool({ name: 'export_unity', arguments: { unity_project: scratch, dry_run: true } });
check(bad.isError && bad.content[0].text.includes("doesn't look like a Unity project"), 'refuses a folder that isn\'t a Unity project');
const esc = await c.callTool({ name: 'export_unity', arguments: { unity_project: proj, folder: '../../outside', dry_run: true } });
check(esc.isError && esc.content[0].text.includes('inside'), 'refuses to write outside Assets');

await c.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL OK');
process.exit(failures ? 1 : 0);
