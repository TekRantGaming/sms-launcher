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
  button.addEventListener('click', closeModal);

function setMessage(text, error = false) {
  const box = $('message');
  box.textContent = text || '';
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
    'before-port-update': 'Before update' })[reason] || 'Backup';
}

function requiredStep(data) {
  if (data.repoReady && data.romReady && data.binaryReady &&
      (!data.config.settings.textures || data.texturesInstalled)) return 0;
  if (!data.repoReady || !data.tools.ready) return 1;
  if (!data.romReady) return 2;
  if (!data.binaryReady || (data.config.settings.textures && !data.texturesInstalled)) return 3;
  return 0;
}

function showWizardStep(data) {
  const required = requiredStep(data);
  if (required === 0) wizardStep = 0;
  else if (wizardStep === null || wizardStep === 0 || wizardStep > required) wizardStep = required;
  const ready = wizardStep === 0;
  $('page-home').classList.toggle('ready-mode', ready);
  $('setup-flow').hidden = ready;
  $('home-title').textContent = ready ? 'Super Mario Sunshine' : 'Set up your game';
  $('home-description').textContent = ready ? 'Ready when you are.' : "Three steps, then you're ready to play.";
  $('setup-download-title').textContent = data.repoReady ? 'Download build tools' : 'Download setup files';
  $('setup-download-description').textContent = data.repoReady
    ? 'The setup files are ready. Download the tools needed to prepare your game.'
    : "We'll get the files and tools needed to prepare your own disc. The game is not included.";
  const needsMacTools = data.platform.id === 'macos' && !data.tools.ready;
  $('mac-setup-help').hidden = !needsMacTools;
  $('mac-tools-settings').hidden = data.platform.id !== 'macos';
  $('tool-location-note').textContent = data.platform.id === 'macos'
    ? data.tools.ready ? 'Mac tools are ready.' : 'This Mac needs a one-time tools setup. Open Mac setup help to get started.'
    : "Any tools we download stay in the launcher's own folder.";
  if (needsMacTools) {
    $('setup-download-title').textContent = 'Prepare this Mac';
    $('setup-download-description').textContent = 'Check the tools needed before downloading and preparing your game.';
  }
  $('repo-location').hidden = data.repoReady;
  $('choose-location').hidden = data.repoReady;
  for (let step = 1; step <= 3; step++)
    $(`setup-step-${step}`).hidden = ready || step !== wizardStep;
  if (ready) $('play').textContent = '▶  Play';
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
  $('task-status').textContent = active ? taskName(active.label)
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
  for (const button of document.querySelectorAll('[data-setup-back]')) button.disabled = Boolean(data.active) || setupPending;
  $('build').hidden = !data.binaryReady || !data.romReady;
  $('rebuild-note').hidden = $('build').hidden;
  $('build').disabled = Boolean(data.active);
  badge('textures-badge', data.texturesInstalled ? 'Installed' : 'Not installed', data.texturesInstalled,
    config.settings.textures && !data.texturesInstalled);
  $('texture-info').textContent = data.texturesInstalled ? 'Ready for the next time you play.'
    : 'About 1 GB to download; needs about 3 GB of free space.';
  $('install-textures').hidden = data.texturesInstalled;
  $('install-textures').disabled = !data.repoReady || Boolean(data.active);
  badge('eclipse-badge', data.eclipseInstalled ? 'Installed' : platform.id === 'linux' ? 'Optional' : 'Experimental', data.eclipseInstalled, platform.id !== 'linux');
  $('eclipse-platform-note').textContent = platform.id === 'linux' ? '' : 'Eclipse has been tested on Linux. It may not work yet on this computer.';
  $('eclipse-note').hidden = !config.settings.eclipse;
  $('install-eclipse').disabled = !data.repoReady || !data.romReady || Boolean(data.active);
  $('clean').disabled = !data.repoReady || Boolean(data.active);
  $('clean-preview').disabled = !data.repoReady || Boolean(data.active);
  $('choose-rom').disabled = Boolean(data.active);
  $('choose-rom-settings').disabled = Boolean(data.active);
  $('choose-repo-settings').disabled = Boolean(data.active);
  $('stop').hidden = !data.active?.canStop;
  $('activity-label').textContent = taskName(data.active?.label);
  renderActivity(data.active);
  $('app-update').textContent = data.appUpdate.message;
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
    const option = document.createElement('option'); option.value = arch; option.textContent = `${arch} bit`; return option;
  }));
  for (const key of ['arch', 'widescreen', 'resolution']) $(key).value = String(config.settings[key]);
  for (const key of ['fps60', 'hudEdges', 'textures', 'eclipse', 'autoUpdate']) $(key).checked = config.settings[key];
  changing = false;
}

async function sync() { refresh(await window.sms.state()); }

function renderMacTools(tools) {
  const requirements = tools.requirements || [];
  $('mac-requirements').replaceChildren(...requirements.map(item => {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = item.label;
    const status = document.createElement('span');
    status.className = `badge${item.ready ? ' good' : item.optional ? '' : ' warn'}`;
    status.textContent = item.ready ? 'Ready' : item.optional ? 'Optional' : 'Needed';
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
  $('mac-homebrew-help').hidden = !tools.needsHomebrew;
  $('mac-check-result').textContent = tools.ready ? 'Ready. Close this help and continue setup.'
    : tools.checked ? 'Some tools still need to be installed.' : 'Checking tools…';
}

function showMacHelp() {
  closeModal();
  $('mac-tools-help').showModal();
}

for (const id of ['mac-setup-help', 'mac-tools-settings']) $(id).addEventListener('click', showMacHelp);
$('open-homebrew-help').addEventListener('click', () => action('openMacToolHelp'));
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
    if (['installPort', 'installEclipse', 'installTextures', 'build', 'setupGame', 'launchGame', 'updatePort', 'clean', 'cleanPreview'].includes(method)) closeModal();
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

function settingsValue() {
  return {
    arch: $('arch').value, widescreen: $('widescreen').value, resolution: Number($('resolution').value),
    fps60: $('fps60').checked, hudEdges: $('hudEdges').checked, textures: $('textures').checked,
    eclipse: $('eclipse').checked, autoUpdate: $('autoUpdate').checked
  };
}

async function saveSettings() {
  if (changing) return;
  try { refresh(await window.sms.saveSettings(settingsValue())); }
  catch (error) { showError(error); }
}

function appendLog(line) {
  const log = $('log');
  if (log.textContent === 'Ready.') log.textContent = '';
  log.textContent += `${line}\n`;
  if (log.textContent.length > 50000) log.textContent = log.textContent.slice(-40000);
  log.scrollTop = log.scrollHeight;
}

for (const [id, method] of Object.entries({
  'choose-rom': 'chooseRom', 'choose-rom-settings': 'chooseRom',
  'choose-repo-settings': 'chooseRepo', 'choose-location': 'chooseLocation',
  'update-port': 'updatePort', 'build': 'build', 'install-eclipse': 'installEclipse', 'install-textures': 'installTextures',
  'clean-preview': 'cleanPreview', clean: 'clean', 'backup-saves': 'backupSaves',
  'open-backups': 'openBackups', stop: 'stop', docs: 'openDocs'
})) $(id).addEventListener('click', () => action(method));
$('play').addEventListener('click', () => {
  if (wizardStep === 0) action('launchGame');
  else if (wizardStep === 1) {
    if (current.platform.id === 'macos' && !current.tools.ready) { showMacHelp(); return; }
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
for (const key of ['arch', 'widescreen', 'resolution', 'fps60', 'hudEdges', 'textures', 'eclipse', 'autoUpdate'])
  $(key).addEventListener('change', saveSettings);
window.sms.onLog(appendLog);
window.sms.onActivity(value => {
  const changed = Boolean(value) !== Boolean(current?.active);
  if (current) current.active = value;
  renderActivity(value);
  if (changed) sync().catch(showError);
});
window.sms.onAppUpdate(value => { $('app-update').textContent = value.message; });
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
