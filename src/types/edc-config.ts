export type EdcConnectionType = 'TCP_IP' | 'SERIAL';
export type EdcPaymentType = 'DEBIT' | 'CREDIT' | 'QRIS';
export type EdcLastTestStatus = 'CONNECTED' | 'FAILED';
export type EdcMasterStatus = 'ACTIVE' | 'INACTIVE' | null;

export interface EdcConfiguration {
  id: string;
  name: string;
  bank: string | null;
  connectionType: EdcConnectionType;
  host: string | null;
  ipPis: string | null;
  ipTerminal: string | null;
  port: number | null;
  baudRate: number;
  portPath: string | null;
  vendorId?: string | null;
  productId?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  isDefault: boolean;
  terminalId: string | null;
  lastTestStatus: EdcLastTestStatus | null;
  lastTestedAt: string | null;
  lastTestError: string | null;
  isActive: boolean;
}

export interface EdcTestConnectionParams {
  connectionType: EdcConnectionType;
  host?: string;
  ipTerminal?: string;
  port?: number;
  portPath?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
  baudRate?: number;
  timeoutMs?: number;
}

export interface EdcTestConnectionResult {
  success: boolean;
  message: string;
  terminalId?: string;
  deviceIdentifier?: {
    vendorId?: string;
    productId?: string;
    serialNumber?: string;
    manufacturer?: string;
  };
}

export const EDC_BAUD_RATE_OPTIONS = [9600, 19200, 38400, 57600, 115200] as const;

/** Konfigurasi standar EDC SakuPOS: TCP port 2001 / baud 9600, serial baud 115200, timeout bayar 180 detik. */
export const EDC_DEFAULT_TCP_PORT = 2001;
export const EDC_DEFAULT_TCP_BAUD_RATE = 9600;
export const EDC_DEFAULT_SERIAL_BAUD_RATE = 115200;
export const EDC_DEFAULT_PAYMENT_TIMEOUT_MS = 180000;

export const POPULAR_INDONESIAN_BANKS = [
  'Danamon',
  'BCA',
  'Mandiri',
  'BRI',
  'BNI',
  'CIMB Niaga',
  'Permata',
  'BSI',
  'Maybank',
  'OCBC NISP',
] as const;

export interface EdcTcpFormValues {
  connectionType: 'TCP_IP';
  name: string;
  bank?: string;
  host: string;
  ipPis: string;
  ipTerminal: string;
  port: number;
  baudRate?: number;
}

export interface EdcSerialFormValues {
  connectionType: 'SERIAL';
  name: string;
  bank?: string;
  portPath: string;
  baudRate: number;
}

export type EdcFormValues = EdcTcpFormValues | EdcSerialFormValues;

export function mapEdcConfigToTestParams(config: EdcConfiguration): EdcTestConnectionParams {
  if (config.connectionType === 'TCP_IP') {
    return {
      connectionType: 'TCP_IP',
      host: config.host ?? undefined,
      ipTerminal: config.ipTerminal ?? undefined,
      port: config.port ?? undefined,
      baudRate: config.baudRate,
    };
  }

  return {
    connectionType: 'SERIAL',
    portPath: config.portPath ?? undefined,
    baudRate: config.baudRate,
  };
}

export function formatEdcConnectionLabel(config: EdcConfiguration): string {
  if (config.connectionType === 'SERIAL') {
    return `${config.portPath || 'Unknown Port'} (${config.baudRate || EDC_DEFAULT_SERIAL_BAUD_RATE} baud)`;
  }
  if (config.ipTerminal && config.port) {
    return `${config.ipTerminal}:${config.port}`;
  }
  return config.host || 'Unknown Host';
}

export function validateEdcConfigForPayment(config: EdcConfiguration): string | null {
  if (config.connectionType === 'SERIAL') {
    if (!config.portPath?.trim()) {
      return 'Port serial EDC belum dikonfigurasi. Buka Pengaturan → EDC Configuration.';
    }
    return null;
  }

  if (!config.host?.trim()) {
    return 'Host wajib diisi untuk pembayaran EDC TCP/IP.';
  }
  if (!config.ipPis?.trim()) {
    return 'IP PIS wajib diisi untuk pembayaran EDC TCP/IP.';
  }
  if (!config.ipTerminal?.trim() || !config.port) {
    return 'IP Terminal dan Port wajib untuk pembayaran EDC TCP/IP.';
  }

  return null;
}

export function mapEdcConfigToPaymentParams(
  config: EdcConfiguration,
  amount: number,
  paymentType: EdcPaymentType,
  timeoutMs = EDC_DEFAULT_PAYMENT_TIMEOUT_MS
) {
  return {
    connectionType: config.connectionType,
    portPath: config.portPath ?? undefined,
    host: config.host ?? undefined,
    ipTerminal: config.ipTerminal ?? undefined,
    port: config.port ?? undefined,
    baudRate: config.baudRate,
    amount,
    paymentType,
    timeoutMs,
  };
}
