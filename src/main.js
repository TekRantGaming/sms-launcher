'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const port = require('./port');

let window;
let config;
let active = null;
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
  if (!port.isPort(config.repo)) throw new Error('Install the port or choose an existing sms-port checkout first.');
  return config.repo;
}

function launch(command, args, options = {}, label = 'Task') {
  if (active) throw new Error(`Wait for ${active.label} to finish, or stop it first.`);
  return new Promise((resolve, reject) => {
    log(`▶ ${label}`);
    const child = spawn(command, args, { ...options, detached: process.platform !== 'win32',
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    active = { label, child };
    broadcast('activity', { label });
    child.stdout.on('data', bytes => log(bytes.toString()));
    child.stderr.on('data', bytes => log(bytes.toString()));
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
    child.on('close', code => done(null, code));
  });
}

async function capture(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)));
  });
}

async function updatePort() {
  const root = requireRepo();
  if (!fs.existsSync(path.join(root, '.git'))) throw new Error('This port folder is not a Git checkout, so it cannot update automatically.');
  await launch('git', ['fetch', '--recurse-submodules=no'], { cwd: root }, 'Check for port updates');
  const tracking = await capture('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root);
  const counts = await capture('git', ['rev-list', '--left-right', '--count', `HEAD...${tracking}`], root);
  const [ahead, behind] = counts.split(/\s+/).map(Number);
  if (behind === 0) { log('Port source is up to date.'); return { updated: false, behind: 0 }; }
  if (ahead > 0) throw new Error(`Local branch has ${ahead} unpublished commit(s) and ${behind} upstream commit(s). Resolve that branch before updating.`);
  await launch('git', ['merge', '--ff-only', tracking], { cwd: root }, `Update port (${behind} commits)`);
  config.portGeneration += 1;
  saveConfig();
  await launch('git', ['submodule', 'update', '--init', 'decomp'], { cwd: root }, 'Update decompilation');
  log('Port updated. Rebuild before playing. Restart the launcher if its source changed.');
  return { updated: true, behind };
}

async function installPort() {
  const destination = path.resolve(config.repo);
  if (fs.existsSync(destination)) {
    if (port.isPort(destination)) throw new Error('The port is already installed here.');
    if (!fs.statSync(destination).isDirectory() || fs.readdirSync(destination).length)
      throw new Error('The selected port folder has other files. Change the download location.');
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await launch('git', ['clone', '--branch', 'eclipse', '--recurse-submodules', port.PORT_URL, destination], { cwd: path.dirname(destination) }, 'Download port source');
  return { ok: true };
}

async function installEclipse() {
  const root = requireRepo();
  const rom = port.validateRom(config.rom);
  const cmd = port.commandFor(root, 'python', [rom]);
  return launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, 'Install Eclipse from your disc');
}

async function build() {
  const root = requireRepo();
  const rom = port.validateRom(config.rom);
  const settings = config.settings;
  if (settings.eclipse && !fs.existsSync(path.join(root, port.ECLIPSE_ISO))) await installEclipse();
  const disc = port.gameDisc(root, rom, settings.eclipse);
  const env = port.buildEnvironment(settings, disc);
  const cmd = settings.eclipse
    ? port.eclipseBuildCommand(root, settings, process.platform, env)
    : port.commandFor(root, 'build', [disc], process.platform, env);
  const result = await launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, settings.eclipse ? 'Build Eclipse port' : 'Build Sunshine port');
  config.builtGeneration[port.binaryPath(root, settings)] = config.portGeneration;
  saveConfig();
  return result;
}

async function play() {
  const root = requireRepo();
  const settings = config.settings;
  const rom = port.validateRom(config.rom);
  const binary = port.binaryPath(root, settings);
  if (!fs.existsSync(binary) || (config.portGeneration && config.builtGeneration[binary] !== config.portGeneration))
    throw new Error('Build this configuration before playing.');
  const disc = port.gameDisc(root, rom, settings.eclipse);
  const env = port.buildEnvironment(settings, disc);
  const cmd = settings.eclipse
    ? port.eclipseRunCommand(root, settings, disc, process.platform, env)
    : port.commandFor(root, 'run', [disc], process.platform, env);
  return launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, 'Play Super Mario Sunshine');
}

async function clean(dryRun) {
  const root = requireRepo();
  const env = { ...process.env };
  delete env.SMS_ARCH;
  const cmd = port.commandFor(root, 'clean', dryRun ? ['--dry-run'] : [], process.platform, env);
  return launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, dryRun ? 'Preview cleanup' : 'Clean build output');
}

function state() {
  const info = port.platformInfo();
  let romError = '';
  if (config.rom) { try { port.validateRom(config.rom); } catch (error) { romError = error.message; } }
  const binary = port.isPort(config.repo) ? port.binaryPath(config.repo, config.settings) : '';
  return {
    config, platform: info, repoReady: port.isPort(config.repo),
    romReady: Boolean(config.rom) && !romError, romError,
    eclipseInstalled: port.isPort(config.repo) && fs.existsSync(path.join(config.repo, port.ECLIPSE_ISO)),
    binaryReady: Boolean(binary) && fs.existsSync(binary)
      && (!config.portGeneration || config.builtGeneration[binary] === config.portGeneration),
    active: active ? { label: active.label } : null, appUpdate, logs: logLines
  };
}

function setupAppUpdater() {
  const url = process.env.SMS_LAUNCHER_UPDATE_URL;
  const bundledFeed = fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  if (!app.isPackaged || (!url && !bundledFeed) || (process.platform === 'linux' && !process.env.APPIMAGE)) {
    appUpdate = { state: 'unconfigured', message: app.isPackaged ? 'Launcher update feed is not configured.' : 'Port source updates automatically; launcher release feed is not configured.' };
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
  ipcMain.handle('state', () => state());
  ipcMain.handle('save-settings', (_event, input) => {
    config.settings = port.normalizeSettings(input);
    saveConfig();
    return state();
  });
  ipcMain.handle('choose-rom', async () => {
    const chosen = await dialog.showOpenDialog(window, {
      title: 'Choose your own Super Mario Sunshine disc image',
      properties: ['openFile'], filters: [{ name: 'GameCube disc image', extensions: ['iso', 'gcm', 'ciso'] }]
    });
    if (chosen.canceled) return state();
    config.rom = port.validateRom(chosen.filePaths[0]);
    saveConfig();
    return state();
  });
  ipcMain.handle('choose-repo', async () => {
    const chosen = await dialog.showOpenDialog(window, { title: 'Choose an existing sms-port checkout', properties: ['openDirectory'] });
    if (chosen.canceled) return state();
    if (!port.isPort(chosen.filePaths[0])) throw new Error('That folder is not an sms-port checkout.');
    config.repo = chosen.filePaths[0];
    config.portGeneration = 0;
    config.builtGeneration = {};
    saveConfig();
    return state();
  });
  ipcMain.handle('choose-location', async () => {
    const chosen = await dialog.showOpenDialog(window, { title: 'Choose where to download the port', properties: ['openDirectory'] });
    if (chosen.canceled) return state();
    const destination = path.join(chosen.filePaths[0], 'sms-pc-port');
    if (fs.existsSync(destination) && (!fs.statSync(destination).isDirectory() || fs.readdirSync(destination).length))
      throw new Error('That location already contains an sms-pc-port folder. Choose another parent folder.');
    config.repo = destination;
    config.portGeneration = 0;
    config.builtGeneration = {};
    saveConfig();
    return state();
  });
  ipcMain.handle('install-port', installPort);
  ipcMain.handle('update-port', updatePort);
  ipcMain.handle('install-eclipse', installEclipse);
  ipcMain.handle('build', build);
  ipcMain.handle('play', play);
  ipcMain.handle('clean-preview', () => clean(true));
  ipcMain.handle('clean', async () => {
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', buttons: ['Cancel', 'Clean build output'], defaultId: 0, cancelId: 0,
      message: 'Remove generated builds?', detail: 'The port clean script keeps your disc image and saved games.'
    });
    return answer.response === 1 ? clean(false) : { cancelled: true };
  });
  ipcMain.handle('stop', () => {
    if (!active) return false;
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(active.child.pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(-active.child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    return true;
  });
  ipcMain.handle('open-docs', () => shell.openPath(path.join(requireRepo(), 'BUILD.md')));
}

function createWindow() {
  window = new BrowserWindow({
    width: 1080, height: 780, minWidth: 760, minHeight: 600,
    backgroundColor: '#111c29', title: 'SMS Launcher',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.setMenuBarVisibility(false);
  window.loadFile(path.join(__dirname, 'index.html'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  registerHandlers();
  setupAppUpdater();
  setTimeout(() => {
    if (config.settings.autoUpdate && port.isPort(config.repo) && !active)
      updatePort().catch(error => log(`Update check: ${error.message}`));
  }, 5000);
  setInterval(() => {
    if (config.settings.autoUpdate && port.isPort(config.repo) && !active)
      updatePort().catch(error => log(`Update check: ${error.message}`));
  }, 30 * 60 * 1000);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
