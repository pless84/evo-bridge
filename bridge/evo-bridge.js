#!/usr/bin/env node
// Computer bridge: the same HTTP API as the ESP32 firmware, but this computer's
// own Bluetooth talks to the Evo. No extra board needed.
//
//   GET  /state/<name>?session_id=<id>&t=<ms>&name=<project>
//        name: idle | thinking | working[_bash|_edit|_read] | needs_input | done | error | end
//   POST /unread/clear         finished sessions stop counting as unread
//   POST /text                 body = text (or form field text=), ?color=RRGGBB
//   GET  /brightness/<0-100>
//   GET  /status               JSON
//   GET  /config               settings, defaults and the file they live in
//   POST /config               JSON with the settings to change (see config.js)
//   GET  /preview/<state>      show a state's animation for a few seconds
//   GET  /themes               the art themes (set one with POST /config {"theme": ...})
//   GET  /art                  which states have your own art (?theme=, default: current)
//   GET  /art/<state>          a state's frames: { frames: [{ pixels: [256 'rrggbb'], ms }] }
//   POST /art/<state>          save frames as tools/art/custom/<state>.gif and use them
//   POST /art/<state>/try      show frames on the Evo without saving
//   DELETE /art/<state>        back to the starter art
//
// Listens on 127.0.0.1 only. Everything except "/" needs the X-Evo-Token
// header, a Host header of 127.0.0.1/localhost, and no Origin header (so web
// pages cannot drive it).
//
// Environment:
//   EVO_MAC         the Evo's address (overrides config.json's "mac"; default:
//                   the paired device named TimeBox*)
//   EVO_CONFIG      settings file (default ~/.config/evo-bridge/config.json)
//   EVO_CHANNEL     RFCOMM channel (default 1)
//   EVO_PORT        HTTP port (default 8787)
//   EVO_TOKEN       shared secret, or
//   EVO_TOKEN_FILE  file holding it (default ~/.config/evo-bridge/token)
//   EVO_PYTHON      Python with Bluetooth sockets (default /usr/bin/python3)
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const encode = require('../tools/evo-encode');
const { buildStates, stateMessages: buildStateMessages, sourceFor } = require('../tools/build-states');
const artIo = require('../tools/art-io');
const themes = require('../tools/art/themes');
const { StateMachine, NAMES, isWorking } = require('./state-machine');
const config = require('./config');
const markers = require('./markers');
const MSG_INTERVAL_MS = 60;
const BACKOFF_MIN_MS = 2000;
const BACKOFF_MAX_MS = 60000;
const TEXT_BASE_MS = 4000;
const TEXT_PER_CHAR_MS = 350;
const TEXT_MAX_MS = 30000;
const PREVIEW_MS = 5000;
const TRY_MAX_MS = 15000;
const ART_BODY_LIMIT = 512 * 1024;

const PORT = Number(process.env.EVO_PORT || 8787);
const CHANNEL = Number(process.env.EVO_CHANNEL || 1);
const PYTHON = process.env.EVO_PYTHON || '/usr/bin/python3';
const PIPE = path.join(__dirname, 'rfcomm-pipe.py');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let cfg = config.load(log);

function readToken() {
  if (process.env.EVO_TOKEN) return process.env.EVO_TOKEN.trim();
  const file = process.env.EVO_TOKEN_FILE || path.join(os.homedir(), '.config', 'evo-bridge', 'token');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

// The Evo to talk to: EVO_MAC, else the configured one, else the paired
// TimeBox. Asynchronous, so a slow bluetoothd never stalls HTTP.
function findEvo() {
  if (process.env.EVO_MAC) return Promise.resolve(process.env.EVO_MAC);
  if (cfg.mac) return Promise.resolve(cfg.mac);
  return new Promise((resolve) => {
    execFile('bluetoothctl', ['devices', 'Paired'], { encoding: 'utf8', timeout: 5000 }, (err, out) => {
      const m = !err && out.match(/^Device ([0-9A-F:]{17}) TimeBox/im);
      resolve(m ? m[1] : '');
    });
  });
}

const TOKEN = readToken();
let MAC = '';
if (TOKEN.length < 16) {
  console.error('No token: put a random string of 16+ characters in ~/.config/evo-bridge/token (or set EVO_TOKEN).');
  process.exit(1);
}

const now = () => performance.now();
const machine = new StateMachine(cfg.timing);

// ---------------------------------------------------------------------------
// Bluetooth link: rfcomm-pipe.py holds the connection; we write to its stdin.

let pipe = null;
let connected = false;
let backoff = BACKOFF_MIN_MS;
let reconnectTimer = null;
let stopping = false;

let connecting = false; // looking up the Evo; a relink waits for it to finish

async function connect() {
  reconnectTimer = null;
  if (connecting || pipe) return;
  connecting = true;
  MAC = await findEvo();
  connecting = false;
  if (stopping) return;
  if (!config.MAC_RE.test(MAC)) {
    // Keep serving HTTP, so the companion app can pick the Evo.
    if (backoff === BACKOFF_MIN_MS) log('[bt] no Evo: pair it (PIN 0000), or choose it in the companion app');
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    return;
  }
  const child = spawn(PYTHON, [PIPE, MAC, String(CHANNEL)], { stdio: ['pipe', 'pipe', 'inherit'] });
  pipe = child;
  child.stdin.on('error', () => {}); // EPIPE when it exits; handled below
  let gone = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    if (!connected && d.includes('connected')) {
      connected = true;
      backoff = BACKOFF_MIN_MS;
      log(`[bt] connected to ${MAC}`);
      // The Evo shows whatever it had: send our screen again.
      showCurrent();
      if (brightness !== null) sender.sendNext(encode.brightness(brightness)[0]);
    }
  });
  // A failed spawn may emit only 'error'; a normal end emits 'exit'. Handle once.
  child.on('error', (e) => {
    log(`[bt] cannot run ${PYTHON}: ${e.message}`);
    onGone('error');
  });
  child.on('exit', (code) => onGone(code));
  function onGone(code) {
    if (gone) return;
    gone = true;
    if (pipe === child) pipe = null;
    const was = connected;
    connected = false;
    if (stopping) return;
    if (was) log('[bt] disconnected');
    const wait = was ? BACKOFF_MIN_MS : backoff;
    if (!was) backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    log(`[bt] retrying in ${Math.round(wait / 1000)} s (exit ${code})`);
    reconnectTimer = setTimeout(connect, wait);
  }
}

// Rate-limited outbox. Replacing the content drops anything still queued, so
// a fast run of state changes only ever sends the newest one.
const sender = {
  queue: [],
  sent: 0,
  last: 0,
  replace(msgs) { this.queue = [...msgs]; },
  sendNext(msg) { this.queue.unshift(msg); },
  loop(t) {
    if (!connected || !pipe || !this.queue.length || t - this.last < MSG_INTERVAL_MS) return;
    pipe.stdin.write(this.queue.shift());
    this.last = t;
    this.sent++;
  },
};

// ---------------------------------------------------------------------------
// Screen

let STATES = {};
let overlay = null; // text or a preview on top of the state: { kind, label, msgs, until }
let brightness = cfg.brightness;

function stateMessages(s) {
  if (Object.hasOwn(STATES, s)) return STATES[s].msgs;
  if (isWorking(s) && Object.hasOwn(STATES, 'working')) return STATES.working.msgs;
  return [];
}

// The state's animation with the unread markers drawn on it. Encoded on
// first use; markerCache is emptied whenever the art changes.
let markerCache = new Map();
function markedMessages(s, marks) {
  const name = !Object.hasOwn(STATES, s) && isWorking(s) ? 'working' : s;
  const art = Object.hasOwn(STATES, name) ? STATES[name] : null;
  if (!marks.length || !art || !art.frames) return stateMessages(s);
  const key = `${name}|${marks.join(',')}`;
  if (!markerCache.has(key)) {
    const frames = art.frames.map(({ pixels, ms }) => ({ pixels: markers.draw(pixels, marks), ms }));
    markerCache.set(key, art.animated ? encode.animation(frames) : encode.picture(frames[0].pixels));
  }
  return markerCache.get(key);
}

// What the state screen is: the state, and a marker per session that waits
// for you. The Evo's own clock cannot carry markers, so the idle pet stays
// while there are any.
function screen() {
  const marks = cfg.unreadMarkers ? machine.unread() : [];
  const state = machine.displayed === 'clock' && marks.length ? 'idle' : machine.displayed;
  return { state, marks };
}

let shown = ''; // the screen() last sent, to notice marker changes
function showCurrent() {
  const { state, marks } = screen();
  shown = `${state}|${marks.join(',')}`;
  sender.replace(overlay ? overlay.msgs : markedMessages(state, marks));
}

function update() {
  const t = now();
  if (overlay && t >= overlay.until) {
    overlay = null;
    showCurrent();
  }
  if (machine.tick(t)) log(`[state] ${machine.displayed}`);
  const { state, marks } = screen();
  if (!overlay && `${state}|${marks.join(',')}` !== shown) showCurrent();
  sender.loop(t);
}

// ---------------------------------------------------------------------------
// HTTP

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const tokenMatches = (got) => crypto.timingSafeEqual(sha(got || ''), sha(TOKEN));
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

function send(res, code, body, type = 'text/plain') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

function authorized(req, res) {
  if (req.headers.origin) return send(res, 403, 'browser requests are not allowed\n'), false;
  if (!HOSTS.has(req.headers.host)) return send(res, 403, 'wrong Host\n'), false;
  if (!tokenMatches(req.headers['x-evo-token'])) return send(res, 401, 'missing or wrong X-Evo-Token\n'), false;
  return true;
}

const cleanId = (raw) => String(raw || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
const cleanName = (raw) => String(raw || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    let over = false;
    req.setEncoding('utf8');
    req.on('data', (c) => {
      if (over) return; // read and drop the rest, so the 413 reply gets through
      body += c;
      if (body.length > limit) {
        over = true;
        body = '';
        reject(new Error('too long'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function textFromBody(body, contentType) {
  if (!/application\/x-www-form-urlencoded/i.test(contentType || '')) return body;
  // `curl --data 'hello'` sends a form body; take text=, else a bare word.
  const form = new URLSearchParams(body);
  if (form.get('text')) return form.get('text');
  for (const [k, v] of form) if (!v && k !== 'color') return k;
  return '';
}

function handleState(name, url, res) {
  name = name.replace(/\/$/, '');
  const sid = cleanId(url.searchParams.get('session_id'));
  const seq = Number(url.searchParams.get('t')) || 0;
  const t = now();
  if (name === 'end') machine.end(sid, t, seq);
  else if (NAMES.includes(name)) {
    machine.report(sid, name, t, seq);
    machine.label(sid, cleanName(url.searchParams.get('name')));
  } else return send(res, 404, `unknown state: ${name}\n`);
  update();
  send(res, 200, `ok ${machine.displayed}\n`);
}

async function handleText(req, url, res) {
  let str;
  try {
    str = textFromBody(await readBody(req), req.headers['content-type']);
  } catch {
    return send(res, 413, 'text too long\n');
  }
  if (!str && url.searchParams.get('text')) str = url.searchParams.get('text');
  str = (str || '').trim();
  if (!str) return send(res, 400, 'empty text\n');
  let color = (url.searchParams.get('color') || 'ffffff').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(color)) color = 'ffffff';
  const ms = Math.min(TEXT_BASE_MS + TEXT_PER_CHAR_MS * str.length, TEXT_MAX_MS);
  overlay = { kind: 'text', label: str, msgs: encode.text(str, color, '000000'), until: now() + ms };
  showCurrent();
  send(res, 200, 'ok\n');
}

function handleBrightness(value, res) {
  value = value.replace(/\/$/, '');
  if (!/^\d{1,3}$/.test(value) || Number(value) > 100) return send(res, 400, 'brightness must be 0-100\n');
  brightness = Number(value);
  sender.sendNext(encode.brightness(brightness)[0]);
  send(res, 200, 'ok\n');
}

function handleStatus(res) {
  const t = now();
  const sessions = [...machine.sessions.values()].filter((s) => !s.ended)
    .map((s) => ({ id: s.id, name: s.name, state: s.state, unread: s.unread, idle_s: Math.floor((t - s.lastSeen) / 1000) }));
  send(res, 200, JSON.stringify({
    transport: 'computer-bluetooth',
    evo: MAC || null,
    connected,
    state: screen().state, // what is on screen: the idle pet stands in for the clock under markers
    state_for_s: Math.floor((t - machine.displayedSince) / 1000),
    text: overlay && overlay.kind === 'text' ? overlay.label : null,
    preview: overlay && overlay.kind === 'preview' ? overlay.label : null,
    queued: sender.queue.length,
    sent: sender.sent,
    brightness,
    theme: cfg.theme,
    unread_markers: cfg.unreadMarkers,
    uptime_s: Math.floor(process.uptime()),
    sessions,
  }) + '\n', 'application/json');
}

function handlePreview(name, res) {
  name = name.replace(/\/$/, '');
  if (!Object.hasOwn(STATES, name)) return send(res, 404, `unknown state: ${name}\n`);
  overlay = { kind: 'preview', label: name, msgs: stateMessages(name), until: now() + PREVIEW_MS };
  showCurrent();
  send(res, 200, 'ok\n');
}

// ---- art (the companion's pixel editor) ----

async function readFrames(req) {
  const body = JSON.parse(await readBody(req, ART_BODY_LIMIT));
  const frames = body && body.frames;
  const p = artIo.problems(frames);
  if (p.length) throw Object.assign(new Error(p.join('\n')), { status: 400 });
  return frames.map(({ pixels, ms }) => ({ pixels, ms }));
}

// Saves and deletes of one state run one at a time, so the art in use always
// matches the file on disk.
const artQueue = new Map();
function serialized(state, fn) {
  const run = (artQueue.get(state) || Promise.resolve()).then(fn, fn);
  artQueue.set(state, run.catch(() => {}));
  return run;
}

// Rebuild a state's messages after its file changed. The change is already
// on disk, so a failure here is reported but not undone.
let activeTheme = null; // the theme STATES holds

async function reloadState(state, theme) {
  await themeLoad; // a theme switch in progress read the files before this save
  if (theme !== activeTheme) return; // edited another theme; nothing on screen changes
  const { msgs, frames, animated } = await buildStateMessages(state, { theme });
  if (theme !== activeTheme) return; // switched while loading
  STATES[state] = { msgs, frames, animated };
  markerCache = new Map();
  if (!overlay) showCurrent(); // the displayed state may be the one that changed
}

// Load every state of a theme and show it. Loads run one after another; a
// load that a newer one overtook is dropped. Resolves to null on success
// (or when overtaken), or to the Error.
let themeLoad = Promise.resolve(null);
let themeGen = 0;
function loadTheme(theme) {
  const gen = ++themeGen;
  themeLoad = themeLoad.then(async () => {
    try {
      const built = await buildStates({ theme });
      if (gen !== themeGen) return null;
      STATES = Object.fromEntries(Object.entries(built)
        .map(([k, v]) => [k, { msgs: v.msgs, frames: v.frames, animated: v.animated }]));
      markerCache = new Map();
      activeTheme = theme;
      log(`[art] theme: ${theme}`);
      if (!overlay) showCurrent();
      return null;
    } catch (e) {
      log(`[art] could not load theme ${theme}: ${e.message}`);
      return e;
    }
  });
  return themeLoad;
}

// The theme list for the companion, with a small preview (first idle frame).
function themesJson() {
  const list = Object.entries(themes.THEMES).map(([id, t]) => {
    const pal = t.paletteFor('idle');
    const preview = t.STATES.idle.frames[0].grid.flat().map((c) => pal[c]);
    return { id, label: t.label, description: t.description, preview };
  });
  return JSON.stringify({ current: cfg.theme, themes: list }) + '\n';
}

async function handleArt(req, url, res) {
  const parts = url.pathname.split('/').filter(Boolean); // ['art', state?, 'try'?]
  const theme = url.searchParams.get('theme') || cfg.theme;
  if (!themes.isTheme(theme)) return send(res, 404, `unknown theme: ${theme}\n`);
  if (parts.length === 1 && req.method === 'GET') {
    const states = artIo.EDITABLE.map((state) => ({ state, custom: sourceFor(state, { theme }).custom }));
    return send(res, 200, JSON.stringify({ theme, states, dir: artIo.CUSTOM_DIR }) + '\n', 'application/json');
  }
  const state = parts[1];
  if (!artIo.isEditable(state) || parts.length > 3 || (parts.length === 3 && parts[2] !== 'try')) {
    return send(res, 404, 'not found\n');
  }
  try {
    if (parts.length === 3 && req.method === 'POST') {
      const frames = await readFrames(req);
      const loop = frames.reduce((a, f) => a + f.ms, 0);
      overlay = { kind: 'preview', label: state, msgs: encode.animation(frames),
        until: now() + Math.min(Math.max(PREVIEW_MS, loop * 2), TRY_MAX_MS) };
      showCurrent();
      return send(res, 200, 'ok\n');
    }
    if (parts.length !== 2) return send(res, 405, 'method not allowed\n');
    if (req.method === 'GET') {
      return send(res, 200, JSON.stringify(await artIo.readArt(state, theme)) + '\n', 'application/json');
    }
    const reloaded = async (what) => {
      try {
        await reloadState(state, theme);
        return 'ok\n';
      } catch (e) {
        log(`[art] ${state}: ${what}, but loading it failed: ${e.message}`);
        return `${what}, but the bridge could not load it (${e.message}); restart the bridge\n`;
      }
    };
    if (req.method === 'POST') {
      const frames = await readFrames(req);
      const reply = await serialized(`${theme}/${state}`, async () => {
        const file = await artIo.writeArt(state, frames, theme);
        log(`[art] ${theme}/${state}: saved ${frames.length} frame(s) to ${file}`);
        return reloaded('Saved');
      });
      return send(res, 200, reply);
    }
    if (req.method === 'DELETE') {
      const reply = await serialized(`${theme}/${state}`, async () => {
        artIo.removeArt(state, theme);
        log(`[art] ${theme}/${state}: back to the starter art`);
        return reloaded('Removed');
      });
      return send(res, 200, reply);
    }
    return send(res, 405, 'method not allowed\n');
  } catch (e) {
    if (e.message === 'too long') return send(res, 413, 'too much art\n');
    if (e instanceof SyntaxError) return send(res, 400, 'body must be JSON\n');
    return send(res, e.status || 500, `${e.message}\n`);
  }
}

function configJson() {
  return JSON.stringify({ config: cfg, defaults: config.DEFAULTS, file: config.FILE,
    mac_from_env: Boolean(process.env.EVO_MAC) }) + '\n';
}

async function handleConfig(req, res) {
  let change;
  try {
    change = JSON.parse(await readBody(req, 16384));
  } catch {
    return send(res, 400, 'body must be JSON\n');
  }
  const p = config.problems(change);
  if (p.length) return send(res, 400, p.join('\n') + '\n');
  const before = cfg;
  const next = config.merge(cfg, change);
  // A new theme must load before it becomes the setting.
  if (next.theme !== before.theme) {
    const err = await loadTheme(next.theme);
    if (err) return send(res, 500, `could not load theme ${next.theme}: ${err.message}\n`);
  }
  try {
    config.save(next);
  } catch (e) {
    if (next.theme !== before.theme) loadTheme(before.theme); // keep showing what the setting says
    return send(res, 500, `could not save ${config.FILE}: ${e.message}\n`);
  }
  cfg = next;
  machine.t = { ...cfg.timing };
  // Compare with what the Evo has now: GET /brightness may have changed it.
  if (cfg.brightness !== brightness) {
    brightness = cfg.brightness;
    if (brightness !== null) sender.sendNext(encode.brightness(brightness)[0]);
  }
  if (cfg.mac !== before.mac && !process.env.EVO_MAC) relink();
  log('[config] saved');
  update();
  send(res, 200, configJson(), 'application/json');
}

// Drop the Bluetooth link and connect again (the Evo to use changed).
function relink() {
  backoff = BACKOFF_MIN_MS;
  clearTimeout(reconnectTimer);
  if (pipe) pipe.kill(); // its exit handler reconnects
  else if (!connecting) connect();
  else reconnectTimer = setTimeout(connect, 500); // a lookup is running; go again after it
}

const ROOT = 'Evo bridge (computer)\n'
  + '  GET  /state/<idle|thinking|working|working_bash|working_edit|working_read|needs_input|done|error|end>?session_id=ID\n'
  + '  POST /text   (body = text, ?color=RRGGBB)\n'
  + '  GET  /brightness/<0-100>\n'
  + '  GET  /status\n'
  + '  POST /unread/clear\n'
  + '  GET  /config, POST /config (JSON)\n'
  + '  GET  /preview/<state>\n'
  + '  GET|POST|DELETE /art/<state>, POST /art/<state>/try\n';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://bridge');
  const p = url.pathname;
  if (p === '/' && req.method === 'GET') return send(res, 200, ROOT);
  if (!authorized(req, res)) return;
  if (p === '/status' && req.method === 'GET') return handleStatus(res);
  if (p === '/text' && req.method === 'POST') return handleText(req, url, res).catch(() => send(res, 500, 'error\n'));
  if (p.startsWith('/state/')) return handleState(p.slice(7), url, res);
  if (p === '/unread/clear' && req.method === 'POST') {
    machine.clearUnread();
    update();
    return send(res, 200, 'ok\n');
  }
  if (p.startsWith('/brightness/')) return handleBrightness(p.slice(12), res);
  if (p.startsWith('/preview/')) return handlePreview(p.slice(9), res);
  if (p === '/themes' && req.method === 'GET') return send(res, 200, themesJson(), 'application/json');
  if (p === '/art' || p.startsWith('/art/')) return handleArt(req, url, res).catch(() => send(res, 500, 'error\n'));
  if (p === '/config' && req.method === 'GET') return send(res, 200, configJson(), 'application/json');
  if (p === '/config' && req.method === 'POST') return handleConfig(req, res).catch(() => send(res, 500, 'error\n'));
  send(res, 404, 'not found\n');
});

function shutdown() {
  stopping = true;
  clearTimeout(reconnectTimer);
  server.close();
  if (pipe) pipe.stdin.end();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  if (await loadTheme(cfg.theme)) {
    if (cfg.theme === themes.DEFAULT_THEME) throw new Error('could not load the starter art (run `npm run art` in tools/)');
    log(`[art] using ${themes.DEFAULT_THEME} instead; pick another theme in the companion app`);
    cfg = { ...cfg, theme: themes.DEFAULT_THEME };
    if (await loadTheme(cfg.theme)) throw new Error('could not load the starter art (run `npm run art` in tools/)');
  }
  server.on('error', (e) => {
    console.error(`HTTP: ${e.message}`);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => log(`[http] http://127.0.0.1:${PORT}  (channel ${CHANNEL}, settings ${config.FILE})`));
  showCurrent();
  connect();
  setInterval(update, 20);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
