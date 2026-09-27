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
  assert.deepEqual(port.platformInfo('win32').arches, ['32']);
  const windows = port.normalizeSettings({ arch: '64' }, 'win32');
  assert.equal(windows.arch, '32');
  const settings = port.normalizeSettings({ eclipse: true, arch: '64' }, 'linux');
  assert.match(port.binaryPath('/port', settings, 'linux'), /linux-64-eclipse[\\/]sms$/);
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_DISC_IMAGE, '/my/disc.iso');
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_MOD, 'none');
  assert.equal(port.buildEnvironment(settings, '/my/disc.iso', '/port').SMS_TEXTURE_PACKS, '0');
  assert.equal(port.buildEnvironment({ ...settings, textures: true }, '/my/disc.iso', '/port').SMS_TEXTURE_PACKS,
    path.join('/port', 'mods', 'textures'));
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
    assert.deepEqual(port.commandFor(dir, 'textures', [], 'linux').args, ['tools/mods/get.py', 'textures']);
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
    for (const name of ['git', 'cmake']) {
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
    assert.match(cmd.env.PATH, /mingw32/);
    const textures = port.commandFor('C:\\port', 'textures', [], 'win32', { PATH: 'C:\\Windows', MSYS2_ROOT: dir });
    assert.match(textures.args[1], /get\.py textures/);
    assert.equal(textures.args.at(-1), 'C:\\port');
  } finally {
    if (old === undefined) delete process.env.MSYS2_ROOT;
    else process.env.MSYS2_ROOT = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
