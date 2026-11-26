// tests/p0-core.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OutletDatabase } from '../server/db/database.js';
import { OrderService } from '../server/services/OrderService.js';
import { PaymentService } from '../server/services/PaymentService.js';
import { CupLabelService } from '../server/services/CupLabelService.js';
import { PrintQueueService, MockPrinterAdapter } from '../server/services/PrintQueueService.js';
import type { CreateOrderRequest } from '../server/types/index.js';
import { formatLocalOrderNumber } from '../server/util/local-trx-code.util.js';
import {
  seedMinimalTestCatalog,
  TEST_MOD_GROUP_MILK,
  TEST_MOD_GROUP_SHOTS,
  TEST_MOD_GROUP_SUGAR,
  TEST_MOD_OPTION_OAT,
  TEST_MOD_OPTION_SHOT_1,
  TEST_MOD_OPTION_SUGAR_50,
  TEST_PRODUCT_ID,
} from './helpers/test-catalog.js';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_p0.sqlite');

function cleanupDb(db?: OutletDatabase) {
  if (db) {
    try {
      db.db.close();
    } catch {
      // ignore
    }
  }
  OutletDatabase.resetInstance();
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }
  }
}

test('PHASE 0 & P0: Database Schema & Full Auto-Seed (produk, modifier, user, EDC, shift, transaksi)', async () => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_PATH);
  const products = db.db.prepare('SELECT count(*) as c FROM products').get() as { c: number };
  const nullStock = db.db.prepare('SELECT count(*) as c FROM products WHERE stock_qty IS NULL').get() as { c: number };
  const groups = db.db.prepare('SELECT count(*) as c FROM modifier_groups').get() as { c: number };
  const users = db.db.prepare('SELECT count(*) as c FROM users').get() as { c: number };
  const edc = db.db.prepare('SELECT count(*) as c FROM edc_configurations').get() as { c: number };
  const shifts = db.db.prepare('SELECT count(*) as c FROM shifts').get() as { c: number };
  const orders = db.db.prepare('SELECT count(*) as c FROM orders').get() as { c: number };
  const outboxTable = db.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbox_events'")
    .get();

  assert.equal(products.c, 26, 'Auto-seed 26 produk SakuPOS - Coffee');
  assert.equal(nullStock.c, 0, 'Semua produk memiliki stok awal non-null');
  assert.equal(groups.c, 5, '5 grup modifier lokal ter-seed');
  assert.ok(users.c >= 6, 'Minimal 6 staff user ter-seed');
  assert.equal(edc.c, 2, '2 konfigurasi EDC ter-seed di SQLite');
  assert.equal(shifts.c, 2, '2 shift historis ter-seed');
  assert.ok(orders.c >= 14, '14+ transaksi historis ter-seed');
  assert.equal(outboxTable, undefined, 'Tabel outbox_events tidak boleh ada');
});

test('P0 Item 7: Tiga minuman menghasilkan tiga cup sticker (1 label per cup verification)', async (t) => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_PATH);
  seedMinimalTestCatalog(db.db);
  const orderService = new OrderService(db);
  const printService = new PrintQueueService(db);

  // Order with 2x Aren Latte + 1x Caffe Latte = 3 cups total
  const req: CreateOrderRequest = {
    outletId: 'out_cibeureum',
    terminalId: 'TERM-01',
    cashierId: 'cashier_01',
    cashierName: 'Asep Barista',
    customerName: 'Budi Santoso',
    diningOption: 'takeaway',
    items: [
      {
        productId: TEST_PRODUCT_ID,
        variantSize: 'Large',
        quantity: 2,
        selectedModifiers: [
          { groupId: TEST_MOD_GROUP_SUGAR, groupName: 'Sugar Level', optionId: TEST_MOD_OPTION_SUGAR_50, optionName: 'Less Sugar (50%)', price: 0 },
          { groupId: TEST_MOD_GROUP_MILK, groupName: 'Dairy & Plant Milk', optionId: TEST_MOD_OPTION_OAT, optionName: 'Oatly Oat Milk', price: 8000 },
        ],
        notes: 'Extra hot',
      },
      {
        productId: TEST_PRODUCT_ID,
        variantSize: 'Regular',
        quantity: 1,
        selectedModifiers: [
          { groupId: TEST_MOD_GROUP_SHOTS, groupName: 'Espresso Shots', optionId: TEST_MOD_OPTION_SHOT_1, optionName: 'Extra Shot (1x)', price: 6000 },
        ],
      },
    ],
  };

  const created = orderService.createOrder(req);
  assert.ok(created.id, 'Order must have a valid UUID');
  assert.equal(created.orderNumber, formatLocalOrderNumber(new Date(), 1));

  // Verify Cup Label Print Jobs in database
  const jobs = printService.getJobsForOrder(created.id);
  const cupJobs = jobs.filter(j => j.jobType === 'CUP_LABEL');
  const receiptJobs = jobs.filter(j => j.jobType === 'RECEIPT');

  assert.equal(receiptJobs.length, 1, 'Exactly 1 customer receipt job must be queued');
  assert.equal(cupJobs.length, 3, 'CRITICAL: Exactly 3 cup stickers must be queued for 3 physical cups!');

  // Verify cup sequences: [1/3], [2/3], [3/3]
  assert.equal(cupJobs[0].labelIndex, 1);
  assert.equal(cupJobs[0].totalLabels, 3);
  assert.equal(cupJobs[1].labelIndex, 2);
  assert.equal(cupJobs[1].totalLabels, 3);
  assert.equal(cupJobs[2].labelIndex, 3);
  assert.equal(cupJobs[2].totalLabels, 3);

  // Verify modifier snapshot in sticker payload
  const cup1 = cupJobs[0].payload;
  assert.equal(cup1.productName, 'Test Latte');
  assert.equal(cup1.variantSize, 'Large');
  assert.deepEqual(cup1.modifiersSummary, ['Less Sugar (50%)', 'Oatly Oat Milk']);
  assert.equal(cup1.notes, 'Extra hot');

  // Verify HTML preview generation
  const html = CupLabelService.renderHtml(cup1);
  assert.ok(!html.includes(created.orderNumber), 'Trx code must not appear on cup sticker');
  assert.ok(!html.includes('[1/3]'), 'Indeks gelas [n/m] tidak ditampilkan di stiker');
  assert.ok(html.includes('Oatly Oat Milk'));
  assert.ok(html.includes('Less Sugar (50%)'));
  assert.ok(html.includes('Test Latte'));
  cleanupDb(db);
});

test('P0 Item 8: Reprint tidak membuat order baru (reprint flag test)', async (t) => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_PATH);
  seedMinimalTestCatalog(db.db);
  const orderService = new OrderService(db);
  const printService = new PrintQueueService(db);

  const baselineOrders = orderService.listOrders().length;

  const created = orderService.createOrder({
    outletId: 'out_cibeureum',
    terminalId: 'TERM-01',
    cashierId: 'cashier_01',
    cashierName: 'Asep',
    customerName: 'Dewi',
    items: [
      {
        productId: TEST_PRODUCT_ID,
        variantSize: 'Regular',
        quantity: 2,
      },
    ],
  });

  const orderCountAfterCreate = orderService.listOrders().length;
  assert.equal(orderCountAfterCreate, baselineOrders + 1);

  // Trigger reprint
  const reprintedCount = orderService.reprintCupLabels(created.id);
  assert.equal(reprintedCount, 2, 'Must reprint 2 cup labels');

  // Verify NO new order was created in orders table
  const orderCountAfterReprint = orderService.listOrders().length;
  assert.equal(orderCountAfterReprint, baselineOrders + 1, 'Reprint MUST NOT create a new order in database');

  // Verify print jobs contain is_reprint = true
  const jobs = printService.getJobsForOrder(created.id);
  const reprintJobs = jobs.filter(j => j.isReprint === true);
  assert.equal(reprintJobs.length, 2, '2 reprint jobs with is_reprint=true must exist');

  const renderedHtml = CupLabelService.renderHtml(reprintJobs[0].payload);
  assert.ok(renderedHtml.includes('*** REPRINT ***'), 'Reprint label must show prominent REPRINT badge');
});

test('P0 Item 9: Pembayaran UNKNOWN tidak otomatis dianggap PAID (payment state machine test)', async (t) => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_PATH);
  seedMinimalTestCatalog(db.db);
  const orderService = new OrderService(db);
  const paymentService = new PaymentService(db);

  const order = orderService.createOrder({
    outletId: 'out_cibeureum',
    terminalId: 'TERM-01',
    cashierId: 'cashier_01',
    cashierName: 'Asep',
    customerName: 'Hendra',
    items: [{ productId: TEST_PRODUCT_ID, variantSize: 'Regular', quantity: 1 }],
  });

  // Simulate EDC network timeout returning UNKNOWN state
  const res = paymentService.processPayment({
    orderId: order.id,
    paymentMethod: 'EDC_DEBIT',
    amountPaid: order.totalAmount,
    simulateState: 'UNKNOWN',
  });

  assert.equal(res.success, false);
  assert.equal(res.paymentStatus, 'UNKNOWN');
  assert.equal(res.reconciliationRequired, true);

  const freshOrder = orderService.getOrderById(order.id)!;
  assert.equal(freshOrder.paymentStatus, 'UNKNOWN', 'Order must strictly remain in UNKNOWN status');
  assert.notEqual(freshOrder.status, 'PREPARING', 'Order in UNKNOWN status must NOT proceed to barista');

  // Now perform reconciliation to PAID
  const reconciled = paymentService.reconcilePayment(order.id, 'PAID');
  assert.equal(reconciled.paymentStatus, 'PAID');
  assert.equal(reconciled.status, 'PREPARING');
});

test('P0 Item 10: Database tetap konsisten saat operasi gagal (transaction rollback test)', async (t) => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_PATH);
  seedMinimalTestCatalog(db.db);
  const orderService = new OrderService(db);

  const initialOrders = db.db.prepare('SELECT count(*) as c FROM orders').get() as { c: number };
  const initialItems = db.db.prepare('SELECT count(*) as c FROM order_items').get() as { c: number };

  // Attempt creating an order with invalid/non-existent product ID
  assert.throws(() => {
    orderService.createOrder({
      outletId: 'out_cibeureum',
      terminalId: 'TERM-01',
      cashierId: 'cashier_01',
      cashierName: 'Asep',
      items: [
        { productId: TEST_PRODUCT_ID, variantSize: 'Regular', quantity: 1 },
        { productId: 'INVALID_NON_EXISTENT_PRODUCT', variantSize: 'Regular', quantity: 1 },
      ],
    });
  }, /Product not found or inactive/);

  // Verify rollback: no half-inserted orders or items
  const postOrders = db.db.prepare('SELECT count(*) as c FROM orders').get() as { c: number };
  const postItems = db.db.prepare('SELECT count(*) as c FROM order_items').get() as { c: number };

  assert.equal(postOrders.c, initialOrders.c, 'Orders table must remain untouched on rollback');
  assert.equal(postItems.c, initialItems.c, 'Order items table must remain untouched on rollback');
});

test('P0 Item 11: PIN Login verification (valid vs invalid PIN and staff list)', async (t) => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_PATH);
  const { ShiftService } = await import('../server/services/ShiftService.js');
  const shiftService = new ShiftService(db);

  // 1. Staff list
  const users = shiftService.listUsers();
  assert.ok(users.length >= 3, 'Expected at least 3 seeded staff users (Asep, Luthfia, SPV)');

  // 2. Valid PIN
  const validUser = shiftService.verifyPin('12345');
  assert.ok(validUser !== null, 'PIN 12345 should authenticate Asep (demo lokal)');
  assert.equal(validUser.username, 'asep');
  assert.equal(validUser.role, 'CASHIER');

  // 3. Invalid PIN (unused)
  const invalidUser = shiftService.verifyPin('00000');
  assert.equal(invalidUser, null, 'Invalid PIN must return null');

  // Manager seeded PIN 99999 must work
  const mgrUser = shiftService.verifyPin('99999');
  assert.ok(mgrUser !== null && mgrUser.role === 'MANAGER', 'PIN 99999 must authenticate Manager');
});

test('ShiftService: calculateShiftSales mengklasifikasikan CASH, QRIS, EDC_DEBIT, dan EDC_CREDIT dengan benar', async () => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_PATH, { seedTransactions: false });
  seedMinimalTestCatalog(db.db);
  const orderService = new OrderService(db);
  const paymentService = new PaymentService(db);
  const { ShiftService } = await import('../server/services/ShiftService.js');
  const shiftService = new ShiftService(db);

  shiftService.openShift({
    outletId: 'out_cibeureum',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Asep Hidayat',
    startingCash: 100000,
  });

  const makePaid = (method: 'CASH' | 'QRIS' | 'EDC_DEBIT' | 'EDC_CREDIT') => {
    const o = orderService.createOrder({
      outletId: 'out_cibeureum',
      terminalId: 'TERM-01',
      cashierId: 'usr_asep',
      cashierName: 'Asep Hidayat',
      items: [{ productId: TEST_PRODUCT_ID, variantSize: 'Regular', quantity: 1 }],
    });
    paymentService.processPayment({ orderId: o.id, paymentMethod: method, amountPaid: o.totalAmount });
    return o.totalAmount;
  };

  const cashAmt = makePaid('CASH');
  const qrisAmt = makePaid('QRIS');
  const debitAmt = makePaid('EDC_DEBIT');
  const creditAmt = makePaid('EDC_CREDIT');

  const live = shiftService.getCurrentShift('TERM-01');
  assert.equal(live.summary?.cashSales, cashAmt);
  assert.equal(live.summary?.qrisSales, qrisAmt);
  assert.equal(live.summary?.edcSales, debitAmt + creditAmt);
  assert.equal(live.summary?.expectedCash, 100000 + cashAmt);
});

test('P0 Item 12: End Of Day Closing & Z-Report generation (expected cash, reconciliation, print job, outbox)', async (t) => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_PATH);
  seedMinimalTestCatalog(db.db);
  const orderService = new OrderService(db);
  const paymentService = new PaymentService(db);
  const { ShiftService } = await import('../server/services/ShiftService.js');
  const shiftService = new ShiftService(db);

  // 1. Open Shift with Rp 200.000 starting cash
  const openShift = shiftService.openShift({
    outletId: 'out_cibeureum',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Asep Hidayat',
    startingCash: 200000,
  });
  assert.equal(openShift.status, 'OPEN');
  assert.equal(openShift.startingCash, 200000);

  // 2. Create and pay an order (e.g. 1x Aren Latte Regular = Rp 24.000 + 10% tax = Rp 26.400)
  const order = orderService.createOrder({
    outletId: 'out_cibeureum',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Asep Hidayat',
    customerName: 'Deni',
    items: [{ productId: TEST_PRODUCT_ID, variantSize: 'Regular', quantity: 1 }],
  });
  paymentService.processPayment({
    orderId: order.id,
    paymentMethod: 'CASH',
    amountPaid: order.totalAmount,
  });

  // 3. Live Shift Summary check
  const live = shiftService.getCurrentShift('TERM-01');
  assert.equal(live.summary?.totalOrders, 1);
  assert.equal(live.summary?.totalCups, 1);
  assert.equal(live.summary?.cashSales, order.totalAmount);
  assert.equal(live.summary?.expectedCash, 200000 + order.totalAmount);

  // 4. End Of Day Closing with physical cash counted (e.g. Rp 226.400 -> exact match)
  const closedShift = shiftService.closeShift({
    shiftId: openShift.id,
    actualCash: 200000 + order.totalAmount,
    notes: 'Shift closing smooth',
    cashierId: 'usr_asep',
    cashierName: 'Asep Hidayat',
  });

  assert.equal(closedShift.status, 'CLOSED');
  assert.equal(closedShift.cashDifference, 0);
  assert.equal(closedShift.totalOrders, 1);

  // 5. Verify Z-Report print job was enqueued in SQLite for this shift
  const printJobs = db.db
    .prepare("SELECT * FROM print_jobs WHERE order_id = ? AND item_name = 'Z-REPORT CLOSING'")
    .all(openShift.id) as any[];
  assert.equal(printJobs.length, 1, 'Z-Report print job must be enqueued');
  assert.ok(printJobs[0].payload_json.includes('END OF DAY / Z-REPORT'));
});

test('P0 Item 13: Guest Pager System (Pager assignment, sticker label badge, and call/return workflow)', () => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_PATH);
  seedMinimalTestCatalog(db.db);
  const orderService = new OrderService(db);
  const printService = new PrintQueueService(db);

  // 1. Create order with Pager #04
  const order = orderService.createOrder({
    outletId: 'out_sakupos_coffee_01',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Asep Barista',
    customerName: 'Bapak Radit',
    diningOption: 'dinein',
    pagerNumber: '04',
    items: [
      {
        productId: TEST_PRODUCT_ID,
        variantSize: 'Regular',
        quantity: 1,
        notes: 'Less Sugar',
      },
    ],
  });

  assert.equal(order.pagerNumber, '04', 'Order must store assigned pagerNumber');

  // 2. Verify Pager Number exists in Cup Label print job payload and rendered HTML
  const jobs = printService.getJobsForOrder(order.id);
  const cupJob = jobs.find(j => j.jobType === 'CUP_LABEL');
  assert.ok(cupJob, 'Cup label print job must exist');
  assert.equal(cupJob.payload.pagerNumber, '04', 'Cup label payload must have pagerNumber 04');

  const renderedHtml = CupLabelService.renderHtml(cupJob.payload);
  assert.ok(!renderedHtml.includes('PGR #'), 'Cup label sticker must not show pager badge');

  // 3. Barista calls Pager: advance to READY
  const callingOrder = orderService.updateOrderStatus(order.id, 'READY');
  assert.equal(callingOrder.status, 'READY', 'Status must be READY when calling pager');

  // 4. Guest returns Pager: advance to COMPLETED
  const completedOrder = orderService.updateOrderStatus(order.id, 'COMPLETED');
  assert.equal(completedOrder.status, 'COMPLETED', 'Status must be COMPLETED when pager is returned');
});

