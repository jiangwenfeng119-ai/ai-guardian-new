export type LocaleId = 'zh-CN' | 'en-US';

const KEY = 'ai_guardian_locale_v1';

export function getLocale(): LocaleId {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'en-US' ? 'en-US' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

export function setLocale(next: LocaleId) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent('app-locale-change', { detail: next }));
}

