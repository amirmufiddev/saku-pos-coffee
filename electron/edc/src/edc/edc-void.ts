import * as fs from 'fs';
import * as path from 'path';
import { SerialPort } from 'serialport';
import type { EdcSerialHost, EDCProcessPaymentResponse, EDCVoidTransactionParams, EdcPaymentType } from './edc-types';
import {
    classifyLinkChunk,
    formatLinkByteTrace,
    getDefaultBaudRate,
    getDefaultEdcTimeoutMs,
    isEdcLinkNak,
    isShortTerminalError,
    mapEdcErrorMessage,
    parseDirectResponse,
    parseHexByteEnv
} from './edc-protocol';

/** Trace void Danamon: 6 digit nomor unik dari struk (invoice/sequence), bukan STAN 11 digit. */
export function normalizeVoidTraceNumber(traceNumber: string): string {
    const voidDigits = (() => {
        const parsed = parseInt(process.env.EDC_VOID_TRACE_DIGITS || '6', 10);
        return Number.isNaN(parsed) ? 6 : parsed;
    })();

    let digits = (traceNumber || '').replace(/\D/g, '');
    if (!digits) {
        return '0'.repeat(voidDigits);
    }

    if (digits.length > voidDigits) {
        console.warn(
            `[EDC Void] Trace "${digits}" lebih dari ${voidDigits} digit — gunakan nomor 6 digit dari struk EDC Danamon (invoice/sequence), bukan Reference/STAN.`
        );
        digits = digits.slice(-voidDigits);
    }

    return digits.padStart(voidDigits, '0');
}

/**
 * Frame VOID Danamon ECR: [STX] [01] [32] [30] [6 digit Trace ASCII] [03] [LRC]
 * Contoh trace 000007 → 02 01 32 30 30 30 30 30 37 03 07
 * Amount tidak dikirim pada request VOID — hanya trace 6 digit.
 */
export function buildIngenicoVoidFrame(paymentType: EdcPaymentType, traceNumber: string): Buffer {
    const STX = 0x02;
    const ETX = 0x03;

    const traceStr = normalizeVoidTraceNumber(traceNumber);

    const voidVersionByte = parseHexByteEnv(process.env.EDC_VOID_VERSION, 0x01);
    const voidTypeByte = parseHexByteEnv(process.env.EDC_VOID_TYPE, 0x32);
    const voidSubTypeByte = parseHexByteEnv(process.env.EDC_VOID_SUB_TYPE, 0x30);
    const headerBuf = Buffer.from([voidVersionByte, voidTypeByte, voidSubTypeByte]);

    console.log('===========================================================');
    console.log(`              ${paymentType} VOID TRANSACTION FRAME        `);
    console.log('===========================================================');
    console.log(`  PaymentType      : ${paymentType}`);
    console.log(`  Trace Number     : ${traceStr} (${traceStr.length} digit ASCII — nomor struk EDC Danamon)`);
    console.log('-----------------------------------------------------------');
    console.log('  Frame Structure (ECR VOID — tanpa Amount):');
    console.log(`    STX            : 0x${STX.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    Version        : 0x${voidVersionByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    Type           : 0x${voidTypeByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    Sub Type       : 0x${voidSubTypeByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    Trace Number   : ${traceStr}`);
    console.log(`    ETX            : 0x${ETX.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log('-----------------------------------------------------------');

    const bodyBuf = Buffer.concat([headerBuf, Buffer.from(traceStr, 'ascii'), Buffer.from([ETX])]);

    let lrcByte = 0;
    for (let i = 0; i < bodyBuf.length; i++) {
        lrcByte ^= bodyBuf[i];
    }

    const finalFrame = Buffer.concat([Buffer.from([STX]), bodyBuf, Buffer.from([lrcByte])]);

    console.log(`  LRC/CRC          : 0x${lrcByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log('-----------------------------------------------------------');
    console.log(`  Complete Frame   : ${finalFrame.toString('hex').toUpperCase()}`);
    console.log('===========================================================\n');

    return finalFrame;
}

function resolveVoidSerialLogDir(): string {
    const base =
        process.env.SAKUPOS_VOID_LOG_DIR?.trim() ||
        (process.platform === 'win32' && process.env.APPDATA
            ? path.join(process.env.APPDATA, 'sakupos-coffee', 'logs', 'edc-void')
            : path.join(process.cwd(), 'logs', 'edc-void'));
    fs.mkdirSync(base, { recursive: true });
    return base;
}

function createVoidSerialSessionLogger(sessionId: string, meta: Record<string, string>) {
    const filePath = path.join(resolveVoidSerialLogDir(), `void-serial-${sessionId}.log`);
    const append = (line: string) => {
        try {
            fs.appendFileSync(filePath, `${line}\n`, 'utf8');
        } catch {
            // logging must not break void flow
        }
    };
    append('=== EDC VOID Serial Session ===');
    append(`started=${new Date().toISOString()}`);
    for (const [key, value] of Object.entries(meta)) {
        append(`${key}=${value}`);
    }
    append('--- raw exchange (post-ACK focus for TMS comparison) ---');
    append('Investigation: jika setelah ACK tidak ada RX sampai tombol VOID manual → TMS ECR Direct Void belum aktif.');
    append('Auto-execute sukses: biasanya RX STX result tanpa byte POS tambahan (bukan EOT — EOT dari POS → NAK).');
    console.log(`[EDC VOID Serial Log] ${filePath}`);
    return { filePath, append };
}

function logVoidLinkExchange(
    direction: 'RX' | 'TX',
    data: Buffer,
    context: string,
    exchangeSeq: { value: number },
    voidPhase: string,
    options?: {
        msFromAck?: number | null;
        sessionLog?: (line: string) => void;
        note?: string;
    }
): void {
    exchangeSeq.value += 1;
    const classification = classifyLinkChunk(data);
    const ackDelta = options?.msFromAck != null ? ` +${options.msFromAck}ms-from-ack` : '';
    const header =
        `[EDC VOID Trace #${exchangeSeq.value}] ${new Date().toISOString()} ${direction}` +
        ` phase=${voidPhase} class=${classification} ctx=${context}${ackDelta}`;
    console.log(header);
    console.log(`  hex   : ${data.toString('hex').toUpperCase()}`);
    console.log(`  bytes : ${formatLinkByteTrace(data)}`);
    console.log(`  len   : ${data.length}`);
    if (options?.note) {
        console.log(`  note  : ${options.note}`);
    }
    if (data.includes(0x02) && data.includes(0x03)) {
        const stxIdx = data.indexOf(0x02);
        const etxIdx = data.lastIndexOf(0x03);
        if (etxIdx > stxIdx) {
            const asciiPayload = data.subarray(stxIdx + 1, etxIdx).toString('ascii');
            console.log(`  ascii : ${asciiPayload.substring(0, 120)}${asciiPayload.length > 120 ? '…' : ''}`);
        }
    }
    options?.sessionLog?.(
        `${header}\n  hex=${data.toString('hex').toUpperCase()}\n  bytes=${formatLinkByteTrace(data)}` +
            (options.note ? `\n  note=${options.note}` : '')
    );
}

function isVoidEnqFirstEnabled(): boolean {
    // Default selaras SALE/debit: kirim frame langsung (terminal Danamon idle tidak ENQ).
    return (process.env.EDC_VOID_ENQ_FIRST || 'false').toLowerCase() === 'true';
}

function getVoidEnqFallbackMs(): number {
    const parsed = parseInt(process.env.EDC_VOID_ENQ_FALLBACK_MS || '3000', 10);
    return Number.isNaN(parsed) ? 3000 : parsed;
}

/**
 * Memproses Void Transaksi ke Mesin EDC Ingenico Danamon
 */
export function voidEdcTransaction(
    host: EdcSerialHost,
    params: EDCVoidTransactionParams
): Promise<EDCProcessPaymentResponse> {
    let {
        portPath,
        amount,
        paymentType,
        traceNumber,
        baudRate = getDefaultBaudRate(),
        timeoutMs = getDefaultEdcTimeoutMs()
    } = params;

    if (!traceNumber?.trim()) {
        return Promise.resolve({
            success: false,
            message: 'Trace Number EDC (6 digit struk) wajib untuk void.'
        });
    }

    if (process.platform === 'darwin' && portPath.startsWith('/dev/tty.')) {
        portPath = portPath.replace('/dev/tty.', '/dev/cu.');
    }

    return new Promise(resolve => {
        let isSettled = false;
        let bufferAccumulator = Buffer.alloc(0);
        let voidFrameSent = false;
        let voidFrameAcked = false;
        let awaitingVoidResult = false;
        let voidPhase = 'INIT';
        let lastRxAt = Date.now();
        let voidAckAtMs: number | null = null;
        let postAckRxCount = 0;
        let postAckTxCount = 0;
        let postAckIdleTimer: NodeJS.Timeout | null = null;
        const exchangeSeq = { value: 0 };
        const voidEnqFirst = isVoidEnqFirstEnabled();
        const sessionId = `${Date.now()}-${traceNumber}`;
        const sessionLog = createVoidSerialSessionLogger(sessionId, {
            trace: traceNumber,
            paymentType,
            portPath,
            baudRate: String(baudRate),
            requestFrame: '01 32 30 + trace (unchanged)'
        });

        const appendSessionSummary = (outcome: string, detail?: string) => {
            sessionLog.append('--- session summary ---');
            sessionLog.append(`outcome=${outcome}`);
            if (voidAckAtMs != null) {
                sessionLog.append(`ackAt=${new Date(voidAckAtMs).toISOString()}`);
            }
            sessionLog.append(`postAckRxCount=${postAckRxCount}`);
            sessionLog.append(`postAckTxCount=${postAckTxCount}`);
            if (detail) {
                sessionLog.append(`detail=${detail}`);
            }
            if (postAckRxCount === 0 && voidAckAtMs != null) {
                sessionLog.append(
                    'finding=NO_SERIAL_AFTER_ACK → terminal UI-only VOID menu; minta Danamon ICT enable ECR Direct/Auto Execute Void'
                );
            } else if (postAckRxCount > 0 && voidAckAtMs != null) {
                sessionLog.append(
                    'finding=SERIAL_AFTER_ACK → compare delta-ms-from-ack dengan flow tombol VOID manual di terminal'
                );
            }
        };

        const clearPostAckIdleTimer = () => {
            if (postAckIdleTimer) {
                clearInterval(postAckIdleTimer);
                postAckIdleTimer = null;
            }
        };

        const writeVoidLink = (data: Buffer, context: string, note?: string) => {
            if (voidFrameAcked) {
                postAckTxCount += 1;
            }
            logVoidLinkExchange('TX', data, context, exchangeSeq, voidPhase, {
                msFromAck: voidAckAtMs != null ? Date.now() - voidAckAtMs : null,
                sessionLog: voidFrameAcked ? sessionLog.append : undefined,
                note
            });
            host.getActivePort()?.write(data);
        };

        const logVoidRx = (chunk: Buffer, context: string, note?: string) => {
            if (voidFrameAcked) {
                postAckRxCount += 1;
            }
            logVoidLinkExchange('RX', chunk, context, exchangeSeq, voidPhase, {
                msFromAck: voidAckAtMs != null ? Date.now() - voidAckAtMs : null,
                sessionLog: voidFrameAcked ? sessionLog.append : sessionLog.append,
                note
            });
        };

        const startPostAckIdleMonitor = () => {
            clearPostAckIdleTimer();
            postAckIdleTimer = setInterval(() => {
                if (isSettled || !voidFrameAcked) {
                    return;
                }
                const silentSec = Math.round((Date.now() - lastRxAt) / 1000);
                console.log(`[EDC VOID Post-ACK] idle ${silentSec}s — belum ada byte dari EDC setelah ACK void frame.`);
                console.log('  Jika terminal menampilkan layar VOID + password tapi menunggu tombol VOID manual,');
                console.log(
                    '  kemungkinan TMS belum mode ECR Direct Void — hubungi Danamon ICT untuk enable ECR auto-execute.'
                );
                console.log('  POS hanya merespons ENQ→ACK; tidak mengirim EOT (0x04) karena terminal membalas NAK.');
            }, 15000);
        };

        const markVoidFrameAcked = () => {
            if (voidFrameAcked) return;
            voidFrameAcked = true;
            awaitingVoidResult = true;
            voidAckAtMs = Date.now();
            voidPhase = 'POST_ACK_WAIT';
            sessionLog.append(`--- POST_ACK_WAIT @ ${new Date(voidAckAtMs).toISOString()} ---`);
            sessionLog.append('POS action after ACK: NONE (no EOT — terminal NAK on EOT from POS)');
            sessionLog.append('Expected EDC: auto execute VOID → STX result (or ENQ prompt if any)');
            console.log(
                '[EDC Manager] EDC ACK void frame — fase POST_ACK_WAIT: terminal seharusnya eksekusi VOID langsung'
            );
            console.log(
                '[EDC Manager] POS menunggu byte berikutnya dari EDC (ENQ / prompt / STX result). Tidak kirim EOT.'
            );
            console.log(`[EDC VOID Serial Log] bandingkan semua RX/TX post-ACK di: ${sessionLog.filePath}`);
            startPostAckIdleMonitor();
        };


        console.log('\n+-----------------------------------------------------------+');
        console.log(`|          MEMULAI VOID TRANSAKSI EDC - ${paymentType.padEnd(6, ' ')}         |`);
        console.log('+-----------------------------------------------------------+');
        console.log(`[EDC Manager] Payment Type  : ${paymentType}`);
        console.log(`[EDC Manager] Trace Number  : ${traceNumber} (6 digit — payload VOID)`);
        if (amount > 0) {
            console.log(
                `[EDC Manager] Sale Amount   : Rp ${amount.toLocaleString('id-ID')} (referensi UI saja, tidak dikirim ke EDC)`
            );
        }
        console.log(`[EDC Manager] Serial Port   : ${portPath}`);
        console.log(`[EDC Manager] Baud Rate     : ${baudRate}`);
        console.log(`[EDC Manager] Timeout       : ${timeoutMs / 1000}s\n`);

        try {
            const portOptions = {
                path: portPath,
                baudRate: baudRate,
                dataBits: 8,
                parity: 'none' as const,
                stopBits: 1 as const,
                autoOpen: false
            };
            const createdPort = host.createPort ? host.createPort(portOptions) : new SerialPort(portOptions);
            host.setActivePort(createdPort);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return resolve({
                success: false,
                message: `Gagal menginisialisasi Serial Port (${portPath}): ${message}`
            });
        }

        const activePort = host.getActivePort();
        if (!activePort) {
            return resolve({
                success: false,
                message: `Gagal menginisialisasi Serial Port (${portPath}): port tidak tersedia`
            });
        }

        const timer = setTimeout(() => {
            if (!isSettled) {
                isSettled = true;
                appendSessionSummary('TIMEOUT', `No EDC result within ${timeoutMs / 1000}s after ACK`);
                console.log('+===========================================================+');
                console.log('|                    VOID TIMEOUT                           |');
                console.log('+===========================================================+');
                console.log(`|  Payment Type      : ${paymentType.padEnd(37, ' ')}|`);
                console.log(
                    `|  Timeout Duration  : ${(timeoutMs / 1000).toString()}s${' '.repeat(34 - (timeoutMs / 1000).toString().length)}|`
                );
                console.log(`|  Amount (Rp)       : ${amount.toLocaleString('id-ID').padEnd(37, ' ')}|`);
                console.log('+===========================================================+\n');
                host.cleanup(activePort);
                resolve({
                    success: false,
                    message: `Waktu void transaksi di EDC habis (Timeout ${timeoutMs / 1000}s). Void dibatalkan.`
                });
            }
        }, timeoutMs);

        const finish = (result: EDCProcessPaymentResponse) => {
            if (!isSettled) {
                isSettled = true;
                clearTimeout(timer);
                clearPostAckIdleTimer();
                appendSessionSummary(result.success ? 'SUCCESS' : 'FAILED', result.message);
                host.cleanup(activePort);
                resolve(result);
            }
        };

        const sendVoidFrame = () => {
            const port = host.getActivePort();
            if (voidFrameSent || !port?.isOpen) return;
            voidFrameSent = true;
            voidPhase = 'FRAME_SENT';

            const frame = buildIngenicoVoidFrame(paymentType, traceNumber);
            console.log(`[EDC Manager] Mengirim frame VOID ke EDC terminal...`);
            writeVoidLink(frame, 'void-frame', 'LRC=0x04 (bukan EOT — kebetulan nilai sama dengan 0x04)');
        };

        activePort.open(openErr => {
            if (openErr) {
                console.log('+===========================================================+');
                console.log('|             GAGAL MEMBUKA SERIAL PORT                     |');
                console.log('+===========================================================+');
                console.log(`|  Payment Type      : ${paymentType.padEnd(37, ' ')}|`);
                console.log(`|  Port Path         : ${portPath.substring(0, 37).padEnd(37, ' ')}|`);
                console.log(`|  Error Message     : ${openErr.message.substring(0, 37).padEnd(37, ' ')}|`);
                console.log('+===========================================================+\n');
                return finish({
                    success: false,
                    message: `Tidak dapat membuka Serial Port EDC (${portPath}): ${openErr.message}`
                });
            }

            console.log(`[EDC Manager] Serial port berhasil dibuka\n`);

            const port = host.getActivePort();
            if (!port) {
                return finish({
                    success: false,
                    message: `Serial Port EDC (${portPath}) tidak tersedia setelah open`
                });
            }

            try {
                port.set({ dtr: true, rts: true });
            } catch (_) {}

            port.on('data', (chunk: Buffer) => {
                lastRxAt = Date.now();
                bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);

                const rxContext = voidFrameAcked ? 'post-ack-rx' : 'pre-ack-rx';
                logVoidRx(chunk, rxContext);

                if (voidFrameAcked) {
                    console.log(
                        `[EDC VOID Post-ACK] chunk class=${classifyLinkChunk(chunk)} ` +
                            `accumulator=${bufferAccumulator.length}B ` +
                            `+${Date.now() - (voidAckAtMs ?? Date.now())}ms-from-ack`
                    );
                }

                if (chunk.includes(0x05)) {
                    console.log('[EDC Manager] Menerima ENQ (0x05) dari EDC');
                    if (voidFrameAcked) {
                        console.log(
                            '[EDC VOID Post-ACK] ENQ dari EDC — balas ACK saja; catat apakah ini prompt sebelum eksekusi VOID'
                        );
                    }
                    writeVoidLink(Buffer.from([0x06]), voidFrameAcked ? 'post-ack-enq-ack' : 'pre-ack-enq-ack');
                    if (!voidFrameSent) {
                        setTimeout(() => sendVoidFrame(), 100);
                    }
                }

                if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 0x04) {
                    console.log('[EDC Manager] Menerima EOT (0x04) dari EDC — sesi link-layer berakhir');
                    if (voidFrameAcked) {
                        console.log('[EDC VOID Post-ACK] EOT dari EDC (bukan dari POS) — tunggu STX result jika belum');
                    }
                    bufferAccumulator = Buffer.alloc(0);
                    return;
                }

                if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 0x06) {
                    if (voidFrameSent) {
                        console.log('[EDC Manager] EDC merespons ACK (0x06) ke frame VOID');
                        markVoidFrameAcked();
                    } else {
                        console.log('[EDC Manager] EDC merespons ACK ke ENQ — kirim frame VOID');
                        sendVoidFrame();
                    }
                    bufferAccumulator = Buffer.alloc(0);
                    return;
                }

                if (isEdcLinkNak(bufferAccumulator)) {
                    const nakMessage = voidFrameAcked
                        ? 'EDC mengirim NAK (0x15) saat proses VOID'
                        : 'EDC menolak frame VOID (NAK 0x15 — format/LRC salah)';
                    const rawHex = bufferAccumulator.toString('hex');
                    console.log('+===========================================================+');
                    console.log('|                    TRANSAKSI VOID GAGAL                   |');
                    console.log('+===========================================================+');
                    console.log(`|  Payment Type      : ${paymentType.padEnd(37, ' ')}|`);
                    console.log(`|  Error             : ${nakMessage.substring(0, 37).padEnd(37, ' ')}|`);
                    console.log(`|  Raw Hex           : ${rawHex.toUpperCase().substring(0, 37).padEnd(37, ' ')}|`);
                    console.log('+===========================================================+\n');
                    bufferAccumulator = Buffer.alloc(0);
                    return finish({
                        success: false,
                        message: nakMessage,
                        rawHexResponse: rawHex
                    });
                }

                if (bufferAccumulator[0] === 0x06 && bufferAccumulator.length > 1) {
                    if (voidFrameSent) {
                        markVoidFrameAcked();
                        console.log('[EDC Manager] EDC merespons ACK (0x06) + data respons VOID');
                    }
                    bufferAccumulator = bufferAccumulator.subarray(1);
                }

                const stxIdx = bufferAccumulator.indexOf(0x02);
                const etxIdx = bufferAccumulator.lastIndexOf(0x03);

                if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) {
                    if (voidFrameAcked && bufferAccumulator.length > 0) {
                        console.log(
                            `[EDC VOID Post-ACK] buffer partial (${bufferAccumulator.length}B) — tunggu STX frame lengkap`
                        );
                    }
                    return;
                }

                if (bufferAccumulator.length < etxIdx + 2) {
                    if (voidFrameAcked) {
                        console.log('[EDC VOID Post-ACK] frame STX belum lengkap (menunggu LRC)');
                    }
                    return;
                }

                if (voidFrameSent && !awaitingVoidResult) {
                    return;
                }

                voidPhase = 'RESULT';
                clearPostAckIdleTimer();

                const fullFrame = bufferAccumulator.subarray(stxIdx, etxIdx + 2);
                const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);

                console.log('\n+===========================================================+');
                console.log(`|          RESPONSE EDC VOID - ${paymentType.padEnd(6, ' ')}                   |`);
                console.log('+===========================================================+');
                console.log(
                    `|  Full Frame (Hex)  : ${fullFrame.toString('hex').toUpperCase().substring(0, 37).padEnd(37, ' ')}|`
                );
                console.log(
                    `|  Payload (Hex)     : ${payload.toString('hex').toUpperCase().substring(0, 37).padEnd(37, ' ')}|`
                );
                console.log('+===========================================================+\n');

                const parsed = parseDirectResponse(payload);
                console.log(
                    `[EDC Manager] Parsed VOID respCode=${parsed.respCode} type=${parsed.transactionType || '-'} ` +
                        `ref=${parsed.referenceNumber || '-'} date=${parsed.transactionDate || '-'} ` +
                        `time=${parsed.transactionTime || '-'} amount/status=${parsed.terminalAmount || '-'} ` +
                        `approval=${parsed.approvalCode || '-'} detail=${JSON.stringify(parsed.detail || '')}`
                );

                if (isShortTerminalError(payload) && parsed.respCode === '10' && parsed.detail.startsWith('ER')) {
                    console.log('+===========================================================+');
                    console.log('|                    TRANSAKSI VOID GAGAL                   |');
                    console.log('+===========================================================+');
                    console.log(`|  Payment Type      : ${paymentType.padEnd(37, ' ')}|`);
                    console.log(`|  Error Code        : 10-ER${' '.repeat(31)}|`);
                    console.log(`|  Amount (Rp)       : ${amount.toLocaleString('id-ID').padEnd(37, ' ')}|`);
                    console.log('+===========================================================+\n');
                    return finish({
                        success: false,
                        responseCode: '10',
                        message: mapEdcErrorMessage(parsed.respCode, parsed.detail),
                        rawHexResponse: fullFrame.toString('hex')
                    });
                }

                writeVoidLink(Buffer.from([0x06]), `ack-void-result-${parsed.respCode}`);

                const isSuccess = parsed.respCode === '00';

                if (isSuccess) {
                    console.log('+===========================================================+');
                    console.log('|                 TRANSAKSI VOID BERHASIL                   |');
                    console.log('+===========================================================+');
                    console.log(`|  Payment Type      : ${paymentType.padEnd(37, ' ')}|`);
                    console.log(`|  Response Code     : ${parsed.respCode.padEnd(37, ' ')}|`);
                    console.log(`|  Amount (Rp)       : ${amount.toLocaleString('id-ID').padEnd(37, ' ')}|`);
                    console.log('|-----------------------------------------------------------|');
                    console.log(`|  Reference Number  : ${(parsed.referenceNumber || '-').padEnd(37, ' ')}|`);
                    console.log(`|  RRN               : ${(parsed.rrn || '-').padEnd(37, ' ')}|`);
                    console.log(`|  Approval Code     : ${(parsed.approvalCode || '-').padEnd(37, ' ')}|`);
                    console.log(
                        `|  Date / Time       : ${`${parsed.transactionDate || '-'} ${parsed.transactionTime || ''}`.trim().padEnd(37, ' ')}|`
                    );
                    console.log(`|  Amount / Status   : ${(parsed.terminalAmount || '-').padEnd(37, ' ')}|`);
                    console.log('+===========================================================+\n');
                } else {
                    console.log('+===========================================================+');
                    console.log('|                  TRANSAKSI VOID GAGAL                     |');
                    console.log('+===========================================================+');
                    console.log(`|  Payment Type      : ${paymentType.padEnd(37, ' ')}|`);
                    console.log(`|  Response Code     : ${parsed.respCode.padEnd(37, ' ')}|`);
                    console.log(`|  Amount (Rp)       : ${amount.toLocaleString('id-ID').padEnd(37, ' ')}|`);
                    if (parsed.detail) {
                        console.log(`|  Detail            : ${parsed.detail.substring(0, 37).padEnd(37, ' ')}|`);
                    }
                    console.log('+===========================================================+\n');
                }

                return finish({
                    success: isSuccess,
                    responseCode: parsed.respCode,
                    approvalCode: parsed.approvalCode || undefined,
                    maskedCardNo: parsed.maskedCardNo || undefined,
                    traceNumber: parsed.traceNumber || undefined,
                    referenceNumber: parsed.referenceNumber || undefined,
                    rrn: parsed.rrn || undefined,
                    terminalId: parsed.terminalId || undefined,
                    cardType: parsed.cardType || undefined,
                    entryMode: parsed.entryMode || undefined,
                    transactionType: parsed.transactionType || undefined,
                    batchNumber: parsed.batchNumber || undefined,
                    invoiceSequence: parsed.invoiceSequence || undefined,
                    transactionDate: parsed.transactionDate || undefined,
                    transactionTime: parsed.transactionTime || undefined,
                    terminalAmount: parsed.terminalAmount || undefined,
                    message: isSuccess
                        ? 'Void Transaksi EDC Berhasil'
                        : parsed.detail || mapEdcErrorMessage(parsed.respCode, parsed.detail),
                    rawHexResponse: fullFrame.toString('hex')
                });
            });

            port.on('error', err => {
                console.log('+===========================================================+');
                console.log('|                  KONEKSI SERIAL ERROR                     |');
                console.log('+===========================================================+');
                console.log(`|  Payment Type      : ${paymentType.padEnd(37, ' ')}|`);
                console.log(`|  Error Message     : ${err.message.substring(0, 37).padEnd(37, ' ')}|`);
                console.log('+===========================================================+\n');
                finish({
                    success: false,
                    message: `Koneksi Serial EDC Error: ${err.message}`
                });
            });

            port.on('close', () => {
                if (!isSettled) {
                    console.log('+===========================================================+');
                    console.log('|                PORT SERIAL TERPUTUS                       |');
                    console.log('+===========================================================+');
                    console.log(`|  Payment Type      : ${paymentType.padEnd(37, ' ')}|`);
                    console.log(`|  Port Path         : ${portPath.substring(0, 37).padEnd(37, ' ')}|`);
                    console.log('+===========================================================+\n');
                    finish({
                        success: false,
                        message: 'Port serial EDC terputus. Tutup script test, lalu coba void lagi di POS.'
                    });
                }
            });

            if (voidEnqFirst) {
                const enqFallbackMs = getVoidEnqFallbackMs();
                console.log(
                    `[EDC Manager] Mode VOID ENQ-first (opsional) — tunggu ENQ dari EDC (fallback ${enqFallbackMs}ms)`
                );
                setTimeout(() => {
                    if (!voidFrameSent) {
                        console.log(
                            `[EDC Manager] ENQ tidak diterima — kirim frame VOID (fallback ${enqFallbackMs}ms)`
                        );
                        sendVoidFrame();
                    }
                }, enqFallbackMs);
            } else {
                const preSendDelayMs = (() => {
                    const parsed = parseInt(process.env.EDC_PRE_SEND_DELAY_MS || '1500', 10);
                    return Number.isNaN(parsed) ? 1500 : parsed;
                })();
                console.log(
                    `[EDC Manager] Mode VOID direct-send (default, selaras SALE) — kirim frame setelah ${preSendDelayMs}ms`
                );
                setTimeout(() => sendVoidFrame(), preSendDelayMs);
            }
        });
    });
}
