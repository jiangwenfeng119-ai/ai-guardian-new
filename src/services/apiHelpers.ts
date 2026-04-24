/** Shared fetch helpers for authenticated API clients. */

export async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (j && typeof j.error === 'string') return j.error;
    if (j && typeof j.message === 'string') return j.message;
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`;
}

export function checkSession(res: Response) {
  if (res.status === 401) throw new Error('SESSION_EXPIRED');
}
