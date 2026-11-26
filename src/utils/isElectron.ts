export function isElectron(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as Window & { electronAPI?: { isElectron?: boolean } };
  return Boolean(win.electronAPI?.isElectron);
}
