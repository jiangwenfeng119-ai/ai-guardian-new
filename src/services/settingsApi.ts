import type { ApiSyncSettings } from '../permissions';
import type { Assessment } from '../types';
import { checkSession, parseError } from './apiHelpers';
/** JWT from login (sessionStorage). Legacy key kept for one release so existing sessions still work. */
const TOKEN_KEY = 'ai_guardian_jwt';
const LEGACY_ADMIN_KEY = 'ai_guardian_admin_token';

export function getAuthToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(LEGACY_ADMIN_KEY);
}

export function setAuthToken(token: string | null) {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(LEGACY_ADMIN_KEY);
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): HeadersInit {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function apiHealth(opts?: { signal?: AbortSignal }) {
  const res = await fetch('/api/health', { signal: opts?.signal });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ ok: boolean; dataDir: string; ollamaProxy?: boolean }>;
}

export async function fetchSettings(opts?: { signal?: AbortSignal }) {
  const res = await fetch('/api/settings', { headers: { ...authHeaders() }, signal: opts?.signal });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function putSettings(body: Record<string, unknown>) {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchAuditLog(limit = 30, opts?: { signal?: AbortSignal }) {
  const res = await fetch(`/api/audit-log?limit=${limit}`, { headers: { ...authHeaders() }, signal: opts?.signal });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ entries: unknown[] }>;
}

export type UserActivityAnalyticsResponse = {
  window: { days: number; since: string; until: string };
  dimensions: { role: string; companyId: string; projectId: string };
  metricDefinitions: Record<string, string>;
  summary: {
    totalUsers: number;
    activeUsers: number;
    activeUserRatio: number;
    totalLoginOk: number;
    totalAssessmentsCreated: number;
    totalReportsDownloaded: number;
    totalBugSubmitted: number;
    totalStandardsUpdated: number;
    scoreDistribution: { high: number; medium: number; low: number };
  };
  trend: Array<{
    day: string;
    activeUsers: number;
    loginCount: number;
    assessmentCreatedCount: number;
    reportDownloadedCount: number;
    bugSubmittedCount: number;
    standardsUpdatedCount: number;
  }>;
  users: Array<{
    userId: string;
    username: string;
    role: string;
    companyId: string;
    projectId: string;
    activityScore: number;
    activeLevel: 'high' | 'medium' | 'low';
    activeDays: number;
    lastActiveAt: string | null;
    loginOkCount: number;
    loginFailCount: number;
    loginSuccessRate: number | null;
    assessmentsCreatedCount: number;
    assessmentsSavedCount: number;
    reportsDownloadedCount: number;
    bugSubmittedCount: number;
    bugStatusUpdatedCount: number;
    standardsUpdatedCount: number;
    settingsUpdatedCount: number;
    avgSessionGapHours: number | null;
  }>;
};

export type BugTicket = {
  id: string;
  title: string;
  description: string;
  status: 'submitted' | 'in_progress' | 'resolved';
  reporterId: string;
  reporterName: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
};

export async function fetchUserActivityAnalytics(params?: {
  days?: number;
  role?: string;
  companyId?: string;
  projectId?: string;
  limit?: number;
  signal?: AbortSignal;
}) {
  const q = new URLSearchParams();
  if (params?.days != null) q.set('days', String(params.days));
  if (params?.role) q.set('role', params.role);
  if (params?.companyId) q.set('companyId', params.companyId);
  if (params?.projectId) q.set('projectId', params.projectId);
  if (params?.limit != null) q.set('limit', String(params.limit));
  const qs = q.toString();
  const res = await fetch(`/api/analytics/user-activity${qs ? `?${qs}` : ''}`, {
    headers: { ...authHeaders() },
    signal: params?.signal,
  });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<UserActivityAnalyticsResponse>;
}

export async function postReportDownloadEvent(body: { format: 'excel' | 'word' | 'pdf'; assessmentId: string; standardId?: string }) {
  const res = await fetch('/api/reports/download-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ ok: boolean }>;
}

export async function fetchBugs(opts?: { signal?: AbortSignal }) {
  const res = await fetch('/api/bugs', { headers: { ...authHeaders() }, signal: opts?.signal });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ bugs: BugTicket[] }>;
}

export async function postBug(body: { title: string; description?: string }) {
  const res = await fetch('/api/bugs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ bug: BugTicket }>;
}

export async function patchBugStatus(id: string, status: 'submitted' | 'in_progress' | 'resolved') {
  const res = await fetch(`/api/bugs/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ status }),
  });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ bug: BugTicket }>;
}

export async function postModelConnectionTest(
  model: Record<string, unknown>,
  ensureReady = false,
  target: 'primary' | 'local' | 'cloud' = 'primary'
) {
  const res = await fetch('/api/model/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ model, ensureReady, target }),
  });
  checkSession(res);
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    provider?: string;
    endpoint?: string;
    elapsedMs?: number;
    detail?: string;
  };
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || res.statusText);
  }
  return data as {
    ok: true;
    provider?: string;
    endpoint?: string;
    elapsedMs?: number;
    detail?: string;
  };
}

export async function postStandardsSync(sync: ApiSyncSettings) {
  const res = await fetch('/api/standards/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      provider: sync.provider,
      endpoint: sync.endpoint,
      apiKey: sync.apiKey,
      codebuddyEndpoint: sync.codebuddyEndpoint,
      codebuddyApiKey: sync.codebuddyApiKey,
      codebuddySkill: sync.codebuddySkill,
    }),
  });
  checkSession(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string; message?: string }).error || (data as { message?: string }).message || res.statusText;
    throw new Error(msg);
  }
  return data as {
    ok: boolean;
    statusCode?: number;
    lastSyncAt?: string;
    preview?: string;
  };
}

export async function fetchAssessments(opts?: { signal?: AbortSignal; scope?: 'mine' | 'visible' }) {
  const q = new URLSearchParams();
  if (opts?.scope) q.set('scope', opts.scope);
  const url = `/api/assessments${q.toString() ? `?${q.toString()}` : ''}`;
  const res = await fetch(url, { headers: { ...authHeaders() }, signal: opts?.signal });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ assessments: Assessment[] }>;
}

export async function putAssessments(assessments: Assessment[]) {
  const res = await fetch('/api/assessments', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ assessments }),
  });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{
    ok: boolean;
    count: number;
    publishableCount?: number;
    draftByGate?: number;
    issueDistribution?: Record<string, number>;
  }>;
}

export async function postAssessmentPrecheck(assessment: Assessment) {
  const res = await fetch('/api/assessments/precheck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ assessment }),
  });
  checkSession(res);
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    assessmentId?: string;
    standardId?: string;
    parsedItemCount?: number;
    standardControlCount?: number;
    matched?: boolean;
    message?: string;
  };
  if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
  return data as {
    ok: true;
    assessmentId: string;
    standardId: string;
    parsedItemCount: number;
    standardControlCount: number;
    matched: boolean;
    message: string;
  };
}

export async function postAiAssistantChat(body: { message: string; mode: 'default' | 'local' | 'cloud' }) {
  const res = await fetch('/api/ai-assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  checkSession(res);
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    text?: string;
    provider?: string;
    model?: string;
    route?: string;
    elapsedMs?: number;
  };
  if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
  return data as { ok: true; text: string; provider: string; model: string; route: string; elapsedMs?: number };
}

export type LegalRegulationsCachePayload = {
  empty?: boolean;
  message?: string;
  updatedAt?: string;
  keyword?: string;
  query?: string;
  requestUrl?: string;
  statusCode?: number;
  rawText?: string;
  parsedJson?: unknown;
  postProcess?: unknown;
  customerView?: {
    content?: string;
    source?: string;
    updatedAt?: string;
    agentAnswer?: string;
    reviewed?: boolean;
    reviewedAt?: string;
    reviewedBy?: string;
    briefing?: {
      headline?: string;
      summary?: string;
      takeaways?: string[];
    };
    manualItems?: Array<{
      title?: string;
      docType?: string;
      status?: string;
      keyPoints?: string[];
      controlImpacts?: string[];
      sourceSnippet?: string;
    }>;
  };
  history?: Array<{
    ts?: string;
    query?: string;
    statusCode?: number;
    totalCount?: number;
    knowledgeBaseCount?: number;
    requestUrl?: string;
    urlRewritten?: boolean;
    responseType?: string;
    responseMessage?: string;
  }>;
};

/** 读取服务端持久化的法律法规 API 缓存（需「标准条款编辑」权限） */
export async function fetchLegalRegulationsCache(): Promise<LegalRegulationsCachePayload> {
  const res = await fetch('/api/legal-regulations/cache', { headers: { ...authHeaders() } });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<LegalRegulationsCachePayload>;
}

/** 调用配置的法律法规检索 API 并写入缓存（需「第三方标准 API 同步」权限） */
export async function postLegalRegulationsFetch(body?: {
  url?: string;
  keyword?: string;
  query?: string;
  prompt?: string;
  searchApiKey?: string;
  searchClientId?: string;
  postProcessEnabled?: boolean;
  postProcessModel?: string;
  testOnly?: boolean;
}) {
  const res = await fetch('/api/legal-regulations/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body || {}),
  });
  checkSession(res);
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
    statusCode?: number;
    upstreamHint?: string;
    upstreamBodySnippet?: string;
    preview?: string;
    urlRewritten?: boolean;
    requestUrl?: string;
    totalCount?: number;
    knowledgeBaseCount?: number;
    postProcess?: unknown;
  };
  if (!res.ok) {
    const msg = data.error || data.message || res.statusText;
    throw new Error(msg);
  }
  if (data.ok === false) {
    const hint =
      data.upstreamHint ||
      `检索失败（HTTP ${data.statusCode != null ? String(data.statusCode) : '错误'}）`;
    throw new Error(hint);
  }
  return data as {
    ok: boolean;
    testOnly?: boolean;
    statusCode?: number;
    legalLastSyncAt?: string;
    totalCount?: number;
    addedCount?: number;
    addedResults?: number;
    addedItems?: number;
    knowledgeBaseCount?: number;
    postProcess?: unknown;
    preview?: string;
    requestUrl?: string;
    urlRewritten?: boolean;
  };
}

export async function postLegalRegulationsDeleteItem(body: {
  title: string;
  docType?: string;
  status?: string;
  reason?: string;
}) {
  const res = await fetch('/api/legal-regulations/item/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  checkSession(res);
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    removedCount?: number;
  };
  if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
  return data as { ok: true; removedCount: number };
}

export async function putLegalRegulationsReview(body: {
  headline: string;
  summary: string;
  takeaways: string[];
  manualItems?: Array<{
    title?: string;
    docType?: string;
    status?: string;
    keyPoints?: string[];
    controlImpacts?: string[];
    sourceSnippet?: string;
  }>;
  confidence?: number;
  publish?: boolean;
  reset?: boolean;
}) {
  const res = await fetch('/api/legal-regulations/review', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  checkSession(res);
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
    customerView?: LegalRegulationsCachePayload['customerView'];
  };
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || data.message || res.statusText);
  }
  return data;
}

export async function postLegalRegulationsRegenerateSummary(body: {
  manualItems: Array<{
    title?: string;
    docType?: string;
    status?: string;
    keyPoints?: string[];
    controlImpacts?: string[];
    sourceSnippet?: string;
  }>;
  model?: string;
}) {
  const res = await fetch('/api/legal-regulations/customer-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  checkSession(res);
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
    briefing?: { headline?: string; summary?: string; takeaways?: string[] };
  };
  if (!res.ok || data.ok === false) throw new Error(data.error || data.message || res.statusText);
  return data;
}

export async function downloadBackupZip(opts?: { signal?: AbortSignal }): Promise<{ blob: Blob; suggestedFilename: string }> {
  const res = await fetch('/api/admin/backup/export', { headers: { ...authHeaders() }, signal: opts?.signal });
  checkSession(res);
  if (!res.ok) throw new Error(await parseError(res));
  const cd = res.headers.get('Content-Disposition') || '';
  let suggestedFilename = `ai-guardian-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
  const star = /filename\*=UTF-8''([^;\s]+)/i.exec(cd);
  if (star) {
    try {
      suggestedFilename = decodeURIComponent(star[1]);
    } catch {
      /* keep default */
    }
  } else {
    const plain = /filename="([^"]+)"/i.exec(cd);
    if (plain?.[1]) suggestedFilename = plain[1];
  }
  const blob = await res.blob();
  return { blob, suggestedFilename };
}

export async function importBackupZip(file: File, opts?: { signal?: AbortSignal }) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/admin/backup/import', {
    method: 'POST',
    headers: { ...authHeaders() },
    body: fd,
    signal: opts?.signal,
  });
  checkSession(res);
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as { ok?: boolean; message?: string; snapshotDir?: string };
}
