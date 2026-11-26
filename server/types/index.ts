// server/types/index.ts

export type OrderStatus = 'PENDING' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'UNKNOWN' | 'REFUNDED';
export type VariantSize = 'Regular' | 'Large';

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

export interface OrderItemInput {
  productId: string;
  variantSize: VariantSize;
  quantity: number;
  notes?: string;
  selectedModifiers?: SelectedModifier[];
}

export interface CreateOrderRequest {
  outletId: string;
  terminalId: string;
  cashierId: string;
  cashierName: string;
  shiftId?: string;
  customerName?: string;
  diningOption?: 'takeaway' | 'dinein';
  pagerNumber?: string;
  notes?: string;
  items: OrderItemInput[];
  idempotencyKey?: string;
}

export interface OrderItemRecord {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  variantSize: VariantSize;
  basePrice: number;
  modifiersPrice: number;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  notes?: string;
  modifiers: SelectedModifier[];
  cupCount: number;
  createdAt: string;
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  outletId: string;
  outletName: string;
  terminalId: string;
  cashierId: string;
  cashierName: string;
  shiftId?: string;
  customerName: string;
  diningOption: string;
  pagerNumber?: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: string;
  paymentRef?: string;
  subtotal: number;
  discount: number;
  tax: number;
  totalAmount: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  items?: OrderItemRecord[];
}

export interface EdcConfigurationRecord {
  id: string;
  name: string;
  bank: string | null;
  connectionType: 'TCP_IP' | 'SERIAL';
  host: string | null;
  ipPis: string | null;
  ipTerminal: string | null;
  port: number | null;
  baudRate: number;
  portPath: string | null;
  vendorId?: string | null;
  productId?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  isDefault: boolean;
  terminalId: string | null;
  lastTestStatus: 'CONNECTED' | 'FAILED' | null;
  lastTestedAt: string | null;
  lastTestError: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CupLabelPayload {
  orderId: string;
  orderNumber: string;
  outletName: string;
  customerName: string;
  orderTime: string;
  pagerNumber?: string;
  cupIndex: number;
  totalCups: number;
  productName: string;
  variantSize: VariantSize;
  modifiersSummary: string[];
  notes?: string;
  isReprint?: boolean;
  barcodeValue?: string;
}

export interface PrintJobRecord {
  id: string;
  orderId: string;
  jobType: 'RECEIPT' | 'CUP_LABEL';
  labelIndex: number;
  totalLabels: number;
  itemName?: string;
  variantSize?: string;
  modifiersSummary?: string;
  payload: any;
  status: 'PENDING' | 'PRINTING' | 'COMPLETED' | 'FAILED';
  isReprint: boolean;
  retryCount: number;
  lastError?: string;
  createdAt: string;
  printedAt?: string;
}

export interface UserRecord {
  id: string;
  username: string;
  name: string;
  role: 'CASHIER' | 'BARISTA' | 'SUPERVISOR' | 'MANAGER';
  pin: string;
  isActive: boolean;
  createdAt: string;
}

export interface ShiftRecord {
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
  createdAt: string;
}

export interface OpenShiftRequest {
  outletId: string;
  terminalId: string;
  cashierId: string;
  cashierName: string;
  startingCash: number;
}

export interface CloseShiftRequest {
  shiftId: string;
  actualCash: number;
  notes?: string;
  cashierId: string;
  cashierName: string;
}

