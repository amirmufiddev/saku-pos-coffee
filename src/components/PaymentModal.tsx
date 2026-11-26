// src/components/PaymentModal.tsx
import React, { useState } from 'react';
import {
  X,
  CreditCard,
  Banknote,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Cpu,
  Smartphone,
} from 'lucide-react';
import { api, type Order } from '../services/api';
import { EdcPaymentModal } from './EdcPaymentModal';
import type { EdcPaymentType, EdcConfiguration } from '../types/edc-config';
import type { EdcProcessPaymentResult } from '../services/edcService';

interface PaymentModalProps {
  order: Order;
  onClose: () => void;
  onPaymentSuccess: (paidOrder: Order) => void;
  onPaymentFailed?: (errorMessage: string) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  order,
  onClose,
  onPaymentSuccess,
  onPaymentFailed,
}) => {
  const [method, setMethod] = useState<'CASH' | 'EDC_QRIS' | 'EDC_DEBIT' | 'EDC_CREDIT'>('CASH');
  const [cashAmount, setCashAmount] = useState<number>(order.totalAmount);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // EDC Modal State
  const [showEdcModal, setShowEdcModal] = useState(false);
  const [edcType, setEdcType] = useState<EdcPaymentType>('DEBIT');

  const change = Math.max(0, cashAmount - order.totalAmount);
  const isInsufficient = method === 'CASH' && cashAmount < order.totalAmount;

  // Keep Customer Display in sync with selected cashier payment method
  React.useEffect(() => {
    try {
      const channel = new BroadcastChannel('sakupos_cds');
      channel.postMessage({
        type: 'PAYMENT_PENDING',
        payload: {
          orderNumber: order.orderNumber,
          totalAmount: order.totalAmount,
          paymentMethod: method,
        },
      });
      channel.close();
    } catch { }
  }, [method, order.orderNumber, order.totalAmount]);

  const cashPresets = [
    order.totalAmount, // Uang Pas
    Math.ceil(order.totalAmount / 10000) * 10000,
    50000,
    100000,
    200000,
  ].filter((v, i, a) => v >= order.totalAmount && a.indexOf(v) === i);

  const handlePay = async () => {
    // If QRIS EDC is selected, launch EDC with QRIS mode
    if (method === 'EDC_QRIS') {
      setEdcType('QRIS');
      setShowEdcModal(true);
      return;
    }

    // If EDC Card is selected, launch EDC with Debit/Credit mode
    if (method === 'EDC_DEBIT' || method === 'EDC_CREDIT') {
      setEdcType(method === 'EDC_CREDIT' ? 'CREDIT' : 'DEBIT');
      setShowEdcModal(true);
      return;
    }

    // CASH Payment
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const res = await api.payOrder(
        order.id,
        'CASH',
        cashAmount
      );
      if (res.success) {
        onPaymentSuccess(res.order);
      } else {
        const msg = res.message || 'Pembayaran tunai belum berhasil.';
        setErrorMsg(msg);
        onPaymentFailed?.(msg);
      }
    } catch (err: any) {
      const msg = err.message || 'Gagal memproses pembayaran';
      setErrorMsg(msg);
      onPaymentFailed?.(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEdcPaymentSuccess = async (
    result: EdcProcessPaymentResult,
    _config: EdcConfiguration,
    paidType?: EdcPaymentType
  ) => {
    setIsProcessing(true);
    setShowEdcModal(false);
    setErrorMsg(null);

    let resolvedMethod = 'EDC_DEBIT';
    if (paidType === 'QRIS') {
      resolvedMethod = 'QRIS';
    } else if (paidType === 'CREDIT') {
      resolvedMethod = 'EDC_CREDIT';
    }

    const refParts = [
      result.approvalCode ? `APPR:${result.approvalCode}` : null,
      result.maskedCardNo ? `CARD:${result.maskedCardNo}` : null,
      result.referenceNumber ? `RRN:${result.referenceNumber}` : null,
      result.terminalId ? `TID:${result.terminalId}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    try {
      const res = await api.payOrder(
        order.id,
        resolvedMethod,
        order.totalAmount,
        refParts || (paidType === 'QRIS' ? 'EDC-QRIS-APPROVED' : 'EDC-APPROVED')
      );
      if (res.success) {
        onPaymentSuccess(res.order);
      } else {
        const msg = res.message || 'Gagal menyimpan konfirmasi pembayaran EDC.';
        setErrorMsg(msg);
        onPaymentFailed?.(msg);
      }
    } catch (err: any) {
      const msg = err.message || 'Gagal menyimpan transaksi EDC ke server.';
      setErrorMsg(msg);
      onPaymentFailed?.(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-emerald-800 tracking-wider uppercase">
                Penyelesaian Transaksi
              </span>
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                Pesanan <span className="text-amber-800 font-mono">{order.orderNumber}</span>
              </h2>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-slate-200/80 hover:bg-slate-300 flex items-center justify-center text-slate-600 hover:text-slate-900 transition cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6 bg-white">
            {/* Total Box */}
            <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-600 font-medium">Total Pembayaran (Termasuk PB1)</span>
                <div className="text-3xl font-black text-emerald-900 mt-0.5 font-mono">
                  Rp {order.totalAmount.toLocaleString('id-ID')}
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>
                  Pelanggan: <b className="text-slate-800">{order.customerName}</b>
                </div>
                <div>
                  Jumlah: <b className="text-slate-800">{order.items?.length || 0} Gelas</b>
                </div>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-2.5">
                Pilih Cara Pembayaran
              </label>
              <div className="grid grid-cols-3 gap-3">
                {/* 1. Cash */}
                <button
                  type="button"
                  onClick={() => setMethod('CASH')}
                  className={`py-3.5 px-3 rounded-2xl border-2 flex flex-col items-center gap-2 transition cursor-pointer ${method === 'CASH'
                      ? 'border-emerald-700 bg-emerald-50 text-emerald-900 shadow-2xs font-bold'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'
                    }`}
                >
                  <Banknote
                    size={22}
                    className={method === 'CASH' ? 'text-emerald-700' : 'text-slate-500'}
                  />
                  <span className="text-xs font-bold">Cash</span>
                </button>

                {/* 2. QRIS EDC */}
                <button
                  type="button"
                  onClick={() => {
                    setMethod('EDC_QRIS');
                    setEdcType('QRIS');
                  }}
                  className={`py-3.5 px-3 rounded-2xl border-2 flex flex-col items-center gap-2 transition cursor-pointer ${method === 'EDC_QRIS'
                      ? 'border-emerald-700 bg-emerald-50 text-emerald-900 shadow-2xs font-bold'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'
                    }`}
                >
                  <QrCode
                    size={22}
                    className={method === 'EDC_QRIS' ? 'text-emerald-700' : 'text-slate-500'}
                  />
                  <span className="text-xs font-bold">QRIS EDC</span>
                </button>

                {/* 3. EDC Kartu */}
                <button
                  type="button"
                  onClick={() => {
                    setMethod('EDC_DEBIT');
                    setEdcType('DEBIT');
                  }}
                  className={`py-3.5 px-3 rounded-2xl border-2 flex flex-col items-center gap-2 transition cursor-pointer ${method === 'EDC_DEBIT' || method === 'EDC_CREDIT'
                      ? 'border-emerald-700 bg-emerald-50 text-emerald-900 shadow-2xs font-bold'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'
                    }`}
                >
                  <CreditCard
                    size={22}
                    className={
                      method === 'EDC_DEBIT' || method === 'EDC_CREDIT'
                        ? 'text-emerald-700'
                        : 'text-slate-500'
                    }
                  />
                  <span className="text-xs font-bold">Kartu EDC</span>
                </button>
              </div>
            </div>

            {/* CASH View */}
            {method === 'CASH' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-1.5">
                    Nominal Tunai yang Diterima
                  </label>
                  <input
                    type="number"
                    value={cashAmount || ''}
                    onChange={(e) => setCashAmount(Number(e.target.value))}
                    className="w-full px-4 py-3.5 rounded-2xl bg-slate-50 border-2 border-slate-200 text-2xl font-black text-slate-900 font-mono focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>

                {/* Quick Presets */}
                <div className="flex flex-wrap gap-2">
                  {cashPresets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCashAmount(preset)}
                      className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 transition cursor-pointer border border-slate-200"
                    >
                      {preset === order.totalAmount ? 'Uang Pas' : `Rp ${preset.toLocaleString('id-ID')}`}
                    </button>
                  ))}
                </div>

                {/* Kembalian */}
                <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-700">Uang Kembalian</span>
                  <span className="text-xl font-black text-amber-900 font-mono">
                    Rp {change.toLocaleString('id-ID')}
                  </span>
                </div>
              </div>
            )}

            {/* QRIS EDC View */}
            {method === 'EDC_QRIS' && (
              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
                    <QrCode size={18} className="text-emerald-700" />
                    <span>QRIS Dinamis Mesin EDC</span>
                  </div>
                  <span className="text-[11px] text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full font-bold">
                    Otomatisasi ECR
                  </span>
                </div>

                <div className="p-4 bg-white rounded-xl border border-slate-200 text-center space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
                    <Smartphone size={24} />
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    Tampilkan QRIS di Layar Mesin EDC
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed max-w-sm mx-auto">
                    Sistem akan mengirim nominal <strong className="text-emerald-800 font-mono font-bold">Rp {order.totalAmount.toLocaleString('id-ID')}</strong> langsung ke terminal EDC. Kode QRIS resmi akan digenerate dan tampil di layar mesin EDC agar dipindai oleh pelanggan (BCA, GoPay, OVO, ShopeePay, Dana, dll).
                  </p>
                </div>
              </div>
            )}

            {/* EDC Kartu View (Debit vs Credit) */}
            {(method === 'EDC_DEBIT' || method === 'EDC_CREDIT') && (
              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
                    <Cpu size={16} className="text-emerald-700" />
                    <span>Integrasi Kartu Mesin EDC</span>
                  </div>
                  <span className="text-[11px] text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full font-bold">
                    Serial USB / LAN
                  </span>
                </div>

                {/* Sub-card selection: Debit vs Credit */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMethod('EDC_DEBIT');
                      setEdcType('DEBIT');
                    }}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition cursor-pointer text-center ${method === 'EDC_DEBIT'
                        ? 'border-emerald-700 bg-emerald-50 text-emerald-900 shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                  >
                    Kartu Debit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMethod('EDC_CREDIT');
                      setEdcType('CREDIT');
                    }}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition cursor-pointer text-center ${method === 'EDC_CREDIT'
                        ? 'border-emerald-700 bg-emerald-50 text-emerald-900 shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                  >
                    Kartu Kredit
                  </button>
                </div>

                <div className="p-3 bg-white rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
                  <div className="font-semibold text-slate-800">
                    Otomatisasi Kirim Nominal ke Mesin:
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Sistem akan mengirim nominal <strong className="text-emerald-800 font-mono">Rp {order.totalAmount.toLocaleString('id-ID')}</strong> langsung ke terminal EDC. Pelanggan cukup melakukan Tap, Insert (Chip), atau Gesek kartu di mesin.
                  </p>
                </div>
              </div>
            )}

            {/* Error Message */}
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Action Button */}
          <div className="p-4 bg-slate-50 border-t border-slate-200">
            <button
              type="button"
              onClick={handlePay}
              disabled={isProcessing || isInsufficient}
              className="w-full py-4 px-6 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-700/20 transition transform active:scale-98 cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  <span>Memverifikasi Pembayaran...</span>
                </>
              ) : method === 'EDC_QRIS' ? (
                <>
                  <QrCode size={20} />
                  <span>Tampilkan QRIS di Mesin EDC</span>
                </>
              ) : method === 'EDC_DEBIT' || method === 'EDC_CREDIT' ? (
                <>
                  <CreditCard size={20} />
                  <span>Buka Terminal EDC ({edcType === 'CREDIT' ? 'Kredit' : 'Debit'})</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={20} />
                  <span>Konfirmasi Pembayaran Lunas</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* EDC Processing Modal */}
      <EdcPaymentModal
        isOpen={showEdcModal}
        onClose={() => setShowEdcModal(false)}
        amount={order.totalAmount}
        initialPaymentType={edcType}
        invoiceNumber={order.orderNumber}
        customerName={order.customerName}
        onPaymentSuccess={handleEdcPaymentSuccess}
      />
    </>
  );
};
