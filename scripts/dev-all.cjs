/**
 * Start API (8787) + Vite (5173). Ctrl+C stops both.
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const node = process.execPath;

const api = spawn(node, [path.join(root, 'server', 'api.cjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env },
});

const vite = spawn(node, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', '5173', '--host', '0.0.0.0'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, AI_GUARDIAN_SKIP_API: '1' },
});

function shutdown(code) {
  api.kill('SIGTERM');
  vite.kill('SIGTERM');
  process.exit(code);
}

api.on('exit', (c) => {
  if (c !== 0 && c !== null) shutdown(c);
});
vite.on('exit', (c) => {
  if (c !== 0 && c !== null) shutdown(c);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
