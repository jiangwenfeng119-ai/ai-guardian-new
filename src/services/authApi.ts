import { checkSession, parseError } from './apiHelpers';
import { getAuthToken, setAuthToken } from './settingsApi';

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  companyId?: string;
  projectId?: string;
  teamId?: string;
  description?: string;
  visibleCompanyIds?: string[];
  visibleProjectIds?: string[];
}

function authHeaders(): HeadersInit {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function fetchAuthStatus(opts?: { signal?: AbortSignal }) {
  let res: Response;
  try {
    res = await fetch('/api/auth/status', { cache: 'no-store', signal: opts?.signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `无法访问 /api（${msg}）。请用 Vite 开发地址打开（如 http://localhost:3001/），不要双击打开 dist/index.html；并确认终端里已启动本项目的 API（8787）。`
    );
  }
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ needsBootstrap: boolean; userCount: number }>;
}

export async function fetchMe() {
  const res = await fetch('/api/auth/me', { headers: { ...authHeaders() } });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ user: AuthUser }>;
}

export async function postBootstrap(username: string, password: string) {
  const res = await fetch('/api/auth/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || (await parseError(res)));
  const token = (data as { token?: string }).token;
  if (token) setAuthToken(token);
  return data as { token: string; user: AuthUser };
}

export async function postLogin(username: string, password: string) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || (await parseError(res)));
  const token = (data as { token?: string }).token;
  if (token) setAuthToken(token);
  return data as { token: string; user: AuthUser };
}

export function logout() {
  setAuthToken(null);
}

export interface UserRecord {
  id: string;
  username: string;
  role: string;
  companyId?: string;
  projectId?: string;
  teamId?: string;
  description?: string;
  visibleCompanyIds?: string[];
  visibleProjectIds?: string[];
  createdAt: string;
}

export async function fetchUsers() {
  const res = await fetch('/api/users', { headers: { ...authHeaders() } });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ users: UserRecord[] }>;
}

export async function postUser(body: {
  username: string;
  password: string;
  role: string;
  companyId: string;
  projectId: string;
  teamId: string;
  description?: string;
  visibleCompanyIds?: string[];
  visibleProjectIds?: string[];
}) {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  checkSession(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || (await parseError(res)));
  return data as { user: UserRecord };
}

export async function patchUser(
  id: string,
  body: {
    role?: string;
    password?: string;
    companyId?: string;
    projectId?: string;
    teamId?: string;
    description?: string;
    visibleCompanyIds?: string[];
    visibleProjectIds?: string[];
  }
) {
  const res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  checkSession(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || (await parseError(res)));
  return data as { user: UserRecord };
}

export async function deleteUser(id: string) {
  const res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  checkSession(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || (await parseError(res)));
  return data;
}
