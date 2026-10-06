'use strict';

const $ = id => document.getElementById(id);
let current;
let changing = false;
let wizardStep = null;
let setupPending = false;

function closeModal() {
  for (const dialog of document.querySelectorAll('.launcher-modal'))
    if (dialog.open) dialog.close();
}

function showSettingsView(name) {
  $('settings-view').hidden = name !== 'settings';
  $('maintenance-view').hidden = name !== 'maintenance';
  $('page-settings').setAttribute('aria-label', name === 'settings' ? 'Game settings' : 'Manage game');
}

$('settings-cog').addEventListener('click', () => {
  showSettingsView('settings');
  $('page-settings').showModal();
});
$('open-maintenance').addEventListener('click', () => {
  showSettingsView('maintenance');
  $('back-to-settings').focus();
});
$('back-to-settings').addEventListener('click', () => {
  showSettingsView('settings');
  $('open-maintenance').focus();
});
for (const button of document.querySelectorAll('[data-close-modal]'))
  button.addEventListener('click', () => button.closest('dialog').close());

function showActivityLog() {
  if (!$('activity-log').open) $('activity-log').showModal();
  const log = $('log');
  log.scrollTop = log.scrollHeight;
  log.focus();
}
for (const id of ['view-build-log', 'view-activity-log', 'message-view-log'])
  $(id).addEventListener('click', showActivityLog);

function setMessage(text, error = false) {
  const box = $('message');
  $('message-text').textContent = text || '';
  $('message-view-log').hidden = !error || !text;
  box.hidden = !text;
  box.classList.toggle('error', error);
}

function badge(id, label, good = false, warn = false) {
  const element = $(id);
  element.textContent = label;
  element.className = `badge${good ? ' good' : warn ? ' warn' : ''}`;
}

function taskName(label) {
  if (!label) return 'Nothing running';
  if (label === 'Play Super Mario Sunshine') return 'Game running';
  if (label.startsWith('Build ')) return 'Setting up your game';
  if (label.startsWith('Download port')) return 'Downloading setup files';
  if (label.startsWith('Download build') || label.startsWith('Prepare build') ||
      label.startsWith('Unpack build') || label.startsWith('Update private')) return 'Preparing build tools';
  if (label === 'Install HD cutscenes') return 'Preparing HD cutscenes';
  if (label.startsWith('Install UHD')) return 'Downloading HD textures';
  if (label.startsWith('Install Eclipse')) return 'Setting up Eclipse';
  if (label.startsWith('Check for port')) return 'Checking for updates';
  if (label.startsWith('Update port') || label.startsWith('Update decompilation')) return 'Updating setup files';
  if (label === 'Preview cleanup') return 'Checking removable files';
  if (label === 'Clean build output') return 'Freeing up space';
  return label;
}

function backupReason(reason) {
  return ({ manual: 'Manual backup', 'before-play': 'Before playing', 'after-play': 'After playing',
    'before-restore': 'Before restoring', 'before-cleanup': 'Before cleanup',
    'before-port-update': 'Before update', 'before-tools-change': 'Before changing build tools' })[reason] || 'Backup';
}

function needsTextureDownload(data) {
  return data.repoReady && !data.hdVisualsReady;
}

function wantsCutscenes(data) {
  const { cutscenes, textures, eclipse } = data.config.settings;
  return cutscenes && textures && !eclipse && (!data.repoReady || data.cutscenesSupported);
}

function requiredStep(data) {
  if (data.repoReady && data.romReady && (data.config.completedSetup || data.binaryReady)) return 0;
  if (!data.repoReady || !data.tools.ready) return 1;
  if (!data.romReady) return 2;
  if (!data.binaryReady || needsTextureDownload(data)) return 3;
  return 0;
}

function showWizardStep(data) {
  const required = requiredStep(data);
  if (required === 0) wizardStep = 0;
  else if (wizardStep === null || wizardStep === 0 || wizardStep > required) wizardStep = required;
  const ready = wizardStep === 0;
  const downloadTextures = ready && data.binaryReady && needsTextureDownload(data);
  $('page-home').classList.toggle('ready-mode', ready);
  $('setup-flow').hidden = ready;
  // Eclipse is chosen in Settings only: say so wherever it is installed or played.
  const eclipse = data.config.settings.eclipse;
  $('home-title').textContent = ready ? eclipse ? 'Super Mario Eclipse' : 'Super Mario Sunshine' : 'Set up your game';
  $('home-description').textContent = ready
    ? downloadTextures ? 'Set up HD visuals to finish setup.'
      : data.game.needsUpdate && data.config.settings.autoUpdate ? 'An update is ready. Your saves will carry over.' : 'Ready when you are.'
    : "Three steps, then you're ready to play.";
  const hd = [data.config.settings.textures && !data.texturesInstalled ? 'download HD textures' : '',
    wantsCutscenes(data) && !data.cutscenesInstalled ? 'prepare HD cutscenes using your disc image' : ''].filter(Boolean).join(' and ');
  $('setup-install-description').textContent = (hd
    ? `We'll ${hd}, then get the game ready to play. This can take a while.`
    : "We'll prepare a playable copy using your disc image. This can take a while.") +
    (eclipse ? ' Super Mario Eclipse (experimental) is on in Settings, so this sets up Eclipse instead of Super Mario Sunshine.' : '');
  $('setup-download-title').textContent = data.repoReady ? 'Download build tools' : 'Download setup files';
  $('setup-download-description').textContent = data.repoReady
    ? 'The setup files are ready. Download the tools needed to prepare your game.'
    : "We'll get the files and tools needed to prepare your own disc. The game is not included.";
  const needsMacTools = data.platform.id === 'macos' && !data.tools.appleReady;
  $('mac-setup-help').hidden = !needsMacTools;
  $('mac-tools-settings').hidden = data.platform.id !== 'macos';
  $('tool-location-note').textContent = data.platform.id === 'macos'
    ? data.tools.appleReady ? 'Build tools download to the launcher’s own folder.' : 'This Mac needs Apple’s tools first. Open Mac setup help to get started.'
    : "Any tools we download stay in the launcher's own folder.";
  if (needsMacTools) {
    $('setup-download-title').textContent = 'Prepare this Mac';
    $('setup-download-description').textContent = 'Check the tools needed before downloading and preparing your game.';
  }
  $('repo-location').hidden = data.repoReady;
  $('choose-location').hidden = data.repoReady;
  for (let step = 1; step <= 3; step++)
    $(`setup-step-${step}`).hidden = ready || step !== wizardStep;
  if (ready) $('play').textContent = downloadTextures
    ? setupPending || data.active?.label === 'Install UHD textures' || data.active?.label === 'Install HD cutscenes' ? 'Setting up…' : 'Finish HD setup'
    : data.game.needsUpdate && data.config.settings.autoUpdate
      ? '↻  Update & play' : !data.binaryReady ? '▶  Prepare & play' : '▶  Play';
  else {
    $('step-count').textContent = `Step ${wizardStep} of 3`;
    document.querySelectorAll('.setup-progress-track i').forEach((segment, index) => {
      segment.classList.toggle('complete', index + 1 < wizardStep);
      segment.classList.toggle('current', index + 1 === wizardStep);
    });
    $('play').textContent = setupPending
      ? wizardStep === 1 ? 'Downloading…' : wizardStep === 2 ? 'Choosing…' : 'Setting up…'
      : wizardStep === 1 ? needsMacTools ? 'Set up Mac tools' : data.repoReady && data.tools.ready ? 'Continue'
        : data.repoReady ? 'Download build tools' : 'Download setup files'
        : wizardStep === 2 ? data.romReady ? 'Continue' : 'Choose disc image' : 'Begin setup';
  }
}

function renderActivity(active) {
  const working = Boolean(active) && active.label !== 'Play Super Mario Sunshine';
  $('task-progress').hidden = !working;
  $('activity-label').textContent = taskName(active?.label);
  $('stop').hidden = !active?.canStop;
  $('stop').textContent = active?.label === 'Play Super Mario Sunshine' ? 'Stop game'
    : active?.label.startsWith('Build ') ? 'Stop build' : 'Stop task';
  $('view-build-log').textContent = active?.label.startsWith('Build ') ? 'View build log' : 'View activity';
  $('task-status').textContent = active ? taskName(active.label)
    : current?.binaryReady && needsTextureDownload(current) ? 'HD setup needed'
    : current?.game.needsUpdate && current.config.settings.autoUpdate && current.config.completedSetup ? 'Update ready'
    : $('page-home').classList.contains('ready-mode') ? 'Ready to play' : 'Finish setup to play';
  if (!working) return;
  $('progress-title').textContent = taskName(active.label);
  $('progress-detail').textContent = active.detail || 'Working…';
  const seconds = Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000));
  $('progress-time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const known = Number.isFinite(active.percent);
  $('progress-percent').textContent = known ? `${active.percent}%` : '';
  $('progress-track').classList.toggle('indeterminate', !known);
  $('progress-fill').style.width = known ? `${active.percent}%` : '';
  if (known) $('progress-track').setAttribute('aria-valuenow', String(active.percent));
  else $('progress-track').removeAttribute('aria-valuenow');
}

function refresh(data) {
  current = data;
  const { config, platform } = data;
  $('platform').textContent = platform.name;
  $('repo-path').textContent = config.repo;
  $('repo-path').title = config.repo;
  $('settings-repo-path').textContent = config.repo;
  $('settings-repo-path').title = config.repo;
  $('choose-location').disabled = Boolean(data.active);
  $('update-port').disabled = !data.repoReady || Boolean(data.active);
  $('rom-path').textContent = data.romError || config.rom || 'No file selected';
  $('rom-path').title = data.romError || config.rom;
  $('settings-rom-path').textContent = data.romError || config.rom || 'No disc file selected';
  $('settings-rom-path').title = data.romError || config.rom;
  $('choose-rom').hidden = !data.romReady;
  showWizardStep(data);
  renderMacTools(data.tools);
  $('play').disabled = Boolean(data.active) || setupPending;
  $('installed-play-option').hidden = !data.binaryReady || !data.romReady ||
    (!data.game.needsUpdate && !needsTextureDownload(data));
  $('skip-update-play').disabled = Boolean(data.active) || setupPending;
  $('skip-update-play').textContent = data.game.needsUpdate ? 'Skip update & play' : 'Play installed version';
  $('installed-play-note').textContent = `Play ${data.game.installedVersion ? `game ${data.game.installedVersion}` : 'your installed game'} now. Update or finish HD setup when you're ready.`;
  for (const button of document.querySelectorAll('[data-setup-back]')) button.disabled = Boolean(data.active) || setupPending;
  $('build').hidden = !data.binaryReady || !data.romReady;
  $('rebuild-note').hidden = $('build').hidden;
  $('build').disabled = Boolean(data.active);
  const gb = bytes => (Math.ceil(bytes / 1e8) / 10).toFixed(1);
  const finish = data.binaryReady ? 'Close Settings and choose Finish HD setup.' : '';
  badge('textures-badge', data.texturesInstalled ? 'Installed' : 'Not installed', data.texturesInstalled,
    config.settings.textures && !data.texturesInstalled);
  $('texture-info').textContent = data.texturesInstalled
    ? config.settings.textures ? 'HD textures are ready.' : 'Already downloaded. Turn on to use them.'
    : `${config.settings.textures ? `${finish || 'HD textures will download during setup.'} ` : ''}About 1 GB to download; allow 3 GB of free space for setup.`;
  // The movie pack's size comes from the game's own list of movies.
  const movies = data.cutsceneRequirements;
  $('cutscenes-description').textContent =
    `Sharper Sunshine movies, made from your own disc. About ${movies ? gb(movies.downloadBytes) : '5.4'} GB to download.`;
  badge('cutscenes-badge', config.settings.eclipse ? 'Sunshine only' : !config.settings.textures ? 'Needs HD textures'
    : data.cutscenesInstalled ? 'Installed' : 'Not installed',
    data.cutscenesInstalled && !config.settings.eclipse, wantsCutscenes(data) && !data.cutscenesInstalled);
  $('cutscene-info').textContent = config.settings.eclipse ? 'Eclipse plays its own movies.'
    : config.settings.cutscenes && !config.settings.textures ? 'Turn on HD textures to play HD cutscenes.'
    : data.cutscenesInstalled ? config.settings.cutscenes ? 'HD cutscenes are ready for Sunshine.' : 'Already set up. Turn on to use them.'
      : !config.settings.cutscenes ? ''
        : data.repoReady && !data.cutscenesSupported ? 'Update the game to add HD cutscenes.'
          : `${finish || 'HD cutscenes will be made from your disc during setup.'}${movies ? ` Allow ${gb(movies.freeBytes)} GB of free space for setup.` : ''}`;
  $('cutscene-info').hidden = !$('cutscene-info').textContent;
  badge('eclipse-badge', data.eclipseInstalled ? 'Installed' : platform.id === 'linux' ? 'Optional' : 'Experimental', data.eclipseInstalled, platform.id !== 'linux');
  $('eclipse-platform-note').textContent = platform.id === 'linux' ? '' : 'Eclipse has been tested on Linux. It may not work yet on this computer.';
  $('eclipse-note').hidden = !config.settings.eclipse;
  $('install-eclipse').disabled = !data.repoReady || !data.romReady || Boolean(data.active);
  $('clean').disabled = !data.repoReady || Boolean(data.active);
  $('clean-preview').disabled = !data.repoReady || Boolean(data.active);
  $('choose-rom').disabled = Boolean(data.active);
  $('choose-rom-settings').disabled = Boolean(data.active);
  $('choose-repo-settings').disabled = Boolean(data.active);
  renderActivity(data.active);
  renderAppUpdate(data.appUpdate);
  const installedVersion = data.binaryReady ? data.game.installedVersion : null;
  const gameVersion = installedVersion || (data.binaryReady ? 'Version unavailable' : 'Not installed');
  $('version-summary').textContent = `Launcher v${data.game.launcherVersion} · Game ${installedVersion || (data.binaryReady ? 'version unavailable' : 'not installed')}`;
  $('launcher-version').textContent = `v${data.game.launcherVersion}`;
  $('installed-game-version').textContent = gameVersion;
  $('available-game-version-row').hidden = installedVersion === data.game.availableVersion;
  $('available-game-version').textContent = data.game.availableVersion;
  $('tool-version').textContent = data.game.toolVersion;
  $('tool-version-note').textContent = [data.tools.ready || data.tools.privateInstalled ? 'Downloaded' : 'Not downloaded',
    data.game.installedToolVersion && data.game.installedToolVersion !== data.game.toolVersion
      ? `Game built with ${data.game.installedToolVersion}` : ''].filter(Boolean).join(' · ');
  $('game-update-note').textContent = !data.binaryReady
    ? `Game ${data.game.availableVersion} will be installed during setup.` : data.game.needsUpdate
    ? `Game ${data.game.availableVersion} is ready to set up. Your current version stays available until setup succeeds.`
    : 'Your game is up to date.';
  $('play-installed').hidden = !data.binaryReady || (!data.game.needsUpdate && !needsTextureDownload(data));
  $('play-installed').disabled = Boolean(data.active) || !data.romReady || setupPending;
  $('play-previous').hidden = !data.game.previousReady;
  $('play-previous').disabled = Boolean(data.active);
  $('save-path').textContent = `Saved games: ${data.saveDirectory}\nBackups: ${data.backupDirectory}`;
  $('backup-saves').disabled = Boolean(data.active);
  $('restore-saves').disabled = Boolean(data.active) || !data.backups.length;
  const selectedBackup = $('backup-list').value;
  $('backup-list').replaceChildren(...data.backups.map(backup => {
    const option = document.createElement('option');
    option.value = backup.id;
    option.textContent = `${new Date(backup.createdAt).toLocaleString()} · ${backupReason(backup.reason)} · ${backup.count} files`;
    return option;
  }));
  if (data.backups.some(backup => backup.id === selectedBackup)) $('backup-list').value = selectedBackup;
  $('backup-list').disabled = Boolean(data.active) || !data.backups.length;

  changing = true;
  $('arch').replaceChildren(...platform.arches.map(arch => {
    const option = document.createElement('option'); option.value = arch;
    option.textContent = arch === '64' && platform.arches.length > 1 ? '64-bit (recommended)' : `${arch}-bit`;
    return option;
  }));
  for (const key of ['arch', 'widescreen', 'resolution', 'volume']) $(key).value = String(config.settings[key]);
  renderVolume();
  for (const key of ['fps60', 'fullscreen', 'invertCameraX', 'invertCameraY', 'hudEdges', 'textures', 'cutscenes', 'eclipse', 'autoUpdate']) $(key).checked = config.settings[key];
  renderUpdateChannels(config.settings.updateChannel);
  renderGameSource(data);
  for (const key of ['arch', 'widescreen', 'resolution', 'volume', 'fps60', 'fullscreen', 'invertCameraX', 'invertCameraY', 'hudEdges', 'textures', 'cutscenes', 'eclipse', 'autoUpdate', 'updateChannel'])
    $(key).disabled = Boolean(data.active);
  changing = false;
}

let updateChannels = [{ id: 'stable', label: 'Stable' }];
function renderUpdateChannels(chosen) {
  const list = updateChannels.some(item => item.id === chosen) ? updateChannels
    : updateChannels.concat({ id: chosen, label: chosen, missing: true });
  $('updateChannel').replaceChildren(...list.map(item => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.missing ? `${item.label} (no longer available)` : item.label;
    if (item.detail) option.title = item.detail;
    return option;
  }));
  $('updateChannel').value = chosen;
}
async function loadUpdateChannels() {
  try { updateChannels = await window.sms.updateChannels(); }
  catch (_) { return; }
  if (current) { changing = true; renderUpdateChannels(current.config.settings.updateChannel); changing = false; }
}

const sourceFields = { port: ['source-port-repository', 'source-port-ref'], decomp: ['source-decomp-repository', 'source-decomp-ref'] };
let sourceShown = false;
function renderGameSource(data) {
  const chosen = data.gameSource;
  // Fill the fields from the saved choice once, so typing is never overwritten.
  if (!sourceShown) {
    sourceShown = true;
    for (const [part, [repository, ref]] of Object.entries(sourceFields)) {
      $(repository).value = chosen?.override[part]?.repository || '';
      $(ref).value = chosen?.override[part]?.ref || '';
    }
    $('game-source').open = Boolean(chosen);
  }
  $('game-source-note').textContent = chosen
    ? `Building from ${chosen.version}. Update game to build it, or to follow a branch's newest commit.`
    : `Using this launcher's release (game ${data.game.availableVersion}).`;
  for (const id of ['apply-game-source', 'reset-game-source', ...Object.values(sourceFields).flat()])
    $(id).disabled = Boolean(data.active);
  $('reset-game-source').hidden = !chosen;
}
function gameSourceValue() {
  const value = {};
  for (const [part, [repository, ref]] of Object.entries(sourceFields))
    value[part] = { repository: $(repository).value, ref: $(ref).value };
  return value;
}
async function setGameSource(value) {
  setMessage('');
  try { refresh(await window.sms.setGameSource(value)); }
  catch (error) { showError(error); }
}
$('apply-game-source').addEventListener('click', () => setGameSource(gameSourceValue()));
$('reset-game-source').addEventListener('click', () => {
  for (const id of Object.values(sourceFields).flat()) $(id).value = '';
  setGameSource(null);
});

async function sync() { refresh(await window.sms.state()); }

function renderMacTools(tools) {
  const requirements = (tools.requirements || []).filter(item => !tools.managed || !item.package);
  if (tools.managed) requirements.push({ label: 'Launcher build tools', ready: tools.privateInstalled, automatic: true });
  $('mac-requirements').replaceChildren(...requirements.map(item => {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = item.label;
    const status = document.createElement('span');
    status.className = `badge${item.ready ? ' good' : item.optional ? '' : ' warn'}`;
    status.textContent = item.ready ? 'Ready' : item.automatic ? 'Download in Step 1' : item.optional ? 'Optional' : 'Needed';
    row.append(name, status);
    return row;
  }));
  const commands = (tools.commands || '').split('\n').filter(Boolean);
  $('mac-apple-command').replaceChildren();
  $('mac-extra-commands').replaceChildren();
  commands.forEach((command, index) => {
    const row = document.createElement('div');
    row.className = 'mac-command';
    const code = document.createElement('code');
    code.textContent = command;
    const copy = document.createElement('button');
    copy.className = 'subtle'; copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      try { await window.sms.copyMacCommand(index); copy.textContent = 'Copied'; }
      catch (error) { showError(error); }
    });
    row.append(code, copy);
    (command.startsWith('xcode-select') ? $('mac-apple-command') : $('mac-extra-commands')).append(row);
  });
  $('mac-apple-note').hidden = !commands.some(command => command.startsWith('xcode-select'));
  $('mac-extra-note').hidden = !commands.some(command => !command.startsWith('xcode-select'));
  $('mac-check-result').textContent = tools.appleReady || tools.ready ? 'Ready. Close this help and continue setup.'
    : tools.checked ? 'Some tools still need to be installed.' : 'Checking tools…';
}

function showMacHelp() {
  closeModal();
  $('mac-tools-help').showModal();
}

for (const id of ['mac-setup-help', 'mac-tools-settings']) $(id).addEventListener('click', showMacHelp);
$('check-mac-tools').addEventListener('click', async () => {
  $('check-mac-tools').disabled = true;
  $('mac-check-result').textContent = 'Checking tools…';
  try { refresh(await window.sms.checkTools()); }
  catch (error) { showError(error); }
  finally { $('check-mac-tools').disabled = false; }
});

function showError(error) { closeModal(); setMessage(error.message || String(error), true); }

async function action(method) {
  setMessage('');
  try {
    if (['installPort', 'installEclipse', 'installTextures', 'build', 'setupGame', 'launchGame', 'updatePort', 'play', 'playPrevious', 'clean', 'cleanPreview'].includes(method)) closeModal();
    const result = await window.sms[method]();
    if (result && result.config) refresh(result);
    await sync();
    if (['installPort', 'chooseRepo'].includes(method) && current.repoReady && current.tools.ready && wizardStep === 1) wizardStep = 2;
    if (method === 'chooseRom' && current.romReady && wizardStep === 2) wizardStep = 3;
    refresh(current);
  } catch (error) { showError(error); await sync(); }
}

function runWizardAction(method) {
  setupPending = true;
  refresh(current);
  action(method).finally(() => { setupPending = false; if (current) refresh(current); });
}

function renderVolume() { $('volume-value').textContent = `${$('volume').value}%`; }

function settingsValue() {
  return {
    arch: $('arch').value, widescreen: $('widescreen').value, resolution: Number($('resolution').value), volume: Number($('volume').value),
    fps60: $('fps60').checked, fullscreen: $('fullscreen').checked,
    invertCameraX: $('invertCameraX').checked, invertCameraY: $('invertCameraY').checked, hudEdges: $('hudEdges').checked, textures: $('textures').checked, cutscenes: $('cutscenes').checked,
    eclipse: $('eclipse').checked, autoUpdate: $('autoUpdate').checked, updateChannel: $('updateChannel').value
  };
}

async function saveSettings() {
  if (changing) return;
  try { refresh(await window.sms.saveSettings(settingsValue())); }
  // A refused change (a task started) must not stay shown as if it were saved.
  catch (error) { if (current) refresh(current); showError(error); }
}

function appendLog(line) {
  const log = $('log');
  const following = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  if (log.textContent === 'Ready.') log.textContent = '';
  log.textContent += `${line}\n`;
  if (log.textContent.length > 50000) log.textContent = log.textContent.slice(-40000);
  if (following) log.scrollTop = log.scrollHeight;
}

for (const [id, method] of Object.entries({
  'choose-rom': 'chooseRom', 'choose-rom-settings': 'chooseRom',
  'choose-repo-settings': 'chooseRepo', 'choose-location': 'chooseLocation',
  'update-port': 'updatePort', 'play-installed': 'play', 'skip-update-play': 'play', 'play-previous': 'playPrevious', 'build': 'build', 'install-eclipse': 'installEclipse',
  'clean-preview': 'cleanPreview', clean: 'clean', 'backup-saves': 'backupSaves',
  'open-backups': 'openBackups', stop: 'stop', docs: 'openDocs'
})) $(id).addEventListener('click', () => action(method));
$('play').addEventListener('click', () => {
  if (wizardStep === 0) runWizardAction('launchGame');
  else if (wizardStep === 1) {
    if (current.platform.id === 'macos' && !current.tools.appleReady) { showMacHelp(); return; }
    if (current.repoReady && current.tools.ready) { wizardStep = 2; refresh(current); }
    else runWizardAction('installPort');
  } else if (wizardStep === 2) {
    if (current.romReady) { wizardStep = 3; refresh(current); }
    else runWizardAction('chooseRom');
  } else runWizardAction('setupGame');
});
for (const button of document.querySelectorAll('[data-setup-back]')) button.addEventListener('click', () => {
  if (wizardStep > 1) { wizardStep -= 1; refresh(current); }
});
$('restore-saves').addEventListener('click', async () => {
  setMessage('');
  try { await window.sms.restoreSaves($('backup-list').value); await sync(); }
  catch (error) { showError(error); await sync(); }
});
for (const key of ['arch', 'widescreen', 'resolution', 'volume', 'fps60', 'fullscreen', 'invertCameraX', 'invertCameraY', 'hudEdges', 'textures', 'cutscenes', 'eclipse', 'autoUpdate', 'updateChannel'])
  $(key).addEventListener('change', saveSettings);
$('volume').addEventListener('input', renderVolume);
$('open-maintenance').addEventListener('click', loadUpdateChannels);
window.sms.onLog(appendLog);
window.sms.onActivity(value => {
  const changed = Boolean(value) !== Boolean(current?.active);
  if (current) current.active = value;
  renderActivity(value);
  // Lock the settings now: the next state (sync) can take a while to arrive.
  if (changed && current) refresh(current);
  if (changed) sync().catch(showError);
});
function renderAppUpdate(value) {
  $('app-update').textContent = value.message;
  $('install-app-update').hidden = value.state !== 'ready';
}
window.sms.onAppUpdate(renderAppUpdate);
$('install-app-update').addEventListener('click', () => window.sms.installAppUpdate().catch(showError));
function renderWindowState(value) {
  const fullscreen = Boolean(value.fullscreen);
  $('window-fullscreen').setAttribute('aria-pressed', String(fullscreen));
  $('window-fullscreen').setAttribute('aria-label', fullscreen ? 'Exit full screen' : 'Enter full screen');
  $('window-fullscreen').title = fullscreen ? 'Exit full screen' : 'Enter full screen';
}
$('window-minimize').addEventListener('click', () => window.sms.minimizeWindow());
$('window-fullscreen').addEventListener('click', () => window.sms.toggleFullScreen().then(renderWindowState).catch(showError));
$('window-close').addEventListener('click', () => window.sms.closeWindow());
window.sms.onWindowState(renderWindowState);
window.sms.windowState().then(renderWindowState).catch(showError);
setInterval(() => { if (current?.active) renderActivity(current.active); }, 1000);
sync().then(() => { for (const line of current.logs) appendLog(line); }).catch(showError);
