import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Brain,
  RefreshCcw,
  ShieldCheck,
  Save,
  CheckCircle2,
  AlertCircle,
  History,
  Info,
  Loader2,
  Users,
} from 'lucide-react';
import {
  apiHealth,
  fetchAuditLog,
  fetchSettings,
  postLegalRegulationsFetch,
  postModelConnectionTest,
  putSettings,
} from '../services/settingsApi';
import UserManagement from './UserManagement';
import UserActivityDashboard from './UserActivityDashboard';
import { cn } from '../lib/utils';
import { APP_DISPLAY_NAME, APP_UPDATED_DATE, APP_VERSION, RELEASE_NOTES } from '../constants/appMeta';
import {
  DEFAULT_PERMISSION_MATRIX,
  OPENAI_PROVIDER_DEFAULTS,
  PERMISSION_LABELS,
  permissionColumnLabel,
  ROLES,
  isOpenAiCompatProvider,
  type AiModelSettings,
  type ApiSyncSettings,
  type BaseInfoSettings,
  type CompanyProfile,
  type PermissionKey,
  type PermissionMatrix,
  type ProjectProfile,
  type Role,
  type TeamProfile,
  mergePermissionMatrix,
  withOpenAiCompatBaseUrlTemplate,
} from '../permissions';
import { getLocale, setLocale } from '../i18n';

const STORAGE_MODEL_KEY = 'ai_guardian_settings_model_v1';
const STORAGE_SYNC_KEY = 'ai_guardian_settings_sync_v1';
const STORAGE_PERM_KEY = 'ai_guardian_settings_permissions_v1';

const DEFAULT_MODEL_SETTINGS: AiModelSettings = {
  provider: 'Gemini',
  model: 'gemini-2.5-pro',
  geminiApiKey: '',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  openaiBaseUrl: '',
  openaiApiKey: '',
  temperature: 0,
  topP: 0.9,
  maxTokens: 4096,
  timeoutSec: 60,
  fallbackEnabled: true,
  evalConcurrency: 3,
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
};

const DEFAULT_SYNC_SETTINGS: ApiSyncSettings = {
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
};

const DEFAULT_BASE_INFO_SETTINGS: BaseInfoSettings = {
  companies: [],
  projects: [],
  teams: [],
};

const parseFromStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    console.error(`Failed to parse settings for ${key}:`, error);
    return fallback;
  }
};

type SettingsTabId = 'baseInfo' | 'users' | 'ai' | 'audit' | 'usageAudit' | 'about';
type BaseInfoModalState =
  | { kind: 'company'; mode: 'add' | 'edit'; id?: string }
  | { kind: 'project'; mode: 'add' | 'edit'; id?: string }
  | { kind: 'team'; mode: 'add' | 'edit'; id?: string }
  | null;
type AuditCategoryId =
  | 'all'
  | 'modelRuntime'
  | 'auth'
  | 'settings'
  | 'users'
  | 'legal'
  | 'standards'
  | 'other';
type AuditQuickFilter = 'all' | 'errorsOnly';
type AuditTimeWindow = 'all' | '15m' | '1h' | '24h' | '7d' | '30d';

function extractAuditAction(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return '';
  const maybe = (entry as { action?: unknown }).action;
  return typeof maybe === 'string' ? maybe : '';
}

function mapAuditCategory(action: string): AuditCategoryId {
  if (!action) return 'other';
  if (action.startsWith('model.runtime.')) return 'modelRuntime';
  if (action.startsWith('auth.')) return 'auth';
  if (action.startsWith('settings.')) return 'settings';
  if (action.startsWith('users.')) return 'users';
  if (action.startsWith('legal-regulations.')) return 'legal';
  if (action.startsWith('standards.sync.')) return 'standards';
  return 'other';
}

function isAuditEntryAbnormal(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const obj = entry as Record<string, unknown>;
  const action = typeof obj.action === 'string' ? obj.action.toLowerCase() : '';
  if (/(fail|error|open|denied|timeout)/.test(action)) return true;
  const detail = obj.detail && typeof obj.detail === 'object' ? (obj.detail as Record<string, unknown>) : null;
  if (!detail) return false;
  const status = Number(detail.status);
  if (Number.isFinite(status) && status >= 400) return true;
  const reason = String(detail.reason || detail.error || '').toLowerCase();
  return /(fail|error|timeout|refused|unavailable)/.test(reason);
}

function getAuditTs(entry: unknown): number {
  if (!entry || typeof entry !== 'object') return 0;
  const ts = (entry as { ts?: unknown }).ts;
  if (typeof ts !== 'string') return 0;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

function windowToMs(window: AuditTimeWindow): number {
  if (window === '15m') return 15 * 60 * 1000;
  if (window === '1h') return 60 * 60 * 1000;
  if (window === '24h') return 24 * 60 * 60 * 1000;
  if (window === '7d') return 7 * 24 * 60 * 60 * 1000;
  if (window === '30d') return 30 * 24 * 60 * 60 * 1000;
  return 0;
}

const AUDIT_TS_DISPLAY_ZH = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const AUDIT_TS_DISPLAY_EN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatAuditTsChina(entry: unknown, locale: 'zh-CN' | 'en-US' = 'zh-CN'): string {
  const ts = getAuditTs(entry);
  if (!ts) return '—';
  try {
    const fmt = locale === 'en-US' ? AUDIT_TS_DISPLAY_EN : AUDIT_TS_DISPLAY_ZH;
    return fmt.format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString(locale === 'en-US' ? 'en-US' : 'zh-CN');
  }
}

function defaultSettingsTab(p: Record<PermissionKey, boolean>): SettingsTabId {
  if (p.manageUsers) return 'baseInfo';
  if (p.configureAiModel || p.editStandards) return 'ai';
  if (p.viewAuditLog) return 'audit';
  if (p.viewAppAbout) return 'about';
  return 'baseInfo';
}

/** Static UI strings — defined once to avoid reallocating each render. */
const SETTINGS_HEADER_TEXT = {
  'zh-CN': {
    title: '系统核心配置',
    subtitle: '用户与权限、AI 与第三方集成、审计日志、关于与版本等分区管理',
    role: '当前角色',
    loading: '正在加载…',
    backendReady: '后端已连接',
    backendDown: '后端未连接',
    reload: '重新加载',
    saveAll: '保存全部配置',
    noTab: '当前账号无权访问任何配置模块，请联系管理员。',
    usersTab: '用户和权限配置',
    aiTab: 'AI 大模型配置',
    auditTab: '审计日志',
    aboutTab: '关于',
  },
  'en-US': {
    title: 'System Core Settings',
    subtitle: 'Manage users/permissions, AI integration, audit logs, and about/version settings',
    role: 'Current Role',
    loading: 'Loading…',
    backendReady: 'Backend Connected',
    backendDown: 'Backend Disconnected',
    reload: 'Reload',
    saveAll: 'Save All Settings',
    noTab: 'Current account has no permission to access setting modules. Contact administrator.',
    usersTab: 'Users & Permissions',
    aiTab: 'AI Model Settings',
    auditTab: 'Audit Logs',
    aboutTab: 'About',
  },
} as const;

export interface SystemSettingsProps {
  currentUserId: string;
  role: Role;
  effectivePermissions: Record<PermissionKey, boolean>;
  onSessionExpired: () => void;
  onSettingsSaved?: () => void;
  onUsersChanged?: () => void;
}

export default function SystemSettings({
  currentUserId,
  role,
  effectivePermissions,
  onSessionExpired,
  onSettingsSaved,
  onUsersChanged,
}: SystemSettingsProps) {
  const can = (k: PermissionKey) => !!effectivePermissions[k];

  const [modelSettings, setModelSettings] = useState<AiModelSettings>(() =>
    withOpenAiCompatBaseUrlTemplate(parseFromStorage(STORAGE_MODEL_KEY, DEFAULT_MODEL_SETTINGS))
  );
  const [apiSyncSettings, setApiSyncSettings] = useState<ApiSyncSettings>(() =>
    parseFromStorage(STORAGE_SYNC_KEY, DEFAULT_SYNC_SETTINGS)
  );
  const [permissionMatrix, setPermissionMatrix] = useState<PermissionMatrix>(() =>
    mergePermissionMatrix(parseFromStorage(STORAGE_PERM_KEY, DEFAULT_PERMISSION_MATRIX))
  );
  const [baseInfoSettings, setBaseInfoSettings] = useState<BaseInfoSettings>(DEFAULT_BASE_INFO_SETTINGS);
  const [companyDraft, setCompanyDraft] = useState({ name: '', description: '' });
  const [projectDraft, setProjectDraft] = useState({ companyId: '', name: '', description: '' });
  const [teamDraft, setTeamDraft] = useState({ companyId: '', name: '', description: '', projectIds: [] as string[] });
  const [baseInfoModal, setBaseInfoModal] = useState<BaseInfoModalState>(null);
  const [baseInfoSearch, setBaseInfoSearch] = useState('');
  const [expandedCompanies, setExpandedCompanies] = useState<Record<string, boolean>>({});
  const [legalFetchLoading, setLegalFetchLoading] = useState(false);
  const [legalTestLoading, setLegalTestLoading] = useState(false);
  const [legalTestResult, setLegalTestResult] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const [backendReady, setBackendReady] = useState(false);
  const [backendLoading, setBackendLoading] = useState(true);

  const [auditEntries, setAuditEntries] = useState<unknown[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditQuickFilter, setAuditQuickFilter] = useState<AuditQuickFilter>('all');
  const [auditTimeWindow, setAuditTimeWindow] = useState<AuditTimeWindow>('all');
  const [selectedAuditCategories, setSelectedAuditCategories] = useState<AuditCategoryId[]>([
    'modelRuntime',
    'auth',
    'settings',
    'users',
    'legal',
    'standards',
  ]);
  const [modelTestLoading, setModelTestLoading] = useState(false);
  const [modelTestResult, setModelTestResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>(() => defaultSettingsTab(effectivePermissions));
  const [uiLocale, setUiLocale] = useState<'zh-CN' | 'en-US'>(() => getLocale());
  const buildTrackedSettingsSignature = useCallback(
    (payload: {
      model: AiModelSettings;
      sync: ApiSyncSettings;
      permissions: PermissionMatrix;
      baseInfo: BaseInfoSettings;
    }) => {
      const tracked: Record<string, unknown> = {};
      if (effectivePermissions.configureAiModel) tracked.model = payload.model;
      if (effectivePermissions.editStandards) tracked.sync = payload.sync;
      if (effectivePermissions.manageUsers) {
        tracked.permissions = payload.permissions;
        tracked.baseInfo = payload.baseInfo;
      }
      return JSON.stringify(tracked);
    },
    [effectivePermissions]
  );
  const currentTrackedSignature = useMemo(
    () =>
      buildTrackedSettingsSignature({
        model: modelSettings,
        sync: apiSyncSettings,
        permissions: permissionMatrix,
        baseInfo: baseInfoSettings,
      }),
    [buildTrackedSettingsSignature, modelSettings, apiSyncSettings, permissionMatrix, baseInfoSettings]
  );
  const [savedTrackedSignature, setSavedTrackedSignature] = useState<string>('');
  const t = (k: keyof (typeof SETTINGS_HEADER_TEXT)['zh-CN']) =>
    SETTINGS_HEADER_TEXT[uiLocale][k] || SETTINGS_HEADER_TEXT['zh-CN'][k];
  const tx = useCallback((zh: string, en: string) => (uiLocale === 'en-US' ? en : zh), [uiLocale]);

  const auditCategoryOptions = useMemo<Array<{ id: AuditCategoryId; label: string; hint: string }>>(
    () => [
      { id: 'all', label: tx('全部类型', 'All types'), hint: tx('不过滤', 'No filter') },
      {
        id: 'modelRuntime',
        label: tx('模型运行', 'Model runtime'),
        hint: tx('model.runtime.* 熔断/恢复/探活', 'model.runtime.* circuit breaker / recovery / probe'),
      },
      { id: 'auth', label: tx('用户登录', 'Authentication'), hint: tx('auth.* 登录与鉴权行为', 'auth.* sign-in and auth') },
      { id: 'settings', label: tx('配置变更', 'Settings'), hint: tx('settings.* 配置保存', 'settings.* configuration saves') },
      { id: 'users', label: tx('用户管理', 'Users'), hint: tx('users.* 新增/编辑/删除账号', 'users.* account changes') },
      { id: 'legal', label: tx('法律法规', 'Legal regulations'), hint: tx('legal-regulations.* 复核与发布', 'legal-regulations.* review & publish') },
      { id: 'standards', label: tx('标准同步', 'Standards sync'), hint: tx('standards.sync.* 同步任务', 'standards.sync.* sync jobs') },
      { id: 'other', label: tx('其他', 'Other'), hint: tx('未分类日志', 'Uncategorized logs') },
    ],
    [tx]
  );

  const roleLabels = useMemo<Record<Role, string>>(
    () => ({
      SuperAdmin: tx('超级管理员', 'Super Admin'),
      SecurityAdmin: tx('安全管理员', 'Security Admin'),
      Auditor: tx('审计员', 'Auditor'),
      DepartmentManager: tx('部门负责人', 'Department Manager'),
      Viewer: tx('只读访客', 'Read-only visitor'),
    }),
    [tx]
  );

  useEffect(() => {
    const onLocale = (e: Event) => {
      const d = (e as CustomEvent<'zh-CN' | 'en-US'>).detail;
      if (d === 'en-US' || d === 'zh-CN') setUiLocale(d);
    };
    window.addEventListener('app-locale-change', onLocale as EventListener);
    return () => window.removeEventListener('app-locale-change', onLocale as EventListener);
  }, []);

  useEffect(() => {
    if (!savedTrackedSignature) setSavedTrackedSignature(currentTrackedSignature);
  }, [savedTrackedSignature, currentTrackedSignature]);

  const persistLocal = useCallback(() => {
    localStorage.setItem(STORAGE_MODEL_KEY, JSON.stringify(modelSettings));
    localStorage.setItem(STORAGE_SYNC_KEY, JSON.stringify(apiSyncSettings));
    localStorage.setItem(STORAGE_PERM_KEY, JSON.stringify(permissionMatrix));
  }, [modelSettings, apiSyncSettings, permissionMatrix]);

  const loadFromServer = useCallback(async (signal?: AbortSignal) => {
    setBackendLoading(true);
    setErrorNotice(null);
    try {
      await apiHealth({ signal });
      if (signal?.aborted) return;
      setBackendReady(true);
      const s = (await fetchSettings({ signal })) as Record<string, unknown>;
      if (signal?.aborted) return;
      const mergedModel = withOpenAiCompatBaseUrlTemplate({
        ...DEFAULT_MODEL_SETTINGS,
        ...(s.model as Partial<AiModelSettings> | undefined),
      });
      mergedModel.localModel = { ...DEFAULT_MODEL_SETTINGS.localModel, ...(mergedModel.localModel || {}) };
      mergedModel.cloudModel = {
        ...DEFAULT_MODEL_SETTINGS.cloudModel,
        ...(mergedModel.cloudModel || {}),
      };
      const mergedSync = { ...DEFAULT_SYNC_SETTINGS, ...(s.sync as Partial<ApiSyncSettings> | undefined) };
      const mergedPerm = mergePermissionMatrix(s.permissions);
      const mergedBaseInfo = { ...DEFAULT_BASE_INFO_SETTINGS, ...(s.baseInfo as Partial<BaseInfoSettings> | undefined) };
      if (signal?.aborted) return;
      const nextLocale = s.locale === 'en-US' ? 'en-US' : 'zh-CN';
      setUiLocale(nextLocale);
      if (getLocale() !== nextLocale) {
        setLocale(nextLocale);
      }
      setModelSettings(mergedModel);
      setApiSyncSettings(mergedSync);
      setPermissionMatrix(mergedPerm);
      setBaseInfoSettings(mergedBaseInfo);
      setSavedTrackedSignature(
        buildTrackedSettingsSignature({
          model: mergedModel,
          sync: mergedSync,
          permissions: mergedPerm,
          baseInfo: mergedBaseInfo,
        })
      );
      localStorage.setItem(STORAGE_MODEL_KEY, JSON.stringify(mergedModel));
      localStorage.setItem(STORAGE_SYNC_KEY, JSON.stringify(mergedSync));
      localStorage.setItem(STORAGE_PERM_KEY, JSON.stringify(mergedPerm));
      setNotice(tx('已从服务器加载配置', 'Settings loaded from server'));
      setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) return;
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        onSessionExpired();
        return;
      }
      setBackendReady(false);
      setErrorNotice(
        e instanceof Error
          ? e.message
          : tx('无法连接后端 API（请运行 npm run dev:api 或使用 npm run dev:all）', 'Cannot reach backend API (run npm run dev:api or npm run dev:all)')
      );
    } finally {
      setBackendLoading(false);
    }
  }, [onSessionExpired, buildTrackedSettingsSignature, tx]);

  useEffect(() => {
    const ac = new AbortController();
    void loadFromServer(ac.signal);
    return () => ac.abort();
  }, [loadFromServer]);

  const refreshAudit = useCallback(async () => {
    if (!backendReady || !effectivePermissions.viewAuditLog) return;
    setAuditLoading(true);
    setErrorNotice(null);
    try {
      const { entries } = await fetchAuditLog(40);
      setAuditEntries(entries);
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        onSessionExpired();
        return;
      }
      setErrorNotice(e instanceof Error ? e.message : tx('加载审计日志失败', 'Failed to load audit log'));
    } finally {
      setAuditLoading(false);
    }
  }, [backendReady, effectivePermissions.viewAuditLog, onSessionExpired, tx]);

  useEffect(() => {
    if (activeTab === 'audit' && backendReady && effectivePermissions.viewAuditLog) {
      void refreshAudit();
    }
  }, [activeTab, backendReady, effectivePermissions.viewAuditLog, refreshAudit]);

  const saveAllSettings = async () => {
    setErrorNotice(null);
    persistLocal();
    if (!backendReady) {
      setNotice(tx('已保存到浏览器本地（后端未连接）', 'Saved locally (backend disconnected)'));
      setSavedTrackedSignature(currentTrackedSignature);
      setTimeout(() => setNotice(null), 2500);
      return;
    }
    const body: Record<string, unknown> = {};
    if (can('configureAiModel')) {
      body.model = {
        ...modelSettings,
        provider: modelSettings.primaryModel === 'cloud' ? modelSettings.cloudModel?.provider || 'Gemini' : 'Ollama',
        model:
          modelSettings.primaryModel === 'cloud'
            ? modelSettings.cloudModel?.model || modelSettings.model
            : modelSettings.localModel?.model || modelSettings.model,
        ollamaBaseUrl: modelSettings.localModel?.ollamaBaseUrl || modelSettings.ollamaBaseUrl,
        geminiApiKey: modelSettings.cloudModel?.geminiApiKey || modelSettings.geminiApiKey,
        openaiBaseUrl: modelSettings.cloudModel?.openaiBaseUrl || modelSettings.openaiBaseUrl,
        openaiApiKey: modelSettings.cloudModel?.openaiApiKey || modelSettings.openaiApiKey,
      };
    }
    if (can('editStandards')) body.sync = apiSyncSettings;
    if (can('manageUsers')) {
      body.permissions = permissionMatrix;
      body.baseInfo = baseInfoSettings;
    }
    if (Object.keys(body).length === 0) {
      setErrorNotice(tx('当前角色没有可保存的配置项', 'Nothing to save for this role'));
      return;
    }
    try {
      const saved = await putSettings(body);
      const s = saved as Record<string, unknown>;
      if (s.model) {
        setModelSettings((prev) => {
          const next = { ...prev, ...(s.model as Partial<AiModelSettings>) };
          next.localModel = { ...DEFAULT_MODEL_SETTINGS.localModel, ...(next.localModel || {}) };
          next.cloudModel = withOpenAiCompatBaseUrlTemplate({
            ...DEFAULT_MODEL_SETTINGS.cloudModel,
            ...(next.cloudModel || {}),
          });
          return next;
        });
      }
      if (s.sync) setApiSyncSettings((prev) => ({ ...prev, ...(s.sync as Partial<ApiSyncSettings>) }));
      if (s.permissions != null) setPermissionMatrix(mergePermissionMatrix(s.permissions));
      if (s.baseInfo) setBaseInfoSettings({ ...DEFAULT_BASE_INFO_SETTINGS, ...(s.baseInfo as Partial<BaseInfoSettings>) });
      const nextModel = (() => {
        if (!s.model) return modelSettings;
        const next = { ...modelSettings, ...(s.model as Partial<AiModelSettings>) };
        next.localModel = { ...DEFAULT_MODEL_SETTINGS.localModel, ...(next.localModel || {}) };
        next.cloudModel = withOpenAiCompatBaseUrlTemplate({
          ...DEFAULT_MODEL_SETTINGS.cloudModel,
          ...(next.cloudModel || {}),
        });
        return next;
      })();
      const nextSync = s.sync ? { ...apiSyncSettings, ...(s.sync as Partial<ApiSyncSettings>) } : apiSyncSettings;
      const nextPerm = s.permissions != null ? mergePermissionMatrix(s.permissions) : permissionMatrix;
      const nextBaseInfo = s.baseInfo
        ? { ...DEFAULT_BASE_INFO_SETTINGS, ...(s.baseInfo as Partial<BaseInfoSettings>) }
        : baseInfoSettings;
      setSavedTrackedSignature(
        buildTrackedSettingsSignature({
          model: nextModel,
          sync: nextSync,
          permissions: nextPerm,
          baseInfo: nextBaseInfo,
        })
      );
      persistLocal();
      setNotice(tx('配置已保存到服务器', 'Settings saved to server'));
      setTimeout(() => setNotice(null), 2000);
      onSettingsSaved?.();
      await refreshAudit();
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        onSessionExpired();
        return;
      }
      setErrorNotice(e instanceof Error ? e.message : tx('保存失败', 'Save failed'));
    }
  };

  const runLegalFetchNow = async () => {
    if (!backendReady) {
      setErrorNotice(tx('后端未连接，无法执行法律法规拉取', 'Backend disconnected; cannot fetch legal regulations'));
      return;
    }
    setLegalFetchLoading(true);
    setErrorNotice(null);
    setLegalTestResult(null);
    try {
      const r = await postLegalRegulationsFetch({
        url: apiSyncSettings.legalRegulationsApiUrl,
        keyword: apiSyncSettings.legalSearchKeyword,
        searchApiKey: apiSyncSettings.legalSearchApiKey,
        searchClientId: apiSyncSettings.legalSearchClientId,
        postProcessEnabled: apiSyncSettings.legalPostProcessEnabled,
        postProcessModel: apiSyncSettings.legalPostProcessModel,
      });
      setApiSyncSettings((prev) => ({
        ...prev,
        legalLastSyncAt: r.legalLastSyncAt || prev.legalLastSyncAt,
      }));
      setNotice(
        tx('法律法规拉取完成', 'Legal regulations fetch completed') + ` (HTTP ${r.statusCode ?? '—'})`
      );
      setTimeout(() => setNotice(null), 3000);
    } catch (e) {
      setErrorNotice(e instanceof Error ? e.message : tx('法律法规拉取失败', 'Legal regulations fetch failed'));
    } finally {
      setLegalFetchLoading(false);
    }
  };

  const testLegalConnection = async () => {
    if (!backendReady) {
      setErrorNotice(tx('后端未连接，无法测试法律法规接口', 'Backend disconnected; cannot test legal API'));
      return;
    }
    setLegalTestLoading(true);
    setErrorNotice(null);
    setLegalTestResult(null);
    try {
      const r = await postLegalRegulationsFetch({
        url: apiSyncSettings.legalRegulationsApiUrl,
        keyword: apiSyncSettings.legalSearchKeyword,
        searchApiKey: apiSyncSettings.legalSearchApiKey,
        searchClientId: apiSyncSettings.legalSearchClientId,
        postProcessEnabled: apiSyncSettings.legalPostProcessEnabled,
        postProcessModel: apiSyncSettings.legalPostProcessModel,
        testOnly: true,
      });
      const msg = tx('测试连接成功', 'Connection OK') + ` (HTTP ${r.statusCode ?? '—'})`;
      setLegalTestResult(msg);
      setNotice(`${tx('法律法规接口', 'Legal API')}: ${msg}`);
      setTimeout(() => setNotice(null), 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : tx('法律法规接口测试失败', 'Legal API test failed');
      setErrorNotice(msg);
      setLegalTestResult(tx('测试连接失败', 'Connection failed') + `: ${msg}`);
    } finally {
      setLegalTestLoading(false);
    }
  };

  const togglePermission = (r: Role, permission: PermissionKey) => {
    setPermissionMatrix((prev) => ({
      ...prev,
      [r]: {
        ...prev[r],
        [permission]: !prev[r][permission],
      },
    }));
  };

  const updateCompany = (id: string, patch: Partial<CompanyProfile>) => {
    setBaseInfoSettings((prev) => ({
      ...prev,
      companies: prev.companies.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };
  const updateProject = (id: string, patch: Partial<ProjectProfile>) => {
    setBaseInfoSettings((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  };
  const updateTeam = (id: string, patch: Partial<TeamProfile>) => {
    setBaseInfoSettings((prev) => ({
      ...prev,
      teams: prev.teams.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };
  const addCompanyFromDraft = () => {
    if (!companyDraft.name.trim()) return;
    setBaseInfoSettings((prev) => ({
      ...prev,
      companies: [...prev.companies, { id: `c_${Date.now()}`, name: companyDraft.name.trim(), description: companyDraft.description.trim() }],
    }));
    setCompanyDraft({ name: '', description: '' });
  };
  const addProjectFromDraft = () => {
    if (!projectDraft.companyId || !projectDraft.name.trim()) return;
    setBaseInfoSettings((prev) => ({
      ...prev,
      projects: [
        ...prev.projects,
        { id: `p_${Date.now()}`, companyId: projectDraft.companyId, name: projectDraft.name.trim(), description: projectDraft.description.trim() },
      ],
    }));
    setProjectDraft({ companyId: projectDraft.companyId, name: '', description: '' });
  };
  const addTeamFromDraft = () => {
    if (!teamDraft.companyId || !teamDraft.name.trim()) return;
    setBaseInfoSettings((prev) => ({
      ...prev,
      teams: [
        ...prev.teams,
        {
          id: `t_${Date.now()}`,
          companyId: teamDraft.companyId,
          name: teamDraft.name.trim(),
          description: teamDraft.description.trim(),
          projectIds: teamDraft.projectIds,
        },
      ],
    }));
    setTeamDraft({ companyId: teamDraft.companyId, name: '', description: '', projectIds: [] });
  };

  const openBaseInfoModal = (kind: 'company' | 'project' | 'team', mode: 'add' | 'edit', id?: string) => {
    if (kind === 'company') {
      if (mode === 'edit' && id) {
        const c = baseInfoSettings.companies.find((x) => x.id === id);
        if (c) setCompanyDraft({ name: c.name || '', description: c.description || '' });
      } else {
        setCompanyDraft({ name: '', description: '' });
      }
    }
    if (kind === 'project') {
      if (mode === 'edit' && id) {
        const p = baseInfoSettings.projects.find((x) => x.id === id);
        if (p) setProjectDraft({ companyId: p.companyId || '', name: p.name || '', description: p.description || '' });
      } else {
        setProjectDraft({ companyId: baseInfoSettings.companies[0]?.id || '', name: '', description: '' });
      }
    }
    if (kind === 'team') {
      if (mode === 'edit' && id) {
        const t = baseInfoSettings.teams.find((x) => x.id === id);
        if (t) setTeamDraft({ companyId: t.companyId || '', name: t.name || '', description: t.description || '', projectIds: t.projectIds || [] });
      } else {
        setTeamDraft({ companyId: baseInfoSettings.companies[0]?.id || '', name: '', description: '', projectIds: [] });
      }
    }
    setBaseInfoModal({ kind, mode, id });
  };

  const submitBaseInfoModal = () => {
    if (!baseInfoModal) return;
    if (baseInfoModal.kind === 'company') {
      if (baseInfoModal.mode === 'edit' && baseInfoModal.id) updateCompany(baseInfoModal.id, { name: companyDraft.name.trim(), description: companyDraft.description.trim() });
      else addCompanyFromDraft();
    }
    if (baseInfoModal.kind === 'project') {
      if (baseInfoModal.mode === 'edit' && baseInfoModal.id)
        updateProject(baseInfoModal.id, { companyId: projectDraft.companyId, name: projectDraft.name.trim(), description: projectDraft.description.trim() });
      else addProjectFromDraft();
    }
    if (baseInfoModal.kind === 'team') {
      if (baseInfoModal.mode === 'edit' && baseInfoModal.id)
        updateTeam(baseInfoModal.id, {
          companyId: teamDraft.companyId,
          name: teamDraft.name.trim(),
          description: teamDraft.description.trim(),
          projectIds: teamDraft.projectIds,
        });
      else addTeamFromDraft();
    }
    setBaseInfoModal(null);
  };

  const showSaveAllSettings =
    can('configureAiModel') || can('editStandards') || can('manageUsers');
  const hasUnsavedChanges = showSaveAllSettings && savedTrackedSignature !== currentTrackedSignature;

  const testModelConnection = async (ensureReady = false, target: 'primary' | 'local' | 'cloud' | 'all' = 'primary') => {
    if (!backendReady) {
      setErrorNotice(tx('后端未连接，无法测试模型联通', 'Backend disconnected; cannot test model connectivity'));
      return;
    }
    setModelTestLoading(true);
    setModelTestResult(null);
    setErrorNotice(null);
    try {
      if (target === 'all') {
        const [localRes, cloudRes] = await Promise.all([
          postModelConnectionTest(modelSettings as unknown as Record<string, unknown>, ensureReady, 'local'),
          postModelConnectionTest(modelSettings as unknown as Record<string, unknown>, false, 'cloud'),
        ]);
        const msg = `${tx('本地模型', 'Local')}: ${localRes.detail || tx('通过', 'OK')}; ${tx('云端模型', 'Cloud')}: ${cloudRes.detail || tx('通过', 'OK')}`;
        setModelTestResult(msg);
        setNotice(tx('本地+云端联通测试通过', 'Local and cloud connectivity OK'));
      } else {
        const r = await postModelConnectionTest(
          modelSettings as unknown as Record<string, unknown>,
          ensureReady,
          target
        );
        const msg = `${r.provider || modelSettings.provider} ${tx('连通成功', 'connected OK')} (${r.elapsedMs ?? '—'}ms)${r.detail ? `: ${r.detail}` : ''}`;
        setModelTestResult(msg);
        setNotice(msg);
      }
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : tx('模型联通测试失败', 'Model connectivity test failed');
      setModelTestResult(`${tx('联通失败', 'Connectivity failed')}: ${msg}`);
      setErrorNotice(msg);
    } finally {
      setModelTestLoading(false);
    }
  };

  const showBaseInfoTab = can('manageUsers');
  const showUsersTab = can('manageUsers');
  const showAiTab = can('configureAiModel') || can('editStandards');
  const showAuditTab = can('viewAuditLog');
  const showUsageAuditTab = can('viewAuditLog');
  const showAboutTab = can('viewAppAbout');
  const hasAnySettingsTab =
    showBaseInfoTab || showUsersTab || showAiTab || showAuditTab || showUsageAuditTab || showAboutTab;
  const filteredCompanies = useMemo(() => {
    const { companies, projects, teams } = baseInfoSettings;
    const projectCountByCompany: Record<string, number> = {};
    for (const p of projects) {
      const cid = p.companyId || '';
      if (!cid) continue;
      projectCountByCompany[cid] = (projectCountByCompany[cid] || 0) + 1;
    }
    const teamCountByCompany: Record<string, number> = {};
    for (const t of teams) {
      const cid = t.companyId || '';
      if (!cid) continue;
      teamCountByCompany[cid] = (teamCountByCompany[cid] || 0) + 1;
    }
    const q = baseInfoSearch.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => {
      const pCount = projectCountByCompany[c.id] || 0;
      const tCount = teamCountByCompany[c.id] || 0;
      return (
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.description || '').toLowerCase().includes(q) ||
        String(c.id || '').toLowerCase().includes(q) ||
        String(pCount).includes(q) ||
        String(tCount).includes(q)
      );
    });
  }, [baseInfoSearch, baseInfoSettings]);
  const filteredAuditEntries = useMemo(() => {
    const selected = new Set(selectedAuditCategories);
    const noFilter = selected.size === 0 || selected.has('all');
    const winMs = windowToMs(auditTimeWindow);
    const now = Date.now();
    const out: unknown[] = [];
    for (let i = auditEntries.length - 1; i >= 0; i -= 1) {
      const entry = auditEntries[i];
      if (!noFilter) {
        const category = mapAuditCategory(extractAuditAction(entry));
        if (!selected.has(category)) continue;
      }
      if (auditQuickFilter === 'errorsOnly' && !isAuditEntryAbnormal(entry)) continue;
      if (winMs) {
        const ts = getAuditTs(entry);
        if (!ts || now - ts > winMs) continue;
      }
      out.push(entry);
    }
    return out;
  }, [auditEntries, selectedAuditCategories, auditQuickFilter, auditTimeWindow]);

  useEffect(() => {
    if (activeTab === 'baseInfo' && !showBaseInfoTab) {
      if (showUsersTab) setActiveTab('users');
      else if (showAiTab) setActiveTab('ai');
      else if (showAuditTab) setActiveTab('audit');
      else if (showUsageAuditTab) setActiveTab('usageAudit');
      else if (showAboutTab) setActiveTab('about');
    } else if (activeTab === 'users' && !showUsersTab) {
      if (showBaseInfoTab) setActiveTab('baseInfo');
      else if (showAiTab) setActiveTab('ai');
      else if (showAuditTab) setActiveTab('audit');
      else if (showUsageAuditTab) setActiveTab('usageAudit');
      else if (showAboutTab) setActiveTab('about');
    } else if (activeTab === 'ai' && !showAiTab) {
      if (showBaseInfoTab) setActiveTab('baseInfo');
      else if (showUsersTab) setActiveTab('users');
      else if (showAuditTab) setActiveTab('audit');
      else if (showUsageAuditTab) setActiveTab('usageAudit');
      else if (showAboutTab) setActiveTab('about');
    } else if (activeTab === 'audit' && !showAuditTab) {
      if (showBaseInfoTab) setActiveTab('baseInfo');
      else if (showUsersTab) setActiveTab('users');
      else if (showAiTab) setActiveTab('ai');
      else if (showUsageAuditTab) setActiveTab('usageAudit');
      else if (showAboutTab) setActiveTab('about');
    } else if (activeTab === 'usageAudit' && !showUsageAuditTab) {
      if (showBaseInfoTab) setActiveTab('baseInfo');
      else if (showUsersTab) setActiveTab('users');
      else if (showAiTab) setActiveTab('ai');
      else if (showAuditTab) setActiveTab('audit');
      else if (showAboutTab) setActiveTab('about');
    } else if (activeTab === 'about' && !showAboutTab) {
      if (showBaseInfoTab) setActiveTab('baseInfo');
      else if (showUsersTab) setActiveTab('users');
      else if (showAiTab) setActiveTab('ai');
      else if (showAuditTab) setActiveTab('audit');
      else if (showUsageAuditTab) setActiveTab('usageAudit');
    }
  }, [activeTab, showBaseInfoTab, showUsersTab, showAiTab, showAuditTab, showUsageAuditTab, showAboutTab]);

  const toggleAuditCategory = (id: AuditCategoryId) => {
    setSelectedAuditCategories((prev) => {
      if (id === 'all') return ['all'];
      const base = prev.filter((x) => x !== 'all');
      if (base.includes(id)) {
        const next = base.filter((x) => x !== id);
        return next.length === 0 ? ['all'] : next;
      }
      return [...base, id];
    });
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black mb-2">{t('title')}</h2>
          <p className="text-text-main/60 font-medium">
            {t('subtitle')}
          </p>
          <p className="text-xs font-semibold text-text-main/45 mt-2 flex flex-wrap items-center gap-2">
            <span>
              {t('role')}：<strong>{roleLabels[role]}</strong>（{role}）
            </span>
            {backendLoading && (
              <>
                <Loader2 size={14} className="animate-spin" /> {t('loading')}
              </>
            )}
            {!backendLoading && backendReady && <span className="text-success-main">{t('backendReady')}</span>}
            {!backendLoading && !backendReady && <span className="text-warning-main">{t('backendDown')}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {showSaveAllSettings && (
            <button
              type="button"
              onClick={saveAllSettings}
              className={cn(
                'glass-button flex items-center gap-2 w-fit transition-all',
                hasUnsavedChanges ? 'ring-2 ring-warning-main/60 shadow-lg shadow-warning-main/20' : 'opacity-65'
              )}
            >
              <Save size={18} />
              {hasUnsavedChanges ? tx('保存全部配置（有未保存更改）', 'Save All Settings (Unsaved Changes)') : t('saveAll')}
            </button>
          )}
        </div>
      </div>

      {!hasAnySettingsTab && (
        <div className="glass-card p-8 text-center text-text-main/60 font-medium">{t('noTab')}</div>
      )}

      {notice && (
        <div className="glass-card p-4 bg-white/60 border border-white/70 flex items-center gap-2 text-sm font-semibold text-text-main/80">
          <CheckCircle2 size={16} className="text-success-main" />
          {notice}
        </div>
      )}

      {errorNotice && (
        <div className="glass-card p-4 bg-danger-main/10 border border-danger-main/30 flex items-center gap-2 text-sm font-semibold text-danger-main">
          <AlertCircle size={16} />
          {errorNotice}
        </div>
      )}

      {hasAnySettingsTab && (
        <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-white/30 border border-white/50 w-fit">
          {showBaseInfoTab && (
            <button
              type="button"
              onClick={() => setActiveTab('baseInfo')}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all',
                activeTab === 'baseInfo'
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'text-text-main/70 hover:bg-white/50'
              )}
            >
              <ShieldCheck size={18} />
              {tx('基础信息配置', 'Base Information')}
            </button>
          )}
          {showUsersTab && (
            <button
              type="button"
              onClick={() => setActiveTab('users')}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all',
                activeTab === 'users'
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'text-text-main/70 hover:bg-white/50'
              )}
            >
              <Users size={18} />
              {t('usersTab')}
            </button>
          )}
          {showAiTab && (
            <button
              type="button"
              onClick={() => setActiveTab('ai')}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all',
                activeTab === 'ai'
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'text-text-main/70 hover:bg-white/50'
              )}
            >
              <Brain size={18} />
              {t('aiTab')}
            </button>
          )}
          {showAuditTab && (
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all',
                activeTab === 'audit'
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'text-text-main/70 hover:bg-white/50'
              )}
            >
              <History size={18} />
              {t('auditTab')}
            </button>
          )}
          {showUsageAuditTab && (
            <button
              type="button"
              onClick={() => setActiveTab('usageAudit')}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all',
                activeTab === 'usageAudit'
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'text-text-main/70 hover:bg-white/50'
              )}
            >
              <Activity size={18} />
              {tx('应用使用程度审计', 'Application Usage Audit')}
            </button>
          )}
          {showAboutTab && (
            <button
              type="button"
              onClick={() => setActiveTab('about')}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all',
                activeTab === 'about'
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'text-text-main/70 hover:bg-white/50'
              )}
            >
              <Info size={18} />
              {t('aboutTab')}
            </button>
          )}
        </div>
      )}

      {showSaveAllSettings && (
        <div className="fixed bottom-6 right-6 z-[70]">
          <button
            type="button"
            onClick={saveAllSettings}
            className={cn(
              'glass-button flex items-center gap-2 px-5 py-3 shadow-xl shadow-black/10 transition-all',
              hasUnsavedChanges ? 'ring-2 ring-warning-main/70 shadow-warning-main/30' : 'opacity-60'
            )}
            title={hasUnsavedChanges ? tx('存在未保存更改', 'There are unsaved changes') : t('saveAll')}
          >
            <Save size={18} />
            {hasUnsavedChanges ? tx('未保存更改', 'Unsaved Changes') : t('saveAll')}
          </button>
        </div>
      )}

      {activeTab === 'baseInfo' && showBaseInfoTab && (
        <div className="space-y-8">
          <section className="glass-card p-8 bg-white/40 space-y-6">
            <div className="flex items-center gap-3">
              <ShieldCheck size={20} className="text-accent" />
            <h3 className="text-xl font-black">{tx('基础信息配置', 'Base Information')}</h3>
            </div>
            <p className="text-xs text-text-main/55 font-medium">{tx('进行基础信息的配置，包括公司名称，项目名称和团队名称。', 'Configure base information, including company, project, and team names.')}</p>

            <div className="flex flex-wrap gap-3">
              <button type="button" className="glass-button px-4 py-2 text-xs font-black uppercase tracking-widest" onClick={() => openBaseInfoModal('company', 'add')}>
                {tx('新增公司', 'Add Company')}
              </button>
              <button type="button" className="glass-button px-4 py-2 text-xs font-black uppercase tracking-widest" onClick={() => openBaseInfoModal('project', 'add')}>
                {tx('新增项目', 'Add Project')}
              </button>
              <button type="button" className="glass-button px-4 py-2 text-xs font-black uppercase tracking-widest" onClick={() => openBaseInfoModal('team', 'add')}>
                {tx('新增团队', 'Add Team')}
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-black uppercase tracking-widest text-text-main/50">{tx('完整公司清单', 'Full Company List')}</p>
                <input
                  className="glass-input px-3 py-2 text-xs font-semibold min-w-[220px]"
                  placeholder={tx('搜索公司名称/说明', 'Search company name/description')}
                  value={baseInfoSearch}
                  onChange={(e) => setBaseInfoSearch(e.target.value)}
                />
              </div>
              {filteredCompanies.map((c) => {
                const companyProjects = baseInfoSettings.projects.filter((p) => p.companyId === c.id);
                const companyTeams = baseInfoSettings.teams.filter((t) => t.companyId === c.id);
                const expanded = expandedCompanies[c.id] === true;
                return (
                  <div key={c.id} className="rounded-xl border border-black/10 bg-white/60 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold">{c.name || c.id}</p>
                        <p className="text-xs text-text-main/55">
                          {c.description || '—'} · {tx('项目', 'Projects')} {companyProjects.length} · {tx('团队', 'Teams')} {companyTeams.length}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="glass-card px-3 py-1.5 text-xs font-black uppercase tracking-widest"
                          onClick={() => setExpandedCompanies((prev) => ({ ...prev, [c.id]: !expanded }))}
                        >
                          {expanded ? tx('折叠', 'Collapse') : tx('展开', 'Expand')}
                        </button>
                        <button type="button" className="glass-card px-3 py-1.5 text-xs font-black uppercase tracking-widest" onClick={() => openBaseInfoModal('company', 'edit', c.id)}>
                          {tx('编辑', 'Edit')}
                        </button>
                        <button
                          type="button"
                          className="text-xs font-bold text-danger-main"
                          onClick={() =>
                            setBaseInfoSettings((prev) => ({
                              ...prev,
                              companies: prev.companies.filter((x) => x.id !== c.id),
                              projects: prev.projects.filter((x) => x.companyId !== c.id),
                              teams: prev.teams.filter((x) => x.companyId !== c.id),
                            }))
                          }
                        >
                          {tx('删除公司', 'Delete Company')}
                        </button>
                      </div>
                    </div>
                    {expanded && (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-black/10 p-3 bg-white/70 space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-widest text-text-main/45">{tx('项目列表', 'Projects')}</p>
                        {companyProjects.length === 0 ? <p className="text-xs text-text-main/45">{tx('暂无项目', 'No projects')}</p> : null}
                        {companyProjects.map((p) => (
                          <div key={p.id} className="grid grid-cols-[1fr_auto] gap-2 items-center">
                            <div>
                              <p className="text-xs font-semibold">{p.name || p.id}</p>
                              <p className="text-[11px] text-text-main/55">{p.description || '—'}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="glass-card px-3 py-1.5 text-xs font-black uppercase tracking-widest"
                                onClick={() => openBaseInfoModal('project', 'edit', p.id)}
                              >
                                {tx('编辑', 'Edit')}
                              </button>
                              <button
                                type="button"
                                className="text-xs font-bold text-danger-main"
                                onClick={() =>
                                  setBaseInfoSettings((prev) => ({
                                    ...prev,
                                    projects: prev.projects.filter((x) => x.id !== p.id),
                                    teams: prev.teams.map((t) => ({ ...t, projectIds: t.projectIds.filter((pid) => pid !== p.id) })),
                                  }))
                                }
                              >
                                {tx('删除', 'Delete')}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-lg border border-black/10 p-3 bg-white/70 space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-widest text-text-main/45">{tx('团队列表', 'Teams')}</p>
                        {companyTeams.length === 0 ? <p className="text-xs text-text-main/45">{tx('暂无团队', 'No teams')}</p> : null}
                        {companyTeams.map((t) => (
                          <div key={t.id} className="rounded-lg border border-black/10 p-2 space-y-2">
                            <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                              <div>
                                <p className="text-xs font-semibold">{t.name || t.id}</p>
                                <p className="text-[11px] text-text-main/55">{t.description || '—'}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="glass-card px-3 py-1.5 text-xs font-black uppercase tracking-widest"
                                  onClick={() => openBaseInfoModal('team', 'edit', t.id)}
                                >
                                  {tx('编辑', 'Edit')}
                                </button>
                                <button
                                  type="button"
                                  className="text-xs font-bold text-danger-main"
                                  onClick={() =>
                                    setBaseInfoSettings((prev) => ({
                                      ...prev,
                                      teams: prev.teams.filter((x) => x.id !== t.id),
                                    }))
                                  }
                                >
                                  {tx('删除', 'Delete')}
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-1">
                              {companyProjects.map((p) => (
                                <label key={p.id} className="text-xs font-medium flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={t.projectIds.includes(p.id)}
                                    onChange={(e) =>
                                      updateTeam(t.id, {
                                        projectIds: e.target.checked
                                          ? [...t.projectIds, p.id]
                                          : t.projectIds.filter((pid) => pid !== p.id),
                                      })
                                    }
                                  />
                                  {p.name || p.id}
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    )}
                  </div>
                );
              })}
              {baseInfoSettings.companies.length === 0 ? (
                <p className="text-xs text-text-main/45">{tx('暂无公司，请先在上方新增公司。', 'No companies yet. Add one above.')}</p>
              ) : null}
              {baseInfoSettings.companies.length > 0 && filteredCompanies.length === 0 ? (
                <p className="text-xs text-text-main/45">{tx('未找到匹配公司', 'No matched companies')}</p>
              ) : null}
            </div>

            {baseInfoModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-text-main/40 backdrop-blur-[2px]">
                <div className="glass-card w-full max-w-2xl border-white/70 shadow-2xl p-8 space-y-5">
                  <h4 className="text-lg font-black">
                    {baseInfoModal.mode === 'add'
                      ? baseInfoModal.kind === 'company'
                        ? tx('新增公司', 'Add Company')
                        : baseInfoModal.kind === 'project'
                          ? tx('新增项目', 'Add Project')
                          : tx('新增团队', 'Add Team')
                      : tx('编辑基础信息', 'Edit Base Info')}
                  </h4>
                  {baseInfoModal.kind === 'company' && (
                    <div className="space-y-3">
                      <input className="glass-input w-full px-4 py-3 text-sm font-semibold" placeholder={tx('公司名称', 'Company Name')} value={companyDraft.name} onChange={(e) => setCompanyDraft((p) => ({ ...p, name: e.target.value }))} />
                      <input className="glass-input w-full px-4 py-3 text-sm font-semibold" placeholder={tx('说明', 'Description')} value={companyDraft.description} onChange={(e) => setCompanyDraft((p) => ({ ...p, description: e.target.value }))} />
                    </div>
                  )}
                  {baseInfoModal.kind === 'project' && (
                    <div className="space-y-3">
                      <select className="glass-input w-full px-4 py-3 text-sm font-semibold" value={projectDraft.companyId} onChange={(e) => setProjectDraft((p) => ({ ...p, companyId: e.target.value }))}>
                        <option value="">{tx('选择公司', 'Select Company')}</option>
                        {baseInfoSettings.companies.map((c) => (
                          <option key={c.id} value={c.id}>{c.name || c.id}</option>
                        ))}
                      </select>
                      <input className="glass-input w-full px-4 py-3 text-sm font-semibold" placeholder={tx('项目名称', 'Project Name')} value={projectDraft.name} onChange={(e) => setProjectDraft((p) => ({ ...p, name: e.target.value }))} />
                      <input className="glass-input w-full px-4 py-3 text-sm font-semibold" placeholder={tx('说明', 'Description')} value={projectDraft.description} onChange={(e) => setProjectDraft((p) => ({ ...p, description: e.target.value }))} />
                    </div>
                  )}
                  {baseInfoModal.kind === 'team' && (
                    <div className="space-y-3">
                      <select className="glass-input w-full px-4 py-3 text-sm font-semibold" value={teamDraft.companyId} onChange={(e) => setTeamDraft((p) => ({ ...p, companyId: e.target.value, projectIds: [] }))}>
                        <option value="">{tx('选择公司', 'Select Company')}</option>
                        {baseInfoSettings.companies.map((c) => (
                          <option key={c.id} value={c.id}>{c.name || c.id}</option>
                        ))}
                      </select>
                      <input className="glass-input w-full px-4 py-3 text-sm font-semibold" placeholder={tx('团队名称', 'Team Name')} value={teamDraft.name} onChange={(e) => setTeamDraft((p) => ({ ...p, name: e.target.value }))} />
                      <input className="glass-input w-full px-4 py-3 text-sm font-semibold" placeholder={tx('说明', 'Description')} value={teamDraft.description} onChange={(e) => setTeamDraft((p) => ({ ...p, description: e.target.value }))} />
                    </div>
                  )}
                  <div className="flex gap-3 mt-8">
                    <button type="button" className="flex-1 py-3 glass-card font-black text-xs uppercase tracking-widest" onClick={() => setBaseInfoModal(null)}>
                      {tx('取消', 'Cancel')}
                    </button>
                    <button type="button" className="flex-1 py-3 glass-button" onClick={submitBaseInfoModal}>
                      {tx('保存', 'Save')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

        </div>
      )}

      {activeTab === 'users' && showUsersTab && (
        <div className="space-y-8">
          <UserManagement
            currentUserId={currentUserId}
            baseInfo={baseInfoSettings}
            onUsersChanged={onUsersChanged}
            onSessionExpired={onSessionExpired}
          />

          <section className="glass-card p-8 bg-white/40 space-y-6">
            <div className="flex items-center gap-3">
              <ShieldCheck size={20} className="text-accent" />
              <h3 className="text-xl font-black">{tx('企业级权限控制', 'Enterprise Permission Matrix')}</h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="text-left text-text-main/50">
                    <th className="py-3 pr-4 font-black text-[10px] uppercase tracking-widest">{tx('角色', 'Role')}</th>
                    {PERMISSION_LABELS.map((permission) => (
                      <th key={permission.key} className="py-3 px-2 font-black text-[10px] uppercase tracking-widest">
                        {permissionColumnLabel(permission.key, uiLocale)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROLES.map((r) => (
                    <tr key={r} className="border-t border-white/50">
                      <td className="py-3 pr-4 font-bold">{roleLabels[r]}</td>
                      {PERMISSION_LABELS.map((permission) => (
                        <td key={permission.key} className="py-3 px-2">
                          <label className="flex items-center justify-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={permissionMatrix[r][permission.key]}
                              onChange={() => togglePermission(r, permission.key)}
                            />
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-start gap-2 text-xs text-text-main/60 font-medium">
              <AlertCircle size={14} className="mt-0.5 text-warning-main" />
              {tx('矩阵保存后由服务端强制校验；生产环境请结合 IAM/SSO。', 'The backend enforces this matrix after save; use IAM/SSO in production.')}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'ai' && showAiTab && (
        <div className="space-y-8">
      {can('configureAiModel') && (
        <section className="glass-card p-8 bg-white/40 space-y-6">
          <div className="flex items-center gap-3">
            <Brain size={20} className="text-accent" />
            <h3 className="text-xl font-black">{tx('AI 模型参数', 'AI Model Settings')}</h3>
          </div>

          <div className="rounded-xl border border-black/10 bg-white/45 p-4 space-y-3">
            <p className="text-xs font-black uppercase tracking-widest text-text-main/50">{tx('联通测试', 'Connectivity Tests')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void testModelConnection(false, 'primary')}
                disabled={modelTestLoading}
                className="glass-card px-4 py-2 text-xs font-black uppercase tracking-widest disabled:opacity-60"
              >
                {modelTestLoading ? tx('测试中…', 'Testing...') : tx('测试主模型', 'Test Primary Model')}
              </button>
              <button
                type="button"
                onClick={() => void testModelConnection(false, 'local')}
                disabled={modelTestLoading}
                className="glass-card px-4 py-2 text-xs font-black uppercase tracking-widest disabled:opacity-60"
              >
                {modelTestLoading ? tx('测试中…', 'Testing...') : tx('测试本地模型', 'Test Local (Ollama)')}
              </button>
              <button
                type="button"
                onClick={() => void testModelConnection(false, 'cloud')}
                disabled={modelTestLoading}
                className="glass-card px-4 py-2 text-xs font-black uppercase tracking-widest disabled:opacity-60"
              >
                {modelTestLoading ? tx('测试中…', 'Testing...') : tx('测试云端模型', 'Test Cloud Model')}
              </button>
              <button
                type="button"
                onClick={() => void testModelConnection(false, 'all')}
                disabled={modelTestLoading}
                className="glass-card px-4 py-2 text-xs font-black uppercase tracking-widest disabled:opacity-60"
              >
                {modelTestLoading ? tx('测试中…', 'Testing...') : tx('一键测试全部', 'Test All')}
              </button>
              {modelTestResult && (
                <p className="text-xs font-semibold text-text-main/70 bg-black/[0.04] border border-black/10 rounded-lg px-3 py-2">
                  {modelTestResult}
                </p>
              )}
            </div>
            <p className="text-[11px] text-text-main/55 max-w-3xl leading-relaxed">
              {tx(
                '说明：联通测试由后端发起请求。若 Ollama 在宿主机、应用在 Docker 中，请把地址写成 host.docker.internal（或局域网 IP）。未安装的模型请在运行 Ollama 的机器上执行 ollama pull；界面不再自动拉取以免长时间阻塞或误判。',
                'Note: connectivity tests run from the backend. If Ollama is on the host and the app is in Docker, use host.docker.internal (or a LAN IP). Install missing models with ollama pull on that host — the UI no longer auto-pulls to avoid long hangs or false failures.'
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section className="rounded-xl border border-black/10 bg-white/45 p-4 space-y-3">
              <p className="text-xs font-black uppercase tracking-widest text-text-main/50">{tx('本地模型（Ollama）', 'Local Model (Ollama)')}</p>
              <input
                value={modelSettings.localModel?.ollamaBaseUrl ?? ''}
                onChange={(e) =>
                  setModelSettings((prev) => ({
                    ...prev,
                    localModel: { ...(prev.localModel || DEFAULT_MODEL_SETTINGS.localModel!), provider: 'Ollama', ollamaBaseUrl: e.target.value },
                  }))
                }
                className="glass-input w-full px-3 py-2 text-sm font-semibold"
                placeholder={tx('Ollama 地址，如 http://IP:11434 或 /ollama', 'Ollama URL, e.g. http://IP:11434 or /ollama')}
              />
              <input
                value={modelSettings.localModel?.model ?? ''}
                onChange={(e) =>
                  setModelSettings((prev) => ({
                    ...prev,
                    localModel: { ...(prev.localModel || DEFAULT_MODEL_SETTINGS.localModel!), provider: 'Ollama', model: e.target.value },
                  }))
                }
                className="glass-input w-full px-3 py-2 text-sm font-semibold"
                placeholder={tx('本地模型名，如 qwen2.5:14b', 'Local model name, e.g. qwen2.5:14b')}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">
                    Temperature ({modelSettings.localModel?.temperature ?? modelSettings.temperature})
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={modelSettings.localModel?.temperature ?? modelSettings.temperature}
                    onChange={(e) =>
                      setModelSettings((prev) => ({
                        ...prev,
                        localModel: { ...(prev.localModel || DEFAULT_MODEL_SETTINGS.localModel!), temperature: Number(e.target.value) },
                      }))
                    }
                    className="w-full mt-3"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">Top P</label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={modelSettings.localModel?.topP ?? modelSettings.topP}
                    onChange={(e) =>
                      setModelSettings((prev) => ({
                        ...prev,
                        localModel: { ...(prev.localModel || DEFAULT_MODEL_SETTINGS.localModel!), topP: Number(e.target.value) },
                      }))
                    }
                    className="glass-input w-full px-3 py-2 text-sm font-semibold mt-2"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">Max Tokens</label>
                  <input
                    type="number"
                    min={256}
                    max={32768}
                    step={128}
                    value={modelSettings.localModel?.maxTokens ?? modelSettings.maxTokens}
                    onChange={(e) =>
                      setModelSettings((prev) => ({
                        ...prev,
                        localModel: { ...(prev.localModel || DEFAULT_MODEL_SETTINGS.localModel!), maxTokens: Number(e.target.value) },
                      }))
                    }
                    className="glass-input w-full px-3 py-2 text-sm font-semibold mt-2"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">Timeout (sec)</label>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={modelSettings.localModel?.timeoutSec ?? modelSettings.timeoutSec}
                    onChange={(e) =>
                      setModelSettings((prev) => ({
                        ...prev,
                        localModel: { ...(prev.localModel || DEFAULT_MODEL_SETTINGS.localModel!), timeoutSec: Number(e.target.value) },
                      }))
                    }
                    className="glass-input w-full px-3 py-2 text-sm font-semibold mt-2"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-black/10 bg-white/45 p-4 space-y-3">
              <p className="text-xs font-black uppercase tracking-widest text-text-main/50">{tx('云端模型（深度评估 / 回退）', 'Cloud Model (Deep Eval / Fallback)')}</p>
              <select
                value={modelSettings.cloudModel?.provider ?? 'Gemini'}
                onChange={(e) => {
                  const provider = e.target.value as AiModelSettings['provider'];
                  const defaultBase = OPENAI_PROVIDER_DEFAULTS[provider]?.baseUrl || '';
                  const defaultModel =
                    OPENAI_PROVIDER_DEFAULTS[provider]?.modelHint?.split(' / ')[0]?.trim() ||
                    OPENAI_PROVIDER_DEFAULTS[provider]?.modelHint ||
                    '';
                  setModelSettings((prev) => ({
                    ...prev,
                    cloudModel: {
                      ...(prev.cloudModel || DEFAULT_MODEL_SETTINGS.cloudModel!),
                      provider,
                      model: isOpenAiCompatProvider(provider)
                        ? defaultModel || prev.cloudModel?.model || ''
                        : prev.cloudModel?.model || '',
                      openaiBaseUrl: isOpenAiCompatProvider(provider)
                        ? prev.cloudModel?.openaiBaseUrl?.trim() || defaultBase
                        : prev.cloudModel?.openaiBaseUrl || '',
                    },
                  }));
                }}
                className="glass-input w-full px-3 py-2 text-sm font-semibold"
              >
                <option value="Gemini">Gemini</option>
                <option value="OpenAI">OpenAI</option>
                <option value="DeepSeek">DeepSeek</option>
                <option value="Qwen">Qwen</option>
                <option value="Moonshot">Moonshot</option>
                <option value="Zhipu">Zhipu</option>
                <option value="Doubao">Doubao</option>
                <option value="SiliconFlow">SiliconFlow</option>
                <option value="Azure OpenAI">Azure OpenAI</option>
              </select>
              <input
                value={modelSettings.cloudModel?.model ?? ''}
                onChange={(e) =>
                  setModelSettings((prev) => ({
                    ...prev,
                    cloudModel: { ...(prev.cloudModel || DEFAULT_MODEL_SETTINGS.cloudModel!), model: e.target.value },
                  }))
                }
                className="glass-input w-full px-3 py-2 text-sm font-semibold"
                placeholder={OPENAI_PROVIDER_DEFAULTS[modelSettings.cloudModel?.provider || 'Gemini']?.modelHint || tx('云端模型名', 'Cloud model name')}
              />
              {modelSettings.cloudModel?.provider === 'Gemini' ? (
                <input
                  type="password"
                  value={modelSettings.cloudModel?.geminiApiKey ?? ''}
                  onChange={(e) =>
                    setModelSettings((prev) => ({
                      ...prev,
                      cloudModel: { ...(prev.cloudModel || DEFAULT_MODEL_SETTINGS.cloudModel!), geminiApiKey: e.target.value },
                    }))
                  }
                  className="glass-input w-full px-3 py-2 text-sm font-semibold font-mono"
                  placeholder="Gemini API Key"
                  autoComplete="off"
                />
              ) : (
                <>
                  <input
                    type="password"
                    value={modelSettings.cloudModel?.openaiApiKey ?? ''}
                    onChange={(e) =>
                      setModelSettings((prev) => ({
                        ...prev,
                        cloudModel: { ...(prev.cloudModel || DEFAULT_MODEL_SETTINGS.cloudModel!), openaiApiKey: e.target.value },
                      }))
                    }
                    className="glass-input w-full px-3 py-2 text-sm font-semibold font-mono"
                    placeholder={tx('云端 API Key', 'Cloud API Key')}
                    autoComplete="off"
                  />
                  <input
                    value={modelSettings.cloudModel?.openaiBaseUrl ?? ''}
                    onChange={(e) =>
                      setModelSettings((prev) => ({
                        ...prev,
                        cloudModel: { ...(prev.cloudModel || DEFAULT_MODEL_SETTINGS.cloudModel!), openaiBaseUrl: e.target.value },
                      }))
                    }
                    className="glass-input w-full px-3 py-2 text-sm font-semibold font-mono"
                    placeholder={OPENAI_PROVIDER_DEFAULTS[modelSettings.cloudModel?.provider || 'OpenAI']?.baseUrl ?? 'https://.../v1'}
                  />
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">
                    Temperature ({modelSettings.cloudModel?.temperature ?? modelSettings.temperature})
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={modelSettings.cloudModel?.temperature ?? modelSettings.temperature}
                    onChange={(e) =>
                      setModelSettings((prev) => ({
                        ...prev,
                        cloudModel: { ...(prev.cloudModel || DEFAULT_MODEL_SETTINGS.cloudModel!), temperature: Number(e.target.value) },
                      }))
                    }
                    className="w-full mt-3"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">Top P</label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={modelSettings.cloudModel?.topP ?? modelSettings.topP}
                    onChange={(e) =>
                      setModelSettings((prev) => ({
                        ...prev,
                        cloudModel: { ...(prev.cloudModel || DEFAULT_MODEL_SETTINGS.cloudModel!), topP: Number(e.target.value) },
                      }))
                    }
                    className="glass-input w-full px-3 py-2 text-sm font-semibold mt-2"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">Max Tokens</label>
                  <input
                    type="number"
                    min={256}
                    max={32768}
                    step={128}
                    value={modelSettings.cloudModel?.maxTokens ?? modelSettings.maxTokens}
                    onChange={(e) =>
                      setModelSettings((prev) => ({
                        ...prev,
                        cloudModel: { ...(prev.cloudModel || DEFAULT_MODEL_SETTINGS.cloudModel!), maxTokens: Number(e.target.value) },
                      }))
                    }
                    className="glass-input w-full px-3 py-2 text-sm font-semibold mt-2"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">Timeout (sec)</label>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={modelSettings.cloudModel?.timeoutSec ?? modelSettings.timeoutSec}
                    onChange={(e) =>
                      setModelSettings((prev) => ({
                        ...prev,
                        cloudModel: { ...(prev.cloudModel || DEFAULT_MODEL_SETTINGS.cloudModel!), timeoutSec: Number(e.target.value) },
                      }))
                    }
                    className="glass-input w-full px-3 py-2 text-sm font-semibold mt-2"
                  />
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-black/10 bg-white/45 p-4 space-y-4">
            <p className="text-xs font-black uppercase tracking-widest text-text-main/50">{tx('路由与回退策略', 'Routing and Fallback')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{tx('主模型路由', 'Primary Route')}</label>
                <select
                  value={modelSettings.primaryModel ?? 'local'}
                  onChange={(e) => setModelSettings((prev) => ({ ...prev, primaryModel: e.target.value as 'local' | 'cloud' }))}
                  className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2 bg-white/60"
                >
                  <option value="local">{tx('本地优先（不可用自动切云端）', 'Local first (fallback to cloud)')}</option>
                  <option value="cloud">{tx('云端优先（异常回退本地）', 'Cloud first (fallback to local)')}</option>
                </select>
              </div>
              <label className="flex items-center gap-3 text-sm font-semibold cursor-pointer w-fit mt-8 md:mt-0">
                <input
                  type="checkbox"
                  checked={modelSettings.fallbackEnabled}
                  onChange={(e) => setModelSettings((prev) => ({ ...prev, fallbackEnabled: e.target.checked }))}
                />
                {tx('启用模型回退策略（主模型不可用时自动切换）', 'Enable fallback when primary model is unavailable')}
              </label>
              <div>
                <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">
                  {tx('自动化评估并发数', 'Auto Evaluation Concurrency')}
                </label>
                <select
                  value={Number(modelSettings.evalConcurrency || 3)}
                  onChange={(e) => setModelSettings((prev) => ({ ...prev, evalConcurrency: Number(e.target.value) }))}
                  className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2 bg-white/60"
                >
                  <option value={2}>{tx('2（更稳）', '2 (safer)')}</option>
                  <option value={3}>{tx('3（推荐）', '3 (recommended)')}</option>
                  <option value={5}>{tx('5（更快）', '5 (faster)')}</option>
                </select>
              </div>
            </div>
          </section>

        </section>
      )}

        </div>
      )}

      {activeTab === 'audit' && showAuditTab && (
        <section className="glass-card p-8 bg-white/40 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <History size={20} className="text-accent" />
              <div>
                <h3 className="text-xl font-black">{tx('审计日志', 'Audit Logs')}</h3>
                <p className="text-xs text-text-main/50 font-medium mt-1">{tx('日志保留 180 天，超期自动清理。', 'Logs are retained for 180 days and auto-pruned beyond that.')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={refreshAudit}
              disabled={!backendReady || auditLoading}
              className="glass-card px-4 py-2 text-xs font-black uppercase tracking-widest hover:bg-white/60 disabled:opacity-50"
            >
              {auditLoading ? tx('加载中…', 'Loading...') : tx('刷新', 'Refresh')}
            </button>
          </div>
          {!backendReady ? (
            <p className="text-sm text-text-main/50">{tx('连接后端后可查看审计记录。', 'Connect backend to view audit logs.')}</p>
          ) : auditEntries.length === 0 ? (
            <p className="text-sm text-text-main/50">{tx('暂无记录', 'No records')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAuditTimeWindow('all')}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors',
                    auditTimeWindow === 'all'
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white/60 text-text-main/70 border-black/10 hover:bg-white'
                  )}
                >
                  {tx('全部时间', 'All time')}
                </button>
                <button
                  type="button"
                  onClick={() => setAuditTimeWindow('7d')}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors',
                    auditTimeWindow === '7d'
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white/60 text-text-main/70 border-black/10 hover:bg-white'
                  )}
                >
                  {tx('最近 7 天', 'Last 7 days')}
                </button>
                <button
                  type="button"
                  onClick={() => setAuditTimeWindow('30d')}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors',
                    auditTimeWindow === '30d'
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white/60 text-text-main/70 border-black/10 hover:bg-white'
                  )}
                >
                  {tx('最近 30 天', 'Last 30 days')}
                </button>
                <button
                  type="button"
                  onClick={() => setAuditQuickFilter('all')}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors',
                    auditQuickFilter === 'all'
                      ? 'bg-warning-main text-white border-warning-main'
                      : 'bg-white/60 text-text-main/70 border-black/10 hover:bg-white'
                  )}
                  title={tx('显示所有日志（结合大类筛选）', 'Show all logs (with category filters)')}
                >
                  {tx('全部级别', 'All levels')}
                </button>
                <button
                  type="button"
                  onClick={() => setAuditQuickFilter('errorsOnly')}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors',
                    auditQuickFilter === 'errorsOnly'
                      ? 'bg-danger-main text-white border-danger-main'
                      : 'bg-white/60 text-text-main/70 border-black/10 hover:bg-white'
                  )}
                  title={tx('仅看异常：fail/error/open/timeout 或状态码>=400', 'Errors only: fail/error/open/timeout or status>=400')}
                >
                  {tx('仅异常', 'Errors only')}
                </button>
                {auditCategoryOptions.map((option) => {
                  const active =
                    selectedAuditCategories.includes('all') && option.id === 'all'
                      ? true
                      : selectedAuditCategories.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleAuditCategory(option.id)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors',
                        active
                          ? 'bg-accent text-white border-accent'
                          : 'bg-white/60 text-text-main/70 border-black/10 hover:bg-white'
                      )}
                      title={option.hint}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-text-main/55">
                {tx('已显示', 'Showing')} {filteredAuditEntries.length} / {auditEntries.length} {tx('条', 'entries')}
              </p>
              {filteredAuditEntries.length === 0 ? (
                <p className="text-sm text-text-main/50">{tx('当前筛选下暂无记录', 'No records under current filters')}</p>
              ) : (
                <ul className="space-y-2 max-h-[min(70vh,28rem)] overflow-y-auto font-mono text-[11px] text-text-main/80">
                  {filteredAuditEntries.map((entry, i) => (
                    <li key={i} className="glass-card p-3 bg-black/5 border border-black/5 rounded-xl">
                      <div className="mb-1 text-[10px] font-semibold text-text-main/55">
                        {tx('中国时区（UTC+8）', 'China timezone (UTC+8)')}: {formatAuditTsChina(entry, uiLocale)}
                      </div>
                      {JSON.stringify(entry)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {activeTab === 'usageAudit' && showUsageAuditTab && (
        <UserActivityDashboard
          onSessionExpired={onSessionExpired}
          companies={baseInfoSettings.companies}
          projects={baseInfoSettings.projects}
        />
      )}

      {activeTab === 'about' && showAboutTab && (
        <section className="glass-card p-8 bg-white/40 space-y-6">
          <div className="flex items-center gap-3">
            <Info size={20} className="text-accent" />
            <h3 className="text-xl font-black">{tx('关于', 'About')}</h3>
          </div>

          <div className="space-y-1 text-sm font-medium text-text-main/80">
            <p className="text-lg font-black text-text-main">{APP_DISPLAY_NAME}</p>
            <p>
              {tx('版本号', 'Version')}: <span className="font-mono font-semibold text-accent">{APP_VERSION}</span>
            </p>
            <p>
              {tx('更新日期', 'Updated')}: <span className="font-mono font-semibold text-accent">{APP_UPDATED_DATE || '—'}</span>
            </p>
          </div>

          <div className="border-t border-white/50 pt-6">
            <h4 className="text-sm font-black uppercase tracking-widest text-text-main/50 mb-3">{tx('更新日志', 'Release Notes')}</h4>
            {can('viewReleaseNotes') ? (
              <ul className="space-y-6 max-h-[min(70vh,32rem)] overflow-y-auto pr-1">
                {RELEASE_NOTES.map((entry) => (
                  <li key={entry.version + entry.date} className="glass-card p-4 bg-black/5 border border-black/5 rounded-xl">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                      <span className="font-mono font-black text-accent">{entry.version}</span>
                      <span className="text-xs text-text-main/45">{entry.date}</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1.5 text-sm text-text-main/80">
                      {entry.items.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-start gap-2 text-sm text-text-main/60">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-warning-main" />
                <span>{tx('您暂无权限查看更新日志明细。请联系管理员为当前角色开通「查看更新日志」。', 'You do not have permission to view release notes. Contact an admin to grant this permission.')}</span>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
