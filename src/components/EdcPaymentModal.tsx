import React, { useState, useEffect, useRef } from 'react';
import {
  CreditCard,
  QrCode,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  X,
  Building,
  Wifi,
  Usb,
  ArrowRight,
  ShieldCheck,
  Smartphone,
  Search,
} from 'lucide-react';
import { edcStorage } from '../services/edcStorage';
import { api } from '../services/api';
import { EdcService, EdcProcessPaymentResult, EdcSerialPortInfo } from '../services/edcService';
import type { EdcConfiguration, EdcPaymentType } from '../types/edc-config';
import {
  EDC_DEFAULT_SERIAL_BAUD_RATE,
  formatEdcConnectionLabel,
  mapEdcConfigToPaymentParams,
  validateEdcConfigForPayment,
} from '../types/edc-config';

interface EdcPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount: number;
  initialPaymentType?: EdcPaymentType;
  invoiceNumber?: string;
  customerName?: string;
  title?: string;
  subtitle?: string;
  onPaymentSuccess: (
    result: EdcProcessPaymentResult,
    edcConfig: EdcConfiguration,
    paymentType?: EdcPaymentType,
  ) => void | Promise<void>;
  onManualBypass?: () => void;
}

type EdcFlowState = 'IDLE' | 'PROCESSING' | 'SUCCESS' | 'FAILED';

export const EdcPaymentModal: React.FC<EdcPaymentModalProps> = ({
  isOpen,
  onClose,
  amount,
  initialPaymentType = 'DEBIT',
  invoiceNumber,
  customerName,
  title,
  subtitle,
  onPaymentSuccess,
  onManualBypass,
}) => {
  const [configs, setConfigs] = useState<EdcConfiguration[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [availableUsbPorts, setAvailableUsbPorts] = useState<EdcSerialPortInfo[]>([]);
  const [selectedPortPath, setSelectedPortPath] = useState<string>('');
  const [isScanningPorts, setIsScanningPorts] = useState<boolean>(false);
  const [portScanNotice, setPortScanNotice] = useState<string | null>(null);
  const [showManualPortInput, setShowManualPortInput] = useState<boolean>(false);
  const [manualPortPath, setManualPortPath] = useState<string>('');

  const [paymentType, setPaymentType] = useState<EdcPaymentType>(initialPaymentType);
  const [flowState, setFlowState] = useState<EdcFlowState>('IDLE');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [paymentResult, setPaymentResult] = useState<EdcProcessPaymentResult | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  const timerRef = useRef<any>(null);
  const isCancelledRef = useRef<boolean>(false);
  const hasFinalizedRef = useRef<boolean>(false);

  // Scan USB Ports from hardware/Electron
  const scanUsbPorts = async (currentSavedConfigs?: EdcConfiguration[]) => {
    setIsScanningPorts(true);
    setPortScanNotice(null);
    try {
      const ports = await EdcService.listPorts();
      setAvailableUsbPorts(ports);

      const activeConfigs = currentSavedConfigs || configs;

      const preferred = activeConfigs.find((c) => c.isDefault) || activeConfigs[0];
      if (preferred) {
        setSelectedConfigId(preferred.id);
        if (preferred.connectionType === 'SERIAL' && preferred.portPath) {
          setSelectedPortPath(preferred.portPath);
        }
      } else if (ports.length > 0) {
        const usbCandidate =
          ports.find(
            (p) =>
              p.path.toLowerCase().includes('usb') ||
              p.manufacturer.toLowerCase().includes('usb') ||
              p.path.includes('/cu.') ||
              p.path.toUpperCase().startsWith('COM')
          ) || ports[0];
        setSelectedPortPath(usbCandidate.path);
      } else {
        setSelectedPortPath('');
        setPortScanNotice(
          'Tidak ada port USB serial terdeteksi. Pastikan kabel USB mesin EDC telah terpasang ke komputer.'
        );
      }
    } catch (err: any) {
      console.warn('[EdcPaymentModal] Gagal memindai port USB:', err);
      setPortScanNotice('Gagal memindai port USB dari sistem.');
    } finally {
      setIsScanningPorts(false);
    }
  };

  // Load configs and scan USB ports on open
  useEffect(() => {
    if (isOpen) {
      const allConfigs = edcStorage.getEdcConfigurations();
      const activeConfigs = allConfigs.filter((c) => c.isActive !== false);
      setConfigs(activeConfigs);

      const defaultCfg = activeConfigs.find((c) => c.isDefault) || activeConfigs[0];
      if (defaultCfg) {
        setSelectedConfigId(defaultCfg.id);
        if (defaultCfg.connectionType === 'SERIAL' && defaultCfg.portPath) {
          setSelectedPortPath(defaultCfg.portPath);
        }
      }

      setPaymentType(initialPaymentType);
      setFlowState('IDLE');
      setStatusMessage('');
      setPaymentResult(null);
      setElapsedSeconds(0);
      setShowManualPortInput(false);
      setManualPortPath('');
      isCancelledRef.current = false;

      // Scan live USB ports
      scanUsbPorts(activeConfigs);

      // Check if system requires recovery from an ambiguous previous transaction
      EdcService.getStatus()
        .then((status) => {
          if (status.state === 'RECOVERY_REQUIRED') {
            setFlowState('FAILED');
            setPaymentResult({
              success: false,
              responseCode: 'RECOVERY_REQUIRED',
              message: status.recovery?.reason || 'Status transaksi sebelumnya masih ambigu (RECOVERY_REQUIRED).',
            });
            setStatusMessage(
              status.recovery?.reason ||
                'Transaksi sebelumnya belum tuntas atau status ambigu. Lakukan verifikasi sebelum melanjutkan.'
            );
          }
        })
        .catch(() => {});
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      isCancelledRef.current = true;
    }
  }, [isOpen, initialPaymentType]);

  // Elapsed timer when PROCESSING
  useEffect(() => {
    if (flowState === 'PROCESSING') {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [flowState]);

  // Resolve active EDC configuration based on live USB port or saved config
  const savedConfig = configs.find((c) => c.id === selectedConfigId);
  const effectivePortPath = selectedPortPath || manualPortPath.trim();

  const effectiveConfig: EdcConfiguration | null = savedConfig
    ? {
        ...savedConfig,
        portPath:
          savedConfig.connectionType === 'SERIAL' && effectivePortPath
            ? effectivePortPath
            : savedConfig.portPath,
      }
    : effectivePortPath
    ? {
        id: `USB-${effectivePortPath}`,
        name: `Mesin EDC (Port USB: ${effectivePortPath})`,
        bank: 'Danamon',
        connectionType: 'SERIAL',
        host: null,
        ipPis: null,
        ipTerminal: null,
        port: null,
        baudRate: EDC_DEFAULT_SERIAL_BAUD_RATE,
        portPath: effectivePortPath,
        isDefault: true,
        terminalId: null,
        lastTestStatus: null,
        lastTestedAt: null,
        lastTestError: null,
        isActive: true,
      }
    : null;

  const isTcpConnection = effectiveConfig?.connectionType === 'TCP_IP';

  if (!isOpen) return null;

  const handleSendToEdc = async () => {
    if (!effectiveConfig) {
      setFlowState('FAILED');
      setStatusMessage('Konfigurasi EDC belum dipilih. Tambahkan mesin EDC di Pengaturan.');
      return;
    }

    const configError = validateEdcConfigForPayment(effectiveConfig);
    if (configError) {
      setFlowState('FAILED');
      setStatusMessage(configError);
      return;
    }

    if (amount <= 0) {
      setFlowState('FAILED');
      setStatusMessage('Nominal transaksi harus lebih dari 0.');
      return;
    }

    isCancelledRef.current = false;
    hasFinalizedRef.current = false;
    setFlowState('PROCESSING');
    const endpointLabel = formatEdcConnectionLabel(effectiveConfig);
    setStatusMessage(
      paymentType === 'QRIS'
        ? `Mengirim transaksi QRIS ke mesin EDC via ${endpointLabel}... Minta pelanggan scan QR di layar mesin EDC.`
        : `Menghubungkan ke mesin EDC via ${endpointLabel}... Silakan gesek, colok (chip), atau tap kartu pelanggan pada mesin EDC.`
    );

    const paymentInput = mapEdcConfigToPaymentParams(effectiveConfig, amount, paymentType);

    try {
      const result = await EdcService.processPayment(paymentInput);

      if (isCancelledRef.current) return;

      if (result.success) {
        setFlowState('SUCCESS');
        setPaymentResult(result);
        setStatusMessage(result.message || 'Transaksi EDC Berhasil Disetujui!');

        if (savedConfig) {
          const testedAt = new Date().toISOString();
          edcStorage.updateEdcTestResult(savedConfig.id, {
            lastTestStatus: 'CONNECTED',
            lastTestedAt: testedAt,
            terminalId: result.terminalId || savedConfig.terminalId || undefined,
          });
          void api
            .updateEdcTestResult(savedConfig.id, {
              lastTestStatus: 'CONNECTED',
              lastTestedAt: testedAt,
              terminalId: result.terminalId || savedConfig.terminalId || null,
            })
            .catch(() => {});
        }

        // Auto-finalize after 1.8 seconds
        setTimeout(() => {
          if (!isCancelledRef.current && !hasFinalizedRef.current) {
            hasFinalizedRef.current = true;
            void Promise.resolve(onPaymentSuccess(result, effectiveConfig, paymentType));
          }
        }, 1800);
      } else {
        setFlowState('FAILED');
        setPaymentResult(result);
        setStatusMessage(result.message || 'Transaksi EDC ditolak atau gagal.');
      }
    } catch (err: any) {
      if (isCancelledRef.current) return;
      setFlowState('FAILED');
      setStatusMessage(err?.message || 'Terjadi kesalahan komunikasi dengan port USB mesin EDC.');
    }
  };

  const handleCancel = () => {
    isCancelledRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    setFlowState('IDLE');
    onClose();
  };

  const handleManualBypass = () => {
    if (confirm('Apakah Anda yakin ingin memproses transaksi ini secara manual tanpa melalui EDC?')) {
      isCancelledRef.current = true;
      if (onManualBypass) {
        onManualBypass();
      } else {
        const fallbackResult: EdcProcessPaymentResult = {
          success: true,
          approvalCode: 'MANUAL',
          message: 'Transaksi diselesaikan secara manual oleh kasir (Bypass EDC).',
        };
        void Promise.resolve(
          onPaymentSuccess(fallbackResult, effectiveConfig || ({} as EdcConfiguration), paymentType)
        );
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl text-white flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30">
              {paymentType === 'QRIS' ? (
                <QrCode className="w-5 h-5 text-white" />
              ) : (
                <CreditCard className="w-5 h-5 text-white" />
              )}
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight flex items-center gap-2">
                <span>
                  {title || (paymentType === 'QRIS' ? 'Pembayaran QRIS EDC' : 'Pembayaran Kartu EDC')}
                </span>
                <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-full bg-white/20 text-white border border-white/30">
                  {paymentType}
                </span>
              </h3>
              <p className="text-xs text-emerald-100 font-medium mt-0.5">
                {subtitle || (invoiceNumber ? `Invoice #${invoiceNumber}` : 'Integrasi ECR EDC Ingenico')}
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="w-8 h-8 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {/* Amount Display */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 font-medium block">Total Pembayaran</span>
              <span className="text-2xl font-black font-mono tracking-tight text-emerald-400">
                Rp {amount.toLocaleString('id-ID')}
              </span>
            </div>
            {customerName && (
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block">Pelanggan</span>
                <span className="text-xs font-bold text-slate-200">{customerName}</span>
              </div>
            )}
          </div>

          {/* Koneksi sesuai konfigurasi tersimpan: TCP/IP atau Serial/USB */}
          <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                {isTcpConnection ? (
                  <Wifi className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Usb className="w-4 h-4 text-emerald-400" />
                )}
                <span>{isTcpConnection ? 'Koneksi TCP/IP EDC' : 'Koneksi Port USB EDC'}</span>
              </label>
              {!isTcpConnection && (
                <button
                  type="button"
                  disabled={isScanningPorts || flowState === 'PROCESSING'}
                  onClick={() => scanUsbPorts()}
                  className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition disabled:opacity-50 cursor-pointer"
                  title="Pindai ulang port USB yang terhubung"
                >
                  <RefreshCw className={`w-3 h-3 ${isScanningPorts ? 'animate-spin' : ''}`} />
                  <span>{isScanningPorts ? 'Memindai USB...' : 'Pindai Ulang'}</span>
                </button>
              )}
            </div>

            {isTcpConnection && effectiveConfig ? (
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-300">
                <div className="rounded-lg bg-slate-900 px-2.5 py-2">
                  <span className="block text-[10px] text-slate-500">Host</span>
                  {effectiveConfig.host || '-'}
                </div>
                <div className="rounded-lg bg-slate-900 px-2.5 py-2">
                  <span className="block text-[10px] text-slate-500">IP PIS</span>
                  {effectiveConfig.ipPis || '-'}
                </div>
                <div className="rounded-lg bg-slate-900 px-2.5 py-2">
                  <span className="block text-[10px] text-slate-500">IP Terminal</span>
                  {effectiveConfig.ipTerminal || '-'}:{effectiveConfig.port || '-'}
                </div>
                <div className="rounded-lg bg-slate-900 px-2.5 py-2">
                  <span className="block text-[10px] text-slate-500">Baud Rate</span>
                  {effectiveConfig.baudRate}
                </div>
              </div>
            ) : (
              <>
                {/* List of Detected USB Ports */}
                {isScanningPorts ? (
                  <div className="py-2 px-3 bg-slate-900/60 rounded-xl flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    <span>Mendeteksi port USB serial di sistem...</span>
                  </div>
                ) : availableUsbPorts.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedPortPath}
                        disabled={flowState === 'PROCESSING'}
                        onChange={(e) => {
                          setSelectedPortPath(e.target.value);
                          setShowManualPortInput(false);
                        }}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono font-semibold focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                      >
                        {availableUsbPorts.map((p) => (
                          <option key={p.path} value={p.path}>
                            {p.path} {p.manufacturer ? `(${p.manufacturer})` : ''}
                          </option>
                        ))}
                      </select>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-bold text-emerald-400 shrink-0">
                        <CheckCircle className="w-3 h-3" />
                        <span>Terhubung</span>
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 flex items-center justify-between px-1">
                      <span>
                        Port aktif: <strong className="text-slate-200 font-mono">{selectedPortPath}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowManualPortInput(!showManualPortInput)}
                        className="text-slate-400 hover:text-slate-300 underline cursor-pointer"
                      >
                        {showManualPortInput ? 'Tutup Input Manual' : 'Ketik Manual'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl space-y-2 text-xs">
                    <div className="flex items-start gap-2 text-amber-300">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                      <div className="leading-snug">
                        <strong className="block font-bold">Port USB EDC Belum Terdeteksi</strong>
                        <span className="text-[11px] text-amber-200/90">
                          Colokkan kabel USB mesin EDC ke port komputer/POS ini, lalu tekan tombol{' '}
                          <strong>Pindai Ulang</strong>.
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => scanUsbPorts()}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Pindai Ulang Port USB</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowManualPortInput(!showManualPortInput)}
                        className="text-[11px] text-amber-300 hover:text-amber-200 underline font-semibold cursor-pointer"
                      >
                        {showManualPortInput ? 'Sembunyikan' : 'Ketik Port Manual'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Optional Manual Port Input */}
                {showManualPortInput && (
                  <div className="p-2.5 bg-slate-900/90 border border-slate-700 rounded-xl space-y-1 animate-in fade-in duration-150">
                    <label className="text-[10px] font-semibold text-slate-400">
                      Nama Port USB Serial Manual (misal: COM3, /dev/cu.usbserial-10)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={manualPortPath}
                        onChange={(e) => setManualPortPath(e.target.value)}
                        placeholder="COM3 atau /dev/cu.usbserial-..."
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (manualPortPath.trim()) {
                            setSelectedPortPath(manualPortPath.trim());
                          }
                        }}
                        className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-lg transition cursor-pointer"
                      >
                        Terapkan
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Machine & Payment Type Switcher */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* EDC Machine Config Info */}
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-emerald-400" />
                <span>Profil EDC</span>
              </label>
              {configs.length > 1 ? (
                <select
                  value={selectedConfigId}
                  disabled={flowState === 'PROCESSING'}
                  onChange={(e) => {
                    const next = configs.find((item) => item.id === e.target.value);
                    setSelectedConfigId(e.target.value);
                    if (next?.connectionType === 'SERIAL' && next.portPath) {
                      setSelectedPortPath(next.portPath);
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white font-semibold focus:outline-none focus:border-emerald-500"
                >
                  {configs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.isDefault ? ' (Default)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="font-semibold text-slate-200 flex items-center gap-1.5 truncate">
                  {isTcpConnection ? (
                    <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Usb className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  )}
                  <span className="truncate">{effectiveConfig?.name || 'Mesin EDC'}</span>
                </div>
              )}
              <div className="text-[10px] text-slate-400 font-mono">
                {effectiveConfig
                  ? `${effectiveConfig.connectionType} · ${formatEdcConnectionLabel(effectiveConfig)} · ${
                      effectiveConfig.baudRate
                    } bps`
                  : 'Belum ada konfigurasi EDC'}
              </div>
            </div>

            {/* Payment Type Switcher (Card: Debit vs Credit, QRIS) */}
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Metode EDC</span>
              </label>
              {paymentType === 'QRIS' ? (
                <div className="flex items-center justify-between text-emerald-400 font-bold">
                  <span>QRIS Dinamis (Mesin EDC)</span>
                  <span className="text-[10px] text-emerald-500 font-mono">Tampil di Layar EDC</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={flowState === 'PROCESSING'}
                    onClick={() => setPaymentType('DEBIT')}
                    className={`flex-1 py-1 px-2 rounded-lg font-bold text-[11px] transition text-center cursor-pointer ${
                      paymentType === 'DEBIT'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Debit Card
                  </button>
                  <button
                    type="button"
                    disabled={flowState === 'PROCESSING'}
                    onClick={() => setPaymentType('CREDIT')}
                    className={`flex-1 py-1 px-2 rounded-lg font-bold text-[11px] transition text-center cursor-pointer ${
                      paymentType === 'CREDIT'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Credit Card
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Flow Status Area */}
          {flowState === 'IDLE' && (
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                {paymentType === 'QRIS' ? (
                  <QrCode className="w-6 h-6 animate-pulse" />
                ) : (
                  <CreditCard className="w-6 h-6 animate-pulse" />
                )}
              </div>
              <p className="text-xs text-slate-300">
                {effectivePortPath ? (
                  <>
                    Siap mengirim nominal <strong className="text-white">Rp {amount.toLocaleString('id-ID')}</strong> ke
                    mesin EDC pada port <code className="text-emerald-400 font-mono">{effectivePortPath}</code>.
                  </>
                ) : (
                  <span className="text-amber-300">
                    Port USB EDC belum terhubung. Silakan hubungkan kabel USB mesin EDC ke komputer untuk melanjutkan.
                  </span>
                )}
              </p>
              <button
                type="button"
                disabled={!effectivePortPath || isScanningPorts}
                onClick={handleSendToEdc}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed active:scale-[0.99] font-bold text-sm text-white rounded-xl shadow-lg shadow-emerald-900/30 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Mulai Transaksi di EDC</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {flowState === 'PROCESSING' && (
            <div className="p-6 bg-slate-950 border border-emerald-500/30 rounded-2xl text-center space-y-4 relative overflow-hidden">
              <div className="absolute top-3 right-3 text-[11px] font-mono text-slate-400">
                {elapsedSeconds}s
              </div>
              <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping opacity-75" />
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/40 flex items-center justify-center relative z-10 text-emerald-400">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              </div>
              <div className="space-y-1.5">
                <h4 className="font-bold text-sm text-emerald-400">
                  {paymentType === 'QRIS'
                    ? 'Menunggu Pelanggan Scan QRIS di Mesin EDC'
                    : 'Menunggu Transaksi Kartu di Mesin EDC'}
                </h4>
                <p className="text-xs text-slate-300 max-w-sm mx-auto leading-relaxed">
                  {paymentType === 'QRIS'
                    ? 'Mesin EDC sedang menampilkan QRIS. Minta pelanggan scan menggunakan aplikasi BCA, Gopay, OVO, ShopeePay, atau m-Banking.'
                    : 'Silakan minta pelanggan gesek (swipe), colokkan (dip), atau tap kartu pada mesin EDC dan masukkan PIN jika diminta.'}
                </p>
              </div>

              <div className="pt-2 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleManualBypass}
                  className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 font-semibold text-xs rounded-xl transition cursor-pointer"
                >
                  Bypass / Bayar Manual
                </button>
              </div>
            </div>
          )}

          {flowState === 'SUCCESS' && paymentResult && (
            <div className="p-5 bg-emerald-950/30 border border-emerald-500/40 rounded-2xl text-center space-y-3 animate-in zoom-in-95 duration-200">
              <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/30">
                <CheckCircle className="w-7 h-7" />
              </div>
              <div>
                <h4 className="font-bold text-base text-emerald-300">Transaksi EDC Berhasil!</h4>
                <p className="text-xs text-emerald-400/80 font-medium">
                  Pembayaran telah diverifikasi oleh mesin EDC.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-left bg-slate-950/80 p-3 rounded-xl border border-emerald-900/40 text-[11px] font-mono">
                {paymentResult.approvalCode && (
                  <div>
                    <span className="text-slate-400 block text-[10px]">Appr Code:</span>
                    <span className="text-emerald-300 font-bold">{paymentResult.approvalCode}</span>
                  </div>
                )}
                {paymentResult.referenceNumber && (
                  <div>
                    <span className="text-slate-400 block text-[10px]">RRN:</span>
                    <span className="text-slate-200">{paymentResult.referenceNumber}</span>
                  </div>
                )}
                {paymentResult.maskedCardNo && (
                  <div>
                    <span className="text-slate-400 block text-[10px]">Nomor Kartu:</span>
                    <span className="text-slate-200">{paymentResult.maskedCardNo}</span>
                  </div>
                )}
                {paymentResult.issuerName && (
                  <div>
                    <span className="text-slate-400 block text-[10px]">Bank / Issuer:</span>
                    <span className="text-slate-200">{paymentResult.issuerName}</span>
                  </div>
                )}
                {paymentResult.terminalId && (
                  <div>
                    <span className="text-slate-400 block text-[10px]">Terminal ID:</span>
                    <span className="text-slate-200">{paymentResult.terminalId}</span>
                  </div>
                )}
                {paymentResult.batchNumber && (
                  <div>
                    <span className="text-slate-400 block text-[10px]">Batch No:</span>
                    <span className="text-slate-200">{paymentResult.batchNumber}</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={hasFinalizedRef.current}
                onClick={() => {
                  if (hasFinalizedRef.current) return;
                  hasFinalizedRef.current = true;
                  void Promise.resolve(onPaymentSuccess(paymentResult, effectiveConfig!, paymentType));
                }}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-xs text-white rounded-xl shadow-md transition cursor-pointer"
              >
                Selesai & Lanjutkan
              </button>
            </div>
          )}

          {flowState === 'FAILED' && (
            <div className="p-5 bg-rose-950/30 border border-rose-500/40 rounded-2xl text-center space-y-3 animate-in shake duration-200">
              <div className="w-12 h-12 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto">
                <AlertCircle className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-sm text-rose-300">
                  {paymentResult?.responseCode === 'RECOVERY_REQUIRED'
                    ? 'Perlu Verifikasi (Recovery Required)'
                    : 'Transaksi Gagal di EDC'}
                </h4>
                <p className="text-xs text-rose-200/90 leading-relaxed">{statusMessage}</p>
              </div>

              {paymentResult?.responseCode === 'RECOVERY_REQUIRED' ? (
                <div className="pt-2 flex flex-col gap-2">
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-[11px] text-left">
                    ⚠️ <strong>Status Transaksi Ambigu (RECOVERY REQUIRED):</strong>
                    <br />
                    Koneksi serial terputus setelah permintaan transaksi terkirim ke terminal EDC. Untuk mencegah{' '}
                    <em>double charge</em> (pelanggan terpotong dua kali), pilih salah satu prosedur rekonsiliasi di
                    bawah ini:
                  </div>
                  <div className="flex flex-col gap-2">
                    {effectiveConfig && (
                      <button
                        type="button"
                        onClick={async () => {
                          setStatusMessage('Menghubungi terminal EDC untuk inquiry status transaksi terakhir...');
                          try {
                            const inqRes = await EdcService.inquiryQrisLastTransaction({
                              connectionType: effectiveConfig.connectionType,
                              portPath: effectiveConfig.portPath || undefined,
                              baudRate: effectiveConfig.baudRate,
                            });
                            if (inqRes.success && inqRes.responseCode === '00') {
                              setFlowState('SUCCESS');
                              setPaymentResult(inqRes);
                              setStatusMessage('Transaksi terverifikasi BERHASIL melalui inquiry EDC!');
                            } else {
                              setStatusMessage(
                                `Hasil Inquiry: ${
                                  inqRes.message || 'Transaksi tidak ditemukan atau gagal di terminal.'
                                }`
                              );
                            }
                          } catch (err: any) {
                            setStatusMessage(`Gagal inquiry EDC: ${err?.message || 'Terminal tidak merespons'}`);
                          }
                        }}
                        className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 font-bold text-xs text-white rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>1. Jalankan Inquiry Status EDC (Rekomendasi)</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        const confirmed = window.confirm(
                          'KONFIRMASI REKONSILIASI FISIK EDC:\n\n' +
                            'Apakah Anda sudah memeriksa fisik mesin EDC dan memastikan:\n' +
                            '1. Roll kertas TIDAK mengeluarkan struk approved,\n' +
                            '2. Layar mesin EDC tidak menampilkan transaksi berhasil,\n' +
                            '3. Saldo/kartu nasabah belum terdebet?\n\n' +
                            'Klik OK hanya jika fisik EDC telah dipastikan nihil/batal.'
                        );
                        if (!confirmed) return;

                        const resetRes = await EdcService.resetRecovery(
                          'Diverifikasi fisik: kasir memastikan tidak ada struk keluar di mesin EDC',
                          'PHYSICAL_SLIP_VERIFIED'
                        );
                        if (resetRes.success) {
                          setPaymentResult(null);
                          setFlowState('IDLE');
                          setStatusMessage('Status ambigu telah direkonsiliasi secara manual. Pembayaran dapat diulang.');
                        } else {
                          alert(resetRes.message);
                        }
                      }}
                      className="w-full py-2 bg-amber-600 hover:bg-amber-500 font-bold text-xs text-white rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>2. Verifikasi Struk Kertas Fisik (Nihil) & Reset</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleManualBypass}
                      className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 font-semibold text-xs text-slate-300 rounded-xl transition cursor-pointer"
                    >
                      3. Selesaikan Manual (Bypass EDC)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pt-2 flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={handleSendToEdc}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Coba Lagi di EDC</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleManualBypass}
                    className="flex-1 py-2.5 bg-amber-600/30 hover:bg-amber-600/40 border border-amber-500/40 font-bold text-xs text-amber-200 rounded-xl transition cursor-pointer"
                  >
                    Selesaikan Manual
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>Protokol ECR Ingenico (Danamon / BCA / Mandiri)</span>
          <button
            type="button"
            onClick={handleManualBypass}
            className="text-[11px] text-slate-400 hover:text-amber-400 transition underline cursor-pointer"
          >
            Bypass / Proses Tanpa EDC
          </button>
        </div>
      </div>
    </div>
  );
};
