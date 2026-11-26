// src/components/SystemSettingsView.tsx
import React, { useState, useEffect } from 'react';
import {
  SlidersHorizontal,
  Cpu,
  Printer,
  CreditCard,
  Network,
  Usb,
  ShieldCheck,
  RefreshCw,
  Activity,
  Plus,
  Trash2,
  Pencil,
  Star,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Volume2,
  Radio,
  Tv,
  Database,
  Check,
  Zap,
  Server,
  Layers,
  Sparkles,
  Receipt,
  Tag,
  ArrowRight,
  Clock,
  ExternalLink,
  Image as ImageIcon,
  PackageCheck,
} from 'lucide-react';
import { edcStorage } from '../services/edcStorage';
import type { EdcConfiguration, EdcConnectionType } from '../types/edc-config';
import { formatEdcConnectionLabel, mapEdcConfigToTestParams } from '../types/edc-config';
import { EdcService, isDesktopPos } from '../services/edcService';
import { api, type DbStatus, type PrinterStatus, type Product } from '../services/api';
import { pagerAudio } from '../utils/pagerAudio';
import { cdsConfigStorage, type AdSlide } from '../services/cdsConfigStorage';
import { EdcConfigurationFormModal } from './EdcConfigurationFormModal';
import { EdcConnectionTestResultModal } from './EdcConnectionTestResultModal';
import { CdsSlideFormModal } from './CdsSlideFormModal';
import { EdcSettingsSection } from './EdcSettingsSection';

interface SystemSettingsViewProps {
  onRefreshData?: () => void;
}

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({ onRefreshData }) => {
  const [activeTab, setActiveTab] = useState<'HARDWARE' | 'EDC' | 'CDS' | 'CHAOS' | 'DATABASE'>('HARDWARE');
  const [configs, setConfigs] = useState<EdcConfiguration[]>([]);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<EdcConfiguration | null>(null);

  // Customer Display Slides State
  const [cdsSlides, setCdsSlides] = useState<AdSlide[]>(() => cdsConfigStorage.getSlides());
  const [cdsInterval, setCdsInterval] = useState<number>(() => cdsConfigStorage.getIntervalSeconds());
  const [editingSlide, setEditingSlide] = useState<AdSlide | null>(null);
  const [isSlideModalOpen, setIsSlideModalOpen] = useState(false);
  const [deleteSlideConfirmId, setDeleteSlideConfirmId] = useState<string | null>(null);

  // Health and Hardware states
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus | null>(null);
  const [isLoadingHealth, setIsLoadingHealth] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isRestocking, setIsRestocking] = useState(false);
  const [updatingStockId, setUpdatingStockId] = useState<string | null>(null);

  // Test modal states for EDC
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

  const [isTestingThermal, setIsTestingThermal] = useState(false);
  const [isTestingCupLabel, setIsTestingCupLabel] = useState(false);
  const [isVacuumingDb, setIsVacuumingDb] = useState(false);

  const isDesktop = isDesktopPos();

  const loadConfigs = async () => {
    try {
      const items = await api.getEdcConfigurations();
      edcStorage.hydrateFromServer(items);
      setConfigs(items);
    } catch {
      setConfigs(edcStorage.getEdcConfigurations());
    }
  };

  const loadHealth = async () => {
    setIsLoadingHealth(true);
    try {
      const [d, p, cat] = await Promise.all([
        api.getDbStatus().catch(() => null),
        api.getPrinterStatus().catch(() => null),
        api.getCatalog().catch(() => null),
      ]);
      if (d) setDbStatus(d);
      if (p) setPrinterStatus(p);
      if (cat?.products) setProducts(cat.products);
    } catch (err: any) {
      console.warn('Gagal memuat status sistem:', err);
    } finally {
      setIsLoadingHealth(false);
    }
  };

  useEffect(() => {
    void loadConfigs();
    void loadHealth();
  }, []);

  const showNotice = (type: 'success' | 'error' | 'info', text: string) => {
    setActionNotice({ type, text });
    setTimeout(() => {
      setActionNotice(prev => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // 1. HARDWARE TESTS: Thermal Receipt Printer Test
  const handleTestThermalPrinter = async () => {
    setIsTestingThermal(true);
    try {
      const win = window as any;
      if (win.electronAPI?.printReceipt) {
        const res = await win.electronAPI.printReceipt({
          htmlContent: `
            <div style="font-family: monospace; text-align: center; padding: 12px; font-size: 12px;">
              <b>SAKUPOS - COFFEE OUTLET</b><br/>
              <b>TEST CETAK STRUK THERMAL 78MM</b><br/>
              ================================<br/>
              Terminal: TERM-01 (Kasir Utama)<br/>
              Waktu: ${new Date().toLocaleString('id-ID')}<br/>
              Status Printer: ONLINE & READY<br/>
              ================================<br/>
              ESC/POS Driver Test: OK<br/>
              Thermal Head Health: EXCELLENT<br/>
              Laci Kasir (Kick Drawer): SIAP<br/>
              ================================<br/>
              Terima Kasih - SakuPOS - Coffee<br/>
            </div>
          `,
          silent: false,
        });
        if (res?.success) {
          showNotice('success', 'Perintah test cetak berhasil dikirim langsung ke Thermal Receipt Printer!');
          return;
        }
      }

      // Fallback: Open browser print dialog with thermal dummy content
      showNotice('success', 'Jalur cetak thermal kasir aktif (Membuka dialog cetak thermal browser ESC/POS).');
      window.print();
    } catch (err: any) {
      showNotice('error', err?.message || 'Gagal mengirim test cetak ke printer struk.');
    } finally {
      setIsTestingThermal(false);
    }
  };

  // 2. HARDWARE TESTS: Cup Label Printer Test
  const handleTestCupLabelPrinter = async () => {
    setIsTestingCupLabel(true);
    try {
      const win = window as any;
      if (!win.electronAPI?.printCupLabel) {
        showNotice(
          'error',
          'Test cetak stiker hanya berjalan di aplikasi Electron. Jalankan `yarn electron:dev` (bukan browser Vite saja).',
        );
        return;
      }

      const res = await win.electronAPI.printCupLabel({
        productName: 'TEST: Kopi Susu Aren',
        size: 'Regular',
        modifiers: ['Normal Ice', 'Normal Sugar'],
        pagerNumber: '99',
        customerName: 'Uji Printer Barista',
        notes: 'Test print label',
      });

      if (!res?.success) {
        throw new Error(res?.message || 'Windows gagal mengirim job ke printer label.');
      }

      showNotice(
        'success',
        `Test stiker 5×3 cm terkirim ke printer: ${res.deviceName || 'USB label'}`,
      );
    } catch (err: any) {
      showNotice('error', err?.message || 'Gagal mencetak test stiker cup.');
    } finally {
      setIsTestingCupLabel(false);
    }
  };

  // 3. HARDWARE TESTS: Coaster Pager Buzzer Test
  const handleTestPagerBuzzer = () => {
    try {
      pagerAudio.playPagerChime();
      showNotice('success', 'Sinyal nada dering coaster pager berhasil dibunyikan via Web Audio Synthesizer (3-Tone Chime)!');
    } catch (err: any) {
      showNotice('error', 'Gagal membunyikan synthesizer buzzer.');
    }
  };

  // 4. HARDWARE TESTS: Customer Display Screen (CDS) Test
  const handleTestCustomerDisplay = () => {
    try {
      const channel = new BroadcastChannel('sakupos_cds');
      channel.postMessage({
        type: 'TEST_PING',
        payload: {
          timestamp: new Date().toISOString(),
          message: 'Halo Pelanggan! Layar Customer Display SakuPOS - Coffee Siap Melayani.',
        },
      });

      const win = window as any;
      if (win.electronAPI?.sendCdsMessage) {
        win.electronAPI.sendCdsMessage({
          type: 'TEST_PING',
          payload: { message: 'Halo Pelanggan! Layar Customer Display SakuPOS - Coffee Siap Melayani.' },
        });
      }

      showNotice('success', 'Sinyal pesan diagnostik berhasil dikirim ke Layar Customer Display!');
    } catch (err: any) {
      showNotice('error', 'Gagal menghubungi channel Customer Display Screen.');
    }
  };

  // 5. CDS SLIDES HANDLERS: Save, Delete, Reset, Interval
  const handleSaveSlide = (slide: AdSlide) => {
    const existingIndex = cdsSlides.findIndex(s => s.id === slide.id);
    let next: AdSlide[];
    if (existingIndex !== -1) {
      next = [...cdsSlides];
      next[existingIndex] = slide;
    } else {
      next = [...cdsSlides, slide];
    }
    setCdsSlides(next);
    cdsConfigStorage.saveSlides(next);
    showNotice('success', 'Slide banner promo layar customer berhasil diperbarui & disinkronkan langsung!');
  };

  const handleDeleteSlide = (id: string) => {
    if (cdsSlides.length <= 1) {
      showNotice('error', 'Minimal harus ada 1 slide untuk layar pelanggan.');
      return;
    }
    const next = cdsSlides.filter(s => s.id !== id);
    setCdsSlides(next);
    cdsConfigStorage.saveSlides(next);
    setDeleteSlideConfirmId(null);
    showNotice('info', 'Slide banner promo berhasil dihapus.');
  };

  const handleResetSlides = () => {
    if (!confirm('Kembalikan semua slide banner ke preset default SakuPOS - Coffee?')) return;
    const defaults = cdsConfigStorage.resetToDefaults();
    setCdsSlides(defaults);
    setCdsInterval(8);
    showNotice('success', 'Slide berhasil dikembalikan ke preset default SakuPOS - Coffee.');
  };

  const handleChangeInterval = (sec: number) => {
    setCdsInterval(sec);
    cdsConfigStorage.saveIntervalSeconds(sec);
    showNotice('success', `Durasi rotasi banner diubah menjadi ${sec} detik.`);
  };

  // 5. EDC TESTS: Test Connection Handshake
  const handleTestEdcConnection = async (config: EdcConfiguration) => {
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
      }).catch(() => {});
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
      await api.updateEdcTestResult(config.id, {
        lastTestStatus: 'FAILED',
        lastTestedAt: timestamp,
        lastTestError: errorMsg,
      }).catch(() => {});
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

  // 6. RESILIENCE TESTS: Toggle Printer Offline/Online
  const handleTogglePrinter = async () => {
    try {
      await api.togglePrinterOnline();
      await loadHealth();
      onRefreshData?.();
      showNotice('info', 'Status koneksi printer cup label berhasil dialihkan.');
    } catch (err: any) {
      showNotice('error', err.message || 'Gagal mengubah status printer.');
    }
  };

  // 7. DATABASE: Vacuum / Optimize SQLite
  const handleVacuumDatabase = async () => {
    setIsVacuumingDb(true);
    try {
      await api.vacuumDatabase();
      await loadHealth();
      showNotice('success', 'Indeks SQLite Storage Engine berhasil di-vacuum & dioptimasi!');
    } catch (err: any) {
      showNotice('error', err?.message || 'Gagal menjalankan vacuum database.');
    } finally {
      setIsVacuumingDb(false);
    }
  };

  // 8. LOCAL STOCK CONTROLS
  const handleRestockAll = async () => {
    setIsRestocking(true);
    try {
      const res = await api.restockAllProducts(50);
      await loadHealth();
      onRefreshData?.();
      showNotice('success', `Stok ${res.updatedCount} menu berhasil diisi ulang ke ${res.defaultQty} cup.`);
    } catch (err: any) {
      showNotice('error', err?.message || 'Gagal mengisi ulang stok.');
    } finally {
      setIsRestocking(false);
    }
  };

  const handleUpdateProductStock = async (
    product: Product,
    nextStock: number | null,
    isSoldOut?: boolean,
  ) => {
    setUpdatingStockId(product.id);
    try {
      await api.updateProductStock(product.id, nextStock, isSoldOut);
      await loadHealth();
      onRefreshData?.();
    } catch (err: any) {
      showNotice('error', err?.message || 'Gagal memperbarui stok menu.');
    } finally {
      setUpdatingStockId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100 p-6 font-['Inter',sans-serif]">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* 1. Header Banner (Mirip Grocery POS Global Hardware Setting) */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-800 text-white flex items-center justify-center shadow-xs shrink-0">
              <SlidersHorizontal size={24} className="text-emerald-300" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-black text-slate-900 tracking-tight">
                  Pengaturan Sistem & Hardware POS
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                  Akses Terbuka Kasir
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-300">
                  Terminal #TERM-01
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Pusat pengujian perangkat keras kasir: printer struk thermal, printer label cup barista, integrasi mesin EDC, dan manajemen database SQLite lokal.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={loadHealth}
              disabled={isLoadingHealth}
              className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition cursor-pointer"
              title="Perbarui status diagnostik"
            >
              <RefreshCw size={16} className={isLoadingHealth ? 'animate-spin text-emerald-700' : ''} />
            </button>

            <div className="flex items-center gap-2 text-xs text-slate-600 font-mono bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200">
              <Cpu size={16} className="text-emerald-700" />
              <span>{isDesktop ? 'Electron Desktop' : 'Web POS Client'}</span>
            </div>
          </div>
        </div>

        {/* Global Toast Notification */}
        {actionNotice && (
          <div
            className={`p-3.5 rounded-2xl border text-xs font-semibold flex items-center justify-between transition animate-in fade-in duration-150 ${
              actionNotice.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200 shadow-2xs'
                : actionNotice.type === 'error'
                ? 'bg-rose-50 text-rose-900 border-rose-200 shadow-2xs'
                : 'bg-blue-50 text-blue-900 border-blue-200 shadow-2xs'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {actionNotice.type === 'success' ? (
                <CheckCircle2 size={16} className="text-emerald-700 shrink-0" />
              ) : actionNotice.type === 'error' ? (
                <XCircle size={16} className="text-rose-700 shrink-0" />
              ) : (
                <Activity size={16} className="text-blue-700 shrink-0" />
              )}
              <span>{actionNotice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionNotice(null)}
              className="text-slate-400 hover:text-slate-700 font-bold ml-3"
            >
              ✕
            </button>
          </div>
        )}

        {/* 2. Sub-Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('HARDWARE')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-2 shrink-0 ${
              activeTab === 'HARDWARE'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Printer size={15} />
            <span>Diagnostik & Uji Hardware</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('EDC')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-2 shrink-0 ${
              activeTab === 'EDC'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <CreditCard size={15} />
            <span>Konfigurasi Mesin EDC ({configs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('CDS')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-2 shrink-0 ${
              activeTab === 'CDS'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Tv size={15} />
            <span>Layar Customer ({cdsSlides.length} Banner)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('CHAOS')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-2 shrink-0 ${
              activeTab === 'CHAOS'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Zap size={15} />
            <span>Uji Ketahanan Printer</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('DATABASE')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-2 shrink-0 ${
              activeTab === 'DATABASE'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Database size={15} />
            <span>Database SQLite</span>
          </button>
        </div>

        {/* TAB 1: HARDWARE DIAGNOSTICS & PERIPHERAL TESTS */}
        {activeTab === 'HARDWARE' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Card 1: Thermal Receipt Printer */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                      <Receipt size={16} className="text-emerald-700" />
                      Printer Struk Thermal
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      78mm ESC/POS
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900">Thermal Kasir (Struk Belanja)</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Digunakan untuk mencetak struk belanja kasir, ringkasan pembayaran, dan nomor coaster pager tamu.
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">Status: Ready</span>
                  <button
                    type="button"
                    onClick={handleTestThermalPrinter}
                    disabled={isTestingThermal}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-98 text-white font-black text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  >
                    <Printer size={14} />
                    <span>{isTestingThermal ? 'Mencetak...' : 'Test Cetak Struk'}</span>
                  </button>
                </div>
              </div>

              {/* Card 2: Cup Label Sticker Printer */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                      <Tag size={16} className="text-sky-700" />
                      Printer Label Cup Barista
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      printerStatus?.cupLabelPrinter.online
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {printerStatus?.cupLabelPrinter.online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900">Stiker Cup Label Bar (5×3 cm)</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Mencetak 1 stiker tahan air per cup dengan nomor pager tamu, ukuran cup, dan catatan kustomisasi barista.
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">
                    Antrean: {printerStatus?.pendingJobsCount || 0}
                  </span>
                  <button
                    type="button"
                    onClick={handleTestCupLabelPrinter}
                    disabled={isTestingCupLabel}
                    className="px-3.5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 active:scale-98 text-white font-black text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  >
                    <Tag size={14} />
                    <span>{isTestingCupLabel ? 'Mencetak...' : 'Test Cetak Stiker'}</span>
                  </button>
                </div>
              </div>

              {/* Card 3: EDC Integrated Machine */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                      <CreditCard size={16} className="text-amber-700" />
                      Mesin EDC Kasir
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                      ECR Protocol
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900">
                    {configs.find(c => c.isDefault)?.name || 'EDC Default'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Mendukung pembayaran Kartu Debit, Kartu Kredit, dan QRIS Dinamis EDC dengan verifikasi otomatis.
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">
                    TID: {configs.find(c => c.isDefault)?.terminalId || 'Auto'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const def = configs.find(c => c.isDefault) || configs[0];
                      if (def) handleTestEdcConnection(def);
                      else setActiveTab('EDC');
                    }}
                    disabled={Boolean(testingId)}
                    className="px-3.5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-700 active:scale-98 text-white font-black text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  >
                    <ShieldCheck size={14} />
                    <span>{testingId ? 'Menguji...' : 'Uji Koneksi EDC'}</span>
                  </button>
                </div>
              </div>

              {/* Card 4: Coaster Pager Buzzer Synthesizer */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                      <Radio size={16} className="text-emerald-700" />
                      Coaster Pager Barista
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      Web Audio Synthesizer
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900">Buzzer & Sinyal Pager Tamu</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Simulasi 3-tone acoustic chime realistis (520Hz, 650Hz, 780Hz) saat pesanan selesai diracik barista.
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">PGR #01 s/d #99</span>
                  <button
                    type="button"
                    onClick={handleTestPagerBuzzer}
                    className="px-3.5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-700 active:scale-98 text-white font-black text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  >
                    <Volume2 size={14} />
                    <span>Test Buzzer Pager</span>
                  </button>
                </div>
              </div>

              {/* Card 5: Customer Display Screen (CDS) */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                      <Tv size={16} className="text-purple-700" />
                      Layar Customer Display
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-800 border border-purple-200">
                      Dual Screen
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900">Monitor Tamu Real-time</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Menampilkan rincian keranjang belanja, banner promo SakuPOS - Coffee, QRIS pembayaran, dan nomor coaster pager.
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <a
                    href="/?display=customer"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-bold text-purple-700 hover:underline"
                  >
                    Buka Tab Layar ↗
                  </a>
                  <button
                    type="button"
                    onClick={handleTestCustomerDisplay}
                    className="px-3.5 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 active:scale-98 text-white font-black text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  >
                    <Tv size={14} />
                    <span>Kirim Test Ping</span>
                  </button>
                </div>
              </div>

              {/* Card 6: Local SQLite Engine Status */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-2xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                      <Database size={16} className="text-emerald-700" />
                      Database Lokal SQLite
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      dbStatus?.connected
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {dbStatus?.connected ? 'WAL Aktif' : 'Terputus'}
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900">100% Local Storage Engine</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Seluruh katalog, stok, user PIN, shift, EDC, dan transaksi berjalan penuh di SQLite lokal tanpa API cloud.
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">
                    {dbStatus?.counts.orders ?? 0} Orders • {dbStatus?.counts.products ?? 0} SKU
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('DATABASE')}
                    className="px-3.5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-700 active:scale-98 text-white font-black text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  >
                    <Database size={14} />
                    <span>Kelola DB & Stok</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'EDC' && <EdcSettingsSection />}

        {/* TAB 4: PRINTER RESILIENCE SIMULATION */}
        {activeTab === 'CHAOS' && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-2xs space-y-5">
            <div className="border-b border-slate-100 pb-4">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <span>Uji Ketahanan Perangkat Lokal (Antrean Cetak SQLite)</span>
                <span className="text-[10px] font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md border border-amber-300">
                  Resilience Guarantee
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Simulasikan kondisi printer label cup terlepas: pesanan tetap tersimpan di SQLite dan job cetak diantrekan otomatis sampai printer kembali tersambung.
              </p>
            </div>

            <div className="max-w-lg">
              <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Tag size={18} className="text-sky-700" />
                    <span className="text-xs font-black text-slate-900 uppercase">Printer Stiker Cup Label</span>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                    printerStatus?.cupLabelPrinter.online
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : 'bg-rose-100 text-rose-900 border border-rose-300'
                  }`}>
                    {printerStatus?.cupLabelPrinter.online ? 'Printer Siap' : 'Printer Terlepas'}
                  </span>
                </div>

                <div className="p-3.5 bg-white rounded-xl border border-slate-200 text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Model Printer:</span>
                    <span className="font-bold text-slate-800 font-mono">
                      {printerStatus?.cupLabelPrinter.name || 'Cup-Label-Printer-50x30'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Antrean Cetak Tertunda:</span>
                    <span className="font-bold text-amber-700 font-mono">
                      {printerStatus?.pendingJobsCount || 0} Antrean
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleTogglePrinter}
                  className={`w-full py-2.5 px-4 rounded-xl font-black text-xs transition cursor-pointer shadow-xs flex items-center justify-center gap-2 ${
                    printerStatus?.cupLabelPrinter.online
                      ? 'bg-amber-600 hover:bg-amber-700 text-white'
                      : 'bg-emerald-800 hover:bg-emerald-700 text-white'
                  }`}
                >
                  <Printer size={14} />
                  <span>
                    {printerStatus?.cupLabelPrinter.online
                      ? 'Simulasikan Kabel Printer Lepas'
                      : 'Sambungkan Kembali Printer Cup'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: SQLITE DATABASE ENGINE & LOCAL STOCK */}
        {activeTab === 'DATABASE' && (
          <div className="space-y-5">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-2xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <span>SQLite Storage Engine & Database Health</span>
                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-md border border-emerald-300">
                      100% Local Offline
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Penyimpanan lokal ACID-compliant di terminal kasir tanpa ketergantungan API eksternal.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleVacuumDatabase}
                  disabled={isVacuumingDb}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-98 text-white font-black text-xs flex items-center gap-2 transition cursor-pointer shadow-xs"
                >
                  <Database size={15} className={isVacuumingDb ? 'animate-spin text-emerald-400' : ''} />
                  <span>{isVacuumingDb ? 'Mengoptimasi...' : 'Vacuum & Re-index Database'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">Engine</span>
                  <div className="text-base font-black text-slate-900 mt-1">
                    {dbStatus?.engine || 'SQLite 3 (WAL Mode)'}
                  </div>
                  <span className="text-[10px] text-emerald-700 font-bold">Write-Ahead Logging Aktif</span>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">Database File</span>
                  <div className="text-base font-black text-slate-900 mt-1 font-mono">
                    {dbStatus?.dbFile || 'outlet_pos.sqlite'}
                  </div>
                  <span className="text-[10px] text-slate-500 font-semibold">
                    {dbStatus?.counts.edcConfigurations ?? 0} EDC • {dbStatus?.counts.users ?? 0} Staff
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">Transaksi Lokal</span>
                  <div className="text-base font-black text-emerald-800 mt-1 font-mono">
                    {dbStatus?.counts.orders ?? 0} Order
                  </div>
                  <span className="text-[10px] text-slate-500 font-semibold">
                    {dbStatus?.counts.shifts ?? 0} Shift Tercatat
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">Katalog & Terminal</span>
                  <div className="text-base font-black text-slate-900 mt-1 font-mono">
                    {dbStatus?.counts.products ?? 0} SKU
                  </div>
                  <span className="text-[10px] text-slate-500 font-semibold">
                    {dbStatus?.terminalId || 'TERM-01'}
                  </span>
                </div>
              </div>
            </div>

            {/* Local Stock Management Panel */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <PackageCheck size={18} className="text-emerald-700" />
                    <span>Kontrol Stok Menu Lokal</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Stok berkurang otomatis saat order dibuat dan kembali saat pesanan dibatalkan.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleRestockAll}
                  disabled={isRestocking}
                  className="px-4 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-2 transition cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <RefreshCw size={14} className={isRestocking ? 'animate-spin' : ''} />
                  <span>{isRestocking ? 'Mengisi...' : 'Isi Ulang Stok Semua Menu (50)'}</span>
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-2xl">
                {products.map((prod) => {
                  const busy = updatingStockId === prod.id;
                  const currentStock = prod.stockQty ?? 0;
                  return (
                    <div key={prod.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 truncate">{prod.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {prod.sku} • {prod.category}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            prod.isSoldOut || currentStock <= 0
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {prod.isSoldOut || currentStock <= 0 ? 'Habis' : `Stok: ${currentStock}`}
                        </span>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleUpdateProductStock(prod, currentStock + 10, false)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          +10
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            handleUpdateProductStock(
                              prod,
                              prod.isSoldOut ? Math.max(10, currentStock) : 0,
                              !prod.isSoldOut,
                            )
                          }
                          className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer disabled:opacity-50 ${
                            prod.isSoldOut
                              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                              : 'bg-rose-50 hover:bg-rose-100 text-rose-700'
                          }`}
                        >
                          {prod.isSoldOut ? 'Aktifkan' : 'Set Habis'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      <EdcConnectionTestResultModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        success={testResult.success}
        message={testResult.message}
        config={testResult.config}
        errorDetail={testResult.errorDetail}
        terminalId={testResult.terminalId}
      />

      <CdsSlideFormModal
        isOpen={isSlideModalOpen}
        onClose={() => setIsSlideModalOpen(false)}
        onSave={handleSaveSlide}
        editingSlide={editingSlide}
      />
    </div>
  );
};
