'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const port = require('./port');
const tools = require('./build-tools');
const saves = require('./saves');
const release = require('./game-release.json');

function gitRevision(root) {
  try {
    let directory = path.join(root, '.git');
    if (fs.statSync(directory).isFile()) {
      const match = fs.readFileSync(directory, 'utf8').match(/^gitdir: (.+)\s*$/);
      if (!match) return null;
      let location = match[1];
      // MSYS Git can write absolute /c/... paths, while Electron uses native
      // Windows paths. Relative and native Git paths work without conversion.
      if (process.platform === 'win32') location = location.replace(/^\/([a-zA-Z])\//, '$1:/');
      directory = path.resolve(root, location);
    }
    const head = fs.readFileSync(path.join(directory, 'HEAD'), 'utf8').trim();
    if (/^[a-f0-9]{40}$/.test(head)) return head;
    const ref = head.match(/^ref: (refs\/.+)$/)?.[1];
    if (!ref || ref.includes('..')) return null;
    try { return fs.readFileSync(path.join(directory, ref), 'utf8').trim(); }
    catch (_) {
      return fs.readFileSync(path.join(directory, 'packed-refs'), 'utf8').split('\n')
        .find(line => line.endsWith(` ${ref}`))?.split(' ')[0] || null;
    }
  } catch (_) { return null; }
}

function identity(settings, platform = process.platform, arch = process.arch) {
  const asset = tools.assetFor(platform, arch);
  return { schema: 1, gameVersion: release.version, commit: release.commit, decomp: release.decomp,
    platform, hostArch: arch, gameArch: settings.arch, eclipse: Boolean(settings.eclipse),
    toolVersion: tools.toolsetFor(platform, arch), toolSha256: asset.sha256 };
}

function metadataPath(root, settings) {
  return path.join(path.dirname(port.binaryPath(root, settings)), 'launcher-build.json');
}

function installed(root, settings) {
  try { return JSON.parse(fs.readFileSync(metadataPath(root, settings), 'utf8')); }
  catch (_) { return null; }
}

function compilerToolRoot(root, settings) {
  try {
    const cache = fs.readFileSync(path.join(path.dirname(port.binaryPath(root, settings)), 'CMakeCache.txt'), 'utf8');
    const compiler = cache.match(/^CMAKE_CXX_COMPILER:[^=]*=(.+)$/m)?.[1].trim().replaceAll('\\', '/');
    return compiler?.match(/^(.*)\/(?:env\/bin|env\/targets\/linux32\/bin|msys64\/(?:mingw(?:32|64)|opt)\/bin)\/[^/]+$/)?.[1] || null;
  } catch (_) { return null; }
}

function isCurrent(root, settings) {
  if (!fs.existsSync(port.binaryPath(root, settings))) return false;
  const record = installed(root, settings);
  const expected = identity(settings);
  return Boolean(record && Object.keys(expected).every(key => record[key] === expected[key]) &&
    (!record.toolRoot || fs.existsSync(record.toolRoot)) &&
    gitRevision(root) === release.commit && gitRevision(path.join(root, 'decomp')) === release.decomp);
}

function snapshotPath(base, settings) {
  const expected = identity(settings);
  return path.join(`${base}.releases`, `${release.commit.slice(0, 12)}-${tools.platformId()}-${expected.toolSha256.slice(0, 12)}`);
}

async function checkout(root, { git = 'git', run, capture, env, source = release, reference } = {}) {
  fs.mkdirSync(path.dirname(root), { recursive: true });
  const temporary = `${root}.download-${crypto.randomUUID()}`;
  let promoted = false;
  try {
    const args = ['clone', '--config', 'core.longpaths=true', '--no-checkout', '--branch', source.branch];
    if (reference && fs.existsSync(path.join(reference, '.git')))
      args.push('--reference-if-able', reference, '--dissociate');
    args.push(source.repository, temporary);
    await run(git, args, { env }, 'Download port source');
    await run(git, ['fetch', 'origin', source.commit], { cwd: temporary, env }, 'Get game release');
    await run(git, ['checkout', '--detach', source.commit], { cwd: temporary, env }, 'Select game release');
    const actual = await capture(git, ['rev-parse', 'HEAD'], temporary, env);
    const tree = await capture(git, ['ls-tree', 'HEAD', 'decomp'], temporary, env);
    if (actual !== source.commit || !tree.startsWith(`160000 commit ${source.decomp}\t`))
      throw new Error('The downloaded game files did not match this release. Please retry.');
    // MSYS submodules may use absolute gitdir/worktree paths. Initialize them
    // after promotion so none of their paths refer to the temporary checkout.
    fs.renameSync(temporary, root);
    promoted = true;
    await run(git, ['-c', 'core.longpaths=true', 'submodule', 'update', '--init', '--recursive'], { cwd: root, env }, 'Prepare game release');
    const decomp = await capture(git, ['rev-parse', 'HEAD'], path.join(root, 'decomp'), env);
    if (decomp !== source.decomp || gitRevision(root) !== source.commit || gitRevision(path.join(root, 'decomp')) !== source.decomp)
      throw new Error('The downloaded game files did not match this release. Please retry.');
    fs.writeFileSync(path.join(root, 'launcher-source.json'), JSON.stringify(source, null, 2));
  } catch (error) {
    if (promoted) fs.rmSync(root, { recursive: true, force: true });
    throw error;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function carryUserFiles(previous, next) {
  if (previous === next) return;
  const settings = path.join(previous, 'settings.txt');
  if (fs.existsSync(settings)) fs.copyFileSync(settings, path.join(next, 'settings.txt'));
  for (const folder of ['textures', 'hd-cutscenes', 'eclipse']) {
    const origin = path.join(previous, 'mods', folder);
    const target = path.join(next, 'mods', folder);
    if (!fs.existsSync(origin) || fs.existsSync(target)) continue;
    // A Windows directory junction requires no administrator/developer mode.
    fs.symlinkSync(fs.realpathSync(origin), target, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

async function buildSafely(root, settings, saveDir, compile, backups = saves.backupRoot()) {
  const directory = path.dirname(port.binaryPath(root, settings));
  const previous = `${directory}.previous-${crypto.randomUUID()}`;
  const hadBuild = fs.existsSync(directory);
  const journal = `${directory}.launcher-transaction.json`;
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  if (hadBuild) fs.writeFileSync(journal, JSON.stringify({ directory, previous }), { flag: 'wx' });
  try {
    if (hadBuild) saves.moveBuildKeepingSaves(directory, previous, saveDir, backups);
    const result = await compile();
    if (!fs.existsSync(port.binaryPath(root, settings))) throw new Error('Setup finished without a playable game. Please retry.');
    if (gitRevision(root) !== release.commit || gitRevision(path.join(root, 'decomp')) !== release.decomp)
      throw new Error('Game files changed during setup. Please retry.');
    const record = { ...identity(settings), toolRoot: compilerToolRoot(root, settings), builtAt: new Date().toISOString() };
    const file = metadataPath(root, settings);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2));
    fs.renameSync(`${file}.tmp`, file);
    fs.rmSync(journal, { force: true });
    return result;
  } catch (error) {
    // Keep partial output for diagnosis; never delete a custom memory card.
    if (hadBuild && fs.existsSync(previous)) {
      if (fs.existsSync(directory)) fs.renameSync(directory, `${directory}.failed-${crypto.randomUUID()}`);
      fs.renameSync(previous, directory);
    }
    fs.rmSync(journal, { force: true });
    throw error;
  }
}

function recoverBuild(root, settings) {
  const directory = path.dirname(port.binaryPath(root, settings));
  const journal = `${directory}.launcher-transaction.json`;
  if (!fs.existsSync(journal)) return false;
  const record = JSON.parse(fs.readFileSync(journal, 'utf8'));
  if (record.directory !== directory || !record.previous?.startsWith(`${directory}.previous-`) ||
      path.dirname(record.previous) !== path.dirname(directory)) throw new Error('The recovery record is invalid.');
  if (fs.existsSync(record.previous)) {
    if (fs.existsSync(directory)) fs.renameSync(directory, `${directory}.interrupted-${crypto.randomUUID()}`);
    fs.renameSync(record.previous, directory);
  }
  fs.rmSync(journal, { force: true });
  return true;
}

module.exports = { release, gitRevision, identity, installed, compilerToolRoot, isCurrent, snapshotPath, checkout, carryUserFiles, buildSafely, recoverBuild };
