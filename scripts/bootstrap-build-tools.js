'use strict';

// Upstream package managers run only in the tool-asset publishing workflow.
const fs = require('node:fs');
const path = require('node:path');
const { toolsetFor, rootFor, status, hashFile, fetchVerified } = require('../src/build-tools');

const MAMBA = {
  url: 'https://github.com/mamba-org/micromamba-releases/releases/download/2.8.1-0/micromamba-linux-64',
  sha256: '9689782d863c05a1bf5d2d371ba527104e7a4eb4310c1637d8653b751aed9c82'
};
const MAC_MAMBA = {
  x64: { url: 'https://github.com/mamba-org/micromamba-releases/releases/download/2.8.1-0/micromamba-osx-64',
    sha256: 'b2bd613791c0a524883d7cb66505d630bf15badd1f492bc93ba78550a3a1a94b' },
  arm64: { url: 'https://github.com/mamba-org/micromamba-releases/releases/download/2.8.1-0/micromamba-osx-arm64',
    sha256: 'de71a646b73af92dd663e6ddc78993a6a4d47ea28b5d8908c3cc2b9c3077e528' }
};
const MAC_PACKAGES = ['python=3.12', 'git=2.55', 'cmake=4.4.3', 'make', 'patch',
  'clang-21=21.1.8', 'llvm-tools-21=21.1.8', '7zip=26.03', 'bash', 'coreutils',
  'grep', 'sed', 'gawk', 'findutils', 'curl'];
const MSYS2 = {
  url: 'https://github.com/msys2/msys2-installer/releases/download/2026-09-27/msys2-base-x86_64-20260927.sfx.exe',
  sha256: 'ad336cccfda47758b5e15cda993fbba421115cb0b126697daef1ee4dfe37209f'
};
const LINUX_PACKAGES = [
  'python=3.12', 'git=2.55', 'cmake=4.4.3', 'make', 'patch', 'binutils',
  'gcc_linux-64=16.2', 'gxx_linux-64=16.2', 'sysroot_linux-64=2.17', 'sdl2=2.32.56',
  'libegl-devel', 'libgl-devel', '7zip=26.03', 'bash', 'coreutils',
  'grep', 'sed', 'gawk', 'findutils', 'curl'
];
const WINDOWS_PACKAGES = [
  'mingw-w64-i686-gcc', 'mingw-w64-i686-cmake', 'mingw-w64-i686-SDL2',
  'mingw-w64-i686-ninja', 'mingw-w64-i686-python', 'mingw-w64-x86_64-7zip',
  'patch', 'git'
];


async function ensureArchive(archive, source, progress) {
  if (fs.existsSync(archive) && await hashFile(archive) === source.sha256) return;
  fs.rmSync(archive, { force: true });
  await fetchVerified(source.url, archive, source.sha256, progress);
}

async function prepareFromUpstream(userData, { platform = process.platform, run, progress = () => {}, forcePrivate = false } = {}) {
  if (!['linux', 'win32', 'darwin'].includes(platform)) throw new Error('This operating system is not supported.');
  if (platform === 'darwin' ? !['x64', 'arm64'].includes(process.arch) : process.arch !== 'x64')
    throw new Error('Setup tools require a supported 64-bit computer.');
  if (!forcePrivate && status(userData, platform).ready) return status(userData, platform);
  const root = rootFor(userData, platform);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.rmSync(path.join(root, 'ready.json'), { force: true });
  if (platform !== 'win32') {
    const binary = path.join(root, 'micromamba');
    await ensureArchive(binary, platform === 'darwin' ? MAC_MAMBA[process.arch] : MAMBA, progress);
    fs.chmodSync(binary, 0o700);
    const prefix = path.join(root, 'env');
    fs.rmSync(prefix, { recursive: true, force: true });
    await run(binary, ['create', '--yes', '--prefix', prefix, '--channel', 'conda-forge',
      '--override-channels', ...(platform === 'darwin' ? MAC_PACKAGES : LINUX_PACKAGES)], {
      env: { ...process.env, MAMBA_ROOT_PREFIX: path.join(root, 'cache') }
    }, 'Prepare build tools');
    const bin = path.join(prefix, 'bin');
    const aliases = platform === 'darwin' ? [['clang', 'clang-21'], ['clang++', 'clang-21'],
      ['llvm-objcopy', 'llvm-objcopy-21']] : [['gcc', 'x86_64-conda-linux-gnu-gcc'],
      ['g++', 'x86_64-conda-linux-gnu-g++'], ['cc', 'x86_64-conda-linux-gnu-gcc'],
      ['c++', 'x86_64-conda-linux-gnu-g++']];
    for (const [name, target] of aliases) {
      if (platform === 'darwin' && !fs.existsSync(path.join(bin, target))) {
        if (fs.existsSync(path.join(bin, name))) continue;
        throw new Error(`Mac tool ${target} is missing.`);
      }
      const link = path.join(bin, name);
      fs.rmSync(link, { force: true });
      fs.symlinkSync(target, link);
    }
    const required = platform === 'darwin' ? ['git', 'cmake', 'make', 'patch', 'python3', 'llvm-objcopy', 'clang++', '7z', 'bash']
      : ['git', 'cmake', 'make', 'patch', 'python3', 'objcopy', 'g++', '7z', 'bash'];
    for (const name of required)
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
  fs.writeFileSync(path.join(root, 'ready.json'), JSON.stringify({ toolset: toolsetFor(platform), platform }), { mode: 0o600 });
  return status(userData, platform);
}


module.exports = { prepareFromUpstream };
