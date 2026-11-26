import * as net from 'net';
import { SerialPort } from 'serialport';
import type { EdcSerialHost, EDCProcessPaymentParams, EDCProcessPaymentResponse } from './edc-types';
import {
    buildStxLrcFrame,
    formatDanamonAmount,
    getDefaultBaudRate,
    getDefaultEdcTimeoutMs,
    getPreSendDelayMs,
    isBufferNak,
    isShortTerminalError,
    logRxChunk,
    mapEdcErrorMessage,
    normalizeSerialPortPath,
    parseDirectResponse,
    paymentResponseFromParsed,
    validateDanamonAmount,
    writeLinkAck
} from './edc-protocol';

export function buildDebitCreditPaymentFrame(paymentType: 'DEBIT' | 'CREDIT', amount: number): Buffer {
    const ETX = 0x03;
    const transCodeByte = 0x01;
    const amountStr = formatDanamonAmount(amount);

    console.log('===========================================================');
    console.log(`              ${paymentType} PAYMENT FRAME (ECR)              `);
    console.log('===========================================================');
    console.log(`  Payment Type     : ${paymentType}`);
    console.log(`  Amount (Rp)      : ${amount.toLocaleString('id-ID')}`);
    console.log(`  Amount Field     : ${amountStr} (14 digit: "8+6" ASCII)`);
    console.log('-----------------------------------------------------------');
    console.log(`    STX            : 0x02`);
    console.log(`    Trans Code     : 0x${transCodeByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    Amount         : ${amountStr}`);
    console.log(`    ETX            : 0x${ETX.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log('-----------------------------------------------------------');

    const bodyBuf = Buffer.concat([Buffer.from([transCodeByte]), Buffer.from(amountStr, 'ascii'), Buffer.from([ETX])]);
    const finalFrame = buildStxLrcFrame(bodyBuf);

    console.log(
        `  LRC/CRC          : 0x${finalFrame[finalFrame.length - 1].toString(16).toUpperCase().padStart(2, '0')}`
    );
    console.log(`  Complete Frame   : ${finalFrame.toString('hex').toUpperCase()}`);
    console.log('===========================================================\n');

    return finalFrame;
}

export function processDebitCreditPaymentTcp(params: EDCProcessPaymentParams): Promise<EDCProcessPaymentResponse> {
    const ip = params.ipTerminal?.trim();
    const port = params.port;
    const { amount, paymentType, timeoutMs = getDefaultEdcTimeoutMs() } = params;

    if (paymentType !== 'DEBIT' && paymentType !== 'CREDIT') {
        return Promise.resolve({ success: false, message: 'Tipe pembayaran tidak valid untuk modul debit/kredit.' });
    }

    if (!ip || !port) {
        return Promise.resolve({
            success: false,
            message: 'IP Terminal dan Port wajib untuk pembayaran EDC TCP/IP.'
        });
    }

    const amountError = validateDanamonAmount(amount, paymentType);
    if (amountError) {
        return Promise.resolve({ success: false, message: amountError });
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
                message: `Waktu transaksi di EDC habis (Timeout ${timeoutMs / 1000}s). Pembayaran dibatalkan.`
            });
        }, timeoutMs);

        client.setTimeout(timeoutMs);

        client.on('connect', () => {
            const frame = buildDebitCreditPaymentFrame(paymentType, amount);
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
                    'Pembayaran EDC Berhasil'
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

export function processDebitCreditPaymentSerial(
    host: EdcSerialHost,
    params: EDCProcessPaymentParams & { portPath: string }
): Promise<EDCProcessPaymentResponse> {
    const paymentType = params.paymentType;
    if (paymentType !== 'DEBIT' && paymentType !== 'CREDIT') {
        return Promise.resolve({ success: false, message: 'Tipe pembayaran tidak valid untuk modul debit/kredit.' });
    }

    let { portPath, amount, baudRate = getDefaultBaudRate(), timeoutMs = getDefaultEdcTimeoutMs() } = params;
    portPath = normalizeSerialPortPath(portPath);

    const amountError = validateDanamonAmount(amount, paymentType);
    if (amountError) {
        return Promise.resolve({ success: false, message: amountError });
    }

    return new Promise(resolve => {
        let isSettled = false;
        let bufferAccumulator = Buffer.alloc(0);
        let saleFrameSent = false;
        let awaitingPaymentResult = false;


        console.log('\n+-----------------------------------------------------------+');
        console.log(`|          MEMULAI TRANSAKSI EDC - ${paymentType.padEnd(6, ' ')}              |`);
        console.log('+-----------------------------------------------------------+');
        console.log(`[EDC ${paymentType}] Amount        : Rp ${amount.toLocaleString('id-ID')}`);
        console.log(`[EDC ${paymentType}] Serial Port   : ${portPath}`);
        console.log(`[EDC ${paymentType}] Baud Rate     : ${baudRate}\n`);

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
            return resolve({ success: false, message: `Gagal menginisialisasi Serial Port (${portPath}): ${message}` });
        }

        const timer = setTimeout(() => {
            if (!isSettled) {
                isSettled = true;
                if (awaitingPaymentResult) {
                    host.markRecoveryRequired?.({
                        reason: `Waktu transaksi di EDC habis (Timeout ${timeoutMs / 1000}s) saat menunggu respons pembayaran`,
                        amount,
                        paymentType,
                        portPath
                    });
                    host.cleanup(activePort);
                    return resolve({
                        success: false,
                        responseCode: 'RECOVERY_REQUIRED',
                        message: `Waktu transaksi di EDC habis setelah request dikirim. Status transaksi ambigu di EDC — Lakukan pengecekan fisik/inquiry.`
                    });
                }
                host.cleanup(activePort);
                resolve({
                    success: false,
                    message: `Waktu transaksi di EDC habis (Timeout ${timeoutMs / 1000}s). Pembayaran dibatalkan.`
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
            if (saleFrameSent || !host.getActivePort()?.isOpen) return;
            saleFrameSent = true;
            const frame = buildDebitCreditPaymentFrame(paymentType, amount);
            console.log(`[EDC ${paymentType}] Mengirim frame ke EDC terminal...`);
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
                    console.log(`[EDC ${paymentType}] Menerima ENQ — balas ACK`);
                    host.getActivePort()?.write(Buffer.from([0x06]));
                    if (!saleFrameSent) setTimeout(() => sendFrame(), 100);
                }

                if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 0x04) {
                    bufferAccumulator = Buffer.alloc(0);
                    return;
                }

                if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 0x06) {
                    if (saleFrameSent) {
                        console.log(`[EDC ${paymentType}] Menunggu pelanggan tap/gesek/insert kartu...`);
                        awaitingPaymentResult = true;
                    } else {
                        sendFrame();
                    }
                    bufferAccumulator = Buffer.alloc(0);
                    return;
                }

                if (isBufferNak(bufferAccumulator)) {
                    if (awaitingPaymentResult) {
                        bufferAccumulator = Buffer.alloc(0);
                        return finish({ success: false, responseCode: '10', message: mapEdcErrorMessage('10', 'ER') });
                    }
                    return finish({
                        success: false,
                        message: 'EDC menolak paket data (NAK - Format/LRC Salah)',
                        rawHexResponse: bufferAccumulator.toString('hex')
                    });
                }

                if (bufferAccumulator[0] === 0x06 && bufferAccumulator.length > 1) {
                    if (saleFrameSent) awaitingPaymentResult = true;
                    bufferAccumulator = bufferAccumulator.subarray(1);
                }

                const stxIdx = bufferAccumulator.indexOf(0x02);
                const etxIdx = bufferAccumulator.lastIndexOf(0x03);
                if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) return;
                if (bufferAccumulator.length < etxIdx + 2) return;
                if (saleFrameSent && !awaitingPaymentResult) return;

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

                writeLinkAck(host.getActivePort(), `${paymentType} resp ${parsed.respCode}`);
                const isSuccess = parsed.respCode === '00';
                return finish(
                    paymentResponseFromParsed(parsed, isSuccess, fullFrame.toString('hex'), 'Pembayaran EDC Berhasil')
                );
            });

            activePort.on('error', err => {
                if (awaitingPaymentResult) {
                    host.markRecoveryRequired?.({
                        reason: `Koneksi serial EDC error saat menunggu hasil transaksi: ${err.message}`,
                        amount,
                        paymentType,
                        portPath,
                        lastError: err.message
                    });
                    return finish({
                        success: false,
                        responseCode: 'RECOVERY_REQUIRED',
                        message: `Koneksi Serial EDC Error setelah request dikirim (${err.message}). Status ambigu di EDC — Wajib recovery / cek struk EDC fisik.`
                    });
                }
                finish({ success: false, message: `Koneksi Serial EDC Error: ${err.message}` });
            });

            activePort.on('close', () => {
                if (!isSettled) {
                    if (awaitingPaymentResult) {
                        host.markRecoveryRequired?.({
                            reason: 'Port serial EDC terputus saat menunggu respons transaksi (close event)',
                            amount,
                            paymentType,
                            portPath
                        });
                        return finish({
                            success: false,
                            responseCode: 'RECOVERY_REQUIRED',
                            message: 'Port serial EDC terputus setelah request pembayaran dikirim. Status transaksi ambigu di EDC — Wajib recovery / cek struk EDC fisik.'
                        });
                    }
                    finish({
                        success: false,
                        message: 'Port serial EDC terputus. Tutup script test, lalu coba bayar lagi di POS.'
                    });
                }
            });

            setTimeout(() => sendFrame(), getPreSendDelayMs());
        });
    });
}

export function processDebitCreditPayment(
    host: EdcSerialHost,
    params: EDCProcessPaymentParams
): Promise<EDCProcessPaymentResponse> {
    if (params.connectionType === 'TCP_IP') {
        return processDebitCreditPaymentTcp(params);
    }
    const portPath = params.portPath?.trim();
    if (!portPath) {
        return Promise.resolve({
            success: false,
            message: 'Port serial EDC belum dikonfigurasi. Buka Pengaturan → EDC Configuration.'
        });
    }
    return processDebitCreditPaymentSerial(host, { ...params, portPath });
}
