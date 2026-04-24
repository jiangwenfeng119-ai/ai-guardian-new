# Cursor 工作模式与项目实操指南

这份指南面向你当前这个仓库，目标是让你从「拷贝项目过来」到「本地开发、测试、部署」一次走通。

## 1) 从外部拷贝项目后，第一步做什么

1. 在 Cursor 里打开 `File -> Open Folder`，选择项目根目录 `ai-guardian-new`。
2. 确认根目录下有 `package.json`、`src/`、`server/`。
3. 打开内置终端后执行：

```bash
npm install
```

> 要点：一定要打开**项目根目录**，不要只打开 `src/` 子目录。

## 2) 在 Cursor 里如何和 AI 协作

推荐的日常节奏：

1. 先提问理解代码（例如：`解释 @src/App.tsx 的核心流程`）。
2. 再下达改动指令（例如：`在 @src/components/SystemSettings.tsx 增加 XX`）。
3. 让我直接运行命令（例如：`帮我跑测试`、`帮我启动服务`）。
4. 你看改动 diff，不满意继续迭代。

常见高频指令：

- `帮我把这个项目跑起来`
- `先别改代码，解释这个模块`
- `按最小改动修复这个报错`
- `改完后帮我跑 lint 和 build`

## 3) 本仓库本地开发启动命令

安装依赖后：

```bash
npm run dev
```

若你希望前后端一起显式启动：

```bash
npm run dev:all
```

说明：

- 前端默认地址：`http://localhost:5173/`
- API 默认端口：`8787`
- 若 `5173` 被占用，Vite 可能自动改端口，以终端输出为准。

## 4) 本地测试与发布前检查

在提交代码前建议固定执行：

```bash
npm run lint
npm run build
```

含义：

- `lint`：TypeScript 类型检查（`tsc --noEmit`）
- `build`：验证生产构建是否可通过

## 5) 生产部署思路（本项目推荐）

本仓库已经包含 `Dockerfile` 和 `docker-compose.yml`，推荐使用容器化部署。

本次已新增 GitHub Actions 工作流：

- 路径：`.github/workflows/ci-cd.yml`
- 功能：
  - PR / main push 自动做 `npm ci + npm run lint + npm run build`
  - main push 自动部署到 staging
  - 手动触发可选部署到 staging 或 production

## 6) 你需要在 GitHub 配置的变量与密钥

进入仓库 `Settings -> Secrets and variables -> Actions`。

### 6.1 Secrets（敏感信息）

Staging:

- `STAGING_HOST`
- `STAGING_USER`
- `STAGING_SSH_KEY`

Production:

- `PRODUCTION_HOST`
- `PRODUCTION_USER`
- `PRODUCTION_SSH_KEY`

### 6.2 Repository Variables（非敏感）

Staging:

- `STAGING_APP_DIR`（例如 `/srv/ai-guardian-new`）
- `STAGING_BRANCH`（例如 `main`）

Production:

- `PRODUCTION_APP_DIR`（例如 `/srv/ai-guardian-new`）
- `PRODUCTION_BRANCH`（例如 `main` 或 `release`）

## 7) 服务器侧前置条件

目标服务器需要提前具备：

1. Docker + Docker Compose
2. 已克隆本仓库到 `*_APP_DIR` 指定目录
3. 目录内有生产环境可用的 `.env`（至少配置 `JWT_SECRET` 等）

首次手动验证可在服务器运行：

```bash
cd /srv/ai-guardian-new
docker compose up -d --build
docker compose ps
```

## 8) 常见问题排查

1. **工作流部署失败（SSH 连接问题）**  
   通常是 `HOST/USER/SSH_KEY` 配置错误，或服务器安全组未放行 SSH。

2. **容器启动后应用不可用**  
   先看服务器日志：
   ```bash
   docker compose logs -n 200
   ```

3. **本地能跑，CI 失败**  
   多数是本地环境和 CI 环境不一致；先用 `npm ci` 后再复现。

---

如果你希望，我下一步可以继续帮你把这个工作流升级成「打版本标签自动生产发布（tag release）」模式，避免直接从 `main` 手动触发生产部署。
