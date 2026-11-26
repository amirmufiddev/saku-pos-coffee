export interface SakuPosElectronAPI {
  platform: string;
  isElectron: boolean;
  getPrinters: () => Promise<{
    success: boolean;
    message?: string;
    printers: Array<{ name: string; status?: number; isDefault?: boolean }>;
  }>;
  printCupLabel: (
    params: Record<string, unknown>,
  ) => Promise<{ success: boolean; message?: string; deviceName?: string }>;
  printReceipt: (params: {
    htmlContent?: string;
    deviceName?: string;
    copies?: number;
  }) => Promise<{ success: boolean; message?: string; deviceName?: string; copies?: number }>;
}

declare global {
  interface Window {
    electronAPI?: SakuPosElectronAPI;
  }
}

export {};
