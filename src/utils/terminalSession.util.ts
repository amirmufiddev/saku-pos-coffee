/** Sesi unlock terminal — PIN wajib lagi setelah TTL atau restart app. */

const UNLOCK_AT_KEY = 'sakupos_terminal_unlocked_at';
const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;

export function markTerminalUnlocked(): void {
  localStorage.setItem(UNLOCK_AT_KEY, String(Date.now()));
}

export function clearTerminalUnlock(): void {
  localStorage.removeItem(UNLOCK_AT_KEY);
}

export function isTerminalSessionUnlocked(): boolean {
  const raw = localStorage.getItem(UNLOCK_AT_KEY);
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at) || Date.now() - at > UNLOCK_TTL_MS) {
    localStorage.removeItem(UNLOCK_AT_KEY);
    return false;
  }
  try {
    const saved = localStorage.getItem('sakupos_user');
    return Boolean(saved);
  } catch {
    return false;
  }
}
