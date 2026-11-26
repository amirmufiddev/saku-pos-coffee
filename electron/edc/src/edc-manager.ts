import { SerialPort } from 'serialport';
import * as net from 'net';
import { processDebitCreditPayment } from './edc/edc-debit-credit';
import { processQrisPayment } from './edc/edc-qris';
import { inquiryQrisAnyTransaction, inquiryQrisLastTransaction } from './edc/edc-qris-inquiry';
import { voidEdcTransaction } from './edc/edc-void';
import { settleEdcTransaction } from './edc/edc-settlement';
import { arePortPathsEquivalent, extractTerminalIdFromPayload, getDefaultBaudRate, normalizeSerialPortPath } from './edc/edc-protocol';
import {
    EdcConnectionState,
    EdcDeviceIdentifier,
    EdcPortResolutionResult,
    EdcQrisAnyInquiryParams,
    EdcQrisInquiryParams,
    EdcRecoveryInfo,
    EdcSerialHost,
    EdcStatus
} from './edc/edc-types';

export type {
    EdcConnectionType,
    EdcPaymentType,
    EDCProcessPaymentParams,
    EDCVoidTransactionParams,
    EdcSettleTransactionParams,
    EdcQrisInquiryParams,
    EdcQrisAnyInquiryParams,
    EdcTestConnectionParams,
    EdcTestConnectionResponse,
    EDCProcessPaymentResponse,
    EdcConnectionState,
    EdcRecoveryInfo,
    EdcDeviceIdentifier,
    EdcPortResolutionResult,
    EdcStatus,
    EdcSerialHost
} from './edc/edc-types';

interface ActiveOperationRecord {
    id: string;
    type: string;
    port: SerialPort | null;
}

/**
 * Facade komunikasi ECR Serial dengan Mesin EDC Ingenico (Bank Danamon).
 * Dilengkapi dengan Concurrency Guard terpusat, Port Auto-detection & Reconnect Scheduler,
 * serta State Machine diagnostik yang aman untuk transaksi finansial.
 */
export class EDCManager {
    private static instance: EDCManager;

    private activePort: SerialPort | null = null;
    private activeOperation: ActiveOperationRecord | null = null;
    private state: EdcConnectionState = 'DISCONNECTED';
    private recoveryInfo: EdcRecoveryInfo | null = null;
    private savedDeviceIdentifier: EdcDeviceIdentifier | null = null;

    private opSeq = 0;
    private statusListeners: Array<(status: EdcStatus) => void> = [];

    // SerialPort class reference (default to real official package, overridable in unit tests)
    private serialPortClass: any = SerialPort;

    public setSerialPortClassForTesting(mockClass: any): void {
        this.serialPortClass = mockClass;
    }

    public resetSerialPortClass(): void {
        this.serialPortClass = SerialPort;
    }

    // Reconnect scheduler configuration
    private readonly backoffDelays = [1000, 2000, 5000, 10000];
    private backoffIndex = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private configuredPortPath: string | null = null;

    private constructor() {}

    public static getInstance(): EDCManager {
        if (!EDCManager.instance) {
            EDCManager.instance = new EDCManager();
        }
        return EDCManager.instance;
    }

    /**
     * Centralized Concurrency & Transaction Guard:
     * Menjamin hanya ada 1 operasi serial yang aktif di satu waktu.
     */
    private acquireOperationLock(type: string): { opId: string; host: EdcSerialHost } | { error: string } {
        // P0: Tolak pembayaran baru jika transaksi sebelumnya masih ambigu
        if (this.state === 'RECOVERY_REQUIRED' && type === 'PAYMENT') {
            return {
                error: 'EDC_RECOVERY_REQUIRED: Transaksi sebelumnya belum tuntas atau status ambigu. ' +
                    'Harap periksa struk fisik atau lakukan Inquiry/Reset Recovery sebelum melakukan pembayaran baru.'
            };
        }

        // P0: Tolak operasi baru jika sedang ada operasi serial yang aktif
        if (this.activeOperation !== null) {
            return {
                error: `EDC_BUSY: Operasi EDC lain sedang berlangsung (${this.activeOperation.type}). Permintaan ditolak.`
            };
        }

        const opId = `op-${Date.now()}-${++this.opSeq}`;
        this.activeOperation = {
            id: opId,
            type,
            port: null
        };

        if (type === 'PAYMENT') {
            this.setState('PAYMENT_PENDING');
        } else {
            this.setState('CONNECTING');
        }

        const host = this.createSerialHost(opId, type);
        return { opId, host };
    }

    /**
     * Memastikan cleanup hanya menutup instance port yang dimiliki operasi terkait
     * dan tidak pernah menutup port milik operasi lain.
     */
    private releaseOperationLock(opId: string, portToClose?: SerialPort | null): void {
        if (!this.activeOperation || this.activeOperation.id !== opId) {
            // Operasi ini bukan pemilik lock saat ini, hanya tutup port jika secara eksplisit diteruskan
            if (portToClose && portToClose.isOpen) {
                try {
                    portToClose.close();
                } catch (_) {}
            }
            return;
        }

        const currentPort = this.activeOperation.port;

        // Jika portToClose diberikan dan berbeda dengan port yang dipegang operasi aktif, jangan tutup active port
        if (portToClose && currentPort && portToClose !== currentPort) {
            if (portToClose.isOpen) {
                try {
                    portToClose.close();
                } catch (_) {}
            }
            return;
        }

        // Tutup port milik operasi yang aktif
        if (currentPort?.isOpen) {
            try {
                currentPort.close();
            } catch (_) {}
        }

        this.activeOperation = null;
        this.activePort = null;

        if (this.recoveryInfo?.required) {
            this.setState('RECOVERY_REQUIRED');
        } else {
            this.setState('DISCONNECTED');
        }
    }

    private createSerialHost(opId: string, _opType: string): EdcSerialHost {
        return {
            createPort: (options: any) => new this.serialPortClass(options),
            getActivePort: () => {
                if (this.activeOperation && this.activeOperation.id === opId) {
                    return this.activeOperation.port;
                }
                return null;
            },
            setActivePort: (port: SerialPort | null) => {
                if (this.activeOperation && this.activeOperation.id === opId) {
                    this.activeOperation.port = port;
                    this.activePort = port;
                    if (port) {
                        this.setState('CONNECTED');
                    }
                }
            },
            cleanup: (portToClose?: SerialPort | null) => {
                this.releaseOperationLock(opId, portToClose);
            },
            markRecoveryRequired: (info) => {
                this.setRecoveryRequired(info);
            },
            getOperationId: () => opId
        };
    }

    /**
     * P0: Menandai status transaksi menjadi RECOVERY_REQUIRED jika pembayaran
     * terputus setelah frame pembayaran dikirim namun hasil belum dipastikan.
     */
    private setRecoveryRequired(info: {
        reason: string;
        amount?: number;
        paymentType?: import('./edc/edc-types').EdcPaymentType;
        portPath?: string;
        lastError?: string;
    }): void {
        console.warn('[EDC Manager] P0 Safety Triggered: Status diubah ke RECOVERY_REQUIRED', info);
        this.recoveryInfo = {
            required: true,
            reason: info.reason,
            amount: info.amount,
            paymentType: info.paymentType,
            portPath: info.portPath,
            timestamp: new Date().toISOString(),
            lastError: info.lastError
        };
        this.setState('RECOVERY_REQUIRED');
    }

    /**
     * P0: Prosedur reset recovery eksplisit oleh kasir/admin setelah melakukan
     * verifikasi fisik struk atau inquiry.
     */
    public resetRecovery(
        reason?: string,
        verificationMethod?: 'INQUIRY_VERIFIED' | 'PHYSICAL_SLIP_VERIFIED' | 'SUPERVISOR_OVERRIDE'
    ): { success: boolean; message: string } {
        const trimmed = (reason || '').trim();
        if (!trimmed || trimmed.length < 5) {
            return {
                success: false,
                message: 'Reset status recovery ditolak: Wajib menyertakan alasan rekonsiliasi yang valid (min 5 karakter).'
            };
        }
        console.log(`[EDC Manager] Reset recovery dieksekusi [${verificationMethod || 'MANUAL'}]: ${trimmed}`);
        this.recoveryInfo = null;
        this.setState('DISCONNECTED');
        return { success: true, message: 'Status recovery berhasil dibersihkan.' };
    }

    /** Status dan diagnostik EDC */
    public getStatus(): EdcStatus {
        return {
            state: this.state,
            activePortPath: this.activeOperation?.port?.path || (this.activePort as any)?.path || null,
            activeOperation: this.activeOperation?.type || null,
            recovery: this.recoveryInfo,
            savedDevice: this.savedDeviceIdentifier
        };
    }

    public onStatusChange(callback: (status: EdcStatus) => void): () => void {
        this.statusListeners.push(callback);
        try {
            callback(this.getStatus());
        } catch (_) {}
        return () => {
            this.statusListeners = this.statusListeners.filter(cb => cb !== callback);
        };
    }

    private setState(newState: EdcConnectionState): void {
        if (this.state !== newState) {
            console.log(`[EDC State] ${this.state} -> ${newState}`);
            this.state = newState;
            this.emitStatus();
        }
    }

    private emitStatus(): void {
        const current = this.getStatus();
        for (const listener of this.statusListeners) {
            try {
                listener(current);
            } catch (err) {
                console.error('[EDC Manager] Status listener error:', err);
            }
        }
    }

    /** Mendapatkan daftar port serial yang terhubung ke Mac/PC */
    public async listPorts() {
        const ports = await this.serialPortClass.list();
        const cuPorts = ports.filter((p: any) => p.path.includes('/cu.'));
        const otherPorts = ports.filter((p: any) => !p.path.includes('/cu.'));

        return [...cuPorts, ...otherPorts].map((p: any) => ({
            path: p.path,
            manufacturer: p.manufacturer || '',
            serialNumber: p.serialNumber || '',
            vendorId: p.vendorId || '',
            productId: p.productId || ''
        }));
    }

    /**
     * P1: Auto-detection dan resolver port berdasarkan identitas perangkat USB.
     * Tidak mengasumsikan serial number selalu ada.
     */
    public async resolvePortPath(
        preferredPath?: string,
        identifier?: EdcDeviceIdentifier | null
    ): Promise<EdcPortResolutionResult> {
        let ports: Awaited<ReturnType<typeof SerialPort.list>> = [];
        try {
            ports = await this.serialPortClass.list();
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            return {
                resolvedPath: null,
                matchedByIdentity: false,
                ambiguous: false,
                candidatePaths: [],
                error: `Gagal membaca daftar port serial: ${errorMsg}`
            };
        }

        const normPreferred = preferredPath ? normalizeSerialPortPath(preferredPath) : undefined;
        const targetId = identifier || this.savedDeviceIdentifier;

        // 1. Jika ada Serial Number yang spesifik (bukan kosong)
        if (targetId?.serialNumber && targetId.serialNumber.trim().length > 0) {
            const targetSn = targetId.serialNumber.trim().toLowerCase();
            const matches = ports.filter(p => p.serialNumber && p.serialNumber.trim().toLowerCase() === targetSn);
            if (matches.length === 1) {
                return {
                    resolvedPath: matches[0].path,
                    matchedByIdentity: true,
                    ambiguous: false,
                    candidatePaths: [matches[0].path]
                };
            }
            if (matches.length > 1) {
                return {
                    resolvedPath: null,
                    matchedByIdentity: false,
                    ambiguous: true,
                    candidatePaths: matches.map(m => m.path),
                    error: `Ditemukan ${matches.length} perangkat dengan nomor serial USB yang identik.`
                };
            }
        }

        // 2. Jika ada kombinasi VendorID & ProductID
        if (targetId?.vendorId && targetId?.productId) {
            const targetVid = targetId.vendorId.trim().toLowerCase();
            const targetPid = targetId.productId.trim().toLowerCase();
            const matches = ports.filter(
                p => p.vendorId?.trim().toLowerCase() === targetVid && p.productId?.trim().toLowerCase() === targetPid
            );

            if (matches.length === 1) {
                return {
                    resolvedPath: matches[0].path,
                    matchedByIdentity: true,
                    ambiguous: false,
                    candidatePaths: [matches[0].path]
                };
            }
            if (matches.length > 1) {
                if (normPreferred && matches.some(m => m.path === normPreferred)) {
                    return {
                        resolvedPath: normPreferred,
                        matchedByIdentity: true,
                        ambiguous: false,
                        candidatePaths: matches.map(m => m.path)
                    };
                }
                return {
                    resolvedPath: null,
                    matchedByIdentity: false,
                    ambiguous: true,
                    candidatePaths: matches.map(m => m.path),
                    error: `Ditemukan beberapa perangkat dengan VendorID/ProductID (${targetVid}:${targetPid}). Harap pilih port manual.`
                };
            }
        }

        // 3. Fallback: Cocokkan preferredPath jika masih tersedia di list
        if (normPreferred) {
            const found = ports.find(p => arePortPathsEquivalent(p.path, normPreferred));
            if (found) {
                return {
                    resolvedPath: found.path,
                    matchedByIdentity: false,
                    ambiguous: false,
                    candidatePaths: [found.path]
                };
            }
        }

        // 4. Jika preferredPath tidak ditemukan
        if (normPreferred) {
            return {
                resolvedPath: null,
                matchedByIdentity: false,
                ambiguous: false,
                candidatePaths: ports.map(p => p.path),
                error: `Port serial ${normPreferred} tidak ditemukan di sistem.`
            };
        }

        return {
            resolvedPath: null,
            matchedByIdentity: false,
            ambiguous: false,
            candidatePaths: ports.map(p => p.path),
            error: 'Port serial EDC belum dipilih.'
        };
    }

    /** Simpan identitas hardware USB saat koneksi berhasil */
    public async saveDeviceIdentityFromPort(portPath: string): Promise<EdcDeviceIdentifier | null> {
        try {
            const ports = await this.serialPortClass.list();
            const normPath = normalizeSerialPortPath(portPath);
            const found = ports.find((p: any) => arePortPathsEquivalent(p.path, normPath));
            if (found && (found.vendorId || found.productId || found.serialNumber || found.manufacturer)) {
                this.savedDeviceIdentifier = {
                    vendorId: found.vendorId || undefined,
                    productId: found.productId || undefined,
                    serialNumber: found.serialNumber || undefined,
                    manufacturer: found.manufacturer || undefined
                };
                return this.savedDeviceIdentifier;
            }
        } catch (_) {}
        return null;
    }

    public setSavedDeviceIdentifier(id: EdcDeviceIdentifier | null): void {
        this.savedDeviceIdentifier = id;
    }

    public getSavedDeviceIdentifier(): EdcDeviceIdentifier | null {
        return this.savedDeviceIdentifier;
    }

    /**
     * P1: Reconnect scheduler tunggal dengan exponential backoff:
     * 1s, 2s, 5s, 10s (capped di 10 detik).
     */
    public startReconnectScheduler(targetPortPath?: string): void {
        if (targetPortPath) {
            this.configuredPortPath = targetPortPath;
        }
        // P1 & P3: Pastikan tidak berjalan ganda (single scheduler guard)
        if (this.reconnectTimer !== null) {
            return;
        }
        this.scheduleNextReconnect();
    }

    public stopReconnectScheduler(): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.backoffIndex = 0;
    }

    private scheduleNextReconnect(): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        const delay = this.backoffDelays[this.backoffIndex];
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            await this.executeReconnectCheck();
        }, delay);
    }

    private async executeReconnectCheck(): Promise<void> {
        // P1 constraint 6: Jangan membuka port saat transaksi aktif atau cleanup belum selesai
        if (this.activeOperation !== null) {
            this.backoffIndex = Math.min(this.backoffIndex + 1, this.backoffDelays.length - 1);
            this.scheduleNextReconnect();
            return;
        }

        // P0 constraint 5: Jangan auto-retry perintah finansial
        if (this.state === 'RECOVERY_REQUIRED') {
            this.backoffIndex = Math.min(this.backoffIndex + 1, this.backoffDelays.length - 1);
            this.scheduleNextReconnect();
            return;
        }

        const resolution = await this.resolvePortPath(this.configuredPortPath || undefined, this.savedDeviceIdentifier);
        if (!resolution.resolvedPath || resolution.ambiguous) {
            this.setState('DISCONNECTED');
            this.backoffIndex = Math.min(this.backoffIndex + 1, this.backoffDelays.length - 1);
            this.scheduleNextReconnect();
            return;
        }

        // Jalankan probe ENQ ringan non-transaksional untuk memvalidasi kesiapan protokol
        const probeLock = this.acquireOperationLock('RECONNECT_PROBE');
        if ('error' in probeLock) {
            this.backoffIndex = Math.min(this.backoffIndex + 1, this.backoffDelays.length - 1);
            this.scheduleNextReconnect();
            return;
        }

        try {
            const probeResult = await this.testSerialConnection(
                resolution.resolvedPath,
                getDefaultBaudRate(),
                1500,
                probeLock.host
            );

            if (probeResult.success) {
                await this.saveDeviceIdentityFromPort(resolution.resolvedPath);
                this.setState('READY');
                this.backoffIndex = 0;
                // Reconnect berhasil & protokol terverifikasi, hentikan timer sampai disconnect berikutnya
            } else {
                this.setState('DISCONNECTED');
                this.backoffIndex = Math.min(this.backoffIndex + 1, this.backoffDelays.length - 1);
                this.scheduleNextReconnect();
            }
        } finally {
            probeLock.host.cleanup();
        }
    }

    public async processPayment(
        params: import('./edc/edc-types').EDCProcessPaymentParams
    ): Promise<import('./edc/edc-types').EDCProcessPaymentResponse> {
        // P0: Tolak pembayaran baru jika dalam status RECOVERY_REQUIRED
        if (this.state === 'RECOVERY_REQUIRED') {
            return {
                success: false,
                responseCode: 'RECOVERY_REQUIRED',
                message: 'Transaksi sebelumnya belum tuntas atau status ambigu (RECOVERY_REQUIRED). ' +
                    'Harap periksa struk fisik atau lakukan Inquiry/Reset Recovery sebelum melakukan pembayaran baru.'
            };
        }

        if (params.connectionType !== 'TCP_IP') {
            const configuredPath = params.portPath?.trim();
            const resolution = await this.resolvePortPath(configuredPath, this.savedDeviceIdentifier);

            if (resolution.ambiguous) {
                return {
                    success: false,
                    responseCode: 'AMBIGUOUS_PORT',
                    message: resolution.error || 'Ditemukan beberapa port serial. Harap pilih port secara manual di Pengaturan EDC.'
                };
            }

            if (resolution.resolvedPath) {
                if (configuredPath && resolution.resolvedPath !== normalizeSerialPortPath(configuredPath)) {
                    console.log(`[EDC Manager] Port USB EDC terdeteksi berpindah: ${configuredPath} -> ${resolution.resolvedPath}`);
                }
                params.portPath = resolution.resolvedPath;
            } else if (!configuredPath) {
                return {
                    success: false,
                    message: resolution.error || 'Port serial EDC belum dikonfigurasi.'
                };
            }
        }

        const lockResult = this.acquireOperationLock('PAYMENT');
        if ('error' in lockResult) {
            return {
                success: false,
                responseCode: 'EDC_BUSY',
                message: lockResult.error
            };
        }

        const { host } = lockResult;
        try {
            let res: import('./edc/edc-types').EDCProcessPaymentResponse;
            if (params.paymentType === 'QRIS') {
                res = await processQrisPayment(host, params);
            } else {
                res = await processDebitCreditPayment(host, params);
            }

            if (res.success && params.portPath) {
                await this.saveDeviceIdentityFromPort(params.portPath);
                this.setState('READY');
            }
            return res;
        } finally {
            host.cleanup();
        }
    }

    public async voidTransaction(
        params: import('./edc/edc-types').EDCVoidTransactionParams
    ): Promise<import('./edc/edc-types').EDCProcessPaymentResponse> {
        const configuredPath = params.portPath?.trim();
        const resolution = await this.resolvePortPath(configuredPath, this.savedDeviceIdentifier);
        if (resolution.resolvedPath) {
            params.portPath = resolution.resolvedPath;
        }

        const lockResult = this.acquireOperationLock('VOID');
        if ('error' in lockResult) {
            return { success: false, responseCode: 'EDC_BUSY', message: lockResult.error };
        }

        try {
            const res = await voidEdcTransaction(lockResult.host, params);
            if (res.success && params.portPath) {
                await this.saveDeviceIdentityFromPort(params.portPath);
                this.setState('READY');
            }
            return res;
        } finally {
            lockResult.host.cleanup();
        }
    }

    public async settleTransaction(
        params: import('./edc/edc-types').EdcSettleTransactionParams
    ): Promise<import('./edc/edc-types').EDCProcessPaymentResponse> {
        const configuredPath = params.portPath?.trim();
        const resolution = await this.resolvePortPath(configuredPath, this.savedDeviceIdentifier);
        if (resolution.resolvedPath) {
            params.portPath = resolution.resolvedPath;
        }

        const lockResult = this.acquireOperationLock('SETTLEMENT');
        if ('error' in lockResult) {
            return { success: false, responseCode: 'EDC_BUSY', message: lockResult.error };
        }

        try {
            const res = await settleEdcTransaction(lockResult.host, params);
            if (res.success && params.portPath) {
                await this.saveDeviceIdentityFromPort(params.portPath);
                this.setState('READY');
            }
            return res;
        } finally {
            lockResult.host.cleanup();
        }
    }

    public async inquiryQrisLastTransaction(
        params: EdcQrisInquiryParams
    ): Promise<import('./edc/edc-types').EDCProcessPaymentResponse> {
        if (params.connectionType !== 'TCP_IP' && params.portPath) {
            const resolution = await this.resolvePortPath(params.portPath, this.savedDeviceIdentifier);
            if (resolution.resolvedPath) {
                params.portPath = resolution.resolvedPath;
            }
        }

        const lockResult = this.acquireOperationLock('INQUIRY');
        if ('error' in lockResult) {
            return { success: false, responseCode: 'EDC_BUSY', message: lockResult.error };
        }

        try {
            const res = await inquiryQrisLastTransaction(lockResult.host, params);
            if (res.success) {
                if (this.state === 'RECOVERY_REQUIRED') {
                    this.recoveryInfo = null;
                }
                this.setState('READY');
            }
            return res;
        } finally {
            lockResult.host.cleanup();
        }
    }

    public async inquiryQrisAnyTransaction(
        params: EdcQrisAnyInquiryParams
    ): Promise<import('./edc/edc-types').EDCProcessPaymentResponse> {
        if (params.connectionType !== 'TCP_IP' && params.portPath) {
            const resolution = await this.resolvePortPath(params.portPath, this.savedDeviceIdentifier);
            if (resolution.resolvedPath) {
                params.portPath = resolution.resolvedPath;
            }
        }

        const lockResult = this.acquireOperationLock('INQUIRY');
        if ('error' in lockResult) {
            return { success: false, responseCode: 'EDC_BUSY', message: lockResult.error };
        }

        try {
            const res = await inquiryQrisAnyTransaction(lockResult.host, params);
            if (res.success) {
                if (this.state === 'RECOVERY_REQUIRED') {
                    this.recoveryInfo = null;
                }
                this.setState('READY');
            }
            return res;
        } finally {
            lockResult.host.cleanup();
        }
    }

    /** Test koneksi ke EDC tanpa memproses transaksi — handshake ENQ saja. */
    public async testConnection(
        params: import('./edc/edc-types').EdcTestConnectionParams
    ): Promise<import('./edc/edc-types').EdcTestConnectionResponse> {
        const timeoutMs = params.timeoutMs ?? 3000;

        if (params.connectionType === 'TCP_IP') {
            const ip = params.ipTerminal?.trim();
            const port = params.port;
            if (!ip || !port) {
                return { success: false, message: 'IP Terminal dan Port wajib untuk koneksi TCP/IP.' };
            }
            return this.testTcpConnection(ip, port, timeoutMs);
        }

        let configuredPath = params.portPath?.trim();
        const resolution = await this.resolvePortPath(configuredPath, this.savedDeviceIdentifier);
        if (resolution.ambiguous) {
            return {
                success: false,
                message: `Ditemukan beberapa perangkat serial (${resolution.candidatePaths.join(', ')}). Harap pilih port secara manual di Pengaturan EDC.`
            };
        }

        const portPath = resolution.resolvedPath || (configuredPath ? normalizeSerialPortPath(configuredPath) : null);
        if (!portPath) {
            return { success: false, message: resolution.error || 'Port serial wajib dipilih untuk koneksi SERIAL.' };
        }

        const lockResult = this.acquireOperationLock('TEST_CONNECTION');
        if ('error' in lockResult) {
            return { success: false, message: lockResult.error };
        }

        try {
            this.setState('CONNECTING');
            const res = await this.testSerialConnection(
                portPath,
                params.baudRate ?? getDefaultBaudRate(),
                timeoutMs,
                lockResult.host
            );

            let savedId: EdcDeviceIdentifier | null = null;
            if (res.success) {
                savedId = await this.saveDeviceIdentityFromPort(portPath);
                this.setState('READY');
            } else {
                this.setState('DISCONNECTED');
            }
            return {
                ...res,
                deviceIdentifier: savedId || undefined
            };
        } finally {
            lockResult.host.cleanup();
        }
    }

    private testTcpConnection(
        ip: string,
        port: number,
        timeoutMs: number
    ): Promise<import('./edc/edc-types').EdcTestConnectionResponse> {
        return new Promise(resolve => {
            let settled = false;
            const client = net.createConnection({ host: ip, port }, () => {
                client.write(Buffer.from([0x05]));
            });

            const finish = (result: import('./edc/edc-types').EdcTestConnectionResponse) => {
                if (settled) return;
                settled = true;
                try {
                    client.destroy();
                } catch (_) {}
                resolve(result);
            };

            client.setTimeout(timeoutMs);

            client.on('data', (data: Buffer) => {
                finish({
                    success: true,
                    message: 'POS berhasil terhubung ke EDC.',
                    terminalId: extractTerminalIdFromPayload(data)
                });
            });

            client.on('timeout', () => {
                finish({ success: false, message: `Timeout: Unable to connect to ${ip}:${port}` });
            });

            client.on('error', (err: Error) => {
                finish({ success: false, message: err.message || `Gagal koneksi ke ${ip}:${port}` });
            });

            client.on('close', () => {
                if (!settled) {
                    finish({ success: false, message: `Koneksi ditutup sebelum respons diterima (${ip}:${port})` });
                }
            });
        });
    }

    private testSerialConnection(
        portPath: string,
        baudRate: number,
        timeoutMs: number,
        host?: EdcSerialHost
    ): Promise<import('./edc/edc-types').EdcTestConnectionResponse> {
        return new Promise(resolve => {
            let settled = false;
            let port: SerialPort;

            const finish = (result: import('./edc/edc-types').EdcTestConnectionResponse) => {
                if (settled) return;
                settled = true;
                try {
                    if (port?.isOpen) port.close();
                } catch (_) {}
                resolve(result);
            };

            try {
                port = new this.serialPortClass({
                    path: portPath,
                    baudRate,
                    dataBits: 8,
                    parity: 'none',
                    stopBits: 1,
                    autoOpen: false
                });
                if (host) {
                    host.setActivePort(port);
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Gagal inisialisasi port serial';
                return finish({ success: false, message });
            }

            const timer = setTimeout(() => {
                finish({ success: false, message: `Timeout: Tidak ada respons dari port serial ${portPath}` });
            }, timeoutMs);

            port.on('data', (data: Buffer) => {
                clearTimeout(timer);
                finish({
                    success: true,
                    message: 'POS berhasil terhubung ke EDC.',
                    terminalId: extractTerminalIdFromPayload(data)
                });
            });

            port.on('error', (err: Error) => {
                clearTimeout(timer);
                finish({ success: false, message: `Serial error: ${err.message}` });
            });

            port.open(openErr => {
                if (openErr) {
                    clearTimeout(timer);
                    return finish({
                        success: false,
                        message: `Tidak dapat membuka port serial (${portPath}): ${openErr.message}`
                    });
                }

                try {
                    port.set({ dtr: true, rts: true });
                } catch (_) {}

                port.write(Buffer.from([0x05]));
            });
        });
    }
}

export const edcManager = EDCManager.getInstance();
