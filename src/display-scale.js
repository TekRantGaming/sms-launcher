'use strict';

const SCALE_LIMIT = 1.55;
const WM_DPICHANGED = 0x02E0, WM_ENTERSIZEMOVE = 0x0231, WM_EXITSIZEMOVE = 0x0232;
const ZOOM_KEYS = new Set(['0', '-', '=', '+']);
const ZOOM_CODES = new Set(['Digit0', 'Minus', 'Equal', 'Numpad0', 'NumpadSubtract', 'NumpadAdd']);

// Above 155% Windows display scaling, the launcher zooms out to look as it does at 155%.
function zoomFor(scaleFactor) {
  return scaleFactor > SCALE_LIMIT ? SCALE_LIMIT / scaleFactor : 1;
}

// AltGr arrives as Ctrl+Alt and types characters on some layouts.
function isManualZoomKey(input) {
  return input.type === 'keyDown' && input.control && !input.alt && (ZOOM_KEYS.has(input.key) || ZOOM_CODES.has(input.code));
}

function scaledSize(size, zoom) {
  return Object.fromEntries(Object.entries(size).map(([key, value]) => [key, Math.round(value * zoom)]));
}

function resizedBounds(bounds, ratio, area) {
  const width = Math.round(bounds.width * ratio), height = Math.round(bounds.height * ratio);
  const x = Math.round(bounds.x + (bounds.width - width) / 2), y = Math.round(bounds.y + (bounds.height - height) / 2);
  return { width, height,
    x: Math.max(area.x, Math.min(x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - height)) };
}

// Resizing waits for a drag to end: mid-drag it could pull the window back onto the display it came from.
function followDisplayScale(window, screen, size, zoom) {
  let sizedFor = zoom, dragging = false;
  const isWindowed = () => !window.isMaximized() && !window.isFullScreen() && !window.isMinimized();
  const resize = () => {
    if (dragging || sizedFor === zoom || window.isDestroyed() || !isWindowed()) return;
    const bounds = window.getBounds();
    window.setBounds(resizedBounds(bounds, zoom / sizedFor, screen.getDisplayMatching(bounds).workArea));
    sizedFor = zoom;
  };
  // Zoom only applies to a loaded page, and Chromium restores the zoom from the last run on each load.
  const applyZoom = () => window.webContents.setZoomFactor(zoom);
  const fit = () => {
    if (window.isDestroyed()) return;
    const next = zoomFor(screen.getDisplayMatching(window.getBounds()).scaleFactor);
    if (next === zoom) return;
    zoom = next;
    applyZoom();
    const { minWidth, minHeight } = scaledSize(size, zoom);
    window.setMinimumSize(minWidth, minHeight);
    resize();
  };
  window.webContents.on('did-navigate', applyZoom);
  // preventDefault here also stops the default menu's zoom accelerators.
  window.webContents.on('before-input-event', (event, input) => { if (isManualZoomKey(input)) event.preventDefault(); });
  window.hookWindowMessage(WM_DPICHANGED, () => setImmediate(fit));
  window.hookWindowMessage(WM_ENTERSIZEMOVE, () => { dragging = true; });
  window.hookWindowMessage(WM_EXITSIZEMOVE, () => { dragging = false; setImmediate(resize); });
  // leave-full-screen fires before the window reports that it has left fullscreen.
  for (const event of ['restore', 'unmaximize', 'leave-full-screen']) window.on(event, () => setImmediate(resize));
  const displayChanged = (_event, _display, changed) => { if (changed.includes('scaleFactor')) fit(); };
  screen.on('display-metrics-changed', displayChanged);
  window.once('closed', () => screen.off('display-metrics-changed', displayChanged));
  fit();
}

module.exports = { zoomFor, scaledSize, followDisplayScale };
