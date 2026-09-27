'use strict';

function activityFromLine(line) {
  const value = String(line).replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (!value) return null;
  const build = value.match(/^\[\s*(\d{1,3})%\]/);
  if (build) return { detail: 'Preparing your game', percent: Math.min(100, Number(build[1])) };
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

module.exports = { activityFromLine };
