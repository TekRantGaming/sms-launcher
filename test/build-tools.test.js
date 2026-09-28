'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tar = require('tar');
const tools = require('../src/build-tools');
const x64Tools = { skip: process.arch !== 'x64' && 'Linux/Windows tool archives require an x64 host.' };

test('a corrupt tool archive preserves the existing tools', x64Tools, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-tools-test-'));
  try {
    const root = tools.rootFor(dir, 'linux');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'keep.txt'), 'existing tools');
    const archive = path.join(dir, 'tools.tar.gz');
    fs.writeFileSync(archive, 'corrupt archive');
    await assert.rejects(tools.prepare(dir, { platform: 'linux', forcePrivate: true,
      archiveFile: archive, source: { name: 'tools.tar.gz', sha256: '0'.repeat(64) } }), /SHA-256/);
    assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'existing tools');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed archive relocation restores the previous tools', x64Tools, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-tools-test-'));
  try {
    const root = tools.rootFor(dir, 'linux');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'keep.txt'), 'existing tools');
    const staging = path.join(dir, 'fixture');
    fs.mkdirSync(path.join(staging, 'env'), { recursive: true });
    fs.writeFileSync(path.join(staging, 'env', 'payload'), 'new tools');
    const archive = path.join(dir, 'tools.tar.gz');
    await tar.c({ gzip: true, file: archive, cwd: staging }, ['env']);
    await assert.rejects(tools.prepare(dir, { platform: 'linux', forcePrivate: true,
      archiveFile: archive, source: { name: 'tools.tar.gz', sha256: await tools.hashFile(archive) },
      run: async () => { throw new Error('relocation failed'); } }), /relocation failed/);
    assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'existing tools');
    assert.equal(fs.existsSync(path.join(root, 'env')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('matching legacy tools are reused, while changed archives get a separate root and leave old tools intact', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-tool-versions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const legacy = tools.legacyRootFor(dir, 'linux');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'ready.json'), JSON.stringify({ toolset: tools.toolsetFor('linux'), archiveSha256: tools.assetFor('linux').sha256 }));
  fs.writeFileSync(path.join(legacy, 'keep.txt'), 'libraries for my older game');
  assert.equal(tools.rootFor(dir, 'linux'), legacy);
  fs.writeFileSync(path.join(legacy, 'ready.json'), JSON.stringify({ toolset: 'older', archiveSha256: '0'.repeat(64) }));
  assert.notEqual(tools.rootFor(dir, 'linux'), legacy);
  assert.equal(fs.readFileSync(path.join(legacy, 'keep.txt'), 'utf8'), 'libraries for my older game');
});

test('fallback play can use a recorded older Windows toolset without downloading the current tools', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-old-tools-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'msys64'));
  const env = tools.environmentAtRoot(dir, { PATH: 'existing path', SMS_ARCH: '32' }, 'win32');
  assert.equal(env.MSYS2_ROOT, path.join(dir, 'msys64'));
  assert.equal(env.MSYSTEM, 'MINGW32');
  assert.ok(env.PATH.includes(path.join(dir, 'msys64', 'usr', 'bin')));
  const current = tools.environmentAtRoot(dir, { PATH: 'existing path', SMS_ARCH: '64' }, 'win32');
  assert.equal(current.MSYSTEM, 'MINGW64');
  assert.ok(current.PATH.startsWith(path.join(dir, 'msys64', 'mingw64', 'bin')));
  assert.equal(current.PATH.includes(path.join(dir, 'msys64', 'mingw32', 'bin')), false);
});
