import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { X, Users, Activity, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { fetchUserActivityAnalytics, type UserActivityAnalyticsResponse } from '../services/settingsApi';
import { getLocale, type LocaleId } from '../i18n';

type UserActivityDashboardProps = {
  onSessionExpired: () => void;
  companies?: Array<{ id: string; name: string }>;
  projects?: Array<{ id: string; name: string; companyId?: string }>;
};

type UserRow = UserActivityAnalyticsResponse['users'][number];

export default function UserActivityDashboard({
  onSessionExpired,
  companies = [],
  projects = [],
}: UserActivityDashboardProps) {
  const [locale, setLocale] = useState<LocaleId>(() => getLocale());
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [role, setRole] = useState('all');
  const [companyId, setCompanyId] = useState('all');
  const [projectId, setProjectId] = useState('all');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<UserActivityAnalyticsResponse | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  const tx = useCallback((zh: string, en: string) => (locale === 'en-US' ? en : zh), [locale]);

  useEffect(() => {
    const onLocale = (e: Event) => {
      const next = (e as CustomEvent<LocaleId>).detail;
      if (next === 'en-US' || next === 'zh-CN') setLocale(next);
    };
    window.addEventListener('app-locale-change', onLocale as EventListener);
    return () => window.removeEventListener('app-locale-change', onLocale as EventListener);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const out = await fetchUserActivityAnalytics({
        days,
        role,
        companyId,
        projectId,
        limit: 200,
      });
      setData(out);
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        onSessionExpired();
      }
    } finally {
      setLoading(false);
    }
  }, [days, role, companyId, projectId, onSessionExpired]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const roleOptions = useMemo(
    () => ['all', 'SuperAdmin', 'SecurityAdmin', 'Auditor', 'DepartmentManager', 'Viewer'],
    []
  );

  const visibleProjects = useMemo(() => {
    if (companyId === 'all') return projects;
    return projects.filter((p) => String(p.companyId || '') === companyId);
  }, [projects, companyId]);

  return (
    <div className="space-y-8">
      <div className="glass-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black">{tx('用户活跃度分析', 'User Activity Analytics')}</h2>
            <p className="text-sm text-text-main/60 mt-1">
              {tx('查看登录、评估、报告下载与标准维护的用户行为趋势', 'View user behavior trends for login, assessments, report export, and standards updates')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="glass-card px-4 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            {loading ? tx('加载中', 'Loading') : tx('刷新', 'Refresh')}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select className="glass-input px-3 py-2 text-sm font-semibold" value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 90)}>
            <option value={7}>{tx('近7天', 'Last 7 days')}</option>
            <option value={30}>{tx('近30天', 'Last 30 days')}</option>
            <option value={90}>{tx('近90天', 'Last 90 days')}</option>
          </select>
          <select className="glass-input px-3 py-2 text-sm font-semibold" value={role} onChange={(e) => setRole(e.target.value)}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {r === 'all' ? tx('全部角色', 'All roles') : r}
              </option>
            ))}
          </select>
          <select className="glass-input px-3 py-2 text-sm font-semibold" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="all">{tx('全部公司', 'All companies')}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.id}
              </option>
            ))}
          </select>
          <select className="glass-input px-3 py-2 text-sm font-semibold" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="all">{tx('全部项目', 'All projects')}</option>
            {visibleProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="glass-card p-5">
              <p className="text-xs font-black uppercase tracking-widest text-text-main/45">{tx('活跃用户', 'Active users')}</p>
              <p className="text-3xl font-black mt-2">{data.summary.activeUsers}</p>
            </div>
            <div className="glass-card p-5">
              <p className="text-xs font-black uppercase tracking-widest text-text-main/45">{tx('活跃占比', 'Active ratio')}</p>
              <p className="text-3xl font-black mt-2">{Math.round(data.summary.activeUserRatio * 100)}%</p>
            </div>
            <div className="glass-card p-5">
              <p className="text-xs font-black uppercase tracking-widest text-text-main/45">{tx('登录次数', 'Logins')}</p>
              <p className="text-3xl font-black mt-2">{data.summary.totalLoginOk}</p>
            </div>
            <div className="glass-card p-5">
              <p className="text-xs font-black uppercase tracking-widest text-text-main/45">{tx('报告下载', 'Report downloads')}</p>
              <p className="text-3xl font-black mt-2">{data.summary.totalReportsDownloaded}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="glass-card p-6">
              <h3 className="text-sm font-black uppercase tracking-widest text-text-main/45 mb-4">
                {tx('DAU 与登录趋势', 'DAU and login trend')}
              </h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.08)" />
                    <XAxis dataKey="day" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="activeUsers" stroke="#3b82f6" name={tx('DAU', 'DAU')} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="loginCount" stroke="#10b981" name={tx('登录', 'Logins')} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="glass-card p-6">
              <h3 className="text-sm font-black uppercase tracking-widest text-text-main/45 mb-4">
                {tx('事件趋势', 'Event trend')}
              </h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.08)" />
                    <XAxis dataKey="day" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="assessmentCreatedCount" stroke="#8b5cf6" name={tx('评估发起', 'Assessments')} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="reportDownloadedCount" stroke="#f59e0b" name={tx('下载报告', 'Downloads')} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="standardsUpdatedCount" stroke="#ef4444" name={tx('标准更新', 'Standards')} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users size={16} />
              <h3 className="text-sm font-black uppercase tracking-widest text-text-main/45">{tx('用户活跃榜单', 'User activity ranking')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="text-left text-text-main/50">
                    <th className="py-2 pr-3">{tx('用户', 'User')}</th>
                    <th className="py-2 pr-3">{tx('角色', 'Role')}</th>
                    <th className="py-2 pr-3">{tx('活跃分', 'Score')}</th>
                    <th className="py-2 pr-3">{tx('登录', 'Logins')}</th>
                    <th className="py-2 pr-3">{tx('评估', 'Assessments')}</th>
                    <th className="py-2 pr-3">{tx('下载', 'Downloads')}</th>
                    <th className="py-2 pr-3">{tx('活跃天数', 'Active days')}</th>
                    <th className="py-2 pr-3">{tx('最近活跃', 'Last active')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr
                      key={u.userId}
                      className="border-t border-black/10 hover:bg-white/60 cursor-pointer"
                      onClick={() => setSelectedUser(u)}
                    >
                      <td className="py-2 pr-3 font-semibold">{u.username}</td>
                      <td className="py-2 pr-3">{u.role}</td>
                      <td className="py-2 pr-3 font-black">{u.activityScore}</td>
                      <td className="py-2 pr-3">{u.loginOkCount}</td>
                      <td className="py-2 pr-3">{u.assessmentsCreatedCount}</td>
                      <td className="py-2 pr-3">{u.reportsDownloadedCount}</td>
                      <td className="py-2 pr-3">{u.activeDays}</td>
                      <td className="py-2 pr-3">{u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {selectedUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-end">
          <div className="absolute inset-0 bg-black/35" onClick={() => setSelectedUser(null)} />
          <div className="relative h-full w-full max-w-md bg-white border-l border-black/10 shadow-2xl p-5 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity size={16} />
                <h4 className="font-black">{tx('用户明细', 'User details')}</h4>
              </div>
              <button type="button" className="p-2 rounded-lg hover:bg-black/5" onClick={() => setSelectedUser(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div><span className="text-text-main/55">{tx('用户名', 'Username')}：</span><strong>{selectedUser.username}</strong></div>
              <div><span className="text-text-main/55">{tx('角色', 'Role')}：</span>{selectedUser.role}</div>
              <div><span className="text-text-main/55">{tx('活跃分', 'Activity score')}：</span><strong>{selectedUser.activityScore}</strong></div>
              <div><span className="text-text-main/55">{tx('活跃等级', 'Activity level')}：</span>{selectedUser.activeLevel}</div>
              <div><span className="text-text-main/55">{tx('活跃天数', 'Active days')}：</span>{selectedUser.activeDays}</div>
              <div><span className="text-text-main/55">{tx('登录成功/失败', 'Login success/failure')}：</span>{selectedUser.loginOkCount}/{selectedUser.loginFailCount}</div>
              <div><span className="text-text-main/55">{tx('登录成功率', 'Login success rate')}：</span>{selectedUser.loginSuccessRate == null ? '—' : `${Math.round(selectedUser.loginSuccessRate * 100)}%`}</div>
              <div><span className="text-text-main/55">{tx('发起评估', 'Assessments created')}：</span>{selectedUser.assessmentsCreatedCount}</div>
              <div><span className="text-text-main/55">{tx('保存评估', 'Assessments saved')}：</span>{selectedUser.assessmentsSavedCount}</div>
              <div><span className="text-text-main/55">{tx('下载报告', 'Reports downloaded')}：</span>{selectedUser.reportsDownloadedCount}</div>
              <div><span className="text-text-main/55">{tx('标准更新', 'Standards updated')}：</span>{selectedUser.standardsUpdatedCount}</div>
              <div><span className="text-text-main/55">{tx('配置更新', 'Settings updates')}：</span>{selectedUser.settingsUpdatedCount}</div>
              <div><span className="text-text-main/55">{tx('平均会话间隔(小时)', 'Avg session gap (hours)')}：</span>{selectedUser.avgSessionGapHours ?? '—'}</div>
              <div><span className="text-text-main/55">{tx('最近活跃', 'Last active')}：</span>{selectedUser.lastActiveAt ? new Date(selectedUser.lastActiveAt).toLocaleString() : '—'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
