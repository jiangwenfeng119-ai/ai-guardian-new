# 备份与恢复（运维一页）

> 与构建产物一致：`public/docs/BACKUP_OPERATOR.zh-CN.md`（中文）、`public/docs/BACKUP_OPERATOR.en-US.md`（英文）。应用内「备份与恢复」会根据当前界面语言打开对应文件；旧链接 `/docs/BACKUP_OPERATOR.md` 仍指向中文版。

## 能力边界

| 方式 | 谁写文件 | 路径 |
|------|-----------|------|
| 系统配置页「生成并下载备份」 | 浏览器下载 | 由操作系统「下载 / 另存为」决定；网页无法静默写入任意本机路径。 |
| 定时自动备份 | Node 进程（容器内即容器内路径） | `settings.json` 里 `backup.targetDir`；Docker 必须 **volume 挂载** 到宿主机，否则删容器即丢备份。 |

## 备份包内容（zip）

含 `manifest.json`（含 `schemaVersion`、各文件 SHA256）、以及当前 `DATA_DIR` 下的主要数据文件（如 `settings.json`、`users.json`、`assessments.json`、`bugs.json`、`audit.jsonl`、法规缓存等，与导出逻辑一致）。

**不在包内**：环境变量 **`JWT_SECRET`** 及 `.env` 中其他密钥。导入后若 `JWT_SECRET` 与备份生成时不一致，**所有旧会话失效**，用户需重新登录。

**敏感**：zip 含用户密码哈希与业务数据，按机密资产保管。

## Docker 示例

仓库 `docker-compose.yml` 已示例：

- 挂载：`./data:/app/data`、`./backups:/backups`
- 环境变量：`BACKUP_ALLOWED_ROOT=/backups`（允许将定时备份目标目录设在该前缀下，具体校验见 `server/api.cjs`）

在系统配置「备份与恢复」中：目标目录填 `/backups`，启用定时备份并保存全部配置。

## 恢复流程（灾难 / 升级）

1. 从 Git 拉代码或拉镜像，重新部署应用。  
2. 保证 `DATA_DIR`（及可选备份卷）挂载与生产一致。  
3. 使用 **超级管理员** 登录，打开 **系统配置 → 备份与恢复**。  
4. 选择此前的 `.zip`，勾选确认后 **上传并导入**。  
5. 导入前服务端会将当前关键数据复制到 `data/.pre-import-<时间戳>/`。  
6. 导入完成后建议核对审计与业务数据；若登录异常，检查 `JWT_SECRET` 是否变更。

## API（仅 SuperAdmin）

- `GET /api/admin/backup/export`：下载 zip。  
- `POST /api/admin/backup/import`：`multipart/form-data`，字段名 **`file`**。
