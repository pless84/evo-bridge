// `node bridge/test-art-routes.js`: runs a bridge on a spare port with a fake
// Evo address and throwaway folders, and checks the /art routes and auth.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-art-'));
const PORT = 18000 + Math.floor(Math.random() * 2000);
const TOKEN = 'test-token-0123456789abcdef';
const ART = path.join(tmp, 'custom');

const bridge = spawn(process.execPath, [path.join(__dirname, 'evo-bridge.js')], {
  env: { ...process.env, EVO_PORT: String(PORT), EVO_TOKEN: TOKEN, EVO_MAC: '00:00:00:00:00:01',
    EVO_CONFIG: path.join(tmp, 'config.json'), EVO_ART_CUSTOM_DIR: ART, EVO_PYTHON: '/bin/false' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p,
      headers: { 'X-Evo-Token': TOKEN, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ code: res.statusCode, body: data }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

const frame = (color = '000000', ms = 100) => ({ pixels: Array(256).fill(color), ms });

async function main() {
  await new Promise((resolve) => bridge.stdout.on('data', (d) => String(d).includes('[http]') && resolve()));

  // auth applies to /art like everything else
  assert.strictEqual((await req('GET', '/art', undefined, { 'X-Evo-Token': 'wrong' })).code, 401);
  assert.strictEqual((await req('GET', '/art', undefined, { Origin: 'http://example.com' })).code, 403);

  const list = JSON.parse((await req('GET', '/art')).body);
  assert(list.states.every((s) => !s.custom));
  assert(!list.states.some((s) => s.state === 'clock'));

  const starter = JSON.parse((await req('GET', '/art/done')).body);
  assert.strictEqual(starter.custom, false);
  assert(starter.frames.length >= 1);

  // only known states, no traversal, right methods
  for (const p of ['/art/clock', '/art/constructor', '/art/__proto__', '/art/..%2Fx', '/art/done/x', '/art/done/try/x']) {
    assert.strictEqual((await req('GET', p)).code, 404, p);
  }
  assert.strictEqual((await req('PUT', '/art/done', { frames: [frame()] })).code, 405);
  assert.strictEqual((await req('GET', '/art/done/try')).code, 405);

  // bad bodies
  assert.strictEqual((await req('POST', '/art/done', 'not json')).code, 400);
  assert.strictEqual((await req('POST', '/art/done', { frames: [] })).code, 400);
  assert.strictEqual((await req('POST', '/art/done', { frames: [frame('FFFFFF')] })).code, 400);
  assert.strictEqual((await req('POST', '/art/done', 'x'.repeat(600 * 1024))).code, 413);
  assert(!fs.existsSync(ART), 'nothing written for bad requests');

  // try does not save
  assert.strictEqual((await req('POST', '/art/done/try', { frames: [frame('ff0000')] })).code, 200);
  assert.strictEqual(JSON.parse((await req('GET', '/status')).body).preview, 'done');
  assert(!fs.existsSync(ART));

  // save, read back, overlapping saves end with the newest, then revert
  assert.strictEqual((await req('POST', '/art/done', { frames: [frame('00ff00', 120), frame('0000ff', 30)] })).code, 200);
  assert.deepStrictEqual(fs.readdirSync(path.join(ART, 'blip')), ['done.gif']);
  const saved = JSON.parse((await req('GET', '/art/done')).body);
  assert.strictEqual(saved.custom, true);
  assert.deepStrictEqual(saved.frames.map((f) => [f.pixels[0], f.ms]), [['00ff00', 120], ['0000ff', 30]]);
  await Promise.all(['111111', '222222', '333333'].map((c) => req('POST', '/art/done', { frames: [frame(c)] })));
  assert(['111111', '222222', '333333'].includes(JSON.parse((await req('GET', '/art/done')).body).frames[0].pixels[0]));
  assert.strictEqual((await req('DELETE', '/art/done')).code, 200);
  assert.deepStrictEqual(fs.readdirSync(path.join(ART, 'blip')), []);
  assert.strictEqual(JSON.parse((await req('GET', '/art/done')).body).custom, false);

  // themes: list, per-theme art, switching
  const th = JSON.parse((await req('GET', '/themes')).body);
  assert.strictEqual(th.current, 'blip');
  assert(th.themes.length >= 7 && th.themes.every((t) => t.preview.length === 256));
  assert.strictEqual((await req('GET', '/art/done?theme=nope')).code, 404);
  const robotDone = JSON.parse((await req('GET', '/art/done?theme=robot')).body);
  assert.strictEqual(robotDone.theme, 'robot');
  assert.notDeepStrictEqual(robotDone.frames, starter.frames);
  assert.strictEqual((await req('POST', '/art/idle?theme=robot', { frames: [frame('123456')] })).code, 200);
  assert(fs.existsSync(path.join(ART, 'robot', 'idle.gif')));
  assert.strictEqual(JSON.parse((await req('GET', '/art/idle')).body).custom, false, 'blip untouched');
  assert.strictEqual((await req('POST', '/config', { theme: 'robot' })).code, 200);
  assert.strictEqual(JSON.parse((await req('GET', '/status')).body).theme, 'robot');
  assert.strictEqual(JSON.parse((await req('GET', '/art/idle')).body).custom, true, 'current theme is robot now');
  assert.strictEqual((await req('POST', '/config', { theme: 'nope' })).code, 400);
  assert.strictEqual((await req('DELETE', '/art/idle?theme=robot')).code, 200);
  assert(!fs.existsSync(path.join(ART, 'robot', 'idle.gif')));

  // a theme whose art cannot be loaded is refused and not saved
  fs.mkdirSync(path.join(ART, 'weather'), { recursive: true });
  fs.writeFileSync(path.join(ART, 'weather', 'idle.png'), 'not a png');
  const bad = await req('POST', '/config', { theme: 'weather' });
  assert.strictEqual(bad.code, 500, bad.body);
  assert.strictEqual(JSON.parse((await req('GET', '/status')).body).theme, 'robot');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8')).theme, 'robot');
  fs.rmSync(path.join(ART, 'weather'), { recursive: true });

  // unread markers: a finished session is reported as unread; the setting can be switched off
  assert.strictEqual((await req('GET', '/state/done?session_id=u1')).code, 200);
  let st = JSON.parse((await req('GET', '/status')).body);
  assert.strictEqual(st.unread_markers, true);
  assert.strictEqual(st.sessions.find((s) => s.id === 'u1').unread, 'done');
  assert.strictEqual((await req('POST', '/config', { unreadMarkers: 'yes' })).code, 400);
  assert.strictEqual((await req('POST', '/config', { unreadMarkers: false })).code, 200);
  assert.strictEqual(JSON.parse((await req('GET', '/status')).body).unread_markers, false);
  assert.strictEqual((await req('GET', '/state/thinking?session_id=u1')).code, 200);
  st = JSON.parse((await req('GET', '/status')).body);
  assert.strictEqual(st.sessions.find((s) => s.id === 'u1').unread, null);

  // still alive after all that
  assert.strictEqual((await req('GET', '/status')).code, 200);
}

main().then(() => {
  console.log('all tests passed');
}, (e) => {
  console.log(`FAIL  ${e.message}`);
  process.exitCode = 1;
}).finally(() => {
  bridge.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});
