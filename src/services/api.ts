// src/services/api.ts
import type { EdcConfiguration, EdcConnectionType } from '../types/edc-config';

export const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3344';
export const WS_BASE = (import.meta as any).env?.VITE_WS_URL || 'ws://localhost:3344';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  basePriceRegular: number;
  basePriceLarge: number;
  isSoldOut: boolean;
  stockQty: number | null;
  modifierGroupIds: string[];
}

export interface ModifierOption {
  id: string;
  name: string;
  price: number;
  default?: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  type: string;
  required: boolean;
  minSelection: number;
  maxSelection: number;
  options: ModifierOption[];
}

export interface SelectedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  price: number;
}

export interface CartItem {
  uid: string;
  productId: string;
  productName: string;
  variantSize: 'Regular' | 'Large';
  basePrice: number;
  modifiers: SelectedModifier[];
  unitPrice: number;
  quantity: number;
  subtotal: number;
  notes: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  variantSize: 'Regular' | 'Large';
  unitPrice: number;
  quantity: number;
  subtotal: number;
  modifiers: SelectedModifier[];
  notes?: string;
  cupCount: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  outletId: string;
  outletName: string;
  terminalId: string;
  cashierName: string;
  customerName: string;
  status: 'PENDING' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'UNKNOWN' | 'REFUNDED';
  paymentMethod?: string;
  paymentRef?: string;
  diningOption?: string;
  pagerNumber?: string;
  subtotal: number;
  tax: number;
  totalAmount: number;
  createdAt: string;
  items?: OrderItem[];
}

export interface DbStatus {
  connected: boolean;
  engine: string;
  dbFile: string;
  dbPath: string;
  terminalId: string;
  outletId: string;
  outletName: string;
  counts: {
    products: number;
    modifierGroups: number;
    users: number;
    edcConfigurations: number;
    orders: number;
    shifts: number;
    pendingPrintJobs: number;
  };
}

export interface PrinterStatus {
  receiptPrinter: { name: string; online: boolean };
  cupLabelPrinter: { name: string; online: boolean };
  pendingJobsCount: number;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: 'CASHIER' | 'BARISTA' | 'SUPERVISOR' | 'MANAGER';
  isActive: boolean;
}

export interface ShiftSummary {
  totalOrders: number;
  totalCups: number;
  grossSales: number;
  discount: number;
  tax: number;
  netSales: number;
  cashSales: number;
  qrisSales: number;
  edcSales: number;
  startingCash: number;
  expectedCash: number;
}

export interface Shift {
  id: string;
  outletId: string;
  terminalId: string;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  closedAt?: string;
  status: 'OPEN' | 'CLOSED';
  startingCash: number;
  expectedCash: number;
  actualCash?: number;
  cashDifference?: number;
  totalOrders: number;
  totalCups: number;
  totalGrossSales: number;
  totalDiscount: number;
  totalTax: number;
  totalNetSales: number;
  paymentSummary: Record<string, number>;
  notes?: string;
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  const err = await res.json().catch(() => null);
  if (err && typeof err.error === 'string' && err.error.trim()) {
    return err.error;
  }
  return fallback;
}

export const api = {
  async getCatalog(): Promise<{ products: Product[]; modifierGroups: ModifierGroup[] }> {
    const res = await fetch(`${API_BASE}/api/catalog`);
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal memuat katalog lokal dari SQLite'));
    }
    return res.json();
  },

  async updateProductStock(
    productId: string,
    stockQty: number | null,
    isSoldOut?: boolean,
  ): Promise<{ id: string; stockQty: number | null; isSoldOut: boolean }> {
    const res = await fetch(`${API_BASE}/api/catalog/products/${productId}/stock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stockQty, isSoldOut }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal memperbarui stok produk'));
    }
    return res.json();
  },

  async restockAllProducts(
    defaultQty = 50,
  ): Promise<{ success: boolean; updatedCount: number; defaultQty: number }> {
    const res = await fetch(`${API_BASE}/api/catalog/restock-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultQty }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal mengisi ulang stok produk'));
    }
    return res.json();
  },

  async getOrders(limit = 50): Promise<Order[]> {
    const res = await fetch(`${API_BASE}/api/orders?limit=${limit}`);
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal memuat daftar pesanan dari SQLite'));
    }
    return res.json();
  },

  async getOrder(id: string): Promise<Order> {
    const res = await fetch(`${API_BASE}/api/orders/${id}`);
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Order tidak ditemukan'));
    }
    return res.json();
  },

  async createOrder(data: {
    outletId?: string;
    terminalId?: string;
    cashierId?: string;
    cashierName?: string;
    diningOption?: 'takeaway' | 'dinein';
    pagerNumber?: string;
    customerName: string;
    items: {
      productId: string;
      variantSize: 'Regular' | 'Large';
      quantity: number;
      selectedModifiers: SelectedModifier[];
      notes?: string;
    }[];
  }): Promise<Order> {
    const res = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal membuat pesanan di SQLite'));
    }
    return res.json();
  },

  async payOrder(
    orderId: string,
    paymentMethod: string,
    amountPaid: number,
    paymentRef?: string,
  ): Promise<{ success: boolean; order: Order; message: string }> {
    const res = await fetch(`${API_BASE}/api/orders/${orderId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethod, amountPaid, paymentRef }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal memproses pembayaran'));
    }
    return res.json();
  },

  async updateOrderStatus(orderId: string, status: string): Promise<Order> {
    const res = await fetch(`${API_BASE}/api/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal memperbarui status pesanan'));
    }
    return res.json();
  },

  async reconcileOrderPayment(
    orderId: string,
    resolvedStatus: 'PAID' | 'FAILED' = 'PAID',
    notes?: string,
  ): Promise<{ status: string; message: string; order?: Order }> {
    const res = await fetch(`${API_BASE}/api/orders/${orderId}/reconcile-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolvedStatus, notes }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Rekonsiliasi pembayaran gagal'));
    }
    return res.json();
  },

  async reprintCupLabels(
    orderId: string,
  ): Promise<{ success: boolean; reprintedLabelsCount: number }> {
    const res = await fetch(`${API_BASE}/api/orders/${orderId}/reprint`, {
      method: 'POST',
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal mencetak ulang label cup'));
    }
    return res.json();
  },

  async getCupLabelsPreview(
    orderId: string,
  ): Promise<{ orderNumber: string; totalCups: number; labels: any[] }> {
    const res = await fetch(`${API_BASE}/api/orders/${orderId}/cup-labels/preview`);
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal memuat preview label cup'));
    }
    return res.json();
  },

  async getDbStatus(): Promise<DbStatus> {
    const res = await fetch(`${API_BASE}/api/db/status`);
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal memeriksa status SQLite'));
    }
    return res.json();
  },

  async vacuumDatabase(): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/api/db/vacuum`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal melakukan vacuum database'));
    }
    return res.json();
  },

  async getPrinterStatus(): Promise<PrinterStatus> {
    const res = await fetch(`${API_BASE}/api/printer/status`);
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal memuat status printer'));
    }
    return res.json();
  },

  async getPendingHostCupLabels(): Promise<{
    delegateToHost: boolean;
    jobs: Array<{ id: string; labelIndex: number; totalLabels: number; html: string }>;
  }> {
    try {
      const res = await fetch(`${API_BASE}/api/print-queue/cup-labels/pending`);
      if (res.ok) return await res.json();
    } catch {
      // ignore polling hiccup
    }
    return { delegateToHost: false, jobs: [] };
  },

  async completeHostCupLabel(
    jobId: string,
    success: boolean,
    error?: string,
  ): Promise<void> {
    try {
      await fetch(`${API_BASE}/api/print-queue/cup-labels/${jobId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success, error }),
      });
    } catch {
      // ignore
    }
  },

  async togglePrinterOnline(): Promise<{ cupLabelPrinterOnline: boolean }> {
    const res = await fetch(`${API_BASE}/api/chaos/toggle-printer`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal mengubah status printer'));
    }
    return res.json();
  },

  // Local EDC Configurations (SQLite)
  async getEdcConfigurations(): Promise<EdcConfiguration[]> {
    const res = await fetch(`${API_BASE}/api/edc-configurations`);
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal memuat konfigurasi EDC dari SQLite'));
    }
    const json = await res.json();
    return Array.isArray(json.items) ? json.items : [];
  },

  async saveEdcConfiguration(
    config: Partial<EdcConfiguration> & { name: string; connectionType: EdcConnectionType },
  ): Promise<EdcConfiguration> {
    const url = config.id
      ? `${API_BASE}/api/edc-configurations/${config.id}`
      : `${API_BASE}/api/edc-configurations`;
    const method = config.id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal menyimpan konfigurasi EDC ke SQLite'));
    }
    const json = await res.json();
    return json.item;
  },

  async deleteEdcConfiguration(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/edc-configurations/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal menghapus konfigurasi EDC'));
    }
  },

  async setDefaultEdcConfiguration(id: string): Promise<EdcConfiguration> {
    const res = await fetch(`${API_BASE}/api/edc-configurations/${id}/default`, {
      method: 'POST',
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal mengatur EDC default'));
    }
    const json = await res.json();
    return json.item;
  },

  async updateEdcTestResult(
    id: string,
    result: {
      lastTestStatus: 'CONNECTED' | 'FAILED';
      lastTestedAt: string;
      lastTestError?: string | null;
      terminalId?: string | null;
      vendorId?: string | null;
      productId?: string | null;
      serialNumber?: string | null;
      manufacturer?: string | null;
      portPath?: string | null;
    },
  ): Promise<EdcConfiguration> {
    const res = await fetch(`${API_BASE}/api/edc-configurations/${id}/test-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Gagal menyimpan hasil uji EDC'));
    }
    const json = await res.json();
    return json.item;
  },

  // Local Staff PIN Auth & Shifts (100% SQLite)
  async loginPin(pin: string): Promise<{ user: User }> {
    const res = await fetch(`${API_BASE}/api/auth/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin.trim() }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'PIN tidak valid. Silakan coba lagi.'));
    }
    return res.json();
  },

  async getCurrentShift(
    terminalId = 'TERM-01',
  ): Promise<{ shift: Shift | null; summary: ShiftSummary | null }> {
    const res = await fetch(`${API_BASE}/api/shifts/current?terminalId=${terminalId}`);
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Failed to fetch current shift'));
    }
    return res.json();
  },

  async openShift(payload: {
    outletId: string;
    terminalId: string;
    cashierId: string;
    cashierName: string;
    startingCash: number;
  }): Promise<{ shift: Shift }> {
    const res = await fetch(`${API_BASE}/api/shifts/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Failed to open shift'));
    }
    return res.json();
  },

  async closeShift(payload: {
    shiftId: string;
    actualCash: number;
    notes?: string;
    cashierId: string;
    cashierName: string;
  }): Promise<{ shift: Shift }> {
    const res = await fetch(`${API_BASE}/api/shifts/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res, 'Failed to close shift'));
    }
    return res.json();
  },
};
