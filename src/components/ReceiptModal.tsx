import React, { useRef, useState } from 'react';
import { X, Printer, ArrowRight, CheckCircle2, Receipt, ShieldCheck, Loader2 } from 'lucide-react';
import { SakuPosLogo } from './SakuPosLogo';
import type { Order } from '../services/api';

interface ReceiptModalProps {
  order: Order;
  onClose: () => void;
  onProceedToCupLabels?: (order: Order) => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  order,
  onClose,
  onProceedToCupLabels,
}) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printNotice, setPrintNotice] = useState<string | null>(null);

  const formatRp = (num: number) => `Rp ${num.toLocaleString('id-ID')}`;

  const handlePrint = async () => {
    setIsPrinting(true);
    setPrintNotice(null);
    try {
      const win = window as any;
      if (win.electronAPI?.printReceipt && receiptRef.current) {
        const res = await win.electronAPI.printReceipt({
          htmlContent: receiptRef.current.innerHTML,
          copies: 2,
        });
        if (res?.success) {
          setPrintNotice('Struk dicetak (2x: Konsumen & Toko)');
        } else {
          setPrintNotice(res?.message || 'Gagal cetak');
        }
      } else {
        window.print();
      }
    } catch (err: any) {
      console.error('Gagal cetak struk:', err);
      setPrintNotice(err?.message || 'Error cetak');
    } finally {
      setIsPrinting(false);
    }
  };

  const formattedDate = new Date(order.createdAt).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const formattedTime = new Date(order.createdAt).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const paymentMethodLabel = (() => {
    switch (order.paymentMethod) {
      case 'CASH':
        return 'UANG TUNAI (CASH)';
      case 'QRIS':
      case 'EDC_QRIS':
        return 'QRIS DINAMIS EDC';
      case 'EDC_DEBIT':
        return 'KARTU DEBIT EDC';
      case 'EDC_CREDIT':
        return 'KARTU KREDIT EDC';
      default:
        return order.paymentMethod || 'TUNAI';
    }
  })();

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh]">
        {/* Modal Header */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <Receipt size={18} />
            </div>
            <div>
              <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                Struk Pembelian
              </span>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                Pesanan <span className="text-amber-800 font-mono">{order.orderNumber}</span>
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-200/80 hover:bg-slate-300 flex items-center justify-center text-slate-600 hover:text-slate-900 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Thermal Receipt Body (Scrollable preview & Print container) */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-100 flex justify-center">
          <div
            ref={receiptRef}
            id="printable-receipt"
            className="w-full max-w-[340px] bg-white p-5 rounded-xl shadow-xs border border-slate-200 text-slate-800 font-mono text-[11px] leading-relaxed flex flex-col"
          >
            {/* Store Brand Header */}
            <div className="text-center pb-3 border-b border-dashed border-slate-300">
              <div className="flex justify-center mb-1.5">
                <SakuPosLogo height={24} />
              </div>
              <div className="font-bold text-xs text-slate-900 tracking-wider">
                GRAB & GO
              </div>

              <div className="text-[10px] text-slate-500">
                Outlet Kopi &amp; Layanan Grab &amp; Go • Kasir Lokal
              </div>
            </div>

            {/* Receipt Meta */}
            <div className="py-2.5 border-b border-dashed border-slate-300 space-y-0.5 text-[10px]">
              <div className="flex justify-between">
                <span className="text-slate-500">No. Struk</span>
                <span className="font-bold text-slate-900">{order.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Waktu</span>
                <span>{formattedDate} {formattedTime}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Kasir / Terminal</span>
                <span>{order.cashierName || 'Kasir'} / {order.terminalId || 'POS-01'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Pelanggan</span>
                <span className="font-bold text-slate-900">{order.customerName || 'Walk-in'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Layanan</span>
                <span className="font-bold uppercase text-emerald-800">
                  {order.diningOption === 'dinein' ? 'DINE IN' : 'TAKE AWAY'}
                </span>
              </div>
            </div>

            {/* Pager Highlight Box */}
            {order.pagerNumber && (
              <div className="my-2.5 p-2.5 bg-slate-900 text-white rounded-xl text-center space-y-0.5 shadow-xs">
                <div className="text-[9px] font-black tracking-widest text-emerald-400 uppercase">
                  NO. GUEST PAGER
                </div>
                <div className="text-2xl font-black font-mono tracking-wider text-white">
                  #{order.pagerNumber}
                </div>
                <div className="text-[8.5px] text-slate-300 leading-tight">
                  Simpan pager ini. Pager akan bergetar & berbunyi saat minuman siap diambil.
                </div>
              </div>
            )}

            {/* Items List */}
            <div className="py-3 border-b border-dashed border-slate-300 space-y-2">
              {(order.items || []).map((item, idx) => (
                <div key={item.id || idx} className="space-y-0.5">
                  <div className="flex justify-between font-semibold text-slate-900">
                    <span className="truncate pr-2">
                      {item.quantity}x {item.productName} ({item.variantSize})
                    </span>
                    <span className="shrink-0">{formatRp(item.subtotal)}</span>
                  </div>

                  {/* Modifiers */}
                  {item.modifiers && item.modifiers.length > 0 && (
                    <div className="pl-3 text-[10px] text-slate-500 space-y-0.5">
                      {item.modifiers.map((mod, mIdx) => (
                        <div key={mIdx} className="flex justify-between">
                          <span>• {mod.optionName}</span>
                          {mod.price > 0 && <span>+{formatRp(mod.price)}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  {item.notes && (
                    <div className="pl-3 text-[10px] text-amber-700 italic">
                      NB: {item.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Calculations & Totals */}
            <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1 text-[11px]">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span>{formatRp(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Pajak Restoran PB1 (10%)</span>
                <span>{formatRp(order.tax)}</span>
              </div>
              <div className="flex justify-between font-bold text-xs text-slate-900 pt-1 border-t border-slate-200">
                <span>TOTAL AKHIR</span>
                <span className="text-emerald-900">{formatRp(order.totalAmount)}</span>
              </div>
            </div>

            {/* Payment Details */}
            <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1 text-[10px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Cara Bayar</span>
                <span className="font-bold text-slate-900">{paymentMethodLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status Pembayaran</span>
                <span className="font-bold text-emerald-700 uppercase">
                  {order.paymentStatus === 'PAID' ? 'LUNAS' : order.paymentStatus}
                </span>
              </div>
              {order.paymentRef && (
                <div className="text-[9px] text-slate-500 pt-1 break-words font-sans bg-slate-50 p-1.5 rounded border border-slate-200">
                  <div className="font-semibold text-slate-700 mb-0.5 flex items-center gap-1">
                    <ShieldCheck size={11} className="text-emerald-600" />
                    <span>Referensi Transaksi EDC:</span>
                  </div>
                  <span>{order.paymentRef}</span>
                </div>
              )}
            </div>

            {/* Footer Message & Barcode */}
            <div className="text-center pt-3 space-y-1 text-[10px] text-slate-500">
              <div className="font-bold text-slate-700">
                Terima Kasih Atas Kunjungan Anda
              </div>
              <p className="text-[9px] leading-tight text-slate-400">
                Simpan struk ini sebagai bukti pembayaran yang sah.
              </p>
              <div className="pt-2 font-mono text-[9px] text-slate-400 tracking-widest uppercase">
                * {order.orderNumber} *
              </div>
              <div className="text-[9px] text-emerald-800 font-semibold tracking-wider pt-0.5">
                TERIMA KASIH • SAKUPOS - COFFEE
              </div>
            </div>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs flex items-center gap-2 transition cursor-pointer shadow-2xs disabled:opacity-60"
            >
              {isPrinting ? (
                <Loader2 size={16} className="animate-spin text-emerald-700" />
              ) : (
                <Printer size={16} />
              )}
              <span>{isPrinting ? 'Mencetak (2x)...' : 'Cetak Struk (2x)'}</span>
            </button>
            {printNotice && (
              <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 animate-in fade-in duration-200">
                {printNotice}
              </span>
            )}
          </div>

          {onProceedToCupLabels ? (
            <button
              type="button"
              onClick={() => onProceedToCupLabels(order)}
              className="py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center gap-2 transition cursor-pointer shadow-md shadow-emerald-800/20 active:scale-98"
            >
              <span>Lanjut ke Cetak Sticker Cup</span>
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer"
            >
              Selesai
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
