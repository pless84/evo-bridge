// The art themes. Each has the same states; the bridge and the firmware
// build use one at a time (the `theme` setting, default "blip").
//
// Theme module: { label, description, STATES: { state: { frames } }, paletteFor(state) }
const path = require('path');
const blip = require('../sprites');

const THEMES = {
  blip: {
    label: 'Blip',
    description: 'The original pet: a round blob whose colour shows the state.',
    STATES: blip.STATES,
    paletteFor: blip.paletteFor,
  },
  robot: require('./robot'),
  ring: require('./ring'),
  critter: require('./critter'),
  sprout: require('./sprout'),
  weather: require('./weather'),
  terminal: require('./terminal'),
};

const DEFAULT_THEME = 'blip';
const STATE_NAMES = Object.keys(blip.STATES);

for (const [id, t] of Object.entries(THEMES)) {
  const missing = STATE_NAMES.filter((s) => !t.STATES[s]);
  if (missing.length) throw new Error(`theme ${id} has no art for: ${missing.join(', ')}`);
}

const isTheme = (id) => typeof id === 'string' && Object.hasOwn(THEMES, id);

// Rendered starter GIFs. Blip keeps the original location.
const ART = path.join(__dirname, '..');
const gifDir = (id) => (id === DEFAULT_THEME ? path.join(ART, 'gif') : path.join(ART, 'gif', id));

module.exports = { THEMES, DEFAULT_THEME, STATE_NAMES, isTheme, gifDir };
