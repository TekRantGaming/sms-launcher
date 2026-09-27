'use strict';

function activityFromLine(line) {
  const value = String(line).replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (!value) return null;
  const build = value.match(/^\[\s*(\d{1,3})%\]/);
  if (build) return { detail: 'Compiling game code', percent: Math.min(100, Number(build[1])) };
  const git = value.match(/^(Receiving objects|Resolving deltas|Updating files|Compressing objects):\s*(\d{1,3})%/);
  if (git) return { detail: git[1], percent: Math.min(100, Number(git[2])) };
  if (/^Downloading Super Mario Sunshine UHD Texture Pack/.test(value))
    return { detail: 'Downloading UHD textures (about 1 GB)', percent: null };
  if (/^Unpacking GMS\.7z/.test(value))
    return { detail: 'Unpacking UHD textures', percent: null };
  if (/^Installed \d+ textures/.test(value))
    return { detail: 'HD textures installed', percent: 100 };
  if (/^Removing the previous install/.test(value))
    return { detail: 'Preparing texture folder', percent: null };
  if (/^\s*\d+ MiB, MD5 /.test(value))
    return { detail: 'Texture download verified', percent: null };
  if (/^-- (?:Configuring|Generating)/.test(value))
    return { detail: 'Configuring build', percent: null };
  if (/^Cloning into /.test(value))
    return { detail: 'Downloading port source', percent: null };
  if (/^(?:Applying|Patching|Writing|Bundling) /.test(value))
    return { detail: value.slice(0, 100), percent: null };
  return null;
}

module.exports = { activityFromLine };
