'use strict';

const { spawn } = require('node:child_process');

function run(command, args, options = {}, label = command) {
  process.stdout.write(`\n${label}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${label} exited with ${code}`)));
  });
}

module.exports = { run };
