/**
 * Local API: auth (JWT), users, settings, audit, standards sync proxy.
 * Run: node server/api.cjs
 * Env: JWT_SECRET, API_PORT (8787), API_HOST (127.0.0.1), DATA_DIR,
 *      SERVE_DIST=1 to serve ../dist (Docker/production), optional ADMIN_TOKEN (legacy)
 *      OLLAMA_PROXY_TARGET=http://host.docker.internal:11434 — reverse proxy /ollama -> Ollama (Docker/跨域)
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API_PORT = Number(process.env.API_PORT || 8787);
const API_HOST = process.env.API_HOST || '127.0.0.1';
const DIST_DIR = path.join(__dirname, '..', 'dist');
const SERVE_DIST = process.env.SERVE_DIST === '1' && fs.existsSync(DIST_DIR);
/** 未设置时默认反代到本机 Ollama；Docker 请在环境变量中覆盖为 http://host.docker.internal:11434 */
const OLLAMA_PROXY_TARGET = (process.env.OLLAMA_PROXY_TARGET || 'http://127.0.0.1:11434').trim();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const LEGAL_REGULATIONS_CACHE_PATH = path.join(DATA_DIR, 'legal-regulations-cache.json');
const LEGAL_REGULATIONS_HISTORY_PATH = path.join(DATA_DIR, 'legal-regulations-history.json');
const ASSESSMENTS_PATH = path.join(DATA_DIR, 'assessments.json');
const BUGS_PATH = path.join(DATA_DIR, 'bugs.json');
const AUDIT_PATH = path.join(DATA_DIR, 'audit.jsonl');
const AUDIT_RETENTION_DAYS = 180;
const AUDIT_RETENTION_MS = AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-change-me';

const ROLES = ['SuperAdmin', 'SecurityAdmin', 'Auditor', 'DepartmentManager', 'Viewer'];

const DEFAULT_PERMISSION_MATRIX = {
  SuperAdmin: {
    manageUsers: true,
    editStandards: true,
    runAssessments: true,
    exportReports: true,
    configureAiModel: true,
    viewAuditLog: true,
    viewAssessmentResults: true,
    viewAppAbout: true,
    viewReleaseNotes: true,
  },
  SecurityAdmin: {
    manageUsers: false,
    editStandards: true,
    runAssessments: true,
    exportReports: true,
    configureAiModel: true,
    viewAuditLog: true,
    viewAssessmentResults: true,
    viewAppAbout: true,
    viewReleaseNotes: true,
  },
  Auditor: {
    manageUsers: false,
    editStandards: false,
    runAssessments: true,
    exportReports: true,
    configureAiModel: false,
    viewAuditLog: true,
    viewAssessmentResults: true,
    viewAppAbout: true,
    viewReleaseNotes: false,
  },
  DepartmentManager: {
    manageUsers: false,
    editStandards: false,
    runAssessments: true,
    exportReports: true,
    configureAiModel: false,
    viewAuditLog: false,
    viewAssessmentResults: true,
    viewAppAbout: true,
    viewReleaseNotes: false,
  },
  Viewer: {
    manageUsers: false,
    editStandards: false,
    runAssessments: false,
    exportReports: false,
    configureAiModel: false,
    viewAuditLog: false,
    viewAssessmentResults: false,
    viewAppAbout: false,
    viewReleaseNotes: false,
  },
};

const DEFAULT_SETTINGS = {
  locale: 'zh-CN',
  model: {
    provider: 'Gemini',
    model: 'gemini-2.5-pro',
    geminiApiKey: '',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    temperature: 0,
    topP: 0.9,
    maxTokens: 4096,
    timeoutSec: 60,
    fallbackEnabled: true,
    primaryModel: 'local',
    localModel: {
      provider: 'Ollama',
      model: 'gpt-oss:20b',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      temperature: 0,
      topP: 0.9,
      maxTokens: 4096,
      timeoutSec: 60,
    },
    cloudModel: {
      provider: 'Gemini',
      model: 'gemini-2.5-pro',
      geminiApiKey: '',
      openaiBaseUrl: '',
      openaiApiKey: '',
      temperature: 0.1,
      topP: 0.9,
      maxTokens: 4096,
      timeoutSec: 60,
    },
  },
  sync: {
    provider: 'native',
    endpoint: 'https://api.compliance.example.com/v1/standards/sync',
    apiKey: '',
    codebuddyEndpoint: '',
    codebuddyApiKey: '',
    codebuddySkill: 'codebuddy.sync-standards',
    syncCron: '0 */6 * * *',
    autoSyncEnabled: true,
    lastSyncAt: '从未同步',
    legalRegulationsApiUrl: 'http://localhost:3001/agent/search',
    legalSearchKeyword: '信息安全 法律法规',
    legalSearchApiKey: '',
    legalSearchClientId: '',
    legalPostProcessEnabled: false,
    legalPostProcessModel: '',
    legalLastSyncAt: '',
  },
  baseInfo: {
    companies: [],
    projects: [],
    teams: [],
  },
  standardsLibrary: {
    catalogEntries: [],
    controls: {},
  },
  permissions: null,
  assessmentQuality: {
    maxAssessmentsPerRequest: 200,
    maxEvidenceChars: 220000,
    minEvidenceChars: 220,
    minDistinctEvidenceChars: 120,
    minCoverageRatioForPublish: 0.8,
    minEvidencePerFindingChars: 25,
    minUniqueEvidenceRatio: 0.4,
    maxFindingTextChars: 15000,
    maxNameChars: 160,
    maxProjectLabelChars: 80,
    maxIdChars: 120,
    enforcementMode: 'soft',
    hardIssueCodes: ['coverage_below_threshold', 'evidence_too_short'],
  },
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function mergeMatrix(raw) {
  const base = JSON.parse(JSON.stringify(DEFAULT_PERMISSION_MATRIX));
  if (!raw || typeof raw !== 'object') return base;
  for (const role of ROLES) {
    if (raw[role] && typeof raw[role] === 'object') {
      base[role] = { ...base[role], ...raw[role] };
    }
  }
  return base;
}

function readSettings() {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_PATH)) {
    return { ...DEFAULT_SETTINGS, updatedAt: null };
  }
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      model: {
        ...DEFAULT_SETTINGS.model,
        ...(parsed.model || {}),
        localModel: {
          ...DEFAULT_SETTINGS.model.localModel,
          ...((parsed.model && parsed.model.localModel) || {}),
        },
        cloudModel: {
          ...DEFAULT_SETTINGS.model.cloudModel,
          ...((parsed.model && parsed.model.cloudModel) || {}),
        },
      },
      sync: { ...DEFAULT_SETTINGS.sync, ...(parsed.sync || {}) },
      baseInfo: { ...DEFAULT_SETTINGS.baseInfo, ...(parsed.baseInfo || {}) },
      standardsLibrary: {
        ...DEFAULT_SETTINGS.standardsLibrary,
        ...((parsed && parsed.standardsLibrary) || {}),
      },
    };
  } catch (e) {
    console.error('readSettings failed', e);
    return { ...DEFAULT_SETTINGS, updatedAt: null };
  }
}

/** 当启用服务端 /ollama 代理时，把默认的 localhost 地址换成同源路径，避免浏览器访问容器内 127.0.0.1 */
function normalizeSettingsForClient(data) {
  if (!data || typeof data !== 'object' || !data.model) return data;
  const model = { ...data.model };
  if (OLLAMA_PROXY_TARGET) {
    const normalizeOllamaUrl = (u) => {
      const raw = String(u || '').trim();
      if (raw === 'http://127.0.0.1:11434' || raw === 'http://localhost:11434' || raw === '') return '/ollama';
      return raw;
    };
    if (model.provider === 'Ollama') model.ollamaBaseUrl = normalizeOllamaUrl(model.ollamaBaseUrl);
    if (model.localModel && typeof model.localModel === 'object') {
      model.localModel = { ...model.localModel, ollamaBaseUrl: normalizeOllamaUrl(model.localModel.ollamaBaseUrl) };
    }
  }
  return { ...data, model };
}

function writeSettings(data) {
  ensureDataDir();
  const payload = { ...data, updatedAt: new Date().toISOString() };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

/** Below this size, append only (fast path). Above: read + 180d retention + rewrite. */
const AUDIT_FULL_RETENTION_BYTES = 384 * 1024;

function appendAudit(entry) {
  ensureDataDir();
  const nowIso = new Date().toISOString();
  const line = JSON.stringify({
    ts: nowIso,
    ...entry,
  });
  // 保留近 180 天审计日志：大文件时读入并裁剪；小文件仅追加以降低 I/O
  if (fs.existsSync(AUDIT_PATH)) {
    try {
      const st = fs.statSync(AUDIT_PATH);
      if (st.size < AUDIT_FULL_RETENTION_BYTES) {
        fs.appendFileSync(AUDIT_PATH, line + '\n', 'utf8');
        return;
      }
      const cutoff = Date.now() - AUDIT_RETENTION_MS;
      const raw = fs.readFileSync(AUDIT_PATH, 'utf8');
      const kept = raw
        .split('\n')
        .filter(Boolean)
        .filter((l) => {
          try {
            const j = JSON.parse(l);
            const ts = Date.parse(String(j && j.ts ? j.ts : ''));
            return Number.isFinite(ts) ? ts >= cutoff : true;
          } catch {
            return true;
          }
        });
      kept.push(line);
      fs.writeFileSync(AUDIT_PATH, kept.join('\n') + '\n', 'utf8');
      return;
    } catch (e) {
      console.error('appendAudit retention cleanup failed, fallback append', e);
    }
  }
  fs.appendFileSync(AUDIT_PATH, line + '\n', 'utf8');
}

function readAuditTail(limit = 50) {
  ensureDataDir();
  if (!fs.existsSync(AUDIT_PATH)) return [];
  const content = fs.readFileSync(AUDIT_PATH, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  const slice = lines.slice(-limit);
  return slice.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { raw: l };
    }
  });
}

function readAuditAll() {
  ensureDataDir();
  if (!fs.existsSync(AUDIT_PATH)) return [];
  try {
    const content = fs.readFileSync(AUDIT_PATH, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    console.error('readAuditAll failed', e);
    return [];
  }
}

function toIsoDay(tsLike) {
  const ms = Date.parse(String(tsLike || ''));
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

function safeCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function buildUserActivityAnalytics({ days = 30, role = 'all', companyId = 'all', projectId = 'all', limit = 200 }) {
  const allAudit = readAuditAll();
  const { users } = readUsers();
  const userById = new Map(users.map((u) => [String(u.id), u]));
  const userIdByUsername = new Map(users.map((u) => [String(u.username || '').toLowerCase(), String(u.id)]));
  const now = Date.now();
  const windowMs = Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000;
  const sinceMs = now - windowMs;
  const sinceIso = new Date(sinceMs).toISOString();
  const byDay = new Map();
  const bucketByUser = new Map();

  const ensureBucket = (userId) => {
    if (!bucketByUser.has(userId)) {
      const profile = userById.get(userId);
      bucketByUser.set(userId, {
        userId,
        username: String(profile?.username || userId),
        role: String(profile?.role || 'Unknown'),
        companyId: String(profile?.companyId || ''),
        projectId: String(profile?.projectId || ''),
        loginOkCount: 0,
        loginFailCount: 0,
        assessmentsCreatedCount: 0,
        assessmentsSavedCount: 0,
        reportsDownloadedCount: 0,
        bugSubmittedCount: 0,
        bugStatusUpdatedCount: 0,
        standardsUpdatedCount: 0,
        settingsUpdatedCount: 0,
        activeDaysSet: new Set(),
        lastActiveAt: '',
        avgSessionGapHours: null,
        _lastEventTs: null,
        _sessionGapTotalMs: 0,
        _sessionGapCount: 0,
      });
    }
    return bucketByUser.get(userId);
  };

  const resolveUserId = (entry) => {
    const detail = entry && entry.detail && typeof entry.detail === 'object' ? entry.detail : {};
    const fromDetailId = String(detail.userId || '').trim();
    if (fromDetailId && userById.has(fromDetailId)) return fromDetailId;
    const actor = String(entry.actor || '').trim().toLowerCase();
    if (actor && userIdByUsername.has(actor)) return userIdByUsername.get(actor);
    const detailUsername = String(detail.username || '').trim().toLowerCase();
    if (detailUsername && userIdByUsername.has(detailUsername)) return userIdByUsername.get(detailUsername);
    return '';
  };

  for (const entry of allAudit) {
    const ts = Date.parse(String(entry?.ts || ''));
    if (!Number.isFinite(ts) || ts < sinceMs) continue;
    const action = String(entry?.action || '').trim();
    if (!action) continue;
    const day = toIsoDay(entry.ts);
    if (day) {
      if (!byDay.has(day)) {
        byDay.set(day, {
          day,
          activeUsers: new Set(),
          loginCount: 0,
          assessmentCreatedCount: 0,
          reportDownloadedCount: 0,
          bugSubmittedCount: 0,
          standardsUpdatedCount: 0,
        });
      }
    }
    const userId = resolveUserId(entry);
    if (!userId) continue;
    const bucket = ensureBucket(userId);
    if (bucket._lastEventTs && ts > bucket._lastEventTs) {
      const delta = ts - bucket._lastEventTs;
      if (delta <= 8 * 60 * 60 * 1000) {
        bucket._sessionGapTotalMs += delta;
        bucket._sessionGapCount += 1;
      }
    }
    bucket._lastEventTs = ts;
    if (day) {
      bucket.activeDaysSet.add(day);
      byDay.get(day).activeUsers.add(userId);
    }
    if (!bucket.lastActiveAt || String(entry.ts) > bucket.lastActiveAt) {
      bucket.lastActiveAt = String(entry.ts);
    }
    if (action === 'auth.login.ok') {
      bucket.loginOkCount += 1;
      if (day) byDay.get(day).loginCount += 1;
    } else if (action === 'auth.login.fail') {
      bucket.loginFailCount += 1;
    } else if (action === 'assessments.create') {
      bucket.assessmentsCreatedCount += safeCount(entry?.detail?.count || 1);
      if (day) byDay.get(day).assessmentCreatedCount += safeCount(entry?.detail?.count || 1);
    } else if (action === 'assessments.save') {
      bucket.assessmentsSavedCount += safeCount(entry?.detail?.count || 1);
    } else if (action === 'reports.download') {
      bucket.reportsDownloadedCount += 1;
      if (day) byDay.get(day).reportDownloadedCount += 1;
    } else if (action === 'bugs.submit') {
      bucket.bugSubmittedCount += 1;
      if (day) byDay.get(day).bugSubmittedCount += 1;
    } else if (action === 'bugs.status.update') {
      bucket.bugStatusUpdatedCount += 1;
    } else if (action === 'standards.update') {
      bucket.standardsUpdatedCount += 1;
      if (day) byDay.get(day).standardsUpdatedCount += 1;
    } else if (action === 'settings.save') {
      bucket.settingsUpdatedCount += 1;
    }
  }

  const filtered = Array.from(bucketByUser.values()).filter((u) => {
    if (role !== 'all' && u.role !== role) return false;
    if (companyId !== 'all' && String(u.companyId || '') !== companyId) return false;
    if (projectId !== 'all' && String(u.projectId || '') !== projectId) return false;
    return true;
  });

  const maxLogin = Math.max(1, ...filtered.map((u) => u.loginOkCount));
  const maxAssess = Math.max(1, ...filtered.map((u) => u.assessmentsCreatedCount + u.assessmentsSavedCount));
  const maxReport = Math.max(1, ...filtered.map((u) => u.reportsDownloadedCount));
  const maxStd = Math.max(1, ...filtered.map((u) => u.standardsUpdatedCount + u.settingsUpdatedCount));
  const maxBug = Math.max(1, ...filtered.map((u) => u.bugSubmittedCount));

  const usersOut = filtered
    .map((u) => {
      const loginScore = u.loginOkCount / maxLogin;
      const assessmentScore = (u.assessmentsCreatedCount + u.assessmentsSavedCount) / maxAssess;
      const reportScore = u.reportsDownloadedCount / maxReport;
      const standardsScore = (u.standardsUpdatedCount + u.settingsUpdatedCount) / maxStd;
      const bugBehaviorScore = u.bugSubmittedCount / maxBug;
      const activityScore = Math.round(
        Math.min(
          100,
          100 * (0.05 * loginScore + 0.3 * assessmentScore + 0.2 * reportScore + 0.25 * standardsScore + 0.25 * bugBehaviorScore)
        )
      );
      const activeDays = u.activeDaysSet.size;
      const loginTotal = u.loginOkCount + u.loginFailCount;
      const loginSuccessRate = loginTotal > 0 ? Number((u.loginOkCount / loginTotal).toFixed(3)) : null;
      const avgSessionGapHours =
        u._sessionGapCount > 0 ? Number((u._sessionGapTotalMs / u._sessionGapCount / (60 * 60 * 1000)).toFixed(2)) : null;
      return {
        userId: u.userId,
        username: u.username,
        role: u.role,
        companyId: u.companyId,
        projectId: u.projectId,
        activityScore,
        activeLevel: activityScore >= 70 ? 'high' : activityScore >= 40 ? 'medium' : 'low',
        activeDays,
        lastActiveAt: u.lastActiveAt || null,
        loginOkCount: u.loginOkCount,
        loginFailCount: u.loginFailCount,
        loginSuccessRate,
        assessmentsCreatedCount: u.assessmentsCreatedCount,
        assessmentsSavedCount: u.assessmentsSavedCount,
        reportsDownloadedCount: u.reportsDownloadedCount,
        bugSubmittedCount: u.bugSubmittedCount,
        bugStatusUpdatedCount: u.bugStatusUpdatedCount,
        standardsUpdatedCount: u.standardsUpdatedCount,
        settingsUpdatedCount: u.settingsUpdatedCount,
        avgSessionGapHours,
      };
    })
    .sort((a, b) => b.activityScore - a.activityScore || b.activeDays - a.activeDays)
    .slice(0, Math.max(1, Number(limit) || 200));

  const trend = Array.from(byDay.values())
    .map((d) => ({
      day: d.day,
      activeUsers: d.activeUsers.size,
      loginCount: d.loginCount,
      assessmentCreatedCount: d.assessmentCreatedCount,
      reportDownloadedCount: d.reportDownloadedCount,
      bugSubmittedCount: d.bugSubmittedCount || 0,
      standardsUpdatedCount: d.standardsUpdatedCount,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const scoreDist = { high: 0, medium: 0, low: 0 };
  usersOut.forEach((u) => {
    scoreDist[u.activeLevel] += 1;
  });
  const totalUsers = usersOut.length;
  const activeUsers = usersOut.filter((u) => u.activeDays > 0).length;

  return {
    window: { days: Math.max(1, Number(days) || 30), since: sinceIso, until: new Date(now).toISOString() },
    dimensions: { role, companyId, projectId },
    metricDefinitions: {
      activityScore:
        '0-100 weighted score (login 5%, assessments 30%, report download 20%, standards/settings update 25%, bug submission behavior 25%; bug score is normalized by bugSubmittedCount / maxBugSubmittedCount in selected window).',
      loginSuccessRate: 'loginOkCount / (loginOkCount + loginFailCount), null when no login events.',
      activeDays: 'Count of distinct UTC days with at least one tracked event.',
    },
    summary: {
      totalUsers,
      activeUsers,
      activeUserRatio: totalUsers > 0 ? Number((activeUsers / totalUsers).toFixed(3)) : 0,
      totalLoginOk: usersOut.reduce((acc, u) => acc + u.loginOkCount, 0),
      totalAssessmentsCreated: usersOut.reduce((acc, u) => acc + u.assessmentsCreatedCount, 0),
      totalReportsDownloaded: usersOut.reduce((acc, u) => acc + u.reportsDownloadedCount, 0),
      totalBugSubmitted: usersOut.reduce((acc, u) => acc + u.bugSubmittedCount, 0),
      totalStandardsUpdated: usersOut.reduce((acc, u) => acc + u.standardsUpdatedCount, 0),
      scoreDistribution: scoreDist,
    },
    trend,
    users: usersOut,
  };
}

function readAssessmentsStore() {
  ensureDataDir();
  if (!fs.existsSync(ASSESSMENTS_PATH)) return { byUser: {} };
  try {
    const raw = fs.readFileSync(ASSESSMENTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      byUser: parsed && typeof parsed.byUser === 'object' && parsed.byUser ? parsed.byUser : {},
    };
  } catch (e) {
    console.error('readAssessmentsStore', e);
    return { byUser: {} };
  }
}

function writeAssessmentsStore(payload) {
  ensureDataDir();
  fs.writeFileSync(ASSESSMENTS_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

function readBugsStore() {
  ensureDataDir();
  if (!fs.existsSync(BUGS_PATH)) return { bugs: [] };
  try {
    const raw = fs.readFileSync(BUGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { bugs: Array.isArray(parsed?.bugs) ? parsed.bugs : [] };
  } catch (e) {
    console.error('readBugsStore failed', e);
    return { bugs: [] };
  }
}

function writeBugsStore(payload) {
  ensureDataDir();
  fs.writeFileSync(BUGS_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

const ASSESSMENT_STATUS_SET = new Set(['Draft', 'In Progress', 'Completed']);
const FINDING_STATUS_SET = new Set(['Compliant', 'Partial', 'Non-Compliant', 'Not Applicable']);
const ATTENTION_STATE_SET = new Set(['pending', 'processing', 'resolved']);
const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/gi,
  /todo/gi,
  /待补充/g,
  /tbd/gi,
  /n\/a/gi,
  /无/gi,
  /暂无/gi,
];
const DEFAULT_ASSESSMENT_QUALITY_POLICY = {
  maxAssessmentsPerRequest: 200,
  maxEvidenceChars: 220000,
  minEvidenceChars: 220,
  minDistinctEvidenceChars: 120,
  minCoverageRatioForPublish: 0.8,
  minEvidencePerFindingChars: 25,
  minUniqueEvidenceRatio: 0.4,
  maxFindingTextChars: 15000,
  maxNameChars: 160,
  maxProjectLabelChars: 80,
  maxIdChars: 120,
  enforcementMode: 'soft',
  hardIssueCodes: ['coverage_below_threshold', 'evidence_too_short'],
};

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function clampNumber(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function getAssessmentQualityPolicy(settings) {
  const raw =
    settings &&
    settings.assessmentQuality &&
    typeof settings.assessmentQuality === 'object' &&
    !Array.isArray(settings.assessmentQuality)
      ? settings.assessmentQuality
      : {};
  return {
    maxAssessmentsPerRequest: clampInt(
      raw.maxAssessmentsPerRequest,
      1,
      1000,
      DEFAULT_ASSESSMENT_QUALITY_POLICY.maxAssessmentsPerRequest
    ),
    maxEvidenceChars: clampInt(raw.maxEvidenceChars, 5000, 1000000, DEFAULT_ASSESSMENT_QUALITY_POLICY.maxEvidenceChars),
    minEvidenceChars: clampInt(raw.minEvidenceChars, 0, 5000, DEFAULT_ASSESSMENT_QUALITY_POLICY.minEvidenceChars),
    minDistinctEvidenceChars: clampInt(
      raw.minDistinctEvidenceChars,
      0,
      5000,
      DEFAULT_ASSESSMENT_QUALITY_POLICY.minDistinctEvidenceChars
    ),
    minCoverageRatioForPublish: clampNumber(
      raw.minCoverageRatioForPublish,
      0,
      1,
      DEFAULT_ASSESSMENT_QUALITY_POLICY.minCoverageRatioForPublish
    ),
    minEvidencePerFindingChars: clampInt(
      raw.minEvidencePerFindingChars,
      0,
      500,
      DEFAULT_ASSESSMENT_QUALITY_POLICY.minEvidencePerFindingChars
    ),
    minUniqueEvidenceRatio: clampNumber(
      raw.minUniqueEvidenceRatio,
      0,
      1,
      DEFAULT_ASSESSMENT_QUALITY_POLICY.minUniqueEvidenceRatio
    ),
    maxFindingTextChars: clampInt(
      raw.maxFindingTextChars,
      200,
      50000,
      DEFAULT_ASSESSMENT_QUALITY_POLICY.maxFindingTextChars
    ),
    maxNameChars: clampInt(raw.maxNameChars, 20, 500, DEFAULT_ASSESSMENT_QUALITY_POLICY.maxNameChars),
    maxProjectLabelChars: clampInt(
      raw.maxProjectLabelChars,
      20,
      200,
      DEFAULT_ASSESSMENT_QUALITY_POLICY.maxProjectLabelChars
    ),
    maxIdChars: clampInt(raw.maxIdChars, 20, 200, DEFAULT_ASSESSMENT_QUALITY_POLICY.maxIdChars),
    enforcementMode:
      String(raw.enforcementMode || DEFAULT_ASSESSMENT_QUALITY_POLICY.enforcementMode).trim().toLowerCase() === 'hard'
        ? 'hard'
        : 'soft',
    hardIssueCodes: Array.isArray(raw.hardIssueCodes)
      ? raw.hardIssueCodes.map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
      : [...DEFAULT_ASSESSMENT_QUALITY_POLICY.hardIssueCodes],
  };
}

function normalizeWs(input) {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function calcEvidenceMetrics(evidenceText) {
  const raw = String(evidenceText || '');
  const trimmed = raw.trim();
  const normalized = normalizeWs(raw);
  const chars = trimmed.length;
  const distinctChars = new Set(normalized.replace(/\s+/g, '').split('')).size;
  const lines = raw
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  const uniqueLines = new Set(lines.map((x) => x.toLowerCase())).size;
  const uniqueLineRatio = lines.length > 0 ? uniqueLines / lines.length : 0;
  const placeholderHits = PLACEHOLDER_PATTERNS.reduce((acc, p) => acc + (normalized.match(p) || []).length, 0);
  return {
    chars,
    distinctChars,
    lines: lines.length,
    uniqueLines,
    uniqueLineRatio,
    placeholderHits,
    normalized,
  };
}

function calculateCoverageRatio(assessment, settings) {
  const findings = Array.isArray(assessment.findings) ? assessment.findings : [];
  const stdId = String(assessment.standardId || '').trim();
  const controlsMap =
    settings &&
    settings.standardsLibrary &&
    settings.standardsLibrary.controls &&
    typeof settings.standardsLibrary.controls === 'object'
      ? settings.standardsLibrary.controls
      : {};
  const controlList = Array.isArray(controlsMap[stdId]) ? controlsMap[stdId] : [];
  const totalControls = controlList.length;
  if (totalControls <= 0) {
    return { totalControls: 0, assessedControls: findings.length, ratio: findings.length > 0 ? 1 : 0 };
  }
  const covered = new Set(findings.map((f) => String(f && f.controlId ? f.controlId : '').trim()).filter(Boolean)).size;
  return {
    totalControls,
    assessedControls: covered,
    ratio: Math.min(1, covered / totalControls),
  };
}

function countParsedEvidenceItems(evidenceText) {
  const lines = String(evidenceText || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  if (lines.length === 0) return 0;
  const normalizeSheetName = (name) =>
    String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
  const isResearchListSheet = (name) => {
    const n = normalizeSheetName(name);
    return n === '调研清单' || n === 'researchlist' || n === 'research_checklist';
  };

  let activeSheet = '';
  let sawSheetHeader = false;
  let count = 0;
  for (const line of lines) {
    const zhSheetHeader = line.match(/^---\s*工作表\s*:\s*(.+?)\s*---$/i);
    const enSheetHeader = line.match(/^---\s*sheet\s*:\s*(.+?)\s*---$/i);
    if (zhSheetHeader || enSheetHeader) {
      sawSheetHeader = true;
      activeSheet = String((zhSheetHeader || enSheetHeader)?.[1] || '').trim();
      continue;
    }
    if (sawSheetHeader && !isResearchListSheet(activeSheet)) continue;
    if (/^[-=]{3,}$/.test(line)) continue;
    if (/^---\s*.+\s*---$/.test(line)) continue;
    if (/^(sheet|工作表)\s*[:：]/i.test(line)) continue;
    if (line.replace(/[|·•\-\s]/g, '').length < 2) continue;
    count += 1;
  }
  return count;
}

function hashAssessmentInput(assessment) {
  const findings = Array.isArray(assessment.findings) ? assessment.findings : [];
  const stableFindings = findings
    .map((f) => ({
      controlId: String(f?.controlId || '').trim(),
      status: String(f?.status || '').trim(),
      evidence: normalizeWs(String(f?.evidence || '')).slice(0, 500),
      analysis: normalizeWs(String(f?.analysis || '')).slice(0, 500),
      recommendation: normalizeWs(String(f?.recommendation || '')).slice(0, 500),
    }))
    .sort((a, b) => `${a.controlId}|${a.status}`.localeCompare(`${b.controlId}|${b.status}`));
  const payload = {
    standardId: String(assessment?.standardId || '').trim(),
    evidence: normalizeWs(String(assessment?.evidenceText || '')),
    findings: stableFindings,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function validateFindingShape(raw, idx, fIdx, policy) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `第 ${idx + 1} 条任务的 findings[${fIdx}] 不是对象` };
  }
  const controlId = String(raw.controlId || '').trim();
  const status = String(raw.status || '').trim();
  const attentionState = String(raw.attentionState || '').trim();
  const evidence = String(raw.evidence || '').trim();
  const analysis = String(raw.analysis || '').trim();
  const recommendation = String(raw.recommendation || '').trim();
  if (!controlId) return { ok: false, error: `第 ${idx + 1} 条任务的 findings[${fIdx}] 缺少 controlId` };
  if (!FINDING_STATUS_SET.has(status)) {
    return { ok: false, error: `第 ${idx + 1} 条任务的 findings[${fIdx}] status 非法` };
  }
  if (attentionState && !ATTENTION_STATE_SET.has(attentionState)) {
    return { ok: false, error: `第 ${idx + 1} 条任务的 findings[${fIdx}] attentionState 非法` };
  }
  if (
    evidence.length > policy.maxFindingTextChars ||
    analysis.length > policy.maxFindingTextChars ||
    recommendation.length > policy.maxFindingTextChars
  ) {
    return { ok: false, error: `第 ${idx + 1} 条任务的 findings[${fIdx}] 文本超长` };
  }
  return {
    ok: true,
    value: {
      controlId,
      status,
      attentionState: attentionState || undefined,
      evidence,
      analysis,
      recommendation,
    },
  };
}

function validateAssessmentRecord(raw, idx, policy, settings) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `第 ${idx + 1} 条任务不是对象` };
  }
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim();
  const standardId = String(raw.standardId || '').trim();
  const status = String(raw.status || '').trim();
  const createdAt = String(raw.createdAt || '').trim();
  const updatedAt = String(raw.updatedAt || new Date().toISOString()).trim();
  const customerName = String(raw.customerName || '').trim();
  const projectName = String(raw.projectName || '').trim();
  const companyId = String(raw.companyId || '').trim();
  const projectId = String(raw.projectId || '').trim();
  const createdBy = String(raw.createdBy || '').trim();
  const evidenceText = String(raw.evidenceText || '');
  const sequenceNo = Number.isFinite(Number(raw.sequenceNo)) ? Number(raw.sequenceNo) : undefined;
  if (!id || id.length > policy.maxIdChars) return { ok: false, error: `第 ${idx + 1} 条任务 id 无效` };
  if (!name || name.length > policy.maxNameChars) return { ok: false, error: `第 ${idx + 1} 条任务名称无效` };
  if (!standardId || standardId.length > policy.maxIdChars) return { ok: false, error: `第 ${idx + 1} 条任务 standardId 无效` };
  if (!ASSESSMENT_STATUS_SET.has(status)) return { ok: false, error: `第 ${idx + 1} 条任务 status 非法` };
  if (!createdAt) return { ok: false, error: `第 ${idx + 1} 条任务缺少 createdAt` };
  if (customerName.length > policy.maxProjectLabelChars || projectName.length > policy.maxProjectLabelChars) {
    return { ok: false, error: `第 ${idx + 1} 条任务客户/项目名称超长` };
  }
  if (evidenceText.length > policy.maxEvidenceChars) {
    return { ok: false, error: `第 ${idx + 1} 条任务证据文本超长（>${policy.maxEvidenceChars}）` };
  }
  const findingsRaw = Array.isArray(raw.findings) ? raw.findings : null;
  if (!findingsRaw) return { ok: false, error: `第 ${idx + 1} 条任务 findings 必须为数组` };
  const findings = [];
  for (let fIdx = 0; fIdx < findingsRaw.length; fIdx += 1) {
    const one = validateFindingShape(findingsRaw[fIdx], idx, fIdx, policy);
    if (!one.ok) return { ok: false, error: one.error };
    findings.push(one.value);
  }
  const evidenceMetrics = calcEvidenceMetrics(evidenceText);
  const coverage = calculateCoverageRatio({ standardId, findings }, settings);
  const evidencePerFindingChars = findings.length > 0 ? Math.round(evidenceMetrics.chars / findings.length) : evidenceMetrics.chars;
  const qualityIssues = [];
  if (evidenceMetrics.chars < policy.minEvidenceChars) qualityIssues.push('evidence_too_short');
  if (evidenceMetrics.distinctChars < policy.minDistinctEvidenceChars) qualityIssues.push('evidence_low_distinct_chars');
  if (evidenceMetrics.uniqueLineRatio < policy.minUniqueEvidenceRatio) qualityIssues.push('evidence_repetitive');
  if (evidenceMetrics.placeholderHits > 0) qualityIssues.push('evidence_placeholder_like_text');
  if (findings.length > 0 && evidencePerFindingChars < policy.minEvidencePerFindingChars) qualityIssues.push('evidence_per_finding_too_short');
  if (findings.length > 0 && coverage.ratio < policy.minCoverageRatioForPublish) qualityIssues.push('coverage_below_threshold');
  const hardIssueCodes = new Set(Array.isArray(policy.hardIssueCodes) ? policy.hardIssueCodes : []);
  const blockedByGate = policy.enforcementMode === 'hard' && qualityIssues.some((x) => hardIssueCodes.has(x));
  const qualityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        40 * Math.min(1, evidenceMetrics.chars / Math.max(policy.minEvidenceChars, 1)) +
          20 * Math.min(1, evidenceMetrics.distinctChars / Math.max(policy.minDistinctEvidenceChars, 1)) +
          25 * coverage.ratio +
          15 * Math.min(1, evidenceMetrics.uniqueLineRatio / Math.max(policy.minUniqueEvidenceRatio, 0.01))
      )
    )
  );
  const publishable = qualityIssues.length === 0;
  const normalized = {
    id,
    name,
    sequenceNo,
    standardId,
    customerName,
    projectName,
    companyId,
    projectId,
    createdBy,
    status: blockedByGate && status === 'Completed' ? 'Draft' : status,
    createdAt,
    updatedAt,
    findings,
    evidenceText,
  };
  normalized.inputFingerprint = hashAssessmentInput(normalized);
  normalized.quality = {
    publishable,
    blockedByGate,
    enforcementMode: policy.enforcementMode,
    score: qualityScore,
    confidence: qualityScore >= 85 ? 'High' : qualityScore >= 65 ? 'Medium' : 'Low',
    issues: qualityIssues,
    metrics: {
      evidenceChars: evidenceMetrics.chars,
      evidenceDistinctChars: evidenceMetrics.distinctChars,
      evidenceLineCount: evidenceMetrics.lines,
      evidenceUniqueLineRatio: Number(evidenceMetrics.uniqueLineRatio.toFixed(3)),
      evidencePlaceholderHits: evidenceMetrics.placeholderHits,
      evidencePerFindingChars,
      totalControls: coverage.totalControls,
      assessedControls: coverage.assessedControls,
      coverageRatio: Number(coverage.ratio.toFixed(3)),
    },
    policy: {
      minCoverageRatioForPublish: policy.minCoverageRatioForPublish,
      minEvidenceChars: policy.minEvidenceChars,
      minDistinctEvidenceChars: policy.minDistinctEvidenceChars,
      minUniqueEvidenceRatio: policy.minUniqueEvidenceRatio,
      minEvidencePerFindingChars: policy.minEvidencePerFindingChars,
    },
  };
  return { ok: true, value: normalized };
}

function readLegalRegulationsCache() {
  ensureDataDir();
  if (!fs.existsSync(LEGAL_REGULATIONS_CACHE_PATH)) return null;
  try {
    const raw = fs.readFileSync(LEGAL_REGULATIONS_CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('readLegalRegulationsCache', e);
    return null;
  }
}

function writeLegalRegulationsCache(payload) {
  ensureDataDir();
  fs.writeFileSync(LEGAL_REGULATIONS_CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

function collectLegalSearchResultsForPrompt(parsedJson, maxItems = 12) {
  const out = [];
  const take = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const r of arr) {
      if (out.length >= maxItems) return;
      if (!r || typeof r !== 'object') continue;
      out.push({
        title: String(r.title || r.name || r.documentTitle || r.docTitle || '').slice(0, 500),
        snippet: String(r.snippet || r.content || r.text || r.summary || r.answer || r.description || '').slice(0, 2000),
        source: String(r.source || r.url || r.link || r.reference || '').slice(0, 800),
        score: typeof r.score === 'number' ? r.score : undefined,
      });
    }
  };
  if (!parsedJson || typeof parsedJson !== 'object') return out;
  take(parsedJson.results);
  if (out.length < maxItems && parsedJson.response && typeof parsedJson.response === 'object') {
    const web = parsedJson.response.web;
    if (web && typeof web === 'object' && Array.isArray(web.results)) take(web.results);
    const summary = parsedJson.response.summary;
    if (summary && typeof summary === 'object' && Array.isArray(summary.related_links)) {
      for (const group of summary.related_links) {
        if (out.length >= maxItems) break;
        if (group && typeof group === 'object' && Array.isArray(group.items)) take(group.items);
      }
    }
  }
  if (out.length < maxItems && parsedJson.data && typeof parsedJson.data === 'object') {
    const data = parsedJson.data;
    if (Array.isArray(data.results)) take(data.results);
    if (out.length < maxItems && Array.isArray(data.items)) take(data.items);
  }
  if (out.length < maxItems) {
    if (Array.isArray(parsedJson.items)) take(parsedJson.items);
    if (out.length < maxItems && Array.isArray(parsedJson.documents)) take(parsedJson.documents);
    if (out.length < maxItems && Array.isArray(parsedJson.hits)) take(parsedJson.hits);
  }
  return out;
}

function normalizeLegalBriefingFromPostProcess(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : '';
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  const takeaways = Array.isArray(parsed.takeaways)
    ? parsed.takeaways.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
    : [];
  if (!headline && !summary && takeaways.length === 0) return null;
  return {
    headline: headline || '法规检索简报',
    summary,
    takeaways,
  };
}

function buildBriefingFromCache(cache) {
  const parsed =
    cache &&
    cache.postProcess &&
    typeof cache.postProcess === 'object' &&
    cache.postProcess.parsedJson &&
    typeof cache.postProcess.parsedJson === 'object'
      ? cache.postProcess.parsedJson
      : null;
  return normalizeLegalBriefingFromPostProcess(parsed);
}

function briefingFingerprint(b) {
  if (!b || typeof b !== 'object') return '';
  try {
    return JSON.stringify({
      h: b.headline || '',
      s: b.summary || '',
      t: Array.isArray(b.takeaways) ? b.takeaways : [],
    });
  } catch {
    return '';
  }
}

function extractAiAnswerFromLegalParsed(parsedJson) {
  try {
    if (!parsedJson || typeof parsedJson !== 'object') return '';
    const extractFromParsedAnswer = (container) => {
      if (!container || typeof container !== 'object') return '';
      const pa = container.parsedAnswer;
      if (!pa || typeof pa !== 'object') return '';
      const summary = typeof pa.summary === 'string' ? pa.summary.trim() : '';
      const headline = typeof pa.headline === 'string' ? pa.headline.trim() : '';
      if (summary && headline) return `${headline}\n\n${summary}`;
      if (summary) return summary;
      if (headline) return headline;
      return '';
    };
    const fromResponseParsed = extractFromParsedAnswer(parsedJson.response && parsedJson.response.ai);
    if (fromResponseParsed) return fromResponseParsed;
    const fromRootParsed = extractFromParsedAnswer(parsedJson.ai);
    if (fromRootParsed) return fromRootParsed;
    if (parsedJson.ai && typeof parsedJson.ai === 'object' && typeof parsedJson.ai.answer === 'string') {
      return parsedJson.ai.answer.trim();
    }
    if (
      parsedJson.response &&
      typeof parsedJson.response === 'object' &&
      parsedJson.response.ai &&
      typeof parsedJson.response.ai === 'object' &&
      typeof parsedJson.response.ai.answer === 'string'
    ) {
      return parsedJson.response.ai.answer.trim();
    }
    if (
      parsedJson.response &&
      typeof parsedJson.response === 'object' &&
      parsedJson.response.summary &&
      Array.isArray(parsedJson.response.summary)
    ) {
      const aiBlock = parsedJson.response.summary.find(
        (x) => x && typeof x === 'object' && x.type === 'ai_answer' && typeof x.content === 'string'
      );
      if (aiBlock && typeof aiBlock.content === 'string') return aiBlock.content.trim();
    }
  } catch {
    /* ignore */
  }
  return '';
}

function normalizeLegalResultList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      title: String(x.title || '').trim(),
      snippet: String(x.snippet || '').trim(),
      source: String(x.source || '').trim(),
    }))
    .filter((x) => x.title || x.snippet);
}

function normalizeLegalItemList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      title: String(x.title || '').trim(),
      docType: String(x.docType || '未知').trim() || '未知',
      status: String(x.status || '未知').trim() || '未知',
      keyPoints: Array.isArray(x.keyPoints) ? x.keyPoints.map((k) => String(k).trim()).filter(Boolean).slice(0, 12) : [],
      controlImpacts: Array.isArray(x.controlImpacts)
        ? x.controlImpacts.map((k) => String(k).trim()).filter(Boolean).slice(0, 12)
        : [],
      sourceSnippet: String(x.sourceSnippet || '').trim(),
    }))
    .filter((x) => x.title);
}

function legalResultFingerprint(x) {
  return `${String(x?.title || '').trim().toLowerCase()}|${String(x?.source || '').trim().toLowerCase()}`;
}

function legalItemFingerprint(x) {
  return `${String(x?.title || '').trim().toLowerCase()}|${String(x?.docType || '').trim().toLowerCase()}|${String(x?.status || '').trim().toLowerCase()}`;
}

function mergeUniqueByFingerprint(oldList, newList, fpFn) {
  const out = [];
  const seen = new Set();
  [...oldList, ...newList].forEach((x) => {
    const key = fpFn(x);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(x);
  });
  return out;
}

function parseModelJsonSafe(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct && typeof direct === 'object') return direct;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    const fromFence = tryParse(String(fenced[1]).trim());
    if (fromFence && typeof fromFence === 'object') return fromFence;
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const fromBraces = tryParse(raw.slice(first, last + 1));
    if (fromBraces && typeof fromBraces === 'object') return fromBraces;
  }
  return null;
}

function readLegalRegulationsHistory() {
  ensureDataDir();
  if (!fs.existsSync(LEGAL_REGULATIONS_HISTORY_PATH)) return [];
  try {
    const raw = fs.readFileSync(LEGAL_REGULATIONS_HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendLegalRegulationsHistory(entry) {
  const prev = readLegalRegulationsHistory();
  const next = [entry, ...prev].slice(0, 80);
  fs.writeFileSync(LEGAL_REGULATIONS_HISTORY_PATH, JSON.stringify(next, null, 2), 'utf8');
}

function isLikelyDockerRuntime() {
  try {
    return (
      fs.existsSync('/.dockerenv') ||
      fs.existsSync('/run/.containerenv') ||
      process.env.DOCKER === '1' ||
      process.env.RUNNING_IN_DOCKER === '1'
    );
  } catch {
    return process.env.DOCKER === '1';
  }
}

/**
 * 容器内访问宿主机上的 Agent：将 URL 中的 localhost / 127.0.0.1 改为 host.docker.internal。
 * Linux Docker 请在 compose 增加：extra_hosts: - "host.docker.internal:host-gateway"
 * 默认完整检索地址可在运行环境设置 LEGAL_IMA_SEARCH_URL（多为 :3001/agent/search，见 fetch 中 url 解析顺序）。
 * 也可用 LEGAL_IMA_HOST=192.168.x.x 强制覆盖主机名（不做 localhost 重写）。
 */
function resolveLegalSearchUpstreamUrl(urlStr) {
  const forced = (process.env.LEGAL_IMA_HOST || '').trim();
  try {
    const u = new URL(urlStr);
    if (!u.pathname || u.pathname === '') {
      u.pathname = '/';
    }
    if (forced) {
      u.hostname = forced;
      return u.toString();
    }
    if (isLikelyDockerRuntime() && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      u.hostname = 'host.docker.internal';
      return u.toString();
    }
    return u.toString();
  } catch {
    return urlStr;
  }
}

/**
 * 纠正常见误配：旧 API 在 3000 端口 /api/search；Agent 应在 3001 /agent/search。
 * 见项目说明：fetch('http://localhost:3001/agent/search', …)，勿用 :3000/api/search。
 */
function normalizeLegalSearchUpstreamUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const p = (u.pathname || '/').replace(/\/$/, '') || '/';
    if (p === '/api/search') {
      u.pathname = '/agent/search';
      if (u.port === '3000') {
        u.port = '3001';
      }
      return u.toString();
    }
    if (p === '/agent/search' && u.port === '3000') {
      u.port = '3001';
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return urlStr;
}

/** 404 时在 /agent/search 与 /api/agent/search 之间切换再试一次（Next 等常为后者） */
function alternateAgentSearchPathOn404(urlStr) {
  try {
    const u = new URL(urlStr);
    const p = (u.pathname || '/').replace(/\/$/, '') || '/';
    if (p === '/agent/search') {
      u.pathname = '/api/agent/search';
      return u.toString();
    }
    if (p === '/api/agent/search') {
      u.pathname = '/agent/search';
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/** 向完整 URL 发起 POST，body 为 JSON 对象 */
function httpPostJsonToUrl(urlStr, jsonBody, extraHeaders = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(urlStr);
    } catch {
      reject(new Error('URL 无效'));
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      reject(new Error('仅支持 http/https'));
      return;
    }
    const lib = target.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(jsonBody);
    const pathname = target.pathname || '/';
    const search = target.search || '';
    const opts = {
      method: 'POST',
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: pathname + search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...extraHeaders,
      },
      timeout: Math.max(5000, Number(timeoutMs) || 120000),
    };
    const reqUp = lib.request(opts, (resUp) => {
      let data = '';
      resUp.setEncoding('utf8');
      resUp.on('data', (c) => {
        data += c;
      });
      resUp.on('end', () => {
        resolve({ statusCode: resUp.statusCode || 0, rawText: data });
      });
    });
    reqUp.on('error', reject);
    reqUp.on('timeout', () => {
      reqUp.destroy();
      reject(new Error('upstream timeout'));
    });
    reqUp.write(payload);
    reqUp.end();
  });
}

function buildLegalPostProcessPrompt(query, parsedJson) {
  const agentAnswer = extractAiAnswerFromLegalParsed(parsedJson);
  const results = collectLegalSearchResultsForPrompt(parsedJson, 12);
  const compact = {
    query,
    totalCount: parsedJson && parsedJson.totalCount,
    knowledgeBaseCount: parsedJson && parsedJson.knowledgeBaseCount,
    agentAnswerExcerpt: agentAnswer ? agentAnswer.slice(0, 12000) : '',
    results,
  };
  return `你是面向企业客户的「法规合规简报」编辑。请阅读检索结果与 Agent 解读（如有），输出**仅一段合法 JSON**（不要 Markdown 代码块，不要前后说明文字）。\n\nJSON 必须严格符合下列字段与含义：\n{\n  "headline": "string（一行简报标题，专业、简洁）",\n  "summary": "string（面向客户的执行摘要：2～5 句，说明检索主题、监管要点与落地关注方向）",\n  "takeaways": ["string", "…"],\n  "items": [{\n    "title": "string",\n    "docType": "法律|行政法规|部门规章|国家标准|行业标准|地方性法规|其他|未知",\n    "publishDate": "string",\n    "effectiveDate": "string",\n    "status": "现行|修订中|废止|未知",\n    "keyPoints": ["string"],\n    "controlImpacts": ["string"],\n    "sourceSnippet": "string"\n  }],\n  "riskSignals": ["string"],\n  "confidence": 0.0\n}\n\n版式与内容要求：\n1) headline、summary、takeaways 供客户展示：语气正式、无口语；takeaways 共 3～6 条，每条不超过 40 字。\n2) items 对齐检索条目做结构化整理，至多 10 条；无信息的日期填空字符串 ""。\n3) 仅依据输入中的 results 与 agentAnswerExcerpt，不得虚构法规名称或条款号；信息不足时在 summary 中客观说明。\n4) riskSignals 列出需重点关注的合规信号（可为空数组）；confidence 为 0～1。\n\n输入数据：${JSON.stringify(compact)}`;
}

async function runLegalPostProcessWithModel(settings, prompt, modelOverride = '') {
  const modelCfg = { ...DEFAULT_SETTINGS.model, ...(settings.model || {}) };
  const pickProfile = (target) => {
    if (target === 'local') {
      return {
        provider: 'Ollama',
        ...(modelCfg.localModel || {}),
        model: String(modelOverride || modelCfg.localModel?.model || modelCfg.model || 'gpt-oss:20b').trim(),
        ollamaBaseUrl: String(modelCfg.localModel?.ollamaBaseUrl || modelCfg.ollamaBaseUrl || '').trim(),
      };
    }
    const cloud = modelCfg.cloudModel || {};
    return {
      provider: String(cloud.provider || (modelCfg.provider === 'Ollama' ? 'Gemini' : modelCfg.provider || 'Gemini')).trim(),
      ...cloud,
      model: String(modelOverride || cloud.model || modelCfg.model || '').trim(),
      geminiApiKey: String(cloud.geminiApiKey || modelCfg.geminiApiKey || '').trim(),
      openaiBaseUrl: String(cloud.openaiBaseUrl || modelCfg.openaiBaseUrl || '').trim(),
      openaiApiKey: String(cloud.openaiApiKey || modelCfg.openaiApiKey || '').trim(),
    };
  };
  const autoRoute = prompt.length > 2800 ? 'cloud' : String(modelCfg.primaryModel || 'local').trim();
  const route = autoRoute === 'cloud' ? ['cloud', 'local'] : ['local', 'cloud'];
  let lastError = null;
  for (const r of route) {
    try {
      const profile = pickProfile(r);
      if (!profile.model) throw new Error('缺少后处理模型名');
      const timeoutMs = Math.min(
        600000,
        Math.max(30000, Number(profile.timeoutSec || modelCfg.timeoutSec || 180) * 1000)
      );
      const temperature = Number(profile.temperature || modelCfg.temperature || 0);
      const topP = Number(profile.topP || modelCfg.topP || 0.9);
      const maxTokens = Number(profile.maxTokens || modelCfg.maxTokens || 2048);
      if (profile.provider === 'Ollama') {
        const rawBase = String(profile.ollamaBaseUrl || '').trim();
        if (!rawBase) throw new Error('缺少 Ollama 地址');
        const base = rawBase.startsWith('/') ? `http://127.0.0.1:${API_PORT}${rawBase}` : rawBase;
        const endpoint = `${base.replace(/\/$/, '')}/api/chat`;
        const body = {
          model: profile.model,
          stream: false,
          options: {
            temperature,
            top_p: topP,
          },
          messages: [{ role: 'user', content: prompt }],
        };
        const out = await httpPostJsonToUrl(endpoint, body, {}, timeoutMs);
        if (out.statusCode < 200 || out.statusCode >= 300) throw new Error(`后处理模型请求失败 HTTP ${out.statusCode}`);
        const j = JSON.parse(out.rawText || '{}');
        const text = String((j && j.message && j.message.content) || '').trim();
        if (!text) throw new Error('后处理模型未返回内容');
        return { provider: profile.provider, model: profile.model, rawText: text };
      }
      if (profile.provider === 'Gemini') {
        const key = String(profile.geminiApiKey || '').trim();
        if (!key) throw new Error('缺少 Gemini API Key');
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          profile.model || 'gemini-2.5-pro'
        )}:generateContent?key=${encodeURIComponent(key)}`;
        const payload = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature, topP, maxOutputTokens: maxTokens },
        };
        const out = await httpPostJsonToUrl(endpoint, payload, {}, timeoutMs);
        if (out.statusCode < 200 || out.statusCode >= 300) throw new Error(`后处理模型请求失败 HTTP ${out.statusCode}`);
        const j = JSON.parse(out.rawText || '{}');
        const text = String(j?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (!text) throw new Error('后处理模型未返回内容');
        return { provider: profile.provider, model: profile.model, rawText: text };
      }
      const baseUrl = String(profile.openaiBaseUrl || '').trim();
      const apiKey = String(profile.openaiApiKey || '').trim();
      if (!baseUrl || !apiKey) throw new Error('缺少 OpenAI 兼容后处理配置（openaiBaseUrl/openaiApiKey）');
      const normalizedBase = baseUrl.replace(/\/$/, '');
      const endpoint = /\/chat\/completions$/i.test(normalizedBase)
        ? normalizedBase
        : `${normalizedBase}/chat/completions`;
      const payload = {
        model: profile.model,
        temperature,
        top_p: topP,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      };
      const out = await httpPostJsonToUrl(endpoint, payload, { Authorization: `Bearer ${apiKey}` }, timeoutMs);
      if (out.statusCode < 200 || out.statusCode >= 300) throw new Error(`后处理模型请求失败 HTTP ${out.statusCode}`);
      const j = JSON.parse(out.rawText || '{}');
      const text = String((j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
      if (!text) throw new Error('后处理模型未返回内容');
      return { provider: profile.provider, model: profile.model, rawText: text };
    } catch (e) {
      lastError = e;
      if (!modelCfg.fallbackEnabled) break;
    }
  }
  throw lastError || new Error('后处理模型调用失败');
}

async function runAssistantChatWithModel(settings, prompt, mode = 'default') {
  const modelCfg = { ...DEFAULT_SETTINGS.model, ...(settings.model || {}) };
  const pickProfile = (target) => {
    if (target === 'local') {
      return {
        provider: 'Ollama',
        ...(modelCfg.localModel || {}),
        model: String(modelCfg.localModel?.model || modelCfg.model || 'gpt-oss:20b').trim(),
        ollamaBaseUrl: String(modelCfg.localModel?.ollamaBaseUrl || modelCfg.ollamaBaseUrl || '').trim(),
      };
    }
    const cloud = modelCfg.cloudModel || {};
    return {
      provider: String(cloud.provider || (modelCfg.provider === 'Ollama' ? 'Gemini' : modelCfg.provider || 'Gemini')).trim(),
      ...cloud,
      model: String(cloud.model || modelCfg.model || '').trim(),
      geminiApiKey: String(cloud.geminiApiKey || modelCfg.geminiApiKey || '').trim(),
      openaiBaseUrl: String(cloud.openaiBaseUrl || modelCfg.openaiBaseUrl || '').trim(),
      openaiApiKey: String(cloud.openaiApiKey || modelCfg.openaiApiKey || '').trim(),
    };
  };
  const routes =
    mode === 'local'
      ? ['local']
      : mode === 'cloud'
        ? ['cloud']
        : modelCfg.primaryModel === 'cloud'
          ? ['cloud', 'local']
          : ['local', 'cloud'];
  let lastError = null;
  for (const r of routes) {
    try {
      const profile = pickProfile(r);
      if (!profile.model) throw new Error('缺少模型名');
      const timeoutMs = Math.min(600000, Math.max(10000, Number(profile.timeoutSec || modelCfg.timeoutSec || 60) * 1000));
      const temperature = Number(profile.temperature || modelCfg.temperature || 0);
      const topP = Number(profile.topP || modelCfg.topP || 0.9);
      const maxTokens = Number(profile.maxTokens || modelCfg.maxTokens || 4096);
      if (profile.provider === 'Ollama') {
        const rawBase = String(profile.ollamaBaseUrl || '').trim();
        if (!rawBase) throw new Error('缺少 Ollama 地址');
        const base = rawBase.startsWith('/') ? `http://127.0.0.1:${API_PORT}${rawBase}` : rawBase;
        const endpoint = `${base.replace(/\/$/, '')}/api/chat`;
        const payload = {
          model: profile.model,
          stream: false,
          options: { temperature, top_p: topP, num_predict: maxTokens },
          messages: [{ role: 'user', content: prompt }],
        };
        const out = await httpPostJsonToUrl(endpoint, payload, {}, timeoutMs);
        if (out.statusCode < 200 || out.statusCode >= 300) throw new Error(`模型请求失败 HTTP ${out.statusCode}`);
        const j = JSON.parse(out.rawText || '{}');
        const text = String(j?.message?.content || '').trim();
        if (!text) throw new Error('模型未返回内容');
        return { provider: profile.provider, model: profile.model, route: r, text };
      }
      if (profile.provider === 'Gemini') {
        const key = String(profile.geminiApiKey || '').trim();
        if (!key) throw new Error('缺少 Gemini API Key');
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          profile.model || 'gemini-2.5-pro'
        )}:generateContent?key=${encodeURIComponent(key)}`;
        const payload = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, topP, maxOutputTokens: maxTokens },
        };
        const out = await httpPostJsonToUrl(endpoint, payload, {}, timeoutMs);
        if (out.statusCode < 200 || out.statusCode >= 300) throw new Error(`模型请求失败 HTTP ${out.statusCode}`);
        const j = JSON.parse(out.rawText || '{}');
        const text = String(j?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (!text) throw new Error('模型未返回内容');
        return { provider: profile.provider, model: profile.model, route: r, text };
      }
      const baseUrl = String(profile.openaiBaseUrl || '').trim();
      const apiKey = String(profile.openaiApiKey || '').trim();
      if (!baseUrl || !apiKey) throw new Error('缺少 OpenAI 兼容配置（openaiBaseUrl/openaiApiKey）');
      const normalizedBase = baseUrl.replace(/\/$/, '');
      const endpoint = /\/chat\/completions$/i.test(normalizedBase)
        ? normalizedBase
        : `${normalizedBase}/chat/completions`;
      const payload = {
        model: profile.model,
        temperature,
        top_p: topP,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      };
      let out = await httpPostJsonToUrl(endpoint, payload, { Authorization: `Bearer ${apiKey}` }, timeoutMs);
      if (out.statusCode === 401) {
        // Some OpenAI-compatible gateways require provider-specific key headers.
        out = await httpPostJsonToUrl(
          endpoint,
          payload,
          {
            Authorization: `Bearer ${apiKey}`,
            'X-DashScope-API-Key': apiKey,
            'api-key': apiKey,
          },
          timeoutMs
        );
      }
      if (out.statusCode < 200 || out.statusCode >= 300) {
        const snippet = String(out.rawText || '').slice(0, 220);
        throw new Error(`模型请求失败 HTTP ${out.statusCode}${snippet ? `: ${snippet}` : ''}`);
      }
      const j = JSON.parse(out.rawText || '{}');
      const text = String(j?.choices?.[0]?.message?.content || '').trim();
      if (!text) throw new Error('模型未返回内容');
      return { provider: profile.provider, model: profile.model, route: r, text };
    } catch (e) {
      lastError = e;
      if (mode !== 'default' || !modelCfg.fallbackEnabled) break;
    }
  }
  throw lastError || new Error('AI 助手调用失败');
}

async function testModelConnectivity(model, options = {}) {
  const provider = String(model?.provider || '').trim();
  const timeoutMs = Math.min(30_000, Math.max(5_000, Number(model?.timeoutSec || 15) * 1000));
  const ensureReady = options && options.ensureReady === true;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    if (provider === 'Ollama') {
      const rawBase = String(model?.ollamaBaseUrl || '').trim();
      if (!rawBase) throw new Error('缺少 Ollama 服务地址');
      const base = rawBase.startsWith('/') ? `http://127.0.0.1:${API_PORT}${rawBase}` : rawBase;
      const normalizedBase = base.replace(/\/$/, '');
      const endpoint = `${normalizedBase}/api/tags`;
      const r = await fetch(endpoint, { method: 'GET', signal: ctrl.signal });
      const t = await r.text();
      if (!r.ok) throw new Error(`Ollama 连通失败 HTTP ${r.status}`);
      let models = 0;
      let names = [];
      try {
        const j = JSON.parse(t || '{}');
        models = Array.isArray(j?.models) ? j.models.length : 0;
        names = Array.isArray(j?.models) ? j.models.map((m) => String(m?.name || '').trim()).filter(Boolean) : [];
      } catch {
        /* ignore */
      }
      const selectedModel = String(model?.model || model?.localModel?.model || '').trim();
      if (!selectedModel) return { provider, endpoint, detail: `Ollama 可达，模型数 ${models}` };

      const hasModel = names.some((n) => n === selectedModel || n === `${selectedModel}:latest`);
      if (!hasModel && ensureReady) {
        const pullCtrl = new AbortController();
        const pullTimer = setTimeout(() => pullCtrl.abort(), Math.min(10 * 60_000, Math.max(timeoutMs, 60_000)));
        try {
          const pr = await fetch(`${normalizedBase}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: selectedModel, stream: false }),
            signal: pullCtrl.signal,
          });
          const pt = await pr.text();
          if (!pr.ok) throw new Error(`模型拉取失败 HTTP ${pr.status} ${pt.slice(0, 120)}`);
        } finally {
          clearTimeout(pullTimer);
        }
      } else if (!hasModel) {
        throw new Error(`Ollama 已连接，但模型未安装：${selectedModel}`);
      }

      if (ensureReady) {
        const warmCtrl = new AbortController();
        const warmTimer = setTimeout(() => warmCtrl.abort(), Math.max(timeoutMs, 30_000));
        try {
          const wr = await fetch(`${normalizedBase}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: selectedModel,
              stream: false,
              options: { num_predict: 8, temperature: 0 },
              messages: [{ role: 'user', content: 'ping' }],
            }),
            signal: warmCtrl.signal,
          });
          const wt = await wr.text();
          if (!wr.ok) throw new Error(`模型启动失败 HTTP ${wr.status} ${wt.slice(0, 120)}`);
        } finally {
          clearTimeout(warmTimer);
        }
      }

      return {
        provider,
        endpoint,
        detail: ensureReady
          ? `Ollama 可达，模型 ${selectedModel} 已可用`
          : `Ollama 可达，模型数 ${models}，目标模型 ${selectedModel}${hasModel ? ' 已安装' : ' 未安装'}`,
      };
    }

    if (provider === 'Gemini') {
      const key = String(model?.geminiApiKey || '').trim();
      if (!key) throw new Error('缺少 Gemini API Key');
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
      const r = await fetch(endpoint, { method: 'GET', signal: ctrl.signal });
      const t = await r.text();
      if (!r.ok) throw new Error(`Gemini 连通失败 HTTP ${r.status}`);
      let count = 0;
      try {
        const j = JSON.parse(t || '{}');
        count = Array.isArray(j?.models) ? j.models.length : 0;
      } catch {
        /* ignore */
      }
      return { provider, endpoint: 'https://generativelanguage.googleapis.com/v1beta/models', detail: `Gemini 可达，可见模型 ${count}` };
    }

    const baseUrl = String(model?.openaiBaseUrl || '').trim();
    const apiKey = String(model?.openaiApiKey || '').trim();
    if (!baseUrl || !apiKey) throw new Error('缺少 OpenAI 兼容配置（Base URL / API Key）');
    const normalized = baseUrl.replace(/\/$/, '');
    const chatEndpoint = /\/chat\/completions$/i.test(normalized) ? normalized : `${normalized}/chat/completions`;
    const endpoint = /\/chat\/completions$/i.test(normalized) ? normalized.replace(/\/chat\/completions$/i, '/models') : `${normalized}/models`;
    const commonHeaders = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    try {
      const r = await fetch(endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: ctrl.signal,
      });
      const t = await r.text();
      if (!r.ok) {
        if (r.status === 401) {
          throw new Error(
            `模型服务鉴权失败 HTTP 401：API Key 无效、过期或与当前网关不匹配（${endpoint}）`
          );
        }
        throw new Error(`模型服务连通失败 HTTP ${r.status} ${t.slice(0, 200)}`);
      }
      let count = 0;
      try {
        const j = JSON.parse(t || '{}');
        count = Array.isArray(j?.data) ? j.data.length : 0;
      } catch {
        /* ignore */
      }
      return { provider, endpoint, detail: `服务可达，可见模型 ${count}` };
    } catch (modelsErr) {
      // Some OpenAI-compatible gateways disable /models; fallback to a lightweight chat ping.
      const selectedModel = String(model?.model || '').trim();
      if (!selectedModel) {
        throw new Error(`模型列表探测失败，且未配置模型名：${modelsErr && modelsErr.message ? modelsErr.message : String(modelsErr)}`);
      }
      const r = await fetch(chatEndpoint, {
        method: 'POST',
        headers: commonHeaders,
        signal: ctrl.signal,
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: 'user', content: 'ping' }],
          temperature: 0,
          max_tokens: 8,
          stream: false,
        }),
      });
      const t = await r.text();
      if (!r.ok) {
        if (r.status === 401) {
          throw new Error(
            `模型聊天鉴权失败 HTTP 401：API Key 无效、过期或与当前网关不匹配（${chatEndpoint}）`
          );
        }
        throw new Error(
          `模型连通失败：/models 与 /chat/completions 均失败。chat HTTP ${r.status} ${t.slice(0, 200)}`
        );
      }
      let hasContent = false;
      try {
        const j = JSON.parse(t || '{}');
        hasContent = Boolean(String(j?.choices?.[0]?.message?.content || '').trim());
      } catch {
        /* ignore */
      }
      return {
        provider,
        endpoint: chatEndpoint,
        detail: hasContent ? `服务可达，模型 ${selectedModel} 可调用` : `服务可达，模型 ${selectedModel} 调用成功`,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

function readUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_PATH)) {
    return { users: [] };
  }
  try {
    const raw = fs.readFileSync(USERS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { users: Array.isArray(parsed.users) ? parsed.users : [] };
  } catch (e) {
    console.error('readUsers failed', e);
    return { users: [] };
  }
}

function writeUsers(data) {
  ensureDataDir();
  fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return verifyHash === hash;
}

/** 新建/重置密码：>=8 位，含字母、数字、特殊字符（与 src/utils/passwordPolicy.ts 同步） */
function validatePasswordComplexity(password) {
  if (password.length < 8) return '密码长度至少为 8 位';
  if (!/[a-zA-Z]/.test(password)) return '密码需包含至少一个英文字母';
  if (!/\d/.test(password)) return '密码需包含至少一个数字';
  if (!/[^a-zA-Z0-9\s]/.test(password)) return '密码需包含至少一个特殊字符（不能仅为字母、数字或空格）';
  return null;
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signJwt(payload) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  });
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractBearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

function hasPermission(user, settings, key) {
  const matrix = mergeMatrix(settings.permissions);
  const row = matrix[user.role];
  if (!row) return false;
  return !!row[key];
}

function requireAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  const payload = verifyJwt(token);
  if (!payload || !payload.sub) {
    return res.status(401).json({ error: '登录已失效' });
  }
  const { users } = readUsers();
  const user = users.find((u) => u.id === payload.sub);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }
  req.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    companyId: user.companyId || '',
    projectId: user.projectId || '',
    teamId: user.teamId || '',
    visibleCompanyIds: Array.isArray(user.visibleCompanyIds) ? user.visibleCompanyIds : [],
    visibleProjectIds: Array.isArray(user.visibleProjectIds) ? user.visibleProjectIds : [],
  };
  next();
}

const app = express();

// 开发/直连调试：允许浏览器直接请求 8787（不走 Vite 代理时）
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

if (OLLAMA_PROXY_TARGET) {
  const { createProxyMiddleware } = require('http-proxy-middleware');
  /** 推理可能较慢，避免反代默认短超时断开 */
  const OLLAMA_PROXY_MS = Math.min(
    3_600_000,
    Math.max(60_000, Number(process.env.OLLAMA_PROXY_TIMEOUT_MS || 600_000))
  );
  app.use(
    '/ollama',
    createProxyMiddleware({
      target: OLLAMA_PROXY_TARGET,
      changeOrigin: true,
      pathRewrite: { '^/ollama': '' },
      timeout: OLLAMA_PROXY_MS,
      proxyTimeout: OLLAMA_PROXY_MS,
    })
  );
  console.log(
    `[ai-guardian api] Ollama reverse proxy: /ollama -> ${OLLAMA_PROXY_TARGET} (timeout ${OLLAMA_PROXY_MS}ms)`
  );
}

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    dataDir: DATA_DIR,
    ollamaProxy: !!OLLAMA_PROXY_TARGET,
    ollamaProxyTarget: OLLAMA_PROXY_TARGET || null,
  });
});

/** 从 API 进程直接请求 Ollama，用于排查 Docker/网络（不经过浏览器） */
app.get('/api/health/ollama', async (_req, res) => {
  const target = (OLLAMA_PROXY_TARGET || '').replace(/\/$/, '');
  if (!target) {
    return res.json({ ok: false, error: 'OLLAMA_PROXY_TARGET 未配置' });
  }
  const tagsUrl = `${target}/api/tags`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(tagsUrl, { signal: ctrl.signal });
    const body = await r.text();
    clearTimeout(t);
    return res.json({
      ok: r.ok,
      ollamaProxyTarget: target,
      ollamaHttpStatus: r.status,
      message: r.ok ? 'Ollama 可达（/api/tags）' : body.slice(0, 300),
    });
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    return res.json({
      ok: false,
      ollamaProxyTarget: target,
      error: msg,
      hint:
        '若应用跑在 Docker 内：宿主机 Ollama 勿只监听 127.0.0.1，请设置环境变量 OLLAMA_HOST=0.0.0.0:11434 后重启 Ollama；或把 compose 的 OLLAMA_PROXY_TARGET 改为实际可达的 http://IP:11434。',
    });
  }
});

app.get('/api/auth/status', (_req, res) => {
  const { users } = readUsers();
  res.json({
    needsBootstrap: users.length === 0,
    userCount: users.length,
  });
});

app.post('/api/auth/bootstrap', (req, res) => {
  const { users } = readUsers();
  if (users.length > 0) {
    return res.status(403).json({ error: '已存在用户，请使用登录' });
  }
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (username.length < 2) {
    return res.status(400).json({ error: '用户名至少 2 个字符' });
  }
  const pwErr = validatePasswordComplexity(password);
  if (pwErr) {
    return res.status(400).json({ error: pwErr });
  }
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  const id = `u_${crypto.randomBytes(8).toString('hex')}`;
  const record = {
    id,
    username,
    passwordHash: hashPassword(password),
    role: 'SuperAdmin',
    visibleCompanyIds: [],
    visibleProjectIds: [],
    createdAt: new Date().toISOString(),
  };
  writeUsers({ users: [record] });
  appendAudit({ action: 'auth.bootstrap', detail: { username } });
  const token = signJwt({ sub: id });
  res.json({
    token,
    user: { id, username, role: record.role },
  });
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const { users } = readUsers();
  const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    appendAudit({ action: 'auth.login.fail', detail: { username } });
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  appendAudit({ action: 'auth.login.ok', detail: { userId: user.id, username: user.username } });
  const token = signJwt({ sub: user.id });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      companyId: user.companyId || '',
      projectId: user.projectId || '',
      teamId: user.teamId || '',
      description: user.description || '',
      visibleCompanyIds: Array.isArray(user.visibleCompanyIds) ? user.visibleCompanyIds : [],
      visibleProjectIds: Array.isArray(user.visibleProjectIds) ? user.visibleProjectIds : [],
    },
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/assessments', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'runAssessments')) {
    return res.status(403).json({ error: '无权查看评估任务' });
  }
  const store = readAssessmentsStore();
  const list = Array.isArray(store.byUser[req.user.id]) ? store.byUser[req.user.id] : [];
  res.json({ assessments: list });
});

app.post('/api/assessments/precheck', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'runAssessments')) {
    return res.status(403).json({ error: '无权执行评估输入预检查' });
  }
  const raw = req.body && typeof req.body.assessment === 'object' ? req.body.assessment : null;
  if (!raw) {
    return res.status(400).json({ error: 'assessment 不能为空' });
  }
  const standardId = String(raw.standardId || '').trim();
  const evidenceText = String(raw.evidenceText || '');
  if (!standardId) {
    return res.status(400).json({ error: 'standardId 不能为空' });
  }
  const controlsMap =
    settings &&
    settings.standardsLibrary &&
    settings.standardsLibrary.controls &&
    typeof settings.standardsLibrary.controls === 'object'
      ? settings.standardsLibrary.controls
      : {};
  const standardControlCount = Array.isArray(controlsMap[standardId]) ? controlsMap[standardId].length : 0;
  const parsedItemCount = countParsedEvidenceItems(evidenceText);
  const matched = parsedItemCount === standardControlCount;
  const message = matched
    ? `调研条目数与标准条款数一致（${parsedItemCount}）`
    : `调研条目数（${parsedItemCount}）与标准条款数（${standardControlCount}）不一致，请检查并更新调研文件后重试。`;

  appendAudit({
    action: 'assessments.precheck',
    actor: req.user.username,
    detail: {
      assessmentId: String(raw.id || ''),
      standardId,
      parsedItemCount,
      standardControlCount,
      matched,
    },
  });
  return res.json({
    ok: true,
    assessmentId: String(raw.id || ''),
    standardId,
    parsedItemCount,
    standardControlCount,
    matched,
    message,
  });
});

app.put('/api/assessments', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'runAssessments')) {
    return res.status(403).json({ error: '无权保存评估任务' });
  }
  const policy = getAssessmentQualityPolicy(settings);
  const assessments = Array.isArray(req.body?.assessments) ? req.body.assessments : null;
  if (!assessments) {
    return res.status(400).json({ error: 'assessments 必须为数组' });
  }
  if (assessments.length > policy.maxAssessmentsPerRequest) {
    return res.status(400).json({ error: `一次最多保存 ${policy.maxAssessmentsPerRequest} 条任务` });
  }
  const normalized = [];
  const idSet = new Set();
  for (let i = 0; i < assessments.length; i += 1) {
    const checked = validateAssessmentRecord(assessments[i], i, policy, settings);
    if (!checked.ok) {
      appendAudit({
        action: 'assessments.save.reject',
        actor: req.user.username,
        detail: { index: i, reason: checked.error },
      });
      return res.status(400).json({ error: checked.error, index: i });
    }
    if (idSet.has(checked.value.id)) {
      return res.status(400).json({ error: `存在重复任务 id: ${checked.value.id}` });
    }
    idSet.add(checked.value.id);
    normalized.push(checked.value);
  }
  const visibleCompanyIds = Array.isArray(req.user.visibleCompanyIds) ? req.user.visibleCompanyIds : [];
  const visibleProjectIds = Array.isArray(req.user.visibleProjectIds) ? req.user.visibleProjectIds : [];
  const hasCompanyScope = visibleCompanyIds.length > 0;
  const hasProjectScope = visibleProjectIds.length > 0;
  const outOfScope = normalized.find((a) => {
    const companyId = String(a?.companyId || '');
    const projectId = String(a?.projectId || '');
    if (hasCompanyScope && companyId && !visibleCompanyIds.includes(companyId)) return true;
    if (hasProjectScope && projectId && !visibleProjectIds.includes(projectId)) return true;
    return false;
  });
  if (outOfScope) {
    return res.status(403).json({ error: '包含超出当前用户可见范围（公司/项目）的任务数据' });
  }
  const store = readAssessmentsStore();
  const previous = Array.isArray(store.byUser[req.user.id]) ? store.byUser[req.user.id] : [];
  const prevById = new Map(previous.map((x) => [String(x && x.id ? x.id : ''), x]));
  const issueDistribution = {};
  const saved = normalized.map((item) => {
    const prev = prevById.get(item.id);
    const prevFingerprint = String(prev && prev.inputFingerprint ? prev.inputFingerprint : '');
    if (prev && prevFingerprint && prevFingerprint === item.inputFingerprint && Array.isArray(prev.findings) && prev.findings.length > 0) {
      return {
        ...item,
        findings: prev.findings,
        quality: prev.quality || item.quality,
        status: prev.status || item.status,
      };
    }
    for (const reason of item.quality.issues) {
      issueDistribution[reason] = (issueDistribution[reason] || 0) + 1;
    }
    return item;
  });
  const createdIds = saved
    .map((x) => x.id)
    .filter((id) => !prevById.has(id));
  if (createdIds.length > 0) {
    appendAudit({
      action: 'assessments.create',
      actor: req.user.username,
      detail: {
        count: createdIds.length,
        assessmentIds: createdIds.slice(0, 20),
      },
    });
  }
  store.byUser[req.user.id] = saved;
  writeAssessmentsStore(store);
  const publishableCount = saved.filter((x) => x?.quality?.publishable).length;
  const draftByGate = saved.filter((x) => x?.status === 'Draft' && Array.isArray(x?.quality?.issues) && x.quality.issues.length > 0).length;
  appendAudit({
    action: 'assessments.save',
    actor: req.user.username,
    detail: {
      count: saved.length,
      publishableCount,
      draftByGate,
      issueDistribution,
    },
  });
  res.json({
    ok: true,
    count: saved.length,
    publishableCount,
    draftByGate,
    issueDistribution,
  });
});

app.get('/api/users', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'manageUsers')) {
    return res.status(403).json({ error: '无权管理用户' });
  }
  const { users } = readUsers();
  res.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      companyId: u.companyId || '',
      projectId: u.projectId || '',
      teamId: u.teamId || '',
      description: u.description || '',
      visibleCompanyIds: Array.isArray(u.visibleCompanyIds) ? u.visibleCompanyIds : [],
      visibleProjectIds: Array.isArray(u.visibleProjectIds) ? u.visibleProjectIds : [],
      createdAt: u.createdAt,
    })),
  });
});

app.post('/api/users', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'manageUsers')) {
    return res.status(403).json({ error: '无权管理用户' });
  }
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || '');
  const companyId = String(req.body?.companyId || '').trim();
  const projectId = String(req.body?.projectId || '').trim();
  const teamId = String(req.body?.teamId || '').trim();
  const description = String(req.body?.description || '').trim();
  const visibleCompanyIds = Array.isArray(req.body?.visibleCompanyIds) ? req.body.visibleCompanyIds.map((x) => String(x).trim()).filter(Boolean) : [];
  const visibleProjectIds = Array.isArray(req.body?.visibleProjectIds) ? req.body.visibleProjectIds.map((x) => String(x).trim()).filter(Boolean) : [];
  if (username.length < 2) {
    return res.status(400).json({ error: '用户名至少 2 个字符' });
  }
  const pwErr = validatePasswordComplexity(password);
  if (pwErr) {
    return res.status(400).json({ error: pwErr });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: '无效角色' });
  }
  if (!companyId || !projectId || !teamId) {
    return res.status(400).json({ error: '新增用户必须选择公司、项目、团队' });
  }
  const baseInfo = settings.baseInfo && typeof settings.baseInfo === 'object' ? settings.baseInfo : { companies: [], projects: [], teams: [] };
  const companies = Array.isArray(baseInfo.companies) ? baseInfo.companies : [];
  const projects = Array.isArray(baseInfo.projects) ? baseInfo.projects : [];
  const teams = Array.isArray(baseInfo.teams) ? baseInfo.teams : [];
  const project = projects.find((x) => x && String(x.id) === projectId);
  const team = teams.find((x) => x && String(x.id) === teamId);
  if (!companies.some((x) => x && String(x.id) === companyId)) {
    return res.status(400).json({ error: '所选公司不存在' });
  }
  if (!project || String(project.companyId) !== companyId) {
    return res.status(400).json({ error: '所选项目与公司不匹配' });
  }
  if (!team || String(team.companyId) !== companyId || !Array.isArray(team.projectIds) || !team.projectIds.includes(projectId)) {
    return res.status(400).json({ error: '所选团队与公司/项目不匹配' });
  }
  if (visibleCompanyIds.some((id) => !companies.some((x) => String(x.id) === id))) {
    return res.status(400).json({ error: '可见公司范围包含无效项' });
  }
  if (visibleProjectIds.some((id) => !projects.some((x) => String(x.id) === id))) {
    return res.status(400).json({ error: '可见项目范围包含无效项' });
  }
  const data = readUsers();
  if (data.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  const id = `u_${crypto.randomBytes(8).toString('hex')}`;
  const record = {
    id,
    username,
    passwordHash: hashPassword(password),
    role,
    companyId,
    projectId,
    teamId,
    description,
    visibleCompanyIds,
    visibleProjectIds,
    createdAt: new Date().toISOString(),
  };
  data.users.push(record);
  writeUsers(data);
  appendAudit({
    action: 'users.create',
    actor: req.user.username,
    detail: { id, username, role, companyId, projectId, teamId, visibleCompanyCount: visibleCompanyIds.length, visibleProjectCount: visibleProjectIds.length },
  });
  res.json({
    user: {
      id: record.id,
      username: record.username,
      role: record.role,
      companyId: record.companyId,
      projectId: record.projectId,
      teamId: record.teamId,
      description: record.description,
      visibleCompanyIds: record.visibleCompanyIds,
      visibleProjectIds: record.visibleProjectIds,
      createdAt: record.createdAt,
    },
  });
});

app.patch('/api/users/:id', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'manageUsers')) {
    return res.status(403).json({ error: '无权管理用户' });
  }
  const id = req.params.id;
  const data = readUsers();
  const idx = data.users.findIndex((u) => u.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: '用户不存在' });
  }
  const target = data.users[idx];
  const baseInfo = settings.baseInfo && typeof settings.baseInfo === 'object' ? settings.baseInfo : { companies: [], projects: [], teams: [] };
  const companies = Array.isArray(baseInfo.companies) ? baseInfo.companies : [];
  const projects = Array.isArray(baseInfo.projects) ? baseInfo.projects : [];
  const teams = Array.isArray(baseInfo.teams) ? baseInfo.teams : [];
  if (req.body.role != null) {
    const role = String(req.body.role);
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: '无效角色' });
    }
    const superAdmins = data.users.filter((u) => u.role === 'SuperAdmin');
    if (target.role === 'SuperAdmin' && role !== 'SuperAdmin' && superAdmins.length <= 1) {
      return res.status(400).json({ error: '不能移除唯一的超级管理员' });
    }
    target.role = role;
  }
  if (req.body.password != null) {
    const p = String(req.body.password);
    if (p.length > 0) {
      const err = validatePasswordComplexity(p);
      if (err) {
        return res.status(400).json({ error: err });
      }
      target.passwordHash = hashPassword(p);
    }
  }
  if (req.body.companyId != null || req.body.projectId != null || req.body.teamId != null || req.body.description != null) {
    const companyId = String(req.body.companyId ?? target.companyId ?? '').trim();
    const projectId = String(req.body.projectId ?? target.projectId ?? '').trim();
    const teamId = String(req.body.teamId ?? target.teamId ?? '').trim();
    const description = String(req.body.description ?? target.description ?? '').trim();
    if (!companyId || !projectId || !teamId) {
      return res.status(400).json({ error: '公司、项目、团队不能为空' });
    }
    const project = projects.find((x) => x && String(x.id) === projectId);
    const team = teams.find((x) => x && String(x.id) === teamId);
    if (!companies.some((x) => x && String(x.id) === companyId)) {
      return res.status(400).json({ error: '所选公司不存在' });
    }
    if (!project || String(project.companyId) !== companyId) {
      return res.status(400).json({ error: '所选项目与公司不匹配' });
    }
    if (!team || String(team.companyId) !== companyId || !Array.isArray(team.projectIds) || !team.projectIds.includes(projectId)) {
      return res.status(400).json({ error: '所选团队与公司/项目不匹配' });
    }
    target.companyId = companyId;
    target.projectId = projectId;
    target.teamId = teamId;
    target.description = description;
  }
  if (req.body.visibleCompanyIds != null || req.body.visibleProjectIds != null) {
    const visibleCompanyIds = Array.isArray(req.body.visibleCompanyIds)
      ? req.body.visibleCompanyIds.map((x) => String(x).trim()).filter(Boolean)
      : Array.isArray(target.visibleCompanyIds)
        ? target.visibleCompanyIds
        : [];
    const visibleProjectIds = Array.isArray(req.body.visibleProjectIds)
      ? req.body.visibleProjectIds.map((x) => String(x).trim()).filter(Boolean)
      : Array.isArray(target.visibleProjectIds)
        ? target.visibleProjectIds
        : [];
    if (visibleCompanyIds.some((id) => !companies.some((x) => String(x.id) === id))) {
      return res.status(400).json({ error: '可见公司范围包含无效项' });
    }
    if (visibleProjectIds.some((id) => !projects.some((x) => String(x.id) === id))) {
      return res.status(400).json({ error: '可见项目范围包含无效项' });
    }
    target.visibleCompanyIds = visibleCompanyIds;
    target.visibleProjectIds = visibleProjectIds;
  }
  data.users[idx] = target;
  writeUsers(data);
  appendAudit({
    action: 'users.patch',
    actor: req.user.username,
    detail: { id, fields: Object.keys(req.body || {}) },
  });
  res.json({
    user: {
      id: target.id,
      username: target.username,
      role: target.role,
      companyId: target.companyId || '',
      projectId: target.projectId || '',
      teamId: target.teamId || '',
      description: target.description || '',
      visibleCompanyIds: Array.isArray(target.visibleCompanyIds) ? target.visibleCompanyIds : [],
      visibleProjectIds: Array.isArray(target.visibleProjectIds) ? target.visibleProjectIds : [],
      createdAt: target.createdAt,
    },
  });
});

app.delete('/api/users/:id', requireAuth, (req, res) => {
  return res.status(400).json({ error: '当前版本不允许删除已有用户，请使用编辑功能调整归属与角色。' });
});

app.get('/api/settings', requireAuth, (_req, res) => {
  res.json(normalizeSettingsForClient(readSettings()));
});

app.post('/api/model/test-connection', requireAuth, async (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'configureAiModel')) {
    return res.status(403).json({ error: '无权测试 AI 模型连通性' });
  }
  const bodyModel = req.body && req.body.model && typeof req.body.model === 'object' ? req.body.model : {};
  const ensureReady = req.body && req.body.ensureReady === true;
  const target = String(req.body?.target || 'primary').trim();
  const merged = { ...DEFAULT_SETTINGS.model, ...(settings.model || {}), ...bodyModel };
  const pickModel = (kind) => {
    if (kind === 'local') {
      const local = merged.localModel && typeof merged.localModel === 'object' ? merged.localModel : {};
      // Never fall back to merged.model here: when primary is cloud it may be a Gemini/OpenAI name and would break Ollama checks.
      const localModelName = String(local.model || '').trim();
      const localUrl = String(local.ollamaBaseUrl || merged.ollamaBaseUrl || '').trim();
      return {
        ...merged,
        provider: 'Ollama',
        localModel: local,
        model: localModelName,
        ollamaBaseUrl: localUrl,
      };
    }
    if (kind === 'cloud') {
      const c = merged.cloudModel || {};
      return {
        ...merged,
        provider: c.provider || (merged.provider === 'Ollama' ? 'Gemini' : merged.provider),
        model: c.model || merged.model,
        geminiApiKey: c.geminiApiKey || merged.geminiApiKey,
        openaiBaseUrl: c.openaiBaseUrl || merged.openaiBaseUrl,
        openaiApiKey: c.openaiApiKey || merged.openaiApiKey,
      };
    }
    return merged.primaryModel === 'cloud' ? pickModel('cloud') : pickModel('local');
  };
  try {
    const started = Date.now();
    const out = await testModelConnectivity(pickModel(target), { ensureReady });
    res.json({
      ok: true,
      provider: out.provider,
      endpoint: out.endpoint,
      elapsedMs: Date.now() - started,
      detail: out.detail,
    });
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: e && e.message ? e.message : String(e),
    });
  }
});

app.post('/api/model/runtime-event', requireAuth, (req, res) => {
  const event = String(req.body?.event || '').trim();
  const detail = req.body?.detail && typeof req.body.detail === 'object' ? req.body.detail : {};
  const allowed = new Set([
    'local_circuit_open',
    'local_circuit_recovered',
    'local_probe_failed',
    'local_route_fail',
  ]);
  if (!allowed.has(event)) {
    return res.status(400).json({ error: 'invalid runtime event' });
  }
  appendAudit({
    action: `model.runtime.${event}`,
    actor: req.user.username,
    detail,
  });
  res.json({ ok: true });
});

app.post('/api/ai-assistant/chat', requireAuth, async (req, res) => {
  const settings = readSettings();
  const message = String(req.body?.message || '').trim();
  const mode = String(req.body?.mode || 'default').trim();
  if (!message) return res.status(400).json({ error: 'message 不能为空' });
  if (!['default', 'local', 'cloud'].includes(mode)) {
    return res.status(400).json({ error: 'mode 必须是 default/local/cloud' });
  }
  try {
    const started = Date.now();
    const out = await runAssistantChatWithModel(settings, message, mode);
    appendAudit({
      action: 'ai-assistant.chat',
      actor: req.user.username,
      detail: { mode, provider: out.provider, model: out.model, route: out.route, elapsedMs: Date.now() - started },
    });
    res.json({ ok: true, text: out.text, provider: out.provider, model: out.model, route: out.route, elapsedMs: Date.now() - started });
  } catch (e) {
    res.status(502).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});

app.put('/api/settings', requireAuth, (req, res) => {
  try {
    const current = readSettings();
    const body = req.body || {};
    const settings = readSettings();

    if (body.model != null && !hasPermission(req.user, settings, 'configureAiModel')) {
      return res.status(403).json({ error: '无权修改 AI 模型参数' });
    }
    if (body.sync != null && !hasPermission(req.user, settings, 'editStandards')) {
      return res.status(403).json({ error: '无权修改同步配置' });
    }
    if (body.permissions != null && !hasPermission(req.user, settings, 'manageUsers')) {
      return res.status(403).json({ error: '无权修改权限矩阵' });
    }
    if (body.standardsLibrary != null && !hasPermission(req.user, settings, 'editStandards')) {
      return res.status(403).json({ error: '无权修改标准库' });
    }

    const next = {
      locale: current.locale || DEFAULT_SETTINGS.locale,
      model: current.model,
      sync: current.sync,
      baseInfo: current.baseInfo,
      standardsLibrary: current.standardsLibrary,
      permissions: current.permissions,
    };
    if (body.locale != null) {
      const locale = String(body.locale).trim();
      next.locale = locale === 'en-US' ? 'en-US' : 'zh-CN';
    }
    if (body.model != null) {
      next.model = { ...current.model, ...body.model };
    }
    if (body.sync != null) {
      next.sync = { ...current.sync, ...body.sync };
      delete next.sync.legalImaClientId;
      delete next.sync.legalImaApiKey;
      delete next.sync.legalImaKnowledgeBaseId;
      delete next.sync.legalApiKey;
    }
    if (body.permissions != null) {
      next.permissions = body.permissions;
    }
    if (body.baseInfo != null) {
      if (!hasPermission(req.user, settings, 'manageUsers')) {
        return res.status(403).json({ error: '无权修改基础信息配置' });
      }
      const raw = body.baseInfo && typeof body.baseInfo === 'object' ? body.baseInfo : {};
      const companies = Array.isArray(raw.companies) ? raw.companies : [];
      const projects = Array.isArray(raw.projects) ? raw.projects : [];
      const teams = Array.isArray(raw.teams) ? raw.teams : [];
      next.baseInfo = { companies, projects, teams };
    }
    if (body.standardsLibrary != null) {
      const raw = body.standardsLibrary && typeof body.standardsLibrary === 'object' ? body.standardsLibrary : {};
      const catalogEntries = Array.isArray(raw.catalogEntries) ? raw.catalogEntries : current.standardsLibrary?.catalogEntries || [];
      const controls =
        raw.controls && typeof raw.controls === 'object' && !Array.isArray(raw.controls)
          ? raw.controls
          : current.standardsLibrary?.controls || {};
      next.standardsLibrary = { catalogEntries, controls };
    }

    const saved = writeSettings(next);
    appendAudit({
      action: 'settings.save',
      actor: req.user.username,
      detail: { keys: Object.keys(body) },
    });
    if (body.standardsLibrary != null || body.sync != null) {
      appendAudit({
        action: 'standards.update',
        actor: req.user.username,
        detail: {
          sourceKeys: Object.keys(body).filter((k) => k === 'standardsLibrary' || k === 'sync'),
        },
      });
    }
    res.json(normalizeSettingsForClient(saved));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '保存失败', message: String(e && e.message) });
  }
});

app.get('/api/audit-log', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'viewAuditLog')) {
    return res.status(403).json({ error: '无权查看审计日志' });
  }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json({ entries: readAuditTail(limit) });
});

app.post('/api/reports/download-event', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'exportReports')) {
    return res.status(403).json({ error: '无权记录报告下载事件' });
  }
  const format = String(req.body?.format || '').trim().toLowerCase();
  const assessmentId = String(req.body?.assessmentId || '').trim();
  const standardId = String(req.body?.standardId || '').trim();
  if (!['excel', 'word', 'pdf'].includes(format)) {
    return res.status(400).json({ error: 'format 必须为 excel/word/pdf' });
  }
  appendAudit({
    action: 'reports.download',
    actor: req.user.username,
    detail: {
      format,
      assessmentId,
      standardId,
    },
  });
  res.json({ ok: true });
});

app.get('/api/bugs', requireAuth, (_req, res) => {
  const store = readBugsStore();
  const bugs = [...store.bugs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  res.json({ bugs });
});

app.post('/api/bugs', requireAuth, (req, res) => {
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  if (!title) return res.status(400).json({ error: 'title 不能为空' });
  const now = new Date().toISOString();
  const item = {
    id: `bug_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    title,
    description,
    status: 'submitted',
    reporterId: req.user.id,
    reporterName: req.user.username,
    createdAt: now,
    updatedAt: now,
  };
  const store = readBugsStore();
  store.bugs.unshift(item);
  writeBugsStore(store);
  appendAudit({
    action: 'bugs.submit',
    actor: req.user.username,
    detail: { bugId: item.id, titleLen: item.title.length },
  });
  res.json({ bug: item });
});

app.patch('/api/bugs/:id/status', requireAuth, (req, res) => {
  const id = String(req.params.id || '').trim();
  const status = String(req.body?.status || '').trim();
  const allowed = new Set(['submitted', 'in_progress', 'resolved']);
  if (!allowed.has(status)) {
    return res.status(400).json({ error: 'status 必须是 submitted/in_progress/resolved' });
  }
  const store = readBugsStore();
  const idx = store.bugs.findIndex((x) => String(x?.id || '') === id);
  if (idx < 0) return res.status(404).json({ error: 'bug 不存在' });
  const prev = store.bugs[idx];
  const next = { ...prev, status, updatedAt: new Date().toISOString(), updatedBy: req.user.username };
  store.bugs[idx] = next;
  writeBugsStore(store);
  appendAudit({
    action: 'bugs.status.update',
    actor: req.user.username,
    detail: { bugId: id, from: String(prev?.status || ''), to: status },
  });
  res.json({ bug: next });
});

app.get('/api/analytics/user-activity', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'viewAuditLog')) {
    return res.status(403).json({ error: '无权查看用户活跃度分析' });
  }
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
  const role = String(req.query.role || 'all');
  const companyId = String(req.query.companyId || 'all');
  const projectId = String(req.query.projectId || 'all');
  const payload = buildUserActivityAnalytics({ days, role, companyId, projectId, limit });
  res.json(payload);
});

/** 读取服务端缓存的法律法规 API 响应（供「法律法规自动更新架构」页展示） */
app.get('/api/legal-regulations/cache', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'editStandards')) {
    return res.status(403).json({ error: '无权查看法律法规同步内容' });
  }
  const c = readLegalRegulationsCache();
  if (!c) {
    return res.json({
      empty: true,
      message: '尚未拉取过。请在「配置自动拉取策略」中填写法律法规检索 API 并点击拉取。',
    });
  }
  const history = readLegalRegulationsHistory();
  res.json({ empty: false, ...c, history });
});

app.put('/api/legal-regulations/review', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'editStandards')) {
    return res.status(403).json({ error: '无权复核法律法规内容' });
  }
  const current = readLegalRegulationsCache();
  if (!current || typeof current !== 'object') {
    return res.status(400).json({ error: '暂无可复核缓存，请先执行一次拉取' });
  }
  const headline = String(req.body?.headline || '').trim();
  const summary = String(req.body?.summary || '').trim();
  const takeawaysRaw = Array.isArray(req.body?.takeaways) ? req.body.takeaways : [];
  const takeaways = takeawaysRaw.map((x) => String(x).trim()).filter(Boolean).slice(0, 10);
  const manualItemsRaw = Array.isArray(req.body?.manualItems) ? req.body.manualItems : [];
  const manualItems = manualItemsRaw
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      title: String(x.title || '').trim(),
      docType: String(x.docType || '未知').trim(),
      status: String(x.status || '未知').trim(),
      keyPoints: Array.isArray(x.keyPoints) ? x.keyPoints.map((k) => String(k).trim()).filter(Boolean).slice(0, 12) : [],
      controlImpacts: Array.isArray(x.controlImpacts)
        ? x.controlImpacts.map((k) => String(k).trim()).filter(Boolean).slice(0, 12)
        : [],
      sourceSnippet: String(x.sourceSnippet || '').trim(),
    }))
    .filter((x) => x.title);
  const confidenceNum = Number(req.body?.confidence);
  const publish = req.body?.publish !== false;
  const reset = req.body?.reset === true;
  if (reset) {
    const autoBriefing = buildBriefingFromCache(current);
    const prevCustomer =
      current.customerView && typeof current.customerView === 'object'
        ? { ...current.customerView }
        : {};
    const nextCustomerView = {
      ...prevCustomer,
      reviewed: false,
      reviewedAt: new Date().toISOString(),
      reviewedBy: req.user.username,
      source: autoBriefing ? 'llm.postProcess' : 'agent.ai.answer',
      ...(autoBriefing
        ? { briefing: autoBriefing, content: autoBriefing.summary || prevCustomer.content || '' }
        : {}),
    };
    const payload = {
      ...current,
      updatedAt: new Date().toISOString(),
      customerView: nextCustomerView,
    };
    writeLegalRegulationsCache(payload);
    appendAudit({
      action: 'legal-regulations.review.reset',
      actor: req.user.username,
      detail: { restored: autoBriefing ? 'postProcess' : 'agentAnswer' },
    });
    return res.json({ ok: true, customerView: nextCustomerView });
  }
  if (!headline && !summary && takeaways.length === 0) {
    return res.status(400).json({ error: '请至少填写标题、摘要或要点中的一项' });
  }

  const nextCustomerView =
    current.customerView && typeof current.customerView === 'object'
      ? { ...current.customerView }
      : {};
  nextCustomerView.briefing = {
    headline: headline || '人工复核简报',
    summary,
    takeaways,
  };
  if (manualItems.length > 0) {
    nextCustomerView.manualItems = manualItems;
  }
  nextCustomerView.content = summary || nextCustomerView.content || '';
  nextCustomerView.source = 'manual.review';
  nextCustomerView.reviewed = publish;
  nextCustomerView.reviewedAt = new Date().toISOString();
  nextCustomerView.reviewedBy = req.user.username;
  nextCustomerView.updatedAt = new Date().toISOString();
  if (Number.isFinite(confidenceNum)) {
    nextCustomerView.manualConfidence = Math.min(1, Math.max(0, confidenceNum));
  }

  const payload = {
    ...current,
    updatedAt: new Date().toISOString(),
    customerView: nextCustomerView,
  };
  writeLegalRegulationsCache(payload);
  appendAudit({
    action: 'legal-regulations.review.save',
    actor: req.user.username,
    detail: {
      reviewed: publish,
      headlineLen: headline.length,
      summaryLen: summary.length,
      takeaways: takeaways.length,
    },
  });
  res.json({ ok: true, customerView: nextCustomerView });
});

app.post('/api/legal-regulations/customer-summary', requireAuth, async (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'editStandards')) {
    return res.status(403).json({ error: '无权生成客户汇总' });
  }
  const current = readLegalRegulationsCache();
  if (!current || typeof current !== 'object') {
    return res.status(400).json({ error: '暂无可用数据，请先拉取' });
  }
  const manualItemsRaw = Array.isArray(req.body?.manualItems) ? req.body.manualItems : [];
  const manualItems = manualItemsRaw.filter((x) => x && typeof x === 'object').slice(0, 50);
  if (manualItems.length === 0) {
    return res.status(400).json({ error: '请先添加人工法规条目后再生成汇总' });
  }
  const modelOverride = String(req.body?.model || '').trim();
  const prompt = `你是企业法规简报助手。仅输出 JSON：{"headline":"", "summary":"", "takeaways":[""]}。\n输入法规条目：${JSON.stringify(
    manualItems
  )}\n要求：summary 2-4 句，takeaways 3-6 条。`;
  try {
    const modelRes = await runLegalPostProcessWithModel(settings, prompt, modelOverride);
    const parsed = parseModelJsonSafe(modelRes.rawText) || {};
    const briefing = {
      headline: String(parsed.headline || '').trim(),
      summary: String(parsed.summary || '').trim(),
      takeaways: Array.isArray(parsed.takeaways)
        ? parsed.takeaways.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
        : [],
    };
    if (!briefing.headline && !briefing.summary && briefing.takeaways.length === 0) {
      return res.status(502).json({ ok: false, error: '模型未返回有效汇总内容' });
    }
    res.json({ ok: true, briefing });
  } catch (e) {
    res.status(502).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});

/**
 * POST 上游法律法规检索：body 仅 { query }，与 IMA Agent 的 POST /agent/search 一致。
 * Agent 宿主机可先用 GET /health 自检（返回 service、endpoints 等）。
 */
app.post('/api/legal-regulations/fetch', requireAuth, async (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'editStandards')) {
    return res.status(403).json({ error: '无权执行法律法规拉取' });
  }
  const currentSync = { ...DEFAULT_SETTINGS.sync, ...(settings.sync || {}) };
  const body = req.body || {};
  const query = String(
    body.query || body.keyword || currentSync.legalSearchKeyword || '信息安全相关法律法规'
  ).trim();
  const promptHint = String(body.prompt || '').trim();
  const testOnly = body.testOnly === true;
  const postProcessModel = String(
    body.postProcessModel != null && body.postProcessModel !== ''
      ? body.postProcessModel
      : currentSync.legalPostProcessModel || ''
  ).trim();

  appendAudit({
    action: testOnly ? 'legal-regulations.test.start' : 'legal-regulations.fetch.start',
    actor: req.user.username,
    detail: {
      source: 'cloud-model-direct',
      query,
    },
  });

  try {
    const prompt = `你是企业合规法规研究助手。请基于用户检索主题，输出一段严格 JSON，不要 Markdown，不要额外说明。
JSON 结构：
{
  "success": true,
  "type": "result",
  "query": "string",
  "totalCount": number,
  "results": [{"title":"string","snippet":"string","source":"string"}],
  "ai": {
    "parsedAnswer": {
      "headline": "string",
      "summary": "string",
      "takeaways": ["string"],
      "items": [{
        "title":"string",
        "docType":"法律|行政法规|部门规章|国家标准|行业标准|地方性法规|其他|未知",
        "status":"现行|修订中|废止|未知",
        "keyPoints":["string"],
        "controlImpacts":["string"],
        "sourceSnippet":"string"
      }],
      "confidence": 0.0
    }
  }
}
要求：results 与 items 最多 12 条；summary 2-4 句；takeaways 3-6 条；只输出 JSON。检索主题：${query}${
      promptHint ? `\n补充提示词：${promptHint}` : ''
    }`;
    const modelCfg = { ...DEFAULT_SETTINGS.model, ...(settings.model || {}) };
    const cloudCfg = {
      ...(modelCfg.cloudModel && typeof modelCfg.cloudModel === 'object' ? modelCfg.cloudModel : {}),
      timeoutSec: Math.max(120, Number(modelCfg?.cloudModel?.timeoutSec || modelCfg.timeoutSec || 60)),
    };
    const legalModelSettings = {
      ...settings,
      model: {
        ...modelCfg,
        cloudModel: cloudCfg,
      },
    };
    const out = await runAssistantChatWithModel(legalModelSettings, prompt, 'cloud');
    let parsed = parseModelJsonSafe(out.text);
    if (!parsed || typeof parsed !== 'object') {
      parsed = {
        success: true,
        type: 'result',
        query,
        totalCount: 0,
        results: [],
        ai: {
          parsedAnswer: {
            headline: '法律法规更新简报',
            summary: out.text.slice(0, 1200),
            takeaways: [],
            items: [],
            confidence: 0.5,
          },
        },
      };
    }
    const parsedJson = parsed;
    const previousCache = readLegalRegulationsCache() || {};
    const prevParsed = previousCache.parsedJson && typeof previousCache.parsedJson === 'object' ? previousCache.parsedJson : {};
    const prevResults = normalizeLegalResultList(prevParsed.results || []);
    const nextResults = normalizeLegalResultList(parsedJson.results || []);
    const mergedResults = mergeUniqueByFingerprint(prevResults, nextResults, legalResultFingerprint).slice(0, 300);
    const prevItems = normalizeLegalItemList(prevParsed?.ai?.parsedAnswer?.items || []);
    const nextItems = normalizeLegalItemList(parsedJson?.ai?.parsedAnswer?.items || []);
    const mergedItems = mergeUniqueByFingerprint(prevItems, nextItems, legalItemFingerprint).slice(0, 300);
    const prevResultSet = new Set(prevResults.map(legalResultFingerprint));
    const prevItemSet = new Set(prevItems.map(legalItemFingerprint));
    const addedResultRows = nextResults.filter((x) => !prevResultSet.has(legalResultFingerprint(x)));
    const addedItemRows = nextItems.filter((x) => !prevItemSet.has(legalItemFingerprint(x)));
    const addedResults = addedResultRows.length;
    const addedItems = addedItemRows.length;
    const addedCount = addedResults + addedItems;
    const mergedParsedJson = {
      ...parsedJson,
      totalCount: mergedResults.length,
      results: mergedResults,
      ai: {
        ...(parsedJson.ai && typeof parsedJson.ai === 'object' ? parsedJson.ai : {}),
        parsedAnswer: {
          ...(parsedJson?.ai?.parsedAnswer && typeof parsedJson.ai.parsedAnswer === 'object' ? parsedJson.ai.parsedAnswer : {}),
          items: mergedItems,
        },
      },
      metadata: {
        ...(parsedJson.metadata && typeof parsedJson.metadata === 'object' ? parsedJson.metadata : {}),
        addedThisSync: addedCount,
        addedResults,
        addedItems,
        addedResultTitles: addedResultRows.map((x) => x.title).filter(Boolean).slice(0, 20),
        addedItemTitles: addedItemRows.map((x) => x.title).filter(Boolean).slice(0, 20),
      },
    };
    const rawText = JSON.stringify(mergedParsedJson, null, 2);
    const totalCount = mergedResults.length;
    const extractedAiAnswer = extractAiAnswerFromLegalParsed(mergedParsedJson);
    const prev = previousCache.customerView && typeof previousCache.customerView === 'object' ? { ...previousCache.customerView } : {};
    const briefingFromLlm = normalizeLegalBriefingFromPostProcess(mergedParsedJson?.ai?.parsedAnswer || mergedParsedJson);
    const fpNew = briefingFingerprint(briefingFromLlm);
    const fpPrev = briefingFingerprint(prev.briefing);
    const briefingUpdated = Boolean(briefingFromLlm && fpNew && fpNew !== fpPrev);
    const agentUpdated = extractedAiAnswer.length > 0 && extractedAiAnswer !== String(prev.agentAnswer || '');
    let customerView = { ...prev };
    if (briefingUpdated) {
      customerView.briefing = briefingFromLlm;
      customerView.content = briefingFromLlm.summary || customerView.content || '';
      customerView.source = 'llm.cloud.direct';
      customerView.updatedAt = new Date().toISOString();
    }
    if (agentUpdated) {
      customerView.agentAnswer = extractedAiAnswer;
      if (!customerView.briefing) {
        customerView.content = extractedAiAnswer;
        customerView.source = 'llm.cloud.direct';
        customerView.updatedAt = new Date().toISOString();
      }
    }
    if (!briefingUpdated && !agentUpdated) {
      customerView = Object.keys(prev).length ? prev : undefined;
    }
    const cachePayload = {
      updatedAt: new Date().toISOString(),
      keyword: query,
      query,
      requestUrl: 'cloud-model://assistant',
      requestUrlRaw: 'cloud-model://assistant',
      urlRewritten: false,
      statusCode: 200,
      rawText,
      parsedJson: mergedParsedJson,
      postProcess: {
        enabled: true,
        provider: out.provider,
        model: out.model,
        route: out.route,
        parsedJson: mergedParsedJson?.ai?.parsedAnswer || null,
      },
      customerView,
    };
    if (!testOnly) {
      writeLegalRegulationsCache(cachePayload);
      appendLegalRegulationsHistory({
        ts: cachePayload.updatedAt,
        query,
        statusCode: 200,
        totalCount,
        requestUrl: cachePayload.requestUrl,
        responseType: 'cloud-model',
      });
      const nextSync = {
        ...settings,
        sync: {
          ...currentSync,
          legalLastSyncAt: cachePayload.updatedAt,
        },
      };
      writeSettings(nextSync);
    }
    appendAudit({
      action: testOnly ? 'legal-regulations.test.done' : 'legal-regulations.fetch.done',
      actor: req.user.username,
      detail: { query, totalCount, source: 'cloud-model-direct', model: out.model, provider: out.provider },
    });
    return res.json({
      ok: true,
      message: testOnly ? '云端模型连接测试成功（不写缓存）' : '已通过云端模型更新法律法规库',
      statusCode: 200,
      requestUrl: 'cloud-model://assistant',
      preview: rawText.slice(0, 500),
      totalCount,
      addedCount,
      addedResults,
      addedItems,
      postProcess: cachePayload.postProcess,
    });
  } catch (e) {
    appendLegalRegulationsHistory({
      ts: new Date().toISOString(),
      query,
      statusCode: 502,
      requestUrl: 'cloud-model://assistant',
      responseType: 'cloud-model',
      responseMessage: e && e.message ? e.message : String(e),
    });
    return res.status(502).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }

  if (false) {
  const urlRawUser = String(
    body.url || currentSync.legalRegulationsApiUrl || process.env.LEGAL_IMA_SEARCH_URL || ''
  ).trim();
  const urlRaw = normalizeLegalSearchUpstreamUrl(urlRawUser);
  const query = String(
    body.query || body.keyword || currentSync.legalSearchKeyword || '信息安全相关法律法规'
  ).trim();
  const testOnly = body.testOnly === true;
  const searchApiKey = String(
    body.searchApiKey != null && body.searchApiKey !== ''
      ? body.searchApiKey
      : currentSync.legalSearchApiKey || ''
  ).trim();
  const searchClientId = String(
    body.searchClientId != null && body.searchClientId !== ''
      ? body.searchClientId
      : currentSync.legalSearchClientId || ''
  ).trim();
  const postProcessEnabled =
    body.postProcessEnabled != null
      ? !!body.postProcessEnabled
      : !!currentSync.legalPostProcessEnabled;
  const postProcessModel = String(
    body.postProcessModel != null && body.postProcessModel !== ''
      ? body.postProcessModel
      : currentSync.legalPostProcessModel || ''
  ).trim();

  if (!urlRawUser) {
    return res.status(400).json({
      error:
        '请填写法律法规检索 API 完整 URL，或设置环境变量 LEGAL_IMA_SEARCH_URL（例：http://host.docker.internal:3001/agent/search）',
    });
  }

  const urlStr = resolveLegalSearchUpstreamUrl(urlRaw);
  const urlRewritten = urlStr !== urlRaw || urlRaw !== urlRawUser;
  const upstreamPayload = { query };
  const upstreamHeaders = {};
  if (searchApiKey) upstreamHeaders['X-API-Key'] = searchApiKey;
  if (searchClientId) upstreamHeaders['X-Client-Id'] = searchClientId;

  appendAudit({
    action: testOnly ? 'legal-regulations.test.start' : 'legal-regulations.fetch.start',
    actor: req.user.username,
    detail: {
      host: (() => {
        try {
          return new URL(urlStr).host;
        } catch {
          return '';
        }
      })(),
      query,
      hasApiKeyHeader: !!searchApiKey,
      hasClientIdHeader: !!searchClientId,
      requestUrlRaw: urlRawUser,
      requestUrlNormalized: urlRaw !== urlRawUser ? urlRaw : undefined,
      requestUrlResolved: urlStr,
      urlRewritten,
    },
  });

  const MAX = 2_000_000;
  try {
    let requestUsed = urlStr;
    let result = await httpPostJsonToUrl(requestUsed, upstreamPayload, upstreamHeaders);
    const alt404 =
      result.statusCode === 404 ? alternateAgentSearchPathOn404(requestUsed) : null;
    if (alt404) {
      requestUsed = alt404;
      result = await httpPostJsonToUrl(requestUsed, upstreamPayload, upstreamHeaders);
    }
    let rawText = result.rawText || '';
    if (rawText.length > MAX) {
      rawText = rawText.slice(0, MAX) + '\n...[truncated]';
    }
    let parsedJson = null;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      /* 非 JSON 则仅保留 rawText */
    }
    const totalCount =
      parsedJson && typeof parsedJson === 'object' && Number.isFinite(Number(parsedJson.totalCount))
        ? Number(parsedJson.totalCount)
        : parsedJson &&
            typeof parsedJson === 'object' &&
            parsedJson.response &&
            parsedJson.response.web &&
            Number.isFinite(Number(parsedJson.response.web.resultCount))
          ? Number(parsedJson.response.web.resultCount)
          : Array.isArray(parsedJson && parsedJson.results)
            ? parsedJson.results.length
            : parsedJson &&
                typeof parsedJson === 'object' &&
                parsedJson.response &&
                parsedJson.response.web &&
                Array.isArray(parsedJson.response.web.results)
              ? parsedJson.response.web.results.length
              : undefined;
    const knowledgeBaseCount =
      parsedJson && typeof parsedJson === 'object' && Number.isFinite(Number(parsedJson.knowledgeBaseCount))
        ? Number(parsedJson.knowledgeBaseCount)
        : undefined;
    const upstreamOk = result.statusCode >= 200 && result.statusCode < 300;
    let postProcess = undefined;
    if (upstreamOk && postProcessEnabled && parsedJson && typeof parsedJson === 'object') {
      const started = Date.now();
      try {
        const prompt = buildLegalPostProcessPrompt(query, parsedJson);
        const modelRes = await runLegalPostProcessWithModel(settings, prompt, postProcessModel);
        let parsed = null;
        try {
          parsed = JSON.parse(modelRes.rawText);
        } catch {
          parsed = null;
        }
        postProcess = {
          enabled: true,
          model: modelRes.model,
          provider: modelRes.provider,
          elapsedMs: Date.now() - started,
          parsedJson: parsed,
          rawText: modelRes.rawText.slice(0, 20000),
        };
      } catch (e) {
        postProcess = {
          enabled: true,
          model: postProcessModel || settings.model?.model || '',
          provider: settings.model?.provider || '',
          elapsedMs: Date.now() - started,
          error: e && e.message ? e.message : String(e),
        };
      }
    }
    const previousCache = readLegalRegulationsCache() || {};
    const extractedAiAnswer = extractAiAnswerFromLegalParsed(parsedJson);
    const prev =
      previousCache.customerView && typeof previousCache.customerView === 'object'
        ? { ...previousCache.customerView }
        : {};

    const briefingFromLlm =
      postProcess && postProcess.parsedJson && typeof postProcess.parsedJson === 'object'
        ? normalizeLegalBriefingFromPostProcess(postProcess.parsedJson)
        : null;
    const fpNew = briefingFingerprint(briefingFromLlm);
    const fpPrev = briefingFingerprint(prev.briefing);
    const briefingUpdated = Boolean(briefingFromLlm && fpNew && fpNew !== fpPrev);

    const agentUpdated =
      extractedAiAnswer.length > 0 && extractedAiAnswer !== String(prev.agentAnswer || '');

    let customerView = { ...prev };

    if (briefingUpdated) {
      customerView.briefing = briefingFromLlm;
      customerView.content = briefingFromLlm.summary || customerView.content || '';
      customerView.source = 'llm.postProcess';
      customerView.updatedAt = new Date().toISOString();
    }

    if (agentUpdated) {
      customerView.agentAnswer = extractedAiAnswer;
      if (!customerView.briefing) {
        customerView.content = extractedAiAnswer;
        customerView.source = 'agent.ai.answer';
        customerView.updatedAt = new Date().toISOString();
      }
    }

    if (!briefingUpdated && !agentUpdated) {
      customerView = Object.keys(prev).length ? prev : undefined;
    }

    const cachePayload = {
      updatedAt: new Date().toISOString(),
      keyword: query,
      query,
      requestUrl: requestUsed,
      requestUrlRaw: urlRawUser,
      urlRewritten: urlRewritten || requestUsed !== urlStr,
      statusCode: result.statusCode,
      rawText,
      parsedJson,
      postProcess,
      customerView,
    };

    if (upstreamOk && !testOnly) {
      writeLegalRegulationsCache(cachePayload);
      appendLegalRegulationsHistory({
        ts: cachePayload.updatedAt,
        query,
        statusCode: result.statusCode,
        totalCount,
        knowledgeBaseCount,
        requestUrl: requestUsed,
        urlRewritten: cachePayload.urlRewritten,
        responseType:
          parsedJson && typeof parsedJson === 'object' && parsedJson.type ? String(parsedJson.type) : undefined,
        responseMessage:
          parsedJson && typeof parsedJson === 'object' && parsedJson.message ? String(parsedJson.message) : undefined,
      });
      const current = readSettings();
      writeSettings({
        ...current,
        sync: {
          ...current.sync,
          legalLastSyncAt: cachePayload.updatedAt,
        },
      });
    }

    appendAudit({
      action: testOnly ? 'legal-regulations.test.done' : 'legal-regulations.fetch.done',
      actor: req.user.username,
      detail: { statusCode: result.statusCode, bytes: rawText.length, requestUrl: requestUsed },
    });

    let upstreamHint;
    if (!upstreamOk) {
      if (result.statusCode === 404) {
        upstreamHint =
          '检索返回 404：请确认 Agent 已启动且 URL 正确（常见为 /agent/search 或 /api/agent/search）。若在 Docker 内访问宿主机，请确认已配置 host.docker.internal。';
      } else {
        upstreamHint = `检索服务返回 HTTP ${result.statusCode}`;
      }
    }

    res.json({
      ok: upstreamOk,
      testOnly,
      statusCode: result.statusCode,
      legalLastSyncAt: upstreamOk && !testOnly ? cachePayload.updatedAt : undefined,
      totalCount,
      knowledgeBaseCount,
      postProcess,
      preview: rawText.slice(0, 2000),
      requestUrl: requestUsed,
      requestUrlRaw: urlRawUser,
      urlRewritten: urlRewritten || requestUsed !== urlStr,
      upstreamHint: upstreamHint || undefined,
      upstreamBodySnippet: upstreamOk ? rawText.slice(0, 400) : undefined,
    });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    appendAudit({
      action: testOnly ? 'legal-regulations.test.error' : 'legal-regulations.fetch.error',
      actor: req.user.username,
      detail: { message: msg },
    });
    res.status(502).json({ ok: false, error: '法律法规 API 请求失败', message: msg });
  }
  }
});

app.post('/api/legal-regulations/item/delete', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'editStandards')) {
    return res.status(403).json({ error: '无权删除法规条目' });
  }
  const current = readLegalRegulationsCache();
  if (!current || typeof current !== 'object') {
    return res.status(400).json({ error: '暂无可操作缓存' });
  }
  const title = String(req.body?.title || '').trim();
  const docType = String(req.body?.docType || '').trim();
  const status = String(req.body?.status || '').trim();
  const reason = String(req.body?.reason || '').trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: 'title 不能为空' });
  const normTitle = title.toLowerCase();
  const normDocType = docType.toLowerCase();
  const normStatus = status.toLowerCase();
  const matchItem = (x) => {
    const t = String(x?.title || '').trim().toLowerCase();
    const d = String(x?.docType || '').trim().toLowerCase();
    const s = String(x?.status || '').trim().toLowerCase();
    if (t !== normTitle) return false;
    if (normDocType && d !== normDocType) return false;
    if (normStatus && s !== normStatus) return false;
    return true;
  };
  const parsedJson = current.parsedJson && typeof current.parsedJson === 'object' ? { ...current.parsedJson } : {};
  const prevItems = normalizeLegalItemList(parsedJson?.ai?.parsedAnswer?.items || []);
  const nextItems = prevItems.filter((x) => !matchItem(x));
  const prevResults = normalizeLegalResultList(parsedJson.results || []);
  const nextResults = prevResults.filter((x) => String(x.title || '').trim().toLowerCase() !== normTitle);
  const removedCount = (prevItems.length - nextItems.length) + (prevResults.length - nextResults.length);
  const nextCustomer = current.customerView && typeof current.customerView === 'object' ? { ...current.customerView } : {};
  if (Array.isArray(nextCustomer.manualItems)) {
    nextCustomer.manualItems = nextCustomer.manualItems.filter((x) => !matchItem(x));
  }
  const nextCache = {
    ...current,
    updatedAt: new Date().toISOString(),
    parsedJson: {
      ...parsedJson,
      totalCount: nextResults.length,
      results: nextResults,
      ai: {
        ...(parsedJson.ai && typeof parsedJson.ai === 'object' ? parsedJson.ai : {}),
        parsedAnswer: {
          ...(parsedJson?.ai?.parsedAnswer && typeof parsedJson.ai.parsedAnswer === 'object' ? parsedJson.ai.parsedAnswer : {}),
          items: nextItems,
        },
      },
    },
    customerView: nextCustomer,
  };
  writeLegalRegulationsCache(nextCache);
  appendAudit({
    action: 'legal-regulations.item.delete',
    actor: req.user.username,
    detail: { title, docType: docType || undefined, status: status || undefined, removedCount, reason: reason || undefined },
  });
  res.json({ ok: true, removedCount });
});

app.post('/api/standards/sync', requireAuth, async (req, res) => {
  const settings = readSettings();
  if (!hasPermission(req.user, settings, 'editStandards')) {
    return res.status(403).json({ error: '无权执行标准同步' });
  }

  const currentSync = { ...DEFAULT_SETTINGS.sync, ...(settings.sync || {}) };
  const body = req.body || {};
  const provider = String(body.provider || currentSync.provider || 'native');
  const endpoint = String(body.endpoint || currentSync.endpoint || '');
  const apiKey = String(body.apiKey || currentSync.apiKey || '');
  const codebuddyEndpoint = String(body.codebuddyEndpoint || currentSync.codebuddyEndpoint || '');
  const codebuddyApiKey = String(body.codebuddyApiKey || currentSync.codebuddyApiKey || '');
  const codebuddySkill = String(body.codebuddySkill || currentSync.codebuddySkill || 'codebuddy.sync-standards');

  if (provider !== 'native' && provider !== 'codebuddy') {
    return res.status(400).json({ error: 'provider 仅支持 native / codebuddy' });
  }

  const syncHost = provider === 'codebuddy' ? codebuddyEndpoint : endpoint;
  if (!syncHost) {
    return res.status(400).json({ error: provider === 'codebuddy' ? '缺少 codebuddyEndpoint' : '缺少 endpoint' });
  }
  let target;
  try {
    target = new URL(syncHost);
  } catch {
    return res.status(400).json({ error: '同步地址不是合法 URL' });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return res.status(400).json({ error: '仅支持 http/https' });
  }

  const lib = target.protocol === 'https:' ? https : http;
  const timeoutMs = 30000;
  const payload = JSON.stringify({
    source: 'ai-guardian',
    provider,
    ts: new Date().toISOString(),
    ...(provider === 'codebuddy' ? { skill: codebuddySkill } : {}),
  });
  const opts = {
    method: 'POST',
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + target.search,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      ...((provider === 'codebuddy' ? codebuddyApiKey : apiKey)
        ? {
            Authorization: `Bearer ${provider === 'codebuddy' ? codebuddyApiKey : apiKey}`,
            'X-API-Key': String(provider === 'codebuddy' ? codebuddyApiKey : apiKey),
            ...(provider === 'codebuddy' ? { 'X-CodeBuddy-Skill': codebuddySkill } : {}),
          }
        : {}),
    },
    timeout: timeoutMs,
  };

  appendAudit({
    action: 'standards.sync.start',
    actor: req.user.username,
    detail: { provider, host: target.host, path: target.pathname, skill: provider === 'codebuddy' ? codebuddySkill : undefined },
  });

  try {
    const result = await new Promise((resolve, reject) => {
      const reqUp = lib.request(opts, (resUp) => {
        let data = '';
        resUp.setEncoding('utf8');
        resUp.on('data', (c) => (data += c));
        resUp.on('end', () => {
          resolve({
            statusCode: resUp.statusCode,
            body: data.slice(0, 4000),
          });
        });
      });
      reqUp.on('error', reject);
      reqUp.on('timeout', () => {
        reqUp.destroy();
        reject(new Error('upstream timeout'));
      });
      reqUp.write(payload);
      reqUp.end();
    });

    const now = new Date().toLocaleString('zh-CN', { hour12: false });
    const current = readSettings();
    const saved = writeSettings({
      ...current,
      sync: {
        ...current.sync,
        provider,
        lastSyncAt: `${now} (${provider === 'codebuddy' ? 'CodeBuddy' : 'Native'} HTTP ${result.statusCode})`,
      },
    });

    appendAudit({
      action: 'standards.sync.done',
      actor: req.user.username,
      detail: { provider, skill: provider === 'codebuddy' ? codebuddySkill : undefined, statusCode: result.statusCode, bytes: result.body.length },
    });

    res.json({
      ok: result.statusCode >= 200 && result.statusCode < 300,
      provider,
      statusCode: result.statusCode,
      lastSyncAt: saved.sync.lastSyncAt,
      preview: result.body,
    });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    appendAudit({
      action: 'standards.sync.error',
      actor: req.user.username,
      detail: { provider, skill: provider === 'codebuddy' ? codebuddySkill : undefined, message: msg },
    });
    res.status(502).json({
      ok: false,
      error: '同步请求失败',
      message: msg,
    });
  }
});

if (SERVE_DIST) {
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
}

const server = app.listen(API_PORT, API_HOST, () => {
  const hostLabel = API_HOST === '0.0.0.0' ? 'all interfaces' : API_HOST;
  console.log(`[ai-guardian api] listening on ${hostLabel}:${API_PORT}`);
  if (SERVE_DIST) {
    console.log(`[ai-guardian api] serving static from ${DIST_DIR}`);
  }
  console.log(`[ai-guardian api] JWT auth enabled (set JWT_SECRET in production)`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
