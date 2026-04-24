/**
 * 兼容旧引用；实际逻辑在 llm.ts（支持 Gemini / Ollama 等）。
 */
export {
  performGapAnalysis,
  generateExecutiveSummary,
  getAiSettings,
  applyServerAiModelSnapshot,
  clearServerAiModelSnapshot,
  type GapAnalysisResult,
} from './llm';
