'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function main(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-main-log-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = path.resolve(__dirname, '../src/main.js');
  const localRequire = createRequire(filename);
  const appEvents = {}, processEvents = {}, consoleEvents = {};
  const electron = { app: { requestSingleInstanceLock: () => true, on: (name, handler) => { appEvents[name] = handler; },
    whenReady: () => ({ then() {} }), getPath: () => root } };
  electron.BrowserWindow = class {
    webContents = { send() {}, setWindowOpenHandler() {}, on: (name, handler) => { consoleEvents[name] = handler; } };
    isDestroyed() { return false; }
    on() {}
    setMenuBarVisibility() {}
    loadFile() {}
  };
  const context = { require: id => id === 'electron' ? electron : localRequire(id),
    __dirname: path.dirname(filename),
    process: new Proxy(process, { get(target, key) {
      return key === 'on' ? (name, handler) => { processEvents[name] = handler; } : target[key];
    } }),
    setTimeout, setInterval, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') +
    '\nmodule.exports = { launch, capture, createWindow, activityLog, saveLog: file => sessionLog.save(file, [...partialOutput.values()]) };', context, { filename });
  return { ...context.module.exports, root, appEvents, processEvents, consoleEvents };
}

test('real launcher game failures preserve status without quoting warnings and can launch again', async t => {
  const runtime = main(t);
  await assert.rejects(runtime.launch(process.execPath, ['-e',
    "process.stderr.write('Could not find customStages.bin\\nDelay Context: 5');process.exitCode=7"], {}, 'Game', true),
    /^Error: Game exited with code 7\. See the activity log\.$/);
  assert.equal((await runtime.launch(process.execPath, ['-e', "process.stdout.write('ok')"], {}, 'Next')).ok, true);
  const entries = runtime.activityLog.snapshot();
  assert.ok(entries.some(entry => entry.stream === 'stderr' && entry.text === 'Delay Context: 5'));
  assert.ok(entries.some(entry => entry.stream === 'launcher' && entry.text === '✕ Game exited with code 7. See the activity log.'));
  const destination = path.join(runtime.root, 'saved.log');
  runtime.saveLog(destination);
  const saved = fs.readFileSync(destination, 'utf8');
  assert.match(saved, /\[stderr\] Could not find customStages.bin\n\[stderr\] Delay Context: 5\n/);
  assert.match(saved, /\[stdout\] ok\n\[launcher\] ✓ Next finished/);
});

test('the launcher logs captured commands and errors while preserving their returned stdout', async t => {
  const runtime = main(t);
  assert.equal(await runtime.capture(process.execPath, ['-e',
    "process.stdout.write('Café 🌞\\n');process.stderr.write('warning\\n')"]), 'Café 🌞');
  await assert.rejects(runtime.capture(process.execPath, ['-e',
    "process.stderr.write('fatal: real failure');process.exitCode=9"]), /code 9: fatal: real failure/);
  await assert.rejects(runtime.launch('/sms-launcher-missing-command', [], {}, 'Missing'), /ENOENT/);
  assert.equal((await runtime.launch(process.execPath, ['-e', ''], {}, 'Recovered')).ok, true);
  const entries = runtime.activityLog.snapshot();
  assert.ok(entries.some(entry => entry.stream === 'stdout' && entry.text === 'Café 🌞'));
  assert.ok(entries.some(entry => entry.stream === 'stderr' && entry.text === 'fatal: real failure'));
  assert.ok(entries.some(entry => entry.stream === 'launcher' && entry.text.includes('ENOENT')));
});

test('launcher exceptions, renderer errors and Electron process crashes are kept in the session log', t => {
  const runtime = main(t);
  runtime.createWindow();
  runtime.processEvents.uncaughtExceptionMonitor(new Error('launcher failed'));
  runtime.processEvents.warning(new Error('launcher warning'));
  runtime.consoleEvents['console-message']({ level: 'error', message: 'renderer failed', sourceId: 'renderer.js', lineNumber: 42 });
  runtime.appEvents['render-process-gone']({}, {}, { reason: 'crashed', exitCode: 9 });
  runtime.appEvents['child-process-gone']({}, { type: 'GPU', reason: 'oom', exitCode: 1 });
  const destination = path.join(runtime.root, 'saved.log');
  runtime.saveLog(destination);
  const saved = fs.readFileSync(destination, 'utf8');
  for (const expected of ['launcher failed', 'launcher warning', 'renderer failed (renderer.js:42)',
    'renderer crashed: Renderer exited with code 9', 'GPU process oom: GPU exited with code 1'])
    assert.ok(saved.includes(expected), expected);
});
