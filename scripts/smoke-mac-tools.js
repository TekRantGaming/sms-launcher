'use strict';

// No ROM, game data, or compiled executable is uploaded by this test.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const buildTools = require('../src/build-tools');
const port = require('../src/port');
const { run, runMain } = require('./tool-run');

async function main() {
  if (process.platform !== 'darwin') throw new Error('Run this smoke test on macOS.');
  // Reproduce an app opened from Finder, without Homebrew's shell initialization.
  const base = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SMS_ARCH: '64' };
  delete base.HOMEBREW_PREFIX;
  delete base.CC;
  delete base.CXX;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sms Mac tools ci-'));
  try {
    const manifestFile = process.env.SMS_TOOL_ASSET_MANIFEST;
    const source = manifestFile ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')).platforms[process.arch] : null;
    const archiveFile = source ? path.join(path.dirname(manifestFile), source.name) : null;
    await buildTools.prepare(userData, { forcePrivate: true, run, source, archiveFile, archives: true,
      progress(percent, detail) { if (detail) process.stdout.write(`${detail}\n`); }
    });
    const report = await buildTools.check(userData, { env: base, refresh: true, archives: true });
    if (!report.ready || report.mode !== 'private') throw new Error(report.message);
    process.stdout.write(`Private Mac preflight passed with Finder's PATH: ${base.PATH}\n`);
    const env = buildTools.environment(userData, base);
    env.PATH = `${env.SMS_BUILD_TOOLS_BIN}:/usr/bin:/bin:/usr/sbin:/sbin`;
    const root = path.join(userData, 'port');
    await run('git', ['clone', '--branch', 'eclipse', '--recurse-submodules', port.PORT_URL, root], { env });
    await run(path.join(root, 'build.sh'), [], { cwd: root, env }, 'Compile Sunshine on Mac without a ROM');
    {
      const binary = port.binaryPath(root, { arch: '64', eclipse: false });
      if (!fs.existsSync(binary)) throw new Error(`Missing binary: ${binary}`);
      const cache = fs.readFileSync(path.join(path.dirname(binary), 'CMakeCache.txt'), 'utf8');
      if (!/^CMAKE_OSX_ARCHITECTURES:STRING=x86_64$/m.test(cache)) throw new Error('Mac build must target x86_64.');
      const compiler = cache.match(/^CMAKE_CXX_COMPILER:[^=]*=(.+)$/m)?.[1];
      if (!compiler?.startsWith(env.SMS_BUILD_TOOLS_BIN)) throw new Error(`Expected the Apple compiler wrapper: ${compiler}`);
      const wrapper = fs.readFileSync(compiler, 'utf8');
      if (!wrapper.includes('exec /usr/bin/clang++')) throw new Error('Mac builds must use the compiler from Apple Command Line Tools.');
      const objcopy = cache.match(/^SMS_OBJCOPY:[^=]*=(.+)$/m)?.[1];
      if (!objcopy?.startsWith(env.SMS_BUILD_TOOLS_BIN)) throw new Error(`Unexpected system LLVM tool: ${objcopy}`);
      await run('/usr/bin/arch', ['-x86_64', '/usr/bin/true'], { env }, 'Check Intel execution support');
      await run('/usr/bin/file', [binary], { env });
      process.stdout.write(`Mac build succeeded: ${binary}\n`);
    }
  } finally { fs.rmSync(userData, { recursive: true, force: true }); }
}

runMain(main);
