'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activityFromLine } = require('../src/progress');

test('shows real percentages for build and source downloads', () => {
  assert.deepEqual(activityFromLine('[ 42%] Building C object'), { detail: 'Compiling game code', percent: 42 });
  assert.deepEqual(activityFromLine('Receiving objects:  76% (123/160)'), { detail: 'Receiving objects', percent: 76 });
  assert.deepEqual(activityFromLine('-- Configuring done'), { detail: 'Configuring build', percent: null });
});

test('reports texture install phases without inventing a download percentage', () => {
  assert.deepEqual(activityFromLine('Downloading Super Mario Sunshine UHD Texture Pack v2.1.1'),
    { detail: 'Downloading UHD textures (about 1 GB)', percent: null });
  assert.deepEqual(activityFromLine('Unpacking GMS.7z'), { detail: 'Unpacking UHD textures', percent: null });
  assert.deepEqual(activityFromLine('Installed 2180 textures in mods/textures/GMS.'),
    { detail: 'HD textures installed', percent: 100 });
});
