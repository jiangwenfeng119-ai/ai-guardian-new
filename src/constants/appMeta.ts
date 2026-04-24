export const APP_DISPLAY_NAME = 'AI Guardian';

export type ReleaseNoteEntry = {
  version: string;
  date: string;
  items: string[];
};

/** 更新日志（敏感摘要，仅「查看更新日志」权限可见） */
export const RELEASE_NOTES: ReleaseNoteEntry[] = [
  {
    version: '0.1.4',
    date: '2026-04-25',
    items: [
      '评估流程：无「查看评估最终结果」权限时步骤初始化不再误入聚合报告；有权限且条款全部分析完成时自动进入聚合报告',
      '评估流程：聚合报告增加执行摘要（生成中/就绪/失败可重试），按任务与发现内容指纹写入本地缓存；Word 导出优先使用已就绪摘要',
      '评估流程：任务为草稿或未达发布门槛时在报告页展示双语说明横幅，并补充执行摘要与打开报告相关提示文案',
      '系统设置：新增「应用使用程度审计」页签；用户活跃度分析独立为 UserActivityDashboard 组件（时间范围/角色/公司与项目筛选、图表与用户明细等）',
    ],
  },
  {
    version: '0.1.3',
    date: '2026-04-24',
    items: [
      '仪表盘：移除顶栏全局搜索入口及其关联逻辑；评估任务列表仅保留公司/项目/创建人筛选',
      '仪表盘：合规标准配置页取消与顶栏关键词联动过滤，标准卡片与检查项列表始终展示完整数据',
      '仪表盘：右下角圆环指标改为「已进入 processing 的待关注项数量 ÷ 当前待关注项总数」；环内百分比与进度一致；底部文案由「总体就绪」改为「总体待响应」',
      '评估数据：拉取评估列表的 effect 依赖改为 user?.id，避免仅刷新用户信息时覆盖本地状态；支持 AbortSignal 取消；删除任务后在已 hydrated 场景下尽快持久化并同步深度评估任务引用，仪表盘容器 key 随任务集合变化以降低图表缓存导致的陈旧展示',
    ],
  },
  {
    version: '0.1.2',
    date: '2026-04-24',
    items: [
      '系统设置：权限矩阵列名中英双语；审计日志大类筛选标签随语言切换；角色名、保存/加载/模型联通/法律法规相关提示全面 i18n；监听语言切换事件同步界面',
      '用户管理：列表与新建/编辑/改密等弹窗文案 i18n，与全局语言一致',
      '仪表盘待关注项：支持多选与全选，批量设为 processing / resolved',
      '评估流程：当模型返回的分析/整改建议为空时，写入明确占位提示，引导补充调研证据后重跑',
      '法律法规「查看最新同步」弹窗：最近同步时间、法规库版本标签按语言展示；合规标准库上次同步展示「从未同步」的英文释义；英文界面下对内置中文默认拉取提示词增加「按原文发送」说明（存储值不变）',
      '权限定义：集中维护各权限点的中英列名（permissionColumnLabel），便于关于页与设置页一致展示',
    ],
  },
  {
    version: '0.1.1',
    date: '2026-04-22',
    items: [
      '法律法规客户视图升级为“双层结构”：上层汇总简报（headline/summary/takeaways），下层法规条目列表（items）',
      '新增 AI 结构化优先解析：优先读取 response.ai.parsedAnswer / ai.parsedAnswer，后处理结果作为兜底',
      '新增低置信门控（默认阈值 0.7）：低置信结果转入内部诊断，不直接进入客户展示',
      '新增人工复核发布流程：支持发布、撤销发布、发布前预览，并在客户视图显示“已人工发布（发布人/时间）”标识',
      '新增人工法规条目录入：支持手工新增、编辑、删除、上移/下移排序，客户视图优先展示人工发布条目',
      '新增“重新生成汇总”按钮：基于当前人工法规条目调用大模型重新生成摘要，可二次人工编辑后发布',
      '新增内部诊断增强：展示风险信号、置信度、metadata 统计卡片、最近拉取历史',
      '后处理超时策略升级：检索与后处理分离超时，后处理读取 timeoutSec 配置（默认更宽松）',
      '法规条目展示上限由 12 提升到 30，并保留条目为空时的证据回退提示',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-04-21',
    items: [
      '系统核心配置新增「关于」页签：展示应用版本号',
      '更新日志独立于版本展示，受「查看更新日志」权限控制',
      'AI 模型参数：支持国内主流 OpenAI 兼容 Provider，并按厂商自动填充 Base URL 模板',
      'AI 配置：支持通过 VITE_OPENAI_API_KEY / VITE_OPENAI_BASE_URL 注入',
      '文案：「导入企业特定细则」改为「导入合规标准特定条款」',
      '权限矩阵扩展：查看关于与版本、查看更新日志',
      '评估任务：聚合报告与导出受「查看评估最终结果（聚合报告）」权限控制',
      '其他：评估详情 key 调整、TypeScript 与 OpenAI 兼容分支修正',
    ],
  },
];

function compareVersionDesc(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number(x));
  const pb = b.split('.').map((x) => Number(x));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const va = Number.isFinite(pa[i]) ? pa[i] : 0;
    const vb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (va !== vb) return vb - va;
  }
  return 0;
}

const LATEST_RELEASE =
  RELEASE_NOTES.slice().sort((a, b) => {
    const ta = Date.parse(a.date);
    const tb = Date.parse(b.date);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
    return compareVersionDesc(a.version, b.version);
  })[0] || { version: '0.0.0', date: '' };
export const APP_VERSION = LATEST_RELEASE.version;
export const APP_UPDATED_DATE = LATEST_RELEASE.date;
