
import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  Upload, 
  Search, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Brain, 
  Download,
  FileText,
  Table as TableIcon,
  File as FileIcon,
  Loader2
} from 'lucide-react';
import { motion } from 'motion/react';
import { Assessment, Standard, Finding, Control } from '../types';
import { performGapAnalysis, generateExecutiveSummary, type GapAnalysisResult } from '../services/gemini';
import { EXPORT_SERVICE } from '../services/export';
import { postReportDownloadEvent } from '../services/settingsApi';
import { postAssessmentPrecheck } from '../services/settingsApi';
import {
  abortAssessmentAnalysis,
  isAssessmentAnalysisRunning,
  registerAnalysisRun,
  unregisterAnalysisRun,
} from '../services/assessmentAnalysisRunner';
import { cn } from '../lib/utils';
import { getLocale, type LocaleId } from '../i18n';

interface AssessmentFlowProps {
  assessment: Assessment;
  standards: Standard[];
  controls: Record<string, Control[]>;
  /** 自动评估并发数（建议 2/3/5；由系统设置下发） */
  evalConcurrency?: number;
  /** 单项自动评估超时时间（毫秒；由系统设置下发） */
  perItemTimeoutMs?: number;
  /** 是否可进入第 3 步「聚合报告」：统计、条款明细、导出 */
  canViewAssessmentResults?: boolean;
  /** 第一个参数固定为当前任务 id，便于在后台跑分析时与「当前选中的任务」解耦 */
  onUpdate: (assessmentId: string, next: Assessment | ((prev: Assessment) => Assessment)) => void;
}

function initialStep(a: Assessment, canViewResults: boolean): 1 | 2 | 3 {
  if (a.status === 'Completed' && a.findings.length > 0 && canViewResults) return 3;
  if (a.status === 'In Progress') return 2;
  if (a.findings.length > 0 && a.evidenceText) return 2;
  return 1;
}

const ANALYSIS_CACHE_KEY = 'ai_guardian_assessment_analysis_cache_v1';
const MAX_CACHE_ITEMS = 60;

function simpleHash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function loadAnalysisCache(): Record<string, { findings: Finding[]; ts: number }> {
  try {
    const raw = localStorage.getItem(ANALYSIS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { findings: Finding[]; ts: number }>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveAnalysisCache(cache: Record<string, { findings: Finding[]; ts: number }>) {
  try {
    const entries = Object.entries(cache)
      .sort((a, b) => Number(b[1]?.ts || 0) - Number(a[1]?.ts || 0))
      .slice(0, MAX_CACHE_ITEMS);
    localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore localStorage quota errors
  }
}

function estimatePublishableGate(evidence: string, findingsCount: number, controlsCount: number) {
  const normalized = evidence.replace(/\s+/g, ' ').trim();
  const chars = normalized.length;
  const distinctChars = new Set(normalized.replace(/\s+/g, '').split('')).size;
  const lines = evidence
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  const uniqueLineRatio = lines.length > 0 ? new Set(lines.map((x) => x.toLowerCase())).size / lines.length : 0;
  const coverage = controlsCount > 0 ? Math.min(1, findingsCount / controlsCount) : findingsCount > 0 ? 1 : 0;
  const issues: string[] = [];
  if (chars < 120) issues.push('evidence_too_short');
  if (distinctChars < 80) issues.push('evidence_low_distinct_chars');
  if (uniqueLineRatio < 0.35) issues.push('evidence_repetitive');
  if (findingsCount > 0 && coverage < 0.7) issues.push('coverage_below_threshold');
  return { publishable: issues.length === 0, issues, coverage };
}

export default function AssessmentFlow({
  assessment,
  standards,
  controls: allControls,
  evalConcurrency = 3,
  perItemTimeoutMs = 90000,
  canViewAssessmentResults = true,
  onUpdate,
}: AssessmentFlowProps) {
  const [locale, setLocale] = useState<LocaleId>(() => getLocale());
  const T = {
    'zh-CN': {
      step1: '证据导入',
      step2: '差距分析',
      step3: '生成报告',
      start: '开始 AI 差距分析',
      engine: '自动化差距评估引擎',
      progress: '进度',
      stop: '停止分析',
      resume: '继续分析',
      rerun: '重新全量分析',
      final: '分析完成 - 查看聚合报告',
      done: '分析已完成',
      noPerm: '您暂无权限查看最终聚合报告、条款明细与导出。请联系管理员为当前角色开通「查看评估最终结果（聚合报告）」。',
      importTitle: '核心审计证据导入',
      importDesc: '导入关于该标准的访谈记录、过程文档或扫描结果',
      importPlaceholder: '在此录入原始审计数据。例如：物理机房采用指纹识别进行出入控制，所有核心数据库已部署 TLS 1.3 通信加密...',
      reading: '正在解析文件...',
      parse: '文件智能解析',
      dropNow: '可以松手上传了',
      dropHint: '拖拽文档或评估报告至此处，支持 .txt, .xlsx, .json',
      analyzing: 'AI 正在根据标准条款映射并核查审计有效性',
      backgroundHint: '离开本页后分析会在后台继续；再次进入可查看进度与已完成的条款。',
      maturityTitle: '合规成熟度评估模型 - Final',
      complianceRate: '综合合规率',
      trustLevel: '可信等级',
      exportExcel: '导出 Excel 基线清单',
      exportWord: '生成评估正式 Word',
      emptyAnalysis: '该项调研结果为空，请补充对应控制项的检查结果/访谈证据后重新分析。',
      emptyRecommendation:
        '请补充该控制项的调研证据（日志截图、配置片段、访谈记录），然后重新执行自动化差距分析。',
      analysisIncompletePrefix: '自动评估未完成：',
      retryAfterFailure:
        '请检查网络与模型配置后重试；或缩小证据文本、在系统设置中提高超时时间。',
      sheetHeader: '工作表',
      runInspector: '运行 AI 检查',
      autoDraftBadge: '自动草稿',
      analysisFinalizedBadge: '分析已定稿',
      exportChannelsTitle: '导出渠道',
      downloadPdfPack: '下载 PDF 包',
      certifiedSubtitle: '认证复核',
      reportStatNonCompliant: '不合规',
      reportStatCompliant: '完全合规',
      reportStatPartial: '部分合规',
      priorityPrefix: '优先级',
      findingCompliant: '完全合规',
      findingPartial: '部分合规',
      findingNonCompliant: '不合规',
      findingNA: '不适用',
      aiAnalysisHeading: 'AI 分析',
      aiActionPlanHeading: 'AI 整改建议',
      basedOn: '依据',
      noControlsTitle: '该标准尚未配置检查项',
      noControlsHint: '请先在「合规标准知识库」为该标准新增或导入检查项，再执行评估分析。',
    },
    'en-US': {
      step1: 'Evidence',
      step2: 'Gap Analysis',
      step3: 'Report',
      start: 'Start AI Gap Analysis',
      engine: 'Automated Gap Analysis Engine',
      progress: 'Progress',
      stop: 'Stop',
      resume: 'Resume',
      rerun: 'Re-run All',
      final: 'Analysis Completed - View Final Report',
      done: 'Analysis Completed',
      noPerm: 'You do not have permission to view final aggregated reports. Please contact admin to grant access.',
      importTitle: 'Core Audit Evidence Import',
      importDesc: 'Import interview records, process docs, or scan results related to this standard',
      importPlaceholder: 'Enter raw audit evidence here. Example: fingerprint access control for physical server room; all core databases use TLS 1.3...',
      reading: 'Parsing file...',
      parse: 'Smart File Parsing',
      dropNow: 'Release to upload',
      dropHint: 'Drag documents/reports here, supports .txt, .xlsx, .json',
      analyzing: 'AI is mapping controls and verifying audit effectiveness against this standard',
      backgroundHint: 'Analysis continues in background after leaving this page; re-open to check progress.',
      maturityTitle: 'Compliance Maturity Assessment - Final',
      complianceRate: 'Overall Compliance',
      trustLevel: 'Trust Level',
      exportExcel: 'Export Excel Baseline',
      exportWord: 'Generate Formal Word Report',
      emptyAnalysis:
        'No analysis text was returned. Add inspection or interview evidence for this control, then re-run.',
      emptyRecommendation:
        'Add evidence (logs, config excerpts, interview notes) for this control, then run automated gap analysis again.',
      analysisIncompletePrefix: 'Automatic evaluation did not complete: ',
      retryAfterFailure:
        'Check network and model settings, then retry; or shorten evidence / increase timeout in AI settings.',
      sheetHeader: 'Sheet',
      runInspector: 'Run AI inspector',
      autoDraftBadge: 'Auto-draft on',
      analysisFinalizedBadge: 'Analysis finalized',
      exportChannelsTitle: 'Export',
      downloadPdfPack: 'Download PDF pack',
      certifiedSubtitle: 'Certified review',
      reportStatNonCompliant: 'Non-compliant',
      reportStatCompliant: 'Compliant',
      reportStatPartial: 'Partial',
      priorityPrefix: 'Priority',
      findingCompliant: 'Compliant',
      findingPartial: 'Partial',
      findingNonCompliant: 'Non-compliant',
      findingNA: 'Not applicable',
      aiAnalysisHeading: 'AI analysis',
      aiActionPlanHeading: 'AI action plan',
      basedOn: 'Based on',
      noControlsTitle: 'No controls configured for this standard',
      noControlsHint: 'Add or import controls for this standard in Standards first, then run the assessment.',
    },
  } as const;
  const t = (k: keyof (typeof T)['zh-CN']) => T[locale][k] || T['zh-CN'][k];

  const findingStatusLabel = (s: Finding['status']) => {
    if (s === 'Compliant') return t('findingCompliant');
    if (s === 'Partial') return t('findingPartial');
    if (s === 'Non-Compliant') return t('findingNonCompliant');
    return t('findingNA');
  };

  useEffect(() => {
    const onLocale = (e: Event) => {
      const next = (e as CustomEvent<LocaleId>).detail;
      if (next === 'en-US' || next === 'zh-CN') setLocale(next);
    };
    window.addEventListener('app-locale-change', onLocale as EventListener);
    return () => window.removeEventListener('app-locale-change', onLocale as EventListener);
  }, []);
  const patch = (next: Assessment | ((prev: Assessment) => Assessment)) => {
    onUpdate(assessment.id, next);
  };
  const [step, setStep] = useState<1 | 2 | 3>(() => initialStep(assessment, canViewAssessmentResults));
  const [evidenceText, setEvidenceText] = useState(() => assessment.evidenceText ?? '');
  const [isDragging, setIsDragging] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isPrechecking, setIsPrechecking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runAnalysisLoopRef = useRef<(opts: { clearFindings: boolean }) => Promise<void>>(async () => {});

  const currentStandard = standards.find(s => s.id === assessment.standardId);
  const currentControls = currentStandard ? (allControls[currentStandard.id] || []) : [];

  const inProgressRun =
    assessment.status === 'In Progress' &&
    currentControls.length > 0 &&
    assessment.findings.length < currentControls.length;

  const isAnalyzing = inProgressRun;
  const hasControls = currentControls.length > 0;

  const activeAnalysisId =
    inProgressRun && assessment.findings.length < currentControls.length
      ? currentControls[assessment.findings.length]?.id ?? null
      : null;

  useEffect(() => {
    setEvidenceText(assessment.evidenceText ?? '');
    setStep(initialStep(assessment, canViewAssessmentResults));
  }, [assessment.id, canViewAssessmentResults]);

  useEffect(() => {
    if (assessment.status === 'Completed' && assessment.findings.length > 0 && canViewAssessmentResults) {
      setStep(3);
    }
  }, [assessment.status, assessment.findings.length, assessment.id, canViewAssessmentResults]);

  useEffect(() => {
    if (!canViewAssessmentResults) {
      setStep((s) => (s === 3 ? 2 : s));
    }
  }, [canViewAssessmentResults]);

  useEffect(() => {
    if (assessment.status !== 'In Progress') return;
    if (!assessment.evidenceText?.trim()) return;
    if (assessment.findings.length >= currentControls.length) return;
    if (currentControls.length === 0) return;
    if (isAssessmentAnalysisRunning(assessment.id)) return;

    void runAnalysisLoopRef.current({ clearFindings: false });
  }, [assessment.id, assessment.status, assessment.evidenceText, assessment.findings.length, currentControls.length]);

  const compliantCount = assessment.findings.filter((f) => f.status === 'Compliant').length;
  const nonCompliantCount = assessment.findings.filter((f) => f.status === 'Non-Compliant').length;
  const partialCount = assessment.findings.filter((f) => f.status === 'Partial').length;

  const handleFile = (file: File) => {
    if (!file) return;
    
    setIsReadingFile(true);
    const fileName = file.name.toLowerCase();
    
    // Handle Excel files
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          let extractedText = "";

          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            // Convert sheet to text format
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            extractedText += `\n--- ${t('sheetHeader')}: ${sheetName} ---\n`;
            json.forEach((row: any) => {
              if (Array.isArray(row)) {
                extractedText += row.join(" | ") + "\n";
              }
            });
          });

          setEvidenceText(prev => prev ? prev + "\n" + extractedText : extractedText);
          setIsReadingFile(false);
        } catch (error) {
          console.error("Excel Parsing Error:", error);
          setIsReadingFile(false);
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // Handle Text-based files
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setEvidenceText(prev => prev ? prev + "\n---\n" + text : text);
      setIsReadingFile(false);
    };
    
    reader.onerror = () => {
      console.error("Error reading file");
      setIsReadingFile(false);
    };

    reader.readAsText(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  runAnalysisLoopRef.current = async (opts: { clearFindings: boolean }) => {
    const id = assessment.id;
    if (isAssessmentAnalysisRunning(id)) return;

    const evidence = (evidenceText.trim() || assessment.evidenceText || '').trim();
    if (!evidence) return;
    if (currentControls.length === 0) return;
    const inputFingerprint = simpleHash(
      JSON.stringify({
        standardId: assessment.standardId,
        evidence,
        controls: currentControls.map((c) => c.id),
      })
    );
    const cache = loadAnalysisCache();
    const cached = cache[inputFingerprint];
    if (opts.clearFindings && cached && Array.isArray(cached.findings) && cached.findings.length > 0) {
      patch((prev) => ({
        ...prev,
        evidenceText: evidence,
        findings: cached.findings,
        status: 'Completed',
        updatedAt: new Date().toISOString(),
      }));
      if (canViewAssessmentResults) setStep(3);
      return;
    }

    const ac = new AbortController();
    registerAnalysisRun(id, ac);

    let findingsSoFar = opts.clearFindings ? [] : [...assessment.findings];
    const ts = () => new Date().toISOString();

    try {
      patch((prev) => ({
        ...prev,
        evidenceText: evidence,
        status: 'In Progress',
        findings: opts.clearFindings ? [] : prev.findings,
        updatedAt: ts(),
      }));
      if (opts.clearFindings) findingsSoFar = [];

      const pendingControls = currentControls.filter((control) => !findingsSoFar.some((f) => f.controlId === control.id));
      const BATCH_SIZE = [2, 3, 5].includes(Number(evalConcurrency)) ? Number(evalConcurrency) : 3;
      const timeoutMs = Number.isFinite(Number(perItemTimeoutMs))
        ? Math.min(300000, Math.max(15000, Number(perItemTimeoutMs)))
        : 90000;
      for (let i = 0; i < pendingControls.length; i += BATCH_SIZE) {
        if (ac.signal.aborted) break;
        const batch = pendingControls.slice(i, i + BATCH_SIZE);
        const settled = await Promise.allSettled(
          batch.map(async (control) => {
            const result = (await Promise.race([
              performGapAnalysis(control, evidence),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(
                        locale === 'en-US'
                          ? `Auto evaluation timed out (>${timeoutMs}ms)`
                          : `单项自动评估超时（>${timeoutMs}ms）`
                      )
                    ),
                  timeoutMs
                )
              ),
            ])) as GapAnalysisResult;
            const status: Finding['status'] = result.status || 'Non-Compliant';
            const attentionState: Finding['attentionState'] =
              status === 'Partial' || status === 'Non-Compliant' ? 'pending' : 'resolved';
            const evidenceSnippet = evidence.length > 500 ? `${evidence.slice(0, 500)}…` : evidence;
            const evidenceField = (result.evidenceExcerpt?.trim() || evidenceSnippet).slice(0, 15_000);
            const newFinding: Finding = {
              controlId: control.id,
              status,
              attentionState,
              evidence: evidenceField,
              analysis: (result.analysis || '').trim() || t('emptyAnalysis'),
              recommendation: (result.recommendation || '').trim() || t('emptyRecommendation'),
            };
            return newFinding;
          })
        );
        if (ac.signal.aborted) break;
        const batchFindings: Finding[] = settled.map((entry, idx) => {
          if (entry.status === 'fulfilled') return entry.value;
          const control = batch[idx];
          const reason = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
          const evidenceSnippet = evidence.length > 500 ? `${evidence.slice(0, 500)}…` : evidence;
          return {
            controlId: control.id,
            status: 'Non-Compliant' as const,
            attentionState: 'pending' as const,
            evidence: evidenceSnippet,
            analysis: `${t('analysisIncompletePrefix')}${reason}`,
            recommendation: t('retryAfterFailure'),
          };
        });
        findingsSoFar = [...findingsSoFar, ...batchFindings];
        patch((prev) => ({
          ...prev,
          findings: findingsSoFar,
          evidenceText: evidence,
          status: 'In Progress',
          updatedAt: ts(),
        }));
      }

      if (ac.signal.aborted) {
        patch((prev) => ({
          ...prev,
          findings: findingsSoFar,
          evidenceText: evidence,
          status: findingsSoFar.length > 0 ? 'Draft' : prev.status,
          updatedAt: ts(),
        }));
        return;
      }
      const qualityGate = estimatePublishableGate(evidence, findingsSoFar.length, currentControls.length);

      patch((prev) => ({
        ...prev,
        findings: findingsSoFar,
        evidenceText: evidence,
        status: qualityGate.publishable ? 'Completed' : 'Draft',
        updatedAt: ts(),
      }));
      cache[inputFingerprint] = { findings: findingsSoFar, ts: Date.now() };
      saveAnalysisCache(cache);
      if (canViewAssessmentResults && qualityGate.publishable) {
        setStep(3);
      }
    } finally {
      unregisterAnalysisRun(id);
    }
  };

  const handleStopAnalysis = () => {
    abortAssessmentAnalysis(assessment.id);
  };

  const handleExport = async (format: 'excel' | 'word' | 'pdf') => {
    if (!canViewAssessmentResults) return;
    const summary = await generateExecutiveSummary(currentStandard?.name || "", assessment.findings, currentControls);
    
    if (format === 'excel') EXPORT_SERVICE.exportToExcel(assessment.findings, currentControls, currentStandard?.name || "");
    if (format === 'word') EXPORT_SERVICE.exportToWord(assessment.findings, currentControls, currentStandard?.name || "", summary);
    if (format === 'pdf') EXPORT_SERVICE.exportToPDF(assessment.findings, currentControls, currentStandard?.name || "");
    void postReportDownloadEvent({
      format,
      assessmentId: assessment.id,
      standardId: assessment.standardId,
    }).catch(() => {});
  };

  return (
    <div className="space-y-12">
      {/* Step Indicator */}
      <div className="flex items-center justify-center max-w-3xl mx-auto py-4">
        {[
          { num: 1, label: t('step1'), icon: Upload },
          { num: 2, label: t('step2'), icon: Brain },
          { num: 3, label: t('step3'), icon: Download },
        ].map((s, i) => (
          <React.Fragment key={s.num}>
            <div className="flex flex-col items-center gap-3">
              <div className={cn(
                "w-14 h-14 rounded-2xl flex items-center justify-center border-2 transition-all duration-500 shadow-sm",
                step >= s.num 
                  ? "bg-accent border-accent text-white shadow-blue-400/20" 
                  : "bg-white/40 border-white/60 text-text-main/30 backdrop-blur-sm"
              )}>
                <s.icon size={24} />
              </div>
              <span className={cn(
                "text-[10px] font-black uppercase tracking-widest", 
                step >= s.num ? "text-accent" : "text-text-main/40"
              )}>
                {s.label}
              </span>
            </div>
            {i < 2 && (
              <div className={cn(
                "h-1.5 w-32 mx-6 rounded-full transition-all duration-700 overflow-hidden bg-white/30 border border-white/20",
              )}>
                <div className={cn(
                  "h-full bg-accent transition-all duration-700",
                  step > s.num ? "w-full" : "w-0"
                )}></div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: Import */}
      {step === 1 && (
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 lg:grid-cols-5 gap-10"
        >
          <div className="lg:col-span-3 space-y-6">
            <div>
              <h3 className="text-2xl font-black mb-2">{t('importTitle')}</h3>
              <p className="text-text-main/60 font-medium italic">"{t('importDesc')}"</p>
            </div>
            
            <div className="relative group">
              <textarea 
                value={evidenceText}
                onChange={(e) => setEvidenceText(e.target.value)}
                placeholder={t('importPlaceholder')}
                className="w-full h-[450px] p-8 glass-card bg-white/20 border-white/40 focus:bg-white/40 focus:ring-4 focus:ring-accent/10 transition-all text-sm leading-loose outline-none"
              />
              <div className="absolute top-4 right-4 flex gap-2">
                <div className="px-2 py-1 bg-accent/10 text-accent text-[10px] font-bold rounded uppercase">{t('autoDraftBadge')}</div>
              </div>
            </div>
          </div>
          
          <div className="lg:col-span-2 flex flex-col gap-6">
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileInputChange} 
              className="hidden" 
              accept=".txt,.json,.csv,.md,.xlsx,.xls"
            />
            <div 
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex-1 glass-card border-dashed border-2 flex flex-col items-center justify-center p-12 transition-all cursor-pointer group relative overflow-hidden",
                isDragging ? "border-accent bg-accent/5 scale-[1.02]" : "border-white/60 bg-white/10 hover:bg-white/20",
                isReadingFile ? "cursor-wait" : ""
              )}
            >
              <div className={cn(
                "w-20 h-20 rounded-3xl flex items-center justify-center mb-6 transition-all duration-500 shadow-inner",
                isDragging ? "bg-accent text-white" : "bg-accent/10 text-accent group-hover:scale-110 group-hover:bg-accent group-hover:text-white"
              )}>
                {isReadingFile ? <Loader2 size={36} className="animate-spin" /> : <Upload size={36} />}
              </div>
              <p className="font-black text-xl mb-2 text-center">
                {isReadingFile ? t('reading') : t('parse')}
              </p>
              <p className="text-sm text-text-main/50 text-center leading-relaxed font-medium">
                {isDragging ? t('dropNow') : (
                  <>{t('dropHint')}</>
                )}
              </p>

              {/* Success overlay or mini preview could go here if multiple files supported */}
            </div>
            
            <button
              type="button"
              onClick={async () => {
                const trimmed = evidenceText.trim();
                if (!trimmed) return;
                if (!hasControls) {
                  window.alert(`${t('noControlsTitle')}。${t('noControlsHint')}`);
                  return;
                }
                setIsPrechecking(true);
                try {
                  const precheck = await postAssessmentPrecheck({
                    ...assessment,
                    evidenceText: trimmed,
                    findings: assessment.findings || [],
                    updatedAt: new Date().toISOString(),
                  });
                  const blockingIssues = (precheck.issues || []).filter((x) =>
                    ['evidence_too_short', 'evidence_low_distinct_chars', 'evidence_repetitive', 'evidence_placeholder_like_text'].includes(x)
                  );
                  if (blockingIssues.length > 0) {
                    const proceed = window.confirm(
                      locale === 'en-US'
                        ? `Input quality may be too low (${blockingIssues.join(', ')}). Continue anyway?`
                        : `输入质量可能偏低（${blockingIssues.join('、')}），继续评估可能浪费 AI 资源。是否继续？`
                    );
                    if (!proceed) return;
                  }
                } catch (error) {
                  console.warn('Assessment precheck failed:', error);
                } finally {
                  setIsPrechecking(false);
                }
                patch((prev) => ({
                  ...prev,
                  evidenceText: trimmed,
                  updatedAt: new Date().toISOString(),
                }));
                setStep(2);
              }}
              disabled={!evidenceText.trim() || isReadingFile || !hasControls || isPrechecking}
              className="glass-button w-full py-5 text-lg font-black tracking-tight disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPrechecking ? t('reading') : t('start')}
            </button>
            {!hasControls ? (
              <p className="text-xs font-semibold text-warning-main bg-warning-main/10 border border-warning-main/20 rounded-xl px-3 py-2">
                {t('noControlsHint')}
              </p>
            ) : null}
          </div>
        </motion.div>
      )}

      {/* Step 2: Analysis */}
      {step === 2 && (
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-5xl mx-auto pb-20"
        >
          <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-12 glass-card p-6 bg-accent/5">
            <div className="flex-1">
              <h3 className="text-2xl font-black mb-1 flex items-center gap-3">
                <Brain className="text-accent" /> {t('engine')}
              </h3>
              <p className="text-text-main/60 font-medium">{t('analyzing')}</p>
              <p className="text-sm font-bold text-accent/90 mt-2">
                {t('backgroundHint')}
              </p>
            </div>
            <div className="flex flex-col items-stretch sm:items-end gap-3 w-full md:w-auto">
              {isAnalyzing && (
                <div className="flex flex-wrap items-center gap-3 justify-end">
                  <span className="text-sm font-black text-accent flex items-center gap-2">
                    <Loader2 size={18} className="animate-spin" />
                    {t('progress')} {assessment.findings.length}/{currentControls.length}
                  </span>
                  <button
                    type="button"
                    onClick={handleStopAnalysis}
                    className="glass-button flex items-center gap-2 px-6 py-2.5 border border-danger-main/40 text-danger-main font-black text-sm"
                  >
                    <XCircle size={18} />
                    {t('stop')}
                  </button>
                </div>
              )}
              {!isAnalyzing && assessment.findings.length === 0 && (
                <button
                  type="button"
                  onClick={() => void runAnalysisLoopRef.current({ clearFindings: true })}
                  className="glass-button flex items-center gap-3 px-8 transform hover:translate-x-1"
                >
                  <Brain size={22} />
                  {t('runInspector')}
                </button>
              )}
              {!isAnalyzing && assessment.findings.length > 0 && assessment.status !== 'Completed' && (
                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => void runAnalysisLoopRef.current({ clearFindings: false })}
                    className="glass-button flex items-center gap-2 px-6 py-2.5 font-black text-sm"
                  >
                    <Brain size={18} />
                    {t('resume')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAnalysisLoopRef.current({ clearFindings: true })}
                    className="glass-button flex items-center gap-2 px-6 py-2.5 font-black text-sm border border-warning-main/50 text-warning-main"
                  >
                    {t('rerun')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-6">
            {!hasControls ? (
              <div className="glass-card border border-warning-main/30 bg-warning-main/5 p-5 text-sm">
                <p className="font-black text-warning-main mb-1">{t('noControlsTitle')}</p>
                <p className="text-text-main/70">{t('noControlsHint')}</p>
              </div>
            ) : null}
            {currentControls.map(control => (
              <div 
                key={control.id}
                className={cn(
                  "p-6 glass-card transition-all duration-500 relative group",
                  activeAnalysisId === control.id ? "border-accent ring-8 ring-accent/5 bg-white/60" : "bg-white/20",
                  assessment.findings.some(f => f.controlId === control.id) ? "border-success-main/40 bg-success-main/5" : ""
                )}
              >
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-4">
                    <span className="w-12 h-12 rounded-xl bg-white/50 border border-white/60 flex items-center justify-center font-black text-xs text-accent">
                      {control.id}
                    </span>
                    <div>
                      <h4 className="font-black text-lg group-hover:text-accent transition-colors">{control.name}</h4>
                      <div className="flex gap-2 mt-1">
                        <span className={cn(
                          "text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full",
                          control.priority === 'High' ? "bg-danger-main/10 text-danger-main" : "bg-warning-main/10 text-warning-main"
                        )}>
                          {t('priorityPrefix')}: {control.priority}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {activeAnalysisId === control.id ? (
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                    >
                      <Brain size={24} className="text-accent" />
                    </motion.div>
                  ) : assessment.findings.some(f => f.controlId === control.id) ? (
                    <CheckCircle2 size={24} className="text-success-main" />
                  ) : null}
                </div>
                
                <div className="bg-white/30 p-4 rounded-xl text-sm font-medium text-text-main/70 border border-white/40">
                  {control.requirement}
                </div>

                {activeAnalysisId === control.id && (
                  <motion.div 
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 2.5 }}
                    className="absolute bottom-0 left-0 h-1.5 w-full bg-accent origin-left"
                  />
                )}
              </div>
            ))}
          </div>

          {assessment.findings.length > 0 && !isAnalyzing && (
            <>
              {canViewAssessmentResults ? (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => setStep(3)}
                  className="glass-button w-full mt-12 py-5 text-xl font-black bg-success-main shadow-success-main/20"
                >
                  {t('final')}
                </motion.button>
              ) : (
                <div className="glass-card w-full mt-12 p-8 border border-warning-main/25 bg-warning-main/5">
                  <p className="text-center font-black text-lg text-text-main">{t('done')}</p>
                  <p className="text-center text-sm text-text-main/65 mt-3 leading-relaxed">
                    {t('noPerm')}
                  </p>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}

      {/* Step 3: Report — 需 viewAssessmentResults */}
      {step === 3 && canViewAssessmentResults && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="space-y-10"
        >
          <div className="flex flex-col lg:flex-row justify-between items-start gap-10 glass-card p-10">
            <div className="flex-1">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-accent/10 rounded-full text-[10px] font-black text-accent uppercase tracking-widest mb-4">
                {t('analysisFinalizedBadge')}
              </div>
              <h3 className="text-4xl font-black tracking-tight mb-3">{t('maturityTitle')}</h3>
              <p className="text-lg font-medium text-text-main/50 mb-8 italic">
                {t('basedOn')} {currentStandard?.name} | {t('certifiedSubtitle')}
              </p>
              
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {[
                  {
                    label: t('complianceRate'),
                    val: `${currentControls.length > 0 ? Math.round((compliantCount / currentControls.length) * 100) : 0}%`,
                    color: 'text-accent',
                    bg: 'bg-accent/10',
                  },
                  {
                    label: t('reportStatNonCompliant'),
                    val: nonCompliantCount,
                    color: 'text-danger-main',
                    bg: 'bg-danger-main/10',
                  },
                  { label: t('reportStatCompliant'), val: compliantCount, color: 'text-success-main', bg: 'bg-success-main/10' },
                  {
                    label: t('reportStatPartial'),
                    val: partialCount,
                    color: 'text-warning-main',
                    bg: 'bg-warning-main/10',
                  },
                  { label: t('trustLevel'), val: 'Level 2', color: 'text-warning-main', bg: 'bg-warning-main/10' },
                ].map((stat, i) => (
                  <div key={i} className={cn("p-4 rounded-2xl border border-white/40 backdrop-blur-sm", stat.bg)}>
                    <p className="text-[9px] font-black uppercase tracking-wider mb-1 opacity-60">{stat.label}</p>
                    <p className={cn("text-2xl font-black", stat.color)}>{stat.val}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 w-full lg:w-72">
               <p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest mb-1 ml-1">{t('exportChannelsTitle')}</p>
              <button onClick={() => handleExport('excel')} className="glass-button bg-success-main flex items-center justify-start gap-4 px-6 py-4 shadow-success-main/10">
                <TableIcon size={20} />
                <span className="flex-1 text-left">{t('exportExcel')}</span>
              </button>
              <button onClick={() => handleExport('word')} className="glass-button bg-accent flex items-center justify-start gap-4 px-6 py-4 shadow-accent/10">
                <FileText size={20} />
                <span className="flex-1 text-left">{t('exportWord')}</span>
              </button>
              <button onClick={() => handleExport('pdf')} className="glass-button bg-danger-main flex items-center justify-start gap-4 px-6 py-4 shadow-danger-main/10">
                <Download size={20} />
                <span className="flex-1 text-left">{t('downloadPdfPack')}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {assessment.findings.map(finding => {
              const control = currentControls.find(c => c.id === finding.controlId);
              return (
                <div key={finding.controlId} className="glass-card p-6 flex flex-col group hover:-translate-y-2 transition-all duration-500">
                  <div className="flex justify-between items-start mb-6">
                    <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center font-black text-xs text-accent">
                      {control?.id}
                    </div>
                    <div className={cn(
                      "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest",
                      finding.status === 'Compliant' ? "bg-success-main/10 text-success-main" :
                      finding.status === 'Partial' ? "bg-warning-main/10 text-warning-main" : "bg-danger-main/10 text-danger-main"
                    )}>
                      {findingStatusLabel(finding.status)}
                    </div>
                  </div>

                  <h4 className="font-bold text-lg mb-2 line-clamp-1">{control?.name}</h4>
                  <p className="text-xs text-text-main/50 mb-6 italic line-clamp-2">"{control?.requirement}"</p>

                  <div className="mt-auto space-y-4 pt-6 border-t border-white/40">
                    <div className="relative">
                      <h5 className="text-[9px] font-black text-accent uppercase tracking-widest mb-2 flex items-center gap-2">
                        <Search size={12} /> {t('aiAnalysisHeading')}
                      </h5>
                      <p className="text-xs font-medium leading-relaxed opacity-80">{finding.analysis}</p>
                    </div>
                    <div className="relative p-3 rounded-xl bg-white/40 border border-white/60">
                      <h5 className="text-[9px] font-black text-warning-main uppercase tracking-widest mb-2 flex items-center gap-2">
                        <AlertCircle size={12} /> {t('aiActionPlanHeading')}
                      </h5>
                      <p className="text-xs font-bold leading-relaxed text-warning-main/90">{finding.recommendation}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}
