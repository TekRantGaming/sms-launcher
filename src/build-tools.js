'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const assets = require('./tool-assets.json');
const TOOLSET = assets.toolset;

function rootFor(userData, platform = process.platform) {
  return path.join(userData, 'build-tools', platform === 'win32' ? 'windows-x64' : 'linux-x64');
}

function privateReady(userData, platform = process.platform) {
  if (platform === 'darwin') return false;
  const root = rootFor(userData, platform);
  const marker = path.join(root, 'ready.json');
  try {
    const installed = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (installed.toolset !== TOOLSET) return false;
    const expected = assets.platforms[platform];
    if (expected && installed.archiveSha256 !== expected.sha256) return false;
    return platform === 'win32'
      ? fs.existsSync(path.join(root, 'msys64', 'usr', 'bin', 'bash.exe')) &&
        fs.existsSync(path.join(root, 'msys64', 'mingw32', 'bin', 'g++.exe')) &&
        fs.existsSync(path.join(root, 'msys64', 'mingw32', 'include', 'SDL2', 'SDL.h'))
      : ['g++', 'git', 'cmake', 'python3', 'make', 'patch', 'objcopy', '7z']
        .every(name => fs.existsSync(path.join(root, 'env', 'bin', name))) &&
        fs.existsSync(path.join(root, 'env', 'lib', 'libSDL2-2.0.so.0'));
  } catch (_) { return false; }
}

function commandWorks(command, args = [], env = process.env) {
  const result = spawnSync(command, args, { env, windowsHide: true, timeout: 15000, stdio: 'ignore' });
  return result.status === 0;
}

function systemReady(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return true; // Keep macOS's existing Apple toolchain path.
  if (platform === 'linux') {
    const commands = ['git', 'cmake', 'make', 'patch', 'python3', 'objcopy', 'g++'];
    return commands.every(command => commandWorks(command, ['--version'], env)) &&
      commandWorks('7z', ['-h'], env) &&
      commandWorks('pkg-config', ['--exists', 'sdl2', 'egl', 'gl'], env);
  }
  if (platform === 'win32') {
    const root = env.MSYS2_ROOT || 'C:\\msys64';
    return ['usr/bin/bash.exe', 'usr/bin/git.exe', 'usr/bin/patch.exe',
      'mingw32/bin/g++.exe', 'mingw32/bin/cmake.exe', 'mingw32/bin/ninja.exe',
      'mingw32/bin/python.exe', 'mingw32/include/SDL2/SDL.h',
      'mingw32/lib/libSDL2.dll.a'].every(file => fs.existsSync(path.join(root, file))) &&
      (fs.existsSync(path.join(root, 'mingw64', 'bin', '7z.exe')) || commandWorks('7z', ['-h'], env));
  }
  return false;
}

function status(userData, platform = process.platform, env = process.env) {
  if (privateReady(userData, platform)) return { ready: true, mode: 'private' };
  if (platform === 'darwin' && systemReady(platform, env)) return { ready: true, mode: 'system' };
  return { ready: false, mode: 'missing' };
}

function environment(userData, base = process.env, platform = process.platform) {
  if (!privateReady(userData, platform)) return { ...base };
  const root = rootFor(userData, platform);
  if (platform === 'linux') {
    const prefix = path.join(root, 'env');
    const bin = path.join(prefix, 'bin');
    return {
      ...base, PATH: [bin, base.PATH || ''].join(path.delimiter),
      CC: path.join(bin, 'gcc'), CXX: path.join(bin, 'g++'),
      CMAKE_PREFIX_PATH: [prefix, base.CMAKE_PREFIX_PATH || ''].filter(Boolean).join(path.delimiter),
      PKG_CONFIG_PATH: [path.join(prefix, 'lib', 'pkgconfig'), base.PKG_CONFIG_PATH || ''].filter(Boolean).join(path.delimiter)
    };
  }
  const msys = path.join(root, 'msys64');
  return { ...base, MSYS2_ROOT: msys, MSYSTEM: 'MINGW32', CHERE_INVOKING: '1',
    PATH: [path.join(msys, 'mingw32', 'bin'), path.join(msys, 'mingw64', 'bin'),
      path.join(msys, 'usr', 'bin'), base.PATH || ''].join(path.delimiter) };
}

function fetchVerified(url, destination, expected, onProgress = () => {}, redirects = 0) {
  if (redirects > 8) return Promise.reject(new Error('Too many download redirects.'));
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'sms-launcher-build-tools' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        return resolve(fetchVerified(new URL(response.headers.location, url).href, destination, expected, onProgress, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Build tool download returned HTTP ${response.statusCode}.`));
      }
      const part = `${destination}.part`;
      const output = fs.createWriteStream(part, { mode: 0o600 });
      const hash = crypto.createHash('sha256');
      const total = Number(response.headers['content-length']) || 0;
      let received = 0;
      response.on('data', chunk => {
        hash.update(chunk);
        received += chunk.length;
        onProgress(total ? Math.min(99, Math.floor(100 * received / total)) : null);
      });
      response.on('error', reject);
      output.on('error', reject);
      output.on('finish', () => {
        const actual = hash.digest('hex');
        if (actual !== expected) {
          fs.rmSync(part, { force: true });
          return reject(new Error('Downloaded build tools failed their SHA-256 check.'));
        }
        fs.renameSync(part, destination);
        resolve(destination);
      });
      response.pipe(output);
    });
    req.setTimeout(30000, () => req.destroy(new Error('Build tool download timed out.')));
    req.on('error', reject);
  });
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('data', chunk => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function assetFor(platform = process.platform) {
  const source = assets.platforms[platform];
  if (!source || !/^https:\/\//.test(source.url) || !/^[a-f0-9]{64}$/.test(source.sha256) ||
      !/^[a-zA-Z0-9._-]+\.tar\.gz$/.test(source.name))
    throw new Error('The build tools for this release are not available yet.');
  return source;
}

async function prepare(userData, { platform = process.platform, run, progress = () => {},
  forcePrivate = false, source = null, archiveFile = null } = {}) {
  if (platform === 'darwin') return status(userData, platform);
  if (!['linux', 'win32'].includes(platform)) throw new Error('This operating system is not supported.');
  if (process.arch !== 'x64') throw new Error('Setup tools require a 64-bit Intel or AMD computer.');
  if (!forcePrivate && privateReady(userData, platform)) return status(userData, platform);
  source = source || assetFor(platform);
  if (!/^[a-f0-9]{64}$/.test(source.sha256) || !/^[a-zA-Z0-9._-]+\.tar\.gz$/.test(source.name))
    throw new Error('Invalid build tool archive information.');
  const root = rootFor(userData, platform);
  const parent = path.dirname(root);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const archive = archiveFile || path.join(parent, source.name);
  if (!archiveFile) await fetchVerified(source.url, archive, source.sha256, progress);
  if (await hashFile(archive) !== source.sha256) throw new Error('Downloaded build tools failed their SHA-256 check.');
  const staging = fs.mkdtempSync(path.join(parent, '.unpack-'));
  const previous = `${root}.previous-${crypto.randomUUID()}`;
  let replaced = false;
  let keptPrevious = false;
  try {
    progress(null, 'Unpacking build tools…');
    const top = platform === 'win32' ? 'msys64' : 'env';
    await require('tar').x({ file: archive, cwd: staging, strict: true,
      filter(name) {
        const entry = name.replace(/^\.\//, '');
        return entry === top || entry.startsWith(`${top}/`) || entry === 'THIRD-PARTY-NOTICES.md' ||
          entry.startsWith('package-sources/');
      }
    });
    if (!fs.existsSync(path.join(staging, top))) throw new Error('Build tool archive is incomplete.');
    if (fs.existsSync(root)) { fs.renameSync(root, previous); keptPrevious = true; }
    fs.renameSync(staging, root);
    replaced = true;
    if (platform === 'linux') {
      const prefix = path.join(root, 'env');
      await run(path.join(prefix, 'bin', 'python3'), [path.join(prefix, 'bin', 'conda-unpack')],
        { env: { ...process.env, PATH: path.join(prefix, 'bin') } }, 'Prepare build tools');
    }
    fs.writeFileSync(path.join(root, 'ready.json'), JSON.stringify({ toolset: TOOLSET, platform,
      archiveSha256: source.sha256 }), { mode: 0o600 });
    if (!privateReady(userData, platform)) throw new Error('Downloaded build tools are incomplete or do not match this release.');
    const env = environment(userData, process.env, platform);
    const bin = platform === 'win32' ? path.join(root, 'msys64', 'mingw32', 'bin') : path.join(root, 'env', 'bin');
    if (!commandWorks(path.join(bin, platform === 'win32' ? 'g++.exe' : 'g++'), ['--version'], env))
      throw new Error('The downloaded compiler could not start on this computer.');
    if (keptPrevious) await fs.promises.rm(previous, { recursive: true, force: true,
      maxRetries: 5, retryDelay: 200 }).catch(() => {});
    return status(userData, platform);
  } catch (error) {
    if (replaced) await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (keptPrevious) fs.renameSync(previous, root);
    throw error;
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (!archiveFile) fs.rmSync(archive, { force: true });
  }
}

module.exports = { TOOLSET, rootFor, privateReady, systemReady, status, environment,
  fetchVerified, hashFile, assetFor, prepare };
