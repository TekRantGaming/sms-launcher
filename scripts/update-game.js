'use strict';

// Maintainer command: select a complete port revision, then bump the launcher
// so its release gate verifies exactly the source users will receive.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const current = require('../src/game-release.json');
const ref = process.argv[2] || `origin/${current.branch}`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-game-release-'));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
try {
  git(['clone', '--filter=blob:none', '--no-checkout', '--branch', current.branch, current.repository, '.']);
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  const decomp = git(['ls-tree', commit, 'decomp']).match(/^160000 commit ([a-f0-9]{40})\tdecomp$/)?.[1];
  if (!decomp) throw new Error('This port revision does not pin its decomp submodule.');
  if (commit === current.commit && decomp === current.decomp) {
    console.log('This game revision is already selected. No release bump needed.');
  } else {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '.');
    const number = current.version.startsWith(`${date}.`) ? Number(current.version.split('.').at(-1)) + 1 : 1;
    const next = { ...current, version: `${date}.${number}`, commit, decomp };
    fs.writeFileSync(path.join(__dirname, '..', 'src', 'game-release.json'), `${JSON.stringify(next, null, 2)}\n`);
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['version', 'patch', '--no-git-tag-version'],
      { cwd: path.join(__dirname, '..'), stdio: 'inherit', shell: process.platform === 'win32' });
    console.log(`Selected game ${next.version}: ${commit} (decomp ${decomp}). Commit and push to run the release checks.`);
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
