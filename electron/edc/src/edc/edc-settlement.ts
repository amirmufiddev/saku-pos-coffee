import { SerialPort } from 'serialport';
import type { EdcSerialHost, EdcSettleTransactionParams, EDCProcessPaymentResponse } from './edc-types';
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
    writeLinkAck
} from './edc-protocol';

/**
 * Danamon ECR Settlement §6.5: [STX] [01] [33] [30] [ETX] [LRC]
 * Example: 02 01 33 30 03 01
 */
export function buildIngenicoSettleFrame(): Buffer {
    const ETX = 0x03;
    const settleVersionByte = parseHexByteEnv(process.env.EDC_SETTLE_VERSION, 0x01);
    const settleTypeByte = parseHexByteEnv(process.env.EDC_SETTLE_TYPE, 0x33);
    const settleSubTypeByte = parseHexByteEnv(process.env.EDC_SETTLE_SUB_TYPE, 0x30);
    const headerBuf = Buffer.from([settleVersionByte, settleTypeByte, settleSubTypeByte]);

    console.log('===========================================================');
    console.log('                EDC SETTLEMENT TRANSACTION FRAME           ');
    console.log('===========================================================');
    console.log('  Frame Structure (Danamon spec §6.5):');
    console.log(`    STX            : 0x02`);
    console.log(`    Version        : 0x${settleVersionByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    Type           : 0x${settleTypeByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    Sub Type       : 0x${settleSubTypeByte.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log(`    ETX            : 0x${ETX.toString(16).toUpperCase().padStart(2, '0')}`);
    console.log('-----------------------------------------------------------');

    const bodyBuf = Buffer.concat([headerBuf, Buffer.from([ETX])]);
    const finalFrame = buildStxLrcFrame(bodyBuf);

    console.log(
        `  LRC/CRC          : 0x${finalFrame[finalFrame.length - 1].toString(16).toUpperCase().padStart(2, '0')}`
    );
    console.log('-----------------------------------------------------------');
    console.log(`  Complete Frame   : ${finalFrame.toString('hex').toUpperCase()}`);
    console.log('===========================================================\n');

    return finalFrame;
}

export function settleEdcTransaction(
    host: EdcSerialHost,
    params: EdcSettleTransactionParams
): Promise<EDCProcessPaymentResponse> {
    let { portPath, baudRate = getDefaultBaudRate(), timeoutMs = 120000 } = params;
    portPath = normalizeSerialPortPath(portPath);

    return new Promise(resolve => {
        let isSettled = false;
        let bufferAccumulator = Buffer.alloc(0);
        let settleFrameSent = false;
        let awaitingSettleResult = false;


        console.log('\n+-----------------------------------------------------------+');
        console.log(`|            MEMULAI SETTLEMENT BATCH EDC                   |`);
        console.log('+-----------------------------------------------------------+');
        console.log(`[EDC Manager] Serial Port   : ${portPath}`);
        console.log(`[EDC Manager] Baud Rate     : ${baudRate}`);
        console.log(`[EDC Manager] Timeout       : ${timeoutMs / 1000}s\n`);

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
                console.log('+===========================================================+');
                console.log('|                  SETTLEMENT TIMEOUT                       |');
                console.log('+===========================================================+');
                console.log(
                    `|  Timeout Duration  : ${(timeoutMs / 1000).toString()}s${' '.repeat(34 - (timeoutMs / 1000).toString().length)}|`
                );
                console.log('+===========================================================+\n');
                host.cleanup(activePort);
                resolve({
                    success: false,
                    message: `Waktu settlement di EDC habis (Timeout ${timeoutMs / 1000}s). Settlement dibatalkan.`
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

        const sendSettleFrame = () => {
            if (settleFrameSent || !host.getActivePort()?.isOpen) return;
            settleFrameSent = true;

            const frame = buildIngenicoSettleFrame();
            console.log(`[EDC Manager] Mengirim frame SETTLE ke EDC terminal...`);
            host.getActivePort()!.write(frame);
        };

        activePort.open(openErr => {
            if (openErr) {
                console.log('+===========================================================+');
                console.log('|             GAGAL MEMBUKA SERIAL PORT                     |');
                console.log('+===========================================================+');
                console.log(`|  Port Path         : ${portPath.substring(0, 37).padEnd(37, ' ')}|`);
                console.log(`|  Error Message     : ${openErr.message.substring(0, 37).padEnd(37, ' ')}|`);
                console.log('+===========================================================+\n');
                return finish({
                    success: false,
                    message: `Tidak dapat membuka Serial Port EDC (${portPath}): ${openErr.message}`
                });
            }

            console.log(`[EDC Manager] Serial port berhasil dibuka\n`);

            try {
                activePort.set({ dtr: true, rts: true });
            } catch (_) {}

            activePort.on('data', (chunk: Buffer) => {
                bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
                logRxChunk(chunk);

                if (chunk.includes(0x05)) {
                    console.log('[EDC Manager] Menerima ENQ (0x05) dari EDC — balas ACK (terminal flow tetap jalan)');
                    host.getActivePort()?.write(Buffer.from([0x06]));
                    if (!settleFrameSent) {
                        setTimeout(() => sendSettleFrame(), 100);
                    }
                }

                if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 0x04) {
                    console.log('[EDC Manager] Menerima EOT (0x04) - Sesi berakhir');
                    bufferAccumulator = Buffer.alloc(0);
                    return;
                }

                if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 0x06) {
                    if (settleFrameSent) {
                        console.log(`[EDC Manager] EDC merespons ACK (0x06) — menunggu proses settlement di terminal...`);
                        awaitingSettleResult = true;
                    } else {
                        console.log('[EDC Manager] ACK sebelum frame — kirim frame SETTLE');
                        sendSettleFrame();
                    }
                    bufferAccumulator = Buffer.alloc(0);
                    return;
                }

                if (isBufferNak(bufferAccumulator)) {
                    if (awaitingSettleResult) {
                        console.log('+===========================================================+');
                        console.log('|                   SETTLEMENT GAGAL                        |');
                        console.log('+===========================================================+');
                        console.log(`|  Error             : NAK dari terminal${' '.repeat(18)}|`);
                        console.log('+===========================================================+\n');
                        bufferAccumulator = Buffer.alloc(0);
                        return finish({
                            success: false,
                            responseCode: '10',
                            message: mapEdcErrorMessage('10', 'ER')
                        });
                    }
                    console.log('+===========================================================+');
                    console.log('|                   SETTLEMENT GAGAL                        |');
                    console.log('+===========================================================+');
                    console.log(`|  Error             : NAK - Format/LRC Salah${' '.repeat(12)}|`);
                    console.log(
                        `|  Raw Hex           : ${bufferAccumulator.toString('hex').toUpperCase().substring(0, 37).padEnd(37, ' ')}|`
                    );
                    console.log('+===========================================================+\n');
                    return finish({
                        success: false,
                        message: 'EDC menolak paket data (NAK - Format/LRC Salah)',
                        rawHexResponse: bufferAccumulator.toString('hex')
                    });
                }

                if (bufferAccumulator[0] === 0x06 && bufferAccumulator.length > 1) {
                    if (settleFrameSent) {
                        awaitingSettleResult = true;
                        console.log(`[EDC Manager] EDC merespons ACK (0x06) + data tambahan`);
                        console.log(`[EDC Manager] Menunggu proses settlement di terminal...`);
                    }
                    bufferAccumulator = bufferAccumulator.subarray(1);
                }

                const stxIdx = bufferAccumulator.indexOf(0x02);
                const etxIdx = bufferAccumulator.lastIndexOf(0x03);

                if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) {
                    return;
                }

                if (bufferAccumulator.length < etxIdx + 2) {
                    return;
                }

                if (settleFrameSent && !awaitingSettleResult) {
                    return;
                }

                const fullFrame = bufferAccumulator.subarray(stxIdx, etxIdx + 2);
                const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);

                console.log('\n+===========================================================+');
                console.log(`|          RESPONSE EDC SETTLEMENT                          |`);
                console.log('+===========================================================+');
                console.log(
                    `|  Full Frame (Hex)  : ${fullFrame.toString('hex').toUpperCase().substring(0, 37).padEnd(37, ' ')}|`
                );
                console.log(
                    `|  Payload (Hex)     : ${payload.toString('hex').toUpperCase().substring(0, 37).padEnd(37, ' ')}|`
                );
                console.log('+===========================================================+\n');

                const parsed = parseDirectResponse(payload);

                if (isShortTerminalError(payload) && parsed.respCode === '10' && parsed.detail.startsWith('ER')) {
                    console.log('+===========================================================+');
                    console.log('|                   SETTLEMENT GAGAL                        |');
                    console.log('+===========================================================+');
                    console.log(`|  Error Code        : 10-ER${' '.repeat(31)}|`);
                    console.log('+===========================================================+\n');
                    return finish({
                        success: false,
                        responseCode: '10',
                        message: mapEdcErrorMessage(parsed.respCode, parsed.detail),
                        rawHexResponse: fullFrame.toString('hex')
                    });
                }

                writeLinkAck(host.getActivePort(), `settlement resp ${parsed.respCode}`);

                const isSuccess = parsed.respCode === '00';

                if (isSuccess) {
                    console.log('+===========================================================+');
                    console.log('|                  SETTLEMENT BERHASIL                      |');
                    console.log('+===========================================================+');
                    console.log(`|  Response Code     : ${parsed.respCode.padEnd(37, ' ')}|`);
                    console.log(`|  Message           : Settlement Batch Berhasil${' '.repeat(10)}|`);
                    console.log('+===========================================================+\n');
                } else {
                    console.log('+===========================================================+');
                    console.log('|                   SETTLEMENT GAGAL                        |');
                    console.log('+===========================================================+');
                    console.log(`|  Response Code     : ${parsed.respCode.padEnd(37, ' ')}|`);
                    console.log('+===========================================================+\n');
                }

                return finish({
                    success: isSuccess,
                    responseCode: parsed.respCode,
                    message: isSuccess
                        ? 'Settlement Batch EDC Berhasil'
                        : mapEdcErrorMessage(parsed.respCode, parsed.detail),
                    rawHexResponse: fullFrame.toString('hex')
                });
            });

            activePort.on('error', err => {
                console.log('+===========================================================+');
                console.log('|                  KONEKSI SERIAL ERROR                     |');
                console.log('+===========================================================+');
                console.log(`|  Error Message     : ${err.message.substring(0, 37).padEnd(37, ' ')}|`);
                console.log('+===========================================================+\n');
                finish({
                    success: false,
                    message: `Koneksi Serial EDC Error: ${err.message}`
                });
            });

            activePort.on('close', () => {
                if (!isSettled) {
                    console.log('+===========================================================+');
                    console.log('|                PORT SERIAL TERPUTUS                       |');
                    console.log('+===========================================================+');
                    console.log(`|  Port Path         : ${portPath.substring(0, 37).padEnd(37, ' ')}|`);
                    console.log('+===========================================================+\n');
                    finish({
                        success: false,
                        message: 'Port serial EDC terputus. Tutup script test, lalu coba settle lagi.'
                    });
                }
            });

            setTimeout(() => sendSettleFrame(), getPreSendDelayMs());
        });
    });
}
