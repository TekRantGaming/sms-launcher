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
  const settings = port.normalizeSettings({ eclipse: true, arch: '64' }, 'linux');
  assert.match(port.binaryPath('/port', settings, 'linux'), /linux-64-eclipse[\\/]sms$/);
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_DISC_IMAGE, '/my/disc.iso');
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_MOD, 'none');
  assert.equal(settings.fullscreen, false);
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_FULLSCREEN, '0');
  assert.equal(port.buildEnvironment(port.normalizeSettings({ fullscreen: true }), '/my/disc.iso', '/port').SMS_FULLSCREEN, '1');
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_TEXTURE_PACKS, '0');
  assert.equal(port.buildEnvironment({ ...settings, textures: true }, '/my/disc.iso', '/port').SMS_TEXTURE_PACKS,
    path.join('/port', 'mods', 'textures'));
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
  assert.equal(port.hdVisualsInstalled(root, port.normalizeSettings({ cutscenes: true, eclipse: true })), true);
  assert.equal(port.hdVisualsInstalled(root, port.normalizeSettings({})), true);
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
