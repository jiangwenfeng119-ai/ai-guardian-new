
export interface Standard {
  id: string;
  name: string;
  version: string;
  description: string;
  categories: Category[];
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  controls: Control[];
}

export interface Control {
  id: string; // e.g., "7.1.1"
  name: string;
  requirement: string;
  priority: 'High' | 'Medium' | 'Low';
  command?: string; // e.g., "cat /etc/passwd" or SQL script
}

export interface Assessment {
  id: string;
  /** 展示名：合规标准 + 客户名 + 项目名 */
  name: string;
  /** 同客户同项目下的任务序号（01/02/...） */
  sequenceNo?: number;
  standardId: string;
  /** 新建任务时写入；旧数据可能为空 */
  customerName?: string;
  projectName?: string;
  companyId?: string;
  projectId?: string;
  /** 创建人（用于列表展示） */
  createdBy?: string;
  status: 'Draft' | 'In Progress' | 'Completed';
  createdAt: string;
  updatedAt: string;
  findings: Finding[];
  /** 差距分析使用的证据全文快照；用于后台续跑、刷新后恢复 */
  evidenceText?: string;
  /** 后端基于证据与覆盖率计算出的输入指纹，用于幂等复用 */
  inputFingerprint?: string;
  /** 输入质量门禁结果：用于区分草稿与可发布结果 */
  quality?: {
    publishable: boolean;
    score: number;
    confidence: 'High' | 'Medium' | 'Low';
    issues: string[];
    metrics?: {
      evidenceChars?: number;
      evidenceDistinctChars?: number;
      evidenceLineCount?: number;
      evidenceUniqueLineRatio?: number;
      evidencePlaceholderHits?: number;
      evidencePerFindingChars?: number;
      totalControls?: number;
      assessedControls?: number;
      coverageRatio?: number;
    };
  };
}

export interface Finding {
  controlId: string;
  status: 'Compliant' | 'Partial' | 'Non-Compliant' | 'Not Applicable';
  attentionState?: 'pending' | 'processing' | 'resolved';
  /** 本条结论所依据的证据：全文或「节选+说明」（与任务级 evidenceText 对照） */
  evidence: string;
  analysis: string;
  recommendation: string;
}

export interface EvidenceFile {
  id: string;
  name: string;
  type: string;
  content: string; // Base64 or text extracted
}
