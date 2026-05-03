export const APP_DISPLAY_NAME = 'AI Guardian';

export type ReleaseNoteEntry = {
  version: string;
  date: string;
  items: string[];
};

/** 更新日志（敏感摘要，仅「查看更新日志」权限可见） */
export const RELEASE_NOTES: ReleaseNoteEntry[] = [
  {
    version: '0.1.7',
    date: '2026-05-04',
    items: [
      '备份与恢复（超级管理员）：系统配置新增「备份与恢复」页签；支持全量 zip 导出/导入（manifest + SHA256 校验），导入前自动快照至 data/.pre-import-*，并写入审计',
      '定时自动备份：可配置开关、间隔（小时）、服务器目标目录、保留份数；API 进程内调度并回写 lastRunAt/lastError；优雅退出时清理定时器',
      'Docker：compose 增加 BACKUP_ALLOWED_ROOT 与 ./backups 卷示例，便于定时备份落盘到宿主机',
      '运维文档：public/docs 提供中英文运维一页；备份页链接随界面语言切换；开发/生产均以 UTF-8 显式返回正文，避免浏览器误判编码导致乱码',
      'PDF 导出修复：与 Word 一致在可用时带入聚合执行摘要（此前 PDF 路径未传入摘要）',
      '仪表盘待关注项修复：在「分析输入指纹 inputFingerprint 未变」时服务端原样保留分析结果会覆盖客户端待关注状态；现改为将 PUT 中的 attentionState 按 controlId 合并进既有 findings，保存后状态可正确落库（他人反馈的「改状态不生效」）',
      '评估自动保存：仅序列化并提交本人任务（ownAssessments），拉取支持 assessmentViewScope，与可见范围一致，降低误覆盖与无效 PUT',
      '仪表盘深度评估：按可见公司与筛选条件控制是否可启动深度评估，不满足时禁用按钮并展示双语范围提示（与 App 侧权限/筛选联动）',
      '依赖与工具链：新增 archiver、adm-zip、multer；Vite 增加运维文档中间件；settingsApi 增加备份下载/上传接口封装',
    ],
  },
  {
    version: '0.1.6',
    date: '2026-04-25',
    items: [
      '评估流程重构：预检查简化为“调研条目数 vs 标准条款数”一致性校验；支持调研清单/标准检查清单工作表与常见英文别名，并优化条目识别规则（仅统计有效控制项行）',
      '评估执行提效：简化差距分析提示词与输出约束，降低模型负担；分析失败语义改为“需重跑”而非直接判定不合规',
      '断点续评估增强：停止分析可即时生效并固化中间结果，后续可从未完成条目继续；任务卡片显示进度并支持“启动评估/继续评估/重新评估”入口',
      '深度评估稳定性优化：固定低并发、加宽单项超时并增加单次降载重试；任务记录保留更完整的失败原因与耗时信息',
      '评估可见范围与视图切换：新增“可见全部内容/我的评估”选项；按用户可见公司/项目范围展示任务与仪表盘数据，非本人任务默认只读展示',
      '体验优化：合规标准知识库卡片支持鼠标悬停查看说明；Bug 状态展示精简为单一可编辑状态控件',
    ],
  },
  {
    version: '0.1.5',
    date: '2026-04-25',
    items: [
      '新增一级导航「Bug提交」页面：支持提交 bug、查看全量清单，并在线更新状态（已提交 / 处理中 / 已修复）',
      'Bug 清单状态增加颜色标识：已提交为红色、处理中为黄色、已修复为绿色，便于快速识别处理进度',
      '应用使用程度审计接入 bug 提交行为统计，并纳入总活跃度评分权重（登录 5%、评估 30%、报告下载 20%、标准/配置更新 25%、Bug 提交 25%）',
      '用户活跃度看板移除独立 Bug 评分列，改为将 Bug 行为按提交次数归一化后计入总活跃分',
    ],
  },
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
