import {GoogleGenAI} from '@google/genai';
import {type AiEndpointProfile, type AiModelSettings, isOpenAiCompatProvider, withOpenAiCompatBaseUrlTemplate} from '../permissions';
import {Control, Finding} from '../types';
import { getAuthToken } from './settingsApi';
import { buildEvidenceExcerptForControl } from '../utils/evidenceExcerpt';

const STORAGE_MODEL_KEY = 'ai_guardian_settings_model_v1';

/** 未在配置中填写模型名时，Ollama 请求使用的默认模型 */
export const OLLAMA_DEFAULT_MODEL = 'gpt-oss:20b';
const LOCAL_PROBE_TIMEOUT_MS = 500;
const LOCAL_FAIL_THRESHOLD = 2;
const LOCAL_CIRCUIT_OPEN_MS = 90_000;

const DEFAULT_AI: AiModelSettings = {
  provider: 'Gemini',
  model: 'gemini-2.5-pro',
  geminiApiKey: '',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  openaiBaseUrl: '',
  openaiApiKey: '',
  /** 默认 0 便于同一文档多次评估结果更稳定；需要更发散时可调高 */
  temperature: 0,
  topP: 0.9,
  maxTokens: 4096,
  timeoutSec: 60,
  fallbackEnabled: true,
  evalConcurrency: 3,
  primaryModel: 'local',
  localModel: {
    provider: 'Ollama',
    model: OLLAMA_DEFAULT_MODEL,
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
    temperature: 0.1,
    topP: 0.9,
    maxTokens: 4096,
    timeoutSec: 60,
  },
};

/** 登录后由 App 根据 GET /api/settings 的 model 字段刷新；覆盖 localStorage 中的同名字段（云端为准）。 */
let serverAiModelSnapshot: AiModelSettings | null = null;

/**
 * 将服务端返回的 `settings.model` 合并为运行时快照；评估 / 深度评估优先使用该配置。
 * 传 `null` 或非对象则清除快照（仅使用浏览器 localStorage）。
 */
export function applyServerAiModelSnapshot(raw: unknown): void {
  if (raw == null || typeof raw !== 'object') {
    serverAiModelSnapshot = null;
    return;
  }
  const s = raw as Partial<AiModelSettings>;
  const merged = withOpenAiCompatBaseUrlTemplate({
    ...DEFAULT_AI,
    ...s,
    localModel: { ...DEFAULT_AI.localModel, ...(s.localModel || {}) },
    cloudModel: { ...DEFAULT_AI.cloudModel, ...(s.cloudModel || {}) },
  });
  if (!merged.localModel) {
    merged.localModel = {
      provider: 'Ollama',
      model: merged.model || OLLAMA_DEFAULT_MODEL,
      ollamaBaseUrl: merged.ollamaBaseUrl || 'http://127.0.0.1:11434',
      temperature: merged.temperature,
      topP: merged.topP,
      maxTokens: merged.maxTokens,
      timeoutSec: merged.timeoutSec,
    };
  }
  if (!merged.cloudModel) {
    merged.cloudModel = {
      provider: merged.provider === 'Ollama' ? 'Gemini' : merged.provider,
      model: merged.model || 'gemini-2.5-pro',
      geminiApiKey: merged.geminiApiKey || '',
      openaiApiKey: merged.openaiApiKey || '',
      openaiBaseUrl: merged.openaiBaseUrl || '',
      temperature: merged.temperature,
      topP: merged.topP,
      maxTokens: merged.maxTokens,
      timeoutSec: merged.timeoutSec,
    };
  }
  serverAiModelSnapshot = merged;
}

export function clearServerAiModelSnapshot(): void {
  serverAiModelSnapshot = null;
}

function readMergedFromLocalStorage(): AiModelSettings {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_AI;
  }
  try {
    const raw = localStorage.getItem(STORAGE_MODEL_KEY);
    if (!raw) return DEFAULT_AI;
    const parsed = JSON.parse(raw) as Partial<AiModelSettings>;
    const merged = withOpenAiCompatBaseUrlTemplate({ ...DEFAULT_AI, ...parsed });
    if (!merged.localModel) {
      merged.localModel = {
        provider: 'Ollama',
        model: merged.model || OLLAMA_DEFAULT_MODEL,
        ollamaBaseUrl: merged.ollamaBaseUrl || 'http://127.0.0.1:11434',
        temperature: merged.temperature,
        topP: merged.topP,
        maxTokens: merged.maxTokens,
        timeoutSec: merged.timeoutSec,
      };
    }
    if (!merged.cloudModel) {
      merged.cloudModel = {
        provider: merged.provider === 'Ollama' ? 'Gemini' : merged.provider,
        model: merged.model || 'gemini-2.5-pro',
        geminiApiKey: merged.geminiApiKey || '',
        openaiApiKey: merged.openaiApiKey || '',
        openaiBaseUrl: merged.openaiBaseUrl || '',
        temperature: merged.temperature,
        topP: merged.topP,
        maxTokens: merged.maxTokens,
        timeoutSec: merged.timeoutSec,
      };
    }
    return merged;
  } catch {
    return DEFAULT_AI;
  }
}

export function getAiSettings(): AiModelSettings {
  const local = readMergedFromLocalStorage();
  if (!serverAiModelSnapshot) return local;
  return withOpenAiCompatBaseUrlTemplate({
    ...local,
    ...serverAiModelSnapshot,
    localModel: {
      ...(local.localModel || DEFAULT_AI.localModel),
      ...(serverAiModelSnapshot.localModel || {}),
    },
    cloudModel: {
      ...(local.cloudModel || DEFAULT_AI.cloudModel),
      ...(serverAiModelSnapshot.cloudModel || {}),
    },
  });
}

/** 含深度评估附加字段及「写入 finding 的证据摘录」 */
export type GapAnalysisResult = Partial<Finding> &
  Record<string, unknown> & {
    evidenceExcerpt?: string;
  };

function capEvidenceDisplay(s: string): string {
  const cap = 14_000;
  if (s.length <= cap) return s;
  return `${s.slice(0, cap - 40)}\n\n[…已截断至 ${cap} 字以内以便存储]`;
}

function withEvidenceExcerpt(r: Partial<Finding>, display: string): GapAnalysisResult {
  return { ...r, evidenceExcerpt: capEvidenceDisplay(display.trim() || '') };
}

function getGeminiClient(profile: AiEndpointProfile): GoogleGenAI | null {
  const fromSettings = profile.geminiApiKey?.trim();
  const fromVite =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY
      ? String(import.meta.env.VITE_GEMINI_API_KEY).trim()
      : '';
  const apiKey = fromSettings || fromVite;
  if (!apiKey) {
    return null;
  }
  try {
    return new GoogleGenAI({apiKey});
  } catch {
    return null;
  }
}

function getOpenAiCompatConfig(profile: AiEndpointProfile): { baseUrl: string; apiKey: string } | null {
  const fromSettingsKey = profile.openaiApiKey?.trim() || '';
  const fromViteKey =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_OPENAI_API_KEY
      ? String(import.meta.env.VITE_OPENAI_API_KEY).trim()
      : '';
  const fromSettingsBase = profile.openaiBaseUrl?.trim() || '';
  const fromViteBase =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_OPENAI_BASE_URL
      ? String(import.meta.env.VITE_OPENAI_BASE_URL).trim()
      : '';
  const apiKey = fromSettingsKey || fromViteKey;
  const baseUrl = (fromSettingsBase || fromViteBase || '').replace(/\/$/, '');
  if (!apiKey || !baseUrl) return null;
  return { baseUrl, apiKey };
}

/**
 * - 以 `/` 开头：同源路径（由 Vite 或 server/api.cjs 反代到 Ollama）
 * - 开发模式（Vite）：始终走 /ollama
 * - 生产/预览：默认本机地址也走同源 /ollama，避免浏览器直连 127.0.0.1:11434 触发跨域
 * - 其它完整 URL：直连（需在 Ollama 配置 OLLAMA_ORIGINS）
 */
function getOllamaHttpBase(profile: AiEndpointProfile): string {
  const raw = (profile.ollamaBaseUrl || '').trim();
  if (raw.startsWith('/')) {
    return raw.replace(/\/$/, '') || '/ollama';
  }
  if (import.meta.env.DEV) {
    return '/ollama';
  }
  const isDefaultLocalOllama =
    !raw ||
    raw === 'http://127.0.0.1:11434' ||
    raw === 'http://localhost:11434';
  if (isDefaultLocalOllama) {
    return '/ollama';
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw.replace(/\/$/, '');
  }
  return '/ollama';
}

async function ollamaChat(settings: AiModelSettings, profile: AiEndpointProfile, userPrompt: string): Promise<string> {
  const base = getOllamaHttpBase(profile);
  const url = `${base}/api/chat`;
  const controller = new AbortController();
  const ms = Math.min(300_000, Math.max(5000, profileTimeoutSec(profile, settings) * 1000));
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      signal: controller.signal,
      body: JSON.stringify({
        model: (profile.model || '').trim() || OLLAMA_DEFAULT_MODEL,
        messages: [{role: 'user', content: userPrompt}],
        stream: false,
        options: {
          temperature: profileTemperature(profile, settings),
          top_p: profileTopP(profile, settings),
          num_predict: Math.min(32768, profileMaxTokens(profile, settings)),
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as {message?: {content?: string}; error?: string};
    if (data.error) {
      throw new Error(data.error);
    }
    const text = data.message?.content?.trim();
    if (!text) {
      throw new Error('Ollama 返回空内容');
    }
    return text;
  } catch (e) {
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function openaiCompatibleChat(settings: AiModelSettings, userPrompt: string): Promise<string> {
  const profile = resolveCloudProfile(settings);
  const cfg = getOpenAiCompatConfig(profile);
  if (!cfg) {
    throw new Error('未配置 OpenAI 兼容 API Key 或 Base URL');
  }
  const controller = new AbortController();
  const ms = Math.min(300_000, Math.max(5000, profileTimeoutSec(profile, settings) * 1000));
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const base = cfg.baseUrl.replace(/\/$/, '');
    const endpoint = /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: profile.model,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: profileTemperature(profile, settings),
        top_p: profileTopP(profile, settings),
        max_tokens: Math.min(32768, profileMaxTokens(profile, settings)),
        stream: false,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI 兼容接口 HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string } | string;
    };
    if (data.error) {
      const message = typeof data.error === 'string' ? data.error : data.error.message || '未知错误';
      throw new Error(message);
    }
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error('OpenAI 兼容接口返回空内容');
    }
    return text;
  } catch (e) {
    throw e;
  } finally {
    clearTimeout(t);
  }
}

type AiRoute = 'local' | 'cloud';
type CircuitState = {
  failureCount: number;
  openUntilMs: number;
  probing: boolean;
  lastError: string;
};

const localCircuit: CircuitState = {
  failureCount: 0,
  openUntilMs: 0,
  probing: false,
  lastError: '',
};
const runtimeEventDedupTs: Record<string, number> = {};

async function reportRuntimeEvent(event: string, detail: Record<string, unknown>) {
  try {
    const now = Date.now();
    const last = runtimeEventDedupTs[event] || 0;
    if (now - last < 5000) return;
    runtimeEventDedupTs[event] = now;
    const token = getAuthToken();
    if (!token) return;
    await fetch('/api/model/runtime-event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ event, detail }),
    });
  } catch {
    // ignore runtime audit reporting errors
  }
}

function markLocalSuccess() {
  const wasOpen = localCircuit.openUntilMs > Date.now();
  localCircuit.failureCount = 0;
  localCircuit.openUntilMs = 0;
  localCircuit.lastError = '';
  if (wasOpen) {
    void reportRuntimeEvent('local_circuit_recovered', {
      at: new Date().toISOString(),
    });
  }
}

function markLocalFailure(err: unknown) {
  const wasOpen = localCircuitOpenNow();
  localCircuit.failureCount += 1;
  localCircuit.lastError = err instanceof Error ? err.message : String(err);
  if (localCircuit.failureCount >= LOCAL_FAIL_THRESHOLD) {
    localCircuit.openUntilMs = Date.now() + LOCAL_CIRCUIT_OPEN_MS;
    if (!wasOpen) {
      void reportRuntimeEvent('local_circuit_open', {
        at: new Date().toISOString(),
        failureCount: localCircuit.failureCount,
        openMs: LOCAL_CIRCUIT_OPEN_MS,
        reason: localCircuit.lastError.slice(0, 300),
      });
    }
  } else {
    void reportRuntimeEvent('local_route_fail', {
      at: new Date().toISOString(),
      failureCount: localCircuit.failureCount,
      reason: localCircuit.lastError.slice(0, 300),
    });
  }
}

function localCircuitOpenNow(): boolean {
  return Date.now() < localCircuit.openUntilMs;
}

async function probeLocalModel(profile: AiEndpointProfile): Promise<boolean> {
  if (localCircuit.probing) return false;
  localCircuit.probing = true;
  try {
    const base = getOllamaHttpBase(profile);
    const endpoint = `${base}/api/tags`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LOCAL_PROBE_TIMEOUT_MS);
    try {
      const r = await fetch(endpoint, { method: 'GET', signal: ctrl.signal });
      if (!r.ok) {
        void reportRuntimeEvent('local_probe_failed', {
          at: new Date().toISOString(),
          status: r.status,
        });
        return false;
      }
      markLocalSuccess();
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    void reportRuntimeEvent('local_probe_failed', {
      at: new Date().toISOString(),
      error: 'probe_exception',
    });
    return false;
  } finally {
    localCircuit.probing = false;
  }
}

function resolveLocalProfile(settings: AiModelSettings): AiEndpointProfile {
  return {
    provider: 'Ollama',
    model: settings.localModel?.model || settings.model || OLLAMA_DEFAULT_MODEL,
    ollamaBaseUrl: settings.localModel?.ollamaBaseUrl || settings.ollamaBaseUrl || 'http://127.0.0.1:11434',
  };
}

function resolveCloudProfile(settings: AiModelSettings): AiEndpointProfile {
  const p = settings.cloudModel;
  if (p) return p;
  return {
    provider: settings.provider === 'Ollama' ? 'Gemini' : settings.provider,
    model: settings.model,
    geminiApiKey: settings.geminiApiKey,
    openaiApiKey: settings.openaiApiKey,
    openaiBaseUrl: settings.openaiBaseUrl,
  };
}

function profileTimeoutSec(profile: AiEndpointProfile, settings: AiModelSettings): number {
  const p = Number(profile?.timeoutSec);
  if (Number.isFinite(p) && p > 0) return p;
  return Number(settings.timeoutSec || 60);
}

function profileTemperature(profile: AiEndpointProfile, settings: AiModelSettings): number {
  const p = Number(profile?.temperature);
  if (Number.isFinite(p)) return p;
  return Number(settings.temperature ?? 0);
}

function profileTopP(profile: AiEndpointProfile, settings: AiModelSettings): number {
  const p = Number(profile?.topP);
  if (Number.isFinite(p)) return p;
  return Number(settings.topP ?? 0.9);
}

function profileMaxTokens(profile: AiEndpointProfile, settings: AiModelSettings): number {
  const p = Number(profile?.maxTokens);
  if (Number.isFinite(p) && p > 0) return p;
  return Number(settings.maxTokens || 4096);
}

function chooseRoute(settings: AiModelSettings, evidenceText: string, preferCloud: boolean): AiRoute {
  if (preferCloud) return 'cloud';
  if (localCircuitOpenNow()) return 'cloud';
  const threshold = 4000;
  if ((evidenceText || '').length > threshold) return 'cloud';
  return settings.primaryModel === 'cloud' ? 'cloud' : 'local';
}

async function runWithRoute(settings: AiModelSettings, route: AiRoute, prompt: string): Promise<string> {
  const serverFallback = async (mode: 'local' | 'cloud') => {
    const token = getAuthToken();
    if (!token) throw new Error('missing auth token for server model fallback');
    const r = await fetch('/api/ai-assistant/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: prompt, mode }),
    });
    const data = (await r.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
    if (!r.ok || data.ok === false || !String(data.text || '').trim()) {
      throw new Error(data.error || `server fallback failed: ${r.status}`);
    }
    return String(data.text || '');
  };

  if (route === 'local') {
    try {
      return await ollamaChat(settings, resolveLocalProfile(settings), prompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/load failed|failed to fetch|networkerror|fetch is aborted/i.test(msg)) {
        return serverFallback('local');
      }
      throw e;
    }
  }
  const cloud = resolveCloudProfile(settings);
  if (cloud.provider === 'Gemini') {
    try {
      const ai = getGeminiClient(cloud);
      if (!ai) throw new Error('未配置 Gemini API Key');
      const timeoutMs = Math.min(300_000, Math.max(5000, profileTimeoutSec(cloud, settings) * 1000));
      const response = await Promise.race([
        ai.models.generateContent({
          model: cloud.model || 'gemini-2.5-flash',
          contents: prompt,
          config: {
            temperature: profileTemperature(cloud, settings),
            topP: profileTopP(cloud, settings),
            maxOutputTokens: Math.min(32768, profileMaxTokens(cloud, settings)),
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini 请求超时（>${timeoutMs}ms）`)), timeoutMs)
        ),
      ]);
      return response.text || '';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/load failed|failed to fetch|networkerror|fetch is aborted/i.test(msg)) {
        return serverFallback('cloud');
      }
      throw e;
    }
  }
  if (isOpenAiCompatProvider(cloud.provider)) {
    try {
      return await openaiCompatibleChat(settings, prompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/load failed|failed to fetch|networkerror|fetch is aborted/i.test(msg)) {
        return serverFallback('cloud');
      }
      throw e;
    }
  }
  throw new Error(`暂不支持云端 Provider：${cloud.provider}`);
}

function localKeywordFallback(control: Control, evidenceText: string): Partial<Finding> {
  const lowerEvidence = evidenceText.toLowerCase();
  const lowerRequirement = control.requirement.toLowerCase();
  const hasMatch = lowerRequirement.split(/[,，。；;]/).some((keyword) => keyword.trim().length > 3 && lowerEvidence.includes(keyword.trim()));
  return {
    // 保守兜底：模型链路失败时不直接判“合规”，避免未充分核验却全部 Compliant。
    status: hasMatch ? 'Partial' : 'Non-Compliant',
    analysis: hasMatch
      ? '模型链路失败，已执行本地兜底匹配：发现部分证据与控制要求存在关联，但未完成模型级核验，暂不判定为完全合规。'
      : '模型链路失败，且本地兜底未发现与该控制要求直接相关的充分证据。',
    recommendation: hasMatch
      ? '请恢复模型连接后重新执行自动评估；补充关键证据（日志、配置、审批记录）后再确认是否合规。'
      : '请补充该控制项的直接证据，并在模型连通后重新执行自动评估。',
  };
}

function parseFindingJsonSafe(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct) return direct;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const fromFence = tryParse(String(fenced[1]).trim());
    if (fromFence) return fromFence;
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const fromBraces = tryParse(raw.slice(first, last + 1));
    if (fromBraces) return fromBraces;
  }
  return null;
}

function normalizeFindingStatus(input: unknown): Finding['status'] {
  const v = String(input || '').trim().toLowerCase();
  if (!v) return 'Non-Compliant';
  if (v === 'compliant' || v.includes('合规') || v.includes('符合')) return 'Compliant';
  if (v === 'partial' || v.includes('部分')) return 'Partial';
  if (v === 'not applicable' || v === 'not_applicable' || v === 'na' || v.includes('不适用')) return 'Not Applicable';
  if (v === 'non-compliant' || v === 'noncompliant' || v.includes('不合规') || v.includes('不符合')) return 'Non-Compliant';
  return 'Non-Compliant';
}

function normalizeForNaMatch(input: string): string {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasExplicitNaMarker(text: string): boolean {
  const raw = String(text || '');
  if (!raw) return false;
  if (/(status|状态)\s*[:：]\s*(not applicable|不适用|na)\b/i.test(raw)) return true;
  if (/\bnot\s*applicable\b/i.test(raw)) return true;
  if (/(^|[：:\-\s])(不适用)([，。；;\s]|$)/.test(raw)) return true;
  return false;
}

function isNotApplicableByResearch(control: Control, evidenceText: string): boolean {
  const evidence = String(evidenceText || '');
  if (!hasExplicitNaMarker(evidence)) return false;

  const blocks = evidence
    .split(/\n\s*\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
  const controlId = normalizeForNaMatch(control.id || '');
  const controlName = normalizeForNaMatch(control.name || '');

  // Prefer control-scoped NA evidence to avoid one NA statement affecting all controls.
  for (const block of blocks) {
    if (!hasExplicitNaMarker(block)) continue;
    const normalized = normalizeForNaMatch(block);
    if ((controlId && normalized.includes(controlId)) || (controlName && normalized.includes(controlName))) {
      return true;
    }
  }

  // If there is no control identifier at all in the evidence body, treat explicit NA as global.
  const normalizedAll = normalizeForNaMatch(evidence);
  const evidenceMentionsControl = (controlId && normalizedAll.includes(controlId)) || (controlName && normalizedAll.includes(controlName));
  return !evidenceMentionsControl && hasExplicitNaMarker(evidence);
}

/**
 * 将模型原文转为 Finding 片段：优先解析 JSON；解析失败时保留摘录便于排错，避免静默空结果。
 * @param evidenceTextForFallback 全文，用于关键词兜底
 * @param diagnosticEvidence 写入错误诊断时展示的文本（常为送入模型的摘录）
 */
function gapAnalysisFromModelText(
  text: string,
  control: Control,
  evidenceTextForFallback: string,
  diagnosticEvidence?: string
): Partial<Finding> {
  const trimmed = String(text || '').trim();
  const parsed = parseFindingJsonSafe(trimmed);
  if (parsed) return normalizeFindingResult(parsed);
  if (trimmed.length > 0) {
    const diag = (diagnosticEvidence ?? evidenceTextForFallback).trim();
    return {
      status: 'Partial',
      analysis: `分析失败：模型输出不是有效 JSON，无法写入结构化结论。模型原文摘录：\n${trimmed.slice(0, 1200)}${trimmed.length > 1200 ? '…' : ''}\n\n送入分析的证据摘录：\n${diag.slice(0, 1800)}${diag.length > 1800 ? '…' : ''}`,
      recommendation:
        '请重试本次分析；若多次出现，请检查模型配置与超时参数，必要时更换模型后重跑。',
    };
  }
  return localKeywordFallback(control, evidenceTextForFallback);
}

function normalizeFindingResult(parsed: Record<string, unknown> | null): Partial<Finding> & Record<string, unknown> {
  if (!parsed) return {};
  const deep = parsed.deepEval && typeof parsed.deepEval === 'object' ? (parsed.deepEval as Record<string, unknown>) : {};
  const rootCause = String(parsed.rootCause || deep.rootCause || '').trim();
  const technicalDetails = String(parsed.technicalDetails || deep.technicalDetails || '').trim();
  const ownerTeam = String(parsed.ownerTeam || deep.ownerTeam || '').trim();
  const targetDate = String(parsed.targetDate || deep.targetDate || '').trim();
  const riskLevel = String(parsed.riskLevel || deep.riskLevel || '').trim();
  const recommendations = Array.isArray(parsed.recommendations)
    ? (parsed.recommendations as unknown[]).map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const baseAnalysis = String(parsed.analysis || '').trim();
  const baseRecommendation = String(parsed.recommendation || '').trim();
  const analysis = [baseAnalysis, rootCause ? `根因：${rootCause}` : '', technicalDetails ? `技术说明：${technicalDetails}` : '']
    .filter(Boolean)
    .join('\n');
  const recommendation = [
    baseRecommendation,
    recommendations.length > 0 ? `整改建议：${recommendations.join('；')}` : '',
    ownerTeam ? `建议负责团队：${ownerTeam}` : '',
    targetDate ? `建议完成时间：${targetDate}` : '',
    riskLevel ? `风险等级：${riskLevel}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const normalizedStatus = normalizeFindingStatus(parsed.status);
  return {
    status: normalizedStatus,
    analysis: analysis || (normalizedStatus === 'Compliant' ? '模型判定为合规；未提供详细分析文本。' : ''),
    recommendation:
      recommendation ||
      (normalizedStatus === 'Compliant' ? '建议保留证据材料以备审计复核。' : ''),
    rootCause,
    technicalDetails,
    ownerTeam,
    targetDate,
    riskLevel,
    recommendations,
  };
}

export async function performGapAnalysis(
  control: Control,
  evidenceText: string,
  options?: { preferCloud?: boolean; deepEval?: boolean; evidenceBudgetChars?: number }
): Promise<GapAnalysisResult> {
  const settings = getAiSettings();
  const budgetChars = Number(options?.evidenceBudgetChars);
  const bundle = buildEvidenceExcerptForControl(control, evidenceText, {
    budgetChars: Number.isFinite(budgetChars)
      ? Math.min(48_000, Math.max(2_000, budgetChars))
      : options?.deepEval
        ? 9_000
        : 6_000,
  });
  const promptEvidenceBody = bundle.excerpt
    ? `${bundle.preamble}\n\n${bundle.excerpt}`.trim()
    : '(无证据文本)';
  const diagnosticContext = bundle.wasTruncated ? promptEvidenceBody : evidenceText;
  const displayForFinding = (bundle.displayForFinding || promptEvidenceBody || evidenceText).trim();
  const naDetected = isNotApplicableByResearch(control, evidenceText);
  if (naDetected) {
    return withEvidenceExcerpt(
      {
        status: 'Not Applicable',
        analysis:
          '人工调研结果已明确标注本控制项为“不适用（Not Applicable）”，本次已跳过大模型评估。请在审计复核时确认该不适用范围与边界持续成立。',
        recommendation: '建议保留不适用判定依据（业务范围、系统边界、职责边界）并按周期复核。',
      },
      displayForFinding
    );
  }

  const prompt = `你是安全合规评估助手。请根据给定证据判断控制项差距，并输出 JSON。

控制项:
ID: ${control.id}
名称: ${control.name}
要求: ${control.requirement}${
    control.command?.trim() ? `\n参考命令:\n${control.command.trim()}` : ''
  }

证据:
${promptEvidenceBody}

输出格式（仅 JSON）:
{
  "status": "Compliant" | "Partial" | "Non-Compliant" | "Not Applicable",
  "analysis": "简要分析（1-3 句）",
  "recommendation": "可执行建议（1-3 句）"
}

要求:
1) 仅基于证据，不要编造。
2) 证据不足时优先给 Partial，并在 analysis 写明“证据不足”。
3) 只返回 JSON。${
    options?.deepEval
      ? '\n深度评估模式：额外返回 rootCause、technicalDetails、recommendations(数组)、ownerTeam、targetDate、riskLevel。technicalDetails 不超过 180 字，recommendations 最多 3 条。'
      : ''
  }`;

  const initialRoute = chooseRoute(settings, evidenceText, options?.preferCloud === true);
  const fallbackRoute: AiRoute = initialRoute === 'local' ? 'cloud' : 'local';
  if (initialRoute === 'cloud' && localCircuit.openUntilMs > 0 && !localCircuitOpenNow()) {
    const recovered = await probeLocalModel(resolveLocalProfile(settings));
    if (recovered && !options?.preferCloud) {
      try {
        const text = await runWithRoute(settings, 'local', prompt);
        return withEvidenceExcerpt(
          gapAnalysisFromModelText(text, control, evidenceText, diagnosticContext),
          displayForFinding
        );
      } catch (e) {
        markLocalFailure(e);
      }
    }
  }
  try {
    const text = await runWithRoute(settings, initialRoute, prompt);
    if (initialRoute === 'local') markLocalSuccess();
    const parsed = gapAnalysisFromModelText(text, control, evidenceText, diagnosticContext);
    return withEvidenceExcerpt(parsed, displayForFinding);
  } catch (e) {
    if (initialRoute === 'local') markLocalFailure(e);
    console.error('Primary gap analysis failed:', e);
    if (settings.fallbackEnabled) {
      try {
        const text = await runWithRoute(settings, fallbackRoute, prompt);
        if (fallbackRoute === 'local') markLocalSuccess();
        const parsed = gapAnalysisFromModelText(text, control, evidenceText, diagnosticContext);
        return withEvidenceExcerpt(parsed, displayForFinding);
      } catch (secondErr) {
        if (fallbackRoute === 'local') markLocalFailure(secondErr);
        console.error('Fallback gap analysis failed:', secondErr);
      }
    }
    const local = localKeywordFallback(control, evidenceText);
    return withEvidenceExcerpt(local, displayForFinding);
  }
}

export async function generateExecutiveSummary(standardName: string, findings: Finding[], controls: Control[]): Promise<string> {
  const settings = getAiSettings();
  const compliantCount = findings.filter((f) => f.status === 'Compliant').length;
  const nonCompliantCount = findings.filter((f) => f.status === 'Non-Compliant').length;
  const partialCount = findings.filter((f) => f.status === 'Partial').length;

  const prompt = `请为一份安全合规评估报告撰写执行摘要。
标准名称: ${standardName}
评估统计:
- 总检查项: ${controls.length}
- 已合规: ${compliantCount}
- 不合规: ${nonCompliantCount}
- 部分合规: ${partialCount}

主要问题要点:
${findings
  .filter((f) => f.status !== 'Compliant')
  .slice(0, 5)
  .map((f) => `- ${f.controlId}: ${f.analysis}`)
  .join('\n')}

请用专业、客观、严谨的语气撰写，包含整体概括、主要差距和改进建议。直接输出正文，不要 Markdown 代码块。`;

  const route = chooseRoute(settings, findings.map((f) => `${f.analysis} ${f.recommendation}`).join('\n'), false);
  try {
    const out = await runWithRoute(settings, route, prompt);
    if (route === 'local') markLocalSuccess();
    return out;
  } catch {
    if (route === 'local') markLocalFailure(new Error('local summary failed'));
    if (settings.fallbackEnabled) {
      try {
        const fallbackRoute = route === 'local' ? 'cloud' : 'local';
        const out = await runWithRoute(settings, fallbackRoute, prompt);
        if (fallbackRoute === 'local') markLocalSuccess();
        return out;
      } catch {
        if (route !== 'local') markLocalFailure(new Error('fallback local summary failed'));
        return localSummaryText(standardName, findings, controls, compliantCount, nonCompliantCount, partialCount);
      }
    }
    return localSummaryText(standardName, findings, controls, compliantCount, nonCompliantCount, partialCount);
  }
}

function localSummaryText(
  standardName: string,
  findings: Finding[],
  controls: Control[],
  compliantCount: number,
  nonCompliantCount: number,
  partialCount: number
): string {
  const complianceRate = controls.length > 0 ? Math.round((compliantCount / controls.length) * 100) : 0;
  return `【${standardName}】安全合规评估执行摘要

一、整体评估概况
本次评估共检查 ${controls.length} 个控制项，其中：
- 已合规项：${compliantCount} 项
- 部分合规项：${partialCount} 项  
- 不合规项：${nonCompliantCount} 项
- 整体合规率：${complianceRate}%

二、主要发现
${findings.filter((f) => f.status !== 'Compliant').length > 0
    ? findings
        .filter((f) => f.status !== 'Compliant')
        .slice(0, 5)
        .map((f) => `  - ${f.controlId}: ${f.analysis}`)
        .join('\n')
    : '本次评估未发现重大合规差距。'}

三、改进建议
${nonCompliantCount > 0
    ? '1. 优先处理不合规项，制定整改计划\n2. 完善相关政策和流程文档\n3. 加强人员培训和安全意识'
    : '1. 持续监控现有合规状态\n2. 定期进行内部审计\n3. 关注法规更新并及时调整'}
`;
}
