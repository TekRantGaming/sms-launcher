'use strict';

// CI smoke build: prepares private tools and compiles the port without a ROM.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const buildTools = require('../src/build-tools');
const port = require('../src/port');
const { run } = require('./tool-run');

async function main() {
  const userData = path.join(os.tmpdir(), 'sms-launcher-private-tools-ci');
  const manifestFile = process.env.SMS_TOOL_ASSET_MANIFEST;
  const source = manifestFile ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')).platforms[process.platform] : null;
  const archiveFile = source ? path.join(path.dirname(manifestFile), source.name) : null;
  await buildTools.prepare(userData, { forcePrivate: true, run, source, archiveFile });
  if (buildTools.status(userData).mode !== 'private') throw new Error('Private tools were not prepared.');
  const env = buildTools.environment(userData, { ...process.env, SMS_ARCH: process.platform === 'win32' ? '32' : '64' });
  const toolRoot = buildTools.rootFor(userData);
  const git = process.platform === 'win32'
    ? path.join(env.MSYS2_ROOT, 'usr', 'bin', 'git.exe')
    : path.join(toolRoot, 'env', 'bin', 'git');
  if (!fs.existsSync(git)) throw new Error(`Private Git is missing: ${git}`);
  if (process.platform === 'linux') env.PATH = path.join(toolRoot, 'env', 'bin');
  const root = path.join(os.tmpdir(), 'sms-port-private-tools-ci');
  if (fs.existsSync(root)) throw new Error(`Smoke build folder already exists: ${root}`);
  await run(git, ['clone', '--branch', 'eclipse', '--recurse-submodules', port.PORT_URL, root],
    { cwd: os.tmpdir(), env }, 'Clone source using private Git');
  if (process.platform === 'win32') {
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
  const privatePathFragment = '/sms-launcher-private-tools-ci/build-tools/';
  if (!compiler || !compiler.toLowerCase().replaceAll('\\', '/').includes(privatePathFragment))
    throw new Error(`Port was not compiled with the private C++ toolchain: ${compiler || 'unknown'}`);
  process.stdout.write(`Private tool build succeeded: ${binary}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
