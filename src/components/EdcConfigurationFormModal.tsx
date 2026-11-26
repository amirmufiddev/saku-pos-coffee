// src/components/EdcConfigurationFormModal.tsx
import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  Network,
  Usb,
  X,
  RefreshCw,
  HelpCircle,
  Save,
  Check,
} from 'lucide-react';
import type {
  EdcConfiguration,
  EdcConnectionType,
} from '../types/edc-config';
import {
  EDC_BAUD_RATE_OPTIONS,
  EDC_DEFAULT_SERIAL_BAUD_RATE,
  EDC_DEFAULT_TCP_BAUD_RATE,
  EDC_DEFAULT_TCP_PORT,
  POPULAR_INDONESIAN_BANKS,
} from '../types/edc-config';
import { EdcService, type EdcSerialPortInfo } from '../services/edcService';

interface EdcConfigurationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: Partial<EdcConfiguration> & { name: string; connectionType: EdcConnectionType }) => void;
  editingConfig?: EdcConfiguration | null;
  existingCount: number;
}

export const EdcConfigurationFormModal: React.FC<EdcConfigurationFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingConfig,
  existingCount,
}) => {
  const [connectionType, setConnectionType] = useState<EdcConnectionType>('TCP_IP');
  const [name, setName] = useState('');
  const [bank, setBank] = useState('Danamon');
  const [customBank, setCustomBank] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  // TCP/IP Fields
  const [host, setHost] = useState('');
  const [ipPis, setIpPis] = useState('');
  const [ipTerminal, setIpTerminal] = useState('');
  const [port, setPort] = useState(EDC_DEFAULT_TCP_PORT);

  // Serial Fields
  const [portPath, setPortPath] = useState('');
  const [baudRate, setBaudRate] = useState<number>(EDC_DEFAULT_TCP_BAUD_RATE);

  // Ports detection
  const [availablePorts, setAvailablePorts] = useState<EdcSerialPortInfo[]>([]);
  const [scanningPorts, setScanningPorts] = useState(false);
  const [portScanNotice, setPortScanNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (editingConfig) {
        setConnectionType(editingConfig.connectionType);
        setName(editingConfig.name);
        if (editingConfig.bank && POPULAR_INDONESIAN_BANKS.includes(editingConfig.bank as any)) {
          setBank(editingConfig.bank);
          setCustomBank('');
        } else if (editingConfig.bank) {
          setBank('Other');
          setCustomBank(editingConfig.bank);
        } else {
          setBank('Danamon');
          setCustomBank('');
        }
        setIsDefault(editingConfig.isDefault);
        setHost(editingConfig.host || '');
        setIpPis(editingConfig.ipPis || '');
        setIpTerminal(editingConfig.ipTerminal || '');
        setPort(editingConfig.port || EDC_DEFAULT_TCP_PORT);
        setPortPath(editingConfig.portPath || '');
        setBaudRate(
          editingConfig.baudRate ||
            (editingConfig.connectionType === 'SERIAL'
              ? EDC_DEFAULT_SERIAL_BAUD_RATE
              : EDC_DEFAULT_TCP_BAUD_RATE)
        );
      } else {
        setConnectionType('TCP_IP');
        setName(`EDC Kasir #${existingCount + 1}`);
        setBank('Danamon');
        setCustomBank('');
        setIsDefault(existingCount === 0);
        setHost('');
        setIpPis('');
        setIpTerminal('192.168.1.100');
        setPort(EDC_DEFAULT_TCP_PORT);
        setPortPath('');
        setBaudRate(EDC_DEFAULT_TCP_BAUD_RATE);
      }
      handleScanPorts();
    }
  }, [isOpen, editingConfig, existingCount]);

  const handleScanPorts = async () => {
    setScanningPorts(true);
    setPortScanNotice(null);
    try {
      const ports = await EdcService.listPorts();
      setAvailablePorts(ports);
      if (ports.length === 0) {
        setPortScanNotice('Tidak ada port USB/Serial terdeteksi. Gunakan input manual atau koneksi TCP/IP.');
      } else if (!portPath && ports[0]) {
        setPortPath(ports[0].path);
      }
    } catch {
      setPortScanNotice('Gagal memindai port serial.');
    } finally {
      setScanningPorts(false);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Nama mesin EDC wajib diisi');
      return;
    }

    const finalBank = bank === 'Other' ? customBank.trim() || null : bank;

    if (connectionType === 'TCP_IP') {
      onSave({
        id: editingConfig?.id,
        name: name.trim(),
        bank: finalBank,
        connectionType: 'TCP_IP',
        host: host.trim() || null,
        ipPis: ipPis.trim() || null,
        ipTerminal: ipTerminal.trim() || null,
        port: Number(port) || EDC_DEFAULT_TCP_PORT,
        baudRate,
        isDefault,
        portPath: null,
      });
    } else {
      onSave({
        id: editingConfig?.id,
        name: name.trim(),
        bank: finalBank,
        connectionType: 'SERIAL',
        portPath: portPath.trim() || null,
        baudRate: Number(baudRate) || EDC_DEFAULT_SERIAL_BAUD_RATE,
        isDefault,
        host: null,
        ipPis: null,
        ipTerminal: null,
        port: null,
      });
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-800 text-white flex items-center justify-center shadow-xs">
              <CreditCard size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">
                {editingConfig ? 'Edit Konfigurasi EDC' : 'Tambah Mesin EDC Baru'}
              </h2>
              <p className="text-xs text-slate-500">
                Integrasi protokol ECR Ingenico (TCP/IP Ethernet & Serial USB)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Connection Type Switcher */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Tipe Koneksi Perangkat
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setConnectionType('TCP_IP')}
                className={`p-3.5 rounded-2xl border-2 flex items-center gap-3 transition cursor-pointer ${
                  connectionType === 'TCP_IP'
                    ? 'border-emerald-600 bg-emerald-50/60 text-emerald-950 font-bold shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 text-slate-600 bg-white'
                }`}
              >
                <div className={`p-2 rounded-xl ${connectionType === 'TCP_IP' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  <Network size={18} />
                </div>
                <div className="text-left leading-tight">
                  <div className="text-xs font-bold">TCP / IP (LAN)</div>
                  <div className="text-[10px] text-slate-500">Ethernet / Wi-Fi POS</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setConnectionType('SERIAL')}
                className={`p-3.5 rounded-2xl border-2 flex items-center gap-3 transition cursor-pointer ${
                  connectionType === 'SERIAL'
                    ? 'border-emerald-600 bg-emerald-50/60 text-emerald-950 font-bold shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 text-slate-600 bg-white'
                }`}
              >
                <div className={`p-2 rounded-xl ${connectionType === 'SERIAL' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  <Usb size={18} />
                </div>
                <div className="text-left leading-tight">
                  <div className="text-xs font-bold">Serial USB / COM</div>
                  <div className="text-[10px] text-slate-500">RS-232 Direct Cable</div>
                </div>
              </button>
            </div>
          </div>

          {/* Name & Bank */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Nama Label EDC <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Contoh: EDC Danamon Utama"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-200 bg-slate-50 focus:bg-white transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Bank Acquirer
              </label>
              <select
                value={bank}
                onChange={e => setBank(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-emerald-600 bg-slate-50 focus:bg-white transition"
              >
                {POPULAR_INDONESIAN_BANKS.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
                <option value="Other">Bank Lainnya...</option>
              </select>
            </div>
          </div>

          {bank === 'Other' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Nama Bank Kustom
              </label>
              <input
                type="text"
                value={customBank}
                onChange={e => setCustomBank(e.target.value)}
                placeholder="Masukkan nama institusi bank"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-emerald-600 bg-slate-50 focus:bg-white"
              />
            </div>
          )}

          {/* TCP / IP Fields */}
          {connectionType === 'TCP_IP' && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <Network size={15} className="text-emerald-700" />
                <span>Parameter Jaringan Ethernet EDC</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    IP Terminal EDC (Wajib)
                  </label>
                  <input
                    type="text"
                    value={ipTerminal}
                    onChange={e => setIpTerminal(e.target.value)}
                    placeholder="192.168.1.100"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono bg-white focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Port TCP (Default: 2001)
                  </label>
                  <input
                    type="number"
                    value={port}
                    onChange={e => setPort(Number(e.target.value))}
                    placeholder="2001"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono bg-white focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Host / DNS Name (Opsional)
                </label>
                <input
                  type="text"
                  value={host}
                  onChange={e => setHost(e.target.value)}
                  placeholder="edc-counter-01.local"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono bg-white focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>
          )}

          {/* Serial USB Fields */}
          {connectionType === 'SERIAL' && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <Usb size={15} className="text-emerald-700" />
                  <span>Port Serial / USB Virtual COM</span>
                </div>
                <button
                  type="button"
                  onClick={handleScanPorts}
                  disabled={scanningPorts}
                  className="text-xs font-bold text-emerald-800 hover:text-emerald-900 flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw size={13} className={scanningPorts ? 'animate-spin' : ''} />
                  <span>Pindai Port</span>
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Pilih Jalur Port COM / TTY
                </label>
                {availablePorts.length > 0 ? (
                  <select
                    value={portPath}
                    onChange={e => setPortPath(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono bg-white focus:outline-none focus:border-emerald-600"
                  >
                    {availablePorts.map(p => (
                      <option key={p.path} value={p.path}>
                        {p.path} {p.manufacturer ? `(${p.manufacturer})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={portPath}
                    onChange={e => setPortPath(e.target.value)}
                    placeholder="Contoh: /dev/tty.usbserial-110 atau COM3"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono bg-white focus:outline-none focus:border-emerald-600"
                  />
                )}
                {portScanNotice && (
                  <p className="text-[11px] text-amber-700 mt-1 font-medium">{portScanNotice}</p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Baud Rate (Default: 115200)
                </label>
                <select
                  value={baudRate}
                  onChange={e => setBaudRate(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono bg-white focus:outline-none focus:border-emerald-600"
                >
                  {EDC_BAUD_RATE_OPTIONS.map(br => (
                    <option key={br} value={br}>{br} bps</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Is Default Checkbox */}
          <label className="flex items-center gap-3 p-3.5 rounded-2xl bg-emerald-50/50 border border-emerald-200/80 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={e => setIsDefault(e.target.checked)}
              className="w-4 h-4 text-emerald-700 rounded border-slate-300 focus:ring-emerald-500"
            />
            <div className="text-xs">
              <span className="font-bold text-slate-900 block">Jadikan Mesin EDC Utama (Default)</span>
              <span className="text-[11px] text-slate-500">
                Otomatis dipilih saat kasir memproses transaksi Debit / Kredit / QRIS EDC
              </span>
            </div>
          </label>
        </form>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs transition cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-5 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-2 shadow-xs transition cursor-pointer"
          >
            <Save size={15} />
            <span>Simpan Konfigurasi</span>
          </button>
        </div>
      </div>
    </div>
  );
};
