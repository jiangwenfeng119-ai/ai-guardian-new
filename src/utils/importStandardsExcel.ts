import * as XLSX from 'xlsx';
import type { Control } from '../types';

function str(v: unknown): string {
  return String(v ?? '').trim();
}

const PRIORITIES = new Set<Control['priority']>(['High', 'Medium', 'Low']);

/** 解析与「导出清单」模板列名一致的 Excel，得到检查项列表 */
export function parseControlsFromEnterpriseExcel(buffer: ArrayBuffer): { controls: Control[]; errors: string[] } {
  const errors: string[] = [];
  try {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const first = workbook.SheetNames[0];
    if (!first) {
      errors.push('工作簿为空');
      return { controls: [], errors };
    }
    const sheet = workbook.Sheets[first];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const controls: Control[] = [];

    for (const row of rows) {
      const id = str(row['控制项ID'] ?? row['ID'] ?? row['id']);
      const name = str(row['检查项名称'] ?? row['名称'] ?? row['name']);
      const requirement = str(row['合规要求'] ?? row['requirement']);
      const pr = str(row['重要级别'] ?? row['priority'] ?? 'Medium');
      const priority: Control['priority'] = PRIORITIES.has(pr as Control['priority']) ? (pr as Control['priority']) : 'Medium';
      const cmd = str(row['自动化核查命令'] ?? row['command'] ?? '');
      if (!id || !name) continue;
      controls.push({
        id,
        name,
        requirement: requirement || '—',
        priority,
        command: cmd && cmd !== 'N/A' ? cmd : undefined,
      });
    }

    if (controls.length === 0) {
      errors.push(
        '未解析到有效行。请使用与「导出清单」一致的列：控制项ID、检查项名称、重要级别、合规要求、自动化核查命令（可选）。'
      );
    }
    return { controls, errors };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : '解析 Excel 失败');
    return { controls: [], errors };
  }
}
