/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import {
  Shield,
  LayoutDashboard,
  Bot,
  FileText,
  Settings,
  ChevronRight,
  Plus,
  ArrowLeft,
  Trash2,
  CheckCircle2,
  Clock,
  Loader2,
  LogOut,
  AlertCircle,
  User,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { Assessment, Control } from './types';
import Dashboard from './components/Dashboard';
import NewAssessmentModal, { buildAssessmentDisplayName } from './components/NewAssessmentModal';
import LoginPage from './components/LoginPage';
import AppLogo from './components/AppLogo';
import { MOCK_CONTROLS } from './constants/mockData';
import {
  STANDARDS_CATALOG,
  catalogEntryToAppStandard,
  loadCustomStandardsFromStorage,
  saveCustomStandardsToStorage,
  type StandardCatalogEntry,
} from './constants/standardsCatalog';
import { fetchAuthStatus, fetchMe, logout as authLogout } from './services/authApi';
import { fetchAssessments, fetchSettings, getAuthToken, putAssessments, putSettings, setAuthToken } from './services/settingsApi';
import { getRolePermissions, mergePermissionMatrix, type Role } from './permissions';
import { applyServerAiModelSnapshot, clearServerAiModelSnapshot, performGapAnalysis, type GapAnalysisResult } from './services/llm';
import { getLocale, setLocale, type LocaleId } from './i18n';

const AiAssistant = lazy(() => import('./components/AiAssistant'));
const StandardsConfig = lazy(() => import('./components/StandardsConfig'));
const SystemSettings = lazy(() => import('./components/SystemSettings'));
const AssessmentFlow = lazy(() => import('./components/AssessmentFlow'));

function TabLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-3 text-text-main/50">
      <Loader2 className="animate-spin" size={28} />
      <span className="text-sm font-semibold">加载中…</span>
    </div>
  );
}

const STORAGE_KEY_CONTROLS = 'ai_guardian_controls_v1';
/** 已完成任务卡片：按 findings 统计合规率与各状态数量 */
function completedTaskFindingStats(findings: Assessment['findings']) {
  let compliant = 0;
  let partial = 0;
  let nonCompliant = 0;
  for (const f of findings) {
    if (f.status === 'Compliant') compliant += 1;
    else if (f.status === 'Partial') partial += 1;
    else if (f.status === 'Non-Compliant') nonCompliant += 1;
  }
  const total = findings.length;
  const ratePct = total > 0 ? Math.round((compliant / total) * 100) : null;
  return { compliant, partial, nonCompliant, total, ratePct };
}

const ALL_NAV = [
  { id: 'dashboard' as const, label: 'D', tooltip: '仪表盘', icon: LayoutDashboard },
  { id: 'assistant' as const, label: 'AI', tooltip: 'AI助手', icon: Bot },
  { id: 'assessments' as const, label: 'A', tooltip: '评估任务', icon: FileText },
  { id: 'standards' as const, label: 'S', tooltip: '合规标准', icon: Shield },
  { id: 'settings' as const, label: 'C', tooltip: '配置', icon: Settings },
];
const I18N: Record<LocaleId, Record<string, string>> = {
  'zh-CN': {
    dashboard: '仪表盘',
    assistant: 'AI助手',
    assessments: '评估任务',
    standards: '合规标准',
    settings: '配置',
    logout: '退出',
    init: '正在初始化…',
    loadPerm: '正在加载权限…',
  },
  'en-US': {
    dashboard: 'Dashboard',
    assistant: 'AI Assistant',
    assessments: 'Assessments',
    standards: 'Standards',
    settings: 'Settings',
    logout: 'Logout',
    init: 'Initializing…',
    loadPerm: 'Loading permissions…',
  },
};

type DeepEvalTaskRecord = {
  id: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  total: number;
  done: number;
  updatedFindings: number;
  affectedAssessmentIds: string[];
  reportSummary?: string;
  error?: string;
  itemRuns?: Array<{
    assessmentId: string;
    controlId: string;
    status: 'updated' | 'failed';
    durationMs: number;
    error?: string;
    analysis?: string;
    recommendation?: string;
    ownerTeam?: string;
    targetDate?: string;
  }>;
};

export default function App() {
  const [locale, setLocaleState] = useState<LocaleId>(() => getLocale());
  const [authLoading, setAuthLoading] = useState(true);
  const [apiDown, setApiDown] = useState(false);
  const [apiErrorDetail, setApiErrorDetail] = useState<string | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [user, setUser] = useState<{
    id: string;
    username: string;
    role: string;
    companyId?: string;
    projectId?: string;
    teamId?: string;
    visibleCompanyIds?: string[];
    visibleProjectIds?: string[];
  } | null>(null);
  const [settingsForPerm, setSettingsForPerm] = useState<Record<string, unknown> | null>(null);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'assistant' | 'assessments' | 'standards' | 'settings'>('dashboard');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(null);
  const [newAssessmentOpen, setNewAssessmentOpen] = useState(false);
  const [assessmentCompanyFilter, setAssessmentCompanyFilter] = useState('all');
  const [assessmentProjectFilter, setAssessmentProjectFilter] = useState('all');
  const [assessmentCreatorFilter, setAssessmentCreatorFilter] = useState('all');
  const [deepEvaluating, setDeepEvaluating] = useState(false);
  const [deepEvalNotice, setDeepEvalNotice] = useState<string | null>(null);
  const [deepEvalTasks, setDeepEvalTasks] = useState<DeepEvalTaskRecord[]>([]);

  const [assessments, setAssessments] = useState<Assessment[]>([]);

  const [controls, setControls] = useState<Record<string, Control[]>>(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY_CONTROLS);
        return saved ? JSON.parse(saved) : MOCK_CONTROLS;
      }
    } catch (e) {
      console.error('Failed to load controls:', e);
    }
    return MOCK_CONTROLS;
  });

  const [assessmentsHydrated, setAssessmentsHydrated] = useState(false);
  /** JSON snapshot last successfully persisted (or loaded from server) to skip redundant PUTs. */
  const lastSavedAssessmentsSig = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CONTROLS, JSON.stringify(controls));
  }, [controls]);

  const [customStandards, setCustomStandards] = useState<StandardCatalogEntry[]>(() => loadCustomStandardsFromStorage());

  useEffect(() => {
    saveCustomStandardsToStorage(customStandards);
  }, [customStandards]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setApiErrorDetail(null);
        let status: Awaited<ReturnType<typeof fetchAuthStatus>>;
        for (let attempt = 0; attempt < 8; attempt++) {
          if (cancelled) return;
          try {
            status = await fetchAuthStatus();
            break;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (attempt === 7) {
              setApiErrorDetail(msg);
              throw e;
            }
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          }
        }
        if (cancelled) return;
        setNeedsBootstrap(status.needsBootstrap);
        if (status.needsBootstrap && getAuthToken()) {
          setAuthToken(null);
        }
        const token = getAuthToken();
        if (token && !status.needsBootstrap) {
          try {
            const me = await fetchMe();
            if (!cancelled) setUser(me.user);
          } catch {
            setAuthToken(null);
          }
        }
      } catch {
        if (!cancelled) setApiDown(true);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      clearServerAiModelSnapshot();
      setSettingsForPerm(null);
      setAssessments([]);
      setAssessmentsHydrated(false);
      lastSavedAssessmentsSig.current = null;
      return;
    }
    let cancelled = false;
    fetchSettings()
      .then((s) => {
        if (!cancelled) setSettingsForPerm(s as Record<string, unknown>);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  /** 差距分析 / 深度评估使用的模型配置：与 GET /api/settings 返回的 model 同步（服务端优先）。 */
  useEffect(() => {
    if (!user) return;
    const m = settingsForPerm?.model;
    if (m && typeof m === 'object') applyServerAiModelSnapshot(m);
    else clearServerAiModelSnapshot();
  }, [user, settingsForPerm?.model]);

  useEffect(() => {
    const val = settingsForPerm && typeof settingsForPerm.locale === 'string' ? settingsForPerm.locale : 'zh-CN';
    setLocaleState(val === 'en-US' ? 'en-US' : 'zh-CN');
  }, [settingsForPerm]);

  useEffect(() => {
    const onLocale = (e: Event) => {
      const next = (e as CustomEvent<LocaleId>).detail;
      if (next === 'en-US' || next === 'zh-CN') setLocaleState(next);
    };
    window.addEventListener('app-locale-change', onLocale as EventListener);
    return () => window.removeEventListener('app-locale-change', onLocale as EventListener);
  }, []);

  const t = useCallback((key: keyof (typeof I18N)['zh-CN']) => I18N[locale][key] || key, [locale]);

  const effectivePermissions = useMemo(() => {
    if (!user) return null;
    const matrix = mergePermissionMatrix(settingsForPerm?.permissions);
    return getRolePermissions(matrix, user.role as Role);
  }, [user, settingsForPerm]);
  const canAssess = !!effectivePermissions?.runAssessments;

  useEffect(() => {
    if (!user?.id || !canAssess) return;
    const ac = new AbortController();
    let cancelled = false;
    setAssessmentsHydrated(false);
    fetchAssessments({ signal: ac.signal })
      .then(({ assessments: list }) => {
        if (cancelled) return;
        const normalized = Array.isArray(list)
          ? list.map((a) => ({ ...a, customerName: a.customerName ?? '', projectName: a.projectName ?? '' }))
          : [];
        setAssessments(normalized);
        lastSavedAssessmentsSig.current = JSON.stringify(normalized);
        // Only after a successful read do we enable autosave — otherwise a failed fetch + empty state would PUT [] and wipe server data.
        setAssessmentsHydrated(true);
      })
      .catch((e) => {
        if (cancelled || (e instanceof Error && e.name === 'AbortError')) return;
        console.error('Failed to load assessments from server:', e);
        // Do not clear assessments or set hydrated — avoids overwriting the server with an empty array after a transient error.
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [user?.id, canAssess]);

  useEffect(() => {
    if (!user || !canAssess || !assessmentsHydrated) return;
    const sig = JSON.stringify(assessments);
    if (sig === lastSavedAssessmentsSig.current) return;
    const timer = setTimeout(() => {
      void putAssessments(assessments)
        .then(() => {
          lastSavedAssessmentsSig.current = sig;
        })
        .catch((e) => {
          console.error('Failed to save assessments to server:', e);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [assessments, user, canAssess, assessmentsHydrated]);

  const visibleNav = useMemo(() => {
    if (!effectivePermissions) return ALL_NAV;
    return ALL_NAV.filter((item) => {
      if (item.id === 'dashboard') return true;
      if (item.id === 'assistant') return true;
      if (item.id === 'assessments') return effectivePermissions.runAssessments;
      if (item.id === 'standards') return effectivePermissions.editStandards;
      if (item.id === 'settings') {
        return (
          effectivePermissions.manageUsers ||
          effectivePermissions.configureAiModel ||
          effectivePermissions.syncStandardsApi ||
          effectivePermissions.viewAuditLog ||
          effectivePermissions.viewAppAbout
        );
      }
      return true;
    });
  }, [effectivePermissions]);

  useEffect(() => {
    if (!effectivePermissions) return;
    const allowed = new Set(visibleNav.map((i) => i.id));
    if (!allowed.has(activeTab)) setActiveTab('dashboard');
  }, [effectivePermissions, visibleNav, activeTab]);

  const handleSessionExpired = useCallback(() => {
    authLogout();
    setUser(null);
    setSettingsForPerm(null);
  }, []);

  const handleLoggedIn = useCallback(async () => {
    const me = await fetchMe();
    setUser(me.user);
  }, []);

  const handleLogout = useCallback(() => {
    authLogout();
    setUser(null);
    setSettingsForPerm(null);
    setSelectedAssessmentId(null);
    setActiveTab('dashboard');
  }, []);

  const runDeepEvaluation = useCallback(async () => {
    const tx = (zh: string, en: string) => (locale === 'en-US' ? en : zh);
    if (!canAssess || deepEvaluating) return;
    const candidates = assessments
      .filter((a) => a.status === 'Completed' && (a.evidenceText || '').trim())
      .flatMap((a) =>
        a.findings
          .filter(
            (f) =>
              (f.status === 'Partial' || f.status === 'Non-Compliant') &&
              (f.attentionState || 'pending') !== 'resolved'
          )
          .map((f) => ({ assessmentId: a.id, standardId: a.standardId, finding: f, evidence: a.evidenceText || '' }))
      );
    if (candidates.length === 0) {
      setDeepEvalNotice(
        tx(
          '当前没有可深度评估的待关注项（部分合规/不合规）。',
          'No attention items are available for deep evaluation.'
        )
      );
      return;
    }
    setDeepEvaluating(true);
    setDeepEvalNotice(
      tx(
        `已开始深度评估，共 ${candidates.length} 条待关注项。`,
        `Deep evaluation started for ${candidates.length} attention items.`
      )
    );
    const taskId = `deep-${Date.now()}`;
    setDeepEvalTasks((prev) => [
      {
        id: taskId,
        status: 'running',
        startedAt: new Date().toISOString(),
        total: candidates.length,
        done: 0,
        updatedFindings: 0,
        affectedAssessmentIds: [],
        itemRuns: [],
      },
      ...prev,
    ]);
    let done = 0;
    let updatedCount = 0;
    let failedCount = 0;
    const updates = new Map<string, Assessment['findings']>();
    const affectedAssessmentIds = new Set<string>();
    const itemRuns: DeepEvalTaskRecord['itemRuns'] = [];
    try {
      const rawConcurrency = Number(
        (() => {
          try {
            const raw = localStorage.getItem('ai_guardian_settings_model_v1');
            if (!raw) return 3;
            const parsed = JSON.parse(raw) as { evalConcurrency?: number };
            return parsed.evalConcurrency;
          } catch {
            return 3;
          }
        })()
      );
      const BATCH_SIZE = [2, 3, 5].includes(rawConcurrency) ? rawConcurrency : 3;
      const perItemTimeoutMs = Number(
        (() => {
          try {
            const raw = localStorage.getItem('ai_guardian_settings_model_v1');
            if (!raw) return 90000;
            const parsed = JSON.parse(raw) as { timeoutSec?: number };
            const sec = Number(parsed.timeoutSec || 90);
            return Math.min(300000, Math.max(15000, sec * 1000));
          } catch {
            return 90000;
          }
        })()
      );
      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (item) => {
            const started = Date.now();
            const control = (controls[item.standardId] || []).find((c) => c.id === item.finding.controlId);
            if (!control) {
              return { ok: false as const, item, durationMs: Date.now() - started, error: 'control_not_found' };
            }
            try {
              const next = (await Promise.race([
                performGapAnalysis(control, item.evidence, { preferCloud: true, deepEval: true }),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error(`单项深度评估超时（>${perItemTimeoutMs}ms）`)), perItemTimeoutMs)
                ),
              ])) as GapAnalysisResult;
              return { ok: true as const, item, next, durationMs: Date.now() - started };
            } catch (e) {
              return {
                ok: false as const,
                item,
                durationMs: Date.now() - started,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          })
        );
        for (const result of results) {
          done += 1;
          affectedAssessmentIds.add(result.item.assessmentId);
          if (!result.ok) {
            failedCount += 1;
            itemRuns.push({
              assessmentId: result.item.assessmentId,
              controlId: result.item.finding.controlId,
              status: 'failed',
              durationMs: result.durationMs,
              error: result.error,
            });
            continue;
          }
          const { item, next } = result;
          const nextAny = next as GapAnalysisResult;
          const current = updates.get(item.assessmentId) ?? (assessments.find((a) => a.id === item.assessmentId)?.findings || []);
          updates.set(
            item.assessmentId,
            current.map((f) => {
              if (f.controlId !== item.finding.controlId) return f;
              const evidenceNext = String(nextAny.evidenceExcerpt || f.evidence).slice(0, 15_000);
              return {
                ...f,
                status: (nextAny.status as Assessment['findings'][number]['status']) || f.status,
                attentionState:
                  nextAny.status === 'Compliant' || nextAny.status === 'Not Applicable'
                    ? 'resolved'
                    : f.attentionState || 'pending',
                analysis: String(nextAny.analysis || '') || f.analysis,
                recommendation: String(nextAny.recommendation || '') || f.recommendation,
                evidence: evidenceNext,
              };
            })
          );
          updatedCount += 1;
          itemRuns.push({
            assessmentId: item.assessmentId,
            controlId: item.finding.controlId,
            status: 'updated',
            durationMs: result.durationMs,
            analysis: String(nextAny.analysis || ''),
            recommendation: String(nextAny.recommendation || ''),
            ownerTeam: String(nextAny.ownerTeam || ''),
            targetDate: String(nextAny.targetDate || ''),
          });
        }
        setDeepEvalNotice(tx(`深度评估进行中：${done}/${candidates.length}`, `Deep evaluation in progress: ${done}/${candidates.length}`));
        setDeepEvalTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  done,
                  updatedFindings: updatedCount,
                  affectedAssessmentIds: Array.from(affectedAssessmentIds),
                  itemRuns: itemRuns.slice(-300),
                }
              : t
          )
        );
      }
      setAssessments((prev) =>
        prev.map((a) => {
          const findings = updates.get(a.id);
          if (!findings) return a;
          return { ...a, findings, updatedAt: new Date().toISOString() };
        })
      );
      setDeepEvalNotice(
        tx(
          `深度评估完成：已处理 ${done} 条，成功 ${updatedCount} 条，失败 ${failedCount} 条。`,
          `Deep evaluation completed: processed ${done}, succeeded ${updatedCount}, failed ${failedCount}.`
        )
      );
      setDeepEvalTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: updatedCount > 0 ? 'completed' : 'failed',
                done,
                updatedFindings: updatedCount,
                finishedAt: new Date().toISOString(),
                affectedAssessmentIds: Array.from(affectedAssessmentIds),
                itemRuns: itemRuns.slice(-300),
                reportSummary: tx(
                  `本次共处理 ${candidates.length} 条待关注项，成功更新 ${updatedCount} 条，失败 ${failedCount} 条，影响任务 ${affectedAssessmentIds.size} 个。`,
                  `Processed ${candidates.length} attention items, updated ${updatedCount}, failed ${failedCount}, affected ${affectedAssessmentIds.size} tasks.`
                ),
                error: failedCount > 0 ? tx(`失败 ${failedCount} 条`, `Failed ${failedCount} items`) : undefined,
              }
            : t
        )
      );
    } catch (e) {
      setDeepEvalNotice(
        tx(
          `深度评估中断：${e instanceof Error ? e.message : String(e)}`,
          `Deep evaluation interrupted: ${e instanceof Error ? e.message : String(e)}`
        )
      );
      setDeepEvalTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'failed',
                done,
                updatedFindings: done,
                finishedAt: new Date().toISOString(),
                affectedAssessmentIds: Array.from(affectedAssessmentIds),
                error: e instanceof Error ? e.message : String(e),
              }
            : t
        )
      );
    } finally {
      setDeepEvaluating(false);
    }
  }, [assessments, canAssess, controls, deepEvaluating, locale]);

  const updateFindingAttentionState = useCallback(
    (assessmentId: string, controlId: string, nextState: 'pending' | 'processing' | 'resolved') => {
      setAssessments((prev) =>
        prev.map((a) =>
          a.id !== assessmentId
            ? a
            : {
                ...a,
                findings: a.findings.map((f) =>
                  f.controlId === controlId ? { ...f, attentionState: nextState } : f
                ),
                updatedAt: new Date().toISOString(),
              }
        )
      );
    },
    []
  );

  const refreshSettingsForPerm = useCallback(() => {
    fetchSettings()
      .then((s) => setSettingsForPerm(s as Record<string, unknown>))
      .catch(() => {});
  }, []);

  const mergedAppStandards = useMemo(
    () => [...STANDARDS_CATALOG.map(catalogEntryToAppStandard), ...customStandards.map(catalogEntryToAppStandard)],
    [customStandards]
  );

  const standardNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of mergedAppStandards) {
      m[s.id] = s.name || s.id;
    }
    return m;
  }, [mergedAppStandards]);

  const catalogEntriesMerged = useMemo(() => [...STANDARDS_CATALOG, ...customStandards], [customStandards]);
  const baseInfo = useMemo(() => {
    const raw = settingsForPerm && typeof settingsForPerm.baseInfo === 'object' ? (settingsForPerm.baseInfo as Record<string, unknown>) : {};
    return {
      companies: Array.isArray(raw.companies) ? (raw.companies as Array<{ id: string; name: string; description: string }>) : [],
      projects: Array.isArray(raw.projects) ? (raw.projects as Array<{ id: string; companyId: string; name: string; description: string }>) : [],
    };
  }, [settingsForPerm]);
  const companyNameById = useMemo(
    () => Object.fromEntries(baseInfo.companies.map((c) => [c.id, c.name || c.id])),
    [baseInfo.companies]
  );
  const projectNameById = useMemo(
    () => Object.fromEntries(baseInfo.projects.map((p) => [p.id, p.name || p.id])),
    [baseInfo.projects]
  );
  const visibleCompaniesForFilter = useMemo(
    () =>
      baseInfo.companies.filter(
        (c) => !user?.visibleCompanyIds || user.visibleCompanyIds.length === 0 || user.visibleCompanyIds.includes(c.id)
      ),
    [baseInfo.companies, user?.visibleCompanyIds]
  );
  const visibleProjectsForFilter = useMemo(
    () =>
      baseInfo.projects.filter((p) => {
        const allowedByUser = !user?.visibleProjectIds || user.visibleProjectIds.length === 0 || user.visibleProjectIds.includes(p.id);
        const allowedByCompany = assessmentCompanyFilter === 'all' || p.companyId === assessmentCompanyFilter;
        return allowedByUser && allowedByCompany;
      }),
    [baseInfo.projects, user?.visibleProjectIds, assessmentCompanyFilter]
  );
  /** 任务 id 列表变化时强制仪表盘重挂，避免图表库缓存导致删除后 UI 仍显示旧聚合 */
  const dashboardDataVersion = useMemo(() => assessments.map((a) => a.id).join('|'), [assessments]);

  /** 删除任务后，深度评估历史里去掉已不存在任务的引用（仅当任务 id 集合变化时运行） */
  useEffect(() => {
    const ids = new Set(dashboardDataVersion ? dashboardDataVersion.split('|') : []);
    setDeepEvalTasks((prev) =>
      prev.map((t) => ({
        ...t,
        affectedAssessmentIds: (t.affectedAssessmentIds || []).filter((id) => ids.has(id)),
        itemRuns: (t.itemRuns || []).filter((r) => ids.has(r.assessmentId)),
      }))
    );
  }, [dashboardDataVersion]);

  const filteredAssessments = useMemo(
    () =>
      assessments.filter((a) => {
        const companyOk = assessmentCompanyFilter === 'all' || a.companyId === assessmentCompanyFilter;
        const projectOk = assessmentProjectFilter === 'all' || a.projectId === assessmentProjectFilter;
        const creatorOk = assessmentCreatorFilter === 'all' || (a.createdBy || '') === assessmentCreatorFilter;
        return companyOk && projectOk && creatorOk;
      }),
    [assessments, assessmentCompanyFilter, assessmentProjectFilter, assessmentCreatorFilter]
  );
  const creatorOptions = useMemo(() => {
    const set = new Set<string>();
    assessments.forEach((a) => {
      if (a.createdBy) set.add(a.createdBy);
    });
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [assessments]);

  const handleAddCustomStandard = useCallback((entry: StandardCatalogEntry) => {
    setCustomStandards((prev) => [...prev, entry]);
    setControls((prev) => ({ ...prev, [entry.id]: [] }));
  }, []);

  if (authLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-8 p-8">
        <AppLogo className="h-14 w-auto max-w-[min(90vw,280px)]" />
        <div className="flex items-center gap-3 text-text-main/60 font-semibold">
          <Loader2 className="animate-spin" size={24} />
          {t('init')}
        </div>
      </div>
    );
  }

  if (apiDown && !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center gap-4 max-w-lg mx-auto">
        <AppLogo className="h-12 w-auto max-w-[min(90vw,260px)] mx-auto" />
        <AlertCircle className="text-danger-main" size={48} />
        <h1 className="text-xl font-black">无法连接后端 API</h1>
        <p className="text-text-main/60 text-sm leading-relaxed">
          请在本机用 <strong>PowerShell</strong> 进入项目目录后执行 <code className="font-mono text-xs bg-black/5 px-1 rounded">.\run-dev.ps1</code>
          （无需 npm）。浏览器请打开 <strong>终端里显示的 Local 地址</strong>（可能是 3001、3002…），不要用「直接打开磁盘上的 html」。
        </p>
        {apiErrorDetail && (
          <div className="glass-card p-4 text-left text-xs text-danger-main/90 font-mono whitespace-pre-wrap break-words w-full">
            {apiErrorDetail}
          </div>
        )}
        <p className="text-text-main/45 text-xs">
          若 8787 被占用：结束旧终端里的 node，或执行 <code className="font-mono">.\run-dev-api-only.ps1</code> 前先释放端口。
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative">
        {apiDown && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 glass-card px-6 py-3 text-sm text-warning-main font-semibold">
            后端可能不可用，登录可能失败
          </div>
        )}
        <LoginPage needsBootstrap={needsBootstrap} onLoggedIn={handleLoggedIn} />
      </div>
    );
  }

  if (!effectivePermissions) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-8 p-8">
        <AppLogo className="h-14 w-auto max-w-[min(90vw,280px)]" />
          <div className="flex items-center gap-3 text-text-main/60 font-semibold">
          <Loader2 className="animate-spin" size={24} />
            {t('loadPerm')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen text-text-main font-sans overflow-hidden bg-transparent">
      <aside className="w-20 glass-sidebar flex flex-col items-center py-10 gap-8 z-30">
        <div className="w-12 h-12 bg-accent rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-400/30 mb-4">
          <Shield size={28} />
        </div>

        <nav className="flex flex-col gap-6 w-full items-center">
          {visibleNav.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.tooltip}
              aria-label={item.tooltip}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                'w-12 h-12 flex items-center justify-center rounded-xl text-sm font-bold transition-all duration-300 relative group',
                activeTab === item.id
                  ? 'bg-accent text-white shadow-lg shadow-blue-400/30'
                  : 'bg-white/50 text-accent hover:bg-white hover:shadow-md'
              )}
            >
              <item.icon size={22} className="transition-transform group-hover:scale-110" />

              <div className="absolute left-full ml-4 px-2 py-1 bg-text-main text-white text-[10px] rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                {item.id === 'dashboard'
                  ? t('dashboard')
                  : item.id === 'assistant'
                    ? t('assistant')
                    : item.id === 'assessments'
                      ? t('assessments')
                      : item.id === 'standards'
                        ? t('standards')
                        : t('settings')}
              </div>
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-transparent">
        <header className="relative z-20 shrink-0 min-h-[7.5rem] md:min-h-[8.5rem] py-3 translate-z-0 glass-header grid grid-cols-[1fr_auto_1fr] items-center px-10 gap-4 overflow-x-hidden overflow-y-visible">
          <div className="flex items-start gap-3 min-w-0 justify-self-start">
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-3">
                {selectedAssessmentId && (
                  <button
                    type="button"
                    onClick={() => setSelectedAssessmentId(null)}
                    className="p-1 hover:bg-white/50 rounded-md transition-colors mr-2 shrink-0"
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
                <h1 className="text-2xl font-bold tracking-tight">
                  {selectedAssessmentId
                    ? '安全合规评估流水线'
                    : (activeTab === 'dashboard'
                        ? t('dashboard')
                        : activeTab === 'assistant'
                          ? t('assistant')
                          : activeTab === 'assessments'
                            ? t('assessments')
                            : activeTab === 'standards'
                              ? t('standards')
                              : t('settings'))}
                </h1>
              </div>
              {selectedAssessmentId && activeTab !== 'assessments' && canAssess && (
                <span className="text-xs font-semibold text-accent/90 mt-1">当前有评估任务在后台运行，切换到「评估任务」可查看进度</span>
              )}
              {!selectedAssessmentId && (
                <span className="text-xs font-semibold opacity-60 uppercase tracking-widest mt-1">AI Security Compliance Auditor</span>
              )}
            </div>
          </div>

          <div className="pointer-events-none relative z-[25] flex h-[5.5rem] items-center justify-center justify-self-center px-2 overflow-visible">
            <AppLogo className="h-20 md:h-[5.5rem] w-auto max-w-[360px] origin-center scale-[3] object-contain object-center" />
          </div>

          <div className="flex items-center gap-4 justify-self-end">
            <span className="text-sm font-bold text-text-main/70 hidden sm:inline max-w-[120px] truncate" title={user.username}>
              {user.username}
            </span>
            <button
              type="button"
              onClick={async () => {
                const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN';
                setLocaleState(next);
                setLocale(next);
                try {
                  await putSettings({ locale: next });
                } catch {
                  // still reload to make UI locale consistent
                } finally {
                  window.location.reload();
                }
              }}
              className="glass-card flex items-center gap-2 px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-white/60"
            >
              {locale === 'zh-CN' ? 'EN' : '中文'}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="glass-card flex items-center gap-2 px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-white/60"
            >
              <LogOut size={16} />
              {t('logout')}
            </button>
            <div className="w-10 h-10 rounded-full bg-accent border-2 border-white shadow-md flex items-center justify-center text-white font-bold">
              {user.username.slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>

        <main className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="p-10 max-w-[1400px] mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div
                key={`dashboard-${dashboardDataVersion}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <Dashboard
                  assessments={assessments}
                  deepEvalTasks={deepEvalTasks}
                  customStandardsCatalog={customStandards}
                  onUpdateAttentionState={updateFindingAttentionState}
                  onSelectAssessment={
                    canAssess
                      ? (id) => {
                          setActiveTab('assessments');
                          setSelectedAssessmentId(id);
                        }
                      : () => {}
                  }
                  onDeepEvaluate={() => void runDeepEvaluation()}
                  deepEvaluating={deepEvaluating}
                  deepEvalNotice={deepEvalNotice}
                />
              </motion.div>
            )}

            {activeTab === 'assistant' && (
              <motion.div key="assistant" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                <Suspense fallback={<TabLoading />}>
                  <AiAssistant sessionKey={user.id} />
                </Suspense>
              </motion.div>
            )}

            {activeTab === 'assessments' && !selectedAssessmentId && (
              <motion.div
                key="assessments-list"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <div className="flex justify-between items-end mb-10">
                  <div>
                    <h2 className="text-3xl font-black mb-2">评估任务</h2>
                    <p className="text-text-main/60 font-medium text-base">利用核心 AI 引擎驱动的实时差距分析平台</p>
                  </div>
                  <button
                    type="button"
                    disabled={!canAssess}
                    onClick={() => canAssess && setNewAssessmentOpen(true)}
                    className={cn('glass-button flex items-center gap-2 px-5 py-2.5 text-sm', !canAssess && 'opacity-40 cursor-not-allowed')}
                  >
                    <Plus size={18} />
                    新建分析引擎
                  </button>
                </div>
                <div className="mb-6 flex flex-wrap items-center gap-3">
                  <select
                    className="glass-input px-4 py-2 text-sm font-semibold"
                    value={assessmentCompanyFilter}
                    onChange={(e) => {
                      const next = e.target.value;
                      setAssessmentCompanyFilter(next);
                      setAssessmentProjectFilter('all');
                    }}
                  >
                    <option value="all">全部公司</option>
                    {visibleCompaniesForFilter.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.id}
                      </option>
                    ))}
                  </select>
                  <select
                    className="glass-input px-4 py-2 text-sm font-semibold"
                    value={assessmentProjectFilter}
                    onChange={(e) => setAssessmentProjectFilter(e.target.value)}
                  >
                    <option value="all">全部项目</option>
                    {visibleProjectsForFilter.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                  <select
                    className="glass-input px-4 py-2 text-sm font-semibold"
                    value={assessmentCreatorFilter}
                    onChange={(e) => setAssessmentCreatorFilter(e.target.value)}
                  >
                    <option value="all">全部创建人</option>
                    {creatorOptions.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>

                <NewAssessmentModal
                  open={newAssessmentOpen}
                  onClose={() => setNewAssessmentOpen(false)}
                  standards={mergedAppStandards}
                  companies={baseInfo.companies}
                  projects={baseInfo.projects}
                  visibleCompanyIds={user?.visibleCompanyIds || []}
                  visibleProjectIds={user?.visibleProjectIds || []}
                  onConfirm={({ standardId, customerName, projectName, companyId, projectId }) => {
                    const std = mergedAppStandards.find((s) => s.id === standardId);
                    const newId = `eval-${Date.now()}`;
                    setAssessments((prev) => [
                      ...prev,
                      (() => {
                        const sameScope = prev.filter((a) => a.companyId === companyId && a.projectId === projectId);
                        const maxSeq = sameScope.reduce((acc, a) => {
                          const fromField = Number(a.sequenceNo || 0);
                          const fromName = (() => {
                            const m = String(a.name || '').match(/(?:^|\s·\s)(\d{2})$/);
                            return m ? Number(m[1]) : 0;
                          })();
                          return Math.max(acc, fromField, fromName);
                        }, 0);
                        const sequenceNo = maxSeq + 1;
                        const seqLabel = String(sequenceNo).padStart(2, '0');
                        const name = `${buildAssessmentDisplayName(std?.name || standardId, customerName, projectName)} · ${seqLabel}`;
                        return {
                          id: newId,
                          name,
                          sequenceNo,
                          standardId,
                          customerName,
                          projectName,
                          companyId,
                          projectId,
                          createdBy: user.username,
                          status: 'Draft',
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                          findings: [],
                        };
                      })(),
                    ]);
                    setNewAssessmentOpen(false);
                    setSelectedAssessmentId(newId);
                  }}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {filteredAssessments.length === 0 ? (
                    <div className="col-span-full py-20 glass-card border-dashed flex flex-col items-center justify-center text-text-main/40">
                      <FileText size={48} strokeWidth={1} className="mb-4 opacity-30" />
                      <p className="font-bold tracking-tight text-lg">{assessments.length === 0 ? '暂无评估任务，点击上方按钮新建' : '当前筛选条件下暂无任务'}</p>
                    </div>
                  ) : (
                    filteredAssessments.map((item) => {
                      const cardStats = item.status === 'Completed' ? completedTaskFindingStats(item.findings) : null;
                      const companyLabel = item.companyId ? companyNameById[item.companyId] || item.customerName || item.companyId : item.customerName || '—';
                      const projectLabel = item.projectId ? projectNameById[item.projectId] || item.projectName || item.projectId : item.projectName || '—';
                      return (
                      <div
                        key={item.id}
                        role={canAssess ? 'button' : undefined}
                        onClick={() => canAssess && setSelectedAssessmentId(item.id)}
                        className={cn(
                          'glass-card p-6 group transition-all duration-300 relative',
                          canAssess ? 'cursor-pointer hover:-translate-y-1 active:scale-95' : 'opacity-60 cursor-not-allowed'
                        )}
                      >
                        {canAssess && (
                          <button
                            type="button"
                            title="删除任务"
                            className="absolute top-4 right-4 z-10 p-2 rounded-lg text-text-main/35 hover:text-danger-main hover:bg-danger-main/10 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                !window.confirm(
                                  '确定删除该评估任务？本任务下的分析结果与本地记录将被移除（浏览器下载的导出文件需自行删除）。'
                                )
                              ) {
                                return;
                              }
                              setAssessments((prev) => {
                                const next = prev.filter((a) => a.id !== item.id);
                                if (assessmentsHydrated && getAuthToken()) {
                                  queueMicrotask(() => {
                                    void putAssessments(next)
                                      .then(() => {
                                        lastSavedAssessmentsSig.current = JSON.stringify(next);
                                      })
                                      .catch((err) => {
                                        console.error('Failed to persist assessment delete:', err);
                                      });
                                  });
                                }
                                return next;
                              });
                              setSelectedAssessmentId((cur) => (cur === item.id ? null : cur));
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        <div className="flex justify-between items-start mb-4 pr-10">
                          <div
                            className={cn(
                              'px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest',
                              item.status === 'Completed'
                                ? 'bg-success-main/20 text-success-main'
                                : item.status === 'In Progress'
                                  ? 'bg-accent/20 text-accent'
                                  : 'bg-warning-main/20 text-warning-main'
                            )}
                          >
                            {item.status === 'Completed' ? 'Completed' : item.status === 'In Progress' ? 'Analyzing' : 'Ready'}
                          </div>
                          <ChevronRight className="text-text-main/20 group-hover:text-accent transition-colors shrink-0" size={20} />
                        </div>
                        <h3 className="font-bold text-[1.3rem] leading-snug mb-1.5 group-hover:text-accent transition-colors">{item.name}</h3>
                        <p className="text-xs font-semibold text-text-main/50 mb-4 uppercase tracking-wider">
                          {standardNameById[item.standardId || ''] || item.standardId}
                        </p>
                        <div className="mb-4 flex flex-wrap gap-2">
                          <span className="rounded-full border border-black/10 bg-white/70 px-2.5 py-1 text-[10px] font-bold text-text-main/70">
                            公司：{companyLabel}
                          </span>
                          <span className="rounded-full border border-black/10 bg-white/70 px-2.5 py-1 text-[10px] font-bold text-text-main/70">
                            项目：{projectLabel}
                          </span>
                        </div>
                        {item.status === 'Completed' && cardStats && (
                          <div className="grid grid-cols-2 gap-1.5 mb-3.5">
                            <div className="rounded-lg bg-accent/10 border border-accent/20 px-2 py-1.5 text-center">
                              <p className="text-[8px] font-black uppercase tracking-wider text-text-main/45 mb-px">合规率</p>
                              <p className="text-base font-black text-accent tabular-nums leading-tight">
                                {cardStats.ratePct !== null ? `${cardStats.ratePct}%` : '—'}
                              </p>
                            </div>
                            <div className="rounded-lg bg-success-main/10 border border-success-main/20 px-2 py-1.5 text-center">
                              <p className="text-[8px] font-black uppercase tracking-wider text-text-main/45 mb-px">符合</p>
                              <p className="text-base font-black text-success-main tabular-nums leading-tight">{cardStats.compliant}</p>
                            </div>
                            <div className="rounded-lg bg-warning-main/10 border border-warning-main/20 px-2 py-1.5 text-center">
                              <p className="text-[8px] font-black uppercase tracking-wider text-text-main/45 mb-px">部分符合</p>
                              <p className="text-base font-black text-warning-main tabular-nums leading-tight">{cardStats.partial}</p>
                            </div>
                            <div className="rounded-lg bg-danger-main/10 border border-danger-main/20 px-2 py-1.5 text-center">
                              <p className="text-[8px] font-black uppercase tracking-wider text-text-main/45 mb-px">不符合</p>
                              <p className="text-base font-black text-danger-main tabular-nums leading-tight">{cardStats.nonCompliant}</p>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-3 text-xs font-bold text-text-main/40 pt-4 border-t border-white/30">
                          <div className="flex items-center gap-1 uppercase">
                            <Clock size={14} />
                            {new Date(item.createdAt).toLocaleDateString()}
                          </div>
                          <div className="flex items-center gap-1 uppercase">
                            <CheckCircle2 size={14} />
                            {item.status === 'Completed' && cardStats
                              ? `${cardStats.total} 条检查项`
                              : `${item.findings.length} Gaps`}
                          </div>
                          <div className="flex items-center gap-1">
                            <User size={14} />
                            {item.createdBy || '—'}
                          </div>
                        </div>
                      </div>
                    );
                    })
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'standards' && (
              <motion.div key="standards" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Suspense fallback={<TabLoading />}>
                  <StandardsConfig
                    controls={controls}
                    onUpdateControls={setControls}
                    catalogEntries={catalogEntriesMerged}
                    onAddCustomStandard={handleAddCustomStandard}
                    canSyncStandardsApi={effectivePermissions.syncStandardsApi}
                  />
                </Suspense>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Suspense fallback={<TabLoading />}>
                  <SystemSettings
                    currentUserId={user.id}
                    role={user.role as Role}
                    effectivePermissions={effectivePermissions}
                    onSessionExpired={handleSessionExpired}
                    onSettingsSaved={refreshSettingsForPerm}
                    onUsersChanged={async () => {
                      const me = await fetchMe();
                      setUser(me.user);
                      refreshSettingsForPerm();
                    }}
                  />
                </Suspense>
              </motion.div>
            )}
          </AnimatePresence>

          {selectedAssessmentId && canAssess && (
            <div className={cn(activeTab !== 'assessments' && 'hidden')} aria-hidden={activeTab !== 'assessments'}>
              <motion.div
                key={selectedAssessmentId}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                className="glass-card p-10"
              >
                <Suspense fallback={<TabLoading />}>
                  <AssessmentFlow
                    assessment={assessments.find((a) => a.id === selectedAssessmentId)!}
                    standards={mergedAppStandards}
                    controls={controls}
                    canViewAssessmentResults={effectivePermissions.viewAssessmentResults}
                    onUpdate={(assessmentId, next) => {
                      setAssessments((prev) =>
                        prev.map((a) => {
                          if (a.id !== assessmentId) return a;
                          return typeof next === 'function' ? next(a) : next;
                        })
                      );
                    }}
                  />
                </Suspense>
              </motion.div>
            </div>
          )}
        </div>
        </main>
      </div>
    </div>
  );
}
