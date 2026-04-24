import type { LocaleId } from './i18n';

/** Default `lastSyncAt` when standards API has never run (stored value, Chinese). */
export const SYNC_LAST_NEVER_ZH = '从未同步';

/** Default legal fetch prompt in settings (stored value, Chinese). */
export const SYNC_DEFAULT_LEGAL_KEYWORD_ZH = '信息安全 法律法规';

const isEn = (locale: LocaleId) => locale === 'en-US';

/**
 * Display `ApiSyncSettings.lastSyncAt` for UI. Keeps stored Chinese sentinel; only the label changes by locale.
 */
export function displayStandardsLastSyncAt(value: string | undefined | null, locale: LocaleId): string {
  const v = String(value ?? '').trim();
  if (!v || v === SYNC_LAST_NEVER_ZH) {
    return isEn(locale) ? 'Never synced' : SYNC_LAST_NEVER_ZH;
  }
  return String(value);
}

/** Short label when legal library has no successful sync timestamp yet. */
export function displayLegalNotSyncedLabel(locale: LocaleId): string {
  return isEn(locale) ? 'Not synced' : '未同步';
}

/**
 * Regulation library “sync version” line (date code or not-synced).
 * Mirrors previous behavior: YYYY.MM.DD-HHmm in local time parts.
 */
export function displayLegalSyncVersionLabel(legalLastSyncAt: string | undefined | null, locale: LocaleId): string {
  const ts = String(legalLastSyncAt ?? '').trim();
  if (!ts) return displayLegalNotSyncedLabel(locale);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return displayLegalNotSyncedLabel(locale);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * “Latest sync time” row: formatted instant, or not-synced / em dash when empty.
 */
export function displayLegalLastSyncAtLine(
  legalLastSyncAt: string | undefined | null,
  locale: LocaleId,
  formatLocalTime: (value: string) => string
): string {
  const ts = String(legalLastSyncAt ?? '').trim();
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return displayLegalNotSyncedLabel(locale);
  return formatLocalTime(ts);
}

/** True when the textarea still holds the built-in default Chinese prompt. */
export function isDefaultLegalSearchKeyword(value: string | undefined | null): boolean {
  return String(value ?? '').trim() === SYNC_DEFAULT_LEGAL_KEYWORD_ZH;
}
