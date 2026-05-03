# Backup & restore (operator one-pager)

## What runs where

| Method | Who writes the file | Path |
|--------|---------------------|------|
| **Build & download backup** in System Settings | Browser download | Location is chosen by the OS (Save As / Downloads). A web page cannot silently write to arbitrary paths. |
| **Scheduled backup** | Node process (paths are **inside** the container if you use Docker) | `backup.targetDir` in `settings.json`. In Docker you **must** mount a **volume** to the host or backups are lost when the container is removed. |

## What is inside the zip

Includes `manifest.json` (`schemaVersion`, per-file SHA256, etc.) and the main files under `DATA_DIR` (e.g. `settings.json`, `users.json`, `assessments.json`, `bugs.json`, `audit.jsonl`, legal-regulations cache files), aligned with the export implementation.

**Not included**: environment variable **`JWT_SECRET`** and other secrets in `.env`. If `JWT_SECRET` after import differs from when the backup was created, **all existing sessions are invalid** and users must sign in again.

**Sensitive**: the zip contains password hashes and business data; treat it as confidential.

## Docker example

See `docker-compose.yml` in the repo:

- Volumes: `./data:/app/data`, `./backups:/backups`
- Env: `BACKUP_ALLOWED_ROOT=/backups` (allows scheduled backup target under that prefix; see `server/api.cjs` for path checks)

In System Settings → Backup & restore: set target directory to `/backups`, enable scheduled backup, then **Save all settings**.

## Restore after disaster / upgrade

1. Pull code or image from Git and redeploy the app.  
2. Keep `DATA_DIR` (and optional backup volume) mounts consistent with production.  
3. Sign in as **Super Admin**, open **System Settings → Backup & restore**.  
4. Choose the previous `.zip`, confirm, then **Upload & import backup**.  
5. Before import, the server copies current critical files to `data/.pre-import-<timestamp>/`.  
6. After import, verify audit and business data; if sign-in behaves oddly, check whether `JWT_SECRET` changed.

## API (Super Admin only)

- `GET /api/admin/backup/export` — download zip.  
- `POST /api/admin/backup/import` — `multipart/form-data`, field name **`file`**.
