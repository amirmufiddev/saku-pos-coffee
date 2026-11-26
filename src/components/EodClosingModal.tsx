// src/components/EodClosingModal.tsx
import React, { useState, useEffect } from 'react';
import {
  X,
  Receipt,
  Printer,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Clock,
  Coffee,
  ShoppingBag,
  CreditCard,
  QrCode,
  Banknote,
  Coins,
} from 'lucide-react';
import { api, type Shift, type ShiftSummary, type User } from '../services/api';

interface EodClosingModalProps {
  currentUser: User;
  onClose: () => void;
  onShiftClosed: (closedShift: Shift) => void;
}

export const EodClosingModal: React.FC<EodClosingModalProps> = ({
  currentUser,
  onClose,
  onShiftClosed,
}) => {
  const [shift, setShift] = useState<Shift | null>(null);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [actualCashInput, setActualCashInput] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successReport, setSuccessReport] = useState<Shift | null>(null);

  const fetchShiftData = async () => {
    setIsLoading(true);
    try {
      const data = await api.getCurrentShift('TERM-01');
      setShift(data.shift);
      setSummary(data.summary);
      if (data.summary) {
        // Default actual cash to expected cash so cashier can click exact/pas easily
        setActualCashInput(String(data.summary.expectedCash));
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengambil data shift aktif.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchShiftData();
  }, []);

  const formatRp = (num: number) => `Rp ${num.toLocaleString('id-ID')}`;

  const actualCash = Number(actualCashInput) || 0;
  const expectedCash = summary?.expectedCash || 0;
  const cashDifference = actualCash - expectedCash;

  const handleCloseShift = async () => {
    if (!shift) return;
    setIsClosing(true);
    setErrorMsg(null);
    try {
      const res = await api.closeShift({
        shiftId: shift.id,
        actualCash,
        notes: notes.trim() || undefined,
        cashierId: currentUser.id,
        cashierName: currentUser.name,
      });

      setSuccessReport(res.shift);
      setTimeout(() => {
        onShiftClosed(res.shift);
      }, 1800);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal melakukan closing shift.');
      setIsClosing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh]">
        
        {/* Header */}
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-800">
              <Receipt size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">
                End Of Day Closing (Z-Report)
              </h2>
              <div className="text-xs text-slate-500 font-medium">
                Terminal TERM-01 • Kasir: <span className="text-slate-800 font-semibold">{currentUser.name}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-200/80 hover:bg-slate-300 flex items-center justify-center text-slate-600 hover:text-slate-900 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 bg-white">
          {isLoading ? (
            <div className="py-16 text-center text-xs text-slate-400 font-medium">
              Memuat data penjualan shift aktif...
            </div>
          ) : !shift || !summary ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              <AlertTriangle className="mx-auto mb-2 text-amber-600" size={32} />
              Tidak ada sesi shift aktif yang terbuka di terminal ini.
            </div>
          ) : successReport ? (
            <div className="py-12 flex flex-col items-center text-center">
              <CheckCircle2 size={54} className="text-emerald-700 mb-3 animate-bounce" />
              <h3 className="text-lg font-bold text-slate-900">Closing Shift & Z-Report Selesai!</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                Data closing telah tersimpan di SQLite lokal dan Z-Report telah masuk antrean printer thermal.
              </p>
              <div className="mt-4 text-xs font-mono font-bold text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                Shift ID: {successReport.id}
              </div>
            </div>
          ) : (
            <>
              {/* Shift Timing info */}
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-600">
                  <Clock size={15} className="text-amber-700" />
                  <span>Buka Shift:</span>
                  <span className="font-bold text-slate-900">
                    {new Date(shift.openedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <span>Tutup Shift:</span>
                  <span className="font-bold text-slate-900">
                    {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>

              {/* 1. Sales Summary Grid */}
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2.5">
                  1. Ringkasan Penjualan
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                    <div className="flex items-center gap-2 text-slate-500 text-xs font-medium">
                      <ShoppingBag size={14} className="text-amber-700" />
                      <span>Total Pesanan</span>
                    </div>
                    <div className="text-xl font-bold text-slate-900 mt-1">
                      {summary.totalOrders} <span className="text-xs font-medium text-slate-500">order</span>
                    </div>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                    <div className="flex items-center gap-2 text-slate-500 text-xs font-medium">
                      <Coffee size={14} className="text-amber-700" />
                      <span>Total Gelas Terjual</span>
                    </div>
                    <div className="text-xl font-bold text-slate-900 mt-1">
                      {summary.totalCups} <span className="text-xs font-medium text-slate-500">cup</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Penjualan Bruto</span>
                    <span className="font-bold text-slate-800">{formatRp(summary.grossSales)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Diskon Promosi</span>
                    <span className="font-bold text-slate-800">{formatRp(summary.discount)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>PB1 (Pajak Restoran 10%)</span>
                    <span className="font-bold text-slate-800">{formatRp(summary.tax)}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-sm font-bold text-slate-900">
                    <span>Total Penjualan Bersih (Net)</span>
                    <span className="text-emerald-800 text-base">{formatRp(summary.netSales)}</span>
                  </div>
                </div>
              </div>

              {/* 2. Payment Method Breakdown */}
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2.5">
                  2. Rincian Metode Pembayaran
                </h4>
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200">
                    <div className="flex items-center gap-1.5 text-emerald-800 text-[11px] font-bold">
                      <Banknote size={14} />
                      <span>Tunai (Cash)</span>
                    </div>
                    <div className="text-sm font-bold text-emerald-950 mt-1">
                      {formatRp(summary.cashSales)}
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl bg-blue-50/70 border border-blue-200">
                    <div className="flex items-center gap-1.5 text-blue-800 text-[11px] font-bold">
                      <QrCode size={14} />
                      <span>QRIS EDC</span>
                    </div>
                    <div className="text-sm font-bold text-blue-950 mt-1">
                      {formatRp(summary.qrisSales)}
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl bg-purple-50/70 border border-purple-200">
                    <div className="flex items-center gap-1.5 text-purple-800 text-[11px] font-bold">
                      <CreditCard size={14} />
                      <span>EDC / Kartu</span>
                    </div>
                    <div className="text-sm font-bold text-purple-950 mt-1">
                      {formatRp(summary.edcSales)}
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Cash Drawer Reconciliation */}
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2.5">
                  3. Rekonsiliasi Kas Laci (Cash Drawer)
                </h4>
                <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-200 space-y-3">
                  <div className="flex justify-between text-xs text-slate-700">
                    <span>Kas Awal (Starting Cash Float):</span>
                    <span className="font-bold">{formatRp(summary.startingCash)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-700">
                    <span>Penjualan Tunai Shift Ini:</span>
                    <span className="font-bold text-emerald-800">+{formatRp(summary.cashSales)}</span>
                  </div>
                  <div className="pt-2 border-t border-amber-200/80 flex justify-between text-xs font-bold text-slate-900">
                    <span>Estimasi Uang Kas di Laci:</span>
                    <span className="text-amber-900 text-sm">{formatRp(summary.expectedCash)}</span>
                  </div>

                  {/* Cashier input for physical cash */}
                  <div className="mt-3 pt-3 border-t border-amber-200/80">
                    <label className="block text-xs font-bold text-slate-800 mb-1.5">
                      Hitung Fisik Uang di Laci (Actual Cash):
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                        Rp
                      </span>
                      <input
                        type="number"
                        value={actualCashInput}
                        onChange={e => setActualCashInput(e.target.value)}
                        placeholder="0"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 bg-white font-mono font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-sm"
                      />
                    </div>

                    {/* Quick exact match button */}
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => setActualCashInput(String(summary.expectedCash))}
                        className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-[11px] font-bold text-amber-900 hover:bg-amber-100/60 transition cursor-pointer"
                      >
                        Pas / Sesuai ({formatRp(summary.expectedCash)})
                      </button>
                    </div>

                    {/* Difference status pill */}
                    <div className="mt-3 flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200">
                      <span className="text-xs font-medium text-slate-600">Selisih Kas:</span>
                      <span className={`px-2.5 py-1 rounded-lg font-bold text-xs ${
                        cashDifference === 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : cashDifference > 0
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {cashDifference === 0
                          ? 'PAS / BALANCE (Rp 0)'
                          : cashDifference > 0
                          ? `LEBIH (+${formatRp(cashDifference)})`
                          : `KURANG (-${formatRp(Math.abs(cashDifference))})`}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Catatan Closing (Opsional):
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Contoh: Shift berjalan lancar, uang fisik pecahan 100k dan 50k..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-amber-500 bg-slate-50"
                />
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                  {errorMsg}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        {!successReport && (
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isClosing}
              className="px-5 py-3 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition cursor-pointer"
            >
              Kembali
            </button>
            <button
              type="button"
              onClick={handleCloseShift}
              disabled={isClosing || isLoading || !shift}
              className="flex-1 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
            >
              <Printer size={16} />
              <span>{isClosing ? 'Memproses Closing & Cetak...' : 'Tutup Kasir & Cetak Z-Report (End Of Day)'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
