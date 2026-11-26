import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  Plus,
  Zap,
  Trash2,
  Pencil,
  Star,
  CheckCircle2,
  XCircle,
  Network,
  Usb,
  Activity,
  AlertTriangle,
  Database,
} from 'lucide-react';
import { edcStorage } from '../services/edcStorage';
import type { EdcConfiguration, EdcConnectionType } from '../types/edc-config';
import { formatEdcConnectionLabel, mapEdcConfigToTestParams } from '../types/edc-config';
import { EdcService, isDesktopPos } from '../services/edcService';
import { api } from '../services/api';
import { EdcConfigurationFormModal } from './EdcConfigurationFormModal';
import { EdcConnectionTestResultModal } from './EdcConnectionTestResultModal';

export const EdcSettingsSection: React.FC = () => {
  const [configs, setConfigs] = useState<EdcConfiguration[]>([]);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<EdcConfiguration | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    config?: EdcConfiguration | null;
    errorDetail?: string;
    terminalId?: string;
  }>({
    success: false,
    message: '',
  });

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadConfigs = async () => {
    try {
      const items = await api.getEdcConfigurations();
      edcStorage.hydrateFromServer(items);
      setConfigs(items);
    } catch {
      setConfigs(edcStorage.getEdcConfigurations());
    }
  };

  useEffect(() => {
    void loadConfigs();
  }, []);

  const handleOpenAddModal = () => {
    setEditingConfig(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (config: EdcConfiguration) => {
    setEditingConfig(config);
    setIsFormModalOpen(true);
  };

  const handleSaveConfig = async (
    configData: Partial<EdcConfiguration> & { name: string; connectionType: EdcConnectionType },
  ) => {
    try {
      const saved = await api.saveEdcConfiguration(configData);
      await loadConfigs();
      setStatusMsg({
        type: 'success',
        text: `Konfigurasi EDC "${saved.name}" tersimpan di database SQLite.`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err?.message || 'Gagal menyimpan konfigurasi EDC ke SQLite.',
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteEdcConfiguration(id);
      setDeleteConfirmId(null);
      await loadConfigs();
      setStatusMsg({ type: 'success', text: 'Konfigurasi EDC dihapus dari SQLite.' });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Gagal menghapus konfigurasi EDC.' });
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.setDefaultEdcConfiguration(id);
      await loadConfigs();
      setStatusMsg({ type: 'success', text: 'Mesin EDC default berhasil diperbarui.' });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Gagal mengubah EDC default.' });
    }
  };

  const handleTestConnection = async (config: EdcConfiguration) => {
    setTestingId(config.id);
    const testParams = mapEdcConfigToTestParams(config);

    try {
      const result = await EdcService.testConnection(testParams);
      const timestamp = new Date().toISOString();

      await api.updateEdcTestResult(config.id, {
        lastTestStatus: result.success ? 'CONNECTED' : 'FAILED',
        lastTestedAt: timestamp,
        lastTestError: result.success ? null : result.message,
        terminalId: result.terminalId || null,
        vendorId: result.deviceIdentifier?.vendorId || null,
        productId: result.deviceIdentifier?.productId || null,
        serialNumber: result.deviceIdentifier?.serialNumber || null,
        manufacturer: result.deviceIdentifier?.manufacturer || null,
      });
      await loadConfigs();

      setTestResult({
        success: result.success,
        message: result.message,
        config,
        errorDetail: result.success ? undefined : result.message,
        terminalId: result.terminalId,
      });
      setIsTestModalOpen(true);
    } catch (err: any) {
      const timestamp = new Date().toISOString();
      const errorMsg = err?.message || 'Gagal menghubungi mesin EDC.';
      await api
        .updateEdcTestResult(config.id, {
          lastTestStatus: 'FAILED',
          lastTestedAt: timestamp,
          lastTestError: errorMsg,
        })
        .catch(() => {});
      await loadConfigs();

      setTestResult({
        success: false,
        message: 'Koneksi ke mesin EDC gagal.',
        config,
        errorDetail: errorMsg,
      });
      setIsTestModalOpen(true);
    } finally {
      setTestingId(null);
    }
  };

  const isDesktop = isDesktopPos();

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl text-emerald-600 dark:text-emerald-400">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <span>EDC Machine Configuration</span>
              <span className="text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800">
                ECR Ingenico
              </span>
              <span className="text-[10px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full border border-slate-300 inline-flex items-center gap-1">
                <Database className="w-3 h-3" />
                SQLite Local
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Konfigurasi mesin EDC Debit / Kredit & QRIS EDC (Bank Danamon / Mandiri / ECR Protocol) tersimpan penuh di database SQLite lokal.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpenAddModal}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Tambah Mesin EDC</span>
        </button>
      </div>

      {statusMsg && (
        <div
          className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
          <button onClick={() => setStatusMsg(null)} className="p-1 hover:opacity-75 cursor-pointer">
            &times;
          </button>
        </div>
      )}

      {!isDesktop && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <Activity className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            Aplikasi sedang berjalan di browser. Fitur test koneksi fisik & komunikasi ECR Serial/USB memerlukan runtime <strong>Electron Desktop POS</strong>.
          </span>
        </div>
      )}

      {/* EDC List */}
      {configs.length === 0 ? (
        <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center text-slate-400">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">
              Belum Ada Mesin EDC Dikonfigurasi
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1">
              Tambahkan konfigurasi mesin EDC Serial/USB atau TCP/IP untuk mengaktifkan pembayaran kartu lokal.
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah Mesin EDC</span>
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-400 font-semibold">
                <th className="py-2.5 px-3">Mesin EDC</th>
                <th className="py-2.5 px-3">Bank</th>
                <th className="py-2.5 px-3">Tipe Koneksi</th>
                <th className="py-2.5 px-3">Terminal ID (TID)</th>
                <th className="py-2.5 px-3">Status Terakhir</th>
                <th className="py-2.5 px-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {configs.map((config) => {
                const isTesting = testingId === config.id;
                const isConnected = config.lastTestStatus === 'CONNECTED';
                const isFailed = config.lastTestStatus === 'FAILED';

                return (
                  <tr key={config.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition group">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-200">{config.name}</span>
                        {config.isDefault && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                            Default
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-700">
                        {config.bank || 'Danamon'}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-600">
                        {config.connectionType === 'TCP_IP' ? (
                          <>
                            <Network className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            <span>{formatEdcConnectionLabel(config)}</span>
                          </>
                        ) : (
                          <>
                            <Usb className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                            <span>{formatEdcConnectionLabel(config)}</span>
                          </>
                        )}
                      </div>
                      {config.connectionType === 'TCP_IP' && (
                        <span className="block text-[10px] text-slate-400 mt-0.5">
                          Host {config.host || '-'} · PIS {config.ipPis || '-'} · {config.baudRate} baud
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-mono text-slate-700">{config.terminalId || '-'}</span>
                    </td>
                    <td className="py-3 px-3">
                      {isConnected ? (
                        <div className="flex items-center gap-1 text-emerald-600 font-semibold text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Connected</span>
                        </div>
                      ) : isFailed ? (
                        <div className="flex items-center gap-1 text-rose-600 font-semibold text-[11px]">
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>Failed</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Belum dites</span>
                      )}
                      {config.lastTestedAt && (
                        <span className="block text-[10px] text-slate-400 mt-0.5">
                          {new Date(config.lastTestedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleTestConnection(config)}
                          disabled={isTesting}
                          title="Uji Koneksi & Handshake ke EDC"
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                        >
                          <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-bounce text-amber-500' : ''}`} />
                          <span>{isTesting ? 'Testing...' : 'Test'}</span>
                        </button>
                        {!config.isDefault && (
                          <button
                            type="button"
                            onClick={() => handleSetDefault(config.id)}
                            title="Jadikan Mesin EDC Default"
                            className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                          >
                            <Star className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(config)}
                          title="Edit Konfigurasi"
                          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(config.id)}
                          title="Hapus Konfigurasi"
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 border border-slate-200 shadow-2xl">
            <h4 className="text-sm font-bold text-slate-900">Hapus Konfigurasi Mesin EDC?</h4>
            <p className="text-xs text-slate-600">
              Konfigurasi ini akan dihapus permanen dari database SQLite lokal.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deleteConfirmId)}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition cursor-pointer"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      <EdcConfigurationFormModal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        onSave={handleSaveConfig}
        editingConfig={editingConfig}
        existingCount={configs.length}
      />

      <EdcConnectionTestResultModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        success={testResult.success}
        message={testResult.message}
        config={testResult.config}
        errorDetail={testResult.errorDetail}
        terminalId={testResult.terminalId}
      />
    </div>
  );
};
