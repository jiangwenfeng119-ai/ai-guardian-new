/**
 * Start local API + Vite for testing (default avoids Docker production on 8787).
 *
 * Defaults: API_PORT=8788, Vite VITE_DEV_PORT=3000 (override via env).
 * Ctrl+C stops both.
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const node = process.execPath;

const apiPort = process.env.API_PORT || '8788';
const vitePort = process.env.VITE_DEV_PORT || '3000';

const api = spawn(node, [path.join(root, 'server', 'api.cjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, API_PORT: apiPort },
});

const vite = spawn(node, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', vitePort, '--host', '0.0.0.0'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, AI_GUARDIAN_SKIP_API: '1', API_PORT: apiPort, VITE_DEV_PORT: vitePort },
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
