// tests/p1-lan-sqlite.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OutletDatabase } from '../server/db/database.js';
import { OrderService } from '../server/services/OrderService.js';
import { PrintQueueService, MockPrinterAdapter } from '../server/services/PrintQueueService.js';
import { formatLocalOrderNumber } from '../server/util/local-trx-code.util.js';
import {
  seedMinimalTestCatalog,
  TEST_MOD_GROUP_MILK,
  TEST_MOD_OPTION_ALMOND,
  TEST_PRODUCT_ID,
} from './helpers/test-catalog.js';

const TEST_DB_P1 = path.resolve(process.cwd(), 'data', 'test_p1_sqlite.sqlite');

function cleanupDb() {
  OutletDatabase.resetInstance();
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${TEST_DB_P1}${suffix}`;
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
      } catch {
        // ignore
      }
    }
  }
}

test('P1 Item 1: Dua kasir membuat order bersamaan (concurrent test - no order number clash)', async () => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_P1, { seedTransactions: false });
  seedMinimalTestCatalog(db.db);
  const orderService = new OrderService(db);

  const cashierAOrder = orderService.createOrder({
    outletId: 'out_cibeureum',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Kasir Terminal 1',
    customerName: 'Customer A',
    items: [{ productId: TEST_PRODUCT_ID, variantSize: 'Regular', quantity: 1 }],
  });

  const cashierBOrder = orderService.createOrder({
    outletId: 'out_cibeureum',
    terminalId: 'TERM-02',
    cashierId: 'usr_raka',
    cashierName: 'Kasir Terminal 2 (LAN)',
    customerName: 'Customer B',
    items: [{ productId: TEST_PRODUCT_ID, variantSize: 'Large', quantity: 1 }],
  });

  assert.notEqual(cashierAOrder.orderNumber, cashierBOrder.orderNumber, 'Order numbers must NEVER collide');
  assert.equal(cashierAOrder.orderNumber, formatLocalOrderNumber(new Date(), 1));
  assert.equal(cashierBOrder.orderNumber, formatLocalOrderNumber(new Date(), 2));
  cleanupDb();
});

test('P1 Item 2: Server restart setelah order tersimpan (persistence test)', async () => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_P1, { seedTransactions: false });
  seedMinimalTestCatalog(db.db);
  const orderService = new OrderService(db);

  const order = orderService.createOrder({
    outletId: 'out_cibeureum',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Kasir 1',
    customerName: 'Pak Joko',
    items: [
      {
        productId: TEST_PRODUCT_ID,
        variantSize: 'Large',
        quantity: 2,
        selectedModifiers: [
          {
            groupId: TEST_MOD_GROUP_MILK,
            groupName: 'Dairy & Plant Milk',
            optionId: TEST_MOD_OPTION_ALMOND,
            optionName: 'Almond Milk',
            price: 8000,
          },
        ],
      },
    ],
  });

  assert.equal(order.orderNumber, formatLocalOrderNumber(new Date(), 1));

  // Simulate server restart
  OutletDatabase.resetInstance();

  const restartedDb = new OutletDatabase(TEST_DB_P1, { seedTransactions: false });
  seedMinimalTestCatalog(restartedDb.db);
  const restartedOrderService = new OrderService(restartedDb);

  const retrieved = restartedOrderService.getOrderById(order.id);
  assert.ok(retrieved, 'Order must persist after restart');
  assert.equal(retrieved.orderNumber, formatLocalOrderNumber(new Date(), 1));
  assert.equal(retrieved.customerName, 'Pak Joko');
  assert.equal(retrieved.items?.length, 1);
  assert.equal(retrieved.items?.[0].quantity, 2);
  assert.equal(retrieved.items?.[0].modifiers[0].optionName, 'Almond Milk');

  const nextOrder = restartedOrderService.createOrder({
    outletId: 'out_cibeureum',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Kasir 1',
    customerName: 'Ibu Rina',
    items: [{ productId: TEST_PRODUCT_ID, variantSize: 'Regular', quantity: 1 }],
  });

  assert.equal(
    nextOrder.orderNumber,
    formatLocalOrderNumber(new Date(), 2),
    'Order sequence must continue monotonically across restarts',
  );
  cleanupDb();
});

test('P1 Item 3: Printer terputus lalu tersambung (print queue retry test)', async () => {
  cleanupDb();
  const db = new OutletDatabase(TEST_DB_P1, { seedTransactions: false });
  seedMinimalTestCatalog(db.db);
  const orderService = new OrderService(db);

  const receiptMock = new MockPrinterAdapter('Receipt');
  const cupMock = new MockPrinterAdapter('CupSticker');
  const printService = new PrintQueueService(db, receiptMock, cupMock);

  cupMock.online = false;

  const order = orderService.createOrder({
    outletId: 'out_cibeureum',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Kasir 1',
    customerName: 'Rudi',
    items: [{ productId: TEST_PRODUCT_ID, variantSize: 'Regular', quantity: 1 }],
  });

  await printService.processNextBatch();

  const jobs = printService.getJobsForOrder(order.id);
  const cupJob = jobs.find((j) => j.jobType === 'CUP_LABEL')!;
  assert.equal(cupJob.status, 'FAILED', 'Cup sticker job must fail gracefully when printer is offline');
  assert.equal(cupJob.retryCount, 1);

  cupMock.online = true;

  const processed = await printService.processNextBatch();
  assert.ok(processed >= 1, 'Print job must retry and succeed once printer is back online');

  const updatedJobs = printService.getJobsForOrder(order.id);
  const updatedCupJob = updatedJobs.find((j) => j.jobType === 'CUP_LABEL')!;
  assert.equal(updatedCupJob.status, 'COMPLETED');
  assert.ok(updatedCupJob.printedAt);
  cleanupDb();
});
