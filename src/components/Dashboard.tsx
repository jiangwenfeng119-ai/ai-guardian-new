import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Shield, CheckCircle2, AlertCircle, Clock, Brain, Download, X } from 'lucide-react';
import { Assessment } from '../types';
import { cn } from '../lib/utils';
import { aggregateAllFindings, complianceRateByStandard, pieDataFromFindings } from '../utils/dashboardAggregate';
import type { StandardCatalogEntry } from '../constants/standardsCatalog';
import { EXPORT_SERVICE } from '../services/export';
import { getLocale, type LocaleId } from '../i18n';

interface DashboardProps {
  assessments: Assessment[];
  deepEvalTasks?: Array<{
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
  }>;
  onUpdateAttentionState?: (
    assessmentId: string,
    controlId: string,
    nextState: 'pending' | 'processing' | 'resolved'
  ) => void;
  onSelectAssessment: (id: string) => void;
  onDeepEvaluate: () => void;
  deepEvaluating?: boolean;
  deepEvalNotice?: string | null;
  customStandardsCatalog?: StandardCatalogEntry[];
}

export default function Dashboard({
  assessments,
  deepEvalTasks = [],
  onUpdateAttentionState,
  onSelectAssessment,
  onDeepEvaluate,
  deepEvaluating = false,
  deepEvalNotice = null,
  customStandardsCatalog = [],
}: DashboardProps) {
  const [deepTasksOpen, setDeepTasksOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [selectedAttentionKeys, setSelectedAttentionKeys] = useState<string[]>([]);
  const [locale, setLocale] = useState<LocaleId>(() => getLocale());
  const tx = (zh: string, en: string) => (locale === 'en-US' ? en : zh);
  React.useEffect(() => {
    const onLocale = (e: Event) => {
      const next = (e as CustomEvent<LocaleId>).detail;
      if (next === 'en-US' || next === 'zh-CN') setLocale(next);
    };
    window.addEventListener('app-locale-change', onLocale as EventListener);
    return () => window.removeEventListener('app-locale-change', onLocale as EventListener);
  }, []);

  const agg = useMemo(() => aggregateAllFindings(assessments), [assessments]);
  const barData = useMemo(
    () => complianceRateByStandard(assessments, customStandardsCatalog),
    [assessments, customStandardsCatalog]
  );
  const pieData = useMemo(() => pieDataFromFindings(agg), [agg]);
  const avgRate = agg.avgTaskComplianceRatePct;
  const complianceDisplay = avgRate !== null ? `${avgRate}%` : '—';

  const attentionItems = useMemo(
    () =>
      assessments.flatMap((a) =>
        a.findings
          .filter(
            (f) =>
              (f.status === 'Partial' || f.status === 'Non-Compliant') &&
              (f.attentionState || 'pending') !== 'resolved'
          )
          .map((f) => ({
            assessmentId: a.id,
            assessmentName: a.name,
            controlId: f.controlId,
            status: f.status,
            attentionState: f.attentionState || 'pending',
            analysis: f.analysis,
            recommendation: f.recommendation,
          }))
      ),
    [assessments]
  );
  const attentionCount = attentionItems.length;
  const processingAttentionCount = attentionItems.filter((it) => it.attentionState === 'processing').length;
  /** 右下角圆环：processing 待关注项 / 当前待关注项总数 */
  const attentionResponsePct =
    attentionCount === 0 ? null : Math.round((processingAttentionCount / attentionCount) * 100);
  const ringRatio = attentionCount === 0 ? 0 : processingAttentionCount / attentionCount;
  /** 与下方 SVG viewBox 0 0 192 192 中圆半径一致，避免与外层 border 叠出双层错位 */
  const readinessRingRadius = 84;
  const readinessRingStroke = 10;
  const circumference = 2 * Math.PI * readinessRingRadius;
  const dashOffset = circumference * (1 - ringRatio);

  const ctaSummary = useMemo(() => {
    const done = assessments.filter((a) => a.status === 'Completed').length;
    const gaps = agg.nonCompliant + agg.partial;
    if (done === 0 && agg.findingTotal === 0) {
      return tx(
        '完成评估并生成检查项后，系统将在此汇总合规缺口与整改优先级。',
        'After assessments generate findings, the system summarizes compliance gaps and priorities here.'
      );
    }
    if (agg.findingTotal === 0) {
      return tx(
        `当前已有 ${done} 条已完成评估，尚未生成检查项结果。`,
        `${done} assessments are completed, but findings are not generated yet.`
      );
    }
    return tx(
      `当前已完成 ${done} 条评估，共 ${agg.findingTotal} 条检查项；其中 ${gaps} 条需关注。可以点击下面按钮进行深度评估并提供更准确专业的整改建议。`,
      `${done} assessments are completed with ${agg.findingTotal} findings, including ${gaps} attention items. Start deep evaluation for more accurate technical recommendations.`
    );
  }, [assessments, agg, locale]);
  const selectedAttentionSet = useMemo(() => new Set(selectedAttentionKeys), [selectedAttentionKeys]);
  const attentionKey = (assessmentId: string, controlId: string) => `${assessmentId}::${controlId}`;
  const allAttentionKeys = useMemo(
    () => attentionItems.map((it) => attentionKey(it.assessmentId, it.controlId)),
    [attentionItems]
  );
  const allSelected = allAttentionKeys.length > 0 && allAttentionKeys.every((k) => selectedAttentionSet.has(k));
  React.useEffect(() => {
    setSelectedAttentionKeys((prev) => prev.filter((k) => allAttentionKeys.includes(k)));
  }, [allAttentionKeys]);

  const deepTaskStats = useMemo(
    () => ({
      total: deepEvalTasks.length,
      running: deepEvalTasks.filter((t) => t.status === 'running').length,
      completed: deepEvalTasks.filter((t) => t.status === 'completed').length,
      failed: deepEvalTasks.filter((t) => t.status === 'failed').length,
    }),
    [deepEvalTasks]
  );

  const exportDeepTaskReport = (task: NonNullable<DashboardProps['deepEvalTasks']>[number]) => {
    const blob = new Blob([JSON.stringify(task, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deep-eval-report-${task.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        {[
          {
            label: tx('正在进行的评估', 'Assessments In Progress'),
            value: assessments.filter((a) => a.status === 'In Progress').length,
            icon: Clock,
            color: 'text-accent',
            bg: 'bg-accent/10',
          },
          {
            label: tx('已完成分析', 'Completed Assessments'),
            value: assessments.filter((a) => a.status === 'Completed').length,
            icon: CheckCircle2,
            color: 'text-success-main',
            bg: 'bg-success-main/10',
          },
          { label: tx('平均合规率', 'Average Compliance'), value: complianceDisplay, icon: Shield, color: 'text-accent', bg: 'bg-accent/10' },
          { label: tx('待关注项', 'Attention Items'), value: attentionCount > 0 ? attentionCount : '—', icon: AlertCircle, color: 'text-warning-main', bg: 'bg-warning-main/10' },
        ].map((stat, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              if (stat.label === tx('待关注项', 'Attention Items')) setAttentionOpen(true);
            }}
            className={cn(
              'glass-card p-6 flex items-center gap-5 text-left w-full',
              stat.label === tx('待关注项', 'Attention Items') ? 'hover:bg-white/60 transition-colors' : ''
            )}
          >
            <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center', stat.bg)}><stat.icon size={28} className={stat.color} /></div>
            <div><p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest mb-1">{stat.label}</p><p className="text-3xl font-black">{stat.value}</p></div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="glass-card p-8">
          <h3 className="text-sm font-black text-text-main/40 uppercase tracking-widest mb-8">{tx('按标准合规率', 'Compliance by Standard')}</h3>
          <div className="h-72">
            {barData.length === 0 ? <div className="h-full flex items-center justify-center text-sm text-text-main/45">{tx('暂无已完成评估数据', 'No completed assessment data')}</div> : (
              <ResponsiveContainer width="100%" height="100%"><BarChart data={barData}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" /><XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} interval={0} angle={-12} textAnchor="end" height={56} /><YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={40} fontSize={10} /><Tooltip formatter={(v: number) => [`${v}%`, tx('合规率', 'Compliance')]} /><Bar dataKey="value" fill="#4a90e2" radius={[6, 6, 0, 0]} barSize={32} /></BarChart></ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="glass-card p-8">
          <h3 className="text-sm font-black text-text-main/40 uppercase tracking-widest mb-8">{tx('总体合规状态分布', 'Overall Compliance Distribution')}</h3>
          <div className="h-72 flex items-center">
            {pieData.length === 0 ? <div className="w-full text-center text-sm text-text-main/45">{tx('暂无状态分布', 'No status distribution')}</div> : (
              <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} innerRadius={70} outerRadius={100} paddingAngle={8} dataKey="value" stroke="none">{pieData.map((entry, index) => <Cell key={index} fill={entry.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="glass-card bg-accent p-10 relative overflow-hidden text-white border-none">
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-10">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 rounded-full text-[10px] font-black uppercase tracking-widest mb-4"><Brain size={14} /> AI Recommendation Engine</div>
            <h3 className="text-3xl font-black mb-4 tracking-tight leading-tight">{tx('优化您的安全合规链路', 'Optimize Your Security Compliance Workflow')}</h3>
            <p className="text-white/80 font-medium text-lg leading-relaxed mb-8">{ctaSummary}</p>
            <div className="flex gap-4">
              <button onClick={onDeepEvaluate} disabled={deepEvaluating} className="bg-white text-accent px-8 py-3 rounded-xl text-sm font-black disabled:opacity-60">{deepEvaluating ? tx('深度评估中…', 'Deep Evaluation Running...') : tx('启动深度评估', 'Start Deep Evaluation')}</button>
              <button type="button" onClick={() => setDeepTasksOpen(true)} className="bg-white/10 text-white px-8 py-3 rounded-xl text-sm font-black border border-white/20 disabled:opacity-50" disabled={deepEvalTasks.length === 0}>{tx('查看任务详情', 'View Task Details')}</button>
            </div>
            {deepEvalNotice ? <p className="mt-4 text-xs font-semibold text-white/85 bg-white/10 border border-white/25 rounded-lg px-3 py-2">{deepEvalNotice}</p> : null}
          </div>
          <div className="relative w-48 h-48 shrink-0">
            <svg
              viewBox="0 0 192 192"
              className="block h-full w-full -rotate-90"
              aria-hidden
            >
              <circle
                cx="96"
                cy="96"
                r={readinessRingRadius}
                fill="none"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth={readinessRingStroke}
              />
              <circle
                cx="96"
                cy="96"
                r={readinessRingRadius}
                fill="none"
                stroke="white"
                strokeWidth={readinessRingStroke}
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
              />
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-5xl font-black">
                {attentionResponsePct !== null ? `${attentionResponsePct}%` : '—'}
              </span>
              <span className="text-[10px] font-black uppercase tracking-widest opacity-60">
                {tx('总体待响应', 'Overall Pending Response')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {deepTasksOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeepTasksOpen(false)} />
          <div className="relative z-10 w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl">
            <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between">
              <div><h3 className="text-lg font-black">{tx('深度评估任务详情', 'Deep Evaluation Task Details')}</h3><p className="text-xs text-text-main/55 mt-1">{tx('展示历史任务、当前运行状态与报告导出', 'History, runtime status, and export')}</p></div>
              <button type="button" className="p-2 rounded-lg hover:bg-black/5" onClick={() => setDeepTasksOpen(false)}><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-auto max-h-[calc(88vh-70px)]">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl border border-black/10 bg-white/60 px-3 py-2"><p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest">{tx('总任务', 'Total')}</p><p className="text-xl font-black">{deepTaskStats.total}</p></div>
                <div className="rounded-xl border border-accent/20 bg-accent/10 px-3 py-2"><p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest">{tx('运行中', 'Running')}</p><p className="text-xl font-black text-accent">{deepTaskStats.running}</p></div>
                <div className="rounded-xl border border-success-main/20 bg-success-main/10 px-3 py-2"><p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest">{tx('已完成', 'Completed')}</p><p className="text-xl font-black text-success-main">{deepTaskStats.completed}</p></div>
                <div className="rounded-xl border border-danger-main/20 bg-danger-main/10 px-3 py-2"><p className="text-[10px] font-black text-text-main/40 uppercase tracking-widest">{tx('失败', 'Failed')}</p><p className="text-xl font-black text-danger-main">{deepTaskStats.failed}</p></div>
              </div>
              <div className="space-y-3">
                {deepEvalTasks.length === 0 ? (
                  <p className="text-sm text-text-main/60">{tx('暂无深度评估任务记录', 'No deep evaluation tasks yet')}</p>
                ) : (
                  deepEvalTasks.map((task) => (
                    <div key={task.id} className="rounded-xl border border-black/10 bg-white/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-bold text-sm">{task.id}</p>
                        <span className={cn('text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full', task.status === 'completed' ? 'bg-success-main/15 text-success-main' : task.status === 'running' ? 'bg-accent/15 text-accent' : 'bg-danger-main/15 text-danger-main')}>
                          {task.status === 'completed' ? tx('已完成', 'Completed') : task.status === 'running' ? tx('运行中', 'Running') : tx('失败', 'Failed')}
                        </span>
                      </div>
                      <p className="text-xs text-text-main/60 mt-1">{tx('进度', 'Progress')}: {task.done}/{task.total} · {tx('更新项', 'Updated')}: {task.updatedFindings} · {tx('影响任务', 'Affected Tasks')}: {task.affectedAssessmentIds.length}</p>
                      <p className="text-xs text-text-main/55 mt-1">{tx('开始', 'Started')}: {new Date(task.startedAt).toLocaleString()}{task.finishedAt ? ` · ${tx('完成', 'Finished')}: ${new Date(task.finishedAt).toLocaleString()}` : ''}</p>
                      {task.reportSummary ? <p className="text-xs text-text-main/75 mt-2">{task.reportSummary}</p> : null}
                      {task.error ? <p className="text-xs text-danger-main mt-2">{task.error}</p> : null}
                      {Array.isArray(task.itemRuns) && task.itemRuns.length > 0 ? (
                        <details className="mt-3 rounded-lg border border-black/10 bg-white/70 p-2">
                          <summary className="cursor-pointer text-[11px] font-black text-text-main/70">
                            {tx('单条控制项耗时与错误原因', 'Per-Control Duration and Error')} ({task.itemRuns.length})
                          </summary>
                          <div className="mt-2 max-h-40 overflow-auto space-y-1">
                            {task.itemRuns.map((r, idx) => (
                              <div key={`${r.assessmentId}-${r.controlId}-${idx}`} className="text-[11px] rounded-md border border-black/10 px-2 py-1 bg-white/70">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold truncate">{r.controlId} · {r.assessmentId}</span>
                                  <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-black', r.status === 'updated' ? 'bg-success-main/15 text-success-main' : 'bg-danger-main/15 text-danger-main')}>
                                    {r.status === 'updated' ? tx('成功', 'Success') : tx('失败', 'Failed')}
                                  </span>
                                </div>
                                <p className="text-text-main/60">{tx('耗时', 'Duration')}: {Math.max(0, Math.round(r.durationMs))}ms{r.error ? ` · ${tx('错误', 'Error')}: ${r.error}` : ''}</p>
                                {r.status === 'updated' && (r.analysis || r.recommendation || r.ownerTeam || r.targetDate) ? (
                                  <div className="mt-1 space-y-1 text-text-main/75">
                                    {r.analysis ? <p>{tx('分析', 'Analysis')}: {r.analysis}</p> : null}
                                    {r.recommendation ? <p>{tx('整改建议', 'Recommendation')}: {r.recommendation}</p> : null}
                                    {r.ownerTeam ? <p>{tx('建议团队', 'Suggested Team')}: {r.ownerTeam}</p> : null}
                                    {r.targetDate ? <p>{tx('建议完成时间', 'Suggested Due Date')}: {r.targetDate}</p> : null}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                      <div className="mt-3 pt-3 border-t border-black/10 flex items-center gap-2">
                        <button type="button" className="glass-card px-3 py-1.5 text-[11px] font-black uppercase tracking-widest hover:bg-white/70" onClick={() => { const first = assessments.find((a) => task.affectedAssessmentIds.includes(a.id)); if (first) onSelectAssessment(first.id); }} disabled={task.affectedAssessmentIds.length === 0}>{tx('查看相关任务', 'Open Related Task')}</button>
                        <button type="button" className="glass-card px-3 py-1.5 text-[11px] font-black uppercase tracking-widest hover:bg-white/70 flex items-center gap-1" onClick={() => exportDeepTaskReport(task)}><Download size={12} />JSON</button>
                        <button type="button" className="glass-card px-3 py-1.5 text-[11px] font-black uppercase tracking-widest hover:bg-white/70" onClick={() => void EXPORT_SERVICE.exportDeepEvalTaskToWord(task)}>WORD</button>
                        <button type="button" className="glass-card px-3 py-1.5 text-[11px] font-black uppercase tracking-widest hover:bg-white/70" onClick={() => EXPORT_SERVICE.exportDeepEvalTaskToPDF(task)}>PDF</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {attentionOpen && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAttentionOpen(false)} />
          <div className="relative z-10 w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl">
            <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black">{tx('待关注项详情', 'Attention Item Details')}</h3>
                <p className="text-xs text-text-main/55 mt-1">{tx('可切换处理状态：pending / processing / resolved', 'Switch processing state: pending / processing / resolved')}</p>
              </div>
              <button type="button" className="p-2 rounded-lg hover:bg-black/5" onClick={() => setAttentionOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="p-5 max-h-[calc(88vh-70px)] overflow-auto space-y-3">
              {attentionItems.length > 0 && (
                <div className="rounded-xl border border-black/10 bg-white/80 p-3 flex flex-wrap items-center gap-2">
                  <label className="text-xs font-semibold flex items-center gap-2 mr-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => setSelectedAttentionKeys(e.target.checked ? allAttentionKeys : [])}
                    />
                    {tx('全选', 'Select all')}
                  </label>
                  <button
                    type="button"
                    className="glass-card px-3 py-1.5 text-[11px] font-black uppercase tracking-widest"
                    onClick={() => {
                      selectedAttentionKeys.forEach((k) => {
                        const [assessmentId, controlId] = k.split('::');
                        onUpdateAttentionState?.(assessmentId, controlId, 'processing');
                      });
                    }}
                    disabled={selectedAttentionKeys.length === 0}
                  >
                    {tx('批量设为 processing', 'Bulk set processing')}
                  </button>
                  <button
                    type="button"
                    className="glass-card px-3 py-1.5 text-[11px] font-black uppercase tracking-widest"
                    onClick={() => {
                      selectedAttentionKeys.forEach((k) => {
                        const [assessmentId, controlId] = k.split('::');
                        onUpdateAttentionState?.(assessmentId, controlId, 'resolved');
                      });
                      setSelectedAttentionKeys([]);
                    }}
                    disabled={selectedAttentionKeys.length === 0}
                  >
                    {tx('批量设为 resolved', 'Bulk set resolved')}
                  </button>
                  <p className="text-xs text-text-main/55">
                    {tx('已选', 'Selected')}: {selectedAttentionKeys.length}
                  </p>
                </div>
              )}
              {attentionItems.length === 0 ? (
                <p className="text-sm text-text-main/60">{tx('当前无待关注项', 'No attention items')}</p>
              ) : (
                attentionItems.map((it) => (
                  <div key={`${it.assessmentId}-${it.controlId}`} className="rounded-xl border border-black/10 bg-white/70 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedAttentionSet.has(attentionKey(it.assessmentId, it.controlId))}
                          onChange={(e) => {
                            const key = attentionKey(it.assessmentId, it.controlId);
                            setSelectedAttentionKeys((prev) =>
                              e.target.checked ? Array.from(new Set([...prev, key])) : prev.filter((x) => x !== key)
                            );
                          }}
                        />
                        <p className="font-semibold text-sm truncate">{it.controlId} · {it.assessmentName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn('text-[10px] font-black px-2 py-0.5 rounded-full', it.status === 'Partial' ? 'bg-warning-main/15 text-warning-main' : 'bg-danger-main/15 text-danger-main')}>
                          {it.status}
                        </span>
                        <select
                          value={it.attentionState}
                          onChange={(e) =>
                            onUpdateAttentionState?.(
                              it.assessmentId,
                              it.controlId,
                              e.target.value as 'pending' | 'processing' | 'resolved'
                            )
                          }
                          className="glass-input px-2 py-1 text-xs font-semibold"
                        >
                          <option value="pending">{tx('pending', 'pending')}</option>
                          <option value="processing">{tx('processing', 'processing')}</option>
                          <option value="resolved">{tx('resolved', 'resolved')}</option>
                        </select>
                      </div>
                    </div>
                    <p className="text-xs text-text-main/75">{tx('分析', 'Analysis')}: {it.analysis || '—'}</p>
                    <p className="text-xs text-text-main/75">{tx('建议', 'Recommendation')}: {it.recommendation || '—'}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
