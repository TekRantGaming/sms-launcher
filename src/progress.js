'use strict';

const { StringDecoder } = require('node:string_decoder');

function cleanOutputLine(line) {
  return String(line).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

// Pipe output can split a UTF-8 character, a progress line, or a CRLF across
// chunks. Each stream gets its own reader, including its final unterminated line.
function createLineReader(onLine) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  function consume(text) {
    const parts = (pending + text).split(/[\r\n]/);
    pending = parts.pop();
    for (const part of parts) if (part) onLine(cleanOutputLine(part));
  }
  return {
    write(bytes) { consume(decoder.write(bytes)); },
    end() { consume(decoder.end()); if (pending) onLine(cleanOutputLine(pending)); pending = ''; }
  };
}

function buildDetail(output) {
  return /^(?:Linking|Generating .*syms|Renaming)/i.test(output) ? 'Finishing the game build' : 'Building your game';
}

function activityFromLine(line) {
  const value = cleanOutputLine(line).trim();
  if (!value) return null;
  const output = value.replace(/^\[\s*(?:\d{1,3}%|\d+\s*\/\s*\d+)\]\s*/, '');
  // These run after compilation. Their command may print 100% before copying
  // the disc, so keep this separate phase indeterminate until the process exits.
  if (/^(?:Bundling|Extracting (?:the )?(?:SMS\.app|sms\.exe) icon|bundle_disc:)/.test(output))
    return { detail: 'Preparing your game files', percent: null };
  if (/^Built .*[\/]sms(?:\.exe)?\s/.test(value) || /^ninja: no work to do\./.test(value))
    return { detail: 'Finishing setup', percent: null };
  const ninja = value.match(/^\[\s*(\d+)\s*\/\s*(\d+)\]\s*(.*)/);
  if (ninja) {
    const completed = Number(ninja[1]), total = Number(ninja[2]);
    if (!Number.isSafeInteger(completed) || !Number.isSafeInteger(total) || total <= 0 || completed > total) return null;
    return { detail: `${buildDetail(ninja[3])} · ${completed.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} steps`,
      percent: Math.floor(completed * 100 / total) };
  }
  const build = value.match(/^\[\s*(\d{1,3})%\]\s*(.*)/);
  if (build) return { detail: buildDetail(build[2]), percent: Math.min(100, Number(build[1])) };
  const git = value.match(/^(Receiving objects|Resolving deltas|Updating files|Compressing objects):\s*(\d{1,3})%/);
  if (git) return { detail: git[1] === 'Receiving objects' ? 'Downloading files' : 'Preparing downloaded files', percent: Math.min(100, Number(git[2])) };
  if (/^Downloading Super Mario Sunshine UHD Texture Pack/.test(value))
    return { detail: 'Downloading HD textures (about 1 GB)', percent: null };
  if (/^Unpacking GMS\.7z/.test(value))
    return { detail: 'Installing HD textures', percent: null };
  if (/^Installed \d+ textures/.test(value))
    return { detail: 'HD textures installed', percent: 100 };
  if (/^Removing the previous install/.test(value))
    return { detail: 'Making room for HD textures', percent: null };
  if (/^\s*\d+ MiB, MD5 /.test(value))
    return { detail: 'Download checked', percent: null };
  if (/^-- (?:Configuring|Generating)/.test(value))
    return { detail: 'Getting your game ready', percent: null };
  if (/^Cloning into /.test(value))
    return { detail: 'Downloading setup files', percent: null };
  if (/^(?:Applying|Patching|Writing|Bundling) /.test(value))
    return { detail: 'Preparing game files', percent: null };
  return null;
}

module.exports = { activityFromLine, cleanOutputLine, createLineReader };
