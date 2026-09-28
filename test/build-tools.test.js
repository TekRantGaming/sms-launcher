'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tar = require('tar');
const tools = require('../src/build-tools');

test('a corrupt tool archive preserves the existing tools', async () => {
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

test('failed archive relocation restores the previous tools', async () => {
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
