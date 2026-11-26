// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  ping: () => ipcRenderer.invoke('ping'),
  openCustomerDisplay: () => ipcRenderer.invoke('open-customer-display'),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  sendCdsMessage: (message: any) => ipcRenderer.send('cds-message', message),
  onCdsMessage: (callback: (message: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cds-message-reply', handler);
    return () => {
      ipcRenderer.removeListener('cds-message-reply', handler);
    };
  },
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  printCupLabel: (params: Record<string, unknown>) =>
    ipcRenderer.invoke('print-cup-label', params),
  printReceipt: (params: { htmlContent?: string; deviceName?: string; copies?: number }) =>
    ipcRenderer.invoke('print-receipt', params),
  edc: {
    listPorts: () => ipcRenderer.invoke('edc:list-ports'),
    testConnection: (params: any) => ipcRenderer.invoke('edc:test-connection', params),
    processPayment: (params: any) => ipcRenderer.invoke('edc:process-payment', params),
    voidTransaction: (params: any) => ipcRenderer.invoke('edc:void-transaction', params),
    settleTransaction: (params: any) => ipcRenderer.invoke('edc:settle-transaction', params),
    inquiryQrisLastTransaction: (params: any) => ipcRenderer.invoke('edc:inquiry-qris-last', { ...params, inquiryKind: 'LAST' }),
    inquiryQrisAnyTransaction: (params: any) => ipcRenderer.invoke('edc:inquiry-qris-any', { ...params, inquiryKind: 'ANY' }),
    getStatus: () => ipcRenderer.invoke('edc:get-status'),
    resetRecovery: (params: any) => ipcRenderer.invoke('edc:reset-recovery', params),
    onStatusChange: (callback: any) => {
      const sub = (_e: any, status: any) => callback(status);
      ipcRenderer.on('edc:status-changed', sub);
      return () => ipcRenderer.removeListener('edc:status-changed', sub);
    },
  },
});
