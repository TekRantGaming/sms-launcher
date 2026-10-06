'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const port = require('../src/port');

function state() {
  return {
    config: { repo: '/installed/port', settings: port.normalizeSettings({ autoUpdate: true }), completedSetup: true },
    platform: port.platformInfo(), tools: { ready: true, appleReady: true },
    repoReady: true, romReady: true, binaryReady: true, hdVisualsReady: true,
    game: { needsUpdate: true, installedVersion: 'older', availableVersion: 'newer', launcherVersion: '0.1.39' },
    appUpdate: { message: '' }, backups: [], logs: [], active: null
  };
}

async function renderer(data = state()) {
  const calls = [], elements = new Map();
  function element(classes = '') {
    const names = new Set(classes.split(' ')), listeners = new Map();
    return { hidden: false, disabled: false, textContent: '', value: '', style: {}, open: false,
      classList: { contains: name => names.has(name), toggle(name, enabled) {
        if (enabled) names.add(name); else names.delete(name);
      } },
      addEventListener: (event, callback) => listeners.set(event, callback),
      click() { if (!this.disabled) return listeners.get('click')?.(); },
      setAttribute() {}, removeAttribute() {}, replaceChildren() {}, append() {}, focus() {},
      close() { this.open = false; }, showModal() { this.open = true; } };
  }
  const html = fs.readFileSync(path.resolve(__dirname, '../src/index.html'), 'utf8');
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g))
    elements.set(match[1], element(match[0].match(/class="([^"]+)"/)?.[1]));
  const sms = {
    state: async () => data, windowState: async () => ({}),
    onLog() {}, onActivity() {}, onAppUpdate() {}, onWindowState() {},
    play: async () => { calls.push('play'); }, launchGame: async () => { calls.push('launchGame'); }
  };
  const context = vm.createContext({ console, setInterval() {}, window: { sms }, document: {
    getElementById(id) { assert.ok(elements.has(id), `Missing HTML element ${id}`); return elements.get(id); },
    querySelectorAll(selector) {
      return selector === '.launcher-modal' ? ['page-settings', 'activity-log', 'mac-tools-help'].map(id => elements.get(id)) : [];
    }, createElement: () => element()
  } });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/renderer.js'), 'utf8'), context);
  await new Promise(setImmediate);
  return { elements, calls, async refresh() { vm.runInContext('refresh(current)', context); },
    async click(id) { elements.get(id).click(); await new Promise(setImmediate); } };
}

test('home screen offers update or installed play and skip calls the launch-only IPC', async () => {
  const ui = await renderer();
  assert.equal(ui.elements.get('installed-play-option').hidden, false);
  assert.match(ui.elements.get('play').textContent, /Update & play/);
  assert.equal(ui.elements.get('skip-update-play').textContent, 'Skip update & play');
  assert.match(ui.elements.get('installed-play-note').textContent, /game older/);
  await ui.click('skip-update-play');
  assert.deepEqual(ui.calls, ['play']);
  await ui.click('play');
  assert.deepEqual(ui.calls, ['play', 'launchGame']);
});

test('installed play is unavailable before setup, without a disc, or while busy', async () => {
  for (const patch of [{ binaryReady: false }, { romReady: false }]) {
    const ui = await renderer({ ...state(), ...patch });
    assert.equal(ui.elements.get('installed-play-option').hidden, true);
  }
  const data = state(), ui = await renderer(data);
  data.active = { label: 'Build Sunshine port' };
  await ui.refresh();
  assert.equal(ui.elements.get('skip-update-play').disabled, true);
  await ui.click('skip-update-play');
  assert.deepEqual(ui.calls, []);
});

test('pending HD setup offers installed play, while current complete installs show only Play', async () => {
  const data = state(); data.game.needsUpdate = false; data.game.installedVersion = null;
  const ui = await renderer(data);
  assert.equal(ui.elements.get('installed-play-option').hidden, true);
  data.hdVisualsReady = false;
  await ui.refresh();
  assert.equal(ui.elements.get('installed-play-option').hidden, false);
  assert.equal(ui.elements.get('skip-update-play').textContent, 'Play installed version');
  assert.match(ui.elements.get('installed-play-note').textContent, /your installed game/);
  await ui.click('skip-update-play');
  assert.deepEqual(ui.calls, ['play']);
});
