const { spawn } = require('child_process');
const path = require('path');

const projectDir = __dirname;
const nodePath = process.execPath;
const vitePath = path.join(projectDir, 'node_modules', 'vite', 'bin', 'vite.js');

console.log('Starting Vite dev server...');
console.log('Project:', projectDir);

const child = spawn(nodePath, [vitePath, '--port', '3000', '--host', '0.0.0.0'], {
  cwd: projectDir,
  stdio: ['inherit', 'pipe', 'pipe']
});

child.stdout.on('data', (data) => {
  console.log('stdout:', data.toString());
});

child.stderr.on('data', (data) => {
  console.error('stderr:', data.toString());
});

child.on('error', (err) => {
  console.error('Error:', err);
});

child.on('exit', (code) => {
  console.log('Process exited with code:', code);
});

// Keep the process alive
setTimeout(() => {}, 60000);
