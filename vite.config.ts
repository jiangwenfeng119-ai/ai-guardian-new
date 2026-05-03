import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'node:fs';
import http from 'node:http';
import {spawn, type ChildProcess} from 'child_process';
import {fileURLToPath} from 'url';
import {defineConfig, loadEnv, type Plugin} from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 与 Vite 代理、本地 API 探测一致；默认 8787，本地与 Docker 生产并存时请在 .env.local 设 API_PORT=8788 */
function createApiAuthStatusReachable(apiPort: number) {
  return function apiAuthStatusReachable(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${apiPort}/api/auth/status`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve(false);
      });
    });
  };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** 开发 / preview：对运维 md 显式 charset=utf-8；中英文分文件 */
function backupOperatorDocUtf8Plugin(): Plugin {
  const DOC_MAP: Record<string, string> = {
    '/docs/BACKUP_OPERATOR.md': 'BACKUP_OPERATOR.zh-CN.md',
    '/docs/BACKUP_OPERATOR.zh-CN.md': 'BACKUP_OPERATOR.zh-CN.md',
    '/docs/BACKUP_OPERATOR.en-US.md': 'BACKUP_OPERATOR.en-US.md',
  };
  const sendDoc = (reqUrl: string | undefined, base: string, res: import('http').ServerResponse, next: () => void) => {
    const pathname = (reqUrl || '').split('?')[0] || '';
    const baseNorm = base.endsWith('/') ? base.slice(0, -1) : base;
    let rel = pathname;
    if (baseNorm && baseNorm !== '/' && pathname.startsWith(baseNorm)) {
      rel = pathname.slice(baseNorm.length) || '/';
      if (!rel.startsWith('/')) rel = `/${rel}`;
    }
    const diskName = DOC_MAP[rel];
    if (!diskName) {
      next();
      return;
    }
    const file = path.join(__dirname, 'public/docs', diskName);
    if (!fs.existsSync(file)) {
      next();
      return;
    }
    try {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(fs.readFileSync(file, 'utf8'));
    } catch {
      next();
    }
  };
  return {
    name: 'backup-operator-doc-utf8',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        sendDoc(req.url, server.config.base, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        sendDoc(req.url, server.config.base, res, next);
      });
    },
  };
}

/** 开发时：在 Vite 挂好代理之前启动/探测本地 API，避免首屏请求 /api 时后端未就绪。dev:all 设 AI_GUARDIAN_SKIP_API=1 */
function startLocalApiPlugin(apiPort: number): Plugin {
  let child: ChildProcess | null = null;
  const apiAuthStatusReachable = createApiAuthStatusReachable(apiPort);
  return {
    name: 'ai-guardian-local-api',
    apply: 'serve',
    async configureServer(server) {
      if (process.env.AI_GUARDIAN_SKIP_API === '1') {
        return;
      }
      const apiEntry = path.join(__dirname, 'server', 'api.cjs');
      const stop = () => {
        if (child && !child.killed) {
          child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
        }
      };
      server.httpServer?.once('close', stop);
      process.once('exit', stop);

      let alreadyUp = await apiAuthStatusReachable(800);
      if (alreadyUp) {
        console.log(`[ai-guardian] Local API already on ${apiPort} — reusing, skip spawn.`);
        return;
      }

      child = spawn(process.execPath, [apiEntry], {
        cwd: __dirname,
        stdio: 'inherit',
        env: {...process.env, API_PORT: String(apiPort)},
      });
      child.on('error', (err) => {
        console.error('[ai-guardian] 无法启动本地 API:', err.message);
      });
      child.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          console.error(
            `[ai-guardian] server/api.cjs exited (${code}). If port ${apiPort} is in use, stop the other process or set API_PORT in .env.local`
          );
        }
      });

      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        if (await apiAuthStatusReachable(600)) {
          console.log(`[ai-guardian] Local API ready on ${apiPort} (/api/auth/status OK).`);
          return;
        }
        await sleep(200);
      }
      console.error(
        `[ai-guardian] Timed out waiting for http://127.0.0.1:${apiPort}/api/auth/status — check server/api.cjs or free port ${apiPort}`
      );
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  /** 与 Docker 生产（8787）并存时：.env.local 设 API_PORT=8788，或由 scripts/dev-all.cjs 注入 */
  const apiPort = Number(env.API_PORT || process.env.API_PORT || 8787);
  /** 本地测试前端端口，默认 3000 */
  const devPort = Number(env.VITE_DEV_PORT || process.env.VITE_DEV_PORT || 3000);

  return {
    plugins: [backupOperatorDocUtf8Plugin(), startLocalApiPlugin(apiPort), react(), tailwindcss()],
    server: {
      port: devPort,
      strictPort: false,
      host: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          timeout: 60_000,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.error(`[vite proxy] /api -> 127.0.0.1:${apiPort}`, err.message);
            });
          },
        },
        // 浏览器直连 Ollama 会跨域；开发时统一走此前缀代理到本机 11434
        '/ollama': {
          target: 'http://127.0.0.1:11434',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/ollama/, ''),
        },
      },
    },
    preview: {
      port: devPort,
      strictPort: false,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          timeout: 60_000,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.error('[vite preview proxy] /api', err.message);
            });
          },
        },
        '/ollama': {
          target: 'http://127.0.0.1:11434',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/ollama/, ''),
        },
      },
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
