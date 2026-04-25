import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Shield,
  Plus,
  MoreVertical,
  ExternalLink,
  ChevronRight,
  ArrowLeft,
  Edit2,
  Trash2,
  X,
  Check,
  AlertCircle,
  Download,
  Upload,
  RefreshCcw,
  Loader2,
  Sparkles,
  BookMarked,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Control } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { EXPORT_SERVICE } from '../services/export';
import { type StandardCatalogEntry } from '../constants/standardsCatalog';
import {
  parseControlsFromEnterpriseExcel,
  parseControlsFromJsonString,
  parseControlsFromMarkdown,
} from '../utils/importStandardControls';
import {
  apiHealth,
  fetchLegalRegulationsCache,
  fetchSettings,
  postLegalRegulationsFetch,
  postLegalRegulationsDeleteItem,
  postLegalRegulationsRegenerateSummary,
  putLegalRegulationsReview,
  putSettings,
  type LegalRegulationsCachePayload,
} from '../services/settingsApi';
import type { ApiSyncSettings, Role } from '../permissions';
import { getLocale, type LocaleId } from '../i18n';
import {
  displayLegalLastSyncAtLine,
  displayLegalSyncVersionLabel,
  displayStandardsLastSyncAt,
  isDefaultLegalSearchKeyword,
} from '../i18nSyncDisplay';

const STORAGE_SYNC_KEY = 'ai_guardian_settings_sync_v1';

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

function loadSyncFromLocal(): ApiSyncSettings {
  try {
    const raw = localStorage.getItem(STORAGE_SYNC_KEY);
    if (!raw) return DEFAULT_SYNC_SETTINGS;
    return { ...DEFAULT_SYNC_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SYNC_SETTINGS;
  }
}

interface StandardsConfigProps {
  controls: Record<string, Control[]>;
  onUpdateControls: (controls: Record<string, Control[]>) => void;
  /** 内置标准 + 自定义标准合并列表 */
  catalogEntries: StandardCatalogEntry[];
  onAddCustomStandard: (entry: StandardCatalogEntry) => void;
  onUpdateCustomStandard?: (entry: StandardCatalogEntry) => void;
  onDeleteCustomStandard?: (id: string) => void;
  onReorderCatalogEntries?: (entries: StandardCatalogEntry[]) => void;
  currentUserRole?: Role;
  /** 是否可配置第三方标准 API 同步（与系统设置一致） */
  canSyncStandardsApi?: boolean;
}

function mergeControlsById(existing: Control[], imported: Control[]): Control[] {
  const map = new Map(existing.map((c) => [c.id, c]));
  for (const c of imported) {
    map.set(c.id, c);
  }
  return Array.from(map.values());
}

export default function StandardsConfig({
  controls,
  onUpdateControls,
  catalogEntries,
  onAddCustomStandard,
  onUpdateCustomStandard,
  onDeleteCustomStandard,
  onReorderCatalogEntries,
  currentUserRole,
  canSyncStandardsApi = false,
}: StandardsConfigProps) {
  const [locale, setLocale] = useState<LocaleId>(() => getLocale());
  const T = {
    'zh-CN': {
      lawTitle: '基于AI定期自动更新的法律法规库',
      lawDesc:
        '安全AI 守望者核心引擎会自动同步最新的国家标准与行业合规指南（等保 2.0、关基保护条例、数安法等）。您可以将企业内部管理规定与全球标准条款进行一键高精度关联。',
      viewSync: '查看最新同步',
      addCustom: '新增自定义标准',
      importControls: '导入合规标准特定条款',
      editStandard: '编辑标准',
      deleteStandard: '删除标准',
      builtinReadonly: '内置标准不可编辑或删除',
      superAdminOnlyDelete: '仅超级管理员可删除',
      editStandardTitle: '编辑合规标准',
      standardNameRequired: '请填写标准名称',
      save: '保存',
      cancel: '取消',
      stdName: '标准名称',
      stdVersion: '版本 / 文号',
      stdDesc: '说明',
      deleteConfirm1: '确定删除该合规标准？',
      deleteConfirm2: '请再次确认：删除后无法恢复，且会移除该标准下的检查项。',
    },
    'en-US': {
      lawTitle: 'AI-Powered Continuous Legal Regulations Library',
      lawDesc:
        'The core AI engine continuously updates regulations and compliance references. You can align internal policies with external compliance clauses.',
      viewSync: 'View Latest Sync',
      addCustom: 'Add Custom Standard',
      importControls: 'Import Standard Controls',
      editStandard: 'Edit standard',
      deleteStandard: 'Delete standard',
      builtinReadonly: 'Built-in standards cannot be edited or deleted',
      superAdminOnlyDelete: 'Only SuperAdmin can delete',
      editStandardTitle: 'Edit compliance standard',
      standardNameRequired: 'Please enter a standard name',
      save: 'Save',
      cancel: 'Cancel',
      stdName: 'Standard name',
      stdVersion: 'Version / Code',
      stdDesc: 'Description',
      deleteConfirm1: 'Delete this compliance standard?',
      deleteConfirm2: 'Please confirm again: this cannot be undone and controls under this standard will be removed.',
    },
  } as const;
  const t = (k: keyof (typeof T)['zh-CN']) => T[locale][k] || T['zh-CN'][k];
  const tx = (zh: string, en: string) => (locale === 'en-US' ? en : zh);

  useEffect(() => {
    const onLocale = (e: Event) => {
      const next = (e as CustomEvent<LocaleId>).detail;
      if (next === 'en-US' || next === 'zh-CN') setLocale(next);
    };
    window.addEventListener('app-locale-change', onLocale as EventListener);
    return () => window.removeEventListener('app-locale-change', onLocale as EventListener);
  }, []);
  const [selectedStandardId, setSelectedStandardId] = useState<string | null>(null);
  const [cardMenuStandardId, setCardMenuStandardId] = useState<string | null>(null);
  const [draggingStandardId, setDraggingStandardId] = useState<string | null>(null);
  const [editStandardOpen, setEditStandardOpen] = useState(false);
  const [editingStandard, setEditingStandard] = useState<StandardCatalogEntry | null>(null);
  const [editingControl, setEditingControl] = useState<Control | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const [addCustomOpen, setAddCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customVersion, setCustomVersion] = useState('自定义');
  const [customDesc, setCustomDesc] = useState('');

  const [importOpen, setImportOpen] = useState(false);
  const [importStandardId, setImportStandardId] = useState(catalogEntries[0]?.id ?? '');
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (!catalogEntries.some((s) => s.id === importStandardId)) {
      setImportStandardId(catalogEntries[0]?.id ?? '');
    }
  }, [catalogEntries, importStandardId]);

  const [syncInfoOpen, setSyncInfoOpen] = useState(false);
  const [legalArchiveOpen, setLegalArchiveOpen] = useState(false);
  const [legalArchiveLoading, setLegalArchiveLoading] = useState(false);
  const [legalArchiveData, setLegalArchiveData] = useState<LegalRegulationsCachePayload | null>(null);
  const [legalArchiveView, setLegalArchiveView] = useState<'customer' | 'internal'>('customer');
  const [reviewDraftHeadline, setReviewDraftHeadline] = useState('');
  const [reviewDraftSummary, setReviewDraftSummary] = useState('');
  const [reviewDraftTakeaways, setReviewDraftTakeaways] = useState('');
  const [manualLawItems, setManualLawItems] = useState<Array<{
    title: string;
    docType: string;
    status: string;
    keyPoints: string;
    controlImpacts: string;
    sourceSnippet: string;
  }>>([]);
  const [manualDraft, setManualDraft] = useState({
    title: '',
    docType: '法律',
    status: '现行',
    keyPoints: '',
    controlImpacts: '',
    sourceSnippet: '',
  });
  const [manualEditIdx, setManualEditIdx] = useState<number | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewPreviewOpen, setReviewPreviewOpen] = useState(false);
  const [legalFetchLoading, setLegalFetchLoading] = useState(false);
  const [legalTestLoading, setLegalTestLoading] = useState(false);
  const [apiSyncSettings, setApiSyncSettings] = useState<ApiSyncSettings>(() => loadSyncFromLocal());
  const [backendReadyForSync, setBackendReadyForSync] = useState(false);
  const [syncStatusLoading, setSyncStatusLoading] = useState(false);
  const [syncPolicySaving, setSyncPolicySaving] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const persistSyncLocal = useCallback((next: ApiSyncSettings) => {
    try {
      localStorage.setItem(STORAGE_SYNC_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const refreshSyncFromBackend = useCallback(async () => {
    setSyncStatusLoading(true);
    setSyncError(null);
    try {
      await apiHealth();
      setBackendReadyForSync(true);
      const s = (await fetchSettings()) as Record<string, unknown>;
      if (s.sync && typeof s.sync === 'object') {
        setApiSyncSettings((prev) => {
          const merged = { ...prev, ...(s.sync as Partial<ApiSyncSettings>) };
          persistSyncLocal(merged);
          return merged;
        });
      }
    } catch {
      setBackendReadyForSync(false);
    } finally {
      setSyncStatusLoading(false);
    }
  }, [persistSyncLocal]);

  const loadLegalArchive = useCallback(async () => {
    setLegalArchiveLoading(true);
    setLegalArchiveData(null);
    try {
      const d = await fetchLegalRegulationsCache();
      setLegalArchiveData(d);
      const b = d.customerView?.briefing;
      setReviewDraftHeadline(String(b?.headline || ''));
      setReviewDraftSummary(String(b?.summary || ''));
      setReviewDraftTakeaways(Array.isArray(b?.takeaways) ? b?.takeaways.join('\n') : '');
      const mi = Array.isArray(d.customerView?.manualItems) ? d.customerView?.manualItems : [];
      setManualLawItems(
        (mi || []).map((x) => ({
          title: String(x.title || ''),
          docType: String(x.docType || '未知'),
          status: String(x.status || '未知'),
          keyPoints: Array.isArray(x.keyPoints) ? x.keyPoints.join('\n') : '',
          controlImpacts: Array.isArray(x.controlImpacts) ? x.controlImpacts.join('\n') : '',
          sourceSnippet: String(x.sourceSnippet || ''),
        }))
      );
    } catch (e) {
      setLegalArchiveData({
        empty: true,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLegalArchiveLoading(false);
    }
  }, []);

  const openLegalArchive = useCallback((view: 'customer' | 'internal' = 'customer') => {
    setLegalArchiveView(view);
    setLegalArchiveOpen(true);
    void loadLegalArchive();
  }, [loadLegalArchive]);

  const runLegalRegulationsFetchNow = async () => {
    setSyncError(null);
    setSyncNotice(null);
    if (!canSyncStandardsApi) {
      setSyncError('无「第三方标准 API 同步」权限，无法拉取法律法规 API。');
      return;
    }
    if (!backendReadyForSync) {
      setSyncError('请先连接后端后再拉取法律法规。');
      return;
    }
    setLegalFetchLoading(true);
    try {
      const r = await postLegalRegulationsFetch({
        keyword: apiSyncSettings.legalSearchKeyword,
        prompt: apiSyncSettings.legalSearchKeyword,
        searchApiKey: apiSyncSettings.legalSearchApiKey,
        searchClientId: apiSyncSettings.legalSearchClientId,
        postProcessEnabled: apiSyncSettings.legalPostProcessEnabled,
        postProcessModel: apiSyncSettings.legalPostProcessModel,
      });
      const count = typeof r.totalCount === 'number' ? r.totalCount : undefined;
      const added = typeof r.addedCount === 'number' ? r.addedCount : undefined;
      if (count === 0) {
        setSyncError('检索请求成功，但未命中任何结果（totalCount=0）。请调整 query 或确认知识库内容。');
        setSyncNotice(null);
      } else {
        const countText = typeof count === 'number' ? `，累计 ${count} 条` : '';
        const addedText = typeof added === 'number' ? `，本次新增 ${added} 条` : '';
        setSyncNotice(`法律法规已拉取并保存（HTTP ${r.statusCode ?? '—'}${countText}${addedText}）`);
      }
      await refreshSyncFromBackend();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setLegalFetchLoading(false);
    }
  };

  const testLegalRegulationsConnection = async () => {
    setSyncError(null);
    setSyncNotice(null);
    if (!canSyncStandardsApi) {
      setSyncError('无「第三方标准 API 同步」权限，无法测试法律法规 API。');
      return;
    }
    if (!backendReadyForSync) {
      setSyncError('请先连接后端后再测试连接。');
      return;
    }
    setLegalTestLoading(true);
    try {
      const r = await postLegalRegulationsFetch({
        keyword: apiSyncSettings.legalSearchKeyword,
        prompt: apiSyncSettings.legalSearchKeyword,
        searchApiKey: apiSyncSettings.legalSearchApiKey,
        searchClientId: apiSyncSettings.legalSearchClientId,
        postProcessEnabled: apiSyncSettings.legalPostProcessEnabled,
        postProcessModel: apiSyncSettings.legalPostProcessModel,
        testOnly: true,
      });
      const count = typeof r.totalCount === 'number' ? r.totalCount : undefined;
      const countText = typeof count === 'number' ? `，命中 ${count} 条` : '';
      setSyncNotice(`连接测试成功（HTTP ${r.statusCode ?? '—'}${countText}），未写入缓存`);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setLegalTestLoading(false);
    }
  };

  useEffect(() => {
    if (!syncInfoOpen) return;
    void refreshSyncFromBackend();
  }, [syncInfoOpen, refreshSyncFromBackend]);

  const saveSyncPolicy = async () => {
    setSyncError(null);
    setSyncNotice(null);
    if (!canSyncStandardsApi) {
      setSyncError('当前账号无保存同步策略的权限。');
      return;
    }
    setSyncPolicySaving(true);
    try {
      if (!backendReadyForSync) {
        persistSyncLocal(apiSyncSettings);
        setSyncNotice('已保存到浏览器本地（后端未连接时无法写入服务器）');
        return;
      }
      await putSettings({ sync: apiSyncSettings });
      persistSyncLocal(apiSyncSettings);
      setSyncNotice('同步策略已保存到服务器');
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        setSyncError('登录已过期，请重新登录后再试。');
      } else {
        setSyncError(e instanceof Error ? e.message : '保存失败');
      }
    } finally {
      setSyncPolicySaving(false);
    }
  };

  const activeStandard = catalogEntries.find((s) => s.id === selectedStandardId);
  const isSuperAdmin = currentUserRole === 'SuperAdmin';
  const activeControls = selectedStandardId ? (controls[selectedStandardId] || []) : [];

  const handleSaveControl = (control: Control) => {
    if (!selectedStandardId) return;
    
    const currentList = controls[selectedStandardId] || [];
    const exists = currentList.find(c => c.id === control.id);
    
    let newList;
    if (exists && !isAdding) {
      newList = currentList.map(c => c.id === control.id ? control : c);
    } else {
      newList = [...currentList, control];
    }
    
    onUpdateControls({
      ...controls,
      [selectedStandardId]: newList
    });
    setEditingControl(null);
    setIsAdding(false);
  };

  const handleDeleteControl = (id: string) => {
    if (!selectedStandardId) return;
    onUpdateControls({
      ...controls,
      [selectedStandardId]: (controls[selectedStandardId] || []).filter(c => c.id !== id)
    });
  };

  const submitAddCustom = () => {
    const name = customName.trim();
    if (name.length < 1) {
      window.alert('请填写标准名称');
      return;
    }
    const id = `custom-${Date.now()}`;
    const entry: StandardCatalogEntry = {
      id,
      name,
      version: customVersion.trim() || '自定义',
      description: customDesc.trim() || '用户自定义标准',
      items: 0,
      type: '自定义',
      color: 'purple',
    };
    onAddCustomStandard(entry);
    setAddCustomOpen(false);
    setCustomName('');
    setCustomVersion(tx('自定义', 'Custom'));
    setCustomDesc('');
    setSelectedStandardId(id);
  };

  const openEditStandardDialog = (std: StandardCatalogEntry) => {
    setCardMenuStandardId(null);
    setEditingStandard({ ...std });
    setEditStandardOpen(true);
  };

  const saveEditedStandard = () => {
    if (!editingStandard) return;
    const name = String(editingStandard.name || '').trim();
    if (!name) {
      window.alert(t('standardNameRequired'));
      return;
    }
    onUpdateCustomStandard?.({
      ...editingStandard,
      name,
      version: String(editingStandard.version || '').trim() || tx('自定义', 'Custom'),
      description: String(editingStandard.description || '').trim() || tx('用户自定义标准', 'User-defined standard'),
    });
    setEditStandardOpen(false);
    setEditingStandard(null);
  };

  const deleteStandardWithConfirm = (std: StandardCatalogEntry) => {
    setCardMenuStandardId(null);
    if (!isSuperAdmin) {
      window.alert(t('superAdminOnlyDelete'));
      return;
    }
    if (!window.confirm(t('deleteConfirm1'))) return;
    if (!window.confirm(t('deleteConfirm2'))) return;
    onDeleteCustomStandard?.(std.id);
    if (selectedStandardId === std.id) setSelectedStandardId(null);
  };

  const reorderCatalogEntries = useCallback(
    (fromId: string, toId: string) => {
      if (!fromId || !toId || fromId === toId) return;
      const fromIdx = catalogEntries.findIndex((s) => s.id === fromId);
      const toIdx = catalogEntries.findIndex((s) => s.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = [...catalogEntries];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      onReorderCatalogEntries?.(next);
    },
    [catalogEntries, onReorderCatalogEntries]
  );

  const runImportFile = (file: File) => {
    setImportError(null);
    const lower = file.name.toLowerCase();

    const finishImport = (parsed: Control[], errors: string[]) => {
      if (!importStandardId) {
        setImportError(tx('请选择要导入到的标准', 'Please select a target standard'));
        return;
      }
      if (parsed.length === 0) {
        setImportError(errors.join(' ') || tx('未解析到任何条款', 'No valid controls were parsed'));
        return;
      }
      const prev = controls[importStandardId] || [];
      const merged = mergeControlsById(prev, parsed);
      onUpdateControls({
        ...controls,
        [importStandardId]: merged,
      });
      setImportOpen(false);
      if (errors.length) {
        window.alert(
          `${tx('已导入', 'Imported')} ${parsed.length} ${tx('条检查项。提示：', 'controls. Notes: ')}${errors.join(' ')}`
        );
      }
    };

    if (lower.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result ?? '');
          const { controls: parsed, errors } = parseControlsFromJsonString(text);
          if (errors.length && parsed.length === 0) {
            setImportError(errors.join(' '));
            return;
          }
          finishImport(parsed, errors);
        } catch (e) {
          setImportError(e instanceof Error ? e.message : tx('导入失败', 'Import failed'));
        }
      };
      reader.onerror = () => setImportError(tx('读取文件失败', 'Failed to read file'));
      reader.readAsText(file, 'UTF-8');
      return;
    }

    if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result ?? '');
          const { controls: parsed, errors } = parseControlsFromMarkdown(text);
          if (errors.length && parsed.length === 0) {
            setImportError(errors.join(' '));
            return;
          }
          finishImport(parsed, errors);
        } catch (e) {
          setImportError(e instanceof Error ? e.message : tx('导入失败', 'Import failed'));
        }
      };
      reader.onerror = () => setImportError(tx('读取文件失败', 'Failed to read file'));
      reader.readAsText(file, 'UTF-8');
      return;
    }

    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const buf = reader.result as ArrayBuffer;
          const { controls: parsed, errors } = parseControlsFromEnterpriseExcel(buf);
          if (errors.length && parsed.length === 0) {
            setImportError(errors.join(' '));
            return;
          }
          finishImport(parsed, errors);
        } catch (e) {
          setImportError(e instanceof Error ? e.message : tx('导入失败', 'Import failed'));
        }
      };
      reader.onerror = () => setImportError(tx('读取文件失败', 'Failed to read file'));
      reader.readAsArrayBuffer(file);
      return;
    }

    setImportError(
      tx('仅支持 JSON（.json）、Markdown（.md / .markdown）、Excel（.xlsx / .xls）', 'Supported: .json, .md/.markdown, .xlsx/.xls')
    );
  };

  const archivePostProcess = legalArchiveData?.postProcess as Record<string, unknown> | undefined;
  const archivePostProcessParsed = (archivePostProcess?.parsedJson || null) as Record<string, unknown> | null;
  const parsedRoot = legalArchiveData?.parsedJson as Record<string, unknown> | undefined;
  const agentParsedAnswer = (() => {
    const aiResp = (parsedRoot?.response as Record<string, unknown> | undefined)?.ai as Record<string, unknown> | undefined;
    if (aiResp && aiResp.parsedAnswer && typeof aiResp.parsedAnswer === 'object') {
      return aiResp.parsedAnswer as Record<string, unknown>;
    }
    const aiRoot = parsedRoot?.ai as Record<string, unknown> | undefined;
    if (aiRoot && aiRoot.parsedAnswer && typeof aiRoot.parsedAnswer === 'object') {
      return aiRoot.parsedAnswer as Record<string, unknown>;
    }
    return null;
  })();
  const archiveStructured = agentParsedAnswer || archivePostProcessParsed;
  const archiveItems = Array.isArray(archiveStructured?.items) ? (archiveStructured?.items as Record<string, unknown>[]) : [];
  const archiveSummary = typeof archiveStructured?.summary === 'string' ? archiveStructured.summary : '';
  const archiveRiskSignals = Array.isArray(archiveStructured?.riskSignals)
    ? (archiveStructured.riskSignals as string[])
    : [];
  const archiveNextActions = Array.isArray(archiveStructured?.nextActions)
    ? (archiveStructured.nextActions as string[])
    : [];
  const archiveMetadata =
    archiveStructured && typeof archiveStructured.metadata === 'object'
      ? (archiveStructured.metadata as Record<string, unknown>)
      : null;
  const archiveConfidence =
    typeof archiveStructured?.confidence === 'number' ? archiveStructured.confidence : undefined;
  const reviewPublished = legalArchiveData?.customerView?.reviewed === true;
  const CONFIDENCE_THRESHOLD = 0.7;
  const isLowConfidence =
    typeof archiveConfidence === 'number' && archiveConfidence < CONFIDENCE_THRESHOLD;
  const customerBlockedByConfidence = isLowConfidence && !reviewPublished;
  const archiveTotalCount =
    typeof (legalArchiveData?.parsedJson as Record<string, unknown> | undefined)?.totalCount === 'number'
      ? Number((legalArchiveData?.parsedJson as Record<string, unknown>).totalCount)
      : undefined;
  const archiveKbCount =
    typeof (legalArchiveData?.parsedJson as Record<string, unknown> | undefined)?.knowledgeBaseCount === 'number'
      ? Number((legalArchiveData?.parsedJson as Record<string, unknown>).knowledgeBaseCount)
      : undefined;
  const parsedData = (parsedRoot?.data || undefined) as Record<string, unknown> | undefined;
  const archiveRawResultsCandidate =
    (Array.isArray(parsedRoot?.results) && (parsedRoot?.results as Record<string, unknown>[])) ||
    (Array.isArray(parsedRoot?.items) && (parsedRoot?.items as Record<string, unknown>[])) ||
    (Array.isArray(parsedRoot?.documents) && (parsedRoot?.documents as Record<string, unknown>[])) ||
    (Array.isArray(parsedRoot?.hits) && (parsedRoot?.hits as Record<string, unknown>[])) ||
    (Array.isArray(((parsedRoot?.response as Record<string, unknown> | undefined)?.web as Record<string, unknown> | undefined)?.results) &&
      ((((parsedRoot?.response as Record<string, unknown> | undefined)?.web as Record<string, unknown> | undefined)
        ?.results as Record<string, unknown>[]))) ||
    (Array.isArray(
      ((parsedRoot?.response as Record<string, unknown> | undefined)?.summary as Record<string, unknown> | undefined)
        ?.related_links
    ) &&
      ((((parsedRoot?.response as Record<string, unknown> | undefined)?.summary as Record<string, unknown> | undefined)
        ?.related_links as Array<Record<string, unknown>>) || []).flatMap((group) =>
        Array.isArray(group.items) ? (group.items as Record<string, unknown>[]) : []
      )) ||
    (Array.isArray(parsedData?.results) && (parsedData?.results as Record<string, unknown>[])) ||
    (Array.isArray(parsedData?.items) && (parsedData?.items as Record<string, unknown>[])) ||
    (Array.isArray(parsedData?.documents) && (parsedData?.documents as Record<string, unknown>[])) ||
    (Array.isArray(parsedData?.hits) && (parsedData?.hits as Record<string, unknown>[])) ||
    [];
  const archiveRawResults = archiveRawResultsCandidate;
  const archiveRawParsedFallback = (() => {
    if (archiveRawResults.length > 0 || !legalArchiveData?.rawText) return [] as Record<string, unknown>[];
    try {
      const j = JSON.parse(legalArchiveData.rawText) as Record<string, unknown>;
      if (Array.isArray(j.results)) return j.results as Record<string, unknown>[];
      if (Array.isArray(j.items)) return j.items as Record<string, unknown>[];
      const data = (j.data || {}) as Record<string, unknown>;
      if (Array.isArray(data.results)) return data.results as Record<string, unknown>[];
      if (Array.isArray(data.items)) return data.items as Record<string, unknown>[];
      return [];
    } catch {
      return [];
    }
  })();
  const archiveRawResultsForDisplay =
    archiveRawResults.length > 0 ? archiveRawResults : archiveRawParsedFallback;
  const archiveCustomerNarrativeFromSnapshot = String(legalArchiveData?.customerView?.content || '').trim();
  const archiveCustomerNarrativeFromParsed = (() => {
    try {
      const root = legalArchiveData?.parsedJson as Record<string, unknown> | undefined;
      const aiInResponse = ((root?.response as Record<string, unknown> | undefined)?.ai as Record<string, unknown> | undefined);
      if (typeof aiInResponse?.answer === 'string') return aiInResponse.answer.trim();
      const aiInRoot = (root?.ai as Record<string, unknown> | undefined);
      if (typeof aiInRoot?.answer === 'string') return aiInRoot.answer.trim();
      const summary = ((root?.response as Record<string, unknown> | undefined)?.summary as Array<Record<string, unknown>> | undefined) || [];
      const aiBlock = summary.find((x) => x && x.type === 'ai_answer' && typeof x.content === 'string');
      return aiBlock && typeof aiBlock.content === 'string' ? aiBlock.content.trim() : '';
    } catch {
      return '';
    }
  })();
  const archiveCustomerNarrative = archiveCustomerNarrativeFromSnapshot || archiveCustomerNarrativeFromParsed;
  const archiveBriefing = (() => {
    const cv = legalArchiveData?.customerView;
    const b = cv?.briefing;
    if (b && typeof b === 'object') {
      return {
        headline: String(b.headline || '').trim(),
        summary: String(b.summary || '').trim(),
        takeaways: Array.isArray(b.takeaways) ? (b.takeaways as string[]).filter(Boolean) : [],
      };
    }
    const pp = archiveStructured;
    if (pp && typeof pp === 'object') {
      return {
        headline: typeof pp.headline === 'string' ? pp.headline.trim() : '',
        summary: archiveSummary,
        takeaways: Array.isArray(pp.takeaways) ? (pp.takeaways as string[]).filter(Boolean) : [],
      };
    }
    return { headline: '', summary: '', takeaways: [] as string[] };
  })();
  const hasCustomerBriefing = Boolean(
    archiveBriefing.headline || archiveBriefing.summary || archiveBriefing.takeaways.length > 0
  );
  const metadataTotalCount =
    archiveMetadata && Number.isFinite(Number(archiveMetadata.totalCount))
      ? Number(archiveMetadata.totalCount)
      : undefined;
  const metadataCoreCount =
    archiveMetadata && Number.isFinite(Number(archiveMetadata.coreCount))
      ? Number(archiveMetadata.coreCount)
      : undefined;
  const metadataImportantCount =
    archiveMetadata && Number.isFinite(Number(archiveMetadata.importantCount))
      ? Number(archiveMetadata.importantCount)
      : undefined;
  const metadataPeriod = archiveMetadata && typeof archiveMetadata.period === 'string' ? archiveMetadata.period : '';
  const metadataQuery = archiveMetadata && typeof archiveMetadata.query === 'string' ? archiveMetadata.query : '';
  const metadataSources =
    archiveMetadata && Array.isArray(archiveMetadata.dataSources)
      ? (archiveMetadata.dataSources as string[]).filter(Boolean).slice(0, 8)
      : [];
  const metadataAddedCount =
    archiveMetadata && Number.isFinite(Number((archiveMetadata as Record<string, unknown>).addedThisSync))
      ? Number((archiveMetadata as Record<string, unknown>).addedThisSync)
      : 0;
  const metadataAddedResultTitles =
    archiveMetadata && Array.isArray((archiveMetadata as Record<string, unknown>).addedResultTitles)
      ? ((archiveMetadata as Record<string, unknown>).addedResultTitles as unknown[])
          .map((x) => String(x || '').trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];
  const metadataAddedItemTitles =
    archiveMetadata && Array.isArray((archiveMetadata as Record<string, unknown>).addedItemTitles)
      ? ((archiveMetadata as Record<string, unknown>).addedItemTitles as unknown[])
          .map((x) => String(x || '').trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];
  const reviewDraftTakeawaysList = reviewDraftTakeaways
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  const customerManualCards = manualLawItems
    .map((x, idx) => ({
      idx,
      title: x.title.trim(),
      docType: x.docType.trim() || '未知',
      status: x.status.trim() || '未知',
      keyPoints: x.keyPoints.split('\n').map((k) => k.trim()).filter(Boolean),
      controlImpacts: x.controlImpacts.split('\n').map((k) => k.trim()).filter(Boolean),
      sourceSnippet: x.sourceSnippet.trim(),
    }))
    .filter((x) => x.title);

  const saveManualReview = async () => {
    setSyncError(null);
    setSyncNotice(null);
    setReviewSaving(true);
    try {
      const takeaways = reviewDraftTakeaways
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
      await putLegalRegulationsReview({
        headline: reviewDraftHeadline.trim(),
        summary: reviewDraftSummary.trim(),
        takeaways,
        manualItems: customerManualCards,
        confidence: archiveConfidence,
        publish: true,
      });
      setSyncNotice('人工复核已发布，客户视图将优先展示复核内容。');
      await loadLegalArchive();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewSaving(false);
    }
  };
  const regenerateSummaryByModel = async () => {
    setSyncError(null);
    setSyncNotice(null);
    setReviewSaving(true);
    try {
      const res = await postLegalRegulationsRegenerateSummary({
        manualItems: customerManualCards,
      });
      if (res.briefing) {
        setReviewDraftHeadline(String(res.briefing.headline || ''));
        setReviewDraftSummary(String(res.briefing.summary || ''));
        setReviewDraftTakeaways(
          Array.isArray(res.briefing.takeaways) ? res.briefing.takeaways.join('\n') : ''
        );
      }
      setSyncNotice('已根据当前法规条目重新生成汇总，可编辑后发布。');
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewSaving(false);
    }
  };
  const resetManualReview = async () => {
    setSyncError(null);
    setSyncNotice(null);
    setReviewSaving(true);
    try {
      await putLegalRegulationsReview({
        headline: '',
        summary: '',
        takeaways: [],
        reset: true,
      });
      setSyncNotice('已撤销人工发布，客户视图已回退到模型/检索自动结果。');
      await loadLegalArchive();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewSaving(false);
    }
  };
  const deleteLegalItem = async (title: string, docType?: string, status?: string) => {
    setSyncError(null);
    setSyncNotice(null);
    try {
      const ok = window.confirm(`确认删除法规条目「${title}」吗？`);
      if (!ok) return;
      const reasonRaw = window.prompt('可选：请输入删除原因（如“法规已废止/已被新版本替代”）', '');
      const reason = String(reasonRaw || '').trim();
      const r = await postLegalRegulationsDeleteItem({ title, docType, status, reason });
      setSyncNotice(`已删除条目，影响 ${r.removedCount} 处`);
      await loadLegalArchive();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    }
  };
  const customerEvidenceCards = archiveRawResultsForDisplay.slice(0, 30).map((r, idx) => ({
    idx,
    title: String(r.title || r.name || r.documentTitle || r.docTitle || '检索条目'),
    snippet: String(r.snippet || r.content || r.text || r.summary || r.answer || r.description || '（暂无摘要内容）'),
    source: String(r.source || r.url || r.link || r.reference || ''),
    score: typeof r.score === 'number' ? r.score : undefined,
  }));
  const customerAiCards = archiveItems.slice(0, 30).map((item, idx) => ({
    idx,
    title: String(item.title || '未命名法规'),
    docType: String(item.docType || '未知'),
    status: String(item.status || '未知'),
    publishDate: String(item.publishDate || '—'),
    effectiveDate: String(item.effectiveDate || '—'),
    keyPoints: Array.isArray(item.keyPoints) ? (item.keyPoints as string[]) : [],
    controlImpacts: Array.isArray(item.controlImpacts) ? (item.controlImpacts as string[]) : [],
    sourceSnippet: String(item.sourceSnippet || ''),
  }));
  const formatLocalTime = (value?: string) => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(d);
  };
  const legalSyncVersionLabel = displayLegalSyncVersionLabel(apiSyncSettings.legalLastSyncAt, locale);

  if (selectedStandardId && activeStandard) {
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-8 pb-20"
      >
        <div className="flex items-center justify-between">
          <button 
            onClick={() => setSelectedStandardId(null)}
            className="flex items-center gap-2 text-text-main/40 hover:text-accent transition-colors font-black text-xs uppercase tracking-widest"
          >
            <ArrowLeft size={16} /> {tx('返回标准列表', 'Back to Standards')}
          </button>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => EXPORT_SERVICE.exportTemplateToExcel(activeControls, activeStandard.name)}
              className="glass-card bg-white/40 hover:bg-white/60 p-2.5 rounded-xl text-accent transition-all flex items-center gap-2"
              title={tx('导出当前标准为 Excel 清单', 'Export current standard as Excel')}
            >
              <Download size={18} />
              <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">{tx('导出清单', 'Export')}</span>
            </button>

            <button 
              onClick={() => {
                setIsAdding(true);
                setEditingControl({ id: `NEW-${Date.now()}`, name: '', requirement: '', priority: 'Medium' });
              }}
              className="glass-button flex items-center gap-2"
            >
              <Plus size={18} /> {tx('新增检查项', 'Add Control')}
            </button>
          </div>
        </div>

        <div className="glass-card p-10 bg-white/40">
          <div className="flex items-center gap-6 mb-8">
            <div className={cn(
              "w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-lg",
              activeStandard.color === 'blue' ? "bg-blue-500" :
              activeStandard.color === 'indigo' ? "bg-indigo-500" :
              activeStandard.color === 'purple' ? "bg-purple-500" : "bg-amber-500"
            )}>
              <Shield size={32} />
            </div>
            <div>
              <h2 className="text-3xl font-black tracking-tight">{activeStandard.name}</h2>
              <p className="text-text-main/40 font-black text-xs uppercase tracking-widest mt-1">
                {tx('条款条目管理', 'Control Management')} | {activeStandard.version}
              </p>
            </div>
          </div>

          <div className="grid gap-4">
            {activeControls.map(control => (
              <div 
                key={control.id} 
                className="glass-card p-6 bg-white/20 hover:bg-white/40 border-white/40 transition-all flex items-start gap-6 group"
              >
                <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex flex-shrink-0 items-center justify-center font-black text-xs text-accent">
                  {control.id}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-bold text-lg">{control.name}</h4>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => {
                          setEditingControl(control);
                          setIsAdding(false);
                        }}
                        className="p-2 hover:bg-accent/10 text-accent rounded-lg transition-colors"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDeleteControl(control.id)}
                        className="p-2 hover:bg-danger-main/10 text-danger-main rounded-lg transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-text-main/60 leading-relaxed font-medium">{control.requirement}</p>
                  {control.command && (
                    <div className="mt-4 p-3 bg-black/5 rounded-xl border border-black/5 font-mono text-[10px] text-text-main/70 relative group/cmd">
                      <div className="absolute top-2 right-2 opacity-0 group-hover/cmd:opacity-100 transition-opacity uppercase text-[8px] font-bold tracking-tighter text-text-main/30">Check Command</div>
                      {control.command}
                    </div>
                  )}
                  <div className="mt-4 flex items-center gap-3">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider",
                      control.priority === 'High' ? "bg-danger-main/10 text-danger-main" : "bg-warning-main/10 text-warning-main"
                    )}>
                      {control.priority} Priority
                    </span>
                  </div>
                </div>
              </div>
            ))}
            
            {activeControls.length === 0 && (
              <div className="py-20 flex flex-col items-center justify-center text-text-main/20 border-2 border-dashed border-white/40 rounded-3xl backdrop-blur-sm">
                <AlertCircle size={48} className="mb-4 opacity-20" />
                <p className="font-black text-xl">{tx('该标准暂无具体条款', 'No controls configured for this standard')}</p>
                <p className="text-xs uppercase font-bold tracking-widest mt-2">{tx('点击上方按钮开始配置', 'Click the button above to start')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Edit Modal */}
        <AnimatePresence>
          {editingControl && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-24 overflow-y-auto">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setEditingControl(null)}
                className="absolute inset-0 bg-black/20 backdrop-blur-md"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="glass-card bg-white/90 p-10 max-w-xl w-full relative z-10 shadow-2xl border-white"
              >
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-black tracking-tight">
                    {isAdding ? tx('新增条款信息', 'Add Control') : tx('配置条款细节', 'Edit Control')}
                  </h3>
                  <button onClick={() => setEditingControl(null)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="flex gap-4">
                    <div className="flex-1 space-y-2">
                       <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{tx('条款编号 (ID)', 'Control ID')}</label>
                       <input 
                         type="text" 
                         value={editingControl.id}
                         onChange={e => setEditingControl({...editingControl, id: e.target.value})}
                         className="glass-input w-full px-5 py-3 text-sm font-bold"
                         placeholder="如: S1-1"
                       />
                    </div>
                    <div className="flex-1 space-y-2">
                       <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{tx('重要级别', 'Priority')}</label>
                       <select 
                         value={editingControl.priority}
                         onChange={e => setEditingControl({...editingControl, priority: e.target.value as any})}
                         className="glass-input w-full px-5 py-3 text-sm font-bold appearance-none bg-white/50"
                       >
                         <option value="High">High</option>
                         <option value="Medium">Medium</option>
                         <option value="Low">Low</option>
                       </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{tx('检查项名称', 'Control Name')}</label>
                    <input 
                      type="text" 
                      value={editingControl.name}
                      onChange={e => setEditingControl({...editingControl, name: e.target.value})}
                      className="glass-input w-full px-5 py-3 text-sm font-bold"
                      placeholder={tx('输入核心检查项名称', 'Enter control name')}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{tx('详细合规要求', 'Detailed Requirement')}</label>
                    <textarea 
                      value={editingControl.requirement}
                      onChange={e => setEditingControl({...editingControl, requirement: e.target.value})}
                      className="glass-card bg-white/50 border-glass-border w-full p-5 text-sm font-medium leading-relaxed outline-none min-h-[100px] rounded-2xl focus:ring-4 focus:ring-accent/10 transition-all"
                      placeholder={tx('描述具体的合规法律条款或检查基线...', 'Describe legal/control requirement...')}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{tx('自动化检查命令 (Optional)', 'Automation Command (Optional)')}</label>
                    <textarea 
                      value={editingControl.command || ''}
                      onChange={e => setEditingControl({...editingControl, command: e.target.value})}
                      className="glass-card bg-black/5 border-glass-border w-full p-4 font-mono text-xs leading-relaxed outline-none min-h-[80px] rounded-2xl focus:ring-4 focus:ring-accent/10 transition-all"
                      placeholder="如: cat /etc/shadow | grep ..."
                    />
                  </div>
                </div>

                <div className="flex gap-4 mt-10">
                  <button 
                    onClick={() => setEditingControl(null)}
                    className="flex-1 py-4 glass-card bg-white/40 hover:bg-white/60 font-black text-xs uppercase tracking-widest transition-all"
                  >
                    {tx('取消修改', 'Cancel')}
                  </button>
                  <button 
                    onClick={() => handleSaveControl(editingControl)}
                    className="flex-1 py-4 glass-button bg-accent flex items-center justify-center gap-2"
                  >
                    <Check size={18} />
                    {tx('保存配置', 'Save')}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <div className="space-y-10 pb-16">
      <div className="flex justify-between items-end mb-12">
        <div>
          <h2 className="text-3xl font-black mb-2">{tx('合规标准知识库', 'Compliance Standards Knowledge Base')}</h2>
          <p className="text-text-main/60 font-medium">{tx('配置与同步平台支持的自动化检查项与法律条款', 'Configure and sync automated controls and legal clauses')}</p>
        </div>
        <button
          type="button"
          onClick={() => setAddCustomOpen(true)}
          className="glass-button bg-text-main flex items-center gap-2 px-6 py-3 shadow-black/10"
        >
          <Plus size={20} />
          {t('addCustom')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
        {catalogEntries.length === 0 ? (
          <div className="col-span-full py-16 glass-card border-dashed flex flex-col items-center justify-center text-text-main/50 text-center px-6">
            <p className="font-bold text-lg">{tx('暂无合规标准', 'No standards yet')}</p>
            <p className="text-sm mt-2">{tx('可通过上方入口新增自定义标准或导入检查项。', 'Add a custom standard or import controls above.')}</p>
          </div>
        ) : null}
        {catalogEntries.map(std => (
          <div 
            key={std.id}
            title={String(std.description || tx('暂无说明', 'No description')).trim()}
            draggable
            onDragStart={() => {
              setDraggingStandardId(std.id);
              setCardMenuStandardId(null);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (draggingStandardId) reorderCatalogEntries(draggingStandardId, std.id);
              setDraggingStandardId(null);
            }}
            onDragEnd={() => setDraggingStandardId(null)}
            className="glass-card p-8 flex flex-col group hover:-translate-y-2 transition-all duration-300 relative cursor-grab active:cursor-grabbing"
          >
            <div className="flex justify-between items-start mb-6">
              <div className={cn(
                "w-14 h-14 rounded-2xl flex items-center justify-center shadow-inner",
                std.color === 'blue' ? "bg-blue-100 text-blue-600" :
                std.color === 'indigo' ? "bg-indigo-100 text-indigo-600" :
                std.color === 'purple' ? "bg-purple-100 text-purple-600" : "bg-amber-100 text-amber-600"
              )}>
                <Shield size={28} />
              </div>
              <button
                type="button"
                onClick={() => setCardMenuStandardId((cur) => (cur === std.id ? null : std.id))}
                className="p-2 text-text-main/20 hover:text-text-main transition-colors rounded-xl hover:bg-white/50"
              >
                <MoreVertical size={20} />
              </button>
            </div>
            {cardMenuStandardId === std.id ? (
              <div className="absolute right-6 top-14 z-20 min-w-44 rounded-xl border border-white/70 bg-white/95 shadow-xl p-1.5">
                <button
                  type="button"
                  onClick={() => openEditStandardDialog(std)}
                  className="w-full text-left px-3 py-2 text-xs font-bold rounded-lg hover:bg-black/5"
                >
                  {tx('编辑', 'Edit')} · {tx('名称 / 版本 / 说明', 'Name / Version / Description')}
                </button>
                <button
                  type="button"
                  onClick={() => deleteStandardWithConfirm(std)}
                  disabled={!isSuperAdmin}
                  className={cn(
                    'w-full text-left px-3 py-2 text-xs font-bold rounded-lg',
                    !isSuperAdmin
                      ? 'text-text-main/35 cursor-not-allowed'
                      : 'text-danger-main hover:bg-danger-main/10'
                  )}
                >
                  {tx('删除', 'Delete')}
                  {!isSuperAdmin ? ` · ${t('superAdminOnlyDelete')}` : ''}
                </button>
              </div>
            ) : null}
            
            <h3 className="font-black text-xl mb-1 group-hover:text-accent transition-colors">{std.name}</h3>
            <p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest mb-6">{std.version}</p>
            
            <div className="flex items-center justify-between mt-auto pt-8 border-t border-white/40">
              <div className="flex flex-col">
                <span className="text-2xl font-black tracking-tight">{controls[std.id]?.length ?? std.items}</span>
                <span className="text-[10px] font-black text-text-main/40 uppercase tracking-widest">检查项 (Controls)</span>
              </div>
              <button 
                onClick={() => setSelectedStandardId(std.id)}
                className="flex items-center gap-1 text-accent text-sm font-black group-hover:gap-2 transition-all"
              >
                配置条款
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => {
            setImportError(null);
            setImportStandardId(catalogEntries[0]?.id ?? '');
            setImportOpen(true);
          }}
          className="glass-card p-10 flex flex-col items-center justify-center text-text-main/30 border-dashed border-2 bg-white/5 hover:bg-white/20 cursor-pointer transition-all group text-left w-full"
        >
          <div className="w-16 h-16 rounded-3xl border border-white/60 flex items-center justify-center mb-4 group-hover:bg-white group-hover:border-accent group-hover:text-accent group-hover:scale-110 transition-all shadow-inner">
            <Upload size={32} />
          </div>
          <p className="font-black text-lg mb-1">{t('importControls')}</p>
          <p className="text-[10px] font-bold text-center uppercase tracking-widest">
            {tx('JSON · Markdown · Excel（与导出模板列一致）', 'JSON · Markdown · Excel (same columns as export)')}
          </p>
        </button>
      </div>

      <div className="mt-16 glass-card p-10 bg-white/30 border-white/60 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row items-center gap-10">
          <button
            type="button"
            onClick={() => openLegalArchive('internal')}
            className="bg-white p-5 rounded-2xl shadow-xl shadow-blue-900/5 shrink-0 hover:ring-2 hover:ring-accent/30 transition-all cursor-pointer"
            title="打开内部诊断信息"
          >
            <ExternalLink className="text-accent" size={32} />
          </button>
          <div
            role="button"
            tabIndex={0}
            onClick={() => openLegalArchive('customer')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openLegalArchive('customer');
              }
            }}
            className="flex-1 text-left cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/40 min-w-0 transition-transform duration-200 hover:scale-[1.01]"
          >
            <h4 className="font-black text-2xl mb-2 tracking-tight hover:text-accent transition-colors">{t('lawTitle')}</h4>
            <p className="text-sm font-medium text-text-main/60 leading-relaxed max-w-3xl">
              {t('lawDesc')}
            </p>
            <div className="flex flex-wrap gap-6 mt-6" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => {
                  setSyncNotice(null);
                  setSyncError(null);
                  setSyncInfoOpen(true);
                }}
                className="text-xs font-black text-accent uppercase tracking-widest border-b-2 border-accent/20 hover:border-accent transition-all pb-1"
              >
                {t('viewSync')} (Current: {legalSyncVersionLabel})
              </button>
            </div>
          </div>
        </div>

        {/* Decorative background element */}
        <div className="absolute right-0 bottom-0 w-32 h-32 bg-accent/5 rounded-full -mr-16 -mb-16 blur-2xl pointer-events-none" />
      </div>

      <input
        ref={importFileRef}
        type="file"
        accept=".json,.md,.markdown,.xlsx,.xls,application/json,text/markdown"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) runImportFile(f);
        }}
      />

      <AnimatePresence>
        {editStandardOpen && editingStandard && (
          <div className="fixed inset-0 z-[82] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => {
                setEditStandardOpen(false);
                setEditingStandard(null);
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="glass-card relative z-10 w-full max-w-lg p-8 border-white/80 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-black">{t('editStandardTitle')}</h3>
                <button
                  type="button"
                  onClick={() => {
                    setEditStandardOpen(false);
                    setEditingStandard(null);
                  }}
                  className="p-2 rounded-lg hover:bg-black/5"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{t('stdName')}</label>
                  <input
                    value={editingStandard.name}
                    onChange={(e) => setEditingStandard((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                    className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{t('stdVersion')}</label>
                  <input
                    value={editingStandard.version}
                    onChange={(e) => setEditingStandard((prev) => (prev ? { ...prev, version: e.target.value } : prev))}
                    className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{t('stdDesc')}</label>
                  <textarea
                    value={editingStandard.description}
                    onChange={(e) => setEditingStandard((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                    className="glass-card bg-white/50 w-full p-4 text-sm rounded-2xl min-h-[90px] mt-2 outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => {
                    setEditStandardOpen(false);
                    setEditingStandard(null);
                  }}
                  className="flex-1 py-3 glass-card font-black text-xs uppercase tracking-widest"
                >
                  {t('cancel')}
                </button>
                <button type="button" onClick={saveEditedStandard} className="flex-1 py-3 glass-button">
                  {t('save')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {addCustomOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => setAddCustomOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="glass-card relative z-10 w-full max-w-lg p-8 border-white/80 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-black">{t('addCustom')}</h3>
                <button type="button" onClick={() => setAddCustomOpen(false)} className="p-2 rounded-lg hover:bg-black/5">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">标准名称 *</label>
                  <input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
                    placeholder="例如：集团内部信息安全基线"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">版本 / 文号</label>
                  <input
                    value={customVersion}
                    onChange={(e) => setCustomVersion(e.target.value)}
                    className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
                    placeholder="自定义"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">说明</label>
                  <textarea
                    value={customDesc}
                    onChange={(e) => setCustomDesc(e.target.value)}
                    className="glass-card bg-white/50 w-full p-4 text-sm rounded-2xl min-h-[80px] mt-2 outline-none"
                    placeholder="可选：适用范围、发布部门等"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setAddCustomOpen(false)}
                  className="flex-1 py-3 glass-card font-black text-xs uppercase tracking-widest"
                >
                  取消
                </button>
                <button type="button" onClick={submitAddCustom} className="flex-1 py-3 glass-button">
                  创建并配置条款
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {importOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => setImportOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="glass-card relative z-10 w-full max-w-2xl p-8 border-white/80 shadow-2xl max-h-[88vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-black">
                  {tx('导入合规标准特定条款', 'Import standard clauses')}
                </h3>
                <button type="button" onClick={() => setImportOpen(false)} className="p-2 rounded-lg hover:bg-black/5">
                  <X size={20} />
                </button>
              </div>
              <p className="text-sm text-text-main/60 mb-3">
                {tx(
                  '支持 JSON、Markdown、Excel 三种格式。导入后与已有检查项按「控制项 ID」合并（相同 ID 时以导入内容覆盖）。',
                  'Supports JSON, Markdown, and Excel. Merges with existing controls by control ID (import overwrites same ID).'
                )}
              </p>
              <details className="mb-4 rounded-xl border border-white/60 bg-white/40 px-4 py-3 text-xs text-text-main/75 leading-relaxed">
                <summary className="cursor-pointer font-black text-text-main/80 select-none">
                  {tx('字段要求说明（三种格式通用语义）', 'Field requirements (same semantics across formats)')}
                </summary>
                <ul className="mt-3 list-disc pl-5 space-y-1.5">
                  <li>
                    <strong>id / 控制项ID</strong> — {tx('必填，唯一标识（如 7.1.1）。', 'Required. Unique id (e.g. 7.1.1).')}
                  </li>
                  <li>
                    <strong>name / 检查项名称</strong> — {tx('必填。', 'Required.')}
                  </li>
                  <li>
                    <strong>requirement / 合规要求</strong> — {tx('可选；缺省为「—」。', 'Optional; defaults to em dash.')}
                  </li>
                  <li>
                    <strong>priority / 重要级别</strong> — {tx('可选：High | Medium | Low，缺省 Medium。', 'Optional: High | Medium | Low; default Medium.')}
                  </li>
                  <li>
                    <strong>command / 自动化核查命令</strong> — {tx('可选；空或 N/A 表示无命令。', 'Optional; empty or N/A means none.')}
                  </li>
                </ul>
                <p className="mt-3 font-semibold text-text-main/70">{tx('JSON', 'JSON')}</p>
                <pre className="mt-1 p-3 rounded-lg bg-black/5 text-[11px] overflow-x-auto whitespace-pre-wrap font-mono">
{`{
  "controls": [
    {
      "id": "7.1.1",
      "name": "示例检查项",
      "requirement": "应满足……",
      "priority": "High",
      "command": ""
    }
  ]
}`}
                </pre>
                <p className="text-[11px] text-text-main/55 mt-1">
                  {tx('根节点可为数组；或含 controls 数组的对象。键名支持中英混排（见上表）。', 'Root may be an array, or an object with a "controls" array. Keys may be Chinese or English as above.')}
                </p>
                <p className="mt-3 font-semibold text-text-main/70">{tx('Markdown', 'Markdown')}</p>
                <pre className="mt-1 p-3 rounded-lg bg-black/5 text-[11px] overflow-x-auto whitespace-pre-wrap font-mono">
{`## 7.1.1 示例检查项
**priority**: High
**requirement**: 应满足……
**command**: cat /etc/example`}
                </pre>
                <p className="text-[11px] text-text-main/55 mt-1">
                  {tx(
                    '每条条款以二级标题「## 控制项ID」开头，标题行可写名称；也可用 **检查项名称**: 单独写名称。正文用 **字段名**: 值（字段名不区分大小写）。',
                    'Each clause starts with ## controlId; name may be on the heading line or as **name** / **检查项名称**. Body uses **field**: value (case-insensitive keys).'
                  )}
                </p>
                <p className="mt-3 font-semibold text-text-main/70">{tx('Excel', 'Excel')}</p>
                <p className="text-[11px] text-text-main/55">
                  {tx(
                    '与「配置条款 → 导出清单」相同列：控制项ID、检查项名称、重要级别、合规要求、自动化核查命令（可选）。首行表头，支持 .xlsx / .xls。',
                    'Same columns as “Export checklist”: 控制项ID, 检查项名称, 重要级别, 合规要求, 自动化核查命令 (optional). Header row; .xlsx / .xls.'
                  )}
                </p>
              </details>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">导入到标准</label>
                  <select
                    value={importStandardId}
                    onChange={(e) => setImportStandardId(e.target.value)}
                    className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
                  >
                    {catalogEntries.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                {importError && (
                  <p className="text-sm text-danger-main font-medium">{importError}</p>
                )}
              </div>
              <div className="flex gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setImportOpen(false)}
                  className="flex-1 py-3 glass-card font-black text-xs uppercase tracking-widest"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                  className="flex-1 py-3 glass-button flex items-center justify-center gap-2"
                >
                  <Upload size={18} />
                  {tx('选择文件（JSON / MD / Excel）', 'Choose file (JSON / MD / Excel)')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {syncInfoOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => setSyncInfoOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="glass-card relative z-10 w-full max-w-lg p-8 border-white/80 shadow-2xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <RefreshCcw size={22} className="text-accent" />
                  <h3 className="text-xl font-black">{tx('法律法规同步状态', 'Legal Regulations Sync Status')}</h3>
                </div>
                <button type="button" onClick={() => setSyncInfoOpen(false)} className="p-2 rounded-lg hover:bg-black/5">
                  <X size={20} />
                </button>
              </div>

              {syncStatusLoading ? (
                <div className="flex items-center gap-3 py-8 text-text-main/60 font-semibold">
                  <Loader2 className="animate-spin" size={22} />
                  {tx('正在拉取配置…', 'Loading settings...')}
                </div>
              ) : (
                <div className="space-y-4 text-sm">
                  <div className="glass-card p-4 bg-white/40 space-y-2">
                    <p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest">{tx('法规库同步版本', 'Regulation Library Sync Version')}</p>
                    <p className="text-lg font-black">{legalSyncVersionLabel}</p>
                    <p className="text-[11px] text-text-main/50">{tx('规则：每次成功“立即拉取法律法规”后，按最新拉取时间自动更新。', 'Rule: version updates automatically after each successful manual fetch.')}</p>
                  </div>
                  <div className="glass-card p-4 bg-white/40 space-y-2">
                    <p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest">{tx('后端连接', 'Backend Connection')}</p>
                    <p className="font-bold">{backendReadyForSync ? tx('已连接', 'Connected') : tx('未连接（将使用本地缓存）', 'Disconnected (local cache only)')}</p>
                  </div>
                  {canSyncStandardsApi ? (
                    <div className="glass-card p-4 bg-white/40 space-y-2">
                      <p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest">
                        {tx('合规标准库同步（上次）', 'Standards library sync (last)')}
                      </p>
                      <p className="font-bold text-sm break-all">{displayStandardsLastSyncAt(apiSyncSettings.lastSyncAt, locale)}</p>
                    </div>
                  ) : null}
                  <div className="glass-card p-4 bg-white/40 space-y-2">
                    <p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest">{tx('最近同步时间', 'Latest Sync Time')}</p>
                    <p className="font-bold text-sm break-all">
                      {displayLegalLastSyncAtLine(apiSyncSettings.legalLastSyncAt, locale, formatLocalTime)}
                    </p>
                  </div>
                  <div className="glass-card p-4 bg-white/40 space-y-2">
                    <p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest">{tx('拉取提示词', 'Fetch Prompt')}</p>
                    <textarea
                      value={apiSyncSettings.legalSearchKeyword || ''}
                      onChange={(e) =>
                        setApiSyncSettings((prev) => ({
                          ...prev,
                          legalSearchKeyword: e.target.value,
                        }))
                      }
                      placeholder={tx('例如：聚焦信息安全与数据合规，优先输出近 12 个月有效法规', 'Example: Focus on cybersecurity and data compliance, prioritize effective regulations in last 12 months')}
                      className="glass-card w-full min-h-[88px] p-3 text-xs bg-white/70 border border-black/10 rounded-xl outline-none"
                    />
                    {locale === 'en-US' && isDefaultLegalSearchKeyword(apiSyncSettings.legalSearchKeyword) ? (
                      <p className="text-[11px] text-text-main/55 mt-1.5 leading-snug">
                        {tx(
                          '当前为内置中文默认提示词，将按原文发送给模型。',
                          'Built-in default prompt is in Chinese and is sent to the model verbatim.'
                        )}
                      </p>
                    ) : null}
                  </div>
                </div>
              )}

              {syncNotice && (
                <p className="mt-4 text-sm font-semibold text-success-main bg-success-main/10 rounded-xl px-4 py-3">{syncNotice}</p>
              )}
              {syncError && (
                <p className="mt-4 text-sm font-semibold text-danger-main bg-danger-main/10 rounded-xl px-4 py-3">{syncError}</p>
              )}

              <div className="flex flex-wrap gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setSyncInfoOpen(false)}
                  className="flex-1 min-w-[120px] py-3 glass-card font-black text-xs uppercase tracking-widest"
                >
                  {tx('关闭', 'Close')}
                </button>
                <button
                  type="button"
                  onClick={() => void runLegalRegulationsFetchNow()}
                  disabled={legalFetchLoading || legalTestLoading || !canSyncStandardsApi || !backendReadyForSync}
                  className="flex-1 min-w-[140px] py-3 glass-button flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {legalFetchLoading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCcw size={18} />}
                  {legalFetchLoading ? tx('拉取中…', 'Fetching...') : tx('立即拉取法律法规', 'Fetch Legal Regulations Now')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      

      <AnimatePresence>
        {legalArchiveOpen && (
          <div className="fixed inset-0 z-[85] flex items-stretch justify-center p-4 md:p-8">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setLegalArchiveOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              className="relative z-10 flex flex-col w-full max-w-5xl max-h-[min(92vh,900px)] glass-card border-white/80 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-white/50 bg-white/20">
                <div className="min-w-0">
                  <h3 className="text-xl font-black">
                    {legalArchiveView === 'customer'
                      ? tx('法律法规库-持续更新中', 'Legal Regulations Library - Continuous Updates')
                      : tx('内部诊断信息（数据拉取记录）', 'Internal Diagnostics (Fetch Records)')}
                  </h3>
                  <p className="text-xs text-text-main/55 mt-1">{tx('由后端拉取并持久化', 'Fetched and persisted by backend')}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void loadLegalArchive()}
                    className="glass-card px-4 py-2 text-xs font-black uppercase tracking-widest hover:bg-white/60"
                  >
                    {tx('重新加载', 'Reload')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLegalArchiveOpen(false)}
                    className="p-2 rounded-lg hover:bg-black/5"
                    aria-label={tx('关闭', 'Close')}
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-6 min-h-0">
                {legalArchiveLoading ? (
                  <div className="flex items-center gap-3 text-text-main/60 font-semibold py-20 justify-center">
                    <Loader2 className="animate-spin" size={24} />
                    {tx('正在加载…', 'Loading...')}
                  </div>
                ) : legalArchiveData?.empty ? (
                  <p className="text-text-main/65 text-center py-16 max-w-lg mx-auto leading-relaxed">
                    {legalArchiveData.message || tx('尚未拉取。请前往「系统核心配置」完成法律法规配置并执行拉取。', 'No data fetched yet. Complete legal settings in System Settings and run fetch.')}
                  </p>
                ) : (
                  <div className="space-y-5">
                    {legalArchiveView === 'customer' ? (
                      <div className="glass-card p-4 sm:p-6 border border-white/50 rounded-2xl space-y-6">
                        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-black/5 pb-4">
                          <div className="min-w-0 space-y-1">
                            <p className="text-[11px] font-black uppercase tracking-widest text-text-main/45">{tx('客户展示 · 法规合规简报', 'Customer View · Compliance Briefing')}</p>
                            <p className="text-sm font-bold text-text-main/90 leading-snug break-words">
                              {tx('检索主题：', 'Query: ')}{legalArchiveData?.query || legalArchiveData?.keyword || '—'}
                            </p>
                            {reviewPublished && (
                              <p className="inline-flex items-center gap-2 rounded-full border border-success-main/25 bg-success-main/10 px-2.5 py-1 text-[11px] font-bold text-success-main">
                                {tx('已人工审核并最终发布', 'Manually Reviewed and Published')}
                                {legalArchiveData?.customerView?.reviewedBy ? `· ${legalArchiveData.customerView.reviewedBy}` : ''}
                                {legalArchiveData?.customerView?.reviewedAt
                                  ? `· ${formatLocalTime(legalArchiveData.customerView.reviewedAt)}`
                                  : ''}
                              </p>
                            )}
                          </div>
                          {legalArchiveData?.updatedAt && (
                            <p className="text-[11px] font-mono text-text-main/50 shrink-0">缓存 {formatLocalTime(legalArchiveData.updatedAt)}</p>
                          )}
                        </div>

                        {metadataAddedCount > 0 && (
                          <div className="rounded-2xl border border-success-main/25 bg-success-main/10 p-4 space-y-2">
                            <p className="text-sm font-bold text-success-main">
                              {tx('本次新增法规', 'New items this sync')}: {metadataAddedCount}
                            </p>
                            {metadataAddedResultTitles.length > 0 && (
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-text-main/45 mb-1">
                                  {tx('新增检索条目', 'New search results')}
                                </p>
                                <ul className="space-y-1 text-xs text-text-main/80">
                                  {metadataAddedResultTitles.map((x, i) => (
                                    <li key={`ar-${i}-${x.slice(0, 20)}`} className="break-words">• {x}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {metadataAddedItemTitles.length > 0 && (
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-text-main/45 mb-1">
                                  {tx('新增结构化法规', 'New structured regulations')}
                                </p>
                                <ul className="space-y-1 text-xs text-text-main/80">
                                  {metadataAddedItemTitles.map((x, i) => (
                                    <li key={`ai-${i}-${x.slice(0, 20)}`} className="break-words">• {x}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                        {customerBlockedByConfidence ? (
                          <div className="rounded-2xl border border-warning-main/30 bg-warning-main/10 p-5 space-y-3">
                            <p className="text-sm font-bold text-warning-main">
                              {tx('当前为低置信结果', 'Low-confidence result')} (confidence={archiveConfidence?.toFixed(2)}), {tx('已自动放入内部诊断等待人工复核。', 'routed to internal diagnostics for manual review.')}
                            </p>
                            <p className="text-xs text-text-main/70">
                              {tx('请切换到「内部诊断信息」完成人工编辑并点击“人工复核通过并发布”，发布后将直接展示给客户。', 'Switch to Internal Diagnostics, edit manually, then click publish for customer visibility.')}
                            </p>
                          </div>
                        ) : hasCustomerBriefing ? (
                          <div className="space-y-6">
                            <div className="relative overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-white/90 via-white/70 to-accent/[0.07] shadow-md">
                              <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-accent/15 blur-3xl" />
                              <div className="relative space-y-4 p-5 md:p-7">
                                <div className="flex items-center gap-2 text-accent">
                                  <Sparkles className="shrink-0" size={18} strokeWidth={2.25} />
                                  <span className="text-[10px] font-black uppercase tracking-widest">{tx('大模型汇总（客户版）', 'LLM Summary (Customer)')}</span>
                                </div>
                                {archiveBriefing.headline ? (
                                  <h4 className="text-lg font-black leading-snug tracking-tight text-text-main md:text-xl">{archiveBriefing.headline}</h4>
                                ) : null}
                                {archiveBriefing.summary ? (
                                  <p className="text-sm leading-relaxed text-text-main/85">{archiveBriefing.summary}</p>
                                ) : null}
                                {archiveBriefing.takeaways.length > 0 ? (
                                  <div className="space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-text-main/40">{tx('要点速览', 'Key Takeaways')}</p>
                                    <ul className="grid gap-2">
                                      {archiveBriefing.takeaways.map((t, i) => (
                                        <li
                                          key={`${i}-${t.slice(0, 24)}`}
                                          className="flex gap-3 rounded-xl border border-black/[0.06] bg-white/65 px-4 py-2.5 text-sm leading-snug text-text-main/90 shadow-sm"
                                        >
                                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-xs font-black text-accent">
                                            {i + 1}
                                          </span>
                                          <span>{t}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                                {legalArchiveData?.customerView?.updatedAt && (
                                  <p className="text-[11px] font-mono text-text-main/45">
                                    {tx('简报更新：', 'Briefing Updated: ')}{formatLocalTime(legalArchiveData.customerView.updatedAt)}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="space-y-3">
                              <div className="flex items-center gap-2 text-text-main/50">
                                <BookMarked size={17} strokeWidth={2} />
                                <span className="text-[10px] font-black uppercase tracking-widest">{tx('法规条目与要点（人工发布）', 'Regulatory Items & Highlights (Manual Publish)')}</span>
                              </div>
                              {customerManualCards.length > 0 ? (
                                <div className="space-y-3">
                                  {customerManualCards.map((ai) => (
                                    <div
                                      key={`${ai.title}-${ai.idx}`}
                                      className="space-y-3 rounded-2xl border border-black/[0.07] bg-white/55 p-5 shadow-sm ring-1 ring-black/[0.03]"
                                    >
                                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/5 pb-3">
                                        <p className="min-w-0 flex-1 font-bold leading-snug text-text-main/95">{ai.title}</p>
                                        <div className="flex shrink-0 flex-wrap gap-2">
                                          <span className="rounded-full border border-black/10 bg-white/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-main/70">
                                            {ai.docType}
                                          </span>
                                          <span className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold text-accent">
                                            {ai.status}
                                          </span>
                                        </div>
                                      </div>
                                      <p className="text-[11px] font-mono text-text-main/55">
                                        发布 {ai.publishDate} · 生效 {ai.effectiveDate}
                                      </p>
                                      {ai.keyPoints.length > 0 ? (
                                        <ul className="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-text-main/80 marker:text-accent">
                                          {ai.keyPoints.map((pt, j) => (
                                            <li key={j}>{pt}</li>
                                          ))}
                                        </ul>
                                      ) : null}
                                      {ai.controlImpacts.length > 0 ? (
                                        <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-xs leading-relaxed text-text-main/75">
                                          <span className="font-bold text-text-main/55">对控制项： </span>
                                          {ai.controlImpacts.join('；')}
                                        </div>
                                      ) : null}
                                      <div className="pt-1">
                                        <button
                                          type="button"
                                          className="text-xs font-bold text-danger-main"
                                          onClick={() => void deleteLegalItem(ai.title, ai.docType, ai.status)}
                                        >
                                          {tx('删除', 'Delete')}
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : customerAiCards.length > 0 ? (
                                <div className="space-y-3">
                                  {customerAiCards.map((ai) => (
                                    <div key={`${ai.title}-${ai.idx}`} className="space-y-3 rounded-2xl border border-black/[0.07] bg-white/55 p-5 shadow-sm ring-1 ring-black/[0.03]">
                                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/5 pb-3">
                                        <p className="min-w-0 flex-1 font-bold leading-snug text-text-main/95">{ai.title}</p>
                                        <div className="flex shrink-0 flex-wrap gap-2">
                                          <span className="rounded-full border border-black/10 bg-white/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-main/70">
                                            {ai.docType}
                                          </span>
                                          <span className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold text-accent">
                                            {ai.status}
                                          </span>
                                        </div>
                                      </div>
                                      <p className="text-[11px] font-mono text-text-main/55">
                                        发布 {ai.publishDate} · 生效 {ai.effectiveDate}
                                      </p>
                                      {ai.keyPoints.length > 0 ? (
                                        <ul className="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-text-main/80 marker:text-accent">
                                          {ai.keyPoints.map((pt, j) => (
                                            <li key={j}>{pt}</li>
                                          ))}
                                        </ul>
                                      ) : null}
                                      {ai.controlImpacts.length > 0 ? (
                                        <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-xs leading-relaxed text-text-main/75">
                                          <span className="font-bold text-text-main/55">对控制项： </span>
                                          {ai.controlImpacts.join('；')}
                                        </div>
                                      ) : null}
                                      <div className="pt-1">
                                        <button
                                          type="button"
                                          className="text-xs font-bold text-danger-main"
                                          onClick={() => void deleteLegalItem(ai.title, ai.docType, ai.status)}
                                        >
                                          {tx('删除', 'Delete')}
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : customerEvidenceCards.length > 0 ? (
                                <div className="space-y-2 rounded-xl border border-black/10 bg-black/[0.03] p-4">
                                  <p className="text-xs text-text-main/65">{tx('尚未结构化法规条目，先展示证据候选。', 'No structured regulation cards yet; showing evidence candidates.')}</p>
                                  <ul className="space-y-1.5 text-xs text-text-main/75">
                                    {customerEvidenceCards.slice(0, 8).map((e) => (
                                      <li key={`${e.idx}-${e.title}`} className="break-words">
                                        • {e.title}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : (
                                <p className="text-xs text-text-main/60">{tx('本次未返回法规条目（items）。', 'No regulatory items returned in this run.')}</p>
                              )}
                            </div>

                            {archiveNextActions.length > 0 ? (
                              <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-text-main/45">{tx('建议动作', 'Recommended Actions')}</p>
                                <ul className="space-y-2">
                                  {archiveNextActions.map((action, i) => (
                                    <li
                                      key={`${i}-${action.slice(0, 20)}`}
                                      className="flex gap-3 rounded-xl border border-black/[0.06] bg-white/70 px-4 py-2.5 text-sm text-text-main/85"
                                    >
                                      <span className="text-accent font-black shrink-0">{i + 1}.</span>
                                      <span>{action}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {archiveCustomerNarrative &&
                            archiveCustomerNarrative.trim() &&
                            archiveCustomerNarrative.trim() !== archiveBriefing.summary?.trim() ? (
                              <details className="group rounded-xl border border-black/8 bg-black/[0.03] px-4 py-3">
                                <summary className="cursor-pointer text-xs font-bold text-text-main/55 transition-colors group-open:text-text-main/75">
                                  {tx('查看检索 Agent 原文解读', 'View Original Agent Narrative')}
                                </summary>
                                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-main/75">{archiveCustomerNarrative}</p>
                              </details>
                            ) : null}
                          </div>
                        ) : (
                          <div className="space-y-5">
                            {archiveCustomerNarrative ? (
                              <div className="rounded-2xl border border-black/8 bg-white/60 p-5 shadow-sm">
                                <div className="mb-2 flex items-center gap-2 text-text-main/45">
                                  <Sparkles size={16} />
                                  <span className="text-[10px] font-black uppercase tracking-widest">{tx('检索侧 AI 解读', 'Search-side AI Narrative')}</span>
                                </div>
                                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-main/85">{archiveCustomerNarrative}</p>
                                {legalArchiveData?.customerView?.updatedAt && (
                                  <p className="mt-3 text-[11px] font-mono text-text-main/45">
                                    {tx('更新于 ', 'Updated at ')}{formatLocalTime(legalArchiveData.customerView.updatedAt)}
                                  </p>
                                )}
                              </div>
                            ) : null}
                            {archiveSummary ? (
                              <p className="text-sm font-semibold leading-relaxed text-text-main/85">{archiveSummary}</p>
                            ) : null}
                            {customerEvidenceCards.length > 0 ? (
                              <div className="space-y-3">
                                {customerEvidenceCards.map((evidence) => {
                                  const ai = customerAiCards[evidence.idx];
                                  return (
                                    <div key={`${evidence.title}-${evidence.idx}`} className="space-y-3 rounded-xl border border-black/5 bg-black/[0.04] p-4">
                                      <div className="flex items-center justify-between">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-text-main/45">{tx('原始证据', 'Raw Evidence')}</p>
                                        {typeof evidence.score === 'number' && (
                                          <span className="rounded-full border border-black/10 bg-white/70 px-2 py-0.5 text-[10px] text-text-main/60">
                                            score {evidence.score.toFixed(3)}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-sm font-bold text-text-main/90">{evidence.title}</p>
                                      <p className="text-xs leading-relaxed text-text-main/75 whitespace-pre-wrap break-words">
                                        {evidence.snippet.slice(0, 420)}
                                      </p>
                                      {evidence.source ? (
                                        <p className="text-[11px] font-mono text-text-main/50 break-all">{tx('来源：', 'Source: ')}{evidence.source}</p>
                                      ) : null}
                                      <div className="h-px bg-black/10" />
                                      {ai ? (
                                        <div className="space-y-2">
                                          <div className="flex flex-wrap items-start justify-between gap-2">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-text-main/45">{tx('结构化解读', 'Structured Interpretation')}</p>
                                            <div className="flex gap-2">
                                              <span className="rounded-full border border-black/10 bg-white/70 px-2 py-0.5 text-[10px]">{ai.docType}</span>
                                              <span className="rounded-full border border-black/10 bg-white/70 px-2 py-0.5 text-[10px]">{ai.status}</span>
                                            </div>
                                          </div>
                                          <p className="text-sm font-semibold text-text-main/90">{ai.title}</p>
                                          <p className="text-xs text-text-main/60">{tx('发布：', 'Published: ')}{ai.publishDate} ｜ {tx('生效：', 'Effective: ')}{ai.effectiveDate}</p>
                                          {ai.keyPoints.length > 0 ? (
                                            <p className="text-xs leading-relaxed text-text-main/80">{tx('要点：', 'Key points: ')}{ai.keyPoints.join('；')}</p>
                                          ) : null}
                                        </div>
                                      ) : (
                                        <p className="text-xs text-text-main/55">{tx('本条目暂无结构化解读。', 'No structured interpretation for this item.')}</p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : customerAiCards.length > 0 ? (
                              <div className="space-y-3">
                                {customerAiCards.map((ai) => (
                                  <div key={`${ai.title}-${ai.idx}`} className="rounded-xl border border-black/5 bg-black/[0.04] p-4 space-y-2">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <p className="font-semibold text-sm text-text-main/90">{ai.title}</p>
                                      <div className="flex gap-2">
                                        <span className="text-[10px] px-2 py-1 rounded-full bg-white/70 border border-black/10">{ai.docType}</span>
                                        <span className="text-[10px] px-2 py-1 rounded-full bg-white/70 border border-black/10">{ai.status}</span>
                                      </div>
                                    </div>
                                    <p className="text-xs text-text-main/60">{tx('发布：', 'Published: ')}{ai.publishDate} ｜ {tx('生效：', 'Effective: ')}{ai.effectiveDate}</p>
                                    {ai.keyPoints.length > 0 ? (
                                      <p className="text-xs text-text-main/80 leading-relaxed">{tx('要点：', 'Key points: ')}{ai.keyPoints.join('；')}</p>
                                    ) : null}
                                    {ai.controlImpacts.length > 0 ? (
                                      <p className="text-xs text-text-main/75 leading-relaxed">{tx('影响控制项：', 'Impacted controls: ')}{ai.controlImpacts.join('；')}</p>
                                    ) : null}
                                    <div className="pt-1">
                                      <button
                                        type="button"
                                        className="text-xs font-bold text-danger-main"
                                        onClick={() => void deleteLegalItem(ai.title, ai.docType, ai.status)}
                                      >
                                        {tx('删除', 'Delete')}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-text-main/60">{tx('本次暂无可展示内容。可在策略中启用「大模型二次结构化」并保存后重新拉取。', 'No displayable content this time. Enable post-processing and fetch again.')}</p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="glass-card p-4 border border-white/50 rounded-xl space-y-3">
                        <p className="text-[11px] font-black uppercase tracking-widest text-text-main/50">{tx('数据拉取记录（内部）', 'Internal Fetch Records')}</p>
                        <div className="text-xs font-mono text-text-main/65 space-y-1">
                          <p>query: {legalArchiveData?.query ?? legalArchiveData?.keyword}</p>
                          <p>HTTP: {legalArchiveData?.statusCode}</p>
                          <p>totalCount: {archiveTotalCount != null ? archiveTotalCount : '—'}</p>
                          <p>knowledgeBaseCount: {archiveKbCount != null ? archiveKbCount : '—'}</p>
                          <p className="break-all">URL: {legalArchiveData?.requestUrl}</p>
                          <p>updatedAt: {formatLocalTime(legalArchiveData?.updatedAt)}</p>
                          {archivePostProcess && (
                            <>
                              <p>
                                postProcess: model={String(archivePostProcess.model || '—')} / provider=
                                {String(archivePostProcess.provider || '—')} / elapsedMs=
                                {String(archivePostProcess.elapsedMs || '—')}
                              </p>
                              {'error' in archivePostProcess && (
                                <p className="text-danger-main">postProcessError: {String(archivePostProcess.error || tx('未知错误', 'Unknown Error'))}</p>
                              )}
                            </>
                          )}
                          {archiveRiskSignals.length > 0 && <p>riskSignals: {archiveRiskSignals.join(' | ')}</p>}
                          {typeof archiveConfidence === 'number' && <p>confidence: {archiveConfidence}</p>}
                        </div>
                        {(metadataTotalCount != null ||
                          metadataCoreCount != null ||
                          metadataImportantCount != null ||
                          metadataSources.length > 0 ||
                          metadataPeriod ||
                          metadataQuery) && (
                          <div className="rounded-xl border border-black/10 bg-white/60 p-3 space-y-2">
                            <p className="text-[11px] font-black uppercase tracking-widest text-text-main/50">{tx('元数据统计（metadata）', 'Metadata Summary')}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                              <div className="rounded-lg bg-black/[0.04] px-2 py-1.5">{tx('总数', 'Total')}: {metadataTotalCount ?? '—'}</div>
                              <div className="rounded-lg bg-black/[0.04] px-2 py-1.5">{tx('核心', 'Core')}: {metadataCoreCount ?? '—'}</div>
                              <div className="rounded-lg bg-black/[0.04] px-2 py-1.5">{tx('重要', 'Important')}: {metadataImportantCount ?? '—'}</div>
                            </div>
                            {metadataPeriod ? <p className="text-[11px] font-mono">period: {metadataPeriod}</p> : null}
                            {metadataQuery ? <p className="text-[11px] font-mono break-words">query: {metadataQuery}</p> : null}
                            {metadataSources.length > 0 ? (
                              <p className="text-[11px] font-mono break-words">sources: {metadataSources.join(' | ')}</p>
                            ) : null}
                          </div>
                        )}
                        {Array.isArray(legalArchiveData?.history) && legalArchiveData.history.length > 0 && (
                          <div className="border border-black/5 rounded-xl bg-black/5 p-3">
                            <p className="text-[11px] font-black uppercase tracking-widest text-text-main/50 mb-2">{tx('最近拉取记录', 'Recent Fetch History')}</p>
                            <div className="max-h-44 overflow-auto space-y-2 text-[11px] font-mono text-text-main/70">
                              {legalArchiveData.history.slice(0, 20).map((h, i) => (
                                <div key={`${String(h.ts || 'ts')}-${i}`} className="border-b border-black/5 pb-2 last:border-b-0">
                                  <p>{formatLocalTime(h.ts)} | HTTP {h.statusCode ?? '—'} | total {h.totalCount ?? '—'}</p>
                                  <p className="break-all">{h.query || '—'}</p>
                                  {(h.responseType || h.responseMessage) && (
                                    <p>
                                      {h.responseType ? `type=${h.responseType}` : ''}
                                      {h.responseType && h.responseMessage ? ' | ' : ''}
                                      {h.responseMessage || ''}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="rounded-xl border border-black/10 bg-white/50 p-4 space-y-3">
                          <p className="text-[11px] font-black uppercase tracking-widest text-text-main/50">{tx('人工复核（低置信发布）', 'Manual Review (Low Confidence Publish)')}</p>
                          <p className="text-xs text-text-main/65">
                            {isLowConfidence
                              ? tx(`当前模型置信度 ${archiveConfidence?.toFixed(2)}（低于阈值 ${CONFIDENCE_THRESHOLD.toFixed(2)}），默认不在客户端展示。`, `Model confidence ${archiveConfidence?.toFixed(2)} is below threshold ${CONFIDENCE_THRESHOLD.toFixed(2)}; hidden from customer view by default.`)
                              : tx('可手动覆盖客户展示文案；发布后客户端优先使用复核结果。', 'You can manually override customer content; published review takes priority.')}
                          </p>
                          <input
                            value={reviewDraftHeadline}
                            onChange={(e) => setReviewDraftHeadline(e.target.value)}
                            className="glass-input w-full px-3 py-2 text-sm font-semibold"
                            placeholder={tx('复核标题', 'Review Headline')}
                          />
                          <textarea
                            value={reviewDraftSummary}
                            onChange={(e) => setReviewDraftSummary(e.target.value)}
                            className="glass-card w-full p-3 text-sm min-h-[92px] bg-white/60 border border-black/10 rounded-xl outline-none"
                            placeholder={tx('复核摘要（将展示给客户）', 'Review Summary (for customer view)')}
                          />
                          <textarea
                            value={reviewDraftTakeaways}
                            onChange={(e) => setReviewDraftTakeaways(e.target.value)}
                            className="glass-card w-full p-3 text-xs min-h-[96px] bg-white/60 border border-black/10 rounded-xl outline-none font-mono"
                            placeholder={tx('复核要点（每行一条）\n例如：完成重要数据分级梳理', 'Review takeaways (one per line)\nExample: Completed critical data classification')}
                          />
                          <div className="rounded-xl border border-black/10 bg-white/60 p-3 space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-text-main/50">{tx('人工法规条目录入（客户视图来源）', 'Manual Regulation Items (customer source)')}</p>
                            <input
                              value={manualDraft.title}
                              onChange={(e) => setManualDraft((p) => ({ ...p, title: e.target.value }))}
                              className="glass-input w-full px-3 py-2 text-sm font-semibold"
                              placeholder={tx('法规名称', 'Regulation Title')}
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                value={manualDraft.docType}
                                onChange={(e) => setManualDraft((p) => ({ ...p, docType: e.target.value }))}
                                className="glass-input w-full px-3 py-2 text-xs"
                                placeholder={tx('类型：法律/规章', 'Type: law/regulation')}
                              />
                              <input
                                value={manualDraft.status}
                                onChange={(e) => setManualDraft((p) => ({ ...p, status: e.target.value }))}
                                className="glass-input w-full px-3 py-2 text-xs"
                                placeholder={tx('状态：现行/修订中', 'Status: active/revising')}
                              />
                            </div>
                            <textarea
                              value={manualDraft.keyPoints}
                              onChange={(e) => setManualDraft((p) => ({ ...p, keyPoints: e.target.value }))}
                              className="glass-card w-full p-2 text-xs min-h-[64px] bg-white/70 border border-black/10 rounded-lg outline-none"
                              placeholder={tx('要点（每行一条）', 'Key points (one per line)')}
                            />
                            <textarea
                              value={manualDraft.controlImpacts}
                              onChange={(e) => setManualDraft((p) => ({ ...p, controlImpacts: e.target.value }))}
                              className="glass-card w-full p-2 text-xs min-h-[64px] bg-white/70 border border-black/10 rounded-lg outline-none"
                              placeholder={tx('合规影响（每行一条）', 'Compliance impacts (one per line)')}
                            />
                            <textarea
                              value={manualDraft.sourceSnippet}
                              onChange={(e) => setManualDraft((p) => ({ ...p, sourceSnippet: e.target.value }))}
                              className="glass-card w-full p-2 text-xs min-h-[52px] bg-white/70 border border-black/10 rounded-lg outline-none"
                              placeholder={tx('证据片段（可选）', 'Evidence snippet (optional)')}
                            />
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] text-text-main/55">{tx('已录入', 'Entered')} {manualLawItems.length} {tx('条', 'items')}</p>
                              <button
                                type="button"
                                className="glass-card px-3 py-1.5 text-xs font-black uppercase tracking-widest"
                                onClick={() => {
                                  if (!manualDraft.title.trim()) return;
                                  if (manualEditIdx != null) {
                                    setManualLawItems((prev) =>
                                      prev.map((it, idx) => (idx === manualEditIdx ? manualDraft : it))
                                    );
                                  } else {
                                    setManualLawItems((prev) => [...prev, manualDraft]);
                                  }
                                  setManualDraft({
                                    title: '',
                                    docType: tx('法律', 'Law'),
                                    status: tx('现行', 'Active'),
                                    keyPoints: '',
                                    controlImpacts: '',
                                    sourceSnippet: '',
                                  });
                                  setManualEditIdx(null);
                                }}
                              >
                                {manualEditIdx != null ? tx('保存编辑', 'Save Edit') : tx('添加法规条目', 'Add Item')}
                              </button>
                            </div>
                            {manualLawItems.length > 0 && (
                              <div className="space-y-1 max-h-28 overflow-auto">
                                {manualLawItems.map((it, idx) => (
                                  <div key={`${it.title}-${idx}`} className="flex items-center justify-between gap-2 text-xs bg-black/[0.03] rounded px-2 py-1">
                                    <span className="truncate">{it.title}</span>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        type="button"
                                        className="text-text-main/60"
                                        onClick={() =>
                                          setManualLawItems((prev) => {
                                            if (idx <= 0) return prev;
                                            const next = [...prev];
                                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                            return next;
                                          })
                                        }
                                        title={tx('上移', 'Move up')}
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        className="text-text-main/60"
                                        onClick={() =>
                                          setManualLawItems((prev) => {
                                            if (idx >= prev.length - 1) return prev;
                                            const next = [...prev];
                                            [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                                            return next;
                                          })
                                        }
                                        title={tx('下移', 'Move down')}
                                      >
                                        ↓
                                      </button>
                                      <button
                                        type="button"
                                        className="text-accent"
                                        onClick={() => {
                                          setManualDraft(it);
                                          setManualEditIdx(idx);
                                        }}
                                      >
                                        {tx('编辑', 'Edit')}
                                      </button>
                                      <button
                                        type="button"
                                        className="text-danger-main"
                                        onClick={() => {
                                          setManualLawItems((prev) => prev.filter((_, i) => i !== idx));
                                          if (manualEditIdx === idx) {
                                            setManualEditIdx(null);
                                            setManualDraft({
                                              title: '',
                                              docType: tx('法律', 'Law'),
                                              status: tx('现行', 'Active'),
                                              keyPoints: '',
                                              controlImpacts: '',
                                              sourceSnippet: '',
                                            });
                                          }
                                        }}
                                      >
                                        {tx('删除', 'Delete')}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {reviewPreviewOpen && (
                            <div className="rounded-xl border border-accent/25 bg-gradient-to-br from-white/90 to-accent/[0.06] p-4 space-y-2">
                              <p className="text-[10px] font-black uppercase tracking-widest text-accent">{tx('发布前预览（客户视图）', 'Pre-publish Preview (Customer View)')}</p>
                              <p className="text-sm font-bold text-text-main/90">
                                {reviewDraftHeadline.trim() || tx('（未填写标题）', '(No headline)')}
                              </p>
                              <p className="text-sm text-text-main/80 leading-relaxed whitespace-pre-wrap">
                                {reviewDraftSummary.trim() || tx('（未填写摘要）', '(No summary)')}
                              </p>
                              {reviewDraftTakeawaysList.length > 0 ? (
                                <ul className="space-y-1 text-xs text-text-main/75 list-disc list-inside">
                                  {reviewDraftTakeawaysList.map((x, i) => (
                                    <li key={`${i}-${x.slice(0, 20)}`}>{x}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-text-main/50">{tx('（未填写要点）', '(No takeaways)')}</p>
                              )}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-[11px] text-text-main/55">
                              {tx('已发布：', 'Published: ')}{reviewPublished ? tx('是', 'Yes') : tx('否', 'No')}
                              {legalArchiveData?.customerView?.reviewedAt
                                ? ` · ${formatLocalTime(legalArchiveData.customerView.reviewedAt)}`
                                : ''}
                              {legalArchiveData?.customerView?.reviewedBy
                                ? ` · ${legalArchiveData.customerView.reviewedBy}`
                                : ''}
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setReviewPreviewOpen((v) => !v)}
                                className="glass-card px-3 py-2 text-xs font-black uppercase tracking-widest"
                              >
                                {reviewPreviewOpen ? tx('关闭预览', 'Close Preview') : tx('发布前预览', 'Pre-publish Preview')}
                              </button>
                              <button
                                type="button"
                                onClick={() => void regenerateSummaryByModel()}
                                disabled={reviewSaving || customerManualCards.length === 0}
                                className="glass-card px-3 py-2 text-xs font-black uppercase tracking-widest disabled:opacity-60"
                              >
                                {tx('重新生成汇总', 'Regenerate Summary')}
                              </button>
                              <button
                                type="button"
                                onClick={() => void resetManualReview()}
                                disabled={reviewSaving}
                                className="glass-card px-3 py-2 text-xs font-black uppercase tracking-widest disabled:opacity-60"
                              >
                                {tx('撤销人工发布', 'Undo Manual Publish')}
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveManualReview()}
                                disabled={reviewSaving}
                                className="glass-button px-4 py-2 text-xs font-black uppercase tracking-widest disabled:opacity-60"
                              >
                                {reviewSaving ? tx('发布中…', 'Publishing...') : tx('人工复核通过并发布', 'Approve Review and Publish')}
                              </button>
                            </div>
                          </div>
                        </div>
                        <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words bg-black/5 border border-black/5 rounded-xl p-3 max-h-[min(36vh,280px)] overflow-auto">
                          {legalArchiveData?.parsedJson != null
                            ? JSON.stringify(legalArchiveData.parsedJson, null, 2)
                            : legalArchiveData?.rawText || ''}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
