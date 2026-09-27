'use strict';

// CI smoke build: prepares private tools and compiles the port without a ROM.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const buildTools = require('../src/build-tools');
const port = require('../src/port');

function run(command, args, options = {}, label = command) {
  process.stdout.write(`\n${label}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${label} exited with ${code}`)));
  });
}

async function main() {
  const userData = path.join(os.tmpdir(), 'sms-launcher-private-tools-ci');
  await buildTools.prepare(userData, { forcePrivate: true, run });
  if (buildTools.status(userData).mode !== 'private') throw new Error('Private tools were not prepared.');
  const env = buildTools.environment(userData, { ...process.env, SMS_ARCH: process.platform === 'win32' ? '32' : '64' });
  const root = path.join(os.tmpdir(), 'sms-port-private-tools-ci');
  if (fs.existsSync(root)) throw new Error(`Smoke build folder already exists: ${root}`);
  await run('git', ['clone', '--branch', 'eclipse', '--recurse-submodules', port.PORT_URL, root],
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
  process.stdout.write(`Private tool build succeeded: ${binary}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
