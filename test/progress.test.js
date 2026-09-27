'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activityFromLine } = require('../src/progress');

test('shows real percentages for build and source downloads', () => {
  assert.deepEqual(activityFromLine('[ 42%] Building C object'), { detail: 'Preparing your game', percent: 42 });
  assert.deepEqual(activityFromLine('Receiving objects:  76% (123/160)'), { detail: 'Downloading files', percent: 76 });
  assert.deepEqual(activityFromLine('-- Configuring done'), { detail: 'Getting your game ready', percent: null });
});

test('reports texture install phases without inventing a download percentage', () => {
  assert.deepEqual(activityFromLine('Downloading Super Mario Sunshine UHD Texture Pack v2.1.1'),
    { detail: 'Downloading HD textures (about 1 GB)', percent: null });
  assert.deepEqual(activityFromLine('Unpacking GMS.7z'), { detail: 'Installing HD textures', percent: null });
  assert.deepEqual(activityFromLine('Installed 2180 textures in mods/textures/GMS.'),
    { detail: 'HD textures installed', percent: 100 });
});
