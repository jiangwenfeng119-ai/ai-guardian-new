import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import http from 'node:http';
import {spawn, type ChildProcess} from 'child_process';
import {fileURLToPath} from 'url';
import {defineConfig, loadEnv, type Plugin} from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 必须与前端首屏请求一致：只认 /api/auth/status，避免 8787 被其它程序占用时误判为“已就绪” */
function apiAuthStatusReachable(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8787/api/auth/status', (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** 开发时：在 Vite 挂好代理之前启动/探测 API（8787），避免首屏请求 /api 时后端未就绪。dev:all 设 AI_GUARDIAN_SKIP_API=1 */
function startLocalApiPlugin(): Plugin {
  let child: ChildProcess | null = null;
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
        console.log('[ai-guardian] Local API (ai-guardian) already on 8787 — reusing, skip spawn.');
        return;
      }

      child = spawn(process.execPath, [apiEntry], {
        cwd: __dirname,
        stdio: 'inherit',
        env: {...process.env},
      });
      child.on('error', (err) => {
        console.error('[ai-guardian] 无法启动本地 API:', err.message);
      });
      child.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          console.error(
            `[ai-guardian] server/api.cjs exited (${code}). If port 8787 is in use, stop the other process or set API_PORT in .env.local`
          );
        }
      });

      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        if (await apiAuthStatusReachable(600)) {
          console.log('[ai-guardian] Local API ready on 8787 (/api/auth/status OK).');
          return;
        }
        await sleep(200);
      }
      console.error(
        '[ai-guardian] Timed out waiting for http://127.0.0.1:8787/api/auth/status — check server/api.cjs or free port 8787'
      );
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [startLocalApiPlugin(), react(), tailwindcss()],
    server: {
      /** 默认 5173，少与 3000 系其它服务冲突；被占用时 Vite 会自动换端口，请看终端里 Local: 行 */
      port: 5173,
      strictPort: false,
      host: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
          timeout: 60_000,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.error('[vite proxy] /api -> 127.0.0.1:8787', err.message);
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
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
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
