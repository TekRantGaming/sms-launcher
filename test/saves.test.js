'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const saves = require('../src/saves');

test('save path follows the port defaults and explicit configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-save-path-'));
  try {
    assert.equal(saves.saveDirectory(root, { HOME: '/home/player' }, 'linux'),
      path.resolve('/home/player', '.local', 'share', 'sms-port', 'card-a'));
    assert.equal(saves.saveDirectory(root, { APPDATA: 'C:\\Users\\Player\\AppData\\Roaming' }, 'win32'),
      path.resolve('C:\\Users\\Player\\AppData\\Roaming', 'sms-port', 'card-a'));
    fs.writeFileSync(path.join(root, 'settings.txt'), 'save_dir = my-card\n');
    assert.equal(saves.saveDirectory(root, {}, 'linux'), path.join(root, 'my-card'));
    assert.equal(saves.saveDirectory(root, { SMS_SAVE_DIR: 'override' }, 'linux'), path.join(root, 'override'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cleanup refuses a custom memory card inside a removable build folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-save-clean-'));
  try {
    assert.equal(saves.cleanupWouldRemoveSaves(root, path.join(root, 'build', 'linux-64', 'card-a')), true);
    assert.equal(saves.cleanupWouldRemoveSaves(root, path.join(root, 'build32', 'card-a')), true);
    assert.equal(saves.cleanupWouldRemoveSaves(root, path.join(root, 'rom', 'card-a')), false);
    assert.equal(saves.cleanupWouldRemoveSaves(root, path.join(root, 'builds', 'card-a')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('verified backup restores old progress and preserves current files first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-save-backup-'));
  const card = path.join(root, 'card-a');
  const backups = path.join(root, 'backups');
  try {
    fs.mkdirSync(card);
    fs.writeFileSync(path.join(card, 'GMSE01.dat'), Buffer.from('first progress'));
    fs.writeFileSync(path.join(card, 'GMSE01.stat'), Buffer.from('metadata'));
    fs.writeFileSync(path.join(card, 'disc.iso'), Buffer.from('not a save'));
    const first = saves.backupSaves(card, backups, 'before-play');
    assert.equal(first.count, 2);
    assert.equal(fs.existsSync(path.join(first.directory, 'files', 'disc.iso')), false);
    fs.writeFileSync(path.join(card, 'GMSE01.dat'), Buffer.from('later progress'));
    const result = saves.restoreBackup(first.id, card, backups);
    assert.equal(fs.readFileSync(path.join(card, 'GMSE01.dat'), 'utf8'), 'first progress');
    assert.equal(result.restored, 2);
    assert.equal(fs.readFileSync(path.join(result.previous, 'files', 'GMSE01.dat'), 'utf8'), 'later progress');
    assert.equal(saves.listBackups(backups).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('corrupted backup does not replace current progress', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-save-corrupt-'));
  const card = path.join(root, 'card-a');
  const backups = path.join(root, 'backups');
  try {
    fs.mkdirSync(card);
    fs.writeFileSync(path.join(card, 'GMSE01.dat'), 'safe');
    const snapshot = saves.backupSaves(card, backups);
    fs.writeFileSync(path.join(snapshot.directory, 'files', 'GMSE01.dat'), 'tampered');
    assert.throws(() => saves.restoreBackup(snapshot.id, card, backups), /verification failed/i);
    assert.equal(fs.readFileSync(path.join(card, 'GMSE01.dat'), 'utf8'), 'safe');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
