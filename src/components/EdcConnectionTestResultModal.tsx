// src/components/EdcConnectionTestResultModal.tsx
import React from 'react';
import { CheckCircle2, XCircle, X, ShieldCheck, Terminal, Network, Usb } from 'lucide-react';
import type { EdcConfiguration } from '../types/edc-config';

interface EdcConnectionTestResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  success: boolean;
  message: string;
  config?: EdcConfiguration | null;
  errorDetail?: string;
  terminalId?: string;
}

export const EdcConnectionTestResultModal: React.FC<EdcConnectionTestResultModalProps> = ({
  isOpen,
  onClose,
  success,
  message,
  config,
  errorDetail,
  terminalId,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className={success ? 'text-emerald-700' : 'text-rose-600'} />
            <h3 className="text-sm font-black text-slate-800">
              Hasil Tes Koneksi EDC Kasir
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col items-center text-center">
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-3 shadow-inner ${
              success
                ? 'bg-emerald-100 text-emerald-700 ring-4 ring-emerald-50'
                : 'bg-rose-100 text-rose-600 ring-4 ring-rose-50'
            }`}
          >
            {success ? <CheckCircle2 size={32} /> : <XCircle size={32} />}
          </div>

          <h4
            className={`text-base font-black ${
              success ? 'text-emerald-800' : 'text-rose-700'
            }`}
          >
            {success ? 'Handshake EDC Terhubung!' : 'Koneksi Mesin EDC Gagal'}
          </h4>
          <p className="text-xs text-slate-600 mt-1 max-w-sm">
            {message}
          </p>

          {/* Details Table */}
          <div className="mt-5 w-full text-left bg-slate-50 rounded-2xl p-4 border border-slate-200 text-xs space-y-2.5">
            <div className="flex justify-between items-center text-slate-500">
              <span>Nama Mesin:</span>
              <span className="font-bold text-slate-900">
                {config?.name || '-'}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-500">
              <span>Bank Acquirer:</span>
              <span className="font-bold text-slate-900">
                {config?.bank || 'Umum'}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-500">
              <span>Tipe Koneksi:</span>
              <span className="font-mono font-semibold text-slate-800 flex items-center gap-1">
                {config?.connectionType === 'TCP_IP' ? (
                  <>
                    <Network size={13} className="text-emerald-700" />
                    <span>TCP / IP Ethernet</span>
                  </>
                ) : (
                  <>
                    <Usb size={13} className="text-purple-700" />
                    <span>Serial USB (COM)</span>
                  </>
                )}
              </span>
            </div>
            {config?.connectionType === 'TCP_IP' ? (
              <div className="flex justify-between items-center text-slate-500">
                <span>IP Terminal & Port:</span>
                <span className="font-mono text-slate-800 font-bold">
                  {config.ipTerminal || config.host || '-'}:{config.port || 2001}
                </span>
              </div>
            ) : (
              <div className="flex justify-between items-center text-slate-500">
                <span>Port COM & Baud:</span>
                <span className="font-mono text-slate-800 font-bold">
                  {config?.portPath || '-'} ({config?.baudRate || 115200} bps)
                </span>
              </div>
            )}
            {(terminalId || config?.terminalId) && (
              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <span className="font-bold text-emerald-800">Terminal ID (TID):</span>
                <span className="font-mono font-black text-emerald-800 bg-white px-2 py-0.5 rounded-lg border border-emerald-300 shadow-2xs">
                  {terminalId || config?.terminalId}
                </span>
              </div>
            )}
          </div>

          {!success && errorDetail && (
            <div className="mt-4 w-full text-left bg-rose-50 rounded-2xl p-3.5 border border-rose-200 text-xs text-rose-800">
              <span className="font-bold block mb-0.5">Detail Kendala:</span>
              <p className="font-mono text-[11px] break-all leading-relaxed">{errorDetail}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
