/** 新建/重置密码时的复杂度要求（与 server/api.cjs 保持一致） */
export const PASSWORD_POLICY_HINT =
  '至少 8 位，且须同时包含英文字母、数字和特殊字符（不含空格）';

/** 用于弹层/说明中的分条展示 */
export const PASSWORD_POLICY_BULLETS: readonly string[] = [
  '长度不少于 8 位',
  '包含至少一个英文字母（a–z 或 A–Z）',
  '包含至少一个数字（0–9）',
  '包含至少一个特殊字符（如 !@#$ 等，不能仅为字母、数字或空格）',
];

/**
 * @returns 错误提示文案；通过时返回 `null`
 */
export function validatePasswordComplexity(password: string): string | null {
  if (password.length < 8) return '密码长度至少为 8 位';
  if (!/[a-zA-Z]/.test(password)) return '密码需包含至少一个英文字母';
  if (!/\d/.test(password)) return '密码需包含至少一个数字';
  if (!/[^a-zA-Z0-9\s]/.test(password)) return '密码需包含至少一个特殊字符（不能仅为字母、数字或空格）';
  return null;
}
