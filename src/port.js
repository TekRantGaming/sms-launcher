'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PORT_URL = 'https://github.com/chasem-dev/sms-pc-port.git';
const ECLIPSE_ISO = path.join('mods', 'eclipse', 'Super Mario Eclipse v1.1.0.iso');

function platformInfo(platform = process.platform) {
  if (platform === 'linux') return { name: 'Linux', id: 'linux', arches: ['64'], defaultArch: '64', buildSupported: true };
  if (platform === 'darwin') return { name: 'macOS', id: 'macos', arches: ['64'], defaultArch: '64', buildSupported: true };
  if (platform === 'win32') return { name: 'Windows', id: 'windows', arches: [], defaultArch: '64', buildSupported: false };
  throw new Error(`This port does not support ${platform}.`);
}

function isPort(root) {
  return Boolean(root && ['CMakeLists.txt', 'build.sh', 'run.sh', 'clean.sh', path.join('tools', 'mods', 'get.py')]
    .every(file => fs.existsSync(path.join(root, file))));
}

function validateRom(file) {
  if (!file || typeof file !== 'string') throw new Error('Choose your own game disc file first.');
  const absolute = path.resolve(file);
  if (!['.iso', '.gcm', '.ciso'].includes(path.extname(absolute).toLowerCase()))
    throw new Error('Choose an ISO, GCM, or CISO game disc file.');
  let stat;
  try { stat = fs.statSync(absolute); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('That game file cannot be found. Choose it again.');
    throw error;
  }
  if (!stat.isFile()) throw new Error('Choose a game disc file, not a folder.');
  const fd = fs.openSync(absolute, 'r');
  try {
    const first = Buffer.alloc(0x20);
    if (fs.readSync(fd, first, 0, first.length, 0) !== first.length) throw new Error('This file is too small to be a game disc copy.');
    let offset = 0;
    if (first.toString('ascii', 0, 4) === 'CISO') {
      const blockSize = first.readUInt32LE(4);
      if (blockSize < 0x20 || blockSize > 0x200000 || first[8] !== 1)
        throw new Error('This compressed game disc file appears to be damaged.');
      offset = 0x8000;
      if (fs.readSync(fd, first, 0, first.length, offset) !== first.length) throw new Error('This compressed game disc file appears to be incomplete.');
    }
    if (first.toString('ascii', 0, 6) !== 'GMSE01' || first[7] !== 0 || first.readUInt32BE(0x1c) !== 0xc2339f3d)
      throw new Error('Use a copy of your own North American Super Mario Sunshine disc (GMSE01, original revision).');
    return absolute;
  } finally { fs.closeSync(fd); }
}

function normalizeSettings(input = {}, platform = process.platform) {
  const info = platformInfo(platform);
  // Keep existing Windows 32-bit builds playable, but never offer a new 32-bit build.
  const arch = platform === 'win32' && String(input.arch) === '32' ? '32'
    : info.arches.includes(String(input.arch)) ? String(input.arch) : info.defaultArch;
  const widescreen = ['off', '16:9', '16:10', '21:9'].includes(input.widescreen) ? input.widescreen : '16:9';
  const resolution = [1, 2, 3, 4].includes(Number(input.resolution)) ? Number(input.resolution) : 2;
  return {
    arch, widescreen, resolution,
    fps60: input.fps60 !== false,
    hudEdges: Boolean(input.hudEdges),
    textures: Boolean(input.textures),
    eclipse: Boolean(input.eclipse),
    autoUpdate: input.autoUpdate !== false
  };
}

function texturePackDirectory(root) { return path.join(root, 'mods', 'textures'); }

function texturePackInstalled(root) {
  const pending = [texturePackDirectory(root)];
  while (pending.length) {
    let entries;
    const directory = pending.pop();
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of entries) {
      if (entry.isFile() && /^tex1_.*\.(?:dds|png)$/i.test(entry.name)) return true;
      if (entry.isDirectory()) pending.push(path.join(directory, entry.name));
    }
  }
  return false;
}

function buildEnvironment(settings, disc, root) {
  if (!root) throw new Error('The port folder is required to configure texture packs.');
  const env = {
    ...process.env,
    SMS_ARCH: settings.arch,
    SMS_ECLIPSE: settings.eclipse ? '1' : '0',
    SMS_DISC_IMAGE: disc,
    SMS_WIDESCREEN: settings.widescreen,
    SMS_WIDESCREEN_HUD: settings.hudEdges ? 'edges' : 'centre',
    SMS_FRAME_RATE: settings.fps60 ? '60' : '30',
    SMS_GX_SCALE: String(settings.resolution),
    SMS_TEXTURE_PACKS: settings.textures ? texturePackDirectory(root) : '0',
    SMS_MOD: 'none'
  };
  return env;
}

function gameDisc(root, rom, eclipse) {
  if (!eclipse) return validateRom(rom);
  const modDisc = path.join(root, ECLIPSE_ISO);
  if (!fs.existsSync(modDisc)) throw new Error('Set up Eclipse using your own game disc file first.');
  return modDisc;
}

function binaryPath(root, settings, platform = process.platform) {
  const info = platformInfo(platform);
  const suffix = settings.eclipse ? '-eclipse' : '';
  return path.join(root, 'build', `${info.id}-${settings.arch}${suffix}`, platform === 'win32' ? 'sms.exe' : 'sms');
}

function commandFor(root, action, args = [], platform = process.platform, environment = process.env) {
  if (platform !== 'win32') {
    const file = action === 'python' || action === 'textures' ? 'python3' : path.join(root, `${action}.sh`);
    const commandArgs = action === 'python' ? ['tools/mods/get.py', 'eclipse', '--iso', ...args]
      : action === 'textures' ? ['tools/mods/get.py', 'textures'] : args;
    return { command: file, args: commandArgs, cwd: root, env: environment };
  }
  const msys = process.env.MSYS2_ROOT || 'C:\\msys64';
  const bash = path.join(msys, 'usr', 'bin', 'bash.exe');
  if (!fs.existsSync(bash)) throw new Error(`MSYS2 MINGW32 is required. Install it at ${msys} or set MSYS2_ROOT.`);
  const script = action === 'python'
    ? 'cd "$(cygpath -u "$1")" && python tools/mods/get.py eclipse --iso "$(cygpath -u "$2")"'
    : action === 'textures'
      ? 'cd "$(cygpath -u "$1")" && python tools/mods/get.py textures'
    : action === 'clean'
      ? 'cd "$(cygpath -u "$1")" && ./clean.sh "${@:2}"'
      : `cd "$(cygpath -u "$1")" && ./${action}.sh "$(cygpath -u "$2")"`;
  return {
    command: bash,
    args: ['-c', script, 'sms-launcher', root, ...args], cwd: root,
    env: { ...environment, MSYSTEM: 'MINGW32', CHERE_INVOKING: '1',
      PATH: [path.join(msys, 'mingw32', 'bin'), path.join(msys, 'usr', 'bin'), environment.PATH || ''].join(path.delimiter) }
  };
}

function eclipseBuildCommand(root, settings, platform = process.platform, environment = process.env) {
  const script = __dirname.includes('app.asar')
    ? path.join(process.resourcesPath, 'scripts', 'build-eclipse.sh')
    : path.resolve(__dirname, '..', 'scripts', 'build-eclipse.sh');
  if (platform !== 'win32') return { command: script, args: [root, settings.arch], cwd: root, env: environment };
  const msys = process.env.MSYS2_ROOT || 'C:\\msys64';
  const bash = path.join(msys, 'usr', 'bin', 'bash.exe');
  if (!fs.existsSync(bash)) throw new Error(`MSYS2 MINGW32 is required. Install it at ${msys} or set MSYS2_ROOT.`);
  return {
    command: bash,
    args: ['-c', 'exec "$(cygpath -u "$1")" "$(cygpath -u "$2")" "$3"', 'sms-launcher', script, root, settings.arch],
    cwd: root,
    env: { ...environment, MSYSTEM: 'MINGW32', CHERE_INVOKING: '1',
      PATH: [path.join(msys, 'mingw32', 'bin'), path.join(msys, 'usr', 'bin'), environment.PATH || ''].join(path.delimiter) }
  };
}

function eclipseRunCommand(root, settings, disc, platform = process.platform, environment = process.env) {
  const binary = binaryPath(root, settings, platform);
  if (platform !== 'win32') return { command: binary, args: [disc], cwd: root, env: environment };
  const msys = process.env.MSYS2_ROOT || 'C:\\msys64';
  const bash = path.join(msys, 'usr', 'bin', 'bash.exe');
  if (!fs.existsSync(bash)) throw new Error(`MSYS2 MINGW32 is required. Install it at ${msys} or set MSYS2_ROOT.`);
  return {
    command: bash,
    args: ['-c', 'cd "$(cygpath -u "$1")" && exec "$(cygpath -u "$2")" "$(cygpath -u "$3")"', 'sms-launcher', root, binary, disc],
    cwd: root,
    env: { ...environment, MSYSTEM: 'MINGW32', CHERE_INVOKING: '1',
      PATH: [path.join(msys, 'mingw32', 'bin'), path.join(msys, 'usr', 'bin'), environment.PATH || ''].join(path.delimiter) }
  };
}

module.exports = { PORT_URL, ECLIPSE_ISO, platformInfo, isPort, validateRom, normalizeSettings,
  texturePackDirectory, texturePackInstalled, buildEnvironment, gameDisc, binaryPath,
  commandFor, eclipseBuildCommand, eclipseRunCommand };
