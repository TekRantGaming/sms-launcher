'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const port = require('./port');
const saves = require('./saves');
const buildTools = require('./build-tools');
const { activityFromLine } = require('./progress');

let window;
let config;
let active = null;
let preparingTools = false;
let appUpdate = { state: 'idle', message: '' };
const logLines = [];

function broadcast(channel, data) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, data);
}

function log(message) {
  const lines = String(message).replace(/\r/g, '').split('\n');
  for (const line of lines) {
    if (!line) continue;
    logLines.push(line);
    if (logLines.length > 700) logLines.shift();
    broadcast('log', line);
  }
}

function configFile() { return path.join(app.getPath('userData'), 'preferences.json'); }

function defaultRepo() {
  const sibling = path.resolve(__dirname, '..', '..', 'sms-port');
  return !app.isPackaged && port.isPort(sibling)
    ? sibling : path.join(app.getPath('userData'), 'sms-pc-port');
}

function saveConfig() {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch (_) { /* first run */ }
  config = {
    repo: typeof saved.repo === 'string' ? saved.repo : defaultRepo(),
    rom: typeof saved.rom === 'string' ? saved.rom : '',
    settings: port.normalizeSettings(saved.settings),
    portGeneration: Number.isSafeInteger(saved.portGeneration) ? saved.portGeneration : 0,
    builtGeneration: saved.builtGeneration && typeof saved.builtGeneration === 'object' ? saved.builtGeneration : {}
  };
}

function requireRepo() {
  if (!port.isPort(config.repo)) throw new Error('Download the setup files or choose a folder that already has them.');
  return config.repo;
}

function currentSaveDirectory() { return saves.saveDirectory(config.repo); }

function makeSaveBackup(reason) {
  if (active) throw new Error('Stop the running game or task before backing up saves.');
  const result = saves.backupSaves(currentSaveDirectory(), saves.backupRoot(), reason);
  log(result.empty ? result.message : `Saved ${result.count} memory card file(s) to ${result.directory}`);
  return result;
}

function launch(command, args, options = {}, label = 'Task') {
  if (active) throw new Error(`Wait for ${active.label} to finish, or stop it first.`);
  return new Promise((resolve, reject) => {
    log(`▶ ${label}`);
    const child = spawn(command, args, { ...options, detached: process.platform !== 'win32',
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    active = { label, child, detail: label.includes('build tools') ? 'Downloading and preparing tools…' : 'Starting…',
      percent: null, startedAt: Date.now() };
    broadcast('activity', { label, detail: active.detail, percent: null, startedAt: active.startedAt });
    const pending = { stdout: '', stderr: '' };
    function line(value) {
      if (!value) return;
      log(value);
      const progress = activityFromLine(value);
      if (progress && active && active.child === child) {
        Object.assign(active, progress);
        broadcast('activity', { label, detail: active.detail, percent: active.percent, startedAt: active.startedAt });
      }
    }
    function consume(stream, bytes) {
      const parts = (pending[stream] + bytes.toString()).split(/[\r\n]/);
      pending[stream] = parts.pop();
      for (const part of parts) line(part);
    }
    child.stdout.on('data', bytes => consume('stdout', bytes));
    child.stderr.on('data', bytes => consume('stderr', bytes));
    let settled = false;
    function done(error, code) {
      if (settled) return;
      settled = true;
      active = null;
      broadcast('activity', null);
      if (error || code !== 0) {
        const message = error ? error.message : `${label} exited with code ${code}. See the activity log.`;
        log(`✕ ${message}`);
        reject(new Error(message));
      } else {
        log(`✓ ${label} finished`);
        resolve({ ok: true });
      }
    }
    child.on('error', error => done(error));
    child.on('close', code => {
      line(pending.stdout);
      line(pending.stderr);
      done(null, code);
    });
  });
}

async function capture(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)));
  });
}

function toolEnv(base = process.env) {
  return buildTools.environment(app.getPath('userData'), base);
}

function toolOptions() {
  return { archives: Boolean(config.settings.textures || config.settings.eclipse) };
}

function toolsStatus() {
  return buildTools.status(app.getPath('userData'), process.platform, process.env, toolOptions());
}

async function checkTools(refresh = false) {
  return buildTools.check(app.getPath('userData'), { ...toolOptions(), refresh });
}

async function ensureBuildTools() {
  if (preparingTools) throw new Error('Wait for build tools to finish preparing.');
  if (active) throw new Error(`Wait for ${active.label} to finish, or stop it first.`);
  const userData = app.getPath('userData');
  const forcePrivate = process.env.SMS_FORCE_PRIVATE_TOOLS === '1';
  if (process.platform === 'darwin') {
    preparingTools = true;
    try {
      const found = await checkTools(true);
      if (!found.appleReady) throw new Error(found.message);
      if (found.ready && !forcePrivate) return;
    } finally { preparingTools = false; }
  }
  const found = toolsStatus();
  if (found.mode === 'private' || (!forcePrivate && found.ready)) return;
  preparingTools = true;
  const startedAt = Date.now();
  active = { label: 'Download build tools', child: null, detail: 'Checking download…', percent: null, startedAt };
  broadcast('activity', { label: active.label, detail: active.detail, percent: null, startedAt });
  try {
    await buildTools.prepare(userData, {
      forcePrivate,
      progress(percent, detail) {
        if (!active || active.child) return;
        active.detail = detail || (percent === null ? 'Downloading tools…' : `Downloading tools: ${percent}%`);
        active.percent = percent;
        broadcast('activity', { label: active.label, detail: active.detail, percent, startedAt });
      },
      async run(command, args, options, label) {
        active = null;
        broadcast('activity', null);
        try { return await launch(command, args, options, label); }
        finally {
          if (preparingTools && !active) {
            active = { label: 'Download build tools', child: null, detail: 'Preparing build tools…', percent: null, startedAt };
            broadcast('activity', { label: active.label, detail: active.detail, percent: null, startedAt, canStop: false });
          }
        }
      }
    });
    log('Build tools are ready.');
  } finally {
    preparingTools = false;
    if (active && !active.child && active.startedAt === startedAt) {
      active = null;
      broadcast('activity', null);
    }
  }
}

async function updatePort() {
  await ensureBuildTools();
  const root = requireRepo();
  if (!fs.existsSync(path.join(root, '.git'))) throw new Error('These setup files cannot update automatically. Download a fresh copy to get updates.');
  const env = toolEnv();
  await launch('git', ['fetch', '--recurse-submodules=no'], { cwd: root, env }, 'Check for port updates');
  const tracking = await capture('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root, env);
  const counts = await capture('git', ['rev-list', '--left-right', '--count', `HEAD...${tracking}`], root, env);
  const [ahead, behind] = counts.split(/\s+/).map(Number);
  if (behind === 0) { log('Your setup files are up to date.'); return { updated: false, behind: 0 }; }
  if (ahead > 0) throw new Error(`Local branch has ${ahead} unpublished commit(s) and ${behind} upstream commit(s). Resolve that branch before updating.`);
  makeSaveBackup('before-port-update');
  await launch('git', ['merge', '--ff-only', tracking], { cwd: root, env }, `Update port (${behind} commits)`);
  config.portGeneration += 1;
  saveConfig();
  await launch('git', ['submodule', 'update', '--init', 'decomp'], { cwd: root, env }, 'Update decompilation');
  log('Setup files updated. Your game will be prepared again the next time you play.');
  return { updated: true, behind };
}

async function installPort() {
  await ensureBuildTools();
  const destination = path.resolve(config.repo);
  if (fs.existsSync(destination)) {
    if (port.isPort(destination)) return { ok: true };
    if (!fs.statSync(destination).isDirectory() || fs.readdirSync(destination).length)
      throw new Error('That folder has other files in it. Choose a different download folder.');
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await launch('git', ['clone', '--branch', 'eclipse', '--recurse-submodules', port.PORT_URL, destination],
    { cwd: path.dirname(destination), env: toolEnv() }, 'Download port source');
  return { ok: true };
}

async function installEclipse() {
  await ensureBuildTools();
  const root = requireRepo();
  const rom = port.validateRom(config.rom);
  const cmd = port.commandFor(root, 'python', [rom], process.platform, toolEnv());
  return launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, 'Install Eclipse from your disc');
}

async function installTextures() {
  await ensureBuildTools();
  const root = requireRepo();
  if (port.texturePackInstalled(root)) {
    log('HD textures are already installed.');
    return { installed: true };
  }
  const cmd = port.commandFor(root, 'textures', [], process.platform, toolEnv());
  await launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, 'Install UHD textures');
  if (!port.texturePackInstalled(root)) throw new Error('Texture installer finished without a usable texture pack.');
  log('HD textures are ready for the next game launch.');
  return { installed: true };
}

function binaryReady(root = config.repo, settings = config.settings) {
  if (!port.isPort(root)) return false;
  const binary = port.binaryPath(root, settings);
  return fs.existsSync(binary) && (!config.portGeneration || config.builtGeneration[binary] === config.portGeneration);
}

function keepPreviousBuildIfToolchainChanged(root, settings) {
  if (buildTools.status(app.getPath('userData')).mode !== 'private') return;
  const buildDirectory = path.dirname(port.binaryPath(root, settings));
  const cache = path.join(buildDirectory, 'CMakeCache.txt');
  if (!fs.existsSync(cache)) return;
  const expected = buildTools.rootFor(app.getPath('userData'));
  const contents = fs.readFileSync(cache, 'utf8');
  const compiler = contents.match(/^CMAKE_CXX_COMPILER:[^=]*=(.+)$/m)?.[1] || '';
  if (compiler.startsWith(expected)) return;
  const previous = `${buildDirectory}.previous-${Date.now()}`;
  const backup = saves.moveBuildKeepingSaves(buildDirectory, previous, currentSaveDirectory());
  if (backup && !backup.empty) log('Kept your saved games in place and made a backup before changing build tools.');
  log(`Kept the earlier build at ${previous} because this setup uses different build tools.`);
}

async function build() {
  await ensureBuildTools();
  const root = requireRepo();
  const rom = port.validateRom(config.rom);
  if (process.platform === 'darwin') {
    const compatible = () => fs.existsSync(path.join(root, 'decomp-patches', 'modhook-zz-macos-data-exports.patch')) &&
      fs.readFileSync(path.join(root, 'build.sh'), 'utf8').includes('/usr/bin/arch') &&
      ['MarioJump', 'MarioRun'].every(name => {
        const patch = path.join(root, 'decomp-patches', `modhook-32-${name}.patch`);
        return fs.existsSync(patch) && fs.readFileSync(patch, 'utf8').includes('const_cast<TBGCheckData*>(mWallPlane)');
      });
    if (!compatible()) {
      if (!config.settings.autoUpdate) throw new Error('Your setup files need a Mac compatibility update. Open Settings → Manage game → Check for updates, then try again.');
      await updatePort();
      if (!compatible()) throw new Error('These setup files do not have the Mac compatibility fixes yet. Download the latest setup files and try again.');
    }
  }
  const settings = config.settings;
  if (settings.eclipse && !fs.existsSync(path.join(root, port.ECLIPSE_ISO))) await installEclipse();
  const disc = port.gameDisc(root, rom, settings.eclipse);
  keepPreviousBuildIfToolchainChanged(root, settings);
  const env = toolEnv(port.buildEnvironment(settings, disc, root));
  const cmd = settings.eclipse
    ? port.eclipseBuildCommand(root, settings, process.platform, env)
    : port.commandFor(root, 'build', [disc], process.platform, env);
  const result = await launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, settings.eclipse ? 'Build Eclipse port' : 'Build Sunshine port');
  config.builtGeneration[port.binaryPath(root, settings)] = config.portGeneration;
  saveConfig();
  return result;
}

async function setupGame() {
  const root = requireRepo();
  port.validateRom(config.rom);
  if (config.settings.textures && !port.texturePackInstalled(root)) await installTextures();
  if (!binaryReady()) await build();
  return state();
}

async function play() {
  const root = requireRepo();
  const settings = config.settings;
  const rom = port.validateRom(config.rom);
  if (!binaryReady(root, settings))
    throw new Error('Set up this version of the game before playing.');
  if (settings.textures && !port.texturePackInstalled(root))
    throw new Error('HD textures are on but have not been downloaded. Download them or turn them off in Settings.');
  const disc = port.gameDisc(root, rom, settings.eclipse);
  makeSaveBackup('before-play');
  const env = toolEnv({ ...port.buildEnvironment(settings, disc, root), SMS_SAVE_DIR: currentSaveDirectory() });
  const cmd = settings.eclipse
    ? port.eclipseRunCommand(root, settings, disc, process.platform, env)
    : port.commandFor(root, 'run', [disc], process.platform, env);
  try {
    return await launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, 'Play Super Mario Sunshine');
  } finally {
    try { makeSaveBackup('after-play'); }
    catch (error) { log(`Save backup failed: ${error.message}`); }
  }
}

async function launchGame() {
  const root = requireRepo();
  port.validateRom(config.rom);
  if (config.settings.textures && !port.texturePackInstalled(root))
    throw new Error('Download HD textures before playing, or turn them off in Settings.');
  if (!binaryReady(root)) await build();
  return play();
}

async function clean(dryRun) {
  await ensureBuildTools();
  const root = requireRepo();
  if (!dryRun && saves.cleanupWouldRemoveSaves(root, currentSaveDirectory()))
    throw new Error('Your memory card is inside a build folder. Move it outside the build folders before cleanup.');
  if (!dryRun) makeSaveBackup('before-cleanup');
  const env = toolEnv();
  delete env.SMS_ARCH;
  const cmd = port.commandFor(root, 'clean', dryRun ? ['--dry-run'] : [], process.platform, env);
  return launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, dryRun ? 'Preview cleanup' : 'Clean build output');
}

function state() {
  const info = port.platformInfo();
  let romError = '';
  if (config.rom) { try { port.validateRom(config.rom); } catch (error) { romError = error.message; } }
  const repoReady = port.isPort(config.repo);
  return {
    config, platform: info, repoReady,
    romReady: Boolean(config.rom) && !romError, romError,
    eclipseInstalled: repoReady && fs.existsSync(path.join(config.repo, port.ECLIPSE_ISO)),
    texturesInstalled: repoReady && port.texturePackInstalled(config.repo),
    binaryReady: repoReady && binaryReady(),
    tools: toolsStatus(),
    active: active ? { label: active.label, detail: active.detail,
      percent: active.percent, startedAt: active.startedAt, canStop: Boolean(active.child) } : null, appUpdate, logs: logLines,
    saveDirectory: currentSaveDirectory(), backupDirectory: saves.backupRoot(),
    backups: saves.listBackups().filter(item => item.source === currentSaveDirectory())
  };
}

function setupAppUpdater() {
  const url = process.env.SMS_LAUNCHER_UPDATE_URL;
  const bundledFeed = fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  if (!app.isPackaged || (!url && !bundledFeed) || (process.platform === 'linux' && !process.env.APPIMAGE)) {
    appUpdate = { state: 'unconfigured', message: app.isPackaged ? 'Launcher updates are unavailable for this install.' : 'Launcher updates come with new releases.' };
    return;
  }
  const { autoUpdater } = require('electron-updater');
  if (url) autoUpdater.setFeedURL({ provider: 'generic', url });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const set = (state, message) => { appUpdate = { state, message }; broadcast('app-update', appUpdate); };
  autoUpdater.on('checking-for-update', () => set('checking', 'Checking launcher updates…'));
  autoUpdater.on('update-available', () => set('downloading', 'Downloading launcher update…'));
  autoUpdater.on('update-not-available', () => set('current', 'Launcher is up to date.'));
  autoUpdater.on('download-progress', progress => set('downloading', `Downloading launcher update: ${Math.round(progress.percent)}%`));
  autoUpdater.on('update-downloaded', () => set('ready', 'Launcher update downloaded; it will install when you quit.'));
  autoUpdater.on('error', error => set('error', `Launcher update check failed: ${error.message}`));
  const check = () => { if (config.settings.autoUpdate) autoUpdater.checkForUpdates().catch(error => set('error', error.message)); };
  setTimeout(check, 10000);
  setInterval(check, 30 * 60 * 1000);
  ipcMain.handle('check-app-update', () => autoUpdater.checkForUpdates().then(() => appUpdate));
}

function registerHandlers() {
  const senderWindow = event => BrowserWindow.fromWebContents(event.sender);
  ipcMain.handle('window-state', event => {
    const target = senderWindow(event);
    return { fullscreen: target?.isFullScreen() || false, minimized: target?.isMinimized() || false };
  });
  ipcMain.handle('window-minimize', event => {
    const target = senderWindow(event);
    target?.minimize();
    return { minimized: target?.isMinimized() || false };
  });
  ipcMain.handle('window-toggle-full-screen', event => {
    const target = senderWindow(event);
    if (!target) return { fullscreen: false };
    target.setFullScreen(!target.isFullScreen());
    return { fullscreen: target.isFullScreen() };
  });
  ipcMain.handle('window-close', event => senderWindow(event)?.close());
  ipcMain.handle('state', async () => { await checkTools(); return state(); });
  ipcMain.handle('check-tools', async () => { await checkTools(true); return state(); });
  ipcMain.handle('copy-mac-command', (_event, index) => {
    if (process.platform !== 'darwin') throw new Error('This help is for macOS.');
    const commands = toolsStatus().commands.split('\n').filter(Boolean);
    if (!Number.isInteger(index) || !commands[index]) throw new Error('Check your Mac tools again.');
    clipboard.writeText(commands[index]);
  });
  ipcMain.handle('save-settings', (_event, input) => {
    config.settings = port.normalizeSettings(input);
    saveConfig();
    return state();
  });
  ipcMain.handle('choose-rom', async () => {
    const chosen = await dialog.showOpenDialog(window, {
      title: 'Choose a file from your own Super Mario Sunshine disc',
      properties: ['openFile'], filters: [{ name: 'Game disc files', extensions: ['iso', 'gcm', 'ciso'] }]
    });
    if (chosen.canceled) return state();
    config.rom = port.validateRom(chosen.filePaths[0]);
    saveConfig();
    return state();
  });
  ipcMain.handle('choose-repo', async () => {
    const chosen = await dialog.showOpenDialog(window, { title: 'Choose a folder with setup files', properties: ['openDirectory'] });
    if (chosen.canceled) return state();
    if (!port.isPort(chosen.filePaths[0])) throw new Error('That folder does not have the setup files this launcher needs.');
    config.repo = chosen.filePaths[0];
    config.portGeneration = 0;
    config.builtGeneration = {};
    saveConfig();
    return state();
  });
  ipcMain.handle('choose-location', async () => {
    const chosen = await dialog.showOpenDialog(window, { title: 'Choose where to download setup files', properties: ['openDirectory'] });
    if (chosen.canceled) return state();
    const destination = path.join(chosen.filePaths[0], 'sms-pc-port');
    if (fs.existsSync(destination) && (!fs.statSync(destination).isDirectory() || fs.readdirSync(destination).length))
      throw new Error('That location already has a game setup folder. Choose another location.');
    config.repo = destination;
    config.portGeneration = 0;
    config.builtGeneration = {};
    saveConfig();
    return state();
  });
  ipcMain.handle('install-port', installPort);
  ipcMain.handle('update-port', updatePort);
  ipcMain.handle('install-eclipse', installEclipse);
  ipcMain.handle('install-textures', installTextures);
  ipcMain.handle('build', build);
  ipcMain.handle('setup-game', setupGame);
  ipcMain.handle('play', play);
  ipcMain.handle('launch-game', launchGame);
  ipcMain.handle('clean-preview', () => clean(true));
  ipcMain.handle('backup-saves', () => makeSaveBackup('manual'));
  ipcMain.handle('restore-saves', async (_event, id) => {
    if (active) throw new Error('Stop the running game or task before restoring saves.');
    if (!saves.listBackups().some(item => item.id === id && item.source === currentSaveDirectory()))
      throw new Error('Choose a backup for this memory card.');
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', buttons: ['Cancel', 'Restore memory card'], defaultId: 0, cancelId: 0,
      message: 'Restore this backup?',
      detail: "We'll back up your current saves first, then replace matching files."
    });
    if (answer.response !== 1) return { cancelled: true };
    const result = saves.restoreBackup(id, currentSaveDirectory());
    log(`Restored ${result.restored} memory card file(s) from ${id}.`);
    return result;
  });
  ipcMain.handle('open-backups', () => {
    fs.mkdirSync(saves.backupRoot(), { recursive: true, mode: 0o700 });
    return shell.openPath(saves.backupRoot());
  });
  ipcMain.handle('clean', async () => {
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', buttons: ['Cancel', 'Free up space'], defaultId: 0, cancelId: 0,
      message: 'Remove files the launcher can make again?', detail: 'The next play may take longer. Your disc file and saved games will be kept.'
    });
    return answer.response === 1 ? clean(false) : { cancelled: true };
  });
  ipcMain.handle('stop', () => {
    if (!active) return false;
    if (!active.child) return false;
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(active.child.pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(-active.child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    return true;
  });
  ipcMain.handle('open-docs', () => shell.openPath(path.join(requireRepo(), 'BUILD.md')));
}

function createWindow() {
  window = new BrowserWindow({
    width: 1080, height: 760, minWidth: 900, minHeight: 700,
    frame: false, backgroundColor: '#0a3045', title: 'SMS Launcher',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.setMenuBarVisibility(false);
  const sendWindowState = () => broadcast('window-state', { fullscreen: window.isFullScreen() });
  window.on('enter-full-screen', sendWindowState);
  window.on('leave-full-screen', sendWindowState);
  window.loadFile(path.join(__dirname, 'index.html'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  registerHandlers();
  setupAppUpdater();
  setTimeout(() => {
    if (config.settings.autoUpdate && port.isPort(config.repo) && !active && !preparingTools)
      updatePort().catch(error => log(`Update check: ${error.message}`));
  }, 5000);
  setInterval(() => {
    if (config.settings.autoUpdate && port.isPort(config.repo) && !active && !preparingTools)
      updatePort().catch(error => log(`Update check: ${error.message}`));
  }, 30 * 60 * 1000);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
