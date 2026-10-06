'use strict';
// Keyboard bindings for the game (platform/pad/pad.cpp reads them from the
// file named by SMS_BINDINGS: one `CONTROL = KEY [KEY ...]` line per control,
// each line replacing that control's defaults). The launcher keeps only the
// controls a player changed; everything else stays the game's default.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmsBindings = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  const CONTROLS = [
    { id: 'STICK_UP', label: 'Move forward' }, { id: 'STICK_DOWN', label: 'Move back' },
    { id: 'STICK_LEFT', label: 'Move left' }, { id: 'STICK_RIGHT', label: 'Move right' },
    { id: 'HALF_TILT', label: 'Walk (half tilt)' },
    { id: 'A', label: 'A button' }, { id: 'B', label: 'B button' }, { id: 'X', label: 'X button' },
    { id: 'Y', label: 'Y button' }, { id: 'Z', label: 'Z button' }, { id: 'L', label: 'L trigger' },
    { id: 'R', label: 'R trigger' }, { id: 'START', label: 'Start' },
    { id: 'CSTICK_UP', label: 'Camera up' }, { id: 'CSTICK_DOWN', label: 'Camera down' },
    { id: 'CSTICK_LEFT', label: 'Camera left' }, { id: 'CSTICK_RIGHT', label: 'Camera right' },
    { id: 'DPAD_UP', label: 'D-pad up' }, { id: 'DPAD_DOWN', label: 'D-pad down' },
    { id: 'DPAD_LEFT', label: 'D-pad left' }, { id: 'DPAD_RIGHT', label: 'D-pad right' },
    { id: 'QUIT', label: 'Quit the game' }
  ];
  // The game's built-in defaults (kDefaultBindings in platform/pad/pad.cpp).
  const DEFAULTS = {
    A: ['SPACE', 'X'], B: ['LSHIFT', 'RSHIFT', 'C'], X: ['V'], Y: ['F'], Z: ['Z'], L: ['Q'], R: ['E'],
    START: ['ENTER'], DPAD_UP: ['1', 'KP_8'], DPAD_DOWN: ['2', 'KP_2'], DPAD_LEFT: ['3', 'KP_4'],
    DPAD_RIGHT: ['4', 'KP_6'], STICK_UP: ['UP', 'W'], STICK_DOWN: ['DOWN', 'S'], STICK_LEFT: ['LEFT', 'A'],
    STICK_RIGHT: ['RIGHT', 'D'], CSTICK_UP: ['I'], CSTICK_DOWN: ['K'], CSTICK_LEFT: ['J'], CSTICK_RIGHT: ['L'],
    HALF_TILT: ['LCTRL'], QUIT: ['ESCAPE']
  };
  // KeyboardEvent.code to the key names the game knows (kKeys in pad.cpp).
  const CODES = {
    Enter: 'ENTER', Escape: 'ESCAPE', Backspace: 'BACKSPACE', Tab: 'TAB', Space: 'SPACE', Minus: 'MINUS',
    Equal: 'EQUALS', BracketLeft: 'LBRACKET', BracketRight: 'RBRACKET', Semicolon: 'SEMICOLON',
    Quote: 'APOSTROPHE', Comma: 'COMMA', Period: 'PERIOD', Slash: 'SLASH', F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4',
    ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', NumpadDivide: 'KP_DIVIDE',
    NumpadMultiply: 'KP_MULTIPLY', NumpadSubtract: 'KP_MINUS', NumpadAdd: 'KP_PLUS', NumpadEnter: 'KP_ENTER',
    ControlLeft: 'LCTRL', ShiftLeft: 'LSHIFT', AltLeft: 'LALT', ControlRight: 'RCTRL', ShiftRight: 'RSHIFT',
    AltRight: 'RALT'
  };
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') CODES[`Key${letter}`] = letter;
  for (let digit = 0; digit <= 9; digit++) { CODES[`Digit${digit}`] = String(digit); CODES[`Numpad${digit}`] = `KP_${digit}`; }
  const KEYS = new Set(Object.values(CODES));
  const MAX_KEYS = 8;  // kMaxKeys in pad.cpp

  // The key name for a KeyboardEvent.code, or null for a key the game cannot read.
  function keyFromCode(code) { return CODES[code] || null; }

  // Only the controls that differ from the defaults, each a list of known keys.
  function normalize(input) {
    const result = {};
    if (!input || typeof input !== 'object') return result;
    for (const { id } of CONTROLS) {
      if (!Array.isArray(input[id])) continue;
      const keys = [...new Set(input[id].map(String).filter(key => KEYS.has(key)))].slice(0, MAX_KEYS);
      if (keys.join(' ') !== DEFAULTS[id].join(' ')) result[id] = keys;
    }
    return result;
  }

  function keysFor(bindings, id) { return (bindings && bindings[id]) || DEFAULTS[id]; }

  function fileText(bindings) {
    const lines = ['# Written by SMS Launcher from Settings → Controls. Changes here are replaced on the next launch.'];
    for (const { id } of CONTROLS) lines.push(`${id} =${keysFor(bindings, id).map(key => ` ${key}`).join('')}`);
    return `${lines.join('\n')}\n`;
  }

  return { CONTROLS, DEFAULTS, keyFromCode, normalize, keysFor, fileText };
});
