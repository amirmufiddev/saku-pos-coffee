import type {
  EdcTestConnectionParams,
  EdcTestConnectionResult,
} from '../types/edc-config';

export interface EdcSerialPortInfo {
  path: string;
  manufacturer: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

export interface EdcProcessPaymentInput {
  connectionType?: 'TCP_IP' | 'SERIAL';
  portPath?: string;
  host?: string;
  ipTerminal?: string;
  port?: number;
  amount: number;
  paymentType: 'DEBIT' | 'CREDIT' | 'QRIS';
  baudRate?: number;
  timeoutMs?: number;
}

export interface EdcProcessPaymentResult {
  success: boolean;
  responseCode?: string;
  approvalCode?: string;
  maskedCardNo?: string;
  traceNumber?: string;
  referenceNumber?: string;
  rrn?: string;
  terminalId?: string;
  merchantId?: string;
  cardType?: string;
  merchantPan?: string;
  issuerName?: string;
  transactionStatus?: string;
  entryMode?: string;
  transactionType?: string;
  batchNumber?: string;
  invoiceSequence?: string;
  transactionDate?: string;
  transactionTime?: string;
  customerName?: string;
  customerPan?: string;
  reffId?: string;
  terminalAmount?: string;
  inquiryFound?: boolean;
  message: string;
  rawHexResponse?: string;
}

export interface EdcQrisInquiryInput {
  connectionType?: 'TCP_IP' | 'SERIAL';
  portPath?: string;
  host?: string;
  ipTerminal?: string;
  port?: number;
  baudRate?: number;
  timeoutMs?: number;
}

export interface EdcQrisAnyInquiryInput extends EdcQrisInquiryInput {
  referenceNumber: string;
}

export interface EdcVoidTransactionInput {
  portPath: string;
  amount: number;
  paymentType: 'DEBIT' | 'CREDIT' | 'QRIS';
  traceNumber: string;
  baudRate?: number;
  timeoutMs?: number;
}

function getEdcBridge() {
  const win = window as any;
  return win.electronAPI?.edc || win.electron?.edc || null;
}

export const isDesktopPos = (): boolean => {
  const win = window as any;
  return Boolean(win.electronAPI?.isElectron || win.electron?.isElectron || getEdcBridge());
};

export const EdcService = {
  isDesktop: isDesktopPos,

  listPorts: async (): Promise<EdcSerialPortInfo[]> => {
    const bridge = getEdcBridge();
    if (!bridge?.listPorts) {
      return [];
    }
    try {
      return await bridge.listPorts();
    } catch (err: any) {
      console.warn('[EdcService] Failed to list serial ports', err);
      return [];
    }
  },

  testConnection: async (params: EdcTestConnectionParams): Promise<EdcTestConnectionResult> => {
    const bridge = getEdcBridge();
    if (!bridge?.testConnection) {
      return {
        success: false,
        message: 'Test koneksi port USB EDC hanya tersedia di aplikasi POS Desktop (Electron). Jalankan dengan "yarn electron:dev".',
      };
    }

    try {
      return await bridge.testConnection({
        connectionType: params.connectionType,
        host: params.host,
        ipTerminal: params.ipTerminal,
        port: params.port,
        portPath: params.portPath,
        baudRate: params.baudRate,
        timeoutMs: params.timeoutMs ?? 8000,
      });
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Terjadi kesalahan saat menguji koneksi ke mesin EDC.',
      };
    }
  },

  processPayment: async (params: EdcProcessPaymentInput): Promise<EdcProcessPaymentResult> => {
    const bridge = getEdcBridge();
    if (!bridge?.processPayment) {
      return {
        success: false,
        message: 'Komunikasi port serial EDC memerlukan aplikasi POS Desktop (Electron). Jalankan dengan "yarn electron:dev".',
      };
    }

    try {
      return await bridge.processPayment(params);
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Gagal memproses pembayaran ke mesin EDC.',
      };
    }
  },

  voidTransaction: async (params: EdcVoidTransactionInput): Promise<EdcProcessPaymentResult> => {
    const bridge = getEdcBridge();
    if (!bridge?.voidTransaction) {
      return {
        success: false,
        message: 'Fitur Void EDC hanya tersedia di aplikasi POS Desktop.',
      };
    }

    try {
      return await bridge.voidTransaction(params);
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Gagal memproses void pada EDC.',
      };
    }
  },

  inquiryQrisLastTransaction: async (params: EdcQrisInquiryInput): Promise<EdcProcessPaymentResult> => {
    const bridge = getEdcBridge();
    if (!bridge?.inquiryQrisLastTransaction) {
      return {
        success: false,
        message: 'Inquiry QRIS hanya tersedia di aplikasi POS Desktop.',
      };
    }

    try {
      return await bridge.inquiryQrisLastTransaction(params);
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Gagal inquiry transaksi QRIS terakhir.',
      };
    }
  },

  inquiryQrisAnyTransaction: async (params: EdcQrisAnyInquiryInput): Promise<EdcProcessPaymentResult> => {
    const bridge = getEdcBridge();
    if (!bridge?.inquiryQrisAnyTransaction) {
      return {
        success: false,
        message: 'Inquiry QRIS hanya tersedia di aplikasi POS Desktop.',
      };
    }

    try {
      return await bridge.inquiryQrisAnyTransaction(params);
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Gagal inquiry transaksi QRIS dengan nomor referensi.',
      };
    }
  },

  getStatus: async (): Promise<EdcStatus> => {
    const bridge = getEdcBridge();
    if (!bridge?.getStatus) {
      return {
        state: 'DISCONNECTED',
        activePortPath: null,
        activeOperation: null,
        recovery: null,
        savedDevice: null,
      };
    }
    try {
      return await bridge.getStatus();
    } catch (err: any) {
      console.warn('[EdcService] Failed to get EDC status', err);
      return {
        state: 'DISCONNECTED',
        activePortPath: null,
        activeOperation: null,
        recovery: null,
        savedDevice: null,
      };
    }
  },

  resetRecovery: async (reason?: string, method?: string): Promise<{ success: boolean; message: string }> => {
    const bridge = getEdcBridge();
    if (!bridge?.resetRecovery) {
      return { success: false, message: 'Bridge Electron tidak tersedia.' };
    }
    try {
      return await bridge.resetRecovery({ reason, method });
    } catch (err: any) {
      return { success: false, message: err?.message || 'Gagal reset recovery.' };
    }
  },

  onStatusChange: (callback: (status: EdcStatus) => void): (() => void) => {
    const bridge = getEdcBridge();
    if (!bridge?.onStatusChange) {
      return () => {};
    }
    try {
      return bridge.onStatusChange(callback);
    } catch (err: any) {
      console.warn('[EdcService] Failed to listen to EDC status change', err);
      return () => {};
    }
  },
};

export type EdcConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'READY'
  | 'PAYMENT_PENDING'
  | 'RECOVERY_REQUIRED';

export interface EdcRecoveryInfo {
  required: boolean;
  reason: string;
  amount?: number;
  paymentType?: 'DEBIT' | 'CREDIT' | 'QRIS';
  portPath?: string;
  timestamp: string;
  lastError?: string;
}

export interface EdcDeviceIdentifier {
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
  manufacturer?: string;
}

export interface EdcStatus {
  state: EdcConnectionState;
  activePortPath?: string | null;
  activeOperation?: string | null;
  recovery?: EdcRecoveryInfo | null;
  savedDevice?: EdcDeviceIdentifier | null;
}
