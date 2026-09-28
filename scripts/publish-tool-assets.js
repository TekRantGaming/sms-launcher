'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { toolsetFor, hashFile } = require('../src/build-tools');
const { runMain } = require('./tool-run');

async function main() {
  const directory = path.resolve('tool-assets');
  const mac = process.env.SMS_MAC_TOOL_ASSETS === '1';
  const TOOLSET = toolsetFor(mac ? 'darwin' : 'linux');
  const manifest = { toolset: TOOLSET, platforms: {} };
  for (const platform of mac ? ['x64', 'arm64'] : ['linux', 'win32']) {
    const part = JSON.parse(fs.readFileSync(path.join(directory, `manifest-${mac ? `macos-${platform}` : platform}.json`), 'utf8'));
    if (part.toolset !== TOOLSET || !part.platforms[platform]) throw new Error(`Missing manifest for ${platform}`);
    const asset = part.platforms[platform];
    if (await hashFile(path.join(directory, asset.name)) !== asset.sha256) throw new Error(`Archive checksum changed for ${platform}`);
    Object.assign(manifest.platforms, part.platforms);
  }
  fs.writeFileSync(path.join(directory, mac ? 'mac-tool-assets.json' : 'tool-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const repo = 'chasem-dev/sms-launcher';
  const tag = `${mac ? 'mac-' : ''}build-tools-${TOOLSET}`;
  const args = ['release', 'create', tag, '--repo', repo, '--target', process.env.GITHUB_SHA,
    '--prerelease', '--title', `Build tools ${TOOLSET}`, '--notes',
    `Private build tools for SMS Launcher. The ${mac ? 'Intel and Apple Silicon Mac' : 'Linux and Windows'} archives passed a fresh port compilation after relocation. No ROM, game assets, or compiled port is included. The corresponding source archives contain upstream sources, build recipes, patches, package metadata, and notices. Toolsets are independently versioned and reused across launcher releases. This tooling release is marked prerelease so it does not become the launcher update feed.${mac ? ' Apple Command Line Tools and Rosetta are not redistributed and must be installed through Apple.' : ''}`];
  // Never replace an existing toolset: launcher builds pin the exact archive hashes.
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.tar.gz') || name.endsWith('.md') || name === (mac ? 'mac-tool-assets.json' : 'tool-assets.json')))
    args.push(path.join(directory, file));
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.tar.gz')))
    execFileSync('tar', ['-tzf', path.join(directory, file)], { stdio: 'ignore' });
  execFileSync('gh', args, { stdio: 'inherit' });
}

runMain(main);
