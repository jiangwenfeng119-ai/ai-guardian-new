import type { Control } from '../types';

export type EvidenceExcerptBundle = {
  /** 注入模型提示词的摘录正文 */
  excerpt: string;
  /** 置于摘录前的说明（原文长度、节选策略） */
  preamble: string;
  /** 存入 Finding.evidence 的完整展示串（preamble + excerpt） */
  displayForFinding: string;
  /** 是否使用了节选（原文超出预算） */
  wasTruncated: boolean;
};

const DEFAULT_BUDGET = 12_000;
const MAX_CHUNK = 3600;

function tokenizeForMatch(query: string): string[] {
  const lower = query.toLowerCase();
  const parts = lower.split(/[\s,.;，。、；：\[\]（）()]+/).filter((t) => t.length >= 2);
  return [...new Set(parts)].slice(0, 100);
}

/** 将过长证据拆成段落块，便于打分与拼接 */
function chunkEvidence(full: string): { text: string; index: number }[] {
  const paragraphs = full
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: { text: string; index: number }[] = [];
  if (paragraphs.length === 0) {
    for (let i = 0, idx = 0; i < full.length; i += MAX_CHUNK, idx += 1) {
      out.push({ text: full.slice(i, i + MAX_CHUNK), index: idx });
    }
    return out;
  }
  let buf = '';
  let seq = 0;
  const flush = () => {
    if (buf.trim()) out.push({ text: buf.trim(), index: seq++ });
    buf = '';
  };
  for (const p of paragraphs) {
    if (p.length > MAX_CHUNK) {
      flush();
      for (let i = 0; i < p.length; i += MAX_CHUNK) {
        out.push({ text: p.slice(i, i + MAX_CHUNK), index: seq++ });
      }
      continue;
    }
    if (buf.length + p.length + 2 > MAX_CHUNK) {
      flush();
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  flush();
  return out;
}

/**
 * 为单条控制项从整份证据中选取相关片段，控制送入模型的上下文长度。
 * 策略：按段落分块，用条款 id/名称/要求中的词在块中的命中次数打分，优先高相关块直至预算。
 */
export function buildEvidenceExcerptForControl(
  control: Control,
  evidenceText: string,
  opts?: { budgetChars?: number }
): EvidenceExcerptBundle {
  const budget = Math.max(2000, Math.min(48_000, opts?.budgetChars ?? DEFAULT_BUDGET));
  const full = evidenceText.trim();
  if (!full) {
    return {
      excerpt: '',
      preamble: '',
      displayForFinding: '',
      wasTruncated: false,
    };
  }
  if (full.length <= budget) {
    const preamble = '[本项分析使用证据全文。]';
    return {
      excerpt: full,
      preamble,
      displayForFinding: `${preamble}\n\n${full}`.trim(),
      wasTruncated: false,
    };
  }

  const query = `${control.id} ${control.name} ${control.requirement}`.slice(0, 4000);
  const tokens = tokenizeForMatch(query);
  const chunks = chunkEvidence(full);
  const sep = '\n\n--- 相关摘录 ---\n\n';

  const scored = chunks.map(({ text, index }) => {
    const cl = text.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (t.length >= 2 && cl.includes(t)) score += t.length >= 5 ? 4 : 1;
    }
    if (text.includes(control.id)) score += 12;
    return { text, score, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const picked: string[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const { text } of scored) {
    const sig = text.slice(0, 120);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const addLen = (picked.length ? sep.length : 0) + text.length;
    if (used + addLen > budget) {
      if (picked.length === 0) {
        picked.push(text.slice(0, budget - 80) + '…');
        used = budget;
      }
      break;
    }
    picked.push(text);
    used += addLen;
    if (used >= budget * 0.97) break;
  }

  if (picked.length === 0) {
    picked.push(full.slice(0, budget - 80) + '…');
  }

  const excerpt = picked.join(sep);
  const preamble = `（原文约 ${full.length} 字；下列为与本控制项关键词相关度较高的摘录，约 ${excerpt.length} 字。未纳入的原文仍可能含反证，判定「不合规」时须考虑信息缺失风险。）`;
  const displayForFinding = `${preamble}\n\n${excerpt}`.trim();
  return { excerpt, preamble, displayForFinding, wasTruncated: true };
}
