'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activityFromLine, cleanOutputLine, createLineReader } = require('../src/progress');

test('shows real percentages for build and source downloads', () => {
  assert.deepEqual(activityFromLine('[ 42%] Building C object'), { detail: 'Building your game', percent: 42 });
  assert.deepEqual(activityFromLine('Receiving objects:  76% (123/160)'), { detail: 'Downloading files', percent: 76 });
  assert.deepEqual(activityFromLine('-- Configuring done'), { detail: 'Getting your game ready', percent: null });
});

test('uses Ninja completed steps on Windows and private Mac tools, including small incremental builds', () => {
  assert.deepEqual(activityFromLine('[735/2475] Building CXX object decomp/src/Camera/Camera.cpp.obj'),
    { detail: 'Building your game · 735 of 2,475 steps', percent: 29 });
  assert.deepEqual(activityFromLine('\x1b[2K\x1b[32m[2/3] Linking CXX executable sms.exe\x1b[0m'),
    { detail: 'Finishing the game build · 2 of 3 steps', percent: 66 });
  assert.deepEqual(activityFromLine('[3/3] Linking CXX executable sms'),
    { detail: 'Finishing the game build · 3 of 3 steps', percent: 100 });
  for (const invalid of ['[1/0] Building', '[4/3] Building', '[9007199254740992/9007199254740992] Building'])
    assert.equal(activityFromLine(invalid), null);
});

test('disc preparation remains a separate phase after compilation reaches 100 percent', () => {
  assert.deepEqual(activityFromLine('[100%] Bundling /Users/player/Game.iso into sms-standalone'),
    { detail: 'Preparing your game files', percent: null });
  assert.deepEqual(activityFromLine('[1/1] Bundling C:/Games/Game.iso into sms-standalone'),
    { detail: 'Preparing your game files', percent: null });
  assert.deepEqual(activityFromLine('Built build/windows-64/sms.exe (windows, 64-bit)'),
    { detail: 'Finishing setup', percent: null });
  assert.deepEqual(activityFromLine('bundle_disc: wrote build/linux-64/sms-standalone (512 MiB)'),
    { detail: 'Preparing your game files', percent: null });
});

test('reads pipe chunks, carriage-return progress, split Unicode, and the final error line without loss', () => {
  const output = Buffer.from('\x1b[2K[1/3] Building CXX object Mario.cpp.obj\r\n[2/3] Building CXX object Café.cpp.obj\r[3/3] Linking sms.exe\nerror: setup failed');
  const lines = [];
  const reader = createLineReader(line => lines.push(line));
  for (const byte of output) reader.write(Buffer.from([byte]));
  reader.end();
  assert.deepEqual(lines, ['[1/3] Building CXX object Mario.cpp.obj', '[2/3] Building CXX object Café.cpp.obj',
    '[3/3] Linking sms.exe', 'error: setup failed']);
  assert.equal(activityFromLine(lines[1]).percent, 66);
  assert.equal(cleanOutputLine('\x1b]8;;https://example.com\x1b\\Camera.cpp\x1b]8;;\x1b\\'), 'Camera.cpp');
});

test('reports texture install phases without inventing a download percentage', () => {
  assert.deepEqual(activityFromLine('Downloading Super Mario Sunshine UHD Texture Pack v2.1.1'),
    { detail: 'Downloading HD textures (about 1 GB)', percent: null });
  assert.deepEqual(activityFromLine('Unpacking GMS.7z'), { detail: 'Installing HD textures', percent: null });
  assert.deepEqual(activityFromLine('Installed 2180 textures in mods/textures/GMS.'),
    { detail: 'HD textures installed', percent: 100 });
});

test('reports texture download bytes, handles unknown file sizes, and separates checksum checking', () => {
  assert.deepEqual(activityFromLine('Texture download: 500000000/1000000000 bytes'),
    { detail: 'Downloading HD textures · 500 MB of 1,000 MB', percent: 50 });
  assert.deepEqual(activityFromLine('Texture download: 1000000000/1000000000 bytes'),
    { detail: 'Downloading HD textures · 1,000 MB of 1,000 MB', percent: 100 });
  assert.deepEqual(activityFromLine('Texture download: 500000000/0 bytes'),
    { detail: 'Downloading HD textures · 500 MB downloaded', percent: null });
  assert.deepEqual(activityFromLine('Checking HD texture download'),
    { detail: 'Checking HD textures', percent: null });
  for (const invalid of ['Texture download: 4/3 bytes', 'Texture download: 9007199254740992/0 bytes'])
    assert.equal(activityFromLine(invalid), null);
});
