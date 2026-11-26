// src/components/CustomerDisplayView.tsx
import React, { useState, useEffect } from 'react';
import {
  ShoppingBag,
  Coffee,
  QrCode,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Leaf,
  Banknote,
  CreditCard,
  Smartphone,
  ShieldCheck,
  Cpu,
} from 'lucide-react';
import { SakuPosLogo } from './SakuPosLogo';

export interface DisplayCartItem {
  uid: string;
  productName: string;
  variantSize: 'Regular' | 'Large';
  unitPrice: number;
  quantity: number;
  subtotal: number;
  notes?: string;
  modifiers?: { optionName: string }[];
}

export interface DisplayPaymentState {
  status: 'IDLE' | 'PAYMENT_PENDING' | 'PAYMENT_SUCCESS' | 'PAYMENT_FAILED' | 'PAYMENT_UNKNOWN';
  orderNumber?: string;
  totalAmount?: number;
  paymentMethod?: string;
  pagerNumber?: string;
  qrisUrl?: string;
  message?: string;
}

import { cdsConfigStorage, type AdSlide } from '../services/cdsConfigStorage';

export const CustomerDisplayView: React.FC = () => {
  // 1. Transaction State (Strict source of truth from Cashier POS)
  const [cart, setCart] = useState<DisplayCartItem[]>([]);
  const [customerName, setCustomerName] = useState('Walk-in');
  const [diningOption, setDiningOption] = useState<'takeaway' | 'dinein'>('takeaway');
  const [discountAmount, setDiscountAmount] = useState(0);
  const [paymentState, setPaymentState] = useState<DisplayPaymentState>({ status: 'IDLE' });

  // 2. Advertising Slides State from dynamic configuration
  const [slides, setSlides] = useState<AdSlide[]>(() => cdsConfigStorage.getSlides());
  const [intervalSec, setIntervalSec] = useState<number>(() => cdsConfigStorage.getIntervalSeconds());
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [imageErrorMap, setImageErrorMap] = useState<Record<string, boolean>>({});

  // Slide Rotation Timer (Uses configured interval)
  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentSlideIndex((prevIndex) => (prevIndex + 1) % slides.length);
    }, intervalSec * 1000);

    return () => clearInterval(timer);
  }, [slides.length, intervalSec]);

  // Synchronize State via BroadcastChannel and Electron IPC
  useEffect(() => {
    // 1. Initial snapshot from localStorage
    try {
      const saved = localStorage.getItem('sakupos_cds_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.cart) setCart(parsed.cart);
        if (parsed.customerName) setCustomerName(parsed.customerName);
        if (parsed.diningOption) setDiningOption(parsed.diningOption);
        if (parsed.discountAmount) setDiscountAmount(parsed.discountAmount);
        if (parsed.paymentState) setPaymentState(parsed.paymentState);
      }
    } catch {
      // ignore
    }

    // 2. BroadcastChannel for browser & Electron zero-latency sharing
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('sakupos_cds');
      channel.onmessage = (event) => {
        const { type, payload } = event.data;
        handleSyncMessage(type, payload);
      };
      // Request fresh snapshot on mount
      channel.postMessage({ type: 'REQUEST_SNAPSHOT' });
    } catch {
      // fallback
    }

    // 3. Electron IPC listener if running in Electron
    let removeIpcListener: (() => void) | undefined;
    if ((window as any).electronAPI?.onCdsMessage) {
      removeIpcListener = (window as any).electronAPI.onCdsMessage((data: any) => {
        if (data?.type) {
          handleSyncMessage(data.type, data.payload);
        }
      });
    }

    function handleSyncMessage(type: string, payload: any) {
      if (type === 'SYNC_CART') {
        setCart(payload.cart || []);
        setCustomerName(payload.customerName || 'Walk-in');
        setDiningOption(payload.diningOption || 'takeaway');
        setDiscountAmount(payload.discount || 0);
        // Reset payment state to IDLE if actively modifying cart
        if (payload.cart && payload.cart.length > 0) {
          setPaymentState((prev) => (prev.status === 'PAYMENT_PENDING' ? prev : { status: 'IDLE' }));
        } else {
          setPaymentState({ status: 'IDLE' });
        }
      } else if (type === 'PAYMENT_PENDING') {
        setPaymentState({
          status: 'PAYMENT_PENDING',
          orderNumber: payload.orderNumber,
          totalAmount: payload.totalAmount,
          paymentMethod: payload.paymentMethod,
          qrisUrl: payload.qrisUrl,
          message: payload.message,
        });
      } else if (type === 'PAYMENT_SUCCESS') {
        setPaymentState({
          status: 'PAYMENT_SUCCESS',
          orderNumber: payload.orderNumber,
          totalAmount: payload.totalAmount,
          pagerNumber: payload.pagerNumber,
        });
        // Auto reset to idle after 8 seconds
        setTimeout(() => {
          setCart([]);
          setPaymentState({ status: 'IDLE' });
        }, 8000);
      } else if (type === 'PAYMENT_FAILED') {
        setPaymentState({
          status: 'PAYMENT_FAILED',
          message: payload.message || 'Pembayaran tidak berhasil.',
        });
      } else if (type === 'PAYMENT_UNKNOWN') {
        setPaymentState({
          status: 'PAYMENT_UNKNOWN',
          message: payload.message || 'Menunggu verifikasi pembayaran...',
        });
      } else if (type === 'CLEAR_CART' || type === 'RESET_IDLE') {
        setCart([]);
        setCustomerName('Walk-in');
        setDiscountAmount(0);
        setPaymentState({ status: 'IDLE' });
      } else if (type === 'UPDATE_SLIDES' && payload?.slides) {
        setSlides(payload.slides);
        if (payload.intervalSeconds) setIntervalSec(payload.intervalSeconds);
        setCurrentSlideIndex(0);
      }
    }

    return () => {
      if (channel) channel.close();
      if (removeIpcListener) removeIpcListener();
    };
  }, []);

  const formatRp = (num: number) => `Rp ${num.toLocaleString('id-ID')}`;

  const subtotal = cart.reduce((acc, item) => acc + item.subtotal, 0);
  const tax = Math.round((subtotal - discountAmount) * 0.1);
  const total = Math.max(0, subtotal - discountAmount + tax);

  // Helper to pick appropriate thumbnail based on item name
  const getItemThumbnail = (productName: string) => {
    const lower = productName.toLowerCase();
    if (lower.includes('matcha') || lower.includes('green') || lower.includes('tea')) {
      return '/images/cup_matcha.png';
    }
    return '/images/cup_aren.png';
  };

  return (
    <div
      className="customer-display"
      style={{
        display: 'grid',
        gridTemplateColumns: '30% 70%',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        margin: 0,
        padding: 0,
        boxSizing: 'border-box',
        backgroundColor: '#EDE8DE',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        userSelect: 'none',
      }}
    >
      {/* ========================================================
          LEFT PANEL (30%): ORDER SUMMARY
          Palette: Warm Neutral Linen / Ivory (#EDE8DE)
          Typography: Serif Heading, Charcoal (#1F2E23), Muted (#6D736A)
          ======================================================== */}
      <div
        className="order-panel"
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          backgroundColor: '#EDE8DE',
          color: '#1F2E23',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '36px 32px 28px 36px',
          boxSizing: 'border-box',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Top: Header & Order Title */}
        <div className="shrink-0">
          {/* Logo & Dining Option Row */}
          <div className="flex items-center justify-between">
            <SakuPosLogo height={24} variant="light" />
            <div className="flex items-center gap-1.5 text-xs text-[#1F2E23] font-medium tracking-wide">
              <span>{diningOption === 'dinein' ? 'Dine In' : 'Takeaway'}</span>
              {diningOption === 'dinein' ? (
                <Coffee size={14} strokeWidth={1.75} className="text-[#1F2E23]" />
              ) : (
                <ShoppingBag size={14} strokeWidth={1.75} className="text-[#1F2E23]" />
              )}
            </div>
          </div>

          {/* Heading */}
          <div className="mt-8">
            <h4
              className="font-editorial text-[28px] lg:text-[32px] font-normal text-[#1F2E23] leading-none tracking-tight"
              style={{
                fontFamily: "'Playfair Display', 'Newsreader', Georgia, 'Times New Roman', serif",
              }}
            >
              Pesanan Anda
            </h4>
            <p className="text-xs text-[#6D736A] mt-2 font-normal">
              Racikan kopi segar untuk setiap momen Anda.
            </p>
          </div>
        </div>

        {/* Center: Dynamic Cart Items or State Overlays */}
        <div className="flex-1 min-h-0 my-4 overflow-y-auto pr-1">
          {paymentState.status === 'PAYMENT_PENDING' ? (
            /* EDC Payment View (QRIS EDC, EDC Card, or Cash) */
            <div className="h-full flex flex-col items-center justify-center text-center py-4">
              {paymentState.paymentMethod === 'CASH' ? (
                /* Cash Mode */
                <>
                  <div className="w-12 h-12 rounded-full bg-[#E2DCD0] text-[#1F2E23] flex items-center justify-center mb-2.5">
                    <Banknote size={24} strokeWidth={1.5} />
                  </div>
                  <h3 className="text-sm font-semibold text-[#1F2E23]">Pembayaran Uang Tunai</h3>
                  <p className="text-[11px] text-[#6D736A] mt-0.5 max-w-[210px] leading-relaxed">
                    Silakan serahkan uang tunai sebesar nominal berikut kepada kasir.
                  </p>
                </>
              ) : paymentState.paymentMethod === 'EDC_DEBIT' || paymentState.paymentMethod === 'EDC_CREDIT' ? (
                /* Card Mode */
                <>
                  <div className="w-12 h-12 rounded-full bg-[#E2DCD0] text-[#1F2E23] flex items-center justify-center mb-2.5">
                    <CreditCard size={24} strokeWidth={1.5} />
                  </div>
                  <h3 className="text-sm font-semibold text-[#1F2E23]">Pembayaran Kartu EDC</h3>
                  <p className="text-[11px] text-[#6D736A] mt-0.5 max-w-[220px] leading-relaxed">
                    Silakan <strong>Tap (Contactless)</strong> atau <strong>Masukkan Kartu (Chip)</strong> pada mesin EDC kasir.
                  </p>
                  <div className="mt-3 p-3 bg-white rounded-2xl border border-[#DCD6C9] shadow-xs w-full max-w-[230px]">
                    <div className="flex items-center justify-between text-[10px] font-bold text-[#6D736A] tracking-wider uppercase mb-1">
                      <span>Mesin EDC</span>
                      <span className="flex items-center gap-1 text-[#203B2D]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                        Menunggu Kartu
                      </span>
                    </div>
                    <div className="text-[11px] text-[#203B2D] font-medium mt-1">
                      Debit & Kredit (GPN / Visa / Mastercard)
                    </div>
                  </div>
                </>
              ) : (
                /* QRIS EDC Mode (Default) */
                <>
                  <div className="w-12 h-12 rounded-full bg-[#E2DCD0] text-[#1F2E23] flex items-center justify-center mb-2.5">
                    <QrCode size={24} strokeWidth={1.5} />
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#E8EFEA] text-[10px] font-bold text-[#203B2D] mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                    QRIS Dinamis Mesin EDC
                  </div>
                  <h3 className="text-sm font-semibold text-[#1F2E23]">Silakan Scan QRIS pada Mesin EDC</h3>
                  <p className="text-[11px] text-[#6D736A] mt-0.5 max-w-[220px] leading-relaxed">
                    Kode QRIS resmi sedang ditampilkan di layar mesin EDC kasir.
                  </p>

                  <div className="mt-3 p-3.5 bg-white rounded-2xl border border-[#DCD6C9] shadow-xs w-full max-w-[240px] text-center space-y-2">
                    <div className="flex items-center justify-between border-b border-[#EAE4D7] pb-1.5 text-[10px] font-bold text-[#6D736A] tracking-wider uppercase">
                      <span>Terminal EDC</span>
                      <span className="text-[#203B2D] font-mono text-[10px]">Siap Pindai</span>
                    </div>

                    <div className="py-1 flex flex-col items-center justify-center">
                      <div className="w-12 h-12 rounded-xl bg-[#E8EFEA] text-[#203B2D] flex items-center justify-center mb-1.5 shadow-xs">
                        <QrCode size={24} strokeWidth={1.75} />
                      </div>
                      <span className="text-xs font-bold text-[#1F2E23]">QRIS di Mesin EDC</span>
                      <span className="text-[10px] text-[#6D736A]">Arahkan kamera ke layar mesin EDC</span>
                    </div>

                    <div className="pt-2 border-t border-[#EAE4D7] flex flex-wrap items-center justify-center gap-1">
                      <span className="px-1.5 py-0.5 rounded bg-[#F4F1EA] text-[9px] font-semibold text-[#1F2E23]">BCA</span>
                      <span className="px-1.5 py-0.5 rounded bg-[#F4F1EA] text-[9px] font-semibold text-[#1F2E23]">Mandiri</span>
                      <span className="px-1.5 py-0.5 rounded bg-[#F4F1EA] text-[9px] font-semibold text-[#1F2E23]">GoPay</span>
                      <span className="px-1.5 py-0.5 rounded bg-[#F4F1EA] text-[9px] font-semibold text-[#1F2E23]">OVO</span>
                      <span className="px-1.5 py-0.5 rounded bg-[#F4F1EA] text-[9px] font-semibold text-[#1F2E23]">ShopeePay</span>
                      <span className="px-1.5 py-0.5 rounded bg-[#F4F1EA] text-[9px] font-semibold text-[#1F2E23]">Dana</span>
                    </div>
                  </div>
                </>
              )}

              <div className="mt-3.5 text-xs text-[#6D736A]">Total yang Harus Dibayar:</div>
              <div className="text-xl font-bold text-[#1F2E23] font-mono mt-0.5">
                {formatRp(paymentState.totalAmount || total)}
              </div>
            </div>
          ) : paymentState.status === 'PAYMENT_SUCCESS' ? (
            /* Payment Success View */
            <div className="h-full flex flex-col items-center justify-center text-center py-4">
              <div className="w-12 h-12 rounded-full bg-[#E0E9E2] text-[#203B2D] flex items-center justify-center mb-3">
                <CheckCircle2 size={26} strokeWidth={1.75} />
              </div>
              <h3 className="text-base font-semibold text-[#1F2E23]">Pembayaran Berhasil</h3>
              <p className="text-xs text-[#6D736A] mt-1 max-w-[210px] leading-relaxed">
                Pesanan <strong className="text-[#1F2E23]">{paymentState.orderNumber}</strong> sedang disiapkan oleh barista.
              </p>
              {paymentState.pagerNumber && (
                <div className="mt-2.5 px-3 py-1 rounded-full bg-[#1F2E23] text-white text-[11px] font-bold font-mono inline-flex items-center gap-1.5 shadow-xs">
                  <span className="text-[#A6C5B0] text-[9px] uppercase font-sans tracking-wider">No. Pager:</span>
                  <span>#{paymentState.pagerNumber}</span>
                </div>
              )}
              <div className="mt-3 px-3 py-1 rounded-full bg-[#E2DCD0] text-[11px] font-medium text-[#1F2E23]">
                Terima kasih atas kunjungan Anda
              </div>
            </div>
          ) : paymentState.status === 'PAYMENT_FAILED' ? (
            /* Payment Failed View */
            <div className="h-full flex flex-col items-center justify-center text-center py-4">
              <div className="w-10 h-10 rounded-full bg-red-100/70 text-red-700 flex items-center justify-center mb-2.5">
                <XCircle size={20} strokeWidth={1.5} />
              </div>
              <h3 className="text-sm font-semibold text-[#1F2E23]">Pembayaran Gagal</h3>
              <p className="text-xs text-[#6D736A] mt-1 max-w-[200px]">
                {paymentState.message || 'Silakan ulangi transaksi di kasir.'}
              </p>
            </div>
          ) : paymentState.status === 'PAYMENT_UNKNOWN' ? (
            /* Payment Verifying View */
            <div className="h-full flex flex-col items-center justify-center text-center py-4">
              <div className="w-10 h-10 rounded-full bg-amber-100/70 text-amber-800 flex items-center justify-center mb-2.5">
                <AlertCircle size={20} strokeWidth={1.5} />
              </div>
              <h3 className="text-sm font-semibold text-[#1F2E23]">Memverifikasi Status</h3>
              <p className="text-xs text-[#6D736A] mt-1 max-w-[200px]">
                {paymentState.message || 'Menunggu konfirmasi jaringan...'}
              </p>
            </div>
          ) : cart.length === 0 ? (
            /* Idle Welcome State */
            <div className="h-full flex flex-col items-center justify-center text-center py-6">
              <div className="w-11 h-11 rounded-full bg-[#E2DCD0] flex items-center justify-center text-[#5A6258] mb-3">
                <Coffee size={20} strokeWidth={1.5} />
              </div>
              <p className="text-xs text-[#6D736A] max-w-[200px] leading-relaxed">
                Pesanan Anda akan tampil di sini saat kasir memasukkan pilihan menu.
              </p>
            </div>
          ) : (
            /* Active Cart Items matching the Reference Screenshot */
            <div className="space-y-4">
              {cart.map((item) => (
                <div key={item.uid} className="flex items-start gap-3">
                  {/* Item Thumbnail */}
                  <div className="w-11 h-11 shrink-0 rounded-lg overflow-hidden bg-[#E5DFD4]/50 flex items-center justify-center p-0.5">
                    <img
                      src={getItemThumbnail(item.productName)}
                      alt={item.productName}
                      className="w-full h-full object-contain"
                    />
                  </div>

                  {/* Title & Modifiers (Vertical stacking for full visibility) */}
                  <div className="flex-1 min-w-0 pr-1">
                    <div className="text-[13px] font-bold text-[#1F2E23] leading-snug">
                      {item.productName}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      <div className="text-[11px] text-[#6D736A] leading-tight">
                        {item.variantSize} · Iced
                      </div>
                      {item.modifiers && item.modifiers.map((m, idx) => (
                        <div key={idx} className="text-[11px] text-[#6D736A] leading-tight">
                          {m.optionName}
                        </div>
                      ))}
                      {item.notes && (
                        <div className="text-[10px] text-[#8C897E] italic mt-0.5 leading-tight">
                          *{item.notes}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quantity & Price */}
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-[#1F2E23] font-mono tabular-nums">
                      {formatRp(item.subtotal)}
                    </div>
                    <div className="text-[11px] text-[#6D736A] font-medium mt-0.5">
                      {item.quantity} ×
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom: Pelanggan, Subtotal, Pajak, Total Bayar */}
        <div className="shrink-0 pt-2 border-t border-[#E0D9CC]/80 bg-[#EDE8DE]">
          <div className="flex justify-between items-baseline gap-2 text-xs mb-2 pb-2 border-b border-[#E0D9CC]/60">
            <span className="text-[#6D736A] shrink-0">Pelanggan</span>
            <span className="font-semibold text-[#1F2E23] text-right truncate max-w-[70%]">
              {customerName || 'Walk-in'}
            </span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-[#6D736A]">
              <span>Subtotal</span>
              <span className="font-mono text-[#1F2E23] font-medium">{formatRp(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-[#344536]">
                <span>Diskon</span>
                <span className="font-mono font-medium">-{formatRp(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[#6D736A]">
              <span>Pajak 10%</span>
              <span className="font-mono text-[#1F2E23] font-medium">{formatRp(tax)}</span>
            </div>
          </div>

          {/* Strong Total Bayar */}
          <div className="mt-4 pt-3 border-t border-[#D6CEC0] flex justify-between items-baseline">
            <span className="text-sm font-bold text-[#1F2E23] tracking-tight">
              Total Bayar
            </span>
            <span className="text-2xl font-bold text-[#1F2E23] font-mono tracking-tight">
              {formatRp(total)}
            </span>
          </div>

          {/* Understated Quiet Luxury Tagline */}
          <div className="mt-6 flex items-center gap-1.5 text-[11px] text-[#6D736A] font-medium">
            <Leaf size={13} className="text-[#1F2E23]" />
            <span>Good Coffee · Better Journey</span>
          </div>
        </div>
      </div>

      {/* ========================================================
          RIGHT PANEL (70%): ADVERTISING / EDITORIAL SLIDESHOW
          Exact composition matching reference screenshot:
          Outdoor scenery, green camping mug, editorial typography
          ======================================================== */}
      <div
        className="advertising-panel"
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          backgroundColor: '#161815',
          color: '#ffffff',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        {/* Full-bleed Slides Stack with Smooth Cross-Fade */}
        <div className="absolute inset-0 w-full h-full overflow-hidden bg-[#161815]">
          {slides.map((slide, idx) => {
            const isActive = idx === currentSlideIndex;
            const hasError = imageErrorMap[slide.id];

            return (
              <div
                key={slide.id}
                className={`absolute inset-0 w-full h-full transition-opacity duration-1000 ease-in-out ${isActive ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                  }`}
              >
                {!hasError ? (
                  <img
                    src={slide.image}
                    alt={slide.headline || 'SakuPOS - Coffee'}
                    onError={() => setImageErrorMap((prev) => ({ ...prev, [slide.id]: true }))}
                    className="w-full h-full object-cover object-center"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[#203B2D]">
                    <Coffee size={80} strokeWidth={1} className="text-[#EDE8DE]/20" />
                  </div>
                )}

                {/* For slides without embedded typography, render the exact editorial overlay */}
                {!slide.hasEmbeddedTypography && (
                  <div className="absolute inset-0 p-12 flex flex-col justify-between">
                    {/* Top Bar: Brand left, Badge right */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] tracking-[0.25em] uppercase text-white/80 font-medium">
                          {slide.categoryLabel}
                        </span>
                        <div className="w-12 h-px bg-white/40" />
                      </div>

                      {slide.topRightBadge && (
                        <div className="flex flex-col items-end">
                          <span className="text-[9px] tracking-[0.2em] uppercase text-white/80 font-medium text-right leading-tight whitespace-pre-line">
                            {slide.topRightBadge}
                          </span>
                          <div className="w-8 h-px bg-white/40 mt-1" />
                        </div>
                      )}
                    </div>

                    {/* Main Center/Left Headline */}
                    <div className="max-w-xl my-auto">
                      <h1
                        className="font-editorial text-4xl lg:text-5xl font-light text-[#F5F6F2] leading-[1.12] tracking-tight whitespace-pre-line drop-shadow-xs"
                        style={{
                          fontFamily: "'Playfair Display', 'Newsreader', Georgia, 'Times New Roman', serif",
                        }}
                      >
                        {slide.headline}
                      </h1>
                      <p className="text-sm lg:text-base text-[#D8DCD5] font-light leading-relaxed mt-4 max-w-sm">
                        {slide.subtitle}
                      </p>
                    </div>

                    {/* Bottom Left Badge */}
                    <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-white/80 font-medium">
                      <Leaf size={12} className="text-white/80" />
                      <span>{slide.footerBadge}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Minimal Understated Slide Indicator Dots (Bottom Right Edge) */}
        <div className="absolute right-8 bottom-8 z-20 flex items-center gap-2">
          {slides.map((slide, idx) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => setCurrentSlideIndex(idx)}
              className={`h-1 rounded-full transition-all duration-500 cursor-pointer ${currentSlideIndex === idx
                ? 'w-6 bg-white/90'
                : 'w-1.5 bg-white/30 hover:bg-white/60'
                }`}
              aria-label={`Slide ${idx + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
