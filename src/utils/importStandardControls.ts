import type { Control } from '../types';
import { parseControlsFromEnterpriseExcel } from './importStandardsExcel';

export { parseControlsFromEnterpriseExcel };

const PRIORITIES = new Set<Control['priority']>(['High', 'Medium', 'Low']);

function str(v: unknown): string {
  return String(v ?? '').trim();
}

function normalizePriority(raw: string): Control['priority'] {
  const pr = raw || 'Medium';
  return PRIORITIES.has(pr as Control['priority']) ? (pr as Control['priority']) : 'Medium';
}

/** Map loose JSON keys to Control; returns null if id+name missing. */
export function controlFromPlainObject(obj: Record<string, unknown>): Control | null {
  const id = str(obj['控制项ID'] ?? obj['id'] ?? obj['ID'] ?? obj['controlId']);
  const name = str(obj['检查项名称'] ?? obj['name'] ?? obj['名称'] ?? obj['title']);
  if (!id || !name) return null;
  const requirement = str(obj['合规要求'] ?? obj['requirement'] ?? obj['description']) || '—';
  const priority = normalizePriority(str(obj['重要级别'] ?? obj['priority'] ?? 'Medium'));
  const cmd = str(obj['自动化核查命令'] ?? obj['command'] ?? obj['checkCommand'] ?? '');
  return {
    id,
    name,
    requirement,
    priority,
    command: cmd && cmd !== 'N/A' ? cmd : undefined,
  };
}

/** Root: `{ "controls": [...] }` or `[...]` — each item same fields as Excel export. */
export function parseControlsFromJsonString(text: string): { controls: Control[]; errors: string[] } {
  const errors: string[] = [];
  const stripped = text.replace(/^\uFEFF/, '').trim();
  if (!stripped) {
    errors.push('JSON 内容为空');
    return { controls: [], errors };
  }
  let root: unknown;
  try {
    root = JSON.parse(stripped) as unknown;
  } catch (e) {
    errors.push(e instanceof Error ? `JSON 解析失败：${e.message}` : 'JSON 解析失败');
    return { controls: [], errors };
  }
  const arr = Array.isArray(root) ? root : (root as { controls?: unknown }).controls;
  if (!Array.isArray(arr)) {
    errors.push('JSON 须为数组，或形如 { "controls": [ ... ] } 的对象');
    return { controls: [], errors };
  }
  const controls: Control[] = [];
  for (let i = 0; i < arr.length; i += 1) {
    const row = arr[i];
    if (!row || typeof row !== 'object') {
      errors.push(`第 ${i + 1} 条：不是对象，已跳过`);
      continue;
    }
    const c = controlFromPlainObject(row as Record<string, unknown>);
    if (c) controls.push(c);
    else errors.push(`第 ${i + 1} 条：缺少控制项 id 或名称，已跳过`);
  }
  if (controls.length === 0) {
    errors.push(
      '未解析到有效条款。字段要求：id（控制项ID）、name（检查项名称）必填；requirement（合规要求）、priority（High|Medium|Low）、command（可选）'
    );
  }
  return { controls, errors };
}

/**
 * Markdown：每个条款以 `## 控制项ID` 开头（可与名称同写在一行），正文用 **字段名**: 值。
 *
 * 示例：
 * ```
 * ## 7.1.1 访问控制策略
 * **priority**: High
 * **requirement**: 应建立并评审访问控制策略……
 * **command**: cat /etc/passwd
 * ```
 */
export function parseControlsFromMarkdown(text: string): { controls: Control[]; errors: string[] } {
  const errors: string[] = [];
  const controls: Control[] = [];
  const parts = text.split(/^##\s+/m);
  const preamble = parts[0]?.trim() || '';
  const sections = parts.slice(1);
  if (sections.length === 0 && preamble) {
    errors.push(
      '未找到 `## 控制项ID` 标题。每个条款请以二级标题开头，例如：`## 7.1.1 检查项名称`'
    );
    return { controls: [], errors };
  }
  for (let si = 0; si < sections.length; si += 1) {
    const block = sections[si];
    const lines = block.split('\n');
    const heading = (lines[0] || '').trim();
    const bodyLines = lines.slice(1);
    const idNameMatch = heading.match(/^(\S+)(?:\s+(.*))?$/);
    if (!idNameMatch) {
      errors.push(`第 ${si + 1} 个 ## 块：标题格式无效，已跳过`);
      continue;
    }
    const id = idNameMatch[1].trim();
    let name = (idNameMatch[2] || '').trim();
    const kv: Record<string, string> = {};
    for (const line of bodyLines) {
      const m = line.match(/^\*\*([^*]+)\*\*:\s*(.*)$/);
      if (m) {
        const key = m[1].trim().toLowerCase();
        kv[key] = m[2].trim();
      }
    }
    const nameFromKv =
      kv['name'] ||
      kv['名称'] ||
      kv['检查项名称'] ||
      kv['title'] ||
      '';
    if (!name && nameFromKv) name = nameFromKv;
    if (!id || !name) {
      errors.push(
        `条款「${id || heading.slice(0, 24)}」缺少名称：请在「## id 名称」标题行写名称，或正文写 **name**: / **检查项名称**:`
      );
      continue;
    }
    const row: Record<string, unknown> = {
      id,
      name,
      requirement:
        kv['requirement'] ||
        kv['合规要求'] ||
        kv['description'] ||
        '—',
      priority: kv['priority'] || kv['重要级别'] || 'Medium',
      command: kv['command'] || kv['自动化核查命令'] || '',
    };
    const c = controlFromPlainObject(row);
    if (c) controls.push(c);
  }
  if (controls.length === 0 && errors.length === 0) {
    errors.push('未解析到有效条款，请检查 Markdown 结构。');
  }
  return { controls, errors };
}
