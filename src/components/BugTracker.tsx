import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bug, Plus, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { fetchBugs, patchBugStatus, postBug, type BugTicket } from '../services/settingsApi';
import { getLocale, type LocaleId } from '../i18n';

type BugTrackerProps = {
  onSessionExpired: () => void;
};

export default function BugTracker({ onSessionExpired }: BugTrackerProps) {
  const [locale, setLocale] = useState<LocaleId>(() => getLocale());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bugs, setBugs] = useState<BugTicket[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const tx = useCallback((zh: string, en: string) => (locale === 'en-US' ? en : zh), [locale]);

  useEffect(() => {
    const onLocale = (e: Event) => {
      const next = (e as CustomEvent<LocaleId>).detail;
      if (next === 'en-US' || next === 'zh-CN') setLocale(next);
    };
    window.addEventListener('app-locale-change', onLocale as EventListener);
    return () => window.removeEventListener('app-locale-change', onLocale as EventListener);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await fetchBugs();
      setBugs(Array.isArray(out.bugs) ? out.bugs : []);
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        onSessionExpired();
      }
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitBug = async () => {
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    try {
      const out = await postBug({ title: t, description: description.trim() });
      setBugs((prev) => [out.bug, ...prev]);
      setTitle('');
      setDescription('');
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') onSessionExpired();
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: 'submitted' | 'in_progress' | 'resolved') => {
    try {
      const out = await patchBugStatus(id, status);
      setBugs((prev) => prev.map((b) => (b.id === id ? out.bug : b)));
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') onSessionExpired();
    }
  };

  const statusLabel = useMemo(
    () => ({
      submitted: tx('已提交', 'Submitted'),
      in_progress: tx('处理中', 'In progress'),
      resolved: tx('已修复', 'Resolved'),
    }),
    [tx]
  );

  const statusBadgeClass = useCallback((status: BugTicket['status']) => {
    if (status === 'submitted') return 'bg-danger-main/15 text-danger-main border-danger-main/30';
    if (status === 'in_progress') return 'bg-warning-main/15 text-warning-main border-warning-main/30';
    return 'bg-success-main/15 text-success-main border-success-main/30';
  }, []);

  return (
    <div className="space-y-8">
      <div className="glass-card p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Bug size={20} className="text-accent" />
            <h2 className="text-2xl font-black">{tx('Bug 提交与追踪', 'Bug Submission & Tracking')}</h2>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="glass-card px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            {loading ? tx('加载中', 'Loading') : tx('刷新', 'Refresh')}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <input
            className="glass-input px-4 py-3 text-sm font-semibold"
            placeholder={tx('Bug 标题（必填）', 'Bug title (required)')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="glass-input px-4 py-3 text-sm font-semibold min-h-24"
            placeholder={tx('问题描述（可选）', 'Bug description (optional)')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div>
            <button
              type="button"
              onClick={() => void submitBug()}
              disabled={saving || !title.trim()}
              className="glass-button flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
            >
              <Plus size={16} />
              {saving ? tx('提交中...', 'Submitting...') : tx('提交 Bug', 'Submit Bug')}
            </button>
          </div>
        </div>
      </div>

      <div className="glass-card p-8">
        <h3 className="text-sm font-black uppercase tracking-widest text-text-main/50 mb-4">
          {tx('已提交 Bug 清单', 'Submitted bug list')}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="text-left text-text-main/50">
                <th className="py-2 pr-3">{tx('标题', 'Title')}</th>
                <th className="py-2 pr-3">{tx('提交人', 'Reporter')}</th>
                <th className="py-2 pr-3">{tx('状态', 'Status')}</th>
                <th className="py-2 pr-3">{tx('创建时间', 'Created')}</th>
                <th className="py-2 pr-3">{tx('更新时间', 'Updated')}</th>
              </tr>
            </thead>
            <tbody>
              {bugs.map((b) => (
                <tr key={b.id} className="border-t border-black/10 align-top">
                  <td className="py-3 pr-3">
                    <p className="font-semibold">{b.title}</p>
                    {b.description ? <p className="text-xs text-text-main/55 mt-1">{b.description}</p> : null}
                  </td>
                  <td className="py-3 pr-3">{b.reporterName || '—'}</td>
                  <td className="py-3 pr-3">
                    <select
                      className={cn('glass-input px-2 py-1 text-xs font-semibold border rounded-full min-w-[120px]', statusBadgeClass(b.status))}
                      value={b.status}
                      onChange={(e) => void updateStatus(b.id, e.target.value as 'submitted' | 'in_progress' | 'resolved')}
                    >
                      <option value="submitted">{statusLabel.submitted}</option>
                      <option value="in_progress">{statusLabel.in_progress}</option>
                      <option value="resolved">{statusLabel.resolved}</option>
                    </select>
                  </td>
                  <td className="py-3 pr-3">{new Date(b.createdAt).toLocaleString()}</td>
                  <td className="py-3 pr-3">{new Date(b.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
