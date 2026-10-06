'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const bindings = require('../src/bindings');

test('every control has game defaults and a label', () => {
  assert.equal(bindings.CONTROLS.length, Object.keys(bindings.DEFAULTS).length);
  for (const { id, label } of bindings.CONTROLS) {
    assert.ok(label, id);
    assert.ok(bindings.DEFAULTS[id].length, id);
  }
});

test('browser key codes map to the key names the game reads', () => {
  assert.equal(bindings.keyFromCode('KeyW'), 'W');
  assert.equal(bindings.keyFromCode('Digit3'), '3');
  assert.equal(bindings.keyFromCode('Numpad8'), 'KP_8');
  assert.equal(bindings.keyFromCode('ArrowLeft'), 'LEFT');
  assert.equal(bindings.keyFromCode('ShiftRight'), 'RSHIFT');
  assert.equal(bindings.keyFromCode('Space'), 'SPACE');
  assert.equal(bindings.keyFromCode('F12'), null);
  assert.equal(bindings.keyFromCode('MetaLeft'), null);
});

test('normalize keeps only changed controls with known, distinct keys, at most eight', () => {
  assert.deepEqual(bindings.normalize(null), {});
  assert.deepEqual(bindings.normalize({ A: ['SPACE', 'X'] }), {});
  assert.deepEqual(bindings.normalize({ A: ['J', 'J', 'BOGUS'] }), { A: ['J'] });
  assert.deepEqual(bindings.normalize({ QUIT: 'ESCAPE', NOT_A_CONTROL: ['A'] }), {});
  assert.equal(bindings.normalize({ A: 'ABCDEFGHIJ'.split('') }).A.length, 8);
});

test('the bindings file lists every control, with changed keys replacing the defaults', () => {
  const text = bindings.fileText({ A: ['J', 'KP_0'] });
  const lines = text.trim().split('\n').filter(line => !line.startsWith('#'));
  assert.equal(lines.length, bindings.CONTROLS.length);
  assert.ok(lines.includes('A = J KP_0'));
  assert.ok(lines.includes('B = LSHIFT RSHIFT C'));
  assert.ok(lines.includes('QUIT = ESCAPE'));
});
