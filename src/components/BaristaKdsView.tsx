// src/components/BaristaKdsView.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  CheckCircle,
  Tag,
  Coffee,
  Volume2,
  VolumeX,
  Radio,
  BellRing,
  RotateCcw,
  Sparkles,
  Search,
  CheckCheck,
} from 'lucide-react';
import { api, type Order } from '../services/api';
import { CupLabelPreviewModal } from './CupLabelPreviewModal';
import { pagerAudio } from '../utils/pagerAudio';

interface BaristaKdsViewProps {
  orders: Order[];
  onOrderUpdated: () => void;
}

export const BaristaKdsView: React.FC<BaristaKdsViewProps> = ({ orders, onOrderUpdated }) => {
  const [selectedPreviewOrder, setSelectedPreviewOrder] = useState<Order | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(() => pagerAudio.getIsMuted());
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PREPARING' | 'READY'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Calling timer tick
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    pagerAudio.setMuted(next);
  };

  // Active orders in Barista Station (exclude COMPLETED or CANCELLED)
  const activeOrders = useMemo(() => {
    return orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED');
  }, [orders]);

  const callingOrders = useMemo(() => {
    return activeOrders.filter(o => o.status === 'READY');
  }, [activeOrders]);

  const preparingOrders = useMemo(() => {
    return activeOrders.filter(o => o.status !== 'READY');
  }, [activeOrders]);

  // Filtered orders based on selected tab and search query
  const filteredOrders = useMemo(() => {
    return activeOrders.filter(o => {
      // Tab filter
      if (statusFilter === 'PREPARING' && o.status === 'READY') return false;
      if (statusFilter === 'READY' && o.status !== 'READY') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesOrder = o.orderNumber?.toLowerCase().includes(q);
        const matchesCustomer = o.customerName?.toLowerCase().includes(q);
        const matchesPager = o.pagerNumber?.toLowerCase().includes(q);
        return matchesOrder || matchesCustomer || matchesPager;
      }
      return true;
    });
  }, [activeOrders, statusFilter, searchQuery]);

  const handleCallPager = async (order: Order) => {
    setUpdatingId(order.id);
    try {
      // 1. Play realistic guest pager buzzer chime
      pagerAudio.playPagerChime();

      // 2. Advance to READY (Calling Pager state)
      await api.updateOrderStatus(order.id, 'READY');
      onOrderUpdated();
    } catch (err: any) {
      alert(err.message || 'Gagal memanggil pager');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleReCallPager = (_order: Order) => {
    pagerAudio.playPagerChime();
  };

  const handleCompleteOrder = async (order: Order) => {
    setUpdatingId(order.id);
    try {
      await api.updateOrderStatus(order.id, 'COMPLETED');
      onOrderUpdated();
    } catch (err: any) {
      alert(err.message || 'Gagal menyelesaikan pesanan');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCompleteAllCalling = async () => {
    if (!confirm(`Selesaikan dan kembalikan semua (${callingOrders.length}) pager yang sedang berbunyi?`)) return;
    try {
      for (const ord of callingOrders) {
        await api.updateOrderStatus(ord.id, 'COMPLETED');
      }
      onOrderUpdated();
    } catch (err: any) {
      alert(err.message || 'Gagal memproses batch');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-100/70 p-5 overflow-hidden font-['Inter',sans-serif]">
      {/* Header Info & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 shrink-0 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs shrink-0">
            <Radio size={20} className="text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black text-slate-900 tracking-tight">Station Pager Barista</h1>
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-bold border border-amber-200">
                Grab & Go
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Panggil tamu via coaster pager saat pesanan siap diambil di bar
            </p>
          </div>
        </div>

        {/* Filters, Search & Dock Monitor */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Status Filter Chips */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                statusFilter === 'ALL'
                  ? 'bg-emerald-800 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Semua ({activeOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('PREPARING')}
              className={`px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'PREPARING'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Coffee size={13} />
              <span>Dibuat ({preparingOrders.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('READY')}
              className={`px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'READY'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BellRing size={13} className={callingOrders.length > 0 ? 'animate-bounce' : ''} />
              <span>Memanggil ({callingOrders.length})</span>
            </button>
          </div>

          {/* Quick Search */}
          <div className="relative w-44">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari pager / nama..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-600 focus:bg-white transition"
            />
          </div>

          {/* Buzzer Sound Toggle */}
          <button
            type="button"
            onClick={toggleMute}
            className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              isMuted
                ? 'bg-slate-200 text-slate-500 border-slate-300'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 shadow-2xs'
            }`}
            title={isMuted ? 'Buzzer dibisukan (Klik untuk aktifkan)' : 'Buzzer aktif'}
          >
            {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} className="text-emerald-700" />}
            <span>{isMuted ? 'Buzzer Off' : 'Buzzer On'}</span>
          </button>

          {/* Batch complete calling pagers if any */}
          {callingOrders.length > 1 && (
            <button
              type="button"
              onClick={handleCompleteAllCalling}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Selesaikan semua pager yang sedang berbunyi"
            >
              <CheckCheck size={14} className="text-emerald-400" />
              <span>Kembalikan Semua ({callingOrders.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Orders Grid Area */}
      {filteredOrders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-white/70 rounded-3xl border border-dashed border-slate-300 p-8">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3 shadow-2xs">
            <Sparkles size={28} className="text-emerald-700" />
          </div>
          <p className="text-base font-bold text-slate-800">
            {activeOrders.length === 0
              ? 'Semua Pager Sudah Selesai'
              : 'Tidak ada pesanan yang sesuai filter'}
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm text-center">
            {activeOrders.length === 0
              ? 'Pesanan baru dari kasir akan otomatis muncul dengan nomor coaster pager yang ditugaskan ke tamu.'
              : 'Ganti filter atau bersihkan pencarian untuk melihat pesanan lainnya.'}
          </p>
          {activeOrders.length > 0 && (
            <button
              type="button"
              onClick={() => { setStatusFilter('ALL'); setSearchQuery(''); }}
              className="mt-3 text-xs font-bold text-emerald-800 hover:underline cursor-pointer"
            >
              Reset Filter
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-12 items-start auto-rows-max">
            {filteredOrders.map(order => {
              const isReady = order.status === 'READY';
              const isPreparing = order.status === 'PREPARING';
              const timeAgo = Math.max(1, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000));

              return (
                <div
                  key={order.id}
                  className={`min-h-[340px] rounded-2xl border-2 flex flex-col justify-between shadow-sm transition bg-white shrink-0 overflow-hidden ${
                    isReady
                      ? 'border-emerald-500 ring-4 ring-emerald-500/20 shadow-emerald-100'
                      : isPreparing
                      ? 'border-blue-500 shadow-blue-100'
                      : 'border-slate-300'
                  }`}
                >
                  {/* Coaster Pager Top Header */}
                  <div
                    className={`p-3.5 border-b flex items-center justify-between shrink-0 ${
                      isReady
                        ? 'bg-emerald-50/90 border-emerald-100'
                        : isPreparing
                        ? 'bg-blue-50/70 border-blue-100'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    {/* Coaster Pager Disc Icon + Number */}
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-13 h-13 rounded-2xl flex flex-col items-center justify-center font-mono font-black border transition shrink-0 ${
                          isReady
                            ? 'bg-emerald-700 text-white border-emerald-600 shadow-md shadow-emerald-700/30 animate-pulse'
                            : isPreparing
                            ? 'bg-slate-900 text-white border-slate-800'
                            : 'bg-slate-800 text-white border-slate-700'
                        }`}
                      >
                        <span className="text-[8px] font-sans font-bold uppercase tracking-wider text-emerald-300">
                          PAGER
                        </span>
                        <span className="text-xl leading-none font-bold">
                          #{order.pagerNumber || '—'}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <div className="text-sm font-black text-slate-900 font-mono tracking-tight truncate">
                          {order.orderNumber}
                        </div>
                        <div className="text-xs font-semibold text-slate-600 truncate mt-0.5">
                          Tamu: <b className="text-slate-900">{order.customerName}</b>
                        </div>
                      </div>
                    </div>

                    {/* Status Indicator */}
                    <div className="text-right shrink-0">
                      {isReady ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-emerald-600 text-white shadow-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                          <span>MEMANGGIL</span>
                        </span>
                      ) : isPreparing ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-blue-100 text-blue-800 border border-blue-200">
                          Sedang Dibuat
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200">
                          Antrean
                        </span>
                      )}

                      <div className="flex items-center justify-end gap-1 font-mono text-[11px] text-slate-500 mt-1">
                        <Clock size={12} />
                        <span>{timeAgo}m lalu</span>
                      </div>
                    </div>
                  </div>

                  {/* Beverage Items List (scrollable if many drinks, but maintains min-height) */}
                  <div className="p-3.5 flex-1 min-h-[140px] space-y-2 overflow-y-auto max-h-56 bg-white">
                    {order.items?.map((item, idx) => (
                      <div key={item.id || idx} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                        <div className="flex items-start justify-between gap-2 text-xs font-bold text-slate-900">
                          <span className="leading-tight">
                            {item.quantity}x {item.productName}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-white text-emerald-800 border border-emerald-200 shadow-2xs font-mono shrink-0">
                            {item.variantSize}
                          </span>
                        </div>

                        {/* Modifiers List */}
                        {item.modifiers && item.modifiers.length > 0 && (
                          <div className="mt-1.5 space-y-0.5 pl-2 border-l-2 border-emerald-600">
                            {item.modifiers.map(mod => (
                              <div key={mod.optionId} className="text-[11px] font-semibold text-slate-600">
                                • {mod.optionName}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Barista Notes */}
                        {item.notes && (
                          <div className="mt-1.5 text-[10px] text-amber-900 font-bold bg-amber-50 p-1.5 rounded border border-amber-200">
                            NB: {item.notes}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Card Footer Actions */}
                  <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center gap-2 shrink-0">
                    {/* Cup Sticker Preview Button */}
                    <button
                      type="button"
                      onClick={() => setSelectedPreviewOrder(order)}
                      className="p-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 transition cursor-pointer shadow-2xs"
                      title="Preview & Cetak Ulang Cup Sticker"
                    >
                      <Tag size={16} />
                    </button>

                    {/* Primary Workflow Actions */}
                    {isReady ? (
                      /* Ready state: Re-call or Return Pager */
                      <div className="flex-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleReCallPager(order)}
                          className="py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-98"
                          title="Bunyikan ulang buzzer pager"
                        >
                          <RotateCcw size={14} />
                          <span>Panggil</span>
                        </button>

                        <button
                          type="button"
                          disabled={updatingId === order.id}
                          onClick={() => handleCompleteOrder(order)}
                          className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-98"
                        >
                          <CheckCircle size={15} />
                          <span>Pager Kembali</span>
                        </button>
                      </div>
                    ) : (
                      /* Preparing / Pending state: Call Pager */
                      <button
                        type="button"
                        disabled={updatingId === order.id}
                        onClick={() => handleCallPager(order)}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-98 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-700/20 transition cursor-pointer"
                      >
                        <BellRing size={15} className="animate-bounce" />
                        <span>PANGGIL PAGER #{order.pagerNumber || order.orderNumber}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cup Sticker Preview Modal */}
      {selectedPreviewOrder && (
        <CupLabelPreviewModal
          order={selectedPreviewOrder}
          onClose={() => setSelectedPreviewOrder(null)}
        />
      )}
    </div>
  );
};

