import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { postBootstrap, postLogin } from '../services/authApi';
import { PASSWORD_POLICY_HINT, validatePasswordComplexity } from '../utils/passwordPolicy';
import AppLogo from './AppLogo';

interface LoginPageProps {
  needsBootstrap: boolean;
  onLoggedIn: () => void;
}

export default function LoginPage({ needsBootstrap, onLoggedIn }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (username.trim().length < 2) {
      setError('用户名至少 2 个字符');
      return;
    }
    if (needsBootstrap) {
      if (password !== password2) {
        setError('两次输入的密码不一致');
        return;
      }
      const pwErr = validatePasswordComplexity(password);
      if (pwErr) {
        setError(pwErr);
        return;
      }
    } else if (password.length === 0) {
      setError('请输入密码');
      return;
    }
    setLoading(true);
    try {
      if (needsBootstrap) {
        await postBootstrap(username.trim(), password);
      } else {
        await postLogin(username.trim(), password);
      }
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-transparent">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-10 w-full max-w-xl border-white/60 shadow-2xl"
      >
        <div className="flex flex-col items-center mb-8">
          <AppLogo className="w-full h-auto max-h-64 sm:max-h-72 object-center mb-6" />
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight">安全AI 守望者</h1>
          <p className="text-sm text-text-main/55 font-medium mt-2 text-center">
            {needsBootstrap ? '创建首个超级管理员账户' : '请登录以继续'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">用户名</label>
            <input
              className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={loading}
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">密码</label>
            <input
              type="password"
              className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={needsBootstrap ? 'new-password' : 'current-password'}
              disabled={loading}
            />
            {needsBootstrap ? (
              <p className="text-[11px] text-text-main/50 font-medium mt-2 ml-1 leading-relaxed">{PASSWORD_POLICY_HINT}</p>
            ) : null}
          </div>
          {needsBootstrap && (
            <div>
              <label className="text-[10px] font-black text-text-main/40 uppercase tracking-widest ml-1">确认密码</label>
              <input
                type="password"
                className="glass-input w-full px-4 py-3 text-sm font-semibold mt-2"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
              />
            </div>
          )}

          {error && (
            <div className="text-sm font-semibold text-danger-main bg-danger-main/10 border border-danger-main/20 rounded-xl px-4 py-3">{error}</div>
          )}

          <button type="submit" disabled={loading} className="w-full glass-button py-4 flex items-center justify-center gap-2 disabled:opacity-60">
            {loading ? <Loader2 className="animate-spin" size={20} /> : null}
            {needsBootstrap ? '创建并进入系统' : '登录'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
