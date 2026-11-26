// src/components/CupLabelPreviewModal.tsx
import React, { useEffect, useState } from 'react';
import { X, Printer, RefreshCw, ChevronLeft, ChevronRight, CheckCircle2, Tag } from 'lucide-react';
import { api, type Order } from '../services/api';

interface CupLabelPreviewModalProps {
  order: Order;
  onClose: () => void;
}

export const CupLabelPreviewModal: React.FC<CupLabelPreviewModalProps> = ({
  order,
  onClose,
}) => {
  const [labels, setLabels] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isReprinting, setIsReprinting] = useState(false);
  const [reprintSuccessMsg, setReprintSuccessMsg] = useState<string | null>(null);

  const fetchPreviews = async () => {
    setIsLoading(true);
    try {
      const data = await api.getCupLabelsPreview(order.id);
      setLabels(data.labels || []);
    } catch {
      // fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPreviews();
  }, [order.id]);

  const handleReprint = async () => {
    setIsReprinting(true);
    setReprintSuccessMsg(null);
    try {
      const res = await api.reprintCupLabels(order.id);
      setReprintSuccessMsg(`Berhasil mengirim ${res.reprintedLabelsCount} stiker ke printer queue dengan penanda [REPRINT]`);
      await fetchPreviews();
    } catch (err: any) {
      alert(err.message || 'Gagal reprint');
    } finally {
      setIsReprinting(false);
    }
  };

  const currentLabel = labels[selectedIndex];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag size={20} className="text-emerald-800" />
            <h2 className="text-base font-bold text-slate-900">
              Preview Cup Sticker — <span className="text-amber-800 font-mono">{order.orderNumber}</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-200/80 hover:bg-slate-300 flex items-center justify-center text-slate-600 hover:text-slate-900 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col items-center bg-white">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center gap-2 text-slate-400">
              <RefreshCw className="animate-spin text-emerald-800" size={24} />
              <span className="text-xs">Memuat tata letak stiker...</span>
            </div>
          ) : labels.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              Belum ada stiker yang di-generate untuk pesanan ini.
            </div>
          ) : (
            <div className="w-full flex flex-col items-center">
              {/* Cup Carousel Navigation */}
              <div className="w-full flex items-center justify-between mb-4 text-xs font-bold text-slate-700">
                <span>Gelas {selectedIndex + 1} dari {labels.length}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
                    disabled={selectedIndex === 0}
                    className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-slate-700 cursor-pointer border border-slate-200"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIndex(Math.min(labels.length - 1, selectedIndex + 1))}
                    disabled={selectedIndex === labels.length - 1}
                    className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-slate-700 cursor-pointer border border-slate-200"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              {/* Realistic Paper Cup Sticker Frame */}
              <div className="p-5 bg-slate-100 rounded-2xl border border-slate-200 shadow-inner flex items-center justify-center w-full">
                <div
                  dangerouslySetInnerHTML={{ __html: currentLabel.htmlPreview }}
                  className="shadow-md border border-dashed border-slate-300 rounded-md transition transform hover:scale-105 duration-150"
                />
              </div>

              {/* Status Pill */}
              <div className="mt-4 flex items-center gap-2 text-xs">
                <span className="text-slate-500 font-medium">Status Print Queue:</span>
                <span className={`px-2.5 py-0.5 rounded-full font-bold uppercase text-[10px] ${
                  currentLabel.status === 'COMPLETED'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}>
                  {currentLabel.status}
                </span>
                {currentLabel.isReprint && (
                  <span className="px-2.5 py-0.5 rounded-full font-bold uppercase text-[10px] bg-red-50 text-red-800 border border-red-200">
                    REPRINT
                  </span>
                )}
              </div>
            </div>
          )}

          {reprintSuccessMsg && (
            <div className="mt-4 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-700 shrink-0" />
              <span>{reprintSuccessMsg}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
          <button
            type="button"
            onClick={handleReprint}
            disabled={isReprinting}
            className="flex-1 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
          >
            <Printer size={16} />
            <span>{isReprinting ? 'Mengirim ke Antrean...' : 'Cetak Ulang (REPRINT)'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
