'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const TOOLSET = '2026-09-27.1';
const MAMBA = {
  url: 'https://github.com/mamba-org/micromamba-releases/releases/download/2.8.1-0/micromamba-linux-64',
  sha256: '9689782d863c05a1bf5d2d371ba527104e7a4eb4310c1637d8653b751aed9c82'
};
const MSYS2 = {
  url: 'https://github.com/msys2/msys2-installer/releases/download/2026-09-27/msys2-base-x86_64-20260927.sfx.exe',
  sha256: 'ad336cccfda47758b5e15cda993fbba421115cb0b126697daef1ee4dfe37209f'
};
const LINUX_PACKAGES = [
  'python=3.12', 'git=2.55', 'cmake=4.4.3', 'make', 'patch', 'binutils',
  'gcc_linux-64=16.2', 'gxx_linux-64=16.2', 'sdl2=2.32.56',
  'libegl-devel', 'libgl-devel', '7zip=26.03', 'bash', 'coreutils',
  'grep', 'sed', 'gawk', 'findutils', 'curl'
];
const WINDOWS_PACKAGES = [
  'mingw-w64-i686-gcc', 'mingw-w64-i686-cmake', 'mingw-w64-i686-SDL2',
  'mingw-w64-i686-ninja', 'mingw-w64-i686-python', 'mingw-w64-x86_64-7zip',
  'patch', 'git'
];

function rootFor(userData, platform = process.platform) {
  return path.join(userData, 'build-tools', platform === 'win32' ? 'windows-x64' : 'linux-x64');
}

function privateReady(userData, platform = process.platform) {
  if (platform === 'darwin') return false;
  const root = rootFor(userData, platform);
  const marker = path.join(root, 'ready.json');
  try {
    if (JSON.parse(fs.readFileSync(marker, 'utf8')).toolset !== TOOLSET) return false;
    return platform === 'win32'
      ? fs.existsSync(path.join(root, 'msys64', 'usr', 'bin', 'bash.exe')) &&
        fs.existsSync(path.join(root, 'msys64', 'mingw32', 'bin', 'g++.exe'))
      : fs.existsSync(path.join(root, 'env', 'bin', 'g++')) &&
        fs.existsSync(path.join(root, 'env', 'bin', 'git'));
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
      'mingw32/bin/python.exe'].every(file => fs.existsSync(path.join(root, file))) &&
      (fs.existsSync(path.join(root, 'mingw64', 'bin', '7z.exe')) || commandWorks('7z', ['-h'], env));
  }
  return false;
}

function status(userData, platform = process.platform, env = process.env) {
  if (privateReady(userData, platform)) return { ready: true, mode: 'private' };
  if (systemReady(platform, env)) return { ready: true, mode: 'system' };
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

async function ensureArchive(archive, source, progress) {
  if (fs.existsSync(archive) && await hashFile(archive) === source.sha256) return;
  fs.rmSync(archive, { force: true });
  await fetchVerified(source.url, archive, source.sha256, progress);
}

async function prepare(userData, { platform = process.platform, run, progress = () => {}, forcePrivate = false } = {}) {
  if (!['linux', 'win32', 'darwin'].includes(platform)) throw new Error('This operating system is not supported.');
  if (platform === 'darwin') return status(userData, platform);
  if (process.arch !== 'x64') throw new Error('Setup tools require a 64-bit Intel or AMD computer.');
  if (!forcePrivate && status(userData, platform).ready) return status(userData, platform);
  const root = rootFor(userData, platform);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.rmSync(path.join(root, 'ready.json'), { force: true });
  if (platform === 'linux') {
    const binary = path.join(root, 'micromamba');
    await ensureArchive(binary, MAMBA, progress);
    fs.chmodSync(binary, 0o700);
    const prefix = path.join(root, 'env');
    fs.rmSync(prefix, { recursive: true, force: true });
    await run(binary, ['create', '--yes', '--prefix', prefix, '--channel', 'conda-forge',
      '--override-channels', ...LINUX_PACKAGES], {
      env: { ...process.env, MAMBA_ROOT_PREFIX: path.join(root, 'cache') }
    }, 'Prepare build tools');
    const bin = path.join(prefix, 'bin');
    for (const [name, target] of [['gcc', 'x86_64-conda-linux-gnu-gcc'],
      ['g++', 'x86_64-conda-linux-gnu-g++'], ['cc', 'x86_64-conda-linux-gnu-gcc'],
      ['c++', 'x86_64-conda-linux-gnu-g++']]) {
      const link = path.join(bin, name);
      fs.rmSync(link, { force: true });
      fs.symlinkSync(target, link);
    }
    for (const name of ['git', 'cmake', 'make', 'patch', 'python3', 'objcopy', 'g++', '7z', 'bash'])
      if (!fs.existsSync(path.join(bin, name))) throw new Error(`Build tool ${name} is missing after download.`);
  } else {
    const archive = path.join(root, 'msys2-base.sfx.exe');
    await ensureArchive(archive, MSYS2, progress);
    const msys = path.join(root, 'msys64');
    fs.rmSync(msys, { recursive: true, force: true });
    await run(archive, ['-y', `-o${root}`], { cwd: root }, 'Unpack build tools');
    const bash = path.join(msys, 'usr', 'bin', 'bash.exe');
    if (!fs.existsSync(bash)) throw new Error('Portable MSYS2 did not unpack correctly.');
    const env = { ...process.env, MSYSTEM: 'MINGW32', CHERE_INVOKING: '1',
      PATH: [path.join(msys, 'usr', 'bin'), process.env.PATH || ''].join(path.delimiter) };
    await run(bash, ['-lc', 'pacman -Syu --noconfirm'], { cwd: msys, env }, 'Update private build tools');
    await run(bash, ['-lc', `pacman -Syu --noconfirm --needed ${WINDOWS_PACKAGES.join(' ')}`],
      { cwd: msys, env }, 'Prepare build tools');
    if (!fs.existsSync(path.join(msys, 'mingw32', 'bin', 'g++.exe')))
      throw new Error('Windows compiler is missing after tool setup.');
  }
  fs.writeFileSync(path.join(root, 'ready.json'), JSON.stringify({ toolset: TOOLSET, platform }), { mode: 0o600 });
  return status(userData, platform);
}

module.exports = { TOOLSET, LINUX_PACKAGES, WINDOWS_PACKAGES, rootFor, privateReady,
  systemReady, status, environment, fetchVerified, prepare };
