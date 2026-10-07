'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const port = require('./port');
const saves = require('./saves');
const gciSave = require('./gci-save');
const buildTools = require('./build-tools');
const game = require('./game-version');
const updateChannel = require('./update-channel');
const bindings = require('./bindings');
const gameSource = require('./game-source');
const { cleanOutputLine, crashReason, createActivityReader, createLineReader, failureReason } = require('./progress');

const DISCORD_INVITE = 'https://discord.gg/NvUXmm8dB9';

let window;
let config;
let active = null;
let preparingTools = false;
let operation = null;
let appUpdate = { state: 'idle', message: '' };
let updater = null;
const logLines = [];
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

function broadcast(channel, data) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, data);
}

function activityState() {
  const task = active || operation;
  return task ? { label: task.label, detail: task.detail, percent: task.percent,
    startedAt: task.startedAt, canStop: Boolean(active?.child) } : null;
}

function log(message) {
  const lines = String(message).replace(/\r/g, '').split('\n');
  for (const line of lines) {
    if (!line) continue;
    const value = cleanOutputLine(line);
    logLines.push(value);
    if (logLines.length > 700) logLines.shift();
    broadcast('log', value);
  }
}

// A game source chosen under Settings, with the commits it resolved to.
function savedGameSource(saved) {
  try {
    const override = gameSource.normalizeOverride(saved?.override);
    const resolved = saved?.resolved;
    if (!override || !/^[a-f0-9]{40}$/.test(resolved?.commit) || !/^[a-f0-9]{40}$/.test(resolved?.decomp)) return null;
    return { override, resolved: { ...resolved, custom: true, override } };
  } catch (_) { return null; }
}

function currentSource() { return config.gameSource?.resolved || game.release; }

async function chooseGameSource(input) {
  await ensureBuildTools();
  const override = gameSource.normalizeOverride(input);
  if (!override) {
    config.gameSource = null;
    saveConfig();
    log(`Game source: this launcher release (${game.release.version}). Update game to switch back.`);
    return state();
  }
  const resolved = await gameSource.resolve(override, { capture, env: toolEnv() });
  config.gameSource = { override, resolved };
  saveConfig();
  log(`Game source: ${resolved.repository} at ${resolved.commit.slice(0, 12)}, decomp ${resolved.decompRepository || 'pinned by it'} at ${resolved.decomp.slice(0, 12)}. Update game to build it.`);
  return state();
}

// Update game follows a chosen branch to its newest commit.
async function refreshGameSource() {
  if (!config.gameSource) return;
  try {
    const resolved = await gameSource.resolve(config.gameSource.override, { capture, env: toolEnv() });
    if (resolved.commit !== config.gameSource.resolved.commit || resolved.decomp !== config.gameSource.resolved.decomp) {
      config.gameSource = { ...config.gameSource, resolved };
      saveConfig();
      log(`Game source moved to ${resolved.version}.`);
    }
  } catch (error) { log(`Could not check the chosen game source for changes: ${error.message}`); }
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
    settings: port.normalizeSettings(port.savedSettings(saved.settings, typeof saved.repo === 'string' ? saved.repo : defaultRepo())),
    installRoot: typeof saved.installRoot === 'string' ? saved.installRoot : null,
    saveDirectory: typeof saved.saveDirectory === 'string' ? saved.saveDirectory : null,
    previousInstall: saved.previousInstall || null,
    completedSetup: Boolean(saved.completedSetup),
    gameSource: savedGameSource(saved.gameSource)
  };
  for (const root of [config.repo, config.previousInstall?.repo].filter(Boolean))
    for (const arch of port.platformInfo().arches)
      for (const eclipse of [false, true]) {
        try { if (game.recoverBuild(root, { arch, eclipse })) log('Recovered your previous game after interrupted setup.'); }
        catch (error) { log(`Game recovery: ${error.message}`); }
      }
  config.completedSetup ||= fs.existsSync(port.binaryPath(config.repo, config.settings));
}

async function exclusive(label, callback) {
  if (operation || active || preparingTools) throw new Error('Wait for the current task to finish, or stop it first.');
  operation = { label, detail: 'Starting…', percent: null, startedAt: Date.now() };
  broadcast('activity', operation);
  try { return await callback(); }
  finally { operation = null; broadcast('activity', null); }
}

function requireRepo() {
  if (!port.isPort(config.repo)) throw new Error('Download the setup files or choose a folder that already has them.');
  return config.repo;
}

function currentSaveDirectory() {
  return process.env.SMS_SAVE_DIR ? saves.saveDirectory(config.repo) : config.saveDirectory || saves.saveDirectory(config.repo);
}

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
    broadcast('activity', activityState());
    const recent = [], readActivity = createActivityReader();
    function line(value) {
      if (!value) return;
      log(value);
      if (recent.push(value) > 80) recent.shift();
      const progress = readActivity(value);
      if (progress && active && active.child === child) {
        Object.assign(active, progress);
        broadcast('activity', activityState());
      }
    }
    const stdout = createLineReader(line), stderr = createLineReader(line);
    child.stdout.on('data', bytes => stdout.write(bytes));
    child.stderr.on('data', bytes => stderr.write(bytes));
    let settled = false;
    function done(error, code, signal) {
      if (settled) return;
      settled = true;
      active = null;
      broadcast('activity', activityState());
      if (error || code !== 0) {
        const crash = error ? null : crashReason(code, signal);
        const reason = error || crash ? '' : failureReason(recent);
        const message = error ? error.message : crash ? `${label} ${crash}. See the activity log.`
          : `${label} exited with code ${code}${reason ? `: ${reason}` : ''}. See the activity log.`;
        log(`✕ ${message}`);
        reject(new Error(message));
      } else {
        log(`✓ ${label} finished`);
        resolve({ ok: true });
      }
    }
    child.on('error', error => done(error));
    child.on('close', (code, signal) => {
      stdout.end();
      stderr.end();
      done(null, code, signal);
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
  requireRepo();
  port.validateRom(config.rom);
  await ensureBuildTools();
  await refreshGameSource();
  if (game.isCurrent(config.repo, config.settings, currentSource())) {
    log(config.gameSource ? 'Your game is up to date with the chosen game source.' : 'Your game is up to date for this launcher release.');
    return state();
  }
  await build();
  return state();
}

async function installPort() {
  await ensureBuildTools();
  const destination = config.repo;
  if (port.isPort(destination)) return { ok: true };
  if (fs.existsSync(destination)) {
    if (!fs.statSync(destination).isDirectory() || fs.readdirSync(destination).length)
      throw new Error('That folder is not empty. Choose another download location.');
    fs.rmdirSync(destination);
  }
  await game.checkout(destination, { run: launch, capture, env: toolEnv(), source: currentSource() });
  return { ok: true };
}

async function installEclipse(root = requireRepo()) {
  await ensureBuildTools();
  const rom = port.validateRom(config.rom);
  const cmd = port.commandFor(root, 'python', [rom], process.platform, toolEnv());
  return launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, 'Install Eclipse from your disc');
}

async function installTextures(root = requireRepo()) {
  await ensureBuildTools();
  if (config.settings.textures && !port.texturePackInstalled(root)) {
    const cmd = port.commandFor(root, 'textures', [], process.platform, toolEnv());
    await launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, 'Install UHD textures');
    if (!port.texturePackInstalled(root)) throw new Error('Texture installer finished without a usable texture pack.');
  } else if (config.settings.textures) log('HD textures are already installed.');
  if (port.wantsCutscenes(config.settings) && port.cutscenePackSupported(root) && !port.cutscenePackInstalled(root)) {
    const rom = port.validateRom(config.rom);
    const cmd = port.commandFor(root, 'cutscenes', [rom], process.platform, toolEnv());
    await launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, 'Install HD cutscenes');
    if (!port.cutscenePackInstalled(root)) throw new Error('HD cutscene setup finished without a complete movie pack. Please retry.');
  }
  log('HD visuals are ready for the next game launch.');
  return { installed: true };
}

function binaryReady(root = config.repo, settings = config.settings) {
  return port.isPort(root) && fs.existsSync(port.binaryPath(root, settings));
}

async function build(forceFresh = false) {
  const original = requireRepo();
  const settings = { ...config.settings };
  const rom = port.validateRom(config.rom);
  const saveDirectory = currentSaveDirectory();
  makeSaveBackup('before-port-update');
  await ensureBuildTools();
  const source = currentSource();
  let root = original;
  const sourceMarker = path.join(root, 'launcher-source.json');
  const freshPinnedSource = fs.existsSync(sourceMarker) && !binaryReady(root, settings) && game.matchesSource(root, source);
  if (forceFresh || (!game.isCurrent(root, settings, source) && !freshPinnedSource)) {
    root = game.snapshotPath(config.installRoot || original, settings, source);
    if (forceFresh || (fs.existsSync(root) && !game.matchesSource(root, source))) root += `.fresh-${Date.now()}`;
    if (!fs.existsSync(root)) await game.checkout(root, { run: launch, capture, env: toolEnv(), reference: original, source });
    if (!game.matchesSource(root, source))
      throw new Error('The update folder has changed. Choose another setup location in Settings and try again.');
    game.carryUserFiles(original, root);
  }
  if (!port.hdVisualsInstalled(root, settings)) await installTextures(root);
  if (settings.eclipse && !fs.existsSync(path.join(root, port.ECLIPSE_ISO))) await installEclipse(root);
  const disc = port.gameDisc(root, rom, settings.eclipse);
  const env = toolEnv(port.buildEnvironment(settings, disc, root));
  env.NINJA_STATUS = '[%f/%t] ';
  const cmd = settings.eclipse
    ? port.eclipseBuildCommand(root, settings, process.platform, env)
    : port.commandFor(root, 'build', [disc], process.platform, env);
  const result = await game.buildSafely(root, settings, saveDirectory,
    () => launch(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env }, settings.eclipse ? 'Build Eclipse port' : 'Build Sunshine port'),
    undefined, source);
  // Preferences switch only after a successful build. Closing the app or a
  // failed download/build leaves the last installation selected and playable.
  const earlier = { ...config };
  config = { ...config, repo: root, installRoot: config.installRoot || original,
    saveDirectory, completedSetup: true,
    previousInstall: root !== original && binaryReady(original, settings)
      ? { repo: original, settings, rom, saveDirectory } : config.previousInstall };
  try { saveConfig(); }
  catch (error) { config = earlier; throw error; }
  log(`Game ${source.version} is ready. Your saved games stay in the same folder.`);
  return result;
}

async function setupGame() {
  requireRepo();
  port.validateRom(config.rom);
  if (!game.isCurrent(config.repo, config.settings, currentSource())) await build();
  else if (!port.hdVisualsInstalled(config.repo, config.settings)) await installTextures();
  return state();
}

async function play(installation = null) {
  const root = installation?.repo || requireRepo();
  // Camera and key controls and volume are the player's, not the build's: an earlier install plays with them too.
  const settings = installation ? { ...installation.settings, volume: config.settings.volume, invertCameraX: config.settings.invertCameraX,
    invertCameraY: config.settings.invertCameraY, keyBindings: config.settings.keyBindings } : config.settings;
  const rom = port.validateRom(installation?.rom || config.rom);
  if (!binaryReady(root, settings)) throw new Error('Set up this version of the game before playing.');
  if (!port.hdVisualsInstalled(root, settings))
    throw new Error('HD visuals need to be set up. Return to the main screen to finish setup, or turn them off in Settings.');
  const disc = port.gameDisc(root, rom, settings.eclipse);
  makeSaveBackup('before-play');
  const saveDir = saves.prepareSaveDirectory(currentSaveDirectory());
  const recordedTools = game.installed(root, settings)?.toolRoot || game.compilerToolRoot(root, settings);
  const env = recordedTools
    ? buildTools.environmentAtRoot(recordedTools, { ...port.buildEnvironment(settings, disc, root), SMS_SAVE_DIR: saveDir })
    : toolEnv({ ...port.buildEnvironment(settings, disc, root), SMS_SAVE_DIR: saveDir });
  // Changed keys go to a file of the launcher's own, so a bindings.txt kept by hand in the game folder is left alone.
  if (Object.keys(settings.keyBindings || {}).length) {
    const file = path.join(app.getPath('userData'), 'bindings.txt');
    fs.writeFileSync(file, bindings.fileText(settings.keyBindings));
    env.SMS_BINDINGS = file;
  }
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
  requireRepo();
  port.validateRom(config.rom);
  if (!binaryReady() || (config.settings.autoUpdate && !game.isCurrent(config.repo, config.settings, currentSource()))) await build();
  if (!port.hdVisualsInstalled(config.repo, config.settings)) await installTextures();
  return play();
}

async function playInstalled() {
  const root = requireRepo();
  // Playing without setup uses only packs already on disk. Keep the player's
  // preferences so choosing setup later still installs the requested visuals.
  const settings = { ...config.settings,
    textures: config.settings.textures && port.texturePackInstalled(root),
    cutscenes: config.settings.cutscenes && port.cutscenePackInstalled(root) };
  if (settings.textures !== config.settings.textures || settings.cutscenes !== config.settings.cutscenes)
    log('Playing the installed game without missing HD downloads. Your visual settings are saved for later setup.');
  return play({ repo: root, settings });
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
  const ready = repoReady && binaryReady();
  const installedBuild = ready ? game.installed(config.repo, config.settings) : null;
  return {
    config, platform: info, repoReady,
    romReady: Boolean(config.rom) && !romError, romError,
    eclipseInstalled: repoReady && fs.existsSync(path.join(config.repo, port.ECLIPSE_ISO)),
    hdVisualsReady: repoReady && port.hdVisualsInstalled(config.repo, config.settings),
    texturesInstalled: repoReady && port.texturePackInstalled(config.repo),
    cutscenesInstalled: repoReady && port.cutscenePackInstalled(config.repo),
    cutscenesSupported: repoReady && port.cutscenePackSupported(config.repo),
    cutsceneRequirements: repoReady ? port.cutscenePackRequirements(config.repo) : null,
    binaryReady: ready,
    tools: toolsStatus(),
    gameSource: config.gameSource ? { override: config.gameSource.override, version: config.gameSource.resolved.version } : null,
    game: { launcherVersion: app.getVersion(), availableVersion: currentSource().version,
      installedVersion: installedBuild?.gameVersion || null,
      installedToolVersion: installedBuild?.toolVersion || null,
      toolVersion: buildTools.toolsetFor(), needsUpdate: repoReady && !game.isCurrent(config.repo, config.settings, currentSource()),
      previousReady: Boolean(config.previousInstall && binaryReady(config.previousInstall.repo, config.previousInstall.settings)) },
    active: activityState(), appUpdate, logs: logLines,
    saveDirectory: currentSaveDirectory(), backupDirectory: saves.backupRoot(),
    backups: saves.listBackups().filter(item => item.source === currentSaveDirectory())
  };
}

// Stable never sees a pre-release. Beta and pull request previews are opt-in,
// and may be older than what is installed, so leaving one can go back down.
function applyUpdateChannel() {
  if (!updater) return;
  const channel = config.settings.updateChannel;
  const url = process.env.SMS_LAUNCHER_UPDATE_URL;
  updater.setFeedURL(url ? { provider: 'generic', url } : updateChannel.feedFor(channel));
  updater.channel = 'latest';
  updater.allowPrerelease = channel !== 'stable';
  updater.allowDowngrade = channel !== 'stable' || app.getVersion().includes('-');
}

async function checkAppUpdate() {
  if (!updater) return appUpdate;
  try { await updater.checkForUpdates(); }
  catch (error) {
    const missing = config.settings.updateChannel !== 'stable' && /\b404\b/.test(error.message);
    appUpdate = { state: 'error', message: missing
      ? `${updateChannel.channelLabel(config.settings.updateChannel)} is no longer available. Choose another update channel in Settings.`
      : `Launcher update check failed: ${error.message}` };
    broadcast('app-update', appUpdate);
  }
  return appUpdate;
}

async function updateChannels() {
  let releases = [];
  try {
    const response = await net.fetch(`https://api.github.com/repos/${updateChannel.REPOSITORY}/releases?per_page=100`,
      { headers: { Accept: 'application/vnd.github+json' } });
    if (response.ok) releases = await response.json();
  } catch (_) { /* offline: Stable and the current choice are still offered */ }
  const channels = updateChannel.channelsFromReleases(releases);
  const chosen = config.settings.updateChannel;
  if (!channels.some(item => item.id === chosen))
    channels.push({ id: chosen, label: updateChannel.channelLabel(chosen), detail: 'No longer available', missing: true });
  return channels;
}

function setupAppUpdater() {
  const url = process.env.SMS_LAUNCHER_UPDATE_URL;
  const bundledFeed = fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  if (!app.isPackaged || (!url && !bundledFeed) || (process.platform === 'linux' && !process.env.APPIMAGE)) {
    appUpdate = { state: 'unconfigured', message: app.isPackaged ? 'Launcher updates are unavailable for this install.' : 'Launcher updates come with new releases.' };
    ipcMain.handle('check-app-update', () => appUpdate);
    return;
  }
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  applyUpdateChannel();
  const set = (state, message) => { appUpdate = { state, message }; broadcast('app-update', appUpdate); };
  updater.on('checking-for-update', () => set('checking', 'Checking launcher updates…'));
  updater.on('update-available', info => set('downloading', `Downloading launcher ${info.version}…`));
  updater.on('update-not-available', () => set('current', 'Launcher is up to date.'));
  updater.on('download-progress', progress => set('downloading', `Downloading launcher update: ${Math.round(progress.percent)}%`));
  updater.on('update-downloaded', info => set('ready', `Launcher ${info.version} downloaded; it will install when you quit.`));
  updater.on('error', error => set('error', `Launcher update check failed: ${error.message}`));
  const check = () => { if (config.settings.autoUpdate) checkAppUpdate(); };
  setTimeout(check, 10000);
  setInterval(check, 30 * 60 * 1000);
  ipcMain.handle('check-app-update', () => checkAppUpdate());
  ipcMain.handle('install-app-update', () => {
    if (appUpdate.state !== 'ready') throw new Error('No launcher update is ready to install.');
    if (operation || active) throw new Error('Finish the current task or close the game before installing the update.');
    // Install silently, then relaunch from the installer itself. Opening the
    // launcher by hand while the installer still runs gets that copy closed.
    updater.quitAndInstall(true, true);
  });
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
    if (operation || active) throw new Error('Finish the current task before changing settings.');
    const settings = port.normalizeSettings(input);
    if (settings.arch !== config.settings.arch || settings.eclipse !== config.settings.eclipse)
      config.previousInstall = port.playableInstall({ ...config, saveDirectory: currentSaveDirectory() }) || config.previousInstall;
    const channelChanged = settings.updateChannel !== config.settings.updateChannel;
    config.settings = settings;
    saveConfig();
    if (channelChanged) {
      applyUpdateChannel();
      log(`Launcher updates now follow ${updateChannel.channelLabel(settings.updateChannel)}.`);
      checkAppUpdate();
    }
    return state();
  });
  ipcMain.handle('update-channels', () => updateChannels());
  ipcMain.handle('choose-rom', async () => {
    if (operation || active) throw new Error('Finish the current task before changing game files.');
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
    if (operation || active) throw new Error('Finish the current task before changing game files.');
    const chosen = await dialog.showOpenDialog(window, { title: 'Choose a folder with setup files', properties: ['openDirectory'] });
    if (chosen.canceled) return state();
    if (!port.isPort(chosen.filePaths[0])) throw new Error('That folder does not have the setup files this launcher needs.');
    config.repo = chosen.filePaths[0];
    config.installRoot = null;
    config.saveDirectory = null;
    config.previousInstall = null;
    config.completedSetup = fs.existsSync(port.binaryPath(config.repo, config.settings));
    saveConfig();
    return state();
  });
  ipcMain.handle('choose-location', async () => {
    if (operation || active) throw new Error('Finish the current task before changing game files.');
    const chosen = await dialog.showOpenDialog(window, { title: 'Choose where to download setup files', properties: ['openDirectory'] });
    if (chosen.canceled) return state();
    const destination = path.join(chosen.filePaths[0], 'sms-pc-port');
    if (fs.existsSync(destination) && (!fs.statSync(destination).isDirectory() || fs.readdirSync(destination).length))
      throw new Error('That location already has a game setup folder. Choose another location.');
    config.repo = destination;
    config.installRoot = null;
    config.saveDirectory = null;
    config.previousInstall = null;
    config.completedSetup = fs.existsSync(port.binaryPath(config.repo, config.settings));
    saveConfig();
    return state();
  });
  const actions = { 'install-port': ['Download port source', installPort],
    'update-port': ['Update game', updatePort], 'install-eclipse': ['Install Eclipse', () => installEclipse()],
    'install-textures': ['Install UHD textures', () => installTextures()], 'build': ['Build game', () => build(true)],
    'setup-game': ['Build game', setupGame], 'play': ['Play Super Mario Sunshine', playInstalled],
    'launch-game': ['Prepare game', launchGame],
    'play-previous': ['Play Super Mario Sunshine', () => {
      if (!config.previousInstall) throw new Error('There is no previous version available.');
      return play(config.previousInstall);
    }] };
  for (const [channel, [label, callback]] of Object.entries(actions))
    ipcMain.handle(channel, () => exclusive(label, callback));
  ipcMain.handle('set-game-source', (_event, input) => exclusive('Choose game source', () => chooseGameSource(input)));
  ipcMain.handle('clean-preview', () => exclusive('Preview cleanup', () => clean(true)));
  ipcMain.handle('backup-saves', () => exclusive('Back up saves', () => makeSaveBackup('manual')));
  ipcMain.handle('import-dolphin-save', (_event, file) => exclusive('Import Dolphin save', async () => {
    if (file == null) {
      const chosen = await dialog.showOpenDialog(window, { title: 'Import Dolphin save',
        properties: ['openFile'], filters: [{ name: 'Dolphin save', extensions: ['gci'] }] });
      if (chosen.canceled || !chosen.filePaths.length) return { cancelled: true };
      file = chosen.filePaths[0];
    }
    const converted = gciSave.readGci(file);
    const directory = currentSaveDirectory();
    const existing = fs.existsSync(path.join(directory, `${converted.name}.dat`));
    const warning = converted.badBlocks.length
      ? `\n\nSave checksums failed in block(s) ${converted.badBlocks.join(', ')}. Some blocks may be unused or damaged; the game may be unable to load this save.` : '';
    const answer = await dialog.showMessageBox(window, {
      type: existing || warning ? 'warning' : 'question',
      buttons: ['Cancel', 'Import save'], defaultId: 0, cancelId: 0,
      message: existing ? 'Replace your Sunshine save with this Dolphin save?' : 'Import this Dolphin save?',
      detail: `${path.basename(file)}\n\nDestination: ${directory}\n\nThis imports the whole Sunshine save, including all three save slots. Your current memory card will be backed up first. The original .gci file is kept.${warning}`
    });
    if (answer.response !== 1) return { cancelled: true };
    const result = gciSave.importGci(converted, directory);
    log(`Imported Dolphin save into ${directory}.${result.previous ? ` Previous saves: ${result.previous}` : ''}`);
    return result;
  }));
  ipcMain.handle('restore-saves', async (_event, id) => {
    if (operation || active) throw new Error('Stop the running game or task before restoring saves.');
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
  ipcMain.handle('clean', () => exclusive('Clean build output', async () => {
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', buttons: ['Cancel', 'Free up space'], defaultId: 0, cancelId: 0,
      message: 'Remove files the launcher can make again?', detail: 'The next play may take longer. Your disc file and saved games will be kept.'
    });
    return answer.response === 1 ? clean(false) : { cancelled: true };
  }));
  ipcMain.handle('stop', () => {
    if (!active) return false;
    if (!active.child) return false;
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(active.child.pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(-active.child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    return true;
  });
  ipcMain.handle('open-docs', () => shell.openPath(path.join(requireRepo(), 'BUILD.md')));
  // Only this fixed invite opens: the page never chooses a URL.
  ipcMain.handle('open-discord', () => shell.openExternal(DISCORD_INVITE));
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

if (ownsInstance) app.whenReady().then(() => {
  loadConfig();
  createWindow();
  registerHandlers();
  setupAppUpdater();
  // The bundled manifest is the update check. Source downloads and builds
  // start with Update & play, so opening the launcher never changes a game.
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

app.on('before-quit', () => {
  // Stop an in-flight compiler before another launcher process can recover it.
  if (!active?.child || active.label === 'Play Super Mario Sunshine') return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(active.child.pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(-active.child.pid, 'SIGTERM'); } catch (_) { /* already exited */ } }
});
