import type { EdcParsedResponse, EdcPaymentType } from './edc-types';
import type { SerialPort } from 'serialport';

export const DANAMON_AMOUNT_PREFIX = '10000000';
export const DANAMON_AMOUNT_MAX_RUPIAH = 999_999;

export const VOID_PIPE_FIELD = {
    TERMINAL_ID: 0,
    REFERENCE: 1,
    CARD_TYPE: 2,
    MASKED_CARD: 3,
    ENTRY_MODE: 4,
    TRANSACTION_TYPE: 5,
    BATCH: 6,
    INVOICE: 7,
    DATE: 8,
    TIME: 9,
    RRN: 10,
    APPROVAL: 11,
    AMOUNT_OR_STATUS: 12
} as const;

export const LINK_CONTROL_BYTE_NAMES: Readonly<Record<number, string>> = {
    0x02: 'STX',
    0x03: 'ETX',
    0x04: 'EOT',
    0x05: 'ENQ',
    0x06: 'ACK',
    0x15: 'NAK'
};

const EMPTY_PARSED_FIELDS = {
    approvalCode: '',
    maskedCardNo: '',
    traceNumber: '',
    referenceNumber: '',
    rrn: '',
    terminalId: '',
    merchantId: '',
    cardType: '',
    merchantPan: '',
    issuerName: '',
    transactionStatus: '',
    entryMode: '',
    transactionType: '',
    batchNumber: '',
    invoiceSequence: '',
    transactionDate: '',
    transactionTime: '',
    customerName: '',
    customerPan: '',
    reffId: '',
    terminalAmount: '',
    inquiryFound: true,
    detail: ''
};

/** Layout pipe QRIS payment (type 0x3C) dan QRIS inquiry (0x3D/0x3E) sama. */
export const QRIS_INQUIRY_PIPE_FIELD = {
    TERMINAL_ID: 0,
    MERCHANT_ID: 1,
    CARD_TYPE: 2,
    MERCHANT_PAN: 3,
    ISSUER_NAME: 4,
    TRANSACTION_TYPE: 5,
    TRANSACTION_STATUS: 6,
    REFERENCE_NUMBER: 7,
    DATE: 8,
    TIME: 9,
    CUSTOMER_NAME: 10,
    CUSTOMER_PAN: 11,
    REFF_ID: 12,
    AMOUNT: 13
} as const;

export function formatDanamonAmount(amount: number): string {
    const rounded = Math.round(amount);
    const rupiah6 = rounded.toString().padStart(6, '0');
    return `${DANAMON_AMOUNT_PREFIX}${rupiah6}`;
}

export function validateDanamonAmount(amount: number, paymentType: EdcPaymentType): string | null {
    const rounded = Math.round(amount);
    if (rounded <= 0) {
        return 'Nominal pembayaran EDC harus lebih dari nol.';
    }
    if (paymentType !== 'QRIS' && rounded > DANAMON_AMOUNT_MAX_RUPIAH) {
        return `Nominal EDC melebihi batas Danamon serial (maks Rp ${DANAMON_AMOUNT_MAX_RUPIAH.toLocaleString('id-ID')}).`;
    }
    return null;
}

export function parseHexByteEnv(envValue: string | undefined, fallback: number): number {
    if (!envValue) return fallback;
    const parsed = parseInt(envValue.trim(), 16);
    return Number.isNaN(parsed) || parsed < 0 || parsed > 0xff ? fallback : parsed;
}

export function mapEdcErrorMessage(respCode: string, detail: string): string {
    if (respCode === '10' && detail.startsWith('ER')) {
        return (
            'Terminal Axium DX8000 error (10-ER): app Danamon menerima frame serial tapi menolak transaksi ECR. ' +
            'Jika app Danamon force-close setelah bayar dari POS, hubungi Danamon/ICT — parameter integrasi ECR Serial belum benar di TMS.'
        );
    }
    if (respCode === '10') {
        return 'Terminal EDC menolak transaksi (kode 10). Cek konfigurasi merchant/tipe pembayaran di mesin.';
    }
    return `Pembayaran EDC Ditolak (Response Code: ${respCode}${detail ? ` / ${detail}` : ''})`;
}

export function pickVoidPipeField(fields: string[], index: number): string {
    return fields[index]?.trim() ?? '';
}

export function isQrisDanamonPayload(payload: Buffer): boolean {
    return payload.length >= 5 && payload[0] === 0x01 && payload[1] === 0x3c;
}

export function parseQrisDanamonResponse(payload: Buffer): EdcParsedResponse {
    const statusPrefix = payload.subarray(2, 5).toString('ascii');
    const tailAscii = payload.subarray(5).toString('ascii').replace(/\x03/g, '').trim();

    if (!tailAscii.includes('|')) {
        const isEr = statusPrefix.includes('ER') || tailAscii.includes('ER');
        return {
            respCode: '10',
            ...EMPTY_PARSED_FIELDS,
            detail: isEr ? 'ER' : tailAscii
        };
    }

    const fields = tailAscii.split('|').map(field => field.trim());
    const mapped = mapQrisPipeFields(fields);
    const statusLabel = mapped.transactionStatus.toUpperCase();
    const isSuccess = statusPrefix === '200' && statusLabel === 'SUKSES';

    return {
        respCode: isSuccess ? '00' : '10',
        ...EMPTY_PARSED_FIELDS,
        ...mapped,
        detail: isSuccess ? '' : statusLabel || statusPrefix
    };
}

export function isVoidDanamonPayload(payload: Buffer): boolean {
    const voidVersionByte = parseHexByteEnv(process.env.EDC_VOID_VERSION, 0x01);
    const voidTypeByte = parseHexByteEnv(process.env.EDC_VOID_TYPE, 0x32);
    const voidSubTypeByte = parseHexByteEnv(process.env.EDC_VOID_SUB_TYPE, 0x30);
    return (
        payload.length >= 3 &&
        payload[0] === voidVersionByte &&
        payload[1] === voidTypeByte &&
        payload[2] === voidSubTypeByte
    );
}

export function isQrisInquiryDanamonPayload(payload: Buffer): boolean {
    const inquiryVersionByte = parseHexByteEnv(process.env.EDC_QRIS_INQUIRY_VERSION, 0x01);
    const lastTypeByte = parseHexByteEnv(process.env.EDC_QRIS_LAST_TYPE, 0x3d);
    const lastSubTypeByte = parseHexByteEnv(process.env.EDC_QRIS_LAST_SUB_TYPE, 0x30);
    const anyTypeByte = parseHexByteEnv(process.env.EDC_QRIS_ANY_TYPE, 0x3e);
    const anySubTypeByte = parseHexByteEnv(process.env.EDC_QRIS_ANY_SUB_TYPE, 0x30);
    return (
        payload.length >= 3 &&
        payload[0] === inquiryVersionByte &&
        ((payload[1] === lastTypeByte && payload[2] === lastSubTypeByte) ||
            (payload[1] === anyTypeByte && payload[2] === anySubTypeByte))
    );
}

export function pickInquiryPipeField(fields: string[], index: number): string {
    return fields[index]?.trim() ?? '';
}

export function mapQrisPipeFields(fields: string[]): Omit<EdcParsedResponse, 'respCode' | 'inquiryFound' | 'detail'> {
    const idx = QRIS_INQUIRY_PIPE_FIELD;
    return {
        terminalId: pickInquiryPipeField(fields, idx.TERMINAL_ID),
        merchantId: pickInquiryPipeField(fields, idx.MERCHANT_ID),
        cardType: pickInquiryPipeField(fields, idx.CARD_TYPE),
        merchantPan: pickInquiryPipeField(fields, idx.MERCHANT_PAN),
        issuerName: pickInquiryPipeField(fields, idx.ISSUER_NAME),
        transactionType: pickInquiryPipeField(fields, idx.TRANSACTION_TYPE),
        transactionStatus: pickInquiryPipeField(fields, idx.TRANSACTION_STATUS),
        referenceNumber: pickInquiryPipeField(fields, idx.REFERENCE_NUMBER),
        traceNumber: pickInquiryPipeField(fields, idx.REFERENCE_NUMBER),
        transactionDate: pickInquiryPipeField(fields, idx.DATE),
        transactionTime: pickInquiryPipeField(fields, idx.TIME),
        customerName: pickInquiryPipeField(fields, idx.CUSTOMER_NAME),
        customerPan: pickInquiryPipeField(fields, idx.CUSTOMER_PAN),
        reffId: pickInquiryPipeField(fields, idx.REFF_ID),
        terminalAmount: pickInquiryPipeField(fields, idx.AMOUNT),
        maskedCardNo:
            pickInquiryPipeField(fields, idx.CUSTOMER_PAN) || pickInquiryPipeField(fields, idx.MERCHANT_PAN),
        approvalCode: '',
        rrn: pickInquiryPipeField(fields, idx.REFF_ID),
        entryMode: '',
        batchNumber: '',
        invoiceSequence: ''
    };
}

export function evaluateQrisInquiryResult(fields: string[], tailAscii: string): {
    isSuccess: boolean;
    respCode: string;
    inquiryFound: boolean;
    detail: string;
} {
    const idx = QRIS_INQUIRY_PIPE_FIELD;
    const statusLabel = pickInquiryPipeField(fields, idx.TRANSACTION_STATUS).toUpperCase();
    const joinedUpper = (fields.length > 0 ? fields.join('|') : tailAscii).toUpperCase();

    const notFoundKeywords = ['TIDAK DITEMUKAN', 'NOT FOUND', 'NO RECORD', 'NO TRANSACTION'];
    if (notFoundKeywords.some(keyword => joinedUpper.includes(keyword))) {
        return {
            isSuccess: false,
            respCode: '99',
            inquiryFound: false,
            detail: 'Transaksi QRIS tidak ditemukan di EDC'
        };
    }

    const errorKeywords = ['GAGAL', 'FAILED', 'FAIL', 'REJECT', 'DECLINE', 'ERROR', 'TOLAK', 'DITOLAK'];
    if (errorKeywords.some(keyword => joinedUpper.includes(keyword) || statusLabel.includes(keyword))) {
        return {
            isSuccess: false,
            respCode: '10',
            inquiryFound: true,
            detail: statusLabel || 'Inquiry QRIS gagal'
        };
    }

    const successKeywords = ['SUKSES', 'SUCCESS', 'APPROVED', 'BERHASIL', 'COMPLETE', 'OK'];
    if (successKeywords.some(keyword => joinedUpper.includes(keyword) || statusLabel.includes(keyword))) {
        return { isSuccess: true, respCode: '00', inquiryFound: true, detail: '' };
    }

    const referenceNumber = pickInquiryPipeField(fields, idx.REFERENCE_NUMBER);
    const amount = pickInquiryPipeField(fields, idx.AMOUNT);
    if (referenceNumber && amount) {
        return { isSuccess: true, respCode: '00', inquiryFound: true, detail: '' };
    }

    return {
        isSuccess: false,
        respCode: '10',
        inquiryFound: true,
        detail: statusLabel || tailAscii || 'Status inquiry QRIS tidak dikenali'
    };
}

export function parseQrisInquiryDanamonResponse(payload: Buffer): EdcParsedResponse {
    const remainder = payload.subarray(3);
    const tailAscii = remainder.toString('ascii').replace(/\x03/g, '').trim();

    if (!tailAscii.includes('|')) {
        const result = evaluateQrisInquiryResult([], tailAscii);
        return {
            respCode: result.respCode,
            ...EMPTY_PARSED_FIELDS,
            inquiryFound: result.inquiryFound,
            detail: result.detail
        };
    }

    let offset = 0;
    if (remainder.length >= 2 && remainder.subarray(0, 2).toString('ascii') === '10') {
        offset = 2;
    }

    const pipeAscii = remainder.subarray(offset).toString('ascii').replace(/\x03/g, '').trim();
    const fields = pipeAscii.split('|').map(field => field.trim());
    const result = evaluateQrisInquiryResult(fields, pipeAscii);

    return {
        respCode: result.respCode,
        ...EMPTY_PARSED_FIELDS,
        ...mapQrisPipeFields(fields),
        inquiryFound: result.inquiryFound,
        detail: result.detail
    };
}

export function isSettleDanamonPayload(payload: Buffer): boolean {
    const settleVersionByte = parseHexByteEnv(process.env.EDC_SETTLE_VERSION, 0x01);
    const settleTypeByte = parseHexByteEnv(process.env.EDC_SETTLE_TYPE, 0x33);
    const settleSubTypeByte = parseHexByteEnv(process.env.EDC_SETTLE_SUB_TYPE, 0x30);
    return (
        payload.length >= 3 &&
        payload[0] === settleVersionByte &&
        payload[1] === settleTypeByte &&
        payload[2] === settleSubTypeByte
    );
}

export function evaluateSettleDanamonResult(fields: string[], tailAscii: string): {
    isSuccess: boolean;
    respCode: string;
    detail: string;
} {
    const joinedUpper = (fields.length > 0 ? fields.join('|') : tailAscii).toUpperCase();

    const errorKeywords = [
        'GAGAL',
        'FAILED',
        'FAIL',
        'REJECT',
        'DECLINE',
        'ERROR',
        'TOLAK',
        'DITOLAK',
        'NO BATCH',
        'EMPTY BATCH'
    ];
    if (errorKeywords.some(keyword => joinedUpper.includes(keyword))) {
        return {
            isSuccess: false,
            respCode: '10',
            detail: fields[fields.length - 1]?.trim() || tailAscii || 'Settlement ditolak terminal'
        };
    }

    const successKeywords = [
        'SUKSES',
        'SUCCESS',
        'SETTLE',
        'SETTLEMENT',
        'BERHASIL',
        'BATCH CLOSE',
        'CLOSE BATCH',
        'SETTLE OK'
    ];
    if (successKeywords.some(keyword => joinedUpper.includes(keyword))) {
        return { isSuccess: true, respCode: '00', detail: '' };
    }

    return {
        isSuccess: false,
        respCode: '10',
        detail: tailAscii || 'Settlement belum terkonfirmasi sukses'
    };
}

export function parseSettleDanamonResponse(payload: Buffer): EdcParsedResponse {
    const remainder = payload.subarray(3);
    const tailAscii = remainder.toString('ascii').replace(/\x03/g, '').trim();

    if (!tailAscii.includes('|')) {
        const isShortErError = /^ER\d{0,4}$/i.test(tailAscii);
        const result = evaluateSettleDanamonResult([], tailAscii);
        if (result.isSuccess) {
            return { respCode: '00', ...EMPTY_PARSED_FIELDS, detail: '' };
        }
        return {
            respCode: isShortErError ? '10' : result.respCode,
            ...EMPTY_PARSED_FIELDS,
            detail: isShortErError ? 'ER' : result.detail
        };
    }

    let offset = 0;
    if (remainder.length >= 2 && remainder.subarray(0, 2).toString('ascii') === '10') {
        offset = 2;
    }

    const respCode =
        remainder.length >= offset + 2
            ? remainder.subarray(offset, offset + 2).toString('ascii')
            : '99';
    const pipeAscii = remainder.subarray(offset + 2).toString('ascii').replace(/\x03/g, '').trim();
    const fields = pipeAscii.split('|').map(field => field.trim());
    const result = evaluateSettleDanamonResult(fields, pipeAscii);

    if (respCode === '00') {
        return {
            respCode: '00',
            ...EMPTY_PARSED_FIELDS,
            terminalId: fields[0] ?? '',
            referenceNumber: fields[1] ?? '',
            transactionType: fields[5] ?? 'SETTLEMENT',
            batchNumber: fields[6] ?? '',
            transactionDate: fields[8] ?? '',
            transactionTime: fields[9] ?? '',
            terminalAmount: fields[12] ?? '',
            detail: ''
        };
    }

    return {
        respCode: result.respCode,
        ...EMPTY_PARSED_FIELDS,
        terminalId: fields[0] ?? '',
        referenceNumber: fields[1] ?? '',
        transactionType: fields[5] ?? 'SETTLEMENT',
        batchNumber: fields[6] ?? '',
        transactionDate: fields[8] ?? '',
        transactionTime: fields[9] ?? '',
        terminalAmount: fields[12] ?? '',
        detail: result.detail
    };
}

export function evaluateVoidDanamonResult(fields: string[]): {
    isSuccess: boolean;
    respCode: string;
    detail: string;
} {
    const idx = VOID_PIPE_FIELD;
    const transactionType = pickVoidPipeField(fields, idx.TRANSACTION_TYPE).toUpperCase();
    const approvalCode = pickVoidPipeField(fields, idx.APPROVAL);
    const rrn = pickVoidPipeField(fields, idx.RRN);
    const terminalAmount = pickVoidPipeField(fields, idx.AMOUNT_OR_STATUS);
    const transactionDate = pickVoidPipeField(fields, idx.DATE);
    const transactionTime = pickVoidPipeField(fields, idx.TIME);
    const joinedUpper = fields.join('|').toUpperCase();

    const errorKeywords = [
        'GAGAL',
        'FAILED',
        'FAIL',
        'REJECT',
        'DECLINE',
        'NO RECORD',
        'NOT FOUND',
        'TIDAK DITEMUKAN',
        'ERROR',
        'TOLAK',
        'DITOLAK'
    ];
    if (errorKeywords.some(keyword => joinedUpper.includes(keyword))) {
        return {
            isSuccess: false,
            respCode: '10',
            detail: terminalAmount || transactionType || 'VOID ditolak terminal'
        };
    }

    const successKeywords = ['SUKSES', 'SUCCESS', 'APPROVED', 'BERHASIL', 'COMPLETE', 'OK'];
    if (successKeywords.some(keyword => joinedUpper.includes(keyword))) {
        return { isSuccess: true, respCode: '00', detail: '' };
    }

    const hasApproval = /^\d{4,8}$/.test(approvalCode);
    const hasRrn = rrn.replace(/\D/g, '').length >= 6;
    const hasPositiveAmount = terminalAmount.length > 0 && terminalAmount !== '0' && !/^0+$/.test(terminalAmount);
    const hasDateTime = Boolean(transactionDate && transactionTime);
    const isVoidOperation = transactionType.includes('VOID');

    if (terminalAmount === '0' && !hasApproval && !hasRrn) {
        return {
            isSuccess: false,
            respCode: '10',
            detail: 'VOID gagal — status/amount terminal=0 (trace/nominal tidak cocok atau transaksi tidak ditemukan)'
        };
    }

    if (isVoidOperation && hasDateTime && (hasApproval || hasRrn || hasPositiveAmount)) {
        return { isSuccess: true, respCode: '00', detail: '' };
    }

    if (isVoidOperation) {
        return {
            isSuccess: false,
            respCode: '10',
            detail: 'VOID belum terkonfirmasi sukses — respons terminal tidak memuat approval/RRN/nominal valid'
        };
    }

    return {
        isSuccess: false,
        respCode: '10',
        detail: transactionType || joinedUpper || 'Format respons VOID tidak dikenali'
    };
}

export function parseVoidDanamonResponse(payload: Buffer): EdcParsedResponse {
    const tailAscii = payload.subarray(3).toString('ascii').replace(/\x03/g, '').trim();
    if (!tailAscii.includes('|')) {
        const isShortErError = /^ER\d{0,4}$/i.test(tailAscii);
        return {
            respCode: isShortErError ? '10' : '99',
            ...EMPTY_PARSED_FIELDS,
            detail: isShortErError ? 'ER' : tailAscii
        };
    }

    const fields = tailAscii.split('|').map(field => field.trim());
    const idx = VOID_PIPE_FIELD;
    const result = evaluateVoidDanamonResult(fields);

    return {
        respCode: result.respCode,
        ...EMPTY_PARSED_FIELDS,
        terminalId: pickVoidPipeField(fields, idx.TERMINAL_ID),
        referenceNumber: pickVoidPipeField(fields, idx.REFERENCE),
        traceNumber: pickVoidPipeField(fields, idx.REFERENCE),
        cardType: pickVoidPipeField(fields, idx.CARD_TYPE),
        maskedCardNo: pickVoidPipeField(fields, idx.MASKED_CARD),
        entryMode: pickVoidPipeField(fields, idx.ENTRY_MODE),
        transactionType: pickVoidPipeField(fields, idx.TRANSACTION_TYPE),
        batchNumber: pickVoidPipeField(fields, idx.BATCH),
        invoiceSequence: pickVoidPipeField(fields, idx.INVOICE),
        transactionDate: pickVoidPipeField(fields, idx.DATE),
        transactionTime: pickVoidPipeField(fields, idx.TIME),
        rrn: pickVoidPipeField(fields, idx.RRN),
        approvalCode: pickVoidPipeField(fields, idx.APPROVAL),
        terminalAmount: pickVoidPipeField(fields, idx.AMOUNT_OR_STATUS),
        detail: result.detail
    };
}

export function parseDirectResponse(payload: Buffer): EdcParsedResponse {
    if (payload.length < 3) {
        return { respCode: '99', ...EMPTY_PARSED_FIELDS, detail: payload.toString('ascii') };
    }

    if (isQrisDanamonPayload(payload)) {
        return parseQrisDanamonResponse(payload);
    }

    if (isQrisInquiryDanamonPayload(payload)) {
        return parseQrisInquiryDanamonResponse(payload);
    }

    if (isVoidDanamonPayload(payload)) {
        return parseVoidDanamonResponse(payload);
    }

    if (isSettleDanamonPayload(payload)) {
        return parseSettleDanamonResponse(payload);
    }

    const transCodeLen = payload[0] < 0x20 ? 1 : 2;
    let dataOffset = transCodeLen;

    const hasDanamonHeader =
        payload.length >= dataOffset + 2 && payload.subarray(dataOffset, dataOffset + 2).toString('ascii') === '10';
    if (hasDanamonHeader) {
        dataOffset += 2;
    }

    const respCode =
        payload.length >= dataOffset + 2 ? payload.subarray(dataOffset, dataOffset + 2).toString('ascii') : '99';
    const tail = payload.subarray(dataOffset + 2);
    const tailAscii = tail.toString('ascii').replace(/\x03/g, '').trim();

    if (respCode === 'ER' || (tailAscii.startsWith('ER') && !tailAscii.includes('|'))) {
        return { respCode: '10', ...EMPTY_PARSED_FIELDS, detail: 'ER' };
    }

    if (respCode === '00' && tailAscii.includes('|')) {
        const fields = tailAscii.split('|').map(field => field.trim());
        return {
            respCode: '00',
            ...EMPTY_PARSED_FIELDS,
            terminalId: fields[0] ?? '',
            referenceNumber: fields[1] ?? '',
            cardType: fields[2] ?? '',
            maskedCardNo: fields[3] ?? '',
            entryMode: fields[4] ?? '',
            transactionType: fields[5] ?? '',
            batchNumber: fields[6] ?? '',
            traceNumber: fields[7] ?? '',
            transactionDate: fields[8] ?? '',
            transactionTime: fields[9] ?? '',
            rrn: fields[10] ?? '',
            approvalCode: fields[11] ?? '',
            terminalAmount: fields[12] ?? '',
            invoiceSequence: fields[7] ?? '',
            detail: ''
        };
    }

    if (tail.length >= 28) {
        const traceNumber = tail.subarray(22, 28).toString('ascii').trim();
        return {
            respCode,
            ...EMPTY_PARSED_FIELDS,
            approvalCode: tail.subarray(0, 6).toString('ascii').trim(),
            maskedCardNo: tail.subarray(6, 22).toString('ascii').trim(),
            traceNumber,
            referenceNumber: traceNumber,
            detail: ''
        };
    }

    return { respCode, ...EMPTY_PARSED_FIELDS, detail: tailAscii };
}

export function isShortTerminalError(payload: Buffer): boolean {
    return payload.length <= 7 && payload.toString('ascii').includes('ER');
}

export function isEdcLinkNak(buffer: Buffer): boolean {
    if (buffer.length === 1 && buffer[0] === 0x15) return true;
    return buffer.length >= 3 && buffer[0] === 0x15 && buffer[1] === 0x03;
}

export function formatLinkByteTrace(buffer: Buffer): string {
    return [...buffer]
        .map(byte => {
            const label = LINK_CONTROL_BYTE_NAMES[byte];
            return label
                ? `${label}(0x${byte.toString(16).toUpperCase().padStart(2, '0')})`
                : `0x${byte.toString(16).toUpperCase().padStart(2, '0')}`;
        })
        .join(' ');
}

export function classifyLinkChunk(buffer: Buffer): string {
    if (buffer.length === 0) return 'EMPTY';
    if (isEdcLinkNak(buffer)) return 'NAK';
    if (buffer.length === 1) return LINK_CONTROL_BYTE_NAMES[buffer[0]] ?? 'DATA_1B';
    if (buffer.includes(0x02) && buffer.includes(0x03)) return 'STX_FRAME';
    if (buffer.includes(0x05)) return 'ENQ';
    return 'DATA_MULTI';
}

export function writeLinkAck(port: SerialPort | null | undefined, context: string): void {
    console.log(`[EDC Manager] Kirim ACK (0x06) ke EDC (${context})`);
    port?.write(Buffer.from([0x06]));
}

export function buildStxLrcFrame(bodyBuf: Buffer): Buffer {
    let lrcByte = 0;
    for (let i = 0; i < bodyBuf.length; i++) {
        lrcByte ^= bodyBuf[i];
    }
    return Buffer.concat([Buffer.from([0x02]), bodyBuf, Buffer.from([lrcByte])]);
}

/**
 * Normalisasi path port serial sesuai konvensi OS.
 * - macOS: /dev/tty.* dikonversi ke /dev/cu.* (calling unit) agar tidak memblokir carrier detect.
 * - Windows: COM port dinormalisasi ke huruf besar (mis. com3 -> COM3, COM10+ -> \\.\COM10).
 */
export function normalizeSerialPortPath(portPath: string): string {
    const trimmed = (portPath || '').trim();
    if (!trimmed) return '';

    if (process.platform === 'darwin') {
        if (trimmed.startsWith('/dev/tty.')) {
            return trimmed.replace('/dev/tty.', '/dev/cu.');
        }
        return trimmed;
    }

    if (process.platform === 'win32') {
        const m = trimmed.match(/^(\\\\\.\\)?(COM\d+)$/i);
        if (m) {
            const num = parseInt(m[2].substring(3), 10);
            if (num >= 10) {
                return `\\\\.\\COM${num}`;
            }
            return `COM${num}`;
        }
        return trimmed.toUpperCase();
    }

    return trimmed;
}

/**
 * Membandingkan dua path port serial dengan memperhatikan aturan normalisasi platform.
 */
export function arePortPathsEquivalent(pathA?: string | null, pathB?: string | null): boolean {
    if (!pathA || !pathB) return false;
    const normA = normalizeSerialPortPath(pathA);
    const normB = normalizeSerialPortPath(pathB);
    if (process.platform === 'win32') {
        return normA.toLowerCase() === normB.toLowerCase();
    }
    return normA === normB;
}

export function getDefaultBaudRate(): number {
    if (process.env.EDC_BAUD_RATE) {
        const parsed = parseInt(process.env.EDC_BAUD_RATE, 10);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return 115200;
}

export function getDefaultEdcTimeoutMs(): number {
    if (process.env.EDC_TRANSACTION_TIMEOUT_MS) {
        const parsed = parseInt(process.env.EDC_TRANSACTION_TIMEOUT_MS, 10);
        if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
    return 180000;
}

export function getPreSendDelayMs(): number {
    const parsed = parseInt(process.env.EDC_PRE_SEND_DELAY_MS || '1500', 10);
    return Number.isNaN(parsed) ? 1500 : parsed;
}

export function paymentResponseFromParsed(
    parsed: EdcParsedResponse,
    isSuccess: boolean,
    rawHex: string,
    successMessage: string
): import('./edc-types').EDCProcessPaymentResponse {
    return {
        success: isSuccess,
        responseCode: parsed.respCode,
        referenceNumber: parsed.referenceNumber || undefined,
        approvalCode: parsed.approvalCode || undefined,
        maskedCardNo: parsed.maskedCardNo || undefined,
        traceNumber: parsed.traceNumber || undefined,
        rrn: parsed.rrn || undefined,
        terminalId: parsed.terminalId || undefined,
        merchantId: parsed.merchantId || undefined,
        cardType: parsed.cardType || undefined,
        merchantPan: parsed.merchantPan || undefined,
        issuerName: parsed.issuerName || undefined,
        transactionStatus: parsed.transactionStatus || undefined,
        entryMode: parsed.entryMode || undefined,
        transactionType: parsed.transactionType || undefined,
        batchNumber: parsed.batchNumber || undefined,
        invoiceSequence: parsed.invoiceSequence || undefined,
        transactionDate: parsed.transactionDate || undefined,
        transactionTime: parsed.transactionTime || undefined,
        customerName: parsed.customerName || undefined,
        customerPan: parsed.customerPan || undefined,
        reffId: parsed.reffId || undefined,
        terminalAmount: parsed.terminalAmount || undefined,
        inquiryFound: parsed.inquiryFound,
        message: isSuccess ? successMessage : mapEdcErrorMessage(parsed.respCode, parsed.detail),
        rawHexResponse: rawHex
    };
}

export function extractTerminalIdFromPayload(data: Buffer): string | undefined {
    const ascii = data.toString('ascii').replace(/\x03/g, '').trim();
    if (ascii.includes('|')) {
        return ascii.split('|')[0]?.trim() || undefined;
    }
    return undefined;
}

export function logRxChunk(chunk: Buffer): void {
    console.log('\n[EDC Manager] Data diterima dari EDC');
    console.log(`              Hex   : ${chunk.toString('hex').toUpperCase()}`);
    console.log(
        `              ASCII : ${chunk.toString('ascii').replace(/[\x00-\x1F\x7F]/g, m => `<${m.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}>`)}`
    );
}

export function isBufferNak(bufferAccumulator: Buffer): boolean {
    return (
        (bufferAccumulator.length === 1 && bufferAccumulator[0] === 0x15) ||
        (bufferAccumulator.length >= 3 && bufferAccumulator[0] === 0x15 && bufferAccumulator[1] === 0x03)
    );
}
