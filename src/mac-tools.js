'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function executable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); }
  catch (_) { return false; }
}

function find(command, env, exists = executable) {
  return (env.PATH || '').split(':').filter(Boolean)
    .map(directory => path.posix.join(directory, command)).find(exists);
}

function prepareLto(prefix) {
  // Apple's linker checks the resolved filename, not just the symlink name.
  // Conda's versioned libLTO alias therefore needs an unversioned real file.
  // Copy after conda-unpack so the copy already has its relocated library paths.
  const library = path.join(prefix, 'lib', 'libLTO.dylib');
  const clangRoot = path.join(prefix, 'lib', 'clang');
  const aliases = fs.existsSync(clangRoot) ? fs.readdirSync(clangRoot)
    .map(version => path.join(clangRoot, version, 'lib', 'libLTO.dylib')).filter(fs.existsSync) : [];
  const source = [library, ...aliases].find(fs.existsSync);
  if (!source) throw new Error('The Mac LLVM archive is missing libLTO.');
  const resolved = fs.realpathSync(source);
  if (!resolved.startsWith(`${fs.realpathSync(prefix)}${path.sep}`)) throw new Error('Mac LLVM library is outside its tool folder.');
  if (resolved !== library) {
    const temporary = `${library}.portable-copy`;
    fs.copyFileSync(resolved, temporary);
    fs.rmSync(library, { force: true });
    fs.renameSync(temporary, library);
  }
  for (const alias of aliases) {
    fs.rmSync(alias, { force: true });
    fs.symlinkSync(path.relative(path.dirname(alias), library), alias);
  }
}

// Finder launches apps with a minimal PATH, even after Homebrew is installed.
// Change only the environment of our children, never shell profiles or system files.
function environment(base = process.env, exists = executable) {
  const prefixes = [...new Set([base.HOMEBREW_PREFIX, '/opt/homebrew', '/usr/local'].filter(Boolean))];
  const llvm = prefixes.map(prefix => `${prefix}/opt/llvm/bin`)
    .filter(bin => exists(`${bin}/llvm-objcopy`));
  const bins = [base.SMS_BUILD_TOOLS_BIN, ...llvm, ...prefixes.map(prefix => `${prefix}/bin`),
    '/Applications/CMake.app/Contents/bin', ...(base.PATH || '').split(':'),
    '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  return { ...base, PATH: [...new Set(bins.filter(Boolean))].join(':') };
}

function probe(command, args, env) {
  if (!command) return Promise.resolve({ ok: false, stdout: '' });
  return new Promise(resolve => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, stdout: stdout.trim() });
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(false); }, 10000);
    child.stdout.on('data', bytes => { if (stdout.length < 16384) stdout += bytes; });
    child.on('error', () => finish(false));
    child.on('close', code => finish(code === 0));
  });
}

async function inspect(base = process.env, { run = probe, exists = executable } = {}) {
  const env = environment(base, exists);
  const runTool = (command, args) => run(find(command, env, exists), args, env);
  const [sdk, silicon, cmake, objcopy, brew] = await Promise.all([
    run('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], env),
    run('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64'], env),
    runTool('cmake', ['--version']), runTool('llvm-objcopy', ['--version']),
    // Homebrew is useful for fixing missing packages, but is not itself required.
    Promise.resolve(Boolean(find('brew', env, exists)))
  ]);
  const [appleCommands, python, zip, rosetta, compilers] = await Promise.all([
    sdk.ok ? Promise.all(['git', 'make', 'patch'].map(command => runTool(command, ['--version']))) : [],
    // Apple's Python stub can trigger an installation prompt without an SDK.
    sdk.ok || find('python3', env, exists) !== '/usr/bin/python3'
      ? runTool('python3', ['--version']) : { ok: false },
    Promise.all(['7zz', '7z', '7za'].map(command => runTool(command, ['-h']))),
    silicon.stdout === '1' ? run('/usr/bin/arch', ['-x86_64', '/usr/bin/true'], env) : { ok: true },
    Promise.all(['clang', 'clang++'].map(command => sdk.ok || find(command, env, exists) !== `/usr/bin/${command}`
      ? runTool(command, ['--version']) : { ok: false }))
  ]);
  const cmakeVersion = cmake.stdout.match(/cmake version (\d+)\.(\d+)/);
  const cmakeReady = cmake.ok && Boolean(cmakeVersion) &&
    (Number(cmakeVersion[1]) > 3 || Number(cmakeVersion[1]) === 3 && Number(cmakeVersion[2]) >= 20);
  return {
    checked: true, homebrew: brew, sdkPath: sdk.ok ? sdk.stdout : '',
    requirements: [
      { id: 'apple', label: 'Apple Command Line Tools', ready: sdk.ok && Boolean(sdk.stdout) &&
        appleCommands.length === 3 && appleCommands.every(result => result.ok) &&
        ['curl', 'hdiutil'].every(command => find(command, env, exists)) },
      { id: 'cmake', label: 'CMake 3.20 or newer', package: 'cmake', ready: cmakeReady },
      { id: 'python', label: 'Python 3', package: 'python3', ready: python.ok },
      { id: 'llvm', label: 'LLVM build tools', package: 'llvm', ready: objcopy.ok && compilers.every(result => result.ok) },
      ...(silicon.stdout === '1' ? [{ id: 'rosetta', label: 'Rosetta 2', ready: rosetta.ok }] : []),
      { id: 'zip', label: '7-Zip (HD textures and Eclipse)', package: 'sevenzip', optional: true,
        ready: zip.some(result => result.ok) }
    ]
  };
}

function report(inspection = { checked: false, requirements: [] }, { archives = false, managed = false } = {}) {
  const requirements = inspection.requirements.map(item => ({ ...item, optional: item.id === 'zip' && !archives }));
  const missing = requirements.filter(item => !item.ready && !item.optional);
  const commands = [];
  if (missing.some(item => item.id === 'apple')) commands.push('xcode-select --install');
  if (missing.some(item => item.id === 'rosetta')) commands.push('softwareupdate --install-rosetta');
  const packages = managed ? [] : missing.filter(item => item.package).map(item => item.package);
  if (packages.length) commands.push(`brew install ${packages.join(' ')}`);
  return { ...inspection, requirements, ready: inspection.checked && missing.length === 0,
    mode: inspection.checked && missing.length === 0 ? 'system' : 'missing', managed,
    needsHomebrew: packages.length > 0 && !inspection.homebrew, commands: commands.join('\n'),
    message: inspection.checked
      ? missing.length ? `Install ${missing.filter(item => !managed || !item.package).map(item => item.label).join(', ') || 'the downloaded build tools'} to continue. Open Mac setup help in Step 1.`
        : 'Mac tools are ready.'
      : 'Check the tools needed to prepare your game on this Mac.' };
}

module.exports = { environment, inspect, report, prepareLto };
