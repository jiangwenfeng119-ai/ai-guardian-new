/**
 * 评估任务在后台继续分析时，用此注册表防止重复启动、并支持显式「停止」。
 * 离开详情页不再 abort（见 AssessmentFlow）。
 */

const runningIds = new Set<string>();
const abortControllers = new Map<string, AbortController>();

export function isAssessmentAnalysisRunning(assessmentId: string): boolean {
  return runningIds.has(assessmentId);
}

export function abortAssessmentAnalysis(assessmentId: string): void {
  abortControllers.get(assessmentId)?.abort();
}

export function registerAnalysisRun(assessmentId: string, ac: AbortController): void {
  runningIds.add(assessmentId);
  abortControllers.set(assessmentId, ac);
}

export function unregisterAnalysisRun(assessmentId: string): void {
  runningIds.delete(assessmentId);
  abortControllers.delete(assessmentId);
}
