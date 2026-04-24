import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Standard } from '../types';
import type { CompanyProfile, ProjectProfile } from '../permissions';
import type { LocaleId } from '../i18n';

export interface NewAssessmentModalProps {
  open: boolean;
  /** 与顶栏语言一致；缺省为 zh-CN */
  locale?: LocaleId;
  onClose: () => void;
  /** 可选合规标准（内置 + 自定义合并） */
  standards: Standard[];
  companies: CompanyProfile[];
  projects: ProjectProfile[];
  visibleCompanyIds?: string[];
  visibleProjectIds?: string[];
  onConfirm: (payload: { standardId: string; customerName: string; projectName: string; companyId: string; projectId: string }) => void;
}

export function buildAssessmentDisplayName(standardName: string, customerName: string, projectName: string): string {
  const c = customerName.trim();
  const p = projectName.trim();
  return `${standardName} · ${c} · ${p}`;
}

const MODAL_COPY = {
  'zh-CN': {
    title: '新建分析引擎',
    subtitle: '请选择合规标准并填写客户与项目信息，系统将据此生成评估任务名称。',
    close: '关闭',
    standard: '合规标准',
    company: '客户公司（权限内）',
    project: '项目（权限内）',
    pickCompany: '请选择客户公司',
    pickProject: '请选择项目',
    prefilled: '已自动带出',
    previewTitle: '任务名称预览',
    cancel: '取消',
    submit: '创建并进入',
  },
  'en-US': {
    title: 'New assessment',
    subtitle: 'Pick a standard and company/project (within your access). The task name is generated from these fields.',
    close: 'Close',
    standard: 'Compliance standard',
    company: 'Company (within access)',
    project: 'Project (within access)',
    pickCompany: 'Select a company',
    pickProject: 'Select a project',
    prefilled: 'Prefilled',
    previewTitle: 'Task name preview',
    cancel: 'Cancel',
    submit: 'Create and open',
  },
} as const;

export default function NewAssessmentModal({
  open,
  locale = 'zh-CN',
  onClose,
  onConfirm,
  standards,
  companies,
  projects,
  visibleCompanyIds = [],
  visibleProjectIds = [],
}: NewAssessmentModalProps) {
  const m = MODAL_COPY[locale] || MODAL_COPY['zh-CN'];
  const [standardId, setStandardId] = useState(standards[0]?.id ?? '');
  const [companyId, setCompanyId] = useState('');
  const [projectId, setProjectId] = useState('');
  const scopedCompanies = companies.filter((c) => visibleCompanyIds.length === 0 || visibleCompanyIds.includes(c.id));
  const scopedProjects = projects.filter(
    (p) =>
      (!companyId || p.companyId === companyId) &&
      (visibleProjectIds.length === 0 || visibleProjectIds.includes(p.id))
  );

  useEffect(() => {
    if (open) {
      setStandardId((id) => standards.find((s) => s.id === id)?.id ?? standards[0]?.id ?? '');
      const defaultCompany = scopedCompanies[0]?.id ?? '';
      const defaultProject =
        projects.find(
          (p) =>
            p.companyId === defaultCompany &&
            (visibleProjectIds.length === 0 || visibleProjectIds.includes(p.id))
        )?.id ?? '';
      setCompanyId(defaultCompany);
      setProjectId(defaultProject);
    }
  }, [open]);

  if (!open) return null;

  const selectedCompany = scopedCompanies.find((c) => c.id === companyId);
  const selectedProject = scopedProjects.find((p) => p.id === projectId);
  const customerName = selectedCompany?.name || '';
  const projectName = selectedProject?.name || '';

  const submit = () => {
    if (!standardId || !companyId || !projectId || !customerName.trim() || !projectName.trim()) return;
    onConfirm({ standardId, customerName: customerName.trim(), projectName: projectName.trim(), companyId, projectId });
  };

  const std = standards.find((s) => s.id === standardId);
  const preview = std ? buildAssessmentDisplayName(std.name, customerName || '…', projectName || '…') : '';

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-text-main/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-assessment-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-card w-full max-w-lg border-white/70 shadow-2xl p-8 space-y-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="new-assessment-title" className="text-xl font-black">
              {m.title}
            </h3>
            <p className="text-sm text-text-main/55 font-medium mt-1">{m.subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/50 text-text-main/50" aria-label={m.close}>
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{m.standard}</label>
            <select
              value={standardId}
              onChange={(e) => setStandardId(e.target.value)}
              className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
            >
              {standards.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{m.company}</label>
            <select
              value={companyId}
              onChange={(e) => {
                const id = e.target.value;
                setCompanyId(id);
                const nextProject = projects.find((p) => p.companyId === id && (visibleProjectIds.length === 0 || visibleProjectIds.includes(p.id)));
                setProjectId(nextProject?.id || '');
              }}
              className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
            >
              <option value="">{m.pickCompany}</option>
              {scopedCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{m.project}</label>
            <select
              value={projectId}
              onChange={(e) => {
                const id = e.target.value;
                setProjectId(id);
              }}
              className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
            >
              <option value="">{m.pickProject}</option>
              {scopedProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-text-main/55 font-semibold">
            {m.prefilled}：{customerName || '—'} / {projectName || '—'}
          </p>
        </div>

        <div className="rounded-xl border border-white/50 bg-white/25 px-4 py-3">
          <p className="text-[10px] font-black text-text-main/45 uppercase tracking-widest mb-1">{m.previewTitle}</p>
          <p className="text-sm font-bold text-text-main/90 leading-snug break-words">{preview}</p>
        </div>

        <div className="flex flex-wrap gap-3 justify-end pt-2">
          <button type="button" className="glass-card px-5 py-2.5 text-sm font-bold hover:bg-white/70" onClick={onClose}>
            {m.cancel}
          </button>
          <button
            type="button"
            className="glass-button px-5 py-2.5 text-sm font-bold flex items-center gap-2 disabled:opacity-50"
            onClick={submit}
            disabled={!standardId || !companyId || !projectId || !customerName.trim() || !projectName.trim()}
          >
            {m.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
