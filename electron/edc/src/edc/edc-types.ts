import type { SerialPort } from 'serialport';

export type EdcConnectionType = 'TCP_IP' | 'SERIAL';
export type EdcPaymentType = 'DEBIT' | 'CREDIT' | 'QRIS';

export interface EDCProcessPaymentParams {
    connectionType?: EdcConnectionType;
    portPath?: string;
    host?: string;
    ipTerminal?: string;
    port?: number;
    amount: number;
    paymentType: EdcPaymentType;
    baudRate?: number;
    timeoutMs?: number;
}

export interface EDCVoidTransactionParams {
    portPath: string;
    amount: number;
    paymentType: EdcPaymentType;
    traceNumber: string;
    baudRate?: number;
    timeoutMs?: number;
}

export interface EdcSettleTransactionParams {
    portPath: string;
    baudRate?: number;
    timeoutMs?: number;
}

export type EdcQrisInquiryKind = 'LAST' | 'ANY';

export interface EdcQrisInquiryParams {
    inquiryKind: 'LAST';
    connectionType?: EdcConnectionType;
    portPath?: string;
    host?: string;
    ipTerminal?: string;
    port?: number;
    baudRate?: number;
    timeoutMs?: number;
}

export interface EdcQrisAnyInquiryParams extends Omit<EdcQrisInquiryParams, 'inquiryKind'> {
    inquiryKind: 'ANY';
    referenceNumber: string;
}

export interface EdcTestConnectionParams {
    connectionType: EdcConnectionType;
    host?: string;
    ipTerminal?: string;
    port?: number;
    portPath?: string;
    baudRate?: number;
    timeoutMs?: number;
}

export interface EdcTestConnectionResponse {
    success: boolean;
    message: string;
    terminalId?: string;
    deviceIdentifier?: EdcDeviceIdentifier;
}

export interface EDCProcessPaymentResponse {
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

export interface EdcParsedResponse {
    respCode: string;
    approvalCode: string;
    maskedCardNo: string;
    traceNumber: string;
    referenceNumber: string;
    rrn: string;
    terminalId: string;
    merchantId: string;
    cardType: string;
    merchantPan: string;
    issuerName: string;
    transactionStatus: string;
    entryMode: string;
    transactionType: string;
    batchNumber: string;
    invoiceSequence: string;
    transactionDate: string;
    transactionTime: string;
    customerName: string;
    customerPan: string;
    reffId: string;
    terminalAmount: string;
    inquiryFound: boolean;
    detail: string;
}

/** Status koneksi dan diagnostik EDC */
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
    paymentType?: EdcPaymentType;
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

export interface EdcPortResolutionResult {
    resolvedPath: string | null;
    matchedByIdentity: boolean;
    ambiguous: boolean;
    candidatePaths: string[];
    error?: string;
}

export interface EdcStatus {
    state: EdcConnectionState;
    activePortPath?: string | null;
    activeOperation?: string | null;
    recovery?: EdcRecoveryInfo | null;
    savedDevice?: EdcDeviceIdentifier | null;
}

/** Akses port serial aktif dengan pengawasan concurrency & recovery — diimplementasi oleh EDCManager. */
export interface EdcSerialHost {
    createPort?(options: any): SerialPort;
    getActivePort(): SerialPort | null;
    setActivePort(port: SerialPort | null): void;
    cleanup(portToClose?: SerialPort | null): void;
    markRecoveryRequired?(info: {
        reason: string;
        amount?: number;
        paymentType?: EdcPaymentType;
        portPath?: string;
        lastError?: string;
    }): void;
    getOperationId?(): string;
}
