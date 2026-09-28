'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const tools = require('../src/build-tools');

async function main() {
  if (process.platform === 'darwin') return;
  const asset = tools.assetFor();
  const directory = path.resolve('tool-assets');
  fs.mkdirSync(directory, { recursive: true });
  const archive = path.join(directory, asset.name);
  await tools.fetchVerified(asset.url, archive, asset.sha256);
  if (process.env.SMS_RELEASE_TAG)
    execFileSync('gh', ['release', 'upload', process.env.SMS_RELEASE_TAG, archive,
      '--repo', process.env.GITHUB_REPOSITORY || 'chasem-dev/sms-launcher'], { stdio: 'inherit' });
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
