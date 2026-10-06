'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const port = require('../src/port');

function fixture(t, { metadata = true, textures = false, eclipse = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sms installed game-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'port');
  const settings = port.normalizeSettings({ textures: true, cutscenes: true, autoUpdate: true, eclipse });
  for (const file of ['CMakeLists.txt', 'build.sh', 'run.sh', 'clean.sh', 'tools/mods/get.py']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'installed source');
  }
  const binary = port.binaryPath(root, settings);
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'installed executable');
  const toolRoot = path.join(directory, 'old private tools');
  fs.mkdirSync(path.join(toolRoot, 'msys64', 'usr', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(toolRoot, 'msys64', 'usr', 'bin', 'bash.exe'), 'runtime');
  const record = path.join(path.dirname(binary), 'launcher-build.json');
  if (metadata) fs.writeFileSync(record, JSON.stringify({ gameVersion: 'older', toolRoot }));
  const rom = path.join(directory, 'own.iso');
  const header = Buffer.alloc(32);
  header.write('GMSE01'); header.writeUInt32BE(0xc2339f3d, 28);
  fs.writeFileSync(rom, header);
  if (eclipse) {
    fs.mkdirSync(path.dirname(path.join(root, port.ECLIPSE_ISO)), { recursive: true });
    fs.writeFileSync(path.join(root, port.ECLIPSE_ISO), 'already patched disc');
  }
  if (textures) {
    fs.mkdirSync(port.texturePackDirectory(root), { recursive: true });
    fs.writeFileSync(path.join(port.texturePackDirectory(root), 'tex1_fixture.png'), 'installed texture');
  }
  const config = { repo: root, rom, settings, completedSetup: true, saveDirectory: path.join(directory, 'saves') };
  const starts = [], backups = [], handlers = new Map(), environments = [];
  const sourcePath = path.resolve(__dirname, '../src/main.js');
  const nativeRequire = createRequire(sourcePath);
  const context = vm.createContext({ console, process, Buffer, setTimeout, setInterval, __dirname: path.dirname(sourcePath),
    require(name) {
      if (name === 'electron') return {
        app: { requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on() {}, getPath: () => directory },
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, BrowserWindow: {} };
      if (name === './build-tools') return {
        environmentAtRoot(selected, env) {
          environments.push(selected);
          return { ...env, MSYS2_ROOT: path.join(selected, 'msys64') };
        },
        environment(_userData, env) { return { ...env, MSYS2_ROOT: path.join(toolRoot, 'msys64') }; },
        async ensure() { throw new Error('Playing must not prepare new tools'); },
        async check() { throw new Error('Playing must not prepare new tools'); } };
      if (name === './saves') return {
        backupRoot: () => path.join(directory, 'backups'),
        backupSaves(_saves, _backups, reason) { backups.push(reason); return { empty: true, message: 'No saves yet' }; },
        prepareSaveDirectory: dir => dir.replaceAll('\\', '/') };
      if (name === 'node:child_process') return { spawn(command, args, options) {
        starts.push({ command, args, options });
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        setImmediate(() => child.emit('close', 0));
        return child;
      } };
      return nativeRequire(name);
    }, fixtureConfig: config });
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8') + '\nconfig = fixtureConfig; registerHandlers();', context);
  return { config, starts, backups, environments, binary, record, toolRoot, root, play: () => handlers.get('play')() };
}

test('skip update launches the older installed game, keeps preferences and saves, and never builds or downloads', async t => {
  const f = fixture(t);
  const before = JSON.stringify(f.config), recordBefore = fs.readFileSync(f.record, 'utf8');
  await f.play();
  assert.equal(f.starts.length, 1);
  const { command, options } = f.starts[0];
  assert.ok(command.endsWith(process.platform === 'win32' ? 'bash.exe' : 'run.sh'));
  assert.equal(options.cwd, f.root);
  assert.equal(options.env.SMS_TEXTURE_PACKS, '0');
  assert.equal(options.env.SMS_HD_CUTSCENES, '0');
  assert.equal(options.env.SMS_SAVE_DIR, f.config.saveDirectory.replaceAll('\\', '/'));
  assert.deepEqual(f.environments, [f.toolRoot]);
  assert.deepEqual(f.backups, ['before-play', 'after-play']);
  assert.equal(JSON.stringify(f.config), before);
  assert.equal(fs.readFileSync(f.binary, 'utf8'), 'installed executable');
  assert.equal(fs.readFileSync(f.record, 'utf8'), recordBefore);
});

test('skip update supports legacy installs and keeps already installed textures enabled', async t => {
  const f = fixture(t, { metadata: false, textures: true });
  await f.play();
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].options.env.SMS_TEXTURE_PACKS, port.texturePackDirectory(f.root));
  assert.equal(f.starts[0].options.env.SMS_HD_CUTSCENES, '0');
  assert.equal(fs.existsSync(f.record), false);
  assert.equal(f.config.settings.autoUpdate, true);
});

test('skip update starts the installed Eclipse executable with the existing patched disc', async t => {
  const f = fixture(t, { eclipse: true });
  await f.play();
  assert.equal(f.starts.length, 1);
  const start = f.starts[0];
  assert.ok(start.command === f.binary || start.args.includes(f.binary));
  assert.ok(start.args.includes(path.join(f.root, port.ECLIPSE_ISO)));
});

test('skip update cannot start a missing executable or invalid disc', async t => {
  const f = fixture(t);
  fs.rmSync(f.binary);
  await assert.rejects(f.play(), /Set up this version/);
  fs.writeFileSync(f.binary, 'installed executable');
  fs.writeFileSync(f.config.rom, 'bad disc');
  await assert.rejects(f.play(), /too small/);
  assert.equal(f.starts.length, 0);
});
