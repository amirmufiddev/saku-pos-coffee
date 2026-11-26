import * as net from 'net';
import { SerialPort } from 'serialport';
import type {
    EdcQrisAnyInquiryParams,
    EdcQrisInquiryParams,
    EdcSerialHost,
    EDCProcessPaymentResponse
} from './edc-types';
import {
    buildStxLrcFrame,
    getDefaultBaudRate,
    getPreSendDelayMs,
    isBufferNak,
    isShortTerminalError,
    logRxChunk,
    mapEdcErrorMessage,
    normalizeSerialPortPath,
    parseDirectResponse,
    parseHexByteEnv,
    paymentResponseFromParsed,
    writeLinkAck
} from './edc-protocol';

const ETX = 0x03;
const MAX_REFERENCE_LENGTH = 32;

function getInquiryVersionByte(): number {
    return parseHexByteEnv(process.env.EDC_QRIS_INQUIRY_VERSION, 0x01);
}

function getLastInquiryTypeByte(): number {
    return parseHexByteEnv(process.env.EDC_QRIS_LAST_TYPE, 0x3d);
}

function getLastInquirySubTypeByte(): number {
    return parseHexByteEnv(process.env.EDC_QRIS_LAST_SUB_TYPE, 0x30);
}

function getAnyInquiryTypeByte(): number {
    return parseHexByteEnv(process.env.EDC_QRIS_ANY_TYPE, 0x3e);
}

function getAnyInquirySubTypeByte(): number {
    return parseHexByteEnv(process.env.EDC_QRIS_ANY_SUB_TYPE, 0x30);
}

function normalizeInquiryReference(referenceNumber: string): string {
    const trimmed = referenceNumber.trim();
    if (!trimmed) {
        throw new Error('Reference number wajib untuk QRIS Any Transaction inquiry.');
    }
    if (trimmed.length > MAX_REFERENCE_LENGTH) {
        throw new Error(`Reference number melebihi batas ${MAX_REFERENCE_LENGTH} karakter.`);
    }
    return trimmed;
}

/**
 * Danamon ECR QRIS Last Transaction inquiry — tanpa Data 1.
 * Frame: [STX] [Version] [Type] [SubType] [ETX] [LRC]
 */
export function buildQrisLastTransactionFrame(): Buffer {
    const versionByte = getInquiryVersionByte();
    const typeByte = getLastInquiryTypeByte();
    const subTypeByte = getLastInquirySubTypeByte();
    const headerBuf = Buffer.from([versionByte, typeByte, subTypeByte]);

    console.log('===========================================================');
    console.log('              QRIS LAST TRANSACTION INQUIRY                 ');
    console.log('===========================================================');
    console.log(`    STX            : 0x02`);
    console.log(`    Version        : 0x${versionByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    Type           : 0x${typeByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    SubType        : 0x${subTypeByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    ETX            : 0x${ETX.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log('    Data 1         : (none)');
    console.log('-----------------------------------------------------------');

    const bodyBuf = Buffer.concat([headerBuf, Buffer.from([ETX])]);
    const finalFrame = buildStxLrcFrame(bodyBuf);

    console.log(
        `  LRC/CRC          : 0x${finalFrame[finalFrame.length - 1].toString(16).toUpperCase().padStart(2, '0')}`
    );
    console.log(`  Complete Frame   : ${finalFrame.toString('hex').toUpperCase()}`);
    console.log('===========================================================\n');

    return finalFrame;
}

/**
 * Danamon ECR QRIS Any Transaction inquiry — Data 1 berisi reference number.
 * Frame: [STX] [Version] [Type] [SubType] [Reff ASCII] [ETX] [LRC]
 */
export function buildQrisAnyTransactionFrame(referenceNumber: string): Buffer {
    const refField = normalizeInquiryReference(referenceNumber);
    const versionByte = getInquiryVersionByte();
    const typeByte = getAnyInquiryTypeByte();
    const subTypeByte = getAnyInquirySubTypeByte();
    const headerBuf = Buffer.from([versionByte, typeByte, subTypeByte]);

    console.log('===========================================================');
    console.log('               QRIS ANY TRANSACTION INQUIRY                 ');
    console.log('===========================================================');
    console.log(`    STX            : 0x02`);
    console.log(`    Version        : 0x${versionByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    Type           : 0x${typeByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    SubType        : 0x${subTypeByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    Data 1 (Reff)   : ${refField}`);
    console.log(`    ETX            : 0x${ETX.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log('-----------------------------------------------------------');

    const bodyBuf = Buffer.concat([
        headerBuf,
        Buffer.from(refField, 'ascii'),
        Buffer.from([ETX])
    ]);
    const finalFrame = buildStxLrcFrame(bodyBuf);

    console.log(
        `  LRC/CRC          : 0x${finalFrame[finalFrame.length - 1].toString(16).toUpperCase().padStart(2, '0')}`
    );
    console.log(`  Complete Frame   : ${finalFrame.toString('hex').toUpperCase()}`);
    console.log('===========================================================\n');

    return finalFrame;
}

function resolveInquiryFrame(params: EdcQrisInquiryParams | EdcQrisAnyInquiryParams): Buffer {
    if (params.inquiryKind === 'ANY') {
        return buildQrisAnyTransactionFrame(params.referenceNumber);
    }
    return buildQrisLastTransactionFrame();
}

function runInquiryTcp(
    params: EdcQrisInquiryParams | EdcQrisAnyInquiryParams,
    frame: Buffer,
    successMessage: string
): Promise<EDCProcessPaymentResponse> {
    const ip = params.ipTerminal?.trim();
    const port = params.port;
    const { timeoutMs = 30000 } = params;

    if (!ip || !port) {
        return Promise.resolve({
            success: false,
            message: 'IP Terminal dan Port wajib untuk inquiry EDC TCP/IP.'
        });
    }

    return new Promise(resolve => {
        let settled = false;
        let bufferAccumulator = Buffer.alloc(0);
        const client = net.createConnection({ host: ip, port });

        const finish = (result: EDCProcessPaymentResponse) => {
            if (settled) return;
            settled = true;
            try {
                client.destroy();
            } catch (_) {}
            resolve(result);
        };

        const timer = setTimeout(() => {
            finish({
                success: false,
                message: `Waktu inquiry QRIS di EDC habis (Timeout ${timeoutMs / 1000}s).`
            });
        }, timeoutMs);

        client.setTimeout(timeoutMs);

        client.on('connect', () => {
            setTimeout(() => client.write(frame), 300);
        });

        client.on('data', (chunk: Buffer) => {
            bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
            const stxIdx = bufferAccumulator.indexOf(0x02);
            const etxIdx = bufferAccumulator.lastIndexOf(0x03);
            if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) return;
            if (bufferAccumulator.length < etxIdx + 2) return;

            clearTimeout(timer);
            const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);
            const parsed = parseDirectResponse(payload);
            finish(
                paymentResponseFromParsed(
                    parsed,
                    parsed.respCode === '00',
                    bufferAccumulator.toString('hex'),
                    successMessage
                )
            );
        });

        client.on('timeout', () => {
            clearTimeout(timer);
            finish({ success: false, message: `Timeout: Unable to connect to ${ip}:${port}` });
        });

        client.on('error', (err: Error) => {
            clearTimeout(timer);
            finish({ success: false, message: `Koneksi TCP EDC error: ${err.message}` });
        });
    });
}

function runInquirySerial(
    host: EdcSerialHost,
    params: (EdcQrisInquiryParams | EdcQrisAnyInquiryParams) & { portPath: string },
    frame: Buffer,
    successMessage: string
): Promise<EDCProcessPaymentResponse> {
    let { portPath, baudRate = getDefaultBaudRate(), timeoutMs = 30000 } = params;
    portPath = normalizeSerialPortPath(portPath);

    return new Promise(resolve => {
        let isSettled = false;
        let bufferAccumulator = Buffer.alloc(0);
        let inquiryFrameSent = false;
        let awaitingInquiryResult = false;


        console.log('\n+-----------------------------------------------------------+');
        console.log(`|       MEMULAI QRIS INQUIRY (${params.inquiryKind})                    |`);
        console.log('+-----------------------------------------------------------+');
        console.log(`[EDC Inquiry] Serial Port   : ${portPath}`);
        console.log(`[EDC Inquiry] Baud Rate     : ${baudRate}`);
        console.log(`[EDC Inquiry] Timeout       : ${timeoutMs / 1000}s\n`);

        let activePort: SerialPort;
        try {
            const portOptions = {
                path: portPath,
                baudRate,
                dataBits: 8,
                parity: 'none' as const,
                stopBits: 1 as const,
                autoOpen: false
            };
            activePort = host.createPort ? host.createPort(portOptions) : new SerialPort(portOptions);
            host.setActivePort(activePort);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Gagal inisialisasi port';
            return resolve({
                success: false,
                message: `Gagal menginisialisasi Serial Port (${portPath}): ${message}`
            });
        }

        const timer = setTimeout(() => {
            if (!isSettled) {
                isSettled = true;
                host.cleanup(activePort);
                resolve({
                    success: false,
                    message: `Waktu inquiry QRIS di EDC habis (Timeout ${timeoutMs / 1000}s).`
                });
            }
        }, timeoutMs);

        const finish = (result: EDCProcessPaymentResponse) => {
            if (!isSettled) {
                isSettled = true;
                clearTimeout(timer);
                host.cleanup(activePort);
                resolve(result);
            }
        };

        const sendFrame = () => {
            if (inquiryFrameSent || !host.getActivePort()?.isOpen) return;
            inquiryFrameSent = true;
            console.log('[EDC Inquiry] Mengirim frame inquiry ke EDC terminal...');
            host.getActivePort()!.write(frame);
        };

        activePort.open(openErr => {
            if (openErr) {
                return finish({
                    success: false,
                    message: `Tidak dapat membuka Serial Port EDC (${portPath}): ${openErr.message}`
                });
            }

            try {
                activePort.set({ dtr: true, rts: true });
            } catch (_) {}

            activePort.on('data', (chunk: Buffer) => {
                bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
                logRxChunk(chunk);

                if (chunk.includes(0x05)) {
                    console.log('[EDC Inquiry] Menerima ENQ — balas ACK');
                    host.getActivePort()?.write(Buffer.from([0x06]));
                    if (!inquiryFrameSent) setTimeout(() => sendFrame(), 100);
                }

                if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 0x04) {
                    bufferAccumulator = Buffer.alloc(0);
                    return;
                }

                if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 0x06) {
                    if (inquiryFrameSent) {
                        awaitingInquiryResult = true;
                    } else {
                        sendFrame();
                    }
                    bufferAccumulator = Buffer.alloc(0);
                    return;
                }

                if (isBufferNak(bufferAccumulator)) {
                    if (awaitingInquiryResult) {
                        bufferAccumulator = Buffer.alloc(0);
                        return finish({
                            success: false,
                            responseCode: '10',
                            message: mapEdcErrorMessage('10', 'ER')
                        });
                    }
                    return finish({
                        success: false,
                        message: 'EDC menolak paket data (NAK - Format/LRC Salah)',
                        rawHexResponse: bufferAccumulator.toString('hex')
                    });
                }

                if (bufferAccumulator[0] === 0x06 && bufferAccumulator.length > 1) {
                    if (inquiryFrameSent) awaitingInquiryResult = true;
                    bufferAccumulator = bufferAccumulator.subarray(1);
                }

                const stxIdx = bufferAccumulator.indexOf(0x02);
                const etxIdx = bufferAccumulator.lastIndexOf(0x03);
                if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) return;
                if (bufferAccumulator.length < etxIdx + 2) return;
                if (inquiryFrameSent && !awaitingInquiryResult) return;

                const fullFrame = bufferAccumulator.subarray(stxIdx, etxIdx + 2);
                const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);
                const parsed = parseDirectResponse(payload);

                if (isShortTerminalError(payload) && parsed.respCode === '10' && parsed.detail.startsWith('ER')) {
                    return finish({
                        success: false,
                        responseCode: '10',
                        message: mapEdcErrorMessage(parsed.respCode, parsed.detail),
                        rawHexResponse: fullFrame.toString('hex')
                    });
                }

                writeLinkAck(host.getActivePort(), `qris inquiry resp ${parsed.respCode}`);
                const isSuccess = parsed.respCode === '00';
                return finish(
                    paymentResponseFromParsed(parsed, isSuccess, fullFrame.toString('hex'), successMessage)
                );
            });

            activePort.on('error', err => {
                finish({ success: false, message: `Koneksi Serial EDC Error: ${err.message}` });
            });

            activePort.on('close', () => {
                if (!isSettled) {
                    finish({
                        success: false,
                        message: 'Port serial EDC terputus saat inquiry QRIS.'
                    });
                }
            });

            setTimeout(() => sendFrame(), getPreSendDelayMs());
        });
    });
}

function runQrisInquiry(
    host: EdcSerialHost,
    params: EdcQrisInquiryParams | EdcQrisAnyInquiryParams,
    successMessage: string
): Promise<EDCProcessPaymentResponse> {
    let frame: Buffer;
    try {
        frame = resolveInquiryFrame(params);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Parameter inquiry tidak valid.';
        return Promise.resolve({ success: false, message });
    }

    if (params.connectionType === 'TCP_IP') {
        return runInquiryTcp(params, frame, successMessage);
    }

    const portPath = params.portPath?.trim();
    if (!portPath) {
        return Promise.resolve({
            success: false,
            message: 'Port serial EDC belum dikonfigurasi. Buka Pengaturan → EDC Configuration.'
        });
    }

    return runInquirySerial(host, { ...params, portPath }, frame, successMessage);
}

export function inquiryQrisLastTransaction(
    host: EdcSerialHost,
    params: EdcQrisInquiryParams
): Promise<EDCProcessPaymentResponse> {
    return runQrisInquiry(host, params, 'Inquiry QRIS Last Transaction berhasil');
}

export function inquiryQrisAnyTransaction(
    host: EdcSerialHost,
    params: EdcQrisAnyInquiryParams
): Promise<EDCProcessPaymentResponse> {
    return runQrisInquiry(host, params, 'Inquiry QRIS Any Transaction berhasil');
}
