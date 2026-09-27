'use strict';

const $ = id => document.getElementById(id);
let current;
let changing = false;

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

function refresh(data) {
  current = data;
  const { config, platform } = data;
  $('platform').textContent = `${platform.name} · ${platform.arches.join(' / ')} bit`;
  $('repo-path').textContent = config.repo;
  badge('repo-badge', data.repoReady ? 'Ready' : 'Needed', data.repoReady);
  $('install-port').disabled = data.repoReady || Boolean(data.active);
  $('choose-location').hidden = data.repoReady;
  $('choose-location').disabled = Boolean(data.active);
  $('update-port').disabled = !data.repoReady || Boolean(data.active);
  $('rom-path').textContent = data.romError || config.rom || 'Choose your own North American GMSE01 Rev 0 .iso, .gcm, or .ciso file. It stays where it is.';
  badge('rom-badge', data.romReady ? 'Ready' : data.romError ? 'Invalid image' : 'Needed', data.romReady, Boolean(data.romError));
  badge('build-badge', !data.romReady ? 'Image needed' : data.binaryReady ? 'Ready to play' : 'Build needed', data.binaryReady && data.romReady);
  badge('eclipse-badge', data.eclipseInstalled ? 'Installed' : platform.id === 'linux' ? 'Optional' : 'Experimental', data.eclipseInstalled, platform.id !== 'linux');
  $('eclipse-platform-note').textContent = platform.id === 'linux' ? '' : 'The port has only verified Eclipse builds on Linux so far.';
  $('build').disabled = !data.repoReady || !data.romReady || Boolean(data.active);
  $('play').disabled = !data.binaryReady || !data.romReady || Boolean(data.active);
  $('install-eclipse').disabled = !data.repoReady || !data.romReady || Boolean(data.active);
  $('clean').disabled = !data.repoReady || Boolean(data.active);
  $('clean-preview').disabled = !data.repoReady || Boolean(data.active);
  $('choose-rom').disabled = Boolean(data.active);
  $('choose-repo').disabled = Boolean(data.active);
  $('stop').hidden = !data.active;
  $('activity-label').textContent = data.active ? data.active.label : 'Idle';
  $('app-update').textContent = data.appUpdate.message;

  changing = true;
  $('arch').replaceChildren(...platform.arches.map(arch => {
    const option = document.createElement('option'); option.value = arch; option.textContent = `${arch} bit`; return option;
  }));
  for (const key of ['arch', 'widescreen', 'resolution']) $(key).value = String(config.settings[key]);
  for (const key of ['fps60', 'hudEdges', 'textures', 'eclipse', 'autoUpdate']) $(key).checked = config.settings[key];
  changing = false;
}

async function sync() { refresh(await window.sms.state()); }

function showError(error) { setMessage(error.message || String(error), true); }

async function action(method) {
  setMessage('');
  try {
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
  try { refresh(await window.sms.saveSettings(settingsValue())); setMessage('Settings saved. Build the selected version if needed.'); }
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
  'update-port': 'updatePort', 'build': 'build', 'play': 'play', 'install-eclipse': 'installEclipse',
  'clean-preview': 'cleanPreview', clean: 'clean', stop: 'stop', docs: 'openDocs'
})) $(id).addEventListener('click', () => action(method));
for (const key of ['arch', 'widescreen', 'resolution', 'fps60', 'hudEdges', 'textures', 'eclipse', 'autoUpdate'])
  $(key).addEventListener('change', saveSettings);
window.sms.onLog(appendLog);
window.sms.onActivity(() => sync().catch(showError));
window.sms.onAppUpdate(value => { $('app-update').textContent = value.message; });
sync().then(() => { for (const line of current.logs) appendLog(line); }).catch(showError);
