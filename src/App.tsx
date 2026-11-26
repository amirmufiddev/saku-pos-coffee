// src/App.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Coffee,
  Search,
  ShoppingCart,
  Trash2,
  Clock,
  Printer,
  Wifi,
  RefreshCw,
  Plus,
  Minus,
  ChevronRight,
  Server,
  User as UserIcon,
  SlidersHorizontal,
  Flame,
  Snowflake,
  Leaf,
  Croissant,
  Layers,
  ArrowRight,
  Lock,
  Receipt,
  Monitor,
  CreditCard,
  Radio,
} from 'lucide-react';
import {
  api,
  type Product,
  type ModifierGroup,
  type CartItem,
  type Order,
  type DbStatus,
  type PrinterStatus,
  type User,
  WS_BASE,
} from './services/api';
import { edcStorage } from './services/edcStorage';
import { ModifierModal } from './components/ModifierModal';
import { PaymentModal } from './components/PaymentModal';
import { CupLabelPreviewModal } from './components/CupLabelPreviewModal';
import { ReceiptModal } from './components/ReceiptModal';
import { BaristaKdsView } from './components/BaristaKdsView';
import { SakuPosLogo } from './components/SakuPosLogo';
import { PinLoginModal } from './components/PinLoginModal';
import {
  clearTerminalUnlock,
  isTerminalSessionUnlocked,
  markTerminalUnlocked,
} from './utils/terminalSession.util';
import { EodClosingModal } from './components/EodClosingModal';
import { CustomerDisplayView } from './components/CustomerDisplayView';
import { SystemSettingsView } from './components/SystemSettingsView';
import { useCupLabelHostPrinter } from './hooks/useCupLabelHostPrinter';
import { isElectron } from './utils/isElectron';

export default function App() {
  // Check if current browser window/tab is running in Customer Display mode (Second Screen)
  const isCustomerDisplayMode =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('display') === 'customer' ||
     new URLSearchParams(window.location.search).get('screen') === 'customer');

  if (isCustomerDisplayMode) {
    return <CustomerDisplayView />;
  }

  const [activeTab, setActiveTab] = useState<'POS' | 'KDS' | 'HISTORY' | 'DIAGNOSTICS'>('POS');
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'UNPAID' | 'PAID'>('ALL');

  // Customer Display BroadcastChannel Ref
  const cdsChannelRef = useRef<BroadcastChannel | null>(null);

  // User Session & PIN Auth
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    if (!isTerminalSessionUnlocked()) return null;
    try {
      const saved = localStorage.getItem('sakupos_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isLockScreen, setIsLockScreen] = useState(() => !isTerminalSessionUnlocked());
  const [userInitiatedLock, setUserInitiatedLock] = useState(false);
  const [showEodModal, setShowEodModal] = useState(false);

  // Catalog State
  const [products, setProducts] = useState<Product[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);

  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('Walk-in');
  const [pagerNumber, setPagerNumber] = useState('');

  // Modals
  const [selectedProductForMod, setSelectedProductForMod] = useState<Product | null>(null);
  const [pendingPaymentOrder, setPendingPaymentOrder] = useState<Order | null>(null);
  const [previewReceiptOrder, setPreviewReceiptOrder] = useState<Order | null>(null);
  const [previewStickerOrder, setPreviewStickerOrder] = useState<Order | null>(null);

  // Orders & System Status
  const [orders, setOrders] = useState<Order[]>([]);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus | null>(null);
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const loadCatalog = async () => {
    setIsLoadingCatalog(true);
    try {
      const data = await api.getCatalog();
      setProducts(data.products || []);
      setModifierGroups(data.modifierGroups || []);
    } catch {
      // offline
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  const loadOrders = async () => {
    try {
      const list = await api.getOrders();
      setOrders(list || []);
    } catch {
      // ignore
    }
  };

  const loadHealthStatus = async () => {
    try {
      const [dStatus, pStatus] = await Promise.all([
        api.getDbStatus(),
        api.getPrinterStatus(),
      ]);
      setDbStatus(dStatus);
      setPrinterStatus(pStatus);
    } catch {
      setDbStatus(null);
    }
  };

  useCupLabelHostPrinter(Boolean(currentUser) && isElectron());

  useEffect(() => {
    loadCatalog();
    loadOrders();
    loadHealthStatus();
    api.getEdcConfigurations().then(edcStorage.hydrateFromServer).catch(() => {});

    const timer = setInterval(() => {
      loadHealthStatus();
    }, 4000);

    return () => clearInterval(timer);
  }, []);

  // Customer Display BroadcastChannel Setup & Sync
  useEffect(() => {
    try {
      cdsChannelRef.current = new BroadcastChannel('sakupos_cds');
    } catch {
      // fallback
    }
    return () => {
      cdsChannelRef.current?.close();
    };
  }, []);

  // Broadcast live cart changes to Customer Display
  useEffect(() => {
    const subtotal = cart.reduce((acc, item) => acc + item.subtotal, 0);
    const tax = Math.round(subtotal * 0.1);
    const total = subtotal + tax;

    const payload = {
      cart: cart.map(item => ({
        uid: item.uid,
        productName: item.productName,
        variantSize: item.variantSize,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        subtotal: item.subtotal,
        notes: item.notes,
        modifiers: item.modifiers,
      })),
      customerName,
      subtotal,
      tax,
      total,
    };

    cdsChannelRef.current?.postMessage({
      type: 'SYNC_CART',
      payload,
    });

    try {
      localStorage.setItem('sakupos_cds_state', JSON.stringify({ cart: payload.cart, customerName }));
    } catch {}
  }, [cart, customerName]);

  // Broadcast pending payment to Customer Display
  useEffect(() => {
    if (pendingPaymentOrder) {
      cdsChannelRef.current?.postMessage({
        type: 'PAYMENT_PENDING',
        payload: {
          orderNumber: pendingPaymentOrder.orderNumber,
          totalAmount: pendingPaymentOrder.totalAmount,
          paymentMethod: 'QRIS',
        },
      });
    }
  }, [pendingPaymentOrder]);

  useEffect(() => {
    let ws: WebSocket;
    const connectWs = () => {
      ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      ws.onopen = () => setIsWsConnected(true);
      ws.onclose = () => {
        setIsWsConnected(false);
        setTimeout(connectWs, 3000);
      };
      ws.onerror = () => ws.close();

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'order:created' || msg.event === 'order:status_updated' || msg.event === 'order:payment_updated') {
            loadOrders();
            loadHealthStatus();
          }
          if (msg.event === 'catalog:updated') {
            loadCatalog();
          }
        } catch {
          // ignore
        }
      };
    };

    connectWs();
    return () => {
      if (ws) ws.close();
    };
  }, []);

  // Category Tabs Configuration
  const categoryConfigs = [
    { id: 'Semua', label: 'Semua Menu', icon: Layers },
    { id: 'Espresso & Milk', label: 'Espresso & Milk', icon: Flame },
    { id: 'Cold Brew Signatures', label: 'Cold Brew', icon: Snowflake },
    { id: 'Artisan Teas & Non-Coffee', label: 'Teas & Matcha', icon: Leaf },
    { id: 'Pastries & Snacks', label: 'Pastries', icon: Croissant },
  ];

  const filteredProducts = products.filter(p => {
    const matchesCat = selectedCategory === 'Semua' || p.category === selectedCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const cartSubtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const cartTax = Math.round(cartSubtotal * 0.1);
  const cartTotal = cartSubtotal + cartTax;
  const cartItemCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  const handleAddToCart = (item: CartItem) => {
    setCart(prev => [...prev, item]);
    setSelectedProductForMod(null);
  };

  const handleUpdateCartQty = (uid: string, delta: number) => {
    setCart(prev =>
      prev
        .map(item => {
          if (item.uid === uid) {
            const newQty = item.quantity + delta;
            return newQty > 0
              ? { ...item, quantity: newQty, subtotal: item.unitPrice * newQty }
              : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const handleRemoveCartItem = (uid: string) => {
    setCart(prev => prev.filter(item => item.uid !== uid));
  };

  const handleProceedToPayment = async () => {
    if (cart.length === 0) return;
    if (!currentUser || isLockScreen) {
      setUserInitiatedLock(false);
      setIsLockScreen(true);
      return;
    }
    setIsPlacingOrder(true);
    try {
      const order = await api.createOrder({
        outletId: 'out_sakupos_coffee_01',
        terminalId: 'TERM-01',
        cashierId: currentUser.id,
        cashierName: currentUser.name,
        customerName: customerName.trim() || 'Walk-in',
        diningOption: 'takeaway',
        pagerNumber: pagerNumber.trim() || undefined,
        items: cart.map(i => ({
          productId: i.productId,
          variantSize: i.variantSize,
          quantity: i.quantity,
          selectedModifiers: i.modifiers,
          notes: i.notes,
        })),
      });

      setCart([]);
      setCustomerName('Walk-in');
      setPagerNumber('');
      loadOrders();
      loadCatalog();
      setPendingPaymentOrder(order);
    } catch (err: any) {
      alert(err.message || 'Gagal membuat pesanan');
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const activeKdsCount = orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').length;
  const isOrderUnpaid = (o: Order) =>
    o.paymentStatus !== 'PAID' && o.paymentStatus !== 'REFUNDED' && o.status !== 'CANCELLED';
  const unpaidOrdersCount = orders.filter(isOrderUnpaid).length;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#f8fafc] text-slate-800 overflow-hidden font-['Inter',sans-serif]">
      {/* 1. COMPACT PROFESSIONAL TOP NAVBAR */}
      <header className="h-14 bg-white border-b border-slate-200/80 px-5 flex items-center justify-between shrink-0 shadow-2xs z-30">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <SakuPosLogo height={28} />
          <div className="flex items-baseline gap-2 border-l border-slate-200 pl-3">
            <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wide">Grab & Go Counter</span>
          </div>
        </div>

        {/* Center Tabs */}
        <nav className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/70">
          <button
            type="button"
            onClick={() => setActiveTab('POS')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'POS'
                ? 'bg-emerald-800 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Coffee size={14} />
            <span>Kasir POS</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('KDS')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'KDS'
                ? 'bg-emerald-800 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Radio size={14} />
            <span>Pager Barista</span>
            {activeKdsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white font-black text-[10px]">
                {activeKdsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('HISTORY')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'HISTORY'
                ? 'bg-emerald-800 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShoppingCart size={14} />
            <span>Riwayat</span>
            {unpaidOrdersCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white font-black text-[10px] animate-pulse">
                {unpaidOrdersCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('DIAGNOSTICS')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'DIAGNOSTICS'
                ? 'bg-emerald-800 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <SlidersHorizontal size={14} />
            <span>Sistem</span>
          </button>
        </nav>

        {/* Right Status Badges */}
        <div className="flex items-center gap-2.5 text-xs">
          {/* LAN Connection */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border ${
              isWsConnected
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isWsConnected ? 'bg-emerald-600' : 'bg-red-600'}`} />
            <span>LAN</span>
          </span>

          {/* Local SQLite DB Status */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border ${
              dbStatus?.connected
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${dbStatus?.connected ? 'bg-emerald-600' : 'bg-amber-600'}`} />
            <span>SQLite</span>
          </span>

          {/* Printer */}
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-50 border border-slate-200 text-slate-700">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            <span>Printer</span>
          </span>

          {/* Layar Pelanggan (Customer Display Second Screen) */}
          <button
            type="button"
            onClick={() => {
              window.open('/?display=customer', 'SakuPosCustomerDisplay', 'width=1280,height=720,menubar=no,toolbar=no');
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 transition cursor-pointer"
            title="Buka Layar Pelanggan / Second Screen"
          >
            <Monitor size={13} className="text-emerald-700" />
            <span className="hidden xl:inline">Layar Customer</span>
          </button>

          {/* Active Cashier & Auth / EOD Controls */}
          {currentUser ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <button
                type="button"
                onClick={() => setShowEodModal(true)}
                className="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
                title="End Of Day / Tutup Kasir"
              >
                <Receipt size={14} className="text-amber-700" />
                <span className="hidden md:inline">End Of Day</span>
              </button>

              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-800">
                <div className="w-6 h-6 rounded-full bg-emerald-800 text-white font-bold text-[10px] flex items-center justify-center">
                  {currentUser.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="hidden xl:flex flex-col text-left leading-none">
                  <span className="text-[11px] font-bold text-slate-900">{currentUser.name}</span>
                  <span className="text-[9px] font-semibold text-slate-500 uppercase">{currentUser.role}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setUserInitiatedLock(true);
                  setIsLockScreen(true);
                }}
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 hover:text-slate-900 transition cursor-pointer"
                title="Kunci Layar / Ganti PIN"
              >
                <Lock size={15} />
              </button>
            </div>
          ) : (
            <span className="px-2 py-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-md">
              Masukkan PIN di layar kunci
            </span>
          )}
        </div>
      </header>

      {/* 2. MAIN POS WORKSPACE */}
      {activeTab === 'POS' && (
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: Catalog Grid (Fixed compact card sizing) */}
          <div className="flex-1 flex flex-col p-4 overflow-hidden">
            {/* Toolbar: Categories + Search in one neat bar */}
            <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
              {/* Category Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {categoryConfigs.map(cat => {
                  const Icon = cat.icon;
                  const isSelected = selectedCategory === cat.id;
                  const count = cat.id === 'Semua'
                    ? products.length
                    : products.filter(p => p.category === cat.id).length;

                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                        isSelected
                          ? 'bg-emerald-800 text-white shadow-2xs'
                          : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <Icon size={14} className={isSelected ? 'text-amber-300' : 'text-slate-400'} />
                      <span>{cat.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-semibold ${
                        isSelected ? 'bg-emerald-900/60 text-emerald-100' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Search Box */}
              <div className="relative w-64 shrink-0">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Cari kopi, susu, pastry..."
                  className="w-full pl-8.5 pr-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-200 transition"
                />
              </div>
            </div>

            {/* Product Cards Grid: Balanced compact cards */}
            {isLoadingCatalog ? (
              <div className="flex-1 flex items-center justify-center text-slate-400">
                <RefreshCw className="animate-spin text-emerald-800" size={24} />
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                <Coffee size={32} className="text-slate-300 mb-2" />
                <p className="text-xs font-semibold text-slate-500">Tidak ada produk dalam kategori ini</p>
                <button
                  type="button"
                  onClick={() => { setSelectedCategory('Semua'); setSearchQuery(''); }}
                  className="mt-2 text-xs font-bold text-emerald-800 hover:underline cursor-pointer"
                >
                  Tampilkan Semua Menu
                </button>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 auto-rows-max pr-1">
                {filteredProducts.map(p => {
                  const isEspresso = p.category.includes('Espresso');
                  const isColdBrew = p.category.includes('Cold');
                  const isTea = p.category.includes('Tea');
                  const unavailable = p.isSoldOut || (p.stockQty !== null && p.stockQty <= 0);
                  const stockLabel =
                    p.stockQty === null
                      ? null
                      : p.stockQty <= 0
                        ? 'Habis'
                        : `Stok ${p.stockQty}`;

                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={unavailable}
                      onClick={() => {
                        if (!unavailable) setSelectedProductForMod(p);
                      }}
                      className={`p-3 rounded-xl border text-left flex flex-col justify-between transition duration-100 h-[155px] group ${
                        unavailable
                          ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                          : 'bg-white border-slate-200 hover:border-emerald-600 hover:shadow-sm active:scale-98 cursor-pointer'
                      }`}
                    >
                      {/* Top: Icon + Category indicator */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                            isEspresso
                              ? 'bg-amber-50 text-amber-800'
                              : isColdBrew
                              ? 'bg-blue-50 text-blue-700'
                              : isTea
                              ? 'bg-emerald-50 text-emerald-800'
                              : 'bg-orange-50 text-orange-800'
                          }`}>
                            <Coffee size={15} />
                          </div>
                          <div className="flex flex-col items-end gap-0.5">
                            {stockLabel && (
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                                  p.stockQty !== null && p.stockQty <= 5 && p.stockQty > 0
                                    ? 'bg-amber-50 text-amber-900 border-amber-200'
                                    : unavailable
                                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}
                              >
                                {stockLabel}
                              </span>
                            )}
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              {p.sku}
                            </span>
                          </div>
                        </div>

                        {/* Title & Short description */}
                        <h3 className="font-bold text-xs text-slate-900 leading-tight line-clamp-2 group-hover:text-emerald-900 transition">
                          {p.name}
                        </h3>
                        <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5 leading-tight">
                          {p.description}
                        </p>
                      </div>

                      {/* Bottom: Price + Quick Add Button */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                        <div>
                          <span className="text-[9px] text-slate-400 font-medium block">Mulai</span>
                          <span className="text-xs font-black text-emerald-900 font-mono">
                            Rp {p.basePriceRegular.toLocaleString('id-ID')}
                          </span>
                        </div>
                        <div className="w-6 h-6 rounded-md bg-emerald-50 group-hover:bg-emerald-700 text-emerald-800 group-hover:text-white flex items-center justify-center transition shadow-2xs">
                          <Plus size={14} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT: Compact Structured Cart Drawer (340px width) */}
          <div className="w-[340px] lg:w-[380px] bg-white border-l border-slate-200 flex flex-col h-full shrink-0 shadow-sm z-10">
            {/* Cart Header */}
            <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart size={16} className="text-emerald-800" />
                <h2 className="font-black text-xs text-slate-900 uppercase tracking-wider">Pesanan Kasir</h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[11px] font-bold">
                  {cartItemCount} Gelas
                </span>
              </div>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-[11px] text-red-600 hover:text-red-700 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 size={12} />
                  <span>Hapus</span>
                </button>
              )}
            </div>

            {/* Customer & Guest Pager Assignment */}
            <div className="px-4 py-2.5 border-b border-slate-100 bg-white space-y-2">
              <div className="flex items-center gap-2">
                <UserIcon size={14} className="text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="Nama Tamu (Walk-in)"
                  className="w-full text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none"
                />
              </div>

              {/* No. Pager Quick Chips */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 text-[11px] font-bold text-slate-700 shrink-0">
                  <Radio size={12} className="text-emerald-700" />
                  <span>Pager:</span>
                </div>
                <div className="flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar flex-1 justify-end">
                  {['01', '02', '03', '04', '05', '06', '07', '08'].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setPagerNumber(prev => (prev === num ? '' : num))}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition cursor-pointer border ${
                        pagerNumber === num
                          ? 'bg-slate-900 text-white border-slate-900 shadow-2xs scale-105'
                          : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                  <input
                    type="text"
                    value={pagerNumber}
                    onChange={e => setPagerNumber(e.target.value)}
                    placeholder="#"
                    className="w-8 px-1 py-0.5 text-center text-[10px] font-bold font-mono rounded border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:border-slate-400"
                    title="Nomor pager manual jika > 08"
                  />
                </div>
              </div>
            </div>

            {/* Cart Item Lines */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 py-12">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                    <Coffee size={22} />
                  </div>
                  <p className="text-xs font-bold text-slate-600">Pesanan Masih Kosong</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 text-center px-4">
                    Pilih minuman di katalog untuk menambahkan ke antrean
                  </p>
                </div>
              ) : (
                cart.map(item => (
                  <div
                    key={item.uid}
                    className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 flex flex-col gap-1.5"
                  >
                    {/* Item title & size */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900 leading-snug">{item.productName}</div>
                        <div className="text-[10px] font-semibold text-amber-800 mt-0.5">
                          Rp {item.unitPrice.toLocaleString('id-ID')}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCartItem(item.uid)}
                        className="text-slate-400 hover:text-red-600 p-0.5 cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* Modifiers List */}
                    {item.modifiers.length > 0 && (
                      <div className="text-[10px] text-slate-600 space-y-0.5 border-l-2 border-emerald-600 pl-2">
                        {item.modifiers.map(m => (
                          <div key={m.optionId}>
                            • {m.optionName} {m.price > 0 && <span className="text-emerald-700 font-semibold">(+Rp {m.price.toLocaleString('id-ID')})</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {item.notes && (
                      <div className="text-[10px] text-amber-900 bg-amber-50 p-1 rounded border border-amber-200">
                        Catatan: {item.notes}
                      </div>
                    )}

                    {/* Quantity & Subtotal Stepper */}
                    <div className="pt-1.5 border-t border-slate-200/60 flex items-center justify-between">
                      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-md p-0.5">
                        <button
                          type="button"
                          onClick={() => handleUpdateCartQty(item.uid, -1)}
                          className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
                        >
                          <Minus size={11} />
                        </button>
                        <span className="text-xs font-bold px-2">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => handleUpdateCartQty(item.uid, 1)}
                          className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
                        >
                          <Plus size={11} />
                        </button>
                      </div>

                      <span className="text-xs font-black text-slate-900 font-mono">
                        Rp {item.subtotal.toLocaleString('id-ID')}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cart Footer: Total & Checkout Button */}
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 space-y-2.5">
              <div className="space-y-1 text-xs">
                <div className="flex justify-between text-slate-500 font-medium">
                  <span>Subtotal</span>
                  <span className="font-mono">Rp {cartSubtotal.toLocaleString('id-ID')}</span>
                </div>
                <div className="flex justify-between text-slate-500 font-medium">
                  <span>Pajak Resto (PB1 10%)</span>
                  <span className="font-mono">Rp {cartTax.toLocaleString('id-ID')}</span>
                </div>
                <div className="pt-1 border-t border-slate-200 flex justify-between text-sm font-black text-slate-900">
                  <span>Total Tagihan</span>
                  <span className="text-emerald-800 font-mono text-base">Rp {cartTotal.toLocaleString('id-ID')}</span>
                </div>
              </div>

              <button
                type="button"
                disabled={cart.length === 0 || isPlacingOrder}
                onClick={handleProceedToPayment}
                className="w-full py-3 px-4 rounded-xl bg-emerald-800 hover:bg-emerald-700 active:bg-emerald-900 disabled:opacity-40 text-white font-black text-xs flex items-center justify-between shadow-sm transition cursor-pointer"
              >
                <span>Proses Pembayaran</span>
                <span className="flex items-center gap-1 font-mono text-sm">
                  Rp {cartTotal.toLocaleString('id-ID')}
                  <ChevronRight size={16} />
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barista KDS View */}
      {activeTab === 'KDS' && (
        <BaristaKdsView orders={orders} onOrderUpdated={loadOrders} />
      )}

      {/* Transaction History View */}
      {activeTab === 'HISTORY' && (
        <div className="flex-1 p-5 overflow-y-auto bg-slate-100">
          <div className="max-w-5xl mx-auto space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <h2 className="text-base font-bold text-slate-900">Riwayat Transaksi Kasir</h2>
                <p className="text-xs text-slate-500">
                  Daftar seluruh pesanan. Pesanan berstatus belum bayar dapat langsung dilunasi di sini.
                </p>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setHistoryFilter('ALL')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    historyFilter === 'ALL'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Semua ({orders.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFilter('UNPAID')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    historyFilter === 'UNPAID'
                      ? 'bg-amber-600 text-white'
                      : 'text-amber-800 hover:bg-amber-50'
                  }`}
                >
                  <span>Belum Bayar</span>
                  {unpaidOrdersCount > 0 && (
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                      historyFilter === 'UNPAID' ? 'bg-amber-800 text-white' : 'bg-amber-200 text-amber-900'
                    }`}>
                      {unpaidOrdersCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFilter('PAID')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    historyFilter === 'PAID'
                      ? 'bg-emerald-800 text-white'
                      : 'text-emerald-800 hover:bg-emerald-50'
                  }`}
                >
                  Lunas ({orders.filter(o => o.paymentStatus === 'PAID').length})
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="p-3">No. Order</th>
                    <th className="p-3">Waktu</th>
                    <th className="p-3">Pelanggan</th>
                    <th className="p-3">Item</th>
                    <th className="p-3">Total</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Bayar</th>
                    <th className="p-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders
                    .filter(order => {
                      if (historyFilter === 'UNPAID') return isOrderUnpaid(order);
                      if (historyFilter === 'PAID') return order.paymentStatus === 'PAID';
                      return true;
                    })
                    .map(order => {
                      const isUnpaid = isOrderUnpaid(order);
                      const isCancelledOrRefunded = order.status === 'CANCELLED' || order.paymentStatus === 'REFUNDED';
                      return (
                        <tr
                          key={order.id}
                          className={`transition ${
                            isUnpaid
                              ? 'bg-amber-50/40 hover:bg-amber-50/70 border-l-4 border-l-amber-500'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="p-3">
                            <div className="font-bold font-mono text-emerald-800 leading-tight">
                              {order.orderNumber}
                            </div>
                            {order.pagerNumber && (
                              <span className="inline-block mt-1 px-1.5 py-0.2 rounded bg-slate-900 text-white font-mono text-[9px] font-bold tracking-wider">
                                PGR #{order.pagerNumber}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-slate-500">
                            {new Date(order.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="p-3 font-semibold text-slate-900">{order.customerName}</td>
                          <td className="p-3 text-slate-600">{order.items?.length || 0} Gelas</td>
                          <td className="p-3 font-bold text-slate-900 font-mono">
                            Rp {order.totalAmount.toLocaleString('id-ID')}
                          </td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200">
                              {order.status}
                            </span>
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                order.paymentStatus === 'PAID'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : isCancelledOrRefunded
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : 'bg-amber-100 text-amber-900 border border-amber-300 font-black'
                              }`}
                            >
                              {order.paymentStatus === 'PAID'
                                ? 'LUNAS'
                                : isCancelledOrRefunded
                                  ? order.paymentStatus === 'REFUNDED'
                                    ? 'REFUND'
                                    : 'BATAL'
                                  : 'BELUM BAYAR'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {isUnpaid ? (
                              <button
                                type="button"
                                onClick={() => setPendingPaymentOrder(order)}
                                className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 active:scale-98 text-white text-[11px] font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer ml-auto"
                                title="Buka pembayaran untuk pesanan ini"
                              >
                                <CreditCard size={13} />
                                <span>Bayar Sekarang</span>
                              </button>
                            ) : isCancelledOrRefunded ? (
                              <span className="text-[11px] font-semibold text-slate-400">Dibatalkan</span>
                            ) : (
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setPreviewReceiptOrder(order)}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold border border-slate-200 transition cursor-pointer flex items-center gap-1"
                                  title="Cetak struk belanja"
                                >
                                  <Receipt size={12} />
                                  <span>Struk</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPreviewStickerOrder(order)}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold border border-emerald-200 transition cursor-pointer"
                                  title="Lihat stiker label cup"
                                >
                                  Stiker Cup
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* System Settings & Hardware Diagnostics View */}
      {activeTab === 'DIAGNOSTICS' && (
        <SystemSettingsView
          onRefreshData={() => {
            loadHealthStatus();
            loadCatalog();
          }}
        />
      )}

      {/* MODALS */}
      {selectedProductForMod && (
        <ModifierModal
          product={selectedProductForMod}
          modifierGroups={modifierGroups}
          onClose={() => setSelectedProductForMod(null)}
          onAddToCart={handleAddToCart}
        />
      )}

      {pendingPaymentOrder && (
        <PaymentModal
          order={pendingPaymentOrder}
          onClose={() => {
            setPendingPaymentOrder(null);
            const subtotal = cart.reduce((acc, item) => acc + item.subtotal, 0);
            const tax = Math.round(subtotal * 0.1);
            const total = subtotal + tax;
            cdsChannelRef.current?.postMessage({
              type: 'SYNC_CART',
              payload: {
                cart: cart.map(i => ({ ...i })),
                customerName,
                subtotal,
                tax,
                total,
              },
            });
          }}
          onPaymentSuccess={(paidOrder) => {
            setPendingPaymentOrder(null);
            loadOrders();
            // 1. Munculkan Struk Belanja Terlebih Dahulu
            setPreviewReceiptOrder(paidOrder);
            cdsChannelRef.current?.postMessage({
              type: 'PAYMENT_SUCCESS',
              payload: {
                orderNumber: paidOrder.orderNumber,
                totalAmount: paidOrder.totalAmount,
                pagerNumber: paidOrder.pagerNumber,
              },
            });
          }}
          onPaymentFailed={(errMsg) => {
            cdsChannelRef.current?.postMessage({
              type: 'PAYMENT_FAILED',
              payload: { message: errMsg },
            });
          }}
        />
      )}

      {/* 1. Struk Belanja (Customer Receipt) */}
      {previewReceiptOrder && (
        <ReceiptModal
          order={previewReceiptOrder}
          onClose={() => setPreviewReceiptOrder(null)}
          onProceedToCupLabels={(order) => {
            setPreviewReceiptOrder(null);
            // 2. Lanjut ke Cetak Sticker Label Cup
            setPreviewStickerOrder(order);
          }}
        />
      )}

      {/* 2. Sticker Label Cup Barista */}
      {previewStickerOrder && (
        <CupLabelPreviewModal
          order={previewStickerOrder}
          onClose={() => setPreviewStickerOrder(null)}
        />
      )}

      {/* PIN Login Screen */}
      {(!currentUser || isLockScreen) && (
        <PinLoginModal
          isLockScreen={isLockScreen && !!currentUser}
          currentCashierName={currentUser?.name}
          allowCancelLock={userInitiatedLock && !!currentUser}
          onSuccess={(user) => {
            markTerminalUnlocked();
            setUserInitiatedLock(false);
            setCurrentUser(user);
            setIsLockScreen(false);
            localStorage.setItem('sakupos_user', JSON.stringify(user));
            // Ensure open shift exists in background
            api.openShift({
              outletId: 'out_sakupos_coffee_01',
              terminalId: 'TERM-01',
              cashierId: user.id,
              cashierName: user.name,
              startingCash: 200000,
            }).catch(() => {});
          }}
          onCancelLock={() => {
            setIsLockScreen(false);
            setUserInitiatedLock(false);
          }}
        />
      )}

      {/* End Of Day (Z-Report) Closing Modal */}
      {showEodModal && currentUser && (
        <EodClosingModal
          currentUser={currentUser}
          onClose={() => setShowEodModal(false)}
          onShiftClosed={(_closedShift) => {
            setShowEodModal(false);
            setCurrentUser(null);
            setUserInitiatedLock(false);
            setIsLockScreen(true);
            clearTerminalUnlock();
            localStorage.removeItem('sakupos_user');
          }}
        />
      )}
    </div>
  );
}
