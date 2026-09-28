'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { TOOLSET, hashFile } = require('../src/build-tools');
const { runMain } = require('./tool-run');

async function main() {
  const directory = path.resolve('tool-assets');
  const manifest = { toolset: TOOLSET, platforms: {} };
  for (const platform of ['linux', 'win32']) {
    const part = JSON.parse(fs.readFileSync(path.join(directory, `manifest-${platform}.json`), 'utf8'));
    if (part.toolset !== TOOLSET || !part.platforms[platform]) throw new Error(`Missing manifest for ${platform}`);
    const asset = part.platforms[platform];
    if (await hashFile(path.join(directory, asset.name)) !== asset.sha256) throw new Error(`Archive checksum changed for ${platform}`);
    Object.assign(manifest.platforms, part.platforms);
  }
  fs.writeFileSync(path.join(directory, 'tool-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const repo = 'chasem-dev/sms-launcher';
  const tag = `build-tools-${TOOLSET}`;
  const args = ['release', 'create', tag, '--repo', repo, '--target', process.env.GITHUB_SHA,
    '--prerelease', '--title', `Build tools ${TOOLSET}`, '--notes',
    'Private build tools for SMS Launcher. The Linux and Windows archives passed a fresh port compilation after relocation. No ROM, game assets, or compiled port is included. The corresponding source archives contain upstream sources, build recipes, patches, package metadata, and notices. Toolsets are independently versioned and reused across launcher releases. This tooling release is marked prerelease so it does not become the launcher update feed.'];
  // Never replace an existing toolset: launcher builds pin the exact archive hashes.
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.tar.gz') || name.endsWith('.md') || name === 'tool-assets.json'))
    args.push(path.join(directory, file));
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.tar.gz')))
    execFileSync('tar', ['-tzf', path.join(directory, file)], { stdio: 'ignore' });
  execFileSync('gh', args, { stdio: 'inherit' });
}

runMain(main);
