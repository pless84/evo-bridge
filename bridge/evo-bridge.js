#!/usr/bin/env node
// Laptop bridge: the same HTTP API as the ESP32 firmware, but this computer's
// own Bluetooth talks to the Evo. No extra board needed.
//
//   GET  /state/<name>?session_id=<id>&t=<ms>
//        name: idle | thinking | working[_bash|_edit|_read] | needs_input | done | error | end
//   POST /text                 body = text (or form field text=), ?color=RRGGBB
//   GET  /brightness/<0-100>
//   GET  /status               JSON
//
// Listens on 127.0.0.1 only. Everything except "/" needs the X-Evo-Token
// header, a Host header of 127.0.0.1/localhost, and no Origin header (so web
// pages cannot drive it).
//
// Environment:
//   EVO_MAC         the Evo's address (default: the paired device named TimeBox*)
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
const { spawn, execFileSync } = require('child_process');

const encode = require('../tools/evo-encode');
const { buildStates } = require('../tools/build-states');
const { StateMachine, NAMES, isWorking } = require('./state-machine');

// Same values as firmware/include/config.h.
const TIMING = {
  minDisplayMs: 800,
  workingDebounceMs: 1500,
  errorHoldMs: 3000,
  doneHoldMs: 30000,
  idleToClockMs: 120000,
  staleBusyMs: 10 * 60 * 1000,
  sessionTimeoutMs: 30 * 60 * 1000,
};
const MSG_INTERVAL_MS = 60;
const BACKOFF_MIN_MS = 2000;
const BACKOFF_MAX_MS = 60000;
const TEXT_BASE_MS = 4000;
const TEXT_PER_CHAR_MS = 350;
const TEXT_MAX_MS = 30000;

const PORT = Number(process.env.EVO_PORT || 8787);
const CHANNEL = Number(process.env.EVO_CHANNEL || 1);
const PYTHON = process.env.EVO_PYTHON || '/usr/bin/python3';
const PIPE = path.join(__dirname, 'rfcomm-pipe.py');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function readToken() {
  if (process.env.EVO_TOKEN) return process.env.EVO_TOKEN.trim();
  const file = process.env.EVO_TOKEN_FILE || path.join(os.homedir(), '.config', 'evo-bridge', 'token');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

function findEvo() {
  if (process.env.EVO_MAC) return process.env.EVO_MAC;
  try {
    const out = execFileSync('bluetoothctl', ['devices', 'Paired'], { encoding: 'utf8', timeout: 5000 });
    const m = out.match(/^Device ([0-9A-F:]{17}) TimeBox/im);
    if (m) return m[1];
  } catch { /* fall through */ }
  return '';
}

const TOKEN = readToken();
const MAC = findEvo();
if (TOKEN.length < 16) {
  console.error('No token: put a random string of 16+ characters in ~/.config/evo-bridge/token (or set EVO_TOKEN).');
  process.exit(1);
}
if (!/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i.test(MAC)) {
  console.error('No Evo found: pair it in Bluetooth settings (PIN 0000), or set EVO_MAC.');
  process.exit(1);
}

const now = () => performance.now();
const machine = new StateMachine(TIMING);

// ---------------------------------------------------------------------------
// Bluetooth link: rfcomm-pipe.py holds the connection; we write to its stdin.

let pipe = null;
let connected = false;
let backoff = BACKOFF_MIN_MS;
let reconnectTimer = null;
let stopping = false;

function connect() {
  reconnectTimer = null;
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
let text = null; // { str, msgs, until }
let brightness = null;

function stateMessages(s) {
  if (STATES[s]) return STATES[s].msgs;
  if (isWorking(s) && STATES.working) return STATES.working.msgs;
  return [];
}

function showCurrent() {
  sender.replace(text ? text.msgs : stateMessages(machine.displayed));
}

function update() {
  const t = now();
  if (text && t >= text.until) {
    text = null;
    showCurrent();
  }
  if (machine.tick(t)) {
    log(`[state] ${machine.displayed}`);
    if (!text) showCurrent();
  }
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

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > limit) reject(new Error('too long'));
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
  else if (NAMES.includes(name)) machine.report(sid, name, t, seq);
  else return send(res, 404, `unknown state: ${name}\n`);
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
  text = { str, msgs: encode.text(str, color, '000000'), until: now() + ms };
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
    .map((s) => ({ id: s.id, state: s.state, idle_s: Math.floor((t - s.lastSeen) / 1000) }));
  send(res, 200, JSON.stringify({
    transport: 'laptop-bluetooth',
    evo: MAC,
    connected,
    state: machine.displayed,
    state_for_s: Math.floor((t - machine.displayedSince) / 1000),
    text: text ? text.str : null,
    queued: sender.queue.length,
    sent: sender.sent,
    brightness,
    uptime_s: Math.floor(process.uptime()),
    sessions,
  }) + '\n', 'application/json');
}

const ROOT = 'Evo bridge (laptop)\n'
  + '  GET  /state/<idle|thinking|working|working_bash|working_edit|working_read|needs_input|done|error|end>?session_id=ID\n'
  + '  POST /text   (body = text, ?color=RRGGBB)\n'
  + '  GET  /brightness/<0-100>\n'
  + '  GET  /status\n';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://bridge');
  const p = url.pathname;
  if (p === '/' && req.method === 'GET') return send(res, 200, ROOT);
  if (!authorized(req, res)) return;
  if (p === '/status' && req.method === 'GET') return handleStatus(res);
  if (p === '/text' && req.method === 'POST') return handleText(req, url, res).catch(() => send(res, 500, 'error\n'));
  if (p.startsWith('/state/')) return handleState(p.slice(7), url, res);
  if (p.startsWith('/brightness/')) return handleBrightness(p.slice(12), res);
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
  STATES = Object.fromEntries(Object.entries(await buildStates()).map(([k, v]) => [k, { msgs: v.msgs }]));
  server.on('error', (e) => {
    console.error(`HTTP: ${e.message}`);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => log(`[http] http://127.0.0.1:${PORT}  (Evo ${MAC}, channel ${CHANNEL})`));
  showCurrent();
  connect();
  setInterval(update, 20);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
