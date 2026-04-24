import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, Loader2, Trash2, Download } from 'lucide-react';
import { fetchSettings, postAiAssistantChat } from '../services/settingsApi';
import { getLocale, type LocaleId } from '../i18n';

type ChatMode = 'default' | 'local' | 'cloud';
type Msg = { role: 'user' | 'assistant'; text: string; meta?: string };
const CONTEXT_TURNS = 8;
type AiAssistantProps = { sessionKey?: string };

export default function AiAssistant({ sessionKey = 'default' }: AiAssistantProps) {
  const [locale, setLocale] = useState<LocaleId>(() => getLocale());
  const isEn = locale === 'en-US';
  const tx = (zh: string, en: string) => (isEn ? en : zh);
  const storageKey = `ai_assistant_session_v1_${sessionKey}`;
  const [mode, setMode] = useState<ChatMode>('default');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: tx('你好，我是 AI 助手。你可以选择默认/本地/云端模型与我对话。', 'Hello! I am your AI assistant. You can switch default/local/cloud modes.') },
  ]);
  const [strategyText, setStrategyText] = useState(tx('默认策略读取中…', 'Loading default strategy...'));

  useEffect(() => {
    const onLocale = (e: Event) => {
      const next = (e as CustomEvent<LocaleId>).detail;
      if (next === 'en-US' || next === 'zh-CN') setLocale(next);
    };
    window.addEventListener('app-locale-change', onLocale as EventListener);
    return () => window.removeEventListener('app-locale-change', onLocale as EventListener);
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { mode?: ChatMode; messages?: Msg[] };
      if (parsed.mode && ['default', 'local', 'cloud'].includes(parsed.mode)) {
        setMode(parsed.mode);
      }
      if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
        setMessages(parsed.messages.slice(-200));
      }
    } catch {
      // ignore parse errors
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ mode, messages: messages.slice(-200) }));
    } catch {
      // ignore storage errors
    }
  }, [storageKey, mode, messages]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((s) => {
        if (cancelled) return;
        const settings = s as Record<string, unknown>;
        const model = (settings.model && typeof settings.model === 'object' ? settings.model : {}) as Record<string, unknown>;
        const primary = String(model.primaryModel || 'local');
        const fallbackEnabled = model.fallbackEnabled !== false;
        setStrategyText(
          isEn
            ? `Current: ${primary === 'cloud' ? 'Cloud-first' : 'Local-first'}, fallback ${fallbackEnabled ? 'enabled' : 'disabled'}`
            : `当前：${primary === 'cloud' ? '云端优先' : '本地优先'}，${fallbackEnabled ? '失败回退已启用' : '失败回退未启用'}`
        );
      })
      .catch(() => setStrategyText(tx('当前：默认策略（读取失败，请检查系统配置连接）', 'Current: default strategy (failed to load settings)')));
    return () => {
      cancelled = true;
    };
  }, []);

  const send = async () => {
    const q = input.trim();
    if (!q || sending) return;
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-CONTEXT_TURNS * 2)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
      .join('\n');
    const composedPrompt = history
      ? `${tx('以下是最近对话上下文，请基于上下文继续回答：', 'Here is recent conversation context, continue based on it:')}\n${history}\n\n${tx('当前用户问题：', 'Current user question:')}\n${q}`
      : q;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setSending(true);
    try {
      const r = await postAiAssistantChat({ message: composedPrompt, mode });
      setMessages((prev) => [...prev, { role: 'assistant', text: r.text, meta: `${r.provider} / ${r.model} / route:${r.route}` }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', text: `${tx('请求失败', 'Request failed')}: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setSending(false);
    }
  };

  const clearChat = () => {
    const next = [{ role: 'assistant', text: tx('会话已清空。你可以继续开始新的提问。', 'Chat cleared. You can start a new conversation.') } as Msg];
    setMessages(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ mode, messages: next }));
    } catch {
      // ignore storage errors
    }
  };

  const exportChat = () => {
    const lines = messages.map((m) => `[${m.role === 'user' ? 'USER' : 'ASSISTANT'}] ${m.text}${m.meta ? `\n(meta) ${m.meta}` : ''}`);
    const content = lines.join('\n\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-assistant-chat-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const modeHint = useMemo(() => {
    if (mode === 'default') return strategyText;
    if (mode === 'local') return tx('当前：强制本地模型（不走默认路由）', 'Current: force local model (skip default route)');
    return tx('当前：强制云端模型（不走默认路由）', 'Current: force cloud model (skip default route)');
  }, [mode, strategyText, isEn]);

  return (
    <section className="glass-card p-8 bg-white/40 space-y-5">
      <div className="flex items-center gap-3">
        <Bot size={20} className="text-accent" />
        <h3 className="text-xl font-black">{tx('AI 助手', 'AI Assistant')}</h3>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-semibold text-text-main/70">{tx('模型模式', 'Model Mode')}</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as ChatMode)} className="glass-input px-4 py-2 text-sm font-semibold">
          <option value="default">{tx('默认（按系统路由策略）', 'Default (system routing strategy)')}</option>
          <option value="local">{tx('本地模型', 'Local model')}</option>
          <option value="cloud">{tx('云端模型', 'Cloud model')}</option>
        </select>
        <button type="button" className="glass-card px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2" onClick={clearChat}>
          <Trash2 size={14} />
          {tx('清空会话', 'Clear Chat')}
        </button>
        <button type="button" className="glass-card px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2" onClick={exportChat}>
          <Download size={14} />
          {tx('导出记录', 'Export Chat')}
        </button>
      </div>
      <div className="rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-xs font-semibold text-text-main/70">{modeHint}</div>
      <div ref={chatScrollRef} className="rounded-xl border border-black/10 bg-white/50 p-4 h-[55vh] overflow-y-auto space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                m.role === 'user' ? 'bg-accent text-white' : 'bg-white border border-black/10 text-text-main'
              }`}
            >
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.meta ? <p className="text-[10px] opacity-70 mt-2">{m.meta}</p> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="glass-input flex-1 px-4 py-3 text-sm font-semibold"
          placeholder={tx('输入你的问题，回车发送', 'Type your question and press Enter')}
        />
        <button type="button" onClick={() => void send()} disabled={sending || !input.trim()} className="glass-button px-4 py-3">
          {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
        </button>
      </div>
    </section>
  );
}
