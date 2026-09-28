'use strict';

// CI smoke build: prepares private tools and compiles the port without a ROM.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const buildTools = require('../src/build-tools');
const port = require('../src/port');
const game = require('../src/game-version');
const { execFileSync, spawnSync } = require('node:child_process');
const capture = async (command, args, cwd, env) => execFileSync(command, args, { cwd, env, encoding: 'utf8' }).trim();
const { run, runMain } = require('./tool-run');

async function main() {
  const userData = path.join(os.tmpdir(), process.platform === 'win32'
    ? 'SMS Launcher Private Tools CI' : 'sms-launcher-private-tools-ci');
  const manifestFile = process.env.SMS_TOOL_ASSET_MANIFEST;
  const generated = manifestFile ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null;
  const source = generated?.platforms[process.platform] || null;
  if (source) {
    source.toolset ||= generated.toolset;
    require('../src/tool-assets.json').platforms[process.platform] = source;
  }
  const archiveFile = source ? path.join(path.dirname(manifestFile), source.name) : null;
  await buildTools.prepare(userData, { forcePrivate: true, run, source, archiveFile,
    progress(percent, detail) {
      if (detail) process.stdout.write(`${detail}\n`);
      else if (percent !== null && percent % 10 === 0) process.stdout.write(`Download tools: ${percent}%\n`);
    }
  });
  if (buildTools.status(userData).mode !== 'private') throw new Error('Private tools were not prepared.');
  const env = buildTools.environment(userData, { ...process.env, SMS_ARCH: '64' });
  const toolRoot = buildTools.rootFor(userData);
  const git = process.platform === 'win32'
    ? path.join(env.MSYS2_ROOT, 'usr', 'bin', 'git.exe')
    : path.join(toolRoot, 'env', 'bin', 'git');
  if (!fs.existsSync(git)) throw new Error(`Private Git is missing: ${git}`);
  if (process.platform === 'linux') env.PATH = path.join(toolRoot, 'env', 'bin');
  if (process.platform === 'win32') env.PATH = [path.join(env.MSYS2_ROOT, 'mingw64', 'bin'),
    path.join(env.MSYS2_ROOT, 'usr', 'bin'), path.join(process.env.SystemRoot, 'System32')].join(path.delimiter);
  const root = path.join(os.tmpdir(), process.platform === 'win32'
    ? 'SMS Port Private Tools CI' : 'sms-port-private-tools-ci');
  if (fs.existsSync(root)) throw new Error(`Smoke build folder already exists: ${root}`);
  await game.checkout(root, { git, run, capture, env });
  if (process.platform === 'win32') {
    for (const name of ['Python3_EXECUTABLE', 'CMAKE_MAKE_PROGRAM', 'CMAKE_OBJCOPY']) {
      const selected = cache.match(new RegExp(`^${name}:[^=]*=(.+)$`, 'm'))?.[1];
      if (!selected || !fs.realpathSync.native(selected).replaceAll('\\', '/').toLowerCase().startsWith(privatePrefix))
        throw new Error(`Build used a tool outside the private archive: ${name}=${selected || 'unknown'}`);
    }
    const bash = path.join(env.MSYS2_ROOT, 'usr', 'bin', 'bash.exe');
    await run(bash, ['-lc', 'cd "$(cygpath -u "$1")" && ./build.sh', 'sms-launcher', root],
      { cwd: root, env }, 'Build port using private Windows tools');
  } else {
    await run(path.join(root, 'build.sh'), [], { cwd: root, env }, 'Build port using private Linux tools');
  }
  const binary = port.binaryPath(root, { arch: env.SMS_ARCH, eclipse: false });
  if (!fs.existsSync(binary)) throw new Error(`Build completed without ${binary}`);
  const cache = fs.readFileSync(path.join(path.dirname(binary), 'CMakeCache.txt'), 'utf8');
  const compiler = cache.match(/^CMAKE_CXX_COMPILER:[^=]*=(.+)$/m)?.[1];
  // Windows tools may report the long path while os.tmpdir uses an 8.3 alias.
  const privatePrefix = `${fs.realpathSync.native(toolRoot).replaceAll('\\', '/').toLowerCase()}/`;
  if (!compiler || !fs.realpathSync.native(compiler).toLowerCase().replaceAll('\\', '/').startsWith(privatePrefix))
    throw new Error(`Port was not compiled with the private C++ toolchain: ${compiler || 'unknown'}`);
  if (process.platform === 'win32') {
    const machine = await capture(compiler, ['-dumpmachine'], root, env);
    if (machine !== 'x86_64-w64-mingw32') throw new Error(`Expected the Windows x64 compiler, got ${machine}`);
    const fd = fs.openSync(binary, 'r');
    try {
      const header = Buffer.alloc(64);
      fs.readSync(fd, header, 0, header.length, 0);
      const pe = Buffer.alloc(112);
      fs.readSync(fd, pe, 0, pe.length, header.readUInt32LE(0x3c));
      if (header.readUInt16LE(0) !== 0x5a4d || pe.readUInt32LE(0) !== 0x4550 ||
          pe.readUInt16LE(4) !== 0x8664 || pe.readUInt16LE(24) !== 0x20b)
        throw new Error('The Windows game executable is not AMD64/PE32+.');
      if (pe.readBigUInt64LE(48) !== 0x400000n || (pe.readUInt16LE(94) & 0x60))
        throw new Error('The Windows game image must stay below 4 GiB.');
    } finally { fs.closeSync(fd); }
    const cmake = path.join(env.MSYS2_ROOT, 'mingw64', 'bin', 'cmake.exe');
    await run(cmake, ['--build', path.dirname(binary), '--target', 'sms_windows_stack_test'], { cwd: root, env });
    await run(path.join(path.dirname(binary), 'sms_windows_stack_test.exe'), [], { cwd: root, env },
      'Check Windows x64 game stacks and thread exits');
    const start = spawnSync(binary, [], { cwd: root, timeout: 15000, encoding: 'utf8', windowsHide: true,
      env: { ...env, SMS_SAVE_DIR: path.join(userData, 'test-saves'),
        SMS_DISC_IMAGE: path.join(userData, 'intentionally-missing.iso') } });
    if (start.error || start.signal || start.status !== 1 || !start.stderr.includes('not a usable GameCube disc image'))
      throw new Error(`Windows x64 game did not reach the missing-disc check: ${start.error?.message || start.stderr}`);
    process.stdout.write('Windows game verified as native x64; low-stack and loader checks passed.\n');
  }
  process.stdout.write(`Private tool build succeeded: ${binary}\n`);
}

runMain(main);
