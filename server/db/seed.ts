// server/db/seed.ts
import type { DatabaseSync } from 'node:sqlite';
import {
  ensureLocalModifierGroups,
  resolveLocalModifierGroupIdsForProduct,
} from '../catalog/local-modifier-groups.service.js';
import { getOutletEnvConfig } from '../config/outlet-env.js';
import {
  formatLocalDateKey,
  formatLocalOrderNumber,
  resolveOutletTrxPrefix,
} from '../util/local-trx-code.util.js';

export interface SeedProductDef {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string | null;
  basePriceRegular: number;
  basePriceLarge: number;
  stockQty: number;
}

export interface SeedUserDef {
  id: string;
  username: string;
  name: string;
  role: 'CASHIER' | 'BARISTA' | 'SUPERVISOR' | 'MANAGER';
  pin: string;
}

export interface SeedSummary {
  productsSeeded: number;
  usersSeeded: number;
  edcConfigsSeeded: number;
  shiftsSeeded: number;
  ordersSeeded: number;
}

export const REAL_SEED_PRODUCTS: SeedProductDef[] = [
  {
    id: 'c2c940c6-9366-495c-80d6-801169964cf2',
    sku: 'PRD-RC3UID',
    name: 'Berry Honey Lemon',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Berry Honey Lemon',
    basePriceRegular: 37000,
    basePriceLarge: 42550,
    stockQty: 48,
  },
  {
    id: '20ec2e26-2984-4c2f-9fbc-514c134882a0',
    sku: 'PRD-1LS83P',
    name: 'Coconut Macha',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Coconut Macha',
    basePriceRegular: 39000,
    basePriceLarge: 44850,
    stockQty: 36,
  },
  {
    id: '29d70b32-9373-4538-a797-df659f16a754',
    sku: 'PRD-M4TYJ9',
    name: 'Forest Honey Lychee',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Forest Honey Lychee',
    basePriceRegular: 33000,
    basePriceLarge: 37950,
    stockQty: 52,
  },
  {
    id: '187ef77a-39b0-4659-95be-32c6293cedcf',
    sku: 'PRD-ISK6X6',
    name: 'Honey Lemon Tea',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Honey Lemon Tea',
    basePriceRegular: 36000,
    basePriceLarge: 41400,
    stockQty: 45,
  },
  {
    id: '7b82c1ac-61b9-4de4-b408-5b563c6ea0a2',
    sku: 'PRD-4TP62S',
    name: 'Kiwi Lemonade',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Kiwi Lemonade',
    basePriceRegular: 36000,
    basePriceLarge: 41400,
    stockQty: 40,
  },
  {
    id: 'd328ca4d-cd88-4db0-9819-44da7b3c5562',
    sku: 'PRD-ZEZ25B',
    name: 'Matcha Latte',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Matcha Latte',
    basePriceRegular: 39000,
    basePriceLarge: 44850,
    stockQty: 55,
  },
  {
    id: '7120f043-ee76-472c-ba28-b11643be830a',
    sku: 'PRD-Z581DS',
    name: 'Matcha Taro',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Matcha Taro',
    basePriceRegular: 39000,
    basePriceLarge: 44850,
    stockQty: 38,
  },
  {
    id: 'c15c73d2-1ab4-4f22-a8ed-00e509a8d3f4',
    sku: 'PRD-G81TJV',
    name: 'Raspberry Lemonade',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Raspberry Lemonade',
    basePriceRegular: 36000,
    basePriceLarge: 41400,
    stockQty: 42,
  },
  {
    id: '87f36dc4-fcee-4837-a161-c75df4d9b27d',
    sku: 'PRD-4T8APS',
    name: 'Strawberry Lemonade',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Strawberry Lemonade',
    basePriceRegular: 36000,
    basePriceLarge: 41400,
    stockQty: 44,
  },
  {
    id: '74c80c9b-d334-44c9-a6d1-62ee2b9d6dcc',
    sku: 'PRD-C890Q8',
    name: 'Summer Botanical Tea',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Summer Botanical Tea',
    basePriceRegular: 28000,
    basePriceLarge: 32200,
    stockQty: 60,
  },
  {
    id: '059f11e4-6d85-431e-9ec0-b0a5c979aba8',
    sku: 'PRD-UBQ0RC',
    name: 'Summit Peach Mango Tea',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Summit Peach Mango Tea',
    basePriceRegular: 33000,
    basePriceLarge: 37950,
    stockQty: 50,
  },
  {
    id: '186e66c3-b15a-4b4c-9638-a1980f198570',
    sku: 'PRD-0PWEG6',
    name: 'Yuzu Jasmine Lemonade',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Yuzu Jasmine Lemonade',
    basePriceRegular: 39000,
    basePriceLarge: 44850,
    stockQty: 35,
  },
  {
    id: '4d6f48b7-7e2e-4c7d-a678-4088db6b8da2',
    sku: 'PRD-AJ3IB6',
    name: 'Yuzu Lemonade',
    category: 'Artisan Teas & Non-Coffee',
    description: 'Yuzu Lemonade',
    basePriceRegular: 38000,
    basePriceLarge: 43700,
    stockQty: 46,
  },
  {
    id: 'e18bcc11-be64-428b-8bbc-2ac5bd80c60b',
    sku: 'PRD-19UY2I',
    name: 'Butterscotch Sea Salt',
    category: 'Espresso & Milk',
    description: 'Butterscotch Sea Salt',
    basePriceRegular: 37000,
    basePriceLarge: 42550,
    stockQty: 58,
  },
  {
    id: 'b7500438-0054-4ac7-99f6-eab3ac0e2ed4',
    sku: 'PRD-V8I2FQ',
    name: 'Caffe Latte',
    category: 'Espresso & Milk',
    description: 'Caffe Latte in SakuPOS - Coffee',
    basePriceRegular: 36000,
    basePriceLarge: 41400,
    stockQty: 75,
  },
  {
    id: 'd631d371-2416-49e6-87ce-c8799ad70015',
    sku: 'PRD-527OG6',
    name: 'Cappucino',
    category: 'Espresso & Milk',
    description: 'Cappucino',
    basePriceRegular: 36000,
    basePriceLarge: 41400,
    stockQty: 68,
  },
  {
    id: '7698a992-6f63-477d-9e69-41203b8baf6a',
    sku: 'PRD-8FJ07J',
    name: 'Clasic Mount Blanc',
    category: 'Espresso & Milk',
    description: 'Mount Blanc Classic by SakuPOS - Coffee',
    basePriceRegular: 40000,
    basePriceLarge: 46000,
    stockQty: 42,
  },
  {
    id: '231ca0a5-1802-46c3-a7a3-53faa950f92c',
    sku: 'PRD-VCIG4R',
    name: 'Classic Montblanc',
    category: 'Espresso & Milk',
    description: 'Classic Montblanc',
    basePriceRegular: 40000,
    basePriceLarge: 46000,
    stockQty: 40,
  },
  {
    id: 'a68d18f9-e117-4434-af45-a19923082b1a',
    sku: 'PRD-FIGWBW',
    name: 'SakuPOS Signature Coffee',
    category: 'Espresso & Milk',
    description: 'SakuPOS Signature Coffee',
    basePriceRegular: 35000,
    basePriceLarge: 40250,
    stockQty: 65,
  },
  {
    id: 'e7235695-989f-4b91-9ea4-4dc1c57e0f28',
    sku: 'PRD-2HWVX3',
    name: 'Ice Cappucino',
    category: 'Espresso & Milk',
    description: 'Ice Cappucino',
    basePriceRegular: 40000,
    basePriceLarge: 46000,
    stockQty: 64,
  },
  {
    id: 'a06b11ad-8b9f-44a7-a5e8-1e7f6606943b',
    sku: 'PRD-Z3NMET',
    name: 'Ice Latte',
    category: 'Espresso & Milk',
    description: 'Ice Latte in SakuPOS - Coffee',
    basePriceRegular: 40000,
    basePriceLarge: 46000,
    stockQty: 72,
  },
  {
    id: '8307c408-14f7-40f3-9058-3e26cbb61918',
    sku: 'PRD-N305Y9',
    name: 'Iced Long Black',
    category: 'Espresso & Milk',
    description: 'Iced Long Black',
    basePriceRegular: 37000,
    basePriceLarge: 42550,
    stockQty: 70,
  },
  {
    id: '10d21cc1-f44d-4a1b-8ea9-a9a98cdde280',
    sku: 'PRD-PALM-01',
    name: 'Iced Palm Sugar Latte',
    category: 'Espresso & Milk',
    description: 'Signature kopi susu gula aren organik SakuPOS - Coffee',
    basePriceRegular: 28000,
    basePriceLarge: 32200,
    stockQty: 80,
  },
  {
    id: 'e8bcdfed-873a-43a7-afd4-e1e94b18fdd0',
    sku: 'PRD-GLWTJZ',
    name: 'Long Black',
    category: 'Espresso & Milk',
    description: 'Long Black',
    basePriceRegular: 37000,
    basePriceLarge: 42550,
    stockQty: 66,
  },
  {
    id: '2c115f67-5709-4c96-9a9b-bd2d9b85acb8',
    sku: 'PRD-YFGSEV',
    name: 'Nutty Oat Latte',
    category: 'Espresso & Milk',
    description: 'Nutty Oat Latte',
    basePriceRegular: 37000,
    basePriceLarge: 42550,
    stockQty: 48,
  },
  {
    id: '80de660d-0a6d-406a-827a-e4d413ac4542',
    sku: 'PRD-QXLSNH',
    name: 'Matcha Strawberry Cheese Cake',
    category: 'Pastries & Snacks',
    description: 'Matcha Strawberry Cheese Cake',
    basePriceRegular: 47000,
    basePriceLarge: 54050,
    stockQty: 24,
  },
];

export const REAL_SEED_USERS: SeedUserDef[] = [
  { id: 'usr_asep', username: 'asep', name: 'Asep Hidayat', role: 'CASHIER', pin: '12345' },
  { id: 'usr_raka', username: 'raka', name: 'Raka Pratama', role: 'CASHIER', pin: '11223' },
  { id: 'usr_luthfia', username: 'luthfia', name: 'Luthfia', role: 'BARISTA', pin: '20261' },
  { id: 'usr_nadia', username: 'nadia', name: 'Nadia Putri', role: 'BARISTA', pin: '33445' },
  { id: 'usr_spv', username: 'spv', name: 'Supervisor Outlet', role: 'SUPERVISOR', pin: '88888' },
  { id: 'usr_mgr', username: 'manager', name: 'Manager Outlet', role: 'MANAGER', pin: '99999' },
];

export const REAL_SEED_EDC_CONFIGS = [
  {
    id: 'edc_danamon_serial',
    name: 'EDC Danamon Counter 1 (USB)',
    bank: 'Danamon',
    connectionType: 'SERIAL' as const,
    host: null,
    ipPis: null,
    ipTerminal: null,
    port: null,
    baudRate: 115200,
    portPath: 'COM3',
    terminalId: 'DANAMON-01',
    isDefault: true,
    isActive: true,
  },
  {
    id: 'edc_mandiri_tcp',
    name: 'EDC Mandiri Backup (LAN)',
    bank: 'Mandiri',
    connectionType: 'TCP_IP' as const,
    host: '192.168.1.55',
    ipPis: '192.168.1.55',
    ipTerminal: '192.168.1.55',
    port: 2001,
    baudRate: 9600,
    portPath: null,
    terminalId: 'MANDIRI-02',
    isDefault: false,
    isActive: true,
  },
];

interface SeedOrderItemSpec {
  productId: string;
  variantSize: 'Regular' | 'Large';
  quantity: number;
  notes?: string;
  modifiers?: Array<{
    groupId: string;
    groupName: string;
    optionId: string;
    optionName: string;
    price: number;
  }>;
}

interface SeedOrderSpec {
  id: string;
  dayOffset: -2 | -1;
  hour: number;
  minute: number;
  seq: number;
  shiftId: string;
  cashierId: string;
  cashierName: string;
  customerName: string;
  diningOption: 'takeaway' | 'dinein';
  pagerNumber: string | null;
  status: 'PENDING' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  paymentMethod: string | null;
  paymentRef: string | null;
  items: SeedOrderItemSpec[];
}

function makeHistoricalIso(dayOffset: number, hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function makeHistoricalDate(dayOffset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d;
}

const MOD_SUGAR_50 = {
  groupId: 'mod_sugar',
  groupName: 'Sugar Level',
  optionId: 'sug_50',
  optionName: 'Less Sugar (50%)',
  price: 0,
};
const MOD_ICE_LESS = {
  groupId: 'mod_ice',
  groupName: 'Ice Level',
  optionId: 'ice_less',
  optionName: 'Less Ice',
  price: 0,
};
const MOD_MILK_OAT = {
  groupId: 'mod_milk',
  groupName: 'Dairy & Plant Milk',
  optionId: 'milk_oat',
  optionName: 'Oatly Oat Milk',
  price: 8000,
};
const MOD_SHOT_1 = {
  groupId: 'mod_shots',
  groupName: 'Espresso Shots',
  optionId: 'shot_1',
  optionName: 'Extra Shot (1x)',
  price: 6000,
};

const HISTORICAL_ORDER_SPECS: SeedOrderSpec[] = [
  // --- H-2 (Shift 1: usr_asep) ---
  {
    id: 'ord_seed_01',
    dayOffset: -2,
    hour: 9,
    minute: 15,
    seq: 1,
    shiftId: 'shift_seed_h2',
    cashierId: 'usr_asep',
    cashierName: 'Asep Hidayat',
    customerName: 'Budi Santoso',
    diningOption: 'takeaway',
    pagerNumber: '01',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    paymentMethod: 'CASH',
    paymentRef: 'CASH-HIST-001',
    items: [
      { productId: 'b7500438-0054-4ac7-99f6-eab3ac0e2ed4', variantSize: 'Regular', quantity: 1, modifiers: [MOD_SUGAR_50, MOD_MILK_OAT] },
      { productId: '74c80c9b-d334-44c9-a6d1-62ee2b9d6dcc', variantSize: 'Regular', quantity: 1, modifiers: [MOD_ICE_LESS] },
    ],
  },
  {
    id: 'ord_seed_02',
    dayOffset: -2,
    hour: 10,
    minute: 30,
    seq: 2,
    shiftId: 'shift_seed_h2',
    cashierId: 'usr_asep',
    cashierName: 'Asep Hidayat',
    customerName: 'Siti Rahma',
    diningOption: 'dinein',
    pagerNumber: '02',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    paymentMethod: 'QRIS',
    paymentRef: 'QRIS-HIST-882101',
    items: [
      { productId: 'a06b11ad-8b9f-44a7-a5e8-1e7f6606943b', variantSize: 'Large', quantity: 1, modifiers: [MOD_MILK_OAT] },
      { productId: '4d6f48b7-7e2e-4c7d-a678-4088db6b8da2', variantSize: 'Regular', quantity: 1, modifiers: [MOD_ICE_LESS] },
    ],
  },
  {
    id: 'ord_seed_03',
    dayOffset: -2,
    hour: 12,
    minute: 10,
    seq: 3,
    shiftId: 'shift_seed_h2',
    cashierId: 'usr_asep',
    cashierName: 'Asep Hidayat',
    customerName: 'Dimas Wijaya',
    diningOption: 'takeaway',
    pagerNumber: '03',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    paymentMethod: 'EDC_DEBIT',
    paymentRef: 'APPR:441209 | RRN:000011223344 | TID:DANAMON-01',
    items: [
      { productId: 'd631d371-2416-49e6-87ce-c8799ad70015', variantSize: 'Regular', quantity: 2, modifiers: [MOD_SHOT_1] },
    ],
  },
  {
    id: 'ord_seed_04',
    dayOffset: -2,
    hour: 14,
    minute: 45,
    seq: 4,
    shiftId: 'shift_seed_h2',
    cashierId: 'usr_asep',
    cashierName: 'Asep Hidayat',
    customerName: 'Rina Marlina',
    diningOption: 'dinein',
    pagerNumber: '04',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    paymentMethod: 'CASH',
    paymentRef: 'CASH-HIST-004',
    items: [
      { productId: 'd328ca4d-cd88-4db0-9819-44da7b3c5562', variantSize: 'Large', quantity: 1, modifiers: [MOD_SUGAR_50] },
      { productId: '80de660d-0a6d-406a-827a-e4d413ac4542', variantSize: 'Regular', quantity: 1 },
    ],
  },
  {
    id: 'ord_seed_05',
    dayOffset: -2,
    hour: 16,
    minute: 20,
    seq: 5,
    shiftId: 'shift_seed_h2',
    cashierId: 'usr_asep',
    cashierName: 'Asep Hidayat',
    customerName: 'Fajar Nugroho',
    diningOption: 'takeaway',
    pagerNumber: null,
    status: 'CANCELLED',
    paymentStatus: 'REFUNDED',
    paymentMethod: 'CASH',
    paymentRef: 'REFUND-HIST-005',
    items: [
      { productId: 'e7235695-989f-4b91-9ea4-4dc1c57e0f28', variantSize: 'Large', quantity: 1 },
    ],
  },
  {
    id: 'ord_seed_06',
    dayOffset: -2,
    hour: 17,
    minute: 50,
    seq: 6,
    shiftId: 'shift_seed_h2',
    cashierId: 'usr_asep',
    cashierName: 'Asep Hidayat',
    customerName: 'Walk-in',
    diningOption: 'takeaway',
    pagerNumber: '05',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    paymentMethod: 'EDC_CREDIT',
    paymentRef: 'APPR:773910 | RRN:000055667788 | TID:DANAMON-01',
    items: [
      { productId: 'e8bcdfed-873a-43a7-afd4-e1e94b18fdd0', variantSize: 'Regular', quantity: 1 },
      { productId: '29d70b32-9373-4538-a797-df659f16a754', variantSize: 'Regular', quantity: 1 },
    ],
  },

  // --- H-1 (Shift 2: usr_raka) ---
  {
    id: 'ord_seed_07',
    dayOffset: -1,
    hour: 8,
    minute: 40,
    seq: 1,
    shiftId: 'shift_seed_h1',
    cashierId: 'usr_raka',
    cashierName: 'Raka Pratama',
    customerName: 'Hendra Kusuma',
    diningOption: 'takeaway',
    pagerNumber: '06',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    paymentMethod: 'CASH',
    paymentRef: 'CASH-HIST-007',
    items: [
      { productId: '10d21cc1-f44d-4a1b-8ea9-a9a98cdde280', variantSize: 'Large', quantity: 2, modifiers: [MOD_ICE_LESS] },
    ],
  },
  {
    id: 'ord_seed_08',
    dayOffset: -1,
    hour: 9,
    minute: 55,
    seq: 2,
    shiftId: 'shift_seed_h1',
    cashierId: 'usr_raka',
    cashierName: 'Raka Pratama',
    customerName: 'Maya Lestari',
    diningOption: 'dinein',
    pagerNumber: '07',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    paymentMethod: 'QRIS',
    paymentRef: 'QRIS-HIST-992014',
    items: [
      { productId: 'e18bcc11-be64-428b-8bbc-2ac5bd80c60b', variantSize: 'Regular', quantity: 1, modifiers: [MOD_SUGAR_50] },
      { productId: 'c2c940c6-9366-495c-80d6-801169964cf2', variantSize: 'Regular', quantity: 1 },
    ],
  },
  {
    id: 'ord_seed_09',
    dayOffset: -1,
    hour: 11,
    minute: 20,
    seq: 3,
    shiftId: 'shift_seed_h1',
    cashierId: 'usr_raka',
    cashierName: 'Raka Pratama',
    customerName: 'Bagas Prakoso',
    diningOption: 'takeaway',
    pagerNumber: '08',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    paymentMethod: 'EDC_DEBIT',
    paymentRef: 'APPR:661820 | RRN:000088776655 | TID:DANAMON-01',
    items: [
      { productId: '2c115f67-5709-4c96-9a9b-bd2d9b85acb8', variantSize: 'Large', quantity: 1, modifiers: [MOD_SHOT_1] },
      { productId: '8307c408-14f7-40f3-9058-3e26cbb61918', variantSize: 'Regular', quantity: 1 },
    ],
  },
  {
    id: 'ord_seed_10',
    dayOffset: -1,
    hour: 13,
    minute: 15,
    seq: 4,
    shiftId: 'shift_seed_h1',
    cashierId: 'usr_raka',
    cashierName: 'Raka Pratama',
    customerName: 'Tari Wulandari',
    diningOption: 'dinein',
    pagerNumber: '09',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    paymentMethod: 'CASH',
    paymentRef: 'CASH-HIST-010',
    items: [
      { productId: '187ef77a-39b0-4659-95be-32c6293cedcf', variantSize: 'Regular', quantity: 1 },
      { productId: '059f11e4-6d85-431e-9ec0-b0a5c979aba8', variantSize: 'Regular', quantity: 1 },
    ],
  },
  {
    id: 'ord_seed_11',
    dayOffset: -1,
    hour: 15,
    minute: 5,
    seq: 5,
    shiftId: 'shift_seed_h1',
    cashierId: 'usr_raka',
    cashierName: 'Raka Pratama',
    customerName: 'Gilang Ramadhan',
    diningOption: 'takeaway',
    pagerNumber: '10',
    status: 'READY',
    paymentStatus: 'PAID',
    paymentMethod: 'QRIS',
    paymentRef: 'QRIS-HIST-992088',
    items: [
      { productId: 'a68d18f9-e117-4434-af45-a19923082b1a', variantSize: 'Regular', quantity: 2, modifiers: [MOD_SUGAR_50] },
    ],
  },
  {
    id: 'ord_seed_12',
    dayOffset: -1,
    hour: 16,
    minute: 10,
    seq: 6,
    shiftId: 'shift_seed_h1',
    cashierId: 'usr_raka',
    cashierName: 'Raka Pratama',
    customerName: 'Dewi Anggraini',
    diningOption: 'dinein',
    pagerNumber: '11',
    status: 'PREPARING',
    paymentStatus: 'PAID',
    paymentMethod: 'CASH',
    paymentRef: 'CASH-HIST-012',
    items: [
      { productId: '7698a992-6f63-477d-9e69-41203b8baf6a', variantSize: 'Regular', quantity: 1 },
      { productId: '7b82c1ac-61b9-4de4-b408-5b563c6ea0a2', variantSize: 'Regular', quantity: 1 },
    ],
  },
  {
    id: 'ord_seed_13',
    dayOffset: -1,
    hour: 17,
    minute: 25,
    seq: 7,
    shiftId: 'shift_seed_h1',
    cashierId: 'usr_raka',
    cashierName: 'Raka Pratama',
    customerName: 'Ayu Pertiwi',
    diningOption: 'takeaway',
    pagerNumber: '12',
    status: 'PENDING',
    paymentStatus: 'PENDING',
    paymentMethod: null,
    paymentRef: null,
    items: [
      { productId: '87f36dc4-fcee-4837-a161-c75df4d9b27d', variantSize: 'Regular', quantity: 1 },
      { productId: '186e66c3-b15a-4b4c-9638-a1980f198570', variantSize: 'Regular', quantity: 1 },
    ],
  },
  {
    id: 'ord_seed_14',
    dayOffset: -1,
    hour: 18,
    minute: 0,
    seq: 8,
    shiftId: 'shift_seed_h1',
    cashierId: 'usr_raka',
    cashierName: 'Raka Pratama',
    customerName: 'Reza Mahendra',
    diningOption: 'takeaway',
    pagerNumber: '14',
    status: 'PENDING',
    paymentStatus: 'PENDING',
    paymentMethod: null,
    paymentRef: null,
    items: [
      { productId: '7120f043-ee76-472c-ba28-b11643be830a', variantSize: 'Large', quantity: 1, modifiers: [MOD_MILK_OAT] },
    ],
  },
];

export function seedFullLocalDatabase(
  db: DatabaseSync,
  options?: { includeTransactions?: boolean },
): SeedSummary {
  const now = new Date().toISOString();
  const outletCfg = getOutletEnvConfig();
  const trxPrefix = resolveOutletTrxPrefix();
  const productById = new Map(REAL_SEED_PRODUCTS.map((p) => [p.id, p]));

  ensureLocalModifierGroups(db);

  let productsSeeded = 0;
  let usersSeeded = 0;
  let edcConfigsSeeded = 0;
  let shiftsSeeded = 0;
  let ordersSeeded = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    // 1. Master Products
    const prodCount = (db.prepare('SELECT count(*) as c FROM products').get() as { c: number }).c;
    if (prodCount === 0) {
      const insertProd = db.prepare(`
        INSERT INTO products (
          id, sku, name, category, description,
          base_price_regular, base_price_large, image_url,
          is_active, is_sold_out, stock_qty, modifier_group_ids_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, ?, ?, ?)
      `);
      for (const p of REAL_SEED_PRODUCTS) {
        const modIds = resolveLocalModifierGroupIdsForProduct(p.category, p.name);
        insertProd.run(
          p.id,
          p.sku,
          p.name,
          p.category,
          p.description,
          p.basePriceRegular,
          p.basePriceLarge,
          p.stockQty,
          JSON.stringify(modIds),
          now,
        );
        productsSeeded++;
      }
    }

    // 2. Staff Users
    const userCount = (db.prepare('SELECT count(*) as c FROM users').get() as { c: number }).c;
    if (userCount === 0) {
      const insertUser = db.prepare(`
        INSERT INTO users (id, username, name, role, pin, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `);
      for (const u of REAL_SEED_USERS) {
        insertUser.run(u.id, u.username, u.name, u.role, u.pin, now);
        usersSeeded++;
      }
    }

    // 3. EDC Configurations
    const edcCount = (db.prepare('SELECT count(*) as c FROM edc_configurations').get() as { c: number }).c;
    if (edcCount === 0) {
      const insertEdc = db.prepare(`
        INSERT INTO edc_configurations (
          id, name, bank, connection_type, host, ip_pis, ip_terminal,
          port, baud_rate, port_path, is_default, terminal_id, is_active,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const e of REAL_SEED_EDC_CONFIGS) {
        insertEdc.run(
          e.id,
          e.name,
          e.bank,
          e.connectionType,
          e.host,
          e.ipPis,
          e.ipTerminal,
          e.port,
          e.baudRate,
          e.portPath,
          e.isDefault ? 1 : 0,
          e.terminalId,
          e.isActive ? 1 : 0,
          now,
          now,
        );
        edcConfigsSeeded++;
      }
    }

    // 4. Historical Shifts & Orders
    const includeTx = options?.includeTransactions !== false;
    if (includeTx) {
      const shiftCount = (db.prepare('SELECT count(*) as c FROM shifts').get() as { c: number }).c;
      const orderCount = (db.prepare('SELECT count(*) as c FROM orders').get() as { c: number }).c;

      if (shiftCount === 0 && orderCount === 0) {
        const shiftAgg: Record<
          string,
          {
            orders: number;
            cups: number;
            gross: number;
            tax: number;
            net: number;
            cash: number;
            qris: number;
            edc: number;
          }
        > = {
          shift_seed_h2: { orders: 0, cups: 0, gross: 0, tax: 0, net: 0, cash: 0, qris: 0, edc: 0 },
          shift_seed_h1: { orders: 0, cups: 0, gross: 0, tax: 0, net: 0, cash: 0, qris: 0, edc: 0 },
        };

        const insertOrder = db.prepare(`
          INSERT INTO orders (
            id, order_number, outlet_id, outlet_name, terminal_id,
            cashier_id, cashier_name, shift_id, customer_name, dining_option, pager_number,
            status, payment_status, payment_method, payment_ref,
            subtotal, discount, tax, total_amount, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)
        `);

        const insertItem = db.prepare(`
          INSERT INTO order_items (
            id, order_id, product_id, product_name, variant_size,
            base_price, modifiers_price, unit_price, quantity, subtotal,
            notes, modifiers_json, cup_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
        `);

        const insertPrint = db.prepare(`
          INSERT INTO print_jobs (
            id, order_id, job_type, label_index, total_labels,
            item_name, variant_size, modifiers_summary, payload_json,
            status, is_reprint, retry_count, created_at, printed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
        `);

        for (const spec of HISTORICAL_ORDER_SPECS) {
          const orderDate = makeHistoricalDate(spec.dayOffset);
          const orderNumber = formatLocalOrderNumber(orderDate, spec.seq, trxPrefix);
          const createdAt = makeHistoricalIso(spec.dayOffset, spec.hour, spec.minute);

          let subtotal = 0;
          let totalCups = 0;
          const computedItems = spec.items.map((it, idx) => {
            const prod = productById.get(it.productId)!;
            const basePrice = it.variantSize === 'Large' ? prod.basePriceLarge : prod.basePriceRegular;
            const mods = it.modifiers || [];
            const modifiersPrice = mods.reduce((sum, m) => sum + m.price, 0);
            const unitPrice = basePrice + modifiersPrice;
            const lineSubtotal = unitPrice * it.quantity;
            subtotal += lineSubtotal;
            totalCups += it.quantity;
            return {
              id: `${spec.id}_it_${idx + 1}`,
              prod,
              variantSize: it.variantSize,
              basePrice,
              modifiersPrice,
              unitPrice,
              quantity: it.quantity,
              lineSubtotal,
              modifiers: mods,
            };
          });

          const tax = Math.round(subtotal * 0.1);
          const totalAmount = subtotal + tax;

          insertOrder.run(
            spec.id,
            orderNumber,
            outletCfg.outletId,
            outletCfg.outletDisplayName,
            outletCfg.terminalId,
            spec.cashierId,
            spec.cashierName,
            spec.shiftId,
            spec.customerName,
            spec.diningOption,
            spec.pagerNumber,
            spec.status,
            spec.paymentStatus,
            spec.paymentMethod,
            spec.paymentRef,
            subtotal,
            tax,
            totalAmount,
            createdAt,
            createdAt,
          );
          ordersSeeded++;

          let cupIndex = 1;
          for (const ci of computedItems) {
            insertItem.run(
              ci.id,
              spec.id,
              ci.prod.id,
              ci.prod.name,
              ci.variantSize,
              ci.basePrice,
              ci.modifiersPrice,
              ci.unitPrice,
              ci.quantity,
              ci.lineSubtotal,
              JSON.stringify(ci.modifiers),
              ci.quantity,
              createdAt,
            );

            for (let q = 0; q < ci.quantity; q++) {
              const modSummary = ci.modifiers.map((m) => m.optionName);
              const payload = {
                orderId: spec.id,
                orderNumber,
                outletName: outletCfg.outletDisplayName,
                customerName: spec.customerName,
                orderTime: createdAt,
                pagerNumber: spec.pagerNumber || undefined,
                cupIndex,
                totalCups,
                productName: ci.prod.name,
                variantSize: ci.variantSize,
                modifiersSummary: modSummary,
                isReprint: false,
                barcodeValue: `${orderNumber}-${cupIndex}`,
              };
              const jobStatus = spec.paymentStatus === 'PAID' ? 'COMPLETED' : 'PENDING';
              insertPrint.run(
                `${spec.id}_cup_${cupIndex}`,
                spec.id,
                'CUP_LABEL',
                cupIndex,
                totalCups,
                ci.prod.name,
                ci.variantSize,
                modSummary.join(', '),
                JSON.stringify(payload),
                jobStatus,
                createdAt,
                spec.paymentStatus === 'PAID' ? createdAt : null,
              );
              cupIndex++;
            }
          }

          // Receipt print job
          insertPrint.run(
            `${spec.id}_rcpt`,
            spec.id,
            'RECEIPT',
            1,
            1,
            'Customer Bill Receipt',
            '',
            '',
            JSON.stringify({
              orderId: spec.id,
              orderNumber,
              outletName: outletCfg.outletDisplayName,
              terminalId: outletCfg.terminalId,
              cashierName: spec.cashierName,
              customerName: spec.customerName,
              orderTime: createdAt,
              subtotal,
              tax,
              discount: 0,
              totalAmount,
            }),
            spec.paymentStatus === 'PAID' ? 'COMPLETED' : 'PENDING',
            createdAt,
            spec.paymentStatus === 'PAID' ? createdAt : null,
          );

          if (spec.paymentStatus === 'PAID' && spec.status !== 'CANCELLED') {
            const agg = shiftAgg[spec.shiftId];
            agg.orders += 1;
            agg.cups += totalCups;
            agg.gross += subtotal;
            agg.tax += tax;
            agg.net += totalAmount;
            if (spec.paymentMethod === 'CASH') agg.cash += totalAmount;
            else if (spec.paymentMethod === 'QRIS') agg.qris += totalAmount;
            else agg.edc += totalAmount;
          }
        }

        // Order sequences for historical days
        const insertSeq = db.prepare(`
          INSERT OR REPLACE INTO order_sequence (date_key, current_seq) VALUES (?, ?)
        `);
        insertSeq.run(formatLocalDateKey(makeHistoricalDate(-2)), 6);
        insertSeq.run(formatLocalDateKey(makeHistoricalDate(-1)), 8);

        // Two closed historical shifts
        const insertShift = db.prepare(`
          INSERT INTO shifts (
            id, outlet_id, terminal_id, cashier_id, cashier_name,
            opened_at, closed_at, status, starting_cash, expected_cash,
            actual_cash, cash_difference, total_orders, total_cups,
            total_gross_sales, total_discount, total_tax, total_net_sales,
            payment_summary_json, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CLOSED', ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?, ?)
        `);

        const shiftConfigs = [
          {
            id: 'shift_seed_h2',
            dayOffset: -2,
            cashierId: 'usr_asep',
            cashierName: 'Asep Hidayat',
            startingCash: 200000,
            notes: 'Closing shift normal (seed H-2)',
          },
          {
            id: 'shift_seed_h1',
            dayOffset: -1,
            cashierId: 'usr_raka',
            cashierName: 'Raka Pratama',
            startingCash: 250000,
            notes: 'Closing shift sore (seed H-1)',
          },
        ];

        for (const sc of shiftConfigs) {
          const agg = shiftAgg[sc.id];
          const openedAt = makeHistoricalIso(sc.dayOffset, 8, 0);
          const closedAt = makeHistoricalIso(sc.dayOffset, 21, 0);
          const expectedCash = sc.startingCash + agg.cash;

          insertShift.run(
            sc.id,
            outletCfg.outletId,
            outletCfg.terminalId,
            sc.cashierId,
            sc.cashierName,
            openedAt,
            closedAt,
            sc.startingCash,
            expectedCash,
            expectedCash,
            agg.orders,
            agg.cups,
            agg.gross,
            agg.tax,
            agg.net,
            JSON.stringify({ CASH: agg.cash, QRIS: agg.qris, EDC: agg.edc }),
            sc.notes,
            openedAt,
          );
          shiftsSeeded++;

          insertPrint.run(
            `${sc.id}_zreport`,
            sc.id,
            'RECEIPT',
            1,
            1,
            'Z-REPORT CLOSING',
            'EOD',
            'SUMMARY',
            JSON.stringify({
              type: 'EOD_Z_REPORT',
              shiftId: sc.id,
              zReportText: `Z-REPORT ${sc.id} | Orders: ${agg.orders} | Net: Rp ${agg.net.toLocaleString('id-ID')}`,
            }),
            'COMPLETED',
            closedAt,
            closedAt,
          );
        }
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    productsSeeded,
    usersSeeded,
    edcConfigsSeeded,
    shiftsSeeded,
    ordersSeeded,
  };
}
