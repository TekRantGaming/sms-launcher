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

async function renderer(data = state(), copyError = null) {
  const calls = [], elements = new Map(), droppedFiles = [], listeners = {};
  let logCallback, resetCallback, activityCallback;
  function element(classes = '') {
    const names = new Set(classes.split(' ')), listeners = new Map();
    return { hidden: false, disabled: false, textContent: '', value: '', style: {}, open: false,
      classList: { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name), toggle(name, enabled) {
        if (enabled) names.add(name); else names.delete(name);
      } },
      addEventListener: (event, callback) => { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(callback); },
      click() { if (!this.disabled) for (const callback of listeners.get('click') || []) callback(); },
      dispatch(event, value) { for (const callback of listeners.get(event) || []) callback(value); },
      setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
      replaceChildren(...children) { this.textContent = children.map(child => child.textContent).join(''); }, append() {}, focus() {},
      close() { this.open = false; }, showModal() { this.open = true; } };
  }
  const html = fs.readFileSync(path.resolve(__dirname, '../src/index.html'), 'utf8');
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = element(match[0].match(/class="([^"]+)"/)?.[1]);
    node.hidden = /\bhidden\b/.test(match[0]);
    elements.set(match[1], node);
  }
  const sms = {
    state: async () => data, windowState: async () => ({}), zoomFactor: () => 1,
    importDolphinSave: async file => { calls.push('importDolphinSave'); droppedFiles.push(file); return { name: 'super_mario_sunshine' }; },
    onLog(callback) { logCallback = callback; }, onActivity(callback) { activityCallback = callback; }, onAppUpdate() {}, onWindowState() {}, onOnline(callback) { listeners.online = callback; },
    onLogReset(callback) { resetCallback = callback; },
    saveActivityLog: async () => { calls.push('saveActivityLog'); },
    copyActivityLog: async () => { calls.push('copyActivityLog'); if (copyError) throw copyError; },
    saveSettings: async value => { calls.push(['saveSettings', value]); return { ...data, config: { ...data.config, settings: port.normalizeSettings(value) } }; },
    play: async () => { calls.push('play'); }, launchGame: async () => { calls.push('launchGame'); }
  };
  const context = vm.createContext({ console, setInterval() {}, requestAnimationFrame: callback => setImmediate(callback),
    window: { sms, smsActivityLog: require('../src/activity-log'), addEventListener() {} }, document: {
    getElementById(id) { assert.ok(elements.has(id), `Missing HTML element ${id}`); return elements.get(id); },
    querySelectorAll(selector) {
      return selector === '.launcher-modal' ? ['page-settings', 'mac-tools-help'].map(id => elements.get(id)) : [];
    }, createElement: () => element()
  } });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/renderer.js'), 'utf8'), context);
  await new Promise(setImmediate);
  return { elements, calls, droppedFiles, listeners,
    async emitLog(entry) { logCallback(entry); await new Promise(setImmediate); },
    async resetLog(sequence) { resetCallback(sequence); await new Promise(setImmediate); },
    async emitActivity(active) { activityCallback(active); await new Promise(setImmediate); },
    async refresh() { vm.runInContext('refresh(current)', context); },
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

test('Update & play shows the newly built game version once the game starts', async () => {
  const data = state(), ui = await renderer(data);
  assert.match(ui.elements.get('version-summary').textContent, /Game older/);
  const startedAt = Date.now();
  await ui.emitActivity({ label: 'Prepare game', startedAt });
  await ui.emitActivity({ label: 'Build Sunshine port', startedAt, canStop: true });
  data.game = { ...data.game, installedVersion: 'newer', needsUpdate: false };
  await ui.emitActivity({ label: 'Play Super Mario Sunshine', startedAt, canStop: true });
  assert.match(ui.elements.get('version-summary').textContent, /Game newer/);
  assert.equal(ui.elements.get('installed-game-version').textContent, 'newer');
});

test('Dolphin save import offers a chooser and drop, reports success and refuses busy or multiple drops', async () => {
  const data = state(), ui = await renderer(data);
  await ui.click('import-dolphin-save');
  assert.deepEqual(ui.calls, ['importDolphinSave']);
  assert.match(ui.elements.get('dolphin-import-result').textContent, /imported/);
  const file = { name: 'Sunshine.gci' }, drop = ui.elements.get('dolphin-save-drop');
  let prevented = false;
  const event = files => ({ preventDefault() { prevented = true; }, dataTransfer: { files } });
  drop.dispatch('drop', event([file]));
  await new Promise(setImmediate);
  assert.equal(prevented, true);
  assert.equal(ui.droppedFiles[1], file);
  drop.dispatch('drop', event([file, file]));
  assert.match(ui.elements.get('dolphin-import-result').textContent, /one Dolphin/);
  assert.equal(ui.calls.length, 2);
  data.active = { label: 'Play Super Mario Sunshine' };
  await ui.refresh();
  assert.equal(ui.elements.get('import-dolphin-save').disabled, true);
  await ui.click('import-dolphin-save');
  drop.dispatch('drop', event([file]));
  await new Promise(setImmediate);
  assert.equal(ui.calls.length, 2);
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

test('activity log renders stream labels, updates partial lines once and saves the full session', async () => {
  const data = state();
  data.logs = [{ id: 1, sequence: 1, stream: 'launcher', text: 'Started' },
    { id: 2, sequence: 2, stream: 'stderr', text: 'partial' }];
  const ui = await renderer(data);
  await ui.emitLog({ id: 2, sequence: 3, stream: 'stderr', text: 'complete diagnostic' });
  await ui.emitLog(data.logs[1]);
  assert.equal(ui.elements.get('log').textContent, '[launcher] Started\n[stderr] complete diagnostic\n');
  await ui.click('save-activity-log');
  assert.deepEqual(ui.calls, ['saveActivityLog']);
  await ui.click('copy-activity-log');
  assert.deepEqual(ui.calls, ['saveActivityLog', 'copyActivityLog']);
  assert.equal(ui.elements.get('copy-log-result').textContent, 'Full session copied.');
  assert.equal(ui.elements.get('copy-activity-log').disabled, false);
});

test('Copy log reports failures in the activity panel and allows retry', async () => {
  const ui = await renderer(state(), new Error('clipboard unavailable'));
  await ui.click('copy-activity-log');
  assert.equal(ui.elements.get('copy-log-result').textContent, 'Could not copy log: clipboard unavailable');
  assert.equal(ui.elements.get('copy-activity-log').disabled, false);
});

test('the dock is always accessible, opens for tasks, and respects collapse until the next task', async () => {
  const ui = await renderer();
  assert.equal(ui.elements.get('console-body').hidden, true);
  await ui.click('toggle-activity-log');
  assert.equal(ui.elements.get('console-body').hidden, false);
  assert.equal(ui.elements.get('toggle-activity-log')['aria-expanded'], 'true');
  await ui.click('toggle-activity-log');
  const task = { label: 'Build Sunshine port', startedAt: Date.now(), canStop: true };
  await ui.emitActivity(task);
  assert.equal(ui.elements.get('console-body').hidden, false);
  assert.equal(ui.elements.get('console-state').textContent, 'Live');
  assert.equal(ui.elements.get('stop').hidden, false);
  await ui.click('toggle-activity-log');
  await ui.emitActivity({ ...task, detail: 'Compiling…' });
  assert.equal(ui.elements.get('console-body').hidden, true);
  await ui.emitActivity(null);
  await ui.emitActivity(task);
  assert.equal(ui.elements.get('console-body').hidden, false);
});

test('the dock opens for reported failures and expands without treating stderr as a crash', async () => {
  const ui = await renderer();
  await ui.emitLog({ id: 1, sequence: 1, stream: 'stderr', text: 'Could not find customStages.bin' });
  assert.equal(ui.elements.get('console-state').textContent, 'Idle');
  assert.equal(ui.elements.get('console-body').hidden, true);
  await ui.emitLog({ id: 2, sequence: 2, stream: 'launcher', text: '✕ Game exited with code 7.' });
  assert.equal(ui.elements.get('console-state').textContent, 'Error');
  assert.equal(ui.elements.get('console-body').hidden, false);
  await ui.click('expand-activity-log');
  assert.equal(ui.elements.get('activity-log').classList.contains('is-expanded'), true);
  assert.equal(ui.elements.get('expand-activity-log')['aria-label'], 'Restore activity log');
  await ui.click('toggle-activity-log');
  assert.equal(ui.elements.get('activity-log').classList.contains('is-expanded'), false);
  await ui.resetLog(3);
  assert.equal(ui.elements.get('console-state').textContent, 'Idle');
});

test('a fresh Play clears rendered history and ignores delayed output from the previous run', async () => {
  const data = state();
  const old = { id: 1, sequence: 1, stream: 'stderr', text: 'old error' };
  data.logs = [old];
  const ui = await renderer(data);
  await ui.click('copy-activity-log');
  await ui.resetLog(2);
  assert.equal(ui.elements.get('log').textContent, '');
  assert.equal(ui.elements.get('copy-log-result').textContent, '');
  await ui.emitLog(old);
  await ui.emitLog({ id: 2, sequence: 3, stream: 'stdout', text: 'new run' });
  assert.equal(ui.elements.get('log').textContent, '[stdout] new run\n');
});

test('usage sharing toggle shows the setting and is saved with the others', async () => {
  const data = state(); data.config.settings = port.normalizeSettings({ shareUsage: false });
  const ui = await renderer(data);
  assert.equal(ui.elements.get('shareUsage').checked, false);
  ui.elements.get('shareUsage').checked = true;
  ui.elements.get('shareUsage').dispatch('change');
  await new Promise(setImmediate);
  assert.equal(ui.calls.at(-1)[1].shareUsage, true);
});

test('the top bar shows the online count once the usage API answers', async () => {
  const data = state(), ui = await renderer(data);
  assert.equal(ui.elements.get('online-number').textContent, '');
  ui.listeners.online({ online: 1, playing: 0 });
  assert.equal(ui.elements.get('online-count').hidden, false);
  assert.equal(ui.elements.get('online-number').textContent, '1 online');
  assert.equal(ui.elements.get('online-count').title, '1 player has the launcher open · 0 playing now');
  data.online = { online: 42, playing: 7 };
  await ui.refresh();
  assert.equal(ui.elements.get('online-number').textContent, '42 online');
  assert.equal(ui.elements.get('online-count').title, '42 players have the launcher open · 7 playing now');
});
