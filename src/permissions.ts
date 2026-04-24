/**
 * Shared role / permission matrix (must stay aligned with server defaults in server/api.cjs).
 */
export type AiProvider =
  | 'Gemini'
  | 'Ollama'
  | 'OpenAI'
  | 'Azure OpenAI'
  | 'DeepSeek'
  | 'Qwen'
  | 'Moonshot'
  | 'Zhipu'
  | 'Doubao'
  | 'SiliconFlow';

export interface AiEndpointProfile {
  provider: AiProvider;
  model: string;
  geminiApiKey?: string;
  ollamaBaseUrl?: string;
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutSec?: number;
}

export interface AiModelSettings {
  /** 兼容旧版本：未拆分配置时仍可使用 */
  provider: AiProvider;
  /** 兼容旧版本字段 */
  model: string;
  geminiApiKey?: string;
  ollamaBaseUrl: string;
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  /** 新版：本地模型（通常 Ollama） */
  localModel?: AiEndpointProfile;
  /** 新版：云端模型（Gemini/OpenAI 兼容） */
  cloudModel?: AiEndpointProfile;
  /** 主路由：local 优先，失败按 fallbackEnabled 切 cloud */
  primaryModel?: 'local' | 'cloud';
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutSec: number;
  fallbackEnabled: boolean;
  /** 自动化差距评估并发数（建议 2/3/5） */
  evalConcurrency?: number;
}

/** OpenAI 兼容类 Provider（与下拉、Base URL 模板一致） */
export const OPENAI_COMPAT_PROVIDERS: readonly AiProvider[] = [
  'OpenAI',
  'Azure OpenAI',
  'DeepSeek',
  'Qwen',
  'Moonshot',
  'Zhipu',
  'Doubao',
  'SiliconFlow',
] as const;

export function isOpenAiCompatProvider(p: AiProvider): boolean {
  return (OPENAI_COMPAT_PROVIDERS as readonly string[]).includes(p);
}

/** 各 Provider 的 OpenAI 兼容 Base URL 模板与模型名占位提示 */
export const OPENAI_PROVIDER_DEFAULTS: Record<string, { baseUrl: string; modelHint: string }> = {
  OpenAI: { baseUrl: 'https://api.openai.com/v1', modelHint: 'gpt-4o-mini / gpt-4.1' },
  'Azure OpenAI': {
    baseUrl: 'https://{resource-name}.openai.azure.com/openai/deployments/{deployment-name}',
    modelHint: '你的部署名（deployment name）',
  },
  DeepSeek: { baseUrl: 'https://api.deepseek.com/v1', modelHint: 'deepseek-chat / deepseek-reasoner' },
  Qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelHint: 'qwen-plus / qwen-max / qwen-turbo' },
  Moonshot: { baseUrl: 'https://api.moonshot.cn/v1', modelHint: 'moonshot-v1-8k / moonshot-v1-32k' },
  Zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelHint: 'glm-4-plus / glm-4-air' },
  Doubao: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', modelHint: 'ep-xxxxxxxx（方舟推理接入点）' },
  SiliconFlow: { baseUrl: 'https://api.siliconflow.cn/v1', modelHint: 'Qwen/Qwen2.5-72B-Instruct / deepseek-ai/DeepSeek-V3' },
};

/**
 * 当 Provider 为 OpenAI 兼容类且 Base URL 未填写时，填入该 Provider 官方模板（供展示与保存）。
 */
export function withOpenAiCompatBaseUrlTemplate(settings: AiModelSettings): AiModelSettings {
  if (!isOpenAiCompatProvider(settings.provider)) return settings;
  const d = OPENAI_PROVIDER_DEFAULTS[settings.provider];
  if (!d) return settings;
  if (settings.openaiBaseUrl?.trim()) return settings;
  return { ...settings, openaiBaseUrl: d.baseUrl };
}

/**
 * 切换为 OpenAI 兼容类 Provider 时：写入该 Provider 的 Base URL 模板，并给出模型名占位（避免残留 Gemini/Ollama 模型名）。
 */
export function applyOpenAiCompatProviderSwitch(prev: AiModelSettings, nextProvider: AiProvider): AiModelSettings {
  if (!isOpenAiCompatProvider(nextProvider)) {
    return { ...prev, provider: nextProvider };
  }
  const d = OPENAI_PROVIDER_DEFAULTS[nextProvider];
  if (!d) return { ...prev, provider: nextProvider };
  const firstModel = d.modelHint.split(' / ')[0]?.trim() || d.modelHint;
  return {
    ...prev,
    provider: nextProvider,
    openaiBaseUrl: d.baseUrl,
    model: firstModel,
  };
}

export interface ApiSyncSettings {
  provider: 'native' | 'codebuddy';
  endpoint: string;
  apiKey: string;
  codebuddyEndpoint: string;
  codebuddyApiKey: string;
  codebuddySkill: string;
  syncCron: string;
  autoSyncEnabled: boolean;
  lastSyncAt: string;
  /** 法律法规检索 API 完整 URL（默认：http://localhost:3001/agent/search） */
  legalRegulationsApiUrl: string;
  /** 请求体 query（搜索语句），默认示例：信息安全相关法律法规 */
  legalSearchKeyword: string;
  /** 可选：透传到检索服务的 X-API-Key */
  legalSearchApiKey: string;
  /** 可选：透传到检索服务的 X-Client-Id */
  legalSearchClientId: string;
  /** 是否启用通用大模型对检索结果进行二次结构化 */
  legalPostProcessEnabled: boolean;
  /** 二次结构化使用的模型名（留空则用系统模型设置） */
  legalPostProcessModel: string;
  /** 最近一次法律法规 API 拉取时间（服务端写入） */
  legalLastSyncAt: string;
}

export interface CompanyProfile {
  id: string;
  name: string;
  description: string;
}

export interface ProjectProfile {
  id: string;
  companyId: string;
  name: string;
  description: string;
}

export interface TeamProfile {
  id: string;
  companyId: string;
  projectIds: string[];
  name: string;
  description: string;
}

export interface BaseInfoSettings {
  companies: CompanyProfile[];
  projects: ProjectProfile[];
  teams: TeamProfile[];
}

export type Role = 'SuperAdmin' | 'SecurityAdmin' | 'Auditor' | 'DepartmentManager' | 'Viewer';

export type PermissionKey =
  | 'manageUsers'
  | 'editStandards'
  | 'runAssessments'
  | 'exportReports'
  | 'configureAiModel'
  | 'viewAuditLog'
  | 'viewAssessmentResults'
  | 'viewAppAbout'
  | 'viewReleaseNotes';

export type PermissionMatrix = Record<Role, Record<PermissionKey, boolean>>;

export const ROLES: Role[] = ['SuperAdmin', 'SecurityAdmin', 'Auditor', 'DepartmentManager', 'Viewer'];

/** Column labels for permission matrix; use `permissionColumnLabel(key, locale)` for UI locale. */
export const PERMISSION_LABELS_I18N: Record<PermissionKey, { zh: string; en: string }> = {
  manageUsers: { zh: '用户与角色管理', en: 'Users & roles' },
  editStandards: { zh: '标准条款编辑', en: 'Edit standard clauses' },
  runAssessments: { zh: '发起与终止评估', en: 'Start & stop assessments' },
  exportReports: { zh: '导出审计报告', en: 'Export audit reports' },
  configureAiModel: { zh: 'AI 模型参数配置', en: 'AI model configuration' },
  viewAuditLog: { zh: '查看审计日志', en: 'View audit logs' },
  viewAssessmentResults: { zh: '查看评估最终结果（聚合报告）', en: 'View final assessment results' },
  viewAppAbout: { zh: '查看关于与版本', en: 'View about & version' },
  viewReleaseNotes: { zh: '查看更新日志', en: 'View release notes' },
};

const PERMISSION_COLUMN_ORDER: PermissionKey[] = [
  'manageUsers',
  'editStandards',
  'runAssessments',
  'exportReports',
  'configureAiModel',
  'viewAuditLog',
  'viewAssessmentResults',
  'viewAppAbout',
  'viewReleaseNotes',
];

export function permissionColumnLabel(key: PermissionKey, locale: 'zh-CN' | 'en-US'): string {
  const row = PERMISSION_LABELS_I18N[key];
  return locale === 'en-US' ? row.en : row.zh;
}

export const PERMISSION_LABELS: { key: PermissionKey; label: string }[] = PERMISSION_COLUMN_ORDER.map((key) => ({
  key,
  label: PERMISSION_LABELS_I18N[key].zh,
}));

export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = {
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

export function mergePermissionMatrix(raw: unknown): PermissionMatrix {
  if (!raw || typeof raw !== 'object') {
    return JSON.parse(JSON.stringify(DEFAULT_PERMISSION_MATRIX)) as PermissionMatrix;
  }
  const base = JSON.parse(JSON.stringify(DEFAULT_PERMISSION_MATRIX)) as PermissionMatrix;
  for (const role of ROLES) {
    const row = (raw as Record<string, unknown>)[role];
    if (row && typeof row === 'object') {
      base[role] = { ...base[role], ...(row as Record<PermissionKey, boolean>) };
    }
  }
  return base;
}

export function getRolePermissions(matrix: PermissionMatrix, role: Role): Record<PermissionKey, boolean> {
  return { ...DEFAULT_PERMISSION_MATRIX[role], ...matrix[role] };
}

export function can(matrix: PermissionMatrix, role: Role, key: PermissionKey): boolean {
  return !!getRolePermissions(matrix, role)[key];
}
