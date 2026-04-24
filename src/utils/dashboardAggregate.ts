import type { Assessment, Finding } from '../types';
import { STANDARDS_CATALOG, type StandardCatalogEntry } from '../constants/standardsCatalog';

export function standardShortLabel(
  standardId: string,
  maxLen = 14,
  extraCatalog: StandardCatalogEntry[] = []
): string {
  const entry =
    STANDARDS_CATALOG.find((s) => s.id === standardId) ?? extraCatalog.find((s) => s.id === standardId);
  const raw = entry?.name ?? standardId;
  return raw.length <= maxLen ? raw : `${raw.slice(0, maxLen - 1)}…`;
}

/** 仅统计已完成的评估中的 findings */
export function aggregateAllFindings(assessments: Assessment[]) {
  const completed = assessments.filter((a) => a.status === 'Completed' && a.findings.length > 0);
  let total = 0;
  let compliant = 0;
  let partial = 0;
  let nonCompliant = 0;
  let notApplicable = 0;

  for (const a of completed) {
    for (const f of a.findings) {
      total += 1;
      switch (f.status) {
        case 'Compliant':
          compliant += 1;
          break;
        case 'Partial':
          partial += 1;
          break;
        case 'Non-Compliant':
          nonCompliant += 1;
          break;
        case 'Not Applicable':
          notApplicable += 1;
          break;
        default:
          break;
      }
    }
  }

  /** 各已完成任务先算合规率，再对任务数取算术平均（每条任务权重相同） */
  let avgTaskComplianceRatePct: number | null = null;
  if (completed.length > 0) {
    let sumTaskRates = 0;
    for (const a of completed) {
      const n = a.findings.length;
      const c = a.findings.filter((f) => f.status === 'Compliant').length;
      sumTaskRates += (c / n) * 100;
    }
    avgTaskComplianceRatePct = Math.round(sumTaskRates / completed.length);
  }

  return {
    completedTaskCount: completed.length,
    findingTotal: total,
    compliant,
    partial,
    nonCompliant,
    notApplicable,
    /** 各已完成任务合规率（合规÷该任务条款数）的算术平均 */
    avgTaskComplianceRatePct,
    /** 需要跟进的条款数（非完全合规） */
    attentionCount: partial + nonCompliant,
  };
}

/** 按标准聚合：各标准下已完成任务中的条款合规率（合并多条任务到同一标准时加权平均） */
export function complianceRateByStandard(
  assessments: Assessment[],
  extraCatalog: StandardCatalogEntry[] = []
): { name: string; value: number; standardId: string }[] {
  const completed = assessments.filter((a) => a.status === 'Completed' && a.findings.length > 0);
  const map = new Map<string, { compliant: number; total: number }>();

  for (const a of completed) {
    for (const f of a.findings) {
      const cur = map.get(a.standardId) ?? { compliant: 0, total: 0 };
      cur.total += 1;
      if (f.status === 'Compliant') cur.compliant += 1;
      map.set(a.standardId, cur);
    }
  }

  return Array.from(map.entries())
    .map(([standardId, v]) => ({
      standardId,
      name: standardShortLabel(standardId, 16, extraCatalog),
      value: v.total > 0 ? Math.round((v.compliant / v.total) * 100) : 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export const PIE_STATUS_COLORS: Record<Finding['status'], string> = {
  Compliant: '#10B981',
  Partial: '#F59E0B',
  'Non-Compliant': '#EF4444',
  'Not Applicable': '#94A3B8',
};

const PIE_LABELS: Record<Finding['status'], string> = {
  Compliant: '已合规',
  Partial: '部分合规',
  'Non-Compliant': '未合规',
  'Not Applicable': '不适用',
};

export function pieDataFromFindings(agg: ReturnType<typeof aggregateAllFindings>) {
  const { findingTotal, compliant, partial, nonCompliant, notApplicable } = agg;
  if (findingTotal === 0) return [];

  const items: { name: string; value: number; color: string; status: Finding['status'] }[] = [
    { name: PIE_LABELS.Compliant, value: compliant, color: PIE_STATUS_COLORS.Compliant, status: 'Compliant' },
    { name: PIE_LABELS.Partial, value: partial, color: PIE_STATUS_COLORS.Partial, status: 'Partial' },
    { name: PIE_LABELS['Non-Compliant'], value: nonCompliant, color: PIE_STATUS_COLORS['Non-Compliant'], status: 'Non-Compliant' },
    { name: PIE_LABELS['Not Applicable'], value: notApplicable, color: PIE_STATUS_COLORS['Not Applicable'], status: 'Not Applicable' },
  ];

  return items.filter((x) => x.value > 0);
}
