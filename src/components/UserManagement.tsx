import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, KeyRound, Pencil, Search, Info } from 'lucide-react';
import { fetchUsers, patchUser, postUser, type UserRecord } from '../services/authApi';
import { ROLES, type BaseInfoSettings, type Role } from '../permissions';
import { PASSWORD_POLICY_BULLETS, validatePasswordComplexity } from '../utils/passwordPolicy';
import { getLocale, type LocaleId } from '../i18n';

interface UserManagementProps {
  currentUserId: string;
  baseInfo: BaseInfoSettings;
  onUsersChanged?: () => void;
  onSessionExpired?: () => void;
}

type UserForm = {
  username: string;
  password: string;
  role: Role;
  companyId: string;
  projectId: string;
  teamId: string;
  description: string;
  visibleCompanyIds: string[];
  visibleProjectIds: string[];
};

const EMPTY_FORM: UserForm = {
  username: '',
  password: '',
  role: 'Viewer',
  companyId: '',
  projectId: '',
  teamId: '',
  description: '',
  visibleCompanyIds: [],
  visibleProjectIds: [],
};

export default function UserManagement({ currentUserId, baseInfo, onUsersChanged, onSessionExpired }: UserManagementProps) {
  const [locale, setLocale] = useState<LocaleId>(() => getLocale());
  const tx = (zh: string, en: string) => (locale === 'en-US' ? en : zh);
  useEffect(() => {
    const onLocale = (e: Event) => {
      const next = (e as CustomEvent<LocaleId>).detail;
      if (next === 'en-US' || next === 'zh-CN') setLocale(next);
    };
    window.addEventListener('app-locale-change', onLocale as EventListener);
    return () => window.removeEventListener('app-locale-change', onLocale as EventListener);
  }, []);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [userForm, setUserForm] = useState<UserForm>(EMPTY_FORM);
  const [savingUser, setSavingUser] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [policyPopoverFor, setPolicyPopoverFor] = useState<null | 'create' | 'edit' | 'reset'>(null);

  const [pwdModal, setPwdModal] = useState<{ id: string; username: string } | null>(null);
  const [pwdNew, setPwdNew] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [pwdModalError, setPwdModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { users: list } = await fetchUsers();
      setUsers(list);
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        onSessionExpired?.();
        return;
      }
      setError(e instanceof Error ? e.message : tx('加载用户失败', 'Failed to load users'));
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreateModal = () => {
    setError(null);
    setUserForm(EMPTY_FORM);
    setCreateModalOpen(true);
  };
  const openEditModal = (u: UserRecord) => {
    setError(null);
    setEditingUser(u);
    setUserForm({
      username: u.username,
      password: '',
      role: (u.role as Role) || 'Viewer',
      companyId: u.companyId || '',
      projectId: u.projectId || '',
      teamId: u.teamId || '',
      description: u.description || '',
      visibleCompanyIds: Array.isArray(u.visibleCompanyIds) ? u.visibleCompanyIds : [],
      visibleProjectIds: Array.isArray(u.visibleProjectIds) ? u.visibleProjectIds : [],
    });
  };

  const companyProjects = useMemo(
    () => baseInfo.projects.filter((p) => p.companyId === userForm.companyId),
    [baseInfo.projects, userForm.companyId]
  );
  const companyTeams = useMemo(
    () =>
      baseInfo.teams.filter((t) => {
        if (t.companyId !== userForm.companyId) return false;
        if (!userForm.projectId) return true;
        if (!Array.isArray(t.projectIds) || t.projectIds.length === 0) return true;
        return t.projectIds.includes(userForm.projectId);
      }),
    [baseInfo.teams, userForm.companyId, userForm.projectId]
  );
  const companyNameById = useMemo(
    () => Object.fromEntries(baseInfo.companies.map((c) => [c.id, c.name || c.id])),
    [baseInfo.companies]
  );
  const projectNameById = useMemo(
    () => Object.fromEntries(baseInfo.projects.map((p) => [p.id, p.name || p.id])),
    [baseInfo.projects]
  );
  const teamNameById = useMemo(
    () => Object.fromEntries(baseInfo.teams.map((t) => [t.id, t.name || t.id])),
    [baseInfo.teams]
  );
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const company = String(companyNameById[u.companyId || ''] || u.companyId || '').toLowerCase();
      const project = String(projectNameById[u.projectId || ''] || u.projectId || '').toLowerCase();
      const team = String(teamNameById[u.teamId || ''] || u.teamId || '').toLowerCase();
      return company.includes(q) || project.includes(q) || team.includes(q) || String(u.username || '').toLowerCase().includes(q);
    });
  }, [users, userSearch, companyNameById, projectNameById, teamNameById]);

  const validateUserForm = (forCreate: boolean): string | null => {
    if (userForm.username.trim().length < 2) return tx('用户名至少 2 个字符', 'Username must be at least 2 characters');
    if (forCreate) {
      const pwErr = validatePasswordComplexity(userForm.password);
      if (pwErr) return pwErr;
    } else if (userForm.password.trim()) {
      const pwErr = validatePasswordComplexity(userForm.password);
      if (pwErr) return pwErr;
    }
    if (!userForm.companyId || !userForm.projectId || !userForm.teamId) {
      return tx('必须选择公司、项目和团队', 'Company, project and team are required');
    }
    return null;
  };

  const addUser = async () => {
    setError(null);
    const err = validateUserForm(true);
    if (err) {
      setError(err);
      return;
    }
    setSavingUser(true);
    try {
      await postUser({
        username: userForm.username.trim(),
        password: userForm.password,
        role: userForm.role,
        companyId: userForm.companyId,
        projectId: userForm.projectId,
        teamId: userForm.teamId,
        description: userForm.description.trim(),
        visibleCompanyIds: userForm.visibleCompanyIds,
        visibleProjectIds: userForm.visibleProjectIds,
      });
      setCreateModalOpen(false);
      setUserForm(EMPTY_FORM);
      setNotice(tx('用户已创建', 'User created'));
      setTimeout(() => setNotice(null), 2000);
      await load();
      onUsersChanged?.();
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        onSessionExpired?.();
        return;
      }
      setError(e instanceof Error ? e.message : tx('创建失败', 'Create failed'));
    } finally {
      setSavingUser(false);
    }
  };

  const changeRole = async (u: UserRecord, role: Role) => {
    setError(null);
    try {
      await patchUser(u.id, { role });
      setNotice(tx('角色已更新', 'Role updated'));
      setTimeout(() => setNotice(null), 2000);
      await load();
      onUsersChanged?.();
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        onSessionExpired?.();
        return;
      }
      setError(e instanceof Error ? e.message : tx('更新失败', 'Update failed'));
    }
  };

  const openPasswordModal = (u: UserRecord) => {
    setError(null);
    setPwdModalError(null);
    setPwdModal({ id: u.id, username: u.username });
    setPwdNew('');
    setPwdConfirm('');
  };

  const closePasswordModal = () => {
    if (pwdSubmitting) return;
    setPwdModal(null);
    setPwdNew('');
    setPwdConfirm('');
    setPwdModalError(null);
  };

  const submitPasswordChange = async () => {
    if (!pwdModal) return;
    setPwdModalError(null);
    if (pwdNew !== pwdConfirm) {
      setPwdModalError(tx('两次输入的密码不一致', 'Passwords do not match'));
      return;
    }
    const pwErr = validatePasswordComplexity(pwdNew);
    if (pwErr) {
      setPwdModalError(pwErr);
      return;
    }
    setPwdSubmitting(true);
    try {
      await patchUser(pwdModal.id, { password: pwdNew });
      setPwdModal(null);
      setPwdNew('');
      setPwdConfirm('');
      setPwdModalError(null);
      setNotice(tx('密码已更新', 'Password updated'));
      setTimeout(() => setNotice(null), 2000);
      onUsersChanged?.();
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        onSessionExpired?.();
        return;
      }
      setPwdModalError(e instanceof Error ? e.message : tx('修改密码失败', 'Password update failed'));
    } finally {
      setPwdSubmitting(false);
    }
  };

  useEffect(() => {
    if (!pwdModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || pwdSubmitting) return;
      setPwdModal(null);
      setPwdNew('');
      setPwdConfirm('');
      setPwdModalError(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pwdModal, pwdSubmitting]);

  const saveEditedUser = async () => {
    if (!editingUser) return;
    const err = validateUserForm(false);
    if (err) {
      setError(err);
      return;
    }
    setSavingUser(true);
    setError(null);
    try {
      await patchUser(editingUser.id, {
        role: userForm.role,
        companyId: userForm.companyId,
        projectId: userForm.projectId,
        teamId: userForm.teamId,
        description: userForm.description.trim(),
        visibleCompanyIds: userForm.visibleCompanyIds,
        visibleProjectIds: userForm.visibleProjectIds,
        ...(userForm.password.trim() ? { password: userForm.password } : {}),
      });
      setEditingUser(null);
      setUserForm(EMPTY_FORM);
      setNotice(tx('用户信息已更新', 'User updated'));
      setTimeout(() => setNotice(null), 2000);
      await load();
      onUsersChanged?.();
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        onSessionExpired?.();
        return;
      }
      setError(e instanceof Error ? e.message : tx('更新失败', 'Update failed'));
    } finally {
      setSavingUser(false);
    }
  };

  return (
    <section className="glass-card p-8 bg-white/40 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-black">{tx('用户管理', 'User Management')}</h3>
          <p className="text-xs text-text-main/55 font-medium mt-1">{tx('新增用户必须绑定公司、项目、团队；已有用户支持编辑归属信息。', 'New users must bind company, project and team; existing users can edit ownership.')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-main/40" />
            <input
              className="glass-input pl-8 pr-3 py-2 text-xs font-semibold w-[220px]"
              placeholder={tx('搜索公司/项目/团队/用户', 'Search company/project/team/user')}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />
          </div>
          <button type="button" onClick={load} className="glass-card px-4 py-2 text-xs font-black uppercase tracking-widest hover:bg-white/60 w-fit">
            {tx('刷新列表', 'Refresh')}
          </button>
          <button type="button" onClick={openCreateModal} className="glass-button flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest">
            <Plus size={16} />
            {tx('新建用户', 'New User')}
          </button>
        </div>
      </div>

      {notice && <p className="text-sm font-semibold text-success-main">{notice}</p>}
      {error && <p className="text-sm font-semibold text-danger-main">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-text-main/50">
          <Loader2 className="animate-spin" size={18} /> {tx('加载中…', 'Loading...')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-text-main/50">
                <th className="py-2 font-black text-[10px] uppercase tracking-widest">{tx('用户', 'User')}</th>
                <th className="py-2 font-black text-[10px] uppercase tracking-widest">{tx('角色', 'Role')}</th>
                <th className="py-2 font-black text-[10px] uppercase tracking-widest">{tx('公司 / 项目 / 团队', 'Company / Project / Team')}</th>
                <th className="py-2 font-black text-[10px] uppercase tracking-widest">{tx('操作', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} className="border-t border-white/50">
                  <td className="py-3 font-bold">
                    {u.username}
                    {u.id === currentUserId ? <span className="ml-2 text-[10px] text-accent font-black">{tx('(当前)', '(Current)')}</span> : null}
                  </td>
                  <td className="py-3">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value as Role)}
                      className="glass-input px-3 py-2 text-xs font-semibold"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 text-xs font-medium text-text-main/70">
                    <div>{companyNameById[u.companyId || ''] || u.companyId || '—'}</div>
                    <div>{projectNameById[u.projectId || ''] || u.projectId || '—'}</div>
                    <div>{teamNameById[u.teamId || ''] || u.teamId || '—'}</div>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditModal(u)}
                        className="p-2 rounded-lg text-accent hover:bg-accent/10"
                        title={tx('编辑用户信息', 'Edit user')}
                      >
                        <Pencil size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openPasswordModal(u)}
                        className="p-2 rounded-lg text-accent hover:bg-accent/10"
                        title={tx('修改密码', 'Change password')}
                      >
                        <KeyRound size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pwdModal ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-text-main/40 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwd-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePasswordModal();
          }}
        >
          <div className="glass-card w-full max-w-md border-white/70 shadow-2xl p-8 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div>
              <h4 id="pwd-modal-title" className="text-lg font-black">
                {tx('修改密码', 'Change Password')}
              </h4>
              <p className="text-sm text-text-main/55 font-medium mt-1">{tx('用户', 'User')}: {pwdModal.username}</p>
            </div>
            {pwdModalError ? (
              <div className="text-sm font-semibold text-danger-main bg-danger-main/10 border border-danger-main/20 rounded-xl px-4 py-3">{pwdModalError}</div>
            ) : null}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{tx('新密码', 'New Password')}</label>
                <button type="button" className="text-[11px] font-bold text-accent flex items-center gap-1" onClick={() => setPolicyPopoverFor('reset')}>
                  <Info size={12} />
                  {tx('查看复杂度要求', 'View complexity policy')}
                </button>
              </div>
              <input
                type="password"
                autoComplete="new-password"
                className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
                value={pwdNew}
                onChange={(e) => setPwdNew(e.target.value)}
                disabled={pwdSubmitting}
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">{tx('确认新密码', 'Confirm New Password')}</label>
              <input
                type="password"
                autoComplete="new-password"
                className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
                value={pwdConfirm}
                onChange={(e) => setPwdConfirm(e.target.value)}
                disabled={pwdSubmitting}
              />
            </div>
            <div className="rounded-xl border border-white/50 bg-white/30 px-3 py-2.5">
              <p className="text-[10px] font-black text-text-main/45 uppercase tracking-widest mb-1.5">{tx('密码复杂度要求', 'Password Policy')}</p>
              <ul className="text-[11px] text-text-main/75 font-medium space-y-1 list-disc pl-4 leading-snug">
                {PASSWORD_POLICY_BULLETS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-3 justify-end pt-2">
              <button type="button" className="glass-card px-5 py-2.5 text-sm font-bold hover:bg-white/70" onClick={closePasswordModal} disabled={pwdSubmitting}>
                {tx('取消', 'Cancel')}
              </button>
              <button type="button" className="glass-button px-5 py-2.5 text-sm font-bold flex items-center gap-2" onClick={submitPasswordChange} disabled={pwdSubmitting}>
                {pwdSubmitting ? <Loader2 className="animate-spin" size={18} /> : null}
                {tx('保存', 'Save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createModalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-text-main/40 backdrop-blur-[2px]">
          <div className="glass-card w-full max-w-2xl border-white/70 shadow-2xl p-8 space-y-5">
            <h4 className="text-lg font-black">{tx('新建用户', 'New User')}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input className="glass-input px-4 py-3 text-sm font-semibold" placeholder={tx('用户名', 'Username')} value={userForm.username} onChange={(e) => setUserForm((p) => ({ ...p, username: e.target.value }))} />
              <input className="glass-input px-4 py-3 text-sm font-semibold" placeholder={tx('初始密码', 'Initial Password')} type="password" value={userForm.password} onChange={(e) => setUserForm((p) => ({ ...p, password: e.target.value }))} />
              <button type="button" className="md:col-span-2 text-xs font-bold text-accent w-fit" onClick={() => setPolicyPopoverFor('create')}>
                {tx('查看密码复杂度要求', 'View password policy')}
              </button>
              <select className="glass-input px-4 py-3 text-sm font-semibold" value={userForm.role} onChange={(e) => setUserForm((p) => ({ ...p, role: e.target.value as Role }))}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input className="glass-input px-4 py-3 text-sm font-semibold" placeholder={tx('说明（可选）', 'Description (optional)')} value={userForm.description} onChange={(e) => setUserForm((p) => ({ ...p, description: e.target.value }))} />
              <select className="glass-input px-4 py-3 text-sm font-semibold" value={userForm.companyId} onChange={(e) => setUserForm((p) => ({ ...p, companyId: e.target.value, projectId: '', teamId: '' }))}>
                <option value="">{tx('选择公司（必选）', 'Select company (required)')}</option>
                {baseInfo.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id}
                  </option>
                ))}
              </select>
              <select className="glass-input px-4 py-3 text-sm font-semibold" value={userForm.projectId} onChange={(e) => setUserForm((p) => ({ ...p, projectId: e.target.value, teamId: '' }))}>
                <option value="">{tx('选择项目（必选）', 'Select project (required)')}</option>
                {companyProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
              </select>
              <select className="glass-input px-4 py-3 text-sm font-semibold md:col-span-2" value={userForm.teamId} onChange={(e) => setUserForm((p) => ({ ...p, teamId: e.target.value }))}>
                <option value="">{tx('选择团队（必选）', 'Select team (required)')}</option>
                {companyTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name || t.id}
                  </option>
                ))}
              </select>
              <div className="md:col-span-2 rounded-xl border border-black/10 bg-white/60 p-3 space-y-2">
                <p className="text-[10px] font-black text-text-main/45 uppercase tracking-widest">{tx('数据可见范围（公司与项目）', 'Data visibility (company and project)')}</p>
                {baseInfo.companies.map((c) => {
                  const companyChecked = userForm.visibleCompanyIds.includes(c.id);
                  const ps = baseInfo.projects.filter((p) => p.companyId === c.id);
                  return (
                    <div key={c.id} className="rounded-lg border border-black/10 bg-white/70 p-2.5 space-y-2">
                      <label className="text-xs font-semibold flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={companyChecked}
                          onChange={(e) =>
                            setUserForm((prev) => {
                              const nextCompanies = e.target.checked
                                ? Array.from(new Set([...prev.visibleCompanyIds, c.id]))
                                : prev.visibleCompanyIds.filter((id) => id !== c.id);
                              const projectIdsOfCompany = ps.map((x) => x.id);
                              const nextProjects = e.target.checked
                                ? prev.visibleProjectIds
                                : prev.visibleProjectIds.filter((id) => !projectIdsOfCompany.includes(id));
                              return { ...prev, visibleCompanyIds: nextCompanies, visibleProjectIds: nextProjects };
                            })
                          }
                        />
                        {c.name || c.id}
                      </label>
                      {ps.length > 0 ? (
                        <div className="grid grid-cols-2 gap-1 pl-6">
                          {ps.map((p) => (
                            <label key={p.id} className="text-xs font-medium flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={userForm.visibleProjectIds.includes(p.id)}
                                onChange={(e) =>
                                  setUserForm((prev) => {
                                    const nextProjects = e.target.checked
                                      ? Array.from(new Set([...prev.visibleProjectIds, p.id]))
                                      : prev.visibleProjectIds.filter((id) => id !== p.id);
                                    const nextCompanies = e.target.checked
                                      ? Array.from(new Set([...prev.visibleCompanyIds, c.id]))
                                      : prev.visibleCompanyIds;
                                    return { ...prev, visibleCompanyIds: nextCompanies, visibleProjectIds: nextProjects };
                                  })
                                }
                              />
                              {p.name || p.id}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="pl-6 text-[11px] text-text-main/45">{tx('该公司暂无项目', 'No projects under this company')}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl border border-white/50 bg-white/30 px-3 py-2.5">
              <p className="text-[10px] font-black text-text-main/45 uppercase tracking-widest mb-1.5">{tx('密码复杂度要求', 'Password Policy')}</p>
              <ul className="text-[11px] text-text-main/75 font-medium space-y-1 list-disc pl-4 leading-snug">
                {PASSWORD_POLICY_BULLETS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="glass-card px-4 py-2 text-sm font-bold" onClick={() => setCreateModalOpen(false)} disabled={savingUser}>
                {tx('取消', 'Cancel')}
              </button>
              <button type="button" className="glass-button px-4 py-2 text-sm font-bold" onClick={addUser} disabled={savingUser}>
                {savingUser ? tx('保存中…', 'Saving...') : tx('创建用户', 'Create User')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingUser ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-text-main/40 backdrop-blur-[2px]">
          <div className="glass-card w-full max-w-2xl border-white/70 shadow-2xl p-8 space-y-5">
            <h4 className="text-lg font-black">{tx('编辑用户', 'Edit User')}: {editingUser.username}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select className="glass-input px-4 py-3 text-sm font-semibold" value={userForm.role} onChange={(e) => setUserForm((p) => ({ ...p, role: e.target.value as Role }))}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input className="glass-input px-4 py-3 text-sm font-semibold" placeholder={tx('重置密码（留空不改）', 'Reset password (leave empty to keep)')} type="password" value={userForm.password} onChange={(e) => setUserForm((p) => ({ ...p, password: e.target.value }))} />
              <button type="button" className="md:col-span-2 text-xs font-bold text-accent w-fit" onClick={() => setPolicyPopoverFor('edit')}>
                {tx('查看密码复杂度要求', 'View password policy')}
              </button>
              <input className="glass-input px-4 py-3 text-sm font-semibold md:col-span-2" placeholder={tx('说明', 'Description')} value={userForm.description} onChange={(e) => setUserForm((p) => ({ ...p, description: e.target.value }))} />
              <select className="glass-input px-4 py-3 text-sm font-semibold" value={userForm.companyId} onChange={(e) => setUserForm((p) => ({ ...p, companyId: e.target.value, projectId: '', teamId: '' }))}>
                <option value="">{tx('选择公司（必选）', 'Select company (required)')}</option>
                {baseInfo.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id}
                  </option>
                ))}
              </select>
              <select className="glass-input px-4 py-3 text-sm font-semibold" value={userForm.projectId} onChange={(e) => setUserForm((p) => ({ ...p, projectId: e.target.value, teamId: '' }))}>
                <option value="">{tx('选择项目（必选）', 'Select project (required)')}</option>
                {companyProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
              </select>
              <select className="glass-input px-4 py-3 text-sm font-semibold md:col-span-2" value={userForm.teamId} onChange={(e) => setUserForm((p) => ({ ...p, teamId: e.target.value }))}>
                <option value="">{tx('选择团队（必选）', 'Select team (required)')}</option>
                {companyTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name || t.id}
                  </option>
                ))}
              </select>
              <div className="md:col-span-2 rounded-xl border border-black/10 bg-white/60 p-3 space-y-2">
                <p className="text-[10px] font-black text-text-main/45 uppercase tracking-widest">{tx('数据可见范围（公司与项目）', 'Data visibility (company and project)')}</p>
                {baseInfo.companies.map((c) => {
                  const companyChecked = userForm.visibleCompanyIds.includes(c.id);
                  const ps = baseInfo.projects.filter((p) => p.companyId === c.id);
                  return (
                    <div key={c.id} className="rounded-lg border border-black/10 bg-white/70 p-2.5 space-y-2">
                      <label className="text-xs font-semibold flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={companyChecked}
                          onChange={(e) =>
                            setUserForm((prev) => {
                              const nextCompanies = e.target.checked
                                ? Array.from(new Set([...prev.visibleCompanyIds, c.id]))
                                : prev.visibleCompanyIds.filter((id) => id !== c.id);
                              const projectIdsOfCompany = ps.map((x) => x.id);
                              const nextProjects = e.target.checked
                                ? prev.visibleProjectIds
                                : prev.visibleProjectIds.filter((id) => !projectIdsOfCompany.includes(id));
                              return { ...prev, visibleCompanyIds: nextCompanies, visibleProjectIds: nextProjects };
                            })
                          }
                        />
                        {c.name || c.id}
                      </label>
                      {ps.length > 0 ? (
                        <div className="grid grid-cols-2 gap-1 pl-6">
                          {ps.map((p) => (
                            <label key={p.id} className="text-xs font-medium flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={userForm.visibleProjectIds.includes(p.id)}
                                onChange={(e) =>
                                  setUserForm((prev) => {
                                    const nextProjects = e.target.checked
                                      ? Array.from(new Set([...prev.visibleProjectIds, p.id]))
                                      : prev.visibleProjectIds.filter((id) => id !== p.id);
                                    const nextCompanies = e.target.checked
                                      ? Array.from(new Set([...prev.visibleCompanyIds, c.id]))
                                      : prev.visibleCompanyIds;
                                    return { ...prev, visibleCompanyIds: nextCompanies, visibleProjectIds: nextProjects };
                                  })
                                }
                              />
                              {p.name || p.id}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="pl-6 text-[11px] text-text-main/45">{tx('该公司暂无项目', 'No projects under this company')}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="glass-card px-4 py-2 text-sm font-bold" onClick={() => setEditingUser(null)} disabled={savingUser}>
                {tx('取消', 'Cancel')}
              </button>
              <button type="button" className="glass-button px-4 py-2 text-sm font-bold" onClick={saveEditedUser} disabled={savingUser}>
                {savingUser ? tx('保存中…', 'Saving...') : tx('保存修改', 'Save Changes')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {policyPopoverFor && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-text-main/40 backdrop-blur-[2px]" onClick={() => setPolicyPopoverFor(null)}>
          <div className="glass-card w-full max-w-md border-white/70 shadow-2xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-base font-black">{tx('密码复杂度要求', 'Password Policy')}</h4>
            <ul className="text-xs text-text-main/75 font-medium space-y-1 list-disc pl-4 leading-snug">
              {PASSWORD_POLICY_BULLETS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="pt-2 flex justify-end">
              <button type="button" className="glass-button px-4 py-2 text-xs font-black uppercase tracking-widest" onClick={() => setPolicyPopoverFor(null)}>
                {tx('我知道了', 'Got it')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
