// Settings for the laptop bridge, kept in ~/.config/evo-bridge/config.json
// (EVO_CONFIG overrides the path). The companion app edits them through
// POST /config; every field is optional and falls back to the default.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.config', 'evo-bridge');
const FILE = process.env.EVO_CONFIG || path.join(DIR, 'config.json');

// Same timing values as firmware/include/config.h.
const DEFAULTS = {
  mac: '',          // '' = the paired device named TimeBox*
  brightness: null, // null = leave the Evo's own setting alone
  timing: {
    minDisplayMs: 800,
    workingDebounceMs: 1500,
    errorHoldMs: 3000,
    doneHoldMs: 30000,
    idleToClockMs: 120000,          // 0 = never show the clock
    staleBusyMs: 10 * 60 * 1000,    // 0 = never
    sessionTimeoutMs: 30 * 60 * 1000,
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;
// Lower limits where 0 has no "off" meaning. A session timeout of 0 would drop
// every session at once.
const MIN = { sessionTimeoutMs: 60000 };
const has = (o, k) => Object.hasOwn(o, k);
const MAC_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;

// Checks a (partial) config. Returns a list of problems; empty = fine.
function problems(c) {
  const out = [];
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return ['config must be a JSON object'];
  for (const k of Object.keys(c)) if (!has(DEFAULTS, k)) out.push(`unknown setting: ${k}`);
  if (has(c, 'mac') && !(c.mac === '' || (typeof c.mac === 'string' && MAC_RE.test(c.mac)))) {
    out.push('mac must look like 11:22:33:44:55:66, or be empty for auto');
  }
  if (has(c, 'brightness') && c.brightness !== null
      && !(Number.isInteger(c.brightness) && c.brightness >= 0 && c.brightness <= 100)) {
    out.push('brightness must be 0-100 or null');
  }
  if (has(c, 'timing')) {
    if (c.timing === null || typeof c.timing !== 'object' || Array.isArray(c.timing)) {
      out.push('timing must be an object');
    } else {
      for (const [k, v] of Object.entries(c.timing)) {
        const min = MIN[k] || 0;
        if (!has(DEFAULTS.timing, k)) out.push(`unknown timing: ${k}`);
        else if (!(Number.isInteger(v) && v >= min && v <= DAY_MS)) out.push(`${k} must be ${min}-${DAY_MS} ms`);
      }
    }
  }
  return out;
}

// Defaults overlaid with `c` (assumed valid).
function merge(base, c) {
  return {
    mac: has(c, 'mac') ? c.mac : base.mac,
    brightness: has(c, 'brightness') ? c.brightness : base.brightness,
    timing: { ...base.timing, ...(c.timing || {}) },
  };
}

// The saved settings, or the defaults. A broken file is reported, not fatal.
function load(log = console.error) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') log(`[config] ignoring ${FILE}: ${e.message}`);
    return merge(DEFAULTS, {});
  }
  const p = problems(raw);
  if (p.length) {
    log(`[config] ignoring ${FILE}: ${p.join('; ')}`);
    return merge(DEFAULTS, {});
  }
  return merge(DEFAULTS, raw);
}

// Write atomically, readable by this user only.
function save(c) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

module.exports = { DEFAULTS, MIN, FILE, problems, merge, load, save, MAC_RE };
