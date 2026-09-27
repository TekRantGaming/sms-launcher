'use strict';

const $ = id => document.getElementById(id);
let current;
let changing = false;

function closeModal() {
  for (const dialog of document.querySelectorAll('.launcher-modal'))
    if (dialog.open) dialog.close();
}

function showModal(name) {
  closeModal();
  $('page-' + name).showModal();
}

for (const button of document.querySelectorAll('[data-modal]'))
  button.addEventListener('click', () => showModal(button.dataset.modal));
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

function renderActivity(active) {
  const working = Boolean(active) && active.label !== 'Play Super Mario Sunshine';
  $('task-progress').hidden = !working;
  $('task-status').textContent = active ? active.label === 'Play Super Mario Sunshine' ? 'Game running' : active.label : 'Idle';
  if (!working) return;
  $('progress-title').textContent = active.label;
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
  $('platform').textContent = `${platform.name} · ${platform.arches.join(' / ')} bit`;
  $('repo-path').textContent = config.repo;
  $('repo-path').title = config.repo;
  badge('repo-badge', data.repoReady ? 'Ready' : 'Needed', data.repoReady);
  $('install-port').hidden = data.repoReady;
  $('install-port').disabled = Boolean(data.active);
  $('choose-location').hidden = data.repoReady;
  $('choose-location').disabled = Boolean(data.active);
  $('update-port').disabled = !data.repoReady || Boolean(data.active);
  $('rom-path').textContent = data.romError || config.rom || 'Choose your own GMSE01 Rev 0 ISO, GCM, or CISO.';
  $('rom-path').title = data.romError || config.rom;
  $('choose-rom').textContent = data.romReady ? 'Change image' : 'Choose image';
  badge('rom-badge', data.romReady ? 'Ready' : data.romError ? 'Invalid image' : 'Needed', data.romReady, Boolean(data.romError));
  const texturesNeeded = config.settings.textures && !data.texturesInstalled;
  const ready = data.repoReady && data.romReady && data.binaryReady && !texturesNeeded;
  badge('build-badge', !data.repoReady ? 'Port needed' : !data.romReady ? 'Disc needed'
    : texturesNeeded ? 'Textures needed' : data.binaryReady ? 'Ready' : 'Build needed', ready, texturesNeeded);
  $('launch-description').textContent = !data.repoReady ? 'Download the port to get started.'
    : !data.romReady ? 'Choose your own disc image to continue.'
      : texturesNeeded ? 'HD textures are selected. Install the pack before playing.'
        : !data.binaryReady ? 'Build the game for this computer, then play.' : 'Your game is ready.';
  $('play').textContent = !data.repoReady ? 'Download port' : !data.romReady ? 'Choose image'
    : texturesNeeded ? 'Install textures' : !data.binaryReady ? 'Build & play' : '▶  Play';
  $('play').disabled = Boolean(data.active);
  $('build').hidden = !data.binaryReady || !data.romReady;
  $('launch-secondary').hidden = $('build').hidden;
  $('build').disabled = Boolean(data.active);
  badge('textures-badge', data.texturesInstalled ? 'Installed' : 'Not installed', data.texturesInstalled, texturesNeeded);
  $('texture-info').textContent = data.texturesInstalled ? 'The installed pack will load on your next game start when enabled.'
    : 'Downloads from the pack authors: about 1 GB, using about 3 GB after install. Requires 7-Zip.';
  $('install-textures').hidden = data.texturesInstalled;
  $('install-textures').disabled = !data.repoReady || Boolean(data.active);
  $('texture-status').textContent = !data.repoReady ? 'HD textures: choose a port first.'
    : data.texturesInstalled ? `HD textures: installed, ${config.settings.textures ? 'on' : 'off'}.`
      : config.settings.textures ? 'HD textures: install required before playing.' : 'HD textures: off and not installed.';
  badge('eclipse-badge', data.eclipseInstalled ? 'Installed' : platform.id === 'linux' ? 'Optional' : 'Experimental', data.eclipseInstalled, platform.id !== 'linux');
  $('eclipse-platform-note').textContent = platform.id === 'linux' ? '' : 'The port has only verified Eclipse builds on Linux so far.';
  $('eclipse-note').hidden = !config.settings.eclipse;
  $('install-eclipse').disabled = !data.repoReady || !data.romReady || Boolean(data.active);
  $('clean').disabled = !data.repoReady || Boolean(data.active);
  $('clean-preview').disabled = !data.repoReady || Boolean(data.active);
  $('choose-rom').disabled = Boolean(data.active);
  $('choose-repo').disabled = Boolean(data.active);
  $('stop').hidden = !data.active;
  $('activity-label').textContent = data.active ? data.active.label : 'Idle';
  renderActivity(data.active);
  $('app-update').textContent = data.appUpdate.message;
  $('save-path').textContent = `Save folder: ${data.saveDirectory}\nBackups: ${data.backupDirectory}`;
  $('backup-saves').disabled = Boolean(data.active);
  $('restore-saves').disabled = Boolean(data.active) || !data.backups.length;
  const selectedBackup = $('backup-list').value;
  $('backup-list').replaceChildren(...data.backups.map(backup => {
    const option = document.createElement('option');
    option.value = backup.id;
    option.textContent = `${new Date(backup.createdAt).toLocaleString()} · ${backup.reason} · ${backup.count} files`;
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

function showError(error) { closeModal(); setMessage(error.message || String(error), true); }

async function action(method) {
  setMessage('');
  try {
    if (['installPort', 'installEclipse', 'installTextures', 'build', 'launchGame', 'updatePort', 'clean', 'cleanPreview'].includes(method)) closeModal();
    const result = await window.sms[method]();
    if (result && result.config) refresh(result);
    await sync();
  } catch (error) { showError(error); await sync(); }
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
  'choose-rom': 'chooseRom', 'choose-repo': 'chooseRepo', 'choose-location': 'chooseLocation', 'install-port': 'installPort',
  'update-port': 'updatePort', 'build': 'build', 'install-eclipse': 'installEclipse', 'install-textures': 'installTextures',
  'clean-preview': 'cleanPreview', clean: 'clean', 'backup-saves': 'backupSaves',
  'open-backups': 'openBackups', stop: 'stop', docs: 'openDocs'
})) $(id).addEventListener('click', () => action(method));
$('play').addEventListener('click', () => {
  if (!current.repoReady) action('installPort');
  else if (!current.romReady) action('chooseRom');
  else if (current.config.settings.textures && !current.texturesInstalled) action('installTextures');
  else action('launchGame');
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
setInterval(() => { if (current?.active) renderActivity(current.active); }, 1000);
sync().then(() => { for (const line of current.logs) appendLog(line); }).catch(showError);
