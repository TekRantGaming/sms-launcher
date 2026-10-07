'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const port = require('../src/port');

function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sms-launcher-test-')); }
function header() {
  const bytes = Buffer.alloc(0x20);
  bytes.write('GMSE01', 0, 'ascii');
  bytes[7] = 0;
  bytes.writeUInt32BE(0xc2339f3d, 0x1c);
  return bytes;
}

test('frame rate defaults to 60, migrates the old toggle, and passes all three rates to the game', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    assert.equal(port.normalizeSettings({}, platform).frameRate, 60);
    assert.equal(port.normalizeSettings({ fps60: true }, platform).frameRate, 60);
    assert.equal(port.normalizeSettings({ fps60: false }, platform).frameRate, 30);
    for (const frameRate of [30, 60, 120]) {
      const settings = port.normalizeSettings({ frameRate: String(frameRate), fps60: false }, platform);
      assert.equal(settings.frameRate, frameRate);
      assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_FRAME_RATE, String(frameRate));
      assert.equal(port.normalizeSettings(JSON.parse(JSON.stringify(settings)), platform).frameRate, frameRate);
    }
    for (const frameRate of [0, 90, 144, '120fps', null])
      assert.equal(port.normalizeSettings({ frameRate }, platform).frameRate, 60);
  }
  assert.equal(port.buildEnvironment({ fps60: false }, '/my/disc.iso', '/port').SMS_FRAME_RATE, '30');
});

test('requires an owned GMSE01 Rev 0 image and supports plain and CISO headers', () => {
  const dir = temporary();
  try {
    const iso = path.join(dir, 'my disc.iso');
    fs.writeFileSync(iso, header());
    assert.equal(port.validateRom(iso), iso);
    const ciso = path.join(dir, 'my disc.ciso');
    const bytes = Buffer.alloc(0x8000 + 0x20);
    bytes.write('CISO'); bytes.writeUInt32LE(0x8000, 4); bytes[8] = 1;
    header().copy(bytes, 0x8000);
    fs.writeFileSync(ciso, bytes);
    assert.equal(port.validateRom(ciso), ciso);
    bytes.write('GMSE04', 0x8000, 'ascii');
    fs.writeFileSync(ciso, bytes);
    assert.throws(() => port.validateRom(ciso), /GMSE01/);
    assert.throws(() => port.validateRom(''), /Choose your own/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('offers only platform-supported architectures and keeps builds separate', () => {
  assert.deepEqual(port.platformInfo('linux').arches, ['64', '32']);
  assert.deepEqual(port.platformInfo('darwin').arches, ['64']);
  assert.deepEqual(port.platformInfo('win32').arches, ['64', '32']);
  const windows = port.normalizeSettings({ arch: '64' }, 'win32');
  assert.equal(windows.arch, '64');
  assert.equal(port.normalizeSettings({ arch: '32' }, 'win32').arch, '32');
  assert.equal(port.normalizeSettings({ arch: '32' }, 'linux').arch, '32');
  assert.match(port.binaryPath('/port', windows, 'win32'), /windows-64[\\/]sms.exe$/);
  const settings = port.normalizeSettings({ eclipse: true, arch: '64', textures: false }, 'linux');
  assert.match(port.binaryPath('/port', settings, 'linux'), /linux-64-eclipse[\\/]sms$/);
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_DISC_IMAGE, '/my/disc.iso');
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_MOD, 'none');
  assert.equal(settings.fullscreen, false);
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_FULLSCREEN, '0');
  assert.equal(port.buildEnvironment(port.normalizeSettings({ fullscreen: true }), '/my/disc.iso', '/port').SMS_FULLSCREEN, '1');
  assert.equal(settings.invertCameraX, true);
  assert.equal(settings.invertCameraY, false);
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_CAMERA_INVERT_X, '1');
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_CAMERA_INVERT_Y, '0');
  const inverted = port.normalizeSettings({ invertCameraX: false, invertCameraY: true });
  assert.equal(port.buildEnvironment(inverted, '/my/disc.iso', '/port').SMS_CAMERA_INVERT_X, '0');
  assert.equal(port.buildEnvironment(inverted, '/my/disc.iso', '/port').SMS_CAMERA_INVERT_Y, '1');
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_TEXTURE_PACKS, '0');
  assert.equal(port.buildEnvironment({ ...settings, textures: true }, '/my/disc.iso', '/port').SMS_TEXTURE_PACKS,
    path.join('/port', 'mods', 'textures'));
});

test('master volume defaults to full, is clamped to 0-100, and reaches the game as SMS_VOLUME', () => {
  assert.equal(port.normalizeSettings({}).volume, 100);
  assert.equal(port.normalizeSettings({ volume: 40 }).volume, 40);
  assert.equal(port.normalizeSettings({ volume: '65' }).volume, 65);
  assert.equal(port.normalizeSettings({ volume: 150 }).volume, 100);
  assert.equal(port.normalizeSettings({ volume: -5 }).volume, 0);
  assert.equal(port.normalizeSettings({ volume: 'loud' }).volume, 100);
  assert.equal(port.normalizeSettings({ volume: null }).volume, 100);
  assert.equal(port.buildEnvironment(port.normalizeSettings({}), '/my/disc.iso', '/port').SMS_VOLUME, '100');
  assert.equal(port.buildEnvironment(port.normalizeSettings({ volume: 0 }), '/my/disc.iso', '/port').SMS_VOLUME, '0');
});

test('settings keep only changed, known key bindings', () => {
  assert.deepEqual(port.normalizeSettings({}).keyBindings, {});
  const settings = port.normalizeSettings({ keyBindings: { A: ['J'], B: ['LSHIFT', 'RSHIFT', 'C'], R: ['NOPE', 'K', 'K'], JUMP: ['A'] } });
  assert.deepEqual(settings.keyBindings, { A: ['J'], R: ['K'] });
});

test('new settings default to the game as it was, so updating changes nothing until chosen', () => {
  const s = port.normalizeSettings({});
  assert.deepEqual([s.freeCamera, s.cameraSpeed, s.mouseCamera, s.mouseSensitivity], [false, 100, false, 100]);
  assert.deepEqual([s.fullscreenMode, s.exclusiveResolution, s.display, s.vsync, s.skipMovies, s.overlay],
    ['desktop', 'desktop', 'launcher', 'off', false, false]);
  assert.deepEqual([s.msaa, s.fxaa, s.anisotropic, s.sharpen, s.brightness, s.aspect, s.presentFilter],
    [0, false, 0, 0, 100, 'keep', 'bilinear']);
  const env = port.buildEnvironment(s, '/my/disc.iso', '/port');
  assert.deepEqual([env.SMS_FREE_CAMERA, env.SMS_CAMERA_SPEED, env.SMS_MOUSE_CAMERA, env.SMS_MOUSE_SENSITIVITY], ['0', '100', '0', '100']);
  assert.deepEqual([env.SMS_FULLSCREEN, env.SMS_VSYNC, env.SMS_SKIP_MOVIES, env.SMS_OVERLAY], ['0', '0', '0', '0']);
  assert.deepEqual([env.SMS_MSAA, env.SMS_FXAA, env.SMS_ANISO, env.SMS_SHARPEN, env.SMS_GAMMA, env.SMS_ASPECT, env.SMS_PRESENT_FILTER],
    ['0', '0', '0', '0', '1.00', 'keep', 'bilinear']);
  for (const key of ['SMS_FULLSCREEN_MODE', 'SMS_DISPLAY']) assert.equal(env[key], undefined, key);
});

test('chosen settings reach the game as its environment variables', () => {
  const env = port.buildEnvironment(port.normalizeSettings({
    freeCamera: true, cameraSpeed: '150', mouseCamera: true, mouseSensitivity: 250,
    fullscreen: true, fullscreenMode: 'exclusive', exclusiveResolution: '1920x1080', display: 'primary', vsync: 'adaptive',
    skipMovies: true, overlay: true, msaa: 4, fxaa: true, anisotropic: '16', sharpen: 40, brightness: 115,
    aspect: 'integer', presentFilter: 'sharp'
  }), '/my/disc.iso', '/port');
  assert.deepEqual([env.SMS_FREE_CAMERA, env.SMS_CAMERA_SPEED, env.SMS_MOUSE_CAMERA, env.SMS_MOUSE_SENSITIVITY], ['1', '150', '1', '250']);
  assert.deepEqual([env.SMS_FULLSCREEN, env.SMS_FULLSCREEN_MODE, env.SMS_DISPLAY, env.SMS_VSYNC], ['exclusive', '1920x1080', '0', 'adaptive']);
  assert.deepEqual([env.SMS_SKIP_MOVIES, env.SMS_OVERLAY], ['1', '1']);
  assert.deepEqual([env.SMS_MSAA, env.SMS_FXAA, env.SMS_ANISO, env.SMS_SHARPEN, env.SMS_GAMMA, env.SMS_ASPECT, env.SMS_PRESENT_FILTER],
    ['4', '1', '16', '40', '1.15', 'integer', 'sharp']);
  // borderless keeps today's value, and windowed never sends a display mode
  assert.equal(port.buildEnvironment(port.normalizeSettings({ fullscreen: true }), '/d', '/port').SMS_FULLSCREEN, '1');
  assert.equal(port.buildEnvironment(port.normalizeSettings({ fullscreenMode: 'exclusive', exclusiveResolution: '1920x1080' }), '/d', '/port').SMS_FULLSCREEN_MODE, undefined);
});

test('saved values outside what the game accepts fall back or are clamped', () => {
  const s = port.normalizeSettings({ cameraSpeed: 9000, mouseSensitivity: 'fast', msaa: 3, anisotropic: 5, sharpen: -4,
    brightness: 900, aspect: 'wide', presentFilter: 'cubic', vsync: 'sometimes', fullscreenMode: 'window',
    exclusiveResolution: '1920x1080; rm', display: 2 });
  assert.deepEqual([s.cameraSpeed, s.mouseSensitivity, s.msaa, s.anisotropic, s.sharpen, s.brightness], [400, 100, 0, 0, 0, 200]);
  assert.deepEqual([s.aspect, s.presentFilter, s.vsync, s.fullscreenMode, s.exclusiveResolution, s.display],
    ['keep', 'bilinear', 'off', 'desktop', 'desktop', 'launcher']);
});

test('Windows upgrade keeps the existing 32-bit game available with its original settings and tools', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saved = { repo: root, rom: 'own-disc.iso', settings: { arch: '32', textures: true }, saveDirectory: 'my-saves' };
  assert.equal(port.playableInstall(saved, 'win32'), null);
  const binary = port.binaryPath(root, saved.settings, 'win32');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'previous 32-bit game');
  const previous = port.playableInstall(saved, 'win32');
  assert.equal(previous.settings.arch, '32');
  assert.equal(previous.settings.textures, true);
  assert.equal(previous.saveDirectory, saved.saveDirectory);
  assert.equal(fs.readFileSync(binary, 'utf8'), 'previous 32-bit game');
  const msys = path.join(root, 'tools');
  fs.mkdirSync(path.join(msys, 'usr', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(msys, 'usr', 'bin', 'bash.exe'), '');
  const cmd = port.commandFor(root, 'run', [saved.rom], 'win32', { SMS_ARCH: previous.settings.arch, MSYS2_ROOT: msys });
  assert.equal(cmd.env.MSYSTEM, 'MINGW32');
  assert.ok(cmd.env.PATH.startsWith(path.join(msys, 'mingw32', 'bin')));
  assert.equal(port.playableInstall({ ...saved, settings: { arch: '64' } }, 'win32'), null);
  assert.equal(port.normalizeSettings({ arch: '32' }, 'darwin').arch, '64');
  assert.equal(port.normalizeSettings({}, 'win32').arch, '64');
  const x64 = port.binaryPath(root, { arch: '64' }, 'win32');
  fs.mkdirSync(path.dirname(x64), { recursive: true });
  fs.writeFileSync(x64, 'previous 64-bit game');
  assert.equal(port.playableInstall({ ...saved, settings: { arch: '64' } }, 'win32').settings.arch, '64');
});

test('recognizes an installed texture pack and points the game at its folder', () => {
  const dir = temporary();
  try {
    assert.equal(port.texturePackInstalled(dir), false);
    const textures = port.texturePackDirectory(dir);
    fs.mkdirSync(path.join(textures, 'GMS', 'stage'), { recursive: true });
    fs.writeFileSync(path.join(textures, 'GMS', 'stage', 'tex1_abcdef.dds'), 'texture');
    assert.equal(port.texturePackInstalled(dir), true);
    const settings = port.normalizeSettings({ textures: true });
    assert.equal(port.buildEnvironment(settings, '/my/disc.iso', dir).SMS_TEXTURE_PACKS, textures);
    const progressScript = path.resolve(__dirname, '..', 'scripts', 'texture-progress.py');
    for (const platform of ['linux', 'darwin'])
      assert.deepEqual(port.commandFor(dir, 'textures', [], platform).args,
        [progressScript, path.join(dir, 'tools', 'mods', 'get.py')]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Eclipse builder uses its own CMake tree without bundling the patched disc', () => {
  if (process.platform !== 'linux') return;
  const dir = temporary();
  try {
    const repo = path.join(dir, 'port');
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(path.join(repo, 'cmake'), { recursive: true });
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(repo, 'cmake', 'eclipse.cmake'), '');
    for (const name of ['git', 'cmake', 'clang', 'clang++']) {
      const file = path.join(bin, name);
      fs.writeFileSync(file, '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$CALL_LOG"\n');
      fs.chmodSync(file, 0o755);
    }
    const callLog = path.join(dir, 'calls.txt');
    const result = spawnSync(path.join(__dirname, '..', 'scripts', 'build-eclipse.sh'), [repo, '64'], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: callLog }, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(callLog, 'utf8');
    assert.match(calls, /-DSMS_ECLIPSE=ON/);
    assert.match(calls, /-DSMS_BUNDLE_DISC=/);
    assert.match(calls, /build\/linux-64-eclipse/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Eclipse builder explains a missing clang before configuring', () => {
  if (process.platform !== 'linux') return;
  const dir = temporary();
  try {
    const repo = path.join(dir, 'port');
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(path.join(repo, 'cmake'), { recursive: true });
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(repo, 'cmake', 'eclipse.cmake'), '');
    fs.symlinkSync(spawnSync('sh', ['-c', 'command -v uname'], { encoding: 'utf8' }).stdout.trim(), path.join(bin, 'uname'));
    const result = spawnSync('/bin/bash', [path.join(__dirname, '..', 'scripts', 'build-eclipse.sh'), repo, '64'], {
      env: { PATH: bin }, encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Eclipse needs clang and clang\+\+/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Windows command passes an image path as data to MSYS2 Bash', () => {
  const dir = temporary();
  const old = process.env.MSYS2_ROOT;
  try {
    fs.mkdirSync(path.join(dir, 'usr', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'usr', 'bin', 'bash.exe'), '');
    process.env.MSYS2_ROOT = dir;
    const rom = 'C:\\Games\\Sunshine (own copy).iso';
    const cmd = port.commandFor('C:\\port', 'build', [rom], 'win32', { PATH: 'C:\\Windows', MSYS2_ROOT: dir });
    assert.equal(cmd.args.at(-1), rom);
    assert.doesNotMatch(cmd.args[1], /Sunshine/);
    assert.match(cmd.env.PATH, /mingw64/);
    const textures = port.commandFor('C:\\port', 'textures', [], 'win32', { PATH: 'C:\\Windows', MSYS2_ROOT: dir });
    assert.match(textures.args[1], /python "\$\(cygpath -u "\$2"\)" tools\/mods\/get\.py/);
    assert.equal(textures.args[3], 'C:\\port');
    assert.equal(textures.args[4], path.resolve(__dirname, '..', 'scripts', 'texture-progress.py'));
  } finally {
    if (old === undefined) delete process.env.MSYS2_ROOT;
    else process.env.MSYS2_ROOT = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('HD movies have their own setting and only complete packs are recognized', t => {
  const root = temporary();t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = port.cutscenePackDirectory(root);
  const movies = Array.from({ length: 21 }, (_, i) => ({ disc_path: `data/movie${i}.thp`, target_bytes: 8 }));
  const catalog = { schema: 1, release: 'test-v1', movies };
  fs.mkdirSync(path.join(root, 'tools', 'media'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'media', 'cutscene-release.json'), JSON.stringify(catalog));
  fs.mkdirSync(path.join(folder, 'files', 'data'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'installed.json'), JSON.stringify(catalog));
  assert.equal(port.cutscenePackInstalled(root), false);
  // An older preferences.json with HD textures on but no movie pack: movies stay off.
  assert.equal(port.savedSettings({ textures: true }, root).cutscenes, false);
  fs.writeFileSync(path.join(folder, 'sms-hd-cutscenes-v1.complete'), 'test-v1\n');
  for (const movie of movies) fs.writeFileSync(path.join(folder, 'files', movie.disc_path), 'HD movie');
  assert.equal(port.cutscenePackInstalled(root), true);
  // ...and with the pack already set up, they stay on.
  assert.equal(port.savedSettings({ textures: true }, root).cutscenes, true);
  assert.equal(port.savedSettings({ textures: true, cutscenes: false }, root).cutscenes, false);
  assert.equal(port.savedSettings({ textures: false }, root).cutscenes, false);
  assert.deepEqual(port.savedSettings(undefined, root), { textures: true });
  assert.equal(port.normalizeSettings({ textures: true }).cutscenes, false);
  assert.equal(port.hdVisualsInstalled(root, port.normalizeSettings({ textures: true, cutscenes: true })), false);
  fs.writeFileSync(path.join(folder, 'files', movies[20].disc_path), 'damaged');
  assert.equal(port.cutscenePackInstalled(root), false);
  assert.equal(port.hdVisualsInstalled(root, port.normalizeSettings({ textures: false, cutscenes: true })), true);
  assert.equal(port.hdVisualsInstalled(root, port.normalizeSettings({ textures: false, cutscenes: true, eclipse: true })), true);
  assert.equal(port.hdVisualsInstalled(root, port.normalizeSettings({})), false);
  const settings = port.normalizeSettings({ textures: true, cutscenes: true, eclipse: false });
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', root).SMS_HD_CUTSCENES, folder);
  // The game plays HD movies only with HD textures on, so none are set up or passed without them.
  assert.equal(port.buildEnvironment({ ...settings, textures: false }, '/my/disc.iso', root).SMS_HD_CUTSCENES, '0');
  assert.equal(port.buildEnvironment({ ...settings, cutscenes: false, textures: true }, '/my/disc.iso', root).SMS_HD_CUTSCENES, '0');
  assert.equal(port.buildEnvironment({ ...settings, eclipse: true }, '/my/disc.iso', root).SMS_HD_CUTSCENES, '0');
  for (const platform of ['linux', 'darwin']) assert.deepEqual(port.commandFor(root, 'cutscenes', ['/my/disc.iso'], platform).args,
    ['tools/media/install_cutscenes.py', '--iso', '/my/disc.iso']);
  const msys = path.join(root, 'MSYS2');fs.mkdirSync(path.join(msys, 'usr', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(msys, 'usr', 'bin', 'bash.exe'), '');
  const cmd = port.commandFor(root, 'cutscenes', ['C:\\own game.iso'], 'win32', { MSYS2_ROOT: msys });
  assert.match(cmd.args[1], /install_cutscenes.py --iso/);
  assert.equal(cmd.args.at(-1), 'C:\\own game.iso');
});


test('older installed games remain playable with HD cutscenes on until updated', t => {
  const root = temporary(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const settings = port.normalizeSettings({ textures: true, cutscenes: true, eclipse: false, autoUpdate: false });
  const textures = port.texturePackDirectory(root);
  fs.mkdirSync(textures, { recursive: true });
  fs.writeFileSync(path.join(textures, 'tex1_existing.png'), 'texture');
  assert.equal(port.cutscenePackSupported(root), false);
  assert.equal(port.hdVisualsInstalled(root, settings), true);
  const media = path.join(root, 'tools', 'media'); fs.mkdirSync(media, { recursive: true });
  fs.writeFileSync(path.join(media, 'install_cutscenes.py'), 'installer');
  assert.equal(port.cutscenePackSupported(root), true);
  assert.equal(port.hdVisualsInstalled(root, settings), false);
  assert.equal(port.hdVisualsInstalled(root, { ...settings, eclipse: true }), true);
});

test('settings keep only changed, known controller buttons', () => {
  assert.deepEqual(port.normalizeSettings({}).padBindings, {});
  assert.deepEqual(port.normalizeSettings({ padBindings: { A: ['PAD_Y'], B: ['PAD_B'], JUMP: ['PAD_A'], X: ['NOPE'] } }).padBindings,
    { A: ['PAD_Y'] });
});
