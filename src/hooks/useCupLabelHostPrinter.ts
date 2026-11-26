import { useEffect, useRef } from 'react';
import { api } from '../services/api';
import { isElectron } from '../utils/isElectron';

type ElectronPrintApi = {
  printCupLabel: (params: { html: string }) => Promise<{ success: boolean; message?: string }>;
};

export function useCupLabelHostPrinter(enabled: boolean): void {
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled || !isElectron()) return;

    const electronApi = (window as Window & { electronAPI?: ElectronPrintApi }).electronAPI;
    if (!electronApi?.printCupLabel) return;

    const tick = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const pending = await api.getPendingHostCupLabels();
        if (!pending.delegateToHost || pending.jobs.length === 0) return;

        for (const job of pending.jobs) {
          const result = await electronApi.printCupLabel({ html: job.html });
          await api.completeHostCupLabel(job.id, result.success, result.message);
        }
      } catch {
        // retry on next interval
      } finally {
        busyRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      tick().catch(() => {});
    }, 2000);

    tick().catch(() => {});

    return () => window.clearInterval(timer);
  }, [enabled]);
}
